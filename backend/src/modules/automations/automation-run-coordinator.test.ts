import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { AutomationRunCoordinator, isWithinMaintenanceWindow, type AutomationActionExecutionPort } from './application/automation-run-coordinator.js';
import { applyAutomationMigrations } from './automation-test-migrations.js';
import { AutomationsRepository } from './repository/automations.repository.js';

async function setup(
  execute: (input: { action: { type: string }; target: { sequenceNo: number }; requireApproval?: boolean; approvalId?: string }) => Promise<{ status: 'succeeded' | 'running' | 'waiting_approval'; referenceType?: 'deployment_plan' | 'execution_run' | 'notification_request'; referenceId?: string }>,
  threshold = 2,
  executionOptions?: { stopOnError?: boolean; dryRun?: boolean },
) {
  const db = new PgliteDatabase();
  await applyAutomationMigrations(db);
  const repository = new AutomationsRepository(db); const now = '2026-07-21T00:00:00.000Z';
  await repository.createAutomation({ id: 'a', tenantId: 't', name: 'A', status: 'active', currentVersion: 1, createdBy: 'u', createdAt: now, updatedAt: now, version: 1 });
  await repository.createVersion({ id: 'v', tenantId: 't', automationId: 'a', version: 1, trigger: { type: 'on_demand' }, targetResolver: { type: 'certificate_version_targets' }, actions: [{ type: 'create_deployment_plan', position: 1, config: { workflowTemplateId: 'w' } }, { type: 'execute_deployment_plan', position: 2, config: { source: 'created_by_previous_action', dryRunFirst: true } }, { type: 'send_notification', position: 3, config: { templateKey: 'x', eventKey: 'done' } }], guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 2, requirePreview: true, requireDryRun: true, requireApproval: true, failureCountThreshold: threshold }, checksum: 'c'.repeat(64), createdBy: 'u', createdAt: now });
  await repository.createRun({ id: 'r', tenantId: 't', automationId: 'a', automationVersion: 1, automationNameSnapshot: 'A', triggerType: 'on_demand', idempotencyKey: 'k', status: 'queued', targetSummary: { total: 3, pending: 3, running: 0, waitingApproval: 0, succeeded: 0, failed: 0, skipped: 0, cancelled: 0 }, actionTypes: ['create_deployment_plan', 'execute_deployment_plan', 'send_notification'], environmentSnapshots: ['production'], executionOptions, createdBy: 'u', createdAt: now });
  for (let index = 1; index <= 3; index += 1) await repository.createRunTarget({ id: `t${index}`, tenantId: 't', runId: 'r', sequenceNo: index, targetSnapshot: { certificateId: `c${index}`, certificateName: `cert${index}`, tags: [] }, actionTypes: ['create_deployment_plan', 'execute_deployment_plan', 'send_notification'], status: 'pending', notificationRequestIds: [], createdAt: now, updatedAt: now });
  return { repository, coordinator: new AutomationRunCoordinator(repository, { execute: execute as never }, () => new Date(now)) };
}

test('完整动作链成功并保存稳定动作结果', async () => {
  const { repository, coordinator } = await setup(async ({ action }) => ({ status: 'succeeded', referenceType: action.type === 'create_deployment_plan' ? 'deployment_plan' : action.type === 'execute_deployment_plan' ? 'execution_run' : 'notification_request', referenceId: action.type }));
  const run = await coordinator.execute('r', 't');
  assert.equal(run.status, 'succeeded');
  assert.equal((await repository.listActionResults('r', 't')).length, 9);
});

test('审批阻塞后从当前动作恢复且不重放计划创建', async () => {
  let approved = false;
  const calls: string[] = [];
  const { repository, coordinator } = await setup(async ({ action }) => {
    calls.push(action.type);
    if (action.type === 'execute_deployment_plan' && !approved) return { status: 'waiting_approval' };
    return { status: 'succeeded' };
  });
  assert.equal((await coordinator.execute('r', 't')).status, 'waiting_approval');
  const firstPassCreateCount = calls.filter((type) => type === 'create_deployment_plan').length;
  approved = true;
  assert.equal((await coordinator.execute('r', 't')).status, 'succeeded');
  assert.equal(calls.filter((type) => type === 'create_deployment_plan').length, firstPassCreateCount);
  assert.equal((await repository.listActionResults('r', 't')).filter((result) => result.status === 'running').length, 0);
});

test('历史运行级审批字段不再阻塞运行且不会传入执行授权', async () => {
  const actionInputs: Array<{ requireApproval?: boolean; approvalId?: string }> = [];
  const { repository } = await setup(async (input) => {
    actionInputs.push(input);
    return { status: 'succeeded' };
  });
  const coordinator = new AutomationRunCoordinator(
    repository,
    { execute: (async (input: Parameters<AutomationActionExecutionPort['execute']>[0]) => { actionInputs.push(input); return { status: 'succeeded' }; }) as never },
    () => new Date('2026-07-21T00:00:00.000Z'),
  );
  await repository.updateRun('r', 't', { status: 'waiting_approval', approvalId: 'apr_1' });
  assert.equal((await coordinator.execute('r', 't')).status, 'succeeded');
  assert.equal(actionInputs.length, 9);
  assert.equal(actionInputs.every((input) => input.requireApproval === false), true);
  assert.equal(actionInputs.every((input) => input.approvalId === undefined), true);
});

test('验证失败与回滚失败映射稳定失败阶段，阈值停止剩余目标', async () => {
  const { repository, coordinator } = await setup(async ({ target }) => { const error = new Error(target.sequenceNo === 1 ? 'TLS_VERIFY_FAILED' : 'ROLLBACK_FAILED'); throw Object.assign(error, { errorCode: error.message }); }, 2);
  const run = await coordinator.execute('r', 't');
  assert.equal(run.status, 'needs_attention');
  const targets = await repository.listRunTargets('r', 't');
  assert.deepEqual(targets.map((target) => target.status), ['failed', 'failed', 'cancelled']);
  assert.deepEqual(targets.slice(0, 2).map((target) => target.failureStage), ['verification', 'rollback']);
});

test('勾选错误中断工作流后，首个失败目标会终止后续目标', async () => {
  const { repository, coordinator } = await setup(async ({ target }) => {
    if (target.sequenceNo === 1) {
      const error = new Error('AUTOMATION_TARGET_FAILED');
      throw Object.assign(error, { errorCode: error.message });
    }
    return { status: 'succeeded' };
  }, 99, { stopOnError: true });
  const run = await coordinator.execute('r', 't');
  assert.equal(run.status, 'needs_attention');
  const targets = await repository.listRunTargets('r', 't');
  assert.deepEqual(targets.map((target) => target.status), ['failed', 'cancelled', 'cancelled']);
});

test('停止只取消未派发目标，失败重试创建关联新运行', async () => {
  const { repository, coordinator } = await setup(async () => ({ status: 'succeeded' }));
  await repository.updateRunTarget('t1', 't', { status: 'failed', failureStage: 'execution', updatedAt: '2026-07-21T00:00:00.000Z' });
  const stopped = await coordinator.stop('r', 't');
  assert.equal(stopped.status, 'stopped');
  const retry = await coordinator.retryFailed('r', 't', 'u', 'retry-key');
  assert.equal(retry.parentRunId, 'r');
  assert.equal((await repository.listRunTargets(retry.id, 't')).length, 1);
});

test('维护窗口支持普通时段和跨午夜时段', () => {
  assert.equal(isWithinMaintenanceWindow({ daysOfWeek: [2], startTime: '08:00', endTime: '18:00', timeZone: 'Asia/Shanghai' }, new Date('2026-07-21T02:00:00.000Z')), true);
  assert.equal(isWithinMaintenanceWindow({ daysOfWeek: [2], startTime: '23:00', endTime: '02:00', timeZone: 'Asia/Shanghai' }, new Date('2026-07-21T16:00:00.000Z')), true);
});
