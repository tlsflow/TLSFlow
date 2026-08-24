import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { createCertificateServices } from '../certificates/index.js';
import { createSecurityServices } from '../security/security.controller.js';
import { buildReuseRisks, InternalCaApplicationService } from './application/internal-ca.application-service.js';
import { agentInstallPublicBaseUrl, getInternalCaRouteContracts, pathId, renderAdcsAgentInstallScript } from './controller/internal-ca.controller.js';
import { CaProviderRegistry } from './providers/ca-provider.js';

async function createFixture(providers?: CaProviderRegistry) {
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
    providers,
  });
  return { db, security, certificates, service };
}

test('AD CS Agent 安装地址优先使用统一公开地址配置', () => {
  const previous = process.env.GCAC_AGENT_INSTALL_PUBLIC_BASE_URL;
  process.env.GCAC_AGENT_INSTALL_PUBLIC_BASE_URL = 'http://10.255.0.85:5172/';
  try {
    const baseUrl = agentInstallPublicBaseUrl({
      method: 'POST', path: '/api/v1/adcs-agents/install-sessions', query: {}, body: {}, context: { requestId: 'req_url', traceId: 'trace_url' },
      headers: { host: '127.0.0.1:3003' },
    });
    assert.equal(baseUrl, 'http://10.255.0.85:5172');
  } finally {
    if (previous === undefined) delete process.env.GCAC_AGENT_INSTALL_PUBLIC_BASE_URL;
    else process.env.GCAC_AGENT_INSTALL_PUBLIC_BASE_URL = previous;
  }
});

test('标准 REST 删除路由可以读取最后一个路径段作为资源 ID', () => {
  assert.equal(pathId({
    method: 'DELETE', path: '/api/v1/ca-providers/caprov_delete_me', query: {}, context: { requestId: 'req_path', traceId: 'trace_path' }, headers: {},
  }), 'caprov_delete_me');
});

test('AD CS Agent 安装配置使用任务推送通道且不再写入轮询间隔', () => {
  const script = renderAdcsAgentInstallScript({
    controlPlaneUrl: 'https://gcac.example.test', tenantId: 'tenant-1', providerId: 'provider-1', token: 'token-1',
  });
  assert.doesNotMatch(script, /pollSeconds/);
  assert.equal(getInternalCaRouteContracts().some((route) => route.operationId === 'streamCaNodeTasks'), true);
});

test('创建 CA 信任域未提供 code 时由后端自动生成唯一代码', async () => {
  const { service } = await createFixture();
  const tenantId = 'tenant-auto-trust-domain-code';
  const actorId = 'user-admin';
  const first = await service.createTrustDomain(tenantId, {
    name: '自动代码信任域一',
    purpose: 'production_tls',
  }, actorId);
  const second = await service.createTrustDomain(tenantId, {
    name: '自动代码信任域二',
    purpose: 'development_tls',
  }, actorId);

  assert.match(first.code, /^auto_domain_[a-z0-9]{24}$/);
  assert.match(second.code, /^auto_domain_[a-z0-9]{24}$/);
  assert.notEqual(first.code, second.code);
});

test('内置 CA 完成根与中间拓扑、Profile、签发、续期、吊销和信任分发', async () => {
  const { db, service, certificates, security } = await createFixture();
  const tenantId = 'tenant-internal-ca';
  const actorId = 'user-admin';
  const provider = await service.createProvider(tenantId, {
    name: 'GCAC 内置 CA',
    type: 'gcac_builtin',
    deploymentMode: 'builtin',
    runtimePlatform: 'embedded',
    availabilityMode: 'single',
  }, actorId);
  const preview = service.previewAuthority({
    topologyMode: 'root_with_intermediate',
    deploymentMode: 'builtin',
    runtimePlatform: 'embedded',
    availabilityMode: 'single',
    keyBackend: 'secret',
  });
  assert.equal(preview.blockers.length, 0);
  const authorities = await service.createAuthority(tenantId, {
    providerId: provider.id,
    name: '生产应用 CA',
    commonName: 'GCAC Production Root CA',
    securityDomain: 'production',
    topologyMode: 'root_with_intermediate',
    deploymentMode: 'builtin',
    runtimePlatform: 'embedded',
    availabilityMode: 'single',
    keyBackend: 'secret',
    confirmationToken: preview.confirmationToken,
    actorId,
  });
  assert.equal(authorities.length, 2);
  assert.equal(authorities.some((item) => 'privateKeySecretRef' in item), false);
  const root = authorities.find((item) => item.role === 'root');
  const intermediate = authorities.find((item) => item.role === 'intermediate');
  assert.ok(root);
  assert.ok(intermediate?.certificatePem);
  const additionalIntermediate = (await service.createAuthority(tenantId, {
    providerId: provider.id,
    trustDomainId: root.trustDomainId,
    parentCaId: root.id,
    name: '生产应用第二签发 CA',
    commonName: 'GCAC Production Issuing CA 2',
    securityDomain: 'production',
    topologyMode: 'root_with_intermediate',
    deploymentMode: 'builtin',
    runtimePlatform: 'embedded',
    availabilityMode: 'single',
    keyBackend: 'secret',
    confirmationToken: preview.confirmationToken,
    actorId,
  }))[0];
  assert.equal(additionalIntermediate.parentCaId, root.id);
  assert.equal(additionalIntermediate.trustDomainId, root.trustDomainId);

  const { version } = await service.createProfile(tenantId, {
    name: '生产 TLS',
    securityDomain: 'production',
    actorId,
    rules: {
      allowedDnsSuffixes: ['.example.com'],
      maximumValidityDays: 90,
      renewalWindowDays: 30,
      rotateKeyOnRenewal: true,
      requireApproval: false,
    },
  });
  const requestInput = {
    applicationAssetId: 'app-oa',
    caId: intermediate.id,
    profileVersionId: version.id,
    commonName: 'oa.example.com',
    sans: ['oa.example.com'],
    requestedValidityDays: 60,
    custodyMode: 'managed_secret' as const,
    idempotencyKey: 'issue-app-oa-20260722',
    actorId,
  };
  const issued = await service.createCertificateRequest(tenantId, requestInput);
  const duplicate = await service.createCertificateRequest(tenantId, requestInput);
  assert.equal(issued.status, 'issued');
  assert.equal(duplicate.id, issued.id);
  assert.ok(issued.certificateVersionId);

  const detail = await certificates.certificates.getVersionDetail(issued.certificateVersionId!);
  assert.equal(detail.publicKeyFingerprintSha256, issued.publicKeyFingerprintSha256);
  const stored = (await db.query<{ key_custody_mode: string }>(
    'select key_custody_mode from pg_certificate_versions where id = $1',
    [issued.certificateVersionId],
  )).rows[0];
  assert.equal(detail.commonName, 'oa.example.com');
  assert.equal(detail.chainStatus, 'valid');
  assert.equal(stored.key_custody_mode, 'managed_secret');
  const issuanceRecords = await service.listIssuanceRecords(tenantId, intermediate.id);
  assert.equal(issuanceRecords.length, 1);
  assert.equal(issuanceRecords[0].certificateRequestId, issued.id);
  assert.equal(issuanceRecords[0].certificateVersionId, issued.certificateVersionId);
  assert.equal(issuanceRecords[0].serialNumber, detail.serialNumber.toUpperCase());
  assert.equal(issuanceRecords[0].certificateFingerprintSha256, detail.fingerprintSha256);
  assert.equal(issuanceRecords[0].publicKeyFingerprintSha256, detail.publicKeyFingerprintSha256);

  for (const fixture of [
    { suffix: 'a', environment: 'production', securityDomain: 'production' },
    { suffix: 'b', environment: 'development', securityDomain: 'development' },
  ]) {
    await db.query(`insert into pg_hosts (id, tenant_id, hostname, os_type, discovery_source, compatibility_level, management_mode, status)
      values ($1,$2,$3,'LINUX','MANUAL','L1','AGENT','ACTIVE')`, [`host-${fixture.suffix}`, tenantId, `host-${fixture.suffix}.example.com`]);
    await db.query(`insert into pg_service_instances (id, tenant_id, host_id, provider_type, display_name, discovery_source, status)
      values ($1,$2,$3,'NGINX',$4,'MANUAL','ACTIVE')`, [`svc-${fixture.suffix}`, tenantId, `host-${fixture.suffix}`, `NGINX ${fixture.suffix}`]);
    await db.query(`insert into pg_service_assets (id, tenant_id, address, address_type, port, protocol, display_name, service_instance_id, host_id, environment, discovery_source, status, metadata)
      values ($1,$2,$3,'DNS',443,'HTTPS',$4,$5,$6,$7,'MANUAL','ACTIVE',$8::jsonb)`, [
        `asset-${fixture.suffix}`, tenantId, `app-${fixture.suffix}.example.com`, `应用 ${fixture.suffix}`, `svc-${fixture.suffix}`, `host-${fixture.suffix}`,
        fixture.environment, JSON.stringify({ securityDomain: fixture.securityDomain }),
      ]);
    await db.query(`insert into pg_certificate_bindings (id, tenant_id, service_instance_id, host_id, service_asset_id, binding_key, binding_type, certificate_version_id, verify_method, status)
      values ($1,$2,$3,$4,$5,$6,'FILE_PATH',$7,'LOCAL_FILE','ACTIVE')`, [
        `binding-${fixture.suffix}`, tenantId, `svc-${fixture.suffix}`, `host-${fixture.suffix}`, `asset-${fixture.suffix}`, `/etc/nginx/${fixture.suffix}.pem`, issued.certificateVersionId,
      ]);
  }
  const reuseRisks = await service.analyzeCertificateReuseRisks(tenantId);
  assert.equal(reuseRisks.length, 2);
  assert.ok(reuseRisks.every((risk) => risk.crossSecurityDomain));
  assert.ok(reuseRisks.some((risk) => risk.riskType === 'certificate_fingerprint_reuse'));
  assert.ok(reuseRisks.some((risk) => risk.riskType === 'public_key_reuse'));
  const remediation = await service.previewCertificateReuseRemediation(tenantId, reuseRisks[0].id);
  assert.equal((remediation.requests as unknown[]).length, 2);

  const renewals = await service.scheduleDueRenewals(tenantId, actorId, new Date(Date.now() + 40 * 86_400_000));
  assert.equal(renewals.length, 1);
  assert.equal(renewals[0].status, 'deploying');
  assert.ok(renewals[0].certificateRequestId);

  const revocation = await service.requestRevocation(tenantId, issued.certificateVersionId!, 'keyCompromise', actorId);
  assert.ok(revocation.approvalId);
  await security.approvals.decide({ approvalId: revocation.approvalId!, decision: 'approved', approverId: 'security-admin' });
  const revoked = await service.approveRevocation(tenantId, revocation.id, revocation.approvalId!, 'security-admin');
  assert.equal(revoked.status, 'revoked');
  assert.ok(revoked.warnings?.some((warning) => warning.includes('CRL')));
  assert.equal((await service.approveRevocation(tenantId, revocation.id, revocation.approvalId!, 'security-admin')).status, 'revoked');
  const revokedLedger = (await service.listIssuanceRecords(tenantId, intermediate.id))
    .find((record) => record.certificateVersionId === issued.certificateVersionId)!;
  assert.equal(revokedLedger.status, 'revoked');
  assert.equal(revokedLedger.revocationReason, 'keyCompromise');
  assert.ok(revokedLedger.revokedAt);
  assert.equal(revokedLedger.invalidityDate, revokedLedger.revokedAt);
  await assert.rejects(service.getRepository().saveIssuanceRecord({ ...revokedLedger, status: 'issued' }), /不可恢复/);

  const distribution = await service.createTrustDistribution(tenantId, intermediate.id, { agentIds: ['agent-a'], platform: 'linux' }, actorId);
  assert.ok(distribution.approvalId);
  await security.approvals.decide({ approvalId: distribution.approvalId!, decision: 'approved', approverId: 'security-admin' });
  const deploying = await service.approveTrustDistribution(tenantId, distribution.id, distribution.approvalId!);
  assert.equal(deploying.status, 'deploying');
  const verified = await service.completeTrustDistribution(tenantId, distribution.id, true, { installed: 1, verified: 1 });
  assert.equal(verified.status, 'verified');
});

test('内置 CA 根 CA 单层拓扑保持兼容并明确风险确认', async () => {
  const { service } = await createFixture();
  const tenantId = 'tenant-root-only-baseline';
  const actorId = 'user-admin';
  const provider = await service.createProvider(tenantId, {
    name: 'GCAC 内置根 CA 基线',
    type: 'gcac_builtin',
    deploymentMode: 'builtin',
    runtimePlatform: 'embedded',
    availabilityMode: 'single',
  }, actorId);
  const input = {
    providerId: provider.id,
    name: '兼容根 CA',
    commonName: 'GCAC Compatibility Root CA',
    securityDomain: 'development',
    topologyMode: 'root_only' as const,
    deploymentMode: 'builtin' as const,
    runtimePlatform: 'embedded' as const,
    availabilityMode: 'single' as const,
    keyBackend: 'secret' as const,
  };
  const preview = service.previewAuthority(input);
  assert.equal(preview.blockers.length, 0);
  assert.equal(preview.requiresApproval, true);
  assert.ok(preview.warnings.some((warning) => warning.includes('根私钥')));

  const authorities = await service.createAuthority(tenantId, {
    ...input,
    confirmationToken: preview.confirmationToken,
    actorId,
  });
  assert.equal(authorities.length, 1);
  assert.equal(authorities[0].role, 'root');
  assert.equal(authorities[0].topologyMode, 'root_only');
  assert.equal(authorities[0].pathLengthConstraint, 0);
});

test('Provider 能力记录保留声明来源并在验证过期后回退', async () => {
  const { service } = await createFixture();
  const tenantId = 'tenant-capability-records';
  const provider = await service.createProvider(tenantId, {
    name: '能力记录 Provider',
    type: 'gcac_builtin',
    deploymentMode: 'builtin',
    runtimePlatform: 'embedded',
    availabilityMode: 'single',
  }, 'user-admin');
  const created = (await service.listProviders(tenantId)).find((item) => item.id === provider.id);
  assert.ok(created?.capabilityRecords);
  assert.equal(created.capabilityRecords?.length, Object.keys(created.capabilities).length);
  const signRecord = created.capabilityRecords?.find((item) => item.capabilityKey === 'signCsr');
  assert.equal(signRecord?.state, 'declared');
  assert.equal(signRecord?.source, 'adapter_declaration');

  await service.getRepository().saveCapabilityRecord({
    ...signRecord!,
    state: 'verified',
    source: 'integration_test',
    expiresAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
  });
  const effective = await service.listCapabilityRecords(tenantId, 'provider', provider.id, new Date('2026-07-23T00:00:00.000Z'));
  const expired = effective.find((item) => item.capabilityKey === 'signCsr');
  assert.equal(expired?.state, 'declared');
  assert.equal(expired?.source, 'expired_verification');
  assert.equal(expired?.failureReason, 'capability_verification_expired');
});

test('CA 签发账本并发分配唯一序列号且历史回填不伪造签发时间', async () => {
  const { service, db } = await createFixture();
  const tenantId = 'tenant-issuance-ledger';
  const actorId = 'user-admin';
  const provider = await service.createProvider(tenantId, {
    name: '签发账本 Provider',
    type: 'gcac_builtin',
    deploymentMode: 'builtin',
    runtimePlatform: 'embedded',
    availabilityMode: 'single',
  }, actorId);
  const preview = service.previewAuthority({
    topologyMode: 'root_only', deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single', keyBackend: 'secret',
  });
  const [authority] = await service.createAuthority(tenantId, {
    providerId: provider.id,
    name: '账本根 CA',
    commonName: 'GCAC Ledger Root CA',
    securityDomain: 'development',
    topologyMode: 'root_only',
    deploymentMode: 'builtin',
    runtimePlatform: 'embedded',
    availabilityMode: 'single',
    keyBackend: 'secret',
    confirmationToken: preview.confirmationToken,
    actorId,
  });

  const records = await Promise.all(Array.from({ length: 24 }, (_, index) => service.reserveIssuanceRecord(tenantId, {
    caId: authority.id,
    certificateRequestId: `request-${index}`,
    subjectCommonName: `service-${index}.example.com`,
  })));
  assert.equal(new Set(records.map((record) => record.serialNumber)).size, records.length);
  const duplicate = await service.reserveIssuanceRecord(tenantId, {
    caId: authority.id,
    certificateRequestId: 'request-0',
  });
  assert.equal(duplicate.id, records[0].id);

  const historical = await service.backfillIssuanceRecord(tenantId, {
    caId: authority.id,
    serialNumber: 'ABCDEF',
    certificateVersionId: 'legacy-version-no-longer-present',
    subjectCommonName: 'legacy.example.com',
    observedAt: '2026-07-23T00:00:00.000Z',
  });
  assert.equal(historical.recordOrigin, 'historical_backfill');
  assert.equal(historical.issuedAt, undefined);
  await db.query('delete from pg_certificate_versions where id = $1', ['legacy-version-no-longer-present']);
  assert.equal((await service.listIssuanceRecords(tenantId, authority.id)).some((record) => record.id === historical.id), true);
});

test('内置 CA 签名失败时账本不会留下半完成 issued 记录', async () => {
  const capabilities = {
    discoverHierarchy: true, createRoot: true, createIntermediate: true, signCsr: true, queryIssuance: true,
    revokeCertificate: true, publishCrl: false, ocsp: false, listProfiles: true, deviceLocalCsr: false,
    hardwareBackedKey: false, highAvailability: false,
  };
  const providers = new CaProviderRegistry().register('gcac_builtin', {
    getCapabilities: () => capabilities,
    validateConnection: async () => ({ reachable: true, capabilities }),
    signCsr: async () => { throw new Error('injected_sign_failure'); },
  });
  const { service } = await createFixture(providers);
  const tenantId = 'tenant-ledger-failure';
  const actorId = 'user-admin';
  const provider = await service.createProvider(tenantId, {
    name: '故障注入 Provider', type: 'gcac_builtin', deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single',
  }, actorId);
  const preview = service.previewAuthority({ topologyMode: 'root_only', deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single', keyBackend: 'secret' });
  const [authority] = await service.createAuthority(tenantId, {
    providerId: provider.id, name: '故障注入根 CA', commonName: 'GCAC Failure Root CA', securityDomain: 'development',
    topologyMode: 'root_only', deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single', keyBackend: 'secret',
    confirmationToken: preview.confirmationToken, actorId,
  });
  const { version } = await service.createProfile(tenantId, {
    name: '故障注入 Profile', securityDomain: 'development', actorId,
    rules: { allowedDnsSuffixes: ['.example.com'], requireApproval: false },
  });
  await assert.rejects(service.createCertificateRequest(tenantId, {
    applicationAssetId: 'app-failure', caId: authority.id, profileVersionId: version.id,
    commonName: 'failure.example.com', sans: ['failure.example.com'], custodyMode: 'managed_secret',
    idempotencyKey: 'failure-request', actorId,
  }), /injected_sign_failure/);
  const [request] = await service.listRequests(tenantId);
  const [ledger] = await service.listIssuanceRecords(tenantId, authority.id);
  assert.equal(request.status, 'issue_failed');
  assert.equal(ledger.status, 'failed');
  assert.equal(ledger.certificateVersionId, undefined);
});

test('AD CS Agent 一键安装会话自动创建 Provider 且注册令牌只能使用一次', async () => {
  const { service } = await createFixture();
  const tenantId = 'tenant-adcs-agent-install';
  const install = await service.createAdcsAgentInstallSession(
    tenantId,
    { name: '域证书服务 Agent' },
    'user-admin',
    'https://gcac.example.test',
  );
  assert.match(String(install.installCommand), /^irm 'https:\/\/gcac\.example\.test\/api\/v1\/adcs-agents\/install\.ps1\?token=/);
  const token = decodeURIComponent(String(install.scriptUrl).split('token=')[1]);
  const context = await service.getAdcsAgentInstallContext(token);
  assert.equal(context.tenantId, tenantId);
  const provider = (await service.listProviders(tenantId)).find((item) => item.id === context.providerId);
  assert.equal(provider?.type, 'microsoft_adcs');
  const identity = generateKeyPairSync('ed25519');
  const publicKeyPem = identity.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const identityFingerprint = createHash('sha256').update(identity.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
  const node = await service.registerNode({
    token,
    name: 'CA01',
    platform: 'windows',
    role: 'member',
    identityFingerprint,
    authenticationPublicKeyPem: publicKeyPem,
    keyBackend: 'file',
    exportability: 'exportable',
    capabilities: provider!.capabilities,
    version: '0.1.0',
    discovery: {
      caConfig: 'CA01\\Contoso Issuing CA',
      caName: 'Contoso Issuing CA',
      computerName: 'CA01',
      status: 'ready',
      templates: ['WebServer', 'SubCA'],
    },
  });
  assert.equal(node.providerId, provider?.id);
  assert.equal(node.platform, 'windows');
  const registeredProvider = (await service.listProviders(tenantId)).find((item) => item.id === provider?.id);
  assert.deepEqual((registeredProvider?.configuration.discovered as Record<string, unknown>)?.templates, ['WebServer', 'SubCA']);
  assert.equal((registeredProvider?.configuration.discovered as Record<string, unknown>)?.caConfig, 'CA01\\Contoso Issuing CA');
  const body = { nodeId: node.id, healthStatus: 'online' };
  const timestamp = new Date().toISOString();
  const nonce = 'nonce_0123456789abcdef';
  const path = '/api/v1/ca-nodes/heartbeat';
  const bodyHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  const canonical = ['POST', path, tenantId, node.id, timestamp, nonce, bodyHash].join('\n');
  const signature = sign(null, Buffer.from(canonical), identity.privateKey).toString('base64');
  const verified = await service.verifyNodeRequest({ tenantId, nodeId: node.id, method: 'POST', path, timestamp, nonce, signature, body });
  assert.equal(verified.id, node.id);
  await service.heartbeatNode(tenantId, node.id, {
    healthStatus: 'online',
    discovery: { caConfig: 'CA01\\Contoso Updated CA', caName: 'Contoso Updated CA', templates: ['WebServer'] },
  });
  const refreshedProvider = (await service.listProviders(tenantId)).find((item) => item.id === provider?.id);
  assert.equal((refreshedProvider?.configuration.discovered as Record<string, unknown>)?.caConfig, 'CA01\\Contoso Updated CA');
  await assert.rejects(
    service.verifyNodeRequest({ tenantId, nodeId: node.id, method: 'POST', path, timestamp, nonce, signature, body }),
    /已重放/,
  );
  await assert.rejects(service.registerNode({
    token,
    name: 'CA01-duplicate',
    platform: 'windows',
    identityFingerprint: 'b'.repeat(64),
    keyBackend: 'cng',
    exportability: 'non_exportable',
    capabilities: provider!.capabilities,
  }), /无效、已使用或已过期/);
});

test('未绑定证书机构的 AD CS Provider 可删除，绑定后必须拒绝', async () => {
  const { service } = await createFixture();
  const tenantId = 'tenant-adcs-provider-delete';
  const input = { name: '待清理 AD CS', type: 'microsoft_adcs' as const, deploymentMode: 'external' as const, runtimePlatform: 'external' as const, availabilityMode: 'single' as const };
  const removable = await service.createProvider(tenantId, input, 'user-admin');
  assert.deepEqual(await service.deleteProvider(tenantId, removable.id, 'user-admin'), { id: removable.id, deleted: true });
  assert.equal((await service.listProviders(tenantId)).some((item) => item.id === removable.id), false);

  const bound = await service.createProvider(tenantId, { ...input, name: '已绑定 AD CS' }, 'user-admin');
  const now = new Date().toISOString();
  await service.getRepository().saveAuthority({
    id: 'ca_bound_adcs', tenantId, name: '已管理 AD CA', role: 'root', topologyMode: 'external_managed', providerId: bound.id,
    securityDomain: 'production', status: 'active', subjectCommonName: 'Contoso Issuing CA', createdAt: now, updatedAt: now,
  });
  await assert.rejects(service.deleteProvider(tenantId, bound.id, 'user-admin'), /已被证书机构使用/);
});

test('同一租户可管理多套根 CA 信任域并拒绝跨域签发', async () => {
  const { service } = await createFixture();
  const tenantId = 'tenant-multi-root-ca';
  const actorId = 'user-admin';
  const provider = await service.createProvider(tenantId, {
    name: '外部 CA 管理器',
    type: 'microsoft_adcs',
    deploymentMode: 'external',
    runtimePlatform: 'external',
    availabilityMode: 'single',
    configuration: { discovered: { caName: 'Contoso Root CA', caConfig: 'CA01\\Contoso Root CA' } },
  }, actorId);
  const productionDomain = await service.createTrustDomain(tenantId, {
    name: '生产信任域', code: 'production', purpose: 'production_tls', isDefault: true, isolationLevel: 'strict',
  }, actorId);
  const developmentDomain = await service.createTrustDomain(tenantId, {
    name: '开发信任域', code: 'development', purpose: 'development_tls', isDefault: true,
  }, actorId);
  const domains = await service.listTrustDomains(tenantId);
  assert.equal(domains.length, 2);
  assert.equal(domains.filter((domain) => domain.isDefault).length, 1);
  assert.equal(domains.find((domain) => domain.isDefault)?.id, developmentDomain.id);

  const preview = service.previewAuthority({
    topologyMode: 'external_managed', deploymentMode: 'external', runtimePlatform: 'external', availabilityMode: 'single', keyBackend: 'hsm',
  });
  const productionAuthority = (await service.createAuthority(tenantId, {
    providerId: provider.id, trustDomainId: productionDomain.id, name: '生产 CA', commonName: 'Production Root CA', securityDomain: 'shared',
    topologyMode: 'external_managed', deploymentMode: 'external', runtimePlatform: 'external', availabilityMode: 'single', keyBackend: 'hsm',
    confirmationToken: preview.confirmationToken, actorId,
  }))[0];
  const developmentAuthority = (await service.createAuthority(tenantId, {
    providerId: provider.id, trustDomainId: developmentDomain.id, name: '开发 CA', commonName: 'Development Root CA', securityDomain: 'shared',
    topologyMode: 'external_managed', deploymentMode: 'external', runtimePlatform: 'external', availabilityMode: 'single', keyBackend: 'hsm',
    confirmationToken: preview.confirmationToken, actorId,
  }))[0];
  assert.notEqual(productionAuthority.trustDomainId, developmentAuthority.trustDomainId);

  const { version: productionProfile } = await service.createProfile(tenantId, {
    name: '生产 TLS', securityDomain: 'shared', trustDomainId: productionDomain.id, actorId,
  });
  await assert.rejects(
    () => service.createCertificateRequest(tenantId, {
      applicationAssetId: 'app-development', caId: developmentAuthority.id, trustDomainId: developmentDomain.id,
      profileVersionId: productionProfile.id, commonName: 'dev.example.com', sans: ['dev.example.com'],
      custodyMode: 'managed_secret', actorId,
    }),
    (error: unknown) => typeof error === 'object' && error !== null && 'errorCode' in error && error.errorCode === 'CERTIFICATE_TRUST_DOMAIN_MISMATCH',
  );

  await service.updateTrustDomain(tenantId, developmentDomain.id, { status: 'compromised' }, actorId);
  await assert.rejects(
    () => service.createCertificateRequest(tenantId, {
      applicationAssetId: 'app-development', caId: developmentAuthority.id, trustDomainId: developmentDomain.id,
      profileVersionId: productionProfile.id, commonName: 'dev.example.com', sans: ['dev.example.com'],
      custodyMode: 'managed_secret', actorId,
    }),
    (error: unknown) => typeof error === 'object' && error !== null && 'errorCode' in error && error.errorCode === 'CA_TRUST_DOMAIN_STATE_INVALID',
  );
});

test('同一公钥跨根 CA 信任域复用时报告严重隔离风险', () => {
  const common = {
    fingerprint_sha256: '11'.repeat(32), public_key_fingerprint_sha256: '22'.repeat(32),
    common_name: 'service.example.com', sans: ['service.example.com'], environment: 'production', metadata: {},
  };
  const risks = buildReuseRisks([
    { ...common, binding_id: 'binding-a', service_asset_id: 'asset-a', certificate_version_id: 'version-a', display_name: '应用 A', trust_domain_id: 'domain-a', trust_domain_name: '生产根 CA' },
    { ...common, binding_id: 'binding-b', service_asset_id: 'asset-b', certificate_version_id: 'version-b', display_name: '应用 B', trust_domain_id: 'domain-b', trust_domain_name: '设备根 CA' },
  ], 'public_key_reuse', (row) => row.public_key_fingerprint_sha256!);
  assert.equal(risks.length, 1);
  assert.equal(risks[0].severity, 'critical');
  assert.equal(risks[0].crossTrustDomain, true);
  assert.deepEqual(risks[0].trustDomainIds.sort(), ['domain-a', 'domain-b']);
  assert.match(risks[0].explanation, /根 CA 信任域/);
});

test('CA Node 注册令牌只能使用一次，主备拒绝双主且多活允许多节点', async () => {
  const { service } = await createFixture();
  const tenantId = 'tenant-ca-node';
  const provider = await service.createProvider(tenantId, {
    name: 'Linux CA Node',
    type: 'gcac_managed_node',
    deploymentMode: 'managed_node',
    runtimePlatform: 'linux',
    availabilityMode: 'active_standby',
  }, 'user-admin');
  const capabilities = {
    discoverHierarchy: true,
    createRoot: true,
    createIntermediate: true,
    signCsr: true,
    queryIssuance: true,
    revokeCertificate: true,
    publishCrl: true,
    ocsp: true,
    listProfiles: true,
    deviceLocalCsr: false,
    hardwareBackedKey: true,
    highAvailability: true,
  };
  const firstToken = await service.createNodeEnrollmentToken(tenantId, provider.id, 'user-admin');
  await service.registerNode({
    token: firstToken.token,
    name: 'ca-node-a',
    platform: 'linux',
    role: 'active',
    identityFingerprint: 'aa'.repeat(32),
    keyBackend: 'pkcs11',
    exportability: 'non_exportable',
    capabilities,
  });
  await assert.rejects(() => service.registerNode({
    token: firstToken.token,
    name: 'replay',
    platform: 'linux',
    role: 'standby',
    identityFingerprint: 'bb'.repeat(32),
    keyBackend: 'pkcs11',
    exportability: 'non_exportable',
    capabilities,
  }));

  const secondToken = await service.createNodeEnrollmentToken(tenantId, provider.id, 'user-admin');
  await assert.rejects(() => service.registerNode({
    token: secondToken.token,
    name: 'ca-node-b',
    platform: 'linux',
    role: 'active',
    identityFingerprint: 'cc'.repeat(32),
    keyBackend: 'pkcs11',
    exportability: 'non_exportable',
    capabilities,
  }));

  const activeActiveProvider = await service.createProvider(tenantId, {
    name: '多活 CA Node',
    type: 'gcac_managed_node',
    deploymentMode: 'managed_node',
    runtimePlatform: 'linux',
    availabilityMode: 'active_active',
    configuration: { keyBackend: 'pkcs11' },
  }, 'user-admin');
  for (const suffix of ['a', 'b']) {
    const token = await service.createNodeEnrollmentToken(tenantId, activeActiveProvider.id, 'user-admin');
    const node = await service.registerNode({
      token: token.token,
      name: `active-active-${suffix}`,
      platform: 'linux',
      role: 'active',
      identityFingerprint: (suffix === 'a' ? 'dd' : 'ee').repeat(32),
      keyBackend: 'pkcs11',
      exportability: 'non_exportable',
      capabilities,
    });
    assert.equal(node.role, 'active');
  }
});
