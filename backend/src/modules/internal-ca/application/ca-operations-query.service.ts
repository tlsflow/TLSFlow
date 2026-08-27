import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import type {
  CaOperationIntegrity,
  CaOperationRecordDto,
  CaOperationRecordDetailDto,
  CaOperationRecordPageDto,
  CaOperationsRecordQueryDto,
  CaOperationsTreeAuthorityDto,
  CaOperationsTreeDto,
} from '../dto/ca-operations.dto.js';
import { caOperationNormalizedStatuses, caOperationObjectTypes } from '../providers/ca-operations.js';
import { CaOperationsQueryRepository, type CaOperationProjectionCursor } from '../repository/ca-operations-query.repository.js';
import { InternalCaRepository } from '../repository/internal-ca.repository.js';
import type { CaOperationObjectType, CertificateAuthorityEntity } from '../schema/internal-ca.schema.js';
import { sameAdcsAuthorityIdentity } from './adcs-authority-identity.js';

const allowedSources = ['gcac_native', 'external_sync', 'historical_backfill'] as const;

export class CaOperationsQueryService {
  private readonly queryRepository: CaOperationsQueryRepository;
  private readonly internalRepository: InternalCaRepository;

  constructor(
    db: DatabasePort,
    queryRepository?: CaOperationsQueryRepository,
    internalRepository?: InternalCaRepository,
  ) {
    this.queryRepository = queryRepository ?? new CaOperationsQueryRepository(db);
    this.internalRepository = internalRepository ?? new InternalCaRepository(db);
  }

  async tree(tenantId: string, canRead: (authority: CertificateAuthorityEntity) => Promise<boolean>): Promise<CaOperationsTreeDto> {
    const [domains, authorities, providers] = await Promise.all([
      this.internalRepository.listTrustDomains(tenantId),
      this.internalRepository.listAuthorities(tenantId),
      this.internalRepository.listProviders(tenantId),
    ]);
    const providerById = new Map(providers.map((provider) => [provider.id, provider]));
    // 每个 CA 的计数都是本地投影查询。并行执行，避免 CA 数量增加后首屏时间线性叠加。
    const visibleAuthorities = (await Promise.all(authorities.map(async (authority): Promise<CaOperationsTreeAuthorityDto | undefined> => {
      // 已软删除的 CA 只保留给历史审计和精确查询，不能继续出现在运营资源树中。
      if (authority.status === 'retired') return undefined;
      if (!(await canRead(authority))) return undefined;
      const provider = providerById.get(authority.providerId);
      if (!provider) return undefined;
      const counts = await this.queryRepository.countByObjectType(tenantId, authority.id);
      const views = operationViews(provider.type, counts)
        .map((objectType) => ({ objectType, count: counts[objectType] }));
      return {
        id: authority.id, name: authority.name, providerId: provider.id, providerName: provider.name,
        providerType: String(provider.type), status: String(authority.status), views,
      };
    }))).filter((authority): authority is CaOperationsTreeAuthorityDto => Boolean(authority));
    const deduplicatedAuthorities = deduplicateExternalAuthorities(visibleAuthorities, authorities, providerById);
    return {
      trustDomains: domains.map((domain) => ({
        id: domain.id, name: domain.name, status: domain.status,
        authorities: deduplicatedAuthorities.filter((authority) => authorities.find((item) => item.id === authority.id)?.trustDomainId === domain.id),
      })).filter((domain) => domain.authorities.length > 0),
      unassignedAuthorities: deduplicatedAuthorities.filter((authority) => !authorities.find((item) => item.id === authority.id)?.trustDomainId),
    };
  }

  async records(tenantId: string, query: CaOperationsRecordQueryDto): Promise<CaOperationRecordPageDto> {
    const normalized = normalizeQuery(query);
    let authority = await this.internalRepository.getAuthority(tenantId, normalized.caId);
    if (!authority) throw new AppError('RESOURCE_NOT_FOUND', '证书机构不存在', { caId: normalized.caId });
    // 删除后重建的同一 AD CS CA 可能留下两个 Authority。优先使用已有观测事实最多的
    // 活动登记，使旧链接也能显示新 Agent 上报的数据，不要求人工改库。
    if (authority.topologyMode === 'external_managed') {
      const allAuthorities = await this.internalRepository.listAuthorities(tenantId);
      const providers = await this.internalRepository.listProviders(tenantId);
      const providerById = new Map(providers.map((provider) => [provider.id, provider]));
      const authorityProvider = providerById.get(authority.providerId);
      if (isMicrosoftAdcsProvider(authorityProvider)) {
        const candidates = allAuthorities.filter((item) => item.status !== 'retired'
          && item.topologyMode === 'external_managed'
          && isMicrosoftAdcsProvider(providerById.get(item.providerId))
          && sameAdcsAuthorityIdentity(authority!, item, providerById));
        let best = authority;
        let bestCount = -1;
        for (const candidate of candidates) {
          const counts = await this.queryRepository.countByObjectType(tenantId, candidate.id);
          const count = Object.values(counts).reduce((total, value) => total + value, 0);
          if (count > bestCount
            || (count === bestCount && candidate.updatedAt.localeCompare(best.updatedAt) > 0)) {
            best = candidate;
            bestCount = count;
          }
        }
        authority = best;
      }
    }
    const targetCaId = authority.id;
    const provider = await this.internalRepository.getProvider(tenantId, authority.providerId);
    if (!provider) throw new AppError('RESOURCE_NOT_FOUND', '证书机构 Provider 不存在', { caId: normalized.caId });
    // 运营适配器能力不再触发远程采集；已有原生/历史事实始终保留只读查询入口。
    // Agent 观测是事件驱动且幂等入库，数据页只反映当前观测投影。
    // 数据页只反映当前投影，避免把已经废弃的任务状态误显示为 CA 数据状态。
    const integrity: CaOperationIntegrity = 'complete';
    const rows = await this.queryRepository.queryRecords({
      tenantId, caId: targetCaId, objectType: normalized.view, statuses: normalized.status,
      sources: normalized.source, query: normalized.query, from: normalized.from, to: normalized.to,
      cursor: normalized.cursor ? decodeCursor(normalized.cursor) : undefined, limit: normalized.limit,
    });
    const hasNext = rows.length > normalized.limit;
    const pageRows = hasNext ? rows.slice(0, normalized.limit) : rows;
    return {
      items: pageRows.map((row) => toRecordDto(row, integrity)),
      nextCursor: hasNext && pageRows.length ? encodeCursor(pageRows[pageRows.length - 1]!) : undefined,
      total: rows[0]?.total ?? 0,
      integrity,
    };
  }

  async record(tenantId: string, recordKey: string): Promise<CaOperationRecordDetailDto> {
    if (!recordKey || recordKey.length > 512) throw new AppError('CA_OPERATIONS_QUERY_INVALID', 'CA 运营记录键无效');
    let row;
    try {
      row = await this.queryRepository.getRecord(tenantId, recordKey);
    } catch {
      throw new AppError('RESOURCE_NOT_FOUND', 'CA 运营记录不存在', { recordKey });
    }
    if (!row) throw new AppError('RESOURCE_NOT_FOUND', 'CA 运营记录不存在', { recordKey });
    return { ...toRecordDto(row, 'complete'), auditReferences: [] };
  }
}

function normalizeQuery(query: CaOperationsRecordQueryDto): Required<Pick<CaOperationsRecordQueryDto, 'caId' | 'view'>> & CaOperationsRecordQueryDto & { limit: number } {
  if (!query.caId?.trim() || !caOperationObjectTypes.includes(query.view)) {
    throw new AppError('CA_OPERATIONS_QUERY_INVALID', 'CA 运营查询缺少有效 CA 或视图');
  }
  if (query.status?.some((status) => !caOperationNormalizedStatuses.includes(status))) {
    throw new AppError('CA_OPERATIONS_QUERY_INVALID', 'CA 运营状态筛选无效');
  }
  if (query.source?.some((source) => !allowedSources.includes(source))) {
    throw new AppError('CA_OPERATIONS_QUERY_INVALID', 'CA 运营来源筛选无效');
  }
  if (query.query && query.query.length > 256) throw new AppError('CA_OPERATIONS_QUERY_INVALID', 'CA 运营关键字过长');
  if (query.from && Number.isNaN(Date.parse(query.from))) throw new AppError('CA_OPERATIONS_QUERY_INVALID', '起始时间无效');
  if (query.to && Number.isNaN(Date.parse(query.to))) throw new AppError('CA_OPERATIONS_QUERY_INVALID', '结束时间无效');
  if (query.from && query.to && Date.parse(query.from) > Date.parse(query.to)) throw new AppError('CA_OPERATIONS_QUERY_INVALID', '起始时间不能晚于结束时间');
  if (query.sort && query.sort !== 'observedAt:desc') throw new AppError('CA_OPERATIONS_QUERY_INVALID', 'CA 运营排序字段不受支持', { sort: query.sort });
  const limit = query.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new AppError('CA_OPERATIONS_QUERY_INVALID', 'CA 运营分页大小必须在 1 到 200 之间');
  return { ...query, caId: query.caId.trim(), limit };
}

function operationViews(
  providerType: string,
  counts: Record<CaOperationObjectType, number>,
): CaOperationObjectType[] {
  const supported = providerType === 'gcac_builtin' ? new Set(caOperationObjectTypes) : new Set<CaOperationObjectType>();
  // 外部 CA 只展示 Agent 已经观测到的事实；没有事实就不虚构可用视图。
  return caOperationObjectTypes.filter((objectType) => supported.has(objectType) || counts[objectType] > 0);
}

function deduplicateExternalAuthorities(
  authorities: CaOperationsTreeAuthorityDto[],
  entities: CertificateAuthorityEntity[],
  providers: Map<string, Awaited<ReturnType<InternalCaRepository['listProviders']>>[number]>,
): CaOperationsTreeAuthorityDto[] {
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const selected = new Map<string, CaOperationsTreeAuthorityDto>();
  const selectedEntities = new Map<string, CertificateAuthorityEntity>();
  for (const authority of authorities) {
    const entity = entityById.get(authority.id);
    const provider = providers.get(authority.providerId);
    const authorityConfig = entity?.configuration ?? {};
    const providerConfig = provider?.configuration ?? {};
    const adcs = entity?.topologyMode === 'external_managed'
      && provider?.type === 'plugin'
      && (String(providerConfig.providerKind ?? '').toLowerCase().replaceAll('-', '_') === 'microsoft_adcs'
        || String(providerConfig.profile ?? '').toLowerCase() === 'windows.agent_plan.adcs'
        || provider.runtimePlatform === 'windows');
    let key: string | undefined;
    if (adcs && entity) {
      for (const [candidateKey, candidateEntity] of selectedEntities.entries()) {
        if (sameAdcsAuthorityIdentity(entity, candidateEntity, providers)) {
          key = candidateKey;
          break;
        }
      }
    }
    if (!key) {
      const externalIdentity = String(
        authorityConfig.caConfig
        ?? providerConfig.caConfig
        ?? authorityConfig.agentId
        ?? providerConfig.agentId
        ?? authorityConfig.agentKey
        ?? providerConfig.agentKey
        ?? (adcs ? '' : authorityConfig.caName ?? authority.name),
      ).trim().toLowerCase();
      // AD CS 之外的外部 Provider 保持原有键规则；没有身份的 AD CS
      // 首次登记以 Authority 自身为键，后续由同一身份判断主动归并。
      key = adcs
        ? `external:adcs:${externalIdentity || authority.id}`
        : entity?.topologyMode === 'external_managed'
          ? `external:${provider?.type ?? authority.providerType}:${externalIdentity}`
          : `native:${authority.id}`;
    }
    const previous = selected.get(key);
    if (!previous || authorityViewCount(authority) > authorityViewCount(previous)) {
      selected.set(key, authority);
      if (entity && adcs) selectedEntities.set(key, entity);
    }
  }
  return [...selected.values()];
}

function authorityViewCount(authority: CaOperationsTreeAuthorityDto): number {
  return authority.views.reduce((total, view) => total + view.count, 0);
}

function isMicrosoftAdcsProvider(provider: Awaited<ReturnType<InternalCaRepository['listProviders']>>[number] | undefined): boolean {
  if (!provider || provider.type !== 'plugin') return false;
  const configuration = provider.configuration ?? {};
  return String(configuration.providerKind ?? '').toLowerCase().replaceAll('-', '_') === 'microsoft_adcs'
    || String(configuration.profile ?? '').toLowerCase() === 'windows.agent_plan.adcs'
    || provider.runtimePlatform === 'windows';
}

function toRecordDto(row: Awaited<ReturnType<CaOperationsQueryRepository['queryRecords']>>[number], integrity: CaOperationIntegrity): CaOperationRecordDto {
  return {
    recordKey: row.recordKey, objectType: row.objectType, source: row.source,
    gcacResource: row.gcacResourceType && row.gcacResourceId ? { type: row.gcacResourceType, id: row.gcacResourceId } : undefined,
    externalObject: row.providerId && row.externalObjectId ? { providerId: row.providerId, externalObjectId: row.externalObjectId } : undefined,
    caId: row.caId, normalizedStatus: row.normalizedStatus, sourceStatus: row.sourceStatus,
    display: {
      subjectCommonName: row.subjectCommonName, serialNumber: row.serialNumber,
      templateExternalId: row.templateExternalId, requestedByDisplay: row.requestedByDisplay,
    },
    observedAt: row.observedAt, integrity, allowedActions: [],
  };
}

function encodeCursor(row: { observedAt: string; recordKey: string }): string {
  return Buffer.from(JSON.stringify({ observedAt: row.observedAt, recordKey: row.recordKey }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): CaOperationProjectionCursor {
  if (cursor.length > 2048) throw new AppError('CA_OPERATIONS_QUERY_INVALID', 'CA 运营游标过长');
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<CaOperationProjectionCursor>;
    if (!value.observedAt || Number.isNaN(Date.parse(value.observedAt)) || !value.recordKey) throw new Error('invalid cursor');
    return { observedAt: value.observedAt, recordKey: value.recordKey };
  } catch {
    throw new AppError('CA_OPERATIONS_QUERY_INVALID', 'CA 运营游标无效');
  }
}
