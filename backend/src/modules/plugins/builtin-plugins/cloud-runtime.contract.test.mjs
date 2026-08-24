import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

const root = fileURLToPath(new URL('.', import.meta.url));
const providers = [
  ['cloud-aliyun', 'cloud.aliyun'],
  ['cloud-huawei', 'cloud.huawei'],
  ['cloud-tencent', 'cloud.tencent'],
  ['cloud-volcengine', 'cloud.volcengine'],
];

test('四个 Cloud Runtime 工厂遵守固定 PluginVersion、五类 Capability 和失败关闭合同', async () => {
  for (const [directory, pluginId] of providers) {
    const manifest = JSON.parse(readFileSync(join(root, directory, 'manifest.json'), 'utf8'));
    const module = await import(pathToFileURL(join(root, directory, 'runtime', 'index.js')).href);
    const versionId = `${pluginId}:${manifest.version}`;
    const hashes = {
      packageHash: `sha256:${'1'.repeat(64)}`,
      manifestHash: `sha256:${'2'.repeat(64)}`,
      resourceHash: `sha256:${'3'.repeat(64)}`,
    };
    const previous = snapshotEnv({
      GCAC_PLUGIN_VERSION_ID: versionId,
      GCAC_PLUGIN_PACKAGE_HASH: hashes.packageHash,
      GCAC_PLUGIN_MANIFEST_HASH: hashes.manifestHash,
      GCAC_PLUGIN_RESOURCE_HASH: hashes.resourceHash,
    });
    try {
      const executor = module.createPluginRunnerExecutor();
      assert.equal(executor.descriptor.pluginId, pluginId);
      assert.equal(executor.descriptor.pluginVersion, manifest.version);
      assert.deepEqual(executor.descriptor.capabilities, manifest.capabilities.map((item) => item.key));
      const hostApi = mockHostApi(pluginId);
      for (const capability of ['cloud.service.connection-test', 'cloud.service.discover', 'certificate.deploy', 'certificate.verify', 'certificate.rollback']) {
        const result = await executor.execute(context({ pluginId, versionId, manifest, hashes, capability }), hostApi);
        assert.equal(result.success, true, `${pluginId} ${capability} 未成功`);
      }
      const discovery = await executor.execute(context({ pluginId, versionId, manifest, hashes, capability: 'cloud.service.discover' }), hostApi);
      assert.equal(discovery.normalizedObjects[0].apiVersion, 'gcac.cloud-service/v1');
      assert.equal(discovery.normalizedObjects[0].pluginVersionId, versionId);
      const denied = await executor.execute(context({ pluginId, versionId, manifest, hashes, capability: 'cloud.service.connection-test', grantRefs: [] }), hostApi);
      assert.equal(denied.success, false);
      assert.equal(denied.status, 'FAILED');
      assert.equal(denied.error.secretRedacted, true);
      assert.equal(denied.error.mayBeUnknown, false);
    } finally {
      restoreEnv(previous);
    }
  }
});

test('Cloud Runtime 缺少固定摘要时创建工厂失败关闭', async () => {
  for (const [directory] of providers) {
    const module = await import(pathToFileURL(join(root, directory, 'runtime', 'index.js')).href);
    const previous = snapshotEnv({
      GCAC_PLUGIN_VERSION_ID: undefined,
      GCAC_PLUGIN_PACKAGE_HASH: undefined,
      GCAC_PLUGIN_MANIFEST_HASH: undefined,
      GCAC_PLUGIN_RESOURCE_HASH: undefined,
    });
    try {
      assert.throws(() => module.createPluginRunnerExecutor(), /CLOUD_DESCRIPTOR_MISSING|缺失或格式无效/);
    } finally {
      restoreEnv(previous);
    }
  }
});

function context({ pluginId, versionId, manifest, hashes, capability, grantRefs = ['grant-cloud'] }) {
  return {
    pluginVersionId: versionId,
    pluginId,
    pluginVersion: manifest.version,
    capability,
    grantRefs,
    writeEffect: capability === 'certificate.deploy' || capability === 'certificate.rollback',
    input: {
      cloudServiceRef: 'caa_fixture',
      credential: { grantId: 'grant-cloud', secretRef: 'secret://api_token/cloud-fixture#current' },
      certificateArtifactRef: 'artifact://fixture/cloud',
      request: { method: 'POST', uri: '/fixture', action: capability, timestamp: '2026-08-11T00:00:00Z', body: {} },
      security: {
        tokenRef: 'token://fixture', decisionRef: 'decision://fixture', nonce: 'nonce-fixture', receiptRef: 'receipt://fixture',
        localPolicyRef: 'policy://fixture', grantRef: 'grant-cloud', ...hashes,
      },
    },
  };
}

function mockHostApi(pluginId) {
  return {
    async call(method) {
      if (method === 'cloudService.get') return {
        ok: true,
        data: {
          cloudServiceRef: 'caa_fixture',
          providerKey: pluginId,
          scope: {
            endpoint: 'https://cloud.example.invalid',
            metadata: {
              ...(pluginId === 'cloud.tencent' ? { serviceName: 'cvm' } : {}),
              ...(pluginId === 'cloud.volcengine' ? { serviceName: 'vod', region: 'cn-north-1' } : {}),
            },
          },
          status: 'ACTIVE',
        },
      };
      if (method === 'secret.grant.resolve') return {
        ok: true,
        data: {
          secretRef: 'secret://api_token/cloud-fixture#current',
          value: '[REDACTED]',
          ...(pluginId === 'cloud.huawei' ? { accessKey: 'fixture-access', secretKey: 'fixture-secret' } : {}),
          ...(pluginId === 'cloud.volcengine' ? { accessKey: 'fixture-access', secretKey: 'fixture-secret' } : {}),
          ...(pluginId === 'cloud.tencent' ? { secretId: 'fixture-access', secretKey: 'fixture-secret' } : {}),
          ...(pluginId === 'cloud.aliyun' ? { accessKeyId: 'fixture-access', accessKeySecret: 'fixture-secret' } : {}),
        },
      };
      if (method === 'artifact.grant.read') return { ok: true, data: { artifactRef: 'artifact://fixture/cloud', certificateChain: '-----BEGIN CERTIFICATE-----fixture' } };
      if (method === 'http.request') return { ok: true, data: { statusCode: 200, signatureVerified: true, body: { status: 'SUCCEEDED', resources: [{ id: 'resource-1', type: 'cdn.domain', region: 'cn-hangzhou' }] } } };
      throw new Error(`unexpected host method ${method}`);
    },
  };
}

function snapshotEnv(values) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return previous;
}

function restoreEnv(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
