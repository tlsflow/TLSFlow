import { AppError } from '../../../common/errors/app-error.js';
import { AUDIT_EVENT_TYPES } from '../../audits/audit-event-types.js';
import { AuditService } from '../../audits/audit.service.js';
import type { DeploymentPlansRepository } from '../../deployment-plans/repository/deployment-plans.repository.js';
import type { DeploymentGatewayRouteDto } from '../../deployment-plans/dto/deployment-plans.dto.js';
import { newId } from '../../../shared/id.js';
import { assertTransition } from '../../../shared/state-machine/core-state-machine.js';
import type { RequestContext } from '../../../shared/security-types.js';
import type { StateTransitionEventEntity } from '../../deployment-plans/schema/deployment-plans.schema.js';
import type { CreateExecutionRunInput, ExecutionRunDto, ExecutionSourceDto, ExecutionStepDto, RetryExecutionRunInput, RollbackExecutionRunInput } from '../dto/executions.dto.js';
import { ExecutionsDomainService } from '../domain/executions.domain-service.js';
import { ExecutionsRepository } from '../repository/executions.repository.js';
import type { ExecutionRunEntity, ExecutionStepEntity } from '../schema/executions.schema.js';
import { ExecutorRegistry } from './executors.js';
import type { ExecutionResultSyncService } from './execution-result-sync.service.js';
import { FailurePolicyEngine } from './failure-policy-engine.js';
import { ExecutionDetailStreamService } from './execution-detail-stream.service.js';
import { RunRecoveryWorker } from './run-recovery-worker.js';
import { Scheduler } from './scheduler.js';
import { StepGraphBuilder } from './step-graph-builder.js';
import { sanitizeExecutionErrorDetails } from './execution-error-details.js';
import type { DeploymentInputSnapshotsRepository } from '../../deployment-inputs/repository/deployment-input-snapshots.repository.js';
import { sanitizeDeploymentInputPersistencePayload } from '../../deployment-inputs/application/deployment-input-persistence-sanitizer.js';
import type { TaskEnqueuer } from '../../tasks/task-enqueue.js';
import type { AgentSecurityStatus } from '../../agents/security/agent-security.contract.js';

type FailurePolicy = 'stop' | 'continue' | 'rollback';

export interface ExecutionsApplicationDependencies {
  repository?: ExecutionsRepository;
  deploymentPlansRepository: DeploymentPlansRepository;
  /** 旧 bootstrap 仍会传入该字段；执行服务不会读取，也不会据此创建旧队列。 */
  queueDb?: unknown;
  audit?: AuditService;
  domain?: ExecutionsDomainService;
  executorRegistry?: ExecutorRegistry;
  resultSync?: ExecutionResultSyncService;
  detailStream?: ExecutionDetailStreamService;
  stageIntervalMs?: number;
  delay?: (milliseconds: number) => Promise<void>;
  deploymentInputSnapshots?: DeploymentInputSnapshotsRepository;
  tasks?: TaskEnqueuer;
}

export class ExecutionsApplicationService {
  private readonly repository: ExecutionsRepository;
  private readonly deploymentPlansRepository: DeploymentPlansRepository;
  private readonly audit: AuditService;
  private readonly domain: ExecutionsDomainService;
  private readonly graphBuilder: StepGraphBuilder;
  private readonly scheduler: Scheduler;
  private readonly failurePolicy: FailurePolicyEngine;
  private readonly recoveryWorker: RunRecoveryWorker;
  private readonly executorRegistry: ExecutorRegistry;
  private readonly resultSync?: ExecutionResultSyncService;
  private readonly detailStream?: ExecutionDetailStreamService;
  private readonly stageIntervalMs: number;
  private readonly delay: (milliseconds: number) => Promise<void>;
  private readonly deploymentInputSnapshots?: DeploymentInputSnapshotsRepository;
  private readonly tasks?: TaskEnqueuer;

  constructor(dependencies: ExecutionsApplicationDependencies) {
    this.repository = dependencies.repository ?? new ExecutionsRepository();
    this.deploymentPlansRepository = dependencies.deploymentPlansRepository;
    this.audit = dependencies.audit ?? new AuditService();
    this.domain = dependencies.domain ?? new ExecutionsDomainService();
    this.graphBuilder = new StepGraphBuilder();
    this.scheduler = new Scheduler(this.graphBuilder);
    this.failurePolicy = new FailurePolicyEngine();
    this.recoveryWorker = new RunRecoveryWorker(this.repository);
    this.executorRegistry = dependencies.executorRegistry ?? new ExecutorRegistry();
    this.resultSync = dependencies.resultSync;
    this.detailStream = dependencies.detailStream;
    this.stageIntervalMs = Math.max(0, dependencies.stageIntervalMs ?? 1_000);
    this.delay = dependencies.delay ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.deploymentInputSnapshots = dependencies.deploymentInputSnapshots;
    this.tasks = dependencies.tasks;
  }

  async listRuns(input: { tenantId?: string; deploymentPlanId?: string } = {}): Promise<any> {
    return (await this.repository.listRuns(input.tenantId, input.deploymentPlanId)).map((run) => this.toRunDto(run));
  }

  async listSteps(input: { tenantId?: string; executionRunId?: string } = {}): Promise<any> {
    return (await this.repository.listSteps(input.tenantId, input.executionRunId)).map((step) => this.toStepDto(step));
  }

  async getRun(id: string, tenantId?: string): Promise<any> {
    return this.toRunDto(await this.repository.getRunOrThrow(id, tenantId));
  }

  getRepository(): ExecutionsRepository {
    return this.repository;
  }

  async getStep(id: string, tenantId?: string): Promise<any> {
    return this.toStepDto(await this.repository.getStepOrThrow(id, tenantId));
  }

  async createApplyRun(input: CreateExecutionRunInput, context: RequestContext = {}): Promise<any> {
    return this.createRunAndEnqueue(input, context);
  }

  async createDryRun(input: CreateExecutionRunInput, context: RequestContext = {}): Promise<any> {
    return this.createRunAndEnqueue({ ...input, type: 'dry_run' }, context);
  }

  async retry(input: RetryExecutionRunInput, context: RequestContext = {}): Promise<any> {
    const sourceRun = await this.repository.getRunOrThrow(input.runId, input.tenantId);
    const sourceSteps = await this.repository.listSteps(input.tenantId, sourceRun.id);
    if (!['FAILED', 'TIMEOUT', 'CANCELLED'].includes(sourceRun.status)) {
      throw new AppError('DEPLOYMENT_INVALID_STATE', '只有失败、超时或取消的运行允许重试', { runId: sourceRun.id, status: sourceRun.status });
    }
    const targetIds = sourceSteps
      .map((step) => step.deploymentPlanTargetId)
      .filter((id): id is string => Boolean(id));
    const uniqueTargetIds = [...new Set(targetIds)];
    const sourcePayloadByTargetId = new Map<string, Record<string, unknown>>();
    for (const step of sourceSteps) {
      const targetId = step.deploymentPlanTargetId;
      if (!targetId) continue;
      if (!sourcePayloadByTargetId.has(targetId)) sourcePayloadByTargetId.set(targetId, step.inputSnapshot);
    }
    const executorTypeByTargetId = readSourceExecutorTypes(sourcePayloadByTargetId);
    const gatewayRouteByTargetId = readSourceGatewayRoutes(sourcePayloadByTargetId);
    return this.createRunAndEnqueue({
      deploymentPlanId: sourceRun.deploymentPlanId,
      deploymentPlanTargetIds: uniqueTargetIds,
      type: 'apply',
      idempotencyKey: input.idempotencyKey,
      actorId: input.actorId,
      tenantId: input.tenantId,
      executorTypeByTargetId,
      gatewayRouteByTargetId,
      agentPayloadByTargetId: sourcePayloadByTargetId,
      source: readExecutionSource(sourceRun.summary.executionSource),
    }, context);
  }

  async rollback(input: RollbackExecutionRunInput, context: RequestContext = {}): Promise<any> {
    const sourceRun = await this.repository.getRunOrThrow(input.runId, input.tenantId);
    const sourceSteps = await this.repository.listSteps(input.tenantId, sourceRun.id);
    this.domain.assertRollbackAllowed(sourceRun);
    const targetIds = [...new Set(sourceSteps.map((step) => step.deploymentPlanTargetId).filter((id): id is string => Boolean(id)))];
    if (!sourceSteps.length || !targetIds.length) {
      throw new AppError('VALIDATION_FAILED', '回滚缺少源步骤或目标，不能静默创建空回滚，请人工介入', { runId: sourceRun.id, sourceStepCount: sourceSteps.length, targetCount: targetIds.length });
    }
    const sourcePayloadByTargetId = new Map<string, Record<string, unknown>>();
    for (const step of sourceSteps) {
      const targetId = step.deploymentPlanTargetId;
      if (!targetId) continue;
      if (!sourcePayloadByTargetId.has(targetId)) {
        const basePayload = readRecord(step.inputSnapshot) ?? {};
        const rollbackContext = buildRollbackContextFromSourceSteps(sourceRun.id, sourceSteps, targetId);
        const stepOutputs = buildWorkflowStepOutputsFromSourceSteps(sourceSteps, targetId);
        const rollbackCertificateSha256 = readString(rollbackContext, 'rollbackCertificateSha256');
        const baseVerification = readRecord(basePayload.certificateVerification);
        sourcePayloadByTargetId.set(targetId, {
          ...basePayload,
          ...(stepOutputs ? { stepOutputs } : {}),
          ...(rollbackCertificateSha256
            ? {
                certificateVerification: {
                  ...(baseVerification ?? {}),
                  expectedFingerprintSha256: rollbackCertificateSha256,
                },
                expectedCertificateFingerprintSha256: rollbackCertificateSha256,
              }
            : {}),
          sourceRunId: sourceRun.id,
          rollbackContext,
        });
      }
    }
    const executorTypeByTargetId = readSourceExecutorTypes(sourcePayloadByTargetId);
    const gatewayRouteByTargetId = readSourceGatewayRoutes(sourcePayloadByTargetId);
    const transitioned = await this.transitionRunEntity(sourceRun, 'ROLLBACK_RUNNING', input.actorId, 'rollback.requested');
    await this.audit.write({
      eventType: AUDIT_EVENT_TYPES.DEPLOYMENT_ROLLBACK_REQUESTED,
      actorType: 'user',
      actorId: input.actorId,
      action: 'execution.rollback',
      resourceType: 'executionRun',
      resourceId: sourceRun.id,
      result: 'success',
      riskLevel: 'high',
      context,
      failClosed: true,
      detail: { sourceRunId: sourceRun.id, approvalId: input.approvalId },
    });
    const created = await this.createRunAndEnqueue({
      deploymentPlanId: sourceRun.deploymentPlanId,
      deploymentPlanTargetIds: targetIds,
      type: 'rollback',
      idempotencyKey: input.idempotencyKey,
      actorId: input.actorId,
      tenantId: input.tenantId,
      executorTypeByTargetId,
      gatewayRouteByTargetId,
      agentPayloadByTargetId: sourcePayloadByTargetId,
      source: readExecutionSource(sourceRun.summary.executionSource),
    }, context);
    return { sourceRun: this.toRunDto(transitioned), rollbackRun: created.run, steps: created.steps, jobId: created.jobId };
  }

  async triggerAutomaticRollback(runId: string, actorId: string, tenantId?: string): Promise<void> {
    const run = await this.repository.getRunOrThrow(runId, tenantId);
    if (run.type !== 'apply') return;
    if (this.readRunFailurePolicy(run) !== 'rollback') return;
    if (!['FAILED', 'TIMEOUT'].includes(run.status)) return;
    await this.requestAutomaticRollback(run, actorId, tenantId);
  }

  async cancelRun(runId: string, actorId: string, tenantId?: string): Promise<any> {
    const run = await this.repository.getRunOrThrow(runId, tenantId);
    if (!['PENDING', 'DISPATCHED', 'RUNNING'].includes(run.status)) {
      return this.toRunDto(run);
    }
    for (const step of await this.repository.listSteps(tenantId, run.id)) {
      if (step.status === 'PENDING') {
        await this.transitionStepEntity(step, 'SKIPPED', actorId, 'step.cancelled');
      } else if (step.status === 'RUNNING' && isPotentiallyUnknownWriteStep(step)) {
        await this.persistUnknownExecution(run, step, actorId, tenantId, {
          success: false,
          errorCode: 'EXECUTION_CANCELLED_UNKNOWN',
          errorMessage: '写操作取消与外部执行竞态，结果无法确认，禁止自动重放',
          detail: { executionStatus: 'UNKNOWN', cancellationRace: true },
        });
      }
    }
    return this.toRunDto(await this.transitionRunEntity(run, 'CANCELLED', actorId, 'run.cancelled'));
  }

  async runDispatchedExecution(runId: string, actorId: string, tenantId: string | undefined, registry: ExecutorRegistry = this.executorRegistry): Promise<any> {
    let run = await this.repository.getRunOrThrow(runId, tenantId);
    const persistedSteps = await this.repository.listSteps(tenantId, run.id);
    if (run.status === 'CANCELLED') return { success: false, errorCode: 'RUN_CANCELLED', errorMessage: '执行运行已取消' };
    if (!['DISPATCHED', 'RUNNING'].includes(run.status)) {
      throw new AppError('DEPLOYMENT_INVALID_STATE', '只有 DISPATCHED 或 RUNNING 运行允许调度执行', { runId: run.id, status: run.status });
    }

    if (run.status === 'DISPATCHED') {
      run = await this.transitionRunEntity(run, 'RUNNING', actorId, 'runner.started');
    }
    while (true) {
      const currentRun = await this.repository.getRunOrThrow(run.id, tenantId);
      if (currentRun.status === 'CANCELLED') {
        return { success: false, errorCode: 'RUN_CANCELLED', errorMessage: '执行运行已取消' };
      }
      if (isTerminalRunStatus(currentRun.status)) {
        return {
          success: currentRun.status === 'SUCCESS',
          errorCode: currentRun.errorCode,
          errorMessage: currentRun.errorMessage,
        };
      }

      const steps = (await this.repository.listSteps(tenantId, run.id)).sort((left, right) => left.stepNo - right.stepNo);
      const graphState = this.graphBuilder.build(steps);
      const policy = this.readRunFailurePolicy(currentRun);
      const failedStep = steps.find((step) => step.status === 'FAILED' || step.status === 'TIMEOUT');
      if (failedStep && policy !== 'continue') {
        return await this.finishFailedRun(currentRun, actorId, tenantId, policy, failedStep.lastErrorCode ?? 'STEP_FAILED', failedStep.lastErrorMessage ?? '执行步骤失败', failedStep.status === 'TIMEOUT');
      }
      if (graphState.runnable.length === 0 && graphState.running.length > 0) {
        return { success: true, pending: true };
      }
      if (graphState.runnable.length === 0 && graphState.running.length === 0) {
        if (failedStep) {
          return await this.finishFailedRun(currentRun, actorId, tenantId, policy, failedStep.lastErrorCode ?? 'STEP_FAILED_CONTINUED', failedStep.lastErrorMessage ?? 'failurePolicy=continue 已执行完可运行步骤，运行以失败汇总结束', failedStep.status === 'TIMEOUT');
        }
        const successRun = await this.transitionRunEntity(currentRun, 'SUCCESS', actorId, 'runner.success');
        await this.syncDeploymentPlanAfterRun(successRun, actorId, tenantId);
        return { success: true };
      }

      const pick = this.scheduler.pickNext(steps, currentRun.concurrencyLimit ?? 1);
      if (!pick.selected.length) {
        if (!graphState.running.length) {
          return await this.finishFailedRun(currentRun, actorId, tenantId, policy, 'STEP_DEPENDENCY_BLOCKED', '所有步骤都被依赖阻塞，执行无法继续');
        }
        continue;
      }

      const batchResults = await Promise.all(pick.selected.map(async (step) => this.executeSingleStep(step.id, currentRun, actorId, tenantId, registry)));
      if (batchResults.some((item) => item.asyncPending)) {
        return { success: true, pending: true };
      }
      const failures = batchResults.filter((item) => !item.success);
      if (failures.length && policy === 'continue') {
        for (const failure of failures) {
          await this.skipPendingStepsForTarget(run.id, failure.deploymentPlanTargetId, actorId, tenantId, 'failure_policy.continue');
        }
        continue;
      }
      const firstFailure = failures[0];
      if (firstFailure) {
        const refreshedRun = await this.repository.getRunOrThrow(run.id, tenantId);
        return await this.finishFailedRun(refreshedRun, actorId, tenantId, policy, firstFailure.errorCode ?? 'STEP_FAILED', firstFailure.errorMessage ?? '执行步骤失败');
      }
    }
  }

  async markFailedForTest(runId: string, actorId: string, tenantId?: string): Promise<any> {
    const run = await this.repository.getRunOrThrow(runId, tenantId);
    const dispatched = run.status === 'PENDING' ? await this.transitionRunEntity(run, 'DISPATCHED', actorId, 'test.dispatch') : run;
    const running = dispatched.status === 'DISPATCHED' ? await this.transitionRunEntity(dispatched, 'RUNNING', actorId, 'test.start') : dispatched;
    const failed = await this.transitionRunEntity(running, 'FAILED', actorId, 'test.fail', { errorCode: 'MOCK_FAILURE', errorMessage: '模拟失败' });
    await this.syncDeploymentPlanAfterRun(failed, actorId, tenantId);
    return this.toRunDto(failed);
  }

  async updateStepForTest(stepId: string, patch: Partial<ExecutionStepEntity>, tenantId?: string): Promise<any> {
    await this.repository.getStepOrThrow(stepId, tenantId);
    const updated = await this.repository.updateStep(stepId, patch);
    this.detailStream?.publishStep(updated);
    return this.toStepDto(updated);
  }

  async updateRunForTest(runId: string, patch: Partial<ExecutionRunEntity>, tenantId?: string): Promise<any> {
    await this.repository.getRunOrThrow(runId, tenantId);
    const updated = await this.repository.updateRun(runId, patch);
    this.detailStream?.publishRun(updated);
    return this.toRunDto(updated);
  }

  async recoverRunsForTest(actorId: string, tenantId?: string, registry: ExecutorRegistry = new ExecutorRegistry()): Promise<any> {
    const candidates = await this.recoveryWorker.recoverableRuns(tenantId);
    const results: Array<{ run: ExecutionRunDto; result: { success: boolean; recovered: boolean; skippedStepIds: string[]; unknownStepIds: string[] } }> = [];
    for (const candidate of candidates) {
      for (const stepId of candidate.unknownStepIds) {
        const step = await this.repository.getStepOrThrow(stepId, tenantId);
        if (step.status === 'RUNNING') {
          await this.persistUnknownExecution(candidate.run, step, actorId, tenantId, {
            success: false,
            errorCode: 'EXECUTION_RECOVERY_UNKNOWN',
            errorMessage: '进程重启后无法确认写操作是否已生效，禁止自动重放',
            detail: { executionStatus: 'UNKNOWN', recoveryBoundary: true },
          });
        }
      }
      for (const step of candidate.stepsToResume) {
        if (step.status === 'RUNNING' && step.idempotent !== false) {
          await this.repository.updateStep(step.id, {
            status: 'PENDING',
            updatedAt: new Date().toISOString(),
            updatedBy: actorId,
          });
          await this.recordTransition('executionStep', step.id, 'RUNNING', 'PENDING', 'recovery.requeued', actorId, step.tenantId);
        }
      }
      for (const stepId of candidate.skippedStepIds) {
        const step = await this.repository.getStepOrThrow(stepId, tenantId);
        if (step.status === 'RUNNING') {
          await this.repository.updateStep(step.id, {
            status: 'SKIPPED',
            updatedAt: new Date().toISOString(),
            updatedBy: actorId,
            finishedAt: new Date().toISOString(),
            lastFailureCategory: 'unsafe',
            lastErrorCode: 'NON_IDEMPOTENT_SKIPPED',
            lastErrorMessage: '恢复流程跳过不可幂等的运行中步骤',
          });
          await this.recordTransition('executionStep', step.id, 'RUNNING', 'SKIPPED', 'recovery.non_idempotent_skipped', actorId, step.tenantId);
        }
      }

      const resumedRun = await this.repository.getRunOrThrow(candidate.run.id, tenantId);
      const normalizedRun = resumedRun.status === 'PENDING'
        ? await this.transitionRunEntity(resumedRun, 'DISPATCHED', actorId, 'recovery.redispatched')
        : await this.repository.updateRun(resumedRun.id, {
            recoveryAttemptCount: (resumedRun.recoveryAttemptCount ?? 0) + 1,
            lastRecoveryAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            updatedBy: actorId,
          });
      const executionResult = await this.runDispatchedExecution(normalizedRun.id, actorId, tenantId, registry);
      results.push({
        run: await this.getRun(normalizedRun.id, tenantId),
        result: { success: executionResult.success, recovered: true, skippedStepIds: candidate.skippedStepIds, unknownStepIds: candidate.unknownStepIds },
      });
    }
    return results;
  }

  /** 旧 bootstrap 调用的硬停止接口；统一任务控制面之外不再执行任何任务。 */
  async runNextQueuedJob(): Promise<null> {
    return null;
  }

  private async createRunAndEnqueue(input: CreateExecutionRunInput, context: RequestContext): Promise<{ run: ExecutionRunDto; steps: ExecutionStepDto[]; jobId: string }> {
    const tasks = this.tasks;
    const tenantId = input.tenantId;
    if (!tasks || !tenantId) {
      throw new AppError('SYSTEM_INTERNAL_ERROR', '统一任务控制面未配置，拒绝进入旧执行路径', {
        code: 'UNIFIED_TASK_CONTROL_PLANE_REQUIRED',
        deploymentPlanId: input.deploymentPlanId,
        tenantId,
      });
    }
    const existing = await this.repository.findRunByIdempotencyKey(input.tenantId, input.idempotencyKey);
    const requestHash = this.domain.buildRunRequestHash({ deploymentPlanId: input.deploymentPlanId, type: input.type });
    if (existing) {
      if (existing.requestHash !== requestHash) throw new AppError('IDEMPOTENCY_CONFLICT', '执行运行幂等键冲突', { idempotencyKey: input.idempotencyKey });
      return { run: this.toRunDto(existing), steps: await this.listSteps({ tenantId: input.tenantId, executionRunId: existing.id }), jobId: existing.externalRunId ?? '' };
    }

    const now = new Date().toISOString();
    const run = await this.repository.createRun({
      id: newId('run'),
      tenantId: input.tenantId,
      deploymentPlanId: input.deploymentPlanId,
      runNo: await this.repository.nextRunNo(input.tenantId, input.deploymentPlanId),
      type: input.type,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      status: 'PENDING',
      concurrencyLimit: input.concurrencyLimit ?? 1,
      summary: {
        failurePolicy: input.failurePolicy ?? 'stop',
        retry: input.retry ?? { maxAttempts: input.stepMaxAttempts ?? 1, backoffSeconds: 0 },
        allowMockExecutor: input.allowMockExecutor === true,
        executionSource: input.source ?? { type: 'deployment_plan' },
      },
      createdAt: now,
      updatedAt: now,
      createdBy: input.actorId,
      version: 1,
    });
    await this.recordTransition('executionRun', run.id, undefined, 'PENDING', 'run.created', input.actorId, input.tenantId);

    const stepMaxAttempts = input.retry?.maxAttempts ?? input.stepMaxAttempts ?? 1;
    const steps = await this.createDefaultSteps(
      run,
      input.deploymentPlanTargetIds,
      input.actorId,
      input.executorTypeByTargetId,
      input.gatewayRouteByTargetId,
      input.mockResultByTargetId,
      stepMaxAttempts,
      input.allowMockExecutor === true,
      input.agentPayloadByTargetId,
    );
    const deploymentPlan = await this.deploymentPlansRepository.getPlan(input.deploymentPlanId, tenantId);
    const task = await tasks.enqueue({
      tenantId,
      taskType: taskTypeForExecutionRun(input.type),
      requestedBy: input.actorId,
      triggerSource: `execution.${input.type}.enqueue`,
      idempotencyKey: `execution-run:${run.id}`,
      resourceSummary: {
        displayName: deploymentPlan?.name ?? input.deploymentPlanId,
        deploymentPlanId: input.deploymentPlanId,
        executionType: input.type,
      },
      payload: {
        runId: run.id,
        deploymentPlanId: input.deploymentPlanId,
        executionType: input.type,
      },
      resourceRefs: [
        { resourceType: 'deploymentPlan', resourceId: input.deploymentPlanId, displayKey: deploymentPlan?.name ?? input.deploymentPlanId },
        { resourceType: 'executionRun', resourceId: run.id },
      ],
    });
    const jobId = task.id;
    const dispatched = await this.transitionRunEntity({ ...run, externalRunId: jobId }, 'DISPATCHED', input.actorId, 'queue.dispatched', { externalRunId: jobId });

    await this.audit.write({
      eventType: AUDIT_EVENT_TYPES.DEPLOYMENT_EXECUTED,
      actorType: 'user',
      actorId: input.actorId,
      action: `execution.${input.type}.enqueue`,
      resourceType: 'executionRun',
      resourceId: run.id,
      result: 'success',
      riskLevel: input.type === 'dry_run' ? 'low' : 'high',
      context,
      failClosed: input.type !== 'dry_run',
      detail: { deploymentPlanId: input.deploymentPlanId, jobId, stepCount: steps.length, taskControlPlane: 'unified-task-control-plane' },
    });

    return { run: this.toRunDto(dispatched), steps: steps.map((step) => this.toStepDto(step)), jobId };
  }

  private async createDefaultSteps(
    run: ExecutionRunEntity,
    targetIds: string[],
    actorId: string,
    executorTypeByTargetId: Map<string, string>,
    gatewayRouteByTargetId?: Map<string, unknown>,
    mockResultByTargetId?: Map<string, 'success' | 'fail'>,
    stepMaxAttempts = 1,
    allowMockExecutor = false,
    agentPayloadByTargetId?: Map<string, Record<string, unknown>>,
  ): Promise<ExecutionStepEntity[]> {
    const defaultStepTypes = run.type === 'rollback'
      ? ['ROLLBACK', 'VERIFY'] as const
      : ['DISCOVER', 'BACKUP', 'INSTALL', 'RELOAD', 'VERIFY'] as const;
    const created: ExecutionStepEntity[] = [];
    let stepNo = 1;
    for (const targetId of targetIds) {
      let previousStepNo: number | undefined;
      const targetExecutorType = executorTypeByTargetId.get(targetId);
      const agentPayload = persistentExecutionPayload(agentPayloadByTargetId?.get(targetId) ?? {});
      const trustPlan = run.type === 'apply' ? readCertificateTrustPlan(agentPayload.certificateTrustPlan) : undefined;
      if (trustPlan?.decision === 'install') {
        const now = new Date().toISOString();
        const trustStep = await this.repository.createStep({
          id: newId('stp'),
          tenantId: run.tenantId,
          executionRunId: run.id,
          deploymentPlanTargetId: targetId,
          stepNo,
          stepType: 'CUSTOM',
          name: `TRUST_INSTALL ${targetId}`,
          dependsOn: [],
          idempotent: true,
          attemptCount: 0,
          maxAttempts: stepMaxAttempts,
          inputSnapshot: {
            ...agentPayload,
            actionType: trustPlan.actionType,
            actionSchemaVersion: trustPlan.actionSchemaVersion,
            agentId: trustPlan.agentId,
            certificatePem: trustPlan.certificatePem,
            fingerprintSha256: trustPlan.fingerprintSha256,
            trustStore: trustPlan.store,
            deploymentPlanId: run.deploymentPlanId,
            deploymentPlanTargetId: targetId,
            executionRunId: run.id,
            deploymentExecutorType: 'AGENT',
            executorType: 'AGENT',
            dryRun: false,
            stepType: 'CUSTOM',
            operation: 'install_trust_root',
            retryBackoffSeconds: readRetryBackoff(run.summary),
          },
          status: 'PENDING',
          createdAt: now,
          updatedAt: now,
          createdBy: actorId,
          version: 1,
        });
        await this.recordTransition('executionStep', trustStep.id, undefined, 'PENDING', 'step.created', actorId, run.tenantId);
        this.detailStream?.publishStep(trustStep);
        created.push(trustStep);
        previousStepNo = stepNo;
        stepNo += 1;
      }
      const stepTypes = defaultStepTypes;
      for (const stepType of stepTypes) {
        const now = new Date().toISOString();
	        const baseExecutorType = targetExecutorType;
	        if (!baseExecutorType) {
	          throw new AppError('VALIDATION_FAILED', '部署目标缺少执行器类型，拒绝使用 MockExecutor 兜底', { targetId });
	        }
	        if (baseExecutorType === 'MOCK' && !allowMockExecutor) {
	          throw new AppError('VALIDATION_FAILED', 'MockExecutor 只能在测试或显式允许时使用', { targetId });
	        }
	        if (baseExecutorType !== 'MOCK') {
	          readDeploymentInputSnapshotRef(agentPayload.deploymentInputSnapshotRef, { deploymentPlanTargetId: targetId });
	        }
	        const gatewayRoute = this.readGatewayRoute(gatewayRouteByTargetId?.get(targetId));
	        const executorType = resolveStepExecutorType(baseExecutorType, stepType, agentPayload, gatewayRoute);
	        const operation = mapStepTypeToOperation(stepType);
        const sourceRunId = run.type === 'rollback'
          ? readString(agentPayload.sourceRunId) ?? readString(agentPayload.rollbackContext, 'sourceRunId')
          : undefined;
        const planTarget = await this.deploymentPlansRepository.getTarget(targetId, run.tenantId);
        const step = await this.repository.createStep({
          id: newId('stp'),
            tenantId: run.tenantId,
            executionRunId: run.id,
            deploymentPlanTargetId: targetId,
          stepNo,
          stepType,
          name: `${stepType} ${targetId}`,
          dependsOn: previousStepNo ? [previousStepNo] : [],
          idempotent: stepType !== 'RELOAD',
          attemptCount: 0,
          maxAttempts: stepMaxAttempts,
            inputSnapshot: {
              ...agentPayload,
              deploymentPlanId: run.deploymentPlanId,
              deploymentPlanTargetId: targetId,
              executionRunId: run.id,
              certificateBindingId: readString(agentPayload.certificateBindingId) ?? planTarget?.certificateBindingId,
              deploymentExecutorType: baseExecutorType,
              executorType,
              dryRun: run.type === 'dry_run',
              stepType,
              operation,
              sourceRunId,
              mockResult: mockResultByTargetId?.get(targetId),
              gatewayRoute,
            gatewayId: gatewayRoute?.gatewayId,
            zoneId: gatewayRoute?.zoneId,
            gatewayAdapter: gatewayRoute?.adapter,
            delegatedTargetId: gatewayRoute?.delegatedTargetId,
            retryBackoffSeconds: readRetryBackoff(run.summary),
          },
          status: 'PENDING',
          createdAt: now,
          updatedAt: now,
          createdBy: actorId,
          version: 1,
        });
        await this.recordTransition('executionStep', step.id, undefined, 'PENDING', 'step.created', actorId, run.tenantId);
        this.detailStream?.publishStep(step);
        created.push(step);
        previousStepNo = stepNo;
        stepNo += 1;
      }
    }
    return created;
  }

  private async syncDeploymentPlanAfterRun(run: ExecutionRunEntity, actorId: string, tenantId?: string): Promise<void> {
    if (run.type === 'dry_run') return;
    const plan = await this.deploymentPlansRepository.getPlan(run.deploymentPlanId, tenantId);
    if (!plan) return;
    const steps = await this.repository.listSteps(tenantId, run.id);
    const targetIds = [...new Set(steps.map((step) => step.deploymentPlanTargetId).filter((id): id is string => Boolean(id)))];

    if (run.type === 'rollback') {
      if (run.status === 'SUCCESS') {
        await this.markTargets(targetIds, 'READY', actorId, tenantId);
        if (plan.status === 'FAILED' || plan.status === 'PARTIAL_SUCCESS') {
          await this.transitionDeploymentPlan(plan, 'ROLLED_BACK', actorId, 'rollback.success');
        }
        await this.markRollbackSourceRuns(run.deploymentPlanId, 'ROLLBACK_SUCCESS', actorId, tenantId);
      } else if (run.status === 'FAILED' || run.status === 'TIMEOUT') {
        await this.markRollbackSourceRuns(run.deploymentPlanId, 'ROLLBACK_FAILED', actorId, tenantId);
      }
      return;
    }

    if (run.status === 'SUCCESS') {
      await this.markTargets(targetIds, 'COMPLETED', actorId, tenantId);
      if (plan.status === 'RUNNING') await this.transitionDeploymentPlan(plan, 'SUCCESS', actorId, 'execution.success');
      await this.resultSync?.probeSuccessfulDeploymentPlanTargets({ tenantId, deploymentPlanId: run.deploymentPlanId });
      return;
    }

    if (run.status === 'FAILED' || run.status === 'TIMEOUT') {
      const failedTargetIds = new Set(steps
        .filter((step) => step.status === 'FAILED' || step.status === 'TIMEOUT')
        .map((step) => step.deploymentPlanTargetId)
        .filter((id): id is string => Boolean(id)));
      const successfulTargetIds = new Set(steps
        .filter((step) => step.stepType === 'VERIFY' && step.status === 'SUCCESS')
        .map((step) => step.deploymentPlanTargetId)
        .filter((id): id is string => Boolean(id)));
      await this.markTargets([...successfulTargetIds], 'COMPLETED', actorId, tenantId);
      await this.markTargets([...failedTargetIds], 'FAILED', actorId, tenantId);
      if (plan.status === 'RUNNING') {
        await this.transitionDeploymentPlan(plan, successfulTargetIds.size > 0 ? 'PARTIAL_SUCCESS' : 'FAILED', actorId, 'execution.failed');
      }
    }
  }

  private async markTargets(targetIds: string[], status: 'READY' | 'COMPLETED' | 'FAILED' | 'SKIPPED', actorId: string, tenantId?: string): Promise<void> {
    for (const targetId of targetIds) {
      const target = await this.deploymentPlansRepository.getTarget(targetId, tenantId);
      if (!target || target.status === status) continue;
      await this.deploymentPlansRepository.updateTarget(target.id, {
        status,
        updatedAt: new Date().toISOString(),
        updatedBy: actorId,
      });
    }
  }

  private readGatewayRoute(value: unknown): Record<string, string | string[] | boolean | undefined> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const route = value as Record<string, unknown>;
    const normalized = {
      gatewayId: typeof route.gatewayId === 'string' ? route.gatewayId : undefined,
      agentId: typeof route.agentId === 'string' ? route.agentId : undefined,
      zoneId: typeof route.zoneId === 'string' ? route.zoneId : undefined,
      adapter: typeof route.adapter === 'string' ? route.adapter : undefined,
      delegatedTargetId: typeof route.delegatedTargetId === 'string' ? route.delegatedTargetId : undefined,
      fallbackSuggestions: Array.isArray(route.fallbackSuggestions) ? route.fallbackSuggestions.map(String) : undefined,
      mockSafeLocalRuntime: typeof route.mockSafeLocalRuntime === 'boolean' ? route.mockSafeLocalRuntime : undefined,
    };
    return Object.values(normalized).some((item) => Array.isArray(item) ? item.length > 0 : Boolean(item)) ? normalized : undefined;
  }

  private async transitionDeploymentPlan(plan: Awaited<ReturnType<DeploymentPlansRepository['getPlanOrThrow']>>, nextStatus: Awaited<ReturnType<DeploymentPlansRepository['getPlanOrThrow']>>['status'], actorId: string, event: string): Promise<void> {
    assertTransition('deploymentPlan', plan.status, nextStatus);
    await this.deploymentPlansRepository.updatePlan(plan.id, {
      status: nextStatus,
      updatedAt: new Date().toISOString(),
      updatedBy: actorId,
    });
    await this.recordTransition('deploymentPlan', plan.id, plan.status, nextStatus, event, actorId, plan.tenantId);
  }

  private async markRollbackSourceRuns(deploymentPlanId: string, status: 'ROLLBACK_SUCCESS' | 'ROLLBACK_FAILED', actorId: string, tenantId?: string): Promise<void> {
    for (const sourceRun of await this.repository.listRuns(tenantId, deploymentPlanId)) {
      if (sourceRun.status !== 'ROLLBACK_RUNNING') continue;
      await this.transitionRunEntity(sourceRun, status, actorId, status === 'ROLLBACK_SUCCESS' ? 'rollback.success' : 'rollback.failed');
    }
  }

  private async transitionStepEntity(step: ExecutionStepEntity, nextStatus: ExecutionStepEntity['status'], actorId: string, event: string, patch: Partial<ExecutionStepEntity> = {}): Promise<ExecutionStepEntity> {
    this.domain.transitionStep(step.status, nextStatus);
    const now = new Date().toISOString();
    const updated = await this.repository.updateStep(step.id, {
      ...patch,
      status: nextStatus,
      updatedAt: now,
      updatedBy: actorId,
      startedAt: nextStatus === 'RUNNING' ? now : step.startedAt,
      finishedAt: ['SUCCESS', 'FAILED', 'TIMEOUT', 'SKIPPED'].includes(nextStatus) ? now : step.finishedAt,
    });
    await this.recordTransition('executionStep', step.id, step.status, nextStatus, event, actorId, step.tenantId);
    this.detailStream?.publishStep(updated);
    return updated;
  }

  private async transitionRunEntity(run: ExecutionRunEntity, nextStatus: ExecutionRunEntity['status'], actorId: string, event: string, patch: Partial<ExecutionRunEntity> = {}): Promise<ExecutionRunEntity> {
    this.domain.transitionRun(run.status, nextStatus);
    const now = new Date().toISOString();
    const updated = await this.repository.updateRun(run.id, {
      ...patch,
      externalRunId: patch.externalRunId ?? run.externalRunId,
      status: nextStatus,
      updatedAt: now,
      updatedBy: actorId,
      startedAt: nextStatus === 'RUNNING' ? now : run.startedAt,
      finishedAt: ['SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED', 'ROLLBACK_SUCCESS', 'ROLLBACK_FAILED'].includes(nextStatus) ? now : run.finishedAt,
    });
    await this.recordTransition('executionRun', run.id, run.status, nextStatus, event, actorId, run.tenantId);
    this.detailStream?.publishRun(updated);
    return updated;
  }

  private async recordTransition(entityType: StateTransitionEventEntity['entityType'], entityId: string, fromStatus: string | undefined, toStatus: string, event: string, actorId: string, tenantId?: string): Promise<void> {
    await this.deploymentPlansRepository.createTransition({
      id: newId('ste'),
      tenantId,
      entityType,
      entityId,
      fromStatus,
      toStatus,
      event,
      actorType: 'user',
      actorId,
      createdAt: new Date().toISOString(),
    });
  }

  private async executeSingleStep(stepId: string, run: ExecutionRunEntity, actorId: string, tenantId: string | undefined, registry: ExecutorRegistry): Promise<{ success: boolean; asyncPending?: boolean; errorCode?: string; errorMessage?: string; deploymentPlanTargetId?: string }> {
    let current = await this.repository.getStepOrThrow(stepId, tenantId);
    if (current.status !== 'PENDING') {
      return { success: true, deploymentPlanTargetId: current.deploymentPlanTargetId };
    }
    await this.waitForStageInterval(current, run, tenantId);
    current = await this.repository.getStepOrThrow(stepId, tenantId);
    if (current.status !== 'PENDING') {
      return { success: current.status !== 'FAILED' && current.status !== 'TIMEOUT', deploymentPlanTargetId: current.deploymentPlanTargetId };
    }
    const runningStep = await this.transitionStepEntity(current, 'RUNNING', actorId, 'step.started', {
      attemptCount: current.attemptCount + 1,
    });
    const executorType = String(runningStep.inputSnapshot.executorType ?? 'MOCK');
    let result;
    try {
      const runtimeStep = await this.materializeRuntimeStep(runningStep, tenantId);
      result = await registry.get(executorType).executeStep({
        step: runtimeStep,
        runType: run.type,
        dryRun: Boolean(runningStep.inputSnapshot.dryRun),
        reportProgress: async (detail) => {
          const latest = await this.repository.getStepOrThrow(runningStep.id, tenantId);
          if (latest.status !== 'RUNNING') return;
          const updated = await this.repository.updateStep(runningStep.id, {
            inputSnapshot: {
              ...latest.inputSnapshot,
              resultDetail: {
                ...(readRecord(latest.inputSnapshot.resultDetail) ?? {}),
                ...detail,
              },
            },
            updatedAt: new Date().toISOString(),
            updatedBy: actorId,
          });
          this.detailStream?.publishStep(updated);
        },
      });
    } catch (error) {
      result = error instanceof AppError
        ? { success: false, errorCode: error.errorCode, errorMessage: error.message, detail: readRecord(error.details) }
        : { success: false, errorCode: 'EXECUTOR_FAILED', errorMessage: error instanceof Error ? error.message : String(error) };
    }
    const latestStep = await this.repository.getStepOrThrow(runningStep.id, tenantId);
    if (latestStep.status !== 'RUNNING') {
      return {
        success: latestStep.status !== 'FAILED' && latestStep.status !== 'TIMEOUT',
        errorCode: latestStep.lastErrorCode,
        errorMessage: latestStep.lastErrorMessage,
        deploymentPlanTargetId: latestStep.deploymentPlanTargetId,
      };
    }
    const executionStatus = resolveExecutionStatus(result, runningStep);
    const currentRun = await this.repository.getRunOrThrow(run.id, tenantId);
    if (executionStatus === 'UNKNOWN'
      || (currentRun.status === 'CANCELLED' && isPotentiallyUnknownWriteStep(runningStep))) {
      await this.persistUnknownExecution(currentRun, latestStep, actorId, tenantId, {
        success: false,
        status: 'UNKNOWN',
        errorCode: result.errorCode ?? (currentRun.status === 'CANCELLED' ? 'EXECUTION_CANCELLED_UNKNOWN' : 'AGENT_EXECUTION_UNKNOWN'),
        errorMessage: result.errorMessage ?? '执行结果不明，禁止自动重放或回退',
        detail: {
          ...(result.detail ?? {}),
          executionStatus: 'UNKNOWN',
          ...(currentRun.status === 'CANCELLED' ? { cancellationRace: true } : {}),
        },
      });
      return {
        success: true,
        asyncPending: true,
        errorCode: result.errorCode ?? 'AGENT_EXECUTION_UNKNOWN',
        errorMessage: result.errorMessage ?? '执行结果不明，禁止自动重放或回退',
        deploymentPlanTargetId: latestStep.deploymentPlanTargetId,
      };
    }
    if (result.success && result.asyncPending) {
      const latest = await this.repository.getStepOrThrow(runningStep.id, tenantId);
      await this.repository.updateStep(runningStep.id, {
        inputSnapshot: {
          ...latest.inputSnapshot,
          dispatchDetail: result.detail,
        },
        updatedAt: new Date().toISOString(),
        updatedBy: actorId,
      });
      this.detailStream?.publishStep(await this.repository.getStepOrThrow(runningStep.id, tenantId));
      return { success: true, asyncPending: true, deploymentPlanTargetId: runningStep.deploymentPlanTargetId };
    }
    if (this.resultSync && shouldSyncExecutorResult(executorType, run.type)) {
      const stepTenantId = tenantId ?? runningStep.tenantId;
      if (!stepTenantId) {
        throw new AppError('TENANT_CONTEXT_INVALID', '执行结果同步缺少租户上下文', {
          runId: runningStep.executionRunId,
          stepId: runningStep.id,
        });
      }
      await this.resultSync.applyAgentTaskResult({
        tenantId: stepTenantId,
        executionRunId: runningStep.executionRunId,
         executionStepId: runningStep.id,
         success: result.success,
         status: executionStatus,
         errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        detail: {
          executionMode: executorType === 'WORKFLOW' ? 'workflow' : 'control_plane',
          ...(result.detail ?? {}),
        },
        actorId,
      });
      const syncedStep = await this.repository.getStepOrThrow(runningStep.id, tenantId);
      return {
        success: syncedStep.status !== 'FAILED' && syncedStep.status !== 'TIMEOUT',
        errorCode: syncedStep.lastErrorCode,
        errorMessage: syncedStep.lastErrorMessage,
        deploymentPlanTargetId: syncedStep.deploymentPlanTargetId,
      };
    }
    if (result.success) {
      await this.transitionStepEntity(runningStep, 'SUCCESS', actorId, 'step.success', result.detail ? {
        inputSnapshot: {
          ...runningStep.inputSnapshot,
          resultDetail: result.detail,
        },
      } : {});
      return { success: true, deploymentPlanTargetId: runningStep.deploymentPlanTargetId };
    }

    const decision = this.failurePolicy.classify(runningStep, result);
    const canRetry = decision.shouldAutoRetry && runningStep.idempotent !== false;
    if (canRetry) {
      await this.repository.updateStep(runningStep.id, {
        status: 'PENDING',
        updatedAt: new Date().toISOString(),
        updatedBy: actorId,
        lastFailureCategory: decision.category,
        lastErrorCode: result.errorCode,
        lastErrorMessage: result.errorMessage,
        lastErrorDetails: sanitizeExecutionErrorDetails(result.detail),
      });
      await this.recordTransition('executionStep', runningStep.id, 'RUNNING', 'PENDING', 'step.retrying', actorId, runningStep.tenantId);
      this.detailStream?.publishStep(await this.repository.getStepOrThrow(runningStep.id, tenantId));
      return { success: true, deploymentPlanTargetId: runningStep.deploymentPlanTargetId };
    }

    const terminalStatus = decision.category === 'timeout' ? 'TIMEOUT' : 'FAILED';
    await this.transitionStepEntity(runningStep, terminalStatus, actorId, 'step.failed', {
      lastFailureCategory: decision.category,
      lastErrorCode: result.errorCode,
      lastErrorMessage: result.errorMessage,
      lastErrorDetails: sanitizeExecutionErrorDetails(result.detail),
    });
    return { success: false, errorCode: result.errorCode, errorMessage: result.errorMessage, deploymentPlanTargetId: runningStep.deploymentPlanTargetId };
  }

  private async finishFailedRun(run: ExecutionRunEntity, actorId: string, tenantId: string | undefined, policy: FailurePolicy, errorCode: string, errorMessage: string, timeout = false): Promise<{ success: boolean; errorCode?: string; errorMessage?: string }> {
    if (run.status === 'FAILED' || run.status === 'TIMEOUT') {
      return { success: false, errorCode: run.errorCode ?? errorCode, errorMessage: run.errorMessage ?? errorMessage };
    }
    const nextStatus = timeout || errorCode.toLowerCase().includes('timeout') ? 'TIMEOUT' : 'FAILED';
    await this.skipPendingStepsForRun(run.id, actorId, tenantId, 'runner.failed.skip_pending', errorCode, errorMessage);
    const failedRun = await this.transitionRunEntity(run, nextStatus, actorId, 'runner.failed', { errorCode, errorMessage });
    await this.syncDeploymentPlanAfterRun(failedRun, actorId, tenantId);
    if (policy === 'rollback' && run.type === 'apply') {
      await this.requestAutomaticRollback(failedRun, actorId, tenantId);
    }
    return { success: false, errorCode: failedRun.errorCode, errorMessage: failedRun.errorMessage };
  }

  private async requestAutomaticRollback(run: ExecutionRunEntity, actorId: string, tenantId?: string): Promise<void> {
    try {
      const rollbackKey = `${run.idempotencyKey}:auto_rollback`;
      await this.rollback({ runId: run.id, actorId, tenantId, idempotencyKey: rollbackKey }, { actor: { id: actorId, type: 'system', scope: { tenantId } } });
    } catch (error) {
      const source = await this.repository.getRun(run.id, tenantId);
      if (source?.status === 'ROLLBACK_RUNNING') return;
      if (source?.status === 'FAILED' || source?.status === 'TIMEOUT') {
        await this.transitionRunEntity(source, 'ROLLBACK_RUNNING', actorId, 'rollback.auto_failed', {
          errorCode: 'AUTO_ROLLBACK_REQUEST_FAILED',
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async skipPendingStepsForTarget(runId: string, targetId: string | undefined, actorId: string, tenantId: string | undefined, event: string): Promise<void> {
    if (!targetId) return;
    for (const step of await this.repository.listSteps(tenantId, runId)) {
      if (step.deploymentPlanTargetId === targetId && step.status === 'PENDING') {
        await this.transitionStepEntity(step, 'SKIPPED', actorId, event, {
          lastFailureCategory: 'transient',
          lastErrorCode: 'SKIPPED_AFTER_TARGET_FAILURE',
          lastErrorMessage: '同一目标已有失败步骤，failurePolicy=continue 跳过该目标剩余步骤',
        });
      }
    }
  }

  private async skipPendingStepsForRun(runId: string, actorId: string, tenantId: string | undefined, event: string, errorCode: string, errorMessage: string): Promise<void> {
    for (const step of await this.repository.listSteps(tenantId, runId)) {
      if (step.status !== 'PENDING') continue;
      await this.transitionStepEntity(step, 'SKIPPED', actorId, event, {
        lastFailureCategory: 'unsafe',
        lastErrorCode: 'SKIPPED_AFTER_RUN_FAILURE',
        lastErrorMessage: `执行运行已失败，跳过未执行步骤；源错误 ${errorCode}: ${errorMessage}`,
      });
    }
  }

  private toRunDto(run: ExecutionRunEntity): ExecutionRunDto {
    return {
      ...run,
      source: readExecutionSource(run.summary.executionSource),
    };
  }

  private async persistUnknownExecution(
    run: ExecutionRunEntity,
    step: ExecutionStepEntity,
    actorId: string,
    tenantId: string | undefined,
    input: { success: false; status?: AgentSecurityStatus; errorCode?: string; errorMessage?: string; detail?: Record<string, unknown> },
  ): Promise<void> {
    const existingDetail = readRecord(step.inputSnapshot.resultDetail) ?? {};
    if (String(existingDetail.executionStatus ?? '').toUpperCase() === 'UNKNOWN') return;
    const detail = {
      ...existingDetail,
      ...(input.detail ?? {}),
      executionStatus: 'UNKNOWN',
    };
    const now = new Date().toISOString();
    await this.repository.updateStep(step.id, {
      inputSnapshot: { ...step.inputSnapshot, resultDetail: detail },
      lastErrorCode: input.errorCode ?? 'AGENT_EXECUTION_UNKNOWN',
      lastErrorMessage: input.errorMessage ?? '执行结果不明，禁止自动重放或回退',
      lastErrorDetails: sanitizeExecutionErrorDetails(detail),
      updatedAt: now,
      updatedBy: actorId,
    });
    await this.repository.updateRun(run.id, {
      summary: { ...run.summary, executionStatus: 'UNKNOWN', unknownReason: input.errorMessage ?? input.errorCode ?? '执行结果不明' },
      updatedAt: now,
      updatedBy: actorId,
    });
    this.detailStream?.publishStep(await this.repository.getStepOrThrow(step.id, tenantId));
    this.detailStream?.publishRun(await this.repository.getRunOrThrow(run.id, tenantId));
  }

  private toStepDto(step: ExecutionStepEntity): ExecutionStepDto {
    return { ...step };
  }

  private async waitForStageInterval(step: ExecutionStepEntity, run: ExecutionRunEntity, tenantId?: string): Promise<void> {
    if (run.type === 'rollback' || this.stageIntervalMs === 0) return;
    const dependencyNumbers = step.dependsOn ?? [];
    if (dependencyNumbers.length === 0) return;
    const steps = await this.repository.listSteps(tenantId, step.executionRunId);
    const dependencies = steps.filter((candidate) => dependencyNumbers.includes(candidate.stepNo));
    const latestFinishedAt = dependencies.reduce<number | undefined>((latest, dependency) => {
      if (!dependency.finishedAt) return latest;
      const timestamp = Date.parse(dependency.finishedAt);
      if (!Number.isFinite(timestamp)) return latest;
      return latest === undefined ? timestamp : Math.max(latest, timestamp);
    }, undefined);
    if (latestFinishedAt === undefined) return;
    const remaining = this.stageIntervalMs - Math.max(0, Date.now() - latestFinishedAt);
    if (remaining > 0) await this.delay(remaining);
  }

  private async materializeRuntimeStep(
    step: ExecutionStepEntity,
    tenantId: string | undefined,
  ): Promise<ExecutionStepEntity> {
    const executionRuntimeSnapshot = readExecutionRuntimeSnapshot(step.inputSnapshot.executionRuntimeSnapshot);
    if (executionRuntimeSnapshot) {
      return {
        ...step,
        inputSnapshot: {
          ...step.inputSnapshot,
          resolvedDeploymentInput: executionRuntimeSnapshot.resolvedDeploymentInput,
          deploymentArtifact: executionRuntimeSnapshot.deploymentArtifact,
        },
      };
    }
    const executorType = readString(step.inputSnapshot.executorType);
    if (executorType === 'MOCK' && !step.inputSnapshot.deploymentInputSnapshotRef) return step;
    const ref = readDeploymentInputSnapshotRef(step.inputSnapshot.deploymentInputSnapshotRef, {
      executionStepId: step.id,
      deploymentPlanTargetId: step.deploymentPlanTargetId,
    });
    const snapshotId = ref.snapshotId;
    if (!tenantId || !this.deploymentInputSnapshots) {
      throw new AppError('SYSTEM_INTERNAL_ERROR', '执行步骤无法读取部署输入密封运行材料', {
        code: 'DEPLOYMENT_INPUT_RUNTIME_SNAPSHOT_REPOSITORY_MISSING',
        executionStepId: step.id,
        snapshotId,
      });
    }
    const auditSnapshot = await this.deploymentInputSnapshots.get(tenantId, snapshotId);
    const deploymentPlanId = readString(step.inputSnapshot.deploymentPlanId);
    if (!auditSnapshot
      || auditSnapshot.deploymentPlanId !== deploymentPlanId
      || auditSnapshot.deploymentPlanTargetId !== step.deploymentPlanTargetId
      || auditSnapshot.revision !== ref.revision
      || auditSnapshot.snapshot.resolvedSha256 !== ref.resolvedSha256) {
      throw new AppError('VALIDATION_FAILED', '执行步骤引用的部署输入快照身份不匹配', {
        code: 'DEPLOYMENT_INPUT_RUNTIME_SNAPSHOT_INVALID',
        executionStepId: step.id,
        snapshotId,
      });
    }
    const runtimeSnapshot = await this.deploymentInputSnapshots.getRuntimeSnapshot(tenantId, snapshotId);
    if (!runtimeSnapshot) {
      throw new AppError('VALIDATION_FAILED', '执行步骤引用的部署输入密封运行材料不存在', {
        code: 'DEPLOYMENT_INPUT_RUNTIME_SNAPSHOT_INVALID',
        executionStepId: step.id,
        snapshotId,
      });
    }
    if (ref.resolvedSha256 !== runtimeSnapshot.resolvedDeploymentInput.resolvedSha256) {
      throw new AppError('VALIDATION_FAILED', '执行步骤引用的部署输入摘要不匹配', {
        code: 'DEPLOYMENT_INPUT_RUNTIME_SNAPSHOT_INVALID',
        executionStepId: step.id,
        snapshotId,
      });
    }
    return {
      ...step,
      inputSnapshot: {
        ...step.inputSnapshot,
        resolvedDeploymentInput: runtimeSnapshot.resolvedDeploymentInput,
        deploymentArtifact: runtimeSnapshot.deploymentArtifact,
      },
    };
  }

  private readRunFailurePolicy(run: ExecutionRunEntity): FailurePolicy {
    const value = String(run.summary.failurePolicy ?? 'stop');
    return value === 'continue' || value === 'rollback' ? value : 'stop';
  }
}

function taskTypeForExecutionRun(type: CreateExecutionRunInput['type']): 'CERTIFICATE_DRY_RUN' | 'CERTIFICATE_DEPLOY' | 'CERTIFICATE_ROLLBACK' {
  if (type === 'dry_run') return 'CERTIFICATE_DRY_RUN';
  if (type === 'rollback') return 'CERTIFICATE_ROLLBACK';
  return 'CERTIFICATE_DEPLOY';
}

function readRetryBackoff(summary: Record<string, unknown>): number | undefined {
  const retry = summary.retry;
  if (!retry || typeof retry !== 'object' || Array.isArray(retry)) return undefined;
  const backoff = (retry as { backoffSeconds?: unknown }).backoffSeconds;
  return typeof backoff === 'number' ? backoff : undefined;
}

function mapStepTypeToOperation(stepType: 'DISCOVER' | 'BACKUP' | 'INSTALL' | 'RELOAD' | 'VERIFY' | 'ROLLBACK' | 'CUSTOM'): string {
  switch (stepType) {
    case 'DISCOVER':
      return 'prepare';
    case 'BACKUP':
      return 'backup';
    case 'INSTALL':
      return 'install';
    case 'RELOAD':
      return 'reload';
    case 'VERIFY':
      return 'verify';
    case 'ROLLBACK':
      return 'rollback';
    case 'CUSTOM':
      return 'workflow';
    default:
      return 'install';
  }
}

function resolveStepExecutorType(baseExecutorType: string, stepType: string, payload: Record<string, unknown>, gatewayRoute?: Record<string, unknown>): string {
  if (baseExecutorType === 'MOCK') return 'MOCK';
  if (stepType === 'VERIFY') {
    return readString(gatewayRoute?.agentId)
      ? 'GATEWAY_FORWARD'
      : 'CONTROL_PLANE_TLS';
  }
  if (stepType === 'DISCOVER') return 'PLATFORM_STAGE';
  const runtime = readString(payload.pluginRuntimeCapability, 'runtime');
  const monolithicUpdate = baseExecutorType === 'WORKFLOW' || runtime === 'TRUSTED_JS';
  if (monolithicUpdate && (stepType === 'BACKUP' || stepType === 'RELOAD')) return 'PLATFORM_STAGE';
  return baseExecutorType;
}

function persistentExecutionPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const executionRuntimeSnapshot = readRecord(payload.executionRuntimeSnapshot);
  return {
    ...sanitizeDeploymentInputPersistencePayload(payload),
    ...(executionRuntimeSnapshot ? { executionRuntimeSnapshot: structuredClone(executionRuntimeSnapshot) } : {}),
  };
}

function readExecutionRuntimeSnapshot(value: unknown): {
  resolvedDeploymentInput: Record<string, unknown>;
  deploymentArtifact: Record<string, unknown>;
} | undefined {
  const snapshot = readRecord(value);
  const resolvedDeploymentInput = readRecord(snapshot?.resolvedDeploymentInput);
  const deploymentArtifact = readRecord(snapshot?.deploymentArtifact);
  if (snapshot?.apiVersion !== 'gcac.deployment-input-runtime-snapshot/v1'
    || resolvedDeploymentInput?.apiVersion !== 'gcac.resolved-deployment-input/v1'
    || !deploymentArtifact) {
    return undefined;
  }
  return { resolvedDeploymentInput, deploymentArtifact };
}

function readDeploymentInputSnapshotRef(
  value: unknown,
  detail: Record<string, unknown>,
): { snapshotId: string; revision: number; resolvedSha256: string } {
  const ref = readRecord(value);
  const snapshotId = readString(ref?.snapshotId);
  const resolvedSha256 = readString(ref?.resolvedSha256);
  if (ref?.apiVersion !== 'gcac.deployment-input-snapshot/v1'
    || !snapshotId
    || !Number.isInteger(ref.revision)
    || Number(ref.revision) < 1
    || !resolvedSha256) {
    throw new AppError('VALIDATION_FAILED', '执行步骤缺少有效的部署输入快照引用', {
      code: 'DEPLOYMENT_INPUT_RUNTIME_SNAPSHOT_INVALID',
      ...detail,
    });
  }
  return { snapshotId, revision: Number(ref.revision), resolvedSha256 };
}

function readCertificateTrustPlan(value: unknown): {
  decision: 'skip' | 'install';
  actionType: 'certificate.trust.install';
  actionSchemaVersion: '1.0';
  agentId: string;
  fingerprintSha256: string;
  certificatePem: string;
  store: 'root';
} | undefined {
  const plan = readRecord(value);
  const decision = readString(plan, 'decision');
  const actionType = readString(plan, 'actionType');
  const actionSchemaVersion = readString(plan, 'actionSchemaVersion');
  const agentId = readString(plan, 'agentId');
  const fingerprintSha256 = readString(plan, 'fingerprintSha256');
  const certificatePem = readString(plan, 'certificatePem');
  const store = readString(plan, 'store');
  if ((decision !== 'skip' && decision !== 'install')
    || actionType !== 'certificate.trust.install'
    || actionSchemaVersion !== '1.0'
    || !agentId
    || !fingerprintSha256
    || !certificatePem
    || store !== 'root') {
    return undefined;
  }
  return {
    decision,
    actionType,
    actionSchemaVersion: '1.0',
    agentId,
    fingerprintSha256,
    certificatePem,
    store: 'root',
  };
}

function readSourceExecutorTypes(
  payloadByTargetId: Map<string, Record<string, unknown>>,
): Map<string, string> {
  return new Map([...payloadByTargetId].map(([targetId, payload]) => {
    const executorType = readString(payload.deploymentExecutorType);
    if (!executorType) {
      throw new AppError('VALIDATION_FAILED', '源执行步骤缺少不可变执行器类型，无法重试或回滚', {
        code: 'DEPLOYMENT_INPUT_RUNTIME_SNAPSHOT_INVALID',
        deploymentPlanTargetId: targetId,
      });
    }
    return [targetId, executorType] as const;
  }));
}

function readSourceGatewayRoutes(
  payloadByTargetId: Map<string, Record<string, unknown>>,
): Map<string, DeploymentGatewayRouteDto | undefined> {
  return new Map([...payloadByTargetId].map(([targetId, payload]) => [
    targetId,
    structuredClone(payload.gatewayRoute) as DeploymentGatewayRouteDto | undefined,
  ]));
}

function shouldSyncExecutorResult(executorType: string, runType: ExecutionRunEntity['type']): boolean {
  if (runType === 'dry_run') return false;
  if (executorType === 'CONTROL_PLANE_TLS') return true;
  return executorType === 'WORKFLOW' || executorType === 'TRUSTED_JS';
}

function resolveExecutionStatus(
  result: { success: boolean; errorCode?: string; errorMessage?: string; detail?: Record<string, unknown> },
  step: ExecutionStepEntity,
): AgentSecurityStatus {
  const detail = result.detail ?? {};
  const error = readRecord(detail.error);
  const candidates = [
    (result as { status?: unknown }).status,
    detail.executionStatus,
    detail.status,
    readRecord(detail.receipt)?.status,
  ];
  const explicit = candidates.find((value): value is AgentSecurityStatus =>
    value === 'SUCCESS' || value === 'FAILED' || value === 'UNKNOWN' || value === 'CANCELLED');
  if (explicit === 'UNKNOWN' || explicit === 'CANCELLED') return 'UNKNOWN';
  if (explicit) return explicit;
  const actionType = readString(step.inputSnapshot.actionType)?.toLowerCase();
  const plan = readRecord(step.inputSnapshot.plan);
  const writeEffect = step.inputSnapshot.writeEffect === true || plan?.writeEffect === true || actionType === 'agent.plan.execute';
  const uncertaintyCode = `${result.errorCode ?? ''} ${result.errorMessage ?? ''}`.toLowerCase();
  if (detail.mayBeUnknown === true || error?.mayBeUnknown === true || result.errorCode === 'PLUGIN_OPERATION_UNKNOWN_STATE'
    || (writeEffect && /(timeout|timed out|crash|cancel|late|unknown|connection lost|disconnected)/i.test(uncertaintyCode))) {
    return 'UNKNOWN';
  }
  return result.success ? 'SUCCESS' : 'FAILED';
}

function isPotentiallyUnknownWriteStep(step: ExecutionStepEntity): boolean {
  const actionType = readString(step.inputSnapshot.actionType)?.toLowerCase();
  const plan = readRecord(step.inputSnapshot.plan);
  return step.inputSnapshot.writeEffect === true || plan?.writeEffect === true || actionType === 'agent.plan.execute';
}

function isTerminalRunStatus(status: ExecutionRunEntity['status']): boolean {
  return ['SUCCESS', 'FAILED', 'TIMEOUT', 'ROLLBACK_SUCCESS', 'ROLLBACK_FAILED'].includes(status);
}

function buildRollbackContextFromSourceSteps(sourceRunId: string, sourceSteps: ExecutionStepEntity[], targetId: string): Record<string, unknown> {
  const steps = sourceSteps.filter((step) => step.deploymentPlanTargetId === targetId);
  const firstPayload = readRecord(steps[0]?.inputSnapshot) ?? {};
  const firstDetail = readRecord(firstPayload.resultDetail);
  const installStep = steps.find((step) => step.stepType === 'INSTALL');
  const backupStep = steps.find((step) => step.stepType === 'BACKUP');
  const installDetail = readRecord(installStep?.inputSnapshot?.resultDetail);
  const backupDetail = readRecord(backupStep?.inputSnapshot?.resultDetail);
  return {
    sourceRunId,
    sourceStepId: installStep?.id ?? backupStep?.id,
    backupManifestPath: readString(installDetail?.backupManifestPath)
      ?? readString(backupDetail?.backupManifestPath)
      ?? readString(firstDetail?.backupManifestPath),
    backupManifest: readRecord(installDetail?.backupManifest)
      ?? readRecord(backupDetail?.backupManifest)
      ?? readRecord(firstDetail?.backupManifest),
    rollbackCertificateSha256: readString(readRecord(readRecord(installDetail?.backupManifest)?.certBackup), 'certificateFingerprintSha256')
      ?? readString(readRecord(readRecord(backupDetail?.backupManifest)?.certBackup), 'certificateFingerprintSha256')
      ?? readString(readRecord(readRecord(firstDetail?.backupManifest)?.certBackup), 'certificateFingerprintSha256'),
    installedCertificateSha256: readString(installDetail?.installedCertificateSha256)
      ?? readString(firstDetail?.installedCertificateSha256),
    checkpoint: readRecord(installDetail?.checkpoint)
      ?? readRecord(backupDetail?.checkpoint)
      ?? readRecord(firstDetail?.checkpoint),
  };
}

function buildWorkflowStepOutputsFromSourceSteps(
  sourceSteps: ExecutionStepEntity[],
  targetId: string,
): Record<string, unknown> | undefined {
  const outputs: Record<string, unknown> = {};
  for (const step of sourceSteps) {
    if (step.deploymentPlanTargetId !== targetId) continue;
    const detail = readRecord(step.inputSnapshot.resultDetail);
    const workflowRun = readRecord(detail?.workflowRun);
    const stepResults = Array.isArray(workflowRun?.stepResults) ? workflowRun.stepResults : [];
    for (const item of stepResults) {
      const result = readRecord(item);
      if (!result) continue;
      const name = readString(result.name);
      const extracted = readRecord(result.extracted);
      if (!name || !extracted || Object.keys(extracted).length === 0) continue;
      outputs[name] = { extracted: structuredClone(extracted) };
    }
  }
  return Object.keys(outputs).length > 0 ? outputs : undefined;
}

function readExecutionSource(value: unknown): ExecutionSourceDto | undefined {
  const source = readRecord(value);
  const type = readString(source, 'type');
  if (type !== 'automation' && type !== 'deployment_plan') return undefined;
  const automationRunId = readString(source, 'automationRunId');
  const automationId = readString(source, 'automationId');
  const approvalId = readString(source, 'approvalId');
  return {
    type,
    ...(automationRunId ? { automationRunId } : {}),
    ...(automationId ? { automationId } : {}),
    ...(approvalId ? { approvalId } : {}),
  };
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readString(value: unknown, key?: string): string | undefined {
  const target = key ? readRecord(value)?.[key] : value;
  return typeof target === 'string' && target.trim() ? target.trim() : undefined;
}
