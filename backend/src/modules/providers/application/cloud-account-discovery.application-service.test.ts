import assert from 'node:assert/strict';
import test from 'node:test';
import { CloudAccountDiscoveryApplicationService, type CloudAccountDiscoveryDependencies } from './cloud-account-discovery.application-service.js';
import type { CloudAccountAsset } from '../dto/providers.dto.js';

const asset: CloudAccountAsset = {
  id: 'caa-dynamic-version',
  tenantId: 'tenant-dynamic-version',
  assetKind: 'cloud.account',
  providerKey: 'cloud.aliyun',
  displayName: '阿里云测试账号',
  credentialRef: 'credential://aliyun',
  scope: {},
  status: 'ACTIVE',
  metadata: {},
  createdAt: '',
  updatedAt: '',
  version: 1,
};

function createService(catalog: unknown[], binding?: unknown, assignmentPluginVersionId: string | undefined = 'uplgv-latest', currentEnabledVersion?: unknown, repairBinding = false): CloudAccountDiscoveryApplicationService {
  let activeBinding = binding;
  const dependencies: CloudAccountDiscoveryDependencies = {
    db: { query: async () => ({ rows: assignmentPluginVersionId ? [{ plugin_version_id: assignmentPluginVersionId }] : [] }) } as never,
    cloudAccounts: { get: async () => asset },
    plugins: {
      listCatalog: async () => catalog as never,
      getVersionForTenant: async () => ({
        id: assignmentPluginVersionId ?? 'uplgv-latest',
        pluginId: 'cloud.aliyun',
        version: '2.0.20',
        status: 'ENABLED',
        manifest: { capabilities: [{ key: 'cloud.service.connection-test' }, { key: 'cloud.service.discover' }] },
      } as never),
      ...(currentEnabledVersion ? { getCurrentEnabledVersion: async () => currentEnabledVersion as never } : {}),
    },
    workflows: { getVersion: async () => ({} as never), runWithDispatcher: async () => ({} as never) },
    workflowBindings: {
      find: async () => activeBinding as never,
      findByResource: async () => undefined,
      findLatestByPluginResource: async () => undefined,
      listCurrent: async () => [],
      list: async () => [],
      listAll: async () => [],
      save: async (record) => record,
    },
    ...(repairBinding ? {
      workflowPublisher: {
        publishPlugin: async () => {
          activeBinding = {
            pluginVersionId: 'uplgv-current',
            workflowTemplateId: 'wft-current',
            workflowVersionId: 'wfv-current',
          };
          return [];
        },
      },
    } : {}),
    projection: {} as never,
    pluginActionExecutor: {} as never,
    executionGrants: {} as never,
  };
  return new CloudAccountDiscoveryApplicationService(dependencies);
}

test('云账号动作忽略历史 Assignment 并解析最新已启用插件版本', async () => {
  const service = createService([
    {
      pluginId: 'cloud.aliyun',
      pluginVersionId: 'uplgv-latest',
      status: 'ENABLED',
      capabilities: [
        { key: 'cloud.service.connection-test' },
        { key: 'cloud.service.discover' },
      ],
    },
  ], {
    pluginVersionId: 'uplgv-latest',
    workflowTemplateId: 'wft-latest',
    workflowVersionId: 'wfv-latest',
  }, 'uplgv-history', {
    id: 'uplgv-latest',
    pluginId: 'cloud.aliyun',
    version: '2.0.20',
    status: 'ENABLED',
    manifest: { capabilities: [{ key: 'cloud.service.connection-test' }, { key: 'cloud.service.discover' }] },
  });

  const resolved = await (service as unknown as {
    resolveCurrentExecution: (tenantId: string, cloudAsset: CloudAccountAsset, operation: 'connection-test' | 'discover') => Promise<unknown>;
  }).resolveCurrentExecution(asset.tenantId, asset, 'discover');

  assert.deepEqual(resolved, {
    pluginVersionId: 'uplgv-latest',
    workflowTemplateId: 'wft-latest',
    workflowVersionId: 'wfv-latest',
  });
});

test('最新插件没有当前动作 Workflow 时失败关闭', async () => {
  const service = createService([
    {
      pluginId: 'cloud.aliyun',
      pluginVersionId: 'uplgv-latest',
      status: 'ENABLED',
      capabilities: [{ key: 'cloud.service.discover' }],
    },
  ], undefined, undefined);

  await assert.rejects(
    () => (service as unknown as {
      resolveCurrentExecution: (tenantId: string, cloudAsset: CloudAccountAsset, operation: 'connection-test' | 'discover') => Promise<unknown>;
    }).resolveCurrentExecution(asset.tenantId, asset, 'connection-test'),
    (error: unknown) => error instanceof Error && error.message.includes('当前插件版本没有对应 WorkflowVersion'),
  );
});

test('最新插件 Workflow 绑定指向旧插件时明确拒绝', async () => {
  const service = createService([
    {
      pluginId: 'cloud.aliyun',
      pluginVersionId: 'uplgv-latest',
      status: 'ENABLED',
      capabilities: [{ key: 'cloud.service.connection-test' }],
    },
  ], {
    pluginVersionId: 'uplgv-old',
    workflowTemplateId: 'wft-old',
    workflowVersionId: 'wfv-old',
  }, 'uplgv-latest');

  await assert.rejects(
    () => (service as unknown as {
      resolveCurrentExecution: (tenantId: string, cloudAsset: CloudAccountAsset, operation: 'connection-test' | 'discover') => Promise<unknown>;
    }).resolveCurrentExecution(asset.tenantId, asset, 'connection-test'),
    (error: unknown) => error instanceof Error && error.message.includes('没有对应 WorkflowVersion'),
  );
});

test('云服务重扫优先使用当前启用版本而非历史 Assignment', async () => {
  const service = createService([], {
    pluginVersionId: 'uplgv-current',
    workflowTemplateId: 'wft-current',
    workflowVersionId: 'wfv-current',
  }, 'uplgv-history', {
    id: 'uplgv-current',
    pluginId: 'cloud.aliyun',
    version: '2.0.21',
    status: 'ENABLED',
    manifest: { capabilities: [{ key: 'cloud.service.discover' }] },
  });

  const resolved = await (service as unknown as {
    resolveCurrentExecution: (tenantId: string, cloudAsset: CloudAccountAsset, operation: 'discover') => Promise<unknown>;
  }).resolveCurrentExecution(asset.tenantId, asset, 'discover');

  assert.deepEqual(resolved, {
    pluginVersionId: 'uplgv-current',
    workflowTemplateId: 'wft-current',
    workflowVersionId: 'wfv-current',
  });
});

test('当前插件缺少派生 Workflow 绑定时，重扫会幂等补发后继续执行', async () => {
  const service = createService([], undefined, 'uplgv-history', {
    id: 'uplgv-current',
    pluginId: 'cloud.aliyun',
    version: '2.0.21',
    status: 'ENABLED',
    manifest: { capabilities: [{ key: 'cloud.service.discover' }] },
  }, true);

  const resolved = await (service as unknown as {
    resolveCurrentExecution: (tenantId: string, cloudAsset: CloudAccountAsset, operation: 'discover') => Promise<unknown>;
  }).resolveCurrentExecution(asset.tenantId, asset, 'discover');

  assert.deepEqual(resolved, {
    pluginVersionId: 'uplgv-current',
    workflowTemplateId: 'wft-current',
    workflowVersionId: 'wfv-current',
  });
});
