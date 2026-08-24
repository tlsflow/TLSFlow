import { AppError } from '../../common/errors/app-error.js';
import type { AgentsApplicationService } from '../agents/application/agents.application-service.js';
import type { AutomationEventDeliveryService } from '../automations/application/automation-event-delivery.service.js';
import type { AutomationScheduler } from '../automations/application/automation-scheduler.js';
import type { AutomationsApplicationService } from '../automations/application/automations.application-service.js';
import type { ExecutorRegistry } from '../executions/application/executors.js';
import type { ExecutionsApplicationService } from '../executions/application/executions.application-service.js';
import type { InternalCaApplicationService } from '../internal-ca/application/internal-ca.application-service.js';
import type { AcmeRenewalWorker } from '../internal-ca/application/acme-renewal-worker.js';
import type { CaSyncWorker } from '../internal-ca/application/ca-sync-worker.js';
import type { AcmeRepository } from '../internal-ca/repository/acme.repository.js';
import type { MonitorsApplicationService } from '../monitors/application/monitors.application-service.js';
import type { NotificationWorker } from '../notifications/application/notification-worker.js';
import type { ReportExportService } from '../reports/application/report-export.service.js';
import { buildAutomationTaskProgress } from '../automations/application/automation-task-progress.js';
import type { TaskAttempt, TaskExecutionResult, TaskRun } from './task.types.js';
import { TaskExecutorRegistry } from './task-worker-supervisor.js';

export interface BuiltinPluginCatalogRefresher {
  refresh(tenantId?: string): Promise<{
    refreshedAt: string;
    versions: Array<{ id: string; pluginId: string; version: string; status: string }>;
    projection?: {
      attempted: number;
      projected: number;
      skipped: number;
      failed: Array<{ tenantId: string; agentId: string; error: string }>;
    };
  }>;
}

export interface TaskWorkerAdapterDependencies {
  acme?: Pick<AcmeRenewalWorker, 'runJob'>;
  acmeJobs?: Pick<AcmeRepository, 'getRenewalJob'>;
  executions?: Pick<ExecutionsApplicationService, 'runDispatchedExecution'>;
  executionRegistry?: ExecutorRegistry;
  caSync?: Pick<CaSyncWorker, 'runRun'>;
  internalCa?: Pick<InternalCaApplicationService, 'getRepository'>;
  automation?: Pick<AutomationScheduler, 'runRun'>;
  automationRuns?: Pick<AutomationsApplicationService, 'getRun' | 'listRunTargets' | 'listRunActionResults'>;
  automationEvents?: Pick<AutomationEventDeliveryService, 'processDelivery'>;
  monitors?: Pick<MonitorsApplicationService, 'runMonitorBatch'>;
  notifications?: Pick<NotificationWorker, 'runDelivery' | 'getDelivery'>;
  reports?: Pick<ReportExportService, 'executeTask'>;
  agents?: Pick<AgentsApplicationService, 'getRepository'>;
  pluginCatalog?: BuiltinPluginCatalogRefresher;
}

/**
 * 将领域 Worker 的精确执行方法装配到统一任务控制面。
 *
 * 这里不做全局扫描。每个适配器只读取当前 TaskRun 的 tenantId 和 payload，
 * 这样 Claim 到的任务不会越过租户边界执行其他资源。
 */
export function createTaskExecutorRegistry(
  dependencies: TaskWorkerAdapterDependencies,
  executorKeys: readonly string[] = [],
): TaskExecutorRegistry {
  const registry = new TaskExecutorRegistry();
  const acme = dependencyExecutor('ACME Worker', dependencies.acme, async (task) => {
    const renewalJobId = requiredPayloadString(task, 'renewalJobId');
    const result = await dependencies.acme!.runJob(task.tenantId, renewalJobId, task.requestedBy ?? 'task-worker');
    const current = result ?? await dependencies.acmeJobs?.getRenewalJob(task.tenantId, renewalJobId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'ACME 续签任务不存在', { renewalJobId });
    if (['completed', 'issued_waiting_for_installation'].includes(current.status)) {
      return { success: true, detail: { renewalJobId, status: current.status, claimed: Boolean(result) } };
    }
    if (['failed', 'cancelled'].includes(current.status)) {
      return {
        success: false,
        errorCode: current.failureCode ?? 'ACME_RENEWAL_FAILED',
        errorMessage: current.failureMessage ?? `ACME 续签任务以 ${current.status} 结束`,
        detail: { renewalJobId, status: current.status },
      };
    }
    return {
      success: false,
      defer: true,
      nextAttemptAt: current.nextAttemptAt,
      errorCode: 'ACME_RENEWAL_PENDING',
      errorMessage: `ACME 续签任务仍处于 ${current.status} 状态`,
      detail: { renewalJobId, status: current.status },
    };
  });
  registry.register('acme.issue', acme);
  registry.register('acme.renewal', acme);

  const execution = dependencyExecutor('Execution Worker', dependencies.executions, async (task) => {
    const runId = requiredPayloadString(task, 'runId');
    const result = await dependencies.executions!.runDispatchedExecution(
      runId,
      task.requestedBy ?? 'task-worker',
      task.tenantId,
      dependencies.executionRegistry,
    );
    if (result?.pending === true) {
      const waitingStatus = result.pendingState === 'AWAITING_CONFIRMATION'
        ? 'AWAITING_CONFIRMATION'
        : 'WAITING_RESULT';
      const errorCode = typeof result.errorCode === 'string' && result.errorCode.trim()
        ? result.errorCode
        : waitingStatus === 'AWAITING_CONFIRMATION'
          ? 'EXECUTION_RESULT_UNCONFIRMED'
          : 'EXECUTION_PENDING';
      const errorMessage = typeof result.errorMessage === 'string' && result.errorMessage.trim()
        ? result.errorMessage
        : waitingStatus === 'AWAITING_CONFIRMATION'
          ? '写入结果无法确认，系统已停止自动重放；请在执行详情中核验目标证书状态'
          : '执行运行仍在等待外部执行结果，控制面将继续查询运行状态';
      return {
        success: false,
        waitingStatus,
        ...(waitingStatus === 'WAITING_RESULT' ? { retryAfterSeconds: 10 } : {}),
        errorCode,
        errorMessage,
        detail: { runId, pending: true, waitingStatus, errorCode, errorMessage },
      };
    }
    return {
      success: result?.success === true,
      ...(result?.success === true ? {} : {
        // ExecutionRun 自己拥有步骤级重试和终态；统一任务层不能再次调用已结束的 Run。
        retryable: false,
        errorCode: result?.errorCode ?? 'EXECUTION_FAILED',
        errorMessage: result?.errorMessage ?? '执行运行失败',
      }),
      detail: { runId, ...(isRecord(result) ? result : {}) },
    };
  });
  registry.register('certificate.dry-run', execution);
  registry.register('certificate.deploy', execution);
  registry.register('certificate.verify', execution);
  registry.register('certificate.rollback', execution);

  registry.register('agent.install', async (task, attempt) => executeAgentEnrollmentTask(task, attempt, dependencies, 'install'));

  registry.register('agent.update', async (task, attempt) => executeAgentEnrollmentTask(task, attempt, dependencies, 'update'));

  registry.register('ca.node-task', dependencyExecutor('CA Node 任务', dependencies.internalCa, async (task) => {
    const nodeTaskId = requiredPayloadString(task, 'nodeTaskId');
    return executeCaNodeTask(task, dependencies.internalCa!, nodeTaskId);
  }));

  registry.register('plugin.reference-refresh', dependencyExecutor('插件引用刷新', dependencies.pluginCatalog, async (task) => {
    const result = await dependencies.pluginCatalog!.refresh(task.tenantId);
    return { success: true, detail: result as unknown as Record<string, unknown> };
  }));
  registry.register('deployment.plan.refresh', unavailableExecutor('部署计划能力刷新尚未有可复用的领域执行入口，禁止伪造成功'));

  registry.register('monitoring.batch', dependencyExecutor('监控批次 Worker', dependencies.monitors, async (task) => {
    const result = await dependencies.monitors!.runMonitorBatch({
      tenantId: task.tenantId,
      maxTargets: optionalPayloadNumber(task, 'maxTargets'),
      now: optionalPayloadString(task, 'now'),
      targetIds: optionalPayloadStringArray(task, 'monitorTargetIds'),
      taskId: task.id,
    });
    return { success: true, detail: result };
  }));
  registry.register('monitoring.probe', unavailableExecutor('监控探测必须由 MONITORING_BATCH 统一批次执行'));

  registry.register('ca.sync', dependencyExecutor('CA 同步 Worker', dependencies.caSync, async (task) => {
    const syncRunId = requiredPayloadString(task, 'syncRunId');
    const result = await dependencies.caSync!.runRun(task.tenantId, syncRunId);
    if (result.status === 'queued' || result.status === 'running') {
      return {
        success: false,
        defer: true,
        errorCode: 'CA_SYNC_PENDING',
        errorMessage: 'CA 同步尚未完成，等待下一批次',
        detail: { syncRunId, status: result.status },
      };
    }
    if (result.status === 'succeeded') return { success: true, detail: { syncRunId, status: result.status } };
    return {
      success: false,
      errorCode: result.errorCode ?? 'CA_SYNC_FAILED',
      errorMessage: result.errorMessage ?? `CA 同步以 ${result.status} 结束`,
      detail: { syncRunId, status: result.status },
    };
  }));

  registry.register('automation.trigger-delivery', dependencyExecutor('Automation Trigger Delivery Worker', dependencies.automationEvents, async (task) => {
    const deliveryId = requiredPayloadString(task, 'deliveryId');
    await dependencies.automationEvents!.processDelivery(task.tenantId, deliveryId);
    return { success: true, detail: { deliveryId } };
  }));

  registry.register('automation.run', dependencyExecutor('Automation Worker', dependencies.automation, async (task) => {
    const runId = requiredPayloadString(task, 'runId');
    const executed = await dependencies.automation!.runRun(runId, task.tenantId);
    const current = await dependencies.automationRuns?.getRun(task.tenantId, runId);
    const targets = current ? await dependencies.automationRuns?.listRunTargets(task.tenantId, runId) : [];
    const actionResults = current ? await dependencies.automationRuns?.listRunActionResults(task.tenantId, runId) : [];
    const detail = current ? buildAutomationTaskProgress({ run: current, targets, actionResults }) : { runId };
    if (!executed) {
      return {
        success: false,
        defer: true,
        errorCode: 'AUTOMATION_RUN_LEASE_UNAVAILABLE',
        errorMessage: '自动化运行租约暂不可用',
        detail,
        retryAfterSeconds: 5,
      };
    }
    if (!current || ['queued', 'running', 'waiting_approval'].includes(current.status)) {
      return {
        success: false,
        defer: true,
        errorCode: 'AUTOMATION_RUN_PENDING',
        errorMessage: '自动化运行仍未进入终态',
        detail,
        retryAfterSeconds: 5,
      };
    }
    if (['failed', 'needs_attention', 'stopped'].includes(current.status)) {
      return {
        success: false,
        errorCode: current.failureCode ?? 'AUTOMATION_RUN_FAILED',
        errorMessage: current.failureMessage ?? `自动化运行以 ${current.status} 结束`,
        detail,
      };
    }
    return { success: true, detail };
  }));

  registry.register('report.export', dependencyExecutor('报表导出 Worker', dependencies.reports, async (task) => {
    const query = task.payload.query;
    if (!isRecord(query) || query.tenantId !== task.tenantId) {
      throw new AppError('AUTH_FORBIDDEN', '报表导出任务载荷租户与任务租户不一致', { taskId: task.id });
    }
    await dependencies.reports!.executeTask(task.payload);
    return { success: true, detail: { runId: optionalPayloadString(task, 'runId') } };
  }));
  registry.register('notification.delivery', dependencyExecutor('通知投递 Worker', dependencies.notifications, async (task) => {
    const deliveryId = requiredPayloadString(task, 'deliveryId');
    const processed = await dependencies.notifications!.runDelivery(task.tenantId, deliveryId);
    const delivery = await dependencies.notifications!.getDelivery(task.tenantId, deliveryId);
    if (!delivery) throw new AppError('RESOURCE_NOT_FOUND', '通知投递记录不存在', { deliveryId });
    if (delivery.status === 'delivered') {
      return { success: true, detail: { deliveryId, processed, status: delivery.status } };
    }
    if (delivery.status === 'failed') {
      return {
        success: false,
        errorCode: delivery.failureCategory ?? 'NOTIFICATION_DELIVERY_FAILED',
        errorMessage: delivery.failureMessage ?? '通知投递失败',
        detail: { deliveryId, processed, status: delivery.status },
      };
    }
    return {
      success: false,
      defer: true,
      errorCode: 'NOTIFICATION_DELIVERY_PENDING',
      errorMessage: `通知投递仍处于 ${delivery.status} 状态`,
      detail: { deliveryId, processed, status: delivery.status },
    };
  }));

  const configured = new Set(registry.keys());
  for (const executorKey of executorKeys) {
    if (configured.has(executorKey)) continue;
    registry.register(executorKey, unavailableExecutor(`任务执行器 ${executorKey} 尚未接入`));
  }
  return registry;
}

async function executeAgentEnrollmentTask(
  task: TaskRun,
  attempt: TaskAttempt,
  dependencies: TaskWorkerAdapterDependencies,
  mode: 'install' | 'update',
): Promise<TaskExecutionResult> {
  const enrollmentTokenId = optionalPayloadString(task, 'enrollmentTokenId');
  if (enrollmentTokenId) {
    if (!dependencies.internalCa) return unavailableExecutor('CA Node 注册令牌未接入统一任务控制面')(task, attempt);
    const token = await dependencies.internalCa.getRepository().getNodeEnrollmentToken(task.tenantId, enrollmentTokenId);
    if (!token) throw new AppError('RESOURCE_NOT_FOUND', 'CA Node 注册令牌不存在', { enrollmentTokenId });
    if (token.status === 'used') {
      return {
        success: true,
        detail: {
          enrollmentTokenId,
          providerId: token.providerId,
          orchestration: mode === 'install' ? 'agent-install-session-created' : 'agent-update-session-created',
          bootstrapCompleted: true,
          usedAt: token.usedAt,
        },
      };
    }
    if (token.status !== 'active' || Date.parse(token.expiresAt) <= Date.now()) {
      return {
        success: false,
        errorCode: 'AGENT_ENROLLMENT_TOKEN_EXPIRED',
        errorMessage: 'CA Node Agent 注册令牌已过期或不可用',
        detail: { enrollmentTokenId, providerId: token.providerId, status: token.status },
      };
    }
    return {
      success: false,
      defer: true,
      retryAfterSeconds: 15,
      errorCode: mode === 'install' ? 'AGENT_INSTALL_PENDING' : 'AGENT_UPDATE_PENDING',
      errorMessage: mode === 'install' ? '等待 CA Node Agent 注册并回连' : '等待 CA Node Agent 更新后回连',
      detail: { enrollmentTokenId, providerId: token.providerId, bootstrapCompleted: false },
    };
  }

  return {
    success: false,
    errorCode: mode === 'install' ? 'AGENT_INSTALL_PAYLOAD_INVALID' : 'AGENT_UPDATE_PAYLOAD_INVALID',
    errorMessage: mode === 'install'
      ? 'Agent 安装任务缺少 enrollmentTokenId'
      : 'Agent 更新任务缺少 enrollmentTokenId',
  };
}

function dependencyExecutor<T>(
  name: string,
  dependency: T | undefined,
  executor: (task: TaskRun, attempt: TaskAttempt) => Promise<TaskExecutionResult>,
): (task: TaskRun, attempt: TaskAttempt) => Promise<TaskExecutionResult> {
  return dependency ? executor : unavailableExecutor(`${name} 未接入统一任务控制面`);
}

function unavailableExecutor(message: string): (task: TaskRun, attempt: TaskAttempt) => Promise<TaskExecutionResult> {
  return async () => ({
    success: false,
    errorCode: 'TASK_EXECUTOR_NOT_CONFIGURED',
    errorMessage: message,
  });
}

async function executeCaNodeTask(
  task: TaskRun,
  internalCa: Pick<InternalCaApplicationService, 'getRepository'>,
  nodeTaskId: string,
): Promise<TaskExecutionResult> {
  const nodeTask = await internalCa.getRepository().getNodeTask(task.tenantId, nodeTaskId);
  if (!nodeTask) throw new AppError('RESOURCE_NOT_FOUND', 'CA Node 任务不存在', { nodeTaskId });
  if (nodeTask.status === 'succeeded') {
    return { success: true, detail: { nodeTaskId, status: nodeTask.status, result: nodeTask.result } };
  }
  if (nodeTask.status === 'failed') {
    return {
      success: false,
      errorCode: nodeTask.errorCode ?? 'CA_NODE_TASK_FAILED',
      errorMessage: nodeTask.errorMessage ?? 'CA Node 任务失败',
      detail: { nodeTaskId, status: nodeTask.status },
    };
  }
  return {
    success: false,
    defer: true,
    errorCode: 'CA_NODE_TASK_PENDING',
    errorMessage: '等待 CA Node 返回任务结果',
    detail: { nodeTaskId, status: nodeTask.status },
  };
}

function requiredPayloadString(task: TaskRun, key: string): string {
  const value = optionalPayloadString(task, key);
  if (!value) throw new AppError('VALIDATION_FAILED', `任务载荷缺少 ${key}`, { taskId: task.id, key });
  return value;
}

function optionalPayloadString(task: TaskRun, key: string): string | undefined {
  const value = task.payload[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalPayloadNumber(task: TaskRun, key: string): number | undefined {
  const value = task.payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalPayloadStringArray(task: TaskRun, key: string): string[] | undefined {
  const value = task.payload[key];
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
