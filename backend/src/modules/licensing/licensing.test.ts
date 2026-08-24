import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { GCAC_VERSION } from '../../common/version.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { AuditService, type WriteAuditInput } from '../audits/audit.service.js';
import type { AuditLogEntity } from '../../persistence/entities/audit-log.entity.js';
import { signPayloadForTests } from './domain/license-crypto.js';
import { LicensingApplicationService } from './application/licensing.application-service.js';
import type { ActivationResponse, LicenseGrant, LicenseGrantV1, LicenseGrantV2 } from './domain/licensing.types.js';

function createSigningFixture() {
  const signingPair = generateKeyPairSync('ed25519');
  return {
    privateKey: signingPair.privateKey.export({ format: 'der', type: 'pkcs8' }),
    publicKey: signingPair.publicKey.export({ format: 'der', type: 'spki' }),
  };
}

function signGrant<T extends LicenseGrant>(grant: T, privateKey: Buffer): T {
  grant.signature = signPayloadForTests(grant as unknown as Record<string, unknown>, privateKey);
  return grant;
}

async function withEnvironment<T>(
  changes: Record<string, string | undefined>,
  callback: () => Promise<T> | T,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(changes)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

class RecordingAuditService extends AuditService {
  readonly events: WriteAuditInput[] = [];

  override async write(input: WriteAuditInput): Promise<AuditLogEntity> {
    this.events.push(input);
    return {} as AuditLogEntity;
  }
}

test('无许可证时按 none 状态运行社区功能，并把应用资产限制为 1', async () => {
  const service = new LicensingApplicationService(new PgliteDatabase(), undefined, {
    trustKeys: new Map(),
    storageKey: Buffer.alloc(32, 7),
  });

  const status = await service.getStatus();
  assert.equal(status.state, 'none');
  assert.equal(status.planCode, 'none');
  assert.equal(status.quotas.applicationAssets, 1);
  assert.match(status.deviceId, /^dev_/);

  await service.requireFeature('deployment.manual');
  await service.requireApplicationAssetQuota(1);
  await assert.rejects(
    () => service.requireApplicationAssetQuota(2),
    (error: unknown) => error instanceof Error && 'errorCode' in error && error.errorCode === 'LICENSE_QUOTA_EXCEEDED',
  );
});

test('社区版额度上限为 5，并收敛旧的不限额度存量许可证', async () => {
  const keys = createSigningFixture();
  const service = new LicensingApplicationService(new PgliteDatabase(), undefined, {
    trustKeys: new Map([['key-community-quota', keys.publicKey]]),
    storageKey: Buffer.alloc(32, 34),
    now: () => new Date('2026-08-18T00:00:00.000Z'),
  });
  const initialStatus = await service.getStatus();
  const unlimitedGrant = signGrant<LicenseGrantV2>({
    schemaVersion: 2,
    grantId: 'grant_community_unlimited',
    keyId: 'key-community-quota',
    productCode: 'gcac',
    installationId: initialStatus.installationId,
    installationPublicKey: initialStatus.installationPublicKey,
    deviceId: initialStatus.deviceId,
    planCode: 'community',
    features: [...initialStatus.features],
    quotas: {
      applicationAssets: null,
      managedTargets: null,
      concurrentExecutions: null,
      plugins: null,
    },
    issuedAt: '2026-08-18T00:00:00.000Z',
    startsAt: '2026-08-18T00:00:00.000Z',
    gracePeriodDays: 0,
    upgradeGraceDays: 30,
    signature: '',
  }, keys.privateKey);

  await assert.rejects(
    () => service.importLicense(unlimitedGrant),
    (error: unknown) => error instanceof Error && 'errorCode' in error && error.errorCode === 'LICENSE_INVALID',
  );
  await (service as any).repositories.grants.upsert({
    id: 'current',
    grant: unlimitedGrant,
    importedAt: '2026-08-18T00:00:00.000Z',
  });

  const status = await service.getStatus();
  assert.equal(status.planCode, 'community');
  assert.equal(status.quotas.applicationAssets, 5);
  assert.equal(status.quotas.managedTargets, 5);
});

test('生产环境缺少显式许可证信任根时必须失败关闭', async () => {
  await withEnvironment({ NODE_ENV: 'production', GCAC_LICENSE_TRUST_KEYS_JSON: undefined }, async () => {
    assert.throws(
      () => new LicensingApplicationService(new PgliteDatabase(), undefined, { storageKey: Buffer.alloc(32, 31) }),
      /生产环境缺少 GCAC_LICENSE_TRUST_KEYS_JSON/,
    );
  });
});

test('非生产环境缺少显式许可证存储密钥时也必须失败关闭', async () => {
  await withEnvironment({
    NODE_ENV: 'test',
    GCAC_LICENSE_TRUST_KEYS_JSON: undefined,
    GCAC_LICENSE_STORAGE_KEY: undefined,
    GCAC_SECRET_KEK: undefined,
  }, async () => {
    assert.throws(
      () => new LicensingApplicationService(new PgliteDatabase()),
      /缺少 GCAC_LICENSE_STORAGE_KEY 或 GCAC_SECRET_KEK/,
    );
  });
});

test('生产环境显式配置了信任根但缺少许可证存储密钥时仍必须失败关闭', async () => {
  const keys = createSigningFixture();
  await withEnvironment({
    NODE_ENV: 'production',
    GCAC_LICENSE_TRUST_KEYS_JSON: JSON.stringify({ 'key-prod-storage-test': keys.publicKey.toString('base64url') }),
    GCAC_LICENSE_STORAGE_KEY: undefined,
    GCAC_SECRET_KEK: undefined,
  }, async () => {
    assert.throws(
      () => new LicensingApplicationService(new PgliteDatabase()),
      /缺少 GCAC_LICENSE_STORAGE_KEY 或 GCAC_SECRET_KEK/,
    );
  });
});

test('生产环境只使用显式 Ed25519 信任根验证许可证', async () => {
  const keys = createSigningFixture();
  await withEnvironment({
    NODE_ENV: 'production',
    GCAC_LICENSE_TRUST_KEYS_JSON: JSON.stringify({ 'key-prod-2026-08': keys.publicKey.toString('base64url') }),
  }, async () => {
    const service = new LicensingApplicationService(new PgliteDatabase(), undefined, {
      storageKey: Buffer.alloc(32, 32),
      now: () => new Date('2026-08-08T00:00:00.000Z'),
    });
    const initialStatus = await service.getStatus();
    const grant = signGrant<LicenseGrantV2>({
      schemaVersion: 2,
      grantId: 'grant_explicit_production_root',
      keyId: 'key-prod-2026-08',
      productCode: 'gcac',
      installationId: initialStatus.installationId,
      installationPublicKey: initialStatus.installationPublicKey,
      deviceId: initialStatus.deviceId,
      planCode: 'community',
      features: [...initialStatus.features],
      quotas: {
        applicationAssets: 3,
        managedTargets: 3,
        concurrentExecutions: null,
        plugins: null,
      },
      issuedAt: '2026-08-08T00:00:00.000Z',
      startsAt: '2026-08-08T00:00:00.000Z',
      gracePeriodDays: 0,
      upgradeGraceDays: 30,
      signature: '',
    }, keys.privateKey);

    const imported = await service.importLicense(grant);
    assert.equal(imported.state, 'active');
    assert.equal(imported.integrityStatus, 'verified');
  });
});

test('生产环境拒绝空对象、非法公钥和默认开发许可证信任根', async () => {
  const keys = createSigningFixture();
  const invalidConfigurations = [
    '{}',
    JSON.stringify({ 'key-prod-invalid': 'not-a-base64url-key' }),
    JSON.stringify({ 'builtin-dev-2026-08': keys.publicKey.toString('base64url') }),
  ];

  for (const configuration of invalidConfigurations) {
    await withEnvironment({ NODE_ENV: 'production', GCAC_LICENSE_TRUST_KEYS_JSON: configuration }, async () => {
      assert.throws(
        () => new LicensingApplicationService(new PgliteDatabase(), undefined, { storageKey: Buffer.alloc(32, 33) }),
        /GCAC_LICENSE_TRUST_KEYS_JSON|默认开发许可证信任根/,
      );
    });
  }
});

test('许可证内容被修改后标记为 tampered，并拒绝再次导入', async () => {
  const keys = createSigningFixture();
  const audit = new RecordingAuditService();
  const service = new LicensingApplicationService(new PgliteDatabase(), audit, {
    trustKeys: new Map([['key-2026-08', keys.publicKey]]),
    storageKey: Buffer.alloc(32, 11),
    now: () => new Date('2026-08-08T00:00:00.000Z'),
  });

  const initialStatus = await service.getStatus();
  const grant = signGrant<LicenseGrantV2>({
    schemaVersion: 2,
    grantId: 'grant_integrity_test',
    keyId: 'key-2026-08',
    productCode: 'gcac',
    installationId: initialStatus.installationId,
    installationPublicKey: initialStatus.installationPublicKey,
    deviceId: initialStatus.deviceId,
    planCode: 'community',
    features: [...initialStatus.features],
    quotas: {
      applicationAssets: 3,
      managedTargets: 3,
      concurrentExecutions: null,
      plugins: null,
    },
    issuedAt: '2026-08-08T00:00:00.000Z',
    startsAt: '2026-08-08T00:00:00.000Z',
    gracePeriodDays: 0,
    upgradeGraceDays: 30,
    signature: '',
  }, keys.privateKey);

  const imported = await service.importLicense(grant);
  assert.equal(imported.integrityStatus, 'verified');

  const tamperedImport = {
    ...grant,
    quotas: {
      ...grant.quotas,
      applicationAssets: 999,
      managedTargets: 999,
    },
  };
  await assert.rejects(
    () => service.importLicense(tamperedImport),
    (error: unknown) => error instanceof Error && 'errorCode' in error && error.errorCode === 'LICENSE_TAMPERED',
  );
  assert.equal((await service.getStatus()).integrityStatus, 'verified');

  const tamperedGrant = {
    ...grant,
    quotas: {
      ...grant.quotas,
      applicationAssets: 999,
      managedTargets: 999,
    },
  };
  await (service as any).repositories.grants.upsert({
    id: 'current',
    grant: tamperedGrant,
    importedAt: '2026-08-08T00:00:00.000Z',
  });

  const tamperedStatus = await service.getStatus();
  assert.equal(tamperedStatus.state, 'none');
  assert.equal(tamperedStatus.integrityStatus, 'tampered');
  assert.equal(tamperedStatus.reason, 'signature invalid');

  await assert.rejects(
    () => service.importLicense(tamperedGrant),
    (error: unknown) => error instanceof Error && 'errorCode' in error && error.errorCode === 'LICENSE_TAMPERED',
  );
  assert.equal(audit.events.at(-1)?.eventType, 'licensing.license.tampered');
  assert.equal(audit.events.at(-1)?.riskLevel, 'high');
  assert.equal(audit.events.at(-1)?.result, 'failure');
});

test('V2 许可证绑定 deviceId，版本失配后进入 upgrade_grace，超时后降级为 none', async () => {
  const keys = createSigningFixture();
  let currentNow = new Date('2026-08-08T00:00:00.000Z');
  const service = new LicensingApplicationService(new PgliteDatabase(), undefined, {
    trustKeys: new Map([['key-2026-08', keys.publicKey]]),
    storageKey: Buffer.alloc(32, 9),
    now: () => currentNow,
  });

  const initialStatus = await service.getStatus();
  const storedIncompatibleGrant = signGrant<LicenseGrantV2>({
    schemaVersion: 2,
    grantId: 'grant_test_v2_upgrade',
    keyId: 'key-2026-08',
    productCode: 'gcac',
    installationId: initialStatus.installationId,
    installationPublicKey: initialStatus.installationPublicKey,
    deviceId: initialStatus.deviceId,
    planCode: 'commercial',
    features: [...initialStatus.features],
    quotas: {
      applicationAssets: 5,
      managedTargets: 5,
      concurrentExecutions: null,
      plugins: null,
    },
    issuedAt: '2026-08-01T00:00:00.000Z',
    startsAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2027-08-01T00:00:00.000Z',
    gracePeriodDays: 14,
    versionRange: { min: '0.0.1', max: '0.0.9' },
    upgradeGraceDays: 30,
    signature: '',
  }, keys.privateKey);

  await (service as any).repositories.grants.upsert({
    id: 'current',
    grant: storedIncompatibleGrant,
    importedAt: currentNow.toISOString(),
  });

  const graceStatus = await service.getStatus();
  assert.equal(graceStatus.state, 'upgrade_grace');
  assert.equal(graceStatus.planCode, 'commercial');
  assert.equal(graceStatus.versionCompatible, false);
  assert.equal(graceStatus.licenseSchemaVersion, 2);
  assert.ok(graceStatus.upgradeGraceEndsAt);

  const mismatchedDeviceGrant = signGrant<LicenseGrantV2>({
    ...storedIncompatibleGrant,
    grantId: 'grant_test_v2_device_mismatch',
    deviceId: 'dev_other_device',
    versionRange: { min: '0.1.0', max: '0.1.0' },
    signature: '',
  }, keys.privateKey);

  await assert.rejects(
    () => service.importLicense(mismatchedDeviceGrant),
    (error: unknown) => error instanceof Error && 'errorCode' in error && error.errorCode === 'LICENSE_DEVICE_MISMATCH',
  );

  currentNow = new Date('2026-09-08T00:00:00.000Z');
  const expiredStatus = await service.getStatus();
  assert.equal(expiredStatus.state, 'none');
  assert.equal(expiredStatus.planCode, 'none');
  assert.equal(expiredStatus.quotas.applicationAssets, 1);
  assert.equal(expiredStatus.reason, 'upgrade grace expired');
  await service.requireFeature('deployment.manual');
  await assert.rejects(() => service.requireApplicationAssetQuota(2));
});

test('试用许可证到期后恢复为 none，商业版不会因旧到期字段失效', async () => {
  const keys = createSigningFixture();
  let currentNow = new Date('2026-08-08T00:00:00.000Z');
  const service = new LicensingApplicationService(new PgliteDatabase(), undefined, {
    trustKeys: new Map([['key-2026-08', keys.publicKey]]),
    storageKey: Buffer.alloc(32, 10),
    now: () => currentNow,
  });

  const initialStatus = await service.getStatus();
  const trialGrant = signGrant<LicenseGrantV2>({
    schemaVersion: 2,
    grantId: 'grant_trial_expiring',
    keyId: 'key-2026-08',
    productCode: 'gcac',
    installationId: initialStatus.installationId,
    installationPublicKey: initialStatus.installationPublicKey,
    deviceId: initialStatus.deviceId,
    planCode: 'trial',
    features: [...initialStatus.features],
    quotas: {
      applicationAssets: 5,
      managedTargets: 5,
      concurrentExecutions: null,
      plugins: null,
    },
    issuedAt: '2026-08-08T00:00:00.000Z',
    startsAt: '2026-08-08T00:00:00.000Z',
    expiresAt: '2026-08-09T00:00:00.000Z',
    gracePeriodDays: 0,
    upgradeGraceDays: 30,
    trialDays: 1,
    signature: '',
  }, keys.privateKey);

  const importedTrial = await service.importLicense(trialGrant);
  assert.equal(importedTrial.state, 'active');
  assert.equal(importedTrial.planCode, 'trial');
  assert.equal(importedTrial.expiresAt, '2026-08-09T00:00:00.000Z');

  currentNow = new Date('2026-08-09T00:00:01.000Z');
  const expiredTrial = await service.getStatus();
  assert.equal(expiredTrial.state, 'none');
  assert.equal(expiredTrial.planCode, 'none');
  assert.equal(expiredTrial.quotas.applicationAssets, 1);
  await service.requireFeature('deployment.manual');

  const commercialGrant = signGrant<LicenseGrantV2>({
    ...trialGrant,
    grantId: 'grant_commercial_permanent',
    planCode: 'commercial',
    issuedAt: '2026-08-10T00:00:00.000Z',
    startsAt: '2026-08-10T00:00:00.000Z',
    expiresAt: '2026-08-10T00:00:01.000Z',
    signature: '',
  }, keys.privateKey);
  currentNow = new Date('2026-08-10T00:00:02.000Z');
  const importedCommercial = await service.importLicense(commercialGrant);
  assert.equal(importedCommercial.state, 'active');
  assert.equal(importedCommercial.planCode, 'commercial');
  assert.equal(importedCommercial.expiresAt, undefined);
});

test('激活请求导出 deviceId，旧套餐代码导入后按新口径归并为 commercial', async () => {
  const keys = createSigningFixture();
  const service = new LicensingApplicationService(new PgliteDatabase(), undefined, {
    trustKeys: new Map([['key-2026-08', keys.publicKey]]),
    storageKey: Buffer.alloc(32, 5),
    now: () => new Date('2026-08-08T00:00:00.000Z'),
  });

  const initialStatus = await service.getStatus();
  const request = await service.createActivationRequest();
  assert.equal(request.kind, 'offline');
  assert.equal(request.schemaVersion, 2);
  assert.equal(request.deviceId, initialStatus.deviceId);
  assert.equal(request.productVersion, GCAC_VERSION);

  const grant = signGrant<LicenseGrantV1>({
    schemaVersion: 1,
    grantId: 'grant_test_v1_standard',
    keyId: 'key-2026-08',
    productCode: 'gcac',
    installationId: initialStatus.installationId,
    installationPublicKey: initialStatus.installationPublicKey,
    planCode: 'standard',
    features: ['core.assets', 'workflow.templates'],
    quotas: { managedTargets: 2, concurrentExecutions: 1, plugins: 0 },
    issuedAt: '2026-08-08T00:00:00.000Z',
    startsAt: '2026-08-08T00:00:00.000Z',
    expiresAt: '2027-08-08T00:00:00.000Z',
    gracePeriodDays: 14,
    signature: '',
  }, keys.privateKey);

  const response: ActivationResponse = {
    schemaVersion: 2,
    responseId: 'resp_standard_to_commercial',
    requestId: request.requestId,
    nonce: request.nonce,
    issuedAt: '2026-08-08T00:00:00.000Z',
    licenseGrant: grant,
  };
  const imported = await service.importActivationResponse(response);

  assert.equal(imported.state, 'active');
  assert.equal(imported.planCode, 'commercial');
  assert.equal(imported.quotas.applicationAssets, 2);
  await service.requireQuota('managedTargets', 2);
  await assert.rejects(
    () => service.requireQuota('applicationAssets', 3),
    (error: unknown) => error instanceof Error && 'errorCode' in error && error.errorCode === 'LICENSE_QUOTA_EXCEEDED',
  );
});

test('运行时可同时信任多个 keyId，并在导入撤销列表后把当前许可证标记为 revoked', async () => {
  const oldKeys = createSigningFixture();
  const newKeys = createSigningFixture();
  const service = new LicensingApplicationService(new PgliteDatabase(), undefined, {
    trustKeys: new Map([
      ['key-2026-08-old', oldKeys.publicKey],
      ['key-2026-09-new', newKeys.publicKey],
    ]),
    storageKey: Buffer.alloc(32, 8),
    now: () => new Date('2026-08-08T00:00:00.000Z'),
  });

  const initialStatus = await service.getStatus();
  const oldGrant = signGrant<LicenseGrantV2>({
    schemaVersion: 2,
    grantId: 'grant_old_key_active',
    keyId: 'key-2026-08-old',
    productCode: 'gcac',
    installationId: initialStatus.installationId,
    installationPublicKey: initialStatus.installationPublicKey,
    deviceId: initialStatus.deviceId,
    planCode: 'community',
    features: [...initialStatus.features],
    quotas: {
      applicationAssets: 2,
      managedTargets: 2,
      concurrentExecutions: null,
      plugins: null,
    },
    issuedAt: '2026-08-08T00:00:00.000Z',
    startsAt: '2026-08-08T00:00:00.000Z',
    gracePeriodDays: 0,
    versionRange: { min: GCAC_VERSION, max: GCAC_VERSION },
    upgradeGraceDays: 30,
    signature: '',
  }, oldKeys.privateKey);

  const importedOld = await service.importLicense(oldGrant);
  assert.equal(importedOld.state, 'active');
  assert.equal(importedOld.planCode, 'community');

  const revocationList = {
    schemaVersion: 1 as const,
    listId: 'revocation_list_001',
    keyId: 'key-2026-09-new',
    generatedAt: '2026-08-08T00:00:00.000Z',
    expiresAt: '2027-02-04T00:00:00.000Z',
    revokedGrantIds: ['grant_old_key_active'],
    signature: '',
  };
  revocationList.signature = signPayloadForTests(revocationList as unknown as Record<string, unknown>, newKeys.privateKey);

  await service.importRevocationList(revocationList);
  const revokedStatus = await service.getStatus();
  assert.equal(revokedStatus.state, 'revoked');
  assert.equal(revokedStatus.grantId, 'grant_old_key_active');

  await assert.rejects(
    () => service.importLicense(oldGrant),
    (error: unknown) => error instanceof Error && 'errorCode' in error && error.errorCode === 'LICENSE_REVOKED',
  );

  const newGrant = signGrant<LicenseGrantV2>({
    ...oldGrant,
    grantId: 'grant_new_key_active',
    keyId: 'key-2026-09-new',
    issuedAt: '2026-08-09T00:00:00.000Z',
    signature: '',
  }, newKeys.privateKey);
  const importedNew = await service.importLicense(newGrant);
  assert.equal(importedNew.state, 'active');
  assert.equal(importedNew.grantId, 'grant_new_key_active');
});
