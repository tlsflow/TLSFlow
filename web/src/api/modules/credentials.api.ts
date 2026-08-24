import { apiClient, createIdempotencyKey } from '@/api/client'
import type { ApiResult } from '@/api/generated/client-types'
import { toClientPath } from './common'

export type CredentialKind = 'USERNAME_PASSWORD' | 'SSH_KEY' | 'BEARER_TOKEN' | 'API_KEY' | 'CLIENT_CERTIFICATE'

export interface CredentialProfileSummary {
  id: string
  name: string
  kind: CredentialKind
  scopeType: 'global' | 'team' | 'zone' | 'host' | 'plugin'
  scopeId?: string
  username?: string
  status: 'active' | 'disabled' | 'error'
  version: number
  updatedAt: string
}

export interface CredentialProfileDetail extends CredentialProfileSummary {
  delivery?: { location?: 'header' | 'query' | 'cookie'; name?: string }
  secretSlots: Record<string, string>
  metadata: Record<string, unknown>
  createdAt: string
}

export interface CredentialProfilePage {
  items: CredentialProfileSummary[]
  page: number
  pageSize: number
  total: number
}

export interface CredentialUsage {
  credentialId: string
  total: number
  items: Array<{ type: 'PLUGIN_BINDING' | 'DEVICE' | 'DEPLOYMENT_PLAN'; id: string; name?: string; detail?: Record<string, unknown> }>
}

export interface CredentialSecretValueInput { plainText: string; type?: string }

export interface CreateCredentialInput {
  name: string
  kind: CredentialKind
  scopeType: CredentialProfileSummary['scopeType']
  scopeId?: string
  username?: string
  delivery?: CredentialProfileDetail['delivery']
  secretValues: Record<string, CredentialSecretValueInput>
}

export interface UpdateCredentialInput {
  name?: string
  scopeType?: CredentialProfileSummary['scopeType']
  scopeId?: string
  username?: string
  delivery?: CredentialProfileDetail['delivery']
  secretValues?: Record<string, CredentialSecretValueInput>
  expectedVersion: number
}

export function listCredentials(filters: { kinds?: CredentialKind[]; scopes?: string[] } = {}): Promise<ApiResult<CredentialProfilePage>> {
  const query = new URLSearchParams()
  if (filters.kinds?.length === 1) query.set('kind', filters.kinds[0]!)
  const suffix = query.size > 0 ? `?${query.toString()}` : ''
  return apiClient.get<CredentialProfilePage>(`${toClientPath('/api/v1/credentials')}${suffix}`)
}

export function getCredential(id: string): Promise<ApiResult<CredentialProfileDetail>> {
  return apiClient.get<CredentialProfileDetail>(`${toClientPath('/api/v1/credentials/detail')}?id=${encodeURIComponent(id)}`)
}

export function getCredentialUsage(id: string): Promise<ApiResult<CredentialUsage>> {
  return apiClient.get<CredentialUsage>(`${toClientPath('/api/v1/credentials/usage')}?id=${encodeURIComponent(id)}`)
}

export function createCredential(input: CreateCredentialInput): Promise<ApiResult<CredentialProfileDetail>> {
  return apiClient.post<CredentialProfileDetail>(toClientPath('/api/v1/credentials'), input, { idempotencyKey: createIdempotencyKey('credential_create') })
}

export function updateCredential(id: string, input: UpdateCredentialInput): Promise<ApiResult<CredentialProfileDetail>> {
  return apiClient.request<CredentialProfileDetail>(toClientPath('/api/v1/credentials'), { method: 'PATCH', body: { id, ...input }, idempotencyKey: createIdempotencyKey('credential_update') })
}

export function rotateCredential(id: string, expectedVersion: number, secretValues: Record<string, CredentialSecretValueInput>): Promise<ApiResult<CredentialProfileDetail>> {
  return apiClient.post<CredentialProfileDetail>(toClientPath('/api/v1/credentials/rotate'), { id, expectedVersion, secretValues }, { idempotencyKey: createIdempotencyKey('credential_rotate') })
}

export function updateCredentialStatus(id: string, expectedVersion: number, status: 'active' | 'disabled'): Promise<ApiResult<CredentialProfileDetail>> {
  return apiClient.post<CredentialProfileDetail>(toClientPath('/api/v1/credentials/status'), { id, expectedVersion, status }, { idempotencyKey: createIdempotencyKey('credential_status') })
}

export function deleteCredential(id: string): Promise<ApiResult<{ id: string; deleted: true }>> {
  return apiClient.request<{ id: string; deleted: true }>(toClientPath('/api/v1/credentials/delete'), { method: 'DELETE', body: { id }, idempotencyKey: createIdempotencyKey('credential_delete') })
}
