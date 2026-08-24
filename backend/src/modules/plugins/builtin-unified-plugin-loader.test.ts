import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { AppError } from '../../common/errors/app-error.js';
import { BuiltinUnifiedPluginLoader } from './builtin-plugins/builtin-unified-plugin-loader.js';
import type { UnifiedPluginVersionRecord } from './dto/unified-plugins.dto.js';

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

test('内置插件包摘要冲突时复用已登记版本重试派生发布', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gcac-plugin-loader-recovery-'));
  const pluginDirectory = join(root, 'workflow-fixture');
  await mkdir(join(pluginDirectory, 'workflows'), { recursive: true });
  await mkdir(join(pluginDirectory, 'runtime'), { recursive: true });
  const manifest = {
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
    resources: { workflows: { 'certificate.deploy': 'workflows/deploy.json' } },
  };
  await writeFile(join(pluginDirectory, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  await writeFile(join(pluginDirectory, 'workflows/deploy.json'), '{}\n', 'utf8');

  const [pluginPackage] = await new BuiltinUnifiedPluginLoader(root).loadPackages();
  assert.ok(pluginPackage);
  const existing: UnifiedPluginVersionRecord = {
    id: 'existing-workflow-version',
    tenantId: 'SYSTEM',
    ownerType: 'SYSTEM',
    pluginId: 'fixture.workflow',
    version: '1.0.0',
    source: 'BUILTIN',
    runtime: 'WORKFLOW_DSL',
    scope: 'MANAGED',
    trust: 'OFFICIAL_SIGNED',
    support: 'OFFICIAL',
    manifest: manifest as UnifiedPluginVersionRecord['manifest'],
    packageSha256: 'sha256:database-package',
    manifestSha256: 'sha256:database-manifest',
    resourceSha256: {},
    resources: {},
    status: 'DISABLED',
    permissionApprovalStatus: 'APPROVED',
    approvedPermissions: [],
    validationReport: {
      valid: true,
      errors: [],
      warnings: [],
      manifestSha256: 'sha256:database-manifest',
      resourceSha256: {},
    },
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
  };
  let enabledId: string | undefined;
  const service = {
    listBuiltinVersions: async () => [existing],
    importVersion: async () => {
      throw new AppError('RESOURCE_VERSION_CONFLICT', '同一插件版本不可覆盖');
    },
    approvePermissions: async () => existing,
    enableVersion: async (id: string) => {
      enabledId = id;
      return { ...existing, status: 'ENABLED' as const };
    },
  } as unknown as Parameters<BuiltinUnifiedPluginLoader['installPackages']>[0];

  const [installed] = await new BuiltinUnifiedPluginLoader(root).installPackages(service, [pluginPackage]);

  assert.equal(installed?.id, existing.id);
  assert.equal(installed?.status, 'ENABLED');
  assert.equal(enabledId, existing.id);
  assert.equal(installed?.resources['workflows/deploy.json'], '{}\n');
});
