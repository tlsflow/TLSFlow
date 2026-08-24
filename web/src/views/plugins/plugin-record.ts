import type { PluginCatalogItem, PluginRuntimeMetric, PluginVersionRecord } from '@/api/generated/schemas'

export type PluginSource = 'builtin' | 'user'
export type PluginCatalogType = 'UNIFIED_PLUGIN'
export type RunnerStatus = 'ready' | 'busy' | 'unavailable' | 'notObserved'

export function aggregateRunnerStatus(metrics: readonly PluginRuntimeMetric[]): RunnerStatus {
  if (metrics.length === 0) return 'notObserved'
  if (metrics.some((metric) => metric.circuitState === 'OPEN')) return 'unavailable'
  if (metrics.some((metric) => metric.inFlight > 0)) return 'busy'
  return 'ready'
}

export interface PluginMetadata {
  name: string
  displayName?: string
  description?: string
  tags: string[]
  logoUrl?: string
  logoSquareUrl?: string
  platforms: string[]
}

export interface PluginRecord {
  id: string
  pluginId: string
  pluginVersionId: string
  version: string
  source: PluginSource
  valid: boolean
  updatedAt: string
  metadata: PluginMetadata
  stepCount: number
  rollbackCount: number
  catalogType: PluginCatalogType
  status: string
  runtime?: string
  capabilities: string[]
  permissions: string[]
  packageSha256: string
  manifestSha256: string
  resourceSha256: Record<string, string>
  runnerStatus: RunnerStatus
}

export function toCatalogPluginRecord(record: PluginCatalogItem, versionRecord?: PluginVersionRecord): PluginRecord | undefined {
  const pluginVersionId = readString(record.pluginVersionId)
  const pluginId = readString(record.pluginId)
  const version = readString(record.version)
  const packageSha256 = readString(record.packageSha256)
  const manifestSha256 = readString(record.manifestSha256)
  if (!pluginVersionId || !pluginId || !version || !packageSha256 || !manifestSha256) return undefined
  if (versionRecord && (versionRecord.id !== pluginVersionId || versionRecord.pluginId !== pluginId || versionRecord.version !== version)) return undefined

  const status = readString(record.status)
  return {
    id: pluginVersionId,
    pluginId,
    pluginVersionId,
    version,
    source: record.source === 'USER' ? 'user' : 'builtin',
    valid: !['INVALID', 'REJECTED', 'QUARANTINED', 'RETIRED'].includes(status.toUpperCase()),
    updatedAt: readString(versionRecord?.updatedAt),
    metadata: {
      name: readString(record.name, pluginId),
      displayName: readOptionalString(record.displayName),
      description: readOptionalString(record.description),
      logoUrl: readOptionalString(record.logoUrl),
      logoSquareUrl: readOptionalString(record.logoSquareUrl),
      tags: readStringArray(record.tags),
      platforms: readStringArray(record.platforms),
    },
    stepCount: readNumber(record.stepCount),
    rollbackCount: readNumber(record.rollbackCount),
    catalogType: 'UNIFIED_PLUGIN',
    status,
    runtime: readOptionalString(record.runtime),
    capabilities: record.capabilities.map((capability) => capability.key).filter(Boolean),
    permissions: readStringArray(versionRecord?.manifest?.permissions),
    packageSha256,
    manifestSha256,
    resourceSha256: readStringMap(record.resourceSha256),
    runnerStatus: 'notObserved',
  }
}

function readString(value: string | undefined, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function readOptionalString(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function readNumber(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function readStringArray(value: readonly string[] | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
}

function readStringMap(value: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).filter(([path, digest]) => path.trim() && digest.trim()))
}
