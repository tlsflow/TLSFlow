import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgBindingsRepository } from '../bindings/repository/bindings.repository.js';
import { PgDeviceAssetsRepository } from '../device-assets/repository/device-assets.repository.js';
import { PgAssetsRepository } from './repository/assets.repository.js';

test('Spec033.1 迁移只软删除 ADC Provider 自动应用资产并保留人工资产与发现目标', async () => {
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
  const serviceInstance = await assets.createServiceInstance(tenantId, {
    hostId: device.hostId,
    providerType: 'DEVICE_TEMPLATE',
    serviceName: 'netscaler-adc',
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
    serviceInstanceId: serviceInstance.id,
    serviceAssetId: projectedAsset.id,
    hostId: device.hostId,
    providerType: 'DEVICE_TEMPLATE',
    siteType: 'CUSTOM',
    siteName: 'projected',
    siteKey: 'LB:projected',
    bindingInformation: '10.33.10.50:443',
    port: 443,
    protocol: 'HTTPS',
    discoverySource: 'PROVIDER',
    metadata: { deviceAssetId: device.id, virtualServerType: 'LB', virtualServerName: 'projected' },
  });
  const managedTarget = await assets.createManagedTarget(tenantId, {
    deviceAssetId: device.id,
    hostId: device.hostId,
    serviceInstanceId: serviceInstance.id,
    serviceAssetId: projectedAsset.id,
    siteAssetId: site.id,
    providerType: 'DEVICE_TEMPLATE',
    frameworkType: 'DEVICE_TEMPLATE',
    targetType: 'SITE_BINDING',
    targetKey: 'LB:projected',
    bindingKey: 'LB:projected',
    deploymentMode: 'NITRO',
    metadata: { deviceAssetId: device.id },
  });
  const projectedTarget = await assets.createApplicationAssetTarget(tenantId, {
    applicationAssetId: projectedAsset.id,
    deviceAssetId: device.id,
    siteAssetId: site.id,
    managedTargetId: managedTarget.id,
    providerType: 'DEVICE_TEMPLATE',
    frameworkType: 'DEVICE_TEMPLATE',
    targetType: 'SITE_BINDING',
    targetKey: managedTarget.targetKey,
    bindingKey: managedTarget.bindingKey,
    metadata: { deviceAssetId: device.id },
  });
  const manualTarget = await assets.createApplicationAssetTarget(tenantId, {
    applicationAssetId: manualAsset.id,
    deviceAssetId: device.id,
    siteAssetId: site.id,
    managedTargetId: managedTarget.id,
    providerType: 'DEVICE_TEMPLATE',
    frameworkType: 'DEVICE_TEMPLATE',
    targetType: 'SITE_BINDING',
    targetKey: managedTarget.targetKey,
    bindingKey: managedTarget.bindingKey,
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

  const migration = await readFile(
    resolve('src/database/migrations/20260724000100_manual_application_assets.sql'),
    'utf8',
  );
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
  assert.equal(siteAfter?.serviceAssetId, undefined);
  assert.equal(managedTargetAfter?.serviceAssetId, undefined);
  assert.equal(bindingAfter?.serviceAssetId, undefined);
});
