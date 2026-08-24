import { AppError } from '../../../common/errors/app-error.js';
import { newId } from '../../../shared/id.js';
import type { BindingsRepository } from '../../bindings/repository/bindings.repository.js';
import type { CertificatesRepository } from '../../certificates/repository/certificates.repository.js';
import type { InternalCaApplicationService } from './internal-ca.application-service.js';
import type { AcmeRepository } from '../repository/acme.repository.js';
import type { AcmeRenewalJobEntity, AcmeRenewalPolicyEntity } from '../schema/acme.schema.js';
import { enqueueTaskBestEffort, type TaskEnqueuer } from '../../tasks/task-enqueue.js';

export class AcmeRenewalScheduler {
  constructor(
    private readonly repository: AcmeRepository,
    private readonly certificates: CertificatesRepository,
    private readonly bindings?: BindingsRepository,
    private readonly issuance?: Pick<InternalCaApplicationService, 'ensureAcmeIssuanceContext' | 'createCertificateRequest'>,
    private readonly tasks?: TaskEnqueuer,
  ) {}

  async runOnce(limit = 50, now = new Date()): Promise<AcmeRenewalJobEntity[]> {
    const created: AcmeRenewalJobEntity[] = [];
    for (const policy of await this.repository.listActivePolicies(limit)) {
      if (created.length >= limit) break;
      const currentVersionId = await this.resolveCurrentVersionId(policy);
      if (!currentVersionId) {
        const initialJob = await this.scheduleMissingInitialIssuance(policy, now);
        if (initialJob) {
          created.push(initialJob);
          this.enqueueRenewalTask(initialJob);
        }
        continue;
      }
      const version = await this.certificates.getVersion(currentVersionId);
      if (!version || (version.activationState ?? 'promoted') !== 'promoted') continue;
      if (Date.parse(version.notAfter) - now.getTime() > policy.renewalWindowDays * 86_400_000) continue;

      const renewalWindowKey = `${version.notAfter.slice(0, 10)}:policy-${policy.version}`;
      const existing = await this.repository.getRenewalJobByWindow(policy.tenantId, version.id, renewalWindowKey);
      if (existing) continue;
      const timestamp = now.toISOString();
      const job: AcmeRenewalJobEntity = {
        id: newId('acmerenew'),
        tenantId: policy.tenantId,
        certificateVersionId: version.id,
        sourceCertificateVersionId: version.id,
        renewalWindowKey,
        status: 'scheduled',
        policyId: policy.id,
        promotionStatus: 'not_required',
        attemptCount: 0,
        policySnapshot: {
          providerId: policy.providerId,
          accountId: policy.accountId,
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
        this.enqueueRenewalTask(saved);
      } catch {
        const raced = await this.repository.getRenewalJobByWindow(policy.tenantId, version.id, renewalWindowKey);
        if (raced) {
          created.push(raced);
          this.enqueueRenewalTask(raced);
        }
      }
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
        if (existing.status === 'retry_waiting') {
          return this.repository.retryRenewalJob(tenantId, existing.id, now.toISOString());
        }
        return existing;
      }
      const created = await this.scheduleMissingInitialIssuance(policy, now);
      if (created) return created;
      throw new AppError('ACME_RENEWAL_FAILED', '证书缺少可执行的首次申请上下文', { certificateAssetId });
    }

    const version = await this.certificates.getVersion(currentVersionId);
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
      promotionStatus: 'not_required',
      attemptCount: 0,
      policySnapshot: {
        providerId: policy.providerId,
        accountId: policy.accountId,
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

  private async scheduleMissingInitialIssuance(policy: AcmeRenewalPolicyEntity, now: Date): Promise<AcmeRenewalJobEntity | undefined> {
    if (!this.issuance || !policy.certificateAssetId) return undefined;
    const renewalWindowKey = `initial:${policy.certificateAssetId}`;
    const existing = await this.repository.getRenewalJobByWindow(policy.tenantId, undefined, renewalWindowKey);
    if (existing) return undefined;
    const asset = await this.certificates.getAsset(policy.certificateAssetId);
    if (!asset || asset.sourceType !== 'acme' || asset.currentVersionId) return undefined;

    const issuanceContext = await this.issuance.ensureAcmeIssuanceContext(policy.tenantId, policy.providerId, policy.createdBy);
    const request = await this.issuance.createCertificateRequest(policy.tenantId, {
      applicationAssetId: asset.id,
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
    const timestamp = now.toISOString();
    const job: AcmeRenewalJobEntity = {
      id: newId('acmerenew'),
      tenantId: policy.tenantId,
      certificateVersionId: undefined,
      sourceCertificateVersionId: undefined,
      renewalWindowKey,
      status: 'scheduled',
      certificateRequestId: request.id,
      policyId: policy.id,
      promotionStatus: 'not_required',
      attemptCount: 0,
      policySnapshot: {
        providerId: policy.providerId,
        accountId: policy.accountId,
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
      return this.repository.getRenewalJobByWindow(policy.tenantId, undefined, renewalWindowKey);
    }
  }

  private async resolveCurrentVersionId(policy: AcmeRenewalPolicyEntity): Promise<string | undefined> {
    if (policy.certificateAssetId) {
      const asset = await this.certificates.getAsset(policy.certificateAssetId);
      return asset?.currentVersionId;
    }
    if (!policy.bindingId || !this.bindings) return undefined;
    const binding = await this.bindings.getCertificateBinding(policy.tenantId, policy.bindingId);
    return binding?.certificateVersionId
      ?? binding?.targetCertificateVersionId
      ?? binding?.localCertificateVersionId;
  }

  private enqueueRenewalTask(job: AcmeRenewalJobEntity): void {
    enqueueTaskBestEffort(this.tasks, {
      tenantId: job.tenantId,
      taskType: 'ACME_CERTIFICATE_RENEWAL',
      triggerSource: 'acme.renewal.scheduler',
      idempotencyKey: `acme-renewal:${job.id}`,
      payload: { renewalJobId: job.id },
      resourceRefs: [
        { resourceType: 'acmeRenewalJob', resourceId: job.id },
        ...(job.certificateVersionId ? [{ resourceType: 'certificateVersion', resourceId: job.certificateVersionId }] : []),
      ],
    });
  }
}
