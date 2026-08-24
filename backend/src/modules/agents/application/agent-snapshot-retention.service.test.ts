import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { runMigrations } from '../../../database/migration-runner.js';
import { AgentSnapshotRetentionService } from './agent-snapshot-retention.service.js';
import { PgAgentsRepository } from '../repository/agents.repository.js';

async function insertSnapshot(db: PgliteDatabase, id: string, tenantId: string, agentId: string, reportedAt: string, capabilities: unknown[] = []) {
  await db.query(
    `insert into pg_documents (namespace, document_id, payload, updated_at)
     values ('agents:snapshots', $1, $2::jsonb, now())`,
    [id, JSON.stringify({ id, tenantId, agentId, reportedAt, requestId: `request-${id}`, capabilities })],
  );
}

describe('Agent 快照历史保留', () => {
  it('dry-run 统计候选、当前指针、审计引用和异常记录', async () => {
    const db = new PgliteDatabase();
    try {
      await runMigrations(db, 'src/database/migrations');
      const repository = new PgAgentsRepository(db);
      const retention = new AgentSnapshotRetentionService(db);
      await insertSnapshot(db, 'expired-regular', 'tenant-a', 'agent-a', '2026-07-01T00:00:00.000Z');
      await insertSnapshot(db, 'expired-full', 'tenant-a', 'agent-b', '2026-05-01T00:00:00.000Z', [{ capabilityKey: 'web.inventory', value: { scope: 'FULL_WEB_DISCOVERY' }, confidence: 1 }]);
      await insertSnapshot(db, 'audited', 'tenant-a', 'agent-c', '2026-06-01T00:00:00.000Z');
      await db.query(`insert into pg_documents (namespace, document_id, payload) values ('security.audit_logs', 'audit-snapshot', $1::jsonb)`, [JSON.stringify({ id: 'audit-snapshot', resourceId: 'audited' })]);
      await insertSnapshot(db, 'current', 'tenant-a', 'agent-d', '2026-08-16T00:00:00.000Z');
      await repository.saveCapabilitySnapshot({
        id: 'current-new', tenantId: 'tenant-a', agentId: 'agent-d', reportedAt: '2026-08-16T00:00:00.000Z', requestId: 'request-current-new', capabilities: [],
      });
      await insertSnapshot(db, 'invalid', 'tenant-a', 'agent-e', 'not-a-timestamp');

      const report = await retention.dryRun({ now: '2026-08-17T00:00:00.000Z' });
      assert.equal(report.candidateCount, 2);
      assert.equal(report.protectedCurrentCount, 1);
      assert.equal(report.protectedAuditCount, 1);
      assert.equal(report.invalidCount, 1);
      assert.equal(report.skippedCount, 4);
      assert.equal(report.regularCutoffAt, '2026-07-18T00:00:00.000Z');
      assert.equal(report.fullWebCutoffAt, '2026-05-19T00:00:00.000Z');
    } finally {
      await db.close();
    }
  });

  it('执行批次只删除到期且未被保护的历史事实', async () => {
    const db = new PgliteDatabase();
    try {
      await runMigrations(db, 'src/database/migrations');
      const retention = new AgentSnapshotRetentionService(db);
      await insertSnapshot(db, 'expired-1', 'tenant-a', 'agent-a', '2026-06-01T00:00:00.000Z');
      await insertSnapshot(db, 'expired-2', 'tenant-a', 'agent-a', '2026-06-02T00:00:00.000Z');
      await insertSnapshot(db, 'kept', 'tenant-a', 'agent-a', '2026-08-16T00:00:00.000Z');

      const report = await retention.dryRun({ now: '2026-08-17T00:00:00.000Z' });
      const first = await retention.executeBatch(report.runId, 1);
      assert.equal(first.deletedCount, 1);
      assert.equal(first.status, 'RUNNING');
      const second = await retention.executeBatch(report.runId, 1);
      assert.equal(second.deletedCount, 1);
      assert.equal(second.status, 'COMPLETED');

      const remaining = await db.query<{ document_id: string }>(
        `select document_id from pg_documents where namespace = 'agents:snapshots' order by document_id`,
      );
      assert.deepEqual(remaining.rows.map((row) => row.document_id), ['kept']);
    } finally {
      await db.close();
    }
  });
});
