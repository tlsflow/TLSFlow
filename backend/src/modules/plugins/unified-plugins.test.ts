import assert from 'node:assert/strict';
import test from 'node:test';
import type { UnifiedPluginVersionRecord } from './dto/unified-plugins.dto.js';
import { UnifiedPluginsApplicationService } from './application/unified-plugins.application-service.js';
import { hostLocales } from './locales/plugin-locale.service.js';
import type { UnifiedPluginsRepository } from './repository/unified-plugins.repository.js';

test('统一插件版本不可覆盖且生命周期需要权限审批', async () => {
  const records = new Map<string, UnifiedPluginVersionRecord>();
  const repository = memoryRepository(records);
  const service = new UnifiedPluginsApplicationService(repository);
  const input = workflowPluginInput();
  const imported = await service.importVersion('tenant-1', input);
  assert.equal(imported.status, 'PENDING_APPROVAL');
  await assert.rejects(() => service.enableVersion(imported.id), /权限尚未完成审批/);
  const approved = await service.approvePermissions(imported.id, ['network.http']);
  assert.equal(approved.status, 'DISABLED');
  assert.equal((await service.enableVersion(imported.id)).status, 'ENABLED');
  assert.equal((await service.disableVersion(imported.id)).status, 'DISABLED');
  const same = await service.importVersion('tenant-1', input);
  assert.equal(same.id, imported.id);
  await assert.rejects(
    () => service.importVersion('tenant-1', { ...input, packageContent: 'changed' }),
    /不可覆盖/,
  );
});

test('统一插件拒绝任意可执行资源和缺失资源', async () => {
  const service = new UnifiedPluginsApplicationService(memoryRepository(new Map()));
  await assert.rejects(
    () => service.importVersion('tenant-1', { ...workflowPluginInput(), resources: {} }),
    /资源缺失/,
  );
  await assert.rejects(
    () => service.importVersion('tenant-1', {
      ...workflowPluginInput(),
      resources: { 'workflows/deploy.json': '{}', 'scripts/run.js': 'console.log(1)' },
    }),
    /普通插件不得携带可执行代码/,
  );
  await assert.rejects(
    () => service.importVersion('tenant-1', {
      ...workflowPluginInput(),
      manifest: { ...(workflowPluginInput().manifest as Record<string, unknown>), source: 'BUILTIN' },
    }),
    /安装通道决定/,
  );
  await assert.rejects(
    () => service.importVersion('tenant-1', {
      ...workflowPluginInput(),
      manifest: { ...(workflowPluginInput().manifest as Record<string, unknown>), unexpected: true },
    }),
    /未知字段/,
  );
  await assert.rejects(
    () => service.importVersion('tenant-1', {
      ...workflowPluginInput(),
      manifest: { ...(workflowPluginInput().manifest as Record<string, unknown>), compatibility: { products: ['legacy'] } },
    }),
    /未知字段/,
  );
  await assert.rejects(
    () => service.importVersion('tenant-1', {
      ...workflowPluginInput(),
      manifest: { ...(workflowPluginInput().manifest as Record<string, unknown>), logoUrl: '../private/logo.svg' },
    }),
    /不能包含 \.\./,
  );
});

test('统一插件在导入阶段拒绝无效接入配方，并接受完整的声明式配方', async () => {
  const service = new UnifiedPluginsApplicationService(memoryRepository(new Map()));
  const base = workflowPluginInput();
  await assert.rejects(() => service.importVersion('tenant-1', {
    ...base,
    manifest: {
      ...base.manifest,
      resources: { ...base.manifest.resources, onboarding: { applicationAsset: 'onboarding/application-asset.json' } },
    },
    resources: { ...base.resources, 'onboarding/application-asset.json': '{}' },
  }), /接入配方无效/);

  const imported = await service.importVersion('tenant-1', onboardingPluginInput());
  assert.equal(imported.pluginId, 'test.device.workflow');
  const approved = await service.approvePermissions(imported.id, ['network.http']);
  assert.equal((await service.enableVersion(approved.id)).status, 'ENABLED');
});

test('Trusted JS 插件 Manifest 必须失败关闭', async () => {
  const service = new UnifiedPluginsApplicationService(memoryRepository(new Map()));
  await assert.rejects(
    () => service.importVersion('tenant-1', trustedJsPluginInput()),
    /必须是 AGENT_PLAN、WORKFLOW_DSL 之一/,
  );
});

test('统一插件 Manifest 拒绝宿主 Provider 元数据', async () => {
  const service = new UnifiedPluginsApplicationService(memoryRepository(new Map()));
  for (const field of ['providerKey', 'supportedProducts', 'supportedOperations']) {
    await assert.rejects(
      () => service.importVersion('tenant-1', {
        ...workflowPluginInput(),
        manifest: {
          ...(workflowPluginInput().manifest as Record<string, unknown>),
          [field]: field === 'providerKey' ? 'cloud.example' : ['certificate.deploy'],
        },
      }),
      /包含未知字段/,
    );
  }
});

test('统一插件目录保留正交分类和能力声明', async () => {
  const service = new UnifiedPluginsApplicationService(memoryRepository(new Map()));
  const imported = await service.importVersion('tenant-1', {
    ...workflowPluginInput(),
    manifest: { ...(workflowPluginInput().manifest as Record<string, unknown>), permissions: [] },
  });
  const [item] = await service.listCatalog('tenant-1');
  assert.equal(imported.status, 'DISABLED');
  assert.equal(item?.runtime, 'WORKFLOW_DSL');
  assert.equal(item?.scope, 'BOTH');
  assert.equal(item?.source, 'USER');
  assert.equal(item?.logoUrl, '/plugin-logos/test.svg');
  assert.equal(item?.capabilities[0]?.key, 'certificate.deploy');
  assert.equal(item?.pluginVersionId, imported.id);
  assert.equal(item?.packageSha256, imported.packageSha256);
  assert.equal(item?.manifestSha256, imported.manifestSha256);
  assert.deepEqual(item?.resourceSha256, imported.resourceSha256);
});

test('统一插件目录同一插件只返回最高语义版本', async () => {
  const service = new UnifiedPluginsApplicationService(memoryRepository(new Map()));
  await service.importVersion('tenant-1', {
    ...workflowPluginInput(),
    manifest: { ...(workflowPluginInput().manifest as Record<string, unknown>), permissions: [], version: '1.9.0' },
  });
  await service.importVersion('tenant-1', {
    ...workflowPluginInput(),
    packageContent: 'package-1.10.0',
    manifest: { ...(workflowPluginInput().manifest as Record<string, unknown>), permissions: [], version: '1.10.0' },
  });

  const catalog = await service.listCatalog('tenant-1');

  assert.equal(catalog.length, 1);
  assert.equal(catalog[0]?.version, '1.10.0');
});

test('统一插件目录对租户展示系统注册表中的最新内置版本', async () => {
  const records = new Map<string, UnifiedPluginVersionRecord>();
  const service = new UnifiedPluginsApplicationService(memoryRepository(records));
  const base = workflowPluginInput();
  await service.importVersion('tenant-1', {
    ...base,
    manifest: { ...(base.manifest as Record<string, unknown>), source: 'BUILTIN', permissions: [], version: '1.1.23' },
  }, 'BUILTIN');
  await service.importVersion('SYSTEM', {
    ...base,
    packageContent: 'system-package-1.1.25',
    manifest: { ...(base.manifest as Record<string, unknown>), source: 'BUILTIN', permissions: [], version: '1.1.25' },
  }, 'BUILTIN');

  const catalog = await service.listCatalog('tenant-1');

  assert.equal(catalog.length, 1);
  assert.equal(catalog[0]?.version, '1.1.25');
});

test('统一插件目录跳过缺失资源的坏版本并回退到上一个可用版本', async () => {
  const base = workflowPluginInput();
  const service = new UnifiedPluginsApplicationService(memoryRepository(new Map([
    ['broken-version', {
      id: 'broken-version',
      tenantId: 'SYSTEM',
      ownerType: 'SYSTEM',
      pluginId: 'test.device.workflow',
      version: '1.1.0',
      source: 'BUILTIN',
      runtime: 'WORKFLOW_DSL',
      scope: 'BOTH',
      trust: 'OFFICIAL_SIGNED',
      support: 'OFFICIAL',
      manifest: {
        ...(base.manifest as Record<string, unknown>),
        source: 'BUILTIN',
        permissions: [],
        version: '1.1.0',
        defaultLocale: 'zh-CN',
        resources: {
          ...(base.manifest as Record<string, any>).resources,
          locales: builtinLocaleManifestResources(),
        },
      } as unknown as UnifiedPluginVersionRecord['manifest'],
      packageSha256: 'sha256:broken',
      manifestSha256: 'sha256:broken-manifest',
      resourceSha256: {
        'workflows/deploy.json': 'sha256:missing',
        'locales/zh-CN.json': 'sha256:missing-locale',
      },
      resources: {},
      status: 'ENABLED',
      permissionApprovalStatus: 'NOT_REQUIRED',
      approvedPermissions: [],
      validationReport: {
        valid: true,
        errors: [],
        warnings: [],
        manifestSha256: 'sha256:broken-manifest',
        resourceSha256: {
          'workflows/deploy.json': 'sha256:missing',
          'locales/zh-CN.json': 'sha256:missing-locale',
        },
      },
      createdAt: '2026-08-06T10:00:00.000Z',
      updatedAt: '2026-08-06T10:00:00.000Z',
    }],
    ['healthy-version', {
      id: 'healthy-version',
      tenantId: 'SYSTEM',
      ownerType: 'SYSTEM',
      pluginId: 'test.device.workflow',
      version: '1.0.0',
      source: 'BUILTIN',
      runtime: 'WORKFLOW_DSL',
      scope: 'BOTH',
      trust: 'OFFICIAL_SIGNED',
      support: 'OFFICIAL',
      manifest: {
        ...(base.manifest as Record<string, unknown>),
        source: 'BUILTIN',
        permissions: [],
        version: '1.0.0',
        defaultLocale: 'zh-CN',
        resources: {
          ...(base.manifest as Record<string, any>).resources,
          locales: builtinLocaleManifestResources(),
        },
      } as unknown as UnifiedPluginVersionRecord['manifest'],
      packageSha256: 'sha256:healthy',
      manifestSha256: 'sha256:healthy-manifest',
      resourceSha256: {
        'workflows/deploy.json': 'sha256:healthy-resource',
        'locales/zh-CN.json': 'sha256:healthy-locale',
      },
      resources: {
        'workflows/deploy.json': '{}',
        ...builtinLocaleResources(),
      },
      status: 'ENABLED',
      permissionApprovalStatus: 'NOT_REQUIRED',
      approvedPermissions: [],
      validationReport: {
        valid: true,
        errors: [],
        warnings: [],
        manifestSha256: 'sha256:healthy-manifest',
        resourceSha256: {
          'workflows/deploy.json': 'sha256:healthy-resource',
          'locales/zh-CN.json': 'sha256:healthy-locale',
        },
      },
      createdAt: '2026-08-05T10:00:00.000Z',
      updatedAt: '2026-08-05T10:00:00.000Z',
    }],
  ])));

  const catalog = await service.listCatalog('tenant-1');

  assert.equal(catalog.length, 1);
  assert.equal(catalog[0]?.pluginVersionId, 'healthy-version');
  assert.equal(catalog[0]?.version, '1.0.0');
});

test('统一插件升级差异和退休状态可追踪', async () => {
  const service = new UnifiedPluginsApplicationService(memoryRepository(new Map()));
  const first = await service.importVersion('tenant-1', {
    ...workflowPluginInput(),
    manifest: { ...(workflowPluginInput().manifest as Record<string, unknown>), permissions: [], version: '1.0.0' },
  });
  const second = await service.importVersion('tenant-1', {
    ...workflowPluginInput(),
    packageContent: 'package-v2',
    manifest: {
      ...(workflowPluginInput().manifest as Record<string, unknown>),
      permissions: ['network.http'],
      version: '2.0.0',
      capabilities: [
        ...((workflowPluginInput().manifest as Record<string, unknown>).capabilities as unknown[]),
        {
          key: 'certificate.rollback', contractVersion: 'v1', actionContractId: 'certificate.rollback.v1',
          riskLevel: 'HIGH', executionLocations: ['CONTROL_PLANE'],
        },
      ],
    },
  });
  const diff = await service.getUpgradeDiff(first.id, second.id);
  assert.deepEqual(diff.addedCapabilities, ['certificate.rollback']);
  assert.deepEqual(diff.addedPermissions, ['network.http']);
  assert.equal(diff.requiresApproval, true);
  assert.equal((await service.retireVersion(first.id)).status, 'RETIRED');
});

function workflowPluginInput() {
  return {
    manifest: {
      apiVersion: 'gcac.plugin-manifest/v1',
      kind: 'GcacPlugin',
      pluginId: 'test.device.workflow',
      version: '1.0.0',
      displayNameKey: 'plugin.test.device.name',
      logoUrl: '/plugin-logos/test.svg',
      publisher: 'test',
      runtime: 'WORKFLOW_DSL',
      source: 'USER',
      scope: 'BOTH',
      trust: 'UNSIGNED',
      support: 'SELF_MANAGED',
      capabilities: [{
        key: 'certificate.deploy',
        contractVersion: 'v1',
        actionContractId: 'certificate.deploy.v1',
        riskLevel: 'HIGH',
        executionLocations: ['CONTROL_PLANE', 'GATEWAY'],
      }],
      permissions: ['network.http'],
      resources: { workflows: { 'certificate.deploy': 'workflows/deploy.json' } },
    },
    resources: { 'workflows/deploy.json': '{}' },
    packageContent: 'package',
  };
}

function onboardingPluginInput() {
  const base = workflowPluginInput();
  return {
    ...base,
    packageContent: 'valid-onboarding-package',
    manifest: {
      ...base.manifest,
      defaultLocale: 'zh-CN',
      capabilities: [
        ...(base.manifest.capabilities as unknown[]),
        {
          key: 'application.discover', contractVersion: 'v1', actionContractId: 'application.discover.v1',
          riskLevel: 'LOW', executionLocations: ['CONTROL_PLANE'],
        },
      ],
      resources: {
        ...base.manifest.resources,
        workflows: {
          ...base.manifest.resources.workflows,
          'application.discover': 'workflows/discover.json',
        },
        locales: { 'zh-CN': 'locales/zh-CN.json' },
        onboarding: { applicationAsset: 'onboarding/application-asset.json' },
      },
    },
    resources: {
      ...base.resources,
      'workflows/discover.json': '{}',
      'locales/zh-CN.json': JSON.stringify({ 'plugin.test.device.name': '测试设备' }),
      'onboarding/application-asset.json': JSON.stringify({
        protocol: 'gcac.application-onboarding/v1', platformKey: 'test.direct', displayNameKey: 'plugin.test.device.name', supportStatus: 'SUPPORTED',
        deploymentMode: 'DIRECT_WORKFLOW', deviceSelection: 'NONE', forms: {},
        capabilities: { connectionTest: 'application.discover', discovery: 'application.discover', workflowExecution: 'certificate.deploy' },
        targetProjection: { targetType: 'tls.binding', displayFields: ['displayName'], identityFields: ['managedTargetId', 'configFingerprint'], selectableWhen: 'always' },
        certificate: { acceptedFormats: ['PEM'], requiredArtifacts: ['leaf', 'privateKey'], defaultVersion: 'LATEST_VALID' },
        commit: { executionSource: 'WORKFLOW', inputContract: 'certificate.deploy.v1' },
      }),
    },
  };
}

function trustedJsPluginInput() {
  return {
    manifest: {
      apiVersion: 'gcac.plugin-manifest/v1',
      kind: 'GcacPlugin',
      pluginId: 'builtin.cloud.aliyun.cdn',
      version: '1.0.0',
      displayNameKey: 'plugin.builtin.aliyun.cdn.name',
      publisher: 'GCAC',
      runtime: 'TRUSTED_JS',
      source: 'BUILTIN',
      scope: 'MANAGED',
      trust: 'OFFICIAL_SIGNED',
      support: 'OFFICIAL',
      capabilities: [{
        key: 'certificate.deploy',
        contractVersion: 'v1',
        actionContractId: 'certificate.deploy.v1',
        riskLevel: 'HIGH',
        executionLocations: ['CONTROL_PLANE'],
      }],
      permissions: ['certificate.deploy', 'runtime.execute_unknown_code'],
      resources: { runtimeEntrypoint: 'runtime/index.js' },
    },
    resources: { 'runtime/index.js': 'export default async function main() { return { ok: true }; }\n' },
    packageContent: 'trusted-js-package',
  };
}

function builtinLocaleResources() {
  return Object.fromEntries(hostLocales.map((locale) => [
    `locales/${locale}.json`,
    JSON.stringify({ 'plugin.test.device.name': '测试插件' }),
  ]));
}

function builtinLocaleManifestResources() {
  return Object.fromEntries(hostLocales.map((locale) => [locale, `locales/${locale}.json`]));
}

function memoryRepository(records: Map<string, UnifiedPluginVersionRecord>): UnifiedPluginsRepository {
  return {
    saveVersion: async (record) => {
      records.set(record.id, record);
      return record;
    },
    findVersion: async (id) => records.get(id),
    findByIdentity: async (tenantId, pluginId, version) => [...records.values()].find(
      (record) => record.tenantId === tenantId && record.pluginId === pluginId && record.version === version,
    ),
    listVersions: async (tenantId) => [...records.values()].filter((record) => record.tenantId === tenantId),
    listVersionsBySource: async (source) => [...records.values()].filter((record) => record.source === source),
    listAccessibleVersions: async (tenantId) => [...records.values()].filter(
      (record) => record.tenantId === tenantId || record.source === 'BUILTIN',
    ),
    countReferences: async () => ({ bindings: 0, assignments: 0, hosts: 0, serviceAssets: 0, deviceAssets: 0, total: 0 }),
  };
}
