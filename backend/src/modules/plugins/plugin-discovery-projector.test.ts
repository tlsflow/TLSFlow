import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgUnifiedPluginsRepository } from './repository/unified-plugins.repository.js';
import { UnifiedPluginsApplicationService } from './application/unified-plugins.application-service.js';
import { StandardDeviceDiscoveryProjector } from './discovery/standard-device-discovery.projector.js';
import { PgDevicesRepository } from '../devices/repository/devices.repository.js';

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
  await db.query(`insert into pg_device_assets (service_asset_id, tenant_id, device_family, credential_id, host_id)
    values ('device-1','tenant-1','MOCK_DEVICE','secret://credential/mock','host-1')`);
  await db.query(`insert into pg_certificate_assets (
      id, name, primary_domain, source_type, status, created_by
    ) values ('certificate-asset-1','example.test','example.test','imported','active','test')`);
  await db.query(`insert into pg_certificate_versions (
      id, certificate_asset_id, version_no, common_name, issuer, subject, serial_number,
      not_before, not_after, fingerprint_sha256, public_key_algorithm, signature_algorithm,
      leaf_storage_ref, chain_status, source_type, status, created_by
    ) values (
      'certificate-version-1','certificate-asset-1',1,'example.test','{}'::jsonb,'{}'::jsonb,'01',
      '2026-01-01T00:00:00Z','2027-01-01T00:00:00Z',$1,'RSA','SHA256-RSA',
      'secret://certificate/test','complete','imported','active','test'
    )`, ['a'.repeat(64)]);

  const fixture = JSON.parse(await readFile(new URL('../../../../compatibility/fixtures/device-plugins/mock-adc.discovery.json', import.meta.url), 'utf8'));
  const longSoftwareVersion = 'NetScaler NS14.1: Build 43.50.nc, Date: Jul 1 2026';
  fixture.device.softwareVersion = longSoftwareVersion;
  const projector = new StandardDeviceDiscoveryProjector(db);
  const context = { tenantId: 'tenant-1', deviceAssetId: 'device-1', hostId: 'host-1', pluginVersionId: plugin.id };
  const first = await projector.project(context, fixture);
  const second = await projector.project(context, fixture);
  assert.deepEqual(second, first);
  assert.equal((await db.query<{ count: string }>("select count(*)::text as count from pg_site_assets where status='ACTIVE'")).rows[0]?.count, '1');
  assert.equal((await db.query<{ count: string }>('select count(*)::text as count from plugin_discovery_snapshots')).rows[0]?.count, '2');
  assert.equal((await db.query<{ software_version: string }>('select software_version from pg_device_assets where service_asset_id=$1', ['device-1'])).rows[0]?.software_version, longSoftwareVersion);
  const detail = await new PgDevicesRepository(db).get('tenant-1', 'host-1');
  assert.equal(detail?.productFamily, 'Mock ADC');
  assert.equal(detail?.frameworks.length, 1, '详情必须返回最新发现框架');
  assert.equal(detail?.sites.length, 1, '详情必须返回标准投影站点');
  assert.equal(detail?.certificates.length, 1, '详情必须返回标准发现证书');
  assert.equal(detail?.certificates[0]?.certificateAssetId, 'certificate-asset-1');
  assert.equal(detail?.certificates[0]?.certificateVersionId, 'certificate-version-1');
  assert.equal(detail?.sites[0]?.bindings[0]?.certificate?.certificateVersionId, 'certificate-version-1');
  const formalBinding = (await db.query<{
    binding_type: string;
    binding_key: string;
    managed_target_id: string | null;
    metadata: Record<string, unknown>;
  }>('select binding_type, binding_key, managed_target_id, metadata from pg_certificate_bindings limit 1')).rows[0];
  assert.equal(formalBinding?.binding_type, 'DEVICE_API');
  assert.ok(formalBinding?.binding_key);
  assert.ok(formalBinding?.managed_target_id);
  assert.equal(formalBinding?.metadata.pluginDiscoveryStableKey, formalBinding?.binding_key);
  assert.equal((await db.query<{ certificate_version_id: string | null }>('select certificate_version_id from plugin_discovered_certificates limit 1')).rows[0]?.certificate_version_id, 'certificate-version-1');
  const discoveredBinding = (await db.query<{ current_certificate_version_id: string | null; observed_fingerprint_sha256: string | null }>('select current_certificate_version_id, observed_fingerprint_sha256 from plugin_discovered_certificate_bindings limit 1')).rows[0];
  assert.equal(discoveredBinding?.current_certificate_version_id, 'certificate-version-1');
  assert.equal(discoveredBinding?.observed_fingerprint_sha256, 'A'.repeat(64));

  const withoutSites = { ...fixture, sites: [], managedTargets: [], certificates: [], certificateBindings: [] };
  await projector.project(context, withoutSites);
  assert.equal((await db.query<{ status: string }>('select status from pg_site_assets limit 1')).rows[0]?.status, 'STALE');
  assert.equal((await db.query<{ status: string }>('select status from pg_managed_targets limit 1')).rows[0]?.status, 'STALE');
  assert.equal((await db.query<{ discovery_status: string }>("select metadata->>'discoveryStatus' as discovery_status from pg_certificate_bindings limit 1")).rows[0]?.discovery_status, 'STALE');
});

test('非法发现关系不会污染上次成功投影', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, undefined, { appliedBy: 'test', checksum: (content) => createHash('sha256').update(content).digest('hex') });
  const projector = new StandardDeviceDiscoveryProjector(db);
  await assert.rejects(() => projector.preview({
    tenantId: 'tenant-1', deviceAssetId: 'device-1', hostId: 'host-1', pluginVersionId: 'plugin-1',
  }, {
    apiVersion: 'gcac.device-discovery/v2', device: { stableKey: 'device:1', displayName: 'Device', productFamily: 'Mock' },
    capabilities: [], frameworks: [], sites: [], managedTargets: [], certificates: [],
    certificateBindings: [{ stableKey: 'binding:1', managedTargetStableKey: 'missing', certificateStableKey: 'missing' }], warnings: [],
  }));
});
