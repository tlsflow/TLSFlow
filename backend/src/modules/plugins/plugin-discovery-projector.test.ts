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
      apiVersion: 'gcac.plugin-manifest/v1', kind: 'GcacPlugin', pluginId: 'device.citrix.netscaler-adc', version: '1.0.0',
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
      id, tenant_id, name, primary_domain, source_type, status, created_by
    ) values ('certificate-asset-1','tenant-1','example.test','example.test','imported','active','test')`);
  await db.query(`insert into pg_certificate_versions (
      id, tenant_id, certificate_asset_id, version_no, common_name, issuer, subject, serial_number,
      not_before, not_after, fingerprint_sha256, public_key_algorithm, signature_algorithm,
      leaf_storage_ref, chain_status, source_type, status, created_by
    ) values (
      'certificate-version-1','tenant-1','certificate-asset-1',1,'example.test','{}'::jsonb,'{}'::jsonb,'01',
      '2026-01-01T00:00:00Z','2027-01-01T00:00:00Z',$1,'RSA','SHA256-RSA',
      'secret://certificate/test','complete','imported','active','test'
    )`, ['a'.repeat(64)]);

  const fixture = JSON.parse(await readFile(new URL('../../../../compatibility/fixtures/device-plugins/mock-adc.discovery.json', import.meta.url), 'utf8'));
  const longSoftwareVersion = 'NetScaler NS14.1: Build 43.50.nc, Date: Jul 1 2026';
  fixture.device.softwareVersion = longSoftwareVersion;
  const projector = new StandardDeviceDiscoveryProjector(db);
  const context = { tenantId: 'tenant-1', deviceAssetId: 'device-1', hostId: 'host-1', pluginVersionId: plugin.id };
  const first = await projector.project(context, fixture);
  const versionAfterFirstProjection = (await db.query<{ version: number }>(
    'select version from pg_framework_instances where tenant_id=$1 and device_id=$2',
    ['tenant-1', 'host-1'],
  )).rows[0]?.version;
  const second = await projector.project(context, fixture);
  assert.deepEqual(second, first);
  assert.equal((await db.query<{ count: string }>("select count(*)::text as count from pg_site_assets where status='ACTIVE'")).rows[0]?.count, '1');
  assert.equal((await db.query<{ count: string }>('select count(*)::text as count from plugin_discovery_snapshots')).rows[0]?.count, '1');
  assert.equal((await db.query<{ version: number }>('select version from pg_framework_instances where tenant_id=$1 and device_id=$2', ['tenant-1', 'host-1'])).rows[0]?.version, versionAfterFirstProjection);
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
  assert.equal(discoveredBinding?.observed_fingerprint_sha256, null);

  const withoutSites = { ...fixture, sites: [], managedTargets: [], certificates: [], certificateBindings: [] };
  await projector.project(context, withoutSites);
  assert.equal((await db.query<{ status: string }>('select status from pg_site_assets limit 1')).rows[0]?.status, 'STALE');
  assert.equal((await db.query<{ status: string }>('select status from pg_managed_targets limit 1')).rows[0]?.status, 'STALE');
  assert.equal((await db.query<{ discovery_status: string }>("select metadata->>'discoveryStatus' as discovery_status from pg_certificate_bindings limit 1")).rows[0]?.discovery_status, 'STALE');
});

test('设备证书没有指纹时按唯一公开元数据关联项目证书版本', async () => {
  const { db, context, discovery } = await createCertificateIdentityFixture(false);
  await new StandardDeviceDiscoveryProjector(db).project(context, discovery);

  const detail = await new PgDevicesRepository(db).get(context.tenantId, context.hostId);
  assert.equal(detail?.certificates[0]?.certificateVersionId, 'certificate-version-dsm');
  assert.equal(detail?.sites[0]?.bindings[0]?.certificate?.certificateVersionId, 'certificate-version-dsm');
  assert.equal((await db.query<{ current_certificate_version_id: string | null; drift_state: string }>(
    'select current_certificate_version_id, drift_state from plugin_discovered_certificate_bindings limit 1',
  )).rows[0]?.current_certificate_version_id, 'certificate-version-dsm');
  assert.equal((await db.query<{ drift_state: string }>(
    'select drift_state from plugin_discovered_certificate_bindings limit 1',
  )).rows[0]?.drift_state, 'UNKNOWN', '没有设备返回指纹时不能伪造 SYNCED');
});

test('设备证书元数据命中多个项目版本时拒绝关联', async () => {
  const { db, context, discovery } = await createCertificateIdentityFixture(true);
  await new StandardDeviceDiscoveryProjector(db).project(context, discovery);

  const discovered = (await db.query<{ certificate_version_id: string | null }>(
    'select certificate_version_id from plugin_discovered_certificates limit 1',
  )).rows[0];
  const formal = (await db.query<{ certificate_version_id: string | null }>(
    'select certificate_version_id from pg_certificate_bindings limit 1',
  )).rows[0];
  assert.equal(discovered?.certificate_version_id, null);
  assert.equal(formal?.certificate_version_id, null);
});

async function createCertificateIdentityFixture(duplicate: boolean) {
  const db = new PgliteDatabase();
  await runMigrations(db, undefined, { appliedBy: 'test', checksum: (content) => createHash('sha256').update(content).digest('hex') });
  const tenantId = 'tenant-dsm-identity';
  const hostId = 'host-dsm-identity';
  const deviceAssetId = 'device-dsm-identity';
  await db.query(`insert into pg_hosts (id, tenant_id, hostname, os_type, discovery_source, compatibility_level, management_mode, status)
    values ($1,$2,'dsm.example','NETWORK_DEVICE','MANUAL','L1','AGENTLESS','ACTIVE')`, [hostId, tenantId]);
  await db.query(`insert into pg_service_assets (id, tenant_id, address, address_type, port, protocol, display_name, host_id, discovery_source, status, asset_kind)
    values ($1,$2,'10.255.0.77','IPV4',5000,'HTTP','DSM','${hostId}','MANUAL','ACTIVE','DEVICE')`, [deviceAssetId, tenantId]);
  await db.query(`insert into pg_device_assets (service_asset_id, tenant_id, device_family, credential_id, host_id)
    values ($1,$2,'NETWORK_APPLIANCE','secret://dsm','${hostId}')`, [deviceAssetId, tenantId]);
  await db.query(`insert into pg_certificate_assets (id, tenant_id, name, primary_domain, source_type, status, created_by)
    values ('certificate-asset-dsm-1',$1,'DSM certificate','*.jacksonz.cn','IMPORTED','ACTIVE','test'),
           ('certificate-asset-dsm-2',$1,'DSM duplicate','duplicate.jacksonz.cn','IMPORTED','ACTIVE','test')`, [tenantId]);
  await db.query(`insert into pg_certificate_versions (
      id, tenant_id, certificate_asset_id, version_no, common_name, issuer, subject, serial_number,
      not_before, not_after, fingerprint_sha256, public_key_algorithm, signature_algorithm,
      leaf_storage_ref, chain_status, source_type, status, created_by
    ) values (
      'certificate-version-dsm','${tenantId}','certificate-asset-dsm-1',1,'*.jacksonz.cn',
      '{"commonName":"YR1"}'::jsonb,'{"commonName":"*.jacksonz.cn"}'::jsonb,'01',
      '2025-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',$1,'RSA','SHA256-RSA',
      'secret://certificate/dsm','COMPLETE','IMPORTED','ACTIVE','test'
    )`, ['a'.repeat(64)]);
  if (duplicate) await db.query(`insert into pg_certificate_versions (
      id, tenant_id, certificate_asset_id, version_no, common_name, issuer, subject, serial_number,
      not_before, not_after, fingerprint_sha256, public_key_algorithm, signature_algorithm,
      leaf_storage_ref, chain_status, source_type, status, created_by
    ) values (
      'certificate-version-dsm-duplicate','${tenantId}','certificate-asset-dsm-2',1,'*.jacksonz.cn',
      '{"commonName":"YR1"}'::jsonb,'{"commonName":"*.jacksonz.cn"}'::jsonb,'02',
      '2025-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',$1,'RSA','SHA256-RSA',
      'secret://certificate/dsm-duplicate','COMPLETE','IMPORTED','ACTIVE','test'
    )`, ['b'.repeat(64)]);
  return {
    db,
    context: {
      tenantId,
      deviceAssetId,
      hostId,
      discoveryProviderKey: 'agent:dsm-identity',
      discoverySource: 'AGENT' as const,
    },
    discovery: {
      apiVersion: 'gcac.device-discovery/v2' as const,
      device: { stableKey: 'synology-dsm:10.255.0.77', displayName: 'DSM', productFamily: 'device.synology-dsm', managementAddress: '10.255.0.77' },
      capabilities: [],
      frameworks: [{ stableKey: 'framework:synology-dsm', frameworkType: 'synology.dsm-web', displayName: 'Synology' }],
      sites: [{ stableKey: 'DSM:Default', frameworkStableKey: 'framework:synology-dsm', siteType: 'device.service', displayName: 'Default', addresses: ['10.255.0.77'], protocol: 'HTTP', metadata: { serviceKey: 'default' } }],
      managedTargets: [{ stableKey: 'TARGET:DSM:Default', frameworkStableKey: 'framework:synology-dsm', siteStableKey: 'DSM:Default', targetType: 'tls.binding', targetKey: 'Default', supportedCapabilities: ['certificate.deploy'], executionLocations: ['CONTROL_PLANE'] }],
      certificates: [{ stableKey: 'CERT:502aVL', subject: 'CN=*.jacksonz.cn', issuer: 'CN=YR1', notBefore: '2025-01-01T00:00:00.000Z', notAfter: '2026-01-01T00:00:00.000Z' }],
      certificateBindings: [{ stableKey: 'BINDING:DSM:Default:502aVL', managedTargetStableKey: 'TARGET:DSM:Default', certificateStableKey: 'CERT:502aVL', bindingName: 'DSM Desktop Service' }],
      warnings: [],
    },
  };
}

test('标准发现重建稳定键后会释放旧的非托管证书绑定唯一键', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, undefined, { appliedBy: 'test', checksum: (content) => createHash('sha256').update(content).digest('hex') });
  await db.query(`insert into pg_hosts (id, tenant_id, hostname, os_type, discovery_source, compatibility_level, management_mode, status)
    values ('host-binding-rebuild','tenant-binding-rebuild','iis.example','WINDOWS','AGENT','L1','AGENT','ACTIVE')`);

  const projector = new StandardDeviceDiscoveryProjector(db);
  const context = {
    tenantId: 'tenant-binding-rebuild',
    hostId: 'host-binding-rebuild',
    discoveryProviderKey: 'agent:binding-rebuild',
    discoverySource: 'AGENT' as const,
  };
  const first = windowsStoreDiscovery('site:v1', 'target:v1', 'binding:v1');
  await projector.project(context, first);

  const second = windowsStoreDiscovery('site:v2', 'target:v2', 'binding:v2');
  await projector.project(context, second);

  const rows = (await db.query<{
    id: string;
    deleted_at: string | null;
    discovery_status: string | null;
    local_config_fingerprint: string | null;
  }>(`select id, deleted_at, metadata->>'discoveryStatus' as discovery_status
             , local_config_fingerprint
      from pg_certificate_bindings
      where tenant_id=$1
      order by created_at`, [context.tenantId])).rows;
  assert.equal(rows.length, 2);
  assert.ok(rows[0]?.deleted_at, '旧的非托管发现绑定必须释放唯一索引占位');
  assert.equal(rows[0]?.discovery_status, 'STALE');
  assert.equal(rows[1]?.deleted_at, null);
  assert.equal(rows[1]?.local_config_fingerprint, 'C'.repeat(64));
  assert.equal(rows[1]?.discovery_status, 'ACTIVE');
  const site = (await db.query<{ binding_information: string | null }>(
    `select binding_information
       from pg_site_assets
      where tenant_id=$1 and status='ACTIVE'`,
    [context.tenantId],
  )).rows[0];
  assert.equal(site?.binding_information, '*:443:rds.example.test');
  const target = (await db.query<{ certificate_location: Record<string, unknown> }>(
    `select metadata->'certificateLocation' as certificate_location
       from pg_managed_targets
      where tenant_id=$1 and status='ACTIVE'`,
    [context.tenantId],
  )).rows[0]?.certificate_location;
  assert.equal(target?.serviceName, 'Apache-Test');
  assert.equal(target?.programPath, 'C:/Apache24/bin/httpd.exe');
  assert.equal(target?.configFingerprint, 'C'.repeat(64));
});

function windowsStoreDiscovery(siteStableKey: string, targetStableKey: string, bindingStableKey: string) {
  return {
    apiVersion: 'gcac.device-discovery/v2' as const,
    device: { stableKey: `device:${siteStableKey}`, displayName: 'IIS', productFamily: 'AGENT_HOST' },
    capabilities: [],
    frameworks: [{ stableKey: 'framework:iis', frameworkType: 'web.iis', displayName: 'IIS' }],
    sites: [{
      stableKey: siteStableKey,
      frameworkStableKey: 'framework:iis',
      siteType: 'web.site',
      displayName: 'Default Web Site',
      addresses: ['rds.example.test'],
      port: 443,
      protocol: 'HTTPS',
      metadata: { listeners: [{ protocol: 'HTTPS', bindingInformation: '*:443:rds.example.test', host: 'rds.example.test', port: 443 }] },
    }],
    managedTargets: [{
      stableKey: targetStableKey,
      frameworkStableKey: 'framework:iis',
      siteStableKey,
      targetType: 'tls.binding',
      targetKey: `rds.example.test:443:${targetStableKey}`,
      supportedCapabilities: ['certificate.deploy'],
      executionLocations: ['AGENT' as const],
      metadata: {
        certificateLocation: {
          storageKind: 'WINDOWS_CERTIFICATE_STORE',
          storeName: 'My',
          storeLocation: 'LocalMachine',
          storeThumbprint: 'B'.repeat(40),
          serviceName: 'Apache-Test',
          programPath: 'C:/Apache24/bin/httpd.exe',
          configFingerprint: 'C'.repeat(64),
        },
      },
    }],
    certificates: [{
      stableKey: 'certificate:iis',
      sha256Fingerprint: 'A'.repeat(64),
      subject: 'CN=rds.example.test',
      issuer: 'CN=Test CA',
      notBefore: '2026-01-01T00:00:00Z',
      notAfter: '2027-01-01T00:00:00Z',
    }],
    certificateBindings: [{
      stableKey: bindingStableKey,
      managedTargetStableKey: targetStableKey,
      certificateStableKey: 'certificate:iis',
      deploymentTarget: {
        storageKind: 'WINDOWS_CERTIFICATE_STORE' as const,
        storeName: 'My',
        storeLocation: 'LocalMachine',
        storeThumbprint: 'B'.repeat(40),
        serviceName: 'Apache-Test',
        programPath: 'C:/Apache24/bin/httpd.exe',
        configFingerprint: 'C'.repeat(64),
      },
    }],
    warnings: [],
  };
}

test('非法发现关系不会污染上次成功投影', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, undefined, { appliedBy: 'test', checksum: (content) => createHash('sha256').update(content).digest('hex') });
  const projector = new StandardDeviceDiscoveryProjector(db);
  await db.query(`insert into pg_hosts (id, tenant_id, hostname, os_type, discovery_source, compatibility_level, management_mode, status)
    values ('host-invalid','tenant-1','invalid.example','NETWORK_DEVICE','MANUAL','L1','AGENTLESS','ACTIVE')`);
  await assert.rejects(() => projector.project({
    tenantId: 'tenant-1', hostId: 'host-invalid', discoveryProviderKey: 'test:invalid', discoverySource: 'AGENT',
  }, {
    apiVersion: 'gcac.device-discovery/v2', device: { stableKey: 'device:1', displayName: 'Device', productFamily: 'Mock' },
    capabilities: [], frameworks: [], sites: [], managedTargets: [], certificates: [],
    certificateBindings: [{ stableKey: 'binding:1', managedTargetStableKey: 'missing', certificateStableKey: 'missing' }], warnings: [],
  }));
  assert.equal((await db.query<{ count: string }>('select count(*)::text as count from pg_framework_instances where device_id=$1', ['host-invalid'])).rows[0]?.count, '0');
  const failed = (await db.query<{ status: string; payload: unknown; error_code: string }>(
    'select status, payload, error_code from plugin_discovery_snapshots where device_id=$1',
    ['host-invalid'],
  )).rows[0];
  assert.equal(failed?.status, 'FAILED');
  assert.equal(failed?.payload, null, '校验失败快照不得持久化未经验证的原始数据');
  assert.equal(failed?.error_code, 'DISCOVERY_RELATION_INVALID');
});

test('Agent 发现使用相同标准快照和投影幂等链', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, undefined, { appliedBy: 'test', checksum: (content) => createHash('sha256').update(content).digest('hex') });
  await db.query(`insert into pg_hosts (id, tenant_id, hostname, os_type, discovery_source, compatibility_level, management_mode, status, agent_id)
    values ('host-agent','tenant-agent','agent.example','LINUX','AGENT','L1','AGENT','ACTIVE','agent-1')`);
  await db.query(`insert into pg_certificate_assets (
      id, tenant_id, name, primary_domain, source_type, status, created_by
    ) values ('certificate-asset-agent','tenant-agent','agent.example','agent.example','imported','active','test')`);
  await db.query(`insert into pg_certificate_versions (
      id, tenant_id, certificate_asset_id, version_no, common_name, issuer, subject, serial_number,
      not_before, not_after, fingerprint_sha256, public_key_algorithm, signature_algorithm,
      leaf_storage_ref, chain_status, source_type, status, created_by
    ) values (
      'certificate-version-agent','tenant-agent','certificate-asset-agent',1,'agent.example','{}'::jsonb,'{}'::jsonb,'02',
      '2026-01-01T00:00:00Z','2027-01-01T00:00:00Z',$1,'RSA','SHA256-RSA',
      'secret://certificate/agent','complete','imported','active','test'
    )`, ['b'.repeat(64)]);
  const projector = new StandardDeviceDiscoveryProjector(db);
  const context = {
    tenantId: 'tenant-agent',
    hostId: 'host-agent',
    discoveryProviderKey: 'agent:agent-1',
    discoverySource: 'AGENT' as const,
  };
  const discovery = {
    apiVersion: 'gcac.device-discovery/v2',
    device: { stableKey: 'agent-host:agent-1', displayName: 'Agent Host', productFamily: 'AGENT_HOST' },
    capabilities: [{ key: 'nginx.cert.install', available: true }],
    frameworks: [{ stableKey: 'nginx', frameworkType: 'web.nginx', displayName: 'NGINX' }],
    sites: [{ stableKey: 'site:default', frameworkStableKey: 'nginx', siteType: 'web.virtual-host', displayName: 'Default', addresses: ['*'], port: 443, protocol: 'HTTPS' }],
    managedTargets: [{ stableKey: 'target:default', frameworkStableKey: 'nginx', siteStableKey: 'site:default', targetType: 'tls.file', targetKey: 'nginx:default', supportedCapabilities: ['nginx.cert.install'], executionLocations: ['AGENT'] }],
    certificates: [{
      stableKey: 'certificate:default', sha256Fingerprint: 'b'.repeat(64), subject: 'CN=agent.example',
      issuer: 'CN=Agent Test CA', notBefore: '2026-01-01T00:00:00Z', notAfter: '2027-01-01T00:00:00Z',
      metadata: { name: 'agent.example' },
    }],
    certificateBindings: [{
      stableKey: 'binding:default', managedTargetStableKey: 'target:default',
      certificateStableKey: 'certificate:default', bindingName: 'Default',
    }],
    warnings: [],
  };

  const first = await projector.project(context, discovery);
  const second = await projector.project(context, structuredClone(discovery));
  assert.deepEqual(second, first);
  const snapshots = await db.query<{ count: string; device_asset_id: string | null; discovery_source: string }>(
    `select count(*) over ()::text as count, device_asset_id, discovery_source
     from plugin_discovery_snapshots
     where tenant_id=$1 and device_id=$2`,
    ['tenant-agent', 'host-agent'],
  );
  assert.equal(snapshots.rows[0]?.count, '1');
  assert.equal(snapshots.rows[0]?.device_asset_id, null);
  assert.equal(snapshots.rows[0]?.discovery_source, 'AGENT');
  assert.equal((await db.query<{ count: string }>('select count(*)::text as count from pg_framework_instances where device_id=$1', ['host-agent'])).rows[0]?.count, '1');
  assert.equal((await db.query<{ count: string }>('select count(*)::text as count from pg_managed_targets where device_id=$1', ['host-agent'])).rows[0]?.count, '1');
  assert.equal((await db.query<{ count: string }>('select count(*)::text as count from plugin_discovered_certificates')).rows[0]?.count, '0');
  const formalBinding = (await db.query<{
    certificate_version_id: string | null;
    observed_fingerprint_sha256: string | null;
    metadata: Record<string, unknown>;
  }>('select certificate_version_id, observed_fingerprint_sha256, metadata from pg_certificate_bindings')).rows[0];
  assert.equal(formalBinding?.certificate_version_id, 'certificate-version-agent');
  assert.equal(formalBinding?.observed_fingerprint_sha256, null);
  assert.equal(formalBinding?.metadata.discoveryProviderKey, 'agent:agent-1');
  const detail = await new PgDevicesRepository(db).get('tenant-agent', 'host-agent');
  assert.equal(detail?.sites[0]?.bindings[0]?.certificate?.certificateVersionId, 'certificate-version-agent');
  assert.equal(detail?.sites[0]?.bindings[0]?.certificate?.fingerprintSha256, 'b'.repeat(64));

  const unmanagedDiscovery = structuredClone(discovery);
  unmanagedDiscovery.certificates[0]!.sha256Fingerprint = 'c'.repeat(64);
  unmanagedDiscovery.certificates[0]!.subject = 'CN=unmanaged.agent.example';
  await projector.project(context, unmanagedDiscovery);
  const unmanagedDetail = await new PgDevicesRepository(db).get('tenant-agent', 'host-agent');
  assert.equal(unmanagedDetail?.sites[0]?.bindings[0]?.certificate?.certificateVersionId, undefined);
  assert.equal(unmanagedDetail?.sites[0]?.bindings[0]?.certificate?.fingerprintSha256, 'c'.repeat(64));
  assert.equal(unmanagedDetail?.sites[0]?.bindings[0]?.certificate?.subject, 'CN=unmanaged.agent.example');

  await projector.project(context, { ...unmanagedDiscovery, certificates: [], certificateBindings: [] });
  const withoutBindingDetail = await new PgDevicesRepository(db).get('tenant-agent', 'host-agent');
  assert.equal(withoutBindingDetail?.sites[0]?.bindings.length, 0);
});

test('并发重复发现只提交一次标准快照和业务投影', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, undefined, { appliedBy: 'test', checksum: (content) => createHash('sha256').update(content).digest('hex') });
  await db.query(`insert into pg_hosts (id, tenant_id, hostname, os_type, discovery_source, compatibility_level, management_mode, status)
    values ('host-concurrent','tenant-concurrent','concurrent.example','LINUX','AGENT','L1','AGENT','ACTIVE')`);
  const projector = new StandardDeviceDiscoveryProjector(db);
  const context = { tenantId: 'tenant-concurrent', hostId: 'host-concurrent', discoveryProviderKey: 'agent:concurrent', discoverySource: 'AGENT' as const };
  const discovery = {
    apiVersion: 'gcac.device-discovery/v2',
    device: { stableKey: 'agent-host:concurrent', displayName: 'Concurrent Host', productFamily: 'AGENT_HOST' },
    capabilities: [], frameworks: [], sites: [], managedTargets: [], certificates: [], certificateBindings: [], warnings: [],
  };

  const [left, right] = await Promise.all([
    projector.project(context, discovery),
    projector.project(context, structuredClone(discovery)),
  ]);
  assert.deepEqual(right, left);
  assert.equal((await db.query<{ count: string }>('select count(*)::text as count from plugin_discovery_snapshots where device_id=$1 and status=$2', ['host-concurrent', 'SUCCEEDED'])).rows[0]?.count, '1');
});

test('标准发现投影缺少插件版本和显式来源时拒绝运行期回退', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, undefined, { appliedBy: 'test', checksum: (content) => createHash('sha256').update(content).digest('hex') });
  const projector = new StandardDeviceDiscoveryProjector(db);
  const discovery = {
    apiVersion: 'gcac.device-discovery/v2',
    device: { stableKey: 'device:missing-source', displayName: 'Device', productFamily: 'generic.device' },
    capabilities: [], frameworks: [], sites: [], managedTargets: [], certificates: [], certificateBindings: [], warnings: [],
  };

  await assert.rejects(
    () => projector.project({ tenantId: 'tenant-missing-source', hostId: 'host-missing-source' }, discovery),
    /缺少插件版本或显式来源标识/,
  );
});
