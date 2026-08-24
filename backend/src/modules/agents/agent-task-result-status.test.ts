import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentsApplicationService } from './application/agents.application-service.js';
import type { AgentTaskEnvelope } from './schema/agents.schema.js';

const now = '2026-08-09T00:00:00.000Z';

test('Agent 任务结果拒绝 success 与 UNKNOWN 矛盾的提交', async () => {
  const task = createTask();
  let updateCount = 0;
  const repository = {
    getTask: async () => task,
    updateTask: async () => {
      updateCount += 1;
      return task;
    },
  };
  const service = new AgentsApplicationService(repository as never);

  await assert.rejects(
    service.submitResult('tenant_result_status', {
      agentId: task.agentId,
      taskId: task.id,
      leaseId: task.leaseId!,
      success: true,
      status: 'UNKNOWN',
    }),
    (error: unknown) => (error as { errorCode?: string }).errorCode === 'VALIDATION_FAILED',
  );
  assert.equal(updateCount, 0);
});

test('Agent 任务写操作结果 UNKNOWN 会保留不明状态', async () => {
  const task = createTask();
  let updated: AgentTaskEnvelope | undefined;
  const repository = {
    getTask: async () => updated ?? task,
    updateTask: async (_taskId: string, patch: Partial<AgentTaskEnvelope>) => {
      updated = { ...task, ...patch };
      return updated;
    },
  };
  const service = new AgentsApplicationService(repository as never);

  await service.submitResult('tenant_result_status', {
    agentId: task.agentId,
    taskId: task.id,
    leaseId: task.leaseId!,
    success: false,
    status: 'UNKNOWN',
    errorCode: 'AGENT_CONNECTION_LOST',
  });

  assert.equal(updated?.status, 'failed');
  assert.equal(updated?.result?.status, 'UNKNOWN');
  assert.equal(updated?.result?.success, false);
});

function createTask(): AgentTaskEnvelope {
  return {
    id: 'task_result_status',
    tenantId: 'tenant_result_status',
    agentId: 'agent_result_status',
    executionRunId: 'run_result_status',
    executionStepId: 'step_result_status',
    idempotencyKey: 'idem_result_status',
    payload: { actionType: 'agent.plan.execute' },
    status: 'acked',
    leaseId: 'lease_result_status',
    ackedAt: now,
    createdAt: now,
    updatedAt: now,
    requestId: 'request_result_status',
  };
}
