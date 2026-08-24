import assert from 'node:assert/strict';
import test from 'node:test';

import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { AssetsApplicationService } from './application/assets.application-service.js';
import { PgBindingsRepository } from '../bindings/repository/bindings.repository.js';
import { PgCertificatesRepository } from '../certificates/repository/certificates.repository.js';
import { PgMonitorsRepository } from '../monitors/repository/monitors.repository.js';
import { PgAssetsRepository } from './repository/assets.repository.js';

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
});

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
