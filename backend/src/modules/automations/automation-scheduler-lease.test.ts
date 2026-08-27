import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { applyAutomationMigrations } from './automation-test-migrations.js';
import { AutomationsRepository } from './repository/automations.repository.js';
import { AutomationScheduler } from './application/automation-scheduler.js';

test('同一租约窗口只有一个调度实例获得租约', async () => {
  const db = new PgliteDatabase();
  await applyAutomationMigrations(db);
  const repository = new AutomationsRepository(db);
  const until = new Date(Date.now() + 60_000);
  assert.equal(await repository.acquireSchedulerLease('lease_1', 'worker_a', until), true);
  assert.equal(await repository.acquireSchedulerLease('lease_1', 'worker_b', until), false);
});

test('多实例 worker 通过运行租约只执行一次 queued run', async () => {
  const db = new PgliteDatabase();
  await applyAutomationMigrations(db);
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

test('自动化等待审批时释放运行租约，批准后可立即重新获取', async () => {
  const db = new PgliteDatabase();
  await applyAutomationMigrations(db);
  const repository = new AutomationsRepository(db);
  const now = new Date(Date.now() + 60_000).toISOString();
  await repository.createAutomation({ id: 'automation_approval', tenantId: 'tenant_approval', name: 'A', status: 'draft', currentVersion: 1, createdBy: 'user_1', createdAt: now, updatedAt: now, version: 1 });
  await repository.createRun({ id: 'run_approval', tenantId: 'tenant_approval', automationId: 'automation_approval', automationVersion: 1, automationNameSnapshot: 'A', triggerType: 'on_demand', idempotencyKey: 'approval-key', status: 'queued', targetSummary: { total: 0, pending: 0, running: 0, waitingApproval: 0, succeeded: 0, failed: 0, skipped: 0, cancelled: 0 }, actionTypes: [], environmentSnapshots: [], createdBy: 'user_1', createdAt: now });
  const service = { createOnDemandRun: async () => { throw new Error('不应创建定时运行'); } };
  const executor = { execute: async () => ({ status: 'waiting_approval' as const }) };
  const clock = { now: () => new Date(now) };
  const scheduler = new AutomationScheduler(repository, service as never, executor, 'worker_approval', clock);

  assert.equal(await scheduler.runRun('run_approval', 'tenant_approval'), true);
  assert.equal(await repository.acquireSchedulerLease('automation-run:tenant_approval:run_approval', 'worker_after_approval', new Date(Date.now() + 60_000)), true);
});

test('自动化协调完成后释放运行租约，后续轮询不会被旧租约阻塞', async () => {
  const db = new PgliteDatabase();
  await applyAutomationMigrations(db);
  const repository = new AutomationsRepository(db);
  const now = new Date(Date.now() + 60_000).toISOString();
  await repository.createAutomation({ id: 'automation_running', tenantId: 'tenant_running', name: 'A', status: 'draft', currentVersion: 1, createdBy: 'user_1', createdAt: now, updatedAt: now, version: 1 });
  await repository.createRun({ id: 'run_running', tenantId: 'tenant_running', automationId: 'automation_running', automationVersion: 1, automationNameSnapshot: 'A', triggerType: 'on_demand', idempotencyKey: 'running-key', status: 'queued', targetSummary: { total: 0, pending: 0, running: 0, waitingApproval: 0, succeeded: 0, failed: 0, skipped: 0, cancelled: 0 }, actionTypes: [], environmentSnapshots: [], createdBy: 'user_1', createdAt: now });
  const scheduler = new AutomationScheduler(
    repository,
    { createOnDemandRun: async () => { throw new Error('不应创建定时运行'); } } as never,
    { execute: async () => ({ status: 'running' as const }) },
    'worker_running',
    { now: () => new Date(now) },
  );

  assert.equal(await scheduler.runRun('run_running', 'tenant_running'), true);
  assert.equal(await repository.acquireSchedulerLease('automation-run:tenant_running:run_running', 'worker_after_running', new Date(Date.now() + 60_000)), true);
});
