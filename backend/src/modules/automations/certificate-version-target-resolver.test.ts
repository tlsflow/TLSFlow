import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../common/errors/app-error.js';
import { CertificateVersionTargetResolver } from './application/certificate-version-target-resolver.js';

test('证书事件解析器按明确选择的应用资产计算版本影响', async () => {
  const bindings = [
    {
      id: 'binding-a',
      serviceAssetId: 'asset-a',
      status: 'MANAGED',
      localCertificateVersionId: 'current-a-local',
      certificateVersionId: 'current-a-record',
      targetCertificateVersionId: 'current-a-target',
      deletedAt: undefined,
    },
    {
      id: 'binding-b',
      serviceAssetId: 'asset-b',
      status: 'MANAGED',
      localCertificateVersionId: undefined,
      certificateVersionId: 'current-b-record',
      targetCertificateVersionId: 'current-b-target',
      deletedAt: undefined,
    },
    {
      id: 'binding-c',
      serviceAssetId: 'asset-c',
      status: 'MANAGED',
      localCertificateVersionId: undefined,
      certificateVersionId: undefined,
      targetCertificateVersionId: 'current-c-target',
      deletedAt: undefined,
    },
    { id: 'binding-other', serviceAssetId: 'asset-other', status: 'MANAGED', targetCertificateVersionId: 'current-other', certificateVersionId: undefined, deletedAt: undefined },
  ];
  const versions = new Map([
    ['target', { id: 'target', certificateAssetId: 'certificate-target', name: 'example.com', versionNo: 4, notAfter: '2026-12-01T00:00:00.000Z', deployable: true }],
    ['current-a-local', { id: 'current-a-local', certificateAssetId: 'certificate-old', versionNo: 99, notAfter: '2026-08-01T00:00:00.000Z', deployable: true }],
    ['current-a-record', { id: 'current-a-record', certificateAssetId: 'certificate-old', versionNo: 2, notAfter: '2027-08-01T00:00:00.000Z', deployable: true }],
    ['current-a-target', { id: 'current-a-target', certificateAssetId: 'certificate-old', versionNo: 1, notAfter: '2025-08-01T00:00:00.000Z', deployable: true }],
    ['current-b-record', { id: 'current-b-record', certificateAssetId: 'certificate-target', versionNo: 9, notAfter: '2026-12-01T00:00:00.000Z', deployable: true }],
    ['current-b-target', { id: 'current-b-target', certificateAssetId: 'certificate-target', versionNo: 1, notAfter: '2025-12-01T00:00:00.000Z', deployable: true }],
    ['current-c-target', { id: 'current-c-target', certificateAssetId: 'certificate-target', versionNo: 2, notAfter: '2027-01-01T00:00:00.000Z', deployable: true }],
    ['current-other', { id: 'current-other', certificateAssetId: 'certificate-target', versionNo: 1, notAfter: '2026-06-01T00:00:00.000Z', deployable: true }],
  ]);
  const resolver = new CertificateVersionTargetResolver(
    {
      getVersion: async (id: string) => versions.get(id),
      getVersionByFingerprint: async () => undefined,
      getAsset: async () => ({ id: 'certificate-target', name: 'example.com', tags: [] }),
    } as never,
    {
      listCertificateBindings: async () => ({ page: 1, pageSize: 5000, total: bindings.length, items: bindings }),
    } as never,
    {
      getServiceAssetDetail: async () => undefined,
      getServiceAsset: async (_tenantId: string, id: string) => ({ id, displayName: id, environment: 'production' }),
      getHost: async () => undefined,
    } as never,
    { canReadTarget: async () => true },
  );

  const items = await resolver.resolve({
    tenantId: 'tenant-1',
    actorId: 'user-1',
    triggerContext: { certificateVersionId: 'target', certificateAssetId: 'certificate-target', sourceType: 'manual_import' },
    resolver: { type: 'certificate_version_targets', assetIds: ['asset-a', 'asset-b', 'asset-c'] },
    guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 2, requirePreview: true, requireDryRun: true, requireApproval: true },
  });

  assert.equal(items.length, 3);
  assert.deepEqual(items.map((item) => item.target.assetId), ['asset-a', 'asset-b', 'asset-c']);
  assert.equal(items[0]?.target.certificateVersionImpact, 'upgrade');
  assert.equal(items[1]?.target.certificateVersionImpact, 'same');
  assert.equal(items[2]?.target.certificateVersionImpact, 'downgrade');
  assert.equal(items[0]?.executable, true);
  assert.equal(items[1]?.executable, false);
  assert.equal(items[1]?.excludedReason, 'certificate_already_up_to_date');
  assert.equal(items[2]?.executable, false);
  assert.equal(items[2]?.excludedReason, 'certificate_version_downgrade');
  assert.equal(items[0]?.target.currentCertificateVersionId, 'current-a-local');
  assert.equal(items[0]?.target.currentCertificateNotAfter, '2026-08-01T00:00:00.000Z');
  assert.equal(items[0]?.target.targetCertificateNotAfter, '2026-12-01T00:00:00.000Z');
});

test('证书版本事件优先使用证书资产所属应用，忽略过期的静态目标', async () => {
  const versions = new Map([
    ['target', { id: 'target', certificateAssetId: 'certificate-target', name: 'test.jacksonz.cn', versionNo: 2, notAfter: '2027-01-01T00:00:00.000Z', deployable: true }],
    ['current-test', { id: 'current-test', certificateAssetId: 'certificate-target', versionNo: 1, notAfter: '2026-01-01T00:00:00.000Z', deployable: true }],
  ]);
  const resolver = new CertificateVersionTargetResolver(
    {
      getVersion: async (id: string) => versions.get(id),
      getVersionByFingerprint: async () => undefined,
      getAsset: async () => ({ id: 'certificate-target', applicationAssetId: 'application-test', name: 'dedicated:test.jacksonz.cn', primaryDomain: 'test.jacksonz.cn', tags: [] }),
    } as never,
    {
      listCertificateBindings: async () => ({ page: 1, pageSize: 5000, total: 1, items: [{ id: 'binding-test', serviceAssetId: 'application-test', status: 'MANAGED', certificateVersionId: 'current-test', deletedAt: undefined }] }),
    } as never,
    {
      getApplicationAssetTargetByApplicationAssetId: async () => undefined,
      getServiceAssetDetail: async (_tenantId: string, id: string) => ({ id, displayName: 'test.jacksonz.cn', environment: 'production', metadata: {}, targetBindingDetail: { certificateBindings: [] }, targetSnapshots: [] }),
      getServiceAsset: async (_tenantId: string, id: string) => ({ id, displayName: 'test.jacksonz.cn', environment: 'production' }),
      getHost: async () => undefined,
    } as never,
    { canReadTarget: async () => true },
  );

  const items = await resolver.resolve({
    tenantId: 'tenant-1',
    actorId: 'user-1',
    triggerContext: { certificateVersionId: 'target', certificateAssetId: 'certificate-target', sourceType: 'manual_import' },
    resolver: { type: 'certificate_version_targets', assetIds: ['application-cns'] },
    guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 1, requirePreview: true, requireDryRun: false, requireApproval: false },
  });

  assert.deepEqual(items.map((item) => item.target.assetId), ['application-test']);
});

test('证书事件解析器仅在显式允许时将有效期降级目标标为可执行', async () => {
  const versions = new Map([
    ['target', { id: 'target', certificateAssetId: 'certificate-target', name: 'example.com', versionNo: 4, notAfter: '2026-10-30T00:00:00.000Z', deployable: true }],
    ['current', { id: 'current', certificateAssetId: 'certificate-target', versionNo: 5, notAfter: '2026-11-04T00:00:00.000Z', deployable: true }],
  ]);
  const resolver = new CertificateVersionTargetResolver(
    {
      getVersion: async (id: string) => versions.get(id),
      getVersionByFingerprint: async () => undefined,
      getAsset: async () => ({ id: 'certificate-target', name: 'example.com', tags: [] }),
    } as never,
    {
      listCertificateBindings: async () => ({
        page: 1,
        pageSize: 5000,
        total: 1,
        items: [{ id: 'binding-a', serviceAssetId: 'asset-a', status: 'MANAGED', certificateVersionId: 'current', deletedAt: undefined }],
      }),
    } as never,
    {
      getServiceAssetDetail: async (_tenantId: string, id: string) => ({
        id,
        address: 'app.example.com',
        port: 443,
        protocol: 'HTTPS',
        discoverySource: 'MANUAL',
        status: 'ACTIVE',
        tags: [],
        metadata: {},
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
        version: 1,
        targetBindingDetail: { certificateBindings: [] },
        targetSnapshots: [],
      }),
      getServiceAsset: async (_tenantId: string, id: string) => ({ id, displayName: id, environment: 'production' }),
      getHost: async () => undefined,
    } as never,
    { canReadTarget: async () => true },
  );
  const input = {
    tenantId: 'tenant-1',
    actorId: 'user-1',
    triggerContext: { certificateVersionId: 'target', certificateAssetId: 'certificate-target' },
    resolver: { type: 'certificate_version_targets' as const, assetIds: ['asset-a'] },
    guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 2, requirePreview: true, requireDryRun: false, requireApproval: false },
  };

  const automaticItems = await resolver.resolve(input);
  assert.equal(automaticItems[0]?.executable, false);
  assert.equal(automaticItems[0]?.excludedReason, 'certificate_version_downgrade');

  const manualItems = await resolver.resolve({ ...input, allowCertificateDowngrade: true });
  assert.equal(manualItems[0]?.executable, true);
  assert.equal(manualItems[0]?.excludedReason, undefined);
});

test('证书事件解析器复用应用资产当前证书信息，而不是只依赖绑定版本字段', async () => {
  const bindings = [
    { id: 'binding-a', serviceAssetId: 'asset-a', status: 'MANAGED', certificateVersionId: undefined, targetCertificateVersionId: undefined, deletedAt: undefined },
    { id: 'binding-b', serviceAssetId: 'asset-b', status: 'MANAGED', certificateVersionId: undefined, targetCertificateVersionId: undefined, deletedAt: undefined },
  ];
  const versions = new Map([
    ['target', { id: 'target', certificateAssetId: 'certificate-target', name: 'example.com', versionNo: 4, notAfter: '2026-11-04T09:08:33.000Z', deployable: true }],
    ['snapshot-current', { id: 'snapshot-current', certificateAssetId: 'certificate-target', versionNo: 2, notAfter: '2026-08-01T00:00:00.000Z', deployable: true }],
  ]);
  const resolver = new CertificateVersionTargetResolver(
    {
      getVersion: async (id: string) => versions.get(id),
      getVersionByFingerprint: async (fingerprint: string) => fingerprint === 'ABC123' ? versions.get('snapshot-current') : undefined,
      getAsset: async () => ({ id: 'certificate-target', name: 'example.com', tags: [] }),
    } as never,
    {
      listCertificateBindings: async () => ({ page: 1, pageSize: 5000, total: bindings.length, items: bindings }),
    } as never,
    {
      getServiceAssetDetail: async (_tenantId: string, id: string) => {
        if (id === 'asset-a') {
          return {
            id,
            address: 'test01.jacksonz.cn',
            port: 443,
            protocol: 'HTTPS',
            discoverySource: 'MANUAL',
            status: 'ACTIVE',
            tags: [],
            metadata: { currentCertificateNotAfter: '2026-08-01T00:00:00.000Z' },
            createdAt: '2026-08-01T00:00:00.000Z',
            updatedAt: '2026-08-01T00:00:00.000Z',
            version: 1,
            targetBindingDetail: { certificateBindings: [] },
            targetSnapshots: [],
          };
        }
        if (id === 'asset-b') {
          return {
            id,
            address: 'test02.jacksonz.cn',
            port: 443,
            protocol: 'HTTPS',
            discoverySource: 'MANUAL',
            status: 'ACTIVE',
            tags: [],
            metadata: {},
            createdAt: '2026-08-01T00:00:00.000Z',
            updatedAt: '2026-08-01T00:00:00.000Z',
            version: 1,
            targetBindingDetail: {
              certificateBindings: [
                {
                  id: 'binding-b',
                  observedFingerprintSha256: 'ab:c1:23',
                  certificateVersionId: undefined,
                  targetCertificateVersionId: undefined,
                },
              ],
            },
            targetSnapshots: [
              {
                id: 'snapshot-b',
                certificateBindingId: 'binding-b',
                metadata: {
                  detail: {
                    verify: {
                      remoteCertificateSha256: 'abc123',
                    },
                  },
                },
                capturedAt: '2026-08-02T00:00:00.000Z',
              },
            ],
          };
        }
        return undefined;
      },
      getServiceAsset: async (_tenantId: string, id: string) => ({ id, displayName: id, environment: 'production' }),
      getHost: async () => undefined,
    } as never,
    { canReadTarget: async () => true },
  );

  const items = await resolver.resolve({
    tenantId: 'tenant-1',
    actorId: 'user-1',
    triggerContext: { certificateVersionId: 'target', certificateAssetId: 'certificate-target', sourceType: 'manual_import' },
    resolver: { type: 'certificate_version_targets', assetIds: ['asset-a', 'asset-b'] },
    guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 2, requirePreview: true, requireDryRun: true, requireApproval: true },
  });

  assert.equal(items.length, 2);
  assert.equal(items[0]?.target.currentCertificateNotAfter, '2026-08-01T00:00:00.000Z');
  assert.equal(items[0]?.target.certificateVersionImpact, 'upgrade');
  assert.equal(items[1]?.target.currentCertificateVersionId, 'snapshot-current');
  assert.equal(items[1]?.target.currentCertificateNotAfter, '2026-08-01T00:00:00.000Z');
  assert.equal(items[1]?.target.certificateVersionImpact, 'upgrade');
});

test('证书事件解析器会按 managedTargetId 复用应用资产绑定，并把到期一致的目标标记为跳过更新', async () => {
  const bindings = [
    { id: 'binding-a', managedTargetId: 'managed-a', status: 'MANAGED', certificateVersionId: undefined, targetCertificateVersionId: undefined, deletedAt: undefined },
    { id: 'binding-b', managedTargetId: 'managed-b', status: 'MANAGED', certificateVersionId: undefined, targetCertificateVersionId: undefined, deletedAt: undefined },
  ];
  const versions = new Map([
    ['target', { id: 'target', certificateAssetId: 'certificate-target', name: 'example.com', versionNo: 4, notAfter: '2026-11-04T00:00:00.000Z', deployable: true }],
  ]);
  const resolver = new CertificateVersionTargetResolver(
    {
      getVersion: async (id: string) => versions.get(id),
      getVersionByFingerprint: async () => undefined,
      getAsset: async () => ({ id: 'certificate-target', name: 'example.com', tags: [] }),
    } as never,
    {
      listCertificateBindings: async () => ({ page: 1, pageSize: 5000, total: bindings.length, items: bindings }),
    } as never,
    {
      getApplicationAssetTargetByApplicationAssetId: async (_tenantId: string, assetId: string) => assetId === 'asset-a'
        ? { id: 'target-a', applicationAssetId: assetId, managedTargetId: 'managed-a', status: 'ACTIVE', metadata: {}, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', version: 1 }
        : { id: 'target-b', applicationAssetId: assetId, managedTargetId: 'managed-b', status: 'ACTIVE', metadata: {}, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', version: 1 },
      getServiceAssetDetail: async (_tenantId: string, id: string) => ({
        id,
        address: `${id}.example.com`,
        port: 443,
        protocol: 'HTTPS',
        discoverySource: 'MANUAL',
        status: 'ACTIVE',
        tags: [],
        metadata: { currentCertificateNotAfter: id === 'asset-a' ? '2026-10-30T00:00:00.000Z' : '2026-11-04T00:00:00.000Z' },
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
        version: 1,
        targetBindingDetail: {
          certificateBindings: [
            { id: id === 'asset-a' ? 'binding-a' : 'binding-b', managedTargetId: id === 'asset-a' ? 'managed-a' : 'managed-b' },
          ],
        },
        targetSnapshots: [],
      }),
      getServiceAsset: async (_tenantId: string, id: string) => ({ id, displayName: id, environment: 'production' }),
      getHost: async () => undefined,
    } as never,
    { canReadTarget: async () => true },
  );

  const items = await resolver.resolve({
    tenantId: 'tenant-1',
    actorId: 'user-1',
    triggerContext: { certificateVersionId: 'target', certificateAssetId: 'certificate-target', sourceType: 'manual_import' },
    resolver: { type: 'certificate_version_targets', assetIds: ['asset-a', 'asset-b'] },
    guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 2, requirePreview: true, requireDryRun: true, requireApproval: true },
  });

  assert.equal(items.length, 2);
  assert.equal(items[0]?.executable, true);
  assert.equal(items[0]?.target.certificateVersionImpact, 'upgrade');
  assert.equal(items[1]?.executable, false);
  assert.equal(items[1]?.excludedReason, 'certificate_already_up_to_date');
});

test('证书事件解析器按应用资产去重，重复绑定不会重复展示资产记录', async () => {
  const bindings = [
    { id: 'binding-a-1', managedTargetId: 'managed-a', status: 'MANAGED', certificateVersionId: undefined, targetCertificateVersionId: undefined, deletedAt: undefined },
    { id: 'binding-a-2', managedTargetId: 'managed-a', status: 'MANAGED', certificateVersionId: undefined, targetCertificateVersionId: undefined, deletedAt: undefined },
    { id: 'binding-b-1', managedTargetId: 'managed-b', status: 'MANAGED', certificateVersionId: undefined, targetCertificateVersionId: undefined, deletedAt: undefined },
    { id: 'binding-b-2', managedTargetId: 'managed-b', status: 'MANAGED', certificateVersionId: undefined, targetCertificateVersionId: undefined, deletedAt: undefined },
  ];
  const versions = new Map([
    ['target', { id: 'target', certificateAssetId: 'certificate-target', name: 'example.com', versionNo: 4, notAfter: '2026-11-04T00:00:00.000Z', deployable: true }],
  ]);
  const resolver = new CertificateVersionTargetResolver(
    {
      getVersion: async (id: string) => versions.get(id),
      getVersionByFingerprint: async () => undefined,
      getAsset: async () => ({ id: 'certificate-target', name: 'example.com', tags: [] }),
    } as never,
    {
      listCertificateBindings: async () => ({ page: 1, pageSize: 5000, total: bindings.length, items: bindings }),
    } as never,
    {
      getApplicationAssetTargetByApplicationAssetId: async (_tenantId: string, assetId: string) => assetId === 'asset-a'
        ? { id: 'target-a', applicationAssetId: assetId, managedTargetId: 'managed-a', status: 'ACTIVE', metadata: {}, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', version: 1 }
        : { id: 'target-b', applicationAssetId: assetId, managedTargetId: 'managed-b', status: 'ACTIVE', metadata: {}, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', version: 1 },
      getServiceAssetDetail: async (_tenantId: string, id: string) => ({
        id,
        address: `${id}.example.com`,
        port: 443,
        protocol: 'HTTPS',
        discoverySource: 'MANUAL',
        status: 'ACTIVE',
        tags: [],
        metadata: { currentCertificateNotAfter: id === 'asset-a' ? '2026-10-30T00:00:00.000Z' : '2026-11-04T00:00:00.000Z' },
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
        version: 1,
        targetBindingDetail: {
          certificateBindings: [
            { id: id === 'asset-a' ? 'binding-a-1' : 'binding-b-1', managedTargetId: id === 'asset-a' ? 'managed-a' : 'managed-b' },
          ],
        },
        targetSnapshots: [],
      }),
      getServiceAsset: async (_tenantId: string, id: string) => ({ id, displayName: id, environment: 'production' }),
      getHost: async () => undefined,
    } as never,
    { canReadTarget: async () => true },
  );

  const items = await resolver.resolve({
    tenantId: 'tenant-1',
    actorId: 'user-1',
    triggerContext: { certificateVersionId: 'target', certificateAssetId: 'certificate-target', sourceType: 'manual_import' },
    resolver: { type: 'certificate_version_targets', assetIds: ['asset-a', 'asset-b'] },
    guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 2, requirePreview: true, requireDryRun: true, requireApproval: true },
  });

  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => item.target.assetId), ['asset-a', 'asset-b']);
  assert.equal(items[0]?.target.certificateVersionImpact, 'upgrade');
  assert.equal(items[1]?.excludedReason, 'certificate_already_up_to_date');
});

test('证书事件解析器忽略已删除应用资产的历史选择 ID', async () => {
  const versions = new Map([
    ['target', { id: 'target', certificateAssetId: 'certificate-target', name: 'example.com', versionNo: 4, notAfter: '2026-11-04T00:00:00.000Z', deployable: true }],
  ]);
  const resolver = new CertificateVersionTargetResolver(
    {
      getVersion: async (id: string) => versions.get(id),
      getVersionByFingerprint: async () => undefined,
      getAsset: async () => ({ id: 'certificate-target', name: 'example.com', tags: [] }),
    } as never,
    {
      listCertificateBindings: async () => ({ page: 1, pageSize: 5000, total: 0, items: [] }),
    } as never,
    {
      getServiceAssetDetail: async () => undefined,
      getServiceAsset: async (_tenantId: string, id: string) => id === 'asset-active'
        ? { id, displayName: '当前应用', environment: 'production' }
        : undefined,
      getHost: async () => undefined,
    } as never,
    { canReadTarget: async () => true },
  );

  const items = await resolver.resolve({
    tenantId: 'tenant-1',
    actorId: 'user-1',
    triggerContext: { certificateVersionId: 'target', certificateAssetId: 'certificate-target', sourceType: 'manual_import' },
    resolver: { type: 'certificate_version_targets', assetIds: ['asset-active', 'asset-deleted'] },
    guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 2, requirePreview: true, requireDryRun: true, requireApproval: true },
  });

  assert.equal(items.length, 1);
  assert.equal(items[0]?.target.assetId, 'asset-active');
  assert.equal(items[0]?.excludedReason, 'binding_missing');
});

test('证书事件解析器忽略已删除资产残留的 ManagedTarget 关联', async () => {
  const versions = new Map([
    ['target', { id: 'target', certificateAssetId: 'certificate-target', name: 'example.com', versionNo: 4, notAfter: '2026-11-04T00:00:00.000Z', deployable: true }],
  ]);
  const resolver = new CertificateVersionTargetResolver(
    {
      getVersion: async (id: string) => versions.get(id),
      getVersionByFingerprint: async () => undefined,
      getAsset: async () => ({ id: 'certificate-target', name: 'example.com', tags: [] }),
    } as never,
    {
      listCertificateBindings: async () => ({
        page: 1,
        pageSize: 5000,
        total: 1,
        items: [{
          id: 'binding-deleted',
          managedTargetId: 'managed-deleted',
          status: 'MANAGED',
          certificateVersionId: undefined,
          targetCertificateVersionId: undefined,
          deletedAt: undefined,
        }],
      }),
    } as never,
    {
      getApplicationAssetTargetByApplicationAssetId: async () => ({
        id: 'target-deleted',
        applicationAssetId: 'asset-deleted',
        managedTargetId: 'managed-deleted',
        status: 'ACTIVE',
        metadata: {},
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
        version: 1,
      }),
      getServiceAssetDetail: async () => undefined,
      getServiceAsset: async () => undefined,
      getHost: async () => undefined,
    } as never,
    { canReadTarget: async () => true },
  );

  const items = await resolver.resolve({
    tenantId: 'tenant-1',
    actorId: 'user-1',
    triggerContext: { certificateVersionId: 'target', certificateAssetId: 'certificate-target', sourceType: 'manual_import' },
    resolver: { type: 'certificate_version_targets', assetIds: ['asset-deleted'] },
    guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 2, requirePreview: true, requireDryRun: true, requireApproval: true },
  });

  assert.equal(items.length, 0);
});

test('外部 API 传入证书版本号时解析为真实版本并返回应用资产明细', async () => {
  const targetVersion = {
    id: 'certificate-version-5',
    certificateAssetId: 'certificate-target',
    versionNo: 5,
    notAfter: '2026-10-25T00:00:00.000Z',
    deployable: true,
  };
  const currentVersion = {
    id: 'certificate-version-4',
    certificateAssetId: 'certificate-target',
    versionNo: 4,
    notAfter: '2026-09-25T00:00:00.000Z',
    deployable: true,
  };
  const resolver = new CertificateVersionTargetResolver(
    {
      getVersion: async (id: string) => id === targetVersion.id ? targetVersion : id === currentVersion.id ? currentVersion : undefined,
      listVersions: async () => ({ page: 1, pageSize: 1000, total: 1, items: [targetVersion] }),
      getVersionByFingerprint: async () => undefined,
      getAsset: async () => ({ id: 'certificate-target', name: '*.example.com', primaryDomain: 'example.com', tags: [] }),
    } as never,
    {
      listCertificateBindings: async () => ({
        page: 1,
        pageSize: 5000,
        total: 1,
        items: [{ id: 'binding-1', serviceAssetId: 'asset-1', status: 'MANAGED', certificateVersionId: currentVersion.id, deletedAt: undefined }],
      }),
    } as never,
    {
      getServiceAssetDetail: async () => undefined,
      getServiceAsset: async () => ({ id: 'asset-1', displayName: 'app.example.com', environment: 'production' }),
      getHost: async () => undefined,
    } as never,
    { canReadTarget: async () => true },
  );

  const items = await resolver.resolve({
    tenantId: 'tenant-1',
    actorId: 'external:api-key',
    triggerContext: { certificateVersionId: '5', sourceType: 'external_api', domains: ['example.com'] },
    resolver: { type: 'certificate_version_targets' },
    guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 2, requirePreview: true, requireDryRun: false, requireApproval: false },
  });

  assert.equal(items.length, 1);
  assert.equal(items[0]?.executable, true);
  assert.equal(items[0]?.target.certificateVersionId, targetVersion.id);
  assert.equal(items[0]?.target.assetId, 'asset-1');
  assert.equal(items[0]?.target.assetName, 'app.example.com');
  assert.equal(items[0]?.target.bindingId, 'binding-1');
  assert.equal(items[0]?.target.currentCertificateNotAfter, currentVersion.notAfter);
  assert.equal(items[0]?.target.targetCertificateNotAfter, targetVersion.notAfter);
  assert.equal(items[0]?.target.certificateVersionImpact, 'upgrade');
});

test('外部 API 证书版本不属于自动化预设域名时拒绝', async () => {
  const resolver = new CertificateVersionTargetResolver(
    {
      getVersion: async () => ({ id: 'version-other-domain', certificateAssetId: 'certificate-other', versionNo: 1, notAfter: '2026-10-25T00:00:00.000Z', deployable: true }),
      getAsset: async () => ({ id: 'certificate-other', name: 'other.example.net', primaryDomain: 'other.example.net', tags: [] }),
    } as never,
    {} as never,
    {} as never,
    { canReadTarget: async () => true },
  );

  await assert.rejects(
    () => resolver.resolve({
      tenantId: 'tenant-1',
      actorId: 'external:api-key',
      triggerContext: { certificateVersionId: 'version-other-domain', sourceType: 'external_api', domains: ['example.com'] },
      resolver: { type: 'certificate_version_targets' },
      guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 2, requirePreview: true, requireDryRun: false, requireApproval: false },
    }),
    (error: unknown) => error instanceof AppError && error.errorCode === 'VALIDATION_FAILED' && error.message.includes('预设域名'),
  );
});
