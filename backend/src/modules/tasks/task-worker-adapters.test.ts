import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultDefinitions, TaskRegistry } from './task.registry.js';
import { TaskExecutorRegistry, TaskWorkerSupervisor } from './task-worker-supervisor.js';
import { createTaskExecutorRegistry } from './task-worker-adapters.js';
import type { TaskAttempt, TaskRun } from './task.types.js';

function task(taskType: string, payload: Record<string, unknown>): TaskRun {
  return {
    id: `task-${taskType}`,
    tenantId: 'tenant-task-adapter',
    taskType,
    definitionVersion: 1,
    category: 'SYSTEM',
    status: 'RUNNING',
    triggerSource: 'test',
    payload,
    availableAt: '2026-08-06T00:00:00.000Z',
    createdAt: '2026-08-06T00:00:00.000Z',
  };
}

const attempt: TaskAttempt = {
  id: 'attempt-1',
  taskRunId: 'task-1',
  attemptNo: 1,
  workerId: 'worker-1',
  leaseExpiresAt: '2026-08-06T00:10:00.000Z',
  status: 'RUNNING',
  startedAt: '2026-08-06T00:00:00.000Z',
};

test('统一任务适配器覆盖所有默认注册类型，未接入类型也有明确失败执行器', () => {
  const registry = createTaskExecutorRegistry({}, defaultDefinitions.map((definition) => definition.executorKey));
  const keys = new Set(registry.keys());
  for (const definition of defaultDefinitions) assert.equal(keys.has(definition.executorKey), true, definition.executorKey);
});

test('Agent 能力重扫在外部 Agent 未回报时延后，不伪造成功', async () => {
  const registry = createTaskExecutorRegistry({
    agents: {
      getRepository: () => ({
        getTask: async () => ({
          id: 'agent-task-1',
          tenantId: 'tenant-task-adapter',
          agentId: 'agent-1',
          executionRunId: 'agent-rescan:agent-1',
          executionStepId: 'capability-rescan:agent-1',
          idempotencyKey: 'agent-rescan-1',
          payload: { type: 'agent.capability.rescan' },
          status: 'queued',
          createdAt: '2026-08-06T00:00:00.000Z',
          updatedAt: '2026-08-06T00:00:00.000Z',
          requestId: 'request-1',
        }),
      } as never),
    },
  });
  const result = await registry.get('agent.capability-rescan')(
    task('AGENT_CAPABILITY_RESCAN', { agentTaskId: 'agent-task-1' }),
    attempt,
  );
  assert.equal(result.success, false);
  assert.equal(result.defer, true);
  assert.equal(result.errorCode, 'AGENT_CAPABILITY_RESCAN_PENDING');
});

test('宿主 ACME 签发和续签执行器恢复，独立 Challenge 与 Provider 执行器保持退役', () => {
  const registry = createTaskExecutorRegistry({
    acme: {
      runJob: async () => undefined,
    } as never,
  });
  for (const executorKey of ['acme.challenge', 'provider.operation']) {
    assert.equal(registry.has(executorKey), false, executorKey);
    assert.throws(() => registry.get(executorKey), /任务执行器未注册/);
  }
  assert.equal(registry.has('acme.issue'), true);
  assert.equal(registry.has('acme.renewal'), true);
});

test('执行任务遇到异步步骤时延后，不提前完成统一任务', async () => {
  const registry = createTaskExecutorRegistry({
    executions: {
      runDispatchedExecution: async () => ({ success: true, pending: true }),
    },
  });
  const result = await registry.get('certificate.deploy')(
    task('CERTIFICATE_DEPLOY', { runId: 'execution-run-1' }),
    attempt,
  );
  assert.equal(result.success, false);
  assert.equal(result.defer, true);
  assert.equal(result.errorCode, 'EXECUTION_PENDING');
});

test('自动化运行等待审批时使用相对退避，不生成应用侧绝对时间', async () => {
  const registry = createTaskExecutorRegistry({
    automation: {
      runRun: async () => false,
    } as never,
    automationRuns: {
      getRun: async () => ({
        id: 'automation-run-1',
        tenantId: 'tenant-task-adapter',
        automationId: 'automation-1',
        automationNameSnapshot: '审批自动化',
        triggerType: 'manual',
        status: 'waiting_approval',
        approvalId: 'approval-1',
        targetSummary: {
          total: 1,
          pending: 1,
          running: 0,
          waitingApproval: 1,
          succeeded: 0,
          failed: 0,
          skipped: 0,
          cancelled: 0,
        },
      }),
      listRunTargets: async () => [],
      listRunActionResults: async () => [],
    } as never,
  });
  const result = await registry.get('automation.run')(
    task('AUTOMATION_RUN', { runId: 'automation-run-1' }),
    attempt,
  );
  assert.equal(result.success, false);
  assert.equal(result.defer, true);
  assert.equal(result.retryAfterSeconds, 5);
  assert.equal(result.nextAttemptAt, undefined);
  assert.equal(result.errorCode, 'AUTOMATION_RUN_LEASE_UNAVAILABLE');
});

test('Supervisor 只执行当前 Claim 的任务并返回执行器结果', async () => {
  const taskRun = task('WORKFLOW_RUN', { workflowRunId: 'workflow-1' });
  const registry = new TaskExecutorRegistry()
    .register('workflow.run', async () => ({ success: true, detail: { executed: true } }));
  const definition = {
    id: 'definition-workflow',
    taskType: 'WORKFLOW_RUN',
    version: 1,
    category: 'SYSTEM' as const,
    displayKey: 'tasks.types.workflowRun',
    executorKey: 'workflow.run',
    timeoutSeconds: 60,
    retryPolicy: { maxAttempts: 1, backoffSeconds: 0 },
    permissionKey: 'workflow.read',
    sensitivePaths: [],
    enabled: true,
  };
  let executed = 0;
  const supervisor = new TaskWorkerSupervisor(
    {
      registry: new TaskRegistry([definition]),
      runNext: async (_workerId, executor) => {
        executed += 1;
        await executor(taskRun, attempt);
        return taskRun;
      },
    },
    registry,
    { workerId: 'worker-supervisor', maxTasksPerTick: 1 },
  );
  assert.equal(await supervisor.runOnce(), 1);
  assert.equal(executed, 1);
});
