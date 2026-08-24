import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../../common/errors/app-error.js';
import { AgentsApplicationService } from './agents.application-service.js';

test('Agent 直连执行旁路被拒绝，不确认、不执行、不写入结果', async () => {
  const service = new AgentsApplicationService({} as never);
  await assert.rejects(
    service.executeTaskDirect('tenant_direct_retired', 'task_direct_retired', 'request_direct_retired'),
    (error: unknown) => error instanceof AppError
      && error.errorCode === 'AUTH_FORBIDDEN'
      && (error.details as { reason?: string } | undefined)?.reason === 'AGENT_DIRECT_BYPASS_RETIRED',
  );
});

test('旧 Agent 动作按未注册动作拒绝，不进入任务创建', async () => {
  let createCount = 0;
  const service = new AgentsApplicationService({
    createTask: async () => {
      createCount += 1;
      throw new Error('不应创建旧动作任务');
    },
  } as never);

  for (const payload of [
    { actionType: 'agent.atomic_plan.execute' },
    { actionType: 'command.execute' },
    { type: 'agent.atomic_plan.execute' },
    { type: 'command.execute' },
  ]) {
    await assert.rejects(
      service.enqueueTask('tenant_legacy_action', {
        agentId: 'agent_legacy_action',
        executionRunId: 'run_legacy_action',
        executionStepId: 'step_legacy_action',
        idempotencyKey: `legacy-action:${JSON.stringify(payload)}`,
        payload,
      }, 'request_legacy_action'),
      (error: unknown) => error instanceof AppError
        && error.errorCode === 'VALIDATION_FAILED'
        && error.message.includes('动作未注册')
        && (error.details as { actionType?: string } | undefined)?.actionType
          === (payload.actionType ?? payload.type),
    );
  }

  assert.equal(createCount, 0);
});
