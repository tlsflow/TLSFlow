import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { AssetsApplicationService } from './application/assets.application-service.js';
import { PgAssetsRepository } from './repository/assets.repository.js';

test('应用资产地址变更会同步派生 SNI、accessDomain 和校验地址', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const service = new AssetsApplicationService(new PgAssetsRepository(database));
  const created = await service.createServiceAsset('tenant-address-sync', {
    address: 'ad.example.com',
    port: 443,
    protocol: 'HTTPS',
    sniName: 'ad.example.com',
    verifyUrl: 'https://ad.example.com:8443/health',
    metadata: { accessDomain: 'ad.example.com' },
  });

  const updated = await service.updateServiceAsset('tenant-address-sync', created.id, { address: 'cns.example.com' });

  assert.equal(updated.address, 'cns.example.com');
  assert.equal(updated.sniName, 'cns.example.com');
  assert.equal(updated.verifyUrl, 'https://cns.example.com:8443/health');
  assert.equal(updated.metadata.accessDomain, 'cns.example.com');
});

test('应用资产地址变更不会覆盖显式独立 SNI', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const service = new AssetsApplicationService(new PgAssetsRepository(database));
  const created = await service.createServiceAsset('tenant-address-sync-explicit', {
    address: 'backend.example.com',
    port: 443,
    protocol: 'HTTPS',
    sniName: 'public.example.com',
    verifyUrl: 'https://backend.example.com:8443',
  });

  const updated = await service.updateServiceAsset('tenant-address-sync-explicit', created.id, { address: 'backend-new.example.com' });

  assert.equal(updated.sniName, 'public.example.com');
  assert.equal(updated.verifyUrl, 'https://backend-new.example.com:8443/');
});

test('地址已变更但历史派生 SNI 未变时，保存资产会修复历史字段', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const service = new AssetsApplicationService(new PgAssetsRepository(database));
  const created = await service.createServiceAsset('tenant-address-sync-stale', {
    address: 'cns.example.com',
    port: 443,
    protocol: 'HTTPS',
    sniName: 'ad.example.com',
    verifyUrl: 'https://cns.example.com:8443',
    metadata: { accessDomain: 'ad.example.com' },
  });

  const updated = await service.updateServiceAsset('tenant-address-sync-stale', created.id, { address: 'cns.example.com' });

  assert.equal(updated.sniName, 'cns.example.com');
  assert.equal(updated.metadata.accessDomain, 'cns.example.com');
  assert.equal(updated.verifyUrl, 'https://cns.example.com:8443');
});
