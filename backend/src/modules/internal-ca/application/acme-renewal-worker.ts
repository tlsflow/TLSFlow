import { AppError } from '../../../common/errors/app-error.js';
import type { RequestContext } from '../../../shared/security-types.js';
import type { DeploymentPlansApplicationService } from '../../deployment-plans/application/deployment-plans.application-service.js';
import type { ExecutionsApplicationService } from '../../executions/application/executions.application-service.js';
import type { ExecutionStepDto } from '../../executions/dto/executions.dto.js';
import type { CertificatesRepository } from '../../certificates/repository/certificates.repository.js';
import type { AcmeRepository } from '../repository/acme.repository.js';
import type { AcmeRenewalJobEntity, AcmeRenewalPolicyEntity } from '../schema/acme.schema.js';
import type { InternalCaApplicationService } from './internal-ca.application-service.js';
import type { CertificateRequestEntity } from '../schema/internal-ca.schema.js';
import { AcmeChallengeService } from './acme-challenge.service.js';
import { AcmeOrderService } from './acme-order.service.js';
import { CertificatePromotionService } from './certificate-promotion.service.js';

export interface AcmeRenewalWorkerDependencies {
  repository: AcmeRepository;
  certificates: CertificatesRepository;
  internalCa: InternalCaApplicationService;
  orders: AcmeOrderService;
  challenges: AcmeChallengeService;
  deployments?: DeploymentPlansApplicationService;
  executions?: ExecutionsApplicationService;
  promotion?: CertificatePromotionService;
  leaseOwner: string;
  now?: () => Date;
}

export class AcmeRenewalWorker {
  private readonly now: () => Date;

  constructor(private readonly dependencies: AcmeRenewalWorkerDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  async runOnce(limit = 10, actorId = 'system:acme-renewal-worker', context?: RequestContext): Promise<AcmeRenewalJobEntity[]> {
    const completed: AcmeRenewalJobEntity[] = [];
    const now = this.now();
    for (const candidate of await this.dependencies.repository.listDueRenewalJobs(now.toISOString(), limit)) {
      const claimed = await this.dependencies.repository.claimRenewalJob(
        candidate.tenantId,
        candidate.id,
        this.dependencies.leaseOwner,
        new Date(now.getTime() + 120_000).toISOString(),
        now.toISOString(),
      );
      if (!claimed) continue;
      try {
        completed.push(await this.process(claimed, actorId, context));
      } catch (error) {
        completed.push(await this.failOrRetry(claimed, error));
      }
    }
    return completed;
  }

  private async process(job: AcmeRenewalJobEntity, actorId: string, context?: RequestContext): Promise<AcmeRenewalJobEntity> {
    const policy = await this.requirePolicy(job);
    const sourceIssuance = await this.dependencies.internalCa.getRepository().getIssuanceByCertificateVersion(job.tenantId, job.sourceCertificateVersionId);
    const sourceRequest = sourceIssuance?.certificateRequestId
      ? await this.dependencies.internalCa.getRepository().getRequest(job.tenantId, sourceIssuance.certificateRequestId)
      : undefined;
    if (!sourceRequest) throw new AppError('ACME_RENEWAL_FAILED', '续签任务缺少源证书申请上下文');

    let current = job;
    let requestId = job.certificateRequestId;
    let issuedRequest: CertificateRequestEntity | undefined;
    if (requestId) {
      const resumedRequest = await this.dependencies.internalCa.getRepository().getRequest(job.tenantId, requestId);
      if (!resumedRequest?.certificateVersionId || !['issued', 'deploying', 'active'].includes(resumedRequest.status)) {
        if (job.certificateVersionId !== job.sourceCertificateVersionId) {
          throw new AppError('ACME_RENEWAL_FAILED', '续签任务已记录新证书版本，但证书申请状态不完整');
        }
      } else {
        issuedRequest = resumedRequest;
      }
    }
    if (!issuedRequest && !requestId) {
      const sourceKey = await this.dependencies.internalCa.getRepository().getKeyReference(job.tenantId, sourceRequest.keyReferenceId);
      if (!sourceKey) throw new AppError('ACME_RENEWAL_FAILED', '续签任务缺少源密钥引用');
      if (policy.rotateKeyOnRenewal && !['managed_secret', 'external_key'].includes(sourceKey.custodyMode)) {
        throw new AppError('ACME_KEY_ROTATION_UNSUPPORTED', '当前密钥托管方式不支持自动轮换');
      }
      const request = await this.dependencies.internalCa.createCertificateRequest(job.tenantId, {
        applicationAssetId: sourceRequest.applicationAssetId,
        caId: sourceRequest.caId,
        trustDomainId: sourceRequest.trustDomainId,
        profileVersionId: sourceRequest.profileVersionId,
        commonName: sourceRequest.subjectCommonName,
        sans: sourceRequest.sans,
        requestedValidityDays: sourceRequest.requestedValidityDays,
        custodyMode: policy.rotateKeyOnRenewal ? 'managed_secret' : sourceKey.custodyMode,
        ...(policy.rotateKeyOnRenewal ? {} : {
          csrPem: sourceRequest.csrPem,
          opaqueKeyReference: sourceKey.secretRef ?? sourceKey.opaqueReference,
          keyBackend: sourceKey.backendType,
          exportability: sourceKey.exportability,
          protectionEvidence: sourceKey.evidence,
        }),
        deferIssuance: true,
        idempotencyKey: `acme-renewal-request:${job.id}`,
        actorId,
      }, context);
      requestId = request.id;
      current = await this.saveJob({ ...current, certificateRequestId: request.id, status: 'issuing' });
    }

    if (!issuedRequest) {
      let order = current.acmeOrderId
        ? await this.dependencies.orders.getEntity(job.tenantId, current.acmeOrderId)
        : undefined;
      if (!order) {
        const created = await this.dependencies.orders.create({
          tenantId: job.tenantId,
          providerId: policy.providerId,
          accountId: policy.accountId,
          certificateRequestId: requestId!,
          challengeType: policy.challengeType,
          idempotencyKey: `acme-renewal-order:${job.id}`,
          actorId,
        });
        current = await this.saveJob({ ...current, acmeOrderId: created.id, status: 'issuing' });
        order = await this.dependencies.orders.getEntity(job.tenantId, created.id);
      }

      const challenges = await this.dependencies.repository.listChallenges(job.tenantId, order.id);
      for (const challenge of challenges.filter((item) => !['valid', 'cleaned'].includes(item.status))) {
        const currentChallenge = ['presented', 'processing'].includes(challenge.status)
          ? await this.dependencies.challenges.refreshFromProvider({
            tenantId: job.tenantId,
            challengeId: challenge.id,
            actorId,
          })
          : await this.dependencies.challenges.presentFromProvider({
            tenantId: job.tenantId,
            challengeId: challenge.id,
            actorId,
            leaseOwner: this.dependencies.leaseOwner,
          });
        if (currentChallenge.status === 'valid') continue;
        await this.saveJob({ ...current, status: 'issuing', nextAttemptAt: new Date(this.now().getTime() + 15_000).toISOString() });
        return this.dependencies.repository.getRenewalJob(job.tenantId, job.id).then((value) => value!);
      }

      if (order.status === 'pending' || order.status === 'processing') {
        const reconciled = await this.dependencies.orders.reconcile(job.tenantId, order.id, actorId);
        await this.saveJob({ ...current, status: 'issuing', nextAttemptAt: reconciled.retryAfterAt ?? new Date(this.now().getTime() + 15_000).toISOString() });
        return this.dependencies.repository.getRenewalJob(job.tenantId, job.id).then((value) => value!);
      }
      if (order.status === 'ready') {
        await this.dependencies.orders.finalize(job.tenantId, order.id, actorId);
        await this.saveJob({ ...current, status: 'issuing', nextAttemptAt: new Date(this.now().getTime() + 15_000).toISOString() });
        return this.dependencies.repository.getRenewalJob(job.tenantId, job.id).then((value) => value!);
      }
      if (order.status !== 'valid') {
        throw new AppError('ACME_ORDER_CONFLICT', 'ACME Order 未进入可下载状态', { status: order.status });
      }

      const material = await this.dependencies.orders.downloadCertificate(job.tenantId, order.id, actorId);
      for (const challenge of challenges.filter((item) => !['cleaned'].includes(item.status))) {
        await this.dependencies.challenges.cleanupFromProvider({
          tenantId: job.tenantId,
          challengeId: challenge.id,
          actorId,
          leaseOwner: this.dependencies.leaseOwner,
        });
      }
      issuedRequest = await this.dependencies.internalCa.importAcmeCertificate(
        job.tenantId,
        requestId!,
        material,
        order.externalOrderUrl,
        actorId,
        context,
      );
      if (!issuedRequest.certificateVersionId) {
        throw new AppError('ACME_RENEWAL_FAILED', 'ACME 签发结果缺少证书版本');
      }
      current = await this.saveJob({
        ...current,
        certificateRequestId: issuedRequest.id,
        certificateVersionId: issuedRequest.certificateVersionId,
        status: 'deploying',
        promotionStatus: 'pending',
        nextAttemptAt: undefined,
      });
    }
    if (!this.dependencies.deployments || !this.dependencies.executions || !this.dependencies.promotion) {
      throw new AppError('ACME_DEPLOYMENT_BLOCKED', 'ACME 证书已暂存，但部署与 Promotion 服务未接入');
    }

    let planId = current.deploymentPlanId;
    if (!planId) {
      const plan = await this.dependencies.deployments.createFromApplicationAsset({
        applicationAssetId: issuedRequest.applicationAssetId,
        targetCertificateVersionId: issuedRequest.certificateVersionId,
        selectionMode: 'EXPLICIT',
        planType: 'UPDATE',
        policy: {
          approvalRequired: policy.deploymentMode === 'approval',
          failurePolicy: 'rollback',
          riskLevel: 'high',
          retry: { maxAttempts: 2, backoffSeconds: policy.backoffSeconds },
        },
        idempotencyKey: `acme-renewal-plan:${job.id}`,
        actorId,
        tenantId: job.tenantId,
      }, context);
      planId = plan.id;
      current = await this.saveJob({ ...current, deploymentPlanId: plan.id });
    }
    let plan = await this.dependencies.deployments.get(planId, job.tenantId);
    if (plan.status === 'DRAFT' || plan.status === 'PENDING_APPROVAL') {
      plan = await this.dependencies.deployments.submit({ planId, actorId, tenantId: job.tenantId }, context);
    }
    if (plan.status === 'PENDING_APPROVAL') {
      return this.saveJob({ ...current, status: 'deploying', nextAttemptAt: new Date(this.now().getTime() + 300_000).toISOString() });
    }
    if (!current.executionRunId) {
      const execution = await this.dependencies.deployments.execute({
        planId,
        actorId,
        tenantId: job.tenantId,
        idempotencyKey: `acme-renewal-execution:${job.id}`,
      }, context);
      return this.saveJob({ ...current, status: 'verifying', executionRunId: execution.run.id, nextAttemptAt: new Date(this.now().getTime() + 15_000).toISOString() });
    }
    const run = await this.dependencies.executions.getRun(current.executionRunId, job.tenantId);
    if (run.status !== 'SUCCESS') {
      if (['FAILED', 'TIMEOUT', 'CANCELLED'].includes(run.status)) throw new AppError('ACME_DEPLOYMENT_BLOCKED', '自动续签部署执行失败', { status: run.status });
      return this.saveJob({ ...current, status: 'verifying', nextAttemptAt: new Date(this.now().getTime() + 15_000).toISOString() });
    }
    const steps: ExecutionStepDto[] = await this.dependencies.executions.listSteps({ tenantId: job.tenantId, executionRunId: current.executionRunId });
    const verification = steps
      .filter((step) => step.stepType === 'VERIFY' && step.status === 'SUCCESS')
      .map((step) => readVerification(step.inputSnapshot))
      .find((value): value is { success: true; certificateFingerprintSha256: string } => Boolean(value?.success && value.certificateFingerprintSha256));
    if (!verification) throw new AppError('ACME_VERIFY_FAILED', '自动续签部署缺少成功的 TLS Verify 证据');
    await this.dependencies.promotion.promote({
      tenantId: job.tenantId,
      certificateVersionId: issuedRequest.certificateVersionId!,
      deploymentPlanId: plan.id,
      executionRunId: current.executionRunId,
      tlsVerify: verification,
      actorId,
    });
    await this.dependencies.internalCa.markRequestActive(job.tenantId, issuedRequest.id);
    return this.saveJob({ ...current, status: 'completed', promotionStatus: 'promoted', nextAttemptAt: undefined });
  }

  private async requirePolicy(job: AcmeRenewalJobEntity): Promise<AcmeRenewalPolicyEntity> {
    if (!job.policyId) throw new AppError('ACME_RENEWAL_FAILED', '续签任务缺少策略引用');
    const policy = await this.dependencies.repository.getPolicy(job.tenantId, job.policyId);
    if (!policy || !policy.enabled || policy.status !== 'active') throw new AppError('ACME_RENEWAL_FAILED', '续签策略不存在或已停用');
    return policy;
  }

  private async saveJob(job: AcmeRenewalJobEntity): Promise<AcmeRenewalJobEntity> {
    return this.dependencies.repository.saveRenewalJob({ ...job, updatedAt: this.now().toISOString() });
  }

  private async failOrRetry(job: AcmeRenewalJobEntity, error: unknown): Promise<AcmeRenewalJobEntity> {
    const policy = job.policyId ? await this.dependencies.repository.getPolicy(job.tenantId, job.policyId) : undefined;
    const attemptCount = job.attemptCount + 1;
    const maxAttempts = policy?.maxAttempts ?? 5;
    const message = error instanceof Error ? error.message : String(error);
    const failureCode = error instanceof AppError ? error.errorCode : 'ACME_RENEWAL_FAILED';
    if (attemptCount >= maxAttempts) {
      return this.saveJob({
        ...job,
        attemptCount,
        status: 'failed',
        failureCode,
        failureMessage: message.slice(0, 500),
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
      });
    }
    const backoffSeconds = policy?.backoffSeconds ?? 300;
    const delay = Math.min(86_400, backoffSeconds * (2 ** Math.max(0, attemptCount - 1)));
    return this.saveJob({
      ...job,
      attemptCount,
      status: 'retry_waiting',
      nextAttemptAt: new Date(this.now().getTime() + delay * 1000).toISOString(),
      failureCode,
      failureMessage: message.slice(0, 500),
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    });
  }
}

function readVerification(input: Record<string, unknown>): { success: true; certificateFingerprintSha256: string } | undefined {
  const detail = input.resultDetail;
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return undefined;
  const verify = (detail as Record<string, unknown>).verify;
  const source = verify && typeof verify === 'object' && !Array.isArray(verify)
    ? verify as Record<string, unknown>
    : detail as Record<string, unknown>;
  const fingerprint = source.remoteCertificateSha256 ?? source.certificateFingerprintSha256 ?? source.fingerprintSha256;
  return source.success === true && typeof fingerprint === 'string' && fingerprint.trim()
    ? { success: true, certificateFingerprintSha256: fingerprint.trim() }
    : undefined;
}
