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

test('Cloud Resource 投影只生成稳定 Framework/Site，重复投影保持相同 ID', () => {
  const service = new CloudResourceProjectionService();
  const first = service.project(context(), resource);
  const second = service.project(context(), { ...resource, displayName: 'changed display name' });
  assert.equal(first.framework.id, second.framework.id);
  assert.equal(first.site.id, second.site.id);
  assert.deepEqual(service.preview(context(), [resource]), { frameworks: 1, sites: 1 });
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
