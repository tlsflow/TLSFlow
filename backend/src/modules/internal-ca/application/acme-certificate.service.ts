import { generateKeyPairSync } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { CertificatesApplicationService } from '../../certificates/application/certificates.application-service.js';
import type { CertificateAssetDto } from '../../certificates/dto/certificates.dto.js';
import type { AcmeRepository } from '../repository/acme.repository.js';
import type { InternalCaRepository } from '../repository/internal-ca.repository.js';
import type { AcmeChallengeType, AcmeRenewalPolicyEntity } from '../schema/acme.schema.js';
import type { CaProviderEntity } from '../schema/internal-ca.schema.js';
import { findAcmeDnsProvider } from '../providers/acme-dns-provider.registry.js';
import type { CredentialsApplicationService } from '../../credentials/application/credentials.application-service.js';
import type { AcmeAccountService } from './acme-account.service.js';
import type { SecretService } from '../../secrets/secret.service.js';
import { AcmeRenewalPolicyService } from './acme-renewal-policy.service.js';
import { newId } from '../../../shared/id.js';
import type { CreateCertificateRequestInput, InternalCaApplicationService } from './internal-ca.application-service.js';
import type { RequestContext } from '../../../shared/security-types.js';

export type AcmeCertificateKeyType = 'rsa' | 'ecdsa';

export interface CreateAcmeCertificateInput {
  tenantId: string;
  name?: string;
  domains: string[];
  contactEmail: string;
  providerId?: string;
  challengeType: AcmeChallengeType;
  dnsProvider?: string;
  dnsCredentialId?: string;
  dnsPropagationSeconds?: number;
  keyType?: AcmeCertificateKeyType;
  autoRenew?: boolean;
  renewalWindowDays?: number;
  termsOfServiceAgreed: boolean;
  actorId: string;
}

export interface AcmeCertificateSetupView {
  asset: CertificateAssetDto;
  policy: AcmeRenewalPolicyEntity;
  certificateRequestId: string;
  renewalJobId: string;
  provisioningStatus: 'initial_job_scheduled';
  issuanceContextStatus: 'ready';
}

export interface UpdateAcmeCertificateInput {
  tenantId: string;
  certificateAssetId: string;
  name?: string;
  domains: string[];
  contactEmail: string;
  providerId: string;
  challengeType: AcmeChallengeType;
  dnsProvider?: string;
  dnsCredentialId?: string;
  dnsPropagationSeconds?: number;
  keyType?: AcmeCertificateKeyType;
  autoRenew: boolean;
  renewalWindowDays: number;
  actorId: string;
}

export interface AcmeCertificateAutomationView {
  asset: CertificateAssetDto;
  policy: AcmeRenewalPolicyEntity;
}

export class AcmeCertificateService {
  constructor(
    private readonly certificates: CertificatesApplicationService,
    private readonly caRepository: InternalCaRepository,
    private readonly acmeRepository: AcmeRepository,
    private readonly policies: AcmeRenewalPolicyService,
    private readonly credentials?: Pick<CredentialsApplicationService, 'get'>,
    private readonly ensureBuiltinAcmeProvider?: (tenantId: string, actorId: string) => Promise<CaProviderEntity>,
    private readonly accounts?: Pick<AcmeAccountService, 'create'>,
    private readonly secrets?: Pick<SecretService, 'create'>,
    private readonly issuance?: Pick<InternalCaApplicationService, 'ensureAcmeIssuanceContext' | 'createCertificateRequest'>,
  ) {}

  async create(input: CreateAcmeCertificateInput): Promise<AcmeCertificateSetupView> {
    let dnsProvider = input.dnsProvider?.trim();
    const dnsCredentialId = input.dnsCredentialId?.trim();
    if (!input.termsOfServiceAgreed) {
      throw new AppError('ACME_ACCOUNT_INVALID', '创建 ACME 证书前必须同意服务条款');
    }
    const domains = normalizeDomains(input.domains);
    if (domains.length === 0) throw new AppError('VALIDATION_FAILED', '至少需要一个域名');
    if (!input.contactEmail.trim()) throw new AppError('VALIDATION_FAILED', '联系邮箱不能为空');
    if (input.challengeType === 'dns-01' && dnsCredentialId) {
      if (!this.credentials) throw new AppError('CAPABILITY_MISSING', '全局凭据服务未注册');
      const credential = await this.credentials.get(input.tenantId, dnsCredentialId);
      if (credential.kind !== 'DNS_PROVIDER' || credential.status !== 'active') {
        throw new AppError('VALIDATION_FAILED', '所选 DNS 凭据不存在或未启用');
      }
      const profileProvider = typeof credential.metadata.providerId === 'string' ? credential.metadata.providerId.trim() : '';
      dnsProvider ??= profileProvider;
      if (!dnsProvider || !findAcmeDnsProvider(dnsProvider)) {
        throw new AppError('VALIDATION_FAILED', 'DNS 凭据没有可用的 LEGO Provider 标识', { credentialId: dnsCredentialId });
      }
      if (credential.metadata.providerId !== dnsProvider) {
        throw new AppError('VALIDATION_FAILED', 'DNS 凭据与所选 DNS Provider 不匹配', {
          credentialId: dnsCredentialId,
          providerId: dnsProvider,
        });
      }
    }
    if (input.challengeType === 'dns-01' && (!dnsProvider || !dnsCredentialId)) {
      throw new AppError('VALIDATION_FAILED', 'DNS-01 必须提供已启用的 DNS 凭据');
    }
    if (input.keyType !== undefined && !['rsa', 'ecdsa'].includes(input.keyType)) {
      throw new AppError('VALIDATION_FAILED', '证书密钥类型无效');
    }
    if (input.dnsPropagationSeconds !== undefined
      && (!Number.isInteger(input.dnsPropagationSeconds) || input.dnsPropagationSeconds < 0 || input.dnsPropagationSeconds > 7200)) {
      throw new AppError('VALIDATION_FAILED', 'DNS 传播等待秒数必须在 0 到 7200 之间');
    }

    let acmeProviders = (await this.caRepository.listProviders(input.tenantId))
      .filter((item) => item.type === 'acme' && item.status === 'active');
    if (acmeProviders.length === 0 && !input.providerId && this.ensureBuiltinAcmeProvider) {
      await this.ensureBuiltinAcmeProvider(input.tenantId, input.actorId);
      acmeProviders = (await this.caRepository.listProviders(input.tenantId))
        .filter((item) => item.type === 'acme' && item.status === 'active');
    }
    const provider = input.providerId
      ? acmeProviders.find((item) => item.id === input.providerId)
      : acmeProviders.find((item) => item.configuration?.isDefault === true) ?? acmeProviders[0];
    if (!provider && input.providerId) {
      throw new AppError('RESOURCE_NOT_FOUND', '所选 ACME Provider 不存在或未启用', { providerId: input.providerId });
    }
    if (!provider) throw new AppError('RESOURCE_NOT_FOUND', '当前租户没有可用的 ACME Provider');
    let account = (await this.acmeRepository.listAccounts(input.tenantId, provider.id))
      .find((item) => item.status === 'active');
    if (!account) {
      account = await this.ensureAcmeAccount(provider, input);
    }
    if (!account) throw new AppError('ACME_ACCOUNT_INVALID', '当前租户没有可用的 ACME Account');

    const asset = await this.certificates.createAsset({
      tenantId: input.tenantId,
      name: input.name?.trim() || domains[0],
      primaryDomain: domains[0],
      sans: domains.slice(1),
      sourceType: 'acme',
      tags: ['acme'],
      createdBy: input.actorId,
    });
    const maintenanceWindow = {
      ...(dnsProvider ? { dnsProvider } : {}),
      ...(dnsCredentialId ? { dnsCredentialId } : {}),
      ...(input.dnsPropagationSeconds !== undefined ? { dnsPropagationSeconds: input.dnsPropagationSeconds } : {}),
      contactEmail: input.contactEmail.trim(),
      keyType: input.keyType ?? 'rsa',
      domains,
    };
    const existing = (await this.policies.list(input.tenantId))
      .find((item) => item.certificateAssetId === asset.id && item.status !== 'disabled');
    const policyInput = {
      certificateAssetId: asset.id,
      providerId: provider.id,
      accountId: account.id,
      enabled: input.autoRenew !== false,
      renewalWindowDays: input.renewalWindowDays ?? 7,
      challengeType: input.challengeType,
      deploymentMode: 'manual' as const,
      rotateKeyOnRenewal: true,
      maxAttempts: 5,
      backoffSeconds: 300,
      maintenanceWindow,
    };
    const policy = existing
      ? await this.policies.update(input.tenantId, existing.id, { ...policyInput, actorId: input.actorId })
      : await this.policies.create({ ...policyInput, tenantId: input.tenantId, actorId: input.actorId });
    if (!this.issuance) throw new AppError('CAPABILITY_MISSING', 'ACME 首次申请服务未注册');
    const issuanceContext = await this.issuance.ensureAcmeIssuanceContext(input.tenantId, provider.id, input.actorId);
    const requestInput: CreateCertificateRequestInput = {
      caId: issuanceContext.caId,
      trustDomainId: issuanceContext.trustDomainId,
      profileVersionId: issuanceContext.profileVersionId,
      commonName: domains[0]!,
      sans: domains.slice(1),
      requestedValidityDays: 90,
      custodyMode: 'managed_secret',
      requestedKeyAlgorithm: input.keyType === 'ecdsa' ? 'ec' : 'rsa',
      deferIssuance: true,
      idempotencyKey: `acme-initial-request:${asset.id}`,
      actorId: input.actorId,
    };
    const request = await this.issuance.createCertificateRequest(input.tenantId, requestInput);
    const renewalWindowKey = `initial:${asset.id}`;
    const existingJob = await this.acmeRepository.getRenewalJobByWindow(input.tenantId, undefined, renewalWindowKey);
    const timestamp = new Date().toISOString();
    const job = existingJob ?? await this.acmeRepository.saveRenewalJob({
      id: newId('acmerenew'),
      tenantId: input.tenantId,
      certificateVersionId: undefined,
      sourceCertificateVersionId: undefined,
      renewalWindowKey,
      status: 'scheduled',
      certificateRequestId: request.id,
      policyId: policy.id,
      promotionStatus: 'not_required',
      attemptCount: 0,
      taskGeneration: 0,
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
    });
    return {
      asset,
      policy,
      certificateRequestId: request.id,
      renewalJobId: job.id,
      provisioningStatus: 'initial_job_scheduled',
      issuanceContextStatus: 'ready',
    };
  }

  async update(input: UpdateAcmeCertificateInput): Promise<AcmeCertificateAutomationView> {
    const asset = await this.requireAcmeAsset(input.tenantId, input.certificateAssetId);
    const currentPolicy = (await this.policies.list(input.tenantId))
      .find((item) => item.certificateAssetId === input.certificateAssetId);
    if (currentPolicy) await this.assertNoRunningJob(input.tenantId, currentPolicy.id);
    const domains = normalizeDomains(input.domains);
    if (domains.length === 0) throw new AppError('VALIDATION_FAILED', '至少需要一个域名');
    if (!input.contactEmail.trim()) throw new AppError('VALIDATION_FAILED', '联系邮箱不能为空');
    if (!Number.isInteger(input.renewalWindowDays) || input.renewalWindowDays < 1 || input.renewalWindowDays > 90) {
      throw new AppError('VALIDATION_FAILED', '提前续签天数必须在 1 到 90 之间');
    }
    if (input.keyType !== undefined && !['rsa', 'ecdsa'].includes(input.keyType)) {
      throw new AppError('VALIDATION_FAILED', '证书密钥类型无效');
    }
    if (input.dnsPropagationSeconds !== undefined
      && (!Number.isInteger(input.dnsPropagationSeconds) || input.dnsPropagationSeconds < 0 || input.dnsPropagationSeconds > 7200)) {
      throw new AppError('VALIDATION_FAILED', 'DNS 传播等待秒数必须在 0 到 7200 之间');
    }

    const provider = (await this.caRepository.listProviders(input.tenantId))
      .find((item) => item.id === input.providerId && item.type === 'acme' && item.status === 'active');
    if (!provider) throw new AppError('RESOURCE_NOT_FOUND', '所选 ACME Provider 不存在或未启用');
    let account = (await this.acmeRepository.listAccounts(input.tenantId, provider.id))
      .find((item) => item.status === 'active');
    if (!account) {
      account = await this.ensureAcmeAccount(provider, {
        tenantId: input.tenantId,
        contactEmail: input.contactEmail,
        // 仅复用 Provider 已保存的条款接受记录，不能在补全历史资产时替用户默认同意条款。
        termsOfServiceAgreed: provider.configuration?.termsOfServiceAgreed === true,
        actorId: input.actorId,
      });
    }
    if (!account) throw new AppError('ACME_ACCOUNT_INVALID', '所选 ACME Provider 没有可用的 Account');

    const dnsProvider = input.dnsProvider?.trim();
    const dnsCredentialId = input.dnsCredentialId?.trim();
    await this.validateDnsConfiguration(input.tenantId, input.challengeType, dnsProvider, dnsCredentialId);

    const recoveredCurrentVersionId = asset.currentVersionId ?? await this.findLatestPromotedVersionId(input.tenantId, asset.id);
    const updatedAsset = await this.certificates.getRepository().updateAsset(asset.id, {
      name: input.name?.trim() || domains[0],
      primaryDomain: domains[0],
      sans: domains.slice(1),
      sourceType: 'acme',
      tags: [...new Set([...(asset.tags ?? []), 'acme'])],
      ...(recoveredCurrentVersionId ? { currentVersionId: recoveredCurrentVersionId } : {}),
      updatedAt: new Date().toISOString(),
    }, input.tenantId);
    const maintenanceWindow = {
      contactEmail: input.contactEmail.trim(),
      keyType: input.keyType ?? 'rsa',
      domains,
      ...(input.challengeType === 'dns-01' && dnsProvider ? { dnsProvider } : {}),
      ...(input.challengeType === 'dns-01' && dnsCredentialId ? { dnsCredentialId } : {}),
      ...(input.challengeType === 'dns-01' && input.dnsPropagationSeconds !== undefined
        ? { dnsPropagationSeconds: input.dnsPropagationSeconds }
        : {}),
    };
    const policyInput = {
      providerId: provider.id,
      accountId: account.id,
      enabled: input.autoRenew,
      renewalWindowDays: input.renewalWindowDays,
      challengeType: input.challengeType,
      maintenanceWindow,
    };
    const updatedPolicy = currentPolicy
      ? await this.policies.update(input.tenantId, currentPolicy.id, { ...policyInput, actorId: input.actorId })
      : await this.policies.create({
        ...policyInput,
        tenantId: input.tenantId,
        certificateAssetId: asset.id,
        actorId: input.actorId,
      });
    return { asset: updatedAsset, policy: updatedPolicy };
  }

  async delete(
    tenantId: string,
    certificateAssetId: string,
    actorId: string,
    context?: RequestContext,
  ): Promise<AcmeCertificateAutomationView> {
    const policy = await this.requirePolicyForAsset(tenantId, certificateAssetId);
    await this.assertNoRunningJob(tenantId, policy.id);
    await this.requireAcmeAsset(tenantId, certificateAssetId);
    const disabledPolicy = await this.policies.update(tenantId, policy.id, {
      enabled: false,
      actorId,
    });
    const deletedAsset = await this.certificates.deleteAsset({
      id: certificateAssetId,
      tenantId,
      status: 'deleted',
      actorId,
    }, [], context);
    return { asset: deletedAsset, policy: disabledPolicy };
  }

  private async validateDnsConfiguration(
    tenantId: string,
    challengeType: AcmeChallengeType,
    dnsProvider?: string,
    dnsCredentialId?: string,
  ): Promise<void> {
    if (challengeType !== 'dns-01') return;
    if (!dnsProvider || !dnsCredentialId) {
      throw new AppError('VALIDATION_FAILED', 'DNS-01 必须提供 DNS Provider 和全局凭据');
    }
    if (!findAcmeDnsProvider(dnsProvider)) {
      throw new AppError('VALIDATION_FAILED', '所选 DNS Provider 不受支持');
    }
    if (!this.credentials) throw new AppError('CAPABILITY_MISSING', '全局凭据服务未注册');
    const credential = await this.credentials.get(tenantId, dnsCredentialId);
    if (credential.kind !== 'DNS_PROVIDER' || credential.status !== 'active') {
      throw new AppError('VALIDATION_FAILED', '所选 DNS 凭据不存在或未启用');
    }
    if (credential.metadata.providerId !== dnsProvider) {
      throw new AppError('VALIDATION_FAILED', 'DNS 凭据与所选 DNS Provider 不匹配', {
        credentialId: dnsCredentialId,
        providerId: dnsProvider,
      });
    }
  }

  private async requirePolicyForAsset(tenantId: string, certificateAssetId: string): Promise<AcmeRenewalPolicyEntity> {
    const policy = (await this.policies.list(tenantId))
      .find((item) => item.certificateAssetId === certificateAssetId);
    if (!policy) throw new AppError('RESOURCE_NOT_FOUND', 'ACME 证书自动化配置不存在', { certificateAssetId });
    return policy;
  }

  private async findLatestPromotedVersionId(tenantId: string, certificateAssetId: string): Promise<string | undefined> {
    const versions = await this.certificates.getRepository().listVersionsByAsset(certificateAssetId, tenantId);
    return versions
      .filter((version) => version.status === 'active' && (version.activationState ?? 'promoted') === 'promoted')
      .sort((left, right) => Date.parse(right.notAfter) - Date.parse(left.notAfter))[0]
      ?.id;
  }

  private async requireAcmeAsset(tenantId: string, certificateAssetId: string) {
    const asset = await this.certificates.getRepository().getAsset(certificateAssetId, tenantId);
    if (!asset || asset.status === 'deleted') {
      throw new AppError('RESOURCE_NOT_FOUND', 'ACME 证书资产不存在', { certificateAssetId });
    }
    return asset;
  }

  private async assertNoRunningJob(tenantId: string, policyId: string): Promise<void> {
    const running = (await this.acmeRepository.listRenewalJobs(tenantId))
      .find((job) => job.policyId === policyId && [
        'scheduled',
        'retry_waiting',
        'issuing',
        'deploying',
        'verifying',
      ].includes(job.status));
    if (running) {
      throw new AppError('RESOURCE_VERSION_CONFLICT', '当前证书存在执行中的 ACME 任务，请等待任务结束后再操作', {
        renewalJobId: running.id,
        status: running.status,
      });
    }
  }

  private async ensureAcmeAccount(
    provider: CaProviderEntity,
    input: Pick<CreateAcmeCertificateInput, 'tenantId' | 'contactEmail' | 'termsOfServiceAgreed' | 'actorId'>,
  ): Promise<Awaited<ReturnType<AcmeRepository['listAccounts']>>[number] | undefined> {
    const configuration = provider.configuration ?? {};
    const preset = typeof configuration.preset === 'string' ? configuration.preset : undefined;
    if (preset !== 'letsencrypt' && configuration.isBuiltIn !== true) {
      throw new AppError('ACME_ACCOUNT_INVALID', '当前 ACME Provider 尚未配置 Account，请先在高级配置中完成连接', {
        providerId: provider.id,
      });
    }
    if (!this.accounts || !this.secrets) {
      throw new AppError('CAPABILITY_MISSING', 'ACME Account 自动准备服务未注册');
    }

    const accountKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString();
    const secret = await this.secrets.create({
      tenantId: input.tenantId,
      name: `ACME Account Key - ${provider.name}`,
      type: 'certificate_private_key',
      scopeType: 'global',
      metadata: {
        purpose: 'acme_account_key',
        providerId: provider.id,
        tenantId: input.tenantId,
      },
      plainText: accountKey,
      createdBy: input.actorId,
    });
    const created = await this.accounts.create({
      tenantId: input.tenantId,
      providerId: provider.id,
      accountKeySecretRef: secret.secretRef,
      contact: [`mailto:${input.contactEmail.trim()}`],
      termsOfServiceAgreed: input.termsOfServiceAgreed,
      actorId: input.actorId,
    });
    if (created.status !== 'active') {
      throw new AppError('ACME_ACCOUNT_INVALID', 'ACME Account 创建后未处于可用状态', {
        providerId: provider.id,
        accountId: created.id,
        status: created.status,
      });
    }
    return (await this.acmeRepository.listAccounts(input.tenantId, provider.id))
      .find((item) => item.id === created.id && item.status === 'active');
  }
}

function normalizeDomains(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
}
