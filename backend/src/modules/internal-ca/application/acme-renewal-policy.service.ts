import { AppError } from '../../../common/errors/app-error.js';
import { newId } from '../../../shared/id.js';
import { AcmeDomainService } from '../domain/acme.domain-service.js';
import type { AcmeRepository } from '../repository/acme.repository.js';
import type { InternalCaRepository } from '../repository/internal-ca.repository.js';
import type {
  AcmeRenewalDeploymentMode,
  AcmeRenewalPolicyEntity,
  AcmeChallengeType,
} from '../schema/acme.schema.js';

export interface CreateAcmeRenewalPolicyInput {
  tenantId: string;
  certificateAssetId?: string;
  bindingId?: string;
  providerId: string;
  accountId: string;
  enabled?: boolean;
  renewalWindowDays?: number;
  challengeType: AcmeChallengeType;
  rotateKeyOnRenewal?: boolean;
  deploymentMode?: AcmeRenewalDeploymentMode;
  maxAttempts?: number;
  backoffSeconds?: number;
  maintenanceWindow?: Record<string, unknown>;
  actorId: string;
}

export class AcmeRenewalPolicyService {
  private readonly domain: AcmeDomainService = new AcmeDomainService();

  constructor(
    private readonly repository: AcmeRepository,
    private readonly caRepository: InternalCaRepository,
  ) {}

  async create(input: CreateAcmeRenewalPolicyInput): Promise<AcmeRenewalPolicyEntity> {
    const provider = await this.caRepository.getProvider(input.tenantId, input.providerId);
    if (!provider || provider.type !== 'acme') throw new AppError('RESOURCE_NOT_FOUND', 'ACME Provider 不存在');
    const account = await this.repository.getAccount(input.tenantId, input.accountId);
    if (!account || account.providerId !== provider.id || account.status !== 'active') {
      throw new AppError('ACME_ACCOUNT_INVALID', '续签策略的 Account 不存在、未激活或与 Provider 不匹配');
    }
    const policy: AcmeRenewalPolicyEntity = {
      id: newId('acmepolicy'),
      tenantId: input.tenantId,
      certificateAssetId: input.certificateAssetId,
      bindingId: input.bindingId,
      providerId: input.providerId,
      accountId: input.accountId,
      enabled: input.enabled !== false,
      renewalWindowDays: input.renewalWindowDays ?? 30,
      challengeType: input.challengeType,
      rotateKeyOnRenewal: input.rotateKeyOnRenewal !== false,
      deploymentMode: input.deploymentMode ?? 'automatic',
      maxAttempts: input.maxAttempts ?? 5,
      backoffSeconds: input.backoffSeconds ?? 300,
      maintenanceWindow: input.maintenanceWindow,
      status: input.enabled === false ? 'disabled' : 'active',
      version: 1,
      createdBy: input.actorId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.domain.validateRenewalPolicy(policy);
    return this.repository.savePolicy(policy);
  }

  async update(tenantId: string, id: string, patch: Partial<Omit<CreateAcmeRenewalPolicyInput, 'tenantId' | 'actorId'>> & { actorId: string }): Promise<AcmeRenewalPolicyEntity> {
    const current = await this.repository.getPolicy(tenantId, id);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'ACME 续签策略不存在');
    const { actorId: _actorId, ...policyPatch } = patch;
    const next: AcmeRenewalPolicyEntity = {
      ...current,
      ...policyPatch,
      id: current.id,
      tenantId,
      version: current.version + 1,
      status: policyPatch.enabled === false ? 'disabled' : policyPatch.enabled === true ? 'active' : current.status,
      updatedAt: new Date().toISOString(),
    };
    const provider = await this.caRepository.getProvider(tenantId, next.providerId);
    if (!provider || provider.type !== 'acme') throw new AppError('RESOURCE_NOT_FOUND', 'ACME Provider 不存在');
    const account = await this.repository.getAccount(tenantId, next.accountId);
    if (!account || account.providerId !== provider.id || account.status !== 'active') {
      throw new AppError('ACME_ACCOUNT_INVALID', '续签策略的 Account 不存在、未激活或与 Provider 不匹配');
    }
    this.domain.validateRenewalPolicy(next);
    return this.repository.savePolicy(next);
  }

  list(tenantId: string): Promise<AcmeRenewalPolicyEntity[]> {
    return this.repository.listPolicies(tenantId);
  }

  async get(tenantId: string, id: string): Promise<AcmeRenewalPolicyEntity> {
    const policy = await this.repository.getPolicy(tenantId, id);
    if (!policy) throw new AppError('RESOURCE_NOT_FOUND', 'ACME 续签策略不存在');
    return policy;
  }
}
