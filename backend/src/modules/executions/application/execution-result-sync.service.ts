import type { AssetsApplicationService } from '../../assets/application/assets.application-service.js';
import type { ApplicationAssetTargetSummaryDto, CreateManagedTargetSnapshotDto, ManagedTargetDto, ServiceAssetDto, SiteAssetDto } from '../../assets/dto/assets.dto.js';
import type { BindingsApplicationService } from '../../bindings/application/bindings.application-service.js';
import type { CertificateBindingDto } from '../../bindings/dto/bindings.dto.js';
import type { DeploymentPlansRepository } from '../../deployment-plans/repository/deployment-plans.repository.js';
import type { MonitorsApplicationService } from '../../monitors/application/monitors.application-service.js';
import type { ProbeServiceAssetResult } from '../../monitors/dto/monitors.dto.js';
import type { StateTransitionEventEntity } from '../../deployment-plans/schema/deployment-plans.schema.js';
import { newId } from '../../../shared/id.js';
import type { ExecutionsRepository } from '../repository/executions.repository.js';
import type { ExecutionRunEntity, ExecutionStepEntity } from '../schema/executions.schema.js';
import { ExecutionDetailStreamService } from './execution-detail-stream.service.js';
import type { PluginCertificateResultService } from '../../plugins/results/plugin-certificate-result.service.js';
import type { AgentSecurityStatus } from '../../agents/security/agent-security.contract.js';
import { sanitizeExecutionErrorDetails } from './execution-error-details.js';
import { normalizeAgentV2DryRunDetail } from './agent-v2-dry-run-result.js';

type ContinuationRunner = (input: { runId: string; tenantId: string; actorId: string }) => Promise<unknown>;
type RollbackRunner = (input: { runId: string; tenantId: string; actorId: string }) => Promise<unknown>;

export class ExecutionResultSyncService {
  private continuationRunner?: ContinuationRunner;
  private rollbackRunner?: RollbackRunner;
  private monitors?: MonitorsApplicationService;

  constructor(
    private readonly executions: ExecutionsRepository,
    private readonly assets: AssetsApplicationService,
    private readonly bindings: BindingsApplicationService,
    private readonly deploymentPlans?: DeploymentPlansRepository,
    private readonly detailStream?: ExecutionDetailStreamService,
    private readonly pluginCertificateResults?: PluginCertificateResultService,
  ) {}

  setContinuationRunner(runner: ContinuationRunner): void {
    this.continuationRunner = runner;
  }

  setRollbackRunner(runner: RollbackRunner): void {
    this.rollbackRunner = runner;
  }

  setMonitorsService(monitors: MonitorsApplicationService): void {
    this.monitors = monitors;
  }

  async probeSuccessfulDeploymentPlanTargets(input: { tenantId?: string; deploymentPlanId: string }): Promise<void> {
    if (!input.tenantId || !this.monitors || !this.deploymentPlans) return;
    const targets = await this.resolveDeploymentPlanProbeTargets(input.tenantId, input.deploymentPlanId);
    for (const { serviceAssetId, workflowTarget } of targets) {
      if (workflowTarget) await this.mergeServiceAssetWorkflowTarget(input.tenantId, serviceAssetId, workflowTarget);
      const probeResult = await this.probeWorkflowServiceAsset(input.tenantId, serviceAssetId);
      if (probeResult) await this.writeServiceAssetProbeMetadata(input.tenantId, serviceAssetId, probeResult);
    }
  }

  async applyAgentTaskResult(input: {
    tenantId: string;
    executionRunId: string;
    executionStepId: string;
    success: boolean;
    status?: AgentSecurityStatus;
    errorCode?: string;
    errorMessage?: string;
    detail?: Record<string, unknown>;
    actorId: string;
  }): Promise<void> {
    const step = await this.executions.getStep(input.executionStepId, input.tenantId);
    if (!step) return;
    const run = await this.executions.getRun(input.executionRunId, input.tenantId);
    if (!run) return;

    if (hasPersistedUnknownResult(step)) return;
    const executionStatus = resolveAgentExecutionStatus(input);
    if (executionStatus === 'UNKNOWN') {
      await this.persistUnknownAgentExecution(input, run, step);
      return;
    }

    if (run.status === 'CANCELLED') return;

    const isDryRun = run.type === 'dry_run' || step.inputSnapshot.dryRun === true;
    const inputDetail = isDryRun
      ? normalizeAgentV2DryRunDetail(input.detail ?? {})
      : input.detail ?? {};
    const mergedDetail = {
      ...((step.inputSnapshot.resultDetail as Record<string, unknown> | undefined) ?? {}),
      ...inputDetail,
    };
    normalizeWorkflowRollbackDetail(mergedDetail);
    const installDetail = await this.resolveTargetInstallDetail(input.tenantId, step);
    if (installDetail) {
      mergedDetail.installResult = installDetail;
    }
    if (isDryRun) {
      const mergedDryRunChecks = mergeDryRunChecks(
        readDryRunChecks((step.inputSnapshot.resultDetail as Record<string, unknown> | undefined) ?? {}),
        readDryRunChecks(inputDetail),
      );
      if (!input.success && dryRunChecksContainNoFailure(mergedDryRunChecks)) {
        mergedDryRunChecks.push(buildDryRunExecutionFailureCheck(input, step, mergedDetail));
      }
      if (mergedDryRunChecks.length > 0) {
        mergedDetail.dryRunChecks = mergedDryRunChecks;
        mergedDetail.dryRunSummary = summarizeDryRunChecks(mergedDryRunChecks);
      }
    }
    const acceptedInputSuccess = input.success && executionStatus === 'SUCCESS';
    const certificateVerification = validateFormalCertificateVerification(
      step,
      mergedDetail,
      isDryRun,
      acceptedInputSuccess,
    );
    const effectiveSuccess = acceptedInputSuccess && certificateVerification.success;
    const agentFailureWithoutDetails = buildAgentFailureWithoutDetails(input, step, mergedDetail);
    const effectiveErrorCode = input.errorCode ?? certificateVerification.errorCode ?? agentFailureWithoutDetails?.errorCode;
    const effectiveErrorMessage = input.errorMessage ?? certificateVerification.errorMessage ?? agentFailureWithoutDetails?.errorMessage;
    if (!certificateVerification.success) {
      mergedDetail.certificateVerification = certificateVerification.detail;
    }
    if (agentFailureWithoutDetails) {
      mergedDetail.failure = agentFailureWithoutDetails.detail;
    }
    console.info('[execution-result-sync.applyAgentTaskResult]', JSON.stringify({
      tenantId: input.tenantId,
      executionRunId: input.executionRunId,
      executionStepId: input.executionStepId,
      success: input.success,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      effectiveSuccess,
      effectiveErrorCode,
      effectiveErrorMessage,
      inputDetailKeys: Object.keys(input.detail ?? {}),
      mergedDetailKeys: Object.keys(mergedDetail),
      dryRunDebug: {
        mode: mergedDetail.mode,
        pfxPassLen: mergedDetail.pfxPassLen,
        pfxEdgeWhitespace: mergedDetail.pfxEdgeWhitespace,
        pfxPassUtf8Sha256: mergedDetail.pfxPassUtf8Sha256,
        pfxPassUtf8Len: mergedDetail.pfxPassUtf8Len,
        decodedPfxSha256: mergedDetail.decodedPfxSha256,
        decodedPfxSize: mergedDetail.decodedPfxSize,
        pfxSource: mergedDetail.pfxSource,
        dryRunSummary: mergedDetail.dryRunSummary,
        dryRunCheckCount: Array.isArray(mergedDetail.dryRunChecks) ? mergedDetail.dryRunChecks.length : undefined,
        firstFailedCheck: Array.isArray(mergedDetail.dryRunChecks)
          ? mergedDetail.dryRunChecks.find((item) => item && typeof item === 'object' && (item as Record<string, unknown>).status === 'failed')
          : undefined,
      },
    }));

    const now = new Date().toISOString();
    const nextStepStatus = effectiveSuccess ? 'SUCCESS' : 'FAILED';
    const errorDetails = effectiveSuccess ? undefined : sanitizeExecutionErrorDetails(mergedDetail);
    await this.executions.updateStep(step.id, {
      status: nextStepStatus,
      lastErrorCode: effectiveErrorCode,
      lastErrorMessage: effectiveErrorMessage,
      lastErrorDetails: errorDetails,
      finishedAt: now,
      updatedAt: now,
      updatedBy: input.actorId,
      inputSnapshot: {
        ...step.inputSnapshot,
        resultDetail: effectiveSuccess ? mergedDetail : errorDetails ?? {},
      },
    });
    this.detailStream?.publishStep(await this.executions.getStepOrThrow(step.id, input.tenantId));
    await this.recordTransitionIfChanged('executionStep', step.id, step.status, nextStepStatus, effectiveSuccess ? 'agent.step.success' : 'agent.step.failed', input.actorId, step.tenantId);

    let resultState: ResultState | undefined;
    if (!isDryRun) {
      resultState = await this.syncDeploymentAssets({ ...input, success: effectiveSuccess, errorCode: effectiveErrorCode, runType: run.type }, step, mergedDetail);
    }

    let latestSteps = await this.executions.listSteps(input.tenantId, run.id);
    let hasFailed = latestSteps.some((item) => item.status === 'FAILED' || item.status === 'TIMEOUT');
    let allFinished = latestSteps.every((item) => ['SUCCESS', 'FAILED', 'TIMEOUT', 'SKIPPED'].includes(item.status));
    if (hasFailed && !allFinished) {
      await this.skipPendingStepsAfterRunFailure(run, latestSteps, input.actorId, input.tenantId, effectiveErrorCode ?? 'STEP_FAILED', effectiveErrorMessage ?? 'Agent 执行失败');
      latestSteps = await this.executions.listSteps(input.tenantId, run.id);
      hasFailed = latestSteps.some((item) => item.status === 'FAILED' || item.status === 'TIMEOUT');
      allFinished = latestSteps.every((item) => ['SUCCESS', 'FAILED', 'TIMEOUT', 'SKIPPED'].includes(item.status));
    }
    if (!allFinished) {
      await this.continueRunAfterAgentResult(run, input.actorId, input.tenantId);
      return;
    }

    const nextRunStatus = hasFailed ? 'FAILED' : 'SUCCESS';
    const finishedRun = await this.executions.updateRun(run.id, {
      status: nextRunStatus,
      errorCode: hasFailed ? effectiveErrorCode ?? 'STEP_FAILED' : undefined,
      errorMessage: hasFailed ? effectiveErrorMessage ?? 'Agent 执行失败' : undefined,
      finishedAt: now,
      updatedAt: now,
      updatedBy: input.actorId,
      summary: {
        ...run.summary,
        ...(resultState ? { resultState: resultState.kind } : {}),
      },
    });
    this.detailStream?.publishRun(await this.executions.getRunOrThrow(run.id, input.tenantId));
    await this.recordTransitionIfChanged('executionRun', run.id, run.status, nextRunStatus, hasFailed ? 'agent.run.failed' : 'agent.run.success', input.actorId, run.tenantId);
    if (!isDryRun) {
      await this.syncDeploymentPlanAfterRun(finishedRun, latestSteps, input.actorId, input.tenantId);
      if (hasFailed) {
        await this.requestAutomaticRollbackIfNeeded(finishedRun, input.actorId, input.tenantId);
      }
    }
  }

  private async persistUnknownAgentExecution(
    input: { tenantId: string; executionRunId: string; executionStepId: string; success: boolean; status?: AgentSecurityStatus; errorCode?: string; errorMessage?: string; detail?: Record<string, unknown>; actorId: string },
    run: ExecutionRunEntity,
    step: ExecutionStepEntity,
  ): Promise<void> {
    const now = new Date().toISOString();
    const unknownDetail = {
      ...readRecord(step.inputSnapshot.resultDetail),
      ...(input.detail ?? {}),
      executionStatus: 'UNKNOWN',
      unknownReason: input.errorMessage ?? input.errorCode ?? 'Agent 写操作结果不明',
    };
    await this.executions.updateStep(step.id, {
      inputSnapshot: { ...step.inputSnapshot, resultDetail: unknownDetail },
      lastErrorCode: input.errorCode ?? 'AGENT_EXECUTION_UNKNOWN',
      lastErrorMessage: input.errorMessage ?? 'Agent 写操作结果不明，禁止自动重试或回退',
      lastErrorDetails: sanitizeExecutionErrorDetails(unknownDetail),
      updatedAt: now,
      updatedBy: input.actorId,
    });
    await this.executions.updateRun(run.id, {
      summary: {
        ...run.summary,
        executionStatus: 'UNKNOWN',
        unknownReason: input.errorMessage ?? input.errorCode ?? 'Agent 写操作结果不明',
      },
      updatedAt: now,
      updatedBy: input.actorId,
    });
    await this.persistUnknownDeploymentState(input.tenantId, run.deploymentPlanId, step.deploymentPlanTargetId, input.actorId, input.errorMessage ?? input.errorCode ?? 'Agent 写操作结果不明');
    this.detailStream?.publishStep(await this.executions.getStepOrThrow(step.id, input.tenantId));
    this.detailStream?.publishRun(await this.executions.getRunOrThrow(run.id, input.tenantId));
  }

  private async persistUnknownDeploymentState(
    tenantId: string,
    deploymentPlanId: string,
    targetId: string | undefined,
    actorId: string,
    reason: string,
  ): Promise<void> {
    if (!this.deploymentPlans) return;
    const plan = await this.deploymentPlans.getPlan(deploymentPlanId, tenantId);
    if (!plan) return;
    await this.deploymentPlans.updatePlan(plan.id, {
      executionStatus: 'UNKNOWN',
      updatedAt: new Date().toISOString(),
      updatedBy: actorId,
    });
    if (!targetId) return;
    const target = await this.deploymentPlans.getTarget(targetId, tenantId);
    if (!target) return;
    await this.deploymentPlans.updateTarget(target.id, {
      executionStatus: 'UNKNOWN',
      strategyPayload: {
        ...(target.strategyPayload ?? {}),
        executionStatus: 'UNKNOWN',
        unknownReason: reason,
      },
      updatedAt: new Date().toISOString(),
      updatedBy: actorId,
    });
  }

  private async resolveTargetInstallDetail(tenantId: string, step: ExecutionStepEntity): Promise<Record<string, unknown> | undefined> {
    if (step.stepType !== 'VERIFY' || !step.deploymentPlanTargetId) return undefined;
    const steps = await this.executions.listSteps(tenantId, step.executionRunId);
    const installStep = steps
      .filter((item) => item.deploymentPlanTargetId === step.deploymentPlanTargetId && item.stepType === 'INSTALL')
      .sort((left, right) => right.stepNo - left.stepNo)[0];
    return readRecord(installStep?.inputSnapshot.resultDetail);
  }

  private async skipPendingStepsAfterRunFailure(run: ExecutionRunEntity, steps: ExecutionStepEntity[], actorId: string, tenantId: string, errorCode: string, errorMessage: string): Promise<void> {
    const now = new Date().toISOString();
    for (const step of steps) {
      if (step.status !== 'PENDING') continue;
      await this.executions.updateStep(step.id, {
        status: 'SKIPPED',
        finishedAt: now,
        updatedAt: now,
        updatedBy: actorId,
        lastFailureCategory: 'unsafe',
        lastErrorCode: 'SKIPPED_AFTER_RUN_FAILURE',
        lastErrorMessage: `执行运行 ${run.id} 已失败，跳过未执行步骤；源错误 ${errorCode}: ${errorMessage}`,
      });
      this.detailStream?.publishStep(await this.executions.getStepOrThrow(step.id, tenantId));
      await this.recordTransitionIfChanged('executionStep', step.id, step.status, 'SKIPPED', 'agent.run_failed.skip_pending', actorId, step.tenantId);
    }
  }

  private async continueRunAfterAgentResult(run: ExecutionRunEntity, actorId: string, tenantId: string): Promise<void> {
    if (!this.continuationRunner) return;
    if (!['DISPATCHED', 'RUNNING'].includes(run.status)) return;
    await this.continuationRunner({ runId: run.id, tenantId, actorId });
  }

  private async requestAutomaticRollbackIfNeeded(run: ExecutionRunEntity, actorId: string, tenantId: string): Promise<void> {
    if (!this.rollbackRunner) return;
    if (run.type !== 'apply') return;
    if (!['FAILED', 'TIMEOUT'].includes(run.status)) return;
    if (readRunFailurePolicy(run.summary) !== 'rollback') return;
    try {
      await this.rollbackRunner({ runId: run.id, tenantId, actorId });
    } catch (error) {
      console.warn('[execution-result-sync.auto-rollback]', JSON.stringify({
        runId: run.id,
        tenantId,
        actorId,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  private async syncDeploymentAssets(
    input: { tenantId: string; executionRunId: string; executionStepId: string; success: boolean; errorCode?: string; detail?: Record<string, unknown>; runType: ExecutionRunEntity['type'] },
    step: ExecutionStepEntity,
    detail: Record<string, unknown>,
  ): Promise<ResultState | undefined> {
    if (!shouldSyncDeploymentState(input.runType, step, input.success, detail)) return undefined;

    const bindingId = typeof step.inputSnapshot.certificateBindingId === 'string' ? step.inputSnapshot.certificateBindingId : undefined;
    if (!bindingId) return this.syncWorkflowDeploymentAssets(input, step, detail);

    const binding = await this.bindings.getRepository().getCertificateBinding(input.tenantId, bindingId);
    if (!binding) return undefined;

    const resultState = deriveResultState(input.runType, step.stepType, input.success, detail, input.errorCode);
    const assetBinding = await this.resolveApplicationAssetTarget(input.tenantId, binding);
    const siteAsset = binding.siteAssetId ? await this.assets.getRepository().getSiteAsset(input.tenantId, binding.siteAssetId) : undefined;
    const managedTarget = binding.managedTargetId ? await this.assets.getRepository().getManagedTarget(input.tenantId, binding.managedTargetId) : undefined;
    const targetCertificateVersionId = resultState.useTargetCertificate
      ? await this.resolveTargetCertificateVersionId(input.tenantId, step, binding)
      : undefined;

    await this.captureSnapshots(input, binding, assetBinding, siteAsset, managedTarget, detail, resultState, targetCertificateVersionId);
    await this.writeBindingState(input, binding, detail, resultState, targetCertificateVersionId);
    await this.writeAssetState(input, assetBinding, siteAsset, managedTarget, detail, resultState);
    await this.tryWritePluginCertificateResult(input, binding, resultState);
    return resultState;
  }

  private async tryWritePluginCertificateResult(
    input: { tenantId: string; executionRunId: string; executionStepId: string },
    binding: CertificateBindingDto,
    resultState: ResultState,
  ): Promise<void> {
    try {
      await this.writePluginCertificateResult(input, binding, resultState);
    } catch (error) {
      console.warn('[execution-result-sync.plugin-certificate-result]', JSON.stringify({
        tenantId: input.tenantId,
        executionRunId: input.executionRunId,
        executionStepId: input.executionStepId,
        bindingId: binding.id,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  private async writePluginCertificateResult(
    input: { tenantId: string; executionRunId: string; executionStepId: string },
    binding: CertificateBindingDto,
    resultState: ResultState,
  ): Promise<void> {
    if (!this.pluginCertificateResults) return;
    const pluginDeviceAssetId = readString(binding.metadata, 'pluginDeviceAssetId');
    const bindingStableKey = readString(binding.metadata, 'pluginDiscoveryStableKey');
    if (!pluginDeviceAssetId || !bindingStableKey) return;
    const updated = await this.bindings.getRepository().getCertificateBinding(input.tenantId, binding.id);
    if (!updated) return;
    const observedFingerprintSha256 = updated.observedFingerprintSha256 ?? updated.remoteEndpointFingerprint;
    const status = resultState.kind === 'DEPLOY_SUCCESS' ? 'VERIFIED' : resultState.kind === 'DEPLOY_FAILED_ROLLED_BACK' ? 'ROLLED_BACK' : 'FAILED';
    await this.pluginCertificateResults.applyDeploymentResult(input.tenantId, pluginDeviceAssetId, {
      apiVersion: 'gcac.certificate-deploy-result/v1',
      bindingStableKey,
      status,
      observedFingerprintSha256,
      certificateVersionId: status === 'VERIFIED' ? updated.certificateVersionId : undefined,
      desiredCertificateVersionId: status === 'VERIFIED' ? updated.targetCertificateVersionId ?? updated.certificateVersionId : undefined,
      rollbackCertificateVersionId: status === 'ROLLED_BACK' ? updated.certificateVersionId : undefined,
      verifiedAt: new Date().toISOString(),
      evidence: {
        executionRunId: input.executionRunId,
        executionStepId: input.executionStepId,
        certificateBindingId: binding.id,
      },
    });
  }

  private async syncWorkflowDeploymentAssets(
    input: { tenantId: string; executionRunId: string; executionStepId: string; success: boolean; errorCode?: string; detail?: Record<string, unknown>; runType: ExecutionRunEntity['type'] },
    step: ExecutionStepEntity,
    detail: Record<string, unknown>,
  ): Promise<ResultState | undefined> {
    const applicationAssetId = await this.resolveWorkflowApplicationAssetId(input.tenantId, step);
    if (!applicationAssetId) return undefined;

    const serviceAsset = await this.assets.getRepository().getServiceAsset(input.tenantId, applicationAssetId);
    if (!serviceAsset) return undefined;

    const resultState = deriveResultState(input.runType, step.stepType, input.success, detail, input.errorCode);
    const assetBinding = await this.assets.getRepository().getApplicationAssetTargetByApplicationAssetId(input.tenantId, applicationAssetId);
    const managedTarget = assetBinding?.managedTargetId ? await this.assets.getRepository().getManagedTarget(input.tenantId, assetBinding.managedTargetId) : undefined;
    const siteAsset = managedTarget?.siteId ? await this.assets.getRepository().getSiteAsset(input.tenantId, managedTarget.siteId) : undefined;

    await this.writeAssetState(input, assetBinding, siteAsset, managedTarget, detail, resultState);
    const probeResult = resultState.kind === 'DEPLOY_SUCCESS'
      ? await this.probeWorkflowServiceAsset(input.tenantId, serviceAsset.id)
      : undefined;
    const probeMetadata = probeResult ? buildServiceAssetProbeMetadata(probeResult) : {};
    await this.assets.updateServiceAsset(input.tenantId, serviceAsset.id, {
      metadata: {
        ...serviceAsset.metadata,
        lastDeploymentResultState: resultState.kind,
        manualInterventionRequired: resultState.manualRequired,
        currentFingerprintSha256: normalizeProbeFingerprint(probeResult?.certificate?.fingerprintSha256)
          ?? readString(detail, 'verify.remoteCertificateSha256')
          ?? readString(detail, 'installedCertificateSha256')
          ?? readString(serviceAsset.metadata, 'currentFingerprintSha256'),
        currentThumbprint: readString(detail, 'verify.remoteThumbprint') ?? readString(detail, 'newThumbprint') ?? readString(detail, 'oldThumbprint') ?? readString(serviceAsset.metadata, 'currentThumbprint'),
        ...probeMetadata,
        lastWorkflowExecutionRunId: input.executionRunId,
        lastWorkflowExecutionStepId: input.executionStepId,
        lastDeployedAt: new Date().toISOString(),
      },
    });
    return resultState;
  }

  private async probeWorkflowServiceAsset(tenantId: string, serviceAssetId: string): Promise<ProbeServiceAssetResult | undefined> {
    if (!this.monitors) return undefined;
    try {
      return await this.monitors.probeServiceAsset({ tenantId, serviceAssetId });
    } catch (error) {
      console.warn('[execution-result-sync.workflow-probe]', JSON.stringify({
        tenantId,
        serviceAssetId,
        error: error instanceof Error ? error.message : String(error),
      }));
      return undefined;
    }
  }

  private async resolveWorkflowApplicationAssetId(tenantId: string, step: ExecutionStepEntity): Promise<string | undefined> {
    const direct = readString(step.inputSnapshot, 'workflowRequest.applicationAssetId')
      ?? readString(step.inputSnapshot, 'applicationAssetId');
    if (direct) return direct;
    if (!this.deploymentPlans || !step.deploymentPlanTargetId) return undefined;

    const target = await this.deploymentPlans.getTarget(step.deploymentPlanTargetId, tenantId);
    const targetRecord = readRecord(target);
    const strategyPayload = readRecord(target?.strategyPayload);
    return readString(targetRecord ?? {}, 'applicationAssetId')
      ?? readString(targetRecord ?? {}, 'serviceAssetId')
      ?? readString(strategyPayload ?? {}, 'workflowRequest.applicationAssetId')
      ?? readString(strategyPayload ?? {}, 'applicationAssetId');
  }

  private async syncDeploymentPlanAfterRun(
    run: ExecutionRunEntity,
    steps: ExecutionStepEntity[],
    actorId: string,
    tenantId?: string,
  ): Promise<void> {
    if (!this.deploymentPlans || run.type === 'dry_run') return;
    const plan = await this.deploymentPlans.getPlan(run.deploymentPlanId, tenantId);
    if (!plan) return;

    const targetIds = uniqueTargetIds(steps);
    if (run.type === 'rollback') {
      if (run.status === 'SUCCESS') {
        await this.markTargets(targetIds, 'READY', actorId, tenantId);
        if (plan.status === 'FAILED' || plan.status === 'PARTIAL_SUCCESS') {
          await this.transitionDeploymentPlan(plan.id, plan.status, 'ROLLED_BACK', actorId, 'rollback.success', plan.tenantId);
        }
        await this.markRollbackSourceRuns(run.deploymentPlanId, 'ROLLBACK_SUCCESS', actorId, tenantId);
      } else if (run.status === 'FAILED' || run.status === 'TIMEOUT') {
        await this.markRollbackSourceRuns(run.deploymentPlanId, 'ROLLBACK_FAILED', actorId, tenantId);
      }
      return;
    }

    if (run.status === 'SUCCESS') {
      await this.markTargets(targetIds, 'COMPLETED', actorId, tenantId);
      if (plan.status === 'RUNNING') {
        await this.transitionDeploymentPlan(plan.id, plan.status, 'SUCCESS', actorId, 'execution.success', plan.tenantId);
      }
      await this.probeSuccessfulDeploymentPlanTargets({ tenantId, deploymentPlanId: run.deploymentPlanId });
      return;
    }

    if (run.status === 'FAILED' || run.status === 'TIMEOUT') {
      const failedTargetIds = uniqueTargetIds(steps.filter((step) => step.status === 'FAILED' || step.status === 'TIMEOUT'));
      const successfulTargetIds = uniqueTargetIds(steps.filter((step) => step.stepType === 'VERIFY' && step.status === 'SUCCESS'));
      await this.markTargets(successfulTargetIds, 'COMPLETED', actorId, tenantId);
      await this.markTargets(failedTargetIds, 'FAILED', actorId, tenantId);
      if (plan.status === 'RUNNING') {
        await this.transitionDeploymentPlan(plan.id, plan.status, successfulTargetIds.length > 0 ? 'PARTIAL_SUCCESS' : 'FAILED', actorId, 'execution.failed', plan.tenantId);
      }
    }
  }

  private async markTargets(targetIds: string[], status: 'READY' | 'COMPLETED' | 'FAILED' | 'SKIPPED', actorId: string, tenantId?: string): Promise<void> {
    if (!this.deploymentPlans) return;
    for (const targetId of targetIds) {
      const target = await this.deploymentPlans.getTarget(targetId, tenantId);
      if (!target || target.status === status) continue;
      await this.deploymentPlans.updateTarget(target.id, {
        status,
        updatedAt: new Date().toISOString(),
        updatedBy: actorId,
      });
    }
  }

  private async resolveDeploymentPlanProbeTargets(tenantId: string | undefined, deploymentPlanId: string): Promise<Array<{ serviceAssetId: string; workflowTarget?: Record<string, unknown> }>> {
    if (!tenantId || !this.deploymentPlans) return [];
    const output = new Map<string, Record<string, unknown> | undefined>();
    const targets = await this.deploymentPlans.listTargetsByPlan(deploymentPlanId, tenantId);
    for (const target of targets) {
      const targetRecord = readRecord(target) ?? {};
      const strategyPayload = readRecord(target.strategyPayload);
      const workflowRequest = readRecord(strategyPayload?.workflowRequest);
      const workflowTarget = readRecord(workflowRequest?.target)
        ?? readRecord(readRecord(readRecord(strategyPayload?.deploymentStrategy)?.workflow)?.target);
      const applicationAssetId = readString(targetRecord, 'applicationAssetId')
        ?? readString(targetRecord, 'serviceAssetId')
        ?? readString(workflowRequest ?? {}, 'applicationAssetId')
        ?? readString(strategyPayload ?? {}, 'applicationAssetId')
        ?? (!target.certificateBindingId ? target.executionTargetId : undefined);
      if (applicationAssetId) output.set(applicationAssetId, workflowTarget ?? output.get(applicationAssetId));

      if (!target.certificateBindingId) continue;
      const binding = await this.bindings.getRepository().getCertificateBinding(tenantId, target.certificateBindingId);
      if (binding?.serviceAssetId) output.set(binding.serviceAssetId, workflowTarget ?? output.get(binding.serviceAssetId));
    }
    return [...output].map(([serviceAssetId, workflowTarget]) => ({ serviceAssetId, workflowTarget }));
  }

  private async mergeServiceAssetWorkflowTarget(tenantId: string, serviceAssetId: string, workflowTarget: Record<string, unknown>): Promise<void> {
    const serviceAsset = await this.assets.getRepository().getServiceAsset(tenantId, serviceAssetId);
    if (!serviceAsset) return;
    await this.assets.updateServiceAsset(tenantId, serviceAssetId, {
      metadata: {
        ...serviceAsset.metadata,
        workflowTarget: {
          ...(readRecord(serviceAsset.metadata.workflowTarget) ?? {}),
          ...workflowTarget,
        },
      },
    });
  }

  private async writeServiceAssetProbeMetadata(tenantId: string, serviceAssetId: string, probeResult: ProbeServiceAssetResult): Promise<void> {
    const serviceAsset = await this.assets.getRepository().getServiceAsset(tenantId, serviceAssetId);
    if (!serviceAsset) return;
    await this.assets.updateServiceAsset(tenantId, serviceAssetId, {
      metadata: {
        ...serviceAsset.metadata,
        ...buildServiceAssetProbeMetadata(probeResult),
      },
    });
  }

  private async transitionDeploymentPlan(
    planId: string,
    fromStatus: string,
    toStatus: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED' | 'ROLLED_BACK',
    actorId: string,
    event: string,
    tenantId?: string,
  ): Promise<void> {
    if (!this.deploymentPlans || fromStatus === toStatus) return;
    await this.deploymentPlans.updatePlan(planId, {
      status: toStatus,
      updatedAt: new Date().toISOString(),
      updatedBy: actorId,
    });
    await this.recordTransitionIfChanged('deploymentPlan', planId, fromStatus, toStatus, event, actorId, tenantId);
  }

  private async markRollbackSourceRuns(deploymentPlanId: string, status: 'ROLLBACK_SUCCESS' | 'ROLLBACK_FAILED', actorId: string, tenantId?: string): Promise<void> {
    for (const sourceRun of await this.executions.listRuns(tenantId, deploymentPlanId)) {
      if (sourceRun.status !== 'ROLLBACK_RUNNING') continue;
      await this.executions.updateRun(sourceRun.id, {
        status,
        updatedAt: new Date().toISOString(),
        updatedBy: actorId,
        finishedAt: new Date().toISOString(),
      });
      await this.recordTransitionIfChanged('executionRun', sourceRun.id, sourceRun.status, status, status === 'ROLLBACK_SUCCESS' ? 'rollback.success' : 'rollback.failed', actorId, sourceRun.tenantId);
    }
  }

  private async resolveApplicationAssetTarget(tenantId: string, binding: CertificateBindingDto): Promise<ApplicationAssetTargetSummaryDto | undefined> {
    const page = await this.assets.getRepository().listApplicationAssetTargets(tenantId, {
      page: 1,
      pageSize: 500,
      filter: { managedTargetId: binding.managedTargetId ?? '' },
      sort: undefined,
    });
    return page.items.find((item) => item.managedTargetId === binding.managedTargetId);
  }

  private async captureSnapshots(
    input: { tenantId: string; executionRunId: string; executionStepId: string; success: boolean; detail?: Record<string, unknown> },
    binding: CertificateBindingDto,
    assetBinding: ApplicationAssetTargetSummaryDto | undefined,
    siteAsset: SiteAssetDto | undefined,
    managedTarget: ManagedTargetDto | undefined,
    detail: Record<string, unknown>,
    resultState: ResultState,
    targetCertificateVersionId?: string,
  ): Promise<void> {
    const base: Omit<CreateManagedTargetSnapshotDto, 'snapshotType'> = {
      applicationAssetId: assetBinding?.applicationAssetId,
      siteAssetId: binding.siteAssetId ?? siteAsset?.id,
      managedTargetId: binding.managedTargetId ?? managedTarget?.id,
      certificateBindingId: binding.id,
      executionRunId: input.executionRunId,
      executionStepId: input.executionStepId,
      bindingInformation: readString(detail, 'binding.bindingInformation') ?? siteAsset?.bindingInformation,
      hostHeader: readString(detail, 'binding.hostHeader') ?? siteAsset?.hostHeader ?? binding.domainName ?? binding.domain,
      port: readNumber(detail, 'binding.port') ?? siteAsset?.port ?? binding.port,
      storeLocation: binding.storeLocation,
      storeName: binding.storeName,
      storeThumbprint: readString(detail, 'oldThumbprint') ?? binding.storeThumbprint,
      certificateVersionId: binding.certificateVersionId,
      fingerprintSha256: binding.observedFingerprintSha256 ?? binding.targetFingerprintSha256,
      status: resultState.snapshotStatus,
      metadata: {
        source: 'agent_task_result',
        resultState: resultState.kind,
      },
    };
    await this.assets.createManagedTargetSnapshot(input.tenantId, {
      ...base,
      snapshotType: 'PRE_DEPLOY',
    });
    await this.assets.createManagedTargetSnapshot(input.tenantId, {
      ...base,
      storeThumbprint: readString(detail, 'newThumbprint') ?? readString(detail, 'verify.remoteThumbprint') ?? binding.storeThumbprint,
      fingerprintSha256: readString(detail, 'verify.remoteCertificateSha256') ?? binding.targetFingerprintSha256 ?? binding.observedFingerprintSha256,
      certificateVersionId: resultState.useTargetCertificate ? (targetCertificateVersionId ?? binding.certificateVersionId) : binding.certificateVersionId,
      snapshotType: resultState.snapshotType,
      metadata: {
        ...(base.metadata ?? {}),
        detail,
      },
    });
  }

  private async writeBindingState(
    input: { tenantId: string },
    binding: CertificateBindingDto,
    detail: Record<string, unknown>,
    resultState: ResultState,
    targetCertificateVersionId?: string,
  ): Promise<void> {
    const targetThumbprint = readString(detail, 'verify.remoteThumbprint') ?? readString(detail, 'newThumbprint') ?? binding.storeThumbprint;
    const observedFingerprint = readString(detail, 'verify.remoteCertificateSha256') ?? binding.targetFingerprintSha256 ?? binding.observedFingerprintSha256;
    await this.bindings.updateCertificateBinding(input.tenantId, binding.id, {
      certificateVersionId: resultState.useTargetCertificate ? (targetCertificateVersionId ?? binding.certificateVersionId) : binding.certificateVersionId,
      targetCertificateVersionId: resultState.useTargetCertificate
        ? (targetCertificateVersionId ?? binding.targetCertificateVersionId ?? binding.certificateVersionId)
        : binding.targetCertificateVersionId,
      observedFingerprintSha256: observedFingerprint,
      storeThumbprint: targetThumbprint ?? binding.storeThumbprint,
      lastVerifiedAt: new Date().toISOString(),
      lastDeployedAt: new Date().toISOString(),
      status: resultState.bindingStatus,
      metadata: {
        ...binding.metadata,
        deploymentResultState: resultState.kind,
        manualInterventionRequired: resultState.manualRequired,
      },
    });
  }

  private async resolveTargetCertificateVersionId(
    tenantId: string,
    step: ExecutionStepEntity,
    binding: CertificateBindingDto,
  ): Promise<string | undefined> {
    const current = readCertificateVersionId(step.inputSnapshot, [
      'deploymentArtifact.certificateVersionId',
      'executionRuntimeSnapshot.deploymentArtifact.certificateVersionId',
      'workflowRequest.certificateVersionId',
    ]);
    if (current) return current;

    const steps = (await this.executions.listSteps(tenantId, step.executionRunId))
      .filter((candidate) => {
        if (step.deploymentPlanTargetId) return candidate.deploymentPlanTargetId === step.deploymentPlanTargetId;
        return readString(candidate.inputSnapshot, 'certificateBindingId') === binding.id;
      })
      .sort((left, right) => right.stepNo - left.stepNo);

    // 先只回溯部署产物快照，避免把其他步骤的旧 workflowRequest 当成新证书。
    const artifactPaths = [
      'deploymentArtifact.certificateVersionId',
      'executionRuntimeSnapshot.deploymentArtifact.certificateVersionId',
    ];
    for (const candidate of steps) {
      const versionId = readCertificateVersionId(candidate.inputSnapshot, artifactPaths);
      if (versionId) return versionId;
    }
    for (const candidate of steps) {
      const versionId = readCertificateVersionId(candidate.inputSnapshot, ['workflowRequest.certificateVersionId']);
      if (versionId) return versionId;
    }
    return binding.targetCertificateVersionId;
  }

  private async writeAssetState(
    input: { tenantId: string },
    assetBinding: ApplicationAssetTargetSummaryDto | undefined,
    siteAsset: SiteAssetDto | undefined,
    managedTarget: ManagedTargetDto | undefined,
    detail: Record<string, unknown>,
    resultState: ResultState,
  ): Promise<void> {
    if (siteAsset) {
      await this.assets.updateSiteAsset(input.tenantId, siteAsset.id, {
        runtimeStatus: resultState.siteRuntimeStatus,
        metadata: {
          ...siteAsset.metadata,
          lastDeploymentResultState: resultState.kind,
          currentThumbprint: readString(detail, 'verify.remoteThumbprint') ?? readString(detail, 'newThumbprint') ?? readString(detail, 'oldThumbprint'),
        },
      });
    }
    if (managedTarget) {
      await this.assets.updateManagedTarget(input.tenantId, managedTarget.id, {
        status: resultState.managedTargetStatus,
        lastSeenAt: new Date().toISOString(),
        metadata: {
          ...managedTarget.metadata,
          lastDeploymentResultState: resultState.kind,
          manualInterventionRequired: resultState.manualRequired,
        },
      });
    }
    if (assetBinding) {
      await this.assets.getRepository().updateApplicationAssetTarget(input.tenantId, assetBinding.id, {
        status: resultState.applicationAssetTargetStatus,
        metadata: {
          ...assetBinding.metadata,
          lastDeploymentResultState: resultState.kind,
          currentThumbprint: readString(detail, 'verify.remoteThumbprint') ?? readString(detail, 'newThumbprint') ?? readString(detail, 'oldThumbprint'),
        },
      });
    }
  }

  private async recordTransitionIfChanged(
    entityType: StateTransitionEventEntity['entityType'],
    entityId: string,
    fromStatus: string | undefined,
    toStatus: string,
    event: string,
    actorId: string,
    tenantId?: string,
  ): Promise<void> {
    if (!this.deploymentPlans || fromStatus === toStatus) return;
    await this.deploymentPlans.createTransition({
      id: newId('ste'),
      tenantId,
      entityType,
      entityId,
      fromStatus,
      toStatus,
      event,
      actorType: 'orchestrator',
      actorId,
      createdAt: new Date().toISOString(),
    });
  }
}

type ResultState = {
  kind: 'DEPLOY_SUCCESS' | 'DEPLOY_FAILED_ROLLED_BACK' | 'DEPLOY_FAILED_MANUAL_REQUIRED';
  snapshotType: CreateManagedTargetSnapshotDto['snapshotType'];
  snapshotStatus: NonNullable<CreateManagedTargetSnapshotDto['status']>;
  bindingStatus: CertificateBindingDto['status'];
  managedTargetStatus: ManagedTargetDto['status'];
  applicationAssetTargetStatus: ApplicationAssetTargetSummaryDto['status'];
  siteRuntimeStatus: string;
  useTargetCertificate: boolean;
  manualRequired: boolean;
};

function deriveResultState(
  runType: ExecutionRunEntity['type'],
  stepType: ExecutionStepEntity['stepType'],
  success: boolean,
  detail: Record<string, unknown>,
  errorCode?: string,
): ResultState {
  const rollbackSucceeded = runType === 'rollback' && (stepType === 'VERIFY' || stepType === 'CUSTOM') && success;
  const rolledBack = rollbackSucceeded || readBoolean(detail, 'rolledBack');
  const manualRequired = readBoolean(detail, 'manualRequired') || readBoolean(detail, 'manualInterventionRequired') || errorCode === 'ROLLBACK_FAILED';
  if (rollbackSucceeded) {
    return {
      kind: 'DEPLOY_FAILED_ROLLED_BACK',
      snapshotType: 'POST_ROLLBACK',
      snapshotStatus: 'ROLLED_BACK',
      bindingStatus: 'DRIFTED',
      managedTargetStatus: 'ACTIVE',
      applicationAssetTargetStatus: 'ERROR',
      siteRuntimeStatus: 'ROLLED_BACK',
      useTargetCertificate: false,
      manualRequired: false,
    };
  }
  if (success) {
    return {
      kind: 'DEPLOY_SUCCESS',
      snapshotType: 'POST_DEPLOY',
      snapshotStatus: 'SUCCESS',
      bindingStatus: 'MANAGED',
      managedTargetStatus: 'ACTIVE',
      applicationAssetTargetStatus: 'ACTIVE',
      siteRuntimeStatus: 'DEPLOYED',
      useTargetCertificate: true,
      manualRequired: false,
    };
  }
  if (rolledBack && !manualRequired) {
    return {
      kind: 'DEPLOY_FAILED_ROLLED_BACK',
      snapshotType: 'POST_ROLLBACK',
      snapshotStatus: 'ROLLED_BACK',
      bindingStatus: 'DRIFTED',
      managedTargetStatus: 'ACTIVE',
      applicationAssetTargetStatus: 'ERROR',
      siteRuntimeStatus: 'ROLLED_BACK',
      useTargetCertificate: false,
      manualRequired: false,
    };
  }
  return {
    kind: 'DEPLOY_FAILED_MANUAL_REQUIRED',
    snapshotType: 'ERROR_STATE',
    snapshotStatus: 'MANUAL_REQUIRED',
    bindingStatus: 'ERROR',
    managedTargetStatus: 'UNREACHABLE',
    applicationAssetTargetStatus: 'ERROR',
    siteRuntimeStatus: 'MANUAL_INTERVENTION_REQUIRED',
    useTargetCertificate: false,
    manualRequired: true,
  };
}

function shouldSyncDeploymentState(
  runType: ExecutionRunEntity['type'],
  step: ExecutionStepEntity,
  success: boolean,
  detail?: Record<string, unknown>,
): boolean {
  if (step.stepType === 'VERIFY') return true;
  if (step.stepType === 'CUSTOM' && (isWorkflowExecutionDetail(detail) || isAgentV2Step(step))) return true;
  if (runType === 'rollback' && step.stepType === 'ROLLBACK' && !success) return true;
  if ((step.stepType === 'INSTALL' || step.stepType === 'RELOAD') && !success) return true;
  return false;
}

function isAgentV2Step(step: ExecutionStepEntity): boolean {
  return agentV2ActionTypes.has(readString(step.inputSnapshot, 'actionType') ?? '');
}

const agentV2ActionTypes = new Set([
  'agent.fact.collect',
  'agent.plan.validate',
  'agent.plan.execute',
  'agent.execution.receipt',
]);

function normalizeWorkflowRollbackDetail(detail: Record<string, unknown>): void {
  if (!isWorkflowExecutionDetail(detail)) return;
  const workflowRun = readRecord(detail.workflowRun);
  const status = readString(workflowRun ?? {}, 'status');
  if (status === 'rolled_back') detail.rolledBack = true;
}

function isWorkflowExecutionDetail(detail: Record<string, unknown> | undefined): boolean {
  if (!detail) return false;
  return readString(detail, 'executionMode') === 'workflow' || Boolean(readRecord(detail.workflowRun));
}

function readRunFailurePolicy(summary: Record<string, unknown>): 'stop' | 'continue' | 'rollback' {
  const value = String(summary.failurePolicy ?? 'stop');
  return value === 'continue' || value === 'rollback' ? value : 'stop';
}

function validateFormalCertificateVerification(
  step: ExecutionStepEntity,
  detail: Record<string, unknown>,
  isDryRun: boolean,
  submittedSuccess: boolean,
): { success: true; detail?: undefined; errorCode?: undefined; errorMessage?: undefined } | { success: false; errorCode: string; errorMessage: string; detail: Record<string, unknown> } {
  if (isDryRun || step.stepType !== 'VERIFY' || !submittedSuccess) return { success: true };

  const verification = readRecord(step.inputSnapshot.certificateVerification);
  const expected = normalizeSha256(readString(verification ?? {}, 'expectedFingerprintSha256'));
  const remote = normalizeSha256(readString(detail, 'verify.remoteCertificateSha256'));
  const remoteThumbprint = normalizeThumbprint(readString(detail, 'verify.remoteThumbprint'));

  if (!expected) {
    return {
      success: false,
      errorCode: 'CERT_VERIFY_EXPECTED_FINGERPRINT_MISSING',
      errorMessage: '正式执行 VERIFY 缺少目标证书 SHA256 指纹，拒绝判定部署成功',
      detail: { expected, remote, remoteThumbprint },
    };
  }
  if (!remote) {
    return {
      success: false,
      errorCode: 'CERT_VERIFY_REMOTE_FINGERPRINT_MISSING',
      errorMessage: '正式执行 VERIFY 缺少远端 TLS 证书 SHA256 指纹，拒绝判定部署成功',
      detail: { expected, remote, remoteThumbprint },
    };
  }
  if (remote !== expected) {
    return {
      success: false,
      errorCode: 'CERT_VERIFY_FINGERPRINT_MISMATCH',
      errorMessage: '正式执行 VERIFY 发现远端 TLS 证书与目标证书不一致',
      detail: { expected, remote, remoteThumbprint },
    };
  }
  return { success: true };
}

function buildAgentFailureWithoutDetails(
  input: { success: boolean; errorCode?: string; errorMessage?: string },
  step: ExecutionStepEntity,
  detail: Record<string, unknown>,
): { errorCode: string; errorMessage: string; detail: Record<string, unknown> } | undefined {
  if (input.success || input.errorCode || input.errorMessage) return undefined;
  const taskId = readString(detail, 'taskId')
    ?? readString(detail, 'agentTaskId')
    ?? readString(step.inputSnapshot, 'dispatchDetail.taskId')
    ?? readString(step.inputSnapshot, 'dispatchDetail.agentTaskId');
  const mode = readString(detail, 'mode');
  const executor = readString(detail, 'executor');
  return {
    errorCode: 'AGENT_TASK_FAILED_WITHOUT_ERROR',
    errorMessage: `Agent 任务失败但未返回错误详情 stepType=${step.stepType}${taskId ? ` taskId=${taskId}` : ''}`,
    detail: {
      stepType: step.stepType,
      taskId,
      mode,
      executor,
      detailKeys: Object.keys(detail),
    },
  };
}

function uniqueTargetIds(steps: ExecutionStepEntity[]): string[] {
  return [...new Set(steps.map((step) => step.deploymentPlanTargetId).filter((id): id is string => Boolean(id)))];
}

function readPath(value: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

function readString(value: Record<string, unknown>, path: string): string | undefined {
  const candidate = readPath(value, path);
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
}

function readCertificateVersionId(value: Record<string, unknown>, paths: readonly string[]): string | undefined {
  for (const path of paths) {
    const versionId = readString(value, path);
    if (versionId) return versionId;
  }
  return undefined;
}

function readNumber(value: Record<string, unknown>, path: string): number | undefined {
  const candidate = readPath(value, path);
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined;
}

function readBoolean(value: Record<string, unknown>, path: string): boolean {
  return readPath(value, path) === true;
}

function normalizeSha256(value: string | undefined): string | undefined {
  const normalized = value?.replaceAll(':', '').trim().toLowerCase();
  return normalized && /^[a-f0-9]{64}$/.test(normalized) ? normalized : undefined;
}

function normalizeProbeFingerprint(value: string | undefined): string | undefined {
  const normalized = value?.replace(/[^a-f0-9]/giu, '').toLowerCase();
  return normalized || undefined;
}

function buildServiceAssetProbeMetadata(probeResult: ProbeServiceAssetResult): Record<string, unknown> {
  const certificate = probeResult.certificate;
  const base: Record<string, unknown> = {
    currentCertificateObservedAt: probeResult.checkedAt,
    currentCertificateProbeStatus: probeResult.status,
    currentCertificateProbeMessage: probeResult.message,
    currentCertificateProbeUrl: probeResult.url,
  };
  if (!certificate) return base;
  const fingerprintSha256 = normalizeProbeFingerprint(certificate.fingerprintSha256);
  return {
    ...base,
    currentFingerprintSha256: fingerprintSha256,
    currentCertificateNotAfter: certificate.notAfter,
    currentCertificateVerified: certificate.verified,
    currentCertificateVerificationError: certificate.verificationError,
    currentCertificate: {
      fingerprintSha256,
      notAfter: certificate.notAfter,
      observedAt: probeResult.checkedAt,
      verified: certificate.verified,
      verificationError: certificate.verificationError,
      source: probeResult.source,
      url: probeResult.url,
    },
  };
}

function normalizeThumbprint(value: string | undefined): string | undefined {
  const normalized = value?.replaceAll(':', '').replaceAll(' ', '').trim().toUpperCase();
  return normalized || undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function hasPersistedUnknownResult(step: ExecutionStepEntity): boolean {
  return String(readRecord(step.inputSnapshot.resultDetail)?.executionStatus ?? '').trim().toUpperCase() === 'UNKNOWN';
}

function resolveAgentExecutionStatus(input: {
  success: boolean;
  status?: AgentSecurityStatus;
  errorCode?: string;
  detail?: Record<string, unknown>;
}): AgentSecurityStatus {
  const detail = input.detail ?? {};
  const receipt = readRecord(detail.receipt);
  const candidates = [input.status, detail.executionStatus, detail.status, receipt?.status];
  if (candidates.some((value) => value === 'UNKNOWN' || value === 'CANCELLED')) return 'UNKNOWN';
  const error = readRecord(detail.error);
  if (detail.mayBeUnknown === true || error?.mayBeUnknown === true || input.errorCode === 'PLUGIN_OPERATION_UNKNOWN_STATE') return 'UNKNOWN';
  const explicit = candidates.find((value): value is AgentSecurityStatus =>
    value === 'SUCCESS' || value === 'FAILED' || value === 'UNKNOWN' || value === 'CANCELLED');
  if (explicit) return explicit;
  return input.success ? 'SUCCESS' : 'FAILED';
}

function readDryRunChecks(detail: Record<string, unknown> | undefined): Record<string, unknown>[] {
  const candidate = detail?.dryRunChecks;
  return Array.isArray(candidate)
    ? candidate.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function mergeDryRunChecks(...groups: ReadonlyArray<readonly Record<string, unknown>[]>): Record<string, unknown>[] {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const checks of groups) {
    for (const check of checks) {
      const key = readString(check, 'key') ?? readString(check, 'label') ?? readString(check, 'id');
      if (!key) continue;
      const existing = byKey.get(key);
      if (!existing || dryRunStatusRank(check.status) >= dryRunStatusRank(existing.status)) {
        byKey.set(key, { ...existing, ...check });
      }
    }
  }
  return [...byKey.values()];
}

function dryRunChecksContainNoFailure(checks: readonly Record<string, unknown>[]): boolean {
  return !checks.some((check) => normalizeDryRunStatus(check.status) === 'failed');
}

function buildDryRunExecutionFailureCheck(
  input: { errorCode?: string; errorMessage?: string },
  step: ExecutionStepEntity,
  detail: Record<string, unknown>,
): Record<string, unknown> {
  const taskId = readString(detail, 'taskId')
    ?? readString(detail, 'agentTaskId')
    ?? readString(step.inputSnapshot, 'dispatchDetail.taskId')
    ?? readString(step.inputSnapshot, 'dispatchDetail.agentTaskId');
  return {
    key: readString(step.inputSnapshot, 'actionType') ?? 'agent.plan.validate',
    label: 'Agent v2 预检结果',
    status: 'failed',
    detail: input.errorMessage?.trim() || 'Agent v2 返回失败状态，但没有提供对应的 failed 预检项',
    evidence: {
      actionType: readString(step.inputSnapshot, 'actionType'),
      stepType: step.stepType,
      taskId,
      errorCode: input.errorCode,
      executor: readString(detail, 'executor'),
      mode: readString(detail, 'mode'),
    },
  };
}

function summarizeDryRunChecks(checks: readonly Record<string, unknown>[]): { passed: number; failed: number; warning: number; unknown: number } {
  const summary = { passed: 0, failed: 0, warning: 0, unknown: 0 };
  for (const check of checks) {
    const status = normalizeDryRunStatus(check.status);
    summary[status] += 1;
  }
  return summary;
}

function normalizeDryRunStatus(value: unknown): 'passed' | 'failed' | 'warning' | 'unknown' {
  const current = String(value ?? '').trim().toLowerCase();
  if (current === 'passed' || current === 'success') return 'passed';
  if (current === 'failed' || current === 'error') return 'failed';
  if (current === 'warning' || current === 'warn') return 'warning';
  return 'unknown';
}

function dryRunStatusRank(value: unknown): number {
  const status = normalizeDryRunStatus(value);
  if (status === 'failed') return 4;
  if (status === 'warning') return 3;
  if (status === 'unknown') return 2;
  return 1;
}
