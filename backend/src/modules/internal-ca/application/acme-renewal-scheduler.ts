import { AppError } from '../../../common/errors/app-error.js';
import { structuredLogger } from '../../../common/logging/structured-logger.js';
import { newId } from '../../../shared/id.js';
import type { BindingsRepository } from '../../bindings/repository/bindings.repository.js';
import type { CertificatesRepository } from '../../certificates/repository/certificates.repository.js';
import type { InternalCaApplicationService } from './internal-ca.application-service.js';
import type { AcmePolicyCursor, AcmeRepository } from '../repository/acme.repository.js';
import type { AcmeRenewalJobEntity, AcmeRenewalPolicyEntity } from '../schema/acme.schema.js';
import type { CertificateRequestEntity } from '../schema/internal-ca.schema.js';
import { enqueueTaskBestEffort, isUnifiedTaskWorkerEnabled, type TaskEnqueuer } from '../../tasks/task-enqueue.js';

export class AcmeRenewalScheduler {
  constructor(
    private readonly repository: AcmeRepository,
    private readonly certificates: CertificatesRepository,
    private readonly bindings?: BindingsRepository,
    private readonly issuance?: Pick<InternalCaApplicationService, 'ensureAcmeIssuanceContext' | 'createCertificateRequest' | 'getRequestByIdempotencyKey'>,
    private readonly tasks?: TaskEnqueuer,
  ) {}

  async runOnce(limit = 50, now = new Date()): Promise<AcmeRenewalJobEntity[]> {
    const created: AcmeRenewalJobEntity[] = [];
    const budget = Math.max(1, Math.floor(limit));
    let scheduledCount = 0;
    const pageSize = budget;
    let cursor: AcmePolicyCursor | undefined;
    for (;;) {
      const policies = await this.repository.listActivePolicies(pageSize, cursor);
      if (policies.length === 0) break;
      for (const policy of policies) {
        const currentVersionId = await this.resolveCurrentVersionId(policy);
        if (!currentVersionId) {
          const initialWindowKey = `initial:${policy.certificateAssetId}`;
          const existingInitial = policy.certificateAssetId
            ? await this.repository.getRenewalJobByWindow(policy.tenantId, undefined, initialWindowKey)
            : undefined;
          if (existingInitial && isExecutableRenewalJob(existingInitial)) {
            await this.ensureRenewalTask(existingInitial);
            continue;
          }
          if (!existingInitial && scheduledCount >= budget) continue;
          const initialJob = await this.scheduleMissingInitialIssuance(policy, now);
          if (initialJob) {
            if (!existingInitial || existingInitial.id !== initialJob.id) {
              created.push(initialJob);
              scheduledCount += 1;
            }
            await this.ensureRenewalTask(initialJob);
          }
          continue;
        }
        const version = await this.certificates.getVersion(currentVersionId, policy.tenantId);
        if (!version || (version.activationState ?? 'promoted') !== 'promoted') continue;

        const renewalWindowKey = `${version.notAfter.slice(0, 10)}:policy-${policy.version}`;
        const existing = await this.repository.getRenewalJobByWindow(policy.tenantId, version.id, renewalWindowKey);
        if (existing && isExecutableRenewalJob(existing)) {
          await this.ensureRenewalTask(existing);
          continue;
        }
        if (existing) continue;

        // 手动续签使用不同的窗口键；先按源版本查活动 Job，避免自动扫描重复创建，
        // 同时把活动 Job 缺失任务的情况纳入补偿扫描。
        const activeBySource = typeof this.repository.getActiveRenewalJobBySourceVersion === 'function'
          ? await this.repository.getActiveRenewalJobBySourceVersion(policy.tenantId, version.id)
          : undefined;
        if (activeBySource) {
          await this.ensureRenewalTask(activeBySource);
          continue;
        }
        if (Date.parse(version.notAfter) - now.getTime() > policy.renewalWindowDays * 86_400_000) continue;
        if (scheduledCount >= budget) continue;

        const timestamp = now.toISOString();
        const job: AcmeRenewalJobEntity = {
          id: newId('acmerenew'),
          tenantId: policy.tenantId,
          certificateVersionId: version.id,
          sourceCertificateVersionId: version.id,
          renewalWindowKey,
          status: 'scheduled',
          policyId: policy.id,
          applicationAssetId: policy.applicationAssetId,
          applicationCertificatePolicyVersionId: policy.applicationCertificatePolicyVersionId,
          promotionStatus: 'not_required',
          attemptCount: 0,
          taskGeneration: 0,
          policySnapshot: {
            providerId: policy.providerId,
            accountId: policy.accountId,
            ...(policy.applicationAssetId ? { applicationAssetId: policy.applicationAssetId } : {}),
            ...(policy.applicationCertificatePolicyVersionId ? { applicationCertificatePolicyVersionId: policy.applicationCertificatePolicyVersionId } : {}),
            challengeType: policy.challengeType,
            rotateKeyOnRenewal: policy.rotateKeyOnRenewal,
            maxAttempts: policy.maxAttempts,
            backoffSeconds: policy.backoffSeconds,
            renewalWindowDays: policy.renewalWindowDays,
          },
          scheduledAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        try {
          const saved = await this.repository.saveRenewalJob(job);
          created.push(saved);
          scheduledCount += 1;
          await this.ensureRenewalTask(saved);
        } catch {
          const raced = await this.repository.getRenewalJobByWindow(policy.tenantId, version.id, renewalWindowKey);
          if (raced) {
            created.push(raced);
            await this.ensureRenewalTask(raced);
          }
        }
      }
      if (policies.length < pageSize) break;
      const last = policies[policies.length - 1]!;
      const nextCursor: AcmePolicyCursor = { updatedAt: last.updatedAt, id: last.id };
      if (cursor?.updatedAt === nextCursor.updatedAt && cursor.id === nextCursor.id) break;
      cursor = nextCursor;
    }
    return created;
  }

  async scheduleManualRenewal(tenantId: string, certificateAssetId: string, actorId: string, now = new Date()): Promise<AcmeRenewalJobEntity> {
    const policy = (await this.repository.listPolicies(tenantId))
      .find((item) => item.certificateAssetId === certificateAssetId);
    if (!policy) throw new AppError('RESOURCE_NOT_FOUND', '证书没有关联的 ACME 续签策略', { certificateAssetId });
    if (!policy.enabled || policy.status !== 'active') {
      throw new AppError('ACME_RENEWAL_FAILED', '该证书的自动续签策略已停用，无法手动续签', { policyId: policy.id });
    }

    const currentVersionId = await this.resolveCurrentVersionId(policy);
    if (!currentVersionId) {
      const renewalWindowKey = `initial:${certificateAssetId}`;
      const existing = await this.repository.getRenewalJobByWindow(tenantId, undefined, renewalWindowKey);
      if (existing) {
        if (['retry_waiting', 'failed'].includes(existing.status)) {
          return this.repository.retryRenewalJob(tenantId, existing.id, now.toISOString());
        }
        if (['scheduled', 'key_pending', 'csr_pending', 'issuing', 'deploying', 'verifying'].includes(existing.status)) {
          return existing;
        }
        // 已完成的首次任务却没有资产当前版本，说明历史任务只保存了签发结果，
        // 没有完成 Promotion。手动操作必须创建新的可执行任务，不能再次入队
        // 已完成任务并把幂等成功误报成新的续签成功。
        if (existing.status === 'completed') {
          const recovered = await this.scheduleMissingInitialIssuance(
            policy,
            now,
            `manual-initial:${certificateAssetId}:${now.toISOString()}`,
          );
          if (recovered) return recovered;
        }
        return existing;
      }
      const created = await this.scheduleMissingInitialIssuance(policy, now);
      if (created) return created;
      throw new AppError('ACME_RENEWAL_FAILED', '证书缺少可执行的首次申请上下文', { certificateAssetId });
    }

    const version = await this.certificates.getVersion(currentVersionId, tenantId);
    if (!version) throw new AppError('RESOURCE_NOT_FOUND', '证书当前版本不存在', { certificateVersionId: currentVersionId });
    if ((version.activationState ?? 'promoted') !== 'promoted') {
      throw new AppError('ACME_RENEWAL_FAILED', '证书当前版本尚未完成 Promotion，暂不能手动续签', { certificateVersionId: currentVersionId });
    }
    const existing = await this.repository.getActiveRenewalJobBySourceVersion(tenantId, version.id);
    if (existing) {
      if (existing.status === 'retry_waiting') {
        return this.repository.retryRenewalJob(tenantId, existing.id, now.toISOString());
      }
      return existing;
    }

    const timestamp = now.toISOString();
    const renewalWindowKey = `manual:${version.id}:${timestamp}`;
    const job: AcmeRenewalJobEntity = {
      id: newId('acmerenew'),
      tenantId,
      certificateVersionId: version.id,
      sourceCertificateVersionId: version.id,
      renewalWindowKey,
      status: 'scheduled',
      policyId: policy.id,
      applicationAssetId: policy.applicationAssetId,
      applicationCertificatePolicyVersionId: policy.applicationCertificatePolicyVersionId,
      promotionStatus: 'not_required',
      attemptCount: 0,
      taskGeneration: 0,
      policySnapshot: {
        providerId: policy.providerId,
        accountId: policy.accountId,
        ...(policy.applicationAssetId ? { applicationAssetId: policy.applicationAssetId } : {}),
        ...(policy.applicationCertificatePolicyVersionId ? { applicationCertificatePolicyVersionId: policy.applicationCertificatePolicyVersionId } : {}),
        challengeType: policy.challengeType,
        rotateKeyOnRenewal: policy.rotateKeyOnRenewal,
        maxAttempts: policy.maxAttempts,
        backoffSeconds: policy.backoffSeconds,
        renewalWindowDays: policy.renewalWindowDays,
      },
      scheduledAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    try {
      return await this.repository.saveRenewalJob(job);
    } catch {
      const raced = await this.repository.getActiveRenewalJobBySourceVersion(tenantId, version.id);
      if (raced) return raced;
      throw new AppError('ACME_RENEWAL_FAILED', '手动续签任务创建失败', { certificateAssetId });
    }
  }

  /**
   * 专属 ACME provisioning 完成后立即创建首次 RenewalJob。
   * 任务仍由同一个调度器和 Worker 执行，后台扫描只是兜底补偿。
   */
  async scheduleInitialIssuance(tenantId: string, certificateAssetId: string, now = new Date()): Promise<AcmeRenewalJobEntity | undefined> {
    const policy = (await this.repository.listPolicies(tenantId))
      .find((item) => item.certificateAssetId === certificateAssetId && item.enabled && item.status === 'active');
    if (!policy) throw new AppError('RESOURCE_NOT_FOUND', '证书没有关联的活动 ACME 续签策略', { certificateAssetId });
    const job = await this.scheduleMissingInitialIssuance(policy, now);
    if (job) await this.ensureRenewalTask(job);
    return job;
  }

  private async scheduleMissingInitialIssuance(
    policy: AcmeRenewalPolicyEntity,
    now: Date,
    renewalWindowKey = `initial:${policy.certificateAssetId}`,
  ): Promise<AcmeRenewalJobEntity | undefined> {
    if (!this.issuance || !policy.certificateAssetId) return undefined;
    const existing = await this.repository.getRenewalJobByWindow(policy.tenantId, undefined, renewalWindowKey);
    if (existing) {
      return ['scheduled', 'key_pending', 'csr_pending', 'issuing', 'deploying', 'verifying'].includes(existing.status)
        ? existing
        : undefined;
    }
    const asset = await this.certificates.getAsset(policy.certificateAssetId, policy.tenantId);
    if (!asset || asset.currentVersionId) return undefined;

    const request = await this.findExecutableInitialRequest(policy.tenantId, asset.id);
    const resolvedRequest = request ?? await this.createInitialRequest(policy, asset);
    return this.createInitialJob(policy, resolvedRequest.id, now, renewalWindowKey);
  }

  private async findExecutableInitialRequest(tenantId: string, certificateAssetId: string): Promise<CertificateRequestEntity | undefined> {
    const request = await this.issuance?.getRequestByIdempotencyKey(tenantId, `acme-initial-request:${certificateAssetId}`);
    // 新记录必须使用结构化 certificateAssetId 归属；只有历史记录没有该列时，
    // 才允许使用旧的 applicationAssetId=证书资产 ID 兼容回退。
    const belongsToAsset = request
      ? (request.certificateAssetId ? request.certificateAssetId === certificateAssetId : request.applicationAssetId === certificateAssetId)
      : false;
    return request && belongsToAsset
      && ['approved', 'issuing', 'issue_failed', 'issued', 'deploying', 'active'].includes(request.status)
      ? request
      : undefined;
  }

  private async createInitialRequest(policy: AcmeRenewalPolicyEntity, asset: { id: string; primaryDomain: string; sans: string[] }): Promise<CertificateRequestEntity> {
    const issuanceContext = await this.issuance!.ensureAcmeIssuanceContext(policy.tenantId, policy.providerId, policy.createdBy);
    try {
      return await this.issuance!.createCertificateRequest(policy.tenantId, {
        applicationAssetId: policy.applicationAssetId ?? asset.id,
        ...(policy.applicationCertificatePolicyVersionId && policy.certificateAssetId
          ? { certificateAssetId: policy.certificateAssetId, applicationCertificatePolicyVersionId: policy.applicationCertificatePolicyVersionId }
          : {}),
        caId: issuanceContext.caId,
        trustDomainId: issuanceContext.trustDomainId,
        profileVersionId: issuanceContext.profileVersionId,
        commonName: asset.primaryDomain,
        sans: asset.sans,
        requestedValidityDays: 90,
        custodyMode: 'managed_secret',
        deferIssuance: true,
        idempotencyKey: `acme-initial-request:${asset.id}`,
        actorId: policy.createdBy,
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const raced = await this.findExecutableInitialRequest(policy.tenantId, asset.id);
      if (raced) return raced;
      throw error;
    }
  }

  private async createInitialJob(
    policy: AcmeRenewalPolicyEntity,
    certificateRequestId: string,
    now: Date,
    renewalWindowKey = `initial:${policy.certificateAssetId}`,
  ): Promise<AcmeRenewalJobEntity> {
    const timestamp = now.toISOString();
    const job: AcmeRenewalJobEntity = {
      id: newId('acmerenew'),
      tenantId: policy.tenantId,
      certificateVersionId: undefined,
      sourceCertificateVersionId: undefined,
      renewalWindowKey,
      status: 'scheduled',
      certificateRequestId,
      policyId: policy.id,
      applicationAssetId: policy.applicationAssetId,
      applicationCertificatePolicyVersionId: policy.applicationCertificatePolicyVersionId,
      promotionStatus: 'not_required',
      attemptCount: 0,
      taskGeneration: 0,
      policySnapshot: {
        providerId: policy.providerId,
        accountId: policy.accountId,
        ...(policy.applicationAssetId ? { applicationAssetId: policy.applicationAssetId } : {}),
        ...(policy.applicationCertificatePolicyVersionId ? { applicationCertificatePolicyVersionId: policy.applicationCertificatePolicyVersionId } : {}),
        challengeType: policy.challengeType,
        rotateKeyOnRenewal: policy.rotateKeyOnRenewal,
        maxAttempts: policy.maxAttempts,
        backoffSeconds: policy.backoffSeconds,
        renewalWindowDays: policy.renewalWindowDays,
      },
      scheduledAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    try {
      return await this.repository.saveRenewalJob(job);
    } catch {
      const raced = await this.repository.getRenewalJobByWindow(policy.tenantId, undefined, renewalWindowKey);
      if (raced) return raced;
      throw new AppError('ACME_RENEWAL_FAILED', '首次 ACME 续签任务创建失败', { certificateAssetId: policy.certificateAssetId });
    }
  }

  private async resolveCurrentVersionId(policy: AcmeRenewalPolicyEntity): Promise<string | undefined> {
    if (policy.certificateAssetId) {
      const asset = await this.certificates.getAsset(policy.certificateAssetId, policy.tenantId);
      return asset?.currentVersionId;
    }
    if (!policy.bindingId || !this.bindings) return undefined;
    const binding = await this.bindings.getCertificateBinding(policy.tenantId, policy.bindingId);
    return binding?.certificateVersionId
      ?? binding?.targetCertificateVersionId
      ?? binding?.localCertificateVersionId;
  }

  private async ensureRenewalTask(job: AcmeRenewalJobEntity): Promise<void> {
    if (!this.tasks || !isUnifiedTaskWorkerEnabled()) return;
    const idempotencyKey = renewalTaskIdempotencyKey(job);
    try {
      const existing = this.tasks.findByIdempotencyKey
        ? await this.tasks.findByIdempotencyKey(job.tenantId, 'ACME_CERTIFICATE_RENEWAL', idempotencyKey)
        : await this.tasks.findActiveByIdempotency?.(job.tenantId, 'ACME_CERTIFICATE_RENEWAL', idempotencyKey);
      if (existing) {
        if (existing.status === 'FAILED' && this.tasks.retry) {
          try {
            await this.tasks.retry(job.tenantId, existing.id);
            return;
          } catch (error: unknown) {
            structuredLogger.warn('ACME 续签关联失败任务原子重置失败', {
              renewalJobId: job.id,
              taskId: existing.id,
              error: error instanceof Error ? error.message : String(error),
            }, { module: 'acme-renewal-scheduler', resourceType: 'acmeRenewalJob', resourceId: job.id });
          }
        }
        if (isTerminalTask(existing.status)) {
          structuredLogger.warn('ACME 续签 Job 仍活动但统一任务已进入终态', {
            renewalJobId: job.id,
            taskId: existing.id,
            taskStatus: existing.status,
          }, { module: 'acme-renewal-scheduler', resourceType: 'acmeRenewalJob', resourceId: job.id });
        }
        return;
      }
    } catch (error: unknown) {
      // 查询失败时仍继续尝试入队；幂等唯一键负责收敛并发补偿。
      structuredLogger.warn('ACME 续签任务补偿查询失败', {
        renewalJobId: job.id,
        tenantId: job.tenantId,
        error: error instanceof Error ? error.message : String(error),
      }, { module: 'acme-renewal-scheduler', resourceType: 'acmeRenewalJob', resourceId: job.id });
    }
    await enqueueTaskBestEffort(this.tasks, {
      tenantId: job.tenantId,
      taskType: 'ACME_CERTIFICATE_RENEWAL',
      triggerSource: 'acme.renewal.scheduler',
      idempotencyKey,
      payload: renewalTaskPayload(job),
      resourceRefs: [
        { resourceType: 'acmeRenewalJob', resourceId: job.id },
        ...(job.certificateVersionId ? [{ resourceType: 'certificateVersion', resourceId: job.certificateVersionId }] : []),
      ],
    });
  }
}

function isExecutableRenewalJob(job: AcmeRenewalJobEntity): boolean {
  return !['completed', 'failed', 'rollback_required', 'cancelled', 'issued_waiting_for_installation'].includes(job.status);
}

function isTerminalTask(status: string): boolean {
  return ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(status);
}

/** 中文说明：代次 0 沿用历史幂等键，避免升级后为存量 Job 重复创建 TaskRun。 */
export function renewalTaskIdempotencyKey(job: Pick<AcmeRenewalJobEntity, 'id' | 'taskGeneration'>): string {
  const generation = Number.isInteger(job.taskGeneration) ? Math.max(0, job.taskGeneration ?? 0) : 0;
  return generation > 0 ? `acme-renewal:${job.id}:${generation}` : `acme-renewal:${job.id}`;
}

/** 中文说明：代次 0 不改变历史任务请求体；只有人工重试的新代次才写入载荷。 */
export function renewalTaskPayload(job: Pick<AcmeRenewalJobEntity, 'id' | 'taskGeneration'>): Record<string, unknown> {
  const generation = Number.isInteger(job.taskGeneration) ? Math.max(0, job.taskGeneration ?? 0) : 0;
  return generation > 0
    ? { renewalJobId: job.id, taskGeneration: generation }
    : { renewalJobId: job.id };
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === '23505'
    || (typeof candidate.message === 'string' && candidate.message.includes('unique constraint'));
}
