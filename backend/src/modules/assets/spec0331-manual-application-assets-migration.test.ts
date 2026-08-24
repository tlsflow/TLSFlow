import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgBindingsRepository } from '../bindings/repository/bindings.repository.js';
import { PgDeviceAssetsRepository } from '../device-assets/repository/device-assets.repository.js';
import { PgAssetsRepository } from './repository/assets.repository.js';

test('Spec033.1 历史校正语义在终态 FrameworkInstance 结构下仍只删除自动应用资产', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const assets = new PgAssetsRepository(database);
  const bindings = new PgBindingsRepository(assets, database);
  const devices = new PgDeviceAssetsRepository(database);
  const tenantId = 'tenant_spec0331_manual_assets';
  const device = await devices.create(tenantId, {
    displayName: 'ADC Migration',
    managementAddress: '10.33.10.49',
    managementPort: 443,
    deviceFamily: 'NETSCALER_ADC',
    credentialId: 'secret_spec0331_migration',
    authMode: 'SESSION',
    tlsVerify: false,
  });
  const serviceInstance = await assets.createFrameworkInstance(tenantId, {
    deviceId: device.hostId,
    frameworkType: 'adc.load-balancer',
    frameworkKey: 'netscaler-adc',
    discoveryProviderKey: 'provider.discovery',
    displayName: 'Citrix ADC',
    discoverySource: 'PROVIDER',
  });
  const projectedAsset = await assets.createServiceAsset(tenantId, {
    address: 'projected.example.test',
    port: 443,
    protocol: 'HTTPS',
    platform: 'APPLIANCE',
    hostId: device.hostId,
    serviceInstanceId: serviceInstance.id,
    displayName: 'LB projected',
    discoverySource: 'PROVIDER',
    metadata: { deviceAssetId: device.id, virtualServerType: 'LB', virtualServerName: 'projected' },
  });
  const manualAsset = await assets.createServiceAsset(tenantId, {
    address: 'manual.example.test',
    port: 443,
    protocol: 'HTTPS',
    platform: 'APPLIANCE',
    hostId: device.hostId,
    serviceInstanceId: serviceInstance.id,
    displayName: '人工 ADC 应用资产',
    discoverySource: 'MANUAL',
    metadata: { deviceAssetId: device.id },
  });
  const site = await assets.createSiteAsset(tenantId, {
    frameworkInstanceId: serviceInstance.id,
    deviceId: device.hostId,
    discoveryProviderKey: 'plugin-version:version_1',
    siteType: 'network.virtual-server',
    siteName: 'projected',
    siteKey: 'LB:projected',
    bindingInformation: '10.33.10.50:443',
    port: 443,
    protocol: 'HTTPS',
    discoverySource: 'PROVIDER',
    metadata: { deviceAssetId: device.id, virtualServerType: 'LB', virtualServerName: 'projected' },
  });
  const managedTarget = await assets.createManagedTarget(tenantId, {
    deviceId: device.hostId,
    frameworkInstanceId: serviceInstance.id,
    siteId: site.id,
    discoveryProviderKey: 'plugin-version:version_1',
    targetType: 'tls.binding',
    targetKey: 'LB:projected',
    bindingKey: 'LB:projected',
    supportedCapabilities: ['certificate.deploy'],
    executionLocations: ['CONTROL_PLANE'],
    metadata: { deviceAssetId: device.id },
  });
  const projectedTarget = await assets.createApplicationAssetTarget(tenantId, {
    applicationAssetId: projectedAsset.id,
    managedTargetId: managedTarget.id,
    metadata: { deviceAssetId: device.id },
  });
  const manualTarget = await assets.createApplicationAssetTarget(tenantId, {
    applicationAssetId: manualAsset.id,
    managedTargetId: managedTarget.id,
    metadata: { deviceAssetId: device.id },
  });
  const certificateBinding = await bindings.createCertificateBinding(tenantId, {
    serviceInstanceId: serviceInstance.id,
    serviceAssetId: projectedAsset.id,
    siteAssetId: site.id,
    managedTargetId: managedTarget.id,
    domainName: 'projected.example.test',
    port: 443,
    protocol: 'HTTPS',
    bindingKey: 'LB:projected:cert-a',
    bindingType: 'CUSTOM',
    verifyMethod: 'CUSTOM',
  });

  const migration = (await readFile(
    resolve('src/database/migrations/20260727001200_terminal_application_asset_cleanup.sql'),
    'utf8',
  ));
  for (const statement of migration.split(/;\s*(?:\r?\n|$)/).map((item) => item.trim()).filter(Boolean)) {
    await database.query(statement);
  }

  const projectedAfter = await assets.getServiceAssetIncludingDeleted(tenantId, projectedAsset.id);
  const manualAfter = await assets.getServiceAssetIncludingDeleted(tenantId, manualAsset.id);
  const projectedTargetAfter = await assets.getApplicationAssetTarget(tenantId, projectedTarget.id);
  const manualTargetAfter = await assets.getApplicationAssetTarget(tenantId, manualTarget.id);
  const siteAfter = await assets.getSiteAsset(tenantId, site.id);
  const managedTargetAfter = await assets.getManagedTarget(tenantId, managedTarget.id);
  const bindingAfter = await bindings.getCertificateBinding(tenantId, certificateBinding.id);

  assert.equal(projectedAfter?.status, 'DELETED');
  assert.ok(projectedAfter?.deletedAt);
  assert.equal(projectedTargetAfter, undefined);
  assert.equal(manualAfter?.status, 'ACTIVE');
  assert.equal(manualAfter?.deletedAt, undefined);
  assert.equal(manualTargetAfter?.status, 'ACTIVE');
  assert.equal(siteAfter?.deviceId, device.hostId);
  assert.equal(managedTargetAfter?.deviceId, device.hostId);
  assert.equal(bindingAfter?.serviceAssetId, undefined);
});
