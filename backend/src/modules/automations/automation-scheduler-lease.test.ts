import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { AutomationsRepository } from './repository/automations.repository.js';
import { AutomationScheduler } from './application/automation-scheduler.js';

test('同一租约窗口只有一个调度实例获得租约', async () => {
  const db = new PgliteDatabase();
  await db.exec(await readFile(join(process.cwd(), 'src/database/migrations/20260721000100_automation_tables.sql'), 'utf8'));
  const repository = new AutomationsRepository(db);
  const until = new Date(Date.now() + 60_000);
  assert.equal(await repository.acquireSchedulerLease('lease_1', 'worker_a', until), true);
  assert.equal(await repository.acquireSchedulerLease('lease_1', 'worker_b', until), false);
});

test('多实例 worker 通过运行租约只执行一次 queued run', async () => {
  const db = new PgliteDatabase();
  await db.exec(await readFile(join(process.cwd(), 'src/database/migrations/20260721000100_automation_tables.sql'), 'utf8'));
  const repository = new AutomationsRepository(db);
  const now = new Date(Date.now() + 60_000).toISOString();
  await repository.createAutomation({ id: 'automation_1', tenantId: 'tenant_1', name: 'A', status: 'draft', currentVersion: 1, createdBy: 'user_1', createdAt: now, updatedAt: now, version: 1 });
  await repository.createRun({ id: 'run_1', tenantId: 'tenant_1', automationId: 'automation_1', automationVersion: 1, automationNameSnapshot: 'A', triggerType: 'on_demand', idempotencyKey: 'run-key', status: 'queued', targetSummary: { total: 0, pending: 0, running: 0, waitingApproval: 0, succeeded: 0, failed: 0, skipped: 0, cancelled: 0 }, actionTypes: [], environmentSnapshots: [], createdBy: 'user_1', createdAt: now });
  const executed: string[] = [];
  const service = { createOnDemandRun: async () => { throw new Error('不应创建定时运行'); } };
  const executor = { execute: async (runId: string) => { executed.push(runId); } };
  const clock = { now: () => new Date(now) };
  const workerA = new AutomationScheduler(repository, service as never, executor, 'worker_a', clock);
  const workerB = new AutomationScheduler(repository, service as never, executor, 'worker_b', clock);
  await Promise.all([workerA.runOnce(), workerB.runOnce()]);
  assert.deepEqual(executed, ['run_1']);
});
