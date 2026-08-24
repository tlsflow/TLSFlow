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

function createService(catalog: unknown[], binding?: unknown): CloudAccountDiscoveryApplicationService {
  const dependencies: CloudAccountDiscoveryDependencies = {
    db: { query: async () => ({ rows: [] }) } as never,
    cloudAccounts: { get: async () => asset },
    plugins: {
      listCatalog: async () => catalog as never,
      getVersionForTenant: async () => ({} as never),
    },
    workflows: { getVersion: async () => ({} as never), runWithDispatcher: async () => ({} as never) },
    workflowBindings: {
      find: async () => binding as never,
      findByResource: async () => undefined,
      findLatestByPluginResource: async () => undefined,
      listCurrent: async () => [],
      list: async () => [],
      listAll: async () => [],
      save: async (record) => record,
    },
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
  ]);

  await assert.rejects(
    () => (service as unknown as {
      resolveCurrentExecution: (tenantId: string, cloudAsset: CloudAccountAsset, operation: 'connection-test' | 'discover') => Promise<unknown>;
    }).resolveCurrentExecution(asset.tenantId, asset, 'connection-test'),
    (error: unknown) => error instanceof Error && error.message.includes('没有声明云账号动作能力'),
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
  });

  await assert.rejects(
    () => (service as unknown as {
      resolveCurrentExecution: (tenantId: string, cloudAsset: CloudAccountAsset, operation: 'connection-test' | 'discover') => Promise<unknown>;
    }).resolveCurrentExecution(asset.tenantId, asset, 'connection-test'),
    (error: unknown) => error instanceof Error && error.message.includes('没有对应 WorkflowVersion'),
  );
});
