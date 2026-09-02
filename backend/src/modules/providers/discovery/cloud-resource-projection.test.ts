import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { runMigrations } from '../../../database/migration-runner.js';
import { CloudResourceProjectionService } from './cloud-resource-projection.js';
import { CloudAccountAssetsApplicationService } from '../application/cloud-account-assets.application-service.js';
import { PgAssetsRepository } from '../../assets/repository/assets.repository.js';
import { PgBindingsRepository } from '../../bindings/repository/bindings.repository.js';
import { PgCertificatesRepository } from '../../certificates/repository/certificates.repository.js';
import { AssetsApplicationService } from '../../assets/application/assets.application-service.js';

const resource = {
  apiVersion: 'gcac.cloud-service/v1',
  kind: 'CloudServiceResource',
  stableKey: 'cloud.aliyun:cdn.domain:resource-1',
  pluginId: 'cloud.aliyun',
  pluginVersionId: 'cloud.aliyun:2.0.1',
  provider: 'cloud.aliyun',
  resourceId: 'resource-1',
  resourceType: 'cdn.domain',
  region: 'cn-hangzhou',
  displayName: 'example.com',
  metadata: { domain: 'example.com' },
} as const;

const resourceWithCertificateEndpoint = {
  ...resource,
  targetType: 'cloud.aliyun.cdn.certificate',
  targetKey: 'example.com',
  supportedCapabilities: ['cloud.resource.discover', 'certificate.deploy'],
  executionLocations: ['CONTROL_PLANE'],
} as const;

function context(tenantId = 'tenant-projection', assetId = 'caa_projection') {
  return {
    tenantId,
    cloudAccountAssetId: assetId,
    pluginId: 'cloud.aliyun',
    pluginVersionId: 'cloud.aliyun:2.0.1',
    provider: 'cloud.aliyun',
    discoveryProviderKey: 'cloud.aliyun:2.0.1:discover',
    discoveredAt: '2026-08-16T00:00:00.000Z',
  } as const;
}

function serviceAssetContext(tenantId = 'tenant-service-asset', assetId = 'service-asset-projection') {
  return {
    tenantId,
    serviceAssetId: assetId,
    pluginId: 'cloud.aliyun',
    pluginVersionId: 'cloud.aliyun:2.0.1',
    provider: 'cloud.aliyun',
    discoveryProviderKey: 'cloud.aliyun:2.0.1:discover',
    discoveredAt: '2026-08-16T00:00:00.000Z',
  } as const;
}

test('标准 ServiceAsset 所有者不会把 assetId 写入 Framework 元数据', () => {
  const projection = new CloudResourceProjectionService().project(serviceAssetContext(), resourceWithCertificateEndpoint);
  assert.equal(projection.framework.serviceAssetId, 'service-asset-projection');
  assert.equal(projection.framework.assetId, undefined);
  assert.equal(projection.framework.rawFacts.assetId, undefined);
  assert.equal(projection.framework.rawFacts.serviceAssetId, 'service-asset-projection');
});

test('投影上下文禁止同时传入 ServiceAsset 和历史 CloudAccountAsset 所有者', () => {
  assert.throws(() => new CloudResourceProjectionService().project({
    ...serviceAssetContext(),
    cloudAccountAssetId: 'legacy-cloud-account',
  }, resource), /必须二选一/);
});

test('普通 Cloud Resource 只生成 Framework/Site，不默认伪造 ManagedTarget', () => {
  const service = new CloudResourceProjectionService();
  const first = service.project(context(), resource);
  const second = service.project(context(), { ...resource, displayName: 'changed display name' });
  assert.equal(first.device, undefined);
  assert.equal(first.managedTarget, undefined);
  assert.equal(first.framework.id, second.framework.id);
  assert.equal(first.site.id, second.site.id);
  assert.deepEqual(service.preview(context(), [resource]), { devices: 0, frameworks: 1, sites: 1, managedTargets: 0 });
});

test('插件显式声明证书更换端点时才生成 ManagedTarget，且端点参与稳定 ID', () => {
  const service = new CloudResourceProjectionService();
  const first = service.project(context(), resourceWithCertificateEndpoint);
  const second = service.project(context(), {
    ...resourceWithCertificateEndpoint,
    metadata: {
      ...resourceWithCertificateEndpoint.metadata,
      certificateEndpoints: [{
        endpointKey: 'certificate-api',
        targetType: 'cloud.aliyun.cdn.certificate',
        targetKey: 'example.com',
        supportedCapabilities: ['certificate.deploy'],
        executionLocations: ['CONTROL_PLANE'],
      }],
    },
    targetType: undefined,
    targetKey: undefined,
    supportedCapabilities: undefined,
    executionLocations: undefined,
  });
  assert.equal(first.managedTarget?.targetType, 'cloud.aliyun.cdn.certificate');
  assert.equal(first.managedTarget?.targetKey, 'example.com');
  assert.notEqual(first.managedTarget?.id, second.managedTarget?.id);
  assert.equal(second.managedTarget?.metadata.certificateEndpointKey, 'certificate-api');
});

test('账号级 CDN 投影不创建伪设备，区域生成 Framework，实例生成 Site', () => {
  const service = new CloudResourceProjectionService();
  const projection = service.projectBatch({
    ...context(),
    topology: 'ACCOUNT_FRAMEWORK',
    providerDisplayName: '阿里云 CDN',
  }, [
    { ...resource, frameworkKey: 'cdn.mainland', frameworkDisplayName: '阿里云 CDN · 中国大陆', metadata: { cdnRegion: 'mainland', cdnRegionName: '中国大陆' } },
    {
      ...resource,
      stableKey: 'cloud.aliyun:cdn.domain:global.example',
      resourceId: 'global.example',
      displayName: 'global.example',
      region: 'global',
      frameworkKey: 'cdn.global',
      frameworkDisplayName: '阿里云 CDN · 国际站',
      metadata: { cdnRegion: 'global', cdnRegionName: '国际站' },
    },
  ]);
  assert.equal(projection.devices.length, 0);
  assert.deepEqual(projection.frameworks.map((item) => [item.frameworkKey, item.displayName]), [
    ['cdn.global', '阿里云 CDN · 国际站'],
    ['cdn.mainland', '阿里云 CDN · 中国大陆'],
  ]);
  assert.equal(projection.sites.length, 2);
  assert.ok(projection.sites.every((site) => site.deviceId === undefined));
  assert.deepEqual(service.preview({ ...context(), topology: 'ACCOUNT_FRAMEWORK' }, [resource]), { devices: 0, frameworks: 1, sites: 1, managedTargets: 0 });
});

test('账号级 CDN 投影将历史全球文案规范化为国际站', () => {
  const projection = new CloudResourceProjectionService().projectBatch({
    ...context(),
    topology: 'ACCOUNT_FRAMEWORK',
    providerDisplayName: '阿里云 CDN',
  }, [{
    ...resource,
    region: 'global',
    frameworkKey: 'cdn.global',
    frameworkDisplayName: '阿里云 CDN · 国际站',
    metadata: { cdnRegion: 'global', cdnRegionName: '全球' },
  }]);
  assert.equal(projection.frameworks.find((item) => item.frameworkKey === 'cdn.global')?.displayName, '阿里云 CDN · 国际站');
});

test('账号级 CDN 没有域名时不生成空的中国大陆或国际站 Framework', () => {
  const service = new CloudResourceProjectionService();
  const projection = service.projectBatch({
    ...context(),
    topology: 'ACCOUNT_FRAMEWORK',
    providerDisplayName: '阿里云 CDN',
  }, []);
  assert.equal(projection.devices.length, 0);
  assert.deepEqual(projection.frameworks, []);
  assert.equal(projection.sites.length, 0);
});

test('账号级拓扑完全使用插件声明的 Framework 分组，不依赖厂商名称', () => {
  const service = new CloudResourceProjectionService();
  const genericContext = {
    tenantId: 'tenant-generic-provider',
    cloudAccountAssetId: 'account-generic-provider',
    pluginId: 'cloud.example',
    pluginVersionId: 'cloud.example:1.0.0',
    provider: 'cloud.example',
    topology: 'ACCOUNT_FRAMEWORK' as const,
  };
  const first = {
    apiVersion: 'gcac.cloud-service/v1' as const,
    kind: 'CloudServiceResource' as const,
    stableKey: 'cloud.example:database:one',
    pluginId: 'cloud.example',
    pluginVersionId: 'cloud.example:1.0.0',
    provider: 'cloud.example',
    resourceId: 'one',
    resourceType: 'database',
    region: 'region-a',
    frameworkKey: 'database.primary',
    frameworkDisplayName: 'Primary databases',
  };
  const second = { ...first, stableKey: 'cloud.example:database:two', resourceId: 'two', region: 'region-b' };
  const projection = service.projectBatch(genericContext, [first, second]);
  assert.deepEqual(projection.frameworks.map((item) => [item.frameworkKey, item.displayName]), [['database.primary', 'Primary databases']]);
  assert.equal(projection.sites.length, 2);
});

test('Cloud Resource provenance、stableKey 和跨租户资产边界失败关闭', async () => {
  const service = new CloudResourceProjectionService();
  assert.throws(() => service.project(context(), { ...resource, pluginVersionId: 'cloud.aliyun:2.0.2' }), /provenance/);
  assert.throws(() => service.project(context(), { ...resource, stableKey: 'cloud.aliyun:cdn.domain:other' }), /stableKey/);

  const db = new PgliteDatabase();
  await runMigrations(db);
  const assets = new CloudAccountAssetsApplicationService(db);
  await assets.create('tenant-projection-other', {
    displayName: '其他租户账号',
    providerKey: 'cloud.aliyun',
    accountId: 'account-other',
    credentialRef: 'credential://other',
  });
  await assert.rejects(
    () => new CloudResourceProjectionService(db).persist(context('tenant-projection', 'caa_missing'), resource),
    (error: unknown) => error instanceof Error && error.message.includes('不属于当前租户'),
  );
  await db.close();
});

test('同一云产品跨区域投影为多个 ManagedTarget，每个目标拥有自己的 Framework 和 Site', () => {
  const service = new CloudResourceProjectionService();
  const second = {
    ...resource,
    stableKey: 'cloud.aliyun:cdn.domain:resource-2',
    resourceId: 'resource-2',
    region: 'cn-shanghai',
    displayName: 'example.cn',
  };
  const projection = service.projectBatch(context(), [resource, second]);
  assert.equal(projection.devices.length, 0);
  assert.equal(projection.frameworks.length, 2);
  assert.equal(projection.sites.length, 2);
  assert.notEqual(projection.frameworks[0]?.id, projection.frameworks[1]?.id);
  assert.notEqual(projection.sites[0]?.frameworkId, projection.sites[1]?.frameworkId);
  assert.equal(projection.managedTargets.length, 0);
  assert.deepEqual(service.preview(context(), [resource, second]), { devices: 0, frameworks: 2, sites: 2, managedTargets: 0 });
});

test('区域资源不伪装成设备、Framework、Site 或 ManagedTarget', async () => {
  const service = new CloudResourceProjectionService();
  const regions = Array.from({ length: 32 }, (_, index) => `cn-test-${String(index).padStart(2, '0')}`);
  const resources = regions.map((region) => ({
    ...resource,
    stableKey: `cloud.aliyun:cloud.region:${region}`,
    resourceId: region,
    resourceType: 'cloud.region',
    region,
  }));
  const projection = service.projectBatch(context(), resources);
  assert.equal(projection.devices.length, 0);
  assert.equal(projection.frameworks.length, 0);
  assert.equal(projection.sites.length, 0);
  assert.equal(projection.managedTargets.length, 0);

  const db = new PgliteDatabase();
  await runMigrations(db);
  const assets = new CloudAccountAssetsApplicationService(db);
  const asset = await assets.create('tenant-projection', {
    displayName: '多区域投影账号',
    providerKey: 'cloud.aliyun',
    accountId: 'account-projection-regions',
    credentialRef: 'credential://projection-regions',
  });
  const persisted = await new CloudResourceProjectionService(db).persistBatch({ ...context('tenant-projection', asset.id) }, resources);
  assert.equal(persisted.devices.length, 0);
  const targetCount = await db.query<{ count: number }>(
    `select count(*) as count from pg_managed_targets where tenant_id=$1 and asset_id=$2 and deleted_at is null`,
    ['tenant-projection', asset.id],
  );
  assert.equal(Number(targetCount.rows[0]?.count), 0);
  await db.close();
});

test('Projection persist 在真实迁移上按稳定 ID 幂等合并并保持 Asset 拓扑关系', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const assets = new CloudAccountAssetsApplicationService(db);
  const asset = await assets.create('tenant-projection', {
    displayName: '投影账号',
    providerKey: 'cloud.aliyun',
    accountId: 'account-projection',
    credentialRef: 'credential://projection',
  });
  const service = new CloudResourceProjectionService(db);
  const first = await service.persist({ ...context('tenant-projection', asset.id) }, resourceWithCertificateEndpoint);
  const second = await service.persist({ ...context('tenant-projection', asset.id) }, { ...resourceWithCertificateEndpoint, displayName: '更新后的域名' });
  assert.equal(first.framework.id, second.framework.id);
  const counts = await db.query<{ framework_count: number; site_count: number; target_count: number }>(
    `select
       (select count(*) from pg_framework_instances where id=$1) as framework_count,
       (select count(*) from pg_site_assets where id=$2) as site_count,
       (select count(*) from pg_managed_targets where asset_id=$3 and deleted_at is null) as target_count`,
    [first.framework.id, first.site.id, asset.id],
  );
  assert.deepEqual(counts.rows[0], { framework_count: 1, site_count: 1, target_count: 1 });
  const listed = await service.listForAsset('tenant-projection', asset.id);
  assert.equal(listed.frameworks.length, 1);
  assert.equal(listed.sites.length, 1);
  assert.equal(listed.sites[0]?.siteName, '更新后的域名');
  const topology = await db.query<{ framework_asset_id: string; site_asset_id: string }>(
    `select framework.asset_id as framework_asset_id, site.asset_id as site_asset_id
       from pg_framework_instances framework
       join pg_site_assets site on site.framework_instance_id=framework.id
      where framework.id=$1`,
    [first.framework.id],
  );
  assert.deepEqual(topology.rows[0], {
    framework_asset_id: asset.id,
    site_asset_id: asset.id,
  });
  await db.close();
});

test('Projection batch persist 重复发现保持单 Framework、多 Site 和 ManagedTarget', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const assets = new CloudAccountAssetsApplicationService(db);
  const asset = await assets.create('tenant-projection', {
    displayName: '批量投影账号',
    providerKey: 'cloud.aliyun',
    accountId: 'account-projection-batch',
    credentialRef: 'credential://projection-batch',
  });
  const second = {
    ...resource,
    stableKey: 'cloud.aliyun:cdn.domain:resource-2',
    resourceId: 'resource-2',
    displayName: 'example.cn',
  };
  const secondWithEndpoint = {
    ...resourceWithCertificateEndpoint,
    ...second,
    targetKey: 'example.cn',
  };
  const service = new CloudResourceProjectionService(db);
  const first = await service.persistBatch({ ...context('tenant-projection', asset.id) }, [resourceWithCertificateEndpoint, secondWithEndpoint]);
  await service.persistBatch({ ...context('tenant-projection', asset.id) }, [resourceWithCertificateEndpoint, secondWithEndpoint]);
  const counts = await db.query<{ framework_count: number; site_count: number; target_count: number }>(
    `select
       (select count(*) from pg_framework_instances where asset_id=$1 and deleted_at is null) as framework_count,
       (select count(*) from pg_site_assets where asset_id=$1 and deleted_at is null) as site_count,
       (select count(*) from pg_managed_targets where asset_id=$1 and deleted_at is null) as target_count`,
    [asset.id],
  );
  assert.deepEqual(counts.rows[0], { framework_count: 1, site_count: 2, target_count: 2 });
  assert.equal(first.devices.length, 0);
  assert.equal(first.managedTargets.length, 2);
  assert.equal(first.frameworks[0]?.id, first.sites[0]?.frameworkId);
  const targetTopology = await db.query<{ asset_id: string; site_id: string; framework_instance_id: string }>(
    `select asset_id, site_id, framework_instance_id from pg_managed_targets where asset_id=$1 and deleted_at is null order by target_key`,
    [asset.id],
  );
  assert.equal(targetTopology.rows.length, 2);
  assert.ok(targetTopology.rows.every((row) => row.asset_id === asset.id && row.site_id && row.framework_instance_id));
  await db.close();
});

test('详情投影隐藏没有 ACTIVE Site 的孤立 Framework', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const assets = new PgAssetsRepository(db);
  const asset = await assets.createServiceAsset('tenant-orphan-framework', {
    address: 'cloud.aliyun.example', port: 443, protocol: 'HTTPS', assetKind: 'CLOUD_SERVICE', displayName: '孤立框架账号',
    metadata: { pluginId: 'cloud.aliyun' },
  });
  const service = new CloudResourceProjectionService(db);
  const persisted = await service.persist({ ...serviceAssetContext('tenant-orphan-framework', asset.id) }, resource);
  await db.query('update pg_site_assets set status=$1 where id=$2', ['STALE', persisted.site.id]);

  const listed = await service.listForAsset('tenant-orphan-framework', asset.id, 'SERVICE_ASSET');
  assert.equal(listed.sites.length, 0);
  assert.equal(listed.frameworks.length, 0);
  await db.close();
});

test('云 CDN 证书事实会持久化为 Site 绑定，未匹配证书库时保留未纳管指纹', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const assets = new PgAssetsRepository(db);
  const asset = await assets.createServiceAsset('tenant-projection', {
    address: 'cloud.aliyun.example', port: 443, protocol: 'HTTPS', assetKind: 'CLOUD_SERVICE', displayName: '证书绑定账号',
    metadata: { pluginId: 'cloud.aliyun', credentialRef: 'credential://cert' },
  });
  const certificateResource = {
    ...resourceWithCertificateEndpoint,
    metadata: {
      domainName: 'example.com',
      certificate: {
        providerCertificateId: 'cas-001',
        fingerprintSha256: 'sha256:' + 'b'.repeat(64),
        subject: 'CN=example.com',
        issuer: 'CN=Example CA',
        notBefore: '2026-01-01T00:00:00Z',
        notAfter: '2027-01-01T00:00:00Z',
      },
    },
  };
  const projection = await new CloudResourceProjectionService(db).persist({ ...serviceAssetContext('tenant-projection', asset.id) }, certificateResource);
  const binding = (await db.query<{ service_asset_id: string; site_asset_id: string; managed_target_id: string; host_id: string | null; certificate_version_id: string | null; unmanaged_certificate_fingerprint: string | null; status: string }>(
    'select service_asset_id, site_asset_id, managed_target_id, host_id, certificate_version_id, unmanaged_certificate_fingerprint, status from pg_certificate_bindings where tenant_id=$1',
    ['tenant-projection'],
  )).rows[0];
  assert.equal(binding?.service_asset_id, asset.id);
  assert.equal(binding?.site_asset_id, projection.site.id);
  assert.equal(binding?.managed_target_id, projection.managedTarget?.id);
  assert.equal(binding?.host_id, null);
  assert.equal(binding?.certificate_version_id, null);
  assert.equal(binding?.unmanaged_certificate_fingerprint, 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
  assert.equal(binding?.status, 'DISCOVERED');
  await db.close();
});

test('云 CDN 证书指纹命中项目证书库，并由统一详情返回证书资产和版本关联', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const assetsRepository = new PgAssetsRepository(db);
  const certificatesRepository = new PgCertificatesRepository(db);
  const asset = await assetsRepository.createServiceAsset('tenant-projection', {
    address: 'cloud.aliyun.example', port: 443, protocol: 'HTTPS', assetKind: 'CLOUD_SERVICE', displayName: '已纳管证书账号',
    metadata: { pluginId: 'cloud.aliyun', credentialRef: 'credential://managed-cert' },
  });
  const certificateAssetId = 'certasset_cloud_projection_managed';
  const certificateVersionId = 'certver_cloud_projection_managed';
  const fingerprint = 'C'.repeat(64);
  await certificatesRepository.createAsset({
    id: certificateAssetId,
    tenantId: 'tenant-projection',
    name: 'example.com',
    primaryDomain: 'example.com',
    sans: ['example.com'],
    sourceType: 'manual',
    status: 'active',
    tags: [],
    createdBy: 'test',
    createdAt: '2026-08-16T00:00:00.000Z',
    updatedAt: '2026-08-16T00:00:00.000Z',
  });
  await certificatesRepository.createVersion({
    id: certificateVersionId,
    tenantId: 'tenant-projection',
    certificateAssetId,
    versionNo: 1,
    commonName: 'example.com',
    sans: ['example.com'],
    issuer: { raw: 'CN=Example CA', commonName: 'Example CA' },
    subject: { raw: 'CN=example.com', commonName: 'example.com' },
    serialNumber: 'cloud-projection-managed-serial',
    notBefore: '2026-01-01T00:00:00.000Z',
    notAfter: '2027-01-01T00:00:00.000Z',
    fingerprintSha256: fingerprint,
    publicKeyAlgorithm: 'RSA',
    signatureAlgorithm: 'sha256WithRSAEncryption',
    leafStorageRef: 'artifact://cloud-projection-managed',
    chainCertificateRefs: [],
    chainOrder: [],
    chainDiagnostics: [],
    chainStatus: 'valid',
    deployable: true,
    sourceType: 'manual',
    status: 'active',
    createdBy: 'test',
    createdAt: '2026-08-16T00:00:00.000Z',
  });
  const resourceWithManagedCertificate = {
    ...resourceWithCertificateEndpoint,
    metadata: {
      domainName: 'example.com',
      certificate: {
        providerCertificateId: 'cas-managed-001',
      },
    },
  };
  const projection = new CloudResourceProjectionService(db);
  await projection.persist({ ...serviceAssetContext('tenant-projection', asset.id) }, resourceWithManagedCertificate);
  const binding = (await db.query<{ certificate_version_id: string | null; unmanaged_certificate_fingerprint: string | null }>(
    'select certificate_version_id, unmanaged_certificate_fingerprint from pg_certificate_bindings where tenant_id=$1',
    ['tenant-projection'],
  )).rows[0];
  assert.equal(binding?.certificate_version_id, certificateVersionId);
  assert.equal(binding?.unmanaged_certificate_fingerprint, null);

  const detailService = new AssetsApplicationService(
    assetsRepository,
    undefined,
    new PgBindingsRepository(assetsRepository, db),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    certificatesRepository,
    undefined,
    undefined,
    undefined,
    projection,
  );
  const detail = await detailService.getServiceAssetDetail('tenant-projection', asset.id) as Record<string, any>;
  const site = detail.sites?.[0];
  const certificate = site?.bindings?.[0]?.certificate;
  assert.equal(certificate?.certificateAssetId, certificateAssetId);
  assert.equal(certificate?.certificateVersionId, certificateVersionId);
  assert.equal(detail.certificates?.[0]?.certificateAssetId, certificateAssetId);
  assert.equal(detail.resourceCounts?.certificates, 1);

  // 历史投影可能只有 Site 元数据；详情读取仍需恢复证书卡片并关联证书库版本。
  await db.query('update pg_certificate_bindings set deleted_at=now() where tenant_id=$1', ['tenant-projection']);
  const historicalDetail = await detailService.getServiceAssetDetail('tenant-projection', asset.id) as Record<string, any>;
  const historicalCertificate = historicalDetail.sites?.[0]?.bindings?.[0]?.certificate;
  assert.equal(historicalCertificate?.certificateAssetId, certificateAssetId);
  assert.equal(historicalCertificate?.certificateVersionId, certificateVersionId);
  await db.close();
});
