import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { PgGatewayTargetHistoryRepository, type GatewayTargetHistoryRecord } from './gateway-target-history.service.js';

test('Gateway 目标历史按目标或任务精确查询并保持时间排序', async () => {
  const db = new PgliteDatabase();
  const repository = new PgGatewayTargetHistoryRepository(db);
  try {
    await repository.append(history('history-a-late', 'tenant-a', 'task-a', 'target-a', '2026-08-17T02:00:00.000Z'));
    await repository.append(history('history-a-early', 'tenant-a', 'task-a', 'target-a', '2026-08-17T01:00:00.000Z'));
    await repository.append(history('history-b', 'tenant-b', 'task-b', 'target-a', '2026-08-17T03:00:00.000Z'));

    assert.deepEqual((await repository.listByTarget('target-a', 'tenant-a')).map((item) => item.id), ['history-a-early', 'history-a-late']);
    assert.deepEqual((await repository.listByTask('task-a')).map((item) => item.id), ['history-a-early', 'history-a-late']);
    assert.equal((await repository.listByTarget('target-a', 'tenant-b'))[0]?.id, 'history-b');
  } finally {
    await db.close();
  }
});

function history(
  id: string,
  tenantId: string,
  taskId: string,
  delegatedTargetId: string,
  createdAt: string,
): GatewayTargetHistoryRecord {
  return {
    id,
    tenantId,
    taskId,
    executionRunId: 'run-a',
    stepId: 'step-a',
    gatewayId: 'gateway-a',
    delegatedTargetId,
    adapter: 'agent-v2',
    action: 'verify',
    result: 'success',
    summary: id,
    createdAt,
  };
}
