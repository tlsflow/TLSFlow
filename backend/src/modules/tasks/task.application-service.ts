import { AppError } from '../../common/errors/app-error.js';
import { structuredLogger } from '../../common/logging/structured-logger.js';
import type { AuditService } from '../audits/audit.service.js';
import type { SecuritySubject } from '../../shared/security-types.js';
import { TaskRegistry } from './task.registry.js';
import { isUniqueViolation, assertSameRequest } from '../../shared/idempotency.js';
import { TaskRepository, taskRequestHash } from './task.repository.js';
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

export interface TaskExecutionCancellationHandler {
  cancelRun(runId: string, actorId: string, tenantId: string): Promise<unknown>;
}

/** 中文说明：强制结束 Agent 升级任务时，把对应 UpgradePlan 收敛到人工处置，避免留下活动计划。 */
export interface AgentUpgradeCancellationHandler {
  cancelUpgrade(tenantId: string, agentId: string, planId: string, actorId: string, reason?: string): Promise<unknown>;
}

export class TasksApplicationService {
  readonly registry: TaskRegistry;
  private lifecycle: TaskControlPlaneLifecycle = { status: 'MIGRATION_PENDING' };
  private initializationPromise?: Promise<void>;
  private executionCancellationHandler?: TaskExecutionCancellationHandler;
  private agentUpgradeCancellationHandler?: AgentUpgradeCancellationHandler;

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

  /** 中文说明：强制结束统一任务时同步收敛关联执行运行，避免留下 RUNNING 孤儿。 */
  setExecutionCancellationHandler(handler: TaskExecutionCancellationHandler): void {
    this.executionCancellationHandler = handler;
  }

  /** 中文说明：全局任务只是升级过程的观察者，强制结束时必须同步记录人工接管事实。 */
  setAgentUpgradeCancellationHandler(handler: AgentUpgradeCancellationHandler): void {
    this.agentUpgradeCancellationHandler = handler;
  }

  async initialize(): Promise<void> {
    if (this.lifecycle.status === 'READY') return;
    if (this.initializationPromise) return this.initializationPromise;

    this.lifecycle = { status: 'INITIALIZING' };
    const initialization = this.repository.ensureControlPlaneSchema(this.registry.list())
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
    const idempotencyScope = input.idempotencyScope ?? {
      actionType: `task.enqueue.${input.taskType}`,
      resourceType: 'task',
      resourceId: input.taskType,
    };
    const hash = input.idempotencyKey ? taskRequestHash(input, definition.version) : undefined;
    if (input.parentTaskId) {
      const parent = await this.repository.getById(input.tenantId, input.parentTaskId);
      if (!parent) throw new AppError('RESOURCE_NOT_FOUND', '父任务不存在', { parentTaskId: input.parentTaskId });
    }
    if (input.idempotencyKey) {
      const existing = await this.repository.findByIdempotency(input.tenantId, input.taskType, input.idempotencyKey, idempotencyScope);
      if (existing) {
        if (hash) assertSameRequest(existing.record, hash, input.idempotencyKey);
        return existing.task;
      }
    }
    let task: TaskRun;
    try {
      task = await this.repository.create({ ...input, idempotencyScope }, definition);
    } catch (error) {
      if (!input.idempotencyKey || !hash || !isUniqueViolation(error)) throw error;
      const raced = await this.repository.findByIdempotency(input.tenantId, input.taskType, input.idempotencyKey, idempotencyScope);
      if (!raced) throw error;
      assertSameRequest(raced.record, hash, input.idempotencyKey);
      return raced.task;
    }
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

  /** 中文说明：调度补偿只关心仍可执行的同一幂等代次，终态任务不应阻止领域状态诊断。 */
  async findActiveByIdempotency(tenantId: string, taskType: string, idempotencyKey: string): Promise<TaskRun | undefined> {
    await this.initialize();
    return this.repository.findActiveByIdempotency(tenantId, taskType, idempotencyKey);
  }

  /** 中文说明：补偿扫描先确认同一幂等代次是否已有历史 TaskRun。 */
  async findByIdempotencyKey(tenantId: string, taskType: string, idempotencyKey: string): Promise<TaskRun | undefined> {
    await this.initialize();
    return this.repository.findByIdempotencyKey(tenantId, taskType, idempotencyKey);
  }

  async list(query: TaskQuery): Promise<TaskPage> {
    return this.repository.list(query);
  }

  async detail(tenantId: string, id: string): Promise<TaskDetail> {
    const detail = await this.repository.detail(tenantId, id);
    if (!detail) throw new AppError('RESOURCE_NOT_FOUND', '任务不存在');
    return detail;
  }

  /** 中文说明：恢复流程确认远端写入事实后，显式结束冻结的统一任务。 */
  async resolveWaitingExecutionTask(input: {
    tenantId: string;
    taskId: string;
    success: boolean;
    actorId?: string;
    errorCode?: string;
    errorMessage?: string;
    detail?: Record<string, unknown>;
  }): Promise<TaskRun | undefined> {
    const task = await this.repository.resolveWaitingExecutionTask(input);
    if (task) this.realtime?.publishTask(task);
    return task;
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
      const current = await this.repository.getById(tenantId, id);
      const task = await this.repository.forceCancel(tenantId, id, actorId, reason);
      await this.cancelLinkedExecution(current ?? task, actorId ?? 'system');
      await this.cancelLinkedAgentUpgrade(current ?? task, actorId ?? 'system', reason);
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

  async adoptIdempotencyKey(tenantId: string, id: string, idempotencyKey: string, actorId?: string, reason?: string): Promise<TaskRun> {
    try {
      const task = await this.repository.adoptIdempotencyKey(tenantId, id, idempotencyKey, actorId, reason);
      if (shouldWriteTaskAudit(task)) {
        await this.audit?.write({
          eventType: 'task.idempotency_adopted',
          actorType: 'user',
          actorId: actorId ?? 'system',
          action: 'task.idempotency_adopt',
          resourceType: 'task',
          resourceId: id,
          result: 'success',
          riskLevel: 'high',
          detail: { taskId: id, idempotencyKey, reason },
        });
      }
      this.realtime?.publishTask(task);
      return task;
    } catch (error) {
      if (error instanceof Error && error.message === 'NOT_FOUND') throw new AppError('RESOURCE_NOT_FOUND', '任务不存在');
      if (error instanceof Error && error.message === 'TASK_NOT_ACTIVE') throw new AppError('TASK_NOT_RETRYABLE', '任务当前状态不允许接管幂等键');
      if (error instanceof Error && error.message === 'IDEMPOTENCY_CONFLICT') throw new AppError('IDEMPOTENCY_CONFLICT', '规范幂等键已有其他活动任务');
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
    // 兼容已在旧版本中进入 AWAITING_CONFIRMATION 的证书部署任务，先恢复到
    // 只读证书状态轮询队列；没有核验材料的未知写操作不会被提升。
    await this.repository.promoteRecoverableExecutionTasks(tenantId);
    const claimed = await this.repository.claimNext(tenantId, workerId, 60);
    if (!claimed) return undefined;
    const { task, attempt } = claimed;
    this.realtime?.publishTask(task);
    let result;
    try {
      result = await executor(task, attempt);
    } catch (error) {
      // Agent 事实采集已提交但尚未返回 Receipt 时，属于等待外部结果，不是执行失败。
      // 保留错误明细并进入统一轮询，避免前端显示“等待重试”误导用户。
      const details = error instanceof AppError && error.details && typeof error.details === 'object'
        ? error.details as Record<string, unknown>
        : undefined;
      if (details?.asyncPending === true) {
        result = {
          success: false,
          waitingStatus: 'WAITING_RESULT' as const,
          retryAfterSeconds: 10,
          errorCode: error instanceof AppError ? error.errorCode : 'EXECUTION_TARGET_UNAVAILABLE',
          errorMessage: error instanceof Error ? error.message : String(error),
          detail: details,
        };
      } else {
        result = { success: false, errorCode: 'TASK_EXECUTOR_THROWN', errorMessage: error instanceof Error ? error.message : String(error) };
      }
    }
    const definition = this.registry.get(task.taskType, task.definitionVersion);
    try {
      if (result.waitingStatus) {
        const nextAttemptAt = result.waitingStatus === 'WAITING_RESULT' ? result.nextAttemptAt : undefined;
        const retryAfterSeconds = result.waitingStatus === 'WAITING_RESULT' && !nextAttemptAt
          ? result.retryAfterSeconds ?? definition.retryPolicy.backoffSeconds
          : undefined;
        await this.repository.finish(task, attempt, workerId, result.waitingStatus, {
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
          detail: result.detail,
        }, nextAttemptAt, retryAfterSeconds);
        const waiting = await this.repository.getById(task.tenantId, task.id) as TaskRun;
        this.realtime?.publishTask(waiting);
        return waiting;
      }
      if (result.success) {
        await this.repository.finish(task, attempt, workerId, 'SUCCEEDED', { detail: result.detail });
        const finished = await this.repository.getById(task.tenantId, task.id) as TaskRun;
        this.realtime?.publishTask(finished);
        return finished;
      }
      // 中文说明：defer 只是“稍后再处理”的时间策略，不得绕过任务定义的最大尝试次数。
      // 真正需要长期轮询外部结果的执行器必须返回 waitingStatus=WAITING_RESULT；
      // 普通失败（包括自动化租约竞争）一律遵守 maxAttempts，避免任务无限重试。
      const shouldRetry = result.retryable !== false
        && attempt.attemptNo < definition.retryPolicy.maxAttempts;
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

  private async cancelLinkedExecution(task: TaskRun, actorId: string): Promise<void> {
    if (!this.executionCancellationHandler) return;
    if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(task.status)) return;
    if (!['CERTIFICATE_DEPLOY', 'CERTIFICATE_DRY_RUN', 'CERTIFICATE_VERIFY', 'CERTIFICATE_ROLLBACK'].includes(task.taskType)) return;
    const runId = readRunId(task.payload) ?? readRunId(task.resourceSummary);
    if (!runId) return;
    try {
      await this.executionCancellationHandler.cancelRun(runId, actorId, task.tenantId);
    } catch (error) {
      // 统一任务已明确结束，不能因为历史执行运行缺失而把取消接口变成 500；记录证据供运维处理。
      structuredLogger.warn('强制结束任务后收敛执行运行失败', {
        taskId: task.id,
        runId,
        taskType: task.taskType,
        error: error instanceof Error ? error.message : String(error),
      }, { module: 'task-control-plane', resourceType: 'task', resourceId: task.id, tenantId: task.tenantId });
    }
  }

  private async cancelLinkedAgentUpgrade(task: TaskRun, actorId: string, reason?: string): Promise<void> {
    if (!this.agentUpgradeCancellationHandler || task.taskType !== 'AGENT_UPDATE') return;
    const agentId = readAgentId(task.payload) ?? readAgentId(task.resourceSummary);
    const planId = readPlanId(task.payload) ?? readPlanId(task.resourceSummary);
    if (!agentId || !planId) return;
    try {
      await this.agentUpgradeCancellationHandler.cancelUpgrade(task.tenantId, agentId, planId, actorId, reason);
    } catch (error) {
      // 中文说明：任务已经结束，不能因为升级计划投影失败而把强制结束接口变成 500；保留日志供人工处置。
      structuredLogger.warn('强制结束 Agent 升级任务后收敛升级计划失败', {
        taskId: task.id,
        agentId,
        planId,
        error: error instanceof Error ? error.message : String(error),
      }, { module: 'task-control-plane', resourceType: 'task', resourceId: task.id, tenantId: task.tenantId });
    }
  }
}

/**
 * 证书监控由独立的探测记录承载，不能把高频监控任务写入长期审计列表。
 * 其他任务类别仍保留创建、取消和重试审计。
 */
function shouldWriteTaskAudit(task: Pick<TaskRun, 'category'>): boolean {
  return task.category !== 'MONITORING';
}

function readRunId(value: Record<string, unknown> | undefined): string | undefined {
  const runId = value?.runId;
  return typeof runId === 'string' && runId.trim() ? runId.trim() : undefined;
}

function readAgentId(value: Record<string, unknown> | undefined): string | undefined {
  const agentId = value?.agentId;
  return typeof agentId === 'string' && agentId.trim() ? agentId.trim() : undefined;
}

function readPlanId(value: Record<string, unknown> | undefined): string | undefined {
  const planId = value?.planId;
  return typeof planId === 'string' && planId.trim() ? planId.trim() : undefined;
}
