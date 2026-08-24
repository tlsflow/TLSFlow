import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgAssetsRepository } from '../assets/repository/assets.repository.js';
import { PgDeviceAssetsRepository } from '../device-assets/repository/device-assets.repository.js';
import { ManagedTargetPluginQueryService } from './application/managed-target-plugin-query.service.js';
import { UnifiedPluginsApplicationService } from './application/unified-plugins.application-service.js';
import { PgUnifiedPluginsRepository } from './repository/unified-plugins.repository.js';

test('受管目标插件 API 在同一事务中保存目标、Binding 和 Assignment', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');
  const tenantId = 'tenant-managed-plugin-query';
  const device = await new PgDeviceAssetsRepository(db).create(tenantId, {
    displayName: 'Fixture ADC', managementAddress: '10.33.44.10', managementPort: 443,
    deviceFamily: 'NETSCALER_ADC', authMode: 'AUTO', tlsVerify: true,
  });
  const assets = new PgAssetsRepository(db);
  const framework = await assets.createFrameworkInstance(tenantId, {
    deviceId: device.hostId, frameworkType: 'adc.load-balancer', frameworkKey: 'adc-1', discoveryProviderKey: 'fixture', displayName: 'ADC',
  });
  const site = await assets.createSiteAsset(tenantId, {
    frameworkInstanceId: framework.id, deviceId: device.hostId, discoveryProviderKey: 'fixture', siteType: 'virtual-server', siteName: 'HTTPS', siteKey: 'https', port: 443, protocol: 'HTTPS',
  });
  const target = await assets.createManagedTarget(tenantId, {
    deviceId: device.hostId, frameworkInstanceId: framework.id, siteId: site.id, discoveryProviderKey: 'fixture',
    targetType: 'tls.binding', targetKey: 'https', supportedCapabilities: ['certificate.deploy'], executionLocations: ['CONTROL_PLANE'],
  });
  const applicationAsset = await assets.createServiceAsset(tenantId, {
    address: 'managed-plugin.example.com', port: 443, protocol: 'HTTPS', discoverySource: 'MANUAL', status: 'ACTIVE',
  });
  const plugins = new UnifiedPluginsApplicationService(new PgUnifiedPluginsRepository(db));
  const imported = await plugins.importVersion(tenantId, {
    manifest: {
      apiVersion: 'gcac.plugin-manifest/v1', kind: 'GcacPlugin', pluginId: 'fixture.managed', version: '1.0.0', displayNameKey: 'fixture.managed', publisher: 'test',
      defaultLocale: 'zh-CN',
      runtime: 'WORKFLOW_DSL', source: 'USER', scope: 'MANAGED', trust: 'UNSIGNED', support: 'SELF_MANAGED', permissions: [],
      capabilities: [{ key: 'certificate.deploy', contractVersion: 'v1', actionContractId: 'certificate.deploy.v1', riskLevel: 'HIGH', executionLocations: ['CONTROL_PLANE'] }],
      compatibility: { frameworkTypes: ['adc.load-balancer'], targetTypes: ['tls.binding'], managementMethods: ['PLUGIN'], executionLocations: ['CONTROL_PLANE'], artifactContracts: ['certificate.deploy.v1'] },
      resources: { workflows: { 'certificate.deploy': 'workflows/deploy.json' }, locales: { 'zh-CN': 'locales/zh-CN.json' } },
    },
    resources: {
      'workflows/deploy.json': JSON.stringify({
        apiVersion: 'gcac.workflow/v1', kind: 'CurlSshWorkflow', metadata: { name: 'fixture-managed-deploy', version: '1.0.0' }, variables: {},
        steps: [{ name: 'deploy', type: 'transform', stage: 'install', transform: { engine: 'jsonata', input: {}, outputs: { result: { expression: '{}' } } } }],
      }),
      'locales/zh-CN.json': JSON.stringify({ 'fixture.managed': 'Fixture 受管证书部署' }),
    },
  });
  await plugins.enableVersion(imported.id);
  const older = await plugins.importVersion(tenantId, {
    manifest: { ...imported.manifest, version: '0.9.0' },
    resources: imported.resources,
  });
  await plugins.enableVersion(older.id);
  const legacy = await plugins.importVersion(tenantId, {
    manifest: {
      ...imported.manifest,
      pluginId: 'fixture.legacy',
      version: '1.0.0',
      displayNameKey: 'fixture.legacy',
      defaultLocale: undefined,
      compatibility: undefined,
      resources: { workflows: { 'certificate.deploy': 'workflows/deploy.json' } },
    },
    resources: { 'workflows/deploy.json': imported.resources['workflows/deploy.json']! },
  });
  await plugins.enableVersion(legacy.id);

  const service = new ManagedTargetPluginQueryService(db);
  const compatible = await service.listCompatiblePlugins({ tenantId, managedTargetId: target.id, capabilityKey: 'certificate.deploy', locale: 'zh-CN' });
  assert.deepEqual(compatible.items.filter((item) => item.compatible).map((item) => item.pluginVersionId), [imported.id]);
  assert.equal(compatible.items.find((item) => item.pluginId === 'fixture.managed')?.displayName, 'Fixture 受管证书部署');
  assert.equal(compatible.items.some((item) => item.pluginVersionId === older.id), false);
  assert.equal(compatible.items.find((item) => item.pluginId === 'fixture.legacy')?.compatible, false);
  assert.equal(compatible.items.find((item) => item.pluginId === 'fixture.legacy')?.reasons.some((reason) => reason.dimension === 'compatibilityContract'), true);

  const saved = await service.saveApplicationAssetTarget({
    tenantId,
    applicationAssetId: applicationAsset.id,
    value: {
      managedTargetId: target.id,
      pluginOverride: { pluginVersionId: imported.id, variableBindings: { virtualServer: 'https' }, secretBindings: {} },
    },
  });
  assert.equal(saved.target.managedTargetId, target.id);
  assert.equal(saved.effectiveCapability?.source.ownerType, 'APPLICATION_ASSET');
  assert.equal(saved.effectiveCapability?.plugin.pluginId, 'fixture.managed');
  assert.equal(saved.effectiveCapability?.binding.hostId, device.hostId);

  const effective = await service.getEffectiveCapability({ tenantId, managedTargetId: target.id, applicationAssetId: applicationAsset.id, capabilityKey: 'certificate.deploy' });
  assert.equal(effective.executionLocation, 'CONTROL_PLANE');
  assert.equal(effective.binding.pluginBindingId, saved.effectiveCapability?.binding.pluginBindingId);

  await service.saveApplicationAssetTarget({
    tenantId,
    applicationAssetId: applicationAsset.id,
    value: { managedTargetId: target.id },
  });
  const disabledAssignment = await db.query<{ status: string }>(
    `select status from plugin_capability_assignments
     where tenant_id=$1 and owner_type='APPLICATION_ASSET' and owner_id=$2 and capability_key='certificate.deploy'`,
    [tenantId, applicationAsset.id],
  );
  assert.equal(disabledAssignment.rows[0]?.status, 'DISABLED');

  await assert.rejects(() => service.saveApplicationAssetTarget({
    tenantId,
    applicationAssetId: applicationAsset.id,
    value: { managedTargetId: target.id, expectedTargetVersion: 999 },
  }), /版本冲突/);
});
