import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { signPayloadForTests } from './domain/license-crypto.js';
import { LicensingApplicationService } from './application/licensing.application-service.js';
import type { ActivationResponse, LicenseGrant } from './domain/licensing.types.js';

test('LicenseGrant 使用 Ed25519 校验并绑定安装实例', async () => {
  const signingPair = generateKeyPairSync('ed25519');
  const privateKey = signingPair.privateKey.export({ format: 'der', type: 'pkcs8' });
  const publicKey = signingPair.publicKey.export({ format: 'der', type: 'spki' });
  const service = new LicensingApplicationService(new PgliteDatabase(), undefined, {
    trustKeys: new Map([['key-2026-01', publicKey]]),
    storageKey: Buffer.alloc(32, 7),
  });
  const status = await service.getStatus();
  const grant: LicenseGrant = {
    schemaVersion: 1,
    grantId: 'grant_test_001',
    keyId: 'key-2026-01',
    productCode: 'gcac',
    installationId: status.installationId,
    installationPublicKey: status.installationPublicKey,
    planCode: 'commercial',
    features: ['core.assets', 'deployment.manual', 'workflow.templates', 'monitoring.basic', 'automation', 'reports', 'plugins', 'deployment.private', 'licensing.offline', 'certificate.operations'],
    quotas: { managedTargets: 25, concurrentExecutions: null, plugins: null },
    issuedAt: '2026-08-04T00:00:00.000Z',
    startsAt: '2026-08-04T00:00:00.000Z',
    expiresAt: '2027-08-04T00:00:00.000Z',
    gracePeriodDays: 14,
    signature: '',
  };
  grant.signature = signPayloadForTests(grant as unknown as Record<string, unknown>, privateKey);
  const imported = await service.importLicense(grant);
  assert.equal(imported.state, 'active');
  await service.requireFeature('deployment.manual');
  await service.requireFeature('automation');

  const tampered = { ...grant, planCode: 'enterprise' as const };
  await assert.rejects(
    () => service.importLicense(tampered),
    (error: unknown) => error instanceof Error && 'errorCode' in error && error.errorCode === 'LICENSE_INVALID',
  );
});

test('激活响应必须绑定本地请求，额度守卫必须受许可证状态约束', async () => {
  const signingPair = generateKeyPairSync('ed25519');
  const privateKey = signingPair.privateKey.export({ format: 'der', type: 'pkcs8' });
  const publicKey = signingPair.publicKey.export({ format: 'der', type: 'spki' });
  let currentNow = new Date('2026-08-04T00:00:00.000Z');
  const service = new LicensingApplicationService(new PgliteDatabase(), undefined, {
    trustKeys: new Map([['key-2026-01', publicKey]]),
    storageKey: Buffer.alloc(32, 9),
    now: () => currentNow,
  });

  const initialStatus = await service.getStatus();
  const request = await service.createActivationRequest('offline');
  const grant: LicenseGrant = {
    schemaVersion: 1,
    grantId: 'grant_test_002',
    keyId: 'key-2026-01',
    productCode: 'gcac',
    installationId: initialStatus.installationId,
    installationPublicKey: initialStatus.installationPublicKey,
    planCode: 'free',
    features: ['core.assets', 'certificate.operations', 'deployment.manual', 'workflow.templates', 'monitoring.basic', 'automation', 'reports', 'plugins', 'deployment.private', 'licensing.offline'],
    quotas: { managedTargets: 5, concurrentExecutions: null, plugins: null },
    issuedAt: '2026-08-04T00:00:00.000Z',
    startsAt: '2026-08-04T00:00:00.000Z',
    expiresAt: '2026-08-05T00:00:00.000Z',
    gracePeriodDays: 1,
    signature: '',
  };
  grant.signature = signPayloadForTests(grant as unknown as Record<string, unknown>, privateKey);

  const badResponse: ActivationResponse = {
    schemaVersion: 1,
    responseId: 'resp_bad',
    requestId: request.requestId,
    nonce: 'wrong-nonce',
    issuedAt: '2026-08-04T00:00:00.000Z',
    licenseGrant: grant,
  };
  await assert.rejects(
    () => service.importActivationResponse(badResponse),
    (error: unknown) => error instanceof Error && 'errorCode' in error && error.errorCode === 'LICENSE_INVALID',
  );

  const goodResponse: ActivationResponse = {
    schemaVersion: 1,
    responseId: 'resp_good',
    requestId: request.requestId,
    nonce: request.nonce,
    issuedAt: '2026-08-04T00:00:00.000Z',
    licenseGrant: grant,
  };
  await service.importActivationResponse(goodResponse);
  await service.requireQuota('managedTargets', 5);
  await assert.rejects(
    () => service.requireQuota('managedTargets', 6),
    (error: unknown) => error instanceof Error && 'errorCode' in error && error.errorCode === 'LICENSE_QUOTA_EXCEEDED',
  );

  currentNow = new Date('2026-08-07T00:00:00.000Z');
  await assert.rejects(
    () => service.requireQuota('managedTargets', 1),
    (error: unknown) => error instanceof Error && 'errorCode' in error && error.errorCode === 'LICENSE_INVALID',
  );
});

test('旧套餐代码仍可被新产品目录兼容导入', async () => {
  const signingPair = generateKeyPairSync('ed25519');
  const privateKey = signingPair.privateKey.export({ format: 'der', type: 'pkcs8' });
  const publicKey = signingPair.publicKey.export({ format: 'der', type: 'spki' });
  const service = new LicensingApplicationService(new PgliteDatabase(), undefined, {
    trustKeys: new Map([['key-2026-01', publicKey]]),
    storageKey: Buffer.alloc(32, 3),
  });
  const status = await service.getStatus();
  const grant: LicenseGrant = {
    schemaVersion: 1,
    grantId: 'grant_test_003',
    keyId: 'key-2026-01',
    productCode: 'gcac',
    installationId: status.installationId,
    installationPublicKey: status.installationPublicKey,
    planCode: 'standard',
    features: ['core.assets', 'workflow.templates'],
    quotas: { managedTargets: 25, concurrentExecutions: 2, plugins: 0 },
    issuedAt: '2026-08-04T00:00:00.000Z',
    startsAt: '2026-08-04T00:00:00.000Z',
    expiresAt: '2027-08-04T00:00:00.000Z',
    gracePeriodDays: 14,
    signature: '',
  };
  grant.signature = signPayloadForTests(grant as unknown as Record<string, unknown>, privateKey);
  const imported = await service.importLicense(grant);
  assert.equal(imported.state, 'active');
  assert.equal(imported.planCode, 'standard');
});
