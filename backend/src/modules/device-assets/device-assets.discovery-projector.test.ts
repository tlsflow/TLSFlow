import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { DeviceAssetsDiscoveryProjector } from './application/device-assets.discovery-projector.js';
import { DeviceAssetsApplicationService } from './application/device-assets.application-service.js';
import { PgDeviceAssetsRepository } from './repository/device-assets.repository.js';
import { AssetsApplicationService } from '../assets/application/assets.application-service.js';
import { PgAssetsRepository } from '../assets/repository/assets.repository.js';
import type { NetscalerDiscoveryResult } from '../providers/netscaler/netscaler-nitro.discovery.js';

test('重复发现幂等更新，保留目标证书选择并标记消失对象', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');
  const service = new DeviceAssetsApplicationService(new PgDeviceAssetsRepository(db));
  const device = await service.create('tenant-a', { displayName: 'ADC', managementAddress: '10.0.0.10', deviceFamily: 'NETSCALER_ADC', credentialId: 'secret' });
  const projector = new DeviceAssetsDiscoveryProjector(db);
  await projector.project('tenant-a', device.id, discovery(['vs-a', 'vs-b']));

  const binding = await db.query<{ id: string }>(`select id from pg_device_certificate_bindings where device_asset_id=$1 and deleted_at is null`, [device.id]);
  await db.query(`update pg_device_certificate_bindings set desired_certificate_version_id='cv_target', desired_fingerprint_sha256='desired' where id=$1`, [binding.rows[0].id]);
  await projector.project('tenant-a', device.id, discovery(['vs-a']));

  const virtualServers = await db.query<{ virtual_server_name: string; status: string }>(`select virtual_server_name,status from pg_device_virtual_servers where device_asset_id=$1 order by virtual_server_name`, [device.id]);
  const certificates = await db.query<{ count: number; fingerprint_sha256: string }>(
    `select count(*)::int as count, max(fingerprint_sha256) as fingerprint_sha256
     from pg_device_certificate_resources where device_asset_id=$1 and deleted_at is null`,
    [device.id],
  );
  const bindings = await db.query<{ count: number; desired_certificate_version_id: string; desired_fingerprint_sha256: string }>(
    `select count(*)::int as count, max(desired_certificate_version_id) as desired_certificate_version_id,
      max(desired_fingerprint_sha256) as desired_fingerprint_sha256 from pg_device_certificate_bindings where device_asset_id=$1 and deleted_at is null`, [device.id],
  );
  assert.deepEqual(virtualServers.rows, [{ virtual_server_name: 'vs-a', status: 'ACTIVE' }, { virtual_server_name: 'vs-b', status: 'STALE' }]);
  assert.equal(certificates.rows[0].count, 1);
  assert.equal(certificates.rows[0].fingerprint_sha256, 'a'.repeat(64));
  assert.equal(bindings.rows[0].count, 1);
  assert.equal(bindings.rows[0].desired_certificate_version_id, 'cv_target');
  assert.equal(bindings.rows[0].desired_fingerprint_sha256, 'desired');
});

test('Spec033.1 将 LB/VPN Virtual Server 投影为可选站点和受管目标但不自动创建应用资产', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');
  const device = await new DeviceAssetsApplicationService(new PgDeviceAssetsRepository(db)).create('tenant-projection', {
    displayName: 'ADC Projection', managementAddress: '10.0.0.49', deviceFamily: 'NETSCALER_ADC', credentialId: 'secret',
  });
  const projector = new DeviceAssetsDiscoveryProjector(db);
  const input = discovery(['lb-app']);
  input.virtualServers.push({ type: 'VPN', name: 'vpn-app', address: '10.0.0.2', port: 443, sniNames: ['vpn.example.test'], sourceVersion: '14.1', rawSummary: {} });
  input.bindings.push({ virtualServerType: 'VPN', virtualServerName: 'vpn-app', certKeyName: 'cert-a', sniCertificate: false, sourceVersion: '14.1', rawSummary: {} });
  await projector.project('tenant-projection', device.id, input);

  const assetsRepository = new PgAssetsRepository(db);
  const discoveredSites = await assetsRepository.listSiteAssets('tenant-projection', {
    page: 1,
    pageSize: 20,
    filter: { siteName: 'lb-app' },
  });
  const manualAsset = await new AssetsApplicationService(assetsRepository).createServiceAsset('tenant-projection', {
    address: '10.0.0.1',
    port: 443,
    protocol: 'HTTPS',
    platform: 'APPLIANCE',
    displayName: '人工应用资产',
    discoverySource: 'MANUAL',
    status: 'ACTIVE',
    siteAssetId: discoveredSites.items[0]?.id,
    metadata: {},
  });
  await projector.project('tenant-projection', device.id, input);

  const assets = await assetsRepository.listServiceAssets('tenant-projection', { page: 1, pageSize: 20, filter: {} });
  const serviceInstances = await db.query<{ count: number }>(`select count(*)::int as count from pg_service_instances where tenant_id=$1 and deleted_at is null`, ['tenant-projection']);
  const sites = await db.query<{ service_asset_id: string | null; status: string }>(`select service_asset_id,status from pg_site_assets where tenant_id=$1 order by id`, ['tenant-projection']);
  const targets = await db.query<{ device_asset_id: string; service_asset_id: string | null; status: string }>(`select device_asset_id,service_asset_id,status from pg_managed_targets where tenant_id=$1 order by id`, ['tenant-projection']);
  const applicationTargets = await db.query<{ count: number; application_asset_id: string }>(`select count(*)::int as count, max(application_asset_id) as application_asset_id from pg_application_asset_targets where tenant_id=$1 and deleted_at is null`, ['tenant-projection']);
  const bindings = await db.query<{ count: number; linked_assets: number }>(`select count(*)::int as count, count(service_asset_id)::int as linked_assets from pg_certificate_bindings where tenant_id=$1 and deleted_at is null`, ['tenant-projection']);

  assert.equal(assets.total, 1);
  assert.equal(assets.items[0]?.id, manualAsset.id);
  assert.equal(assets.items[0]?.displayName, '人工应用资产');
  assert.equal(assets.items[0]?.status, 'ACTIVE');
  assert.equal(serviceInstances.rows[0]?.count, 1);
  assert.equal(sites.rows.length, 2);
  assert.ok(sites.rows.every((item) => item.service_asset_id === null && item.status === 'ACTIVE'));
  assert.equal(targets.rows.length, 2);
  assert.ok(targets.rows.every((item) => item.device_asset_id === device.id && item.service_asset_id === null && item.status === 'ACTIVE'));
  assert.equal(applicationTargets.rows[0]?.count, 1);
  assert.equal(applicationTargets.rows[0]?.application_asset_id, manualAsset.id);
  assert.equal(bindings.rows[0].count, 2);
  assert.equal(bindings.rows[0].linked_assets, 0);
  assert.ok(!assets.items.some((item) => item.id === device.id));
});

test('发现失败写回设备错误码供统一健康状态投影', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');
  const device = await new DeviceAssetsApplicationService(new PgDeviceAssetsRepository(db)).create('tenant-failure', {
    displayName: 'ADC Failure', managementAddress: '10.0.0.50', deviceFamily: 'NETSCALER_ADC', credentialId: 'secret',
  });

  await new DeviceAssetsDiscoveryProjector(db).projectFailure('tenant-failure', device.id, 'NETSCALER_UNREACHABLE');
  const row = await db.query<{ last_error_code: string }>(
    `select last_error_code from pg_device_assets where tenant_id=$1 and service_asset_id=$2`,
    ['tenant-failure', device.id],
  );
  assert.equal(row.rows[0]?.last_error_code, 'NETSCALER_UNREACHABLE');
});

function discovery(names: string[]): NetscalerDiscoveryResult {
  return {
    version: { major: 14, minor: 1, normalized: '14.1', raw: 'NS14.1', build: '21.57.nc' },
    capabilityProfile: {
      supportTier: 'SUPPORTED', auth: { session: true, perRequestHeaders: true },
      discovery: { sslCertKey: true, lbVirtualServer: true, csVirtualServer: true, vpnVirtualServer: true, gslbVirtualServer: true, sslBindings: true },
      deployment: { systemFileUpload: true, updateSslCertKey: true, addSslCertKey: true, bindSslCertKey: true, unbindSslCertKey: true, saveConfig: true },
      fieldMappingVersion: '14.1', limitations: [],
    },
    device: { productName: 'NetScaler ADC', softwareVersion: 'NS14.1', softwareBuild: '21.57.nc', rawSummary: {} },
    virtualServers: names.map((name) => ({ type: 'LB', name, address: '10.0.0.1', port: 443, sniNames: [], sourceVersion: '14.1', rawSummary: {} })),
    certificates: [{ certKeyName: 'cert-a', certificatePath: '/nsconfig/ssl/cert.pem', fingerprintSha256: 'a'.repeat(64), sourceVersion: '14.1', rawFieldSummary: {} }],
    bindings: names.slice(0, 1).map((name) => ({ virtualServerType: 'LB', virtualServerName: name, certKeyName: 'cert-a', sniCertificate: false, sourceVersion: '14.1', rawSummary: {} })),
    certKeyUsage: {}, warnings: [],
  };
}
