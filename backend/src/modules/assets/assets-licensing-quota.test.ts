import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { LicensingApplicationService } from '../licensing/application/licensing.application-service.js';
import { signPayloadForTests } from '../licensing/domain/license-crypto.js';
import type { LicenseGrantV2 } from '../licensing/domain/licensing.types.js';
import { AssetsApplicationService } from './application/assets.application-service.js';
import { PgAssetsRepository } from './repository/assets.repository.js';

function createSigningFixture() {
  const signingPair = generateKeyPairSync('ed25519');
  return {
    privateKey: signingPair.privateKey.export({ format: 'der', type: 'pkcs8' }),
    publicKey: signingPair.publicKey.export({ format: 'der', type: 'spki' }),
  };
}

function signGrant(grant: LicenseGrantV2, privateKey: Buffer): LicenseGrantV2 {
  grant.signature = signPayloadForTests(grant as unknown as Record<string, unknown>, privateKey);
  return grant;
}

test('无许可证时第二个应用资产会被额度门禁拒绝', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');

  const licensing = new LicensingApplicationService(db, undefined, {
    trustKeys: new Map(),
    storageKey: Buffer.alloc(32, 4),
  });
  const assets = new AssetsApplicationService(new PgAssetsRepository(db));
  assets.setLicensingService(licensing);

  const tenantId = 'tenant-license-none-quota';
  await assets.createServiceAsset(tenantId, {
    address: 'first.example.com',
    port: 443,
    protocol: 'HTTPS',
    discoverySource: 'MANUAL',
  });

  await assert.rejects(
    () => assets.createServiceAsset(tenantId, {
      address: 'second.example.com',
      port: 443,
      protocol: 'HTTPS',
      discoverySource: 'MANUAL',
    }),
    (error: unknown) => error instanceof Error && 'errorCode' in error && error.errorCode === 'LICENSE_QUOTA_EXCEEDED',
  );
});

test('社区许可证额度会真正限制应用资产创建数量', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');

  const keys = createSigningFixture();
  const licensing = new LicensingApplicationService(db, undefined, {
    trustKeys: new Map([['key-2026-08', keys.publicKey]]),
    storageKey: Buffer.alloc(32, 6),
    now: () => new Date('2026-08-08T00:00:00.000Z'),
  });
  const assets = new AssetsApplicationService(new PgAssetsRepository(db));
  assets.setLicensingService(licensing);

  const status = await licensing.getStatus();
  const grant = signGrant({
    schemaVersion: 2,
    grantId: 'grant_community_assets_2',
    keyId: 'key-2026-08',
    productCode: 'gcac',
    installationId: status.installationId,
    installationPublicKey: status.installationPublicKey,
    deviceId: status.deviceId,
    planCode: 'community',
    features: [...status.features],
    quotas: {
      applicationAssets: 2,
      managedTargets: 2,
      concurrentExecutions: null,
      plugins: null,
    },
    issuedAt: '2026-08-08T00:00:00.000Z',
    startsAt: '2026-08-08T00:00:00.000Z',
    gracePeriodDays: 0,
    versionRange: { min: '0.1.0', max: '0.1.0' },
    upgradeGraceDays: 30,
    signature: '',
  }, keys.privateKey);
  await licensing.importLicense(grant);

  const tenantId = 'tenant-license-community-quota';
  await assets.createServiceAsset(tenantId, {
    address: 'community-1.example.com',
    port: 443,
    protocol: 'HTTPS',
    discoverySource: 'MANUAL',
  });
  await assets.createServiceAsset(tenantId, {
    address: 'community-2.example.com',
    port: 443,
    protocol: 'HTTPS',
    discoverySource: 'MANUAL',
  });

  await assert.rejects(
    () => assets.createServiceAsset(tenantId, {
      address: 'community-3.example.com',
      port: 443,
      protocol: 'HTTPS',
      discoverySource: 'MANUAL',
    }),
    (error: unknown) => error instanceof Error && 'errorCode' in error && error.errorCode === 'LICENSE_QUOTA_EXCEEDED',
  );
});
