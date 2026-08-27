import type { CaOperationNormalizedStatus, CaOperationObjectType } from '../schema/internal-ca.schema.js';

/** Windows AD CS Agent 主动推送的本地 CA 观测批次。 */
export interface AgentCaObservationBatchDto {
  agentId: string;
  caName?: string;
  caConfig?: string;
  observedAt?: string;
  sequence?: number;
  records: Array<{
    objectType: CaOperationObjectType;
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
    rawSummary?: Record<string, unknown>;
  }>;
}

export interface AgentCaObservationIngestResult {
  accepted: number;
  inserted: number;
  updated: number;
  duplicates: number;
  rejected: number;
  rejections?: Array<{ index: number; reason: string }>;
  agentId: string;
  caId: string;
  providerId: string;
  observedAt: string;
}

export interface CaOperationsRecordQueryDto {
  caId: string;
  view: CaOperationObjectType;
  status?: CaOperationNormalizedStatus[];
  source?: Array<'gcac_native' | 'external_sync' | 'historical_backfill'>;
  query?: string;
  from?: string;
  to?: string;
  sort?: string;
  cursor?: string;
  limit?: number;
}

export interface CaOperationsExternalRecordDto {
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
  providerId: string;
  caId: string;
  objectType: CaOperationObjectType;
  observedAt: string;
}

export type CaOperationRecordSource = 'gcac_native' | 'external_sync' | 'historical_backfill';
export type CaOperationIntegrity = 'complete' | 'partial' | 'stale' | 'failed';

export interface CaOperationRecordDto {
  recordKey: string;
  objectType: CaOperationObjectType;
  source: CaOperationRecordSource;
  gcacResource?: { type: string; id: string };
  externalObject?: { providerId: string; externalObjectId: string };
  caId: string;
  normalizedStatus: CaOperationNormalizedStatus;
  sourceStatus?: string;
  display: Record<string, string | number | string[] | undefined>;
  observedAt: string;
  integrity: CaOperationIntegrity;
  allowedActions: string[];
}

export interface CaOperationRecordPageDto {
  items: CaOperationRecordDto[];
  nextCursor?: string;
  total: number;
  integrity: CaOperationIntegrity;
}

export interface CaOperationRecordDetailDto extends CaOperationRecordDto {
  auditReferences: string[];
}

export interface CaOperationsTreeViewDto {
  objectType: CaOperationObjectType;
  count: number;
}

export interface CaOperationsTreeAuthorityDto {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
  providerType: string;
  status: string;
  views: CaOperationsTreeViewDto[];
  agent?: CaAgentRuntimeProjection;
}

export interface CaAgentRuntimeProjection {
  agentId: string;
  agentKey: string;
  version: string;
  /** 实际生效版本的来源：最近一次心跳，或只有注册记录可用。 */
  versionSource: 'heartbeat' | 'registration';
  registeredVersion?: string;
  status: 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
  heartbeatAt?: string;
  managementEndpoint?: string;
  lastObservationAt?: string;
  observationStatus?: string;
  parserVersion?: string;
  forced?: boolean;
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
  storedRecords: number;
}

export interface CaOperationsTreeTrustDomainDto {
  id: string;
  name: string;
  status: string;
  authorities: CaOperationsTreeAuthorityDto[];
}

export interface CaOperationsTreeDto {
  trustDomains: CaOperationsTreeTrustDomainDto[];
  unassignedAuthorities: CaOperationsTreeAuthorityDto[];
}

export const caOperationsOpenApiSchemas = {
  operationObjectType: {
    type: 'string',
    enum: ['request', 'issuance', 'revocation', 'template'],
  },
  operationNormalizedStatus: {
    type: 'string',
    enum: ['pending', 'issued', 'rejected', 'revoked', 'failed', 'unknown'],
  },
  operationRecordQuery: {
    type: 'object',
    required: ['caId', 'view'],
    properties: {
      caId: { type: 'string' },
      view: { type: 'string', enum: ['request', 'issuance', 'revocation', 'template'] },
      status: { type: 'array', items: { type: 'string', enum: ['pending', 'issued', 'rejected', 'revoked', 'failed', 'unknown'] } },
      source: { type: 'array', items: { type: 'string', enum: ['gcac_native', 'external_sync', 'historical_backfill'] } },
      query: { type: 'string', maxLength: 256 },
      from: { type: 'string', format: 'date-time' },
      to: { type: 'string', format: 'date-time' },
      sort: { type: 'string', maxLength: 64 },
      cursor: { type: 'string', maxLength: 2048 },
      limit: { type: 'integer', minimum: 1, maximum: 200 },
    },
  },
} as const;
