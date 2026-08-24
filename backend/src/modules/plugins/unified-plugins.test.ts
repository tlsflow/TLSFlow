import assert from 'node:assert/strict';
import test from 'node:test';
import type { UnifiedPluginVersionRecord } from './dto/unified-plugins.dto.js';
import { UnifiedPluginsApplicationService } from './application/unified-plugins.application-service.js';
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
    /不得携带可执行代码/,
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
      manifest: { ...(workflowPluginInput().manifest as Record<string, unknown>), logoUrl: '../private/logo.svg' },
    }),
    /不能包含 \.\./,
  );
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
  };
}
