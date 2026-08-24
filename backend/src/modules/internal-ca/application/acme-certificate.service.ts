import { generateKeyPairSync } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { CertificatesApplicationService } from '../../certificates/application/certificates.application-service.js';
import type { CertificateAssetDto } from '../../certificates/dto/certificates.dto.js';
import type { AcmeRepository } from '../repository/acme.repository.js';
import type { InternalCaRepository } from '../repository/internal-ca.repository.js';
import type { AcmeChallengeType, AcmeRenewalDeploymentMode, AcmeRenewalPolicyEntity } from '../schema/acme.schema.js';
import type { CaProviderEntity } from '../schema/internal-ca.schema.js';
import { findAcmeDnsProvider } from '../providers/acme-dns-provider.registry.js';
import type { CredentialsApplicationService } from '../../credentials/application/credentials.application-service.js';
import type { AcmeAccountService } from './acme-account.service.js';
import type { SecretService } from '../../secrets/secret.service.js';
import { AcmeRenewalPolicyService } from './acme-renewal-policy.service.js';

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
  /** @deprecated 新界面使用 dnsCredentialId；保留读取能力以兼容历史客户端。 */
  dnsCredentialSecretRef?: string;
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
  provisioningStatus: 'policy_saved';
  issuanceContextStatus: 'requires_application_context';
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
  ) {}

  async create(input: CreateAcmeCertificateInput): Promise<AcmeCertificateSetupView> {
    const dnsProvider = input.dnsProvider?.trim();
    const dnsCredentialId = input.dnsCredentialId?.trim();
    const dnsCredentialSecretRef = input.dnsCredentialSecretRef?.trim();
    if (!input.termsOfServiceAgreed) {
      throw new AppError('ACME_ACCOUNT_INVALID', '创建 ACME 证书前必须同意服务条款');
    }
    const domains = normalizeDomains(input.domains);
    if (domains.length === 0) throw new AppError('VALIDATION_FAILED', '至少需要一个域名');
    if (!input.contactEmail.trim()) throw new AppError('VALIDATION_FAILED', '联系邮箱不能为空');
    if (input.challengeType === 'dns-01' && (!dnsProvider || (!dnsCredentialId && !dnsCredentialSecretRef))) {
      throw new AppError('VALIDATION_FAILED', 'DNS-01 必须提供 DNS Provider 和全局凭据');
    }
    if (input.challengeType === 'dns-01' && (!dnsProvider || !findAcmeDnsProvider(dnsProvider))) {
      throw new AppError('VALIDATION_FAILED', '所选 DNS Provider 不受支持');
    }
    if (input.challengeType === 'dns-01' && dnsCredentialId) {
      if (!this.credentials) throw new AppError('CAPABILITY_MISSING', '全局凭据服务未注册');
      const credential = await this.credentials.get(input.tenantId, dnsCredentialId);
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
      ...(dnsCredentialSecretRef ? { dnsCredentialSecretRef } : {}),
      ...(input.dnsPropagationSeconds !== undefined ? { dnsPropagationSeconds: input.dnsPropagationSeconds } : {}),
      contactEmail: input.contactEmail.trim(),
      keyType: input.keyType ?? 'rsa',
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
      deploymentMode: 'automatic' as AcmeRenewalDeploymentMode,
      rotateKeyOnRenewal: true,
      maxAttempts: 5,
      backoffSeconds: 300,
      maintenanceWindow,
    };
    const policy = existing
      ? await this.policies.update(input.tenantId, existing.id, { ...policyInput, actorId: input.actorId })
      : await this.policies.create({ ...policyInput, tenantId: input.tenantId, actorId: input.actorId });
    return {
      asset,
      policy,
      provisioningStatus: 'policy_saved',
      issuanceContextStatus: 'requires_application_context',
    };
  }

  private async ensureAcmeAccount(
    provider: CaProviderEntity,
    input: CreateAcmeCertificateInput,
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
