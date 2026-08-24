import assert from 'node:assert/strict';
import test from 'node:test';

import { runMigrations } from '../../../database/migration-runner.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { PgAssetsRepository } from '../../assets/repository/assets.repository.js';
import { StandardDeviceDiscoveryProjector } from '../../plugins/discovery/standard-device-discovery.projector.js';
import { MANAGED_DEVICE_SITE_KIND_PATTERN, type ManagedDeviceSiteKind } from '../dto/devices.dto.js';
import { managedDeviceDetailSchema } from '../schema/devices.schema.js';
import { PgDevicesRepository } from './devices.repository.js';

test('设备详情按标准 site_type 往返未知插件分类且不读取 Provider 产品名', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const assets = new PgAssetsRepository(database);
  const tenantId = 'tenant_open_site_kind';
  const host = await assets.createHost(tenantId, {
    hostname: 'cluster.example.test',
    displayName: 'Kubernetes Cluster',
    osType: 'LINUX',
    agentId: 'agent-open-site-kind',
    managementMode: 'AGENT',
  });
  const kinds: ManagedDeviceSiteKind[] = ['web.site', 'kubernetes.ingress'];
  const discovery = {
    apiVersion: 'gcac.device-discovery/v2',
    device: { stableKey: 'device:kubernetes', displayName: 'Kubernetes Cluster', productFamily: 'fixture.unknown' },
    capabilities: [],
    frameworks: [{ stableKey: 'framework:cluster', frameworkType: 'kubernetes.cluster', displayName: 'Cluster Main' }],
    sites: kinds.map((siteType, index) => ({
      stableKey: `site:${index}`,
      frameworkStableKey: 'framework:cluster',
      siteType,
      displayName: `site-${index}`,
      addresses: [],
      metadata: { extension: { source: 'test.plugin' } },
    })),
    managedTargets: [],
    certificates: [],
    certificateBindings: [],
    warnings: [],
  };
  const projector = new StandardDeviceDiscoveryProjector(database);
  const projectionContext = {
    tenantId,
    hostId: host.id,
    discoveryProviderKey: 'plugin-version:unknown-product',
    discoverySource: 'AGENT' as const,
  };
  await projector.project(projectionContext, discovery);
  await database.query(
    `update plugin_discovery_snapshots set payload='{}'::jsonb
     where tenant_id=$1 and device_id=$2`,
    [tenantId, host.id],
  );

  const detail = await new PgDevicesRepository(database).get(tenantId, host.id);

  assert.deepEqual(detail?.sites.map((site) => site.kind), kinds);
  assert.deepEqual(detail?.sites.map((site) => site.frameworkType), ['kubernetes.cluster', 'kubernetes.cluster']);
  assert.deepEqual(detail?.sites.map((site) => site.presentation), [undefined, undefined]);
  assert.equal(detail?.frameworks[0]?.frameworkType, 'kubernetes.cluster');
  assert.equal(detail?.frameworks[0]?.displayName, 'Cluster Main');
  assert.deepEqual(detail?.sites.map((site) => site.metadata), [
    { addresses: [], extension: { source: 'test.plugin' } },
    { addresses: [], extension: { source: 'test.plugin' } },
  ]);

  await assert.rejects(projector.project(projectionContext, {
    ...discovery,
    sites: [{ ...discovery.sites[0]!, siteType: 'IIS' }],
  }));
  const persistedKinds = await database.query<{ site_type: string }>(
    'select site_type from pg_site_assets where tenant_id=$1 and device_id=$2 order by site_name',
    [tenantId, host.id],
  );
  assert.deepEqual(persistedKinds.rows.map((row) => row.site_type), kinds);
});

test('设备详情 OpenAPI 使用开放命名空间约束而不是产品枚举', () => {
  const kindSchema = managedDeviceDetailSchema.properties?.sites?.items?.properties?.kind;

  assert.equal(kindSchema?.type, 'string');
  assert.equal(kindSchema?.pattern, MANAGED_DEVICE_SITE_KIND_PATTERN);
  assert.equal(kindSchema?.enum, undefined);
  assert.match('nas.share', new RegExp(MANAGED_DEVICE_SITE_KIND_PATTERN));
  assert.doesNotMatch('IIS', new RegExp(MANAGED_DEVICE_SITE_KIND_PATTERN));
});

test('设备详情以配置证书为主并单独返回运行证书和漂移状态', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const assets = new PgAssetsRepository(database);
  const tenantId = 'tenant_listener_certificate_precedence';
  const host = await assets.createHost(tenantId, {
    hostname: 'windows-web.example.test',
    displayName: 'Windows Web',
    osType: 'WINDOWS',
    managementMode: 'AGENT',
    agentId: 'agent-listener-certificate',
  });
  const projector = new StandardDeviceDiscoveryProjector(database);
  const base = {
    apiVersion: 'gcac.device-discovery/v2' as const,
    device: { stableKey: 'agent-host:listener-certificate', displayName: 'Windows Web', productFamily: 'AGENT_HOST' },
    capabilities: [],
    frameworks: [{ stableKey: 'framework:web.nginx', frameworkType: 'web.nginx', displayName: 'Nginx' }],
    sites: [{ stableKey: 'site:nginx.test.local', frameworkStableKey: 'framework:web.nginx', siteType: 'web.site', displayName: 'nginx.test.local', addresses: ['nginx.test.local'], port: 8443, protocol: 'HTTPS', metadata: { listeners: [{ port: 8443, protocol: 'HTTPS', host: 'nginx.test.local' }] } }],
    warnings: [],
  };
  await projector.project({ tenantId, hostId: host.id, discoveryProviderKey: 'agent:new', discoverySource: 'AGENT' }, {
    ...base,
    managedTargets: [{ stableKey: 'target:new', frameworkStableKey: 'framework:web.nginx', siteStableKey: 'site:nginx.test.local', targetType: 'tls.binding', targetKey: 'new', supportedCapabilities: ['certificate.deploy', 'certificate.verify'], executionLocations: ['AGENT'], metadata: { listener: { port: 8443, protocol: 'HTTPS', host: 'nginx.test.local' }, certificateLocation: { storageKind: 'PEM_FILES', certificatePath: 'D:/nginx/conf/site.crt' } } }],
    certificates: [
      { stableKey: `CERT:${'A'.repeat(64)}`, sha256Fingerprint: 'A'.repeat(64), subject: 'CN=configured', issuer: 'CN=CA', notBefore: '2026-01-01T00:00:00Z', notAfter: '2027-01-01T00:00:00Z', metadata: { path: 'D:/nginx/conf/site.crt' } },
      { stableKey: `CERT:${'B'.repeat(64)}`, sha256Fingerprint: 'B'.repeat(64), subject: 'CN=actual-listener', issuer: 'CN=CA', notBefore: '2026-02-01T00:00:00Z', notAfter: '2027-02-01T00:00:00Z', metadata: { path: 'windows-tls://127.0.0.1/8443/BBBB' } },
    ],
    certificateBindings: [{
      stableKey: 'binding:new',
      managedTargetStableKey: 'target:new',
      certificateStableKey: `CERT:${'A'.repeat(64)}`,
      configuredCertificateStableKey: `CERT:${'A'.repeat(64)}`,
      observedCertificateStableKey: `CERT:${'B'.repeat(64)}`,
      deploymentTarget: { storageKind: 'PEM_FILES', certificatePath: 'D:/nginx/conf/site.crt', sourceConfigPath: 'D:/nginx/conf/nginx.conf' },
      bindingName: 'nginx.test.local',
      metadata: { listenerHost: 'nginx.test.local', listenerPort: 8443, listenerProtocol: 'HTTPS' },
    }],
  });

  const detail = await new PgDevicesRepository(database).get(tenantId, host.id);
  const bindings = detail?.sites.find((site) => site.name === 'nginx.test.local')?.bindings ?? [];
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0]?.certificate?.fingerprintSha256, 'A'.repeat(64));
  assert.equal(bindings[0]?.observedCertificate?.fingerprintSha256, 'B'.repeat(64));
  assert.equal(bindings[0]?.driftStatus, 'DRIFTED');
  assert.equal(bindings[0]?.bindingType, 'FILE_PATH');
});
