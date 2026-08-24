import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgUnifiedPluginsRepository } from './repository/unified-plugins.repository.js';
import { UnifiedPluginsApplicationService } from './application/unified-plugins.application-service.js';
import { StandardDeviceDiscoveryProjector } from './discovery/standard-device-discovery.projector.js';

test('标准发现投影事务化、幂等并把缺失对象标记为 STALE', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, undefined, { appliedBy: 'test', checksum: (content) => createHash('sha256').update(content).digest('hex') });
  const plugin = await new UnifiedPluginsApplicationService(new PgUnifiedPluginsRepository(db)).importVersion('tenant-1', {
    manifest: {
      apiVersion: 'gcac.plugin-manifest/v1', kind: 'GcacPlugin', pluginId: 'test.mock.device', version: '1.0.0',
      displayNameKey: 'plugin.test.name', publisher: 'test', runtime: 'WORKFLOW_DSL', source: 'USER', scope: 'BOTH',
      trust: 'UNSIGNED', support: 'SELF_MANAGED', permissions: [],
      capabilities: [{ key: 'device.discover', contractVersion: 'v1', actionContractId: 'device.discover.v1', riskLevel: 'LOW', executionLocations: ['CONTROL_PLANE'] }],
      resources: { workflows: { 'device.discover': 'workflows/discover.json' } },
    },
    resources: { 'workflows/discover.json': '{}' },
  });
  await db.query(`insert into pg_hosts (id, tenant_id, hostname, os_type, discovery_source, compatibility_level, management_mode, status)
    values ('host-1','tenant-1','mock.example','NETWORK_DEVICE','MANUAL','L1','AGENTLESS','ACTIVE')`);
  await db.query(`insert into pg_service_assets (id, tenant_id, address, address_type, port, protocol, display_name, host_id, discovery_source, status, asset_kind)
    values ('device-1','tenant-1','192.0.2.20','IPV4',443,'HTTPS','Mock Device','host-1','MANUAL','ACTIVE','DEVICE')`);
  await db.query(`insert into pg_device_assets (service_asset_id, tenant_id, device_family, credential_id)
    values ('device-1','tenant-1','MOCK_DEVICE','secret://credential/mock')`);

  const fixture = JSON.parse(await readFile(new URL('../../../../compatibility/fixtures/device-plugins/mock-adc.discovery.json', import.meta.url), 'utf8'));
  const projector = new StandardDeviceDiscoveryProjector(db);
  const context = { tenantId: 'tenant-1', deviceAssetId: 'device-1', hostId: 'host-1', pluginVersionId: plugin.id };
  const first = await projector.project(context, fixture);
  const second = await projector.project(context, fixture);
  assert.deepEqual(second, first);
  assert.equal((await db.query<{ count: string }>("select count(*)::text as count from pg_site_assets where status='ACTIVE'")).rows[0]?.count, '1');
  assert.equal((await db.query<{ count: string }>('select count(*)::text as count from plugin_discovery_snapshots')).rows[0]?.count, '2');

  const withoutSites = { ...fixture, sites: [], certificates: [], certificateBindings: [] };
  await projector.project(context, withoutSites);
  assert.equal((await db.query<{ status: string }>('select status from pg_site_assets limit 1')).rows[0]?.status, 'STALE');
  assert.equal((await db.query<{ status: string }>('select status from pg_managed_targets limit 1')).rows[0]?.status, 'STALE');
});

test('非法发现关系不会污染上次成功投影', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, undefined, { appliedBy: 'test', checksum: (content) => createHash('sha256').update(content).digest('hex') });
  const projector = new StandardDeviceDiscoveryProjector(db);
  await assert.rejects(() => projector.preview({
    tenantId: 'tenant-1', deviceAssetId: 'device-1', hostId: 'host-1', pluginVersionId: 'plugin-1',
  }, {
    apiVersion: 'gcac.device-discovery/v1', device: { stableKey: 'device:1', displayName: 'Device', productFamily: 'Mock' },
    capabilities: [], frameworks: [], sites: [], certificates: [],
    certificateBindings: [{ stableKey: 'binding:1', siteStableKey: 'missing', certificateStableKey: 'missing' }], warnings: [],
  }));
});
