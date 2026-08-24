import assert from 'node:assert/strict';
import test from 'node:test';
import { TaskRegistry } from './task.registry.js';
import { TaskExecutorRegistry, TaskWorkerSupervisor } from './task-worker-supervisor.js';
import type { LogEvent } from '../../common/logging/structured-logger.js';
import type { TaskAttempt, TaskDefinition, TaskRun } from './task.types.js';

const attempt: TaskAttempt = {
  id: 'attempt-1',
  taskRunId: 'task-1',
  attemptNo: 1,
  workerId: 'worker-1',
  leaseExpiresAt: '2026-08-06T00:10:00.000Z',
  status: 'RUNNING',
  startedAt: '2026-08-06T00:00:00.000Z',
};

test('统一任务 Worker 只对执行类任务输出完成日志', async () => {
  const events: LogEvent[] = [];
  const logger = {
    info(event: string, details?: unknown) {
      events.push({
        timestamp: '2026-08-06T00:00:00.000Z',
        level: 'info',
        message: event,
        details,
      });
    },
    warn(event: string, details?: unknown) {
      events.push({
        timestamp: '2026-08-06T00:00:00.000Z',
        level: 'warn',
        message: event,
        details,
      });
    },
  };

  const registry = new TaskRegistry([
    definition('EXECUTION_TASK', 'EXECUTION', 'execution.worker'),
    definition('MONITORING_BATCH', 'MONITORING', 'monitoring.worker'),
  ]);

  const executors = new TaskExecutorRegistry()
    .register('execution.worker', async () => ({ success: true }))
    .register('monitoring.worker', async () => ({ success: true }));

  const executionTask = task('EXECUTION_TASK', 'EXECUTION');
  let executionCalls = 0;
  const executionSupervisor = new TaskWorkerSupervisor(
    {
      registry,
      runNext: async (_workerId, executor) => {
        executionCalls += 1;
        await executor(executionTask, attempt);
        return executionTask;
      },
    },
    executors,
    { workerId: 'worker-execution', maxTasksPerTick: 1, logger },
  );

  assert.equal(await executionSupervisor.runOnce(), 1);
  assert.equal(executionCalls, 1);
  assert.equal(events.some((event) => event.message === '统一任务执行完成'), true);

  events.length = 0;
  let monitoringCalls = 0;
  const monitoringSupervisor = new TaskWorkerSupervisor(
    {
      registry,
      runNext: async (_workerId, executor) => {
        monitoringCalls += 1;
        await executor(task('MONITORING_BATCH', 'MONITORING'), attempt);
        return task('MONITORING_BATCH', 'MONITORING');
      },
    },
    executors,
    { workerId: 'worker-monitoring', maxTasksPerTick: 1, logger },
  );

  assert.equal(await monitoringSupervisor.runOnce(), 1);
  assert.equal(monitoringCalls, 1);
  assert.equal(events.some((event) => event.message === '统一任务执行完成'), false);
  assert.equal(events.some((event) => event.message === '统一任务执行器抛出异常'), false);
});

function definition(taskType: string, category: 'EXECUTION' | 'MONITORING', executorKey: string): TaskDefinition {
  return {
    id: `definition-${taskType.toLowerCase()}`,
    taskType,
    version: 1,
    category,
    displayKey: `tasks.types.${taskType.toLowerCase()}`,
    executorKey,
    timeoutSeconds: 60,
    retryPolicy: { maxAttempts: 1, backoffSeconds: 0 },
    permissionKey: 'task.read',
    sensitivePaths: [],
    enabled: true,
  };
}

function task(taskType: string, category: 'EXECUTION' | 'MONITORING'): TaskRun {
  return {
    id: `task-${taskType.toLowerCase()}`,
    tenantId: 'tenant-task-worker',
    taskType,
    definitionVersion: 1,
    category,
    status: 'RUNNING',
    triggerSource: 'test',
    payload: {},
    availableAt: '2026-08-06T00:00:00.000Z',
    createdAt: '2026-08-06T00:00:00.000Z',
  };
}
