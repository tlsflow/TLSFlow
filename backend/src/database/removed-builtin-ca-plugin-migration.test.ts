import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { PgliteDatabase } from './pglite-database.js';

const migrationName = '20260816000200_retire_removed_builtin_ca_plugins.sql';
const migrationDirectory = resolve(process.cwd(), 'src/database/migrations');

async function applyMigrationsBefore(db: PgliteDatabase): Promise<void> {
  const files = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith('.sql') && file < migrationName)
    .sort();
  for (const file of files) await db.exec(await readFile(join(migrationDirectory, file), 'utf8'));
}

async function applyMigration(db: PgliteDatabase): Promise<void> {
  await db.exec(await readFile(join(migrationDirectory, migrationName), 'utf8'));
}

async function seed(db: PgliteDatabase): Promise<void> {
  await db.exec(`
    insert into unified_plugin_versions (
      id, tenant_id, owner_type, owner_id, plugin_id, plugin_version, source, runtime, scope, trust, support,
      manifest, package_sha256, manifest_sha256, resource_sha256, status,
      permission_approval_status, approved_permissions, validation_report, created_at, updated_at
    ) values
      ('pv-ca-acme', 'SYSTEM', 'SYSTEM', null, 'ca.acme', '1.0.0', 'BUILTIN', 'WORKFLOW_DSL', 'BOTH', 'OFFICIAL_SIGNED', 'OFFICIAL',
       '{"pluginId":"ca.acme","version":"1.0.0","runtime":"WORKFLOW_DSL"}'::jsonb, 'sha256:acme', 'sha256:acme', '{}'::jsonb,
       'ENABLED', 'APPROVED', '[]'::jsonb, '{}'::jsonb, now(), now()),
      ('pv-ca-acme-dns', 'SYSTEM', 'SYSTEM', null, 'ca.acme-dns', '1.0.0', 'BUILTIN', 'WORKFLOW_DSL', 'BOTH', 'OFFICIAL_SIGNED', 'OFFICIAL',
       '{"pluginId":"ca.acme-dns","version":"1.0.0","runtime":"WORKFLOW_DSL"}'::jsonb, 'sha256:acmedns', 'sha256:acmedns', '{}'::jsonb,
       'ENABLED', 'APPROVED', '[]'::jsonb, '{}'::jsonb, now(), now()),
      ('pv-ca-openssl', 'SYSTEM', 'SYSTEM', null, 'ca.openssl', '1.0.0', 'BUILTIN', 'WORKFLOW_DSL', 'BOTH', 'OFFICIAL_SIGNED', 'OFFICIAL',
       '{"pluginId":"ca.openssl","version":"1.0.0","runtime":"WORKFLOW_DSL"}'::jsonb, 'sha256:openssl', 'sha256:openssl', '{}'::jsonb,
       'ENABLED', 'APPROVED', '[]'::jsonb, '{}'::jsonb, now(), now()),
      ('pv-adcs', 'SYSTEM', 'SYSTEM', null, 'ca.microsoft-adcs', '1.0.0', 'BUILTIN', 'AGENT_PLAN', 'BOTH', 'OFFICIAL_SIGNED', 'OFFICIAL',
       '{"pluginId":"ca.microsoft-adcs","version":"1.0.0","runtime":"AGENT_PLAN"}'::jsonb, 'sha256:adcs', 'sha256:adcs', '{}'::jsonb,
       'ENABLED', 'APPROVED', '[]'::jsonb, '{}'::jsonb, now(), now());

    insert into unified_plugin_bindings (
      id, tenant_id, plugin_version_id, mode, input_bindings,
      managed_context, status, version, created_at, updated_at
    ) values
      ('binding-acme', 'tenant-ca', 'pv-ca-acme', 'MANAGED',
       '{"apiVersion":"gcac.input-bindings/v1","variables":{},"connections":{},"credentials":{},"artifacts":{}}'::jsonb,
       null, 'ACTIVE', 1, now(), now()),
      ('binding-adcs', 'tenant-ca', 'pv-adcs', 'MANAGED',
       '{"apiVersion":"gcac.input-bindings/v1","variables":{},"connections":{},"credentials":{},"artifacts":{}}'::jsonb,
       null, 'ACTIVE', 1, now(), now());

    insert into plugin_capability_assignments (
      id, tenant_id, owner_type, owner_id, capability_key, plugin_version_id, plugin_binding_id,
      precedence, status, created_at, updated_at
    ) values
      ('assign-acme', 'tenant-ca', 'DEVICE', 'device-1', 'ca.certificate.issue', 'pv-ca-acme', 'binding-acme',
       'DEVICE_DEFAULT', 'ACTIVE', now(), now()),
      ('assign-adcs', 'tenant-ca', 'DEVICE', 'device-2', 'ca.certificate.issue', 'pv-adcs', 'binding-adcs',
       'DEVICE_DEFAULT', 'ACTIVE', now(), now());
  `);
}

test('迁移退休已删除的内置 CA 插件版本记录并保留现有插件', async () => {
  const db = new PgliteDatabase();
  await applyMigrationsBefore(db);
  await seed(db);

  await applyMigration(db);

  const versions = (await db.query<{ id: string; plugin_id: string; status: string; validation_report: unknown }>(`
    select id, plugin_id, status, validation_report from unified_plugin_versions
    where plugin_id in ('ca.acme', 'ca.acme-dns', 'ca.openssl', 'ca.microsoft-adcs')
    order by plugin_id
  `)).rows;
  assert.equal(versions.length, 4);
  const byPluginId = new Map(versions.map((row) => [row.plugin_id, row]));
  for (const pluginId of ['ca.acme', 'ca.acme-dns', 'ca.openssl']) {
    const row = byPluginId.get(pluginId);
    assert.ok(row, `缺少记录 ${pluginId}`);
    assert.equal(row.status, 'RETIRED', `${pluginId} 应被退休`);
    const report = row.validation_report as { removedBuiltinCaPlugin?: { status?: string } };
    assert.equal(report.removedBuiltinCaPlugin?.status, 'RETIRED', `${pluginId} 应写入清退标记`);
  }
  assert.equal(byPluginId.get('ca.microsoft-adcs')?.status, 'ENABLED', '现有 CA 插件不得受影响');

  const bindings = (await db.query<{ id: string; status: string }>(`
    select id, status from unified_plugin_bindings where id in ('binding-acme', 'binding-adcs') order by id
  `)).rows;
  assert.equal(bindings.find((row) => row.id === 'binding-acme')?.status, 'DISABLED', '孤儿插件绑定应作废');
  assert.equal(bindings.find((row) => row.id === 'binding-adcs')?.status, 'ACTIVE', '现有插件绑定不得受影响');

  const assignments = (await db.query<{ id: string; status: string }>(`
    select id, status from plugin_capability_assignments where id in ('assign-acme', 'assign-adcs') order by id
  `)).rows;
  assert.equal(assignments.find((row) => row.id === 'assign-acme')?.status, 'DISABLED', '孤儿插件能力分配应作废');
  assert.equal(assignments.find((row) => row.id === 'assign-adcs')?.status, 'ACTIVE', '现有插件能力分配不得受影响');

  const audits = (await db.query<{ reason: string }>(`
    select distinct reason from database_forward_cleanup_audits
    where migration_version = '20260816000200'
  `)).rows.map((row) => row.reason).sort();
  assert.deepEqual(audits, ['DISABLED_REMOVED_CA_ASSIGNMENT', 'DISABLED_REMOVED_CA_BINDING', 'RETIRED_REMOVED_BUILTIN_CA_PLUGIN']);
});

test('迁移幂等：已退休记录与已作废绑定再次执行不报错', async () => {
  const db = new PgliteDatabase();
  await applyMigrationsBefore(db);
  await seed(db);
  await applyMigration(db);

  await applyMigration(db);

  const rows = (await db.query<{ plugin_id: string; status: string }>(`
    select plugin_id, status from unified_plugin_versions
    where plugin_id in ('ca.acme', 'ca.acme-dns', 'ca.openssl') order by plugin_id
  `)).rows;
  assert.deepEqual(rows.map((row) => row.status), ['RETIRED', 'RETIRED', 'RETIRED']);
});

test('迁移是递增新增版本，且 Git 中没有改写历史迁移', async () => {
  const files = (await readdir(migrationDirectory)).filter((file) => file.endsWith('.sql')).sort();
  assert.equal(files.filter((file) => file === migrationName).length, 1);
  const migrationIndex = files.indexOf(migrationName);
  assert.equal(migrationIndex >= 0, true);
  assert.equal(files.slice(0, migrationIndex).every((file) => file < migrationName), true);

  const changedHistoricalFiles = execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACDMRTUXB', '--', 'backend/src/database/migrations'],
    { cwd: resolve(process.cwd(), '..'), encoding: 'utf8' },
  )
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((file) => file !== `backend/src/database/migrations/${migrationName}`);
  assert.deepEqual(changedHistoricalFiles, []);
});
