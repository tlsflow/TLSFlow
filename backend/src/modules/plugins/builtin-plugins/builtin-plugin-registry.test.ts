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

test('版本门禁名单只跳过指定插件包', async () => {
  const root = await createPackageRoot();
  const loader = new BuiltinUnifiedPluginLoader(root);
  const registry = new BuiltinPluginRegistry(loader, { blockedPackageDirectories: ['web-nginx'] });

  assert.deepEqual(await registry.refresh(), []);
});

test('一个插件 Registry 校验失败时其他插件仍保留', async () => {
  const root = await createPackageRoot();
  const loader = new BuiltinUnifiedPluginLoader(root);
  const [validPackage] = await loader.loadPackages();
  assert.ok(validPackage);
  const invalidPackage = {
    ...validPackage,
    packageDirectory: '/tmp/web-unknown',
    manifest: { ...(validPackage.manifest as Record<string, unknown>), pluginId: 'web.unknown' },
  };
  const isolatedLoader = {
    loadPackages: async () => [validPackage, invalidPackage],
    installPackages: loader.installPackages.bind(loader),
  } as unknown as BuiltinUnifiedPluginLoader;

  const entries = await new BuiltinPluginRegistry(isolatedLoader).refresh();

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.pluginId, 'web.nginx');
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

test('同一插件版本摘要不同只跳过冲突插件', async () => {
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

  assert.deepEqual(await registry.refresh(), []);
  assert.throws(() => registry.get('web.nginx', '1.0.0'), /固定的 Manifest PluginVersion/);
});

test('Registry 在 Manifest 边界跳过非法 SemVer 插件', async () => {
  const root = await createPackageRoot();
  const manifestPath = join(root, 'web-nginx', 'manifest.json');
  const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(manifestPath, 'utf8')) as Record<string, unknown>;
  manifest.version = 'v1.0.0';
  await writeFile(manifestPath, JSON.stringify(manifest), 'utf8');

  assert.deepEqual(await new BuiltinPluginRegistry(new BuiltinUnifiedPluginLoader(root)).refresh(), []);
});

test('Registry 在 Policy 边界跳过未知 Canonical Plugin ID 插件', async () => {
  const root = await createPackageRoot();
  const manifestPath = join(root, 'web-nginx', 'manifest.json');
  const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(manifestPath, 'utf8')) as Record<string, unknown>;
  manifest.pluginId = 'web.unknown';
  await writeFile(manifestPath, JSON.stringify(manifest), 'utf8');

  assert.deepEqual(await new BuiltinPluginRegistry(new BuiltinUnifiedPluginLoader(root)).refresh(), []);
});

test('registerAll 自动退休源码已移除的 BUILTIN 孤儿版本记录', async () => {
  const root = await createPackageRoot();
  const loader = new BuiltinUnifiedPluginLoader(root);
  const registry = new BuiltinPluginRegistry(loader, { logger: { warn: () => {} } });

  const disabled: string[] = [];
  const retired: string[] = [];
  const service = {
    listBuiltinVersions: async () => [
      { id: 'orphan-acme', pluginId: 'ca.acme', version: '1.0.0', status: 'ENABLED' },
      { id: 'orphan-openssl', pluginId: 'ca.openssl', version: '1.0.0', status: 'DISABLED' },
      { id: 'retired-acme-dns', pluginId: 'ca.acme-dns', version: '1.0.0', status: 'RETIRED' },
      { id: 'current-nginx', pluginId: 'web.nginx', version: '1.0.0', status: 'ENABLED' },
    ],
    disableVersion: async (id: string) => { disabled.push(id); return { id }; },
    retireVersion: async (id: string) => { retired.push(id); return { id }; },
    importVersion: async (_tenantId: string, pluginPackage: { manifest: { pluginId: string; version: string } }) => ({
      id: `pv-${pluginPackage.manifest.pluginId}`,
      pluginId: pluginPackage.manifest.pluginId,
      version: pluginPackage.manifest.version,
      permissionApprovalStatus: 'APPROVED',
      status: 'DISABLED',
      manifest: pluginPackage.manifest,
    }),
    approvePermissions: async (id: string) => ({ id, status: 'DISABLED' }),
    enableVersion: async (id: string) => ({ id, status: 'ENABLED' }),
  } as unknown as Parameters<typeof registry.registerAll>[0];

  await registry.registerAll(service);

  // 启用的孤儿先降级再退休；已退休和当前源码包记录不动。
  assert.deepEqual(disabled, ['orphan-acme']);
  assert.deepEqual([...retired].sort(), ['orphan-acme', 'orphan-openssl']);
});

test('registerAll 孤儿退休失败只跳过该记录，不影响其余安装', async () => {
  const root = await createPackageRoot();
  const loader = new BuiltinUnifiedPluginLoader(root);
  const registry = new BuiltinPluginRegistry(loader, { logger: { warn: () => {} } });

  const service = {
    listBuiltinVersions: async () => [
      { id: 'orphan-acme', pluginId: 'ca.acme', version: '1.0.0', status: 'ENABLED' },
      { id: 'orphan-openssl', pluginId: 'ca.openssl', version: '1.0.0', status: 'DISABLED' },
    ],
    disableVersion: async (id: string) => {
      if (id === 'orphan-acme') throw new Error('disable failed');
      return { id };
    },
    retireVersion: async (id: string) => ({ id }),
    importVersion: async (_tenantId: string, pluginPackage: { manifest: { pluginId: string; version: string } }) => ({
      id: `pv-${pluginPackage.manifest.pluginId}`,
      pluginId: pluginPackage.manifest.pluginId,
      version: pluginPackage.manifest.version,
      permissionApprovalStatus: 'APPROVED',
      status: 'DISABLED',
      manifest: pluginPackage.manifest,
    }),
    approvePermissions: async (id: string) => ({ id, status: 'DISABLED' }),
    enableVersion: async (id: string) => ({ id, status: 'ENABLED' }),
  } as unknown as Parameters<typeof registry.registerAll>[0];

  await registry.registerAll(service);

  // 失败的孤儿被跳过，其余孤儿仍完成退休，当前包正常安装。
  const installed = await registry.list();
  assert.equal(installed.length, 1);
  assert.equal(installed[0]?.pluginId, 'web.nginx');
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
