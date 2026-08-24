import { AppError } from '../../common/errors/app-error.js';
import type { AuditService } from '../audits/audit.service.js';
import type { SecuritySubject } from '../../shared/security-types.js';
import { TaskRegistry } from './task.registry.js';
import { TaskRepository } from './task.repository.js';
import type { TaskRealtimePublisher } from './task-realtime-stream.js';
import type {
  MonitoringProbePage,
  MonitoringProbeQuery,
  TaskAttempt,
  TaskDetail,
  TaskEnqueueInput,
  TaskExecutor,
  TaskPage,
  TaskQuery,
  TaskRun,
} from './task.types.js';

export class TasksApplicationService {
  readonly registry: TaskRegistry;

  constructor(
    private readonly repository: TaskRepository,
    private readonly audit?: AuditService,
    registry = new TaskRegistry(),
    private readonly realtime?: TaskRealtimePublisher,
  ) {
    this.registry = registry;
  }

  async initialize(): Promise<void> {
    await this.repository.ensureDefinitions(this.registry.list());
  }

  async enqueue(input: TaskEnqueueInput, actor?: SecuritySubject): Promise<TaskRun> {
    await this.initialize();
    const definition = this.registry.get(input.taskType, input.definitionVersion);
    if (input.parentTaskId) {
      const parent = await this.repository.getById(input.tenantId, input.parentTaskId);
      if (!parent) throw new AppError('RESOURCE_NOT_FOUND', '父任务不存在', { parentTaskId: input.parentTaskId });
    }
    if (input.idempotencyKey) {
      const existing = await this.repository.findActiveByIdempotency(input.tenantId, input.taskType, input.idempotencyKey);
      if (existing) return existing;
    }
    const task = await this.repository.create(input, definition);
    await this.audit?.write({
      eventType: 'task.created',
      actorType: actor?.type === 'system' ? 'system' : 'user',
      actorId: actor?.id ?? input.requestedBy ?? 'system',
      action: 'task.create',
      resourceType: 'task',
      resourceId: task.id,
      result: 'success',
      riskLevel: 'medium',
      context: actor ? { actor } : undefined,
      detail: { taskType: task.taskType, category: task.category, triggerSource: task.triggerSource },
    });
    this.realtime?.publishTask(task);
    return task;
  }

  async list(query: TaskQuery): Promise<TaskPage> {
    return this.repository.list(query);
  }

  async detail(tenantId: string, id: string): Promise<TaskDetail> {
    const detail = await this.repository.detail(tenantId, id);
    if (!detail) throw new AppError('RESOURCE_NOT_FOUND', '任务不存在');
    return detail;
  }

  async listActiveExecutionTasks(tenantId: string, requestedBy?: string, includePendingApprovals = false): Promise<TaskRun[]> {
    return this.repository.listActiveExecutionTasks(tenantId, requestedBy, includePendingApprovals);
  }

  async cancel(tenantId: string, id: string, actorId?: string, reason?: string): Promise<TaskRun> {
    try {
      const task = await this.repository.requestCancel(tenantId, id, actorId, reason);
      await this.audit?.write({
        eventType: 'task.cancelled',
        actorType: 'user',
        actorId: actorId ?? 'system',
        action: 'task.cancel',
        resourceType: 'task',
        resourceId: id,
        result: 'success',
        riskLevel: 'high',
        detail: { taskId: id, reason },
      });
      this.realtime?.publishTask(task);
      return task;
    } catch (error) {
      if (error instanceof Error && error.message === 'NOT_FOUND') throw new AppError('RESOURCE_NOT_FOUND', '任务不存在');
      throw error;
    }
  }

  async retry(tenantId: string, id: string, actorId?: string): Promise<TaskRun> {
    try {
      const task = await this.repository.retry(tenantId, id, actorId);
      await this.audit?.write({
        eventType: 'task.retried',
        actorType: 'user',
        actorId: actorId ?? 'system',
        action: 'task.retry',
        resourceType: 'task',
        resourceId: id,
        result: 'success',
        riskLevel: 'high',
        detail: { taskId: id },
      });
      this.realtime?.publishTask(task);
      return task;
    } catch (error) {
      if (error instanceof Error && error.message === 'NOT_FOUND') throw new AppError('RESOURCE_NOT_FOUND', '任务不存在');
      if (error instanceof Error && error.message === 'NOT_RETRYABLE') throw new AppError('TASK_NOT_RETRYABLE', '任务当前状态不允许重试');
      throw error;
    }
  }

  async runNext(workerId: string, executor: TaskExecutor, tenantId?: string): Promise<TaskRun | undefined> {
    const claimed = await this.repository.claimNext(tenantId, workerId, 60);
    if (!claimed) return undefined;
    const { task, attempt } = claimed;
    this.realtime?.publishTask(task);
    let result;
    try {
      result = await executor(task, attempt);
    } catch (error) {
      result = { success: false, errorCode: 'TASK_EXECUTOR_THROWN', errorMessage: error instanceof Error ? error.message : String(error) };
    }
    const definition = this.registry.get(task.taskType, task.definitionVersion);
    if (result.success) {
      await this.repository.finish(task, attempt, workerId, 'SUCCEEDED', { detail: result.detail });
      const finished = await this.repository.getById(task.tenantId, task.id) as TaskRun;
      this.realtime?.publishTask(finished);
      return finished;
    }
    const shouldRetry = result.defer === true || attempt.attemptNo < definition.retryPolicy.maxAttempts;
    const nextAttemptAt = shouldRetry && result.nextAttemptAt ? result.nextAttemptAt : undefined;
    const retryAfterSeconds = shouldRetry && !nextAttemptAt
      ? result.retryAfterSeconds
        ?? definition.retryPolicy.backoffSeconds * Math.max(1, attempt.attemptNo)
      : undefined;
    await this.repository.finish(task, attempt, workerId, shouldRetry ? 'RETRY_WAITING' : 'FAILED', {
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      detail: result.detail,
    }, nextAttemptAt, retryAfterSeconds);
    const finished = await this.repository.getById(task.tenantId, task.id) as TaskRun;
    this.realtime?.publishTask(finished);
    return finished;
  }

  async listMonitoringProbes(query: MonitoringProbeQuery): Promise<MonitoringProbePage> {
    return this.repository.listMonitoringProbes(query);
  }
}
