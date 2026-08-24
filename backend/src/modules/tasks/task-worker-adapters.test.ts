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

test('Agent 安装会话未被消费时延后，不伪造 Bootstrap 成功', async () => {
  const registry = createTaskExecutorRegistry({
    agents: {
      getRepository: () => ({
        getInstallSession: async () => ({
          id: 'install-session-1',
          tenantId: 'tenant-task-adapter',
          platform: 'windows',
          expiresAt: '2026-08-08T23:00:00.000Z',
          createdAt: '2026-08-06T00:00:00.000Z',
        }),
      } as never),
    },
  });
  const result = await registry.get('agent.install')(
    task('AGENT_INSTALL', { sessionId: 'install-session-1' }),
    attempt,
  );
  assert.equal(result.success, false);
  assert.equal(result.defer, true);
  assert.equal(result.errorCode, 'AGENT_INSTALL_PENDING');
});

test('ACME 领域任务处于 retry_waiting 时统一任务继续等待', async () => {
  const registry = createTaskExecutorRegistry({
    acme: {
      runJob: async () => ({
        id: 'renewal-1',
        tenantId: 'tenant-task-adapter',
        status: 'retry_waiting',
        nextAttemptAt: '2026-08-06T00:01:00.000Z',
      }),
    } as never,
  });
  const result = await registry.get('acme.renewal')(
    task('ACME_CERTIFICATE_RENEWAL', { renewalJobId: 'renewal-1' }),
    attempt,
  );
  assert.equal(result.success, false);
  assert.equal(result.defer, true);
  assert.equal(result.nextAttemptAt, '2026-08-06T00:01:00.000Z');
  assert.equal(result.errorCode, 'ACME_RENEWAL_PENDING');
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
