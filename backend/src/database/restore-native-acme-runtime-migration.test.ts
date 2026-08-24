import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { PgliteDatabase } from './pglite-database.js';

const migrationName = '20260813000100_restore_native_acme_runtime.sql';
const migrationDirectory = resolve(process.cwd(), 'src/database/migrations');

async function applyMigrationsBeforeRestore(db: PgliteDatabase): Promise<void> {
  const files = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith('.sql') && file < migrationName)
    .sort();
  for (const file of files) await db.exec(await readFile(join(migrationDirectory, file), 'utf8'));
}

async function applyRestore(db: PgliteDatabase): Promise<void> {
  await db.exec(await readFile(join(migrationDirectory, migrationName), 'utf8'));
}

test('恢复原生 ACME 运行结构，并将遗留插件申请和操作固定为 UNKNOWN 审计状态', async () => {
  const db = new PgliteDatabase();
  try {
    await applyMigrationsBeforeRestore(db);
    await db.exec(`
      create table pg_acme_plugin_requests (
        id text primary key,
        tenant_id text not null default 'tenant-a',
        status text not null,
        unknown_reason text,
        next_action text,
        payload jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null
      );
      create table pg_acme_plugin_operations (
        id text primary key,
        tenant_id text not null default 'tenant-a',
        request_id text,
        status text not null,
        may_be_unknown boolean not null default false,
        last_error_code text,
        last_error_message text,
        payload jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null
      );
      insert into pg_acme_plugin_requests (id, status, updated_at) values
        ('request-pending', 'PENDING', now()),
        ('request-succeeded', 'SUCCEEDED', now());
      insert into pg_acme_plugin_operations (id, status, updated_at) values
        ('operation-running', 'RUNNING', now()),
        ('operation-failed', 'FAILED', now());
    `);

    await applyRestore(db);
    await applyRestore(db);

    assert.equal((await db.query(`
      select count(*)::text as count
      from information_schema.tables
      where table_name in (
        'pg_acme_accounts', 'pg_acme_orders', 'pg_acme_authorizations',
        'pg_acme_challenges', 'pg_acme_http01_presentations', 'pg_acme_renewal_policies'
      )
    `)).rows[0]?.count, '6');
    assert.equal((await db.query(`
      select count(*)::text as count
      from information_schema.tables
      where table_name in ('pg_acme_plugin_requests', 'pg_acme_plugin_operations')
    `)).rows[0]?.count, '2');
    assert.equal((await db.query(`
      select count(*)::text as count
      from information_schema.columns
      where table_name = 'pg_certificate_versions' and column_name = 'activation_state'
    `)).rows[0]?.count, '1');
    assert.deepEqual((await db.query(`
      select id, status, unknown_reason, next_action
      from pg_acme_plugin_requests
      order by id
    `)).rows, [
      {
        id: 'request-pending',
        status: 'UNKNOWN',
        unknown_reason: 'NATIVE_ACME_RUNTIME_RESTORED',
        next_action: 'manual_recovery_required',
      },
      { id: 'request-succeeded', status: 'SUCCEEDED', unknown_reason: null, next_action: null },
    ]);
    assert.deepEqual((await db.query(`
      select id, status, may_be_unknown, last_error_code
      from pg_acme_plugin_operations
      order by id
    `)).rows, [
      {
        id: 'operation-failed',
        status: 'FAILED',
        may_be_unknown: false,
        last_error_code: null,
      },
      {
        id: 'operation-running',
        status: 'UNKNOWN',
        may_be_unknown: true,
        last_error_code: 'NATIVE_ACME_RUNTIME_RESTORED',
      },
    ]);
  } finally {
    await db.close();
  }
});
