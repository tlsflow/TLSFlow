import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { createCertificateServices } from '../certificates/index.js';
import { createSecurityServices } from '../security/security.controller.js';
import { InternalCaApplicationService } from './application/internal-ca.application-service.js';
import { CertificateLifecycleService } from './application/certificate-lifecycle.service.js';

const previousSecretKek = process.env.GCAC_SECRET_KEK;
const previousCaConfirmationSecret = process.env.GCAC_CA_CONFIRMATION_SECRET;
process.env.GCAC_SECRET_KEK = 'test-secret-kek-for-certificate-lifecycle';
process.env.GCAC_CA_CONFIRMATION_SECRET = 'test-ca-confirmation-secret';

async function fixture() {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');
  const security = createSecurityServices();
  const certificates = createCertificateServices(security, { db });
  const internalCa = new InternalCaApplicationService({
    db,
    secrets: security.secrets,
    certificates: certificates.certificates,
    audit: security.audit,
    approvals: security.approvals,
  });
  return {
    db,
    internalCa,
    lifecycle: new CertificateLifecycleService({
      internalCa,
      certificates: certificates.certificates,
      repository: internalCa.getRepository(),
    }),
  };
}

process.on('exit', () => {
  if (previousSecretKek === undefined) delete process.env.GCAC_SECRET_KEK;
  else process.env.GCAC_SECRET_KEK = previousSecretKek;
  if (previousCaConfirmationSecret === undefined) delete process.env.GCAC_CA_CONFIRMATION_SECRET;
  else process.env.GCAC_CA_CONFIRMATION_SECRET = previousCaConfirmationSecret;
});

test('证书轮换使用新密钥，TLS 验证前不吊销旧证书，重复请求保持幂等', async () => {
  const { db, internalCa, lifecycle } = await fixture();
  try {
    const tenantId = 'tenant-certificate-rotation';
    const provider = await internalCa.createProvider(tenantId, {
      name: '轮换内置 CA', type: 'gcac_builtin', deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single',
    }, 'admin');
    const preview = internalCa.previewAuthority({
      topologyMode: 'root_only', deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single', keyBackend: 'secret',
    });
    const [authority] = await internalCa.createAuthority(tenantId, {
      providerId: provider.id, name: 'Rotation Root', commonName: 'Rotation Root', securityDomain: 'production',
      topologyMode: 'root_only', deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single', keyBackend: 'secret',
      crlDistributionPoint: 'http://gcac.test/api/v1/public/ca-crl/tenant-certificate-rotation/',
      confirmationToken: preview.confirmationToken, actorId: 'admin',
    });
    const profile = await internalCa.createProfile(tenantId, { name: 'Rotation Profile', securityDomain: 'production', actorId: 'admin' });
    const issued = await internalCa.createCertificateRequest(tenantId, {
      applicationAssetId: 'rotation-app', caId: authority!.id, profileVersionId: profile.version.id,
      commonName: 'rotation.example.com', sans: ['rotation.example.com'], custodyMode: 'managed_secret', actorId: 'admin',
    });
    assert.equal(issued.status, 'issued');
    assert.ok(issued.certificateVersionId);

    const first = await lifecycle.createRotation({
      tenantId, applicationAssetId: 'rotation-app', sourceCertificateVersionId: issued.certificateVersionId!,
      custodyMode: 'managed_secret', idempotencyKey: 'rotate-once', actorId: 'admin',
    });
    const repeated = await lifecycle.createRotation({
      tenantId, applicationAssetId: 'rotation-app', sourceCertificateVersionId: issued.certificateVersionId!,
      custodyMode: 'managed_secret', idempotencyKey: 'rotate-once', actorId: 'admin',
    });
    assert.equal(repeated.id, first.id);
    assert.equal(first.status, 'install_pending');
    assert.notEqual(first.sourceKeyReferenceId, first.targetKeyReferenceId);
    assert.ok(first.targetCertificateVersionId);
    assert.deepEqual(await internalCa.listRevocations(tenantId), []);

    const install = await lifecycle.getInstallAction(tenantId, first.id);
    assert.equal(install.operation, 'certificate.install_issued');
    assert.equal(install.privateKeyTransported, false);
    assert.equal(install.certificateVersionId, first.targetCertificateVersionId);

    const completed = await lifecycle.markTlsVerified({
      tenantId, rotationId: first.id, certificateVersionId: first.targetCertificateVersionId!,
      tlsEvidence: { verified: true, protocol: 'TLS', observedAt: new Date().toISOString() }, actorId: 'admin',
    });
    assert.equal(completed.status, 'completed');
    assert.equal((await internalCa.listRevocations(tenantId)).length, 1);
  } finally {
    await db.close();
  }
});

test('本机 Agent 轮换在 CSR 尚未回传时保持可恢复状态', async () => {
  const { db, internalCa, lifecycle } = await fixture();
  try {
    const tenantId = 'tenant-agent-rotation-pending';
    const provider = await internalCa.createProvider(tenantId, {
      name: 'Agent 轮换内置 CA', type: 'gcac_builtin', deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single',
    }, 'admin');
    const preview = internalCa.previewAuthority({ topologyMode: 'root_only', deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single', keyBackend: 'secret' });
    const [authority] = await internalCa.createAuthority(tenantId, {
      providerId: provider.id, name: 'Agent Rotation Root', securityDomain: 'production', topologyMode: 'root_only',
      deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single', keyBackend: 'secret', confirmationToken: preview.confirmationToken, actorId: 'admin',
    });
    const profile = await internalCa.createProfile(tenantId, { name: 'Agent Rotation Profile', securityDomain: 'production', actorId: 'admin' });
    const issued = await internalCa.createCertificateRequest(tenantId, {
      applicationAssetId: 'agent-rotation-app', caId: authority!.id, profileVersionId: profile.version.id,
      commonName: 'agent-rotation.example.com', sans: ['agent-rotation.example.com'], custodyMode: 'managed_secret', actorId: 'admin',
    });
    const pending = await lifecycle.createRotation({
      tenantId, applicationAssetId: 'agent-rotation-app', sourceCertificateVersionId: issued.certificateVersionId!,
      custodyMode: 'local_agent', idempotencyKey: 'agent-rotate-once', actorId: 'admin',
    });
    assert.equal(pending.status, 'key_csr_pending');
    assert.equal((await internalCa.listRevocations(tenantId)).length, 0);
  } finally {
    await db.close();
  }
});
