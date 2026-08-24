import { AppError } from '../../../common/errors/app-error.js';
import type {
  CaOperationNormalizedStatus,
  CaOperationObjectType,
  CaProviderEntity,
  CertificateAuthorityEntity,
} from '../schema/internal-ca.schema.js';

export const caOperationObjectTypes = ['request', 'issuance', 'revocation', 'template'] as const;
export const caOperationNormalizedStatuses = ['pending', 'issued', 'rejected', 'revoked', 'failed', 'unknown'] as const;

export interface CaOperationsCapabilities {
  listRequests: boolean;
  listIssuedCertificates: boolean;
  listRevokedCertificates: boolean;
  listTemplates: boolean;
  synchronizeHistory: boolean;
  approvePendingRequest: boolean;
  denyPendingRequest: boolean;
  publishCrl: boolean;
}

export interface ListCaOperationRecordsInput {
  syncRunId?: string;
  provider: CaProviderEntity;
  authority: CertificateAuthorityEntity;
  objectType: CaOperationObjectType;
  cursor?: string;
  limit: number;
  changedAfter?: string;
}

export interface ExternalCaObservationInput {
  externalObjectId: string;
  externalParentId?: string;
  normalizedStatus: CaOperationNormalizedStatus;
  sourceStatus?: string;
  sourceRevision?: string;
  subjectCommonName?: string;
  serialNumber?: string;
  templateExternalId?: string;
  requestedByDisplay?: string;
  submittedAt?: string;
  issuedAt?: string;
  revokedAt?: string;
  notBefore?: string;
  notAfter?: string;
  rawSummary: Record<string, string | number | boolean | null>;
}

export interface CaOperationRecordBatch {
  records: ExternalCaObservationInput[];
  nextCursor?: string;
  complete: boolean;
  sourceWatermark?: string;
}

export interface CaOperationsAdapter {
  getOperationsCapabilities(): CaOperationsCapabilities;
  listOperationRecords(input: ListCaOperationRecordsInput): Promise<CaOperationRecordBatch>;
}

export class CaOperationsAdapterRegistry {
  private readonly adapters = new Map<CaProviderEntity['type'], CaOperationsAdapter>();

  register(type: CaProviderEntity['type'], adapter: CaOperationsAdapter): this {
    this.adapters.set(type, adapter);
    return this;
  }

  get(type: CaProviderEntity['type']): CaOperationsAdapter {
    const adapter = this.adapters.get(type);
    if (!adapter) {
      throw new AppError('CA_OPERATIONS_CAPABILITY_UNSUPPORTED', 'CA Provider 未实现运营查询适配器', { type });
    }
    return adapter;
  }

  has(type: CaProviderEntity['type']): boolean {
    return this.adapters.has(type);
  }
}

export function emptyCaOperationsCapabilities(): CaOperationsCapabilities {
  return {
    listRequests: false,
    listIssuedCertificates: false,
    listRevokedCertificates: false,
    listTemplates: false,
    synchronizeHistory: false,
    approvePendingRequest: false,
    denyPendingRequest: false,
    publishCrl: false,
  };
}

export function assertCaOperationListInput(input: ListCaOperationRecordsInput): void {
  if (!caOperationObjectTypes.includes(input.objectType)) {
    throw new AppError('CA_OPERATIONS_QUERY_INVALID', 'CA 运营对象类型无效', { objectType: input.objectType });
  }
  if (input.provider.id !== input.authority.providerId) {
    throw new AppError('CA_OPERATIONS_QUERY_INVALID', 'CA 与 Provider 不匹配', {
      providerId: input.provider.id,
      authorityProviderId: input.authority.providerId,
    });
  }
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 500) {
    throw new AppError('CA_OPERATIONS_QUERY_INVALID', 'CA 运营查询批量大小必须在 1 到 500 之间', { limit: input.limit });
  }
  if (input.syncRunId !== undefined && (!input.syncRunId.trim() || input.syncRunId.length > 128)) {
    throw new AppError('CA_OPERATIONS_QUERY_INVALID', 'CA 同步运行 ID 无效');
  }
  if (input.changedAfter && Number.isNaN(Date.parse(input.changedAfter))) {
    throw new AppError('CA_OPERATIONS_QUERY_INVALID', 'changedAfter 必须是有效时间', { changedAfter: input.changedAfter });
  }
}

export function assertCaOperationRecordBatch(batch: CaOperationRecordBatch, limit: number): void {
  if (!Array.isArray(batch.records) || batch.records.length > limit) {
    throw new AppError('CA_SYNC_BATCH_TOO_LARGE', 'CA 运营查询批次超过请求上限', {
      recordCount: Array.isArray(batch.records) ? batch.records.length : undefined,
      limit,
    });
  }
  if (typeof batch.complete !== 'boolean') {
    throw new AppError('CA_OPERATIONS_QUERY_INVALID', 'CA 运营查询批次缺少 complete 标记');
  }

  const externalObjectIds = new Set<string>();
  for (const record of batch.records) {
    assertObservation(record);
    if (externalObjectIds.has(record.externalObjectId)) {
      throw new AppError('CA_OPERATIONS_QUERY_INVALID', 'CA 运营查询批次包含重复外部对象', {
        externalObjectId: record.externalObjectId,
      });
    }
    externalObjectIds.add(record.externalObjectId);
  }
}

function assertObservation(record: ExternalCaObservationInput): void {
  if (!record.externalObjectId.trim()) {
    throw new AppError('CA_OPERATIONS_QUERY_INVALID', '外部 CA 记录缺少稳定对象 ID');
  }
  if (!caOperationNormalizedStatuses.includes(record.normalizedStatus)) {
    throw new AppError('CA_OPERATIONS_QUERY_INVALID', '外部 CA 记录状态无效', {
      normalizedStatus: record.normalizedStatus,
    });
  }
  if (!record.rawSummary || Array.isArray(record.rawSummary)) {
    throw new AppError('CA_OPERATIONS_QUERY_INVALID', '外部 CA 记录缺少受限原始摘要');
  }
  if (Buffer.byteLength(JSON.stringify(record.rawSummary), 'utf8') > 16 * 1024) {
    throw new AppError('CA_SYNC_BATCH_TOO_LARGE', '外部 CA 原始摘要超过 16 KiB 上限', {
      externalObjectId: record.externalObjectId,
    });
  }
}
