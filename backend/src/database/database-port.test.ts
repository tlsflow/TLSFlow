import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PgliteDatabase } from './pglite-database.js';
import { runMigrations } from './migration-runner.js';
import { scalar } from './database-port.js';
import { coreTableNames } from './schema/core-schema.js';

describe('数据库端口和迁移执行器', { concurrency: false }, () => {
  it('可以通过 DatabasePort 执行核心迁移', async () => {
    const db = new PgliteDatabase();
    const applied = await runMigrations(db, undefined, {
      appliedBy: 'test',
      checksum: (content) => createHash('sha256').update(content).digest('hex'),
    });
    assert.equal(applied.some((migration) => migration.version === '20260608000100'), true);

    const tableCount = await scalar<number>(db, `
      select count(*)::int as count
      from pg_tables
      where schemaname = 'public'
        and tablename = any(array[${coreTableNames.map((name) => `'${name}'`).join(',')}])
    `);
    assert.equal(tableCount, coreTableNames.length);
  });

  it('迁移会写入 schema_migrations 和 schema_version_state', async () => {
    const db = new PgliteDatabase();
    await runMigrations(db, undefined, {
      appliedBy: 'tester',
      checksum: (content) => createHash('sha256').update(content).digest('hex'),
    });

    const migrationCount = await scalar<number>(db, 'select count(*)::int as count from schema_migrations');
    const currentVersion = await scalar<string>(db, "select current_version from schema_version_state where id = 'current'");

    assert.equal(migrationCount > 0, true);
    assert.equal(currentVersion, '20260703000100');
  });

  it('旧版 ServiceAsset 迁移状态可以继续追加 platform 和 agent_id 字段', async () => {
    const db = new PgliteDatabase();
    const migrationPath = resolve(process.cwd(), 'src/database/migrations/20260618000100_service_assets.sql');
    const currentSql = await readFile(migrationPath, 'utf8');
    const legacySql = currentSql
      .replace(/^  platform varchar\(16\),\r?\n/m, '')
      .replace(/^  agent_id text,\r?\n/m, '')
      .replace(/^create index if not exists idx_pg_service_assets_agent on pg_service_assets \(tenant_id, agent_id\);\r?\n/m, '');
    const legacyChecksum = createHash('sha256').update(legacySql).digest('hex');

    await runMigrations(db, undefined, {
      appliedBy: 'legacy-bootstrap',
      checksum: (content) => createHash('sha256').update(content).digest('hex'),
    });

    await db.exec('drop index if exists idx_pg_service_assets_agent;');
    await db.exec('alter table pg_service_assets drop column if exists platform;');
    await db.exec('alter table pg_service_assets drop column if exists agent_id;');
    await db.query('update schema_migrations set checksum = $1 where version = $2', [legacyChecksum, '20260618000100']);
    await db.query('delete from schema_migrations where version = $1', ['20260621000100']);
    await db.query('update schema_version_state set current_version = $1 where id = $2', ['20260618000100', 'current']);

    await runMigrations(db, undefined, {
      appliedBy: 'legacy-upgrade',
      checksum: (content) => createHash('sha256').update(content).digest('hex'),
    });

    const columns = await db.query<{ column_name: string }>(`
      select column_name
      from information_schema.columns
      where table_name = 'pg_service_assets'
        and column_name in ('platform', 'agent_id')
      order by column_name
    `);
    const indexes = await db.query<{ indexname: string }>(`
      select indexname
      from pg_indexes
      where tablename = 'pg_service_assets'
        and indexname = 'idx_pg_service_assets_agent'
    `);
    const currentVersion = await scalar<string>(db, "select current_version from schema_version_state where id = 'current'");

    assert.deepEqual(columns.rows.map((row) => row.column_name), ['agent_id', 'platform']);
    assert.equal(indexes.rows.length, 1);
    assert.equal(currentVersion, '20260621000100');
  });

  it('事务失败时会回滚已经写入的数据', async () => {
    const db = new PgliteDatabase();
    await db.exec('create table tx_test (id text primary key, name text not null)');

    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.exec("insert into tx_test (id, name) values ('1', 'before-error')");
        throw new Error('boom');
      }),
    );

    const count = await scalar<number>(db, 'select count(*)::int as count from tx_test');
    assert.equal(count, 0);
  });

  it('事务成功时提交写入', async () => {
    const db = new PgliteDatabase();
    await db.exec('create table tx_commit_test (id text primary key, name text not null)');

    await db.transaction(async (tx) => {
      await tx.exec("insert into tx_commit_test (id, name) values ('1', 'committed')");
    });

    const name = await scalar<string>(db, "select name from tx_commit_test where id = '1'");
    assert.equal(name, 'committed');
  });
});
