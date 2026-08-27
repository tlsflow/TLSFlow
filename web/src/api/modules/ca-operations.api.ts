import { apiClient } from '@/api/client'
import { toClientPath } from './common'

export type CaOperationObjectType = 'request' | 'issuance' | 'revocation' | 'template'
export type CaOperationStatus = 'pending' | 'issued' | 'rejected' | 'revoked' | 'failed' | 'unknown'
export type CaOperationIntegrity = 'complete' | 'partial' | 'stale' | 'failed'

export interface CaOperationsTreeView {
  objectType: CaOperationObjectType
  count: number
}

export interface CaOperationsTreeAuthority {
  id: string
  name: string
  providerId: string
  providerName: string
  providerType: string
  status: string
  views: CaOperationsTreeView[]
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
  records: (query: ListCaOperationRecordsQuery) => apiClient.get<CaOperationRecordPage>(queryPath('/api/v1/ca-operations/records', {
    caId: query.caId, view: query.view, status: query.status, query: query.query, cursor: query.cursor, limit: query.limit,
  })),
  record: (recordKey: string) => apiClient.get<CaOperationRecord>(toClientPath(`/api/v1/ca-operations/records/${encodeURIComponent(recordKey)}`)),
}
