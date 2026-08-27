import assert from 'node:assert/strict';
import test from 'node:test';

import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { AssetsDomainService } from './domain/assets.domain-service.js';
import { PgAssetsRepository } from './repository/assets.repository.js';
import { PgDeviceAssetsRepository } from '../device-assets/repository/device-assets.repository.js';
import { CloudAccountAssetsApplicationService } from '../providers/application/cloud-account-assets.application-service.js';

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

test('Spec034 云资源 Framework、Site 和 ManagedTarget 共享 CloudAccountAsset 所有者', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const assets = new PgAssetsRepository(database);
  const cloudAccounts = new CloudAccountAssetsApplicationService(database);
  const tenantId = 'tenant_spec034_cloud_owner';
  const account = await cloudAccounts.create(tenantId, {
    displayName: '云 CDN 账号',
    providerKey: 'cloud.example',
    credentialRef: 'credential://cloud-example',
  });

  const framework = await assets.createFrameworkInstance(tenantId, {
    assetId: account.id,
    frameworkType: 'cloud.cdn',
    frameworkKey: 'cdn.global',
    discoveryProviderKey: 'cloud.example:discover',
    displayName: '云 CDN · 国际站',
    discoverySource: 'PROVIDER',
  });
  const site = await assets.createSiteAsset(tenantId, {
    frameworkInstanceId: framework.id,
    discoveryProviderKey: 'cloud.example:discover',
    siteType: 'cloud.cdn.domain',
    siteName: 'example.com',
    siteKey: 'cloud.example:cdn.domain:example.com',
    metadata: { region: 'global' },
    discoverySource: 'PROVIDER',
  });
  const managedTarget = await assets.createManagedTarget(tenantId, {
    assetId: account.id,
    frameworkInstanceId: framework.id,
    siteId: site.id,
    discoveryProviderKey: 'cloud.example:discover',
    targetType: 'cloud.cdn.domain',
    targetKey: 'example.com',
    supportedCapabilities: ['cloud.resource.discover'],
    executionLocations: ['CONTROL_PLANE'],
  });

  assert.equal(framework.assetId, account.id);
  assert.equal(framework.deviceId, undefined);
  assert.equal(site.assetId, account.id);
  assert.equal(site.deviceId, undefined);
  assert.equal(managedTarget.assetId, account.id);
  assert.equal(managedTarget.deviceId, undefined);
  await assert.rejects(
    () => assets.createSiteAsset(tenantId, {
      frameworkInstanceId: framework.id,
      deviceId: 'host_should_not_be_mixed',
      discoveryProviderKey: 'cloud.example:discover',
      siteType: 'cloud.cdn.domain',
      siteName: 'invalid.example.com',
      siteKey: 'cloud.example:cdn.domain:invalid.example.com',
      discoverySource: 'PROVIDER',
    }),
    /同一资源所有者|Device Root 不存在/,
  );
  await database.close();
});
