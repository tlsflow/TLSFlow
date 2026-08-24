import assert from 'node:assert/strict';
import test from 'node:test';
import { AutomationDeploymentActionService } from './application/automation-deployment-actions.js';

test('Dry Run、提交和执行全部复用 DeploymentPlan 端口', async () => {
  const calls: string[] = [];
  const service = new AutomationDeploymentActionService({
    create: async () => ({ id: 'plan_1' } as never),
    dryRun: async (input) => { calls.push(`dry:${input.planId}`); return { status: 'dry-run' }; },
    submit: async (input) => { calls.push(`submit:${input.planId}`); return { id: input.planId } as never; },
    execute: async (input) => { calls.push(`execute:${input.planId}`); return { status: 'queued' }; },
  });
  await service.dryRun({ planId: 'plan_1', runId: 'run_1', actorId: 'u', tenantId: 't', idempotencyKey: 'x' });
  await service.submit({ planId: 'plan_1', actorId: 'u', tenantId: 't' });
  await service.execute({ planId: 'plan_1', runId: 'run_1', actorId: 'u', tenantId: 't' });
  assert.deepEqual(calls, ['dry:plan_1', 'submit:plan_1', 'execute:plan_1']);
});
