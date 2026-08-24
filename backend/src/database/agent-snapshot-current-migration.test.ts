import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PgliteDatabase } from './pglite-database.js';
import { runMigrations } from './migration-runner.js';

describe('Agent 当前快照指针迁移', () => {
  it('创建轻量指针表、主键和完整 Web 成对约束', async () => {
    const db = new PgliteDatabase();
    try {
      await runMigrations(db, 'src/database/migrations');

      const columns = await db.query<{ column_name: string; data_type: string }>(
        `select column_name, data_type
           from information_schema.columns
          where table_name = 'pg_agent_capability_snapshot_current'
          order by ordinal_position`,
      );
      assert.deepEqual(columns.rows.map((row) => row.column_name), [
        'tenant_id',
        'agent_id',
        'latest_snapshot_id',
        'latest_reported_at',
        'latest_full_web_snapshot_id',
        'latest_full_web_reported_at',
        'updated_at',
      ]);
      assert.equal(columns.rows.find((row) => row.column_name === 'latest_reported_at')?.data_type, 'timestamp with time zone');

      const primaryKey = await db.query<{ indexname: string }>(
        `select indexname
           from pg_indexes
          where tablename = 'pg_agent_capability_snapshot_current'
            and indexname like '%pkey'`,
      );
      assert.equal(primaryKey.rows.length, 1);

      await db.query(
        `insert into pg_agent_capability_snapshot_current (
           tenant_id, agent_id, latest_snapshot_id, latest_reported_at
         ) values ('tenant-a', 'agent-a', 'snapshot-a', '2026-08-17T00:00:00.000Z')`,
      );
      await assert.rejects(
        () => db.query(
          `insert into pg_agent_capability_snapshot_current (
             tenant_id, agent_id, latest_snapshot_id, latest_reported_at,
             latest_full_web_snapshot_id
           ) values ('tenant-a', 'agent-b', 'snapshot-b', '2026-08-17T00:00:00.000Z', 'web-b')`,
        ),
        /pg_agent_snapshot_current_full_web_pair_check/,
      );
    } finally {
      await db.close();
    }
  });
});
