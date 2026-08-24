import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { BuiltinUnifiedPluginLoader } from './builtin-plugins/builtin-unified-plugin-loader.js';

test('内置插件装载器读取 Runner 入口但不在宿主进程装载模块', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gcac-plugin-loader-'));
  const pluginDirectory = join(root, 'workflow-fixture');
  await mkdir(join(pluginDirectory, 'workflows'), { recursive: true });
  await mkdir(join(pluginDirectory, 'runtime'), { recursive: true });
  await writeFile(join(pluginDirectory, 'manifest.json'), JSON.stringify({
    apiVersion: 'gcac.plugin-manifest/v1',
    kind: 'GcacPlugin',
    pluginId: 'fixture.workflow',
    version: '1.0.0',
    displayNameKey: 'plugin.fixture.workflow.name',
    publisher: 'fixture',
    runtime: 'WORKFLOW_DSL',
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
    permissions: [],
    resources: {
      workflows: { deploy: 'workflows/deploy.json' },
      runtimeEntrypoint: 'runtime/index.js',
    },
  }), 'utf8');
  await writeFile(join(pluginDirectory, 'workflows/deploy.json'), '{}\r\n', 'utf8');
  await writeFile(join(pluginDirectory, 'runtime/index.js'), 'export default true;\r\n', 'utf8');

  const [pluginPackage] = await new BuiltinUnifiedPluginLoader(root).loadPackages();

  assert.equal(pluginPackage?.resources['workflows/deploy.json'], '{}\n');
  assert.equal(pluginPackage?.resources['runtime/index.js'], 'export default true;\n');
  assert.equal(pluginPackage?.runtimeEntrypoint, 'runtime/index.js');
  assert.equal(pluginPackage?.runtimeEntrypointPath?.endsWith('runtime\\index.js') || pluginPackage?.runtimeEntrypointPath?.endsWith('runtime/index.js'), true);
});
