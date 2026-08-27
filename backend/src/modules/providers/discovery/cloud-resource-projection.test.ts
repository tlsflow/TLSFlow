import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { runMigrations } from '../../../database/migration-runner.js';
import { CloudResourceProjectionService } from './cloud-resource-projection.js';
import { CloudAccountAssetsApplicationService } from '../application/cloud-account-assets.application-service.js';

const resource = {
  apiVersion: 'gcac.cloud-service/v1',
  kind: 'CloudServiceResource',
  stableKey: 'cloud.aliyun:cdn.domain:resource-1',
  pluginId: 'cloud.aliyun',
  pluginVersionId: 'cloud.aliyun:2.0.1',
  provider: 'cloud.aliyun',
  resourceId: 'resource-1',
  resourceType: 'cdn.domain',
  region: 'cn-hangzhou',
  displayName: 'example.com',
  metadata: { domain: 'example.com' },
} as const;

function context(tenantId = 'tenant-projection', assetId = 'caa_projection') {
  return {
    tenantId,
    cloudAccountAssetId: assetId,
    pluginId: 'cloud.aliyun',
    pluginVersionId: 'cloud.aliyun:2.0.1',
    provider: 'cloud.aliyun',
    discoveryProviderKey: 'cloud.aliyun:2.0.1:discover',
    discoveredAt: '2026-08-16T00:00:00.000Z',
  } as const;
}

test('Cloud Resource 投影生成稳定设备、Framework/Site，重复投影保持相同 ID', () => {
  const service = new CloudResourceProjectionService();
  const first = service.project(context(), resource);
  const second = service.project(context(), { ...resource, displayName: 'changed display name' });
  assert.deepEqual(first.device!.metadata, {
    cloudAccountAssetId: 'caa_projection',
    provider: 'cloud.aliyun',
    region: 'cn-hangzhou',
    regionDisplayName: 'cn-hangzhou',
    scope: 'REGION',
    deviceCategory: 'CLOUD',
    livenessMode: 'DISCOVERY',
    pluginId: 'cloud.aliyun',
    pluginVersionId: 'cloud.aliyun:2.0.1',
  });
  assert.equal(first.framework.id, second.framework.id);
  assert.equal(first.site.id, second.site.id);
  assert.deepEqual(service.preview(context(), [resource]), { devices: 1, frameworks: 1, sites: 1 });
});

test('账号级 CDN 投影不创建伪设备，区域生成 Framework，实例生成 Site', () => {
  const service = new CloudResourceProjectionService();
  const projection = service.projectBatch({
    ...context(),
    topology: 'ACCOUNT_FRAMEWORK',
    providerDisplayName: '阿里云 CDN',
  }, [
    { ...resource, metadata: { cdnRegion: 'mainland', cdnRegionName: '中国大陆' } },
    {
      ...resource,
      stableKey: 'cloud.aliyun:cdn.domain:global.example',
      resourceId: 'global.example',
      displayName: 'global.example',
      region: 'global',
      metadata: { cdnRegion: 'global', cdnRegionName: '国际站' },
    },
  ]);
  assert.equal(projection.devices.length, 0);
  assert.deepEqual(projection.frameworks.map((item) => [item.frameworkKey, item.displayName]), [
    ['cdn.global', '阿里云 CDN · 国际站'],
    ['cdn.mainland', '阿里云 CDN · 中国大陆'],
  ]);
  assert.equal(projection.sites.length, 2);
  assert.ok(projection.sites.every((site) => site.deviceId === undefined));
  assert.deepEqual(service.preview({ ...context(), topology: 'ACCOUNT_FRAMEWORK' }, [resource]), { devices: 0, frameworks: 2, sites: 1 });
});

test('账号级 CDN 投影将历史全球文案规范化为国际站', () => {
  const projection = new CloudResourceProjectionService().projectBatch({
    ...context(),
    topology: 'ACCOUNT_FRAMEWORK',
    providerDisplayName: '阿里云 CDN',
  }, [{
    ...resource,
    region: 'global',
    metadata: { cdnRegion: 'global', cdnRegionName: '全球' },
  }]);
  assert.equal(projection.frameworks.find((item) => item.frameworkKey === 'cdn.global')?.displayName, '阿里云 CDN · 国际站');
});

test('账号级 CDN 即使没有域名也固定生成中国大陆和国际站 Framework', () => {
  const service = new CloudResourceProjectionService();
  const projection = service.projectBatch({
    ...context(),
    topology: 'ACCOUNT_FRAMEWORK',
    providerDisplayName: '阿里云 CDN',
  }, []);
  assert.equal(projection.devices.length, 0);
  assert.deepEqual(projection.frameworks.map((item) => [item.frameworkKey, item.displayName, item.versionText]), [
    ['cdn.global', '阿里云 CDN · 国际站', '0 resources'],
    ['cdn.mainland', '阿里云 CDN · 中国大陆', '0 resources'],
  ]);
  assert.equal(projection.sites.length, 0);
});

test('Cloud Resource provenance、stableKey 和跨租户资产边界失败关闭', async () => {
  const service = new CloudResourceProjectionService();
  assert.throws(() => service.project(context(), { ...resource, pluginVersionId: 'cloud.aliyun:2.0.2' }), /provenance/);
  assert.throws(() => service.project(context(), { ...resource, stableKey: 'cloud.aliyun:cdn.domain:other' }), /stableKey/);

  const db = new PgliteDatabase();
  await runMigrations(db);
  const assets = new CloudAccountAssetsApplicationService(db);
  await assets.create('tenant-projection-other', {
    displayName: '其他租户账号',
    providerKey: 'cloud.aliyun',
    accountId: 'account-other',
    credentialRef: 'credential://other',
  });
  await assert.rejects(
    () => new CloudResourceProjectionService(db).persist(context('tenant-projection', 'caa_missing'), resource),
    (error: unknown) => error instanceof Error && error.message.includes('不属于当前租户'),
  );
  await db.close();
});

test('同一云产品跨可用区投影为多个设备，每个设备拥有自己的 Framework 和 Site', () => {
  const service = new CloudResourceProjectionService();
  const second = {
    ...resource,
    stableKey: 'cloud.aliyun:cdn.domain:resource-2',
    resourceId: 'resource-2',
    region: 'cn-shanghai',
    displayName: 'example.cn',
  };
  const projection = service.projectBatch(context(), [resource, second]);
  assert.equal(projection.devices.length, 2);
  assert.equal(projection.frameworks.length, 2);
  assert.equal(projection.sites.length, 2);
  assert.notEqual(projection.frameworks[0]?.id, projection.frameworks[1]?.id);
  assert.notEqual(projection.sites[0]?.frameworkId, projection.sites[1]?.frameworkId);
  assert.deepEqual(service.preview(context(), [resource, second]), { devices: 2, frameworks: 2, sites: 2 });
});

test('区域资源只生成可用区设备，不把区域本身伪装成 Framework 或 Site', async () => {
  const service = new CloudResourceProjectionService();
  const regions = Array.from({ length: 32 }, (_, index) => `cn-test-${String(index).padStart(2, '0')}`);
  const resources = regions.map((region) => ({
    ...resource,
    stableKey: `cloud.aliyun:cloud.region:${region}`,
    resourceId: region,
    resourceType: 'cloud.region',
    region,
  }));
  const projection = service.projectBatch(context(), resources);
  assert.equal(projection.devices.length, 32);
  assert.equal(projection.frameworks.length, 0);
  assert.equal(projection.sites.length, 0);

  const db = new PgliteDatabase();
  await runMigrations(db);
  const assets = new CloudAccountAssetsApplicationService(db);
  const asset = await assets.create('tenant-projection', {
    displayName: '多区域投影账号',
    providerKey: 'cloud.aliyun',
    accountId: 'account-projection-regions',
    credentialRef: 'credential://projection-regions',
  });
  const persisted = await new CloudResourceProjectionService(db).persistBatch({ ...context('tenant-projection', asset.id) }, resources);
  assert.equal(persisted.devices.length, 32);
  const deviceCount = await db.query<{ count: number }>(
    `select count(*) as count from pg_device_assets where tenant_id=$1 and metadata->>'cloudAccountAssetId'=$2`,
    ['tenant-projection', asset.id],
  );
  assert.equal(Number(deviceCount.rows[0]?.count), 32);
  await db.close();
});

test('Projection persist 在真实迁移上按稳定 ID 幂等合并并保持 Asset 拓扑关系', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const assets = new CloudAccountAssetsApplicationService(db);
  const asset = await assets.create('tenant-projection', {
    displayName: '投影账号',
    providerKey: 'cloud.aliyun',
    accountId: 'account-projection',
    credentialRef: 'credential://projection',
  });
  const service = new CloudResourceProjectionService(db);
  const first = await service.persist({ ...context('tenant-projection', asset.id) }, resource);
  const second = await service.persist({ ...context('tenant-projection', asset.id) }, { ...resource, displayName: '更新后的域名' });
  assert.equal(first.framework.id, second.framework.id);
  const counts = await db.query<{ framework_count: number; site_count: number; target_count: number }>(
    `select
       (select count(*) from pg_framework_instances where id=$1) as framework_count,
       (select count(*) from pg_site_assets where id=$2) as site_count,
       (select count(*) from pg_managed_targets where asset_id=$3 and deleted_at is null) as target_count`,
    [first.framework.id, first.site.id, asset.id],
  );
  assert.deepEqual(counts.rows[0], { framework_count: 1, site_count: 1, target_count: 0 });
  const listed = await service.listForAsset('tenant-projection', asset.id);
  assert.equal(listed.frameworks.length, 1);
  assert.equal(listed.sites.length, 1);
  assert.equal(listed.sites[0]?.siteName, '更新后的域名');
  const topology = await db.query<{ framework_asset_id: string; site_asset_id: string }>(
    `select framework.asset_id as framework_asset_id, site.asset_id as site_asset_id
       from pg_framework_instances framework
       join pg_site_assets site on site.framework_instance_id=framework.id
      where framework.id=$1`,
    [first.framework.id],
  );
  assert.deepEqual(topology.rows[0], {
    framework_asset_id: asset.id,
    site_asset_id: asset.id,
  });
  await db.close();
});

test('Projection batch persist 重复发现保持单 Framework、多 Site 且不创建 ManagedTarget', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const assets = new CloudAccountAssetsApplicationService(db);
  const asset = await assets.create('tenant-projection', {
    displayName: '批量投影账号',
    providerKey: 'cloud.aliyun',
    accountId: 'account-projection-batch',
    credentialRef: 'credential://projection-batch',
  });
  const second = {
    ...resource,
    stableKey: 'cloud.aliyun:cdn.domain:resource-2',
    resourceId: 'resource-2',
    displayName: 'example.cn',
  };
  const service = new CloudResourceProjectionService(db);
  const first = await service.persistBatch({ ...context('tenant-projection', asset.id) }, [resource, second]);
  await service.persistBatch({ ...context('tenant-projection', asset.id) }, [resource, second]);
  const counts = await db.query<{ framework_count: number; site_count: number; target_count: number }>(
    `select
       (select count(*) from pg_framework_instances where asset_id=$1 and deleted_at is null) as framework_count,
       (select count(*) from pg_site_assets where asset_id=$1 and deleted_at is null) as site_count,
       (select count(*) from pg_managed_targets where asset_id=$1 and deleted_at is null) as target_count`,
    [asset.id],
  );
  assert.deepEqual(counts.rows[0], { framework_count: 1, site_count: 2, target_count: 0 });
  assert.equal(first.devices.length, 1);
  assert.equal(first.frameworks[0]?.id, first.sites[0]?.frameworkId);
  const deviceTopology = await db.query<{ device_id: string; framework_device_id: string; site_device_id: string }>(
    `select device.id as device_id, framework.device_id as framework_device_id, site.device_id as site_device_id
       from pg_hosts device
       join pg_framework_instances framework on framework.device_id=device.id and framework.deleted_at is null
       join pg_site_assets site on site.device_id=device.id and site.framework_instance_id=framework.id and site.deleted_at is null
      where device.id=$1`,
    [first.devices[0]?.hostId],
  );
  assert.deepEqual(deviceTopology.rows[0], {
    device_id: first.devices[0]?.hostId,
    framework_device_id: first.devices[0]?.hostId,
    site_device_id: first.devices[0]?.hostId,
  });
  await db.close();
});
