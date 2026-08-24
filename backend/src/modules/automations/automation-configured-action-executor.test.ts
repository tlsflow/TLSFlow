import assert from 'node:assert/strict';
import test from 'node:test';
import { AutomationConfiguredActionExecutor } from './application/automation-configured-action-executor.js';
import { AutomationDeploymentActionService } from './application/automation-deployment-actions.js';
import { AutomationNotificationActionService } from './application/automation-notification-actions.js';

function executionInput() {
  return {
    run: {
      id: 'run_1',
      tenantId: 'tenant_1',
      automationId: 'aut_1',
      automationVersion: 1,
      automationNameSnapshot: 'A',
      triggerType: 'on_demand',
      idempotencyKey: 'k',
      status: 'queued',
      targetSummary: { total: 1, pending: 1, running: 0, waitingApproval: 0, succeeded: 0, failed: 0, skipped: 0, cancelled: 0 },
      actionTypes: ['execute_deployment_plan'],
      environmentSnapshots: [],
      executionOptions: { dryRun: true },
      createdBy: 'u1',
      createdAt: '2026-08-07T00:00:00.000Z',
    } as never,
    target: {
      id: 'target_1',
      tenantId: 'tenant_1',
      runId: 'run_1',
      sequenceNo: 1,
      targetSnapshot: { certificateId: 'cert_1', certificateName: 'example.com', tags: [], bindingId: 'b1', assetId: 'a1' },
      actionTypes: ['execute_deployment_plan'],
      status: 'pending',
      deploymentPlanId: 'plan_1',
      notificationRequestIds: [],
      createdAt: '2026-08-07T00:00:00.000Z',
      updatedAt: '2026-08-07T00:00:00.000Z',
    } as never,
    action: { type: 'execute_deployment_plan', position: 1, config: { source: 'created_by_previous_action' } } as never,
    requireApproval: false,
  };
}

function notificationService(): AutomationNotificationActionService {
  return new AutomationNotificationActionService({ enqueue: async () => ({ requestId: 'n1' }) });
}

test('手动运行勾选 Dry-run 时，启动预检后等待结果且不立即提交计划', async () => {
  const calls: string[] = [];
  const deployment = new AutomationDeploymentActionService({
    get: async () => ({ id: 'plan_1', status: 'DRAFT' } as never),
    createFromApplicationAsset: async () => ({ id: 'plan_1' } as never),
    dryRun: async () => { calls.push('dryRun'); return { run: { id: 'dry_run_1' } } as never; },
    submit: async () => { calls.push('submit'); return { id: 'plan_1', status: 'READY' } as never; },
    execute: async () => { calls.push('execute'); return {} as never; },
  });
  const executor = new AutomationConfiguredActionExecutor(deployment, notificationService());
  const result = await executor.execute(executionInput());

  assert.equal(result.status, 'running');
  assert.equal(result.referenceId, 'dry_run_1');
  assert.deepEqual(calls, ['dryRun']);
});

test('Dry-run 尚未结束时，执行器保持运行中且不重复创建预检', async () => {
  const calls: string[] = [];
  const deployment = new AutomationDeploymentActionService({
    get: async () => ({ id: 'plan_1', status: 'DRAFT', latestRun: { id: 'dry_run_1', type: 'dry_run', status: 'RUNNING' } } as never),
    createFromApplicationAsset: async () => ({ id: 'plan_1' } as never),
    dryRun: async () => { calls.push('dryRun'); return {} as never; },
    submit: async () => { calls.push('submit'); return { id: 'plan_1', status: 'READY' } as never; },
    execute: async () => { calls.push('execute'); return {} as never; },
  });
  const executor = new AutomationConfiguredActionExecutor(deployment, notificationService());
  const result = await executor.execute(executionInput());

  assert.equal(result.status, 'running');
  assert.equal(result.referenceId, 'dry_run_1');
  assert.deepEqual(calls, []);
});

test('Dry-run 成功落库后，执行器才提交并正式执行部署计划', async () => {
  const calls: string[] = [];
  const deployment = new AutomationDeploymentActionService({
    get: async () => ({ id: 'plan_1', status: 'DRAFT', latestRun: { id: 'dry_run_1', type: 'dry_run', status: 'SUCCESS' } } as never),
    createFromApplicationAsset: async () => ({ id: 'plan_1' } as never),
    dryRun: async () => { calls.push('dryRun'); return {} as never; },
    submit: async () => { calls.push('submit'); return { id: 'plan_1', status: 'READY' } as never; },
    execute: async () => { calls.push('execute'); return { run: { id: 'apply_run_1' } } as never; },
  });
  const executor = new AutomationConfiguredActionExecutor(deployment, notificationService());
  const result = await executor.execute(executionInput());

  assert.equal(result.status, 'running');
  assert.equal(result.referenceId, 'apply_run_1');
  assert.deepEqual(calls, ['submit', 'execute']);
});
