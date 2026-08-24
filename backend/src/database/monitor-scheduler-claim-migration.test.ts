import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PgliteDatabase } from './pglite-database.js';
import { runMigrations } from './migration-runner.js';

describe('监控调度原子领取迁移', () => {
  it('为目标补充到期时间，并创建租户时间窗账本和查询索引', async () => {
    const db = new PgliteDatabase();
    try {
      await runMigrations(db, 'src/database/migrations');

      const nextRunAt = await db.query<{ is_nullable: string; data_type: string }>(
        `select is_nullable, data_type
           from information_schema.columns
          where table_name = 'pg_monitor_targets'
            and column_name = 'next_run_at'`,
      );
      assert.equal(nextRunAt.rows[0]?.is_nullable, 'NO');
      assert.equal(nextRunAt.rows[0]?.data_type, 'timestamp with time zone');

      const windowColumns = await db.query<{ column_name: string }>(
        `select column_name
           from information_schema.columns
          where table_name = 'pg_monitor_scheduler_windows'
          order by ordinal_position`,
      );
      assert.deepEqual(windowColumns.rows.map((row) => row.column_name), [
        'tenant_id',
        'window_start',
        'task_id',
        'candidate_count',
        'target_ids',
        'status',
        'last_error',
        'created_at',
        'updated_at',
      ]);

      const indexes = await db.query<{ indexname: string }>(
        `select indexname
           from pg_indexes
          where tablename in ('pg_monitor_targets', 'pg_monitor_scheduler_windows')`,
      );
      const names = new Set(indexes.rows.map((row) => row.indexname));
      assert.equal(names.has('idx_pg_monitor_targets_due_scheduler'), true);
      assert.equal(names.has('idx_pg_monitor_scheduler_windows_recovery'), true);
      assert.equal([...names].some((name) => name.includes('pg_monitor_scheduler_windows_pkey')), true);
    } finally {
      await db.close();
    }
  });
});
