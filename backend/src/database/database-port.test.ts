import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import { PgliteDatabase } from './pglite-database.js';
import { runMigrations } from './migration-runner.js';
import { scalar } from './database-port.js';
import { coreTableNames } from './schema/core-schema.js';

describe('数据库端口和迁移执行器', () => {
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
    assert.equal(currentVersion, '20260608000100');
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
