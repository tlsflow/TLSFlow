import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { PgliteDatabase } from './pglite-database.js';

const migrationDirectory = resolve(process.cwd(), 'src/database/migrations');
const firstForwardMigration = '20260809000100_plugin_runner_canonical_cutover.sql';
const expectedForwardMigrations = [
  '20260809000100_plugin_runner_canonical_cutover.sql',
  '20260809000200_plugin_runner_canonical_constraints.sql',
  '20260809000300_drop_legacy_plugin_storage.sql',
  '20260809000400_automation_canonical_target_resolver.sql',
  '20260809000500_database_forward_cleanup.sql',
  '20260809000600_remove_retired_agent_and_execution_records.sql',
  '20260809000700_retire_legacy_ca_runtime_data.sql',
  '20260809000800_remove_legacy_provider_runtime_records.sql',
  '20260809000900_scope_plugin_runner_constraints.sql',
  '20260810000100_plugin_runner_canonical_scope_fix.sql',
  '20260810000200_agent_plan_runtime.sql',
  '20260810000300_plugin_runner_canonical_agent_plan_scope.sql',
] as const;

async function readForwardMigrations(): Promise<string[]> {
  const files = (await readdir(migrationDirectory))
    .filter((file) => expectedForwardMigrations.includes(file as typeof expectedForwardMigrations[number]))
    .sort();
  assert.deepEqual(files, expectedForwardMigrations);
  return files;
}

async function applyHistoricalMigrations(db: PgliteDatabase): Promise<void> {
  const files = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith('.sql') && file < firstForwardMigration)
    .sort();
  for (const file of files) await db.exec(await readFile(join(migrationDirectory, file), 'utf8'));
}

async function applyForwardMigrations(db: PgliteDatabase, files: readonly string[]): Promise<void> {
  for (const file of files) {
    const sql = await readFile(join(migrationDirectory, file), 'utf8');
    await db.transaction((tx) => tx.exec(sql));
  }
}

async function schemaSnapshot(db: PgliteDatabase): Promise<Record<string, string>> {
  const result = await db.query<{ name: string; value: string }>(`
    select 'runner_bindings' as name, count(*)::text as value from plugin_runner_version_bindings
    union all select 'cleanup_audits', count(*)::text from database_forward_cleanup_audits
    union all select 'legacy_plugin_tables', count(*)::text
      from information_schema.tables
      where table_name in ('provider_registry', 'plugin_packages', 'legacy_plugin_migration_results')
    union all select 'automation_selector_column', count(*)::text
      from information_schema.columns
      where table_name = 'automation_versions' and column_name = 'target_selector'
    union all select 'runner_constraints', count(*)::text
      from pg_constraint
      where conname in (
        'ck_plugin_runner_version_bindings_protocol',
        'ck_plugin_runner_version_bindings_package_hash',
        'ck_plugin_runner_version_bindings_manifest_hash',
        'ck_plugin_runner_version_bindings_resource_hashes',
        'fk_plugin_runner_version_bindings_tenant_version'
      )
    union all select 'canonical_scope', coalesce((
      select pg_get_constraintdef(oid)
      from pg_constraint
      where conrelid = 'unified_plugin_versions'::regclass
        and conname = 'ck_unified_plugin_versions_canonical_id'
    ), '')
  `);
  return Object.fromEntries(result.rows.map((row) => [row.name, row.value]));
}

test('20260809 前向迁移在真实 PGlite schema 上严格按序执行、可重放且约束收口完成', async () => {
  const db = new PgliteDatabase();
  const files = await readForwardMigrations();
  await applyHistoricalMigrations(db);

  await applyForwardMigrations(db, files);
  const first = await schemaSnapshot(db);
  assert.equal(first.legacy_plugin_tables, '0');
  assert.equal(first.automation_selector_column, '0');
  assert.equal(first.runner_constraints, '5');
  assert.match(first.canonical_scope, /source.*BUILTIN.*runtime.*AGENT_PLAN/s);
  assert.doesNotMatch(first.canonical_scope, /AGENT_ATOMIC/);

  // 逐文件重新执行，验证临时表、函数、约束和清理审计都不会制造重复数据。
  await applyForwardMigrations(db, files);
  assert.deepEqual(await schemaSnapshot(db), first);
});

test('20260809 前向迁移整批失败时事务回滚，不留下半成品结构', async () => {
  const db = new PgliteDatabase();
  const files = await readForwardMigrations();
  await applyHistoricalMigrations(db);

  await assert.rejects(
    db.transaction(async (tx) => {
      for (const file of files) await tx.exec(await readFile(join(migrationDirectory, file), 'utf8'));
      throw new Error('模拟 20260809 前向迁移事务失败');
    }),
    /模拟 20260809 前向迁移事务失败/,
  );

  assert.equal(
    (await db.query(`select count(*)::text as count from information_schema.tables where table_name = 'plugin_runner_version_bindings'`)).rows[0]?.count,
    '0',
  );
  assert.equal(
    (await db.query(`select count(*)::text as count from information_schema.tables where table_name = 'database_forward_cleanup_audits'`)).rows[0]?.count,
    '0',
  );
  assert.equal(
    (await db.query(`select count(*)::text as count from information_schema.columns where table_name = 'automation_versions' and column_name = 'target_selector'`)).rows[0]?.count,
    '1',
  );
});
