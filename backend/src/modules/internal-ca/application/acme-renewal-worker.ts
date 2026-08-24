import { AppError } from '../../../common/errors/app-error.js';
import type { RequestContext } from '../../../shared/security-types.js';
import type { CertificatesRepository } from '../../certificates/repository/certificates.repository.js';
import type { AcmeRepository } from '../repository/acme.repository.js';
import type { AcmeRenewalJobEntity, AcmeRenewalPolicyEntity } from '../schema/acme.schema.js';
import type { InternalCaApplicationService } from './internal-ca.application-service.js';
import type { CertificateRequestEntity } from '../schema/internal-ca.schema.js';
import { AcmeChallengeService } from './acme-challenge.service.js';
import { AcmeOrderService } from './acme-order.service.js';
import type { LegoDnsIssuer } from '../providers/lego-dns-issuer.js';

const nonRetryableRenewalErrorCodes = new Set<string>([
  'VALIDATION_FAILED',
  'RESOURCE_NOT_FOUND',
  'CAPABILITY_MISSING',
  'ACME_PROVIDER_CONFIG_INVALID',
  'ACME_KEY_ROTATION_UNSUPPORTED',
]);

export interface AcmeRenewalWorkerDependencies {
  repository: AcmeRepository;
  certificates: CertificatesRepository;
  internalCa: InternalCaApplicationService;
  orders: AcmeOrderService;
  challenges: AcmeChallengeService;
  lego?: LegoDnsIssuer;
  leaseOwner: string;
  leaseDurationMs?: number;
  now?: () => Date;
}

export class AcmeRenewalWorker {
  private readonly now: () => Date;
  private readonly leaseDurationMs: number;
  private runChain: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: AcmeRenewalWorkerDependencies) {
    this.now = dependencies.now ?? (() => new Date());
    this.leaseDurationMs = dependencies.leaseDurationMs ?? 900_000;
  }

  async runOnce(limit = 10, actorId = 'system:acme-renewal-worker', context?: RequestContext): Promise<AcmeRenewalJobEntity[]> {
    return this.withRunLock(async () => {
      const completed: AcmeRenewalJobEntity[] = [];
      const now = this.now();
      for (const candidate of await this.dependencies.repository.listDueRenewalJobs(now.toISOString(), limit)) {
        const claimed = await this.claim(candidate.tenantId, candidate.id, now);
        if (!claimed) continue;
        completed.push(await this.processClaimed(claimed, actorId, context));
      }
      return completed;
    });
  }

  /**
   * 手动触发指定任务时直接按 ID claim，避免通用 due 查询先处理了其他任务。
   * 任务是否仍可执行由数据库中的状态、退避时间和租约条件最终决定。
   */
  async runJob(
    tenantId: string,
    jobId: string,
    actorId = 'system:acme-renewal-worker',
    context?: RequestContext,
  ): Promise<AcmeRenewalJobEntity | undefined> {
    return this.withRunLock(async () => {
      const now = this.now();
      const claimed = await this.claim(tenantId, jobId, now);
      if (!claimed) return undefined;
      return this.processClaimed(claimed, actorId, context);
    });
  }

  private async claim(tenantId: string, jobId: string, now: Date): Promise<AcmeRenewalJobEntity | undefined> {
    return this.dependencies.repository.claimRenewalJob(
      tenantId,
      jobId,
      this.dependencies.leaseOwner,
      new Date(now.getTime() + this.leaseDurationMs).toISOString(),
      now.toISOString(),
    );
  }

  private async processClaimed(
    claimed: AcmeRenewalJobEntity,
    actorId: string,
    context?: RequestContext,
  ): Promise<AcmeRenewalJobEntity> {
    try {
      return await this.process(claimed, actorId, context);
    } catch (error) {
      // 签发过程中会先持久化新建的申请或订单。失败时必须基于最新状态回写，
      // 否则会用 claim 时的旧快照覆盖这些关联，导致后续无法诊断或恢复任务。
      const getRenewalJob = this.dependencies.repository.getRenewalJob;
      const latest = typeof getRenewalJob === 'function'
        ? await getRenewalJob.call(this.dependencies.repository, claimed.tenantId, claimed.id)
        : undefined;
      if (latest?.status === 'cancelled') return latest;
      return this.failOrRetry(latest ?? claimed, error);
    }
  }

  private async withRunLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.runChain;
    let release!: () => void;
    this.runChain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async process(job: AcmeRenewalJobEntity, actorId: string, context?: RequestContext): Promise<AcmeRenewalJobEntity> {
    await this.assertNotCancelled(job);
    const policy = await this.requirePolicy(job);
    const configuredDomains = stringValues(policy.maintenanceWindow?.domains);
    const initialIssuance = !job.sourceCertificateVersionId;
    const sourceIssuance = initialIssuance
      ? undefined
      : await this.dependencies.internalCa.getRepository().getIssuanceByCertificateVersion(job.tenantId, job.sourceCertificateVersionId!);
    let sourceRequest = sourceIssuance?.certificateRequestId
      ? await this.dependencies.internalCa.getRepository().getRequest(job.tenantId, sourceIssuance.certificateRequestId)
      : undefined;

    let current = job;
    let requestId = job.certificateRequestId;
    let issuedRequest: CertificateRequestEntity | undefined;
    let recreateRequest = false;
    if (requestId) {
      const resumedRequest = await this.dependencies.internalCa.getRepository().getRequest(job.tenantId, requestId);
      if (!resumedRequest?.certificateVersionId || !['issued', 'deploying', 'active'].includes(resumedRequest.status)) {
        if (job.certificateVersionId !== job.sourceCertificateVersionId) {
          throw new AppError('ACME_RENEWAL_FAILED', '续签任务已记录新证书版本，但证书申请状态不完整');
        }
      } else {
        const version = await this.dependencies.certificates.getVersion(resumedRequest.certificateVersionId, job.tenantId);
        if (version?.status === 'active') {
          issuedRequest = resumedRequest;
        } else {
          // 证书版本被手动删除或已不可用时，历史申请不能再被当作签发成功。
          // 清除引用后由当前任务创建新的申请，避免无限重试已经失效的版本 ID。
          requestId = undefined;
          recreateRequest = true;
          current = await this.saveJob({
            ...current,
            certificateRequestId: undefined,
            certificateVersionId: undefined,
            acmeOrderId: undefined,
            status: 'issuing',
            failureCode: undefined,
            failureMessage: undefined,
            nextAttemptAt: undefined,
          });
        }
      }
    }
    if (!issuedRequest && !requestId && (initialIssuance || !sourceRequest)) {
      const assetId = policy.certificateAssetId;
      const asset = assetId ? await this.dependencies.certificates.getAsset(assetId, job.tenantId) : undefined;
      if (!asset) throw new AppError('ACME_RENEWAL_FAILED', '续签任务缺少源证书申请上下文');
      await this.assertNotCancelled(current);
      const issuanceContext = await this.dependencies.internalCa.ensureAcmeIssuanceContext(
        job.tenantId,
        policy.providerId,
        actorId,
      );
      const request = await this.dependencies.internalCa.createCertificateRequest(job.tenantId, {
        applicationAssetId: asset.id,
        caId: issuanceContext.caId,
        trustDomainId: issuanceContext.trustDomainId,
        profileVersionId: issuanceContext.profileVersionId,
        commonName: configuredDomains[0] ?? asset.primaryDomain,
        sans: configuredDomains.length > 0 ? configuredDomains.slice(1) : asset.sans,
        requestedValidityDays: 90,
        custodyMode: 'managed_secret',
        deferIssuance: true,
        idempotencyKey: renewalRequestIdempotencyKey(job, recreateRequest),
        actorId,
      }, context);
      requestId = request.id;
      current = await this.saveJob({ ...current, certificateRequestId: request.id, status: 'issuing' });
      sourceRequest = request;
    }
    if (!issuedRequest && !requestId && !initialIssuance) {
      const sourceKey = await this.dependencies.internalCa.getRepository().getKeyReference(job.tenantId, sourceRequest!.keyReferenceId);
      if (!sourceKey) throw new AppError('ACME_RENEWAL_FAILED', '续签任务缺少源密钥引用');
      if (policy.rotateKeyOnRenewal && !['managed_secret', 'external_key'].includes(sourceKey.custodyMode)) {
        throw new AppError('ACME_KEY_ROTATION_UNSUPPORTED', '当前密钥托管方式不支持自动轮换');
      }
      await this.assertNotCancelled(current);
      const request = await this.dependencies.internalCa.createCertificateRequest(job.tenantId, {
        applicationAssetId: sourceRequest!.applicationAssetId,
        caId: sourceRequest!.caId,
        trustDomainId: sourceRequest!.trustDomainId,
        profileVersionId: sourceRequest!.profileVersionId,
        commonName: configuredDomains[0] ?? sourceRequest!.subjectCommonName,
        sans: configuredDomains.length > 0 ? configuredDomains.slice(1) : sourceRequest!.sans,
        requestedValidityDays: sourceRequest!.requestedValidityDays,
        custodyMode: policy.rotateKeyOnRenewal ? 'managed_secret' : sourceKey.custodyMode,
        ...(policy.rotateKeyOnRenewal ? {} : {
          csrPem: sourceRequest!.csrPem,
          opaqueKeyReference: sourceKey.secretRef ?? sourceKey.opaqueReference,
          keyBackend: sourceKey.backendType,
          exportability: sourceKey.exportability,
          protectionEvidence: sourceKey.evidence,
        }),
        deferIssuance: true,
        idempotencyKey: renewalRequestIdempotencyKey(job, recreateRequest),
        actorId,
      }, context);
      requestId = request.id;
      current = await this.saveJob({ ...current, certificateRequestId: request.id, status: 'issuing' });
    }

    if (!issuedRequest) {
      await this.assertNotCancelled(current);
      if (policy.challengeType === 'dns-01') {
        if (!this.dependencies.lego) {
          throw new AppError('CAPABILITY_MISSING', 'DNS-01 lego 执行器未接入');
        }
        const dnsProvider = textValue(policy.maintenanceWindow?.dnsProvider);
        const dnsCredentialId = textValue(policy.maintenanceWindow?.dnsCredentialId);
        const contactEmail = textValue(policy.maintenanceWindow?.contactEmail);
        const propagationSeconds = numberValue(policy.maintenanceWindow?.dnsPropagationSeconds);
        if (!dnsProvider || !dnsCredentialId || !contactEmail) {
          throw new AppError('ACME_PROVIDER_CONFIG_INVALID', 'DNS-01 策略缺少 lego 所需配置');
        }
        const provider = await this.dependencies.internalCa.getRepository().getProvider(job.tenantId, policy.providerId);
        if (!provider || provider.type !== 'acme') {
          throw new AppError('RESOURCE_NOT_FOUND', 'ACME Provider 不存在', { providerId: policy.providerId });
        }
        const issuanceRequest = await this.dependencies.internalCa.getRepository().getRequest(job.tenantId, requestId!);
        if (!issuanceRequest) {
          throw new AppError('ACME_RENEWAL_FAILED', 'DNS-01 续签缺少待签发证书申请');
        }
        const cancellation = this.watchCancellation(current);
        let material;
        try {
          material = await this.dependencies.lego.issue({
            tenantId: job.tenantId,
            jobId: job.id,
            request: issuanceRequest,
            provider,
            dnsProviderId: dnsProvider,
            dnsCredentialId,
            contactEmail,
            ...(propagationSeconds === undefined ? {} : { propagationSeconds }),
            actorId,
            signal: cancellation?.signal,
          });
        } finally {
          cancellation?.dispose();
        }
        await this.assertNotCancelled(current);
        issuedRequest = await this.dependencies.internalCa.importAcmeCertificate(
          job.tenantId,
          requestId!,
          material,
          `lego:${job.id}`,
          actorId,
          context,
        );
        if (!issuedRequest.certificateVersionId) {
          throw new AppError('ACME_RENEWAL_FAILED', 'lego 签发结果缺少证书版本');
        }
      }
    }
    if (!issuedRequest) {
      let order = current.acmeOrderId
        ? await this.dependencies.orders.getEntity(job.tenantId, current.acmeOrderId)
        : undefined;
      if (!order) {
        await this.assertNotCancelled(current);
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
        await this.assertNotCancelled(current);
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
        await this.assertNotCancelled(current);
        const reconciled = await this.dependencies.orders.reconcile(job.tenantId, order.id, actorId);
        await this.saveJob({ ...current, status: 'issuing', nextAttemptAt: reconciled.retryAfterAt ?? new Date(this.now().getTime() + 15_000).toISOString() });
        return this.dependencies.repository.getRenewalJob(job.tenantId, job.id).then((value) => value!);
      }
      if (order.status === 'ready') {
        await this.assertNotCancelled(current);
        await this.dependencies.orders.finalize(job.tenantId, order.id, actorId);
        await this.saveJob({ ...current, status: 'issuing', nextAttemptAt: new Date(this.now().getTime() + 15_000).toISOString() });
        return this.dependencies.repository.getRenewalJob(job.tenantId, job.id).then((value) => value!);
      }
      if (order.status !== 'valid') {
        throw new AppError('ACME_ORDER_CONFLICT', 'ACME Order 未进入可下载状态', { status: order.status });
      }

      const material = await this.dependencies.orders.downloadCertificate(job.tenantId, order.id, actorId);
      await this.assertNotCancelled(current);
      for (const challenge of challenges.filter((item) => !['cleaned'].includes(item.status))) {
        await this.dependencies.challenges.cleanupFromProvider({
          tenantId: job.tenantId,
          challengeId: challenge.id,
          actorId,
          leaseOwner: this.dependencies.leaseOwner,
        });
      }
      await this.assertNotCancelled(current);
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
    }
    return this.completeIssuedJob(current, issuedRequest);
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

  /**
   * ACME 签发出来的版本先处于 staged；未提升为当前版本前，资产仍会展示旧证书的到期时间。
   * 因此只有 Promotion 成功后，续签任务才能进入 completed 终态。
   */
  private async completeIssuedJob(
    job: AcmeRenewalJobEntity,
    issuedRequest: CertificateRequestEntity,
  ): Promise<AcmeRenewalJobEntity> {
    const certificateVersionId = issuedRequest.certificateVersionId;
    if (!certificateVersionId) {
      throw new AppError('ACME_RENEWAL_FAILED', 'ACME 签发结果缺少证书版本');
    }
    const version = await this.dependencies.certificates.getVersion(certificateVersionId, job.tenantId);
    if (!version || version.status !== 'active') {
      throw new AppError('ACME_RENEWAL_FAILED', 'ACME 签发证书版本不存在或不可用', { certificateVersionId });
    }
    if ((version.activationState ?? 'promoted') === 'staged') {
      await this.dependencies.certificates.promoteVersionAtomic(certificateVersionId, job.tenantId);
    } else if ((version.activationState ?? 'promoted') !== 'promoted') {
      throw new AppError('ACME_RENEWAL_FAILED', 'ACME 签发证书版本状态不可提升', {
        certificateVersionId,
        activationState: version.activationState,
      });
    }
    return this.saveJob({
      ...job,
      certificateRequestId: issuedRequest.id,
      certificateVersionId,
      status: 'completed',
      promotionStatus: 'promoted',
      failureCode: undefined,
      failureMessage: undefined,
      nextAttemptAt: undefined,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    });
  }

  private async assertNotCancelled(job: AcmeRenewalJobEntity): Promise<void> {
    // 生产仓储始终提供该方法；兼容仅实现最小接口的旧测试替身。
    const getRenewalJob = this.dependencies.repository.getRenewalJob;
    if (typeof getRenewalJob !== 'function') return;
    const latest = await getRenewalJob.call(this.dependencies.repository, job.tenantId, job.id);
    if (latest?.status === 'cancelled') {
      throw new AppError('ACME_RENEWAL_CANCELLED', 'ACME 续签任务已取消', { renewalJobId: job.id });
    }
  }

  private watchCancellation(job: AcmeRenewalJobEntity): { signal: AbortSignal; dispose: () => void } | undefined {
    const getRenewalJob = this.dependencies.repository.getRenewalJob;
    if (typeof getRenewalJob !== 'function') return undefined;
    const controller = new AbortController();
    let disposed = false;
    const refresh = (): void => {
      void getRenewalJob.call(this.dependencies.repository, job.tenantId, job.id)
        .then((latest) => {
          if (!disposed && latest?.status === 'cancelled') controller.abort();
        })
        // 监视失败不能中断正常签发，完成前的状态检查仍是最终保护。
        .catch(() => undefined);
    };
    refresh();
    const timer = setInterval(refresh, 500);
    return {
      signal: controller.signal,
      dispose: () => {
        disposed = true;
        clearInterval(timer);
      },
    };
  }

  private async failOrRetry(job: AcmeRenewalJobEntity, error: unknown): Promise<AcmeRenewalJobEntity> {
    const policy = job.policyId ? await this.dependencies.repository.getPolicy(job.tenantId, job.policyId) : undefined;
    const attemptCount = job.attemptCount + 1;
    const maxAttempts = policy?.maxAttempts ?? 5;
    const message = renewalFailureMessage(error);
    const failureCode = error instanceof AppError ? error.errorCode : 'ACME_RENEWAL_FAILED';
    if (!isRetryableRenewalError(error) || attemptCount >= maxAttempts) {
      return this.saveJob({
        ...job,
        attemptCount,
        status: 'failed',
        promotionStatus: 'not_required',
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

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function stringValues(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map(String).map((item) => item.trim().toLowerCase()).filter(Boolean))]
    : [];
}

function renewalRequestIdempotencyKey(job: AcmeRenewalJobEntity, recreateRequest: boolean): string {
  return recreateRequest
    ? `acme-renewal-recovery-request:${job.id}`
    : `acme-renewal-request:${job.id}`;
}

function isRetryableRenewalError(error: unknown): boolean {
  if (!(error instanceof AppError)) return true;
  return !nonRetryableRenewalErrorCodes.has(error.errorCode);
}

function renewalFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (!(error instanceof AppError) || !error.details || typeof error.details !== 'object' || Array.isArray(error.details)) {
    return message;
  }
  const reason = textValue((error.details as Record<string, unknown>).reason);
  return reason ? `${message}：${reason}` : message;
}
