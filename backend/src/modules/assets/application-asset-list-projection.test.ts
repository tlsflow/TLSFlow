import assert from 'node:assert/strict';
import test from 'node:test';

import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { AssetsApplicationService } from './application/assets.application-service.js';
import { PgBindingsRepository } from '../bindings/repository/bindings.repository.js';
import { PgCertificatesRepository } from '../certificates/repository/certificates.repository.js';
import { PgMonitorsRepository } from '../monitors/repository/monitors.repository.js';
import { PgAssetsRepository } from './repository/assets.repository.js';
import { PluginBindingsApplicationService } from '../plugins/application/plugin-bindings.application-service.js';
import { PluginBindingsRepository } from '../plugins/repository/plugin-bindings.repository.js';
import { insertCanonicalPluginVersion } from '../plugins/plugin-test-fixtures.js';
import { emptyInputBindingsV1 } from '../deployment-inputs/dto/input-bindings.dto.js';

test('应用资产列表投影设备、框架和站点名称', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const repository = new PgAssetsRepository(database);
  const tenantId = 'tenant_application_asset_projection';

  const host = await repository.createHost(tenantId, {
    hostname: 'jackson-mgt',
    displayName: 'jackson-mgt',
    osType: 'WINDOWS',
  });
  const framework = await repository.createFrameworkInstance(tenantId, {
    deviceId: host.id,
    frameworkType: 'web.iis',
    frameworkKey: 'iis',
    discoveryProviderKey: 'agent:test',
    displayName: 'Microsoft IIS',
  });
  const site = await repository.createSiteAsset(tenantId, {
    frameworkInstanceId: framework.id,
    deviceId: host.id,
    discoveryProviderKey: 'agent:test',
    siteType: 'web.site',
    siteName: 'TEST',
    siteKey: 'iis:test:*:4433:',
    bindingInformation: '*:4433:',
    port: 4433,
    protocol: 'HTTPS',
  });
  const managedTarget = await repository.createManagedTarget(tenantId, {
    deviceId: host.id,
    frameworkInstanceId: framework.id,
    siteId: site.id,
    discoveryProviderKey: 'agent:test',
    targetType: 'tls.binding',
    targetKey: 'iis:test:*:4433:',
    bindingKey: '*:4433:',
    supportedCapabilities: ['certificate.deploy'],
    executionLocations: ['AGENT'],
  });
  const applicationAsset = await repository.createServiceAsset(tenantId, {
    address: 'cloud.jacksonz.cn',
    port: 4433,
    protocol: 'HTTPS',
    platform: 'WINDOWS',
  });
  await repository.createApplicationAssetTarget(tenantId, {
    applicationAssetId: applicationAsset.id,
    managedTargetId: managedTarget.id,
  });
  const pluginVersionId = 'version-asset-card-logo';
  await insertCanonicalPluginVersion(database, pluginVersionId, tenantId);
  const pluginBindings = new PluginBindingsApplicationService(new PluginBindingsRepository(database));
  const pluginBinding = await pluginBindings.createBinding(tenantId, {
    pluginVersionId,
    mode: 'MANAGED',
    inputBindings: emptyInputBindingsV1(),
    managedContext: { hostId: host.id, managedTargetId: managedTarget.id },
  });
  await pluginBindings.assignCapability(tenantId, {
    ownerType: 'APPLICATION_ASSET',
    ownerId: applicationAsset.id,
    capabilityKey: 'certificate.deploy',
    pluginVersionId,
    pluginBindingId: pluginBinding.id,
    precedence: 'ASSET_OVERRIDE',
  });

  const result = await repository.listServiceAssets(tenantId, {
    page: 1,
    pageSize: 20,
    filter: { id: applicationAsset.id },
  });

  assert.equal(result.total, 1);
  assert.equal(result.items[0]?.targetBinding?.deviceDisplayName, 'jackson-mgt');
  assert.equal(result.items[0]?.targetBinding?.frameworkType, 'web.iis');
  assert.equal(result.items[0]?.targetBinding?.frameworkDisplayName, 'Microsoft IIS');
  assert.equal(result.items[0]?.targetBinding?.siteName, 'TEST');
  assert.equal(result.items[0]?.targetBinding?.pluginVersionId, pluginVersionId);

  await pluginBindings.disableOwnerAssignment(tenantId, {
    ownerType: 'APPLICATION_ASSET',
    ownerId: applicationAsset.id,
    capabilityKey: 'certificate.deploy',
  });
  const devicePluginVersionId = pluginVersionId;
  const devicePluginBinding = await pluginBindings.createBinding(tenantId, {
    pluginVersionId: devicePluginVersionId,
    mode: 'MANAGED',
    inputBindings: emptyInputBindingsV1(),
    managedContext: { hostId: host.id },
  });
  await pluginBindings.assignCapability(tenantId, {
    ownerType: 'DEVICE',
    ownerId: host.id,
    capabilityKey: 'device.discover',
    pluginVersionId: devicePluginVersionId,
    pluginBindingId: devicePluginBinding.id,
    precedence: 'DEVICE_DEFAULT',
  });
  const devicePluginResult = await repository.listServiceAssets(tenantId, {
    page: 1,
    pageSize: 20,
    filter: { id: applicationAsset.id },
  });
  assert.equal(devicePluginResult.items[0]?.targetBinding?.pluginVersionId, devicePluginVersionId);
});

test('云服务列表投影产品族、插件控制版本和真实站点数量', async () => {
  const asset = {
    id: 'cloud-service-asset',
    tenantId: 'tenant-cloud',
    assetKind: 'CLOUD_SERVICE',
    address: 'cdn.aliyuncs.com',
    addressType: 'HOSTNAME',
    port: 443,
    protocol: 'HTTPS',
    discoverySource: 'PLUGIN',
    status: 'ACTIVE',
    tags: [],
    metadata: {
      provider: 'cloud.aliyun',
      pluginId: 'cloud.aliyun',
      pluginVersionId: 'plugin-version-cloud',
      request: { apiVersion: '2018-05-10' },
    },
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:00.000Z',
    version: 1,
  };
  const repository = {
    listServiceAssets: async () => ({ items: [asset], page: 1, pageSize: 20, total: 1 }),
    getApplicationAssetTargetByApplicationAssetId: async () => undefined,
  } as any;
  const projection = {
    listForAsset: async () => ({ devices: [], frameworks: [], managedTargets: [], sites: [{ id: 'site-1' }, { id: 'site-2' }] }),
  } as any;
  const plugins = {
    getVersionForTenant: async () => ({
      id: 'plugin-version-cloud',
      pluginId: 'cloud.aliyun',
      version: '2.0.26',
      runtime: 'WORKFLOW_DSL',
      manifest: { compatibility: { productFamilies: ['cloud.aliyun.cdn'] } },
    }),
  } as any;
  const service = new AssetsApplicationService(repository);
  service.setCloudResourceProjectionService(projection);
  service.setPluginVersionResolver(plugins);

  const result = await service.listServiceAssets('tenant-cloud', { page: 1, pageSize: 20, filter: {} });
  const projected = result.items[0] as typeof asset & Record<string, unknown>;
  assert.equal(projected.productFamily, 'cloud.aliyun.cdn');
  assert.equal(projected.controlVersion, '2.0.26');
  assert.equal(projected.siteCount, 2);
  assert.equal(projected.applicationAssetCount, 2);
  assert.equal(projected.softwareVersion, '2018-05-10');
  assert.equal(projected.apiVersion, '2018-05-10');
});

test('云服务详情使用统一详情字段并显示厂商或 SDK 版本', async () => {
  const asset = {
    id: 'cloud-service-detail',
    tenantId: 'tenant-cloud-detail',
    assetKind: 'CLOUD_SERVICE',
    address: 'cdn.aliyuncs.com',
    addressType: 'HOSTNAME',
    port: 443,
    protocol: 'HTTPS',
    discoverySource: 'PLUGIN',
    status: 'ACTIVE',
    tags: [],
    metadata: {
      provider: 'cloud.aliyun',
      pluginId: 'cloud.aliyun',
      pluginVersionId: 'plugin-version-detail',
      sdkVersion: 'aliyun-sdk-cdn/3.7.2',
      request: { apiVersion: '2018-05-10' },
    },
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:00.000Z',
    version: 1,
  } as any;
  const repository = {
    getServiceAssetDetail: async () => asset,
    getApplicationAssetTargetByApplicationAssetId: async () => undefined,
  } as any;
  const projection = {
    listForAsset: async () => ({
      devices: [],
      frameworks: [{ id: 'framework-1', frameworkType: 'cloud.resource', frameworkKey: 'cdn', displayName: '阿里云 CDN', frameworkVersion: '2 resources', status: 'ACTIVE', rawFacts: {} }],
      managedTargets: [],
      sites: [{ id: 'site-1', siteName: 'example.com', siteKey: 'cloud.aliyun:cdn.domain:example.com', siteType: 'cloud.resource', status: 'ACTIVE', metadata: {} }],
    }),
  } as any;
  const plugins = {
    getVersionForTenant: async () => ({
      id: 'plugin-version-detail',
      pluginId: 'cloud.aliyun',
      version: '2.0.26',
      runtime: 'WORKFLOW_DSL',
      manifest: { compatibility: { productFamilies: ['cloud.aliyun.cdn'] } },
    }),
    getCurrentEnabledVersion: async () => ({
      id: 'plugin-version-current',
      pluginId: 'cloud.aliyun',
      version: '2.0.27',
      runtime: 'WORKFLOW_DSL',
      status: 'ENABLED',
      manifest: { compatibility: { productFamilies: ['cloud.aliyun.cdn'] } },
    }),
  } as any;
  const service = new AssetsApplicationService(repository);
  service.setCloudResourceProjectionService(projection);
  service.setPluginVersionResolver(plugins);

  const detail = await service.getServiceAssetDetail('tenant-cloud-detail', asset.id) as any;
  const fields = Object.fromEntries(detail.informationSections.flatMap((section: any) => section.fields.map((field: any) => [field.key, field.value])));
  assert.equal(detail.productFamily, 'cloud.aliyun.cdn');
  assert.equal(detail.controlVersion, '2.0.27');
  assert.equal(detail.siteCount, 1);
  assert.equal(fields.productFamily, 'cloud.aliyun.cdn');
  assert.equal(fields.pluginVersion, '2.0.27');
  assert.equal(fields.softwareVersion, 'aliyun-sdk-cdn/3.7.2');
  assert.equal(fields.siteCount, 1);
  assert.equal(fields.apiVersion, '2018-05-10');
});

test('应用资产卡片为旧设备插件版本选择当前带 Logo 的版本', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const repository = new PgAssetsRepository(database);
  const tenantId = 'tenant_application_asset_plugin_logo_upgrade';
  const host = await repository.createHost(tenantId, {
    hostname: 'npm-18181',
    displayName: 'NPM-18181',
    osType: 'NETWORK_DEVICE',
  });
  const managedTarget = await repository.createManagedTarget(tenantId, {
    deviceId: host.id,
    discoveryProviderKey: 'plugin:device.nginx-proxy-manager',
    targetType: 'tls.binding',
    targetKey: 'proxy-host:1',
    supportedCapabilities: ['certificate.deploy'],
    executionLocations: ['CONTROL_PLANE'],
  });
  const applicationAsset = await repository.createServiceAsset(tenantId, {
    address: 'npm-18181.example.com',
    port: 443,
    protocol: 'HTTPS',
  });
  await repository.createApplicationAssetTarget(tenantId, {
    applicationAssetId: applicationAsset.id,
    managedTargetId: managedTarget.id,
  });
  await insertLogoPluginVersion(database, tenantId, 'npm-old', '0.1.7', false);
  await insertLogoPluginVersion(database, tenantId, 'npm-current', '0.1.11', true);
  await database.query(
    `insert into pg_device_assets
      (service_asset_id, tenant_id, host_id, device_family, product_family, plugin_version_id, management_port, auth_mode, tls_verify, support_tier, capability_profile, metadata, created_at, updated_at, version)
     values ($1,$2,$3,'device.nginx-proxy-manager','device.nginx-proxy-manager','npm-old',443,'AUTO',true,'SUPPORTED','{}'::jsonb,'{}'::jsonb,now(),now(),1)`,
    [applicationAsset.id, tenantId, host.id],
  );

  const result = await repository.listServiceAssets(tenantId, { page: 1, pageSize: 20, filter: { id: applicationAsset.id } });
  assert.equal(result.items[0]?.targetBinding?.pluginVersionId, 'npm-current');
});

async function insertLogoPluginVersion(
  database: PgliteDatabase,
  tenantId: string,
  id: string,
  version: string,
  withLogo: boolean,
): Promise<void> {
  const manifest = {
    pluginId: 'device.nginx-proxy-manager',
    version,
    resources: withLogo ? { logos: { square: 'logos/logo-square.svg' } } : {},
  };
  await database.query(
    `insert into unified_plugin_versions
      (id, tenant_id, plugin_id, plugin_version, source, runtime, scope, trust, support, manifest, package_sha256, manifest_sha256, resource_sha256, status, permission_approval_status, approved_permissions, validation_report, created_at, updated_at)
     values ($1,$2,$3,$4,'USER','WORKFLOW_DSL','BOTH','UNSIGNED','SELF_MANAGED',$5::jsonb,'sha256:test-package','sha256:test-manifest','{}'::jsonb,$6,'NOT_REQUIRED','[]'::jsonb,'{}'::jsonb,now(),now())`,
    [id, tenantId, manifest.pluginId, version, JSON.stringify(manifest), withLogo ? 'ENABLED' : 'DISABLED'],
  );
  if (withLogo) {
    await database.query(
      `insert into unified_plugin_resources
        (plugin_version_id, resource_path, resource_content, resource_sha256, created_at)
       values ($1,'logos/logo-square.svg',$2,'sha256:test-logo',now())`,
      [id, '<svg viewBox="0 0 72 72"><rect width="72" height="72" /></svg>'],
    );
  }
}

test('应用资产部分更新保留验证 URL 并支持显式清空', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const repository = new PgAssetsRepository(database);
  const tenantId = 'tenant_application_asset_verify_url';
  const created = await repository.createServiceAsset(tenantId, {
    address: 'verify.example.com',
    port: 443,
    protocol: 'HTTPS',
    verifyUrl: 'https://verify.example.com/health',
  });

  const strategyUpdated = await repository.updateServiceAsset(tenantId, created.id, {
    deploymentStrategy: {
      type: 'MANAGED_TARGET',
      managedTarget: { managedTargetId: 'target_verify_url' },
    },
  });
  assert.equal(strategyUpdated.verifyUrl, 'https://verify.example.com/health');

  const cleared = await repository.updateServiceAsset(tenantId, created.id, { verifyUrl: '' });
  assert.equal(cleared.verifyUrl, undefined);
  assert.equal(cleared.metadata.verifyUrl, undefined);
});

test('应用资产列表投影当前证书的资产记录、监控观测和绑定版本', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const tenantId = 'tenant_application_asset_current_certificate';
  const assetsRepository = new PgAssetsRepository(database);
  const certificatesRepository = new PgCertificatesRepository(database);
  const monitorsRepository = new PgMonitorsRepository(database);
  const bindingsRepository = new PgBindingsRepository(assetsRepository, database);
  const service = new AssetsApplicationService(assetsRepository);
  service.setCertificatesRepository(certificatesRepository);
  service.setMonitorsRepository(monitorsRepository);
  service.setBindingsRepository(bindingsRepository);

  const host = await assetsRepository.createHost(tenantId, {
    hostname: 'certificate-projection-host',
    osType: 'LINUX',
  });
  const framework = await assetsRepository.createFrameworkInstance(tenantId, {
    deviceId: host.id,
    frameworkType: 'web.nginx',
    frameworkKey: 'nginx-main',
    discoveryProviderKey: 'agent:test',
    displayName: 'NGINX',
  });
  const metadataAsset = await assetsRepository.createServiceAsset(tenantId, {
    address: 'metadata.example.com',
    port: 443,
    protocol: 'HTTPS',
    metadata: {
      currentCertificate: {
        fingerprintSha256: 'AA:11',
        notAfter: '2027-02-01T00:00:00.000Z',
        verified: true,
      },
    },
  });
  const observedAsset = await assetsRepository.createServiceAsset(tenantId, {
    address: 'observed.example.com',
    port: 443,
    protocol: 'HTTPS',
  });
  const bindingAsset = await assetsRepository.createServiceAsset(tenantId, {
    address: 'binding.example.com',
    port: 443,
    protocol: 'HTTPS',
  });

  const certificateAssetId = 'certasset_current_certificate_projection';
  const certificateVersionId = 'certver_current_certificate_projection';
  const currentCertificateVersionId = 'certver_current_certificate_projection_current';
  const latestCertificateVersionId = 'certver_current_certificate_projection_latest';
  await certificatesRepository.createAsset({
    id: certificateAssetId,
    tenantId,
    name: 'projected.example.com',
    primaryDomain: 'projected.example.com',
    sans: ['projected.example.com'],
    sourceType: 'manual',
    status: 'active',
    tags: [],
    createdBy: 'test',
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z',
  });
  await certificatesRepository.createVersion({
    id: certificateVersionId,
    tenantId,
    certificateAssetId,
    versionNo: 1,
    commonName: '*.projected.example.com',
    sans: ['projected.example.com'],
    issuer: { raw: 'CN=GCAC Test CA' },
    subject: { raw: 'CN=*.projected.example.com', commonName: '*.projected.example.com' },
    serialNumber: 'certificate-projection-serial',
    notBefore: '2026-01-01T00:00:00.000Z',
    notAfter: '2027-01-01T00:00:00.000Z',
    fingerprintSha256: 'aa11',
    publicKeyAlgorithm: 'RSA',
    signatureAlgorithm: 'sha256WithRSAEncryption',
    leafStorageRef: 'artifact://certificate-projection',
    chainCertificateRefs: [],
    chainOrder: [],
    chainDiagnostics: [],
    chainStatus: 'valid',
    deployable: true,
    sourceType: 'manual',
    status: 'active',
    createdBy: 'test',
    createdAt: '2026-08-12T00:00:00.000Z',
  });
  await certificatesRepository.createVersion({
    id: currentCertificateVersionId,
    tenantId,
    certificateAssetId,
    versionNo: 2,
    commonName: '*.projected.example.com',
    sans: ['*.projected.example.com'],
    issuer: { raw: 'CN=GCAC Test CA' },
    subject: { raw: 'CN=*.projected.example.com', commonName: '*.projected.example.com' },
    serialNumber: 'certificate-projection-serial-current',
    notBefore: '2026-07-01T00:00:00.000Z',
    notAfter: '2027-07-01T00:00:00.000Z',
    fingerprintSha256: 'bb11',
    publicKeyAlgorithm: 'RSA',
    signatureAlgorithm: 'sha256WithRSAEncryption',
    leafStorageRef: 'artifact://certificate-projection-current',
    chainCertificateRefs: [],
    chainOrder: [],
    chainDiagnostics: [],
    chainStatus: 'valid',
    deployable: true,
    sourceType: 'manual',
    status: 'active',
    createdBy: 'test',
    createdAt: '2026-07-01T00:00:00.000Z',
  });
  await certificatesRepository.createVersion({
    id: latestCertificateVersionId,
    tenantId,
    certificateAssetId,
    versionNo: 3,
    commonName: '*.projected.example.com',
    sans: ['projected.example.com'],
    issuer: { raw: 'CN=GCAC Test CA' },
    subject: { raw: 'CN=*.projected.example.com', commonName: '*.projected.example.com' },
    serialNumber: 'certificate-projection-serial-latest',
    notBefore: '2026-08-01T00:00:00.000Z',
    notAfter: '2027-08-01T00:00:00.000Z',
    fingerprintSha256: 'bb22',
    publicKeyAlgorithm: 'RSA',
    signatureAlgorithm: 'sha256WithRSAEncryption',
    leafStorageRef: 'artifact://certificate-projection-latest',
    chainCertificateRefs: [],
    chainOrder: [],
    chainDiagnostics: [],
    chainStatus: 'valid',
    deployable: true,
    sourceType: 'manual',
    status: 'active',
    createdBy: 'test',
    createdAt: '2026-08-12T00:00:00.000Z',
  });
  await certificatesRepository.updateAsset(certificateAssetId, { currentVersionId: currentCertificateVersionId }, tenantId);
  await monitorsRepository.saveCertificateObservation({
    tenantId,
    serviceAssetId: observedAsset.id,
    source: 'control_plane',
    url: 'https://observed.example.com:443',
    observedAt: '2026-08-12T01:00:00.000Z',
    fingerprintSha256: 'aa:11',
    subject: 'CN=observed.example.com',
    notBefore: '2026-02-01T00:00:00.000Z',
    notAfter: '2027-03-01T00:00:00.000Z',
    verified: true,
  });
  await bindingsRepository.createCertificateBinding(tenantId, {
    serviceAssetId: bindingAsset.id,
    serviceInstanceId: framework.id,
    bindingType: 'FILE_PATH',
    verifyMethod: 'TLS_CONNECT',
    localCertificateVersionId: certificateVersionId,
  });

  const page = await service.listServiceAssets(tenantId, {
    page: 1,
    pageSize: 20,
    filter: {},
  });
  const byAddress = new Map(page.items.map((item) => [item.address, item]));

  const metadataCertificate = byAddress.get('metadata.example.com')?.currentCertificate;
  assert.equal(metadataCertificate?.commonName, '*.projected.example.com');
  assert.equal(metadataCertificate?.notAfter, '2027-02-01T00:00:00.000Z');
  assert.equal(metadataCertificate?.source, 'asset_metadata');

  const observedCertificate = byAddress.get('observed.example.com')?.currentCertificate;
  assert.equal(observedCertificate?.commonName, '*.projected.example.com');
  assert.equal(observedCertificate?.notAfter, '2027-03-01T00:00:00.000Z');
  assert.equal(observedCertificate?.source, 'control_plane');
  assert.equal(observedCertificate?.verified, true);

  const bindingCertificate = byAddress.get('binding.example.com')?.currentCertificate;
  assert.equal(bindingCertificate?.versionId, certificateVersionId);
  assert.equal(bindingCertificate?.commonName, '*.projected.example.com');
  assert.equal(bindingCertificate?.source, 'binding_version');
  assert.equal(bindingCertificate?.updateAvailable, true);

  const latestBindingAsset = await assetsRepository.createServiceAsset(tenantId, {
    address: 'latest-binding.example.com',
    port: 443,
    protocol: 'HTTPS',
  });
  await bindingsRepository.createCertificateBinding(tenantId, {
    serviceAssetId: latestBindingAsset.id,
    serviceInstanceId: framework.id,
    domainName: 'latest-binding.example.com',
    bindingType: 'FILE_PATH',
    verifyMethod: 'TLS_CONNECT',
    localCertificateVersionId: latestCertificateVersionId,
  });
  const latestPage = await service.listServiceAssets(tenantId, {
    page: 1,
    pageSize: 20,
    filter: {},
  });
  const latestBindingCertificate = latestPage.items.find((item) => item.address === 'latest-binding.example.com')?.currentCertificate;
  assert.equal(latestBindingCertificate?.versionId, latestCertificateVersionId);
  assert.equal(latestBindingCertificate?.updateAvailable, false);

  const stagedBindingAsset = await assetsRepository.createServiceAsset(tenantId, {
    address: 'staged-binding.example.com',
    port: 443,
    protocol: 'HTTPS',
  });
  await bindingsRepository.createCertificateBinding(tenantId, {
    serviceAssetId: stagedBindingAsset.id,
    serviceInstanceId: framework.id,
    domainName: 'staged-binding.example.com',
    bindingType: 'FILE_PATH',
    verifyMethod: 'TLS_CONNECT',
    localCertificateVersionId: currentCertificateVersionId,
  });
  const stagedPage = await service.listServiceAssets(tenantId, {
    page: 1,
    pageSize: 20,
    filter: {},
  });
  const stagedBindingCertificate = stagedPage.items.find((item) => item.address === 'staged-binding.example.com')?.currentCertificate;
  assert.equal(stagedBindingCertificate?.versionId, currentCertificateVersionId);
  assert.equal(stagedBindingCertificate?.updateAvailable, true);

  const discoveredBindingAsset = await assetsRepository.createServiceAsset(tenantId, {
    address: 'discovered-binding.example.com',
    port: 8444,
    protocol: 'HTTPS',
  });
  await bindingsRepository.createCertificateBinding(tenantId, {
    serviceAssetId: discoveredBindingAsset.id,
    serviceInstanceId: framework.id,
    domainName: 'discovered-binding.example.com',
    bindingType: 'FILE_PATH',
    verifyMethod: 'TLS_CONNECT',
    metadata: {
      configuredCertificate: {
        path: 'C:/GCAC-Lab/certs/apache.crt.pem',
        source: 'runtime-effective-config',
        subject: 'CN=discovered-binding.example.com',
        issuer: 'CN=GCAC Lab Root CA',
        notBefore: '2026-08-04T02:29:03.000Z',
        notAfter: '2028-11-06T02:29:03.000Z',
        fingerprintSha256: 'E9B4E249F18616E2DC55D429D2C07087096258B87EA4C4A7864E355CA250251A',
      },
    },
  });
  const discoveredPage = await service.listServiceAssets(tenantId, {
    page: 1,
    pageSize: 50,
    filter: {},
  });
  const discoveredCertificate = discoveredPage.items.find((item) => item.address === 'discovered-binding.example.com')?.currentCertificate;
  assert.equal(discoveredCertificate?.versionId, undefined);
  assert.equal(discoveredCertificate?.commonName, 'discovered-binding.example.com');
  assert.equal(discoveredCertificate?.subject?.raw, 'CN=discovered-binding.example.com');
  assert.equal(discoveredCertificate?.fingerprintSha256, 'E9B4E249F18616E2DC55D429D2C07087096258B87EA4C4A7864E355CA250251A');
  assert.equal(discoveredCertificate?.notAfter, '2028-11-06T02:29:03.000Z');
  assert.equal(discoveredCertificate?.source, 'runtime-effective-config');
});
