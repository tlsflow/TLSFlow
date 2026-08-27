import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { createCertificateServices } from '../certificates/index.js';
import { createSecurityServices } from '../security/security.controller.js';
import { createApp, createAppAsync } from '../../app.module.js';
import { InternalCaApplicationService } from './application/internal-ca.application-service.js';
import { getInternalCaRouteContracts } from './controller/internal-ca.controller.js';
import { CaOperationsRepository } from './repository/ca-operations.repository.js';
import type { AgentsApplicationService } from '../agents/application/agents.application-service.js';

const previousSecretKek = process.env.GCAC_SECRET_KEK;
const previousCaConfirmationSecret = process.env.GCAC_CA_CONFIRMATION_SECRET;

before(() => {
  process.env.GCAC_SECRET_KEK = 'test-secret-kek-for-internal-ca';
  process.env.GCAC_CA_CONFIRMATION_SECRET = 'test-ca-confirmation-secret';
});

after(() => {
  if (previousSecretKek === undefined) delete process.env.GCAC_SECRET_KEK;
  else process.env.GCAC_SECRET_KEK = previousSecretKek;
  if (previousCaConfirmationSecret === undefined) delete process.env.GCAC_CA_CONFIRMATION_SECRET;
  else process.env.GCAC_CA_CONFIRMATION_SECRET = previousCaConfirmationSecret;
});

async function createFixture() {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');
  const security = createSecurityServices();
  const certificates = createCertificateServices(security, { db });
  const service = new InternalCaApplicationService({
    db,
    secrets: security.secrets,
    certificates: certificates.certificates,
    audit: security.audit,
    approvals: security.approvals,
  });
  return { db, service };
}

test('缺少 CA 风险确认密钥时拒绝执行拓扑预览', async () => {
  const current = process.env.GCAC_CA_CONFIRMATION_SECRET;
  delete process.env.GCAC_CA_CONFIRMATION_SECRET;
  const db = new PgliteDatabase();
  const security = createSecurityServices();
  const service = new InternalCaApplicationService({
    db,
    secrets: security.secrets,
    certificates: createCertificateServices(security, { db }).certificates,
  });
  try {
    assert.throws(
      () => service.previewAuthority({
        topologyMode: 'root_only',
        deploymentMode: 'builtin',
        runtimePlatform: 'embedded',
        availabilityMode: 'single',
        keyBackend: 'secret',
      }),
      (error: unknown) => error instanceof Error
        && 'errorCode' in error
        && error.errorCode === 'CA_RISK_CONFIRMATION_REQUIRED',
    );
  } finally {
    await db.close();
    if (current === undefined) delete process.env.GCAC_CA_CONFIRMATION_SECRET;
    else process.env.GCAC_CA_CONFIRMATION_SECRET = current;
  }
});

test('通用 CA 路由同时暴露宿主 ACME 生命周期和运营合同', () => {
  const routes = getInternalCaRouteContracts();
  const paths = routes.map((route) => route.path.toLowerCase());

  assert.ok(paths.every((path) => path.startsWith('/api/v1/ca-')
    || path.startsWith('/api/v1/certificate-')
    || path.startsWith('/api/v1/acme/')
    || path.startsWith('/api/v1/reports/')
    || path.startsWith('/api/v1/public/')));
  assert.equal(paths.includes('/api/v1/certificate-authorities'), true);
  assert.equal(paths.includes('/api/v1/certificate-requests'), true);
  assert.equal(paths.includes('/api/v1/ca-operations/records'), true);
  assert.equal(paths.includes('/api/v1/acme/status'), true);
  assert.equal(paths.includes('/api/v1/acme/provider-profiles'), true);
  assert.equal(paths.includes('/api/v1/acme/providers/probe-directory'), true);
  assert.equal(paths.includes('/api/v1/acme/certificates'), true);
  assert.equal(paths.includes('/api/v1/certificate-rotations'), true);
  assert.equal(paths.includes('/api/v1/certificate-rotations/:id/install-action'), true);
  assert.equal(paths.includes('/api/v1/certificate-rotations/:id/tls-verify'), true);
  const publicCrlRoute = routes.find((route) => route.path === '/api/v1/public/ca-crl/:tenantId/:caId');
  assert.equal(publicCrlRoute?.responseContentType, 'application/pkix-crl');
  assert.equal(paths.some((path) => path.includes('certificate-acme')), false);
});

test('ACME 读取接口兼容证书管理的 certificate.read 权限合同', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');
  const security = createSecurityServices();
  security.rbac.createPolicy({
    subjectType: 'user',
    subjectId: 'user-acme-read',
    effect: 'allow',
    actions: ['certificate.read'],
    resourceTypes: ['certificate_asset'],
    scope: { tenantId: 'tenant-acme-read' },
  });
  const app = createApp({ db, corePersistence: { mode: 'memory' }, security });
  app.setAuthTokenResolver(() => ({ actorId: 'user-acme-read', tenantId: 'tenant-acme-read' }));
  try {
    const status = await app.inject({
      method: 'GET',
      path: '/api/v1/acme/status',
      headers: { authorization: 'Bearer test', 'x-tenant-id': 'tenant-acme-read', 'x-actor-id': 'user-acme-read' },
    });
    const providers = await app.inject({
      method: 'GET',
      path: '/api/v1/acme/providers',
      headers: { authorization: 'Bearer test', 'x-tenant-id': 'tenant-acme-read', 'x-actor-id': 'user-acme-read' },
    });
    assert.equal(status.statusCode, 200, JSON.stringify(status.body));
    assert.equal(providers.statusCode, 200, JSON.stringify(providers.body));
  } finally {
    await db.close();
  }
});

test('通用 CA 对象可以创建并查询，不携带厂商执行语义', async () => {
  const { db, service } = await createFixture();
  try {
    const tenantId = 'tenant-generic-ca-lifecycle';
    const provider = await service.createProvider(tenantId, {
      name: '内置 CA 对象',
      type: 'gcac_builtin',
      deploymentMode: 'builtin',
      runtimePlatform: 'embedded',
      availabilityMode: 'single',
    }, 'user-admin');
    const preview = service.previewAuthority({
      topologyMode: 'root_only',
      deploymentMode: 'builtin',
      runtimePlatform: 'embedded',
      availabilityMode: 'single',
      keyBackend: 'secret',
    });
    const [authority] = await service.createAuthority(tenantId, {
      providerId: provider.id,
      name: '通用根 CA 对象',
      securityDomain: 'production',
      topologyMode: 'root_only',
      deploymentMode: 'builtin',
      runtimePlatform: 'embedded',
      availabilityMode: 'single',
      keyBackend: 'secret',
      confirmationToken: preview.confirmationToken,
      actorId: 'user-admin',
    });

    assert.equal(authority?.providerId, provider.id);
    assert.equal(authority?.role, 'root');
    assert.equal(authority?.subjectCommonName, '通用根 CA 对象');
    assert.equal((await service.listAuthorities(tenantId)).length, 1);
  } finally {
    await db.close();
  }
});

test('ACME 首次申请复用已存在的自动信任域', async () => {
  const { db, service } = await createFixture();
  try {
    const tenantId = 'tenant-acme-orphan-domain';
    const provider = await service.createProvider(tenantId, {
      name: "Let's Encrypt",
      type: 'acme',
      deploymentMode: 'external',
      runtimePlatform: 'external',
      availabilityMode: 'single',
    }, 'user-admin');
    const domain = await service.createTrustDomain(tenantId, {
      name: `ACME ${provider.name} Issuer 信任域`,
      purpose: 'acme',
    }, 'user-admin');

    const context = await service.ensureAcmeIssuanceContext(tenantId, provider.id, 'user-admin');

    assert.equal(context.trustDomainId, domain.id);
    assert.equal((await service.listTrustDomains(tenantId)).length, 1);
    assert.equal((await service.listAuthorities(tenantId)).length, 1);
  } finally {
    await db.close();
  }
});

test('ACME 首次申请并发初始化保持幂等', async () => {
  const { db, service } = await createFixture();
  try {
    const tenantId = 'tenant-acme-concurrent-init';
    const provider = await service.createProvider(tenantId, {
      name: "Let's Encrypt",
      type: 'acme',
      deploymentMode: 'external',
      runtimePlatform: 'external',
      availabilityMode: 'single',
    }, 'user-admin');

    const contexts = await Promise.all([
      service.ensureAcmeIssuanceContext(tenantId, provider.id, 'user-admin'),
      service.ensureAcmeIssuanceContext(tenantId, provider.id, 'user-admin'),
    ]);

    assert.equal(new Set(contexts.map((item) => item.caId)).size, 1);
    assert.equal(new Set(contexts.map((item) => item.trustDomainId)).size, 1);
    assert.equal((await service.listTrustDomains(tenantId)).length, 1);
    assert.equal((await service.listAuthorities(tenantId)).length, 1);
  } finally {
    await db.close();
  }
});

test('外部 Provider 可先创建，未绑定固定动作时申请被明确拒绝', async () => {
  const { db, service } = await createFixture();
  try {
    const tenantId = 'tenant-plugin-binding';
    const provider = await service.createProvider(tenantId, {
      name: '未绑定版本的外部 Provider', type: 'plugin', deploymentMode: 'external', runtimePlatform: 'external', availabilityMode: 'single',
    }, 'user-admin');
    const preview = service.previewAuthority({
      topologyMode: 'external_managed', deploymentMode: 'external', runtimePlatform: 'external', availabilityMode: 'single', keyBackend: 'secret',
    });
    const [authority] = await service.createAuthority(tenantId, {
      providerId: provider.id, name: '外部 CA', securityDomain: 'production', commonName: '外部 CA', topologyMode: 'external_managed',
      deploymentMode: 'external', runtimePlatform: 'external', availabilityMode: 'single', keyBackend: 'secret', confirmationToken: preview.confirmationToken, actorId: 'user-admin',
    });
    const profile = await service.createProfile(tenantId, {
      name: '外部 CA Profile', securityDomain: 'production', actorId: 'user-admin',
    });
    await assert.rejects(() => service.createCertificateRequest(tenantId, {
      applicationAssetId: 'app-1', caId: authority!.id, profileVersionId: profile.version.id, commonName: 'app.example.com', sans: ['app.example.com'],
      custodyMode: 'managed_secret', deferIssuance: true, actorId: 'user-admin',
    }),
      (error: unknown) => error instanceof Error
        && 'errorCode' in error
        && error.errorCode === 'CA_PROVIDER_ACTION_UNBOUND',
    );
  } finally {
    await db.close();
  }
});

test('Microsoft AD CS Provider 支持更新并可删除登记而不破坏关联 CA 历史', async () => {
  const { db, service } = await createFixture();
  try {
    const tenantId = 'tenant-microsoft-adcs-management';
    const provider = await service.createProvider(tenantId, {
      name: 'Windows AD CS Agent 01',
      type: 'plugin',
      deploymentMode: 'external',
      runtimePlatform: 'windows',
      availabilityMode: 'single',
      configuration: {
        providerKind: 'microsoft_adcs',
        profile: 'windows.agent_plan.adcs',
        agentId: 'agent-windows-01',
        caConfig: 'CA-SERVER\\IssuingCA',
        templateId: 'WebServer',
      },
    }, 'user-admin');
    const updated = await service.updateProvider(tenantId, provider.id, {
      name: 'Windows AD CS Agent 01 Updated',
      configuration: { agentId: 'agent-windows-02', templateId: 'ServerAuth' },
    }, 'user-admin');
    assert.equal(updated.name, 'Windows AD CS Agent 01 Updated');
    assert.equal(updated.configuration.agentId, 'agent-windows-02');
    assert.equal(updated.configuration.templateId, 'ServerAuth');

    const preview = service.previewAuthority({
      topologyMode: 'external_managed', deploymentMode: 'external', runtimePlatform: 'windows', availabilityMode: 'single', keyBackend: 'device',
    });
    const [authority] = await service.createAuthority(tenantId, {
      providerId: provider.id,
      name: 'Windows AD CS CA',
      commonName: 'Windows AD CS CA',
      securityDomain: 'production',
      topologyMode: 'external_managed',
      deploymentMode: 'external',
      runtimePlatform: 'windows',
      availabilityMode: 'single',
      keyBackend: 'device',
      configuration: { providerKind: 'microsoft_adcs', templateId: 'WebServer' },
      confirmationToken: preview.confirmationToken,
      actorId: 'user-admin',
    });
    assert.equal(authority?.status, 'active');
    assert.equal(authority?.configuration?.templateId, 'WebServer');
    assert.ok(authority?.trustDomainId);

    const deleted = await service.deleteProvider(tenantId, provider.id, 'user-admin');
    assert.deepEqual(deleted, { id: provider.id, deleted: true });
    const [savedProvider] = await service.listProviders(tenantId);
    const [savedAuthority] = await service.listAuthorities(tenantId);
    assert.equal(savedProvider?.status, 'disabled');
    assert.equal(savedProvider?.configuration.registrationStatus, 'deleted');
    assert.equal(savedAuthority?.status, 'retired');
  } finally {
    await db.close();
  }
});

test('Microsoft AD CS Authority 创建按 Provider 和 caConfig 幂等，多个 CA 禁止无身份创建', async () => {
  const { db, service } = await createFixture();
  try {
    const tenantId = 'tenant-adcs-authority-idempotency';
    const provider = await service.createProvider(tenantId, {
      name: 'Windows AD CS Agent',
      type: 'plugin',
      deploymentMode: 'external',
      runtimePlatform: 'windows',
      availabilityMode: 'single',
      configuration: { providerKind: 'microsoft_adcs' },
    }, 'user-admin');
    const preview = service.previewAuthority({
      topologyMode: 'external_managed', deploymentMode: 'external', runtimePlatform: 'windows', availabilityMode: 'single', keyBackend: 'device',
    });
    const [first] = await service.createAuthority(tenantId, {
      providerId: provider.id, name: 'jackson-mgt', commonName: 'jackson-mgt', securityDomain: 'production',
      topologyMode: 'external_managed', deploymentMode: 'external', runtimePlatform: 'windows', availabilityMode: 'single', keyBackend: 'device',
      configuration: { providerKind: 'microsoft_adcs' }, confirmationToken: preview.confirmationToken, actorId: 'user-admin',
    });
    const [sameProviderCa] = await service.createAuthority(tenantId, {
      providerId: provider.id, name: 'Jackson-DC-CA', commonName: 'Jackson-DC-CA', securityDomain: 'production',
      topologyMode: 'external_managed', deploymentMode: 'external', runtimePlatform: 'windows', availabilityMode: 'single', keyBackend: 'device',
      configuration: { providerKind: 'microsoft_adcs' }, confirmationToken: preview.confirmationToken, actorId: 'user-admin',
    });
    assert.equal(sameProviderCa?.id, first?.id);
    assert.equal((await service.listAuthorities(tenantId)).length, 1);

    await service.deleteAuthority(tenantId, first!.id, 'user-admin');
    const [restored] = await service.createAuthority(tenantId, {
      providerId: provider.id, name: 'Jackson-DC-CA', commonName: 'Jackson-DC-CA', securityDomain: 'production',
      topologyMode: 'external_managed', deploymentMode: 'external', runtimePlatform: 'windows', availabilityMode: 'single', keyBackend: 'device',
      configuration: { providerKind: 'microsoft_adcs' }, confirmationToken: preview.confirmationToken, actorId: 'user-admin',
    });
    assert.equal(restored?.id, first?.id);
    assert.equal(restored?.status, 'active');
    assert.equal((await service.listAuthorities(tenantId)).length, 1);

    const [second] = await service.createAuthority(tenantId, {
      providerId: provider.id, name: 'Jackson-DC-CA', commonName: 'Jackson-DC-CA', securityDomain: 'production',
      topologyMode: 'external_managed', deploymentMode: 'external', runtimePlatform: 'windows', availabilityMode: 'single', keyBackend: 'device',
      configuration: { providerKind: 'microsoft_adcs', caConfig: 'CA-SERVER\\Jackson-DC-CA' }, confirmationToken: preview.confirmationToken, actorId: 'user-admin',
    });
    assert.notEqual(second?.id, first?.id);
    assert.equal((await service.listAuthorities(tenantId)).length, 2);
    await service.deleteAuthority(tenantId, second!.id, 'user-admin');
    const [restoredByIdentity] = await service.createAuthority(tenantId, {
      providerId: provider.id, name: 'Jackson-DC-CA', commonName: 'Jackson-DC-CA', securityDomain: 'production',
      topologyMode: 'external_managed', deploymentMode: 'external', runtimePlatform: 'windows', availabilityMode: 'single', keyBackend: 'device',
      configuration: { providerKind: 'microsoft_adcs', caConfig: 'CA-SERVER\\Jackson-DC-CA' }, confirmationToken: preview.confirmationToken, actorId: 'user-admin',
    });
    assert.equal(restoredByIdentity?.id, second?.id);
    assert.equal(restoredByIdentity?.status, 'active');
    assert.equal((await service.listAuthorities(tenantId)).length, 2);
    await assert.rejects(
      () => service.createAuthority(tenantId, {
        providerId: provider.id, name: '未指定 CA', commonName: '未指定 CA', securityDomain: 'production',
        topologyMode: 'external_managed', deploymentMode: 'external', runtimePlatform: 'windows', availabilityMode: 'single', keyBackend: 'device',
        configuration: { providerKind: 'microsoft_adcs' }, confirmationToken: preview.confirmationToken, actorId: 'user-admin',
      }),
      (error: unknown) => error instanceof Error && 'errorCode' in error && error.errorCode === 'CA_TOPOLOGY_INVALID',
    );
  } finally {
    await db.close();
  }
});

test('同机 AD CS Agent 保持独立注册，并在查询 Provider 时补偿登记', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');
  const app = await createAppAsync({ db, corePersistence: { mode: 'memory' } });
  const agents = app.getResource('agentsService') as AgentsApplicationService;
  const service = app.getResource('internalCaService') as InternalCaApplicationService;
  const tenantId = 'tenant-adcs-provider-reconcile';
  try {
    const fullAgent = await agents.register(tenantId, {
      agentKey: 'full-agent-same-host',
      machineId: 'same-host-machine',
      hostname: 'same-host',
      version: '1.0.0',
      osType: 'WINDOWS',
      role: 'full_agent',
      ipAddress: '10.0.0.10',
    }, 'request_full_same_host');
    const adcsAgent = await agents.register(tenantId, {
      agentKey: 'adcs-agent-same-host',
      machineId: 'same-host-machine',
      hostname: 'same-host',
      version: '1.0.0',
      osType: 'WINDOWS_ADCS',
      role: 'adcs_agent',
      ipAddress: '10.0.0.10',
      caName: 'SAME-HOST-CA',
    }, 'request_adcs_same_host');

    assert.notEqual(adcsAgent.id, fullAgent.id);
    assert.equal((await agents.getAgentDetail(tenantId, fullAgent.id)).agent.role, 'full_agent');
    assert.equal((await agents.getAgentDetail(tenantId, adcsAgent.id)).agent.role, 'adcs_agent');

    const initialProvider = (await service.listProviders(tenantId))
      .find((provider) => provider.configuration.providerKind === 'microsoft_adcs');
    assert.equal(initialProvider?.configuration.agentId, adcsAgent.id);
    assert.ok(initialProvider);

    assert.equal(await service.getRepository().deleteUnboundProvider(tenantId, initialProvider.id), true);
    assert.equal((await service.getRepository().listProviders(tenantId)).some((provider) => provider.id === initialProvider.id), false);

    const reconciledProvider = (await service.listProviders(tenantId))
      .find((provider) => provider.configuration.providerKind === 'microsoft_adcs');
    assert.ok(reconciledProvider);
    assert.equal(reconciledProvider?.configuration.agentId, adcsAgent.id);
    assert.equal(reconciledProvider?.status, 'active');
    const bindings = await service.listProviderActionBindings(tenantId, reconciledProvider!.id);
    assert.equal(bindings[0]?.issueAction?.actionId, 'ca.certificate.issue.v1');

    await service.ensureAdcsProviderForAgent({
      tenantId,
      agentId: adcsAgent.id,
      agentKey: adcsAgent.agentKey,
      name: 'SAME-HOST-CA',
      pluginVersionId: 'ca-microsoft-adcs-current-v2',
    });
    const updatedBindings = await service.listProviderActionBindings(tenantId, reconciledProvider!.id);
    assert.equal(updatedBindings[0]?.pluginVersionId, 'ca-microsoft-adcs-current-v2');
  } finally {
    await db.close();
  }
});

test('AD CS Agent 重装后按同名 Provider 复用原登记，不制造重复 Provider', async () => {
  const { db, service } = await createFixture();
  const tenantId = 'tenant-adcs-provider-reuse';
  try {
    const original = await service.createProvider(tenantId, {
      name: 'Jackson-DC-CA',
      type: 'plugin',
      deploymentMode: 'external',
      runtimePlatform: 'windows',
      availabilityMode: 'single',
      configuration: {
        providerKind: 'microsoft_adcs',
        agentId: 'agent-old',
        agentKey: 'adcs-old-key',
        caConfig: 'CA-SERVER\\Jackson-DC-CA',
        registrationStatus: 'deleted',
      },
    }, 'system');
    await service.createProviderActionBinding(tenantId, {
      providerId: original.id,
      pluginVersionId: 'ca-microsoft-adcs-old-v1',
      executionLocation: 'control_plane',
      issueAction: { actionId: 'ca.certificate.issue.v1', actionVersion: 'v1' },
      status: 'active',
    }, 'system');
    await service.ensureAdcsProviderForAgent({
      tenantId,
      agentId: 'agent-new',
      agentKey: 'adcs-new-key',
      name: 'jackson-dc-ca',
      pluginVersionId: 'ca-microsoft-adcs-current-v2',
    });

    const providers = (await service.getRepository().listProviders(tenantId))
      .filter((provider) => provider.configuration.providerKind === 'microsoft_adcs');
    assert.equal(providers.length, 1);
    assert.equal(providers[0]?.id, original.id);
    assert.equal(providers[0]?.status, 'active');
    assert.equal(providers[0]?.configuration.agentId, 'agent-new');
    assert.equal(providers[0]?.configuration.caConfig, 'CA-SERVER\\Jackson-DC-CA');
    const bindings = await service.listProviderActionBindings(tenantId, original.id);
    assert.equal(bindings[0]?.pluginVersionId, 'ca-microsoft-adcs-current-v2');
    assert.equal(bindings[0]?.capabilityEvidence?.agentId, 'agent-new');
    assert.equal(bindings[0]?.capabilityEvidence?.agentKey, 'adcs-new-key');
  } finally {
    await db.close();
  }
});

test('跨服务并发补偿同名 AD CS Provider 仍保持单行登记', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');
  const security = createSecurityServices();
  const certificates = createCertificateServices(security, { db });
  const serviceA = new InternalCaApplicationService({ db, secrets: security.secrets, certificates: certificates.certificates, audit: security.audit, approvals: security.approvals });
  const serviceB = new InternalCaApplicationService({ db, secrets: security.secrets, certificates: certificates.certificates, audit: security.audit, approvals: security.approvals });
  const tenantId = 'tenant-adcs-provider-cross-service-race';
  try {
    await Promise.all([
      serviceA.ensureAdcsProviderForAgent({ tenantId, agentId: 'agent-race-a', agentKey: 'adcs-race-a', name: 'Jackson-DC-CA', pluginVersionId: 'ca-microsoft-adcs-current-v2' }),
      serviceB.ensureAdcsProviderForAgent({ tenantId, agentId: 'agent-race-b', agentKey: 'adcs-race-b', name: 'JACKSON-DC-CA', pluginVersionId: 'ca-microsoft-adcs-current-v2' }),
    ]);
    const providers = await serviceA.getRepository().listProviders(tenantId);
    const matching = providers.filter((provider) => provider.name.toLowerCase() === 'jackson-dc-ca');
    assert.equal(matching.length, 1);
    const bindings = await serviceA.listProviderActionBindings(tenantId, matching[0]!.id);
    assert.equal(bindings.filter((binding) => binding.status !== 'disabled').length, 1);
  } finally {
    await db.close();
  }
});

test('AD CS Authority 从历史主机名切换到 caConfig 时自动复用并补齐身份', async () => {
  const { db, service } = await createFixture();
  const tenantId = 'tenant-adcs-authority-hostname-migration';
  try {
    const provider = await service.createProvider(tenantId, {
      name: 'jackson-mgt', type: 'plugin', deploymentMode: 'external', runtimePlatform: 'windows', availabilityMode: 'single',
      configuration: { providerKind: 'microsoft_adcs', agentId: 'agent-adcs' },
    }, 'system');
    const preview = service.previewAuthority({
      topologyMode: 'external_managed', deploymentMode: 'external', runtimePlatform: 'windows', availabilityMode: 'single', keyBackend: 'device',
    });
    const [oldAuthority] = await service.createAuthority(tenantId, {
      providerId: provider.id, name: 'jackson-mgt', commonName: 'Jackson-DC-CA', securityDomain: 'production',
      topologyMode: 'external_managed', deploymentMode: 'external', runtimePlatform: 'windows', availabilityMode: 'single', keyBackend: 'device',
      configuration: { providerKind: 'microsoft_adcs', agentId: 'agent-adcs' }, confirmationToken: preview.confirmationToken, actorId: 'system',
    });
    const [reused] = await service.createAuthority(tenantId, {
      providerId: provider.id, name: 'Jackson-DC-CA', commonName: 'Jackson-DC-CA', securityDomain: 'production',
      topologyMode: 'external_managed', deploymentMode: 'external', runtimePlatform: 'windows', availabilityMode: 'single', keyBackend: 'device',
      configuration: { providerKind: 'microsoft_adcs', agentId: 'agent-adcs', caConfig: 'JACKSON-MGT\\Jackson-DC-CA' },
      confirmationToken: preview.confirmationToken, actorId: 'system',
    });
    assert.equal(reused?.id, oldAuthority?.id);
    assert.equal(reused?.configuration?.caConfig, 'JACKSON-MGT\\Jackson-DC-CA');
    assert.equal((await service.listAuthorities(tenantId)).length, 1);
  } finally {
    await db.close();
  }
});

test('多个历史 AD CS Provider 存在时按名称复用，不改名撞唯一索引', async () => {
  const { db, service } = await createFixture();
  const tenantId = 'tenant-adcs-provider-name-precedence';
  try {
    const oldProvider = await service.createProvider(tenantId, {
      name: 'jackson-mgt',
      type: 'plugin',
      deploymentMode: 'external',
      runtimePlatform: 'windows',
      availabilityMode: 'single',
      configuration: { providerKind: 'microsoft_adcs', agentId: 'agent-old', agentKey: 'adcs-old-key' },
    }, 'system');
    const currentProvider = await service.createProvider(tenantId, {
      name: 'Jackson-DC-CA',
      type: 'plugin',
      deploymentMode: 'external',
      runtimePlatform: 'windows',
      availabilityMode: 'single',
      configuration: { providerKind: 'microsoft_adcs', agentId: 'agent-current', agentKey: 'adcs-current-key' },
    }, 'system');

    await service.ensureAdcsProviderForAgent({
      tenantId,
      agentId: 'agent-reinstalled',
      agentKey: 'adcs-reinstalled-key',
      name: 'Jackson-DC-CA',
      pluginVersionId: 'ca-microsoft-adcs-current-v2',
    });

    const providers = (await service.getRepository().listProviders(tenantId))
      .filter((provider) => provider.configuration.providerKind === 'microsoft_adcs');
    assert.equal(providers.length, 2);
    assert.equal(providers.find((provider) => provider.id === oldProvider.id)?.name, 'jackson-mgt');
    assert.equal(providers.find((provider) => provider.id === currentProvider.id)?.configuration.agentId, 'agent-reinstalled');
  } finally {
    await db.close();
  }
});

test('旧版缺少 providerKind 的 Windows Provider 按名称自动迁移为 AD CS 登记', async () => {
  const { db, service } = await createFixture();
  const tenantId = 'tenant-adcs-legacy-provider';
  try {
    const legacy = await service.createProvider(tenantId, {
      name: 'Jackson-DC-CA',
      type: 'plugin',
      deploymentMode: 'external',
      // 旧版本只保存通用 external 平台和名称，没有 AD CS 标记。
      runtimePlatform: 'external',
      availabilityMode: 'single',
      configuration: {},
    }, 'system');

    await Promise.all([
      service.ensureAdcsProviderForAgent({
        tenantId,
        agentId: 'agent-adcs-1',
        agentKey: 'adcs-key-1',
        name: 'jackson-dc-ca',
        pluginVersionId: 'ca-microsoft-adcs-current-v2',
      }),
      service.ensureAdcsProviderForAgent({
        tenantId,
        agentId: 'agent-adcs-1',
        agentKey: 'adcs-key-1',
        name: 'JACKSON-DC-CA',
        pluginVersionId: 'ca-microsoft-adcs-current-v2',
      }),
    ]);

    const providers = (await service.getRepository().listProviders(tenantId))
      .filter((provider) => provider.name.toLowerCase() === 'jackson-dc-ca');
    assert.equal(providers.length, 1);
    assert.equal(providers[0]?.id, legacy.id);
    assert.equal(providers[0]?.configuration.providerKind, 'microsoft_adcs');
    assert.equal(providers[0]?.configuration.agentId, 'agent-adcs-1');
    assert.equal(providers[0]?.status, 'active');
    assert.equal((await service.listProviderActionBindings(tenantId, legacy.id)).length, 1);
  } finally {
    await db.close();
  }
});

test('AD CS Agent 以真实 CA 名称上报时复用按主机名创建的旧 Provider', async () => {
  const { db, service } = await createFixture();
  const tenantId = 'tenant-adcs-provider-hostname-legacy';
  try {
    const legacy = await service.createProvider(tenantId, {
      name: 'jackson-mgt',
      type: 'plugin',
      deploymentMode: 'external',
      runtimePlatform: 'external',
      availabilityMode: 'single',
      configuration: {},
    }, 'system');
    await service.getRepository().saveAuthority({
      id: 'ca-hostname-legacy',
      tenantId,
      name: 'Jackson-DC-CA',
      role: 'root',
      topologyMode: 'external_managed',
      providerId: legacy.id,
      securityDomain: 'production',
      status: 'active',
      subjectCommonName: 'Jackson-DC-CA',
      configuration: {},
      createdAt: '2026-08-26T00:00:00.000Z',
      updatedAt: '2026-08-26T00:00:00.000Z',
    });

    await service.ensureAdcsProviderForAgent({
      tenantId,
      agentId: 'agent-current',
      agentKey: 'adcs-current-key',
      name: 'Jackson-DC-CA',
      pluginVersionId: 'ca-microsoft-adcs-current-v2',
    });

    const providers = await service.getRepository().listProviders(tenantId);
    assert.equal(providers.length, 1);
    assert.equal(providers[0]?.id, legacy.id);
    assert.equal(providers[0]?.name, 'Jackson-DC-CA');
    assert.equal(providers[0]?.configuration.providerKind, 'microsoft_adcs');
    assert.equal((await service.getRepository().getAuthority(tenantId, 'ca-hostname-legacy'))?.providerId, legacy.id);
  } finally {
    await db.close();
  }
});

test('AD CS Provider 补偿会同步修正 Authority 的旧 Agent 和插件版本引用', async () => {
  const { db, service } = await createFixture();
  const tenantId = 'tenant-adcs-authority-reconcile';
  try {
    const provider = await service.createProvider(tenantId, {
      name: 'Jackson-DC-CA',
      type: 'plugin',
      deploymentMode: 'external',
      runtimePlatform: 'windows',
      availabilityMode: 'single',
      configuration: { providerKind: 'microsoft_adcs', agentId: 'agent-old', pluginVersionId: 'ca-microsoft-adcs-old-v1' },
    }, 'system');
    await service.getRepository().saveAuthority({
      id: 'ca-authority-reconcile',
      tenantId,
      name: 'Jackson-DC-CA',
      role: 'root',
      topologyMode: 'external_managed',
      providerId: provider.id,
      securityDomain: 'production',
      status: 'active',
      subjectCommonName: 'Jackson-DC-CA',
      configuration: { providerKind: 'microsoft_adcs', agentId: 'agent-old', pluginVersionId: 'ca-microsoft-adcs-old-v1' },
      createdAt: '2026-08-26T00:00:00.000Z',
      updatedAt: '2026-08-26T00:00:00.000Z',
    });

    await service.ensureAdcsProviderForAgent({
      tenantId,
      agentId: 'agent-new',
      agentKey: 'adcs-key-new',
      name: 'Jackson-DC-CA',
      caConfig: 'ADCS-SERVER\\Jackson-DC-CA',
      pluginVersionId: 'ca-microsoft-adcs-current-v2',
    });

    const authority = await service.getRepository().getAuthority(tenantId, 'ca-authority-reconcile');
    assert.equal(authority?.configuration?.agentId, 'agent-new');
    assert.equal(authority?.configuration?.agentKey, 'adcs-key-new');
    assert.equal(authority?.configuration?.caConfig, 'ADCS-SERVER\\Jackson-DC-CA');
    assert.equal(authority?.configuration?.pluginVersionId, 'ca-microsoft-adcs-current-v2');
  } finally {
    await db.close();
  }
});

test('CA 运营读取入口触发 AD CS Provider 补偿', async () => {
  const { db, service } = await createFixture();
  const tenantId = 'tenant-adcs-operation-reconcile';
  let calls = 0;
  service.setAdcsProviderReconciler(async () => {
    calls += 1;
  });
  try {
    await service.listCaOperationsTree(tenantId, async () => true);
    await service.listCaOperationsRecords(tenantId, { caId: 'missing-ca', view: 'request', limit: 50 }).catch(() => undefined);
    assert.equal(calls, 2);
  } finally {
    await db.close();
  }
});

test('Windows AD CS Agent 主动观测直接幂等入库并可查询', async () => {
  const { db, service } = await createFixture();
  const tenantId = 'tenant-adcs-active-observation';
  const agentId = 'agt-adcs-active-observation';
  try {
    service.setAdcsAgentResolver(async () => ({
      id: agentId,
      agentKey: 'adcs-observation-key',
      role: 'adcs_agent',
      status: 'ONLINE',
      descriptor: { osType: 'WINDOWS_ADCS', hostname: 'adcs-server', caName: 'Jackson-DC-CA' },
    }));
    const provider = await service.createProvider(tenantId, {
      name: 'Jackson-DC-CA', type: 'plugin', deploymentMode: 'external', runtimePlatform: 'windows', availabilityMode: 'single',
      configuration: { providerKind: 'microsoft_adcs', agentId },
    }, 'system');
    await service.getRepository().saveAuthority({
      id: 'ca-authority-active-observation', tenantId, name: 'Jackson-DC-CA', role: 'root', topologyMode: 'external_managed',
      providerId: provider.id, securityDomain: 'production', status: 'active', subjectCommonName: 'Jackson-DC-CA',
      configuration: { providerKind: 'microsoft_adcs', agentId }, createdAt: '2026-08-26T00:00:00.000Z', updatedAt: '2026-08-26T00:00:00.000Z',
    });
    const input = {
      agentId,
      caName: 'Jackson-DC-CA',
      observedAt: '2026-08-26T15:00:00.000Z',
      sequence: 1,
      records: [{
        objectType: 'request' as const,
        externalObjectId: 'request:42',
        normalizedStatus: 'issued' as const,
        sourceStatus: '20',
        sourceRevision: 'rev-42',
        subjectCommonName: 'example.com',
        submittedAt: '2026-08-26T14:59:00.000Z',
        rawSummary: { requestId: 42 },
      }],
    };
    const first = await service.ingestAdcsObservations(tenantId, input);
    const second = await service.ingestAdcsObservations(tenantId, input);
    assert.equal(first.inserted, 1);
    assert.equal(second.updated, 0);
    assert.equal(second.duplicates, 1);
    const stale = await service.ingestAdcsObservations(tenantId, {
      ...input,
      observedAt: '2026-08-26T14:00:00.000Z',
      records: [{ ...input.records[0], normalizedStatus: 'pending', sourceRevision: 'older-revision' }],
    });
    assert.equal(stale.updated, 0);
    assert.equal(stale.duplicates, 1);
    const page = await service.listCaOperationsRecords(tenantId, { caId: 'ca-authority-active-observation', view: 'request', limit: 50 });
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0]?.externalObject?.externalObjectId, 'request:42');
    assert.equal(page.items[0]?.normalizedStatus, 'issued');
  } finally {
    await db.close();
  }
});

test('Windows AD CS Agent 状态纠正会清理同一请求的旧吊销投影', async () => {
  const { db, service } = await createFixture();
  const tenantId = 'tenant-adcs-reconcile-derived-observation';
  const agentId = 'agt-adcs-reconcile-derived-observation';
  try {
    service.setAdcsAgentResolver(async () => ({
      id: agentId,
      agentKey: 'adcs-reconcile-key',
      role: 'adcs_agent',
      status: 'ONLINE',
      descriptor: { osType: 'WINDOWS_ADCS', hostname: 'adcs-server', caName: 'Jackson-DC-CA' },
    }));
    const provider = await service.createProvider(tenantId, {
      name: 'Jackson-DC-CA', type: 'plugin', deploymentMode: 'external', runtimePlatform: 'windows', availabilityMode: 'single',
      configuration: { providerKind: 'microsoft_adcs', agentId },
    }, 'system');
    const caId = 'ca-authority-reconcile-derived-observation';
    await service.getRepository().saveAuthority({
      id: caId, tenantId, name: 'Jackson-DC-CA', role: 'root', topologyMode: 'external_managed',
      providerId: provider.id, securityDomain: 'production', status: 'active', subjectCommonName: 'Jackson-DC-CA',
      configuration: { providerKind: 'microsoft_adcs', agentId }, createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z',
    });
    await new CaOperationsRepository(db).upsertExternalObservation({
      id: 'stale-revocation',
      tenantId, providerId: provider.id, caId, objectType: 'revocation', externalObjectId: 'request:42',
      normalizedStatus: 'revoked', sourceStatus: '20', sourceRevision: 'bad-revision',
      subjectCommonName: 'example.com', rawSummary: { requestId: 42 },
      observedAt: '2026-08-26T15:00:00.000Z', firstObservedAt: '2026-08-26T15:00:00.000Z',
      createdAt: '2026-08-26T15:00:00.000Z', updatedAt: '2026-08-26T15:00:00.000Z',
    });

    const result = await service.ingestAdcsObservations(tenantId, {
      agentId, caName: 'Jackson-DC-CA', observedAt: '2026-08-27T15:00:00.000Z',
      records: [{
        objectType: 'request', externalObjectId: 'request:42', normalizedStatus: 'issued', sourceStatus: '20',
        subjectCommonName: 'example.com', rawSummary: { requestId: 42 },
      }],
    });
    assert.equal(result.inserted, 1);
    const counts = await db.query<{ object_type: string; count: number }>(
      `select object_type, count(*)::int as count
         from pg_ca_external_observations
        where tenant_id = $1 and provider_id = $2 and ca_id = $3 and external_object_id = $4
        group by object_type`,
      [tenantId, provider.id, caId, 'request:42'],
    );
    assert.deepEqual(counts.rows.map((row) => [row.object_type, Number(row.count)]), [['request', 1]]);
  } finally {
    await db.close();
  }
});

test('Windows AD CS Agent 上报时自动选择重复 Authority 的主记录', async () => {
  const { db, service } = await createFixture();
  const tenantId = 'tenant-adcs-duplicate-authority-ingest';
  const agentId = 'agt-adcs-duplicate-authority-ingest';
  try {
    service.setAdcsAgentResolver(async () => ({
      id: agentId,
      agentKey: 'adcs-duplicate-key',
      role: 'adcs_agent',
      status: 'ONLINE',
      descriptor: { osType: 'WINDOWS_ADCS', hostname: 'adcs-server', caName: 'Jackson-DC-CA' },
    }));
    const provider = await service.createProvider(tenantId, {
      name: 'Jackson-DC-CA', type: 'plugin', deploymentMode: 'external', runtimePlatform: 'windows', availabilityMode: 'single',
      configuration: { providerKind: 'microsoft_adcs', agentId },
    }, 'system');
    const oldAuthority = {
      id: 'ca-authority-duplicate-old', tenantId, name: 'jackson-mgt', role: 'root' as const, topologyMode: 'external_managed' as const,
      providerId: provider.id, securityDomain: 'production' as const, status: 'active' as const, subjectCommonName: 'Jackson-DC-CA',
      configuration: { providerKind: 'microsoft_adcs', agentId, caConfig: 'ADCS-SERVER\\Jackson-DC-CA' }, createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z',
    };
    const newAuthority = {
      ...oldAuthority,
      id: 'ca-authority-duplicate-new',
      name: 'Jackson-DC-CA',
      createdAt: '2026-08-26T00:00:00.000Z',
      updatedAt: '2026-08-26T00:00:00.000Z',
    };
    await service.getRepository().saveAuthority(oldAuthority);
    await service.getRepository().saveAuthority(newAuthority);

    const result = await service.ingestAdcsObservations(tenantId, {
      agentId,
      caName: 'Jackson-DC-CA',
      observedAt: '2026-08-26T15:00:00.000Z',
      records: [{
        objectType: 'request', externalObjectId: 'request:100', normalizedStatus: 'issued', sourceStatus: '20',
        subjectCommonName: 'example.com',
      }],
    });
    assert.equal(result.inserted, 1);
    const oldObservation = await db.query<{ count: number }>(
      'select count(*)::int as count from pg_ca_external_observations where tenant_id = $1 and ca_id = $2',
      [tenantId, oldAuthority.id],
    );
    const newObservation = await db.query<{ count: number }>(
      'select count(*)::int as count from pg_ca_external_observations where tenant_id = $1 and ca_id = $2',
      [tenantId, newAuthority.id],
    );
    assert.equal(Number(oldObservation.rows[0]?.count ?? 0), 0);
    assert.equal(Number(newObservation.rows[0]?.count ?? 0), 1);
    const tree = await service.listCaOperationsTree(tenantId, async () => true);
    const visible = [...tree.trustDomains.flatMap((domain) => domain.authorities), ...tree.unassignedAuthorities];
    assert.deepEqual(visible.map((item) => item.id), [newAuthority.id]);
  } finally {
    await db.close();
  }
});

test('生产 HTTP 入口接受带 Agent Token 的 AD CS 主动观测并忽略伪造租户', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');
  const app = createApp({ db, corePersistence: { mode: 'memory' } });
  const agents = app.getResource('agentsService') as AgentsApplicationService;
  const service = app.getResource('internalCaService') as InternalCaApplicationService;
  const tenantId = 'tenant-adcs-observation-http';
  try {
    const token = await agents.createEnrollmentToken(tenantId, {
      allowedRoles: ['adcs_agent'], allowedZones: ['default'], maxUses: 1, ttlSeconds: 60, createdBy: 'test',
    }, 'req_adcs_observation_http_token');
    const registration = await app.inject({
      method: 'POST', path: '/api/v1/agents/register',
      headers: { 'x-agent-token': token.token, 'x-tenant-id': 'tenant-attacker' },
      body: {
        agentKey: 'adcs-http-observation-agent', hostname: 'ADCS-SERVER', caName: 'Jackson-DC-CA',
        caConfig: 'ADCS-SERVER\\Jackson-DC-CA', version: '0.1.1', osType: 'WINDOWS_ADCS', role: 'adcs_agent',
        enrollmentToken: token.token,
      },
    });
    assert.equal(registration.statusCode, 201, JSON.stringify(registration.body));
    const agentId = String((registration.body as { id: string }).id);
    const provider = await service.createProvider(tenantId, {
      name: 'Jackson-DC-CA', type: 'plugin', deploymentMode: 'external', runtimePlatform: 'windows', availabilityMode: 'single',
      configuration: { providerKind: 'microsoft_adcs', agentId, caConfig: 'ADCS-SERVER\\Jackson-DC-CA' },
    }, 'system');
    await service.getRepository().saveAuthority({
      id: 'ca-authority-observation-http', tenantId, name: 'Jackson-DC-CA', role: 'root', topologyMode: 'external_managed',
      providerId: provider.id, securityDomain: 'production', status: 'active', subjectCommonName: 'Jackson-DC-CA',
      configuration: { providerKind: 'microsoft_adcs', agentId, caConfig: 'ADCS-SERVER\\Jackson-DC-CA' },
      createdAt: '2026-08-26T00:00:00.000Z', updatedAt: '2026-08-26T00:00:00.000Z',
    });
    const response = await app.inject({
      method: 'POST', path: '/api/v1/agents/ca-observations',
      headers: { 'x-agent-token': token.token, 'x-tenant-id': 'tenant-attacker' },
      body: {
        agentId, caName: 'Jackson-DC-CA', caConfig: 'ADCS-SERVER\\Jackson-DC-CA', sequence: 1,
        records: [{ objectType: 'request', externalObjectId: 'request:http-1', normalizedStatus: 'pending' }],
      },
    });
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    assert.equal((response.body as { inserted: number; caId: string }).inserted, 1);
    assert.equal((response.body as { caId: string }).caId, 'ca-authority-observation-http');
  } finally {
    await db.close();
  }
});

test('固定 Provider 动作和兼容策略快照在申请创建时冻结', async () => {
  const { db, service } = await createFixture();
  try {
    const tenantId = 'tenant-policy-snapshot';
    const provider = await service.createProvider(tenantId, {
      name: '固定动作外部 CA', type: 'plugin', deploymentMode: 'external', runtimePlatform: 'external', availabilityMode: 'single',
    }, 'user-admin');
    const binding = await service.createProviderActionBinding(tenantId, {
      providerId: provider.id, pluginVersionId: 'plugin-version-1', executionLocation: 'agent',
      issueAction: { actionId: 'ca.issue', actionVersion: '1.0' }, status: 'revalidation_required',
    }, 'user-admin');
    const preview = service.previewAuthority({
      topologyMode: 'external_managed', deploymentMode: 'external', runtimePlatform: 'external', availabilityMode: 'single', keyBackend: 'secret',
    });
    const [authority] = await service.createAuthority(tenantId, {
      providerId: provider.id, name: '固定动作 CA', securityDomain: 'production', commonName: '固定动作 CA', topologyMode: 'external_managed',
      deploymentMode: 'external', runtimePlatform: 'external', availabilityMode: 'single', keyBackend: 'secret', confirmationToken: preview.confirmationToken, actorId: 'user-admin',
    });
    const profile = await service.createProfile(tenantId, {
      name: '固定动作 Profile', securityDomain: 'production', rules: { maximumValidityDays: 365 }, actorId: 'user-admin',
    });
    const request = await service.createCertificateRequest(tenantId, {
      applicationAssetId: 'app-1', caId: authority!.id, profileVersionId: profile.version.id, commonName: 'app.example.com', sans: ['app.example.com'],
      custodyMode: 'managed_secret', requestedValidityDays: 365, deferIssuance: true, actorId: 'user-admin',
    });
    assert.equal(request.status, 'approved');
    assert.equal(request.providerActionBindingId, binding.id);
    assert.equal(request.effectivePolicySnapshot?.effectiveValidityDays, 365);
    assert.ok(request.effectivePolicySnapshot?.warnings.some((item) => item.includes('复验')));

    const [{ policy }] = await service.listCertificatePolicies(tenantId);
    const strict = await service.createCertificatePolicyVersion(tenantId, policy!.id, {
      strictEnforcement: true, issueApprovalRequired: true,
    }, 'user-admin');
    const later = await service.createCertificateRequest(tenantId, {
      applicationAssetId: 'app-2', caId: authority!.id, profileVersionId: profile.version.id, commonName: 'later.example.com', sans: ['later.example.com'],
      custodyMode: 'managed_secret', deferIssuance: true, actorId: 'user-admin',
    });
    assert.equal(later.status, 'pending_approval');
    assert.equal(later.certificatePolicyVersionId, strict.id);
    assert.equal(request.effectivePolicySnapshot?.requiresApproval, false);
  } finally {
    await db.close();
  }
});

test('内置 CA 吊销会写入账本并发布可验签 CRL', async () => {
  const { db, service } = await createFixture();
  try {
    const tenantId = 'tenant-builtin-crl';
    const provider = await service.createProvider(tenantId, {
      name: '可发布 CRL 的内置 CA', type: 'gcac_builtin', deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single',
    }, 'user-admin');
    const preview = service.previewAuthority({
      topologyMode: 'root_only', deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single', keyBackend: 'secret',
    });
    const [authority] = await service.createAuthority(tenantId, {
      providerId: provider.id, name: 'CRL Root', securityDomain: 'production', topologyMode: 'root_only',
      deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single', keyBackend: 'secret',
      crlDistributionPoint: 'http://127.0.0.1/crl.pem', confirmationToken: preview.confirmationToken, actorId: 'user-admin',
    });
    const profile = await service.createProfile(tenantId, { name: 'CRL Web', securityDomain: 'production', actorId: 'user-admin' });
    const request = await service.createCertificateRequest(tenantId, {
      applicationAssetId: 'crl-app', caId: authority!.id, profileVersionId: profile.version.id,
      commonName: 'crl.example.com', sans: ['crl.example.com'], custodyMode: 'managed_secret', actorId: 'user-admin',
    });
    assert.equal(request.status, 'issued');
    assert.ok(request.certificateVersionId);
    const revocation = await service.requestRevocation(tenantId, request.certificateVersionId!, 'keyCompromise', 'user-admin');
    assert.equal(revocation.status, 'revoked');
    const publications = await service.listCrlPublications(tenantId, authority!.id);
    assert.equal(publications.length, 1);
    assert.equal(publications[0]?.publicationStatus, 'published');
    assert.equal(publications[0]?.verification.signatureVerified, true);
    assert.deepEqual(publications[0]?.revokedSerialNumbers, ['01']);
    assert.ok(Number.isFinite(Date.parse(publications[0]!.thisUpdate)));
    assert.ok(Number.isFinite(Date.parse(publications[0]!.nextUpdate)));
    assert.ok(Date.parse(publications[0]!.nextUpdate) > Date.parse(publications[0]!.thisUpdate));
    const publicCrl = await service.getPublicCrl(tenantId, authority!.id);
    assert.equal(publicCrl.contentType, 'application/pkix-crl');
    assert.equal(publicCrl.crlNumber, 1);
    assert.match(publicCrl.etag, /^"[a-f0-9]{64}"$/);
    assert.ok(publicCrl.body.length > 0);

    // 即使异常数据把 publication_status 错误标成 published，公开 CDP 也不能返回未验签制品。
    await service.getRepository().saveCrlPublication({
      id: 'crlpub-unverified', tenantId, caId: authority!.id, crlNumber: 99,
      thisUpdate: new Date().toISOString(), nextUpdate: new Date(Date.now() + 86400000).toISOString(),
      distributionPoint: authority!.crlDistributionPoint, crlPem: 'invalid', crlDerBase64: Buffer.from('invalid').toString('base64'),
      crlFingerprintSha256: 'f'.repeat(64), revokedSerialNumbers: [], publicationStatus: 'published',
      verification: { signatureVerified: false, serialsVerified: false, source: 'external' }, createdAt: new Date().toISOString(),
    });
    const filteredPublicCrl = await service.getPublicCrl(tenantId, authority!.id);
    assert.equal(filteredPublicCrl.crlNumber, 1);
  } finally {
    await db.close();
  }
});
