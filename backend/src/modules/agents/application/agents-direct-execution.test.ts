import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../../common/errors/app-error.js';
import { AgentsApplicationService } from './agents.application-service.js';
import type { AgentRegistration, AgentTaskEnvelope } from '../schema/agents.schema.js';

const now = '2026-08-09T00:00:00.000Z';

test('直连连接异常写入 UNKNOWN，不能转成普通失败并继续执行', async () => {
  const agent = createAgent();
  let task: AgentTaskEnvelope | undefined;
  const repository = {
    getRegistration: async () => agent,
    getTask: async () => task,
    findTaskByIdempotencyKey: async () => undefined,
    createTask: async (created: AgentTaskEnvelope) => {
      task = created;
      return created;
    },
    updateTask: async (_taskId: string, patch: Partial<AgentTaskEnvelope>) => {
      task = { ...task!, ...patch };
      return task;
    },
  };
  const service = new AgentsApplicationService(repository as never);
  Object.assign(service as unknown as { directClient: { executeAction: () => Promise<never> } }, {
    directClient: {
      executeAction: async () => {
        throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Agent 直连连接失败');
      },
    },
  });

  const created = await service.enqueueDirectTask('tenant_direct_unknown', {
    agentId: agent.id,
    executionRunId: 'run_direct_unknown',
    executionStepId: 'step_direct_unknown',
    idempotencyKey: 'idem_direct_unknown',
    payload: { actionType: 'agent.plan.execute' },
  }, 'request_direct_unknown');
  const result = await service.executeTaskDirect('tenant_direct_unknown', created.id, 'request_direct_execute_unknown');

  assert.equal(result.success, false);
  assert.equal(result.asyncPending, true);
  assert.equal(result.detail.executionStatus, 'UNKNOWN');
  assert.equal(task?.result?.status, 'UNKNOWN');
  assert.equal(task?.result?.success, false);
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
      service.enqueueDirectTask('tenant_legacy_action', {
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

function createAgent(): AgentRegistration {
  return {
    id: 'agent_direct_unknown',
    tenantId: 'tenant_direct_unknown',
    agentKey: 'agent-direct-unknown',
    descriptor: {
      agentKey: 'agent-direct-unknown',
      hostname: 'agent-direct-unknown',
      version: '1.0.0',
      osType: 'LINUX',
      labels: [],
    },
    directControl: {
      enabled: true,
      reachable: true,
      listenAddress: '127.0.0.1:1',
      protocolVersion: 'v1',
      supportedActions: ['agent.plan.execute'],
    },
    status: 'ONLINE',
    registeredAt: now,
    updatedAt: now,
    version: 1,
  };
}
