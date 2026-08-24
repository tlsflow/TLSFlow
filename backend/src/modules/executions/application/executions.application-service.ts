import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { AUDIT_EVENT_TYPES } from '../../audits/audit-event-types.js';
import { AuditService } from '../../audits/audit.service.js';
import type { DeploymentPlansRepository } from '../../deployment-plans/repository/deployment-plans.repository.js';
import { PgJobRunner } from '../../../queue/pg-job-runner.js';
import type { QueuePort } from '../../../queue/queue-port.js';
import { newId } from '../../../shared/id.js';
import { assertTransition } from '../../../shared/state-machine/core-state-machine.js';
import type { RequestContext } from '../../../shared/security-types.js';
import type { StateTransitionEventEntity } from '../../deployment-plans/schema/deployment-plans.schema.js';
import type { CreateExecutionRunInput, DeploymentArtifactSnapshotDto, ExecutionRunDto, ExecutionStepDto, RetryExecutionRunInput, RollbackExecutionRunInput } from '../dto/executions.dto.js';
import { ExecutionsDomainService } from '../domain/executions.domain-service.js';
import { ExecutionsRepository } from '../repository/executions.repository.js';
import type { ExecutionRunEntity, ExecutionStepEntity } from '../schema/executions.schema.js';
import { ExecutorRegistry } from './executors.js';
import type { ExecutionResultSyncService } from './execution-result-sync.service.js';
import { FailurePolicyEngine } from './failure-policy-engine.js';
import { ExecutionDetailStreamService } from './execution-detail-stream.service.js';
import { RunRecoveryWorker } from './run-recovery-worker.js';
import { Scheduler } from './scheduler.js';
import { StepRunner } from './step-runner.js';
import { StepGraphBuilder } from './step-graph-builder.js';

type FailurePolicy = 'stop' | 'continue' | 'rollback';

export interface ExecutionsApplicationDependencies {
  repository?: ExecutionsRepository;
  deploymentPlansRepository: DeploymentPlansRepository;
  queue?: QueuePort;
  queueDb?: DatabasePort;
  audit?: AuditService;
  domain?: ExecutionsDomainService;
  executorRegistry?: ExecutorRegistry;
  resultSync?: ExecutionResultSyncService;
  detailStream?: ExecutionDetailStreamService;
}

export class ExecutionsApplicationService {
  private readonly repository: ExecutionsRepository;
  private readonly deploymentPlansRepository: DeploymentPlansRepository;
  private readonly queue: QueuePort;
  private readonly audit: AuditService;
  private readonly domain: ExecutionsDomainService;
  private readonly graphBuilder: StepGraphBuilder;
  private readonly scheduler: Scheduler;
  private readonly failurePolicy: FailurePolicyEngine;
  private readonly recoveryWorker: RunRecoveryWorker;
  private readonly executorRegistry: ExecutorRegistry;
  private readonly resultSync?: ExecutionResultSyncService;
  private readonly detailStream?: ExecutionDetailStreamService;

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
    this.queue = dependencies.queue ?? new PgJobRunner(
      (job) => new StepRunner(this, this.executorRegistry).run(job),
      dependencies.queueDb,
      ['DEPLOYMENT_EXECUTE'],
    );
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
    if (!['FAILED', 'TIMEOUT', 'CANCELLED'].includes(sourceRun.status)) {
      throw new AppError('DEPLOYMENT_INVALID_STATE', '只有失败、超时或取消的运行允许重试', { runId: sourceRun.id, status: sourceRun.status });
    }
    const sourceSteps = await this.repository.listSteps(input.tenantId, sourceRun.id);
    const targetIds = sourceSteps
      .map((step) => step.deploymentPlanTargetId)
      .filter((id): id is string => Boolean(id));
    const uniqueTargetIds = [...new Set(targetIds)];
    const sourcePayloadByTargetId = new Map<string, Record<string, unknown>>();
    const sourceArtifactByTargetId = new Map<string, DeploymentArtifactSnapshotDto>();
    for (const step of sourceSteps) {
      const targetId = step.deploymentPlanTargetId;
      if (!targetId) continue;
      if (!sourcePayloadByTargetId.has(targetId)) sourcePayloadByTargetId.set(targetId, step.inputSnapshot);
      if (!sourceArtifactByTargetId.has(targetId) && isDeploymentArtifactSnapshot(step.inputSnapshot.deploymentArtifact)) {
        sourceArtifactByTargetId.set(targetId, step.inputSnapshot.deploymentArtifact);
      }
    }
    const executorTypeByTargetId = new Map(await Promise.all(uniqueTargetIds.map(async (targetId) => {
      const target = await this.deploymentPlansRepository.getTarget(targetId, input.tenantId);
      return [targetId, target?.executorType ?? 'AGENT'] as const;
    })));
    const gatewayRouteByTargetId = new Map(await Promise.all(uniqueTargetIds.map(async (targetId) => {
      const target = await this.deploymentPlansRepository.getTarget(targetId, input.tenantId);
      return [targetId, target?.gatewayRoute] as const;
    })));
    return this.createRunAndEnqueue({
      deploymentPlanId: sourceRun.deploymentPlanId,
      deploymentPlanTargetIds: uniqueTargetIds,
      type: 'apply',
      idempotencyKey: input.idempotencyKey,
      actorId: input.actorId,
      tenantId: input.tenantId,
      executorTypeByTargetId,
      gatewayRouteByTargetId,
      deploymentArtifactByTargetId: sourceArtifactByTargetId,
      agentPayloadByTargetId: sourcePayloadByTargetId,
    }, context);
  }

  async rollback(input: RollbackExecutionRunInput, context: RequestContext = {}): Promise<any> {
    const sourceRun = await this.repository.getRunOrThrow(input.runId, input.tenantId);
    this.domain.assertRollbackAllowed(sourceRun);

    const transitioned = await this.transitionRunEntity(sourceRun, 'ROLLBACK_RUNNING', input.actorId, 'rollback.requested');
    void this.audit.write({
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
    }).catch(() => undefined);

    const sourceSteps = await this.repository.listSteps(input.tenantId, sourceRun.id);
    const targetIds = [...new Set(sourceSteps.map((step) => step.deploymentPlanTargetId).filter((id): id is string => Boolean(id)))];
    if (!sourceSteps.length || !targetIds.length) {
      throw new AppError('VALIDATION_FAILED', '回滚缺少源步骤或目标，不能静默创建空回滚，请人工介入', { runId: sourceRun.id, sourceStepCount: sourceSteps.length, targetCount: targetIds.length });
    }
    const executorTypeByTargetId = new Map(await Promise.all(targetIds.map(async (targetId) => {
      const target = await this.deploymentPlansRepository.getTarget(targetId, input.tenantId);
      return [targetId, target?.executorType ?? 'AGENT'] as const;
    })));
    const gatewayRouteByTargetId = new Map(await Promise.all(targetIds.map(async (targetId) => {
      const target = await this.deploymentPlansRepository.getTarget(targetId, input.tenantId);
      return [targetId, target?.gatewayRoute] as const;
    })));
    const sourcePayloadByTargetId = new Map<string, Record<string, unknown>>();
    const sourceArtifactByTargetId = new Map<string, DeploymentArtifactSnapshotDto>();
    for (const step of sourceSteps) {
      const targetId = step.deploymentPlanTargetId;
      if (!targetId) continue;
      if (!sourcePayloadByTargetId.has(targetId)) {
        const basePayload = readRecord(step.inputSnapshot) ?? {};
        const rollbackContext = buildRollbackContextFromSourceSteps(sourceRun.id, sourceSteps, targetId);
        const rollbackCertificateSha256 = readString(rollbackContext, 'rollbackCertificateSha256');
        const baseArtifact = readRecord(basePayload.artifact);
        sourcePayloadByTargetId.set(targetId, {
          ...basePayload,
          ...(rollbackCertificateSha256
            ? {
                expectedCertificateFingerprintSha256: rollbackCertificateSha256,
                artifact: {
                  ...(baseArtifact ?? {}),
                  targetFingerprintSha256: rollbackCertificateSha256,
                },
              }
            : {}),
          sourceRunId: sourceRun.id,
          rollbackContext,
        });
      }
      if (!sourceArtifactByTargetId.has(targetId) && isDeploymentArtifactSnapshot(step.inputSnapshot.deploymentArtifact)) {
        sourceArtifactByTargetId.set(targetId, step.inputSnapshot.deploymentArtifact);
      }
    }
    const created = await this.createRunAndEnqueue({
      deploymentPlanId: sourceRun.deploymentPlanId,
      deploymentPlanTargetIds: targetIds,
      type: 'rollback',
      idempotencyKey: input.idempotencyKey,
      actorId: input.actorId,
      tenantId: input.tenantId,
      executorTypeByTargetId,
      gatewayRouteByTargetId,
      deploymentArtifactByTargetId: sourceArtifactByTargetId,
      agentPayloadByTargetId: sourcePayloadByTargetId,
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
      }
    }
    return this.toRunDto(await this.transitionRunEntity(run, 'CANCELLED', actorId, 'run.cancelled'));
  }

  async runDispatchedExecution(runId: string, actorId: string, tenantId: string | undefined, registry: ExecutorRegistry = this.executorRegistry): Promise<any> {
    let run = await this.repository.getRunOrThrow(runId, tenantId);
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
    const results: Array<{ run: ExecutionRunDto; result: { success: boolean; recovered: boolean; skippedStepIds: string[] } }> = [];
    for (const candidate of candidates) {
      for (const step of candidate.stepsToResume) {
        if (step.status === 'RUNNING' && step.idempotent !== false) {
          await this.repository.updateStep(step.id, {
            status: 'PENDING',
            updatedAt: new Date().toISOString(),
            updatedBy: actorId,
          });
          this.recordTransition('executionStep', step.id, 'RUNNING', 'PENDING', 'recovery.requeued', actorId, step.tenantId);
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
          this.recordTransition('executionStep', step.id, 'RUNNING', 'SKIPPED', 'recovery.non_idempotent_skipped', actorId, step.tenantId);
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
        result: { success: executionResult.success, recovered: true, skippedStepIds: candidate.skippedStepIds },
      });
    }
    return results;
  }

  async runNextJobForTest() {
    return this.queue.runNext();
  }

  async runNextQueuedJob() {
    return this.queue.runNext();
  }

  private async createRunAndEnqueue(input: CreateExecutionRunInput, context: RequestContext): Promise<{ run: ExecutionRunDto; steps: ExecutionStepDto[]; jobId: string }> {
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
      },
      createdAt: now,
      updatedAt: now,
      createdBy: input.actorId,
      version: 1,
    });
    this.recordTransition('executionRun', run.id, undefined, 'PENDING', 'run.created', input.actorId, input.tenantId);

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
      input.deploymentArtifactByTargetId,
      input.agentPayloadByTargetId,
    );
    const job = await this.queue.enqueue({
      jobType: 'DEPLOYMENT_EXECUTE',
      resourceType: 'executionRun',
      resourceId: run.id,
      idempotencyKey: input.idempotencyKey,
      payload: { runId: run.id, deploymentPlanId: input.deploymentPlanId, type: input.type, tenantId: input.tenantId, actorId: input.actorId },
      retryPolicy: { maxAttempts: 1, backoffSeconds: 0 },
    });
    const dispatched = await this.transitionRunEntity({ ...run, externalRunId: job.jobId }, 'DISPATCHED', input.actorId, 'queue.dispatched', { externalRunId: job.jobId });

    void this.audit.write({
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
      detail: { deploymentPlanId: input.deploymentPlanId, jobId: job.jobId, stepCount: steps.length },
    }).catch(() => undefined);

    return { run: this.toRunDto(dispatched), steps: steps.map((step) => this.toStepDto(step)), jobId: job.jobId };
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
    deploymentArtifactByTargetId?: Map<string, DeploymentArtifactSnapshotDto>,
    agentPayloadByTargetId?: Map<string, Record<string, unknown>>,
  ): Promise<ExecutionStepEntity[]> {
    const defaultStepTypes = run.type === 'rollback' ? ['ROLLBACK', 'VERIFY'] as const : run.type === 'dry_run' ? ['DISCOVER', 'VERIFY'] as const : ['BACKUP', 'INSTALL', 'RELOAD', 'VERIFY'] as const;
    const created: ExecutionStepEntity[] = [];
    let stepNo = 1;
    for (const targetId of targetIds) {
      let previousStepNo: number | undefined;
      const targetExecutorType = executorTypeByTargetId.get(targetId);
      const stepTypes = targetExecutorType === 'WORKFLOW' ? ['CUSTOM'] as const : defaultStepTypes;
      for (const stepType of stepTypes) {
        const now = new Date().toISOString();
	        const baseExecutorType = targetExecutorType;
	        if (!baseExecutorType) {
	          throw new AppError('VALIDATION_FAILED', '部署目标缺少执行器类型，拒绝使用 MockExecutor 兜底', { targetId });
	        }
	        if (baseExecutorType === 'MOCK' && !allowMockExecutor) {
	          throw new AppError('VALIDATION_FAILED', 'MockExecutor 只能在测试或显式允许时使用', { targetId });
	        }
	        const gatewayRoute = this.readGatewayRoute(gatewayRouteByTargetId?.get(targetId));
	        const deploymentArtifact = deploymentArtifactByTargetId?.get(targetId);
	        const agentPayload = agentPayloadByTargetId?.get(targetId) ?? {};
	        const executorType = resolveStepExecutorType(baseExecutorType, stepType, agentPayload);
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
              certificateBindingId: planTarget?.certificateBindingId,
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
            deploymentArtifact,
            retryBackoffSeconds: readRetryBackoff(run.summary),
          },
          status: 'PENDING',
          createdAt: now,
          updatedAt: now,
          createdBy: actorId,
          version: 1,
        });
        this.recordTransition('executionStep', step.id, undefined, 'PENDING', 'step.created', actorId, run.tenantId);
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
      gatewayAgentId: typeof route.gatewayAgentId === 'string' ? route.gatewayAgentId : undefined,
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
    this.recordTransition('deploymentPlan', plan.id, plan.status, nextStatus, event, actorId, plan.tenantId);
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
    this.recordTransition('executionStep', step.id, step.status, nextStatus, event, actorId, step.tenantId);
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
    this.recordTransition('executionRun', run.id, run.status, nextStatus, event, actorId, run.tenantId);
    this.detailStream?.publishRun(updated);
    return updated;
  }

  private recordTransition(entityType: StateTransitionEventEntity['entityType'], entityId: string, fromStatus: string | undefined, toStatus: string, event: string, actorId: string, tenantId?: string): void {
    void this.deploymentPlansRepository.createTransition({
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
    const current = await this.repository.getStepOrThrow(stepId, tenantId);
    if (current.status !== 'PENDING') {
      return { success: true, deploymentPlanTargetId: current.deploymentPlanTargetId };
    }
    const runningStep = await this.transitionStepEntity(current, 'RUNNING', actorId, 'step.started', {
      attemptCount: current.attemptCount + 1,
    });
    const executorType = String(runningStep.inputSnapshot.executorType ?? 'MOCK');
    let result;
    try {
      result = await registry.get(executorType).executeStep({
        step: runningStep,
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
    if (result.success && result.asyncPending) {
      await this.repository.updateStep(runningStep.id, {
        inputSnapshot: {
          ...runningStep.inputSnapshot,
          dispatchDetail: result.detail,
        },
        updatedAt: new Date().toISOString(),
        updatedBy: actorId,
      });
      this.detailStream?.publishStep(await this.repository.getStepOrThrow(runningStep.id, tenantId));
      return { success: true, asyncPending: true, deploymentPlanTargetId: runningStep.deploymentPlanTargetId };
    }
    if (this.resultSync && shouldSyncExecutorResult(executorType, run.type)) {
      await this.resultSync.applyAgentTaskResult({
        tenantId: tenantId ?? runningStep.tenantId ?? '',
        executionRunId: runningStep.executionRunId,
        executionStepId: runningStep.id,
        success: result.success,
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
      });
      this.recordTransition('executionStep', runningStep.id, 'RUNNING', 'PENDING', 'step.retrying', actorId, runningStep.tenantId);
      this.detailStream?.publishStep(await this.repository.getStepOrThrow(runningStep.id, tenantId));
      return { success: true, deploymentPlanTargetId: runningStep.deploymentPlanTargetId };
    }

    const terminalStatus = decision.category === 'timeout' ? 'TIMEOUT' : 'FAILED';
    await this.transitionStepEntity(runningStep, terminalStatus, actorId, 'step.failed', {
      lastFailureCategory: decision.category,
      lastErrorCode: result.errorCode,
      lastErrorMessage: result.errorMessage,
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
    return { ...run };
  }

  private toStepDto(step: ExecutionStepEntity): ExecutionStepDto {
    return { ...step };
  }

  private readRunFailurePolicy(run: ExecutionRunEntity): FailurePolicy {
    const value = String(run.summary.failurePolicy ?? 'stop');
    return value === 'continue' || value === 'rollback' ? value : 'stop';
  }
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
      return 'dryRun';
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

function resolveStepExecutorType(baseExecutorType: string, stepType: string, payload: Record<string, unknown>): string {
  const providerType = typeof payload.providerType === 'string' ? payload.providerType.toUpperCase() : undefined;
  if (providerType === 'NGINX' && stepType === 'VERIFY') return 'CONTROL_PLANE_TLS';
  return baseExecutorType;
}

function shouldSyncExecutorResult(executorType: string, runType: ExecutionRunEntity['type']): boolean {
  if (executorType === 'CONTROL_PLANE_TLS') return true;
  return executorType === 'WORKFLOW' && runType !== 'dry_run';
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
  };
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readString(value: unknown, key?: string): string | undefined {
  const target = key ? readRecord(value)?.[key] : value;
  return typeof target === 'string' && target.trim() ? target.trim() : undefined;
}

function isDeploymentArtifactSnapshot(value: unknown): value is DeploymentArtifactSnapshotDto {
  const record = readRecord(value);
  return Boolean(record
    && typeof record.certificateVersionId === 'string'
    && typeof record.certificateFormatId === 'string'
    && typeof record.format === 'string'
    && typeof record.containsPrivateKey === 'boolean');
}
