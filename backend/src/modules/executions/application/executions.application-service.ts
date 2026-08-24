import { AppError } from '../../../common/errors/app-error.js';
import { AUDIT_EVENT_TYPES } from '../../audits/audit-event-types.js';
import { AuditService } from '../../audits/audit.service.js';
import type { DeploymentPlansRepository } from '../../deployment-plans/repository/deployment-plans.repository.js';
import { InMemoryJobRunner } from '../../../queue/in-memory-job-runner.js';
import type { QueuePort } from '../../../queue/queue-port.js';
import { newId } from '../../../shared/id.js';
import type { RequestContext } from '../../../shared/security-types.js';
import type { StateTransitionEventEntity } from '../../deployment-plans/schema/deployment-plans.schema.js';
import type { CreateExecutionRunInput, ExecutionRunDto, ExecutionStepDto, RetryExecutionRunInput, RollbackExecutionRunInput } from '../dto/executions.dto.js';
import { ExecutionsDomainService } from '../domain/executions.domain-service.js';
import { ExecutionsRepository } from '../repository/executions.repository.js';
import type { ExecutionRunEntity, ExecutionStepEntity } from '../schema/executions.schema.js';
import { ExecutorRegistry } from './executors.js';
import { FailurePolicyEngine } from './failure-policy-engine.js';
import { RunRecoveryWorker } from './run-recovery-worker.js';
import { Scheduler } from './scheduler.js';
import { StepRunner } from './step-runner.js';
import { StepGraphBuilder } from './step-graph-builder.js';

export interface ExecutionsApplicationDependencies {
  repository?: ExecutionsRepository;
  deploymentPlansRepository: DeploymentPlansRepository;
  queue?: QueuePort;
  audit?: AuditService;
  domain?: ExecutionsDomainService;
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

  constructor(dependencies: ExecutionsApplicationDependencies) {
    this.repository = dependencies.repository ?? new ExecutionsRepository();
    this.deploymentPlansRepository = dependencies.deploymentPlansRepository;
    this.audit = dependencies.audit ?? new AuditService();
    this.domain = dependencies.domain ?? new ExecutionsDomainService();
    this.graphBuilder = new StepGraphBuilder();
    this.scheduler = new Scheduler(this.graphBuilder);
    this.failurePolicy = new FailurePolicyEngine();
    this.recoveryWorker = new RunRecoveryWorker(this.repository);
    this.queue = dependencies.queue ?? new InMemoryJobRunner((job) => new StepRunner(this).run(job));
  }

  listRuns(input: { tenantId?: string; deploymentPlanId?: string } = {}): ExecutionRunDto[] {
    return this.repository.listRuns(input.tenantId, input.deploymentPlanId).map((run) => this.toRunDto(run));
  }

  listSteps(input: { tenantId?: string; executionRunId?: string } = {}): ExecutionStepDto[] {
    return this.repository.listSteps(input.tenantId, input.executionRunId).map((step) => this.toStepDto(step));
  }

  getRun(id: string, tenantId?: string): ExecutionRunDto {
    return this.toRunDto(this.repository.getRunOrThrow(id, tenantId));
  }

  getRepository(): ExecutionsRepository {
    return this.repository;
  }

  getStep(id: string, tenantId?: string): ExecutionStepDto {
    return this.toStepDto(this.repository.getStepOrThrow(id, tenantId));
  }

  async createApplyRun(input: CreateExecutionRunInput, context: RequestContext = {}): Promise<{ run: ExecutionRunDto; steps: ExecutionStepDto[]; jobId: string }> {
    return this.createRunAndEnqueue(input, context);
  }

  async createDryRun(input: CreateExecutionRunInput, context: RequestContext = {}): Promise<{ run: ExecutionRunDto; steps: ExecutionStepDto[]; jobId: string }> {
    return this.createRunAndEnqueue({ ...input, type: 'dry_run' }, context);
  }

  async retry(input: RetryExecutionRunInput, context: RequestContext = {}): Promise<{ run: ExecutionRunDto; steps: ExecutionStepDto[]; jobId: string }> {
    const sourceRun = this.repository.getRunOrThrow(input.runId, input.tenantId);
    if (!['FAILED', 'TIMEOUT', 'CANCELLED'].includes(sourceRun.status)) {
      throw new AppError('DEPLOYMENT_INVALID_STATE', '只有失败、超时或取消的运行允许重试', { runId: sourceRun.id, status: sourceRun.status });
    }
    const targetIds = this.repository.listSteps(input.tenantId, sourceRun.id)
      .map((step) => step.deploymentPlanTargetId)
      .filter((id): id is string => Boolean(id));
    const uniqueTargetIds = [...new Set(targetIds)];
    const executorTypeByTargetId = new Map(uniqueTargetIds.map((targetId) => {
      const target = this.deploymentPlansRepository.getTarget(targetId, input.tenantId);
      return [targetId, target?.executorType ?? 'AGENT'] as const;
    }));
    return this.createRunAndEnqueue({
      deploymentPlanId: sourceRun.deploymentPlanId,
      deploymentPlanTargetIds: uniqueTargetIds,
      type: 'apply',
      idempotencyKey: input.idempotencyKey,
      actorId: input.actorId,
      tenantId: input.tenantId,
      executorTypeByTargetId,
    }, context);
  }

  async rollback(input: RollbackExecutionRunInput, context: RequestContext = {}): Promise<{ sourceRun: ExecutionRunDto; rollbackRun: ExecutionRunDto; steps: ExecutionStepDto[]; jobId: string }> {
    const sourceRun = this.repository.getRunOrThrow(input.runId, input.tenantId);
    this.domain.assertRollbackAllowed(sourceRun);

    const transitioned = this.transitionRunEntity(sourceRun, 'ROLLBACK_RUNNING', input.actorId, 'rollback.requested');
    this.audit.write({
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

    const sourceSteps = this.repository.listSteps(input.tenantId, sourceRun.id);
    const targetIds = [...new Set(sourceSteps.map((step) => step.deploymentPlanTargetId).filter((id): id is string => Boolean(id)))];
    if (!sourceSteps.length || !targetIds.length) {
      throw new AppError('VALIDATION_FAILED', '回滚缺少源步骤或目标，不能静默创建空回滚，请人工介入', { runId: sourceRun.id, sourceStepCount: sourceSteps.length, targetCount: targetIds.length });
    }
    const executorTypeByTargetId = new Map(targetIds.map((targetId) => {
      const target = this.deploymentPlansRepository.getTarget(targetId, input.tenantId);
      return [targetId, target?.executorType ?? 'AGENT'] as const;
    }));
    const created = await this.createRunAndEnqueue({
      deploymentPlanId: sourceRun.deploymentPlanId,
      deploymentPlanTargetIds: targetIds,
      type: 'rollback',
      idempotencyKey: input.idempotencyKey,
      actorId: input.actorId,
      tenantId: input.tenantId,
      executorTypeByTargetId,
    }, context);
    return { sourceRun: this.toRunDto(transitioned), rollbackRun: created.run, steps: created.steps, jobId: created.jobId };
  }

  cancelRun(runId: string, actorId: string, tenantId?: string): ExecutionRunDto {
    const run = this.repository.getRunOrThrow(runId, tenantId);
    if (!['PENDING', 'DISPATCHED', 'RUNNING'].includes(run.status)) {
      return this.toRunDto(run);
    }
    for (const step of this.repository.listSteps(tenantId, run.id)) {
      if (step.status === 'PENDING') {
        this.transitionStepEntity(step, 'SKIPPED', actorId, 'step.cancelled');
      }
    }
    return this.toRunDto(this.transitionRunEntity(run, 'CANCELLED', actorId, 'run.cancelled'));
  }

  async runDispatchedExecution(runId: string, actorId: string, tenantId: string | undefined, registry: ExecutorRegistry = new ExecutorRegistry()): Promise<{ success: boolean; errorCode?: string; errorMessage?: string }> {
    let run = this.repository.getRunOrThrow(runId, tenantId);
    if (run.status === 'CANCELLED') return { success: false, errorCode: 'RUN_CANCELLED', errorMessage: '执行运行已取消' };
    if (!['DISPATCHED', 'RUNNING'].includes(run.status)) {
      throw new AppError('DEPLOYMENT_INVALID_STATE', '只有 DISPATCHED 或 RUNNING 运行允许调度执行', { runId: run.id, status: run.status });
    }

    if (run.status === 'DISPATCHED') {
      run = this.transitionRunEntity(run, 'RUNNING', actorId, 'runner.started');
    }
    while (true) {
      const currentRun = this.repository.getRunOrThrow(run.id, tenantId);
      if (currentRun.status === 'CANCELLED') {
        return { success: false, errorCode: 'RUN_CANCELLED', errorMessage: '执行运行已取消' };
      }

      const steps = this.repository.listSteps(tenantId, run.id).sort((left, right) => left.stepNo - right.stepNo);
      const graphState = this.graphBuilder.build(steps);
      const failedStep = steps.find((step) => step.status === 'FAILED' || step.status === 'TIMEOUT');
      if (failedStep) {
        const failedRun = this.transitionRunEntity(currentRun, failedStep.status === 'TIMEOUT' ? 'TIMEOUT' : 'FAILED', actorId, 'runner.failed', {
          errorCode: failedStep.lastErrorCode,
          errorMessage: failedStep.lastErrorMessage,
        });
        return { success: false, errorCode: failedRun.errorCode, errorMessage: failedRun.errorMessage };
      }
      if (graphState.runnable.length === 0 && graphState.running.length === 0) {
        this.transitionRunEntity(currentRun, 'SUCCESS', actorId, 'runner.success');
        return { success: true };
      }

      const pick = this.scheduler.pickNext(steps, currentRun.concurrencyLimit ?? 1);
      if (!pick.selected.length) {
        if (!graphState.running.length) {
          this.transitionRunEntity(currentRun, 'FAILED', actorId, 'runner.deadlock', {
            errorCode: 'STEP_DEPENDENCY_BLOCKED',
            errorMessage: '所有步骤都被依赖阻塞，执行无法继续',
          });
          return { success: false, errorCode: 'STEP_DEPENDENCY_BLOCKED', errorMessage: '所有步骤都被依赖阻塞，执行无法继续' };
        }
        continue;
      }

      const batchResults = await Promise.all(pick.selected.map(async (step) => this.executeSingleStep(step.id, currentRun, actorId, tenantId, registry)));
      const firstFailure = batchResults.find((item) => !item.success);
      if (firstFailure) {
        const refreshedRun = this.repository.getRunOrThrow(run.id, tenantId);
        const failedStep = this.repository.listSteps(tenantId, run.id)
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
        const nextStatus = failedStep?.status === 'TIMEOUT' ? 'TIMEOUT' : 'FAILED';
        this.transitionRunEntity(refreshedRun, nextStatus, actorId, 'runner.failed', {
          errorCode: firstFailure.errorCode,
          errorMessage: firstFailure.errorMessage,
        });
        return firstFailure;
      }
    }
  }

  markFailedForTest(runId: string, actorId: string, tenantId?: string): ExecutionRunDto {
    const run = this.repository.getRunOrThrow(runId, tenantId);
    const dispatched = run.status === 'PENDING' ? this.transitionRunEntity(run, 'DISPATCHED', actorId, 'test.dispatch') : run;
    const running = dispatched.status === 'DISPATCHED' ? this.transitionRunEntity(dispatched, 'RUNNING', actorId, 'test.start') : dispatched;
    return this.toRunDto(this.transitionRunEntity(running, 'FAILED', actorId, 'test.fail', { errorCode: 'MOCK_FAILURE', errorMessage: '模拟失败' }));
  }

  updateStepForTest(stepId: string, patch: Partial<ExecutionStepEntity>, tenantId?: string): ExecutionStepDto {
    this.repository.getStepOrThrow(stepId, tenantId);
    return this.toStepDto(this.repository.updateStep(stepId, patch));
  }

  updateRunForTest(runId: string, patch: Partial<ExecutionRunEntity>, tenantId?: string): ExecutionRunDto {
    this.repository.getRunOrThrow(runId, tenantId);
    return this.toRunDto(this.repository.updateRun(runId, patch));
  }

  async recoverRunsForTest(actorId: string, tenantId?: string, registry: ExecutorRegistry = new ExecutorRegistry()): Promise<Array<{ run: ExecutionRunDto; result: { success: boolean; recovered: boolean; skippedStepIds: string[] } }>> {
    const candidates = this.recoveryWorker.recoverableRuns(tenantId);
    const results: Array<{ run: ExecutionRunDto; result: { success: boolean; recovered: boolean; skippedStepIds: string[] } }> = [];
    for (const candidate of candidates) {
      for (const step of candidate.stepsToResume) {
        if (step.status === 'RUNNING' && step.idempotent !== false) {
          this.repository.updateStep(step.id, {
            status: 'PENDING',
            updatedAt: new Date().toISOString(),
            updatedBy: actorId,
          });
          this.recordTransition('executionStep', step.id, 'RUNNING', 'PENDING', 'recovery.requeued', actorId, step.tenantId);
        }
      }
      for (const stepId of candidate.skippedStepIds) {
        const step = this.repository.getStepOrThrow(stepId, tenantId);
        if (step.status === 'RUNNING') {
          this.repository.updateStep(step.id, {
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

      const resumedRun = this.repository.getRunOrThrow(candidate.run.id, tenantId);
      const normalizedRun = resumedRun.status === 'PENDING'
        ? this.transitionRunEntity(resumedRun, 'DISPATCHED', actorId, 'recovery.redispatched')
        : this.repository.updateRun(resumedRun.id, {
            recoveryAttemptCount: (resumedRun.recoveryAttemptCount ?? 0) + 1,
            lastRecoveryAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            updatedBy: actorId,
          });
      const executionResult = await this.runDispatchedExecution(normalizedRun.id, actorId, tenantId, registry);
      results.push({
        run: this.getRun(normalizedRun.id, tenantId),
        result: { success: executionResult.success, recovered: true, skippedStepIds: candidate.skippedStepIds },
      });
    }
    return results;
  }

  async runNextJobForTest() {
    return this.queue.runNext();
  }

  private async createRunAndEnqueue(input: CreateExecutionRunInput, context: RequestContext): Promise<{ run: ExecutionRunDto; steps: ExecutionStepDto[]; jobId: string }> {
    const existing = this.repository.findRunByIdempotencyKey(input.tenantId, input.idempotencyKey);
    const requestHash = this.domain.buildRunRequestHash({ deploymentPlanId: input.deploymentPlanId, type: input.type });
    if (existing) {
      if (existing.requestHash !== requestHash) throw new AppError('IDEMPOTENCY_CONFLICT', '执行运行幂等键冲突', { idempotencyKey: input.idempotencyKey });
      return { run: this.toRunDto(existing), steps: this.listSteps({ tenantId: input.tenantId, executionRunId: existing.id }), jobId: existing.externalRunId ?? '' };
    }

    const now = new Date().toISOString();
    const run = this.repository.createRun({
      id: newId('run'),
      tenantId: input.tenantId,
      deploymentPlanId: input.deploymentPlanId,
      runNo: this.repository.nextRunNo(input.tenantId, input.deploymentPlanId),
      type: input.type,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      status: 'PENDING',
      concurrencyLimit: input.concurrencyLimit ?? 1,
      summary: {},
      createdAt: now,
      updatedAt: now,
      createdBy: input.actorId,
      version: 1,
    });
    this.recordTransition('executionRun', run.id, undefined, 'PENDING', 'run.created', input.actorId, input.tenantId);

    const steps = this.createDefaultSteps(run, input.deploymentPlanTargetIds, input.actorId, input.executorTypeByTargetId, input.mockResultByTargetId, input.stepMaxAttempts);
    const job = await this.queue.enqueue({
      jobType: 'DEPLOYMENT_EXECUTE',
      resourceType: 'executionRun',
      resourceId: run.id,
      idempotencyKey: input.idempotencyKey,
      payload: { runId: run.id, deploymentPlanId: input.deploymentPlanId, type: input.type, tenantId: input.tenantId, actorId: input.actorId },
      retryPolicy: { maxAttempts: 1, backoffSeconds: 0 },
    });
    const dispatched = this.transitionRunEntity({ ...run, externalRunId: job.jobId }, 'DISPATCHED', input.actorId, 'queue.dispatched', { externalRunId: job.jobId });

    this.audit.write({
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
    });

    return { run: this.toRunDto(dispatched), steps: steps.map((step) => this.toStepDto(step)), jobId: job.jobId };
  }

  private createDefaultSteps(run: ExecutionRunEntity, targetIds: string[], actorId: string, executorTypeByTargetId: Map<string, string>, mockResultByTargetId?: Map<string, 'success' | 'fail'>, stepMaxAttempts = 1): ExecutionStepEntity[] {
    const stepTypes = run.type === 'rollback' ? ['ROLLBACK', 'VERIFY'] as const : run.type === 'dry_run' ? ['DISCOVER', 'VERIFY'] as const : ['BACKUP', 'INSTALL', 'RELOAD', 'VERIFY'] as const;
    const created: ExecutionStepEntity[] = [];
    let stepNo = 1;
    for (const targetId of targetIds) {
      let previousStepNo: number | undefined;
      for (const stepType of stepTypes) {
        const now = new Date().toISOString();
        const step = this.repository.createStep({
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
          inputSnapshot: { deploymentPlanTargetId: targetId, executorType: executorTypeByTargetId.get(targetId) ?? 'MOCK', dryRun: run.type === 'dry_run', mockResult: mockResultByTargetId?.get(targetId) },
          status: 'PENDING',
          createdAt: now,
          updatedAt: now,
          createdBy: actorId,
          version: 1,
        });
        this.recordTransition('executionStep', step.id, undefined, 'PENDING', 'step.created', actorId, run.tenantId);
        created.push(step);
        previousStepNo = stepNo;
        stepNo += 1;
      }
    }
    return created;
  }

  private transitionStepEntity(step: ExecutionStepEntity, nextStatus: ExecutionStepEntity['status'], actorId: string, event: string, patch: Partial<ExecutionStepEntity> = {}): ExecutionStepEntity {
    this.domain.transitionStep(step.status, nextStatus);
    const now = new Date().toISOString();
    const updated = this.repository.updateStep(step.id, {
      ...patch,
      status: nextStatus,
      updatedAt: now,
      updatedBy: actorId,
      startedAt: nextStatus === 'RUNNING' ? now : step.startedAt,
      finishedAt: ['SUCCESS', 'FAILED', 'TIMEOUT', 'SKIPPED'].includes(nextStatus) ? now : step.finishedAt,
    });
    this.recordTransition('executionStep', step.id, step.status, nextStatus, event, actorId, step.tenantId);
    return updated;
  }

  private transitionRunEntity(run: ExecutionRunEntity, nextStatus: ExecutionRunEntity['status'], actorId: string, event: string, patch: Partial<ExecutionRunEntity> = {}): ExecutionRunEntity {
    this.domain.transitionRun(run.status, nextStatus);
    const now = new Date().toISOString();
    const updated = this.repository.updateRun(run.id, {
      ...patch,
      externalRunId: patch.externalRunId ?? run.externalRunId,
      status: nextStatus,
      updatedAt: now,
      updatedBy: actorId,
      startedAt: nextStatus === 'RUNNING' ? now : run.startedAt,
      finishedAt: ['SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED', 'ROLLBACK_SUCCESS', 'ROLLBACK_FAILED'].includes(nextStatus) ? now : run.finishedAt,
    });
    this.recordTransition('executionRun', run.id, run.status, nextStatus, event, actorId, run.tenantId);
    return updated;
  }

  private recordTransition(entityType: StateTransitionEventEntity['entityType'], entityId: string, fromStatus: string | undefined, toStatus: string, event: string, actorId: string, tenantId?: string): void {
    this.deploymentPlansRepository.createTransition({
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

  private toRunDto(run: ExecutionRunEntity): ExecutionRunDto {
    return { ...run };
  }

  private toStepDto(step: ExecutionStepEntity): ExecutionStepDto {
    return { ...step };
  }

  private async executeSingleStep(stepId: string, run: ExecutionRunEntity, actorId: string, tenantId: string | undefined, registry: ExecutorRegistry): Promise<{ success: boolean; errorCode?: string; errorMessage?: string }> {
    const current = this.repository.getStepOrThrow(stepId, tenantId);
    if (current.status !== 'PENDING') {
      return { success: true };
    }
    const runningStep = this.transitionStepEntity(current, 'RUNNING', actorId, 'step.started', {
      attemptCount: current.attemptCount + 1,
    });
    const executorType = String(runningStep.inputSnapshot.executorType ?? 'MOCK');
    const result = await registry.get(executorType).executeStep({
      step: runningStep,
      runType: run.type,
      dryRun: Boolean(runningStep.inputSnapshot.dryRun),
    });
    if (result.success) {
      this.transitionStepEntity(runningStep, 'SUCCESS', actorId, 'step.success');
      return { success: true };
    }

    const decision = this.failurePolicy.classify(runningStep, result);
    const canRetry = decision.shouldAutoRetry && runningStep.idempotent !== false;
    if (canRetry) {
      this.repository.updateStep(runningStep.id, {
        status: 'PENDING',
        updatedAt: new Date().toISOString(),
        updatedBy: actorId,
        lastFailureCategory: decision.category,
        lastErrorCode: result.errorCode,
        lastErrorMessage: result.errorMessage,
      });
      this.recordTransition('executionStep', runningStep.id, 'RUNNING', 'PENDING', 'step.retrying', actorId, runningStep.tenantId);
      return { success: true };
    }

    const terminalStatus = decision.category === 'timeout' ? 'TIMEOUT' : 'FAILED';
    this.transitionStepEntity(runningStep, terminalStatus, actorId, 'step.failed', {
      lastFailureCategory: decision.category,
      lastErrorCode: result.errorCode,
      lastErrorMessage: result.errorMessage,
    });
    return { success: false, errorCode: result.errorCode, errorMessage: result.errorMessage };
  }
}
