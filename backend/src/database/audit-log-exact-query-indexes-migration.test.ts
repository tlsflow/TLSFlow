import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from './pglite-database.js';
import { runMigrations } from './migration-runner.js';

test('审计日志精确查询索引迁移创建租户和资源索引', async () => {
  const db = new PgliteDatabase();
  try {
    await runMigrations(db, 'src/database/migrations');
    const indexes = await db.query<{ indexname: string }>(`
      select indexname
        from pg_indexes
       where tablename = 'pg_documents'
         and indexname = any($1::text[])`, [[
      'idx_pg_documents_audit_logs_tenant_actor_event',
      'idx_pg_documents_audit_logs_resource_type',
    ]]);
    assert.equal(indexes.rows.length, 2);
  } finally {
    await db.close();
  }
});
