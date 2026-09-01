import { AppError } from '../../../common/errors/app-error.js';
import type { InternalCaApplicationService } from '../../internal-ca/application/internal-ca.application-service.js';
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
  constructor(
    private readonly repository: ApplicationCertificateSupplyRepositoryPort,
    private readonly internalCa?: Pick<InternalCaApplicationService, 'listProviders' | 'listAuthorities' | 'listProfiles' | 'listAcmeProviderProfiles'>,
    private readonly certificates?: Pick<CertificatesApplicationService, 'createAsset'>,
    private readonly issuance?: Pick<InternalCaApplicationService, 'createCertificateRequest' | 'ensureAcmeIssuanceContext'>,
  ) {}

  async get(tenantId: string, applicationAssetId: string): Promise<ApplicationCertificateSupplyResponse> {
    const application = await this.requireApplication(tenantId, applicationAssetId);
    const [policy, candidates, capability, providers] = await Promise.all([
      this.repository.getPolicy(tenantId, applicationAssetId),
      this.repository.listCertificateCandidates(tenantId),
      this.repository.resolveCustodyCapability(tenantId, applicationAssetId),
      this.loadProviders(tenantId),
    ]);
    const filtered = candidates.filter((candidate) => candidateMatches(candidate, application.primaryDomain))
      .map((candidate) => ({ ...candidate, matchesPrimaryDomain: true }));
    const current = policy?.currentVersion;
    const readiness = this.evaluate(current ? versionToInput(current) : { supplyMode: 'manual' }, application.primaryDomain, filtered, capability.mode, providers);
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
    const filtered = candidates.filter((candidate) => candidateMatches(candidate, application.primaryDomain))
      .map((candidate) => ({ ...candidate, matchesPrimaryDomain: true }));
    const merged = { ...(currentPolicy?.currentVersion ? versionToInput(currentPolicy.currentVersion) : {}), ...input };
    const readiness = this.evaluate(merged, application.primaryDomain, filtered, capability.mode, providers);
    const lifecycleStatus = input.status
      ?? (input.supplyMode === 'dedicated' && readiness.canIssue ? 'provisioning' : 'draft');
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
    const [candidates, capability, providers] = await Promise.all([
      this.repository.listCertificateCandidates(tenantId),
      this.repository.resolveCustodyCapability(tenantId, applicationAssetId),
      this.loadProviders(tenantId),
    ]);
    const filtered = candidates.filter((candidate) => candidateMatches(candidate, application.primaryDomain))
      .map((candidate) => ({ ...candidate, matchesPrimaryDomain: true }));
    const normalized = this.normalizeInput(input, application.primaryDomain, filtered, capability.mode, providers);
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
    if (savedVersion.certificateAssetId) return undefined;
    const asset = await this.certificates.createAsset({
      tenantId,
      applicationAssetId,
      name: `dedicated:${primaryDomain}`,
      primaryDomain,
      sans: [],
      sourceType: input.providerType === 'acme' ? 'acme' : 'internal_ca',
      tags: ['application-dedicated'],
      createdBy: actorId,
    });
    const boundVersion = await this.repository.bindVersionCertificate(tenantId, applicationAssetId, savedVersion.id, asset.id);
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
    const request = await this.issuance.createCertificateRequest(tenantId, {
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
      idempotencyKey: `application-certificate:${applicationAssetId}:policy:${boundVersion.id}`,
      actorId,
    });
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
    providers: Awaited<ReturnType<ApplicationCertificateSupplyApplicationService['loadProviders']>>,
  ): Omit<ApplicationCertificatePolicyVersionEntity, 'id' | 'policyId' | 'tenantId' | 'applicationAssetId' | 'versionNo' | 'isActive' | 'primaryDomain' | 'createdAt' | 'updatedAt'> {
    const readiness = this.evaluate(input, primaryDomain, candidates, custodyMode, providers);
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
    const lifecycleStatus = input.status
      ?? (input.supplyMode === 'dedicated' && readiness.canIssue ? 'provisioning' : 'draft');
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
    providers: Awaited<ReturnType<ApplicationCertificateSupplyApplicationService['loadProviders']>>,
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

function candidateMatches(candidate: CertificateSupplyCandidateDto, domain: string): boolean {
  const names = [candidate.primaryDomain, candidate.commonName, ...candidate.sans].filter((item): item is string => Boolean(item));
  return names.some((name) => dnsNameMatches(name, domain));
}

function dnsNameMatches(pattern: string, domain: string): boolean {
  const normalizedPattern = pattern.trim().toLowerCase().replace(/\.$/, '');
  const normalizedDomain = domain.trim().toLowerCase().replace(/\.$/, '');
  if (normalizedPattern === normalizedDomain) return true;
  if (!normalizedPattern.startsWith('*.')) return false;
  const suffix = normalizedPattern.slice(2);
  return normalizedDomain.endsWith(`.${suffix}`) && normalizedDomain.split('.').length === suffix.split('.').length + 1;
}
