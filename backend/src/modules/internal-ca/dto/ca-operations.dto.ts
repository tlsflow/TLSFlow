import type {
  CaOperationsCapabilities,
  ExternalCaObservationInput,
} from '../providers/ca-operations.js';
import type { CaOperationNormalizedStatus, CaOperationObjectType } from '../schema/internal-ca.schema.js';

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

export interface CaOperationsProviderCapabilityDto {
  providerId: string;
  capabilities: CaOperationsCapabilities;
  capabilityState: 'declared' | 'discovered' | 'verified' | 'unavailable';
}

export interface CaOperationsExternalRecordDto extends ExternalCaObservationInput {
  providerId: string;
  caId: string;
  objectType: CaOperationObjectType;
  observedAt: string;
}

export type CaOperationRecordSource = 'gcac_native' | 'external_sync' | 'historical_backfill';
export type CaOperationIntegrity = 'complete' | 'partial' | 'stale' | 'syncing' | 'failed';

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
  lastSuccessfulSyncAt?: string;
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

export interface CreateCaSyncRunsDto {
  providerId: string;
  caId: string;
  objectTypes: CaOperationObjectType[];
  mode: 'incremental' | 'full';
  confirmed?: boolean;
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
