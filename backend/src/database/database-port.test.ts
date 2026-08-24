import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PgliteDatabase } from './pglite-database.js';
import { runMigrations } from './migration-runner.js';
import { scalar } from './database-port.js';
import { coreTableNames } from './schema/core-schema.js';

describe('数据库端口和迁移执行器', () => {
  it('可以通过 DatabasePort 执行核心迁移', async () => {
    const db = new PgliteDatabase();
    const applied = await runMigrations(db);
    assert.equal(applied.some((migration) => migration.version === '20260608000100'), true);

    const tableCount = await scalar<number>(db, `
      select count(*)::int as count
      from pg_tables
      where schemaname = 'public'
        and tablename = any(array[${coreTableNames.map((name) => `'${name}'`).join(',')}])
    `);
    assert.equal(tableCount, coreTableNames.length);
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
