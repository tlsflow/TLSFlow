import assert from 'node:assert/strict';
import test from 'node:test';

import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { AssetsDomainService } from './domain/assets.domain-service.js';
import { PgAssetsRepository } from './repository/assets.repository.js';
import { PgDeviceAssetsRepository } from '../device-assets/repository/device-assets.repository.js';

test('Spec033 Device Root 可以统一承载 ManagedTarget 和 ApplicationAssetTarget', async () => {
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
  const serviceInstance = await assets.createFrameworkInstance(tenantId, {
    deviceId: device.hostId,
    frameworkType: 'adc.load-balancer',
    frameworkKey: 'netscaler-adc',
    discoveryProviderKey: 'provider.discovery',
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
    frameworkInstanceId: serviceInstance.id,
    deviceId: device.hostId,
    discoveryProviderKey: 'plugin-version:version_1',
    siteType: 'network.virtual-server',
    siteName: 'vs-owner',
    siteKey: 'lb:vs-owner',
    port: 443,
    protocol: 'HTTPS',
    discoverySource: 'PROVIDER',
  });
  const managedTarget = await assets.createManagedTarget(tenantId, {
    deviceId: device.hostId,
    frameworkInstanceId: serviceInstance.id,
    siteId: site.id,
    discoveryProviderKey: 'plugin-version:version_1',
    targetType: 'tls.binding',
    targetKey: `${device.id}:lb:vs-owner`,
    supportedCapabilities: ['certificate.deploy', 'certificate.verify'],
    executionLocations: ['CONTROL_PLANE', 'GATEWAY'],
  });
  const applicationTarget = await assets.createApplicationAssetTarget(tenantId, {
    applicationAssetId: application.id,
    managedTargetId: managedTarget.id,
  });

  assert.equal(managedTarget.deviceId, device.hostId);
  assert.equal(managedTarget.frameworkInstanceId, serviceInstance.id);
  assert.equal(managedTarget.siteId, site.id);
  assert.equal(applicationTarget.applicationAssetId, application.id);
  assert.equal(applicationTarget.managedTargetId, managedTarget.id);
});

test('Spec033 受管目标只接受 Device Root 和显式能力', () => {
  const domain = new AssetsDomainService();
  const base = {
    discoveryProviderKey: 'agent.discovery',
    targetType: 'tls.binding',
    targetKey: 'site:443',
    supportedCapabilities: ['certificate.deploy'],
    executionLocations: ['AGENT'] as Array<'AGENT'>,
  };

  assert.throws(() => domain.normalizeManagedTarget(base as never));
  assert.throws(() => domain.normalizeManagedTarget({ ...base, deviceId: 'host_spec033', executionLocations: [] }));
  const normalized = domain.normalizeManagedTarget({ ...base, deviceId: 'host_spec033' });
  assert.equal(normalized.deviceId, 'host_spec033');
  assert.deepEqual(normalized.supportedCapabilities, ['certificate.deploy']);
});
