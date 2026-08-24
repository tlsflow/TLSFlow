import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { BuiltinPluginRegistry } from './builtin-plugin-registry.js';
import { BuiltinUnifiedPluginLoader } from './builtin-unified-plugin-loader.js';

test('Registry 直接从 Manifest 派生版本和 Runner 入口，不加载插件模块', async () => {
  const root = await createPackageRoot();
  const loader = new BuiltinUnifiedPluginLoader(root);
  const [pluginPackage] = await loader.loadPackages();
  assert.ok(pluginPackage);
  const registry = new BuiltinPluginRegistry(loader);

  const [entry] = await registry.refresh();

  assert.equal(entry?.pluginId, 'web.nginx');
  assert.equal(entry?.version, '1.0.0');
  assert.equal(entry?.runtimeEntrypoint, 'runtime/index.js');
  assert.equal(entry?.ipcProtocol, 'gcac.plugin-runner/v1');
  assert.match(entry?.runtimeEntrypointPath ?? '', /runtime[\\/]index\.js$/);
  assert.throws(() => registry.get('web.nginx', '1.0.1'), /固定的 Manifest PluginVersion/);
});

test('未登记在历史发布台账中的包仍可按 Manifest 注册', async () => {
  const root = await createPackageRoot();
  const loader = new BuiltinUnifiedPluginLoader(root);
  const registry = new BuiltinPluginRegistry(loader);

  assert.equal((await registry.refresh())[0]?.pluginId, 'web.nginx');
});

test('同一插件版本且摘要相同的重复扫描保持幂等', async () => {
  const root = await createPackageRoot();
  const loader = new BuiltinUnifiedPluginLoader(root);
  const [pluginPackage] = await loader.loadPackages();
  assert.ok(pluginPackage);
  const repeatedLoader = {
    loadPackages: async () => [pluginPackage, pluginPackage],
    installPackages: loader.installPackages.bind(loader),
  } as unknown as BuiltinUnifiedPluginLoader;
  const registry = new BuiltinPluginRegistry(repeatedLoader);

  const entries = await registry.refresh();

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.packageSha256, `sha256:${sha256(pluginPackage.packageContent)}`);
});

test('同一插件版本摘要不同会拒绝刷新并保留旧 Registry 快照', async () => {
  const root = await createPackageRoot();
  const loader = new BuiltinUnifiedPluginLoader(root);
  const [pluginPackage] = await loader.loadPackages();
  assert.ok(pluginPackage);
  let scannedPackages = [pluginPackage];
  const dynamicLoader = {
    loadPackages: async () => scannedPackages,
    installPackages: loader.installPackages.bind(loader),
  } as unknown as BuiltinUnifiedPluginLoader;
  const registry = new BuiltinPluginRegistry(dynamicLoader);
  await registry.refresh();

  const conflictingPackage = { ...pluginPackage, packageContent: `${pluginPackage.packageContent}changed` };
  scannedPackages = [pluginPackage, conflictingPackage];

  await assert.rejects(
    () => registry.refresh(),
    /同一插件版本存在不同包内容/,
  );
  assert.equal(registry.get('web.nginx', '1.0.0').version, '1.0.0');
});

test('Registry 在 Manifest 边界拒绝非法 SemVer', async () => {
  const root = await createPackageRoot();
  const manifestPath = join(root, 'web-nginx', 'manifest.json');
  const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(manifestPath, 'utf8')) as Record<string, unknown>;
  manifest.version = 'v1.0.0';
  await writeFile(manifestPath, JSON.stringify(manifest), 'utf8');

  await assert.rejects(() => new BuiltinPluginRegistry(new BuiltinUnifiedPluginLoader(root)).refresh(), /合法 SemVer/);
});

test('Registry 在 Policy 边界拒绝未知 Canonical Plugin ID', async () => {
  const root = await createPackageRoot();
  const manifestPath = join(root, 'web-nginx', 'manifest.json');
  const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(manifestPath, 'utf8')) as Record<string, unknown>;
  manifest.pluginId = 'web.unknown';
  await writeFile(manifestPath, JSON.stringify(manifest), 'utf8');

  await assert.rejects(() => new BuiltinPluginRegistry(new BuiltinUnifiedPluginLoader(root)).refresh(), /Canonical Plugin ID/);
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

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
