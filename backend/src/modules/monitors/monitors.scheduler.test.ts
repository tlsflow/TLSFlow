import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgAssetsRepository } from '../assets/repository/assets.repository.js';
import { MonitorsApplicationService } from './application/monitors.application-service.js';
import type { MonitorsRepository } from './repository/monitors.repository.js';
import { PgMonitorsRepository, type ClaimedMonitorSchedulerBatch } from './repository/monitors.repository.js';

test('到期目标原子领取只建立一个租户时间窗，并推进 next_run_at', async () => {
  const db = new PgliteDatabase();
  try {
    await runMigrations(db, 'src/database/migrations');
    const assets = new PgAssetsRepository(db);
    const repository = new PgMonitorsRepository(db);
    const tenantId = 'tenant-monitor-claim';
    const firstAsset = await assets.createServiceAsset(tenantId, {
      address: '127.0.0.11',
      port: 443,
      protocol: 'HTTPS',
      discoverySource: 'MANUAL',
      status: 'ACTIVE',
    });
    const secondAsset = await assets.createServiceAsset(tenantId, {
      address: '127.0.0.12',
      port: 443,
      protocol: 'HTTPS',
      discoverySource: 'MANUAL',
      status: 'ACTIVE',
    });
    const firstTarget = await repository.createMonitorTarget({ tenantId, serviceAssetId: firstAsset.id, intervalSeconds: 60 });
    const secondTarget = await repository.createMonitorTarget({ tenantId, serviceAssetId: secondAsset.id, intervalSeconds: 60 });
    const now = '2026-08-17T12:00:45.000Z';
    await db.query(`update pg_monitor_targets set next_run_at = $1::timestamptz where tenant_id = $2`, [now, tenantId]);

    const [left, right] = await Promise.all([
      repository.claimDueMonitorTargets(now, 10),
      repository.claimDueMonitorTargets(now, 10),
    ]);
    const claimed = [...left, ...right];
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0]?.tenantId, tenantId);
    assert.deepEqual(new Set(claimed[0]?.targetIds), new Set([firstTarget.id, secondTarget.id]));

    const window = await db.query<{ candidate_count: number; status: string; target_ids: unknown }>(
      `select candidate_count, status, target_ids
         from pg_monitor_scheduler_windows
        where tenant_id = $1
          and window_start = '2026-08-17T12:00:00.000Z'::timestamptz`,
      [tenantId],
    );
    assert.equal(window.rows.length, 1);
    assert.equal(window.rows[0]?.candidate_count, 2);
    assert.equal(window.rows[0]?.status, 'CLAIMED');

    const nextRuns = await db.query<{ next_run_at: string | Date }>(
      `select next_run_at
         from pg_monitor_targets
        where tenant_id = $1
        order by id`,
      [tenantId],
    );
    assert.deepEqual(
      nextRuns.rows.map((row) => new Date(row.next_run_at).toISOString()),
      ['2026-08-17T12:01:45.000Z', '2026-08-17T12:01:45.000Z'],
    );
    assert.deepEqual(await repository.claimDueMonitorTargets(now, 10), []);

    await repository.markMonitorSchedulerWindowFailed({
      tenantId,
      windowStart: '2026-08-17T12:00:00.000Z',
      error: '任务控制面暂不可用',
    });
    const recovered = await repository.claimRecoverableMonitorSchedulerWindows('2026-08-17T12:00:50.000Z', 10);
    assert.equal(recovered.length, 1);
    assert.deepEqual(new Set(recovered[0]?.targetIds), new Set([firstTarget.id, secondTarget.id]));
  } finally {
    await db.close();
  }
});

test('任务创建失败后复用同一时间窗和领取结果重试', async () => {
  const batch: ClaimedMonitorSchedulerBatch = {
    tenantId: 'tenant-monitor-retry',
    windowStart: '2026-08-17T12:00:00.000Z',
    candidateCount: 1,
    targetIds: ['target-monitor-retry'],
  };
  let fresh = [batch];
  let recovery: ClaimedMonitorSchedulerBatch[] = [];
  const failedWindows: string[] = [];
  const enqueuedWindows: Array<{ windowStart: string; taskId?: string }> = [];
  const repository = {
    listRiskEvents: async () => [],
    claimRecoverableMonitorSchedulerWindows: async () => {
      const items = recovery;
      recovery = [];
      return items;
    },
    claimDueMonitorTargets: async () => {
      const items = fresh;
      fresh = [];
      return items;
    },
    markMonitorSchedulerWindowFailed: async (input: { windowStart: string }) => {
      failedWindows.push(input.windowStart);
      recovery = [batch];
    },
    markMonitorSchedulerWindowEnqueued: async (input: { windowStart: string; taskId?: string }) => {
      enqueuedWindows.push(input);
    },
  } as unknown as MonitorsRepository;
  let enqueueAttempts = 0;
  const service = new MonitorsApplicationService({
    repository,
    certificates: {} as never,
    bindings: {} as never,
    executions: {} as never,
    tasks: {
      enqueue: async () => {
        enqueueAttempts += 1;
        if (enqueueAttempts === 1) throw new Error('任务控制面暂不可用');
        return { id: 'task-monitor-retry' } as never;
      },
    },
  });

  const originalWorkerFlag = process.env.GCAC_UNIFIED_TASK_WORKER_ENABLED;
  process.env.GCAC_UNIFIED_TASK_WORKER_ENABLED = 'true';
  try {
    await service.scheduleMonitorBatches({ maxTargets: 5, now: '2026-08-17T12:00:10.000Z' });
    assert.deepEqual(failedWindows, [batch.windowStart]);
    assert.equal(enqueuedWindows.length, 0);

    await service.scheduleMonitorBatches({ maxTargets: 5, now: '2026-08-17T12:00:15.000Z' });
    assert.equal(enqueueAttempts, 2);
    assert.deepEqual(enqueuedWindows, [{
      tenantId: batch.tenantId,
      windowStart: batch.windowStart,
      taskId: 'task-monitor-retry',
    }]);
  } finally {
    if (originalWorkerFlag === undefined) delete process.env.GCAC_UNIFIED_TASK_WORKER_ENABLED;
    else process.env.GCAC_UNIFIED_TASK_WORKER_ENABLED = originalWorkerFlag;
  }
});
