import assert from 'node:assert/strict';
import test from 'node:test';
import { runMigrations } from '../../database/migration-runner.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { PgAssetsRepository } from '../assets/repository/assets.repository.js';
import { PgCertificatesRepository } from '../certificates/repository/certificates.repository.js';
import { PgBindingsRepository } from './repository/bindings.repository.js';

test('证书绑定 usage 能从站点和受管目标恢复真实应用，并严格隔离证书版本', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const assets = new PgAssetsRepository(db);
  const certificates = new PgCertificatesRepository(db);
  const bindings = new PgBindingsRepository(assets, db);
  const tenantId = 'tenant_certificate_usage_relation';
  const certificateAssetId = 'certasset_usage_relation';
  await certificates.createAsset({
    id: certificateAssetId,
    tenantId,
    name: 'usage-relation.example.test',
    primaryDomain: 'usage-relation.example.test',
    sans: [],
    sourceType: 'manual',
    status: 'active',
    tags: [],
    createdBy: 'test',
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
  });
  for (const [id, versionNo] of [
    ['version-site', 1],
    ['version-target', 2],
    ['version-other', 3],
    ['version-scan', 4],
  ] as const) {
    await certificates.createVersion({
      id,
      tenantId,
      certificateAssetId,
      versionNo,
      commonName: 'usage-relation.example.test',
      sans: [],
      issuer: { raw: 'CN=Test Issuer' },
      subject: { raw: 'CN=usage-relation.example.test' },
      serialNumber: `serial-${id}`,
      notBefore: '2026-08-26T00:00:00.000Z',
      notAfter: '2027-08-26T00:00:00.000Z',
      fingerprintSha256: id.padEnd(64, '0'),
      publicKeyAlgorithm: 'RSA',
      signatureAlgorithm: 'sha256WithRSAEncryption',
      leafStorageRef: `artifact://${id}`,
      chainCertificateRefs: [],
      chainOrder: [],
      chainDiagnostics: [],
      chainStatus: 'valid',
      deployable: true,
      sourceType: 'manual',
      status: 'active',
      createdBy: 'test',
      createdAt: '2026-08-26T00:00:00.000Z',
    });
  }

  const host = await assets.createHost(tenantId, { hostname: 'usage-relation-host', osType: 'LINUX' });
  const framework = await assets.createFrameworkInstance(tenantId, {
    deviceId: host.id,
    frameworkType: 'web.nginx',
    frameworkKey: 'nginx',
    discoveryProviderKey: 'test:usage-relation',
    displayName: 'Nginx',
  });

  const siteApplication = await assets.createServiceAsset(tenantId, {
    address: 'app-site.example.test',
    displayName: '站点应用',
    port: 443,
    protocol: 'HTTPS',
    serviceInstanceId: framework.id,
    hostId: host.id,
  });
  const linkedSite = await assets.createSiteAsset(tenantId, {
    frameworkInstanceId: framework.id,
    deviceId: host.id,
    serviceAssetId: siteApplication.id,
    discoveryProviderKey: 'test:usage-relation',
    siteType: 'web.site',
    siteName: 'Linked site',
    siteKey: 'linked-site',
    hostHeader: 'unmatched-site.example.test',
    port: 443,
    protocol: 'HTTPS',
  });

  const targetApplication = await assets.createServiceAsset(tenantId, {
    address: 'app-target.example.test',
    displayName: '目标应用',
    port: 8443,
    protocol: 'HTTPS',
    serviceInstanceId: framework.id,
    hostId: host.id,
  });
  const targetSite = await assets.createSiteAsset(tenantId, {
    frameworkInstanceId: framework.id,
    deviceId: host.id,
    discoveryProviderKey: 'test:usage-relation',
    siteType: 'web.site',
    siteName: 'Target site',
    siteKey: 'target-site',
    hostHeader: 'unmatched-target.example.test',
    port: 8443,
    protocol: 'HTTPS',
  });
  const managedTarget = await assets.createManagedTarget(tenantId, {
    deviceId: host.id,
    frameworkInstanceId: framework.id,
    siteId: targetSite.id,
    discoveryProviderKey: 'test:usage-relation',
    targetType: 'tls.binding',
    targetKey: 'target-site',
    supportedCapabilities: ['certificate.deploy'],
    executionLocations: ['AGENT'],
  });
  await assets.createApplicationAssetTarget(tenantId, {
    applicationAssetId: targetApplication.id,
    managedTargetId: managedTarget.id,
  });

  const siteBinding = await bindings.createCertificateBinding(tenantId, {
    serviceInstanceId: framework.id,
    siteAssetId: linkedSite.id,
    domainName: 'unmatched-site.example.test',
    port: 443,
    protocol: 'HTTPS',
    bindingKey: 'linked-site-binding',
    bindingType: 'FILE_PATH',
    certPath: '/etc/nginx/linked-site.pem',
    verifyMethod: 'TLS_CONNECT',
    certificateVersionId: 'version-site',
  });
  assert.equal(siteBinding.serviceAssetId, undefined, '测试必须覆盖绑定自身没有 ServiceAsset 的历史形态');

  const targetBinding = await bindings.createCertificateBinding(tenantId, {
    serviceInstanceId: framework.id,
    managedTargetId: managedTarget.id,
    siteAssetId: targetSite.id,
    domainName: 'unmatched-target.example.test',
    port: 8443,
    protocol: 'HTTPS',
    bindingKey: 'linked-target-binding',
    bindingType: 'FILE_PATH',
    certPath: '/etc/nginx/linked-target.pem',
    verifyMethod: 'TLS_CONNECT',
    certificateVersionId: 'version-target',
  });
  assert.equal(targetBinding.serviceAssetId, undefined, 'ApplicationAssetTarget 关联不应被复制到绑定自身');

  const siteUsage = await bindings.findCertificateBindingUsages(tenantId, { certificateVersionId: 'version-site' });
  assert.equal(siteUsage.length, 1);
  assert.equal(siteUsage[0]?.serviceAsset?.id, siteApplication.id);
  assert.equal(siteUsage[0]?.serviceAsset?.displayName, '站点应用');

  const targetUsage = await bindings.findCertificateBindingUsages(tenantId, { certificateVersionId: 'version-target' });
  assert.equal(targetUsage.length, 1);
  assert.equal(targetUsage[0]?.serviceAsset?.id, targetApplication.id);
  assert.equal(targetUsage[0]?.serviceAsset?.displayName, '目标应用');

  const wrongVersionUsage = await bindings.findCertificateBindingUsages(tenantId, { certificateVersionId: 'version-other' });
  assert.equal(wrongVersionUsage.length, 0, '同站点绑定到其他版本时不得被当前版本带入');

  const scanSite = await assets.createSiteAsset(tenantId, {
    frameworkInstanceId: framework.id,
    deviceId: host.id,
    discoveryProviderKey: 'test:usage-relation',
    siteType: 'web.site',
    siteName: 'Scan only',
    siteKey: 'scan-only',
    hostHeader: 'scan-only.example.test',
    port: 9443,
    protocol: 'HTTPS',
  });
  const scanBinding = await bindings.createCertificateBinding(tenantId, {
    serviceInstanceId: framework.id,
    siteAssetId: scanSite.id,
    domainName: 'scan-only.example.test',
    port: 9443,
    protocol: 'HTTPS',
    bindingKey: 'scan-only-binding',
    bindingType: 'FILE_PATH',
    certPath: '/etc/nginx/scan-only.pem',
    verifyMethod: 'TLS_CONNECT',
    certificateVersionId: 'version-scan',
  });
  assert.equal(scanBinding.serviceAssetId, undefined);
  const scanUsage = await bindings.findCertificateBindingUsages(tenantId, { certificateVersionId: 'version-scan' });
  assert.equal(scanUsage.length, 1);
  assert.equal(scanUsage[0]?.serviceAsset, undefined, '没有添加到应用列表的扫描站点不得显示为应用');
});
