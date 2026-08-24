import assert from 'node:assert/strict';
import test from 'node:test';
import { AutomationConfiguredActionExecutor } from './application/automation-configured-action-executor.js';
import { AutomationDeploymentActionService } from './application/automation-deployment-actions.js';
import { AutomationNotificationActionService } from './application/automation-notification-actions.js';

test('手动运行勾选 Dry-run 时，执行器会先执行预检再提交部署计划', async () => {
  const calls: string[] = [];
  const deployment = new AutomationDeploymentActionService({
    get: async () => ({ id: 'plan_1', status: 'DRAFT' } as never),
    create: async () => ({ id: 'plan_1' } as never),
    dryRun: async () => { calls.push('dryRun'); return {} as never; },
    submit: async () => { calls.push('submit'); return { id: 'plan_1', status: 'READY' } as never; },
    execute: async () => { calls.push('execute'); return {} as never; },
  });
  const executor = new AutomationConfiguredActionExecutor(deployment, new AutomationNotificationActionService({ enqueue: async () => ({ requestId: 'n1' }) }));
  const result = await executor.execute({
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
  });

  assert.equal(result.status, 'running');
  assert.deepEqual(calls, ['dryRun', 'submit', 'execute']);
});
