export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'muted'

export interface StatusMeta {
  readonly label: string
  readonly tone: StatusTone
}

interface StatusDefinition {
  readonly labelKey: string
  readonly tone: StatusTone
}

type Translate = (key: string) => string

export const statusDictionary = {
  DRAFT: { labelKey: 'designSystem.status.DRAFT', tone: 'muted' },
  PUBLISHED: { labelKey: 'designSystem.status.PUBLISHED', tone: 'success' },
  PENDING_APPROVAL: { labelKey: 'designSystem.status.PENDING_APPROVAL', tone: 'warning' },
  READY: { labelKey: 'designSystem.status.READY', tone: 'info' },
  RUNNING: { labelKey: 'designSystem.status.RUNNING', tone: 'info' },
  SUCCESS: { labelKey: 'designSystem.status.SUCCESS', tone: 'success' },
  PARTIAL_SUCCESS: { labelKey: 'designSystem.status.PARTIAL_SUCCESS', tone: 'warning' },
  PARTIALLY_SUCCEEDED: { labelKey: 'designSystem.status.PARTIAL_SUCCESS', tone: 'warning' },
  FAILED: { labelKey: 'designSystem.status.FAILED', tone: 'danger' },
  CANCELLED: { labelKey: 'designSystem.status.CANCELLED', tone: 'muted' },
  ROLLED_BACK: { labelKey: 'designSystem.status.ROLLED_BACK', tone: 'warning' },
  DISCOVERED: { labelKey: 'designSystem.status.DISCOVERED', tone: 'info' },
  MANAGED: { labelKey: 'designSystem.status.MANAGED', tone: 'success' },
  DRIFTED: { labelKey: 'designSystem.status.DRIFTED', tone: 'warning' },
  EXPIRED: { labelKey: 'designSystem.status.EXPIRED', tone: 'danger' },
  ERROR: { labelKey: 'designSystem.status.ERROR', tone: 'danger' },
  IGNORED: { labelKey: 'designSystem.status.IGNORED', tone: 'muted' },
  ONLINE: { labelKey: 'designSystem.status.ONLINE', tone: 'success' },
  OFFLINE: { labelKey: 'designSystem.status.OFFLINE', tone: 'danger' },
  ACTIVE: { labelKey: 'designSystem.status.ACTIVE', tone: 'success' },
  DISABLED: { labelKey: 'designSystem.status.DISABLED', tone: 'muted' },
  OPEN: { labelKey: 'designSystem.status.OPEN', tone: 'danger' },
  ACKED: { labelKey: 'designSystem.status.ACKED', tone: 'warning' },
  RESOLVED: { labelKey: 'designSystem.status.RESOLVED', tone: 'success' },
  UPGRADING: { labelKey: 'designSystem.status.UPGRADING', tone: 'info' },
  UPDATE_REQUIRED: { labelKey: 'designSystem.status.UPDATE_REQUIRED', tone: 'warning' },
  UP_TO_DATE: { labelKey: 'designSystem.status.UP_TO_DATE', tone: 'success' },
  HEALTHY: { labelKey: 'devices.health.healthy', tone: 'success' },
  DEGRADED: { labelKey: 'devices.health.degraded', tone: 'warning' },
  UNREACHABLE: { labelKey: 'devices.health.unreachable', tone: 'danger' },
  UNKNOWN: { labelKey: 'designSystem.status.UNKNOWN', tone: 'muted' },
} satisfies Record<string, StatusDefinition>

export function resolveStatusMeta(status: string, t: Translate = (key) => key): StatusMeta {
  const key = status.toUpperCase() as keyof typeof statusDictionary
  const definition = statusDictionary[key]
  return definition ? { label: t(definition.labelKey), tone: definition.tone } : { label: status, tone: 'muted' }
}
