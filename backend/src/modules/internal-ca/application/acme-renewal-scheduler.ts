import { newId } from '../../../shared/id.js';
import type { BindingsRepository } from '../../bindings/repository/bindings.repository.js';
import type { CertificatesRepository } from '../../certificates/repository/certificates.repository.js';
import type { AcmeRepository } from '../repository/acme.repository.js';
import type { AcmeRenewalJobEntity, AcmeRenewalPolicyEntity } from '../schema/acme.schema.js';

export class AcmeRenewalScheduler {
  constructor(
    private readonly repository: AcmeRepository,
    private readonly certificates: CertificatesRepository,
    private readonly bindings?: BindingsRepository,
  ) {}

  async runOnce(limit = 50, now = new Date()): Promise<AcmeRenewalJobEntity[]> {
    const created: AcmeRenewalJobEntity[] = [];
    for (const policy of await this.repository.listActivePolicies(limit)) {
      if (created.length >= limit) break;
      const currentVersionId = await this.resolveCurrentVersionId(policy);
      if (!currentVersionId) continue;
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
        promotionStatus: 'pending',
        attemptCount: 0,
        policySnapshot: {
          providerId: policy.providerId,
          accountId: policy.accountId,
          challengeType: policy.challengeType,
          rotateKeyOnRenewal: policy.rotateKeyOnRenewal,
          deploymentMode: policy.deploymentMode,
          maxAttempts: policy.maxAttempts,
          backoffSeconds: policy.backoffSeconds,
          renewalWindowDays: policy.renewalWindowDays,
        },
        scheduledAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      try {
        created.push(await this.repository.saveRenewalJob(job));
      } catch {
        const raced = await this.repository.getRenewalJobByWindow(policy.tenantId, version.id, renewalWindowKey);
        if (raced) created.push(raced);
      }
    }
    return created;
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
}
