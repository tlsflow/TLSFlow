import assert from 'node:assert/strict';
import test from 'node:test';

import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { AssetsDomainService } from './domain/assets.domain-service.js';
import { PgAssetsRepository } from './repository/assets.repository.js';
import { PgDeviceAssetsRepository } from '../device-assets/repository/device-assets.repository.js';

test('Spec033 设备可以拥有 ManagedTarget 和 ApplicationAssetTarget', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const assets = new PgAssetsRepository(database);
  const devices = new PgDeviceAssetsRepository(database);
  const tenantId = 'tenant_spec033_device_owner';
  const device = await devices.create(tenantId, {
    displayName: 'ADC Owner',
    managementAddress: '10.33.2.49',
    managementPort: 443,
    deviceFamily: 'NETSCALER_ADC',
    credentialId: 'secret_spec033_device_owner',
    authMode: 'SESSION',
    tlsVerify: false,
  });
  const serviceInstance = await assets.createServiceInstance(tenantId, {
    hostId: device.hostId,
    providerType: 'DEVICE_TEMPLATE',
    serviceName: 'netscaler-adc',
    displayName: 'NetScaler ADC',
    discoverySource: 'PROVIDER',
  });
  const application = await assets.createServiceAsset(tenantId, {
    address: 'vs-owner.example.com',
    port: 443,
    protocol: 'HTTPS',
    platform: 'APPLIANCE',
    hostId: device.hostId,
    serviceInstanceId: serviceInstance.id,
    displayName: 'LB:vs-owner',
    discoverySource: 'PROVIDER',
  });
  const site = await assets.createSiteAsset(tenantId, {
    serviceInstanceId: serviceInstance.id,
    serviceAssetId: application.id,
    hostId: device.hostId,
    providerType: 'DEVICE_TEMPLATE',
    siteType: 'CUSTOM',
    siteName: 'vs-owner',
    siteKey: 'lb:vs-owner',
    port: 443,
    protocol: 'HTTPS',
    discoverySource: 'PROVIDER',
  });
  const managedTarget = await assets.createManagedTarget(tenantId, {
    deviceAssetId: device.id,
    hostId: device.hostId,
    serviceInstanceId: serviceInstance.id,
    serviceAssetId: application.id,
    siteAssetId: site.id,
    providerType: 'DEVICE_TEMPLATE',
    frameworkType: 'DEVICE_TEMPLATE',
    targetType: 'SITE_BINDING',
    targetKey: `${device.id}:lb:vs-owner`,
  });
  const applicationTarget = await assets.createApplicationAssetTarget(tenantId, {
    applicationAssetId: application.id,
    deviceAssetId: device.id,
    siteAssetId: site.id,
    managedTargetId: managedTarget.id,
    providerType: 'DEVICE_TEMPLATE',
    frameworkType: 'DEVICE_TEMPLATE',
    targetType: 'SITE_BINDING',
    targetKey: managedTarget.targetKey,
  });

  assert.equal(managedTarget.agentId, undefined);
  assert.equal(managedTarget.deviceAssetId, device.id);
  assert.equal(managedTarget.hostId, device.hostId);
  assert.equal(applicationTarget.agentId, undefined);
  assert.equal(applicationTarget.deviceAssetId, device.id);
});

test('Spec033 受管目标必须且只能指定一种所有者', () => {
  const domain = new AssetsDomainService();
  const base = {
    hostId: 'host_spec033',
    providerType: 'IIS' as const,
    frameworkType: 'IIS' as const,
    targetType: 'SITE_BINDING' as const,
    targetKey: 'site:443',
  };

  assert.throws(() => domain.normalizeManagedTarget(base));
  assert.throws(() => domain.normalizeManagedTarget({ ...base, agentId: 'agent_spec033', deviceAssetId: 'device_spec033' }));
  assert.equal(domain.normalizeManagedTarget({ ...base, agentId: 'agent_spec033' }).agentId, 'agent_spec033');
  assert.equal(domain.normalizeManagedTarget({ ...base, deviceAssetId: 'device_spec033' }).deviceAssetId, 'device_spec033');
});
