import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import test from 'node:test';
import type { UnifiedPluginVersionRecord } from '../dto/unified-plugins.dto.js';
import { UserPluginDirectoryImporter } from './user-plugin-directory-importer.js';

test('用户插件目录刷新按 USER 导入并发布 Workflow', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gcac-user-plugins-'));
  await copyUserFixture(root);
  const imported: Array<{ tenantId: string; source: string }> = [];
  const published: string[] = [];
  const version = { id: 'version-npm', tenantId: 'tenant-1', source: 'USER', runtime: 'WORKFLOW_DSL' } as UnifiedPluginVersionRecord;
  const importer = new UserPluginDirectoryImporter(
    {
      importVersion: async (tenantId, _input, sourceChannel) => {
        imported.push({ tenantId, source: sourceChannel ?? 'USER' });
        return version;
      },
      listVersions: async () => [],
      enableVersion: async () => version,
    },
    { publishPlugin: async (record) => { published.push(record.id); return []; } },
    root,
  );

  const result = await importer.importForTenant('tenant-1');
  assert.equal(result.attempted, 1);
  assert.equal(result.imported, 1);
  assert.equal(result.failed, 0);
  assert.deepEqual(imported, [{ tenantId: 'tenant-1', source: 'USER' }]);
  assert.deepEqual(published, ['version-npm']);
});

test('用户插件目录拒绝 Manifest.source 为 BUILTIN 的包', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gcac-user-plugins-source-'));
  const destination = await copyUserFixture(root);
  const manifestPath = join(destination, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
  manifest.source = 'BUILTIN';
  await writeFile(manifestPath, JSON.stringify(manifest), 'utf8');

  let importCount = 0;
  const importer = new UserPluginDirectoryImporter(
    { importVersion: async () => { importCount += 1; throw new Error('不应导入'); }, listVersions: async () => [], enableVersion: async () => { throw new Error('不应启用'); } },
    { publishPlugin: async () => [] },
    root,
  );
  const result = await importer.importForTenant('tenant-1');
  assert.equal(result.attempted, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.imported, 0);
  assert.equal(importCount, 0);
});

test('用户插件升级时继承上一版本的启用状态', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gcac-user-plugins-upgrade-'));
  await copyUserFixture(root);
  const previous: UnifiedPluginVersionRecord = {
    id: 'version-npm-010',
    tenantId: 'tenant-1',
    pluginId: 'device.nginx-proxy-manager',
    version: '0.1.0',
    source: 'USER',
    runtime: 'WORKFLOW_DSL',
    status: 'ENABLED',
  } as UnifiedPluginVersionRecord;
  const imported: UnifiedPluginVersionRecord = {
    ...previous,
    id: 'version-npm-011',
    version: '0.1.1',
    status: 'DISABLED',
  };
  const enabled: string[] = [];
  const importer = new UserPluginDirectoryImporter(
    {
      listVersions: async () => [previous],
      importVersion: async () => imported,
      enableVersion: async (id) => {
        enabled.push(id);
        return { ...imported, status: 'ENABLED' };
      },
    },
    { publishPlugin: async () => [] },
    root,
  );

  const result = await importer.importForTenant('tenant-1');

  assert.equal(result.imported, 1);
  assert.deepEqual(enabled, ['version-npm-011']);
  assert.equal(result.versions[0]?.version, '0.1.1');
  assert.equal(result.versions[0]?.status, 'ENABLED');
});

async function copyUserFixture(root: string): Promise<string> {
  const source = resolve(dirname(fileURLToPath(import.meta.url)), '../builtin-plugins/device-nginx-proxy-manager');
  const destination = join(root, 'nginx-proxy-manager');
  await cp(source, destination, { recursive: true });
  const manifestPath = join(destination, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
  manifest.publisher = 'GCAC 用户插件';
  manifest.source = 'USER';
  manifest.trust = 'UNSIGNED';
  manifest.support = 'SELF_MANAGED';
  await writeFile(manifestPath, JSON.stringify(manifest), 'utf8');
  return destination;
}
