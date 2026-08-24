import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const providers = [
  ['cloud-aliyun', 'cloud.aliyun', '阿里云'],
  ['cloud-huawei', 'cloud.huawei', '华为云'],
  ['cloud-tencent', 'cloud.tencent', '腾讯云'],
  ['cloud-volcengine', 'cloud.volcengine', '火山引擎'],
];

test('云插件缺少固定 PluginVersion 时失败关闭', async () => {
  for (const [directory, providerKey, providerName] of providers) {
    const module = await loadProvider(directory);
    await assert.rejects(
      () => module.default({ hostApi: {}, plugin: { pluginId: providerKey, providerKey, capabilityKey: 'certificate.discover' } }),
      (error) => error?.code === 'PROVIDER_EXTENSION_UNAVAILABLE'
        && error?.details?.mode === 'CONTRACT_FIXTURE_ONLY'
        && error.message.includes(`${providerName} 插件缺少固定 PluginVersion`),
    );
  }
});

test('云插件合同占位不执行网络、签名或资源写入', async () => {
  for (const [directory, providerKey] of providers) {
    const module = await loadProvider(directory);
    const plugin = await module.default({
      hostApi: {},
      plugin: { pluginId: providerKey, pluginVersionId: `${providerKey}.fixture.v1`, providerKey, capabilityKey: 'certificate.discover' },
    });
    assert.equal(plugin.runtimeMode, 'CONTRACT_FIXTURE_ONLY');
    for (const operation of ['testConnection', 'discover', 'deployCertificate', 'rollbackCertificate']) {
      await assert.rejects(
        () => plugin[operation]({ tenantId: 'tenant-fixture', pluginVersionId: `${providerKey}.fixture.v1` }, {}),
        (error) => error?.code === 'PROVIDER_EXTENSION_UNAVAILABLE'
          && error?.details?.mode === 'CONTRACT_FIXTURE_ONLY',
      );
    }
  }
});

async function loadProvider(directory) {
  return import(pathToFileURL(join(root, directory, 'runtime', 'index.js')).href);
}
