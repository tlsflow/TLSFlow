import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { runMigrations } from './migration-runner.js';
import { PgliteDatabase } from './pglite-database.js';

const activeMigrationDirectory = resolve(process.cwd(), 'src/database/migrations');
const baselineFile = '20260823000000_unified_current_baseline.sql';
const healthMigrationFile = '20260824000000_credential_health_check.sql';

test('活动迁移目录包含统一 baseline 和凭据健康递增迁移，空 PGlite 可直接建立当前结构', async () => {
  const files = (await readdir(activeMigrationDirectory)).filter((file) => file.endsWith('.sql')).sort();
  assert.deepEqual(files, [baselineFile, healthMigrationFile]);

  const db = new PgliteDatabase();
  try {
    await runMigrations(db, activeMigrationDirectory, { appliedBy: 'baseline-test' });
    assert.deepEqual(
      (await db.query<{ version: string; status: string }>('select version, status from schema_migrations')).rows,
      [
        { version: '20260823000000', status: 'APPLIED' },
        { version: '20260824000000', status: 'APPLIED' },
      ],
    );
    const requiredTables = (await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public'
          and table_name = any($1::text[])
        order by table_name`,
      [['tenants', 'tenant_memberships', 'system_initialization_state', 'pg_documents', 'job_queue', 'credential_health_states', 'credential_health_check_records']],
    )).rows.map((row) => row.table_name);
    assert.deepEqual(requiredTables, ['credential_health_check_records', 'credential_health_states', 'job_queue', 'pg_documents', 'system_initialization_state', 'tenant_memberships', 'tenants']);
    assert.equal((await db.query('select status from system_initialization_state where id = \'singleton\'')).rows[0]?.status, 'PENDING');
  } finally {
    await db.close();
  }
});

test('统一 baseline 后可继续执行同一套递增迁移并记录 checksum', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gcac-baseline-followup-'));
  const db = new PgliteDatabase();
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, baselineFile), await readFile(join(activeMigrationDirectory, baselineFile), 'utf8'), 'utf8');
    await writeFile(join(directory, '20260823000400_baseline_followup.sql'),
      'alter table public.system_initialization_state add column baseline_followup_marker text not null default \'ok\';\n',
      'utf8');
    const applied = await runMigrations(db, directory, { appliedBy: 'baseline-followup-test' });
    assert.deepEqual(applied.map((item) => item.version), ['20260823000000', '20260823000400']);
    assert.equal(
      (await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_name = 'system_initialization_state' and column_name = 'baseline_followup_marker'`,
      )).rows.length,
      1,
    );
    assert.equal((await db.query<{ count: string }>('select count(*)::text as count from schema_migrations')).rows[0]?.count, '2');
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
