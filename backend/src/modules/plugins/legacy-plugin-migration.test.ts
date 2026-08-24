import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PgliteDatabase } from '../../database/pglite-database.js';

test('旧插件迁移只映射精确身份，未匹配对象进入人工重导清单且不会自动启用', async () => {
  const db = new PgliteDatabase();
  await db.exec(`
    create table pg_documents (
      namespace varchar(128) not null,
      document_id varchar(128) not null,
      payload jsonb not null,
      updated_at timestamptz not null default now(),
      primary key (namespace, document_id)
    );
    create table plugin_packages (
      id uuid primary key,
      tenant_id uuid,
      name varchar(128) not null,
      plugin_version varchar(64) not null,
      status varchar(32) not null,
      deleted_at timestamptz
    );
    create table unified_plugin_versions (
      id varchar(128) primary key,
      tenant_id varchar(128) not null,
      plugin_id varchar(192) not null,
      plugin_version varchar(64) not null,
      status varchar(32) not null,
      created_at timestamptz not null,
      updated_at timestamptz not null
    );
    insert into unified_plugin_versions values
      ('uplgv_exact', 'tenant-1', 'vendor.exact', '1.2.3', 'ENABLED', now(), now()),
      ('uplgv_enabled', 'tenant-1', 'vendor.disabled', '2.0.0', 'ENABLED', now(), now());
    insert into pg_documents (namespace, document_id, payload) values
      ('plugins:packages', 'legacy-exact', '{"tenantId":"tenant-1","manifest":{"pluginId":"vendor.exact","version":"1.2.3"},"installStatus":"enabled"}'),
      ('plugins:packages', 'legacy-missing', '{"tenantId":"tenant-1","manifest":{"pluginId":"vendor.missing","version":"9.9.9"},"installStatus":"enabled"}'),
      ('plugins:packages', 'legacy-disabled', '{"tenantId":"tenant-1","manifest":{"pluginId":"vendor.disabled","version":"2.0.0"},"installStatus":"disabled"}'),
      ('plugins:executions', 'execution-exact', '{"pluginPackageId":"legacy-exact","status":"success"}'),
      ('plugins:executions', 'execution-orphan', '{"pluginPackageId":"legacy-orphan","status":"failed"}');
  `);

  const sql = await readFile(resolve(process.cwd(), 'src/database/migrations/20260730000500_migrate_legacy_plugin_packages.sql'), 'utf8');
  await db.exec(sql);
  await db.exec(sql);

  const results = await db.query<{ source_id: string; result: string; unified_plugin_version_id?: string }>(`
    select source_id, result, unified_plugin_version_id
    from legacy_plugin_migration_results
    where source_kind = 'DOCUMENT_PACKAGE'
    order by source_id
  `);
  assert.deepEqual(results.rows, [
    { source_id: 'legacy-disabled', result: 'MAPPED', unified_plugin_version_id: 'uplgv_enabled' },
    { source_id: 'legacy-exact', result: 'MAPPED', unified_plugin_version_id: 'uplgv_exact' },
    { source_id: 'legacy-missing', result: 'MANUAL_REIMPORT_REQUIRED', unified_plugin_version_id: null },
  ]);

  const statuses = await db.query<{ id: string; status: string }>('select id, status from unified_plugin_versions order by id');
  assert.deepEqual(statuses.rows, [
    { id: 'uplgv_enabled', status: 'DISABLED' },
    { id: 'uplgv_exact', status: 'ENABLED' },
  ]);

  const audits = await db.query<{ source_id: string; result: string; unified_plugin_version_id?: string }>(`
    select source_id, result, unified_plugin_version_id
    from legacy_plugin_migration_results
    where source_kind = 'EXECUTION_AUDIT'
    order by source_id
  `);
  assert.deepEqual(audits.rows, [
    { source_id: 'execution-exact', result: 'MAPPED', unified_plugin_version_id: 'uplgv_exact' },
    { source_id: 'execution-orphan', result: 'MANUAL_REIMPORT_REQUIRED', unified_plugin_version_id: null },
  ]);
});

test('旧插件迁移 SQL 不包含旧状态自动启用统一版本的旁路', async () => {
  const sql = await readFile(resolve(process.cwd(), 'src/database/migrations/20260730000500_migrate_legacy_plugin_packages.sql'), 'utf8');
  assert.equal(sql.includes("set status = 'ENABLED'"), false);
});
