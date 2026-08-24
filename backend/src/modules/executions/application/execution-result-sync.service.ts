import { createHash, X509Certificate } from 'node:crypto';
import { connect as tlsConnect } from 'node:tls';
import { URL } from 'node:url';
import type { AssetsApplicationService } from '../../assets/application/assets.application-service.js';
import type { ApplicationAssetTargetSummaryDto, CreateManagedTargetSnapshotDto, ManagedTargetDto, ServiceAssetDto, SiteAssetDto } from '../../assets/dto/assets.dto.js';
import type { BindingsApplicationService } from '../../bindings/application/bindings.application-service.js';
import type { CertificateBindingDto } from '../../bindings/dto/bindings.dto.js';
import type { DeploymentPlansRepository } from '../../deployment-plans/repository/deployment-plans.repository.js';
import type { StateTransitionEventEntity } from '../../deployment-plans/schema/deployment-plans.schema.js';
import { newId } from '../../../shared/id.js';
import type { ExecutionsRepository } from '../repository/executions.repository.js';
import type { ExecutionRunEntity, ExecutionStepEntity } from '../schema/executions.schema.js';

type ContinuationRunner = (input: { runId: string; tenantId: string; actorId: string }) => Promise<unknown>;

export class ExecutionResultSyncService {
  private continuationRunner?: ContinuationRunner;

  constructor(
    private readonly executions: ExecutionsRepository,
    private readonly assets: AssetsApplicationService,
    private readonly bindings: BindingsApplicationService,
    private readonly deploymentPlans?: DeploymentPlansRepository,
  ) {}

  setContinuationRunner(runner: ContinuationRunner): void {
    this.continuationRunner = runner;
  }

  async applyAgentTaskResult(input: {
    tenantId: string;
    executionRunId: string;
    executionStepId: string;
    success: boolean;
    errorCode?: string;
    errorMessage?: string;
    detail?: Record<string, unknown>;
    actorId: string;
  }): Promise<void> {
    const step = await this.executions.getStep(input.executionStepId, input.tenantId);
    if (!step) return;
    const run = await this.executions.getRun(input.executionRunId, input.tenantId);
    if (!run) return;

    const mergedDetail = {
      ...((step.inputSnapshot.resultDetail as Record<string, unknown> | undefined) ?? {}),
      ...(input.detail ?? {}),
    };
    const isDryRun = run.type === 'dry_run' || step.inputSnapshot.dryRun === true;
    const allowLegacyVerifyRecovery = shouldRecoverLegacyVerifyFailure(step, input, mergedDetail, isDryRun);
    const remoteVerification = await this.performFormalRemoteVerification(
      step,
      mergedDetail,
      isDryRun,
      input.success || allowLegacyVerifyRecovery,
      input.tenantId,
    );
    const certificateVerification = validateFormalCertificateVerification(
      step,
      mergedDetail,
      isDryRun,
      input.success || allowLegacyVerifyRecovery,
    );
    const recoveredFromLegacyVerifyFailure = !input.success
      && allowLegacyVerifyRecovery
      && remoteVerification.success
      && certificateVerification.success;
    const effectiveSuccess = (input.success || recoveredFromLegacyVerifyFailure)
      && remoteVerification.success
      && certificateVerification.success;
    const fallbackFailure = recoveredFromLegacyVerifyFailure
      ? undefined
      : buildFallbackAgentFailure(input, step, mergedDetail);
    const effectiveErrorCode = recoveredFromLegacyVerifyFailure
      ? undefined
      : input.errorCode ?? remoteVerification.errorCode ?? certificateVerification.errorCode ?? fallbackFailure?.errorCode;
    const effectiveErrorMessage = recoveredFromLegacyVerifyFailure
      ? undefined
      : input.errorMessage ?? remoteVerification.errorMessage ?? certificateVerification.errorMessage ?? fallbackFailure?.errorMessage;
    if (!remoteVerification.success) {
      mergedDetail.remoteVerification = remoteVerification.detail;
    }
    if (!certificateVerification.success) {
      mergedDetail.certificateVerification = certificateVerification.detail;
    }
    if (recoveredFromLegacyVerifyFailure) {
      mergedDetail.verificationRecovery = {
        source: 'control_plane_tls_probe',
        recoveredAt: new Date().toISOString(),
        originalErrorCode: input.errorCode,
        originalErrorMessage: input.errorMessage,
      };
    }
    if (fallbackFailure) {
      mergedDetail.failure = fallbackFailure.detail;
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
    await this.executions.updateStep(step.id, {
      status: nextStepStatus,
      lastErrorCode: effectiveErrorCode,
      lastErrorMessage: effectiveErrorMessage,
      finishedAt: now,
      updatedAt: now,
      updatedBy: input.actorId,
      inputSnapshot: {
        ...step.inputSnapshot,
        resultDetail: mergedDetail,
      },
    });
    await this.recordTransitionIfChanged('executionStep', step.id, step.status, nextStepStatus, effectiveSuccess ? 'agent.step.success' : 'agent.step.failed', input.actorId, step.tenantId);

    let resultState: ResultState | undefined;
    if (!isDryRun) {
      resultState = await this.syncDeploymentAssets({ ...input, success: effectiveSuccess, errorCode: effectiveErrorCode }, step, mergedDetail);
    }

    const latestSteps = await this.executions.listSteps(input.tenantId, run.id);
    const hasFailed = latestSteps.some((item) => item.status === 'FAILED' || item.status === 'TIMEOUT');
    const allFinished = latestSteps.every((item) => ['SUCCESS', 'FAILED', 'TIMEOUT', 'SKIPPED'].includes(item.status));
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
    await this.recordTransitionIfChanged('executionRun', run.id, run.status, nextRunStatus, hasFailed ? 'agent.run.failed' : 'agent.run.success', input.actorId, run.tenantId);
    if (!isDryRun) {
      await this.syncDeploymentPlanAfterRun(finishedRun, latestSteps, input.actorId, input.tenantId);
    }
  }

  private async performFormalRemoteVerification(
    step: ExecutionStepEntity,
    detail: Record<string, unknown>,
    isDryRun: boolean,
    submittedSuccess: boolean,
    tenantId: string,
  ): Promise<{ success: true; detail?: undefined; errorCode?: undefined; errorMessage?: undefined } | { success: false; errorCode: string; errorMessage: string; detail: Record<string, unknown> }> {
    if (isDryRun || step.stepType !== 'VERIFY' || !submittedSuccess) return { success: true };

    const existingRemoteFingerprint = normalizeSha256(readString(detail, 'verify.remoteCertificateSha256'));
    if (existingRemoteFingerprint) return { success: true };

    const target = await this.resolveVerifyTarget(tenantId, step);
    if (!target) {
      return {
        success: false,
        errorCode: 'TLS_VERIFY_TARGET_UNRESOLVED',
        errorMessage: '正式执行 VERIFY 缺少可访问的验证目标，无法发起真实 TLS 验证',
        detail: {
          executionStepId: step.id,
          deploymentPlanTargetId: step.deploymentPlanTargetId,
        },
      };
    }

    try {
      const report = await probeTlsCertificate(target);
      detail.verify = {
        ...readRecord(detail.verify),
        ...report,
      };
      if (!readString(detail, 'newThumbprint') && report.remoteThumbprint) {
        detail.newThumbprint = report.remoteThumbprint;
      }

      const expectedDomains = readStringArray(step.inputSnapshot.expectedDomains);
      for (const domain of expectedDomains) {
        const normalizedDomain = domain.trim();
        if (!normalizedDomain) continue;
        if (!report.matchesDomainNames.includes(normalizedDomain.toLowerCase())) {
          return {
            success: false,
            errorCode: 'TLS_VERIFY_DOMAIN_MISMATCH',
            errorMessage: `正式执行 VERIFY 发现远端 TLS 证书域名不匹配: ${normalizedDomain}`,
            detail: {
              target,
              report,
              expectedDomains,
            },
          };
        }
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        errorCode: 'TLS_VERIFY_FAILED',
        errorMessage: error instanceof Error ? error.message : String(error),
        detail: {
          target,
        },
      };
    }
  }

  private async resolveVerifyTarget(tenantId: string, step: ExecutionStepEntity): Promise<TlsVerifyTarget | undefined> {
    const verifyUrl = readString(step.inputSnapshot, 'verifyUrl');
    if (verifyUrl) {
      return buildTlsVerifyTargetFromUrl(verifyUrl);
    }

    const bindingId = typeof step.inputSnapshot.certificateBindingId === 'string' ? step.inputSnapshot.certificateBindingId : undefined;
    const binding = bindingId ? await this.bindings.getRepository().getCertificateBinding(tenantId, bindingId) : undefined;
    const siteAsset = binding?.siteAssetId ? await this.assets.getRepository().getSiteAsset(tenantId, binding.siteAssetId) : undefined;
    const managedTarget = binding?.managedTargetId ? await this.assets.getRepository().getManagedTarget(tenantId, binding.managedTargetId) : undefined;
    const serviceAsset = await this.resolveServiceAssetForVerify(tenantId, step, binding, siteAsset, managedTarget);

    const host = firstNonEmpty(
      serviceAsset?.address,
      siteAsset?.hostHeader,
      binding?.domainName,
      binding?.domain,
      readString(step.inputSnapshot, 'bindingSelector.hostHeader'),
    );
    const port = firstPositiveNumber(
      serviceAsset?.port,
      siteAsset?.port,
      binding?.port,
      readNumber(step.inputSnapshot, 'bindingSelector.port'),
      443,
    );
    if (!host || !port) return undefined;

    return {
      host,
      port,
      serverName: firstNonEmpty(
        serviceAsset?.sniName,
        siteAsset?.hostHeader,
        binding?.domainName,
        binding?.domain,
        host,
      ) ?? host,
      target: `https://${host}:${port}`,
    };
  }

  private async resolveServiceAssetForVerify(
    tenantId: string,
    step: ExecutionStepEntity,
    binding: CertificateBindingDto | undefined,
    siteAsset: SiteAssetDto | undefined,
    managedTarget: ManagedTargetDto | undefined,
  ): Promise<ServiceAssetDto | undefined> {
    const repository = this.assets.getRepository();
    const directServiceAssetId = binding?.serviceAssetId
      ?? siteAsset?.serviceAssetId
      ?? managedTarget?.serviceAssetId
      ?? readString(step.inputSnapshot, 'serviceAssetId');
    if (directServiceAssetId) {
      const direct = await repository.getServiceAsset(tenantId, directServiceAssetId);
      if (direct) return direct;
    }

    const host = firstNonEmpty(
      siteAsset?.hostHeader,
      binding?.domainName,
      binding?.domain,
      readString(step.inputSnapshot, 'bindingSelector.hostHeader'),
    )?.toLowerCase();
    const port = firstPositiveNumber(
      siteAsset?.port,
      binding?.port,
      readNumber(step.inputSnapshot, 'bindingSelector.port'),
    );
    const protocol = typeof binding?.protocol === 'string' && binding.protocol.trim() ? binding.protocol : 'HTTPS';
    if (!host || !port) return undefined;
    return repository.findServiceAssetByIdentity(tenantId, { address: host, port, protocol });
  }

  private async continueRunAfterAgentResult(run: ExecutionRunEntity, actorId: string, tenantId: string): Promise<void> {
    if (!this.continuationRunner) return;
    if (!['DISPATCHED', 'RUNNING'].includes(run.status)) return;
    await this.continuationRunner({ runId: run.id, tenantId, actorId });
  }

  private async syncDeploymentAssets(
    input: { tenantId: string; executionRunId: string; executionStepId: string; success: boolean; errorCode?: string; detail?: Record<string, unknown> },
    step: ExecutionStepEntity,
    detail: Record<string, unknown>,
  ): Promise<ResultState | undefined> {
    const bindingId = typeof step.inputSnapshot.certificateBindingId === 'string' ? step.inputSnapshot.certificateBindingId : undefined;
    if (!bindingId) return undefined;

    const binding = await this.bindings.getRepository().getCertificateBinding(input.tenantId, bindingId);
    if (!binding) return undefined;

    const resultState = deriveResultState(input.success, detail, input.errorCode);
    const assetBinding = await this.resolveApplicationAssetTarget(input.tenantId, binding);
    const siteAsset = binding.siteAssetId ? await this.assets.getRepository().getSiteAsset(input.tenantId, binding.siteAssetId) : undefined;
    const managedTarget = binding.managedTargetId ? await this.assets.getRepository().getManagedTarget(input.tenantId, binding.managedTargetId) : undefined;

    await this.captureSnapshots(input, binding, assetBinding, siteAsset, managedTarget, detail, resultState);
    await this.writeBindingState(input, binding, detail, resultState);
    await this.writeAssetState(input, assetBinding, siteAsset, managedTarget, detail, resultState);
    return resultState;
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
      filter: { managedTargetId: binding.managedTargetId ?? '', siteAssetId: binding.siteAssetId ?? '' },
      sort: undefined,
    });
    return page.items.find((item) => item.managedTargetId === binding.managedTargetId || item.siteAssetId === binding.siteAssetId);
  }

  private async captureSnapshots(
    input: { tenantId: string; executionRunId: string; executionStepId: string; success: boolean; detail?: Record<string, unknown> },
    binding: CertificateBindingDto,
    assetBinding: ApplicationAssetTargetSummaryDto | undefined,
    siteAsset: SiteAssetDto | undefined,
    managedTarget: ManagedTargetDto | undefined,
    detail: Record<string, unknown>,
    resultState: ResultState,
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
      fingerprintSha256: binding.targetFingerprintSha256 ?? binding.observedFingerprintSha256,
      certificateVersionId: resultState.useTargetCertificate ? (binding.targetCertificateVersionId ?? binding.certificateVersionId) : binding.certificateVersionId,
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
  ): Promise<void> {
    const targetThumbprint = readString(detail, 'verify.remoteThumbprint') ?? readString(detail, 'newThumbprint') ?? binding.storeThumbprint;
    await this.bindings.updateCertificateBinding(input.tenantId, binding.id, {
      certificateVersionId: resultState.useTargetCertificate ? (binding.targetCertificateVersionId ?? binding.certificateVersionId) : binding.certificateVersionId,
      observedFingerprintSha256: binding.targetFingerprintSha256 ?? binding.observedFingerprintSha256,
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

type TlsVerifyTarget = {
  host: string;
  port: number;
  serverName: string;
  target: string;
};

function deriveResultState(success: boolean, detail: Record<string, unknown>, errorCode?: string): ResultState {
  const rolledBack = readBoolean(detail, 'rolledBack');
  const manualRequired = readBoolean(detail, 'manualRequired') || readBoolean(detail, 'manualInterventionRequired') || errorCode === 'ROLLBACK_FAILED';
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

function validateFormalCertificateVerification(
  step: ExecutionStepEntity,
  detail: Record<string, unknown>,
  isDryRun: boolean,
  submittedSuccess: boolean,
): { success: true; detail?: undefined; errorCode?: undefined; errorMessage?: undefined } | { success: false; errorCode: string; errorMessage: string; detail: Record<string, unknown> } {
  if (isDryRun || step.stepType !== 'VERIFY' || !submittedSuccess) return { success: true };

  const expected = normalizeSha256(readString(step.inputSnapshot, 'expectedCertificateFingerprintSha256')
    ?? readString(step.inputSnapshot, 'deploymentArtifact.expectedFingerprintSha256'));
  const actual = normalizeSha256(readString(detail, 'verify.remoteCertificateSha256')
    ?? readString(detail, 'verify.remoteFingerprintSha256')
    ?? readString(detail, 'remoteCertificateSha256'));
  const remoteThumbprint = normalizeThumbprint(readString(detail, 'verify.remoteThumbprint'));
  const deployedThumbprint = normalizeThumbprint(readString(detail, 'newThumbprint'));

  if (!expected) {
    return {
      success: false,
      errorCode: 'CERT_VERIFY_EXPECTED_FINGERPRINT_MISSING',
      errorMessage: '正式执行 VERIFY 缺少目标证书 SHA256 指纹，拒绝判定部署成功',
      detail: { expected, actual, remoteThumbprint, deployedThumbprint },
    };
  }
  if (!actual) {
    return {
      success: false,
      errorCode: 'CERT_VERIFY_REMOTE_FINGERPRINT_MISSING',
      errorMessage: '正式执行 VERIFY 缺少远端 TLS 证书 SHA256 指纹，拒绝判定部署成功',
      detail: { expected, actual, remoteThumbprint, deployedThumbprint },
    };
  }
  if (actual !== expected) {
    return {
      success: false,
      errorCode: 'CERT_VERIFY_FINGERPRINT_MISMATCH',
      errorMessage: '正式执行 VERIFY 发现远端 TLS 证书与目标证书不一致',
      detail: { expected, actual, remoteThumbprint, deployedThumbprint },
    };
  }
  if (remoteThumbprint && deployedThumbprint && remoteThumbprint !== deployedThumbprint) {
    return {
      success: false,
      errorCode: 'CERT_VERIFY_THUMBPRINT_MISMATCH',
      errorMessage: '正式执行 VERIFY 发现远端 TLS 证书 thumbprint 与本次导入证书不一致',
      detail: { expected, actual, remoteThumbprint, deployedThumbprint },
    };
  }
  return { success: true };
}

function buildFallbackAgentFailure(
  input: { success: boolean; errorCode?: string; errorMessage?: string },
  step: ExecutionStepEntity,
  detail: Record<string, unknown>,
): { errorCode: string; errorMessage: string; detail: Record<string, unknown> } | undefined {
  if (input.success || input.errorCode || input.errorMessage) return undefined;
  const taskId = readString(detail, 'taskId') ?? readString(step.inputSnapshot, 'dispatchDetail.taskId');
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

function shouldRecoverLegacyVerifyFailure(
  step: ExecutionStepEntity,
  input: { success: boolean; errorCode?: string; errorMessage?: string },
  detail: Record<string, unknown>,
  isDryRun: boolean,
): boolean {
  if (isDryRun || step.stepType !== 'VERIFY' || input.success) return false;
  const mode = readString(detail, 'mode');
  const executor = readString(detail, 'executor');
  const bindingThumbprint = normalizeThumbprint(readString(detail, 'verify.bindingThumbprint'));
  const currentThumbprint = normalizeThumbprint(readString(detail, 'binding.currentThumbprint'));
  const hasLocalBindingEvidence = Boolean(bindingThumbprint || currentThumbprint);
  if (!hasLocalBindingEvidence) return false;
  if (executor !== 'windows-iis-provider') return false;
  if (mode !== 'iis_tls_verify' && mode !== 'iis_binding_verify') return false;

  const code = (input.errorCode ?? '').trim().toUpperCase();
  const message = (input.errorMessage ?? '').trim();
  return code === 'TLS_VERIFY_FAILED'
    || code === 'TLS_VERIFY_DOMAIN_MISMATCH'
    || message.includes('TLS 连接失败')
    || message.includes('TLS 连接超时')
    || message.includes('证书验证失败');
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

function normalizeThumbprint(value: string | undefined): string | undefined {
  const normalized = value?.replaceAll(':', '').replaceAll(' ', '').trim().toUpperCase();
  return normalized || undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : [];
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function firstPositiveNumber(...values: Array<number | undefined>): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

function buildTlsVerifyTargetFromUrl(verifyUrl: string): TlsVerifyTarget {
  const parsed = new URL(verifyUrl);
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
  if (!parsed.hostname || !port) {
    throw new Error(`verifyUrl 无法解析为有效 TLS 目标: ${verifyUrl}`);
  }
  return {
    host: parsed.hostname,
    port,
    serverName: parsed.hostname,
    target: verifyUrl,
  };
}

async function probeTlsCertificate(target: TlsVerifyTarget): Promise<Record<string, unknown> & { remoteCertificateSha256: string; remoteThumbprint: string; matchesDomainNames: string[] }> {
  return new Promise((resolve, reject) => {
    const socket = tlsConnect({
      host: target.host,
      port: target.port,
      servername: target.serverName,
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2',
      timeout: 15_000,
    });

    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    socket.once('timeout', () => {
      cleanup();
      reject(new Error(`TLS 连接超时: ${target.host}:${target.port}`));
    });

    socket.once('error', (error) => {
      cleanup();
      reject(new Error(`TLS 连接失败: ${error.message}`));
    });

    socket.once('secureConnect', () => {
      try {
        const peer = socket.getPeerX509Certificate();
        if (!peer) {
          cleanup();
          reject(new Error('TLS 握手成功但未返回远端证书'));
          return;
        }
        const raw = peer.raw;
        const thumbprint = createHash('sha1').update(raw).digest('hex').toUpperCase();
        const certificateSha256 = createHash('sha256').update(raw).digest('hex').toLowerCase();
        const x509 = new X509Certificate(raw);
        const san = x509.subjectAltName ?? '';
        const dnsNames = san
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item.startsWith('DNS:'))
          .map((item) => item.slice(4).trim())
          .filter(Boolean);
        const subject = peer.subject ? Object.entries(peer.subject).map(([key, value]) => `${key}=${String(value)}`).join(', ') : '';
        const issuer = peer.issuer ? Object.entries(peer.issuer).map(([key, value]) => `${key}=${String(value)}`).join(', ') : '';
        cleanup();
        resolve({
          target: target.target,
          address: `${target.host}:${target.port}`,
          serverName: target.serverName,
          remoteThumbprint: thumbprint,
          remoteCertificateSha256: certificateSha256,
          subject,
          issuer,
          notAfter: peer.validTo ? new Date(peer.validTo).toISOString() : undefined,
          dnsNames,
          matchesDomainNames: [...new Set([target.serverName.toLowerCase(), ...dnsNames.map((item) => item.toLowerCase())])],
          verifiedAt: new Date().toISOString(),
        });
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}
