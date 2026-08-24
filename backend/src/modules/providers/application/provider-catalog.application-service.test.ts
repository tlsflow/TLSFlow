import assert from 'node:assert/strict';
import test from 'node:test';
import { ProviderCatalogApplicationService } from './provider-catalog.application-service.js';

test('Provider 目录、能力查询和按 key 解析全部失败关闭', async () => {
  const service = new ProviderCatalogApplicationService({} as never);
  for (const operation of [
    () => service.listProviders('tenant-1'),
    () => service.requireProvider('tenant-1', 'cloud.opaque'),
    () => service.listCapabilities('tenant-1'),
    () => service.requireDefinition('cloud.opaque'),
  ]) {
    await assert.rejects(operation, (error: unknown) => {
      assert.equal((error as { errorCode?: string }).errorCode, 'PLUGIN_CAPABILITY_EXECUTION_FAILED');
      return true;
    });
  }
});
