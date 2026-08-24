import assert from 'node:assert/strict';
import test from 'node:test';
import { AutomationTargetSelector } from './application/automation-target-selector.js';

test('目标预览按到期、环境、标签和权限筛选并解释排除原因', async () => {
  const bindings = {
    listCertificateBindings: async () => ({ page: 1, pageSize: 5000, total: 3, items: [
      { id: 'b1', tenantId: 't', serviceAssetId: 's1', serviceInstanceId: 'i', bindingKey: '1', bindingType: 'FILE', verifyMethod: 'TLS_CONNECT', status: 'MANAGED', targetCertificateVersionId: 'v1', metadata: {}, createdAt: '', updatedAt: '', version: 1 },
      { id: 'b2', tenantId: 't', serviceAssetId: 's2', serviceInstanceId: 'i', bindingKey: '2', bindingType: 'FILE', verifyMethod: 'TLS_CONNECT', status: 'DISCOVERED', targetCertificateVersionId: 'v2', metadata: {}, createdAt: '', updatedAt: '', version: 1 },
      { id: 'b3', tenantId: 't', serviceAssetId: 's3', serviceInstanceId: 'i', bindingKey: '3', bindingType: 'FILE', verifyMethod: 'TLS_CONNECT', status: 'MANAGED', targetCertificateVersionId: 'v3', metadata: {}, createdAt: '', updatedAt: '', version: 1 },
    ] }),
  };
  const versions = new Map([
    ['v1', { id: 'v1', certificateAssetId: 'c1', notAfter: '2026-07-25T00:00:00.000Z', deployable: true }],
    ['v2', { id: 'v2', certificateAssetId: 'c2', notAfter: '2026-07-26T00:00:00.000Z', deployable: true }],
    ['v3', { id: 'v3', certificateAssetId: 'c3', notAfter: '2026-07-27T00:00:00.000Z', deployable: false }],
  ]);
  const certificates = {
    getVersion: async (id: string) => versions.get(id),
    getAsset: async (id: string) => ({ id, name: id, status: 'ACTIVE', tags: ['prod'] }),
  };
  const assets = {
    getServiceAsset: async (_tenant: string, id: string) => ({ id, address: `${id}.example.com`, environment: 'production', hostId: `h${id}` }),
    getHost: async () => ({ ownerId: 'owner_1' }),
  };
  const selector = new AutomationTargetSelector(certificates as never, bindings as never, assets as never, {
    canReadTarget: async ({ bindingId }) => bindingId !== 'b3',
  }, () => new Date('2026-07-21T00:00:00.000Z'));
  const preview = await selector.preview({
    tenantId: 't', actorId: 'u', automationId: 'a', automationVersion: 1, configurationChecksum: 'x',
    selector: { expiresWithinDays: 10, environments: ['production'], tags: ['prod'], ownerIds: ['owner_1'] },
    guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 2, requirePreview: true, requireDryRun: true, requireApproval: true, allowedEnvironments: ['production'] },
  });
  assert.equal(preview.totalMatched, 3);
  assert.equal(preview.executableCount, 1);
  assert.deepEqual(preview.excludedReasons, { binding_not_managed: 1, permission_denied: 1 });
});

test('预览稳定分页且不创建任何业务对象', async () => {
  let reads = 0;
  const selector = new AutomationTargetSelector({
    getVersion: async () => ({ id: 'v', certificateAssetId: 'c', notAfter: '2026-07-22T00:00:00.000Z', deployable: true }),
    getAsset: async () => ({ id: 'c', name: 'cert', status: 'ACTIVE', tags: [] }),
  } as never, {
    listCertificateBindings: async () => ({ page: 1, pageSize: 5000, total: 2, items: ['1', '2'].map((id) => ({ id, tenantId: 't', serviceInstanceId: 'i', bindingKey: id, bindingType: 'FILE', verifyMethod: 'TLS_CONNECT', status: 'MANAGED', targetCertificateVersionId: 'v', metadata: {}, createdAt: '', updatedAt: '', version: 1 })) }),
  } as never, {
    getServiceAsset: async () => { reads += 1; return undefined; }, getHost: async () => undefined,
  } as never, undefined, () => new Date('2026-07-21T00:00:00.000Z'));
  const preview = await selector.preview({ tenantId: 't', actorId: 'u', automationId: 'a', automationVersion: 1, configurationChecksum: 'x', selector: {}, guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 1, requirePreview: true, requireDryRun: false, requireApproval: false }, page: 2, pageSize: 1 });
  assert.equal(reads, 0);
  assert.equal(preview.items.length, 1);
  assert.equal(preview.items[0]?.target.bindingId, '2');
});

test('按证书域名筛选现有绑定并冻结最新证书版本', async () => {
  const currentVersion = { id: 'v1', certificateAssetId: 'c1', versionNo: 1, notAfter: '2026-08-01T00:00:00.000Z', deployable: true };
  const latestVersion = { id: 'v2', certificateAssetId: 'c1', versionNo: 2, notAfter: '2026-10-01T00:00:00.000Z', deployable: true };
  const selector = new AutomationTargetSelector({
    getVersion: async () => currentVersion,
    getAsset: async () => ({ id: 'c1', name: 'example.com', primaryDomain: 'example.com', sans: ['www.example.com'], status: 'ACTIVE', tags: [] }),
    listVersionsByAsset: async () => [currentVersion, latestVersion],
  } as never, {
    listCertificateBindings: async () => ({ page: 1, pageSize: 5000, total: 1, items: [{ id: 'b1', tenantId: 't', serviceAssetId: 's1', serviceInstanceId: 'i', bindingKey: '1', bindingType: 'FILE', verifyMethod: 'TLS_CONNECT', status: 'MANAGED', targetCertificateVersionId: 'v1', metadata: {}, createdAt: '', updatedAt: '', version: 1 }] }),
  } as never, {
    getServiceAsset: async () => ({ id: 's1', displayName: '生产站点', environment: 'production' }),
    getHost: async () => undefined,
  } as never);

  const preview = await selector.preview({
    tenantId: 't', actorId: 'u', automationId: 'a', automationVersion: 1, configurationChecksum: 'x',
    selector: { certificateDomains: ['WWW.EXAMPLE.COM.'], certificateVersionSelection: 'latest' },
    guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 1, requirePreview: true, requireDryRun: true, requireApproval: true },
  });

  assert.equal(preview.executableCount, 1);
  assert.equal(preview.items[0]?.target.certificateVersionId, 'v2');
  latestVersion.id = 'v3';
  assert.equal(preview.items[0]?.target.certificateVersionId, 'v2');
});

test('指定证书版本时只为所属证书资产冻结选定版本', async () => {
  const versions = [
    { id: 'v1', certificateAssetId: 'c1', versionNo: 1, deployable: true },
    { id: 'v2', certificateAssetId: 'c1', versionNo: 2, deployable: true },
  ];
  const selector = new AutomationTargetSelector({
    getVersion: async () => versions[0],
    getAsset: async () => ({ id: 'c1', name: 'example.com', primaryDomain: 'example.com', sans: [], status: 'ACTIVE', tags: [] }),
    listVersionsByAsset: async () => versions,
  } as never, {
    listCertificateBindings: async () => ({ page: 1, pageSize: 5000, total: 1, items: [{ id: 'b1', tenantId: 't', serviceAssetId: 's1', serviceInstanceId: 'i', bindingKey: '1', bindingType: 'FILE', verifyMethod: 'TLS_CONNECT', status: 'MANAGED', targetCertificateVersionId: 'v1', metadata: {}, createdAt: '', updatedAt: '', version: 1 }] }),
  } as never, {
    getServiceAsset: async () => ({ id: 's1', displayName: '生产站点', environment: 'production' }),
    getHost: async () => undefined,
  } as never);

  const preview = await selector.preview({
    tenantId: 't', actorId: 'u', automationId: 'a', automationVersion: 1, configurationChecksum: 'x',
    selector: { certificateDomains: ['example.com'], certificateVersionSelection: 'specific', certificateVersionIds: ['v2'] },
    guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 1, requirePreview: true, requireDryRun: true, requireApproval: true },
  });

  assert.equal(preview.executableCount, 1);
  assert.equal(preview.items[0]?.target.certificateVersionId, 'v2');
});
