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

export type TaskControlPlaneStatus = 'MIGRATION_PENDING' | 'INITIALIZING' | 'READY' | 'FAILED';

export interface TaskControlPlaneLifecycle {
  status: TaskControlPlaneStatus;
  error?: {
    name: string;
    message: string;
  };
}

export class TasksApplicationService {
  readonly registry: TaskRegistry;
  private lifecycle: TaskControlPlaneLifecycle = { status: 'MIGRATION_PENDING' };
  private initializationPromise?: Promise<void>;

  constructor(
    private readonly repository: TaskRepository,
    private readonly audit?: AuditService,
    registry = new TaskRegistry(),
    private readonly realtime?: TaskRealtimePublisher,
  ) {
    this.registry = registry;
  }

  getLifecycle(): TaskControlPlaneLifecycle {
    return this.lifecycle.error
      ? { status: this.lifecycle.status, error: { ...this.lifecycle.error } }
      : { status: this.lifecycle.status };
  }

  async initialize(): Promise<void> {
    if (this.lifecycle.status === 'READY') return;
    if (this.initializationPromise) return this.initializationPromise;

    this.lifecycle = { status: 'INITIALIZING' };
    const initialization = this.repository.ensureDefinitions(this.registry.list())
      .then(() => {
        this.lifecycle = { status: 'READY' };
      })
      .catch((error: unknown) => {
        this.lifecycle = {
          status: 'FAILED',
          error: {
            name: error instanceof Error ? error.name : 'UnknownError',
            message: error instanceof Error ? error.message : String(error),
          },
        };
        throw error;
      });
    this.initializationPromise = initialization;
    try {
      await initialization;
    } finally {
      if (this.initializationPromise === initialization) this.initializationPromise = undefined;
    }
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
    if (shouldWriteTaskAudit(task)) {
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
    }
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

  async listRecentTaskRuns(tenantId: string, requestedBy?: string): Promise<TaskRun[]> {
    return this.repository.listRecentTaskRuns(tenantId, requestedBy);
  }

  async cancel(tenantId: string, id: string, actorId?: string, reason?: string): Promise<TaskRun> {
    try {
      const task = await this.repository.requestCancel(tenantId, id, actorId, reason);
      if (shouldWriteTaskAudit(task)) {
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
      }
      this.realtime?.publishTask(task);
      return task;
    } catch (error) {
      if (error instanceof Error && error.message === 'NOT_FOUND') throw new AppError('RESOURCE_NOT_FOUND', '任务不存在');
      throw error;
    }
  }

  async forceCancel(tenantId: string, id: string, actorId?: string, reason?: string): Promise<TaskRun> {
    try {
      const task = await this.repository.forceCancel(tenantId, id, actorId, reason);
      if (shouldWriteTaskAudit(task)) {
        await this.audit?.write({
          eventType: 'task.cancelled',
          actorType: 'user',
          actorId: actorId ?? 'system',
          action: 'task.force_cancel',
          resourceType: 'task',
          resourceId: id,
          result: 'success',
          riskLevel: 'high',
          detail: { taskId: id, reason, force: true },
        });
      }
      this.realtime?.publishTask(task);
      return task;
    } catch (error) {
      if (error instanceof Error && error.message === 'NOT_FOUND') throw new AppError('RESOURCE_NOT_FOUND', '任务不存在');
      throw error;
    }
  }

  async resolveApprovalTask(
    tenantId: string,
    resourceType: string,
    resourceId: string,
    resourceSummary: Record<string, unknown>,
    decision: 'approved' | 'rejected',
    failure?: { errorCode?: string; errorMessage: string },
  ): Promise<TaskRun | undefined> {
    const task = await this.repository.resolveApprovalTask(tenantId, resourceType, resourceId, resourceSummary, decision, failure);
    if (task) this.realtime?.publishTask(task);
    return task;
  }

  async retry(tenantId: string, id: string, actorId?: string): Promise<TaskRun> {
    try {
      const task = await this.repository.retry(tenantId, id, actorId);
      if (shouldWriteTaskAudit(task)) {
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
      }
      this.realtime?.publishTask(task);
      return task;
    } catch (error) {
      if (error instanceof Error && error.message === 'NOT_FOUND') throw new AppError('RESOURCE_NOT_FOUND', '任务不存在');
      if (error instanceof Error && error.message === 'NOT_RETRYABLE') throw new AppError('TASK_NOT_RETRYABLE', '任务当前状态不允许重试');
      throw error;
    }
  }

  async resolveAutomationRunTask(
    tenantId: string,
    runId: string,
    resourceSummary: Record<string, unknown>,
    decision: 'approved' | 'rejected',
  ): Promise<TaskRun | undefined> {
    const page = await this.repository.list({
      tenantId,
      taskType: 'AUTOMATION_RUN',
      resourceType: 'automationRun',
      resourceId: runId,
      includeAll: true,
      page: 1,
      pageSize: 20,
    });
    const task = page.items.find((item) => item.taskType === 'AUTOMATION_RUN');
    if (!task) return undefined;
    const updated = await this.repository.resolveAutomationRun(tenantId, task.id, resourceSummary, decision);
    if (updated) this.realtime?.publishTask(updated);
    return updated;
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
    try {
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
    } catch (error) {
      // 中文说明：强制结束会主动清除租约，执行器返回后的旧回写必须视为已处理，不能让 Worker 循环报错。
      if (!(error instanceof Error) || error.message !== 'TASK_LEASE_LOST') throw error;
      const cancelled = await this.repository.getById(task.tenantId, task.id) as TaskRun;
      this.realtime?.publishTask(cancelled);
      return cancelled;
    }
  }

  async listMonitoringProbes(query: MonitoringProbeQuery): Promise<MonitoringProbePage> {
    return this.repository.listMonitoringProbes(query);
  }
}

/**
 * 证书监控由独立的探测记录承载，不能把高频监控任务写入长期审计列表。
 * 其他任务类别仍保留创建、取消和重试审计。
 */
function shouldWriteTaskAudit(task: Pick<TaskRun, 'category'>): boolean {
  return task.category !== 'MONITORING';
}
