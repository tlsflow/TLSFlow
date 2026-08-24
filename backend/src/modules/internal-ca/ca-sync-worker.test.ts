import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { CaSyncWorker } from './application/ca-sync-worker.js';
import { CaOperationsRepository } from './repository/ca-operations.repository.js';
import type { CaSyncRunEntity } from './schema/internal-ca.schema.js';

const now = new Date('2026-07-25T08:00:00.000Z');

test('Worker 隔离单条失败并继续推进其他运行', async () => {
  const runs = [createRun('run-1'), createRun('run-2')];
  const processed: string[] = [];
  const failures: string[] = [];
  const worker = new CaSyncWorker(
    { listRunnableSyncRuns: async () => runs },
    {
      async processNextCaSyncBatch(_tenantId, runId) {
        processed.push(runId);
        if (runId === 'run-1') throw new Error('模拟单条运行竞争失败');
        return runs[1]!;
      },
    },
    'worker-1',
    ({ run }) => failures.push(run.id),
  );

  assert.equal(await worker.runOnce(2, now), 2);
  assert.deepEqual(processed, ['run-1', 'run-2']);
  assert.deepEqual(failures, ['run-1']);
});

test('仓储只返回到期队列与过期租约，不返回未到期重试和终态', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const repository = new CaOperationsRepository(database);
  await repository.createSyncRun(createRun('queued-ready'));
  await repository.createSyncRun(createRun('queued-later', {
    nextAttemptAt: '2026-07-25T08:01:00.000Z',
  }));
  await repository.createSyncRun(createRun('running-expired', {
    status: 'running',
    leaseOwner: 'dead-worker',
    leaseExpiresAt: '2026-07-25T07:59:00.000Z',
  }));
  await repository.createSyncRun(createRun('running-leased', {
    status: 'running',
    leaseOwner: 'live-worker',
    leaseExpiresAt: '2026-07-25T08:01:00.000Z',
  }));
  await repository.createSyncRun(createRun('succeeded', {
    status: 'succeeded',
    completedAt: '2026-07-25T07:50:00.000Z',
  }));

  const runnable = await repository.listRunnableSyncRuns(now.toISOString(), 10);
  assert.deepEqual(runnable.map((run) => run.id), ['queued-ready', 'running-expired']);
});

test('Worker 将查询上限和固定身份传递给批次处理器', async () => {
  const run = createRun('run-1');
  const queries: Array<[string, number]> = [];
  const calls: Array<[string, string, string, string]> = [];
  const worker = new CaSyncWorker(
    {
      async listRunnableSyncRuns(nowIso, limit) {
        queries.push([nowIso, limit]);
        return [run];
      },
    },
    {
      async processNextCaSyncBatch(tenantId, runId, workerId, runAt) {
        calls.push([tenantId, runId, workerId, runAt?.toISOString() ?? '']);
        return run;
      },
    },
    'worker-fixed',
  );

  assert.equal(await worker.runOnce(3, now), 1);
  assert.deepEqual(queries, [[now.toISOString(), 3]]);
  assert.deepEqual(calls, [['tenant-1', 'run-1', 'worker-fixed', now.toISOString()]]);
});

function createRun(id: string, overrides: Partial<CaSyncRunEntity> = {}): CaSyncRunEntity {
  return {
    id,
    tenantId: 'tenant-1',
    providerId: `provider-${id}`,
    caId: `ca-${id}`,
    objectType: 'request',
    mode: 'incremental',
    status: 'queued',
    readCount: 0,
    upsertedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    attemptCount: 0,
    requestedBy: 'user-1',
    createdAt: '2026-07-25T07:00:00.000Z',
    updatedAt: '2026-07-25T07:00:00.000Z',
    ...overrides,
  };
}
