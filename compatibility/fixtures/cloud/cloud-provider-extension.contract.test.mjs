import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, '../../..');
const packageDirectory = join(testDirectory, 'extension-provider');
const hostPaths = [
  'backend/src/modules/providers',
  'backend/src/modules/plugins/application',
  'backend/src/modules/plugins/controller',
  'web/src/views/settings/CredentialsView.vue',
  'backend/src/modules/providers/discovery/cloud-resource-projection.ts',
];

test('新增 Provider 只需要插件包资源，宿主不出现测试厂商分派', async () => {
  const manifest = readJson('manifest.json');
  assert.equal(manifest.pluginId, 'fixture.cloud-extension');
  assert.deepEqual(Object.keys(manifest.resources).sort(), ['discoveryMappings', 'forms', 'locales', 'presentations', 'runtimeEntrypoint', 'workflows']);
  for (const path of resourcePaths(manifest.resources)) assert.equal(existsSync(join(packageDirectory, path)), true, `缺少插件资源 ${path}`);
  const runtime = await import(pathToFileURL(join(packageDirectory, 'runtime/index.js')).href);
  const previous = setDescriptorEnv();
  try {
    const executor = runtime.createPluginRunnerExecutor();
    assert.deepEqual(executor.descriptor.capabilities, Object.keys(manifest.resources.workflows));
    for (const capability of executor.descriptor.capabilities) {
      const result = await executor.execute({
        pluginId: manifest.pluginId,
        pluginVersionId: `${manifest.pluginId}:${manifest.version}`,
        pluginVersion: manifest.version,
        capability,
        grantRefs: ['fixture-grant'],
        input: { security: { grantRef: 'fixture-grant' } },
      });
      assert.equal(result.success, true, capability);
      if (capability === 'cloud.service.discover') assert.equal(result.normalizedObjects[0].kind, 'CloudServiceResource');
    }
  } finally {
    restoreDescriptorEnv(previous);
  }
  for (const path of hostPaths) {
    const absolute = join(repositoryRoot, path);
    const files = existsSync(absolute) && !absolute.endsWith('.vue') && !absolute.endsWith('.ts') ? walk(absolute) : [absolute];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      assert.equal(source.includes('fixture.cloud-extension'), false, `${path} 出现测试 Provider 宿主分支`);
    }
  }
});

function readJson(name) { return JSON.parse(readFileSync(join(packageDirectory, name), 'utf8')); }
function resourcePaths(resources) {
  const values = [resources.runtimeEntrypoint, ...Object.values(resources.workflows), ...Object.values(resources.forms), ...Object.values(resources.presentations), ...Object.values(resources.discoveryMappings), ...Object.values(resources.locales)];
  return [...new Set(values)];
}
function setDescriptorEnv() {
  const keys = ['GCAC_PLUGIN_VERSION_ID', 'GCAC_PLUGIN_PACKAGE_HASH', 'GCAC_PLUGIN_MANIFEST_HASH', 'GCAC_PLUGIN_RESOURCE_HASH'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.GCAC_PLUGIN_VERSION_ID = 'fixture.cloud-extension:1.0.0';
  process.env.GCAC_PLUGIN_PACKAGE_HASH = `sha256:${'1'.repeat(64)}`;
  process.env.GCAC_PLUGIN_MANIFEST_HASH = `sha256:${'2'.repeat(64)}`;
  process.env.GCAC_PLUGIN_RESOURCE_HASH = `sha256:${'3'.repeat(64)}`;
  return previous;
}
function restoreDescriptorEnv(previous) { for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value; }
function walk(path) { return readdirSync(path, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(join(path, entry.name)) : [join(path, entry.name)]); }
