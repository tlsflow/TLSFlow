import { AppError } from '../../../common/errors/app-error.js';
import { newId } from '../../../shared/id.js';
import type {
  CertificatePolicyEntity,
  CertificatePolicyRules,
  CertificatePolicyVersionEntity,
  CertificateProfileRules,
  EffectiveCertificatePolicySnapshot,
  ProviderActionBindingEntity,
} from '../schema/internal-ca.schema.js';
import { InternalCaRepository } from '../repository/internal-ca.repository.js';

/**
 * 统一策略只决定租户默认值和严格模式，不追溯改写已创建申请。
 * 首期的兼容默认值刻意不要求审批或硬件密钥，确保基础签发路径可用。
 */
export class CertificatePolicyService {
  constructor(private readonly repository: InternalCaRepository) {}

  async ensureDefault(tenantId: string, actorId = 'system'): Promise<{
    policy: CertificatePolicyEntity;
    version: CertificatePolicyVersionEntity;
  }> {
    const existing = (await this.repository.listCertificatePolicies(tenantId))
      .filter((item) => item.status === 'active')
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    if (existing) {
      const version = (await this.repository.listCertificatePolicyVersions(existing.id))
        .find((item) => item.versionNo === existing.currentVersion);
      if (version) return { policy: existing, version };
    }

    const now = new Date().toISOString();
    const policy: CertificatePolicyEntity = {
      id: newId('certpolicy'), tenantId, status: 'active', currentVersion: 1, createdAt: now, updatedAt: now,
    };
    const version: CertificatePolicyVersionEntity = {
      id: newId('certpolicyv'), policyId: policy.id, versionNo: 1, rules: defaultCertificatePolicyRules(), createdBy: actorId, createdAt: now,
    };
    try {
      await this.repository.createCertificatePolicy(policy, version);
      return { policy, version };
    } catch (error) {
      const concurrent = (await this.repository.listCertificatePolicies(tenantId))
        .filter((item) => item.status === 'active')
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
      if (!concurrent) throw error;
      const concurrentVersion = (await this.repository.listCertificatePolicyVersions(concurrent.id))
        .find((item) => item.versionNo === concurrent.currentVersion);
      if (!concurrentVersion) throw error;
      return { policy: concurrent, version: concurrentVersion };
    }
  }

  async createVersion(
    tenantId: string,
    policyId: string,
    rules: Partial<CertificatePolicyRules>,
    actorId: string,
  ): Promise<CertificatePolicyVersionEntity> {
    const policy = await this.repository.getCertificatePolicy(tenantId, policyId);
    if (!policy) throw new AppError('RESOURCE_NOT_FOUND', '证书策略不存在', { policyId });
    const current = (await this.repository.listCertificatePolicyVersions(policy.id))
      .find((item) => item.versionNo === policy.currentVersion);
    if (!current) throw new AppError('RESOURCE_VERSION_CONFLICT', '证书策略当前版本不存在', { policyId, versionNo: policy.currentVersion });
    const now = new Date().toISOString();
    const next: CertificatePolicyVersionEntity = {
      id: newId('certpolicyv'), policyId: policy.id, versionNo: policy.currentVersion + 1,
      rules: normalizeCertificatePolicyRules({ ...current.rules, ...rules }), createdBy: actorId, createdAt: now,
    };
    await this.repository.saveCertificatePolicyVersion(next);
    await this.repository.saveCertificatePolicy({ ...policy, currentVersion: next.versionNo, updatedAt: now });
    return next;
  }

  async snapshot(input: {
    tenantId: string;
    actorId: string;
    requestedValidityDays?: number;
    profileRules: CertificateProfileRules;
    binding?: ProviderActionBindingEntity;
  }): Promise<EffectiveCertificatePolicySnapshot> {
    const { version } = await this.ensureDefault(input.tenantId, input.actorId);
    const requested = input.requestedValidityDays ?? version.rules.defaultValidityDays;
    const effectiveValidityDays = Math.min(requested, version.rules.maximumValidityDays, input.profileRules.maximumValidityDays);
    if (effectiveValidityDays < 1) throw new AppError('CERTIFICATE_POLICY_VIOLATION', '证书策略有效期无效');
    const warnings: string[] = [];
    if (requested > effectiveValidityDays) warnings.push('请求有效期已按 CA 或租户策略上限收敛。');
    if (!version.rules.strictEnforcement && (version.rules.issueApprovalRequired || input.profileRules.requireApproval)) {
      warnings.push('审批要求处于兼容模式，仅记录提示。');
    }
    if (!version.rules.strictEnforcement && version.rules.minimumProtectionLevel !== 'software_controlled') {
      warnings.push('密钥保护等级处于兼容模式，仅记录提示。');
    }
    if (input.binding?.status === 'revalidation_required') warnings.push('外部 CA 动作绑定需要复验，继续使用已冻结版本。');
    return {
      policyVersionId: version.id,
      providerActionBindingId: input.binding?.id,
      rules: structuredClone(version.rules),
      effectiveValidityDays,
      requiresApproval: version.rules.strictEnforcement && (version.rules.issueApprovalRequired || input.profileRules.requireApproval),
      warnings,
    };
  }
}

export function defaultCertificatePolicyRules(): CertificatePolicyRules {
  return {
    defaultValidityDays: 397,
    maximumValidityDays: 397,
    renewalWindowDays: 30,
    rotateKeyOnRenewal: true,
    minimumProtectionLevel: 'software_controlled',
    issueApprovalRequired: false,
    deploymentApprovalRequired: false,
    revocationApprovalRequired: false,
    requireCrlOrOcspEvidence: false,
    strictEnforcement: false,
  };
}

export function normalizeCertificatePolicyRules(input: Partial<CertificatePolicyRules>): CertificatePolicyRules {
  const defaults = defaultCertificatePolicyRules();
  const maximumValidityDays = Math.max(1, Math.min(input.maximumValidityDays ?? defaults.maximumValidityDays, 3650));
  return {
    defaultValidityDays: Math.max(1, Math.min(input.defaultValidityDays ?? defaults.defaultValidityDays, maximumValidityDays)),
    maximumValidityDays,
    renewalWindowDays: Math.max(1, input.renewalWindowDays ?? defaults.renewalWindowDays),
    rotateKeyOnRenewal: input.rotateKeyOnRenewal ?? defaults.rotateKeyOnRenewal,
    minimumProtectionLevel: input.minimumProtectionLevel ?? defaults.minimumProtectionLevel,
    issueApprovalRequired: input.issueApprovalRequired ?? defaults.issueApprovalRequired,
    deploymentApprovalRequired: input.deploymentApprovalRequired ?? defaults.deploymentApprovalRequired,
    revocationApprovalRequired: input.revocationApprovalRequired ?? defaults.revocationApprovalRequired,
    requireCrlOrOcspEvidence: input.requireCrlOrOcspEvidence ?? defaults.requireCrlOrOcspEvidence,
    strictEnforcement: input.strictEnforcement ?? defaults.strictEnforcement,
  };
}
