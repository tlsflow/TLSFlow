import assert from 'node:assert/strict';
import test from 'node:test';

import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgAssetsRepository } from './repository/assets.repository.js';

test('应用资产列表投影设备、框架和站点名称', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const repository = new PgAssetsRepository(database);
  const tenantId = 'tenant_application_asset_projection';

  const host = await repository.createHost(tenantId, {
    hostname: 'jackson-mgt',
    displayName: 'jackson-mgt',
    osType: 'WINDOWS',
  });
  const framework = await repository.createFrameworkInstance(tenantId, {
    deviceId: host.id,
    frameworkType: 'web.iis',
    frameworkKey: 'iis',
    discoveryProviderKey: 'agent:test',
    displayName: 'Microsoft IIS',
  });
  const site = await repository.createSiteAsset(tenantId, {
    frameworkInstanceId: framework.id,
    deviceId: host.id,
    discoveryProviderKey: 'agent:test',
    siteType: 'web.site',
    siteName: 'TEST',
    siteKey: 'iis:test:*:4433:',
    bindingInformation: '*:4433:',
    port: 4433,
    protocol: 'HTTPS',
  });
  const managedTarget = await repository.createManagedTarget(tenantId, {
    deviceId: host.id,
    frameworkInstanceId: framework.id,
    siteId: site.id,
    discoveryProviderKey: 'agent:test',
    targetType: 'tls.binding',
    targetKey: 'iis:test:*:4433:',
    bindingKey: '*:4433:',
    supportedCapabilities: ['certificate.deploy'],
    executionLocations: ['AGENT'],
  });
  const applicationAsset = await repository.createServiceAsset(tenantId, {
    address: 'cloud.jacksonz.cn',
    port: 4433,
    protocol: 'HTTPS',
    platform: 'WINDOWS',
  });
  await repository.createApplicationAssetTarget(tenantId, {
    applicationAssetId: applicationAsset.id,
    managedTargetId: managedTarget.id,
  });

  const result = await repository.listServiceAssets(tenantId, {
    page: 1,
    pageSize: 20,
    filter: { id: applicationAsset.id },
  });

  assert.equal(result.total, 1);
  assert.equal(result.items[0]?.targetBinding?.deviceDisplayName, 'jackson-mgt');
  assert.equal(result.items[0]?.targetBinding?.frameworkType, 'web.iis');
  assert.equal(result.items[0]?.targetBinding?.frameworkDisplayName, 'Microsoft IIS');
  assert.equal(result.items[0]?.targetBinding?.siteName, 'TEST');
});

test('应用资产部分更新保留验证 URL 并支持显式清空', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const repository = new PgAssetsRepository(database);
  const tenantId = 'tenant_application_asset_verify_url';
  const created = await repository.createServiceAsset(tenantId, {
    address: 'verify.example.com',
    port: 443,
    protocol: 'HTTPS',
    verifyUrl: 'https://verify.example.com/health',
  });

  const strategyUpdated = await repository.updateServiceAsset(tenantId, created.id, {
    deploymentStrategy: {
      type: 'MANAGED_TARGET',
      managedTarget: { managedTargetId: 'target_verify_url' },
    },
  });
  assert.equal(strategyUpdated.verifyUrl, 'https://verify.example.com/health');

  const cleared = await repository.updateServiceAsset(tenantId, created.id, { verifyUrl: '' });
  assert.equal(cleared.verifyUrl, undefined);
  assert.equal(cleared.metadata.verifyUrl, undefined);
});
