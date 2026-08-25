import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { createCertificateServices } from '../certificates/index.js';
import { createSecurityServices } from '../security/security.controller.js';
import { createApp } from '../../app.module.js';
import { InternalCaApplicationService } from './application/internal-ca.application-service.js';
import { getInternalCaRouteContracts } from './controller/internal-ca.controller.js';

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
    const publicCrl = await service.getPublicCrl(tenantId, authority!.id);
    assert.equal(publicCrl.contentType, 'application/pkix-crl');
    assert.equal(publicCrl.crlNumber, 1);
    assert.match(publicCrl.etag, /^"[a-f0-9]{64}"$/);
    assert.ok(publicCrl.body.length > 0);
  } finally {
    await db.close();
  }
});
