import type { ApiRecord } from '@/api/modules/common'
import { listSecrets } from '@/api/modules/security.api'

export type WorkflowCredentialKind = 'username_password' | 'ssh_key' | 'curl_bearer' | 'curl_api_key'
export type WorkflowCredentialSecretType = 'ssh_key' | 'password' | 'api_token'

export interface WorkflowCredentialBinding {
  readonly id: string
  readonly kind: WorkflowCredentialKind
  readonly type: WorkflowCredentialSecretType
  readonly username?: string
  readonly apiKeyName?: string
  readonly apiKeyIn?: 'header' | 'query'
}

export interface WorkflowManagedCredential extends WorkflowCredentialBinding {
  readonly name: string
  readonly createdAt: string
}

export interface WorkflowCredentialMetadata extends Record<string, unknown> {
  readonly workflowCredential: true
  readonly workflowCredentialKind: WorkflowCredentialKind
  readonly username?: string
  readonly apiKeyName?: string
  readonly apiKeyIn?: 'header' | 'query'
}

export function isWorkflowCredentialKind(value: unknown): value is WorkflowCredentialKind {
  return value === 'username_password'
    || value === 'ssh_key'
    || value === 'curl_bearer'
    || value === 'curl_api_key'
}

export function isWorkflowCredentialSecretType(value: unknown): value is WorkflowCredentialSecretType {
  return value === 'ssh_key'
    || value === 'password'
    || value === 'api_token'
}

export function isWorkflowCredentialBinding(value: unknown): value is WorkflowCredentialBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Partial<WorkflowCredentialBinding>
  return typeof item.id === 'string'
    && isWorkflowCredentialKind(item.kind)
    && isWorkflowCredentialSecretType(item.type)
}

export function workflowSecretTypeForCredentialKind(kind: WorkflowCredentialKind): WorkflowCredentialSecretType {
  if (kind === 'ssh_key') return 'ssh_key'
  if (kind === 'curl_bearer' || kind === 'curl_api_key') return 'api_token'
  return 'password'
}

export function workflowCredentialBinding(item: Pick<WorkflowManagedCredential, 'id' | 'kind' | 'type' | 'username' | 'apiKeyName' | 'apiKeyIn'>): WorkflowCredentialBinding {
  return {
    id: item.id,
    kind: item.kind,
    type: item.type,
    username: item.username?.trim() ? item.username.trim() : undefined,
    apiKeyName: item.apiKeyName?.trim() ? item.apiKeyName.trim() : undefined,
    apiKeyIn: item.apiKeyIn,
  }
}

export function workflowCredentialMetadata(item: Pick<WorkflowManagedCredential, 'kind' | 'username' | 'apiKeyName' | 'apiKeyIn'>): WorkflowCredentialMetadata {
  return {
    workflowCredential: true,
    workflowCredentialKind: item.kind,
    username: item.username?.trim() ? item.username.trim() : undefined,
    apiKeyName: item.apiKeyName?.trim() ? item.apiKeyName.trim() : undefined,
    apiKeyIn: item.apiKeyIn,
  }
}

export async function loadWorkflowCredentials(): Promise<WorkflowManagedCredential[]> {
  const result = await listSecrets({ page: 1, pageSize: 200, filters: { workflowCredential: true } })
  return [...(result.data?.items ?? [])].flatMap(workflowCredentialFromSecret)
}

export function workflowCredentialFromSecret(secret: ApiRecord): WorkflowManagedCredential[] {
  const metadata = readRecord(secret.metadata)
  if (!metadata) return []
  const kind = isWorkflowCredentialKind(metadata.workflowCredentialKind) ? metadata.workflowCredentialKind : null
  if (!kind) return []
  const id = readString(secret.id)
  if (!id) return []
  const type = isWorkflowCredentialSecretType(secret.type) ? secret.type : workflowSecretTypeForCredentialKind(kind)
  return [{
    id,
    name: readString(secret.name) || id,
    kind,
    type,
    username: readString(metadata.username) || undefined,
    apiKeyName: readString(metadata.apiKeyName) || undefined,
    apiKeyIn: metadata.apiKeyIn === 'query' ? 'query' : metadata.apiKeyIn === 'header' ? 'header' : undefined,
    createdAt: readString(secret.createdAt) || '',
  }]
}

export function workflowCredentialLabel(item: Pick<WorkflowManagedCredential, 'name' | 'kind' | 'username' | 'apiKeyName'>): string {
  if (item.kind === 'curl_api_key') return `${item.name} / ${item.apiKeyName ?? 'X-API-Key'}`
  if (item.username) return `${item.name} / ${item.username}`
  return item.name
}

export function workflowCredentialSummary(item: Pick<WorkflowManagedCredential, 'kind' | 'username' | 'apiKeyName' | 'apiKeyIn'>): string {
  if (item.kind === 'username_password') return `用户名 + 密码${item.username ? ` / ${item.username}` : ''}`
  if (item.kind === 'ssh_key') return `SSH 私钥${item.username ? ` / ${item.username}` : ''}`
  if (item.kind === 'curl_api_key') return `API Key / ${item.apiKeyName ?? 'X-API-Key'} / ${item.apiKeyIn === 'query' ? 'Query' : 'Header'}`
  return 'Bearer Token'
}

export function findWorkflowCredentialById(id: string, items: readonly WorkflowManagedCredential[]): WorkflowManagedCredential | null {
  return items.find((item) => item.id === id) ?? null
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
