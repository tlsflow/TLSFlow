import { AppError } from '../../common/errors/app-error.js';
import type { AgentsApplicationService } from '../agents/application/agents.application-service.js';
import type { AutomationEventDeliveryService } from '../automations/application/automation-event-delivery.service.js';
import type { AutomationScheduler } from '../automations/application/automation-scheduler.js';
import type { AutomationsApplicationService } from '../automations/application/automations.application-service.js';
import type { ExecutorRegistry } from '../executions/application/executors.js';
import type { ExecutionsApplicationService } from '../executions/application/executions.application-service.js';
import type { AcmeRenewalWorker } from '../internal-ca/application/acme-renewal-worker.js';
import type { AcmeRepository } from '../internal-ca/repository/acme.repository.js';
import type { MonitorsApplicationService } from '../monitors/application/monitors.application-service.js';
import type { NotificationWorker } from '../notifications/application/notification-worker.js';
import type { ReportExportService } from '../reports/application/report-export.service.js';
import { buildAutomationTaskProgress } from '../automations/application/automation-task-progress.js';
import type { TaskAttempt, TaskExecutionResult, TaskRun } from './task.types.js';
import { TaskExecutorRegistry } from './task-worker-supervisor.js';
import type { PluginRefreshResult } from '../plugins/dto/plugin-refresh-result.dto.js';
import type { CredentialHealthService } from '../credentials/health/credential-health.service.js';
import type { InternalCaApplicationService } from '../internal-ca/application/internal-ca.application-service.js';
import type { ApplicationCertificateSupplyApplicationService } from '../application-certificate-supply/application/application-certificate-supply.application-service.js';
import type { TasksApplicationService } from './task.application-service.js';

export interface BuiltinPluginCatalogRefresher {
  refresh(tenantId?: string): Promise<PluginRefreshResult>;
}

export interface TaskWorkerAdapterDependencies {
  acme?: Pick<AcmeRenewalWorker, 'runJob'>;
  acmeJobs?: Pick<AcmeRepository, 'getRenewalJob'>;
  executions?: Pick<ExecutionsApplicationService, 'runDispatchedExecution'>;
  executionRegistry?: ExecutorRegistry;
  automation?: Pick<AutomationScheduler, 'runRun'>;
  automationRuns?: Pick<AutomationsApplicationService, 'getRun' | 'listRunTargets' | 'listRunActionResults'>;
  automationEvents?: Pick<AutomationEventDeliveryService, 'processDelivery'>;
  monitors?: Pick<MonitorsApplicationService, 'runMonitorBatch'>;
  notifications?: Pick<NotificationWorker, 'runDelivery' | 'getDelivery'>;
  reports?: Pick<ReportExportService, 'executeTask'>;
  agents?: Pick<AgentsApplicationService, 'getRepository' | 'getUpgradeStatus'>;
  pluginCatalog?: BuiltinPluginCatalogRefresher;
  credentialHealth?: Pick<CredentialHealthService, 'executeTask'>;
  internalCa?: Pick<InternalCaApplicationService, 'issueRequest' | 'refreshRequestIssuance' | 'listRequests'>;
  applicationCertificateSupply?: Pick<ApplicationCertificateSupplyApplicationService, 'createDedicatedDeploymentPlan' | 'updateLifecycleStatus'>;
  taskControl?: Pick<TasksApplicationService, 'detail' | 'list'>;
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
    const expectedGeneration = optionalPayloadNumber(task, 'taskGeneration') ?? 0;
    const before = await dependencies.acmeJobs?.getRenewalJob(task.tenantId, renewalJobId);
    // 人工重试会切换 Job 代次；旧 TaskRun 即使晚到，也只能收敛为成功而不能再次执行 ACME。
    if (before && (before.taskGeneration ?? 0) !== expectedGeneration) {
      return {
        success: true,
        detail: {
          renewalJobId,
          staleTaskGeneration: true,
          expectedGeneration,
          currentGeneration: before.taskGeneration ?? 0,
        },
      };
    }
    const result = await dependencies.acme!.runJob(task.tenantId, renewalJobId, task.requestedBy ?? 'task-worker');
    const current = result ?? await dependencies.acmeJobs?.getRenewalJob(task.tenantId, renewalJobId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'ACME 续签任务不存在', { renewalJobId });
    if (['completed', 'issued_waiting_for_installation'].includes(current.status)) {
      return { success: true, detail: { renewalJobId, status: current.status, claimed: Boolean(result), certificateVersionId: current.certificateVersionId } };
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

  const certificateIssue = dependencyExecutor('证书签发 Worker', dependencies.internalCa, async (task) => {
    const requestId = requiredPayloadString(task, 'certificateRequestId');
    const requests = await dependencies.internalCa!.listRequests(task.tenantId);
    const before = requests.find((item) => item.id === requestId);
    if (!before) throw new AppError('RESOURCE_NOT_FOUND', '证书申请不存在', { requestId });
    if (['issued', 'deploying', 'active'].includes(before.status)) {
      return { success: true, detail: { certificateRequestId: requestId, status: before.status, certificateVersionId: before.certificateVersionId } };
    }
    const actorId = task.requestedBy ?? 'task-worker';
    const current = before.status === 'issuing' && before.providerRequestId
      ? await dependencies.internalCa!.refreshRequestIssuance(task.tenantId, requestId, actorId)
      : before.status === 'pending_key' || before.status === 'pending_csr'
        ? before
        : await dependencies.internalCa!.issueRequest(task.tenantId, requestId, actorId);
    if (['issued', 'deploying', 'active'].includes(current.status)) {
      return { success: true, detail: { certificateRequestId: requestId, status: current.status, certificateVersionId: current.certificateVersionId, deploymentPlanId: current.deploymentPlanId } };
    }
    if (['issue_failed', 'rejected', 'cancelled'].includes(current.status)) {
      return { success: false, retryable: false, errorCode: current.failureCode ?? 'CERTIFICATE_ISSUE_FAILED', errorMessage: current.failureMessage ?? `证书申请以 ${current.status} 结束`, detail: { certificateRequestId: requestId, status: current.status } };
    }
    return {
      success: false,
      waitingStatus: 'WAITING_RESULT',
      retryAfterSeconds: 10,
      errorCode: current.status === 'issuing' ? 'CERTIFICATE_ISSUE_PENDING' : 'CERTIFICATE_KEY_OR_CSR_PENDING',
      errorMessage: current.status === 'issuing' ? '证书签发仍在等待 CA 结果' : '证书申请仍在等待本机密钥或 CSR',
      detail: { certificateRequestId: requestId, status: current.status, certificateVersionId: current.certificateVersionId },
    };
  });
  registry.register('certificate.issue', certificateIssue);

  // 专属证书这里只协调签发结果和标准部署计划；实际安装始终由
  // createApplyRun 生成的 CERTIFICATE_DEPLOY 任务执行，不能在此复制安装逻辑。
  const applicationCertificateSupply = dependencyExecutor('应用专属证书编排 Worker', dependencies.applicationCertificateSupply, async (task) => {
    if (!dependencies.taskControl) throw new AppError('SYSTEM_INTERNAL_ERROR', '统一任务查询服务未接入');
    const applicationAssetId = requiredPayloadString(task, 'applicationAssetId');
    const certificateRequestId = optionalPayloadString(task, 'certificateRequestId');
    if (!certificateRequestId) return { success: false, waitingStatus: 'WAITING_RESULT', retryAfterSeconds: 10, errorCode: 'CERTIFICATE_ISSUE_PENDING', errorMessage: '专属证书申请记录尚未关联，等待签发任务创建', detail: { applicationAssetId } };
    const deploymentTaskId = optionalRecordString(task.progress, 'deploymentTaskId');
    if (deploymentTaskId) {
      const deployment = await dependencies.taskControl.detail(task.tenantId, deploymentTaskId);
      const current = deployment.task;
      if (current.status === 'SUCCEEDED') {
        await dependencies.applicationCertificateSupply!.updateLifecycleStatus(task.tenantId, applicationAssetId, 'deployed', optionalRecordString(task.progress, 'certificateVersionId'));
        return { success: true, detail: { applicationAssetId, certificateRequestId, certificateVersionId: optionalRecordString(task.progress, 'certificateVersionId'), deploymentTaskId } };
      }
      if (current.status === 'FAILED' || current.status === 'CANCELLED') {
        await dependencies.applicationCertificateSupply!.updateLifecycleStatus(task.tenantId, applicationAssetId, 'needs_attention', optionalRecordString(task.progress, 'certificateVersionId'));
        return { success: false, retryable: false, errorCode: current.lastErrorCode ?? 'CERTIFICATE_DEPLOY_FAILED', errorMessage: current.lastErrorMessage ?? '标准证书部署失败', detail: { applicationAssetId, certificateRequestId, certificateVersionId: optionalRecordString(task.progress, 'certificateVersionId'), deploymentTaskId } };
      }
      return { success: false, waitingStatus: 'WAITING_RESULT', retryAfterSeconds: 10, errorCode: 'CERTIFICATE_DEPLOY_PENDING', errorMessage: '标准证书部署仍在执行', detail: { applicationAssetId, certificateRequestId, certificateVersionId: optionalRecordString(task.progress, 'certificateVersionId'), deploymentTaskId } };
    }
    const issuePage = await dependencies.taskControl.list({ tenantId: task.tenantId, taskType: 'CERTIFICATE_ISSUE', resourceType: 'certificateRequest', resourceId: certificateRequestId, includeAll: true, page: 1, pageSize: 20 });
    const issueTask = issuePage.items.find((item) => item.taskType === 'CERTIFICATE_ISSUE');
    if (!issueTask || issueTask.status === 'QUEUED' || issueTask.status === 'RUNNING' || issueTask.status === 'RETRY_WAITING' || issueTask.status === 'WAITING_RESULT') {
      return { success: false, waitingStatus: 'WAITING_RESULT', retryAfterSeconds: 10, errorCode: 'CERTIFICATE_ISSUE_PENDING', errorMessage: '专属证书正在签发，等待签发任务完成', detail: { applicationAssetId, certificateRequestId, issueTaskId: issueTask?.id } };
    }
    if (issueTask.status === 'FAILED' || issueTask.status === 'CANCELLED') {
      return { success: false, retryable: false, errorCode: issueTask.lastErrorCode ?? 'CERTIFICATE_ISSUE_FAILED', errorMessage: issueTask.lastErrorMessage ?? '专属证书签发失败', detail: { applicationAssetId, certificateRequestId, issueTaskId: issueTask.id } };
    }
    const certificateVersionId = readCertificateVersionFromTask(issueTask);
    if (!certificateVersionId) return { success: false, waitingStatus: 'WAITING_RESULT', retryAfterSeconds: 10, errorCode: 'CERTIFICATE_VERSION_PENDING', errorMessage: '签发任务已完成但证书版本尚未回写', detail: { applicationAssetId, certificateRequestId, issueTaskId: issueTask.id } };
    const created = await dependencies.applicationCertificateSupply!.createDedicatedDeploymentPlan({
      tenantId: task.tenantId,
      applicationAssetId,
      certificateVersionId,
      certificateRequestId,
      actorId: task.requestedBy ?? 'task-worker',
      parentTaskId: task.id,
    });
    return { success: false, waitingStatus: 'WAITING_RESULT', retryAfterSeconds: 5, errorCode: 'CERTIFICATE_DEPLOY_PENDING', errorMessage: '标准证书部署任务已创建，等待执行完成', detail: { applicationAssetId, certificateRequestId, certificateVersionId, deploymentPlanId: created.planId, deploymentTaskId: created.jobId } };
  });
  registry.register('application.certificate-supply', applicationCertificateSupply);
  // 仅兼容历史任务记录；新流程不会创建 APPLICATION_CERTIFICATE_DEPLOY。
  // 新的安装任务统一由 DeploymentPlansApplicationService 生成 CERTIFICATE_DEPLOY。
  registry.register('application.certificate-deploy', applicationCertificateSupply);

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

  registry.register('agent.update', async (task, attempt) => {
    if (optionalPayloadString(task, 'planId')) return executeAgentUpgradeTask(task, dependencies);
    return executeAgentEnrollmentTask(task, attempt, dependencies, 'update');
  });

  // CA Node 运行时已移除。保留稳定 executor key 作为历史任务兼容桩，
  // 明确失败关闭而不是让旧任务因执行器缺失反复重试或伪造成功。
  registry.register('ca.node-task', unavailableExecutor('外置 CA Node 任务已退役，无法执行'));

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

  registry.register('credential.health-check', dependencyExecutor('凭据有效性检测 Worker', dependencies.credentialHealth, async (task) => {
    return dependencies.credentialHealth!.executeTask(task);
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
    if (current && ['succeeded', 'partially_succeeded'].includes(current.status)) {
      return { success: true, detail };
    }
    if (current && ['failed', 'needs_attention', 'stopped', 'cancelled'].includes(current.status)) {
      return {
        success: false,
        retryable: false,
        errorCode: current.failureCode ?? 'AUTOMATION_RUN_FAILED',
        errorMessage: current.failureMessage ?? `自动化运行以 ${current.status} 结束`,
        detail,
      };
    }
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
        waitingStatus: 'WAITING_RESULT',
        errorCode: 'AUTOMATION_RUN_PENDING',
        errorMessage: '自动化运行仍未进入终态',
        detail,
        retryAfterSeconds: 5,
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
    const expectedGeneration = optionalPayloadNumber(task, 'dispatchGeneration');
    const currentBeforeRun = await dependencies.notifications!.getDelivery(task.tenantId, deliveryId);
    if (!currentBeforeRun) throw new AppError('RESOURCE_NOT_FOUND', '通知投递记录不存在', { deliveryId });
    if (expectedGeneration !== undefined && currentBeforeRun.dispatchGeneration !== expectedGeneration) {
      return { success: true, detail: { deliveryId, status: currentBeforeRun.status, staleGeneration: expectedGeneration, currentGeneration: currentBeforeRun.dispatchGeneration } };
    }
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
    if (!dependencies.agents) return unavailableExecutor('Agent 注册令牌未接入统一任务控制面')(task, attempt);
    const token = await dependencies.agents.getRepository().getEnrollmentToken(enrollmentTokenId);
    if (!token || token.tenantId !== task.tenantId) throw new AppError('RESOURCE_NOT_FOUND', 'Agent 注册令牌不存在', { enrollmentTokenId });
    if (token.usedCount > 0) {
      return {
        success: true,
        detail: {
          enrollmentTokenId,
          orchestration: mode === 'install' ? 'agent-install-session-created' : 'agent-update-session-created',
          bootstrapCompleted: true,
          usedAt: token.lastUsedAt,
        },
      };
    }
    if (token.status !== 'active' || Date.parse(token.expiresAt) <= Date.now()) {
      return {
        success: false,
        errorCode: 'AGENT_ENROLLMENT_TOKEN_EXPIRED',
        errorMessage: 'Agent 注册令牌已过期或不可用',
        detail: { enrollmentTokenId, status: token.status },
      };
    }
    return {
      success: false,
      defer: true,
      retryAfterSeconds: 15,
      errorCode: mode === 'install' ? 'AGENT_INSTALL_PENDING' : 'AGENT_UPDATE_PENDING',
      errorMessage: mode === 'install' ? '等待 Agent 注册并回连' : '等待 Agent 更新后回连',
      detail: { enrollmentTokenId, bootstrapCompleted: false },
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

async function executeAgentUpgradeTask(
  task: TaskRun,
  dependencies: TaskWorkerAdapterDependencies,
): Promise<TaskExecutionResult> {
  if (!dependencies.agents?.getUpgradeStatus) {
    return { success: false, errorCode: 'TASK_EXECUTOR_NOT_CONFIGURED', errorMessage: 'Agent 升级状态查询未接入统一任务控制面' };
  }
  const agentId = requiredPayloadString(task, 'agentId');
  const planId = requiredPayloadString(task, 'planId');
  const currentVersion = optionalPayloadString(task, 'currentVersion');
  const targetVersion = optionalPayloadString(task, 'targetVersion');
  const baseDetail = {
    agentId,
    planId,
    currentVersion,
    targetVersion,
    releaseId: optionalPayloadString(task, 'releaseId'),
    transactionId: optionalPayloadString(task, 'transactionId'),
  };
  try {
    const plan = await dependencies.agents.getUpgradeStatus(task.tenantId, agentId, planId);
    const receipt = isRecord(plan.result?.receipt) ? plan.result.receipt : undefined;
    const phase = optionalRecordString(receipt, 'phase') ?? upgradePlanPhase(plan.status);
    const detail = {
      ...baseDetail,
      phase,
      upgradeStatus: plan.status,
      summaryCode: upgradePlanSummaryCode(plan.status, phase),
      ...(receipt ? { receipt } : {}),
    };
    if (plan.status === 'succeeded') return { success: true, detail };
    if (['failed', 'rolled_back', 'rejected', 'unknown', 'manual_required', 'transport_failed'].includes(plan.status)) {
      return {
        success: false,
        retryable: false,
        errorCode: optionalRecordString(receipt, 'errorCode') ?? plan.status.toUpperCase(),
        errorMessage: optionalRecordString(receipt, 'errorMessage') ?? plan.reason,
        detail,
      };
    }
    return {
      success: false,
      waitingStatus: 'WAITING_RESULT',
      retryAfterSeconds: 5,
      errorCode: 'AGENT_UPDATE_PENDING',
      detail,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      waitingStatus: 'WAITING_RESULT',
      retryAfterSeconds: 10,
      errorCode: 'AGENT_UPDATE_STATUS_PENDING',
      errorMessage: 'Agent 升级仍在执行，暂时无法读取最终回执',
      detail: {
        ...baseDetail,
        phase: 'status_checking',
        summaryCode: 'waiting',
        lastStatusError: errorMessage,
      },
    };
  }
}

function upgradePlanPhase(status: string): string {
  if (status === 'planned') return 'queued';
  if (status === 'dispatching') return 'dispatching';
  if (status === 'accepted') return 'accepted';
  if (status === 'running' || status === 'retrying') return 'upgrading';
  if (status === 'succeeded') return 'succeeded';
  if (status === 'rolled_back') return 'rolled_back';
  if (status === 'manual_required') return 'manual_required';
  if (status === 'failed' || status === 'rejected' || status === 'transport_failed') return 'failed';
  return 'unknown';
}

function upgradePlanSummaryCode(status: string, phase: string): string {
  if (status === 'succeeded') return 'succeeded';
  if (['failed', 'rolled_back', 'rejected', 'manual_required', 'transport_failed'].includes(status)) return 'failed';
  if (phase === 'queued') return 'queued';
  if (phase === 'dispatching') return 'dispatching';
  if (phase === 'accepted') return 'accepted';
  if (phase === 'upgrading') return 'upgrading';
  return 'waiting';
}

function optionalRecordString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readDedicatedPreparation(progress: Record<string, unknown> | undefined): { certificateVersionId?: string; certificateAssetId?: string; certificateRequestId?: string; issueRequired: boolean } | undefined {
  const value = progress?.preparation;
  if (!isRecord(value) || typeof value.issueRequired !== 'boolean') return undefined;
  return {
    issueRequired: value.issueRequired,
    ...(typeof value.certificateVersionId === 'string' ? { certificateVersionId: value.certificateVersionId } : {}),
    ...(typeof value.certificateAssetId === 'string' ? { certificateAssetId: value.certificateAssetId } : {}),
    ...(typeof value.certificateRequestId === 'string' ? { certificateRequestId: value.certificateRequestId } : {}),
  };
}

function readCertificateVersionFromTask(task: TaskRun): string | undefined {
  const detail = isRecord(task.progress?.detail) ? task.progress.detail : undefined;
  return optionalRecordString(task.progress, 'certificateVersionId')
    ?? optionalRecordString(detail, 'certificateVersionId')
    ?? optionalRecordString(task.payload, 'certificateVersionId');
}

function readCertificateRequestFromTask(task: TaskRun | undefined): string | undefined {
  if (!task) return undefined;
  const detail = isRecord(task.progress?.detail) ? task.progress.detail : undefined;
  return optionalRecordString(task.progress, 'certificateRequestId')
    ?? optionalRecordString(detail, 'certificateRequestId')
    ?? optionalRecordString(task.payload, 'certificateRequestId');
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
