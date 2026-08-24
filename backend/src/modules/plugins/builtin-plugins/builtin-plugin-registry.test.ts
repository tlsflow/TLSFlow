import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { BuiltinPluginRegistry, type P2PluginReleaseManifest } from './builtin-plugin-registry.js';
import { BuiltinUnifiedPluginLoader } from './builtin-unified-plugin-loader.js';

test('P2 Registry 只登记固定版本和 Runner 入口，不加载插件模块', async () => {
  const root = await createPackageRoot();
  const loader = new BuiltinUnifiedPluginLoader(root);
  const [pluginPackage] = await loader.loadPackages();
  assert.ok(pluginPackage);
  const release = releaseManifest(pluginPackage.packageContent);
  const registry = new BuiltinPluginRegistry(loader, release);

  const [entry] = await registry.refresh();

  assert.equal(entry?.pluginId, 'web.nginx');
  assert.equal(entry?.version, '1.0.0');
  assert.equal(entry?.runtimeEntrypoint, 'runtime/index.js');
  assert.equal(entry?.ipcProtocol, 'gcac.plugin-runner/v1');
  assert.match(entry?.runtimeEntrypointPath ?? '', /runtime[\\/]index\.js$/);
  assert.throws(() => registry.get('web.nginx', '1.0.1'), /固定的 P2 PluginVersion/);
});

test('P2 Registry 对未发布包默认失败关闭，开发显式选项不能改变固定身份', async () => {
  const root = await createPackageRoot();
  const loader = new BuiltinUnifiedPluginLoader(root);
  const [pluginPackage] = await loader.loadPackages();
  assert.ok(pluginPackage);
  const release = releaseManifest(pluginPackage.packageContent);
  release.plugins[0]!.packageDigest = { status: 'NOT_BUILT', sha256: null };
  const registry = new BuiltinPluginRegistry(loader, release);

  assert.deepEqual(await registry.refresh(), []);
  assert.equal((await registry.refresh({ allowUnreleased: true }))[0]?.version, '1.0.0');
});

async function createPackageRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'gcac-p2-registry-'));
  const packageRoot = join(root, 'web-nginx');
  await mkdir(join(packageRoot, 'runtime'), { recursive: true });
  await mkdir(join(packageRoot, 'workflows'), { recursive: true });
  await writeFile(join(packageRoot, 'manifest.json'), JSON.stringify({
    apiVersion: 'gcac.plugin-manifest/v1',
    kind: 'GcacPlugin',
    pluginId: 'web.nginx',
    version: '1.0.0',
    displayNameKey: 'plugin.fixture.registry.name',
    publisher: 'fixture',
    runtime: 'AGENT_PLAN',
    source: 'BUILTIN',
    scope: 'MANAGED',
    trust: 'OFFICIAL_SIGNED',
    support: 'OFFICIAL',
    capabilities: [{ key: 'application.discover', contractVersion: 'v1', actionContractId: 'application.discover.v1', riskLevel: 'LOW', executionLocations: ['CONTROL_PLANE'] }],
    permissions: [],
    resources: {
      runtimeEntrypoint: 'runtime/index.js',
      agentPlans: { 'application.discover': 'workflows/read.json' },
    },
  }), 'utf8');
  await writeFile(join(packageRoot, 'runtime/index.js'), 'export function createPluginRunnerExecutor() {}\n', 'utf8');
  await writeFile(join(packageRoot, 'workflows/read.json'), '{"steps":[]}\n', 'utf8');
  return root;
}

function releaseManifest(packageContent: string): P2PluginReleaseManifest {
  return {
    packageContract: {
      rootDirectory: 'builtin-plugins',
      runtimeEntrypoint: 'runtime/index.js',
      executionMode: 'PLUGIN_RUNNER',
      ipcProtocol: 'gcac.plugin-runner/v1',
    },
    plugins: [{
      canonicalPluginId: 'web.nginx',
      packageDirectory: 'web-nginx',
      pluginVersion: '1.0.0',
      implementationStatus: 'P2_RELEASED',
      executionMode: 'PLUGIN_RUNNER',
      agentSidePlugin: false,
      packageDigest: { status: 'P2_RELEASED', sha256: `sha256:${sha256(packageContent)}`, catalogEntryRequired: true },
      capabilities: [{ key: 'application.discover', contractVersion: 'v1', riskLevel: 'LOW', executionLocations: ['CONTROL_PLANE'] }],
      hostApiGrants: [],
      workflows: [{ key: 'application.discover', capabilityKey: 'application.discover', path: 'workflows/read.json', initialVersion: '1.0.0', readOnly: true }],
    }],
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
