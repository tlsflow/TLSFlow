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
  createDefaultCaProviderRegistry,
  type CaIssuanceResult,
} from '../providers/ca-provider.js';
import { listAcmeProviderPresets } from '../providers/acme-provider.catalog.js';
import {
  getAcmeProviderProfile,
  listAcmeProviderProfiles,
  normalizeAcmeProviderProfile,
  normalizeProfileKey,
  type AcmeProviderProfileKey,
} from '../providers/acme-provider-profiles.js';
import { OpenSslCa } from '../providers/openssl-ca.js';
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
import { AcmeDomainService } from '../domain/acme.domain-service.js';
import type { AcmeChallengeType, AcmeProviderConfiguration } from '../schema/acme.schema.js';

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

/** 管理员高级设置使用的 ACME Provider 配置；普通申请页不暴露 Directory URL。 */
export interface AcmeProviderConfigurationInput {
  name?: string;
  displayName?: string;
  preset?: AcmeProviderProfileKey;
  profileKey?: AcmeProviderProfileKey;
  directoryUrl?: string;
  requestTimeoutMs?: number;
  termsOfServiceUrl?: string;
  termsOfServiceAgreed?: boolean;
  isDefault?: boolean;
  trustBundleSecretRef?: string;
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
  commonName?: string;
  securityDomain: string;
  rootValidityDays?: number;
  intermediateValidityDays?: number;
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
  opaqueKeyReference?: string;
  keyBackend?: KeyBackendType;
  exportability?: KeyExportability;
  protectionEvidence?: Record<string, unknown>;
  /** 宿主托管密钥时的真实密钥算法选择。 */
  requestedKeyAlgorithm?: 'rsa' | 'ec';
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
  private readonly openssl: OpenSslCa;
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
    openssl?: OpenSslCa;
    nodeTaskChannel?: CaNodeTaskChannel;
    operationsAdapters?: CaOperationsAdapterRegistry;
  }) {
    this.repository = dependencies.repository ?? new InternalCaRepository(dependencies.db);
    this.providers = dependencies.providers ?? createDefaultCaProviderRegistry(dependencies.secrets);
    this.openssl = dependencies.openssl ?? new OpenSslCa();
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

  /**
   * 每个租户懒初始化一个启用的 Lets Encrypt Profile。普通申请直接使用它，
   * 高级 Provider 才允许在管理员设置中维护。
   */
  async ensureBuiltinAcmeProvider(tenantId: string, actorId = 'system'): Promise<CaProviderEntity> {
    const providers = await this.repository.listProviders(tenantId);
    const active = providers.filter((item) => item.type === 'acme' && item.status === 'active');
    if (active.length > 0) return active.find((item) => item.configuration.isDefault === true) ?? active[0]!;

    const now = new Date().toISOString();
    const existing = providers.find((item) => item.type === 'acme' && (
      item.configuration.isBuiltIn === true
      || item.configuration.preset === 'letsencrypt'
      || item.endpoint === 'https://acme-v02.api.letsencrypt.org/directory'
    ));
    if (existing) {
      const restored: CaProviderEntity = {
        ...existing,
        status: 'active',
        endpoint: 'https://acme-v02.api.letsencrypt.org/directory',
        configuration: {
          ...existing.configuration,
          preset: 'letsencrypt',
          profileKey: 'letsencrypt',
          profileVersion: getAcmeProviderProfile('letsencrypt')?.version,
          directoryUrl: 'https://acme-v02.api.letsencrypt.org/directory',
          allowedChallenges: ['http-01', 'dns-01'],
          requestTimeoutMs: 15_000,
          verifyTls: true,
          termsOfServiceAgreed: true,
          isDefault: true,
          isBuiltIn: true,
          verificationLevel: existing.configuration.verificationLevel ?? 'unconfigured',
        },
        updatedAt: now,
      };
      await this.repository.saveProvider(restored);
      return restored;
    }

    const provider: CaProviderEntity = {
      id: newId('caprov'),
      tenantId,
      name: "Let's Encrypt",
      type: 'acme',
      deploymentMode: 'external',
      runtimePlatform: 'external',
      availabilityMode: 'single',
      endpoint: 'https://acme-v02.api.letsencrypt.org/directory',
      capabilities: this.providers.get('acme').getCapabilities(),
      status: 'active',
      configuration: {
        preset: 'letsencrypt',
        profileKey: 'letsencrypt',
        profileVersion: getAcmeProviderProfile('letsencrypt')?.version,
        directoryUrl: 'https://acme-v02.api.letsencrypt.org/directory',
        allowedChallenges: ['http-01', 'dns-01'],
        requestTimeoutMs: 15_000,
        verifyTls: true,
        termsOfServiceAgreed: true,
        isDefault: true,
        isBuiltIn: true,
        verificationLevel: 'unconfigured',
      },
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.saveProvider(provider);
    await this.saveDeclaredCapabilities(provider);
    await this.audit('internal_ca.acme_provider.initialized', actorId, 'ca_provider.create', 'ca_provider', provider.id, 'high', undefined, {
      preset: 'letsencrypt',
      isBuiltIn: true,
    });
    return provider;
  }

  async listAcmeProviderSettings(tenantId: string): Promise<{
    items: Array<Omit<CaProviderEntity, 'credentialSecretRef'>>;
    presets: ReturnType<typeof listAcmeProviderPresets>;
    profiles: ReturnType<typeof listAcmeProviderProfiles>;
  }> {
    await this.ensureBuiltinAcmeProvider(tenantId);
    const providers = await this.repository.listProviders(tenantId);
    return {
      items: providers.filter((item) => item.type === 'acme').map(sanitizeProvider),
      presets: listAcmeProviderPresets(),
      profiles: listAcmeProviderProfiles(),
    };
  }

  listAcmeProviderProfiles(): ReturnType<typeof listAcmeProviderProfiles> {
    return listAcmeProviderProfiles();
  }

  async createAcmeProvider(
    tenantId: string,
    input: AcmeProviderConfigurationInput,
    actorId: string,
    context?: RequestContext,
  ): Promise<Omit<CaProviderEntity, 'credentialSecretRef'>> {
    const configuration = normalizeAcmeProviderConfiguration(input);
    const profile = getAcmeProviderProfile(configuration.profileKey);
    const created = await this.createProvider(tenantId, {
      name: requiredText(input.displayName ?? input.name ?? profile?.displayName ?? '自定义 ACME CA', 'displayName'),
      type: 'acme',
      deploymentMode: 'external',
      runtimePlatform: 'external',
      availabilityMode: 'single',
      endpoint: configuration.directoryUrl,
      configuration: { ...configuration },
    }, actorId, context);
    if (configuration.isDefault === true) await this.setDefaultAcmeProvider(tenantId, created.id);
    return sanitizeProvider(await this.requireProvider(tenantId, created.id));
  }

  async updateAcmeProvider(
    tenantId: string,
    providerId: string,
    input: AcmeProviderConfigurationInput,
    actorId: string,
    context?: RequestContext,
  ): Promise<Omit<CaProviderEntity, 'credentialSecretRef'>> {
    const current = await this.requireProvider(tenantId, providerId);
    if (current.type !== 'acme') throw new AppError('CA_TOPOLOGY_INVALID', '当前 Provider 不是 ACME Provider', { providerId });
    const configuration = normalizeAcmeProviderConfiguration(input, current.configuration);
    const profile = getAcmeProviderProfile(configuration.profileKey);
    await this.repository.saveProvider({
      ...current,
      name: requiredText(input.displayName ?? input.name ?? current.name ?? profile?.displayName ?? '自定义 ACME CA', 'displayName'),
      endpoint: configuration.directoryUrl,
      configuration: { ...configuration },
      updatedAt: new Date().toISOString(),
    });
    if (configuration.isDefault === true) await this.setDefaultAcmeProvider(tenantId, providerId);
    await this.audit('internal_ca.acme_provider.updated', actorId, 'ca_provider.update', 'ca_provider', providerId, 'high', context, {
      preset: configuration.preset,
      isDefault: configuration.isDefault,
    });
    return sanitizeProvider(await this.requireProvider(tenantId, providerId));
  }

  private async setDefaultAcmeProvider(tenantId: string, providerId: string): Promise<void> {
    const now = new Date().toISOString();
    for (const provider of await this.repository.listProviders(tenantId)) {
      if (provider.type !== 'acme') continue;
      if (provider.id === providerId || provider.configuration.isDefault === true) {
        await this.repository.saveProvider({
          ...provider,
          configuration: { ...provider.configuration, isDefault: provider.id === providerId },
          updatedAt: now,
        });
      }
    }
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
    const result = await this.providers.get(provider.type).validateConnection(provider);
    if (provider.type === 'acme') {
      const existingVerification = provider.configuration.verification && typeof provider.configuration.verification === 'object'
        ? provider.configuration.verification
        : {};
      await this.repository.saveProvider({
        ...provider,
        configuration: {
          ...provider.configuration,
          verificationLevel: result.reachable ? 'directory_reachable' : 'blocked',
          verification: {
            ...existingVerification,
            directory: {
              checkedAt: new Date().toISOString(),
              reachable: result.reachable,
              detail: result.detail,
            },
          },
        },
        updatedAt: new Date().toISOString(),
      });
    }
    return result;
  }

  async listCapabilityRecords(
    tenantId: string,
    ownerType: CaCapabilityRecordEntity['ownerType'],
    ownerId: string,
  ): Promise<CaCapabilityRecordEntity[]> {
    return this.repository.listCapabilityRecords(tenantId, ownerType, ownerId);
  }

  async reserveIssuanceRecord(tenantId: string, input: {
    caId: string;
    certificateRequestId?: string;
    applicationAssetId?: string;
    subjectCommonName?: string;
    sans?: string[];
  }): Promise<CaIssuanceRecordEntity> {
    if (input.certificateRequestId) {
      const existing = await this.repository.getIssuanceByRequest(tenantId, input.certificateRequestId);
      if (existing) return existing;
    }
    await this.requireAuthority(tenantId, input.caId);
    const now = new Date().toISOString();
    return this.repository.saveIssuanceRecord({
      id: newId('caissue'),
      tenantId,
      caId: input.caId,
      serialNumber: await this.repository.allocateSerialNumber(tenantId, input.caId),
      certificateRequestId: input.certificateRequestId,
      applicationAssetId: input.applicationAssetId,
      status: 'reserved',
      recordOrigin: 'native',
      subjectCommonName: input.subjectCommonName,
      sans: normalizeCertificateNames(input.sans ?? []),
      observedAt: now,
      createdAt: now,
      updatedAt: now,
    });
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
    const commonName = requiredText(input.commonName || input.name, 'commonName');
    const preview = this.previewAuthority(input);
    if (!verifyConfirmation(previewPayload(input), input.confirmationToken)) throw new AppError('CA_RISK_CONFIRMATION_REQUIRED', 'CA 风险确认已失效，请重新预览');
    if (preview.blockers.length > 0) throw new AppError('CA_TOPOLOGY_INVALID', 'CA 拓扑存在阻断项', { blockers: preview.blockers });
    const provider = await this.requireProvider(tenantId, input.providerId);
    if (provider.deploymentMode !== input.deploymentMode || provider.runtimePlatform !== input.runtimePlatform) {
      throw new AppError('CA_TOPOLOGY_INVALID', 'CA 创建参数与 Provider 部署模式不一致');
    }
    const trustDomain = input.trustDomainId
      ? await this.requireUsableTrustDomain(tenantId, input.trustDomainId)
      : await this.createTrustDomain(tenantId, { name: `${requiredText(input.name, 'name')} 信任域`, purpose: input.securityDomain }, input.actorId, context);
    if (input.parentCaId) {
      const parent = await this.requireAuthority(tenantId, input.parentCaId);
      if (provider.type !== 'gcac_builtin' || parent.providerId !== provider.id || parent.role !== 'root' || parent.status !== 'active') {
        throw new AppError('CA_TOPOLOGY_INVALID', '只能在同一内置 Provider 的活动根 CA 下创建中间 CA');
      }
      if (parent.trustDomainId !== trustDomain.id || (parent.pathLengthConstraint ?? 0) < 1) {
        throw new AppError('CA_TOPOLOGY_INVALID', '父根 CA 不属于所选信任域或不允许签发中间 CA');
      }
      const intermediate = await this.createBuiltInIntermediate(tenantId, input, parent, input.name, commonName, context);
      await this.audit('internal_ca.authority.created', input.actorId, 'certificate_authority.create', 'certificate_authority', intermediate.id, 'critical', context, {
        providerId: provider.id,
        trustDomainId: trustDomain.id,
        parentCaId: parent.id,
        authorityIds: [intermediate.id],
        keyBackend: input.keyBackend,
      });
      return [sanitizeAuthority(intermediate)];
    }
    if (provider.type !== 'gcac_builtin') {
      const external = await this.createExternalAuthority(tenantId, input, provider, trustDomain.id);
      await this.audit('internal_ca.authority.connected', input.actorId, 'certificate_authority.create', 'certificate_authority', external.id, 'high', context, {
        providerId: provider.id,
        topologyMode: input.topologyMode,
      });
      return [sanitizeAuthority(external)];
    }
    const now = new Date().toISOString();
    const rootId = newId('ca');
    const rootMaterial = await this.openssl.createRoot(commonName, input.rootValidityDays ?? 3650, input.topologyMode === 'root_only' ? 0 : 1);
    const rootSecret = await this.dependencies.secrets.create({
      tenantId,
      name: `CA 私钥 ${input.name}`,
      type: 'certificate_private_key',
      scopeType: 'global',
      plainText: rootMaterial.privateKeyPem,
      createdBy: input.actorId,
      metadata: { ownerType: 'ca', ownerId: rootId, role: 'root' },
    }, context);
    const rootKey = await this.repository.saveKeyReference(buildKeyReference({
      id: newId('keyref'), tenantId, ownerId: rootId, secretRef: rootSecret.secretRef,
      fingerprint: rootMaterial.publicKeyFingerprintSha256, backendType: input.keyBackend,
    }));
    const root: CertificateAuthorityEntity = {
      id: rootId,
      tenantId,
      name: input.topologyMode === 'root_only' ? requiredText(input.name, 'name') : `${requiredText(input.name, 'name')} Root`,
      role: 'root',
      topologyMode: input.topologyMode,
      providerId: provider.id,
      trustDomainId: trustDomain.id,
      keyReferenceId: rootKey.id,
      privateKeySecretRef: rootSecret.secretRef,
      certificatePem: rootMaterial.certificatePem,
      certificateChainPem: rootMaterial.certificateChainPem,
      securityDomain: requiredText(input.securityDomain, 'securityDomain'),
      status: 'active',
      pathLengthConstraint: input.topologyMode === 'root_only' ? 0 : 1,
      subjectCommonName: commonName,
      notBefore: rootMaterial.notBefore,
      notAfter: rootMaterial.notAfter,
      fingerprintSha256: rootMaterial.fingerprintSha256,
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.saveAuthority(root);
    const authorities = [root];
    if (input.topologyMode === 'root_with_intermediate') {
      authorities.push(await this.createBuiltInIntermediate(
        tenantId,
        input,
        root,
        `${input.name} Issuing`,
        `${commonName} Issuing CA`,
        context,
        rootMaterial.privateKeyPem,
      ));
    }
    await this.audit('internal_ca.authority.created', input.actorId, 'certificate_authority.create', 'certificate_authority', root.id, 'critical', context, {
      providerId: provider.id,
      topologyMode: input.topologyMode,
      authorityIds: authorities.map((item) => item.id),
      keyBackend: input.keyBackend,
      availabilityMode: input.availabilityMode,
    });
    return authorities.map(sanitizeAuthority);
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

  /** 普通 ACME 申请的宿主上下文，不暴露逻辑 Authority/Profile 给前端。 */
  async ensureAcmeIssuanceContext(tenantId: string, providerId: string, actorId: string): Promise<{
    caId: string;
    profileVersionId: string;
    trustDomainId?: string;
  }> {
    const provider = await this.requireProvider(tenantId, providerId);
    if (provider.type !== 'acme') throw new AppError('CA_CAPABILITY_UNSUPPORTED', '当前 Provider 不是 ACME Provider', { providerId });
    let authority = (await this.repository.listAuthorities(tenantId)).find((item) => (
      item.providerId === provider.id && item.topologyMode === 'external_managed' && item.status === 'active'
    ));
    if (!authority) {
      const preview = this.previewAuthority({
        topologyMode: 'external_managed', deploymentMode: 'external', runtimePlatform: 'external', availabilityMode: 'single', keyBackend: 'secret',
      });
      const created = await this.createAuthority(tenantId, {
        providerId: provider.id,
        topologyMode: 'external_managed',
        deploymentMode: 'external',
        runtimePlatform: 'external',
        availabilityMode: 'single',
        keyBackend: 'secret',
        name: `ACME ${provider.name} Issuer`,
        commonName: `${provider.name} ACME Issuer`,
        securityDomain: 'acme',
        confirmationToken: preview.confirmationToken,
        actorId,
      });
      authority = await this.repository.getAuthority(tenantId, created[0]!.id);
    }
    if (!authority) throw new AppError('CA_PROVIDER_UNAVAILABLE', 'ACME 逻辑证书机构创建失败', { providerId });
    const profileEntry = (await this.listProfiles(tenantId)).find((item) => (
      item.profile.securityDomain === 'acme'
      && item.profile.trustDomainId === authority!.trustDomainId
      && item.profile.status === 'active'
    ));
    const version = profileEntry?.versions.slice().sort((left, right) => right.versionNo - left.versionNo)[0]
      ?? (await this.createProfile(tenantId, {
        name: `ACME ${provider.name} Server Certificate Profile`,
        securityDomain: 'acme',
        trustDomainId: authority.trustDomainId,
        rules: {
          allowedSanTypes: ['dns', 'ip'], keyAlgorithms: ['rsa', 'ec'], minimumRsaBits: 2048,
          maximumValidityDays: 397, renewalWindowDays: 7, rotateKeyOnRenewal: true,
          allowWildcard: true, requireApproval: false, extendedKeyUsages: ['serverAuth'],
        },
        actorId,
      })).version;
    return { caId: authority.id, profileVersionId: version.id, trustDomainId: authority.trustDomainId };
  }

  async createCertificateRequest(tenantId: string, input: CreateCertificateRequestInput, context?: RequestContext): Promise<CertificateRequestEntity> {
    const authority = await this.requireAuthority(tenantId, input.caId);
    if (authority.status !== 'active') throw new AppError('CA_PROVIDER_UNAVAILABLE', '证书机构当前不可签发', { caId: authority.id, status: authority.status });
    const profileVersion = await this.repository.getProfileVersion(input.profileVersionId);
    if (!profileVersion) throw new AppError('RESOURCE_NOT_FOUND', '证书 Profile 版本不存在', { profileVersionId: input.profileVersionId });
    const profile = await this.repository.getProfile(tenantId, profileVersion.profileId);
    if (!profile) throw new AppError('RESOURCE_NOT_FOUND', '证书 Profile 不存在', { profileId: profileVersion.profileId });
    validateProfile(input, profileVersion.rules);
    if (authority.trustDomainId) {
      await this.requireUsableTrustDomain(tenantId, authority.trustDomainId);
      if (input.trustDomainId && authority.trustDomainId !== input.trustDomainId) throw new AppError('CERTIFICATE_TRUST_DOMAIN_MISMATCH', '证书申请与 CA 信任域不匹配');
      if (profile.trustDomainId && authority.trustDomainId !== profile.trustDomainId) throw new AppError('CERTIFICATE_TRUST_DOMAIN_MISMATCH', '证书 Profile 与 CA 信任域不匹配');
    } else if (profile.securityDomain !== authority.securityDomain) {
      throw new AppError('CERTIFICATE_PROFILE_VIOLATION', '证书 Profile 与 CA 安全域不匹配');
    }
    const idempotencyKey = input.idempotencyKey?.trim() || createHash('sha256').update([
      tenantId, input.applicationAssetId, input.caId, input.profileVersionId, input.commonName,
      [...input.sans].sort().join(','), new Date().toISOString().slice(0, 10),
    ].join('|')).digest('hex');
    const existing = await this.repository.getRequestByIdempotencyKey(tenantId, idempotencyKey);
    if (existing) return existing;
    const keyMaterial = await this.prepareKeyMaterial(tenantId, input, profileVersion.rules, context);
    const now = new Date().toISOString();
    const requestId = newId('certreq');
    const approval = profileVersion.rules.requireApproval && this.dependencies.approvals
      ? await this.dependencies.approvals.create({
          operationType: 'certificate_request.issue',
          resourceRefs: [{ type: 'certificate_request', id: requestId }],
          riskLevel: 'high',
          parameters: { requestId, applicationAssetId: input.applicationAssetId, caId: authority.id, publicKeyFingerprintSha256: keyMaterial.publicKeyFingerprintSha256 },
          requestedBy: input.actorId,
        }, context)
      : undefined;
    const request: CertificateRequestEntity = {
      id: requestId,
      tenantId,
      applicationAssetId: requiredText(input.applicationAssetId, 'applicationAssetId'),
      caId: authority.id,
      trustDomainId: authority.trustDomainId,
      profileVersionId: profileVersion.id,
      keyReferenceId: keyMaterial.keyReference.id,
      csrPem: keyMaterial.csrPem,
      csrSha256: keyMaterial.csrSha256,
      publicKeyFingerprintSha256: keyMaterial.publicKeyFingerprintSha256,
      idempotencyKey,
      status: profileVersion.rules.requireApproval ? 'pending_approval' : 'approved',
      requestedBy: input.actorId,
      approvalId: approval?.id,
      deferIssuance: input.deferIssuance === true,
      subjectCommonName: requiredText(input.commonName, 'commonName'),
      sans: normalizeCertificateNames(input.sans),
      requestedValidityDays: Math.min(input.requestedValidityDays ?? profileVersion.rules.maximumValidityDays, profileVersion.rules.maximumValidityDays),
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.saveRequest(request);
    await this.audit('internal_ca.request.created', input.actorId, 'certificate_request.create', 'certificate_request', request.id, 'high', context, {
      applicationAssetId: request.applicationAssetId,
      caId: request.caId,
      keyCustodyMode: input.custodyMode,
      publicKeyFingerprintSha256: request.publicKeyFingerprintSha256,
    });
    if (profileVersion.rules.requireApproval || input.deferIssuance === true) return request;
    return this.issueRequest(tenantId, request.id, input.actorId, context);
  }

  async listRequests(tenantId: string): Promise<CertificateRequestEntity[]> {
    return this.repository.listRequests(tenantId);
  }

  async approveRequest(tenantId: string, requestId: string, actorId: string, approvalId?: string, context?: RequestContext): Promise<CertificateRequestEntity> {
    const request = await this.requireRequest(tenantId, requestId);
    if (request.status !== 'pending_approval') throw new AppError('RESOURCE_VERSION_CONFLICT', '证书申请当前不在待审批状态', { status: request.status });
    if (request.approvalId) {
      if (!approvalId || approvalId !== request.approvalId) throw new AppError('DEPLOYMENT_APPROVAL_REQUIRED', '证书申请需要匹配的审批单');
      await this.dependencies.approvals?.consume(approvalId, {
        requestId: request.id,
        applicationAssetId: request.applicationAssetId,
        caId: request.caId,
        publicKeyFingerprintSha256: request.publicKeyFingerprintSha256,
      });
    }
    await this.repository.saveRequest({ ...request, status: 'approved', approvedBy: actorId, updatedAt: new Date().toISOString() });
    await this.audit('internal_ca.request.approved', actorId, 'certificate_request.approve', 'certificate_request', requestId, 'high', context, { approvalId });
    return request.deferIssuance === true ? this.requireRequest(tenantId, requestId) : this.issueRequest(tenantId, requestId, actorId, context);
  }

  async issueRequest(tenantId: string, requestId: string, actorId: string, context?: RequestContext): Promise<CertificateRequestEntity> {
    const request = await this.requireRequest(tenantId, requestId);
    if (['issued', 'deploying', 'active'].includes(request.status)) return request;
    if (!['approved', 'issue_failed'].includes(request.status)) throw new AppError('RESOURCE_VERSION_CONFLICT', '证书申请尚未批准', { status: request.status });
    const authority = await this.requireAuthority(tenantId, request.caId);
    const provider = await this.requireProvider(tenantId, authority.providerId);
    if (request.deferIssuance === true && provider.type === 'acme') throw new AppError('ACME_ORDER_REQUIRED', 'ACME 证书申请必须通过 Order 生命周期完成签发');
    const profileVersion = await this.repository.getProfileVersion(request.profileVersionId);
    const keyReference = await this.repository.getKeyReference(tenantId, request.keyReferenceId);
    if (!profileVersion || !keyReference) throw new AppError('RESOURCE_NOT_FOUND', '证书申请依赖对象不存在');
    const ledgerRecord = provider.type === 'gcac_builtin'
      ? await this.reserveIssuanceRecord(tenantId, { caId: authority.id, certificateRequestId: request.id, applicationAssetId: request.applicationAssetId, subjectCommonName: request.subjectCommonName, sans: request.sans })
      : await this.repository.getIssuanceByRequest(tenantId, request.id);
    await this.repository.saveRequest({ ...request, status: 'issuing', updatedAt: new Date().toISOString() });
    try {
      const issued = await this.providers.get(provider.type).signCsr({
        provider,
        authority,
        csrPem: request.csrPem,
        sans: request.sans,
        validityDays: request.requestedValidityDays,
        profileRules: profileVersion.rules,
        idempotencyKey: request.idempotencyKey,
        actorId,
        serialNumber: provider.type === 'gcac_builtin' ? ledgerRecord?.serialNumber : undefined,
      });
      if (issued.status !== 'issued') return this.saveNonFinalIssuance(request, issued);
      return this.completeIssuedRequest(request, issued, provider, authority, keyReference, actorId, context);
    } catch (error) {
      if (ledgerRecord && ledgerRecord.status !== 'issued') await this.repository.saveIssuanceRecord({ ...ledgerRecord, status: 'failed', updatedAt: new Date().toISOString() });
      await this.repository.saveRequest({
        ...request,
        status: 'issue_failed',
        failureCode: error instanceof AppError ? error.errorCode : 'CA_PROVIDER_UNAVAILABLE',
        failureMessage: error instanceof Error ? error.message : String(error),
        updatedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  async refreshRequestIssuance(tenantId: string, requestId: string, actorId: string, context?: RequestContext): Promise<CertificateRequestEntity> {
    const request = await this.requireRequest(tenantId, requestId);
    if (request.status !== 'issuing' || !request.providerRequestId) throw new AppError('RESOURCE_VERSION_CONFLICT', '证书申请当前没有可查询的远程签发结果', { status: request.status });
    const authority = await this.requireAuthority(tenantId, request.caId);
    const provider = await this.requireProvider(tenantId, authority.providerId);
    const adapter = this.providers.get(provider.type);
    if (!adapter.queryIssuance || !provider.capabilities.queryIssuance) throw new AppError('CA_CAPABILITY_UNSUPPORTED', '当前 CA Provider 不支持查询签发结果');
    const keyReference = await this.repository.getKeyReference(tenantId, request.keyReferenceId);
    if (!keyReference) throw new AppError('RESOURCE_NOT_FOUND', '证书申请密钥引用不存在');
    const result = await adapter.queryIssuance({ provider, providerRequestId: request.providerRequestId, actorId });
    if (result.status !== 'issued') return this.saveNonFinalIssuance(request, result);
    return this.completeIssuedRequest(request, result, provider, authority, keyReference, actorId, context);
  }

  async importAcmeCertificate(
    tenantId: string,
    requestId: string,
    material: { certificatePem: string; certificateChainPem: string },
    providerRequestId: string,
    actorId: string,
    context?: RequestContext,
  ): Promise<CertificateRequestEntity> {
    const request = await this.requireRequest(tenantId, requestId);
    const authority = await this.requireAuthority(tenantId, request.caId);
    const provider = await this.requireProvider(tenantId, authority.providerId);
    if (provider.type !== 'acme') throw new AppError('CA_CAPABILITY_UNSUPPORTED', '当前证书申请不是 ACME Provider');
    const validation = this.dependencies.certificates.validateImportVersion({
      certificatePem: material.certificateChainPem,
      allowCertificateOnly: true,
      keyReferenceId: request.keyReferenceId,
      createdBy: actorId,
    });
    const keyReference = await this.repository.getKeyReference(tenantId, request.keyReferenceId);
    if (!keyReference) throw new AppError('RESOURCE_NOT_FOUND', '证书申请密钥引用不存在');
    return this.completeIssuedRequest(request, {
      status: 'issued',
      providerRequestId,
      certificatePem: material.certificatePem,
      certificateChainPem: material.certificateChainPem,
      serialNumber: validation.certificate.serialNumber,
      fingerprintSha256: validation.certificate.fingerprintSha256,
      publicKeyFingerprintSha256: validation.certificate.publicKeyFingerprintSha256 ?? '',
      notBefore: validation.certificate.notBefore,
      notAfter: validation.certificate.notAfter,
    }, provider, authority, keyReference, actorId, context);
  }

  async markRequestActive(tenantId: string, requestId: string): Promise<CertificateRequestEntity> {
    const request = await this.requireRequest(tenantId, requestId);
    if (!['issued', 'deploying'].includes(request.status)) throw new AppError('RESOURCE_VERSION_CONFLICT', '证书申请尚未完成签发', { status: request.status });
    return this.repository.saveRequest({ ...request, status: 'active', updatedAt: new Date().toISOString() });
  }

  listRenewals(tenantId: string): Promise<CertificateRenewalJobEntity[]> {
    return this.repository.listRenewals(tenantId);
  }

  async scheduleDueRenewals(tenantId: string, actorId: string, now = new Date(), context?: RequestContext): Promise<CertificateRenewalJobEntity[]> {
    const jobs = await this.repository.listRenewals(tenantId);
    const requests = await this.repository.listRequests(tenantId);
    const created: CertificateRenewalJobEntity[] = [];
    for (const request of requests.filter((item) => ['issued', 'active'].includes(item.status) && item.certificateVersionId)) {
      const version = await this.dependencies.certificates.getRepository().getVersion(request.certificateVersionId!, tenantId);
      const profileVersion = await this.repository.getProfileVersion(request.profileVersionId);
      const keyReference = await this.repository.getKeyReference(tenantId, request.keyReferenceId);
      if (!version || !profileVersion || !keyReference) continue;
      const renewAt = new Date(version.notAfter).getTime() - profileVersion.rules.renewalWindowDays * 86_400_000;
      if (renewAt > now.getTime()) continue;
      const renewalWindowKey = `${version.notAfter.slice(0, 10)}:${profileVersion.versionNo}`;
      if (jobs.some((item) => item.certificateVersionId === version.id && item.renewalWindowKey === renewalWindowKey)) continue;
      const timestamp = now.toISOString();
      let job: CertificateRenewalJobEntity = {
        id: newId('renew'), tenantId, certificateVersionId: version.id, renewalWindowKey,
        status: ['local_agent', 'device_local'].includes(keyReference.custodyMode) ? 'key_pending' : 'csr_pending',
        scheduledAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
      };
      job = await this.repository.saveRenewal(job);
      if (keyReference.custodyMode === 'managed_secret') {
        const renewed = await this.createCertificateRequest(tenantId, {
          applicationAssetId: request.applicationAssetId,
          caId: request.caId,
          profileVersionId: request.profileVersionId,
          commonName: request.subjectCommonName,
          sans: request.sans,
          requestedValidityDays: request.requestedValidityDays,
          custodyMode: 'managed_secret',
          idempotencyKey: `renew:${version.id}:${renewalWindowKey}`,
          actorId,
        }, context);
        job = await this.repository.saveRenewal({
          ...job,
          certificateRequestId: renewed.id,
          status: renewed.status === 'issued' ? 'deploying' : renewed.status === 'pending_approval' ? 'csr_pending' : 'issuing',
          updatedAt: new Date().toISOString(),
        });
      }
      created.push(job);
    }
    return created;
  }

  async requestRevocation(tenantId: string, certificateVersionId: string, reason: string, actorId: string, context?: RequestContext): Promise<CertificateRevocationEntity> {
    const version = await this.dependencies.certificates.getRepository().getVersion(certificateVersionId, tenantId);
    if (!version?.issuingCaId) throw new AppError('RESOURCE_NOT_FOUND', '证书版本没有可用的签发 CA', { certificateVersionId });
    const authority = await this.requireAuthority(tenantId, version.issuingCaId);
    const now = new Date().toISOString();
    const approval = await this.dependencies.approvals?.create({
      operationType: 'certificate.revoke',
      resourceRefs: [{ type: 'certificate_version', id: certificateVersionId }],
      riskLevel: 'critical',
      parameters: { certificateVersionId, caId: authority.id, serialNumber: version.serialNumber, reason },
      requestedBy: actorId,
    }, context);
    return this.repository.saveRevocation({
      id: newId('revoke'), tenantId, certificateVersionId, caId: authority.id, trustDomainId: authority.trustDomainId,
      reason: requiredText(reason, 'reason'), status: 'pending_approval', requestedBy: actorId, approvalId: approval?.id,
      warnings: [], createdAt: now, updatedAt: now,
    });
  }

  listRevocations(tenantId: string): Promise<CertificateRevocationEntity[]> {
    return this.repository.listRevocations(tenantId);
  }

  async approveRevocation(tenantId: string, revocationId: string, _approvalId: string, _actorId: string): Promise<CertificateRevocationEntity> {
    const revocation = (await this.repository.listRevocations(tenantId)).find((item) => item.id === revocationId);
    if (!revocation) throw new AppError('RESOURCE_NOT_FOUND', '证书吊销任务不存在', { revocationId });
    const version = await this.dependencies.certificates.getRepository().getVersion(revocation.certificateVersionId, tenantId);
    if (!version) throw new AppError('RESOURCE_NOT_FOUND', '证书版本不存在', { certificateVersionId: revocation.certificateVersionId });
    const authority = await this.requireAuthority(tenantId, revocation.caId);
    const provider = await this.requireProvider(tenantId, authority.providerId);
    const adapter = this.providers.get(provider.type);
    if (!adapter.revoke) throw new AppError('CERTIFICATE_REVOCATION_UNSUPPORTED', '当前 CA Provider 不支持吊销');
    const revoked = await adapter.revoke({ provider, authority, serialNumber: version.serialNumber, reason: revocation.reason, actorId: _actorId });
    return this.repository.saveRevocation({ ...revocation, status: 'revoked', revokedAt: revoked.revokedAt, updatedAt: new Date().toISOString() });
  }

  private async prepareKeyMaterial(
    tenantId: string,
    input: CreateCertificateRequestInput,
    rules: CertificateProfileRules,
    context?: RequestContext,
  ): Promise<{
    keyReference: KeyReferenceEntity;
    csrPem: string;
    csrSha256: string;
    publicKeyFingerprintSha256: string;
  }> {
    const now = new Date().toISOString();
    if (input.custodyMode === 'managed_secret') {
      const algorithm = input.requestedKeyAlgorithm
        ?? (rules.keyAlgorithms.includes('ec') && !rules.keyAlgorithms.includes('rsa') ? 'ec' : 'rsa');
      if (!rules.keyAlgorithms.includes(algorithm)) {
        throw new AppError('VALIDATION_FAILED', '证书 Profile 不允许所选密钥算法', { algorithm });
      }
      const generated = await this.openssl.generateManagedKeyAndCsr({
        commonName: input.commonName,
        sans: normalizeCertificateNames(input.sans),
        algorithm,
        rsaBits: rules.minimumRsaBits,
      });
      const secret = await this.dependencies.secrets.create({
        tenantId,
        name: `应用证书私钥 ${input.commonName}`,
        type: 'certificate_private_key',
        scopeType: 'global',
        plainText: generated.privateKeyPem,
        createdBy: input.actorId,
        metadata: { ownerType: 'application_certificate', applicationAssetId: input.applicationAssetId },
      }, context);
      const keyReference = await this.repository.saveKeyReference({
        id: newId('keyref'),
        tenantId,
        ownerType: 'application_certificate',
        ownerId: input.applicationAssetId,
        custodyMode: 'managed_secret',
        backendType: 'secret',
        secretRef: secret.secretRef,
        publicKeyFingerprintSha256: generated.csr.publicKeyFingerprintSha256,
        exportability: 'exportable',
        protectionLevel: 'software_controlled',
        status: 'active',
        evidence: { generatedBy: 'gcac', privateKeyTransported: false, algorithm },
        createdAt: now,
        updatedAt: now,
      });
      return { keyReference, ...generated.csr };
    }
    if (!input.csrPem || !input.opaqueKeyReference) {
      throw new AppError('VALIDATION_FAILED', '本地持钥或外部密钥申请必须提供 CSR 和不透明密钥引用');
    }
    const parsed = await this.openssl.parseCsr(input.csrPem);
    const backendType = input.keyBackend ?? (input.custodyMode === 'device_local' ? 'device' : 'file');
    const keyReference = await this.repository.saveKeyReference({
      id: newId('keyref'),
      tenantId,
      ownerType: 'application_certificate',
      ownerId: input.applicationAssetId,
      custodyMode: input.custodyMode,
      backendType,
      opaqueReference: input.opaqueKeyReference,
      publicKeyFingerprintSha256: parsed.publicKeyFingerprintSha256,
      exportability: normalizeExportability(backendType, input.exportability),
      protectionLevel: ['hsm', 'kms', 'tpm', 'pkcs11'].includes(backendType)
        ? 'hardware_backed'
        : backendType === 'cng'
          ? 'os_protected'
          : 'software_controlled',
      status: 'active',
      evidence: structuredClone(input.protectionEvidence ?? {}),
      createdAt: now,
      updatedAt: now,
    });
    return { keyReference, ...parsed };
  }

  private async createExternalAuthority(
    tenantId: string,
    input: CreateAuthorityInput,
    provider: CaProviderEntity,
    trustDomainId: string,
  ): Promise<CertificateAuthorityEntity> {
    const now = new Date().toISOString();
    return this.repository.saveAuthority({
      id: newId('ca'),
      tenantId,
      name: requiredText(input.name, 'name'),
      role: 'root',
      topologyMode: 'external_managed',
      providerId: provider.id,
      trustDomainId,
      securityDomain: requiredText(input.securityDomain, 'securityDomain'),
      status: 'active',
      subjectCommonName: requiredText(input.commonName || input.name, 'commonName'),
      createdAt: now,
      updatedAt: now,
    });
  }

  private async createBuiltInIntermediate(
    tenantId: string,
    input: CreateAuthorityInput,
    parent: CertificateAuthorityEntity,
    name: string,
    commonName: string,
    context?: RequestContext,
    parentPrivateKeyPem?: string,
  ): Promise<CertificateAuthorityEntity> {
    if (!parent.certificatePem) throw new AppError('CA_TOPOLOGY_INVALID', '父根 CA 缺少证书材料');
    const resolvedParentKey = parentPrivateKeyPem ?? (parent.privateKeySecretRef
      ? (await this.dependencies.secrets.resolveForService({
          secretRef: parent.privateKeySecretRef,
          tenantId,
          expectedType: 'certificate_private_key',
          purpose: 'internal_ca.intermediate.create',
          actorId: input.actorId,
          context,
        })).plainText
      : undefined);
    if (!resolvedParentKey) throw new AppError('CA_TOPOLOGY_INVALID', '父根 CA 私钥不可用，无法创建中间 CA');
    const intermediateId = newId('ca');
    const material = await this.openssl.createIntermediate({
      commonName,
      validityDays: input.intermediateValidityDays ?? 1825,
      pathLengthConstraint: 0,
      parentPrivateKeyPem: resolvedParentKey,
      parentCertificatePem: parent.certificatePem,
      parentChainPem: parent.certificateChainPem ?? parent.certificatePem,
    });
    const secret = await this.dependencies.secrets.create({
      tenantId,
      name: `CA 私钥 ${name}`,
      type: 'certificate_private_key',
      scopeType: 'global',
      plainText: material.privateKeyPem,
      createdBy: input.actorId,
      metadata: { ownerType: 'ca', ownerId: intermediateId, role: 'intermediate', parentCaId: parent.id },
    }, context);
    const key = await this.repository.saveKeyReference(buildKeyReference({
      id: newId('keyref'), tenantId, ownerId: intermediateId, secretRef: secret.secretRef,
      fingerprint: material.publicKeyFingerprintSha256, backendType: input.keyBackend,
    }));
    const now = new Date().toISOString();
    return this.repository.saveAuthority({
      id: intermediateId,
      tenantId,
      name: requiredText(name, 'name'),
      role: 'intermediate',
      parentCaId: parent.id,
      topologyMode: 'root_with_intermediate',
      providerId: parent.providerId,
      trustDomainId: parent.trustDomainId,
      keyReferenceId: key.id,
      privateKeySecretRef: secret.secretRef,
      certificatePem: material.certificatePem,
      certificateChainPem: material.certificateChainPem,
      securityDomain: requiredText(input.securityDomain, 'securityDomain'),
      status: 'active',
      pathLengthConstraint: 0,
      subjectCommonName: requiredText(commonName, 'commonName'),
      notBefore: material.notBefore,
      notAfter: material.notAfter,
      fingerprintSha256: material.fingerprintSha256,
      createdAt: now,
      updatedAt: now,
    });
  }

  private async saveNonFinalIssuance(
    request: CertificateRequestEntity,
    result: Exclude<CaIssuanceResult, { status: 'issued' }>,
  ): Promise<CertificateRequestEntity> {
    return this.repository.saveRequest({
      ...request,
      status: result.status === 'rejected' ? 'rejected' : 'issuing',
      providerRequestId: result.providerRequestId,
      failureCode: result.status === 'rejected' ? 'CA_REQUEST_REJECTED' : undefined,
      failureMessage: result.detail,
      updatedAt: new Date().toISOString(),
    });
  }

  private async completeIssuedRequest(
    request: CertificateRequestEntity,
    issued: Extract<CaIssuanceResult, { status: 'issued' }>,
    provider: CaProviderEntity,
    authority: CertificateAuthorityEntity,
    keyReference: KeyReferenceEntity,
    actorId: string,
    context?: RequestContext,
  ): Promise<CertificateRequestEntity> {
    if (issued.publicKeyFingerprintSha256.toLowerCase() !== request.publicKeyFingerprintSha256.toLowerCase()) {
      throw new AppError('PUBLIC_KEY_MISMATCH', '签发证书公钥与 CSR 不匹配');
    }
    if (provider.type === 'acme') this.assertAcmeIssuedCertificate(request, issued);
    const ledgerRecord = await this.repository.getIssuanceByRequest(request.tenantId, request.id);
    if (ledgerRecord && ledgerRecord.serialNumber.toUpperCase() !== issued.serialNumber.toUpperCase()) {
      throw new AppError('CA_LEDGER_INCONSISTENT', '签发证书序列号与账本预留值不一致', { requestId: request.id, caId: authority.id });
    }
    const imported = await this.dependencies.certificates.importVersion({
      tenantId: request.tenantId,
      certificatePem: issued.certificateChainPem,
      allowCertificateOnly: !keyReference.secretRef,
      existingPrivateKeySecretRef: keyReference.secretRef,
      issuingCaId: authority.id,
      certificateRequestId: request.id,
      certificateProfileVersionId: request.profileVersionId,
      keyReferenceId: keyReference.id,
      keyCustodyMode: keyReference.custodyMode,
      activationState: provider.type === 'acme' ? 'staged' : 'promoted',
      sourceType: provider.type === 'acme' ? 'acme' : 'internal_ca',
      name: request.subjectCommonName,
      tags: ['internal-ca', authority.securityDomain],
      createdBy: actorId,
    }, context);
    if (authority.trustDomainId) {
      await this.dependencies.db.query('update pg_certificate_versions set trust_domain_id = $2 where id = $1', [imported.version.id, authority.trustDomainId]);
    }
    const now = new Date().toISOString();
    await this.repository.saveIssuanceRecord({
      id: ledgerRecord?.id ?? newId('caissue'),
      tenantId: request.tenantId,
      caId: authority.id,
      serialNumber: issued.serialNumber.toUpperCase(),
      certificateRequestId: request.id,
      certificateVersionId: imported.version.id,
      applicationAssetId: request.applicationAssetId,
      status: 'issued',
      recordOrigin: provider.type === 'gcac_builtin' ? 'native' : 'external',
      subjectCommonName: request.subjectCommonName,
      sans: request.sans,
      certificateFingerprintSha256: imported.version.fingerprintSha256,
      publicKeyFingerprintSha256: imported.version.publicKeyFingerprintSha256,
      notBefore: imported.version.notBefore,
      notAfter: imported.version.notAfter,
      issuedAt: now,
      observedAt: ledgerRecord?.observedAt ?? now,
      createdAt: ledgerRecord?.createdAt ?? now,
      updatedAt: now,
    });
    const completed: CertificateRequestEntity = {
      ...request,
      status: 'issued',
      providerRequestId: issued.providerRequestId,
      certificateVersionId: imported.version.id,
      failureCode: undefined,
      failureMessage: undefined,
      updatedAt: now,
    };
    await this.repository.saveRequest(completed);
    await this.audit('internal_ca.request.issued', actorId, 'certificate_request.issue', 'certificate_request', request.id, 'high', context, {
      certificateVersionId: imported.version.id,
      fingerprintSha256: imported.version.fingerprintSha256,
      publicKeyFingerprintSha256: request.publicKeyFingerprintSha256,
    });
    return completed;
  }

  private assertAcmeIssuedCertificate(request: CertificateRequestEntity, issued: Extract<CaIssuanceResult, { status: 'issued' }>): void {
    const validation = this.dependencies.certificates.validateImportVersion({
      certificatePem: issued.certificateChainPem,
      allowCertificateOnly: true,
      keyReferenceId: request.keyReferenceId,
      createdBy: request.requestedBy,
    });
    if (validation.certificate.fingerprintSha256.toLowerCase() !== issued.fingerprintSha256.toLowerCase()) {
      throw new AppError('ACME_CERTIFICATE_INVALID', 'ACME 证书 fingerprint 与签发结果不一致');
    }
    if (validation.certificate.publicKeyFingerprintSha256?.toLowerCase() !== request.publicKeyFingerprintSha256.toLowerCase()) {
      throw new AppError('PUBLIC_KEY_MISMATCH', 'ACME 证书公钥与 CSR 不匹配');
    }
    const requestedNames = new Set(normalizeCertificateNames([request.subjectCommonName, ...request.sans]));
    const issuedNames = new Set(normalizeCertificateNames([validation.certificate.commonName ?? '', ...validation.certificate.sans]));
    if (requestedNames.size !== issuedNames.size || [...requestedNames].some((name) => !issuedNames.has(name))) {
      throw new AppError('ACME_CERTIFICATE_INVALID', 'ACME 证书 SAN 与申请不一致');
    }
    if (!['valid', 'incomplete'].includes(validation.chain.status) || validation.chain.certificateCount < 2) {
      throw new AppError('ACME_CERTIFICATE_INVALID', 'ACME 证书链不完整或无效');
    }
    if (Date.parse(validation.certificate.notAfter) <= Date.now()
      || Date.parse(validation.certificate.notAfter) <= Date.parse(validation.certificate.notBefore)) {
      throw new AppError('ACME_CERTIFICATE_INVALID', 'ACME 证书有效期无效或已过期');
    }
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
  if (provider.deploymentMode === 'external' && ['gcac_builtin', 'gcac_managed_node'].includes(provider.type)) throw new AppError('CA_TOPOLOGY_INVALID', '外部部署不能使用 GCAC 内置 Provider');
}

function assertPluginBinding(provider: CaProviderEntity): void {
  if (provider.type !== 'plugin') return;
  if (!textValue(provider.configuration.pluginId) || !textValue(provider.configuration.pluginVersionId)) {
    throw new AppError('CA_PROVIDER_UNAVAILABLE', '外部 CA 插件缺少已发布的 PluginVersion 绑定', {
      code: 'CA_PLUGIN_BINDING_REQUIRED',
      providerId: provider.id,
      providerType: provider.type,
    });
  }
}

function normalizeAcmeProviderConfiguration(
  input: AcmeProviderConfigurationInput,
  current: Record<string, unknown> = {},
): AcmeProviderConfiguration {
  const configuration = normalizeAcmeProviderProfile({
    ...input,
    profileKey: normalizeProfileKey(input.profileKey ?? input.preset ?? current.profileKey ?? current.preset),
  }, {
    ...current,
    requestTimeoutMs: input.requestTimeoutMs ?? current.requestTimeoutMs,
    termsOfServiceUrl: input.termsOfServiceUrl ?? current.termsOfServiceUrl,
    termsOfServiceAgreed: input.termsOfServiceAgreed === true || current.termsOfServiceAgreed === true,
  });
  new AcmeDomainService().validateProviderConfiguration({ ...configuration });
  return configuration;
}

function buildKeyReference(input: {
  id: string;
  tenantId: string;
  ownerId: string;
  secretRef: string;
  fingerprint: string;
  backendType: KeyBackendType;
}): KeyReferenceEntity {
  const now = new Date().toISOString();
  return {
    id: input.id,
    tenantId: input.tenantId,
    ownerType: 'ca',
    ownerId: input.ownerId,
    custodyMode: input.backendType === 'secret' || input.backendType === 'file' ? 'managed_secret' : 'external_key',
    backendType: input.backendType,
    secretRef: input.secretRef,
    publicKeyFingerprintSha256: input.fingerprint,
    exportability: normalizeExportability(input.backendType),
    protectionLevel: ['hsm', 'kms', 'tpm', 'pkcs11'].includes(input.backendType) ? 'hardware_backed' : 'software_controlled',
    status: 'active',
    evidence: { generatedBy: 'gcac_builtin' },
    createdAt: now,
    updatedAt: now,
  };
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
