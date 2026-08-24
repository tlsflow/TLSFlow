import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { PgliteDatabase } from './pglite-database.js';

const migrationName = '20260809000600_remove_retired_agent_and_execution_records.sql';
const migrationDirectory = resolve(process.cwd(), 'src/database/migrations');

async function migratedDbBeforeCutover(): Promise<PgliteDatabase> {
  const db = new PgliteDatabase();
  const files = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith('.sql') && file < migrationName)
    .sort();
  for (const file of files) await db.exec(await readFile(join(migrationDirectory, file), 'utf8'));
  return db;
}

async function seedRetiredRows(db: PgliteDatabase): Promise<void> {
  const tenant = (await db.query<{ id: string }>(`select id::text as id from tenants where code = 'default'`)).rows[0];
  assert.ok(tenant);

  await db.exec(`
    insert into agents (id, tenant_id, agent_type, agent_version, install_id, protocol_version)
    values ('00000000-0000-0000-0000-000000000101', '${tenant.id}', 'LEGACY', '0.1.0', 'legacy-install-1', 'legacy/v1');
    insert into hosts (id, tenant_id, hostname, os_type, compatibility_level, management_mode)
    values ('00000000-0000-0000-0000-000000000102', '${tenant.id}', 'legacy-host', 'LINUX', 'L1', 'LEGACY_AGENT');
    insert into target_capabilities (id, tenant_id, target_type, target_id, capability_key, capability_value, source, confidence)
    values ('00000000-0000-0000-0000-000000000104', '${tenant.id}', 'AGENT', '00000000-0000-0000-0000-000000000101', 'process.exec', '{}'::jsonb, 'DETECTED', 100);
    insert into execution_targets (id, tenant_id, target_kind, host_id, status)
    values ('00000000-0000-0000-0000-000000000103', '${tenant.id}', 'SCRIPT_PACKAGE', '00000000-0000-0000-0000-000000000102', 'ACTIVE');
    insert into pg_documents (namespace, document_id, payload)
    values ('agents:registrations', 'legacy-registration', jsonb_build_object('agentId', '00000000-0000-0000-0000-000000000101'));
  `);
}

test('前向清理删除旧 Agent、旧执行目标和旧能力，并收紧数据库约束', async () => {
  const db = await migratedDbBeforeCutover();
  await seedRetiredRows(db);
  const sql = await readFile(join(migrationDirectory, migrationName), 'utf8');

  await db.exec(sql);

  assert.equal((await db.query(`select count(*)::text as count from agents where agent_type = 'LEGACY'`)).rows[0]?.count, '0');
  assert.equal((await db.query(`select count(*)::text as count from execution_targets where target_kind = 'SCRIPT_PACKAGE'`)).rows[0]?.count, '0');
  assert.equal((await db.query(`select count(*)::text as count from target_capabilities where capability_key = 'process.exec'`)).rows[0]?.count, '0');
  assert.equal((await db.query(`select count(*)::text as count from pg_documents where document_id = 'legacy-registration'`)).rows[0]?.count, '0');
  assert.equal((await db.query(`select management_mode from hosts where id = '00000000-0000-0000-0000-000000000102'`)).rows[0]?.management_mode, 'AGENTLESS');

  await assert.rejects(db.exec(`
    insert into agents (id, tenant_id, agent_type, agent_version, install_id, protocol_version)
    select '00000000-0000-0000-0000-000000000105', id, 'LEGACY', '0.1.0', 'legacy-install-2', 'legacy/v1'
    from tenants where code = 'default'
  `));
  await assert.rejects(db.exec(`
    insert into execution_targets (id, tenant_id, target_kind, endpoint)
    select '00000000-0000-0000-0000-000000000106', id, 'SCRIPT_PACKAGE', 'legacy://target'
    from tenants where code = 'default'
  `));

  await db.exec(sql);
  assert.equal((await db.query(`select count(*)::text as count from database_forward_cleanup_audits where migration_version = '20260809000600'`)).rows[0]?.count, '4');
});
