import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { PgliteDatabase } from './pglite-database.js';
import { runMigrations } from './migration-runner.js';
import {
  publishBuiltinPlugins,
  runDevelopmentDatabaseCutover,
} from './development-database-cutover.js';

const migrationsDirectory = resolve(process.cwd(), 'src/database/migrations');

async function createMigratedDatabase(): Promise<PgliteDatabase> {
  const db = new PgliteDatabase();
  await runMigrations(db, migrationsDirectory, {
    appliedBy: 'p2-development-cutover-test',
    checksum: (content) => createHash('sha256').update(content, 'utf8').digest('hex'),
  });
  return db;
}

test('开发数据库一次性切换发布 17 个真实 PluginVersion，写入备份和审计并可重放', async () => {
  const db = await createMigratedDatabase();
  const directory = await mkdtemp(join(tmpdir(), 'gcac-p2-cutover-'));
  try {
    const first = await runDevelopmentDatabaseCutover(db, {
      environment: { NODE_ENV: 'test', GCAC_P2_DEV_CUTOVER: '1' },
      backupPath: join(directory, 'first.backup.json'),
      reportPath: join(directory, 'first.report.json'),
    });

    assert.equal(first.expectedPluginCount, 17);
    assert.equal(first.publishedPluginVersionIds.length, 17);
    assert.ok(first.workflowBindingCount > 0);
    assert.ok(first.cleanupAuditCount >= 20);
    assert.deepEqual(JSON.parse(await readFile(first.backupPath, 'utf8')).environment, 'development');
    assert.deepEqual(JSON.parse(await readFile(first.reportPath, 'utf8')).expectedPluginCount, 17);

    const second = await runDevelopmentDatabaseCutover(db, {
      environment: { NODE_ENV: 'test', GCAC_P2_DEV_CUTOVER: '1' },
      backupPath: join(directory, 'second.backup.json'),
      reportPath: join(directory, 'second.report.json'),
    });
    assert.equal(second.expectedPluginCount, 17);
    assert.equal(second.after.counts.unified_plugin_versions, first.after.counts.unified_plugin_versions);
    assert.equal(second.after.counts.pg_documents, first.after.counts.pg_documents);
    assert.equal(
      (await db.query<{ count: string }>(
        `select count(*)::text as count
           from database_forward_cleanup_audits
          where audit_id = 'P2-F-DB-20260811-CUTOVER-DEV'`,
      )).rows[0]?.count,
      '1',
    );
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('开发数据库切换缺少显式开关或进入生产环境时失败关闭', async () => {
  const db = await createMigratedDatabase();
  try {
    await assert.rejects(
      () => runDevelopmentDatabaseCutover(db, { environment: { NODE_ENV: 'test' } }),
      /GCAC_P2_DEV_CUTOVER=1/,
    );
    await assert.rejects(
      () => runDevelopmentDatabaseCutover(db, { environment: { NODE_ENV: 'production', GCAC_P2_DEV_CUTOVER: '1' } }),
      /生产环境拒绝/,
    );
  } finally {
    await db.close();
  }
});

test('开发数据库切换发布失败时恢复切换前记录', async () => {
  const db = await createMigratedDatabase();
  const directory = await mkdtemp(join(tmpdir(), 'gcac-p2-cutover-failure-'));
  try {
    await assert.rejects(
      () => runDevelopmentDatabaseCutover(db, {
        environment: { NODE_ENV: 'test', GCAC_P2_DEV_CUTOVER: '1' },
        backupPath: join(directory, 'failure.backup.json'),
        publishPlugins: async (database, loader, expected) => {
          await publishBuiltinPlugins(database, loader, expected);
          throw new Error('模拟开发 PluginVersion 发布后切换失败');
        },
      }),
      /模拟开发 PluginVersion 发布后切换失败/,
    );
    assert.equal((await db.query<{ count: string }>('select count(*)::text as count from unified_plugin_versions')).rows[0]?.count, '0');
    assert.equal((await db.query<{ count: string }>(
      `select count(*)::text as count from pg_documents where namespace in ('workflow.templates', 'workflow.template_versions')`,
    )).rows[0]?.count, '0');
    assert.equal((await db.query<{ count: string }>(
      `select count(*)::text as count
         from database_forward_cleanup_audits
        where audit_id = 'P2-F-DB-20260811-CUTOVER-DEV'`,
    )).rows[0]?.count, '0');
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
