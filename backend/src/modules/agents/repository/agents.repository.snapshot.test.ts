import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { runMigrations } from '../../../database/migration-runner.js';
import { PgAgentsRepository } from './agents.repository.js';
import type { AgentCapabilitySnapshot } from '../schema/agents.schema.js';

function snapshot(
  id: string,
  tenantId: string,
  agentId: string,
  reportedAt: string | undefined,
  capabilities: AgentCapabilitySnapshot['capabilities'] = [],
): AgentCapabilitySnapshot {
  return {
    id,
    tenantId,
    agentId,
    capabilities,
    reportedAt: reportedAt as string,
    requestId: `request-${id}`,
  };
}

async function insertSnapshot(db: PgliteDatabase, value: AgentCapabilitySnapshot): Promise<void> {
  await db.query(
    `insert into pg_documents (namespace, document_id, payload, updated_at)
     values ('agents:snapshots', $1, $2::jsonb, now())`,
    [value.id, JSON.stringify(value)],
  );
}

describe('PgAgentsRepository 最新快照查询', () => {
  it('只返回同租户同 Agent 的最新有时间快照', async () => {
    const db = new PgliteDatabase();
    try {
      await runMigrations(db, 'src/database/migrations');
      const repository = new PgAgentsRepository(db);
      await insertSnapshot(db, snapshot('old', 'tenant-a', 'agent-a', '2026-08-16T00:00:00.000Z'));
      await insertSnapshot(db, snapshot('new', 'tenant-a', 'agent-a', '2026-08-17T00:00:00.000Z'));
      await insertSnapshot(db, snapshot('other-tenant', 'tenant-b', 'agent-a', '2026-08-18T00:00:00.000Z'));
      await insertSnapshot(db, snapshot('other-agent', 'tenant-a', 'agent-b', '2026-08-19T00:00:00.000Z'));
      await insertSnapshot(db, snapshot('missing-time', 'tenant-a', 'agent-a', undefined));

      const result = await repository.getLatestCapabilitySnapshot('tenant-a', 'agent-a');
      assert.equal(result?.id, 'new');
      assert.equal(result?.tenantId, 'tenant-a');
      assert.equal(result?.agentId, 'agent-a');
    } finally {
      await db.close();
    }
  });

  it('在 SQL 中过滤完整 Web 发现条件并保持租户隔离', async () => {
    const db = new PgliteDatabase();
    try {
      await runMigrations(db, 'src/database/migrations');
      const repository = new PgAgentsRepository(db);
      const fullWeb = (scope: string) => [{
        capabilityKey: 'web.inventory',
        value: { scope },
        confidence: 1,
      }];

      await insertSnapshot(db, snapshot('full-old', 'tenant-a', 'agent-a', '2026-08-16T00:00:00.000Z', fullWeb('FULL_WEB_DISCOVERY')));
      await insertSnapshot(db, snapshot('partial-new', 'tenant-a', 'agent-a', '2026-08-18T00:00:00.000Z', fullWeb('PARTIAL_WEB_DISCOVERY')));
      await insertSnapshot(db, snapshot('full-new', 'tenant-a', 'agent-a', '2026-08-17T00:00:00.000Z', fullWeb('FULL_WEB_DISCOVERY')));
      await insertSnapshot(db, snapshot('wrong-tenant', 'tenant-b', 'agent-a', '2026-08-19T00:00:00.000Z', fullWeb('FULL_WEB_DISCOVERY')));
      await insertSnapshot(db, snapshot('missing-capability', 'tenant-a', 'agent-a', '2026-08-20T00:00:00.000Z'));

      const result = await repository.getLatestFullWebInventorySnapshot('tenant-a', 'agent-a');
      assert.equal(result?.id, 'full-new');
      assert.equal(result?.capabilities[0]?.capabilityKey, 'web.inventory');
      assert.equal((result?.capabilities[0]?.value as { scope?: string })?.scope, 'FULL_WEB_DISCOVERY');
    } finally {
      await db.close();
    }
  });

  it('没有匹配的完整 Web 事实时返回空结果', async () => {
    const db = new PgliteDatabase();
    try {
      await runMigrations(db, 'src/database/migrations');
      const repository = new PgAgentsRepository(db);
      await insertSnapshot(db, snapshot('no-web', 'tenant-a', 'agent-a', '2026-08-17T00:00:00.000Z', [{
        capabilityKey: 'web.inventory',
        value: {},
        confidence: 1,
      }]));

      assert.equal(await repository.getLatestFullWebInventorySnapshot('tenant-a', 'agent-a'), undefined);
    } finally {
      await db.close();
    }
  });

  it('历史写入和当前指针在同一事务中提交，乱序上报不会回退指针', async () => {
    const db = new PgliteDatabase();
    try {
      await runMigrations(db, 'src/database/migrations');
      const repository = new PgAgentsRepository(db);
      const fullWeb = [{ capabilityKey: 'web.inventory', value: { scope: 'FULL_WEB_DISCOVERY' }, confidence: 1 }];

      await repository.saveCapabilitySnapshot(snapshot('new', 'tenant-a', 'agent-a', '2026-08-17T00:00:00.000Z', fullWeb));
      await repository.saveCapabilitySnapshot(snapshot('old', 'tenant-a', 'agent-a', '2026-08-16T00:00:00.000Z', fullWeb));

      const pointer = await db.query<{
        latest_snapshot_id: string;
        latest_reported_at: Date;
        latest_full_web_snapshot_id: string;
        latest_full_web_reported_at: Date;
      }>(
        `select latest_snapshot_id, latest_reported_at, latest_full_web_snapshot_id, latest_full_web_reported_at
           from pg_agent_capability_snapshot_current
          where tenant_id = 'tenant-a' and agent_id = 'agent-a'`,
      );
      assert.equal(pointer.rows[0]?.latest_snapshot_id, 'new');
      assert.equal(pointer.rows[0]?.latest_reported_at.toISOString(), '2026-08-17T00:00:00.000Z');
      assert.equal(pointer.rows[0]?.latest_full_web_snapshot_id, 'new');
      assert.equal(pointer.rows[0]?.latest_full_web_reported_at.toISOString(), '2026-08-17T00:00:00.000Z');
      const history = await db.query<{ count: number }>(
        `select count(*)::int as count
           from pg_documents
          where namespace = 'agents:snapshots' and payload->>'tenantId' = 'tenant-a' and payload->>'agentId' = 'agent-a'`,
      );
      assert.equal(history.rows[0]?.count, 2);
    } finally {
      await db.close();
    }
  });

  it('指针更新失败时回滚历史写入', async () => {
    const db = new PgliteDatabase();
    try {
      await runMigrations(db, 'src/database/migrations');
      const repository = new PgAgentsRepository(db);
      await assert.rejects(
        () => repository.saveCapabilitySnapshot(snapshot('invalid-time', 'tenant-a', 'agent-a', 'not-a-timestamp')),
        /invalid input syntax for type timestamp with time zone|date\/time field value out of range/i,
      );
      const history = await db.query<{ count: number }>(
        `select count(*)::int as count
           from pg_documents
          where namespace = 'agents:snapshots' and document_id = 'invalid-time'`,
      );
      assert.equal(history.rows[0]?.count, 0);
      const pointer = await db.query<{ count: number }>(
        `select count(*)::int as count
           from pg_agent_capability_snapshot_current
          where tenant_id = 'tenant-a' and agent_id = 'agent-a'`,
      );
      assert.equal(pointer.rows[0]?.count, 0);
    } finally {
      await db.close();
    }
  });

  it('在数据库内分批回填当前指针并返回可恢复游标', async () => {
    const db = new PgliteDatabase();
    try {
      await runMigrations(db, 'src/database/migrations');
      const repository = new PgAgentsRepository(db);
      const fullWeb = [{ capabilityKey: 'web.inventory', value: { scope: 'FULL_WEB_DISCOVERY' }, confidence: 1 }];
      await insertSnapshot(db, snapshot('a-old', 'tenant-a', 'agent-a', '2026-08-15T00:00:00.000Z'));
      await insertSnapshot(db, snapshot('a-new', 'tenant-a', 'agent-a', '2026-08-17T00:00:00.000Z', fullWeb));
      await insertSnapshot(db, snapshot('a-b', 'tenant-a', 'agent-b', '2026-08-16T00:00:00.000Z'));
      await insertSnapshot(db, snapshot('b-a', 'tenant-b', 'agent-a', '2026-08-18T00:00:00.000Z', fullWeb));

      let after: { tenantId: string; agentId: string } | undefined;
      let processed = 0;
      for (;;) {
        const result = await repository.backfillCurrentSnapshotPointers({ limit: 1, after });
        processed += result.processed;
        if (!result.next) break;
        after = result.next;
      }
      assert.equal(processed, 3);

      const pointers = await db.query<{ tenant_id: string; agent_id: string; latest_snapshot_id: string; latest_full_web_snapshot_id: string | null }>(
        `select tenant_id, agent_id, latest_snapshot_id, latest_full_web_snapshot_id
           from pg_agent_capability_snapshot_current
          order by tenant_id, agent_id`,
      );
      assert.deepEqual(pointers.rows, [
        { tenant_id: 'tenant-a', agent_id: 'agent-a', latest_snapshot_id: 'a-new', latest_full_web_snapshot_id: 'a-new' },
        { tenant_id: 'tenant-a', agent_id: 'agent-b', latest_snapshot_id: 'a-b', latest_full_web_snapshot_id: null },
        { tenant_id: 'tenant-b', agent_id: 'agent-a', latest_snapshot_id: 'b-a', latest_full_web_snapshot_id: 'b-a' },
      ]);
      assert.equal((await repository.getLatestCapabilitySnapshot('tenant-a', 'agent-a'))?.id, 'a-new');
      assert.equal((await repository.getLatestFullWebInventorySnapshot('tenant-a', 'agent-a'))?.id, 'a-new');
    } finally {
      await db.close();
    }
  });
});
