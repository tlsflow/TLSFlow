import { AppError } from '../../../common/errors/app-error.js';
import type { InternalCaApplicationService } from '../../internal-ca/application/internal-ca.application-service.js';
import type { AcmeRenewalPolicyService } from '../../internal-ca/application/acme-renewal-policy.service.js';
import type { AcmeRepository } from '../../internal-ca/repository/acme.repository.js';
import type { AcmeRenewalScheduler } from '../../internal-ca/application/acme-renewal-scheduler.js';
import type { SecretService } from '../../secrets/secret.service.js';
import { validateLegoCredentialPayload } from '../../internal-ca/providers/lego-dns-issuer.js';
import type { CertificatesApplicationService } from '../../certificates/application/certificates.application-service.js';
import { listAcmeDnsProviders } from '../../internal-ca/providers/acme-dns-provider.registry.js';
import type {
  ApplicationCertificateSupplyResponse,
  CertificateSupplyCandidateDto,
  CertificateSupplyPreviewDto,
  UpdateApplicationCertificatePolicyDto,
} from '../dto/application-certificate-supply.dto.js';
import type { ApplicationCertificateSupplyRepositoryPort } from '../repository/application-certificate-supply.repository.js';
import type {
  ApplicationCertificateArtifactMode,
  ApplicationCertificateCustodyMode,
  ApplicationCertificatePolicyEntity,
  ApplicationCertificatePolicyVersionEntity,
} from '../schema/application-certificate-supply.schema.js';

export class ApplicationCertificateSupplyApplicationService {
  private acmePolicies?: Pick<AcmeRenewalPolicyService, 'list' | 'create' | 'update'>;
  private acmeRepository?: Pick<AcmeRepository, 'listAccounts'>;
  private acmeScheduler?: Pick<AcmeRenewalScheduler, 'scheduleInitialIssuance'>;

  constructor(
    private readonly repository: ApplicationCertificateSupplyRepositoryPort,
    private readonly internalCa?: Pick<InternalCaApplicationService, 'listProviders' | 'listAuthorities' | 'listProfiles' | 'listAcmeProviderProfiles'>,
    private readonly certificates?: Pick<CertificatesApplicationService, 'createAsset'>,
    private readonly issuance?: Pick<InternalCaApplicationService, 'createCertificateRequest' | 'ensureAcmeIssuanceContext' | 'getRequestByIdempotencyKey'>,
    private readonly secrets?: Pick<SecretService, 'resolveForService'>,
  ) {}

  /** 在 ACME 资源装配完成后注入续期策略和 Account 查询，避免模块构造循环。 */
  setAcmeRenewalIntegration(
    policies?: Pick<AcmeRenewalPolicyService, 'list' | 'create' | 'update'>,
    repository?: Pick<AcmeRepository, 'listAccounts'>,
    scheduler?: Pick<AcmeRenewalScheduler, 'scheduleInitialIssuance'>,
  ): void {
    this.acmePolicies = policies;
    this.acmeRepository = repository;
    this.acmeScheduler = scheduler;
  }

  async get(tenantId: string, applicationAssetId: string): Promise<ApplicationCertificateSupplyResponse> {
    const application = await this.requireApplication(tenantId, applicationAssetId);
    const [policy, candidates, capability, providers] = await Promise.all([
      this.repository.getPolicy(tenantId, applicationAssetId),
      this.repository.listCertificateCandidates(tenantId),
      this.repository.resolveCustodyCapability(tenantId, applicationAssetId),
      this.loadProviders(tenantId),
    ]);
    const filtered = selectLatestCandidates(candidates, application.primaryDomain);
    const current = policy?.currentVersion;
    const currentInput = current ? versionToInput(current) : { supplyMode: 'manual' as const };
    const dnsAuthorization = await this.resolveDnsAuthorization(tenantId, currentInput, 'system:application-certificate-supply');
    const readiness = this.evaluate(currentInput, application.primaryDomain, filtered, capability.mode, capability.evidence, providers, dnsAuthorization);
    return {
      applicationAssetId,
      primaryDomain: application.primaryDomain,
      ...(policy ? { policy: policy.policy, ...(current ? { currentVersion: current } : {}) } : {}),
      certificateCandidates: filtered,
      providers: providers.payload,
      capability: {
        custodyMode: capability.mode,
        deploymentArtifactMode: artifactModeFor(capability.mode),
        evidence: capability.evidence,
      },
      readiness,
    };
  }

  async preview(tenantId: string, applicationAssetId: string, input: CertificateSupplyPreviewDto): Promise<ApplicationCertificateSupplyResponse> {
    const application = await this.requireApplication(tenantId, applicationAssetId);
    const [currentPolicy, candidates, capability, providers] = await Promise.all([
      this.repository.getPolicy(tenantId, applicationAssetId),
      this.repository.listCertificateCandidates(tenantId),
      this.repository.resolveCustodyCapability(tenantId, applicationAssetId),
      this.loadProviders(tenantId),
    ]);
    const filtered = selectLatestCandidates(candidates, application.primaryDomain);
    const merged = { ...(currentPolicy?.currentVersion ? versionToInput(currentPolicy.currentVersion) : {}), ...input };
    const dnsAuthorization = await this.resolveDnsAuthorization(tenantId, merged, 'system:application-certificate-supply-preview');
    const readiness = this.evaluate(merged, application.primaryDomain, filtered, capability.mode, capability.evidence, providers, dnsAuthorization);
    return {
      applicationAssetId,
      primaryDomain: application.primaryDomain,
      ...(currentPolicy ? { policy: currentPolicy.policy, ...(currentPolicy.currentVersion ? { currentVersion: currentPolicy.currentVersion } : {}) } : {}),
      certificateCandidates: filtered,
      providers: providers.payload,
      capability: {
        custodyMode: capability.mode,
        deploymentArtifactMode: artifactModeFor(capability.mode),
        evidence: capability.evidence,
      },
      readiness,
    };
  }

  async update(tenantId: string, applicationAssetId: string, input: UpdateApplicationCertificatePolicyDto, actorId: string): Promise<ApplicationCertificateSupplyResponse> {
    const application = await this.requireApplication(tenantId, applicationAssetId);
    const existingPolicy = await this.repository.getPolicy(tenantId, applicationAssetId);
    if (input.supplyMode === 'dedicated'
      && input.providerType
      && existingPolicy?.currentVersion?.supplyMode === 'dedicated'
      && existingPolicy.currentVersion.status !== 'disabled') {
      const currentProviderType = existingPolicy.currentVersion.providerType;
      if (currentProviderType && currentProviderType !== input.providerType) {
        throw new AppError('APPLICATION_CERTIFICATE_POLICY_INVALID', 'Internal CA 与 ACME 不能静默互相切换，请先显式停用当前专属策略', {
          currentProviderType,
          requestedProviderType: input.providerType,
        });
      }
    }
    const [candidates, capability, providers] = await Promise.all([
      this.repository.listCertificateCandidates(tenantId),
      this.repository.resolveCustodyCapability(tenantId, applicationAssetId),
      this.loadProviders(tenantId),
    ]);
    const filtered = selectLatestCandidates(candidates, application.primaryDomain);
    const dnsAuthorization = await this.resolveDnsAuthorization(tenantId, input, actorId);
    const normalized = this.normalizeInput(input, application.primaryDomain, filtered, capability.mode, capability.evidence, providers, dnsAuthorization);
    // 相同配置的重复保存必须收敛到当前不可变版本，尤其是 provisioning
    // 重试不能再创建新的策略版本、证书资产或 CA Request。
    const currentVersion = existingPolicy?.currentVersion;
    // 策略版本不可变：只有相同生命周期状态的重复提交才复用当前版本。
    // draft -> provisioning 必须落新版本并启动签发，不能被配置幂等比较吞掉。
    if (currentVersion
      && currentVersion.status === normalized.status
      && sameProvisioningConfig(currentVersion, normalized, application.primaryDomain)) {
      const provisioned = await this.provisionDedicated(tenantId, applicationAssetId, application.primaryDomain, actorId, normalized, currentVersion);
      const response = await this.get(tenantId, applicationAssetId);
      return { ...response, policy: provisioned?.policy ?? existingPolicy!.policy, currentVersion: provisioned?.currentVersion ?? currentVersion };
    }
    const saved = await this.repository.saveVersion(tenantId, applicationAssetId, application.primaryDomain, {
      ...normalized,
      policySnapshot: {
        actorId,
        applicationAssetId,
        primaryDomain: application.primaryDomain,
        supplyMode: normalized.supplyMode,
        providerType: normalized.providerType,
        credentialRef: normalized.credentialRef,
      },
    });
    const provisioned = await this.provisionDedicated(tenantId, applicationAssetId, application.primaryDomain, actorId, normalized, saved.currentVersion);
    const response = await this.get(tenantId, applicationAssetId);
    return { ...response, policy: provisioned?.policy ?? saved.policy, currentVersion: provisioned?.currentVersion ?? saved.currentVersion };
  }

  /** 由生命周期执行结果回写当前活动策略版本，历史版本保持不可变。 */
  async updateLifecycleStatus(tenantId: string, applicationAssetId: string, status: ApplicationCertificatePolicyVersionEntity['status'], certificateVersionId?: string): Promise<void> {
    await this.repository.updateCurrentVersionStatus?.(tenantId, applicationAssetId, status, certificateVersionId);
  }

  /**
   * 应用主域名变化时复制一份不可变策略版本并重新校验。
   * 手动模式失配后只保留 draft；专属模式沿用原 Provider 配置进入 provisioning，
   * 由现有签发链创建新的专属资产，不按域名猜测或复用旧资产。
   */
  async onApplicationDomainChanged(
    tenantId: string,
    applicationAssetId: string,
    primaryDomain: string,
    actorId = 'application.domain.changed',
  ): Promise<ApplicationCertificateSupplyResponse | undefined> {
    // AssetsApplicationService 也服务普通 ServiceAsset；非 Application 资产没有供应策略，
    // 域名变化必须是无副作用的通知，而不是把一次成功更新变成错误响应。
    if (!(await this.repository.getApplication(tenantId, applicationAssetId))) return undefined;
    const existing = await this.repository.getPolicy(tenantId, applicationAssetId);
    const current = existing?.currentVersion;
    if (!current || normalizeDomain(current.primaryDomain) === normalizeDomain(primaryDomain)) return undefined;
    const previousDedicatedAssetId = current.supplyMode === 'dedicated' ? current.certificateAssetId : undefined;

    const next: UpdateApplicationCertificatePolicyDto = {
      ...versionToInput(current),
      // 证书资产和版本属于上一策略版本，不能复制到新的域名版本。
      // 手动模式失配后必须清除旧引用，否则保存时会再次触发域名匹配门禁。
      certificateAssetId: undefined,
      certificateVersionId: undefined,
      ...(current.supplyMode === 'manual' ? { status: 'draft' as const } : {}),
    };
    if (current.supplyMode === 'dedicated') {
      next.status = current.status === 'draft' ? 'draft' : 'provisioning';
      // 域名变更发生在资产更新之后；若新的 DNS SecretRef 无法证明控制权，
      // 必须仍然落一条新 draft 版本，避免资产已是新域名而策略继续指向旧域名，
      // 也避免在回调中抛错造成调用方误以为整次更新失败。
      if (current.providerType === 'acme') {
        const dnsAuthorization = await this.resolveDnsAuthorization(tenantId, next, actorId);
        if (dnsAuthorization === false) next.status = 'draft';
      }
    }
    const response = await this.update(tenantId, applicationAssetId, next, actorId);
    if (previousDedicatedAssetId && this.acmePolicies?.list && this.acmePolicies.update) {
      // 域名变更后旧专属资产只作为历史事实保留，不能继续被续签调度器视为活动目标。
      const previousPolicy = (await this.acmePolicies.list(tenantId))
        .find((item) => item.certificateAssetId === previousDedicatedAssetId && item.status !== 'disabled');
      if (previousPolicy) {
        await this.acmePolicies.update(tenantId, previousPolicy.id, {
          enabled: false,
          actorId,
        });
      }
    }
    return response;
  }

  /**
   * 专属策略只有明确进入 provisioning 及以后才创建申请；draft 仅保存配置，避免生成密钥或远程订单。
   */
  private async provisionDedicated(
    tenantId: string,
    applicationAssetId: string,
    primaryDomain: string,
    actorId: string,
    input: Omit<ApplicationCertificatePolicyVersionEntity, 'id' | 'policyId' | 'tenantId' | 'applicationAssetId' | 'versionNo' | 'isActive' | 'primaryDomain' | 'createdAt' | 'updatedAt'>,
    savedVersion: ApplicationCertificatePolicyVersionEntity,
  ): Promise<{ policy: ApplicationCertificatePolicyEntity; currentVersion: ApplicationCertificatePolicyVersionEntity } | undefined> {
    if (input.supplyMode !== 'dedicated' || !input.providerType || !this.certificates || !this.issuance) return undefined;
    if (!['provisioning', 'issued', 'ready_to_deploy', 'deployed', 'tls_verified', 'renewing'].includes(input.status)) return undefined;
    let acmeAccountId: string | undefined;
    let acmeContactEmail: string | undefined;
    if (input.providerType === 'acme') {
      if (!this.acmePolicies || !this.acmeRepository || !input.providerId) {
        throw new AppError('ACME_ACCOUNT_INVALID', '专属 ACME Provider 尚未完成续签资源装配');
      }
      const accounts = await this.acmeRepository.listAccounts(tenantId, input.providerId);
      const activeAccount = accounts.find((item) => item.status === 'active');
      acmeAccountId = activeAccount?.id;
      acmeContactEmail = activeAccount?.contact
        .map((item) => item.replace(/^mailto:/i, '').trim())
        .find((item) => item.includes('@'));
      if (!acmeAccountId || !acmeContactEmail) {
        throw new AppError('ACME_ACCOUNT_INVALID', '专属 ACME Provider 没有可用的 Account');
      }
    }
    // 已有活动版本已绑定专属资产时直接复用；只有首次 provisioning 才创建新资产。
    const asset = savedVersion.certificateAssetId
      ? { id: savedVersion.certificateAssetId }
      : await this.certificates.createAsset({
          tenantId,
          applicationAssetId,
          name: `dedicated:${primaryDomain}`,
          primaryDomain,
          sans: [],
          sourceType: input.providerType === 'acme' ? 'acme' : 'internal_ca',
          tags: ['application-dedicated'],
          createdBy: actorId,
        });
    const boundVersion = savedVersion.certificateAssetId === asset.id
      ? savedVersion
      : await this.repository.bindVersionCertificate(tenantId, applicationAssetId, savedVersion.id, asset.id);
    const requestIdempotencyKey = input.providerType === 'acme'
      ? `acme-initial-request:${asset.id}`
      : `application-certificate:${applicationAssetId}:policy:${boundVersion.id}`;
    const existingRequest = this.issuance.getRequestByIdempotencyKey
      ? await this.issuance.getRequestByIdempotencyKey(tenantId, requestIdempotencyKey)
      : undefined;
    if (existingRequest && (existingRequest.applicationAssetId !== applicationAssetId
      || existingRequest.certificateAssetId !== asset.id
      || existingRequest.applicationCertificatePolicyVersionId !== boundVersion.id)) {
      throw new AppError('APPLICATION_CERTIFICATE_POLICY_INVALID', '已有证书申请的应用、证书资产或策略版本归属不匹配，拒绝复用', {
        requestId: existingRequest.id,
        applicationAssetId,
        certificateAssetId: asset.id,
        applicationCertificatePolicyVersionId: boundVersion.id,
      });
    }
    if (!existingRequest) {
      const issuanceContext = input.providerType === 'acme'
        ? await this.issuance.ensureAcmeIssuanceContext(tenantId, input.providerId ?? '', actorId)
        : {
            caId: input.certificateAuthorityId ?? '',
            profileVersionId: input.certificateProfileVersionId ?? '',
            trustDomainId: undefined,
          };
      if (!issuanceContext.caId || !issuanceContext.profileVersionId) {
        throw new AppError('APPLICATION_CERTIFICATE_POLICY_INVALID', '专属证书缺少可用的 CA/Profile 上下文');
      }
      await this.issuance.createCertificateRequest(tenantId, {
        applicationAssetId,
        certificateAssetId: asset.id,
        applicationCertificatePolicyVersionId: boundVersion.id,
        caId: issuanceContext.caId,
        trustDomainId: issuanceContext.trustDomainId,
        profileVersionId: issuanceContext.profileVersionId,
        commonName: primaryDomain,
        sans: [],
        requestedValidityDays: input.renewalWindowDays ?? 90,
        custodyMode: input.custodyMode === 'agent_local' ? 'local_agent' : input.custodyMode ?? 'managed_secret',
        deferIssuance: true,
        idempotencyKey: requestIdempotencyKey,
        actorId,
      });
    }
    if (input.providerType === 'acme' && this.acmePolicies && this.acmeRepository) {
      const existingPolicy = (await this.acmePolicies.list(tenantId))
        .find((item) => item.certificateAssetId === asset.id && item.status !== 'disabled');
      const maintenanceWindow = {
        dnsProvider: input.dnsProviderId,
        contactEmail: acmeContactEmail,
        domains: [primaryDomain],
      };
      const acmePolicyInput = {
        certificateAssetId: asset.id,
        applicationAssetId,
        applicationCertificatePolicyVersionId: boundVersion.id,
        providerId: input.providerId!,
        accountId: acmeAccountId!,
        enabled: input.autoRenew !== false,
        renewalWindowDays: input.renewalWindowDays ?? 30,
        challengeType: 'dns-01' as const,
        rotateKeyOnRenewal: input.rotateKeyOnRenewal !== false,
        maxAttempts: 5,
        backoffSeconds: 300,
        maintenanceWindow,
        dnsCredentialRef: input.credentialRef,
        actorId,
      };
      if (existingPolicy && this.acmePolicies.update) {
        await this.acmePolicies.update(tenantId, existingPolicy.id, { ...acmePolicyInput, actorId });
      } else {
        await this.acmePolicies.create({ tenantId, ...acmePolicyInput });
      }
      // 立即接入统一 ACME 调度器，后台扫描仍负责进程重启或写入竞争后的补偿。
      if (this.acmeScheduler) {
        await this.acmeScheduler.scheduleInitialIssuance(tenantId, asset.id);
      }
    }
    const current = await this.repository.getPolicy(tenantId, applicationAssetId);
    if (!current?.currentVersion) throw new AppError('RESOURCE_VERSION_CONFLICT', '专属证书策略版本保存后无法读取');
    return { policy: current.policy, currentVersion: current.currentVersion };
  }

  private async requireApplication(tenantId: string, applicationAssetId: string): Promise<{ id: string; primaryDomain: string }> {
    const application = await this.repository.getApplication(tenantId, applicationAssetId);
    if (!application) throw new AppError('RESOURCE_NOT_FOUND', 'Application 不存在', { applicationAssetId });
    return application;
  }

  private normalizeInput(
    input: UpdateApplicationCertificatePolicyDto,
    primaryDomain: string,
    candidates: CertificateSupplyCandidateDto[],
    custodyMode: ApplicationCertificateCustodyMode,
    capabilityEvidence: Record<string, unknown>,
    providers: Awaited<ReturnType<ApplicationCertificateSupplyApplicationService['loadProviders']>>,
    dnsAuthorization?: boolean,
  ): Omit<ApplicationCertificatePolicyVersionEntity, 'id' | 'policyId' | 'tenantId' | 'applicationAssetId' | 'versionNo' | 'isActive' | 'primaryDomain' | 'createdAt' | 'updatedAt'> {
    const readiness = this.evaluate(input, primaryDomain, candidates, custodyMode, capabilityEvidence, providers, dnsAuthorization);
    if (input.credentialRef !== undefined && !isSecretRef(input.credentialRef)) {
      throw new AppError('SECRET_REF_INVALID', '凭据必须使用 SecretRef', { field: 'credentialRef' });
    }
    if (input.supplyMode === 'manual' && input.certificateVersionId) {
      const candidate = candidates.find((item) => item.certificateVersionId === input.certificateVersionId);
      if (!candidate) throw new AppError('CERTIFICATE_DOMAIN_NOT_MATCHED', '证书版本的 CN/SAN 未覆盖应用主域名', { applicationAssetId: 'redacted', certificateVersionId: input.certificateVersionId, primaryDomain });
      if (input.certificateAssetId && input.certificateAssetId !== candidate.certificateAssetId) {
        throw new AppError('APPLICATION_CERTIFICATE_POLICY_INVALID', '证书资产和证书版本 ID 不属于同一证书', { certificateAssetId: input.certificateAssetId, certificateVersionId: input.certificateVersionId });
      }
    }
    if (input.supplyMode === 'dedicated' && input.certificateAssetId && input.certificateAssetId !== undefined) {
      // 专属策略不能把任意共享证书资产伪装成专属资产；真正新资产由生命周期服务创建。
      throw new AppError('DEDICATED_CERTIFICATE_OWNERSHIP_CONFLICT', '专属证书不能复用手动证书资产', { certificateAssetId: input.certificateAssetId });
    }
    const expectedArtifact = artifactModeFor(custodyMode);
    if (input.deploymentArtifactMode && input.deploymentArtifactMode !== expectedArtifact) {
      throw new AppError('CERTIFICATE_ARTIFACT_MODE_MISMATCH', '制品模式与目标密钥归属不匹配', { expected: expectedArtifact, actual: input.deploymentArtifactMode });
    }
    // PUT 是配置保存，不是启动签发。只有调用方显式传入 provisioning
    // 才允许后续流程创建密钥、Request 或 Order；普通保存始终保持 draft。
    const lifecycleStatus = input.status ?? 'draft';
    if (lifecycleStatus !== 'draft' && input.supplyMode === 'dedicated' && !readiness.canIssue) {
      throw new AppError('APPLICATION_CERTIFICATE_POLICY_INVALID', '专属证书尚未满足签发条件，只能保存草稿', { reasons: readiness.reasons });
    }
    return {
      supplyMode: input.supplyMode,
      ...(input.supplyMode === 'manual' && input.certificateAssetId ? { certificateAssetId: input.certificateAssetId } : {}),
      ...(input.supplyMode === 'manual' && input.certificateVersionId ? { certificateVersionId: input.certificateVersionId } : {}),
      ...(input.supplyMode === 'dedicated' && input.providerType ? { providerType: input.providerType } : {}),
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(input.certificateAuthorityId ? { certificateAuthorityId: input.certificateAuthorityId } : {}),
      ...(input.acmeProviderProfileId ? { acmeProviderProfileId: input.acmeProviderProfileId } : {}),
      ...(input.dnsProviderId ? { dnsProviderId: input.dnsProviderId } : {}),
      ...(input.credentialRef ? { credentialRef: input.credentialRef } : {}),
      ...(input.certificateProfileVersionId ? { certificateProfileVersionId: input.certificateProfileVersionId } : {}),
      custodyMode,
      deploymentArtifactMode: expectedArtifact,
      autoRenew: Boolean(input.autoRenew),
      ...(input.renewalWindowDays !== undefined ? { renewalWindowDays: input.renewalWindowDays } : {}),
      rotateKeyOnRenewal: Boolean(input.rotateKeyOnRenewal),
      status: lifecycleStatus,
      policySnapshot: { readiness },
    };
  }

  private evaluate(
    input: Partial<UpdateApplicationCertificatePolicyDto> & { supplyMode: string },
    primaryDomain: string,
    candidates: CertificateSupplyCandidateDto[],
    custodyMode: ApplicationCertificateCustodyMode,
    capabilityEvidence: Record<string, unknown>,
    providers: Awaited<ReturnType<ApplicationCertificateSupplyApplicationService['loadProviders']>>,
    dnsAuthorization?: boolean,
  ): { canSave: boolean; canIssue: boolean; canDeploy: boolean; reasons: string[] } {
    const reasons: string[] = [];
    if (input.supplyMode !== 'manual' && input.supplyMode !== 'dedicated') reasons.push('APPLICATION_CERTIFICATE_POLICY_INVALID');
    let canIssue = false;
    let canDeploy = false;
    if (input.supplyMode === 'manual') {
      if (input.certificateVersionId && !candidates.some((item) => item.certificateVersionId === input.certificateVersionId && item.matchesPrimaryDomain && item.deployable)) {
        reasons.push('CERTIFICATE_DOMAIN_NOT_MATCHED');
      }
      canDeploy = Boolean(input.certificateVersionId && candidates.some((item) => item.certificateVersionId === input.certificateVersionId && item.deployable));
    }
    if (input.supplyMode === 'dedicated') {
      if (!input.providerType) reasons.push('PROVIDER_REQUIRED');
      if (input.providerType === 'acme') {
        if (!input.providerId) reasons.push('ACME_PROVIDER_REQUIRED');
        if (!input.acmeProviderProfileId) reasons.push('ACME_PROFILE_REQUIRED');
        if (!input.dnsProviderId) reasons.push('ACME_DNS_AUTHORIZATION_REQUIRED');
        if (!input.credentialRef) reasons.push('ACME_CREDENTIAL_SECRET_REF_REQUIRED');
        if (input.providerId && !providers.payload.acme.some((item) => item.id === input.providerId)) reasons.push('ACME_PROVIDER_INVALID');
        if (input.dnsProviderId && !providers.payload.dns.some((item) => item.id === input.dnsProviderId)) reasons.push('ACME_DNS_PROVIDER_INVALID');
        if (dnsAuthorization === false) reasons.push('ACME_DNS_AUTHORIZATION_REQUIRED');
        canIssue = reasons.length === 0;
      } else if (input.providerType === 'internal_ca') {
        if (!input.certificateAuthorityId) reasons.push('CA_REQUIRED');
        if (!input.certificateProfileVersionId) reasons.push('CERTIFICATE_PROFILE_REQUIRED');
        const authority = input.certificateAuthorityId ? providers.authorities.find((item) => item.id === input.certificateAuthorityId) : undefined;
        if (input.certificateAuthorityId && !authority) reasons.push('CA_INVALID');
        if (authority && input.providerId && authority.providerId !== input.providerId) reasons.push('CA_PROVIDER_MISMATCH');
        if (input.providerId && !providers.payload.ca.some((item) => item.id === input.providerId)) reasons.push('CA_PROVIDER_INVALID');
        if (input.certificateProfileVersionId && !providers.profiles.some((entry) => entry.versions.some((version) => version.id === input.certificateProfileVersionId))) reasons.push('CERTIFICATE_PROFILE_INVALID');
        canIssue = reasons.length === 0;
      }
      if (custodyMode === 'managed_secret') {
        reasons.push('UNMANAGED_DEPLOYMENT_CONTEXT_REQUIRED');
        canDeploy = false;
      } else {
        canDeploy = canIssue;
      }
    }
    return {
      canSave: !reasons.includes('APPLICATION_CERTIFICATE_POLICY_INVALID')
        && !reasons.includes('CERTIFICATE_DOMAIN_NOT_MATCHED')
        && !reasons.includes('DEDICATED_CERTIFICATE_OWNERSHIP_CONFLICT'),
      canIssue,
      canDeploy,
      reasons: [...new Set(reasons)],
    };
  }

  private async loadProviders(tenantId: string) {
    const [rawProviders, authorities, profileEntries] = await Promise.all([
      this.internalCa?.listProviders(tenantId) ?? Promise.resolve([]),
      this.internalCa?.listAuthorities(tenantId) ?? Promise.resolve([]),
      this.internalCa?.listProfiles(tenantId) ?? Promise.resolve([]),
    ]);
    const acmeProviderProfiles = this.internalCa?.listAcmeProviderProfiles?.() ?? [];
    const providers = rawProviders.map((provider) => ({
      id: provider.id,
      name: provider.name,
      type: provider.type,
      status: provider.status,
      ...(provider.capabilities ? { capabilities: provider.capabilities as unknown as Record<string, unknown> } : {}),
    }));
    const dns = listAcmeDnsProviders().map((item) => ({ id: item.id, name: item.name, requiresSecretRef: true as const }));
    return {
      payload: {
        ca: providers.filter((provider) => provider.type !== 'acme'),
        acme: providers.filter((provider) => provider.type === 'acme'),
        dns,
        acmeProviderProfiles: acmeProviderProfiles.map((profile) => ({ id: profile.key, name: profile.displayName, version: profile.version })),
        authorities: authorities.map((item) => ({ id: item.id, name: item.name, providerId: item.providerId, status: item.status })),
        profiles: profileEntries.map((entry) => ({
          id: entry.profile.id,
          name: entry.profile.name,
          currentVersion: entry.profile.currentVersion,
          versions: entry.versions.map((version) => ({ id: version.id, versionNo: version.versionNo })),
        })),
      },
      authorities,
      profiles: profileEntries,
    };
  }

  /**
   * 解析并校验专属 ACME 的 DNS SecretRef。没有注入 SecretService 时保留
   * 旧的纯合同测试行为；正式应用模块会注入该服务，从而在 provisioning
   * 前阻断不存在、跨租户、停用或内容为空的 DNS 凭据。
   */
  private async resolveDnsAuthorization(
    tenantId: string,
    input: Partial<UpdateApplicationCertificatePolicyDto> & { supplyMode: string },
    actorId: string,
  ): Promise<boolean | undefined> {
    if (input.supplyMode !== 'dedicated' || input.providerType !== 'acme' || !this.secrets) return undefined;
    if (!input.credentialRef || !input.dnsProviderId || !isSecretRef(input.credentialRef)) return false;
    try {
      const resolved = await this.secrets.resolveForService({
        secretRef: input.credentialRef,
        tenantId,
        expectedType: 'password',
        purpose: 'acme.application.dns.authorization',
        actorId,
      });
      validateLegoCredentialPayload(input.dnsProviderId, resolved.plainText);
      return true;
    } catch {
      // 预览和保存只返回稳定阻断原因，绝不把 SecretService 的内部细节或明文带到 API。
      return false;
    }
  }
}

function versionToInput(version: ApplicationCertificatePolicyVersionEntity): UpdateApplicationCertificatePolicyDto {
  return {
    supplyMode: version.supplyMode,
    ...(version.certificateAssetId ? { certificateAssetId: version.certificateAssetId } : {}),
    ...(version.certificateVersionId ? { certificateVersionId: version.certificateVersionId } : {}),
    ...(version.providerType ? { providerType: version.providerType } : {}),
    ...(version.providerId ? { providerId: version.providerId } : {}),
    ...(version.certificateAuthorityId ? { certificateAuthorityId: version.certificateAuthorityId } : {}),
    ...(version.acmeProviderProfileId ? { acmeProviderProfileId: version.acmeProviderProfileId } : {}),
    ...(version.dnsProviderId ? { dnsProviderId: version.dnsProviderId } : {}),
    ...(version.credentialRef ? { credentialRef: version.credentialRef } : {}),
    ...(version.certificateProfileVersionId ? { certificateProfileVersionId: version.certificateProfileVersionId } : {}),
    custodyMode: version.custodyMode,
    deploymentArtifactMode: version.deploymentArtifactMode,
    autoRenew: version.autoRenew,
    renewalWindowDays: version.renewalWindowDays,
    rotateKeyOnRenewal: version.rotateKeyOnRenewal,
    status: version.status,
  };
}

function artifactModeFor(mode: ApplicationCertificateCustodyMode): ApplicationCertificateArtifactMode {
  return mode === 'managed_secret' ? 'certificate_with_private_key' : 'certificate_only';
}

function isSecretRef(value: string): boolean {
  return /^secret:\/\/[A-Za-z0-9._:/#-]{1,512}$/.test(value.trim());
}

/** 比较策略的业务输入，忽略每次保存都会变化的审计快照。 */
function sameProvisioningConfig(
  current: ApplicationCertificatePolicyVersionEntity,
  next: Omit<ApplicationCertificatePolicyVersionEntity, 'id' | 'policyId' | 'tenantId' | 'applicationAssetId' | 'versionNo' | 'isActive' | 'primaryDomain' | 'createdAt' | 'updatedAt'>,
  primaryDomain: string,
): boolean {
  const normalize = (value: unknown): unknown => value === undefined ? null : value;
  const currentShape = {
    primaryDomain: normalizeDomain(current.primaryDomain),
    supplyMode: current.supplyMode,
    // 专属资产和当前证书版本由 provisioning 结果回写，业务输入中不传入，
    // 因此不能把它们当作配置差异导致重复创建策略版本。
    certificateAssetId: current.supplyMode === 'dedicated' && next.supplyMode === 'dedicated'
      ? null
      : normalize(current.certificateAssetId),
    certificateVersionId: current.supplyMode === 'dedicated' && next.supplyMode === 'dedicated'
      ? null
      : normalize(current.certificateVersionId),
    providerType: normalize(current.providerType),
    providerId: normalize(current.providerId),
    certificateAuthorityId: normalize(current.certificateAuthorityId),
    acmeProviderProfileId: normalize(current.acmeProviderProfileId),
    dnsProviderId: normalize(current.dnsProviderId),
    credentialRef: normalize(current.credentialRef),
    certificateProfileVersionId: normalize(current.certificateProfileVersionId),
    custodyMode: normalize(current.custodyMode),
    deploymentArtifactMode: normalize(current.deploymentArtifactMode),
    autoRenew: current.autoRenew,
    renewalWindowDays: normalize(current.renewalWindowDays),
    rotateKeyOnRenewal: current.rotateKeyOnRenewal,
  };
  const nextShape = {
    primaryDomain: normalizeDomain(primaryDomain),
    supplyMode: next.supplyMode,
    certificateAssetId: next.supplyMode === 'dedicated' ? null : normalize(next.certificateAssetId),
    certificateVersionId: next.supplyMode === 'dedicated' ? null : normalize(next.certificateVersionId),
    providerType: normalize(next.providerType),
    providerId: normalize(next.providerId),
    certificateAuthorityId: normalize(next.certificateAuthorityId),
    acmeProviderProfileId: normalize(next.acmeProviderProfileId),
    dnsProviderId: normalize(next.dnsProviderId),
    credentialRef: normalize(next.credentialRef),
    certificateProfileVersionId: normalize(next.certificateProfileVersionId),
    custodyMode: normalize(next.custodyMode),
    deploymentArtifactMode: normalize(next.deploymentArtifactMode),
    autoRenew: next.autoRenew,
    renewalWindowDays: normalize(next.renewalWindowDays),
    rotateKeyOnRenewal: next.rotateKeyOnRenewal,
  };
  const equal = Object.keys(nextShape).every((key) => {
    const currentValue = (currentShape as Record<string, unknown>)[key];
    const nextValue = (nextShape as Record<string, unknown>)[key];
    return currentValue === nextValue;
  });
  return equal;
}

function candidateMatches(candidate: CertificateSupplyCandidateDto, domain: string): boolean {
  const names = [candidate.primaryDomain, candidate.commonName, ...candidate.sans].filter((item): item is string => Boolean(item));
  return names.some((name) => dnsNameMatches(name, domain));
}

function selectLatestCandidates(candidates: CertificateSupplyCandidateDto[], domain: string): CertificateSupplyCandidateDto[] {
  const latestByCertificateAndIssuer = new Map<string, CertificateSupplyCandidateDto>();
  for (const candidate of candidates) {
    if (!candidateMatches(candidate, domain)) continue;
    const key = `${normalizeDomain(candidate.primaryDomain)}|${issuerKey(candidate)}`;
    const previous = latestByCertificateAndIssuer.get(key);
    if (!previous || compareCandidateExpiry(candidate, previous) > 0) {
      latestByCertificateAndIssuer.set(key, { ...candidate, matchesPrimaryDomain: true });
    }
  }
  return [...latestByCertificateAndIssuer.values()];
}

function issuerKey(candidate: CertificateSupplyCandidateDto): string {
  const issuer = candidate.issuer;
  const structuredValues = [issuer?.commonName, issuer?.organization, issuer?.organizationalUnit, issuer?.country, issuer?.state, issuer?.locality]
    .filter((value): value is string => Boolean(value));
  return (structuredValues.length > 0 ? structuredValues : [issuer?.raw || candidate.sourceType])
    .map((value) => value.trim().toLowerCase())
    .join('|');
}

function compareCandidateExpiry(left: CertificateSupplyCandidateDto, right: CertificateSupplyCandidateDto): number {
  const leftTime = left.notAfter ? Date.parse(left.notAfter) : Number.NEGATIVE_INFINITY;
  const rightTime = right.notAfter ? Date.parse(right.notAfter) : Number.NEGATIVE_INFINITY;
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return leftTime - rightTime;
  if (Number.isFinite(leftTime) !== Number.isFinite(rightTime)) return Number.isFinite(leftTime) ? 1 : -1;
  return Number(left.versionNo ?? 0) - Number(right.versionNo ?? 0);
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '');
}

function dnsNameMatches(pattern: string, domain: string): boolean {
  const normalizedPattern = pattern.trim().toLowerCase().replace(/\.$/, '');
  const normalizedDomain = domain.trim().toLowerCase().replace(/\.$/, '');
  if (normalizedPattern === normalizedDomain) return true;
  if (!normalizedPattern.startsWith('*.')) return false;
  const suffix = normalizedPattern.slice(2);
  return normalizedDomain.endsWith(`.${suffix}`) && normalizedDomain.split('.').length === suffix.split('.').length + 1;
}
