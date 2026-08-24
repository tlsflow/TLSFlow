import { getCredential, listCredentials, type CredentialKind as ApiCredentialKind } from '@/api/modules/credentials.api'

type WorkflowCredentialTranslate = (key: string, params?: Record<string, unknown>) => string

export type CredentialKind = ApiCredentialKind

export interface RuntimeCredentialBinding {
  readonly credentialId: string
  readonly kind: ApiCredentialKind
  readonly username?: string
  readonly delivery?: { location?: 'header' | 'query' | 'cookie'; name?: string }
  readonly secretRefs: Record<string, string>
}

export interface CredentialProfileOption extends RuntimeCredentialBinding {
  readonly id: string
  readonly name: string
  readonly apiKeyName?: string
  readonly apiKeyIn?: 'header' | 'query'
  readonly createdAt: string
}

export function isRuntimeCredentialBinding(value: unknown): value is RuntimeCredentialBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Partial<RuntimeCredentialBinding>
  return typeof item.credentialId === 'string'
    && typeof item.kind === 'string'
    && Boolean(item.secretRefs && typeof item.secretRefs === 'object' && !Array.isArray(item.secretRefs))
}

export function credentialProfileBinding(item: CredentialProfileOption | RuntimeCredentialBinding): RuntimeCredentialBinding {
  return {
    credentialId: item.credentialId,
    kind: item.kind,
    username: item.username,
    delivery: item.delivery,
    secretRefs: structuredClone(item.secretRefs),
  }
}

export async function loadCredentialProfiles(): Promise<CredentialProfileOption[]> {
  const listed = await listCredentials()
  const active = (listed.data?.items ?? []).filter((item) => item.status === 'active')
  const details = await Promise.all(active.map((item) => getCredential(item.id)))
  return details.flatMap((result) => {
    const item = result.data
    if (!item) return []
    return [{
      id: item.id,
      credentialId: item.id,
      name: item.name,
      kind: item.kind,
      username: item.username,
      delivery: item.delivery,
      secretRefs: item.secretSlots,
      apiKeyName: item.delivery?.name,
      apiKeyIn: item.delivery?.location === 'query' ? 'query' : item.delivery?.location === 'header' ? 'header' : undefined,
      createdAt: item.createdAt,
    }]
  })
}

export function credentialProfileLabel(item: Pick<CredentialProfileOption, 'name' | 'username' | 'apiKeyName'>): string {
  if (item.apiKeyName) return `${item.name} / ${item.apiKeyName}`
  if (item.username) return `${item.name} / ${item.username}`
  return item.name
}

export function credentialProfileSummary(
  item: Pick<CredentialProfileOption, 'kind' | 'username' | 'apiKeyName' | 'apiKeyIn'>,
  t?: WorkflowCredentialTranslate,
): string {
  const text = t ?? ((key: string) => key)
  if (item.kind === 'USERNAME_PASSWORD') return item.username
    ? text('workflows.credentials.summary.usernamePasswordWithUsername', { username: item.username })
    : text('workflows.credentials.summary.usernamePassword')
  if (item.kind === 'SSH_KEY') return item.username
    ? text('workflows.credentials.summary.sshKeyWithUsername', { username: item.username })
    : text('workflows.credentials.summary.sshKey')
  if (item.kind === 'API_KEY') return text('workflows.credentials.summary.apiKey', {
    name: item.apiKeyName ?? 'X-API-Key',
    location: item.apiKeyIn === 'query' ? 'Query' : 'Header',
  })
  return text('workflows.credentials.summary.bearerToken')
}

export function findWorkflowCredentialById(id: string, items: readonly CredentialProfileOption[]): CredentialProfileOption | null {
  return items.find((item) => item.id === id || item.credentialId === id) ?? null
}
