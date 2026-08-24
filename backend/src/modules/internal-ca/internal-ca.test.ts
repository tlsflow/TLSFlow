import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { createCertificateServices } from '../certificates/index.js';
import { createSecurityServices } from '../security/security.controller.js';
import { InternalCaApplicationService } from './application/internal-ca.application-service.js';

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
  return { db, security, certificates, service };
}

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
  const intermediate = authorities.find((item) => item.role === 'intermediate');
  assert.ok(intermediate?.certificatePem);

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

  const distribution = await service.createTrustDistribution(tenantId, intermediate.id, { agentIds: ['agent-a'], platform: 'linux' }, actorId);
  assert.ok(distribution.approvalId);
  await security.approvals.decide({ approvalId: distribution.approvalId!, decision: 'approved', approverId: 'security-admin' });
  const deploying = await service.approveTrustDistribution(tenantId, distribution.id, distribution.approvalId!);
  assert.equal(deploying.status, 'deploying');
  const verified = await service.completeTrustDistribution(tenantId, distribution.id, true, { installed: 1, verified: 1 });
  assert.equal(verified.status, 'verified');
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
