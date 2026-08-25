import { apiClient, createIdempotencyKey } from '@/api/client'
import type { ApiResult } from '@/api/generated/client-types'
import { toClientPath } from './common'

export type CredentialKind = 'USERNAME_PASSWORD' | 'SSH_KEY' | 'BEARER_TOKEN' | 'API_KEY' | 'CLIENT_CERTIFICATE' | 'DNS_PROVIDER' | 'CLOUD_PROVIDER' | 'BROWSER_SESSION'

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
  expiresAt?: string
  metadata?: Record<string, unknown>
  healthStatus?: CredentialHealthStatus
}

export type CredentialHealthStatus = 'DISABLED' | 'UNUSED' | 'UNREACHABLE' | 'VALID' | 'ERROR'
export interface CredentialHealthState {
  tenantId: string
  credentialId: string
  status: CredentialHealthStatus
  checkedAt?: string
  nextCheckAt?: string
  checkingTaskId?: string
  profileVersion: number
  generation: number
  failureCount: number
  reasonCode?: string
  reasonSummary?: string
  deviceCount: number
  updatedAt: string
}
export interface CredentialHealthCheckRecord {
  id: string
  tenantId: string
  credentialId: string
  deviceAssetId: string
  taskId?: string
  generation: number
  profileVersion: number
  resultStatus: 'VALID' | 'UNREACHABLE' | 'ERROR'
  reasonCode?: string
  reasonSummary?: string
  checkedAt: string
  durationMs: number
  pluginVersionId?: string
  workflowVersionId?: string
  secretVersionSummary?: string
  detail: Record<string, unknown>
  createdAt: string
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
  items: Array<{
    type: 'PLUGIN_BINDING' | 'DEVICE' | 'DEPLOYMENT_PLAN' | 'ACME_RENEWAL_POLICY' | 'CLOUD_ACCOUNT_ASSET' | 'BROWSER_CREDENTIAL_SESSION'
    id: string
    name?: string
    detail?: Record<string, unknown>
  }>
}

export interface CredentialSecretValueInput { plainText: string; type?: string }

export interface CreateCredentialInput {
  name: string
  kind: CredentialKind
  scopeType: CredentialProfileSummary['scopeType']
  scopeId?: string
  username?: string
  delivery?: CredentialProfileDetail['delivery']
  metadata?: Record<string, unknown>
  expiresAt?: string | null
  secretValues: Record<string, CredentialSecretValueInput>
}

export interface UpdateCredentialInput {
  name?: string
  scopeType?: CredentialProfileSummary['scopeType']
  scopeId?: string
  username?: string
  delivery?: CredentialProfileDetail['delivery']
  metadata?: Record<string, unknown>
  secretValues?: Record<string, CredentialSecretValueInput>
  expiresAt?: string | null
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

export function getCredentialHealth(id: string): Promise<ApiResult<CredentialHealthState>> {
  return apiClient.get<CredentialHealthState>(`${toClientPath(`/api/v1/credentials/${encodeURIComponent(id)}/health`)}`)
}

export function listCredentialHealthChecks(id: string, deviceAssetId?: string): Promise<ApiResult<{ items: CredentialHealthCheckRecord[] }>> {
  const query = deviceAssetId ? `?deviceAssetId=${encodeURIComponent(deviceAssetId)}` : ''
  return apiClient.get<{ items: CredentialHealthCheckRecord[] }>(`${toClientPath(`/api/v1/credentials/${encodeURIComponent(id)}/health-checks`)}${query}`)
}

export function triggerCredentialHealthCheck(id: string, deviceAssetId?: string): Promise<ApiResult<{ taskId: string; health: CredentialHealthState }>> {
  return apiClient.post<{ taskId: string; health: CredentialHealthState }>(toClientPath(`/api/v1/credentials/${encodeURIComponent(id)}/health-check`), deviceAssetId ? { deviceAssetId } : {}, { idempotencyKey: createIdempotencyKey('credential_health_check') })
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

export type BrowserCredentialSessionStatus = 'CREATING' | 'READY_FOR_ACQUISITION' | 'ACQUIRING' | 'SAVED' | 'FAILED' | 'EXPIRED' | 'CLOSED'

export interface BrowserCredentialSession {
  id: string
  assetId: string
  pluginVersionId: string
  loginUrl?: string
  workflowVersionId: string
  status: BrowserCredentialSessionStatus
  temporaryUrl?: string
  expiresAt: string
  credentialId?: string
  errorCode?: string
  errorMessage?: string
  capability: {
    pluginId: string
    pluginVersion: string
    loginUrl: string
    outputParameters: string[]
  }
}

export interface CreateBrowserCredentialSessionInput {
  credentialId: string
  assetId?: string
  pluginVersionId: string
  loginUrl: string
  ttlSeconds?: number
  sharePassword: string
  screenWidth?: number
  screenHeight?: number
}

export function createBrowserCredentialSession(input: CreateBrowserCredentialSessionInput): Promise<ApiResult<BrowserCredentialSession>> {
  return apiClient.post<BrowserCredentialSession>(toClientPath('/api/v1/credentials/browser-sessions'), input, { idempotencyKey: createIdempotencyKey('browser_credential_session') })
}

export function getBrowserCredentialSession(id: string): Promise<ApiResult<BrowserCredentialSession>> {
  return apiClient.get<BrowserCredentialSession>(`${toClientPath('/api/v1/credentials/browser-sessions')}/${encodeURIComponent(id)}`)
}

export function acquireBrowserCredentialSession(id: string): Promise<ApiResult<BrowserCredentialSession>> {
  return apiClient.post<BrowserCredentialSession>(`${toClientPath('/api/v1/credentials/browser-sessions')}/${encodeURIComponent(id)}/acquire`, {}, { idempotencyKey: createIdempotencyKey('browser_credential_acquire'), timeoutMs: 120_000 })
}

export function cancelBrowserCredentialSession(id: string): Promise<ApiResult<BrowserCredentialSession>> {
  return apiClient.post<BrowserCredentialSession>(`${toClientPath('/api/v1/credentials/browser-sessions')}/${encodeURIComponent(id)}/cancel`, {}, { idempotencyKey: createIdempotencyKey('browser_credential_cancel') })
}
