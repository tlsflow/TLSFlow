import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from './pglite-database.js';
import { runMigrations } from './migration-runner.js';

test('文档历史精确查询索引迁移创建全部高频访问索引', async () => {
  const db = new PgliteDatabase();
  try {
    await runMigrations(db, 'src/database/migrations');
    const result = await db.query<{ indexname: string }>(`
      select indexname
        from pg_indexes
       where tablename = 'pg_documents'
         and indexname = any($1::text[])`, [[
      'idx_pg_documents_agent_tasks_idempotency',
      'idx_pg_documents_agent_task_logs_by_task',
      'idx_pg_documents_execution_runs_plan_created',
      'idx_pg_documents_execution_runs_idempotency',
      'idx_pg_documents_execution_steps_run_order',
      'idx_pg_documents_gateway_history_target',
      'idx_pg_documents_gateway_history_task',
      'idx_pg_documents_deployment_plans_tenant_updated',
      'idx_pg_documents_deployment_plans_idempotency',
      'idx_pg_documents_deployment_targets_plan',
      'idx_pg_documents_deployment_targets_asset',
      'idx_pg_documents_deployment_transitions_entity',
    ]]);
    assert.equal(result.rows.length, 12);
  } finally {
    await db.close();
  }
});
