import { apiClient } from '@/api/client'
import { toClientPath } from './common'

export type CaOperationObjectType = 'request' | 'issuance' | 'revocation' | 'template'
export type CaOperationStatus = 'pending' | 'issued' | 'rejected' | 'revoked' | 'failed' | 'unknown'
export type CaOperationIntegrity = 'complete' | 'partial' | 'stale' | 'failed'

export interface CaOperationsTreeView {
  objectType: CaOperationObjectType
  count: number
}

export interface CaAgentRuntimeProjection {
  agentId: string
  agentKey: string
  version: string
  versionSource: 'heartbeat' | 'registration'
  registeredVersion?: string
  status: 'ONLINE' | 'OFFLINE' | 'UNKNOWN'
  heartbeatAt?: string
  managementEndpoint?: string
  lastObservationAt?: string
  observationStatus?: string
  parserVersion?: string
  forced?: boolean
  scannedRecords?: number
  submittedRecords?: number
  sentRecords?: number
  acceptedRecords?: number
  failedBatches?: number
  insertedRecords?: number
  updatedRecords?: number
  duplicateRecords?: number
  rejectedRecords?: number
  pendingBatches?: number
  statusCounts?: Record<string, number>
  warnings?: string[]
  storedRecords: number
}

export interface CaAgentObservationRunSummary {
  status?: string
  scannedRecords?: number
  changedRecords?: number
  queuedRecords?: number
  submittedRecords?: number
  sentRecords?: number
  acceptedRecords?: number
  failedBatches?: number
  insertedRecords?: number
  updatedRecords?: number
  duplicateRecords?: number
  rejectedRecords?: number
  pendingBatches?: number
  warnings?: string[]
  completedAt?: string
  lastRunAt?: string
  error?: string
  parserVersion?: string
  forced?: boolean
  statusCounts?: Record<string, number>
}

export interface CaAgentRefreshResponse {
  status?: string
  success?: boolean
  agentId?: string
  agentKey?: string
  agentVersion?: string
  lastRun?: CaAgentObservationRunSummary
  pendingBatches?: number
  [key: string]: unknown
}

export interface CaOperationsTreeAuthority {
  id: string
  name: string
  providerId: string
  providerName: string
  providerType: string
  status: string
  views: CaOperationsTreeView[]
  agent?: CaAgentRuntimeProjection
}

export interface CaOperationsTreeTrustDomain {
  id: string
  name: string
  status: string
  authorities: CaOperationsTreeAuthority[]
}

export interface CaOperationsTree {
  trustDomains: CaOperationsTreeTrustDomain[]
  unassignedAuthorities: CaOperationsTreeAuthority[]
}

export interface CaOperationRecord {
  recordKey: string
  objectType: CaOperationObjectType
  source: 'gcac_native' | 'external_sync' | 'historical_backfill'
  caId: string
  normalizedStatus: CaOperationStatus
  sourceStatus?: string
  display: Record<string, string | number | string[] | undefined>
  observedAt: string
  integrity: CaOperationIntegrity
  allowedActions: string[]
}

export interface CaOperationRecordPage {
  items: CaOperationRecord[]
  nextCursor?: string
  total: number
  integrity: CaOperationIntegrity
}

export interface ListCaOperationRecordsQuery {
  caId: string
  view: CaOperationObjectType
  status?: CaOperationStatus[]
  query?: string
  cursor?: string
  limit?: number
}

function queryPath(path: string, query: Record<string, string | number | string[] | undefined>): string {
  const params = new URLSearchParams()
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === '') return
    if (Array.isArray(value)) value.forEach((item) => params.append(key, item))
    else params.set(key, String(value))
  })
  const suffix = params.toString()
  return `${toClientPath(path)}${suffix ? `?${suffix}` : ''}`
}

export const caOperationsApi = {
  tree: () => apiClient.get<CaOperationsTree>(toClientPath('/api/v1/ca-operations/tree')),
  refresh: (caId: string, force = false) => apiClient.post<CaAgentRefreshResponse>(toClientPath('/api/v1/ca-operations/refresh'), { caId, force }),
  records: (query: ListCaOperationRecordsQuery) => apiClient.get<CaOperationRecordPage>(queryPath('/api/v1/ca-operations/records', {
    caId: query.caId, view: query.view, status: query.status, query: query.query, cursor: query.cursor, limit: query.limit,
  })),
  record: (recordKey: string) => apiClient.get<CaOperationRecord>(toClientPath(`/api/v1/ca-operations/records/${encodeURIComponent(recordKey)}`)),
}
