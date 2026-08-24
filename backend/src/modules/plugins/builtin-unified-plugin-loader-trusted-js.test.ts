import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { BuiltinUnifiedPluginLoader } from './builtin-plugins/builtin-unified-plugin-loader.js';

test('内置插件装载器会把 TRUSTED_JS 的 runtimeEntrypoint 加入资源清单', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gcac-trusted-js-loader-'));
  const pluginDirectory = join(root, 'cloud-aliyun-cdn');
  await mkdir(join(pluginDirectory, 'runtime'), { recursive: true });
  await writeFile(join(pluginDirectory, 'manifest.json'), JSON.stringify({
    apiVersion: 'gcac.plugin-manifest/v1',
    kind: 'GcacPlugin',
    pluginId: 'builtin.cloud.aliyun.cdn',
    version: '1.0.1',
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
    resources: {
      runtimeEntrypoint: 'runtime/index.js',
      runtimeModules: {
        shared: 'runtime/shared.js',
      },
    },
  }), 'utf8');
  await writeFile(join(pluginDirectory, 'runtime/index.js'), 'export default async function main() { return true; }\n', 'utf8');
  await writeFile(join(pluginDirectory, 'runtime/shared.js'), 'export const shared = true;\n', 'utf8');

  const [pluginPackage] = await new BuiltinUnifiedPluginLoader(root).loadPackages();

  assert.equal((pluginPackage?.manifest as { runtime?: string }).runtime, 'TRUSTED_JS');
  assert.equal((pluginPackage?.manifest as { resources?: { runtimeEntrypoint?: string } }).resources?.runtimeEntrypoint, 'runtime/index.js');
  assert.equal(pluginPackage?.resources['runtime/index.js'], 'export default async function main() { return true; }\n');
  assert.equal(pluginPackage?.resources['runtime/shared.js'], 'export const shared = true;\n');
});
