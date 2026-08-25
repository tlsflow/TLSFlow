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
import { caOperationNormalizedStatuses, caOperationObjectTypes, type CaOperationsAdapterRegistry } from '../providers/ca-operations.js';
import { CaOperationsQueryRepository, type CaOperationProjectionCursor } from '../repository/ca-operations-query.repository.js';
import { InternalCaRepository } from '../repository/internal-ca.repository.js';
import type { CaOperationObjectType, CertificateAuthorityEntity } from '../schema/internal-ca.schema.js';

const allowedSources = ['gcac_native', 'external_sync', 'historical_backfill'] as const;

export class CaOperationsQueryService {
  private readonly queryRepository: CaOperationsQueryRepository;
  private readonly internalRepository: InternalCaRepository;

  constructor(
    db: DatabasePort,
    private readonly adapters?: CaOperationsAdapterRegistry,
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
    const visibleAuthorities: CaOperationsTreeAuthorityDto[] = [];
    for (const authority of authorities) {
      if (!(await canRead(authority))) continue;
      const provider = providerById.get(authority.providerId);
      if (!provider) continue;
      const counts = await this.queryRepository.countByObjectType(tenantId, authority.id);
      const views = supportedViews(provider.type, this.adapters).map((objectType) => ({ objectType, count: counts[objectType] }));
      visibleAuthorities.push({
        id: authority.id, name: authority.name, providerId: provider.id, providerName: provider.name,
        providerType: provider.type, status: authority.status, views,
      });
    }
    return {
      trustDomains: domains.map((domain) => ({
        id: domain.id, name: domain.name, status: domain.status,
        authorities: visibleAuthorities.filter((authority) => authorities.find((item) => item.id === authority.id)?.trustDomainId === domain.id),
      })).filter((domain) => domain.authorities.length > 0),
      unassignedAuthorities: visibleAuthorities.filter((authority) => !authorities.find((item) => item.id === authority.id)?.trustDomainId),
    };
  }

  async records(tenantId: string, query: CaOperationsRecordQueryDto): Promise<CaOperationRecordPageDto> {
    const normalized = normalizeQuery(query);
    const authority = await this.internalRepository.getAuthority(tenantId, normalized.caId);
    if (!authority) throw new AppError('RESOURCE_NOT_FOUND', '证书机构不存在', { caId: normalized.caId });
    const provider = await this.internalRepository.getProvider(tenantId, authority.providerId);
    if (!provider) throw new AppError('RESOURCE_NOT_FOUND', '证书机构 Provider 不存在', { caId: normalized.caId });
    if (!supportedViews(provider.type, this.adapters).includes(normalized.view)) {
      throw new AppError('CA_OPERATIONS_VIEW_UNSUPPORTED', '当前 CA 不支持此运营视图', { caId: normalized.caId, view: normalized.view });
    }
    const syncState = await this.queryRepository.latestSyncState(tenantId, normalized.caId, normalized.view);
    const integrity = resolveIntegrity(syncState.status);
    const rows = await this.queryRepository.queryRecords({
      tenantId, caId: normalized.caId, objectType: normalized.view, statuses: normalized.status,
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
      lastSuccessfulSyncAt: syncState.completedAt,
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
    const syncState = await this.queryRepository.latestSyncState(tenantId, row.caId, row.objectType);
    return { ...toRecordDto(row, resolveIntegrity(syncState.status)), auditReferences: [] };
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

function supportedViews(providerType: string, adapters?: CaOperationsAdapterRegistry): CaOperationObjectType[] {
  if (providerType === 'gcac_builtin') return [...caOperationObjectTypes];
  if (!adapters?.has(providerType as never)) return [];
  const capabilities = adapters.get(providerType as never).getOperationsCapabilities();
  return caOperationObjectTypes.filter((objectType) => (
    objectType === 'request' ? capabilities.listRequests
      : objectType === 'issuance' ? capabilities.listIssuedCertificates
        : objectType === 'revocation' ? capabilities.listRevokedCertificates
          : capabilities.listTemplates
  ));
}

function resolveIntegrity(status?: string): CaOperationIntegrity {
  if (status === 'queued' || status === 'running') return 'syncing';
  if (status === 'partial') return 'partial';
  if (status === 'failed') return 'failed';
  return 'complete';
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
