import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
    const migrationFiles = (await readdir(new URL('./migrations/', import.meta.url)))
      .filter((file) => file.endsWith('.sql'))
      .sort();
    assert.deepEqual(
      applied.map((migration) => migration.version),
      migrationFiles.map((file) => file.split('_', 1)[0]),
    );

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
    const applied = await runMigrations(db, undefined, {
      appliedBy: 'tester',
      checksum: (content) => createHash('sha256').update(content).digest('hex'),
    });

    const migrationCount = await scalar<number>(db, 'select count(*)::int as count from schema_migrations');
    const currentVersion = await scalar<string>(db, "select current_version from schema_version_state where id = 'current'");

    assert.equal(migrationCount > 0, true);
    assert.equal(currentVersion, applied.at(-1)?.version);
  });

  it('迁移 checksum 不受 CRLF 与 LF 换行差异影响', async () => {
    const migrationsDir = await mkdtemp(join(tmpdir(), 'gcac-migration-line-endings-'));
    const migrationPath = join(migrationsDir, '20260812000100_line_endings.sql');
    const migrationSql = 'create table if not exists line_ending_fixture (id integer primary key);\n';
    const checksum = (content: string) => createHash('sha256').update(content).digest('hex');
    const db = new PgliteDatabase();

    try {
      await writeFile(migrationPath, migrationSql.replaceAll('\n', '\r\n'), 'utf8');
      const firstRun = await runMigrations(db, migrationsDir, { checksum });
      assert.equal(firstRun[0]?.checksum, checksum(migrationSql));

      await writeFile(migrationPath, migrationSql, 'utf8');
      const secondRun = await runMigrations(db, migrationsDir, { checksum });
      assert.equal(secondRun[0]?.status, 'APPLIED');
    } finally {
      await db.close();
      await rm(migrationsDir, { recursive: true, force: true });
    }
  });

  it('兼容按 CRLF 计算的历史迁移 checksum', async () => {
    const migrationsDir = await mkdtemp(join(tmpdir(), 'gcac-migration-legacy-checksum-'));
    const migrationPath = join(migrationsDir, '20260812000200_legacy_checksum.sql');
    const migrationSql = 'create table if not exists legacy_checksum_fixture (id integer primary key);\n';
    const crlfSql = migrationSql.replaceAll('\n', '\r\n');
    const checksum = (content: string) => createHash('sha256').update(content).digest('hex');
    const db = new PgliteDatabase();

    try {
      await writeFile(migrationPath, crlfSql, 'utf8');
      await runMigrations(db, migrationsDir, { checksum });
      await db.query('update schema_migrations set checksum = $1 where version = $2', [
        checksum(crlfSql),
        '20260812000200',
      ]);

      await writeFile(migrationPath, migrationSql, 'utf8');
      const rerun = await runMigrations(db, migrationsDir, { checksum });

      assert.equal(rerun[0]?.status, 'APPLIED');
      assert.equal(rerun[0]?.checksum, checksum(migrationSql));
    } finally {
      await db.close();
      await rm(migrationsDir, { recursive: true, force: true });
    }
  });

  it('迁移实际内容变化时仍拒绝已执行记录', async () => {
    const migrationsDir = await mkdtemp(join(tmpdir(), 'gcac-migration-content-change-'));
    const migrationPath = join(migrationsDir, '20260812000300_content_change.sql');
    const originalSql = 'create table if not exists content_change_fixture (id integer primary key);\n';
    const changedSql = 'create table if not exists content_change_fixture (id bigint primary key);\n';
    const checksum = (content: string) => createHash('sha256').update(content).digest('hex');
    const db = new PgliteDatabase();

    try {
      await writeFile(migrationPath, originalSql.replaceAll('\n', '\r\n'), 'utf8');
      await runMigrations(db, migrationsDir, { checksum });
      await db.query('update schema_migrations set checksum = $1 where version = $2', [
        checksum(originalSql.replaceAll('\n', '\r\n')),
        '20260812000300',
      ]);

      await writeFile(migrationPath, changedSql, 'utf8');
      await assert.rejects(
        runMigrations(db, migrationsDir, { checksum }),
        /迁移 20260812000300 checksum 不一致/,
      );
    } finally {
      await db.close();
      await rm(migrationsDir, { recursive: true, force: true });
    }
  });

  it('只在显式开启时重试失败迁移，且允许重试已修复的当前内容', async () => {
    const migrationsDir = await mkdtemp(join(tmpdir(), 'gcac-migration-retry-failed-'));
    const migrationPath = join(migrationsDir, '20260812000400_retry_failed.sql');
    const migrationSql = 'create table if not exists retry_failed_fixture (id integer primary key);\n';
    const repairedMigrationSql = 'create table if not exists retry_failed_fixture_repaired (id integer primary key);\n';
    const checksum = (content: string) => createHash('sha256').update(content).digest('hex');
    const db = new PgliteDatabase();

    try {
      await writeFile(migrationPath, migrationSql, 'utf8');
      await runMigrations(db, migrationsDir, { checksum });
      await db.query(
        "update schema_migrations set status = 'FAILED', error_message = 'test failure' where version = $1",
        ['20260812000400'],
      );

      await assert.rejects(
        runMigrations(db, migrationsDir, { checksum }),
        /迁移 20260812000400 之前执行失败/,
      );

      await writeFile(migrationPath, repairedMigrationSql, 'utf8');
      await assert.rejects(
        runMigrations(db, migrationsDir, { checksum }),
        /迁移 20260812000400 checksum 不一致/,
      );

      const retried = await runMigrations(db, migrationsDir, {
        checksum,
        retryFailedMigrations: true,
      });
      assert.equal(retried[0]?.status, 'APPLIED');
      assert.equal(
        (await db.query(`select count(*)::text as count from information_schema.tables where table_name = 'retry_failed_fixture_repaired'`)).rows[0]?.count,
        '1',
      );
    } finally {
      await db.close();
      await rm(migrationsDir, { recursive: true, force: true });
    }
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
