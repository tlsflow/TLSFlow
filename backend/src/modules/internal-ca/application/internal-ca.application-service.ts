import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { newId } from '../../../shared/id.js';
import type { RequestContext, SecuritySubject } from '../../../shared/security-types.js';
import type { AuditService } from '../../audits/audit.service.js';
import type { ApprovalService } from '../../approvals/approval.service.js';
import type { CertificatesApplicationService } from '../../certificates/application/certificates.application-service.js';
import type { SecretService } from '../../secrets/secret.service.js';
import {
  CaProviderRegistry,
  caPluginRunnerUnavailable,
  createDefaultCaProviderRegistry,
  type CaIssuanceResult,
} from '../providers/ca-provider.js';
import { InternalCaRepository } from '../repository/internal-ca.repository.js';
import { CaNodeTaskChannel, type CaNodeTaskNotificationListener } from './ca-node-task-channel.js';
import { CaOperationsQueryService } from './ca-operations-query.service.js';
import { CaSyncCoordinator, type CreateCaSyncRunsInput } from './ca-sync-coordinator.js';
import type {
  CaOperationRecordDetailDto,
  CaOperationRecordPageDto,
  CaOperationsRecordQueryDto,
  CaOperationsTreeDto,
} from '../dto/ca-operations.dto.js';
import { CaOperationsAdapterRegistry } from '../providers/ca-operations.js';
import {
  caProviderTypes,
  type CaAvailabilityMode,
  type CaCapabilityRecordEntity,
  type CaDeploymentMode,
  type CaIssuanceRecordEntity,
  type CaNodeEntity,
  type CaNodeTaskEntity,
  type CaProviderEntity,
  type CaProviderType,
  type CaRiskPreview,
  type CaRuntimePlatform,
  type CaSyncRunEntity,
  type CaTopologyMode,
  type CaTrustDomainEntity,
  type CaTrustDomainIsolationLevel,
  type CaTrustDomainStatus,
  type CertificateAuthorityEntity,
  type CertificateProfileEntity,
  type CertificateProfileRules,
  type CertificateProfileVersionEntity,
  type CertificateRequestEntity,
  type CertificateRenewalJobEntity,
  type CertificateRevocationEntity,
  type CertificateReuseRisk,
  type KeyBackendType,
  type KeyExportability,
  type KeyReferenceEntity,
  type TrustDistributionEntity,
} from '../schema/internal-ca.schema.js';

type CaNodePlatform = 'windows' | 'linux';

export interface CreateCaProviderInput {
  name: string;
  type: CaProviderType;
  deploymentMode: CaDeploymentMode;
  runtimePlatform: CaRuntimePlatform;
  availabilityMode: CaAvailabilityMode;
  endpoint?: string;
  credentialSecretRef?: string;
  configuration?: Record<string, unknown>;
}

export interface CreateCaTrustDomainInput {
  name: string;
  code?: string;
  purpose: string;
  isolationLevel?: CaTrustDomainIsolationLevel;
  isDefault?: boolean;
  rootPolicy?: Record<string, unknown>;
  trustPolicy?: Record<string, unknown>;
}

export interface UpdateCaTrustDomainInput {
  name?: string;
  purpose?: string;
  status?: CaTrustDomainStatus;
  isolationLevel?: CaTrustDomainIsolationLevel;
  isDefault?: boolean;
  rootPolicy?: Record<string, unknown>;
  trustPolicy?: Record<string, unknown>;
}

export interface PreviewCaInput {
  topologyMode: CaTopologyMode;
  deploymentMode: CaDeploymentMode;
  runtimePlatform: CaRuntimePlatform;
  availabilityMode: CaAvailabilityMode;
  keyBackend: KeyBackendType;
}

export interface CreateAuthorityInput extends PreviewCaInput {
  providerId: string;
  trustDomainId?: string;
  parentCaId?: string;
  name: string;
  commonName: string;
  securityDomain: string;
  confirmationToken: string;
  actorId: string;
}

export interface CreateProfileInput {
  name: string;
  securityDomain: string;
  trustDomainId?: string;
  rules?: Partial<CertificateProfileRules>;
  actorId: string;
}

export interface CreateCertificateRequestInput {
  applicationAssetId: string;
  caId: string;
  trustDomainId?: string;
  profileVersionId: string;
  commonName: string;
  sans: string[];
  requestedValidityDays?: number;
  custodyMode: 'local_agent' | 'managed_secret' | 'external_key' | 'device_local';
  csrPem?: string;
  publicKeyFingerprintSha256?: string;
  idempotencyKey?: string;
  deferIssuance?: boolean;
  actorId: string;
}

export interface RegisterCaNodeInput {
  enrollmentToken: string;
  name: string;
  platform: CaNodePlatform;
  role?: CaNodeEntity['role'];
  identityFingerprint: string;
  authenticationPublicKeyPem?: string;
  keyBackend: KeyBackendType;
  exportability?: KeyExportability;
  capabilities: CaNodeEntity['capabilities'];
  endpoint?: string;
  version?: string;
}

const runtimeNodePlatforms: Readonly<Record<CaRuntimePlatform, readonly CaNodePlatform[]>> = Object.freeze({
  embedded: ['windows', 'linux'],
  windows: ['windows'],
  linux: ['linux'],
  external: ['windows', 'linux'],
});

export class InternalCaApplicationService {
  private readonly repository: InternalCaRepository;
  private readonly providers: CaProviderRegistry;
  private readonly nodeTaskChannel: CaNodeTaskChannel;
  private readonly operationsQuery: CaOperationsQueryService;
  private readonly syncCoordinator: CaSyncCoordinator;

  constructor(private readonly dependencies: {
    db: DatabasePort;
    secrets: SecretService;
    certificates: CertificatesApplicationService;
    audit?: AuditService;
    approvals?: ApprovalService;
    repository?: InternalCaRepository;
    providers?: CaProviderRegistry;
    nodeTaskChannel?: CaNodeTaskChannel;
    operationsAdapters?: CaOperationsAdapterRegistry;
  }) {
    this.repository = dependencies.repository ?? new InternalCaRepository(dependencies.db);
    this.providers = dependencies.providers ?? createDefaultCaProviderRegistry(dependencies.secrets);
    this.nodeTaskChannel = dependencies.nodeTaskChannel ?? new CaNodeTaskChannel();
    const operationsAdapters = dependencies.operationsAdapters ?? new CaOperationsAdapterRegistry();
    this.operationsQuery = new CaOperationsQueryService(dependencies.db, operationsAdapters, undefined, this.repository);
    this.syncCoordinator = new CaSyncCoordinator(dependencies.db, operationsAdapters, dependencies.audit, undefined, this.repository);
  }

  getRepository(): InternalCaRepository {
    return this.repository;
  }

  listCaOperationsRecords(tenantId: string, query: CaOperationsRecordQueryDto): Promise<CaOperationRecordPageDto> {
    return this.operationsQuery.records(tenantId, query);
  }

  listCaOperationsTree(
    tenantId: string,
    canRead: (authority: CertificateAuthorityEntity) => Promise<boolean>,
  ): Promise<CaOperationsTreeDto> {
    return this.operationsQuery.tree(tenantId, canRead);
  }

  getCaOperationsRecord(tenantId: string, recordKey: string): Promise<CaOperationRecordDetailDto> {
    return this.operationsQuery.record(tenantId, recordKey);
  }

  createCaSyncRuns(input: CreateCaSyncRunsInput): Promise<CaSyncRunEntity[]> {
    return this.syncCoordinator.createRuns(input);
  }

  listCaSyncRuns(tenantId: string, caId?: string): Promise<CaSyncRunEntity[]> {
    return this.syncCoordinator.listRuns(tenantId, caId);
  }

  processNextCaSyncBatch(tenantId: string, runId: string, workerId: string, now?: Date): Promise<CaSyncRunEntity> {
    return this.syncCoordinator.processNextBatch(tenantId, runId, workerId, now);
  }

  async listProviders(tenantId: string): Promise<Array<Omit<CaProviderEntity, 'credentialSecretRef'>>> {
    const providers = await this.repository.listProviders(tenantId);
    return Promise.all(providers.map(async (provider) => sanitizeProvider({
      ...provider,
      capabilityRecords: await this.listCapabilityRecords(tenantId, 'provider', provider.id),
    })));
  }

  async createProvider(
    tenantId: string,
    input: CreateCaProviderInput,
    actorId: string,
    context?: RequestContext,
  ): Promise<Omit<CaProviderEntity, 'credentialSecretRef'>> {
    if (!caProviderTypes.includes(input.type)) throw new AppError('VALIDATION_FAILED', 'CA Provider 类型无效');
    const now = new Date().toISOString();
    const provider: CaProviderEntity = {
      id: newId('caprov'),
      tenantId,
      name: requiredText(input.name, 'name'),
      type: input.type,
      deploymentMode: input.deploymentMode,
      runtimePlatform: input.runtimePlatform,
      availabilityMode: input.availabilityMode,
      endpoint: optionalText(input.endpoint),
      credentialSecretRef: optionalText(input.credentialSecretRef),
      capabilities: this.providers.get(input.type).getCapabilities(),
      status: 'active',
      configuration: structuredClone(input.configuration ?? {}),
      createdAt: now,
      updatedAt: now,
    };
    assertProviderCombination(provider);
    assertPluginBinding(provider);
    await this.repository.saveProvider(provider);
    await this.saveDeclaredCapabilities(provider);
    await this.audit('internal_ca.provider.created', actorId, 'ca_provider.create', 'ca_provider', provider.id, 'high', context, {
      type: provider.type,
      deploymentMode: provider.deploymentMode,
      runtimePlatform: provider.runtimePlatform,
    });
    return sanitizeProvider(provider);
  }

  async deleteProvider(tenantId: string, providerId: string, actorId: string, context?: RequestContext): Promise<{ id: string; deleted: true }> {
    const provider = await this.requireProvider(tenantId, providerId);
    const deleted = await this.repository.deleteUnboundProvider(tenantId, provider.id);
    if (!deleted) throw new AppError('RESOURCE_VERSION_CONFLICT', 'CA Provider 已被证书机构使用，不能删除');
    await this.audit('internal_ca.provider.deleted', actorId, 'ca_provider.delete', 'ca_provider', provider.id, 'high', context, {});
    return { id: provider.id, deleted: true };
  }

  async testProvider(tenantId: string, providerId: string): Promise<{ reachable: boolean; capabilities: CaProviderEntity['capabilities']; detail?: string }> {
    const provider = await this.requireProvider(tenantId, providerId);
    assertPluginBinding(provider);
    return this.providers.get(provider.type).validateConnection(provider);
  }

  async listCapabilityRecords(
    tenantId: string,
    ownerType: CaCapabilityRecordEntity['ownerType'],
    ownerId: string,
  ): Promise<CaCapabilityRecordEntity[]> {
    return this.repository.listCapabilityRecords(tenantId, ownerType, ownerId);
  }

  listTrustDomains(tenantId: string): Promise<CaTrustDomainEntity[]> {
    return this.repository.listTrustDomains(tenantId);
  }

  async createTrustDomain(tenantId: string, input: CreateCaTrustDomainInput, actorId: string, context?: RequestContext): Promise<CaTrustDomainEntity> {
    const now = new Date().toISOString();
    const existing = await this.repository.listTrustDomains(tenantId);
    const domain: CaTrustDomainEntity = {
      id: newId('catd'),
      tenantId,
      name: requiredText(input.name, 'name'),
      code: normalizeTrustDomainCode(input.code ?? generateTrustDomainCode()),
      purpose: requiredText(input.purpose, 'purpose'),
      status: 'active',
      isDefault: input.isDefault ?? existing.length === 0,
      isolationLevel: input.isolationLevel ?? 'standard',
      rootPolicy: structuredClone(input.rootPolicy ?? {}),
      trustPolicy: structuredClone(input.trustPolicy ?? {}),
      createdAt: now,
      updatedAt: now,
    };
    const saved = await this.repository.saveTrustDomainWithDefaultSwitch(domain);
    await this.audit('internal_ca.trust_domain.created', actorId, 'certificate_authority.create', 'ca_trust_domain', saved.id, 'critical', context, {
      code: saved.code,
      isolationLevel: saved.isolationLevel,
    });
    return saved;
  }

  async updateTrustDomain(tenantId: string, id: string, input: UpdateCaTrustDomainInput, actorId: string, context?: RequestContext): Promise<CaTrustDomainEntity> {
    const current = await this.requireTrustDomain(tenantId, id);
    const status = input.status ?? current.status;
    if (input.isDefault === true && !isTrustDomainUsable(status)) {
      throw new AppError('CA_TRUST_DOMAIN_STATE_INVALID', '不可用的 CA 信任域不能设为默认域', { id, status });
    }
    const updated = await this.repository.saveTrustDomainWithDefaultSwitch({
      ...current,
      name: input.name === undefined ? current.name : requiredText(input.name, 'name'),
      purpose: input.purpose === undefined ? current.purpose : requiredText(input.purpose, 'purpose'),
      status,
      isDefault: isTrustDomainUsable(status) && (input.isDefault ?? current.isDefault),
      isolationLevel: input.isolationLevel ?? current.isolationLevel,
      rootPolicy: input.rootPolicy === undefined ? current.rootPolicy : structuredClone(input.rootPolicy),
      trustPolicy: input.trustPolicy === undefined ? current.trustPolicy : structuredClone(input.trustPolicy),
      updatedAt: new Date().toISOString(),
    });
    await this.audit('internal_ca.trust_domain.updated', actorId, 'certificate_authority.update', 'ca_trust_domain', id, 'critical', context, {});
    return updated;
  }

  previewAuthority(input: PreviewCaInput): CaRiskPreview {
    const warnings: string[] = [];
    const blockers: string[] = [];
    if (input.topologyMode === 'root_only') warnings.push('仅根 CA 会让根密钥承担日常签发，建议配置中间 CA。');
    if (input.availabilityMode === 'active_active' && !['hsm', 'kms', 'pkcs11'].includes(input.keyBackend)) {
      warnings.push('多节点高可用应使用共享硬件或受控密钥后端。');
    }
    if (input.topologyMode === 'root_only' && input.availabilityMode === 'active_active') blockers.push('根 CA 不允许在线多节点部署。');
    if (input.deploymentMode === 'builtin' && input.runtimePlatform !== 'embedded') blockers.push('内置 CA 必须使用 embedded 运行平台。');
    if (input.deploymentMode === 'managed_node' && !['windows', 'linux'].includes(input.runtimePlatform)) blockers.push('受控节点必须选择 Windows 或 Linux 运行平台。');
    if (input.deploymentMode === 'external' && input.runtimePlatform !== 'external') blockers.push('插件 CA 必须使用 external 运行平台。');
    const overallRecommendation = blockers.length > 0 ? 'not_recommended' : warnings.length > 0 ? 'acceptable_with_risk' : 'recommended';
    return {
      ...input,
      overallRecommendation,
      warnings,
      blockers,
      requiresApproval: blockers.length > 0 || warnings.length > 0,
      confirmationToken: signConfirmation(previewPayload(input)),
    };
  }

  async createAuthority(tenantId: string, input: CreateAuthorityInput, context?: RequestContext): Promise<Array<Omit<CertificateAuthorityEntity, 'privateKeySecretRef'>>> {
    const preview = this.previewAuthority(input);
    if (!verifyConfirmation(previewPayload(input), input.confirmationToken)) throw new AppError('CA_RISK_CONFIRMATION_REQUIRED', 'CA 风险确认已失效，请重新预览');
    if (preview.blockers.length > 0) throw new AppError('CA_TOPOLOGY_INVALID', 'CA 拓扑存在阻断项', { blockers: preview.blockers });
    const provider = await this.requireProvider(tenantId, input.providerId);
    assertPluginBinding(provider);
    if (provider.deploymentMode !== input.deploymentMode || provider.runtimePlatform !== input.runtimePlatform) {
      throw new AppError('CA_TOPOLOGY_INVALID', 'CA 创建参数与 Provider 部署模式不一致');
    }
    const trustDomain = input.trustDomainId
      ? await this.requireUsableTrustDomain(tenantId, input.trustDomainId)
      : await this.createTrustDomain(tenantId, { name: `${requiredText(input.name, 'name')} 信任域`, purpose: input.securityDomain }, input.actorId, context);
    if (input.parentCaId) await this.requireAuthority(tenantId, input.parentCaId);
    const now = new Date().toISOString();
    const authority = await this.repository.saveAuthority({
      id: newId('ca'),
      tenantId,
      name: requiredText(input.name, 'name'),
      role: input.parentCaId ? 'intermediate' : 'root',
      parentCaId: input.parentCaId,
      topologyMode: input.topologyMode,
      providerId: provider.id,
      trustDomainId: trustDomain.id,
      securityDomain: requiredText(input.securityDomain, 'securityDomain'),
      status: 'draft',
      subjectCommonName: requiredText(input.commonName, 'commonName'),
      createdAt: now,
      updatedAt: now,
    });
    await this.audit('internal_ca.authority.created', input.actorId, 'certificate_authority.create', 'certificate_authority', authority.id, 'high', context, {
      providerId: provider.id,
      pluginVersionId: textValue(provider.configuration.pluginVersionId),
    });
    return [sanitizeAuthority(authority)];
  }

  async listAuthorities(tenantId: string): Promise<Array<Omit<CertificateAuthorityEntity, 'privateKeySecretRef'>>> {
    return (await this.repository.listAuthorities(tenantId)).map(sanitizeAuthority);
  }

  async createProfile(tenantId: string, input: CreateProfileInput): Promise<{ profile: CertificateProfileEntity; version: CertificateProfileVersionEntity }> {
    const now = new Date().toISOString();
    const trustDomainId = input.trustDomainId ?? await this.resolveProfileTrustDomain(tenantId, input.securityDomain);
    if (trustDomainId) await this.requireUsableTrustDomain(tenantId, trustDomainId);
    const profile: CertificateProfileEntity = {
      id: newId('certprof'),
      tenantId,
      name: requiredText(input.name, 'name'),
      securityDomain: requiredText(input.securityDomain, 'securityDomain'),
      trustDomainId,
      status: 'active',
      currentVersion: 1,
      createdAt: now,
      updatedAt: now,
    };
    const version: CertificateProfileVersionEntity = {
      id: newId('certprofv'),
      profileId: profile.id,
      versionNo: 1,
      rules: normalizeProfileRules(input.rules),
      createdBy: input.actorId,
      createdAt: now,
    };
    await this.repository.createProfile(profile, version);
    return { profile, version };
  }

  async createProfileVersion(tenantId: string, profileId: string, rules: Partial<CertificateProfileRules>, actorId: string): Promise<CertificateProfileVersionEntity> {
    const profile = await this.repository.getProfile(tenantId, profileId);
    if (!profile) throw new AppError('RESOURCE_NOT_FOUND', '证书 Profile 不存在', { profileId });
    const current = (await this.repository.listProfileVersions(profileId)).sort((left, right) => right.versionNo - left.versionNo)[0];
    const next: CertificateProfileVersionEntity = {
      id: newId('certprofv'),
      profileId,
      versionNo: profile.currentVersion + 1,
      rules: normalizeProfileRules({ ...(current?.rules ?? {}), ...rules }),
      createdBy: actorId,
      createdAt: new Date().toISOString(),
    };
    await this.repository.saveProfileVersion(next);
    await this.repository.saveProfile({ ...profile, currentVersion: next.versionNo, updatedAt: next.createdAt });
    return next;
  }

  async listProfiles(tenantId: string): Promise<Array<{ profile: CertificateProfileEntity; versions: CertificateProfileVersionEntity[] }>> {
    return Promise.all((await this.repository.listProfiles(tenantId)).map(async (profile) => ({
      profile,
      versions: await this.repository.listProfileVersions(profile.id),
    })));
  }

  async createCertificateRequest(tenantId: string, input: CreateCertificateRequestInput, context?: RequestContext): Promise<CertificateRequestEntity> {
    const authority = await this.requireAuthority(tenantId, input.caId);
    const profileVersion = await this.repository.getProfileVersion(input.profileVersionId);
    const profile = profileVersion ? await this.repository.getProfile(tenantId, profileVersion.profileId) : undefined;
    if (!profileVersion || !profile) throw new AppError('RESOURCE_NOT_FOUND', '证书 Profile 版本不存在', { profileVersionId: input.profileVersionId });
    validateProfile(input, profileVersion.rules);
    if (authority.trustDomainId && input.trustDomainId && authority.trustDomainId !== input.trustDomainId) {
      throw new AppError('CERTIFICATE_TRUST_DOMAIN_MISMATCH', '证书申请与 CA 信任域不匹配');
    }
    const csrPem = requiredText(input.csrPem ?? '', 'csrPem');
    const publicKeyFingerprintSha256 = normalizeFingerprint(requiredText(input.publicKeyFingerprintSha256 ?? '', 'publicKeyFingerprintSha256'));
    const idempotencyKey = input.idempotencyKey?.trim() || createHash('sha256').update([
      tenantId, input.applicationAssetId, input.caId, input.profileVersionId, input.commonName,
      [...input.sans].sort().join(','), csrPem,
    ].join('|')).digest('hex');
    const existing = await this.repository.getRequestByIdempotencyKey(tenantId, idempotencyKey);
    if (existing) return existing;
    const now = new Date().toISOString();
    const request: CertificateRequestEntity = {
      id: newId('certreq'),
      tenantId,
      applicationAssetId: requiredText(input.applicationAssetId, 'applicationAssetId'),
      caId: authority.id,
      trustDomainId: input.trustDomainId ?? authority.trustDomainId,
      profileVersionId: profileVersion.id,
      keyReferenceId: '',
      csrPem,
      csrSha256: createHash('sha256').update(csrPem).digest('hex'),
      publicKeyFingerprintSha256,
      idempotencyKey,
      status: 'draft',
      requestedBy: input.actorId,
      deferIssuance: input.deferIssuance,
      subjectCommonName: requiredText(input.commonName, 'commonName'),
      sans: normalizeCertificateNames(input.sans),
      requestedValidityDays: input.requestedValidityDays ?? profileVersion.rules.maximumValidityDays,
      createdAt: now,
      updatedAt: now,
    };
    await this.audit('internal_ca.request.created', input.actorId, 'certificate_request.create', 'certificate_request', request.id, 'high', context, {
      caId: request.caId,
      pluginVersionId: textValue((await this.requireProvider(tenantId, (await this.requireAuthority(tenantId, request.caId)).providerId)).configuration.pluginVersionId),
    });
    return this.repository.saveRequest(request);
  }

  async listRequests(tenantId: string): Promise<CertificateRequestEntity[]> {
    return this.repository.listRequests(tenantId);
  }

  async approveRequest(tenantId: string, requestId: string, actorId: string, approvalId?: string, context?: RequestContext): Promise<CertificateRequestEntity> {
    const request = await this.requireRequest(tenantId, requestId);
    const now = new Date().toISOString();
    const updated = await this.repository.saveRequest({ ...request, status: 'approved', approvedBy: actorId, approvalId, updatedAt: now });
    await this.audit('internal_ca.request.approved', actorId, 'certificate_request.approve', 'certificate_request', requestId, 'high', context, { approvalId });
    return updated;
  }

  async issueRequest(tenantId: string, requestId: string, actorId: string, _context?: RequestContext): Promise<CertificateRequestEntity> {
    const request = await this.requireRequest(tenantId, requestId);
    const authority = await this.requireAuthority(tenantId, request.caId);
    void actorId;
    throw caPluginRunnerUnavailable('issue_request', { id: authority.providerId, type: 'plugin' });
  }

  async refreshRequestIssuance(tenantId: string, requestId: string, actorId: string, _context?: RequestContext): Promise<CertificateRequestEntity> {
    const request = await this.requireRequest(tenantId, requestId);
    void actorId;
    throw caPluginRunnerUnavailable('query_issuance', { id: request.caId, type: 'plugin' });
  }

  async markRequestActive(tenantId: string, requestId: string): Promise<CertificateRequestEntity> {
    const request = await this.requireRequest(tenantId, requestId);
    if (!['issued', 'deploying'].includes(request.status)) throw new AppError('RESOURCE_VERSION_CONFLICT', '证书申请尚未完成签发', { status: request.status });
    return this.repository.saveRequest({ ...request, status: 'active', updatedAt: new Date().toISOString() });
  }

  listRenewals(tenantId: string): Promise<CertificateRenewalJobEntity[]> {
    return this.repository.listRenewals(tenantId);
  }

  async scheduleDueRenewals(_tenantId: string, _actorId: string, _now = new Date(), _context?: RequestContext): Promise<CertificateRenewalJobEntity[]> {
    throw caPluginRunnerUnavailable('schedule_renewal');
  }

  async requestRevocation(_tenantId: string, _certificateVersionId: string, _reason: string, _actorId: string, _context?: RequestContext): Promise<CertificateRevocationEntity> {
    throw caPluginRunnerUnavailable('request_revocation');
  }

  listRevocations(tenantId: string): Promise<CertificateRevocationEntity[]> {
    return this.repository.listRevocations(tenantId);
  }

  async approveRevocation(tenantId: string, revocationId: string, _approvalId: string, _actorId: string): Promise<CertificateRevocationEntity> {
    const revocation = (await this.repository.listRevocations(tenantId)).find((item) => item.id === revocationId);
    if (!revocation) throw new AppError('RESOURCE_NOT_FOUND', '证书吊销任务不存在', { revocationId });
    throw caPluginRunnerUnavailable('revoke_certificate', { id: revocation.caId, type: 'plugin' });
  }

  async createTrustDistribution(tenantId: string, caId: string, targetScope: Record<string, unknown>, actorId: string, context?: RequestContext): Promise<TrustDistributionEntity> {
    const authority = await this.requireAuthority(tenantId, caId);
    const now = new Date().toISOString();
    const entity = await this.repository.saveTrustDistribution({
      id: newId('catrust'), tenantId, caId: authority.id, trustDomainId: authority.trustDomainId,
      targetScope: structuredClone(targetScope), status: 'pending_approval', requestedBy: actorId,
      createdAt: now, updatedAt: now,
    });
    await this.audit('internal_ca.trust_distribution.created', actorId, 'trust_distribution.create', 'trust_distribution', entity.id, 'high', context, {});
    return entity;
  }

  listTrustDistributions(tenantId: string): Promise<TrustDistributionEntity[]> {
    return this.repository.listTrustDistributions(tenantId);
  }

  async approveTrustDistribution(tenantId: string, distributionId: string, _approvalId: string): Promise<TrustDistributionEntity> {
    const current = (await this.repository.listTrustDistributions(tenantId)).find((item) => item.id === distributionId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', '信任分发任务不存在', { distributionId });
    return this.repository.saveTrustDistribution({ ...current, status: 'approved', updatedAt: new Date().toISOString() });
  }

  async completeTrustDistribution(tenantId: string, distributionId: string, verified: boolean, verification: Record<string, unknown>): Promise<TrustDistributionEntity> {
    const current = (await this.repository.listTrustDistributions(tenantId)).find((item) => item.id === distributionId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', '信任分发任务不存在', { distributionId });
    return this.repository.saveTrustDistribution({
      ...current,
      status: verified ? 'verified' : 'rollback_required',
      verification: structuredClone(verification),
      updatedAt: new Date().toISOString(),
    });
  }

  async analyzeCertificateReuseRisks(tenantId: string): Promise<CertificateReuseRisk[]> {
    const rows = (await this.dependencies.db.query<CertificateReuseRow>(`select
      cb.id as binding_id,
      cb.service_asset_id,
      cv.id as certificate_version_id,
      cv.fingerprint_sha256,
      cv.public_key_fingerprint_sha256,
      cv.common_name,
      cv.sans,
      sa.display_name,
      sa.environment,
      sa.metadata,
      cv.trust_domain_id,
      td.name as trust_domain_name
    from pg_certificate_bindings cb
    join pg_certificate_versions cv on cv.id = coalesce(cb.certificate_version_id, cb.target_certificate_version_id)
    left join pg_service_assets sa on sa.id = cb.service_asset_id and sa.tenant_id = cb.tenant_id
    left join pg_ca_trust_domains td on td.id = cv.trust_domain_id
    where cb.tenant_id = $1 and cb.deleted_at is null and cb.service_asset_id is not null`, [tenantId])).rows;
    return [
      ...buildReuseRisks(rows, 'certificate_fingerprint_reuse', (row) => row.fingerprint_sha256),
      ...buildReuseRisks(rows.filter((row) => Boolean(row.public_key_fingerprint_sha256)), 'public_key_reuse', (row) => row.public_key_fingerprint_sha256!),
    ].sort((left, right) => riskWeight(right.severity) - riskWeight(left.severity));
  }

  async certificateReuseRiskOverview(tenantId: string): Promise<Record<string, unknown>> {
    const items = await this.analyzeCertificateReuseRisks(tenantId);
    return {
      total: items.length,
      critical: items.filter((item) => item.severity === 'critical').length,
      high: items.filter((item) => item.severity === 'high').length,
      warning: items.filter((item) => item.severity === 'warning').length,
      affectedApplicationAssets: new Set(items.flatMap((item) => item.applicationAssets.map((asset) => asset.id))).size,
    };
  }

  async exportCertificateReuseRisks(tenantId: string): Promise<string> {
    const items = await this.analyzeCertificateReuseRisks(tenantId);
    const lines = [['riskType', 'severity', 'fingerprintSha256', 'assetCount', 'bindingCount', 'crossSecurityDomain', 'wildcard', 'assets', 'explanation']];
    for (const item of items) lines.push([
      item.riskType, item.severity, item.fingerprintSha256, String(item.applicationAssets.length), String(item.bindingCount),
      String(item.crossSecurityDomain), String(item.wildcard), item.applicationAssets.map((asset) => `${asset.displayName}(${asset.id})`).join(';'), item.explanation,
    ]);
    return lines.map((line) => line.map(csvCell).join(',')).join('\n');
  }

  async previewCertificateReuseRemediation(tenantId: string, riskId: string): Promise<Record<string, unknown>> {
    const risk = (await this.analyzeCertificateReuseRisks(tenantId)).find((item) => item.id === riskId);
    if (!risk) throw new AppError('RESOURCE_NOT_FOUND', '证书复用风险不存在', { riskId });
    return {
      riskId,
      strategy: 'one_application_asset_one_key',
      requiresApproval: true,
      requests: risk.applicationAssets.map((asset) => ({ applicationAssetId: asset.id, action: 'create_independent_certificate_request', rotateKey: true })),
      warnings: risk.crossSecurityDomain ? ['共享证书跨安全域使用，建议分批切换。'] : [],
    };
  }

  async createNodeEnrollmentToken(tenantId: string, providerId: string, actorId: string, ttlMinutes = 15): Promise<{ tokenId: string; token: string; expiresAt: string }> {
    const provider = await this.requireProvider(tenantId, providerId);
    if (provider.type !== 'gcac_managed_node' && provider.type !== 'plugin') throw new AppError('CA_TOPOLOGY_INVALID', '当前 Provider 不允许注册受控节点');
    assertPluginBinding(provider);
    const token = `gcn_${randomBytes(32).toString('base64url')}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + Math.max(1, Math.min(ttlMinutes, 60)) * 60_000).toISOString();
    const entity = await this.repository.createNodeEnrollmentToken({
      id: newId('cantok'), tenantId, providerId, tokenHash: createHash('sha256').update(token).digest('hex'),
      status: 'active', expiresAt, createdBy: actorId, createdAt: now.toISOString(),
    });
    return { tokenId: entity.id, token, expiresAt };
  }

  async registerNode(input: RegisterCaNodeInput): Promise<CaNodeEntity> {
    const tokenHash = createHash('sha256').update(requiredText(input.enrollmentToken, 'enrollmentToken')).digest('hex');
    const consumed = await this.repository.consumeNodeEnrollmentToken(tokenHash, new Date().toISOString());
    if (!consumed || consumed.status !== 'used') throw new AppError('AUTH_FORBIDDEN', 'CA Node 注册令牌无效、已使用或已过期');
    const provider = await this.requireProvider(consumed.tenantId, consumed.providerId);
    if (!runtimeNodePlatforms[provider.runtimePlatform].includes(input.platform)) throw new AppError('CA_TOPOLOGY_INVALID', '节点平台与 Provider 配置不一致');
    const authenticationPublicKeyPem = optionalText(input.authenticationPublicKeyPem);
    if (authenticationPublicKeyPem) validateNodeAuthenticationKey(authenticationPublicKeyPem, input.identityFingerprint);
    const now = new Date().toISOString();
    const node: CaNodeEntity = {
      id: newId('canode'), tenantId: consumed.tenantId, providerId: consumed.providerId,
      name: requiredText(input.name, 'name'), platform: input.platform,
      role: input.role ?? 'member', identityFingerprint: normalizeHexFingerprint(input.identityFingerprint),
      authenticationPublicKeyPem, keyBackend: input.keyBackend, exportability: normalizeExportability(input.keyBackend, input.exportability),
      capabilities: input.capabilities, healthStatus: 'online', lastHeartbeatAt: now, endpoint: optionalText(input.endpoint),
      version: optionalText(input.version), createdAt: now, updatedAt: now,
    };
    await this.assertNoActiveNodeConflict(node);
    return this.repository.saveNode(node);
  }

  async verifyNodeRequest(input: { tenantId: string; nodeId: string; method: string; path: string; timestamp: string; nonce: string; signature: string; body: unknown }): Promise<CaNodeEntity> {
    const node = await this.repository.getNode(requiredText(input.tenantId, 'tenantId'), requiredText(input.nodeId, 'nodeId'));
    if (!node || node.healthStatus === 'revoked' || !node.authenticationPublicKeyPem) throw new AppError('AUTH_FORBIDDEN', 'CA Node 身份无效或未启用请求签名');
    const requestedAt = new Date(requiredText(input.timestamp, 'timestamp'));
    const now = new Date();
    if (!Number.isFinite(requestedAt.getTime()) || Math.abs(now.getTime() - requestedAt.getTime()) > 5 * 60_000) throw new AppError('AUTH_FORBIDDEN', 'CA Node 请求时间戳无效或已过期');
    const nonce = requiredText(input.nonce, 'nonce');
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) throw new AppError('AUTH_FORBIDDEN', 'CA Node 请求 nonce 无效');
    let valid = false;
    try {
      valid = verify(null, Buffer.from(nodeRequestCanonical(input)), createPublicKey(node.authenticationPublicKeyPem), Buffer.from(input.signature, 'base64'));
    } catch {
      valid = false;
    }
    if (!valid) throw new AppError('AUTH_FORBIDDEN', 'CA Node 请求签名无效');
    if (!(await this.repository.consumeNodeRequestNonce(node.id, nonce, now.toISOString(), new Date(now.getTime() + 10 * 60_000).toISOString()))) throw new AppError('AUTH_FORBIDDEN', 'CA Node 请求已重放');
    return node;
  }

  listNodes(tenantId: string, providerId?: string): Promise<CaNodeEntity[]> {
    return this.repository.listNodes(tenantId, providerId);
  }

  async heartbeatNode(tenantId: string, nodeId: string, patch: { healthStatus?: CaNodeEntity['healthStatus']; role?: CaNodeEntity['role']; capabilities?: CaNodeEntity['capabilities']; version?: string }): Promise<CaNodeEntity> {
    const node = await this.repository.getNode(tenantId, nodeId);
    if (!node) throw new AppError('RESOURCE_NOT_FOUND', 'CA Node 不存在', { nodeId });
    if (node.healthStatus === 'revoked') throw new AppError('AUTH_FORBIDDEN', 'CA Node 身份已吊销');
    const next = { ...node, healthStatus: patch.healthStatus ?? 'online', role: patch.role ?? node.role, capabilities: patch.capabilities ?? node.capabilities, version: patch.version ?? node.version, lastHeartbeatAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await this.assertNoActiveNodeConflict(next);
    return this.repository.saveNode(next);
  }

  async enqueueNodeTask(tenantId: string, providerId: string, taskType: CaNodeTaskEntity['taskType'], payload: Record<string, unknown>, idempotencyKey: string): Promise<CaNodeTaskEntity> {
    await this.requireProvider(tenantId, providerId);
    const existing = await this.repository.getNodeTaskByIdempotencyKey(tenantId, idempotencyKey);
    if (existing) return existing;
    const now = new Date().toISOString();
    const task = await this.repository.saveNodeTask({ id: newId('cantask'), tenantId, providerId, taskType, payload, idempotencyKey, status: 'queued', createdAt: now, updatedAt: now });
    this.nodeTaskChannel.notify(tenantId, providerId);
    return task;
  }

  subscribeNodeTasks(tenantId: string, providerId: string, listener: CaNodeTaskNotificationListener): () => void {
    return this.nodeTaskChannel.subscribe(tenantId, providerId, listener);
  }

  async leaseNodeTask(tenantId: string, nodeId: string): Promise<CaNodeTaskEntity | undefined> {
    const node = await this.repository.getNode(tenantId, nodeId);
    if (!node || node.healthStatus !== 'online') throw new AppError('CA_PROVIDER_UNAVAILABLE', 'CA Node 不在线', { nodeId });
    if (node.role === 'standby') return undefined;
    return this.repository.leaseNodeTask(tenantId, node.providerId, node.id, new Date(Date.now() + 120_000).toISOString());
  }

  async waitForNodeTaskResult(tenantId: string, taskId: string, timeoutMs = 90_000): Promise<CaNodeTaskEntity> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const task = await this.repository.getNodeTask(tenantId, taskId);
      if (!task) throw new AppError('RESOURCE_NOT_FOUND', 'CA Node 任务不存在', { taskId });
      if (task.status === 'succeeded' || task.status === 'failed') return task;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new AppError('CA_SYNC_SOURCE_UNAVAILABLE', 'CA Node 任务超时', { taskId, timeoutMs });
  }

  async completeNodeTask(tenantId: string, nodeId: string, taskId: string, input: { success: boolean; result?: Record<string, unknown>; errorCode?: string; errorMessage?: string }): Promise<CaNodeTaskEntity> {
    const task = await this.repository.getNodeTask(tenantId, taskId);
    if (!task || task.nodeId !== nodeId || task.status !== 'leased') throw new AppError('RESOURCE_VERSION_CONFLICT', 'CA Node 任务租约无效');
    const completed = await this.repository.saveNodeTask({ ...task, status: input.success ? 'succeeded' : 'failed', result: input.result, errorCode: input.success ? undefined : input.errorCode ?? 'CA_NODE_TASK_FAILED', errorMessage: input.success ? undefined : input.errorMessage ?? 'CA Node task failed', updatedAt: new Date().toISOString() });
    this.nodeTaskChannel.notify(task.tenantId, task.providerId);
    return completed;
  }

  private async listCapabilityRecordsForProvider(provider: CaProviderEntity): Promise<void> {
    await this.saveDeclaredCapabilities(provider);
  }

  private async saveDeclaredCapabilities(provider: CaProviderEntity): Promise<void> {
    const now = new Date().toISOString();
    for (const capabilityKey of Object.keys(provider.capabilities)) {
      const available = provider.capabilities[capabilityKey as keyof CaProviderEntity['capabilities']];
      await this.repository.saveCapabilityRecord({
        id: capabilityRecordId('provider', provider.id, capabilityKey), tenantId: provider.tenantId, ownerType: 'provider', ownerId: provider.id,
        capabilityKey: capabilityKey as keyof CaProviderEntity['capabilities'], state: available ? 'declared' : 'unavailable', source: 'host_contract',
        evidence: { available, pluginVersionId: textValue(provider.configuration.pluginVersionId) }, createdAt: now, updatedAt: now,
      });
    }
  }

  private async requireProvider(tenantId: string, id: string): Promise<CaProviderEntity> {
    const provider = await this.repository.getProvider(tenantId, id);
    if (!provider) throw new AppError('RESOURCE_NOT_FOUND', 'CA Provider 不存在', { providerId: id });
    return provider;
  }

  private async requireAuthority(tenantId: string, id: string): Promise<CertificateAuthorityEntity> {
    const authority = await this.repository.getAuthority(tenantId, id);
    if (!authority) throw new AppError('RESOURCE_NOT_FOUND', '证书机构不存在', { caId: id });
    return authority;
  }

  private async requireTrustDomain(tenantId: string, id: string): Promise<CaTrustDomainEntity> {
    const domain = await this.repository.getTrustDomain(tenantId, id);
    if (!domain) throw new AppError('RESOURCE_NOT_FOUND', 'CA 信任域不存在', { trustDomainId: id });
    return domain;
  }

  private async requireUsableTrustDomain(tenantId: string, id: string): Promise<CaTrustDomainEntity> {
    const domain = await this.requireTrustDomain(tenantId, id);
    if (!isTrustDomainUsable(domain.status)) throw new AppError('CA_TRUST_DOMAIN_STATE_INVALID', 'CA 信任域当前不可用', { trustDomainId: id, status: domain.status });
    return domain;
  }

  private async resolveProfileTrustDomain(tenantId: string, securityDomain: string): Promise<string | undefined> {
    const candidates = new Set((await this.repository.listAuthorities(tenantId))
      .filter((authority) => authority.securityDomain === securityDomain && authority.trustDomainId)
      .map((authority) => authority.trustDomainId!));
    return candidates.size === 1 ? [...candidates][0] : undefined;
  }

  private async requireRequest(tenantId: string, id: string): Promise<CertificateRequestEntity> {
    const request = await this.repository.getRequest(tenantId, id);
    if (!request) throw new AppError('RESOURCE_NOT_FOUND', '证书申请不存在', { requestId: id });
    return request;
  }

  private async assertNoActiveNodeConflict(candidate: CaNodeEntity): Promise<void> {
    if (candidate.role !== 'active' || candidate.healthStatus !== 'online') return;
    const provider = await this.requireProvider(candidate.tenantId, candidate.providerId);
    if (provider.availabilityMode === 'active_active') return;
    const conflict = (await this.repository.listNodes(candidate.tenantId, candidate.providerId)).find((node) => node.id !== candidate.id && node.role === 'active' && node.healthStatus === 'online');
    if (conflict) throw new AppError('CA_NODE_SPLIT_BRAIN_RISK', '同一 Provider 已存在在线活动 CA Node', { nodeId: conflict.id });
  }

  private async audit(eventType: string, actorId: string, action: string, resourceType: string, resourceId: string, riskLevel: 'high' | 'critical', context: RequestContext | undefined, detail: Record<string, unknown>): Promise<void> {
    await this.dependencies.audit?.write({ eventType, actorType: 'user', actorId, action, resourceType, resourceId, result: 'success', riskLevel, context, failClosed: true, detail });
  }
}

function assertProviderCombination(provider: CaProviderEntity): void {
  if (provider.deploymentMode === 'builtin' && provider.type !== 'gcac_builtin') throw new AppError('CA_TOPOLOGY_INVALID', '内置部署必须使用 gcac_builtin Provider');
  if (provider.deploymentMode === 'managed_node' && provider.type !== 'gcac_managed_node') throw new AppError('CA_TOPOLOGY_INVALID', '受控节点部署必须使用 gcac_managed_node Provider');
  if (provider.deploymentMode === 'external' && provider.type !== 'plugin') throw new AppError('CA_TOPOLOGY_INVALID', '外部部署必须使用 plugin Provider');
}

function assertPluginBinding(provider: CaProviderEntity): void {
  if (provider.type !== 'plugin') return;
  if (!textValue(provider.configuration.pluginId) || !textValue(provider.configuration.pluginVersionId)) {
    throw caPluginRunnerUnavailable('plugin_version_binding', provider);
  }
}

function normalizeProfileRules(input: Partial<CertificateProfileRules> = {}): CertificateProfileRules {
  return {
    commonNamePattern: input.commonNamePattern,
    allowedDnsSuffixes: uniqueStrings(input.allowedDnsSuffixes ?? []).map((suffix) => suffix.replace(/^\*?\./, '').toLowerCase()),
    allowedIpCidrs: uniqueStrings(input.allowedIpCidrs ?? []),
    allowedSanTypes: input.allowedSanTypes ?? ['dns', 'ip'],
    keyAlgorithms: input.keyAlgorithms ?? ['rsa', 'ec'],
    minimumRsaBits: Math.max(2048, input.minimumRsaBits ?? 2048),
    maximumValidityDays: Math.max(1, Math.min(input.maximumValidityDays ?? 397, 3650)),
    renewalWindowDays: Math.max(1, input.renewalWindowDays ?? 30),
    rotateKeyOnRenewal: input.rotateKeyOnRenewal ?? true,
    allowWildcard: input.allowWildcard ?? false,
    requireApproval: input.requireApproval ?? true,
    extendedKeyUsages: uniqueStrings(input.extendedKeyUsages ?? ['serverAuth']),
  };
}

function validateProfile(input: Pick<CreateCertificateRequestInput, 'commonName' | 'sans' | 'requestedValidityDays'>, rules: CertificateProfileRules): void {
  if (rules.commonNamePattern && !new RegExp(rules.commonNamePattern).test(input.commonName)) throw new AppError('CERTIFICATE_PROFILE_VIOLATION', 'Common Name 不符合 Profile 规则');
  const names = normalizeCertificateNames([input.commonName, ...input.sans]);
  if (!rules.allowWildcard && names.some((value) => value.startsWith('*.'))) throw new AppError('CERTIFICATE_PROFILE_VIOLATION', 'Profile 不允许通配符证书');
  if (rules.allowedDnsSuffixes.length > 0) {
    const invalid = names.filter((value) => !isIp(value) && !rules.allowedDnsSuffixes.some((suffix) => value === suffix || value.endsWith(`.${suffix}`) || value === `*.${suffix}`));
    if (invalid.length > 0) throw new AppError('CERTIFICATE_PROFILE_VIOLATION', '名称超出 Profile 允许范围', { invalid });
  }
  if ((input.requestedValidityDays ?? rules.maximumValidityDays) > rules.maximumValidityDays) throw new AppError('CERTIFICATE_PROFILE_VIOLATION', '申请有效期超过 Profile 上限');
}

function previewPayload(input: PreviewCaInput): string {
  return [input.topologyMode, input.deploymentMode, input.runtimePlatform, input.availabilityMode, input.keyBackend].join('|');
}

function signConfirmation(payload: string): string {
  const secret = process.env.GCAC_CA_CONFIRMATION_SECRET?.trim();
  if (!secret) throw new AppError('CA_RISK_CONFIRMATION_REQUIRED', 'GCAC_CA_CONFIRMATION_SECRET 未配置，拒绝执行 CA 操作');
  return createHmac('sha256', secret).update(payload).digest('hex');
}

function verifyConfirmation(payload: string, token: string): boolean {
  const expected = Buffer.from(signConfirmation(payload), 'hex');
  const actual = /^[0-9a-f]{64}$/i.test(token) ? Buffer.from(token, 'hex') : Buffer.alloc(0);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function sanitizeProvider(provider: CaProviderEntity): Omit<CaProviderEntity, 'credentialSecretRef'> {
  const { credentialSecretRef, ...safe } = provider;
  void credentialSecretRef;
  return safe;
}

function sanitizeAuthority(authority: CertificateAuthorityEntity): Omit<CertificateAuthorityEntity, 'privateKeySecretRef'> {
  const { privateKeySecretRef, ...safe } = authority;
  void privateKeySecretRef;
  return safe;
}

function requiredText(value: string, field: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new AppError('VALIDATION_FAILED', `${field} 不能为空`, { field });
  return normalized;
}

function optionalText(value?: string): string | undefined {
  return value?.trim() || undefined;
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function generateTrustDomainCode(): string {
  return `auto_${newId('domain').replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()}`;
}

function normalizeTrustDomainCode(value: string): string {
  const code = requiredText(value, 'code').toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,63}$/.test(code)) throw new AppError('VALIDATION_FAILED', 'CA 信任域 code 格式无效', { field: 'code' });
  return code;
}

function isTrustDomainUsable(status: CaTrustDomainStatus): boolean {
  return status === 'active' || status === 'rotating';
}

function capabilityRecordId(ownerType: CaCapabilityRecordEntity['ownerType'], ownerId: string, capabilityKey: string): string {
  return `cacap_${createHash('sha256').update(`${ownerType}:${ownerId}:${capabilityKey}`).digest('hex').slice(0, 24)}`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

function normalizeCertificateNames(values: string[]): string[] {
  return uniqueStrings(values.map((value) => value.replace(/\.$/, '')));
}

function normalizeExportability(backend: KeyBackendType, requested?: KeyExportability): KeyExportability {
  if (backend === 'file' || backend === 'secret') return 'exportable';
  if (['hsm', 'kms', 'tpm', 'pkcs11'].includes(backend)) return requested === 'exportable' ? 'unknown' : 'non_exportable';
  return requested ?? 'unknown';
}

function normalizeFingerprint(value: string): string {
  const normalized = value.replaceAll(':', '').trim().toLowerCase();
  if (!/^[0-9a-f]{32,128}$/.test(normalized)) throw new AppError('VALIDATION_FAILED', '公钥指纹格式无效');
  return normalized;
}

function normalizeHexFingerprint(value: string): string {
  return normalizeFingerprint(value);
}

function validateNodeAuthenticationKey(publicKeyPem: string, identityFingerprint: string): void {
  try {
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('unsupported key type');
    const fingerprint = createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex');
    if (fingerprint !== normalizeHexFingerprint(identityFingerprint)) throw new Error('fingerprint mismatch');
  } catch {
    throw new AppError('VALIDATION_FAILED', 'CA Node 请求签名公钥无效或与身份指纹不一致');
  }
}

function nodeRequestCanonical(input: { tenantId: string; nodeId: string; method: string; path: string; timestamp: string; nonce: string; body: unknown }): string {
  const bodyHash = createHash('sha256').update(JSON.stringify(input.body ?? null)).digest('hex');
  return [input.method.toUpperCase(), input.path, input.tenantId, input.nodeId, input.timestamp, input.nonce, bodyHash].join('\n');
}

export type CertificateReuseRow = {
  binding_id: string;
  service_asset_id: string | null;
  certificate_version_id: string;
  fingerprint_sha256: string;
  public_key_fingerprint_sha256: string | null;
  common_name: string | null;
  sans: unknown;
  display_name: string | null;
  environment: string | null;
  metadata: unknown;
  trust_domain_id: string | null;
  trust_domain_name: string | null;
};

export function buildReuseRisks(rows: CertificateReuseRow[], riskType: CertificateReuseRisk['riskType'], fingerprintOf: (row: CertificateReuseRow) => string): CertificateReuseRisk[] {
  const groups = new Map<string, CertificateReuseRow[]>();
  for (const row of rows) groups.set(fingerprintOf(row), [...(groups.get(fingerprintOf(row)) ?? []), row]);
  const risks: CertificateReuseRisk[] = [];
  for (const [fingerprint, group] of groups) {
    const assets = new Map<string, CertificateReuseRisk['applicationAssets'][number]>();
    for (const row of group) {
      if (!row.service_asset_id) continue;
      const metadata = objectValue(row.metadata);
      assets.set(row.service_asset_id, {
        id: row.service_asset_id,
        displayName: row.display_name?.trim() || row.service_asset_id,
        environment: row.environment ?? undefined,
        securityDomain: textValue(metadata.securityDomain) ?? row.environment ?? 'unclassified',
        logicalApplicationId: textValue(metadata.logicalApplicationId),
      });
    }
    if (assets.size < 2) continue;
    const applicationAssets = [...assets.values()];
    const domains = new Set(applicationAssets.map((asset) => asset.securityDomain));
    const trustDomainIds = [...new Set(group.map((row) => row.trust_domain_id).filter((value): value is string => Boolean(value)))];
    const trustDomainNames = [...new Set(group.map((row) => row.trust_domain_name).filter((value): value is string => Boolean(value)))];
    const crossSecurityDomain = domains.size > 1;
    const crossTrustDomain = trustDomainIds.length > 1;
    const wildcard = group.some((row) => row.common_name?.startsWith('*.') || arrayValue(row.sans).some((item) => String(item).startsWith('*.')));
    const severity: CertificateReuseRisk['severity'] = crossTrustDomain && riskType === 'public_key_reuse' ? 'critical' : crossSecurityDomain && wildcard ? 'critical' : riskType === 'public_key_reuse' ? 'critical' : 'high';
    risks.push({
      id: createHash('sha256').update(`${riskType}:${fingerprint}`).digest('hex').slice(0, 24), riskType, severity,
      fingerprintSha256: fingerprint, certificateVersionIds: [...new Set(group.map((row) => row.certificate_version_id))], applicationAssets,
      bindingCount: new Set(group.map((row) => row.binding_id)).size, redundantInstanceOnly: false, wildcard, crossSecurityDomain,
      trustDomainIds, trustDomainNames, crossTrustDomain,
      explanation: crossTrustDomain ? '同一公钥跨多个信任域复用。' : crossSecurityDomain ? '同一证书或公钥跨安全域复用。' : '同一证书或公钥用于多个应用资产。',
      remediation: '为每个应用资产创建独立密钥和证书申请。',
    });
  }
  return risks;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function riskWeight(value: CertificateReuseRisk['severity']): number {
  return value === 'critical' ? 3 : value === 'high' ? 2 : 1;
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function isIp(value: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) || value.includes(':');
}
