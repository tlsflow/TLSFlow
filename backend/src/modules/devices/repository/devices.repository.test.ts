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

  const detail = await new PgDevicesRepository(database).get(tenantId, host.id);

  assert.deepEqual(detail?.sites.map((site) => site.kind), kinds);
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
