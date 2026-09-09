import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import { structuredLogger } from '../../../common/logging/structured-logger.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { newId } from '../../../shared/id.js';
import type { ActorType, RequestContext, SecuritySubject } from '../../../shared/security-types.js';
import type { AuditService } from '../../audits/audit.service.js';
import type { ApprovalService } from '../../approvals/approval.service.js';
import type { CertificatesApplicationService } from '../../certificates/application/certificates.application-service.js';
import type { SecretService } from '../../secrets/secret.service.js';
import {
  CaProviderRegistry,
  createDefaultCaProviderRegistry,
  PluginCaProviderAdapter,
  type CaProviderValidationResult,
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
import { CaOperationsRepository } from '../repository/ca-operations.repository.js';
import { CertificatePolicyService, normalizeCertificatePolicyRules } from './certificate-policy.service.js';
import { CaOperationsQueryService } from './ca-operations-query.service.js';
import type { CaOperationsRealtimePublisher } from './ca-operations-realtime.js';
import type {
  AgentCaObservationBatchDto,
  AgentCaObservationIngestResult,
  CaAgentRuntimeProjection,
  CaOperationRecordDetailDto,
  CaOperationRecordPageDto,
  CaOperationsRecordQueryDto,
  CaOperationsTreeAuthorityDto,
  CaOperationsTreeDto,
} from '../dto/ca-operations.dto.js';
import { allSameAdcsAuthorityIdentity, sameAdcsAuthorityIdentity } from './adcs-authority-identity.js';
import {
  caProviderTypes,
  type CaAvailabilityMode,
  type CaCapabilityRecordEntity,
  type CaCrlPublicationEntity,
  type CaDeploymentMode,
  type CaIssuanceRecordEntity,
  type CaProviderEntity,
  type CaProviderType,
  type CaRiskPreview,
  type CaRuntimePlatform,
  type ExternalCaObservationEntity,
  type CaTopologyMode,
  type CaTrustDomainEntity,
  type CaTrustDomainIsolationLevel,
  type CaTrustDomainStatus,
  type CertificateAuthorityEntity,
  type CertificatePolicyEntity,
  type CertificatePolicyRules,
  type CertificatePolicyVersionEntity,
  type EffectiveCertificatePolicySnapshot,
  type CertificateProfileEntity,
  type CertificateProfilePurpose,
  type CertificateProfileProviderType,
  type CertificateProfileRules,
  type CertificateProfileVersionEntity,
  type CertificateRequestEntity,
  type CertificateRenewalJobEntity,
  type CertificateRevocationEntity,
  type CertificateReuseRisk,
  type KeyBackendType,
  type KeyExportability,
  type KeyReferenceEntity,
  type ProviderActionBindingEntity,
  type ProviderActionExecutionLocation,
  type TrustDistributionEntity,
} from '../schema/internal-ca.schema.js';
import { AcmeDomainService } from '../domain/acme.domain-service.js';
import type { AcmeChallengeType, AcmeProviderConfiguration } from '../schema/acme.schema.js';
import type { TaskEnqueuer } from '../../tasks/task-enqueue.js';

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

export interface UpdateCaProviderInput {
  name?: string;
  deploymentMode?: CaDeploymentMode;
  runtimePlatform?: CaRuntimePlatform;
  availabilityMode?: CaAvailabilityMode;
  endpoint?: string;
  credentialSecretRef?: string;
  configuration?: Record<string, unknown>;
  status?: CaProviderEntity['status'];
}

interface ProviderUpdateOptions {
  source?: 'manual' | 'reconciliation';
}

interface ProviderCreateOptions {
  source?: 'manual' | 'reconciliation';
}

export interface CreateProviderActionBindingInput {
  providerId: string;
  pluginVersionId: string;
  executionLocation: ProviderActionExecutionLocation;
  issueAction: ProviderActionBindingEntity['issueAction'];
  queryAction?: ProviderActionBindingEntity['queryAction'];
  revokeAction?: ProviderActionBindingEntity['revokeAction'];
  revocationEvidenceAction?: ProviderActionBindingEntity['revocationEvidenceAction'];
  approvalMode?: ProviderActionBindingEntity['approvalMode'];
  capabilityEvidence?: Record<string, unknown>;
  status?: ProviderActionBindingEntity['status'];
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
  crlDistributionPoint?: string;
  configuration?: Record<string, unknown>;
  confirmationToken: string;
  actorId: string;
}

/**
 * CA 证书主题、密钥、层级和 Provider 在创建后不可变；这里只允许修改后续签发使用的管理配置。
 * certificateProfileIds 表示将活动 Internal CA Profile 关联到当前 CA，未提供时保持原有关联不变。
 */
export interface UpdateCertificateAuthorityInput {
  name?: string;
  trustDomainId?: string;
  securityDomain?: string;
  /** 当前 CA 唯一使用的 Internal CA Profile；传 null 表示清除选择。 */
  certificateProfileId?: string | null;
  /** 兼容旧版多 Profile 请求，新调用方应使用 certificateProfileId。 */
  certificateProfileIds?: string[];
  /** 外部 CA 的运行时管理配置，例如 AD CS 模板标识；仅合并更新，不覆盖既有配置。 */
  configuration?: Record<string, unknown>;
}

export interface CreateProfileInput {
  name: string;
  securityDomain: string;
  trustDomainId?: string;
  purpose?: CertificateProfilePurpose;
  providerType?: CertificateProfileProviderType;
  providerId?: string;
  certificateAuthorityId?: string;
  acmeProviderProfileId?: string;
  dnsProviderId?: string;
  credentialRef?: string;
  domainPatterns?: string[];
  targetCapabilities?: string[];
  isDefault?: boolean;
  priority?: number;
  rules?: Partial<CertificateProfileRules>;
  actorId: string;
}

export interface CreateCertificateRequestInput {
  /** 全局历史 ACME 申请可为空；专属申请必须绑定真实应用资产。 */
  applicationAssetId?: string;
  certificateAssetId?: string;
  applicationCertificatePolicyVersionId?: string;
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
  /** 仅由应用证书供应编排传入；重新申请/自动续期不创建人工审批单。 */
  skipApproval?: boolean;
  actorId: string;
}

/** 签发完成后生命周期编排返回的脱敏部署结果。 */
export interface IssuedCertificateLifecycleResult {
  deploymentPlanId?: string;
  deploymentPlanStatus?: string;
  deploymentPlanCertificateVersionId?: string;
  deploymentWarnings?: string[];
}

export class InternalCaApplicationService {
  private readonly repository: InternalCaRepository;
  private readonly providers: CaProviderRegistry;
  private readonly openssl: OpenSslCa;
  private readonly operationsQuery: CaOperationsQueryService;
  private readonly operationsRepository: CaOperationsRepository;
  private readonly certificatePolicies: CertificatePolicyService;
  private adcsProviderReconciler?: (tenantId: string) => Promise<void>;
  private caOperationsRealtimePublisher?: CaOperationsRealtimePublisher;
  private adcsAgentResolver?: (tenantId: string, agentId: string) => Promise<{
    id: string;
    agentKey: string;
    role?: string;
    status?: string;
    descriptor: { osType: string; hostname: string; caName?: string; caConfig?: string };
  }>;
  private adcsAgentRuntimeResolver?: (tenantId: string, agentId: string) => Promise<{
    id: string;
    agentKey: string;
    version: string;
    versionSource: 'heartbeat' | 'registration';
    registeredVersion?: string;
    status: 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
    heartbeatAt?: string;
    managementEndpoint?: string;
    observation?: {
      lastRunAt?: string;
      completedAt?: string;
      status?: string;
      forced?: boolean;
      parserVersion?: string;
      scannedRecords?: number;
      submittedRecords?: number;
      sentRecords?: number;
      acceptedRecords?: number;
      failedBatches?: number;
      insertedRecords?: number;
      updatedRecords?: number;
      duplicateRecords?: number;
      rejectedRecords?: number;
      pendingBatches?: number;
      statusCounts?: Record<string, number>;
      warnings?: string[];
    };
  }>;
  private adcsObservationRefresher?: (tenantId: string, agentId: string, force?: boolean) => Promise<Record<string, unknown>>;
  private readonly adcsProviderEnsurePromises = new Map<string, Promise<void>>();
  private certificateIssueTasks?: TaskEnqueuer;
  private localAgentIssuedHandler?: (input: { tenantId: string; request: CertificateRequestEntity; actorId: string; context?: RequestContext }) => Promise<void>;
  private managedSecretIssuedHandler?: (input: { tenantId: string; request: CertificateRequestEntity; actorId: string; context?: RequestContext }) => Promise<IssuedCertificateLifecycleResult | void>;

  constructor(private readonly dependencies: {
    db: DatabasePort;
    secrets: SecretService;
    certificates: CertificatesApplicationService;
    audit?: AuditService;
    approvals?: ApprovalService;
    repository?: InternalCaRepository;
    providers?: CaProviderRegistry;
    openssl?: OpenSslCa;
  }) {
    this.repository = dependencies.repository ?? new InternalCaRepository(dependencies.db);
    this.providers = dependencies.providers ?? createDefaultCaProviderRegistry(dependencies.secrets);
    this.openssl = dependencies.openssl ?? new OpenSslCa();
    this.operationsRepository = new CaOperationsRepository(dependencies.db);
    this.operationsQuery = new CaOperationsQueryService(dependencies.db, undefined, this.repository);
    this.certificatePolicies = new CertificatePolicyService(this.repository);
  }

  getRepository(): InternalCaRepository {
    return this.repository;
  }

  /** 注入本机持钥证书签发后的安装任务编排，避免 CA 与 Agent 模块形成构造循环。 */
  setLocalAgentIssuedHandler(handler?: InternalCaApplicationService['localAgentIssuedHandler']): void {
    this.localAgentIssuedHandler = handler;
  }

  /** 注入托管密钥签发后的部署计划编排；失败不回滚 CA 已签发事实。 */
  setManagedSecretIssuedHandler(handler?: InternalCaApplicationService['managedSecretIssuedHandler']): void {
    this.managedSecretIssuedHandler = handler;
  }

  /** 应用级本机 CSR 回执后统一排队签发任务，避免回执入口同步调用 CA。 */
  setCertificateIssueTaskEnqueuer(tasks?: TaskEnqueuer): void {
    this.certificateIssueTasks = tasks;
  }

  /** 在完整 Runner 资源装配后注入外部 CA 动作执行器。 */
  setPluginActionDispatcher(dispatcher: import('../providers/ca-provider.js').CaPluginActionDispatcher): void {
    this.providers.register('plugin', new PluginCaProviderAdapter(dispatcher));
  }

  setAdcsProviderReconciler(reconciler?: (tenantId: string) => Promise<void>): void {
    this.adcsProviderReconciler = reconciler;
  }

  /** 注入 Agent 身份解析器，主动观测入口只接受已注册的 Windows AD CS Agent。 */
  setAdcsAgentResolver(resolver?: InternalCaApplicationService['adcsAgentResolver']): void {
    this.adcsAgentResolver = resolver;
  }

  setAdcsAgentRuntimeResolver(resolver?: InternalCaApplicationService['adcsAgentRuntimeResolver']): void {
    this.adcsAgentRuntimeResolver = resolver;
  }

  setAdcsObservationRefresher(refresher?: InternalCaApplicationService['adcsObservationRefresher']): void {
    this.adcsObservationRefresher = refresher;
  }

  /** 注入 CA 运营实时事件发布器；事件只做数据失效通知，不携带敏感记录内容。 */
  setCaOperationsRealtimePublisher(publisher?: CaOperationsRealtimePublisher): void {
    this.caOperationsRealtimePublisher = publisher;
  }

  /**
   * 接收 Agent 主动上报的 CA 记录。
   *
   * 这里不创建后台同步任务，也不调用插件。Agent 已在本机完成采集和去重，
   * 控制面只负责校验身份、解析 Authority 并以现有唯一键幂等写入观测表。
   */
  async ingestAdcsObservations(
    tenantId: string,
    input: AgentCaObservationBatchDto,
  ): Promise<AgentCaObservationIngestResult> {
    const agent = await this.adcsAgentResolver?.(tenantId, input.agentId);
    if (!agent) {
      throw new AppError('CA_OBSERVATION_SOURCE_UNAVAILABLE', '主动上报的 Agent 不存在或未完成注册', {
        reason: 'AGENT_NOT_REGISTERED', agentId: input.agentId,
      });
    }
    if (agent.role !== 'adcs_agent' || agent.descriptor.osType.toLowerCase() !== 'windows_adcs') {
      throw new AppError('CA_OBSERVATION_SOURCE_UNAVAILABLE', '主动上报来源不是 Windows AD CS Agent', {
        reason: 'AGENT_PLATFORM_MISMATCH', agentId: input.agentId,
      });
    }
    if (agent.status === 'DISABLED' || agent.status === 'REVOKED') {
      throw new AppError('AUTH_FORBIDDEN', 'Windows AD CS Agent 已被禁用或撤销', {
        reason: 'AGENT_DISABLED', agentId: input.agentId,
      });
    }
    const authority = await this.resolveAdcsObservationAuthority(tenantId, agent, input);
    const provider = await this.repository.getProvider(tenantId, authority.providerId);
    if (!provider || provider.type !== 'plugin') {
      throw new AppError('CA_OBSERVATION_SOURCE_UNAVAILABLE', '主动上报的 CA Provider 不可用', {
        reason: 'PROVIDER_NOT_FOUND', caId: authority.id, providerId: authority.providerId,
      });
    }
    const observedAt = normalizeObservationTime(input.observedAt);
    let accepted = 0;
    let inserted = 0;
    let updated = 0;
    let duplicates = 0;
    let rejected = 0;
    const changedObjectTypes = new Set<string>();
    const rejections: Array<{ index: number; reason: string }> = [];
    for (const [index, record] of input.records.entries()) {
      try {
        const normalized = normalizeAgentObservation(record);
        if (!normalized) {
          rejected += 1;
          rejections.push({ index, reason: 'INVALID_RECORD' });
          continue;
        }
        const existing = await this.operationsRepository.getExternalObservation(
          tenantId, provider.id, authority.id, normalized.objectType, normalized.externalObjectId,
        );
        const entity: ExternalCaObservationEntity = {
          id: existing?.id ?? newId('caobs'),
          tenantId,
          providerId: provider.id,
          caId: authority.id,
          ...normalized,
          observedAt,
          firstObservedAt: existing?.firstObservedAt ?? observedAt,
          createdAt: existing?.createdAt ?? observedAt,
          updatedAt: observedAt,
        };
        const stored = await this.operationsRepository.upsertExternalObservation(entity);
        const observationApplied = !existing || stored.observedAt === entity.observedAt;
        accepted += 1;
        if (existing) {
          if (sameExternalObservation(existing, stored)) duplicates += 1;
          else if (stored.observedAt === entity.observedAt) {
            updated += 1;
            changedObjectTypes.add(normalized.objectType);
          }
          else duplicates += 1;
        } else {
          inserted += 1;
          changedObjectTypes.add(normalized.objectType);
        }
        if (observationApplied && ['request', 'issuance', 'revocation'].includes(normalized.objectType)) {
          const staleObjectTypes = normalized.normalizedStatus === 'issued'
            ? ['revocation'] as const
            : normalized.normalizedStatus === 'revoked'
              ? ['issuance'] as const
              : ['issuance', 'revocation'] as const;
          const removed = await this.operationsRepository.deleteExternalObservations(
            tenantId,
            provider.id,
            authority.id,
            normalized.externalObjectId,
            entity.observedAt,
            [...staleObjectTypes],
          );
          if (removed > 0) {
            for (const objectType of staleObjectTypes) changedObjectTypes.add(objectType);
          }
        }
      } catch (error) {
        rejected += 1;
        rejections.push({ index, reason: error instanceof Error ? error.message.slice(0, 256) : 'RECORD_PERSIST_FAILED' });
      }
    }
    if (changedObjectTypes.size > 0) {
      this.caOperationsRealtimePublisher?.publishChanged({
        tenantId,
        providerId: provider.id,
        caId: authority.id,
        objectTypes: [...changedObjectTypes],
      });
    }
    structuredLogger.info('AD CS Agent 观测批次已接收', {
      agentId: agent.id,
      caId: authority.id,
      providerId: provider.id,
      sequence: input.sequence,
      submittedRecords: input.records.length,
      accepted,
      inserted,
      updated,
      duplicates,
      rejected,
      rejections,
      sourceCaName: input.caName,
      sourceCaConfig: input.caConfig,
      changedObjectTypes: [...changedObjectTypes],
    }, {
      module: 'internal-ca',
      resourceType: 'agent',
      resourceId: agent.id,
      tenantId,
    });
    return {
      accepted, inserted, updated, duplicates, rejected,
      ...(rejections.length ? { rejections } : {}),
      agentId: agent.id, caId: authority.id, providerId: provider.id, observedAt,
    };
  }

  private async resolveAdcsObservationAuthority(
    tenantId: string,
    agent: NonNullable<Awaited<ReturnType<NonNullable<InternalCaApplicationService['adcsAgentResolver']>>>>,
    input: AgentCaObservationBatchDto,
  ): Promise<CertificateAuthorityEntity> {
    const authorities = (await this.repository.listAuthorities(tenantId)).filter((item) => item.status !== 'retired');
    const providers = await this.repository.listProviders(tenantId);
    const providerById = new Map(providers.map((provider) => [provider.id, provider]));
    const agentCandidates = authorities.filter((authority) => {
      if (authority.topologyMode !== 'external_managed') return false;
      const provider = providerById.get(authority.providerId);
      if (!isMicrosoftAdcsProvider(provider)) return false;
      const authorityConfig = authority.configuration ?? {};
      const providerConfig = provider?.configuration ?? {};
      return authorityConfig.agentId === agent.id
        || providerConfig.agentId === agent.id
        || authorityConfig.agentKey === agent.agentKey
        || providerConfig.agentKey === agent.agentKey;
    });
    const name = (input.caName ?? agent.descriptor.caName ?? '').trim().toLowerCase();
    const caConfig = (input.caConfig ?? agent.descriptor.caConfig ?? '').trim().toLowerCase();
    const providerByAuthority = new Map(providers.map((provider) => [provider.id, provider]));
    const named = (name || caConfig)
      ? authorities.filter((authority) => isMicrosoftAdcsProvider(providerByAuthority.get(authority.providerId))
        && ((name && authority.name.trim().toLowerCase() === name)
        || (caConfig && (
          String(authority.configuration?.caConfig ?? '').trim().toLowerCase() === caConfig
          || String(providerByAuthority.get(authority.providerId)?.configuration?.caConfig ?? '').trim().toLowerCase() === caConfig
        ))))
      : [];
    let candidates = agentCandidates.length ? agentCandidates : named;
    // Agent 可能曾经被绑定到多个历史 Authority。先用本次上报的 CA 身份缩小范围，
    // 避免同一 Agent 下存在多个不同 CA 时把记录写入错误的 Authority。
    if (agentCandidates.length && (name || caConfig)) {
      const narrowed = agentCandidates.filter((authority) => {
        const authorityName = authority.name.trim().toLowerCase();
        const authorityConfigValue = String(authority.configuration?.caConfig ?? '').trim().toLowerCase();
        const providerConfigValue = String(providerByAuthority.get(authority.providerId)?.configuration?.caConfig ?? '').trim().toLowerCase();
        return (name && authorityName === name)
          || (caConfig && (authorityConfigValue === caConfig || providerConfigValue === caConfig));
      });
      if (narrowed.length) candidates = narrowed;
    }
    if (candidates.length === 1) return candidates[0]!;
    if (candidates.length > 1) {
      // 同名/同 caConfig 的重复登记代表同一个外部 CA。按已有事实数量选主记录，
      // 没有历史事实时再按最近更新时间选择新登记，保证删除后重建无需人工迁移。
      if (allSameAdcsAuthorityIdentity(candidates, providerByAuthority)) {
        const counts = await Promise.all(candidates.map(async (candidate) => ({
          candidate,
          count: await this.operationsRepository.countExternalObservations(tenantId, candidate.id),
        })));
        counts.sort((left, right) => right.count - left.count
          || (right.candidate.status === 'active' ? 1 : 0) - (left.candidate.status === 'active' ? 1 : 0)
          || right.candidate.updatedAt.localeCompare(left.candidate.updatedAt)
          || left.candidate.id.localeCompare(right.candidate.id));
        return counts[0]!.candidate;
      }
      throw new AppError('CA_OBSERVATION_SOURCE_UNAVAILABLE', '主动上报匹配到多个同名 CA，请保留唯一的 Agent 关联', {
        reason: 'CA_AUTHORITY_AMBIGUOUS', agentId: agent.id, caName: input.caName,
        caIds: candidates.map((item) => item.id),
      });
    }
    throw new AppError('CA_OBSERVATION_SOURCE_UNAVAILABLE', '主动上报的 CA 尚未关联到 Authority', {
      reason: 'CA_AUTHORITY_NOT_FOUND', agentId: agent.id, caName: input.caName,
    });
  }

  listCaOperationsRecords(tenantId: string, query: CaOperationsRecordQueryDto): Promise<CaOperationRecordPageDto> {
    return this.reconcileAndListCaOperationsRecords(tenantId, query);
  }

  async listCaOperationsTree(
    tenantId: string,
    canRead: (authority: CertificateAuthorityEntity) => Promise<boolean>,
  ): Promise<CaOperationsTreeDto> {
    await this.adcsProviderReconciler?.(tenantId);
    const tree = await this.operationsQuery.tree(tenantId, canRead);
    return this.enrichOperationsTreeWithAgentRuntime(tenantId, tree);
  }

  async getCaOperationsRecord(tenantId: string, recordKey: string): Promise<CaOperationRecordDetailDto> {
    await this.adcsProviderReconciler?.(tenantId);
    return this.operationsQuery.record(tenantId, recordKey);
  }

  private async reconcileAndListCaOperationsRecords(tenantId: string, query: CaOperationsRecordQueryDto): Promise<CaOperationRecordPageDto> {
    await this.adcsProviderReconciler?.(tenantId);
    return this.operationsQuery.records(tenantId, query);
  }

  async listProviders(tenantId: string): Promise<Array<Omit<CaProviderEntity, 'credentialSecretRef'>>> {
    await this.adcsProviderReconciler?.(tenantId);
    const providers = await this.repository.listProviders(tenantId);
    return Promise.all(providers.map(async (provider) => {
      const runtime = await this.adcsProviderRuntime(tenantId, provider);
      return sanitizeProvider({
        ...provider,
        capabilityRecords: await this.listCapabilityRecords(tenantId, 'provider', provider.id),
        ...(runtime ? { runtime } : {}),
      });
    }));
  }

  async refreshAdcsObservations(tenantId: string, caId: string, force = false): Promise<Record<string, unknown>> {
    const authority = await this.repository.getAuthority(tenantId, caId);
    if (!authority) throw new AppError('RESOURCE_NOT_FOUND', '证书机构不存在', { caId });
    const provider = await this.repository.getProvider(tenantId, authority.providerId);
    if (!provider || !isMicrosoftAdcsProvider(provider)) {
      throw new AppError('CA_OBSERVATION_SOURCE_UNAVAILABLE', '当前 CA 不是可主动扫描的 Windows AD CS CA', {
        caId,
        providerId: authority.providerId,
      });
    }
    const agentId = textValue(provider.configuration.agentId) ?? textValue(authority.configuration?.agentId);
    if (!agentId) {
      throw new AppError('CA_OBSERVATION_SOURCE_UNAVAILABLE', '当前 CA 尚未关联 AD CS Agent', {
        caId,
        providerId: provider.id,
        reason: 'AGENT_ASSOCIATION_MISSING',
      });
    }
    if (!this.adcsObservationRefresher) {
      throw new AppError('CA_OBSERVATION_SOURCE_UNAVAILABLE', 'AD CS Agent 刷新入口未配置', {
        caId,
        agentId,
        reason: 'AGENT_REFRESH_UNAVAILABLE',
      });
    }
    return {
      ...(await this.adcsObservationRefresher(tenantId, agentId, force)),
      caId,
      providerId: provider.id,
      agentId,
    };
  }

  private async enrichOperationsTreeWithAgentRuntime(tenantId: string, tree: CaOperationsTreeDto): Promise<CaOperationsTreeDto> {
    const [providers, authorities] = await Promise.all([
      this.repository.listProviders(tenantId),
      this.repository.listAuthorities(tenantId),
    ]);
    const providerById = new Map(providers.map((provider) => [provider.id, provider]));
    const authorityById = new Map(authorities.map((authority) => [authority.id, authority]));
    const enrich = async (authority: CaOperationsTreeAuthorityDto): Promise<CaOperationsTreeAuthorityDto> => {
      const provider = providerById.get(authority.providerId);
      if (!provider || !isMicrosoftAdcsProvider(provider)) return authority;
      const runtime = await this.adcsProviderRuntime(tenantId, provider, authority.id, textValue(authorityById.get(authority.id)?.configuration?.agentId));
      return runtime ? { ...authority, agent: runtime } : authority;
    };
    const trustDomains = await Promise.all(tree.trustDomains.map(async (domain) => ({
      ...domain,
      authorities: await Promise.all(domain.authorities.map(enrich)),
    })));
    return {
      trustDomains,
      unassignedAuthorities: await Promise.all(tree.unassignedAuthorities.map(enrich)),
    };
  }

  private async adcsProviderRuntime(tenantId: string, provider: CaProviderEntity, caId?: string, agentIdOverride?: string): Promise<CaAgentRuntimeProjection | undefined> {
    if (!isMicrosoftAdcsProvider(provider) || !this.adcsAgentRuntimeResolver) return undefined;
    const agentId = agentIdOverride ?? textValue(provider.configuration.agentId);
    if (!agentId) return undefined;
    const [agent, observation] = await Promise.all([
      this.adcsAgentRuntimeResolver(tenantId, agentId).catch(() => undefined),
      this.operationsRepository.getExternalObservationSummary(tenantId, provider.id, caId),
    ]);
    if (!agent) return undefined;
    const health = agent.observation;
    return {
      agentId: agent.id,
      agentKey: agent.agentKey,
      version: agent.version,
      versionSource: agent.versionSource,
      ...(agent.registeredVersion ? { registeredVersion: agent.registeredVersion } : {}),
      status: agent.status,
      ...(agent.heartbeatAt ? { heartbeatAt: agent.heartbeatAt } : {}),
      ...(agent.managementEndpoint ? { managementEndpoint: agent.managementEndpoint } : {}),
      ...(observation.lastObservedAt ? { lastObservationAt: observation.lastObservedAt } : {}),
      ...(health?.lastRunAt ? { lastObservationAt: health.lastRunAt } : {}),
      ...(health?.completedAt && !health?.lastRunAt ? { lastObservationAt: health.completedAt } : {}),
      ...(health?.status ? { observationStatus: health.status } : {}),
      ...(health?.parserVersion ? { parserVersion: health.parserVersion } : {}),
      ...(health?.forced !== undefined ? { forced: health.forced } : {}),
      ...(health?.scannedRecords !== undefined ? { scannedRecords: health.scannedRecords } : {}),
      ...(health?.submittedRecords !== undefined ? { submittedRecords: health.submittedRecords } : {}),
      ...(health?.sentRecords !== undefined ? { sentRecords: health.sentRecords } : {}),
      ...(health?.acceptedRecords !== undefined ? { acceptedRecords: health.acceptedRecords } : {}),
      ...(health?.failedBatches !== undefined ? { failedBatches: health.failedBatches } : {}),
      ...(health?.insertedRecords !== undefined ? { insertedRecords: health.insertedRecords } : {}),
      ...(health?.updatedRecords !== undefined ? { updatedRecords: health.updatedRecords } : {}),
      ...(health?.duplicateRecords !== undefined ? { duplicateRecords: health.duplicateRecords } : {}),
      ...(health?.rejectedRecords !== undefined ? { rejectedRecords: health.rejectedRecords } : {}),
      ...(health?.pendingBatches !== undefined ? { pendingBatches: health.pendingBatches } : {}),
      ...(health?.statusCounts ? { statusCounts: health.statusCounts } : {}),
      ...(health?.warnings?.length ? { warnings: health.warnings.slice(0, 8) } : {}),
      storedRecords: observation.storedRecords,
    };
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
      source: 'initialization',
      changedFields: providerCreatedFields(provider),
      before: null,
      after: providerAuditSnapshot(provider),
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
    const updated: CaProviderEntity = {
      ...current,
      name: requiredText(input.displayName ?? input.name ?? current.name ?? profile?.displayName ?? '自定义 ACME CA', 'displayName'),
      endpoint: configuration.directoryUrl,
      configuration: { ...configuration },
      updatedAt: new Date().toISOString(),
    };
    const changedFields = providerChangedFields(current, updated);
    if (changedFields.length === 0) return sanitizeProvider(current);
    await this.repository.saveProvider(updated);
    if (configuration.isDefault === true) await this.setDefaultAcmeProvider(tenantId, providerId);
    await this.audit('internal_ca.acme_provider.updated', actorId, 'ca_provider.update', 'ca_provider', providerId, 'high', context, {
      preset: configuration.preset,
      isDefault: configuration.isDefault,
      source: 'manual',
      changedFields,
      before: providerAuditSnapshot(current),
      after: providerAuditSnapshot(updated),
    });
    return sanitizeProvider(updated);
  }

  /**
   * 探测尚未保存的 ACME Directory。只构造内存 Provider，不写入租户配置和验证记录。
   */
  async probeAcmeDirectory(
    tenantId: string,
    input: AcmeProviderConfigurationInput,
  ): Promise<CaProviderValidationResult> {
    const configuration = normalizeAcmeProviderConfiguration(input);
    const adapter = this.providers.get('acme');
    const now = new Date().toISOString();
    return adapter.validateConnection({
      id: newId('acmeprobe'),
      tenantId,
      name: 'ACME Directory probe',
      type: 'acme',
      deploymentMode: 'external',
      runtimePlatform: 'external',
      availabilityMode: 'single',
      endpoint: configuration.directoryUrl,
      capabilities: adapter.getCapabilities(),
      status: 'active',
      configuration: { ...configuration },
      createdAt: now,
      updatedAt: now,
    });
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
    options: ProviderCreateOptions = {},
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
    await this.repository.saveProvider(provider);
    await this.saveDeclaredCapabilities(provider);
    const auditDetail = {
      type: provider.type,
      deploymentMode: provider.deploymentMode,
      runtimePlatform: provider.runtimePlatform,
      source: options.source === 'reconciliation' ? 'reconciliation' : 'manual',
      changedFields: providerCreatedFields(provider),
      before: null,
      after: providerAuditSnapshot(provider),
    };
    if (options.source === 'reconciliation') {
      structuredLogger.info('AD CS Provider reconciliation created provider outside long-term audit', {
        providerId: provider.id,
        changedFields: auditDetail.changedFields,
      }, { module: 'internal-ca', tenantId, resourceType: 'ca_provider', resourceId: provider.id });
    } else {
      await this.audit('internal_ca.provider.created', actorId, 'ca_provider.create', 'ca_provider', provider.id, 'high', context, auditDetail);
    }
    return sanitizeProvider(provider);
  }

  async updateProvider(
    tenantId: string,
    providerId: string,
    input: UpdateCaProviderInput,
    actorId: string,
    context?: RequestContext,
    options: ProviderUpdateOptions = {},
  ): Promise<Omit<CaProviderEntity, 'credentialSecretRef'>> {
    const current = await this.requireProvider(tenantId, providerId);
    const updated: CaProviderEntity = {
      ...current,
      name: input.name === undefined ? current.name : requiredText(input.name, 'name'),
      deploymentMode: input.deploymentMode ?? current.deploymentMode,
      runtimePlatform: input.runtimePlatform ?? current.runtimePlatform,
      availabilityMode: input.availabilityMode ?? current.availabilityMode,
      endpoint: input.endpoint === undefined ? current.endpoint : optionalText(input.endpoint),
      credentialSecretRef: input.credentialSecretRef === undefined ? current.credentialSecretRef : optionalText(input.credentialSecretRef),
      configuration: input.configuration === undefined
        ? current.configuration
        : { ...current.configuration, ...structuredClone(input.configuration) },
      status: input.status ?? current.status,
      updatedAt: new Date().toISOString(),
    };
    assertProviderCombination(updated);
    const changedFields = providerChangedFields(current, updated);
    if (changedFields.length === 0) {
      if (options.source === 'reconciliation') {
        structuredLogger.info('AD CS Provider reconciliation skipped unchanged update', {
          providerId,
          actorId,
        }, { module: 'internal-ca', tenantId, resourceType: 'ca_provider', resourceId: providerId });
      }
      return sanitizeProvider(current);
    }
    await this.repository.saveProvider(updated);
    const isReconciliation = options.source === 'reconciliation';
    const requiresLongTermAudit = !isReconciliation
      || changedFields.some((field) => field === 'status'
        || field === 'endpoint'
        || field === 'credentialSecretRef'
        || field.endsWith('pluginVersionId'));
    const auditDetail = {
      type: updated.type,
      deploymentMode: updated.deploymentMode,
      runtimePlatform: updated.runtimePlatform,
      source: isReconciliation ? 'reconciliation' : 'manual',
      changedFields,
      before: providerAuditSnapshot(current),
      after: providerAuditSnapshot(updated),
    };
    if (requiresLongTermAudit) {
      await this.audit('internal_ca.provider.updated', actorId, 'ca_provider.update', 'ca_provider', providerId, 'high', context, auditDetail);
    } else {
      structuredLogger.info('AD CS Provider reconciliation applied non-audit metadata update', {
        providerId,
        changedFields,
      }, { module: 'internal-ca', tenantId, resourceType: 'ca_provider', resourceId: providerId });
    }
    return sanitizeProvider(updated);
  }

  async deleteProvider(tenantId: string, providerId: string, actorId: string, context?: RequestContext): Promise<{ id: string; deleted: true }> {
    const provider = await this.requireProvider(tenantId, providerId);
    // AD CS Provider 通常已经关联一个外部 CA。保留历史证书和审计记录，采用停用登记而不是物理删除。
    // 这样删除 Agent 不会破坏证书请求、吊销记录和 CA 外键，同时从可用资源列表中移除实例。
    if (isMicrosoftAdcsProvider(provider)) {
      const now = new Date().toISOString();
      await this.repository.saveProvider({
        ...provider,
        status: 'disabled',
        configuration: { ...provider.configuration, registrationStatus: 'deleted', deletedAt: now },
        updatedAt: now,
      });
      for (const authority of await this.repository.listAuthorities(tenantId)) {
        if (authority.providerId !== provider.id || authority.status === 'retired') continue;
        await this.repository.saveAuthority({ ...authority, status: 'retired', updatedAt: now });
      }
      const after = {
        ...provider,
        status: 'disabled' as const,
        configuration: { ...provider.configuration, registrationStatus: 'deleted', deletedAt: now },
        updatedAt: now,
      };
      await this.audit('internal_ca.provider.deleted', actorId, 'ca_provider.delete', 'ca_provider', provider.id, 'high', context, {
        type: provider.type,
        registrationStatus: 'deleted',
        softDeleted: true,
        changedFields: providerChangedFields(provider, after),
        before: providerAuditSnapshot(provider),
        after: providerAuditSnapshot(after),
      });
      return { id: provider.id, deleted: true };
    }
    const deleted = await this.repository.deleteUnboundProvider(tenantId, provider.id);
    if (!deleted) throw new AppError('RESOURCE_VERSION_CONFLICT', 'CA Provider 已被证书机构使用，不能删除');
    await this.audit('internal_ca.provider.deleted', actorId, 'ca_provider.delete', 'ca_provider', provider.id, 'high', context, {
      changedFields: ['deleted'],
      before: providerAuditSnapshot(provider),
      after: null,
    });
    return { id: provider.id, deleted: true };
  }

  async testProvider(tenantId: string, providerId: string): Promise<CaProviderValidationResult> {
    const provider = await this.requireProvider(tenantId, providerId);
    if (provider.type === 'plugin') {
      const binding = await this.requireProviderActionBinding(tenantId, provider.id);
      return {
        reachable: binding.status !== 'disabled',
        capabilities: provider.capabilities,
        detail: binding.status === 'revalidation_required'
          ? '固定外部 CA 动作仍可使用，但 Schema 或能力证据需要复验。'
          : '固定外部 CA 动作已配置；实际连通性由动作执行回执确认。',
      };
    }
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
              externalAccountRequired: result.directory?.externalAccountRequired,
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

  async createProviderActionBinding(
    tenantId: string,
    input: CreateProviderActionBindingInput,
    actorId: string,
    context?: RequestContext,
  ): Promise<ProviderActionBindingEntity> {
    const provider = await this.requireProvider(tenantId, input.providerId);
    if (provider.type !== 'plugin') throw new AppError('CA_TOPOLOGY_INVALID', '只有 plugin 类型 CA Provider 可以绑定外部动作', { providerId: provider.id });
    const now = new Date().toISOString();
    const binding: ProviderActionBindingEntity = {
      id: newId('capabind'), tenantId, providerId: provider.id,
      pluginVersionId: requiredText(input.pluginVersionId, 'pluginVersionId'),
      executionLocation: input.executionLocation,
      issueAction: normalizeProviderAction(input.issueAction, 'issueAction'),
      queryAction: input.queryAction ? normalizeProviderAction(input.queryAction, 'queryAction') : undefined,
      revokeAction: input.revokeAction ? normalizeProviderAction(input.revokeAction, 'revokeAction') : undefined,
      revocationEvidenceAction: input.revocationEvidenceAction ? normalizeProviderAction(input.revocationEvidenceAction, 'revocationEvidenceAction') : undefined,
      approvalMode: input.approvalMode ?? 'none',
      capabilityEvidence: structuredClone(input.capabilityEvidence ?? {}),
      status: input.status ?? 'active',
      createdBy: actorId, createdAt: now, updatedAt: now,
    };
    await this.repository.saveProviderActionBinding(binding);
    await this.audit('internal_ca.provider_action_binding.created', actorId, 'ca_provider.manage', 'ca_provider_action_binding', binding.id, 'high', context, {
      providerId: provider.id, pluginVersionId: binding.pluginVersionId, executionLocation: binding.executionLocation, status: binding.status,
    });
    return binding;
  }

  async ensureAdcsProviderForAgent(input: { tenantId: string; agentId: string; agentKey: string; name: string; caConfig?: string; pluginVersionId: string }): Promise<void> {
    const normalizedName = requiredText(input.name, 'name').toLowerCase();
    // 同一租户内不同历史 Agent 可能上报不同名称（主机名/真实 CA 名称）。
    // 按名称加锁会让它们同时改写同一个 Provider，最终撞上名称唯一索引；
    // Provider 补偿是低频控制面操作，按租户串行最简单也最可靠。
    const lockKey = input.tenantId;
    const previous = this.adcsProviderEnsurePromises.get(lockKey);
    const current = (previous ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => this.ensureAdcsProviderForAgentInternal({ ...input, name: input.name.trim(), caConfig: textValue(input.caConfig), pluginVersionId: requiredText(input.pluginVersionId, 'pluginVersionId') }));
    this.adcsProviderEnsurePromises.set(lockKey, current);
    try {
      await current;
    } finally {
      if (this.adcsProviderEnsurePromises.get(lockKey) === current) {
        this.adcsProviderEnsurePromises.delete(lockKey);
      }
    }
  }

  private async ensureAdcsProviderForAgentInternal(input: { tenantId: string; agentId: string; agentKey: string; name: string; caConfig?: string; pluginVersionId: string }): Promise<void> {
    const providers = await this.repository.listProviders(input.tenantId);
    const normalizedName = input.name.trim().toLowerCase();
    // Agent 重装后 agentId 会变化，但 agentKey、CA 名称或旧版 Profile 仍然代表同一外部登记。
    // 旧 Provider 即使缺少 providerKind，也必须被自动接管，不能再次触发同名唯一约束。
    const isCandidate = (provider: CaProviderEntity) => isAdcsProviderCandidate(provider, input, normalizedName);
    const authorityProviderIds = new Set(
      (await this.repository.listAuthorities(input.tenantId))
        .filter((authority) => authority.topologyMode === 'external_managed'
          && authority.name.trim().toLowerCase() === normalizedName)
        .map((authority) => authority.providerId),
    );
    // 先按租户内唯一名称定位，再按 Agent 身份回退。
    // 不能把任意一个 AD CS Provider 当作候选，否则多个历史 Provider
    // 存在时会把旧记录改名为当前名称并撞上唯一索引。
    // 租户内 Provider 名称本身就是唯一键。旧版本可能没有任何 AD CS 标记，
    // 但只要是 plugin 且名称与 Agent 上报的 CA 名称一致，就必须复用该行。
    // 否则补偿会再次 INSERT 同名 Provider，直接触发 uq_pg_ca_providers_tenant_name。
    let existing = providers.find((provider) => provider.type === 'plugin' && provider.name.trim().toLowerCase() === normalizedName)
      ?? providers.find((provider) => isCandidate(provider) && provider.name.trim().toLowerCase() === normalizedName)
      // 早期 AD CS Agent 以主机名创建 Provider，但 Authority 已保存真实 CA 名称。
      // 优先沿 Authority 反查旧 Provider，避免重装后把同一个 CA 拆成两条记录。
      ?? providers.find((provider) => provider.type === 'plugin' && authorityProviderIds.has(provider.id))
      ?? providers.find((provider) => isCandidate(provider) && textValue(provider.configuration.agentKey) === input.agentKey)
      ?? providers.find((provider) => isCandidate(provider) && textValue(provider.configuration.agentId) === input.agentId);
    if (!existing) {
      const candidates = providers.filter(isCandidate);
      // 只有租户内唯一的 AD CS Provider 才允许在名称变化时回退复用；
      // 多条历史记录必须保留，不能猜测它们对应哪一个外部 CA。
      if (candidates.length === 1 && !providers.some((provider) => provider.name.trim().toLowerCase() === normalizedName)) {
        existing = candidates[0];
      }
    }
    const configuration = {
      ...(existing?.configuration ?? {}),
      providerKind: 'microsoft_adcs',
      profile: 'windows.agent_plan.adcs',
      agentId: input.agentId,
      agentKey: input.agentKey,
      ...(input.caConfig ? { caConfig: input.caConfig } : {}),
      registrationStatus: 'linked',
      pluginVersionId: input.pluginVersionId,
    };
    let provider: Omit<CaProviderEntity, 'credentialSecretRef'>;
    if (existing) {
      // 只有当真实 CA 名称尚未占用且该旧记录能由 Authority/唯一候选证明时才迁移名称。
      // 多条历史 Provider 场景保留原名称，避免在并发补偿期间猜错对象或撞唯一索引。
      const nameTaken = providers.some((candidate) => candidate.id !== existing!.id
        && candidate.name.trim().toLowerCase() === normalizedName);
      const renameLegacyName = !nameTaken && existing.name.trim().toLowerCase() !== normalizedName
        && (authorityProviderIds.has(existing.id) || providers.filter(isCandidate).length === 1);
      provider = await this.updateProvider(input.tenantId, existing.id, {
        name: renameLegacyName ? input.name : existing.name,
        configuration,
        status: 'active',
      }, 'system', undefined, { source: 'reconciliation' });
    } else {
      try {
        provider = await this.createProvider(input.tenantId, {
          name: input.name,
          type: 'plugin',
          deploymentMode: 'external',
          runtimePlatform: 'windows',
          availabilityMode: 'single',
          configuration,
        }, 'system', undefined, { source: 'reconciliation' });
      } catch (error) {
        // 多个 Agent 注册请求并发时，另一个请求可能刚插入同名 Provider。
        // 重新读取并复用它，保持补偿登记幂等。
        if (!isUniqueConstraintError(error)) throw error;
        const refreshedProviders = await this.repository.listProviders(input.tenantId);
        existing = refreshedProviders.find((candidate) => candidate.type === 'plugin' && candidate.name.trim().toLowerCase() === normalizedName)
          ?? refreshedProviders.find((candidate) => isCandidate(candidate) && candidate.name.trim().toLowerCase() === normalizedName)
          ?? refreshedProviders.find((candidate) => isCandidate(candidate) && textValue(candidate.configuration.agentKey) === input.agentKey);
        if (!existing) throw error;
        const targetOwner = refreshedProviders.find((candidate) => candidate.name.trim().toLowerCase() === normalizedName);
        const stableName = targetOwner && targetOwner.id !== existing.id ? existing.name : input.name;
        provider = await this.updateProvider(input.tenantId, existing.id, { name: stableName, configuration, status: 'active' }, 'system', undefined, { source: 'reconciliation' });
      }
    }
    const bindings = await this.listProviderActionBindings(input.tenantId, provider.id);
    const activeBinding = bindings.find((binding) => binding.status !== 'disabled');
    if (activeBinding) {
      // Agent 重装或插件升级后，旧绑定可能仍指向已禁用的 PluginVersion。
      // 绑定是运行时唯一入口，必须在 Agent 补偿登记时切到当前启用版本。
      const capabilityEvidence = {
        ...(activeBinding.capabilityEvidence ?? {}),
        providerKind: 'microsoft_adcs',
        agentId: input.agentId,
        agentKey: input.agentKey,
      };
      if (
        activeBinding.pluginVersionId !== input.pluginVersionId
        || JSON.stringify(activeBinding.capabilityEvidence ?? {}) !== JSON.stringify(capabilityEvidence)
      ) {
        await this.repository.saveProviderActionBinding({
          ...activeBinding,
          pluginVersionId: input.pluginVersionId,
          capabilityEvidence,
          updatedAt: new Date().toISOString(),
        });
        if (activeBinding.pluginVersionId !== input.pluginVersionId) {
          await this.audit('internal_ca.provider_action_binding.updated', 'system', 'ca_provider.manage', 'ca_provider_action_binding', activeBinding.id, 'high', undefined, {
            source: 'reconciliation',
            changedFields: ['pluginVersionId'],
            before: { pluginVersionId: activeBinding.pluginVersionId },
            after: { pluginVersionId: input.pluginVersionId },
          });
        } else {
          structuredLogger.info('AD CS Provider action binding reconciliation updated metadata', {
            providerId: provider.id,
            bindingId: activeBinding.id,
          }, { module: 'internal-ca', tenantId: input.tenantId, resourceType: 'ca_provider_action_binding', resourceId: activeBinding.id });
        }
      }
    } else {
      await this.createProviderActionBinding(input.tenantId, {
        providerId: provider.id,
        pluginVersionId: input.pluginVersionId,
        executionLocation: 'control_plane',
        approvalMode: 'none',
        status: 'active',
        issueAction: { actionId: 'ca.certificate.issue.v1', actionVersion: 'v1' },
        queryAction: { actionId: 'ca.certificate.query.v1', actionVersion: 'v1' },
        revokeAction: { actionId: 'ca.certificate.revoke.v1', actionVersion: 'v1' },
        revocationEvidenceAction: { actionId: 'ca.revocation.evidence.v1', actionVersion: 'v1' },
        capabilityEvidence: { providerKind: 'microsoft_adcs', agentId: input.agentId, agentKey: input.agentKey },
      }, 'system');
    }
    await this.deduplicateAdcsProviderBindings(input.tenantId, provider.id);
    await this.reconcileAdcsAuthorityBindings(input, provider.id);
  }

  /** 多个控制面实例可能同时为同一 Provider 补偿绑定，最终只保留一个活动入口。 */
  private async deduplicateAdcsProviderBindings(tenantId: string, providerId: string): Promise<void> {
    const bindings = (await this.listProviderActionBindings(tenantId, providerId))
      .filter((binding) => binding.status !== 'disabled')
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id));
    for (const binding of bindings.slice(1)) {
      await this.repository.saveProviderActionBinding({
        ...binding,
        status: 'disabled',
        updatedAt: new Date().toISOString(),
      });
      await this.audit('internal_ca.provider_action_binding.disabled', 'system', 'ca_provider.manage', 'ca_provider_action_binding', binding.id, 'high', undefined, {
        source: 'reconciliation',
        changedFields: ['status'],
        before: { status: binding.status },
        after: { status: 'disabled' },
      });
    }
  }

  private async reconcileAdcsAuthorityBindings(
    input: { tenantId: string; agentId: string; agentKey: string; caConfig?: string; pluginVersionId: string },
    providerId: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    for (const authority of await this.repository.listAuthorities(input.tenantId)) {
      if (authority.providerId !== providerId) continue;
      const configuration = {
        ...authority.configuration,
        providerKind: 'microsoft_adcs',
        agentId: input.agentId,
        agentKey: input.agentKey,
        ...(input.caConfig ? { caConfig: input.caConfig } : {}),
        pluginVersionId: input.pluginVersionId,
      };
      if (JSON.stringify(configuration) === JSON.stringify(authority.configuration)) continue;
      await this.repository.saveAuthority({ ...authority, configuration, updatedAt: now });
    }
  }

  listProviderActionBindings(tenantId: string, providerId?: string): Promise<ProviderActionBindingEntity[]> {
    return this.repository.listProviderActionBindings(tenantId, providerId);
  }

  async listCertificatePolicies(tenantId: string): Promise<Array<{ policy: CertificatePolicyEntity; versions: CertificatePolicyVersionEntity[] }>> {
    await this.certificatePolicies.ensureDefault(tenantId);
    return Promise.all((await this.repository.listCertificatePolicies(tenantId)).map(async (policy) => ({
      policy,
      versions: await this.repository.listCertificatePolicyVersions(policy.id),
    })));
  }

  async createCertificatePolicyVersion(
    tenantId: string,
    policyId: string,
    rules: Partial<CertificatePolicyRules>,
    actorId: string,
    context?: RequestContext,
  ): Promise<CertificatePolicyVersionEntity> {
    const version = await this.certificatePolicies.createVersion(tenantId, policyId, normalizeCertificatePolicyRules(rules), actorId);
    await this.audit('internal_ca.certificate_policy.version_created', actorId, 'ca_policy.manage', 'certificate_policy', policyId, 'high', context, { versionNo: version.versionNo });
    return version;
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

  async deleteTrustDomain(tenantId: string, id: string, actorId: string, context?: RequestContext): Promise<{ id: string; deleted: true }> {
    const domain = await this.requireTrustDomain(tenantId, id);
    if (domain.status === 'retired') return { id: domain.id, deleted: true };
    if (domain.isDefault) {
      throw new AppError('CA_TRUST_DOMAIN_STATE_INVALID', '默认 CA 信任域不能直接删除，请先指定其他活动信任域为默认域', { trustDomainId: domain.id });
    }
    const [authorities, profiles] = await Promise.all([
      this.repository.listAuthorities(tenantId),
      this.repository.listProfiles(tenantId),
    ]);
    const authorityIds = authorities
      .filter((authority) => authority.trustDomainId === domain.id && authority.status !== 'retired')
      .map((authority) => authority.id);
    const profileIds = profiles
      .filter((profile) => profile.trustDomainId === domain.id && profile.status === 'active')
      .map((profile) => profile.id);
    if (authorityIds.length > 0 || profileIds.length > 0) {
      throw new AppError('RESOURCE_VERSION_CONFLICT', 'CA 信任域仍被活动的证书机构或证书 Profile 使用，不能删除', {
        trustDomainId: domain.id,
        authorityIds,
        profileIds,
      });
    }
    const now = new Date().toISOString();
    await this.repository.saveTrustDomain({ ...domain, status: 'retired', isDefault: false, updatedAt: now });
    await this.audit('internal_ca.trust_domain.deleted', actorId, 'certificate_authority.delete', 'ca_trust_domain', domain.id, 'critical', context, {
      softDeleted: true,
    });
    return { id: domain.id, deleted: true };
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
    if (input.deploymentMode === 'external' && !['external', 'windows', 'linux'].includes(input.runtimePlatform)) blockers.push('外部 CA 必须使用 external、windows 或 linux 运行平台。');
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

  async createAuthority(
    tenantId: string,
    input: CreateAuthorityInput,
    context?: RequestContext,
    publicCrlBaseUrl?: string,
  ): Promise<Array<Omit<CertificateAuthorityEntity, 'privateKeySecretRef'>>> {
    const commonName = requiredText(input.commonName || input.name, 'commonName');
    const preview = this.previewAuthority(input);
    if (!verifyConfirmation(previewPayload(input), input.confirmationToken)) throw new AppError('CA_RISK_CONFIRMATION_REQUIRED', 'CA 风险确认已失效，请重新预览');
    if (preview.blockers.length > 0) throw new AppError('CA_TOPOLOGY_INVALID', 'CA 拓扑存在阻断项', { blockers: preview.blockers });
    const provider = await this.requireProvider(tenantId, input.providerId);
    if (provider.deploymentMode !== input.deploymentMode || provider.runtimePlatform !== input.runtimePlatform) {
      throw new AppError('CA_TOPOLOGY_INVALID', 'CA 创建参数与 Provider 部署模式不一致');
    }
    const existingAuthorities = isMicrosoftAdcsProvider(provider) ? await this.repository.listAuthorities(tenantId) : [];
    const adcsAuthorityReuse = resolveAdcsAuthorityReuse(input, provider, existingAuthorities);
    if (adcsAuthorityReuse.error) {
      throw adcsAuthorityReuse.error;
    }
    if (adcsAuthorityReuse.authority) {
      // 旧登记可能只有主机名，新登记才携带 certutil 的稳定 caConfig。
      // 复用原 Authority 时把新身份补回去，后续 Agent 上报和资源树都能使用同一条记录。
      const inputCaConfig = textValue(input.configuration?.caConfig);
      const mergedConfiguration = inputCaConfig && !textValue(adcsAuthorityReuse.authority.configuration?.caConfig)
        ? { ...adcsAuthorityReuse.authority.configuration, caConfig: inputCaConfig }
        : adcsAuthorityReuse.authority.configuration;
      const needsConfigurationUpdate = JSON.stringify(mergedConfiguration) !== JSON.stringify(adcsAuthorityReuse.authority.configuration);
      const authority = adcsAuthorityReuse.authority.status === 'retired' || needsConfigurationUpdate
        ? await this.repository.saveAuthority({
            ...adcsAuthorityReuse.authority,
            ...(needsConfigurationUpdate ? { configuration: mergedConfiguration } : {}),
            ...(adcsAuthorityReuse.authority.status === 'retired' ? { status: 'active' as const } : {}),
            updatedAt: new Date().toISOString(),
          })
        : adcsAuthorityReuse.authority;
      await this.audit('internal_ca.authority.reused', input.actorId, 'certificate_authority.create', 'certificate_authority', authority.id, 'high', context, {
        providerId: provider.id,
        reused: true,
        restored: adcsAuthorityReuse.authority.status === 'retired',
        identity: adcsAuthorityReuse.identity,
      });
      return [sanitizeAuthority(authority)];
    }
    const trustDomain = input.trustDomainId
      ? await this.requireUsableTrustDomain(tenantId, input.trustDomainId)
      : await this.ensureGeneratedTrustDomain(tenantId, `${requiredText(input.name, 'name')} 信任域`, input.securityDomain, input.actorId, context);
    if (input.parentCaId) {
      const parent = await this.requireAuthority(tenantId, input.parentCaId);
      if (provider.type !== 'gcac_builtin' || parent.providerId !== provider.id || parent.role !== 'root' || parent.status !== 'active') {
        throw new AppError('CA_TOPOLOGY_INVALID', '只能在同一内置 Provider 的活动根 CA 下创建中间 CA');
      }
      if (parent.trustDomainId !== trustDomain.id || (parent.pathLengthConstraint ?? 0) < 1) {
        throw new AppError('CA_TOPOLOGY_INVALID', '父根 CA 不属于所选信任域或不允许签发中间 CA');
      }
      const intermediate = await this.createBuiltInIntermediate(tenantId, input, parent, input.name, commonName, context, undefined, publicCrlBaseUrl);
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
      const external = await this.createExternalAuthority(tenantId, input, provider, trustDomain.id, publicCrlBaseUrl);
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
      crlDistributionPoint: resolvePublicCrlDistributionPoint(publicCrlBaseUrl, tenantId, rootId, input.crlDistributionPoint),
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
        publicCrlBaseUrl,
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

  async listAuthorities(tenantId: string, publicCrlBaseUrl?: string): Promise<Array<Omit<CertificateAuthorityEntity, 'privateKeySecretRef'>>> {
    const authorities = await this.repository.listAuthorities(tenantId);
    return authorities.map((authority) => {
      const crlDistributionPoint = resolvePublicCrlDistributionPoint(publicCrlBaseUrl, tenantId, authority.id, authority.crlDistributionPoint);
      return sanitizeAuthority({ ...authority, ...(crlDistributionPoint ? { crlDistributionPoint } : {}) });
    });
  }

  async updateAuthority(
    tenantId: string,
    authorityId: string,
    input: UpdateCertificateAuthorityInput,
    actorId: string,
    context?: RequestContext,
    publicCrlBaseUrl?: string,
  ): Promise<Omit<CertificateAuthorityEntity, 'privateKeySecretRef'>> {
    const authority = await this.requireAuthority(tenantId, authorityId);
    if (authority.status !== 'active') {
      throw new AppError('RESOURCE_VERSION_CONFLICT', '只有活动中的证书机构可以修改管理配置', { authorityId, status: authority.status });
    }
    await this.requireProvider(tenantId, authority.providerId);
    const trustDomainId = input.trustDomainId === undefined
      ? authority.trustDomainId
      : requiredText(input.trustDomainId, 'trustDomainId');
    if (!trustDomainId) throw new AppError('CA_TRUST_DOMAIN_STATE_INVALID', '证书机构必须关联可用的 CA 信任域', { authorityId });
    const trustDomain = await this.requireUsableTrustDomain(tenantId, trustDomainId);
    const authorities = await this.repository.listAuthorities(tenantId);
    if (authority.trustDomainId !== trustDomain.id) {
      const activeChildren = authorities.filter((item) => item.parentCaId === authority.id && item.status !== 'retired');
      if (activeChildren.length > 0) {
        throw new AppError('CA_TOPOLOGY_INVALID', '存在活动中的下级证书机构，不能修改当前 CA 的信任域', {
          authorityId,
          childAuthorityIds: activeChildren.map((item) => item.id),
        });
      }
      if (authority.parentCaId) {
        const parent = authorities.find((item) => item.id === authority.parentCaId);
        if (!parent || parent.trustDomainId !== trustDomain.id) {
          throw new AppError('CA_TOPOLOGY_INVALID', '中间证书机构必须与父根 CA 位于同一信任域', {
            authorityId,
            parentCaId: authority.parentCaId,
            trustDomainId: trustDomain.id,
          });
        }
      }
    }
    const now = new Date().toISOString();
    const updated: CertificateAuthorityEntity = {
      ...authority,
      name: input.name === undefined ? authority.name : requiredText(input.name, 'name'),
      trustDomainId: trustDomain.id,
      securityDomain: input.securityDomain === undefined ? authority.securityDomain : requiredText(input.securityDomain, 'securityDomain'),
      crlDistributionPoint: resolvePublicCrlDistributionPoint(publicCrlBaseUrl, tenantId, authority.id, authority.crlDistributionPoint),
      configuration: input.configuration === undefined
        ? authority.configuration
        : { ...authority.configuration, ...structuredClone(input.configuration) },
      updatedAt: now,
    };
    const profiles = await this.repository.listProfiles(tenantId);
    const linkedProfiles = profiles.filter((profile) => profile.certificateAuthorityId === authority.id);
    const profileIds = input.certificateProfileId !== undefined
      ? (input.certificateProfileId === null || input.certificateProfileId.trim() === ''
        ? []
        : [requiredText(input.certificateProfileId, 'certificateProfileId')])
      : input.certificateProfileIds === undefined
        ? undefined
        : [...new Set(input.certificateProfileIds.map((profileId) => requiredText(profileId, 'certificateProfileIds')) )];
    if (authority.trustDomainId !== trustDomain.id && profileIds === undefined && linkedProfiles.some((profile) => profile.status === 'active')) {
      throw new AppError('CERTIFICATE_PROFILE_VIOLATION', '修改 CA 信任域时必须同时确认关联的活动证书 Profile', { authorityId });
    }
    const profileUpdates: CertificateProfileEntity[] = [];
    if (profileIds !== undefined) {
      const selectedProfiles = profileIds.map((profileId) => profiles.find((profile) => profile.id === profileId));
      if (selectedProfiles.some((profile) => !profile)) {
        throw new AppError('RESOURCE_NOT_FOUND', '关联的证书 Profile 不存在', {
          authorityId,
          profileIds,
        });
      }
      for (const profile of selectedProfiles as CertificateProfileEntity[]) {
        if (profile.status !== 'active' || profile.providerType !== 'internal_ca') {
          throw new AppError('CERTIFICATE_PROFILE_VIOLATION', '只能关联活动中的 Internal CA 证书 Profile', {
            authorityId,
            profileId: profile.id,
          });
        }
        if (profile.providerId && profile.providerId !== authority.providerId) {
          throw new AppError('CERTIFICATE_PROFILE_VIOLATION', '证书 Profile 的签发 Provider 与当前 CA 不匹配', {
            authorityId,
            profileId: profile.id,
          });
        }
        profileUpdates.push({ ...profile, certificateAuthorityId: authority.id, trustDomainId: trustDomain.id, updatedAt: now });
      }
      for (const profile of linkedProfiles) {
        if (profileIds.includes(profile.id)) continue;
        if (profile.isDefault && profile.status === 'active') {
          throw new AppError('CERTIFICATE_PROFILE_VIOLATION', '默认自动证书 Profile 不能解除与 CA 的关联，请先选择替代 Profile', {
            authorityId,
            profileId: profile.id,
          });
        }
        profileUpdates.push({ ...profile, certificateAuthorityId: undefined, updatedAt: now });
      }
    }
    await this.repository.saveAuthorityWithProfiles(updated, profileUpdates);
    await this.audit('internal_ca.authority.updated', actorId, 'certificate_authority.update', 'certificate_authority', authority.id, 'critical', context, {
      trustDomainId: updated.trustDomainId,
      profileIds: profileIds ?? linkedProfiles.map((profile) => profile.id),
      profileLinksChanged: profileIds !== undefined,
    });
    return sanitizeAuthority(updated);
  }

  async deleteAuthority(tenantId: string, authorityId: string, actorId: string, context?: RequestContext): Promise<{ id: string; deleted: true }> {
    const authority = await this.requireAuthority(tenantId, authorityId);
    if (authority.status === 'retired') return { id: authority.id, deleted: true };
    const activeChildren = (await this.repository.listAuthorities(tenantId)).filter((item) => item.parentCaId === authority.id && item.status !== 'retired');
    if (activeChildren.length > 0) {
      throw new AppError('CA_AUTHORITY_IN_USE', '该 CA 仍有活动中的中间 CA，不能删除', {
        caId: authority.id,
        childAuthorityIds: activeChildren.map((item) => item.id),
      });
    }
    const now = new Date().toISOString();
    await this.repository.saveAuthority({ ...authority, status: 'retired', updatedAt: now });
    await this.audit('internal_ca.authority.deleted', actorId, 'certificate_authority.delete', 'certificate_authority', authority.id, 'critical', context, {
      softDeleted: true,
      providerId: authority.providerId,
    });
    return { id: authority.id, deleted: true };
  }

  async createProfile(tenantId: string, input: CreateProfileInput): Promise<{ profile: CertificateProfileEntity; version: CertificateProfileVersionEntity }> {
    const now = new Date().toISOString();
    const trustDomainId = input.trustDomainId ?? await this.resolveProfileTrustDomain(tenantId, input.securityDomain);
    if (trustDomainId) await this.requireUsableTrustDomain(tenantId, trustDomainId);
    const purpose = input.purpose ?? 'https_server';
    if (purpose !== 'https_server') throw new AppError('VALIDATION_FAILED', '证书 Profile 用途当前仅支持 https_server');
    const providerType = input.providerType ?? (input.securityDomain.trim().toLowerCase() === 'acme' ? 'acme' : 'internal_ca');
    if (providerType !== 'acme' && providerType !== 'internal_ca') throw new AppError('VALIDATION_FAILED', '证书 Profile Provider 类型无效');
    let providerId = optionalText(input.providerId);
    const certificateAuthorityId = optionalText(input.certificateAuthorityId);
    const acmeProviderProfileId = optionalText(input.acmeProviderProfileId);
    const dnsProviderId = optionalText(input.dnsProviderId);
    const credentialRef = optionalText(input.credentialRef);
    if (credentialRef && !isSecretRef(credentialRef)) throw new AppError('SECRET_REF_INVALID', '证书 Profile 凭据必须使用 SecretRef', { field: 'credentialRef' });
    if (providerType !== 'acme' && (acmeProviderProfileId || dnsProviderId || credentialRef)) {
      throw new AppError('CERTIFICATE_PROFILE_VIOLATION', '只有 ACME Profile 可以配置 ACME 账户和 DNS 凭据');
    }
    if (providerType === 'internal_ca' && certificateAuthorityId) {
      const authority = await this.repository.getAuthority(tenantId, certificateAuthorityId);
      if (!authority) throw new AppError('RESOURCE_NOT_FOUND', '证书 Profile 绑定的 CA 不存在', { certificateAuthorityId });
      if (authority.status !== 'active') throw new AppError('CA_PROVIDER_UNAVAILABLE', '证书 Profile 只能绑定活动 CA', { certificateAuthorityId });
      if (providerId && authority.providerId !== providerId) throw new AppError('CERTIFICATE_PROFILE_VIOLATION', '证书 Profile 的 Provider 与 CA 不匹配');
      // CA 是 Profile 的实际归属，Provider 由 CA 反推，避免管理员在两个下拉框中选出不一致的组合。
      providerId = authority.providerId;
    }
    if (providerId) {
      const provider = await this.repository.getProvider(tenantId, providerId);
      if (!provider || provider.status !== 'active') throw new AppError('CA_PROVIDER_UNAVAILABLE', '证书 Profile 绑定的 Provider 不可用', { providerId });
      if (providerType === 'acme' && provider.type !== 'acme') throw new AppError('CERTIFICATE_PROFILE_VIOLATION', 'ACME Profile 必须绑定 ACME Provider');
      if (providerType === 'internal_ca' && provider.type === 'acme') throw new AppError('CERTIFICATE_PROFILE_VIOLATION', 'Internal CA Profile 不能绑定 ACME Provider');
    }
    if (input.isDefault === true) {
      if (!providerId) throw new AppError('CERTIFICATE_PROFILE_VIOLATION', '默认 Profile 必须绑定明确的 Provider');
      if (providerType === 'internal_ca' && !certificateAuthorityId) {
        throw new AppError('CERTIFICATE_PROFILE_VIOLATION', '默认 Internal CA Profile 必须绑定明确的 CA');
      }
      if (providerType === 'acme' && (!dnsProviderId || !credentialRef)) {
        throw new AppError('CERTIFICATE_PROFILE_VIOLATION', '默认 ACME Profile 必须配置 DNS Provider 和凭据 SecretRef');
      }
    }
    const profile: CertificateProfileEntity = {
      id: newId('certprof'),
      tenantId,
      name: requiredText(input.name, 'name'),
      purpose,
      providerType,
      ...(providerId ? { providerId } : {}),
      ...(certificateAuthorityId ? { certificateAuthorityId } : {}),
      ...(acmeProviderProfileId ? { acmeProviderProfileId } : {}),
      ...(dnsProviderId ? { dnsProviderId } : {}),
      ...(credentialRef ? { credentialRef } : {}),
      securityDomain: requiredText(input.securityDomain, 'securityDomain'),
      trustDomainId,
      domainPatterns: normalizeProfilePatterns(input.domainPatterns),
      targetCapabilities: uniqueStrings(input.targetCapabilities ?? []),
      isDefault: input.isDefault === true,
      priority: normalizeProfilePriority(input.priority),
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
    if (profile.status !== 'active') throw new AppError('RESOURCE_VERSION_CONFLICT', '已删除的证书 Profile 不能新增版本', { profileId });
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
      profile: normalizeProfileEntity(profile),
      versions: await this.repository.listProfileVersions(profile.id),
    })));
  }

  async deleteProfile(tenantId: string, profileId: string, actorId: string, context?: RequestContext): Promise<{ id: string; deleted: true }> {
    const profile = await this.repository.getProfile(tenantId, profileId);
    if (!profile) throw new AppError('RESOURCE_NOT_FOUND', '证书 Profile 不存在', { profileId });
    if (profile.status === 'disabled') return { id: profile.id, deleted: true };
    const now = new Date().toISOString();
    await this.repository.saveProfile({ ...profile, status: 'disabled', isDefault: false, updatedAt: now });
    await this.audit('internal_ca.profile.deleted', actorId, 'ca_template_mapping.manage', 'certificate_profile', profile.id, 'high', context, {
      softDeleted: true,
      currentVersion: profile.currentVersion,
    });
    return { id: profile.id, deleted: true };
  }

  /**
   * 按用途、域名、CA 和目标能力解析唯一活动 Profile。
   * 这里故意不按数组顺序、优先级或版本号兜底；零个或多个候选都必须让调用方处理。
   */
  async resolveCertificateProfile(input: {
    tenantId: string;
    purpose?: CertificateProfilePurpose;
    primaryDomain: string;
    securityDomain?: string;
    providerType?: CertificateProfileProviderType;
    providerId?: string;
    certificateAuthorityId?: string;
    targetCapabilities?: string[];
  }): Promise<{ profile: CertificateProfileEntity; version: CertificateProfileVersionEntity; matchedBy: Record<string, unknown> }> {
    const purpose = input.purpose ?? 'https_server';
    const domain = normalizeDomain(input.primaryDomain);
    const securityDomain = optionalText(input.securityDomain)?.toLowerCase();
    const targetCapabilities = new Set((input.targetCapabilities ?? []).map((item) => item.trim().toLowerCase()).filter(Boolean));
    const explicitSource = Boolean(input.providerType || input.providerId || input.certificateAuthorityId);
    const entries = await this.listProfiles(input.tenantId);
    const candidates = entries.filter(({ profile }) => {
      if (profile.status !== 'active' || profile.purpose !== purpose) return false;
      if (!explicitSource && !profile.isDefault) return false;
      if (input.providerType && profile.providerType !== input.providerType) return false;
      if (input.providerId && profile.providerId !== input.providerId) return false;
      if (input.certificateAuthorityId && profile.certificateAuthorityId !== input.certificateAuthorityId) return false;
      // 未提供应用安全域时只能使用通用 Profile，不能猜测某个具体安全域。
      if (profile.securityDomain.toLowerCase() !== '*'
        && (!securityDomain || profile.securityDomain.toLowerCase() !== securityDomain)) return false;
      if (profile.domainPatterns.length > 0 && !profile.domainPatterns.some((pattern) => matchesProfilePattern(domain, pattern))) return false;
      if (profile.targetCapabilities.some((capability) => !targetCapabilities.has(capability))) return false;
      return true;
    });
    if (candidates.length !== 1) {
      throw new AppError('CERTIFICATE_PROFILE_RESOLUTION_FAILED', candidates.length === 0
        ? '没有匹配当前用途、域名、CA 与目标能力的活动证书 Profile'
        : '当前条件匹配多个活动证书 Profile，无法安全选择', {
        purpose,
        primaryDomain: domain,
        securityDomain,
        providerType: input.providerType,
        providerId: input.providerId,
        certificateAuthorityId: input.certificateAuthorityId,
        candidateProfileIds: candidates.map(({ profile }) => profile.id),
      });
    }
    const selected = candidates[0]!;
    const version = selected.versions.find((item) => item.versionNo === selected.profile.currentVersion);
    if (!version) throw new AppError('CERTIFICATE_PROFILE_RESOLUTION_FAILED', '活动证书 Profile 没有明确的当前版本', {
      profileId: selected.profile.id,
      currentVersion: selected.profile.currentVersion,
    });
    return {
      profile: selected.profile,
      version,
      matchedBy: {
        purpose,
        primaryDomain: domain,
        securityDomain: selected.profile.securityDomain,
        ...(securityDomain ? { requestedSecurityDomain: securityDomain } : {}),
        providerType: selected.profile.providerType,
        ...(selected.profile.providerId ? { providerId: selected.profile.providerId } : {}),
        ...(selected.profile.certificateAuthorityId ? { certificateAuthorityId: selected.profile.certificateAuthorityId } : {}),
        ...(selected.profile.acmeProviderProfileId ? { acmeProviderProfileId: selected.profile.acmeProviderProfileId } : {}),
        ...(selected.profile.dnsProviderId ? { dnsProviderId: selected.profile.dnsProviderId } : {}),
        ...(selected.profile.credentialRef ? { credentialRef: selected.profile.credentialRef } : {}),
        targetCapabilities: selected.profile.targetCapabilities,
      },
    };
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
      try {
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
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        authority = (await this.repository.listAuthorities(tenantId)).find((item) => (
          item.providerId === provider.id && item.topologyMode === 'external_managed' && item.status === 'active'
        ));
        if (!authority) throw error;
      }
    }
    if (!authority) throw new AppError('CA_PROVIDER_UNAVAILABLE', 'ACME 逻辑证书机构创建失败', { providerId });
    const profileName = `ACME ${provider.name} Server Certificate Profile`;
    let profileEntry = (await this.listProfiles(tenantId)).find((item) => (
      item.profile.securityDomain === 'acme'
      && item.profile.trustDomainId === authority!.trustDomainId
      && item.profile.status === 'active'
    ));
    if (!profileEntry) {
      try {
        const created = await this.createProfile(tenantId, {
          name: profileName,
          securityDomain: 'acme',
          trustDomainId: authority.trustDomainId,
          providerType: 'acme',
          providerId: provider.id,
          certificateAuthorityId: authority.id,
          rules: {
            allowedSanTypes: ['dns', 'ip'], keyAlgorithms: ['rsa', 'ec'], minimumRsaBits: 2048,
            maximumValidityDays: 397, renewalWindowDays: 7, rotateKeyOnRenewal: true,
            allowWildcard: true, requireApproval: false, extendedKeyUsages: ['serverAuth'],
          },
          actorId,
        });
        profileEntry = { profile: created.profile, versions: [created.version] };
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        profileEntry = (await this.listProfiles(tenantId)).find((item) => (
          item.profile.securityDomain === 'acme'
          && item.profile.trustDomainId === authority!.trustDomainId
          && item.profile.status === 'active'
        ));
        if (!profileEntry) throw error;
      }
    }
    const version = profileEntry.versions.slice().sort((left, right) => right.versionNo - left.versionNo)[0];
    if (!version) throw new AppError('CA_PROVIDER_UNAVAILABLE', 'ACME 证书 Profile 创建失败', { providerId });
    return { caId: authority.id, profileVersionId: version.id, trustDomainId: authority.trustDomainId };
  }

  private async ensureGeneratedTrustDomain(
    tenantId: string,
    name: string,
    purpose: string,
    actorId: string,
    context?: RequestContext,
  ): Promise<CaTrustDomainEntity> {
    const existing = await this.repository.getTrustDomainByName(tenantId, name);
    if (existing) return existing;
    try {
      return await this.createTrustDomain(tenantId, { name, purpose }, actorId, context);
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const concurrent = await this.repository.getTrustDomainByName(tenantId, name);
      if (!concurrent) throw error;
      return concurrent;
    }
  }

  async createCertificateRequest(tenantId: string, input: CreateCertificateRequestInput, context?: RequestContext): Promise<CertificateRequestEntity> {
    if (input.applicationCertificatePolicyVersionId && !input.certificateAssetId) {
      throw new AppError('APPLICATION_CERTIFICATE_POLICY_INVALID', '应用证书供应策略申请必须绑定 certificateAssetId', {
        applicationCertificatePolicyVersionId: input.applicationCertificatePolicyVersionId,
      });
    }
    if (input.certificateAssetId && input.certificateAssetId === input.applicationAssetId) {
      throw new AppError('APPLICATION_CERTIFICATE_POLICY_INVALID', 'applicationAssetId 与 certificateAssetId 语义不能相同');
    }
    if (input.applicationCertificatePolicyVersionId) {
      await this.assertApplicationCertificatePolicyBinding(tenantId, input);
    }
    const authority = await this.requireAuthority(tenantId, input.caId);
    if (authority.status !== 'active') throw new AppError('CA_PROVIDER_UNAVAILABLE', '证书机构当前不可签发', { caId: authority.id, status: authority.status });
    const profileVersion = await this.repository.getProfileVersion(input.profileVersionId);
    if (!profileVersion) throw new AppError('RESOURCE_NOT_FOUND', '证书 Profile 版本不存在', { profileVersionId: input.profileVersionId });
    const profile = await this.repository.getProfile(tenantId, profileVersion.profileId);
    if (!profile) throw new AppError('RESOURCE_NOT_FOUND', '证书 Profile 不存在', { profileId: profileVersion.profileId });
    validateProfile(input, profileVersion.rules);
    const provider = await this.requireProvider(tenantId, authority.providerId);
    if (!input.applicationAssetId && provider.type !== 'acme') {
      throw new AppError('APPLICATION_CERTIFICATE_POLICY_INVALID', '非 ACME 证书申请必须绑定 applicationAssetId');
    }
    const providerActionBinding = provider.type === 'plugin'
      ? await this.requireProviderActionBinding(tenantId, provider.id)
      : undefined;
    const policySnapshot = await this.certificatePolicies.snapshot({
      tenantId,
      actorId: input.actorId,
      requestedValidityDays: input.requestedValidityDays,
      profileRules: profileVersion.rules,
      binding: providerActionBinding,
    });
    if (authority.trustDomainId) {
      await this.requireUsableTrustDomain(tenantId, authority.trustDomainId);
      if (input.trustDomainId && authority.trustDomainId !== input.trustDomainId) throw new AppError('CERTIFICATE_TRUST_DOMAIN_MISMATCH', '证书申请与 CA 信任域不匹配');
      if (profile.trustDomainId && authority.trustDomainId !== profile.trustDomainId) throw new AppError('CERTIFICATE_TRUST_DOMAIN_MISMATCH', '证书 Profile 与 CA 信任域不匹配');
    } else if (profile.securityDomain !== authority.securityDomain) {
      throw new AppError('CERTIFICATE_PROFILE_VIOLATION', '证书 Profile 与 CA 安全域不匹配');
    }
    // 应用专属证书的重新申请由统一任务编排，签发动作本身不再插入人工审批步骤。
    // 将豁免结果写入不可变快照，确保本机 CSR 回执阶段不会再次回到 pending_approval。
    const effectivePolicySnapshot: EffectiveCertificatePolicySnapshot = input.skipApproval === true
      ? { ...policySnapshot, requiresApproval: false, approvalBypassed: true }
      : policySnapshot;
    const idempotencyKey = input.idempotencyKey?.trim() || createHash('sha256').update([
      tenantId, input.applicationAssetId, input.caId, input.profileVersionId, input.commonName,
      [...input.sans].sort().join(','), new Date().toISOString().slice(0, 10),
    ].join('|')).digest('hex');
    const existing = await this.repository.getRequestByIdempotencyKey(tenantId, idempotencyKey);
    if (existing) return existing;
    // 本机持钥申请先落一条 pending_key 事实，再由 Agent v2 返回 CSR。此时
    // 不创建任何私钥材料；占位 KeyReference 仅用于维持现有外键和幂等模型。
    if (input.custodyMode === 'local_agent' && !input.csrPem) {
      return this.createPendingLocalAgentRequest(tenantId, input, authority, profileVersion, effectivePolicySnapshot, idempotencyKey, context);
    }
    const keyMaterial = await this.prepareKeyMaterial(tenantId, input, profileVersion.rules, context);
    const now = new Date().toISOString();
    const requestId = newId('certreq');
    const approvalRequired = effectivePolicySnapshot.requiresApproval;
    const approval = approvalRequired && this.dependencies.approvals
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
      ...(input.applicationAssetId ? { applicationAssetId: requiredText(input.applicationAssetId, 'applicationAssetId') } : {}),
      ...(input.certificateAssetId ? { certificateAssetId: input.certificateAssetId } : {}),
      ...(input.applicationCertificatePolicyVersionId ? { applicationCertificatePolicyVersionId: input.applicationCertificatePolicyVersionId } : {}),
      caId: authority.id,
      trustDomainId: authority.trustDomainId,
      profileVersionId: profileVersion.id,
      certificatePolicyVersionId: effectivePolicySnapshot.policyVersionId,
      providerActionBindingId: effectivePolicySnapshot.providerActionBindingId,
      effectivePolicySnapshot,
      keyReferenceId: keyMaterial.keyReference.id,
      csrPem: keyMaterial.csrPem,
      csrSha256: keyMaterial.csrSha256,
      publicKeyFingerprintSha256: keyMaterial.publicKeyFingerprintSha256,
      idempotencyKey,
      status: approvalRequired ? 'pending_approval' : 'approved',
      requestedBy: input.actorId,
      approvalId: approval?.id,
      deferIssuance: input.deferIssuance === true,
      subjectCommonName: requiredText(input.commonName, 'commonName'),
      sans: normalizeCertificateNames(input.sans),
      requestedValidityDays: effectivePolicySnapshot.effectiveValidityDays,
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
    if (approvalRequired || input.deferIssuance === true) return request;
    return this.issueRequest(tenantId, request.id, input.actorId, context);
  }

  /**
   * 专属申请的归属门禁。不能只相信 DTO 中的三个 ID，否则任意调用方都能把
   * 其他应用的证书资产挂到当前申请；这里直接读取持久化关系并在写入前拒绝。
   * 历史策略版本允许继续完成原快照，但必须仍属于同一租户和应用。
   */
  private async assertApplicationCertificatePolicyBinding(
    tenantId: string,
    input: Pick<CreateCertificateRequestInput, 'applicationAssetId' | 'certificateAssetId' | 'applicationCertificatePolicyVersionId'>,
  ): Promise<void> {
    const row = (await this.dependencies.db.query<{
      policy_tenant_id: string;
      policy_application_asset_id: string;
      policy_supply_mode: string;
      policy_certificate_asset_id: string | null;
      asset_tenant_id: string | null;
      asset_application_asset_id: string | null;
    }>(
      `select v.tenant_id as policy_tenant_id,
              v.application_asset_id as policy_application_asset_id,
              v.supply_mode as policy_supply_mode,
              v.certificate_asset_id as policy_certificate_asset_id,
              a.tenant_id as asset_tenant_id,
              a.application_asset_id as asset_application_asset_id
         from pg_application_certificate_policy_versions v
         left join pg_certificate_assets a on a.id = v.certificate_asset_id
        where v.id = $1`,
      [input.applicationCertificatePolicyVersionId],
    )).rows[0];
    const valid = Boolean(
      row
      && row.policy_tenant_id === tenantId
      && row.policy_application_asset_id === input.applicationAssetId
      && row.policy_supply_mode === 'dedicated'
      && row.policy_certificate_asset_id
      && row.policy_certificate_asset_id === input.certificateAssetId
      && row.asset_tenant_id === tenantId
      && row.asset_application_asset_id === input.applicationAssetId,
    );
    if (!valid) {
      throw new AppError('DEDICATED_CERTIFICATE_OWNERSHIP_CONFLICT', '证书申请的应用、策略版本和专属证书资产归属不一致', {
        applicationAssetId: input.applicationAssetId,
        certificateAssetId: input.certificateAssetId,
        applicationCertificatePolicyVersionId: input.applicationCertificatePolicyVersionId,
      });
    }
  }

  /** 创建等待 Agent 生成本机密钥/CSR 的证书申请。 */
  private async createPendingLocalAgentRequest(
    tenantId: string,
    input: CreateCertificateRequestInput,
    authority: CertificateAuthorityEntity,
    profileVersion: CertificateProfileVersionEntity,
    policySnapshot: EffectiveCertificatePolicySnapshot,
    idempotencyKey: string,
    context?: RequestContext,
  ): Promise<CertificateRequestEntity> {
    if (!input.applicationAssetId) throw new AppError('APPLICATION_CERTIFICATE_POLICY_INVALID', '本机 Agent 证书申请必须绑定 applicationAssetId');
    const applicationAssetId = requiredText(input.applicationAssetId, 'applicationAssetId');
    const now = new Date().toISOString();
    const keyReference = await this.repository.saveKeyReference({
      id: newId('keyref'),
      tenantId,
      ownerType: 'application_certificate',
      ownerId: applicationAssetId,
      custodyMode: 'local_agent',
      backendType: input.keyBackend ?? 'file',
      publicKeyFingerprintSha256: '0'.repeat(64),
      exportability: input.exportability ?? 'unknown',
      protectionLevel: 'software_controlled',
      status: 'retiring',
      evidence: { pending: true, privateKeyTransported: false },
      createdAt: now,
      updatedAt: now,
    });
    const request: CertificateRequestEntity = {
      id: newId('certreq'),
      tenantId,
      applicationAssetId,
      ...(input.certificateAssetId ? { certificateAssetId: input.certificateAssetId } : {}),
      ...(input.applicationCertificatePolicyVersionId ? { applicationCertificatePolicyVersionId: input.applicationCertificatePolicyVersionId } : {}),
      caId: authority.id,
      trustDomainId: authority.trustDomainId,
      profileVersionId: profileVersion.id,
      certificatePolicyVersionId: policySnapshot.policyVersionId,
      providerActionBindingId: policySnapshot.providerActionBindingId,
      effectivePolicySnapshot: policySnapshot,
      keyReferenceId: keyReference.id,
      csrPem: '',
      csrSha256: createHash('sha256').update('', 'utf8').digest('hex'),
      publicKeyFingerprintSha256: '0'.repeat(64),
      idempotencyKey,
      status: 'pending_key',
      requestedBy: input.actorId,
      deferIssuance: false,
      subjectCommonName: requiredText(input.commonName, 'commonName'),
      sans: normalizeCertificateNames(input.sans),
      requestedValidityDays: policySnapshot.effectiveValidityDays,
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.saveRequest(request);
    await this.audit('internal_ca.request.created', input.actorId, 'certificate_request.create', 'certificate_request', request.id, 'high', context, {
      applicationAssetId: request.applicationAssetId,
      caId: request.caId,
      keyCustodyMode: 'local_agent',
      status: request.status,
    });
    return request;
  }

  /**
   * 接收 Agent v2 key.generate_csr 成功回执，更新占位 KeyReference 和申请。
   * CSR 会再次由控制面解析，避免信任 Agent 回执中的可伪造指纹。
   */
  async completeLocalAgentCsr(
    tenantId: string,
    requestId: string,
    input: {
      localKeyRef: string;
      csrPem: string;
      csrSha256?: string;
      publicKeyFingerprintSha256?: string;
      keyBackend?: KeyBackendType;
      exportability?: KeyExportability;
      protectionLevel?: KeyReferenceEntity['protectionLevel'];
      evidence?: Record<string, unknown>;
      agentContext?: CertificateRequestEntity['agentContext'];
    },
    actorId: string,
    context?: RequestContext,
  ): Promise<CertificateRequestEntity> {
    const request = await this.requireRequest(tenantId, requestId);
    if (!['pending_key', 'pending_csr'].includes(request.status)) {
      return request;
    }
    const localKeyRef = requiredText(input.localKeyRef, 'localKeyRef');
    if (!/^local-key:[a-f0-9]{64}$/i.test(localKeyRef)) {
      throw new AppError('VALIDATION_FAILED', 'Agent 返回的 localKeyRef 必须是不透明的本机密钥句柄');
    }
    if (!input.agentContext) {
      throw new AppError('TENANT_SCOPE_DENIED', 'Agent CSR 回执缺少已绑定的目标上下文');
    }
    if (input.agentContext.agentId !== actorId) {
      throw new AppError('TENANT_SCOPE_DENIED', 'Agent CSR 回执与执行 Agent 不一致', {
        expectedAgentId: input.agentContext.agentId,
        actualAgentId: actorId,
      });
    }
    if (!request.agentContext || !sameAgentContext(request.agentContext, input.agentContext)) {
      throw new AppError('TENANT_SCOPE_DENIED', 'Agent CSR 回执与证书申请绑定的目标上下文不一致', {
        requestId: request.id,
        agentId: actorId,
      });
    }
    const keyReference = await this.repository.getKeyReference(tenantId, request.keyReferenceId);
    if (!keyReference) throw new AppError('RESOURCE_NOT_FOUND', '证书申请占位密钥引用不存在');
    if (keyReference.custodyMode !== 'local_agent') {
      throw new AppError('RESOURCE_VERSION_CONFLICT', '证书申请的密钥托管模式不是本机 Agent');
    }
    const parsed = await this.openssl.parseCsr(requiredText(input.csrPem, 'csrPem'));
    if (input.csrSha256 && input.csrSha256.toLowerCase() !== parsed.csrSha256.toLowerCase()) {
      throw new AppError('CSR_SIGNATURE_INVALID', 'Agent 返回的 CSR 摘要不匹配');
    }
    if (input.publicKeyFingerprintSha256 && input.publicKeyFingerprintSha256.toLowerCase() !== parsed.publicKeyFingerprintSha256.toLowerCase()) {
      throw new AppError('PUBLIC_KEY_MISMATCH', 'Agent 返回的 CSR 公钥指纹不匹配');
    }
    if (!parsed.subject.toLowerCase().includes(request.subjectCommonName.toLowerCase())) {
      throw new AppError('VALIDATION_FAILED', 'Agent 返回的 CSR 主体与证书申请不一致');
    }
    const updatedKey = await this.repository.saveKeyReference({
      ...keyReference,
      opaqueReference: localKeyRef,
      backendType: input.keyBackend ?? keyReference.backendType,
      publicKeyFingerprintSha256: parsed.publicKeyFingerprintSha256,
      exportability: input.exportability ?? keyReference.exportability,
      protectionLevel: input.protectionLevel ?? keyReference.protectionLevel,
      status: 'active',
      evidence: { ...keyReference.evidence, ...structuredClone(input.evidence ?? {}), privateKeyTransported: false },
      updatedAt: new Date().toISOString(),
    });
    const requiresApproval = request.effectivePolicySnapshot?.requiresApproval === true;
    let next = await this.repository.saveRequest({
      ...request,
      keyReferenceId: updatedKey.id,
      csrPem: parsed.csrPem,
      csrSha256: parsed.csrSha256,
      publicKeyFingerprintSha256: parsed.publicKeyFingerprintSha256,
      agentContext: input.agentContext,
      status: requiresApproval ? 'pending_approval' : 'approved',
      updatedAt: new Date().toISOString(),
    });
    if (requiresApproval && this.dependencies.approvals) {
      const approval = await this.dependencies.approvals.create({
        operationType: 'certificate_request.issue',
        resourceRefs: [{ type: 'certificate_request', id: request.id }],
        riskLevel: 'high',
        parameters: { requestId: request.id, applicationAssetId: request.applicationAssetId, caId: request.caId, publicKeyFingerprintSha256: parsed.publicKeyFingerprintSha256 },
        requestedBy: actorId,
      }, context);
      next = await this.repository.saveRequest({ ...next, approvalId: approval.id, updatedAt: new Date().toISOString() });
      return next;
    }
    if (next.applicationCertificatePolicyVersionId && this.certificateIssueTasks) {
      await this.certificateIssueTasks.enqueue({
        tenantId,
        taskType: 'CERTIFICATE_ISSUE',
        requestedBy: actorId,
        triggerSource: 'internal-ca.local-agent-csr.completed',
        idempotencyKey: `certificate-issue:${next.id}`,
        payload: {
          certificateRequestId: next.id,
          applicationAssetId: next.applicationAssetId,
          ...(next.certificateAssetId ? { certificateAssetId: next.certificateAssetId } : {}),
          policyVersionId: next.applicationCertificatePolicyVersionId,
        },
        resourceSummary: {
          ...(next.subjectCommonName ? { displayName: next.subjectCommonName } : {}),
          ...(next.applicationAssetId ? { applicationAssetId: next.applicationAssetId } : {}),
          ...(next.certificateAssetId ? { certificateAssetId: next.certificateAssetId } : {}),
          policyVersionId: next.applicationCertificatePolicyVersionId,
        },
        resourceRefs: [
          { resourceType: 'certificateRequest', resourceId: next.id },
          ...(next.certificateAssetId ? [{ resourceType: 'certificateAsset', resourceId: next.certificateAssetId }] : []),
          { resourceType: 'applicationCertificatePolicyVersion', resourceId: next.applicationCertificatePolicyVersionId },
        ],
      });
      return this.requireRequest(tenantId, next.id);
    }
    return this.issueRequest(tenantId, next.id, actorId, context);
  }

  async markLocalAgentCertificateInstall(
    tenantId: string,
    requestId: string,
    outcome: 'SUCCESS' | 'FAILED' | 'UNKNOWN',
    input: { detail?: Record<string, unknown>; errorCode?: string; errorMessage?: string } = {},
  ): Promise<CertificateRequestEntity> {
    const request = await this.requireRequest(tenantId, requestId);
    const deploymentEvidence = summarizeAgentCertificateEvidence(input.detail, input.errorCode, input.errorMessage);
    if (outcome === 'SUCCESS') {
      const installEvidence = readAgentInstallEvidence(input.detail);
      const key = await this.repository.getKeyReference(tenantId, request.keyReferenceId);
      const version = request.certificateVersionId
        ? await this.dependencies.certificates.getRepository().getVersion(request.certificateVersionId, tenantId)
        : undefined;
      const expectedKeyRef = key?.opaqueReference;
      const expectedPublicKey = version?.publicKeyFingerprintSha256 ?? key?.publicKeyFingerprintSha256;
      const evidenceValid = Boolean(
        installEvidence
        && installEvidence.privateKeyTransported === false
        && expectedKeyRef
        && installEvidence.localKeyRef === expectedKeyRef
        && installEvidence.publicKeyFingerprintSha256
        && expectedPublicKey
        && installEvidence.publicKeyFingerprintSha256.toLowerCase() === expectedPublicKey.toLowerCase()
        && installEvidence.certificateFingerprintSha256
        && (!version || installEvidence.certificateFingerprintSha256.toLowerCase() === version.fingerprintSha256.toLowerCase()),
      );
      if (!evidenceValid) {
        return this.repository.saveRequest({
          ...request,
          status: 'deploy_failed',
          failureCode: 'AGENT_RECEIPT_INVALID',
          failureMessage: 'Agent 证书安装回执缺少或不匹配公开证据，未激活证书',
          ...(deploymentEvidence ? { deploymentEvidence } : {}),
          updatedAt: new Date().toISOString(),
        });
      }
      return this.repository.saveRequest({
        ...request,
        status: 'active',
        ...(deploymentEvidence ? { deploymentEvidence } : {}),
        failureCode: undefined,
        failureMessage: undefined,
        updatedAt: new Date().toISOString(),
      });
    }
    return this.repository.saveRequest({
      ...request,
      status: outcome === 'UNKNOWN' ? 'deploy_failed' : 'deploy_failed',
      failureCode: input.errorCode ?? (outcome === 'UNKNOWN' ? 'AGENT_EXECUTION_UNKNOWN' : 'AGENT_EXECUTION_FAILED'),
      failureMessage: input.errorMessage ?? (outcome === 'UNKNOWN' ? 'Agent 写操作结果不明，禁止自动重试或回退' : 'Agent 证书安装失败'),
      ...(deploymentEvidence ? { deploymentEvidence } : {}),
      updatedAt: new Date().toISOString(),
    });
  }

  async markLocalAgentCsrFailure(
    tenantId: string,
    requestId: string,
    outcome: 'FAILED' | 'UNKNOWN',
    errorMessage?: string,
  ): Promise<CertificateRequestEntity> {
    const request = await this.requireRequest(tenantId, requestId);
    if (!['pending_key', 'pending_csr'].includes(request.status)) return request;
    return this.repository.saveRequest({
      ...request,
      status: 'pending_csr',
      failureCode: outcome === 'UNKNOWN' ? 'AGENT_EXECUTION_UNKNOWN' : 'AGENT_EXECUTION_FAILED',
      failureMessage: errorMessage,
      updatedAt: new Date().toISOString(),
    });
  }

  async listRequests(tenantId: string): Promise<CertificateRequestEntity[]> {
    const requests = await this.repository.listRequests(tenantId);
    return Promise.all(requests.map(async (request) => {
      const key = await this.repository.getKeyReference(tenantId, request.keyReferenceId);
      if (!key) return request;
      return {
        ...request,
        // 仅返回公开密钥治理摘要；SecretRef、密钥材料和托管密文永不进入列表响应。
        keyReferenceSummary: {
          custodyMode: key.custodyMode,
          backendType: key.backendType,
          exportability: key.exportability,
          protectionLevel: key.protectionLevel,
          publicKeyFingerprintSha256: key.publicKeyFingerprintSha256,
        },
      };
    }));
  }

  getRequestByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<CertificateRequestEntity | undefined> {
    return this.repository.getRequestByIdempotencyKey(tenantId, idempotencyKey);
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
    structuredLogger.info('证书签发任务开始处理', {
      requestId,
      tenantId,
      caId: request.caId,
      applicationAssetId: request.applicationAssetId,
      providerRequestId: request.providerRequestId,
      status: request.status,
    }, { module: 'internal-ca', resourceType: 'certificateRequest', resourceId: requestId, tenantId });
    if (['issued', 'deploying', 'active'].includes(request.status)) {
      // 已签发但部署计划曾因缺少目标/Workflow 而阻断时，显式重试入口仍应
      // 能恢复部署编排；已存在计划则直接返回，保证同一申请不产生第二份计划。
      if (!request.deploymentPlanId && this.managedSecretIssuedHandler) {
        const keyReference = await this.repository.getKeyReference(tenantId, request.keyReferenceId);
        if (keyReference?.custodyMode === 'managed_secret') {
          return this.handleIssuedLifecycle({ tenantId, request, keyCustodyMode: keyReference.custodyMode, actorId, context });
        }
      }
      return request;
    }
    if (!['approved', 'issue_failed'].includes(request.status)) throw new AppError('RESOURCE_VERSION_CONFLICT', '证书申请尚未批准', { status: request.status });
    const authority = await this.requireAuthority(tenantId, request.caId);
    const provider = await this.requireProvider(tenantId, authority.providerId);
    const actionBinding = request.providerActionBindingId ? await this.repository.getProviderActionBinding(tenantId, request.providerActionBindingId) : undefined;
    if (request.deferIssuance === true && provider.type === 'acme') throw new AppError('ACME_ORDER_REQUIRED', 'ACME 证书申请必须通过 Order 生命周期完成签发');
    const profileVersion = await this.repository.getProfileVersion(request.profileVersionId);
    const keyReference = await this.repository.getKeyReference(tenantId, request.keyReferenceId);
    if (!profileVersion || !keyReference) throw new AppError('RESOURCE_NOT_FOUND', '证书申请依赖对象不存在');
    // 历史 ADCS 专属申请可能在 SAN 修复前以空数组落库；主域名本身必须进入 SAN，
    // 否则插件 Provider 会在执行阶段拒绝整个申请。回写后继续沿用原幂等申请。
    const effectiveSans = provider.type !== 'acme' && request.sans.length === 0
      ? [request.subjectCommonName]
      : request.sans;
    const effectiveRequest = effectiveSans === request.sans
      ? request
      : await this.repository.saveRequest({ ...request, sans: effectiveSans, updatedAt: new Date().toISOString() });
    const ledgerRecord = provider.type === 'gcac_builtin'
      ? await this.reserveIssuanceRecord(tenantId, { caId: authority.id, certificateRequestId: effectiveRequest.id, applicationAssetId: effectiveRequest.applicationAssetId, subjectCommonName: effectiveRequest.subjectCommonName, sans: effectiveRequest.sans })
      : await this.repository.getIssuanceByRequest(tenantId, request.id);
    await this.repository.saveRequest({ ...effectiveRequest, status: 'issuing', updatedAt: new Date().toISOString() });
    try {
      const issued = await this.providers.get(provider.type).signCsr({
        provider,
        authority,
        csrPem: effectiveRequest.csrPem,
        subject: effectiveRequest.subjectCommonName,
        sans: effectiveRequest.sans,
        validityDays: effectiveRequest.requestedValidityDays,
        profileRules: profileVersion.rules,
        idempotencyKey: effectiveRequest.idempotencyKey,
        actorId,
        serialNumber: provider.type === 'gcac_builtin' ? ledgerRecord?.serialNumber : undefined,
        actionBinding,
      });
      structuredLogger.info('CA Provider 返回签发结果', {
        requestId,
        tenantId,
        providerType: provider.type,
        providerRequestId: issued.providerRequestId,
        status: issued.status,
      }, { module: 'internal-ca', resourceType: 'certificateRequest', resourceId: requestId, tenantId });
      if (issued.status !== 'issued') return this.saveNonFinalIssuance(effectiveRequest, issued);
      const completed = await this.completeIssuedRequest(effectiveRequest, issued, provider, authority, keyReference, actorId, context);
      return this.handleIssuedLifecycle({ tenantId, request: completed, keyCustodyMode: keyReference.custodyMode, actorId, context });
    } catch (error) {
      structuredLogger.warn('证书签发任务失败', {
        requestId,
        tenantId,
        providerType: provider.type,
        error: error instanceof Error ? error.message : String(error),
      }, { module: 'internal-ca', resourceType: 'certificateRequest', resourceId: requestId, tenantId });
      if (ledgerRecord && ledgerRecord.status !== 'issued') await this.repository.saveIssuanceRecord({ ...ledgerRecord, status: 'failed', updatedAt: new Date().toISOString() });
      await this.repository.saveRequest({
        ...effectiveRequest,
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
    const actionBinding = request.providerActionBindingId ? await this.repository.getProviderActionBinding(tenantId, request.providerActionBindingId) : undefined;
    const result = await adapter.queryIssuance({ authority, provider, providerRequestId: request.providerRequestId, actorId, actionBinding, idempotencyKey: request.idempotencyKey });
    if (result.status !== 'issued') return this.saveNonFinalIssuance(request, result);
    const completed = await this.completeIssuedRequest(request, result, provider, authority, keyReference, actorId, context);
    return this.handleIssuedLifecycle({ tenantId, request: completed, keyCustodyMode: keyReference.custodyMode, actorId, context });
  }

  private async handleIssuedLifecycle(input: {
    tenantId: string;
    request: CertificateRequestEntity;
    keyCustodyMode: KeyReferenceEntity['custodyMode'];
    actorId: string;
    context?: RequestContext;
  }): Promise<CertificateRequestEntity> {
    // 全局历史 ACME 申请没有应用资产，不能误建应用级部署计划或策略状态。
    if (!input.request.applicationAssetId) return input.request;
    const handler = input.keyCustodyMode === 'local_agent'
      ? this.localAgentIssuedHandler
      : input.keyCustodyMode === 'managed_secret'
        ? this.managedSecretIssuedHandler
        : undefined;
    if (!handler) return input.request;
    try {
      const result = await handler({ tenantId: input.tenantId, request: input.request, actorId: input.actorId, context: input.context });
      if (!result) return input.request;
      return this.repository.saveRequest({ ...input.request, ...result, updatedAt: new Date().toISOString() });
    } catch (error) {
      // 证书已由 CA 签发；部署编排失败不能回滚签发事实或伪装成 issue_failed。
      return this.repository.saveRequest({
        ...input.request,
        failureCode: input.keyCustodyMode === 'local_agent' ? 'AGENT_INSTALL_TASK_ENQUEUE_FAILED' : 'MANAGED_DEPLOYMENT_PLAN_CREATE_FAILED',
        failureMessage: redactLifecycleError(error),
        ...(input.keyCustodyMode === 'managed_secret' ? {
          deploymentPlanStatus: 'failed',
          deploymentWarnings: [redactLifecycleError(error)],
        } : {}),
        updatedAt: new Date().toISOString(),
      });
    }
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
    const completed = await this.completeIssuedRequest(request, {
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
    // ACME 与内置 CA 必须共享同一条“签发完成→标准部署计划”生命周期入口。
    return this.handleIssuedLifecycle({ tenantId, request: completed, keyCustodyMode: keyReference.custodyMode, actorId, context });
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
    const normalizedReason = requiredText(reason, 'reason');
    const existing = (await this.repository.listRevocations(tenantId)).find((item) => (
      item.certificateVersionId === certificateVersionId
      && item.reason === normalizedReason
      && !['failed'].includes(item.status)
    ));
    if (existing) return existing;
    const now = new Date().toISOString();
    const policy = await this.certificatePolicies.ensureDefault(tenantId, actorId);
    const requiresApproval = policy.version.rules.strictEnforcement && policy.version.rules.revocationApprovalRequired;
    const approval = requiresApproval ? await this.dependencies.approvals?.create({
      operationType: 'certificate.revoke',
      resourceRefs: [{ type: 'certificate_version', id: certificateVersionId }],
      riskLevel: 'critical',
      parameters: { certificateVersionId, caId: authority.id, serialNumber: version.serialNumber, reason: normalizedReason },
      requestedBy: actorId,
    }, context) : undefined;
    const created = await this.repository.saveRevocation({
      id: newId('revoke'), tenantId, certificateVersionId, caId: authority.id, trustDomainId: authority.trustDomainId,
      reason: normalizedReason, status: requiresApproval ? 'pending_approval' : 'approved', requestedBy: actorId, approvalId: approval?.id,
      warnings: [], createdAt: now, updatedAt: now,
    });
    return requiresApproval ? created : this.executeRevocation(created, version.serialNumber, actorId, context);
  }

  listRevocations(tenantId: string): Promise<CertificateRevocationEntity[]> {
    return this.repository.listRevocations(tenantId);
  }

  async refreshRevocation(tenantId: string, revocationId: string, actorId: string): Promise<CertificateRevocationEntity> {
    const revocation = (await this.repository.listRevocations(tenantId)).find((item) => item.id === revocationId);
    if (!revocation) throw new AppError('RESOURCE_NOT_FOUND', '证书吊销任务不存在', { revocationId });
    if (revocation.status === 'revoked') {
      // 兼容旧版本已将吊销账本写成 revoked、但尚未同步证书库版本的历史记录。
      const version = await this.dependencies.certificates.getRepository().getVersion(revocation.certificateVersionId, tenantId);
      if (version && version.status !== 'revoked') {
        await this.dependencies.certificates.revokeVersion({
          id: revocation.certificateVersionId,
          status: 'revoked',
          actorId,
          tenantId,
        });
      }
      return this.repository.saveRevocation({ ...revocation, warnings: [], updatedAt: new Date().toISOString() });
    }
    if (!['failed', 'unknown', 'revoking'].includes(revocation.status)) {
      throw new AppError('RESOURCE_VERSION_CONFLICT', '证书吊销任务当前不可查询', { status: revocation.status });
    }
    const version = await this.dependencies.certificates.getRepository().getVersion(revocation.certificateVersionId, tenantId);
    if (!version?.serialNumber) throw new AppError('RESOURCE_NOT_FOUND', '证书版本不存在或缺少序列号', { certificateVersionId: revocation.certificateVersionId });
    return this.executeRevocation({ ...revocation, status: 'approved' }, version.serialNumber, actorId);
  }

  async approveRevocation(tenantId: string, revocationId: string, approvalId: string, actorId: string): Promise<CertificateRevocationEntity> {
    const revocation = (await this.repository.listRevocations(tenantId)).find((item) => item.id === revocationId);
    if (!revocation) throw new AppError('RESOURCE_NOT_FOUND', '证书吊销任务不存在', { revocationId });
    if (revocation.status !== 'pending_approval') throw new AppError('RESOURCE_VERSION_CONFLICT', '证书吊销任务当前不在待审批状态', { status: revocation.status });
    if (!revocation.approvalId || revocation.approvalId !== approvalId) throw new AppError('DEPLOYMENT_APPROVAL_REQUIRED', '证书吊销任务需要匹配的审批单');
    const version = await this.dependencies.certificates.getRepository().getVersion(revocation.certificateVersionId, tenantId);
    if (!version) throw new AppError('RESOURCE_NOT_FOUND', '证书版本不存在', { certificateVersionId: revocation.certificateVersionId });
    await this.dependencies.approvals?.consume(approvalId, {
      certificateVersionId: revocation.certificateVersionId,
      caId: revocation.caId,
      serialNumber: version.serialNumber,
      reason: revocation.reason,
    }, tenantId);
    return this.executeRevocation({ ...revocation, status: 'approved' }, version.serialNumber, actorId);
  }

  async publishCrl(tenantId: string, caId: string, actorId: string): Promise<CaCrlPublicationEntity> {
    const authority = await this.requireAuthority(tenantId, caId);
    const provider = await this.requireProvider(tenantId, authority.providerId);
    const adapter = this.providers.get(provider.type);
    if (!adapter.publishCrl) throw new AppError('CA_CRL_UNSUPPORTED', '当前 CA Provider 不支持 CRL 发布');
    const actionBinding = provider.type === 'plugin' ? await this.repository.getActiveProviderActionBinding(tenantId, provider.id) : undefined;
    const crlNumber = await this.repository.allocateCrlNumber(tenantId, caId);
    const now = new Date();
    const thisUpdate = now.toISOString();
    const nextUpdate = new Date(now.getTime() + 7 * 86400000).toISOString();
    try {
      const material = await adapter.publishCrl({
        provider,
        authority,
        issuanceRecords: await this.repository.listIssuanceRecords(tenantId, caId),
        crlNumber,
        actorId,
        actionBinding,
      });
      const materialThisUpdate = Date.parse(material.thisUpdate);
      const materialNextUpdate = Date.parse(material.nextUpdate);
      if (!Number.isFinite(materialThisUpdate) || !Number.isFinite(materialNextUpdate) || materialNextUpdate <= materialThisUpdate) {
        throw new AppError('CA_CRL_PUBLICATION_FAILED', 'CA 返回的 CRL 有效窗口无效', {
          thisUpdate: material.thisUpdate,
          nextUpdate: material.nextUpdate,
        });
      }
      if (material.signatureVerified !== true || !material.crlDerBase64.trim() || !material.crlPem.trim()) {
        throw new AppError('CA_CRL_PUBLICATION_FAILED', 'CA 返回的 CRL 缺少可验证签名制品');
      }
      return this.repository.saveCrlPublication({
        id: newId('crlpub'), tenantId, caId, crlNumber: material.crlNumber,
        thisUpdate: new Date(materialThisUpdate).toISOString(),
        nextUpdate: new Date(materialNextUpdate).toISOString(),
        distributionPoint: authority.crlDistributionPoint, crlPem: material.crlPem, crlDerBase64: material.crlDerBase64,
        crlFingerprintSha256: material.crlFingerprintSha256, revokedSerialNumbers: material.revokedSerialNumbers,
        publicationStatus: 'published', verification: {
          signatureVerified: material.signatureVerified, issuerFingerprintSha256: material.issuerFingerprintSha256,
          serialsVerified: true, source: provider.type === 'gcac_builtin' ? 'openssl' : 'external',
        }, createdAt: thisUpdate,
      });
    } catch (error) {
      return this.repository.saveCrlPublication({
        id: newId('crlpub'), tenantId, caId, crlNumber, thisUpdate, nextUpdate,
        distributionPoint: authority.crlDistributionPoint, crlPem: '', crlDerBase64: '', crlFingerprintSha256: '',
        revokedSerialNumbers: [], publicationStatus: 'failed', verification: {
          signatureVerified: false, serialsVerified: false, source: provider.type === 'gcac_builtin' ? 'openssl' : 'external',
        }, errorCode: error instanceof AppError ? error.errorCode : 'CA_CRL_PUBLICATION_FAILED',
        errorMessage: error instanceof Error ? error.message : String(error), createdAt: thisUpdate,
      });
    }
  }

  listCrlPublications(tenantId: string, caId?: string): Promise<CaCrlPublicationEntity[]> {
    return this.repository.listCrlPublications(tenantId, caId);
  }

  /**
   * 返回证书 CDP 使用的 DER CRL。该读取端不经过控制台权限，
   * 但仍以租户/CA 路径精确定位，并且只允许已签名发布的制品。
   */
  async getPublicCrl(tenantId: string, caId: string, format: 'der' | 'pem' = 'der'): Promise<{
    body: Buffer;
    contentType: string;
    etag: string;
    crlNumber: number;
  }> {
    const authority = await this.repository.getAuthority(tenantId, caId);
    if (!authority) throw new AppError('RESOURCE_NOT_FOUND', 'CRL 对应的 CA 不存在', { caId });
    const publication = await this.repository.getPublicCrlPublication(tenantId, caId);
    if (!publication) throw new AppError('RESOURCE_NOT_FOUND', 'CA 尚未发布可读取的 CRL', { caId });
    const normalizedFormat = format === 'pem' ? 'pem' : 'der';
    const body = normalizedFormat === 'pem'
      ? Buffer.from(publication.crlPem, 'utf8')
      : Buffer.from(publication.crlDerBase64, 'base64');
    return {
      body,
      contentType: normalizedFormat === 'pem' ? 'application/pkix-crl; charset=us-ascii' : 'application/pkix-crl',
      etag: `"${publication.crlFingerprintSha256}"`,
      crlNumber: publication.crlNumber,
    };
  }

  private async executeRevocation(revocation: CertificateRevocationEntity, serialNumber: string, actorId: string, context?: RequestContext): Promise<CertificateRevocationEntity> {
    const authority = await this.requireAuthority(revocation.tenantId, revocation.caId);
    const provider = await this.requireProvider(revocation.tenantId, authority.providerId);
    const adapter = this.providers.get(provider.type);
    if (!adapter.revoke) throw new AppError('CERTIFICATE_REVOCATION_UNSUPPORTED', '当前 CA Provider 不支持吊销');
    const revoking = await this.repository.saveRevocation({ ...revocation, status: 'revoking', updatedAt: new Date().toISOString() });
    try {
      const actionBinding = provider.type === 'plugin'
        ? await this.repository.getActiveProviderActionBinding(revocation.tenantId, provider.id)
        : undefined;
      const revoked = await adapter.revoke({ provider, authority, serialNumber, reason: revocation.reason, actorId, actionBinding, idempotencyKey: `revoke:${revocation.id}` });
      const issuance = await this.repository.getIssuanceByCertificateVersion(revocation.tenantId, revocation.certificateVersionId);
      if (issuance) await this.repository.saveIssuanceRecord({ ...issuance, status: 'revoked', revocationReason: revocation.reason, revokedAt: revoked.revokedAt, updatedAt: revoked.revokedAt, observedAt: revoked.revokedAt });
      // CA 回执确认后必须同步证书库版本投影；CA 运维观测本身不会修改 pg_certificate_versions。
      await this.dependencies.certificates.revokeVersion({
        id: revocation.certificateVersionId,
        status: 'revoked',
        actorId,
        tenantId: revocation.tenantId,
      }, context);
      if (provider.type === 'gcac_builtin') {
        if (!authority.crlDistributionPoint) {
          return this.repository.saveRevocation({
            ...revoking,
            status: 'revoked_unpublished',
            revokedAt: revoked.revokedAt,
            warnings: ['CA 已记录吊销，但未配置 CDP，不能确认撤销传播'],
            updatedAt: new Date().toISOString(),
          });
        }
        const publication = await this.publishCrl(revocation.tenantId, revocation.caId, actorId);
        if (publication.publicationStatus !== 'published' || !publication.verification.signatureVerified || !publication.verification.serialsVerified) {
          return this.repository.saveRevocation({ ...revoking, status: 'revoked_unpublished', revokedAt: revoked.revokedAt, warnings: ['CA 已记录吊销，但 CRL 未完成签名/传播验证'], updatedAt: new Date().toISOString() });
        }
      }
      await this.audit('internal_ca.certificate.revoked', actorId, 'certificate.revoke', 'certificate_revocation', revocation.id, 'critical', context, { caId: authority.id, serialNumber });
      return this.repository.saveRevocation({ ...revoking, status: 'revoked', revokedAt: revoked.revokedAt, warnings: [], updatedAt: new Date().toISOString() });
    } catch (error) {
      const status: CertificateRevocationEntity['status'] = error instanceof AppError && error.errorCode === 'CA_PROVIDER_UNAVAILABLE' ? 'unknown' : 'failed';
      return this.repository.saveRevocation({ ...revoking, status, warnings: [error instanceof Error ? error.message : String(error)], updatedAt: new Date().toISOString() });
    }
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
        metadata: {
          ownerType: 'application_certificate',
          ...(input.applicationAssetId ? { applicationAssetId: input.applicationAssetId } : {}),
          ...(input.certificateAssetId ? { certificateAssetId: input.certificateAssetId } : {}),
        },
      }, context);
      const keyReference = await this.repository.saveKeyReference({
        id: newId('keyref'),
        tenantId,
        ownerType: 'application_certificate',
        ownerId: keyOwnerId(input),
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
      ownerId: keyOwnerId(input),
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
    publicCrlBaseUrl?: string,
  ): Promise<CertificateAuthorityEntity> {
    const now = new Date().toISOString();
    const authorityId = newId('ca');
    return this.repository.saveAuthority({
      id: authorityId,
      tenantId,
      name: requiredText(input.name, 'name'),
      role: 'root',
      topologyMode: 'external_managed',
      providerId: provider.id,
      trustDomainId,
      securityDomain: requiredText(input.securityDomain, 'securityDomain'),
      status: 'active',
      subjectCommonName: requiredText(input.commonName || input.name, 'commonName'),
      crlDistributionPoint: resolvePublicCrlDistributionPoint(publicCrlBaseUrl, tenantId, authorityId, input.crlDistributionPoint),
      configuration: structuredClone(input.configuration ?? {}),
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
    publicCrlBaseUrl?: string,
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
      crlDistributionPoint: resolvePublicCrlDistributionPoint(publicCrlBaseUrl, tenantId, intermediateId, input.crlDistributionPoint),
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
      ...(request.certificateAssetId ? { certificateAssetId: request.certificateAssetId } : {}),
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
      // 应用专属手动签发由 APPLICATION_CERTIFICATE_SUPPLY 父任务统一部署；
      // 后续自动签发逻辑需显式改为 true 才能进入自动化事件链。
      publishAutomationEvent: request.applicationCertificatePolicyVersionId ? false : undefined,
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
    const id = newId('catrust');
    const approval = this.dependencies.approvals
      ? await this.dependencies.approvals.create({
        tenantId,
        operationType: 'trust_distribution.publish',
        resourceRefs: [{ type: 'trust_distribution', id }],
        riskLevel: 'high',
        parameters: { distributionId: id, caId: authority.id, targetScope },
        requestedBy: actorId,
      }, context)
      : undefined;
    const entity = await this.repository.saveTrustDistribution({
      id, tenantId, caId: authority.id, trustDomainId: authority.trustDomainId,
      targetScope: structuredClone(targetScope), status: approval ? 'pending_approval' : 'approved', requestedBy: actorId,
      approvalId: approval?.id,
      createdAt: now, updatedAt: now,
    });
    await this.audit('internal_ca.trust_distribution.created', actorId, 'trust_distribution.create', 'trust_distribution', entity.id, 'high', context, {});
    return entity;
  }

  listTrustDistributions(tenantId: string): Promise<TrustDistributionEntity[]> {
    return this.repository.listTrustDistributions(tenantId);
  }

  async approveTrustDistribution(tenantId: string, distributionId: string, approvalId: string): Promise<TrustDistributionEntity> {
    const current = (await this.repository.listTrustDistributions(tenantId)).find((item) => item.id === distributionId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', '信任分发任务不存在', { distributionId });
    if (current.status !== 'pending_approval') throw new AppError('RESOURCE_VERSION_CONFLICT', '信任分发任务当前不在待审批状态', { status: current.status });
    if (!current.approvalId || current.approvalId !== approvalId) throw new AppError('DEPLOYMENT_APPROVAL_REQUIRED', '信任分发任务需要匹配的审批单');
    await this.dependencies.approvals?.consume(approvalId, {
      distributionId: current.id,
      caId: current.caId,
      targetScope: current.targetScope,
    }, tenantId);
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

  private async requireProviderActionBinding(tenantId: string, providerId: string): Promise<ProviderActionBindingEntity> {
    const binding = await this.repository.getActiveProviderActionBinding(tenantId, providerId);
    if (!binding || binding.status === 'disabled') {
      throw new AppError('CA_PROVIDER_ACTION_UNBOUND', '外部 CA Provider 未绑定可执行的固定动作', { providerId });
    }
    return binding;
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

  private async audit(eventType: string, actorId: string, action: string, resourceType: string, resourceId: string, riskLevel: 'high' | 'critical', context: RequestContext | undefined, detail: Record<string, unknown>): Promise<void> {
    const actorType: ActorType = actorId === 'system' ? 'system' : 'user';
    await this.dependencies.audit?.write({ eventType, actorType, actorId, action, resourceType, resourceId, result: 'success', riskLevel, context, failClosed: true, detail });
  }
}

function providerChangedFields(before: CaProviderEntity, after: CaProviderEntity): string[] {
  const fields = ['name', 'type', 'deploymentMode', 'runtimePlatform', 'availabilityMode', 'endpoint', 'status'] as const;
  const changed = fields.filter((field) => stableJson(before[field]) !== stableJson(after[field])).map(String);
  const configurationKeys = new Set([...Object.keys(before.configuration ?? {}), ...Object.keys(after.configuration ?? {})]);
  for (const key of configurationKeys) {
    if (stableJson(before.configuration?.[key]) !== stableJson(after.configuration?.[key])) changed.push(`configuration.${key}`);
  }
  if (stableJson(before.credentialSecretRef) !== stableJson(after.credentialSecretRef)) changed.push('credentialSecretRef');
  return changed.sort();
}

function providerCreatedFields(provider: CaProviderEntity): string[] {
  return [
    'name',
    'type',
    'deploymentMode',
    'runtimePlatform',
    'availabilityMode',
    ...(provider.endpoint ? ['endpoint'] : []),
    ...(provider.credentialSecretRef ? ['credentialSecretRef'] : []),
    'status',
    ...Object.keys(provider.configuration ?? {}).sort().map((key) => `configuration.${key}`),
  ];
}

function providerAuditSnapshot(provider: CaProviderEntity): Record<string, unknown> {
  return {
    id: provider.id,
    name: provider.name,
    type: provider.type,
    deploymentMode: provider.deploymentMode,
    runtimePlatform: provider.runtimePlatform,
    availabilityMode: provider.availabilityMode,
    endpoint: redactProviderString(provider.endpoint),
    credentialSecretRef: provider.credentialSecretRef ? '[REDACTED]' : undefined,
    status: provider.status,
    configuration: redactProviderValue(provider.configuration),
  };
}

function redactProviderValue(value: unknown, key?: string): unknown {
  if (key && /secret|password|token|private.?key|api.?key|authorization|cookie|credential/i.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return redactProviderString(value);
  if (Array.isArray(value)) return value.map((item) => redactProviderValue(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactProviderValue(entryValue, entryKey)]));
}

function redactProviderString(value: string | undefined): string | undefined {
  if (!value) return value;
  return value
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/(password|passwd|token|secret|api[-_]?key)=([^&\s]+)/gi, '$1=[REDACTED]');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function readAgentInstallEvidence(detail?: Record<string, unknown>): {
  localKeyRef?: string;
  publicKeyFingerprintSha256?: string;
  certificateFingerprintSha256?: string;
  privateKeyTransported?: boolean;
} | undefined {
  if (!detail) return undefined;
  const candidates: unknown[] = [detail];
  if (Array.isArray(detail.operationResults)) candidates.push(...detail.operationResults);
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const value = candidate as Record<string, unknown>;
    if (value.operationType !== undefined && value.operationType !== 'certificate.install_issued') continue;
    // Agent v2 通常把证据放在 operationResults 子项中。顶层 detail
    // 只有聚合字段时不能提前返回空证据，否则会掩盖真实安装回执。
    const hasEvidence = ['localKeyRef', 'publicKeyFingerprintSha256', 'certificateFingerprintSha256', 'privateKeyTransported']
      .some((field) => Object.prototype.hasOwnProperty.call(value, field));
    if (!hasEvidence && Array.isArray(value.operationResults)) continue;
    return {
      ...(typeof value.localKeyRef === 'string' ? { localKeyRef: value.localKeyRef } : {}),
      ...(typeof value.publicKeyFingerprintSha256 === 'string' ? { publicKeyFingerprintSha256: value.publicKeyFingerprintSha256 } : {}),
      ...(typeof value.certificateFingerprintSha256 === 'string' ? { certificateFingerprintSha256: value.certificateFingerprintSha256 } : {}),
      ...(typeof value.privateKeyTransported === 'boolean' ? { privateKeyTransported: value.privateKeyTransported } : {}),
    };
  }
  return undefined;
}

function assertProviderCombination(provider: CaProviderEntity): void {
  if (provider.deploymentMode === 'builtin' && provider.type !== 'gcac_builtin') throw new AppError('CA_TOPOLOGY_INVALID', '内置部署必须使用 gcac_builtin Provider');
  if (provider.deploymentMode === 'external' && provider.type === 'gcac_builtin') throw new AppError('CA_TOPOLOGY_INVALID', '外部部署不能使用 GCAC 内置 Provider');
}

function normalizeProviderAction(
  value: ProviderActionBindingEntity['issueAction'] | undefined,
  field: string,
): ProviderActionBindingEntity['issueAction'] {
  if (!value) throw new AppError('VALIDATION_FAILED', `${field} 不能为空`, { field });
  const inputSchemaDigest = optionalText(value.inputSchemaDigest);
  const outputSchemaDigest = optionalText(value.outputSchemaDigest);
  return {
    actionId: requiredText(value.actionId, `${field}.actionId`),
    actionVersion: requiredText(value.actionVersion, `${field}.actionVersion`),
    ...(inputSchemaDigest ? { inputSchemaDigest } : {}),
    ...(outputSchemaDigest ? { outputSchemaDigest } : {}),
  };
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
    requireApproval: input.requireApproval ?? false,
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

function redactLifecycleError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gi, '[REDACTED_PRIVATE_KEY]')
    .replace(/(?:password|passphrase|secret|token)\s*[:=]\s*[^,;\s]+/gi, '$1=[REDACTED]');
}

function sanitizeProvider(provider: CaProviderEntity): Omit<CaProviderEntity, 'credentialSecretRef'> {
  const { credentialSecretRef, ...safe } = provider;
  void credentialSecretRef;
  return safe;
}

function sanitizeAuthority(authority: CertificateAuthorityEntity): Omit<CertificateAuthorityEntity, 'privateKeySecretRef'> {
  const { privateKeySecretRef, ...safe } = authority;
  void privateKeySecretRef;
  if (!safe.configuration) return safe;
  const { credentialSecretRef, ...configuration } = safe.configuration;
  void credentialSecretRef;
  return { ...safe, configuration };
}

function requiredText(value: string, field: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new AppError('VALIDATION_FAILED', `${field} 不能为空`, { field });
  return normalized;
}

function optionalText(value?: string): string | undefined {
  return value?.trim() || undefined;
}

function resolveAdcsAuthorityReuse(
  input: CreateAuthorityInput,
  provider: CaProviderEntity,
  authorities: CertificateAuthorityEntity[],
): { authority?: CertificateAuthorityEntity; identity?: string; error?: AppError } {
  if (!isMicrosoftAdcsProvider(provider)) return {};
  const related = authorities.filter((authority) => (
    authority.providerId === provider.id
    && authority.topologyMode === 'external_managed'
  ));
  if (related.length === 0) return {};

  const identity = adcsAuthorityIdentity(input.configuration, provider.configuration);
  if (identity) {
    const matching = related.filter((item) => (
      ['active', 'retired'].includes(item.status)
      && adcsAuthorityIdentity(item.configuration, provider.configuration) === identity
    ));
    // 已存在活动记录时保持原记录幂等；只有没有活动记录时才恢复退休记录，避免制造两个活动 CA。
    const authority = matching.find((item) => item.status === 'active')
      ?? matching.find((item) => item.status === 'retired');
    if (authority) return { authority, identity };
    // 历史版本可能只保存了 CA 名称，没有稳定 caConfig。若当前 Provider
    // 只有一条无身份登记，补上 caConfig 并复用它，避免删除后重建产生第二条 CA。
    const inputAgentId = textValue(input.configuration?.agentId) ?? textValue(provider.configuration.agentId);
    const inputAgentKey = textValue(input.configuration?.agentKey) ?? textValue(provider.configuration.agentKey);
    const unqualified = related.filter((item) => {
      if (!['active', 'retired'].includes(item.status) || adcsAuthorityIdentity(item.configuration, provider.configuration)) return false;
      const itemAgentId = textValue(item.configuration?.agentId);
      const itemAgentKey = textValue(item.configuration?.agentKey);
      // 没有任何 Agent 身份时无法证明两个无 caConfig 记录是同一 CA，
      // 必须保留原有“显式 caConfig 才能创建第二条”的行为。
      if (!inputAgentId && !inputAgentKey) return false;
      return (!itemAgentId || itemAgentId === inputAgentId)
        && (!itemAgentKey || itemAgentKey === inputAgentKey);
    });
    if (unqualified.length === 1) return { authority: unqualified[0], identity };
    if (unqualified.length > 1) {
      return {
        error: new AppError('CA_TOPOLOGY_INVALID', 'Microsoft AD CS Provider 存在多个未标识的历史 CA，无法安全自动归并', {
          providerId: provider.id,
          existingAuthorityIds: unqualified.map((item) => item.id),
          caConfig: identity,
        }),
      };
    }
    return {};
  }
  if (related.length === 1 && ['active', 'retired'].includes(related[0]!.status)) {
    return { authority: related[0], identity: adcsAuthorityIdentity(related[0].configuration, provider.configuration) };
  }
  return {
    error: new AppError('CA_TOPOLOGY_INVALID', 'Microsoft AD CS Provider 已关联多个历史或活动 CA，请填写唯一的 caConfig 后再创建', {
      providerId: provider.id,
      existingAuthorityIds: related.map((authority) => authority.id),
    }),
  };
}

function isMicrosoftAdcsProvider(provider?: CaProviderEntity): boolean {
  if (!provider || provider.type !== 'plugin') return false;
  return normalizeAdcsProviderKind(provider.configuration.providerKind) === 'microsoft_adcs'
    || textValue(provider.configuration.profile)?.toLowerCase() === 'windows.agent_plan.adcs'
    || provider.runtimePlatform === 'windows';
}

function isAdcsProviderCandidate(
  provider: CaProviderEntity,
  input: { agentId: string; agentKey: string },
  normalizedName: string,
): boolean {
  if (provider.type !== 'plugin') return false;
  const configuration = provider.configuration ?? {};
  if (normalizeAdcsProviderKind(configuration.providerKind) === 'microsoft_adcs') return true;
  if (textValue(configuration.profile)?.toLowerCase() === 'windows.agent_plan.adcs') return true;
  if (textValue(configuration.agentId) === input.agentId || textValue(configuration.agentKey) === input.agentKey) return true;
  // 旧版本手工创建的 Provider 可能只有名称、外部 Windows 平台和插件类型。
  // 名称是租户内唯一键，命中后自动迁移为 AD CS Provider。
  return provider.deploymentMode === 'external'
    && provider.runtimePlatform === 'windows'
    && provider.name.trim().toLowerCase() === normalizedName;
}

function normalizeAdcsProviderKind(value: unknown): string | undefined {
  return textValue(value)?.toLowerCase().replaceAll('-', '_');
}

function adcsAuthorityIdentity(
  authorityConfiguration: Record<string, unknown> | undefined,
  providerConfiguration: Record<string, unknown>,
): string | undefined {
  const authorityValue = authorityConfiguration?.caConfig;
  const providerValue = providerConfiguration.caConfig;
  const value = textValue(authorityValue) ?? textValue(providerValue);
  return value?.toLowerCase();
}

function sameExternalObservation(left: ExternalCaObservationEntity, right: ExternalCaObservationEntity): boolean {
  return left.externalParentId === right.externalParentId
    && left.normalizedStatus === right.normalizedStatus
    && left.sourceStatus === right.sourceStatus
    && left.sourceRevision === right.sourceRevision
    && left.subjectCommonName === right.subjectCommonName
    && left.serialNumber === right.serialNumber
    && left.templateExternalId === right.templateExternalId
    && left.requestedByDisplay === right.requestedByDisplay
    && left.submittedAt === right.submittedAt
    && left.issuedAt === right.issuedAt
    && left.revokedAt === right.revokedAt
    && left.notBefore === right.notBefore
    && left.notAfter === right.notAfter
    && JSON.stringify(left.rawSummary) === JSON.stringify(right.rawSummary)
    && left.observedAt === right.observedAt;
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

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === '23505'
    || (typeof candidate.message === 'string' && candidate.message.includes('unique constraint'));
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

/** 内置 CA 的 CRL 只能指向控制面实际提供的匿名 CRL 服务，禁止从管理表单写入任意地址。 */
function resolvePublicCrlDistributionPoint(
  publicBaseUrl: string | undefined,
  tenantId: string,
  authorityId: string,
  fallback?: string,
): string | undefined {
  const baseUrl = normalizePublicServiceBaseUrl(publicBaseUrl ?? process.env.GCAC_PUBLIC_BASE_URL);
  if (!baseUrl) return optionalText(fallback);
  return `${baseUrl}/api/v1/public/ca-crl/${encodeURIComponent(tenantId)}/${encodeURIComponent(authorityId)}`;
}

function normalizePublicServiceBaseUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return parsed.origin.replace(/\/+$/u, '');
  } catch {
    return undefined;
  }
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '');
}

function normalizeProfilePatterns(values?: string[]): string[] {
  return uniqueStrings(values ?? []).map((pattern) => pattern.replace(/^\.+/, ''));
}

function normalizeProfilePriority(value?: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.max(0, Math.min(1000, Math.trunc(value!)));
}

function isSecretRef(value: string): boolean {
  return /^secret:\/\/[A-Za-z0-9._:/#-]{1,512}$/.test(value.trim());
}

function normalizeProfileEntity(profile: CertificateProfileEntity): CertificateProfileEntity {
  const legacySecurityDomain = profile.securityDomain?.trim().toLowerCase() || '*';
  // AD CS/插件 Profile 的旧数据可能把 providerType 写成具体 Provider 类型。
  // 应用供应策略只区分 ACME 与本产品管理的 CA，其余来源统一归一化为 internal_ca，
  // 这样选择微软 CA 时仍能按绑定的 Authority 解析到唯一当前版本。
  const providerType = String(profile.providerType ?? (legacySecurityDomain === 'acme' ? 'acme' : 'internal_ca')).trim().toLowerCase() === 'acme'
    ? 'acme'
    : 'internal_ca';
  return {
    ...profile,
    purpose: profile.purpose ?? 'https_server',
    providerType,
    securityDomain: legacySecurityDomain,
    domainPatterns: normalizeProfilePatterns(profile.domainPatterns),
    targetCapabilities: uniqueStrings(profile.targetCapabilities ?? []),
    isDefault: profile.isDefault === true,
    priority: normalizeProfilePriority(profile.priority),
  };
}

function matchesProfilePattern(domain: string, pattern: string): boolean {
  const normalized = normalizeDomain(pattern);
  if (!normalized || normalized === '*') return true;
  if (normalized.startsWith('*.')) return domain === normalized.slice(2) || domain.endsWith(`.${normalized.slice(2)}`);
  return domain === normalized;
}

function normalizeCertificateNames(values: string[]): string[] {
  return uniqueStrings(values.map((value) => value.replace(/\.$/, '')));
}

/** 只保留 Agent 证书安装的公开回执摘要，避免把 PEM、凭据或完整载荷写入申请事实。 */
function summarizeAgentCertificateEvidence(
  detail: Record<string, unknown> | undefined,
  errorCode?: string,
  errorMessage?: string,
): Record<string, unknown> | undefined {
  if (!detail && !errorCode && !errorMessage) return undefined;
  const evidence: Record<string, unknown> = {};
  for (const key of [
    'executionStatus',
    'certificateFingerprintSha256',
    'publicKeyFingerprintSha256',
    'storagePath',
    'keyStoragePath',
    'certificateThumbprint',
    'storeName',
    'storeLocation',
    'format',
    'privateKeyTransported',
  ]) {
    const value = detail?.[key];
    if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') evidence[key] = value;
  }
  const receipt = detail?.receipt;
  if (receipt && typeof receipt === 'object' && !Array.isArray(receipt)) {
    const source = receipt as Record<string, unknown>;
    const summary: Record<string, unknown> = {};
    for (const key of ['operationId', 'planId', 'planDigest', 'digest', 'agentId', 'tenantId', 'status', 'completedAt', 'agentKeyId']) {
      const value = source[key];
      if (typeof value === 'string') summary[key] = value;
    }
    if (Object.keys(summary).length > 0) evidence.receipt = summary;
  }
  if (errorCode) evidence.errorCode = errorCode;
  if (errorMessage) evidence.errorMessage = redactLifecycleError(errorMessage);
  return Object.keys(evidence).length > 0 ? evidence : undefined;
}

function sameAgentContext(
  left: NonNullable<CertificateRequestEntity['agentContext']>,
  right: NonNullable<CertificateRequestEntity['agentContext']>,
): boolean {
  return left.agentId === right.agentId
    && left.targetId === right.targetId
    && left.keyPath === right.keyPath
    && left.certificatePath === right.certificatePath
    && left.format === right.format
    && left.storageMode === right.storageMode
    && left.alias === right.alias
    && left.pluginId === right.pluginId
    && left.pluginVersionId === right.pluginVersionId;
}

function normalizeExportability(backend: KeyBackendType, requested?: KeyExportability): KeyExportability {
  if (backend === 'file' || backend === 'secret') return 'exportable';
  if (['hsm', 'kms', 'tpm', 'pkcs11'].includes(backend)) return requested === 'exportable' ? 'unknown' : 'non_exportable';
  return requested ?? 'unknown';
}

function keyOwnerId(input: Pick<CreateCertificateRequestInput, 'applicationAssetId' | 'certificateAssetId' | 'idempotencyKey' | 'commonName'>): string {
  if (input.applicationAssetId) return input.applicationAssetId;
  // 全局历史 ACME 没有应用资产；为其托管密钥使用独立命名空间，
  // 不把证书资产 ID 冒充为应用 ID。
  return `legacy-acme:${input.certificateAssetId ?? input.idempotencyKey ?? input.commonName}`;
}

function normalizeFingerprint(value: string): string {
  const normalized = value.replaceAll(':', '').trim().toLowerCase();
  if (!/^[0-9a-f]{32,128}$/.test(normalized)) throw new AppError('VALIDATION_FAILED', '公钥指纹格式无效');
  return normalized;
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

function normalizeObservationTime(value?: string): string {
  if (!value) return new Date().toISOString();
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new AppError('VALIDATION_FAILED', 'AD CS 观测时间无效');
  return new Date(parsed).toISOString();
}

function normalizeAgentObservation(input: AgentCaObservationBatchDto['records'][number]): Omit<ExternalCaObservationEntity, 'id' | 'tenantId' | 'providerId' | 'caId' | 'observedAt' | 'firstObservedAt' | 'createdAt' | 'updatedAt'> | undefined {
  const objectTypes = new Set(['request', 'issuance', 'revocation', 'template']);
  const statuses = new Set(['pending', 'issued', 'rejected', 'revoked', 'failed', 'unknown']);
  const objectType = input.objectType;
  const externalObjectId = String(input.externalObjectId ?? '').trim();
  if (!objectTypes.has(objectType) || !externalObjectId || externalObjectId.length > 512 || !statuses.has(input.normalizedStatus)) return undefined;
  const iso = (value?: string) => value && !Number.isNaN(Date.parse(value)) ? new Date(Date.parse(value)).toISOString() : undefined;
  const rawSummary: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input.rawSummary ?? {})) {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') rawSummary[key] = value;
  }
  return {
    objectType,
    externalObjectId,
    externalParentId: input.externalParentId?.trim() || undefined,
    normalizedStatus: input.normalizedStatus,
    sourceStatus: input.sourceStatus?.trim() || undefined,
    sourceRevision: input.sourceRevision?.trim() || undefined,
    subjectCommonName: input.subjectCommonName?.trim() || undefined,
    serialNumber: input.serialNumber?.trim() || undefined,
    templateExternalId: input.templateExternalId?.trim() || undefined,
    requestedByDisplay: input.requestedByDisplay?.trim() || undefined,
    submittedAt: iso(input.submittedAt),
    issuedAt: iso(input.issuedAt),
    revokedAt: iso(input.revokedAt),
    notBefore: iso(input.notBefore),
    notAfter: iso(input.notAfter),
    rawSummary,
  };
}
