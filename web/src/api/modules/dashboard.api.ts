import { apiClient } from '@/api/client'
import type { ApiResult } from '@/api/generated/client-types'
import { listRecords, toClientPath, type BusinessListQuery } from './common'
import type { AuditPresentation } from '@/utils/audit-format'

const RISK_EVENTS_PATH = '/api/v1/monitors/risks'
const DASHBOARD_OVERVIEW_PATH = '/api/v1/dashboard/overview'
const DASHBOARD_RESOURCES_PATH = '/api/v1/dashboard/resources'

export type DashboardMetricTrend = 'neutral' | 'good' | 'warning' | 'danger'

export interface DashboardMetric {
  readonly key: string
  readonly title: string
  readonly value: number
  readonly description: string
  readonly trend: DashboardMetricTrend
  readonly targetPath?: string
}

export type DashboardCertificateState = 'valid' | 'expiring' | 'critical' | 'expired' | 'unknown'
export type DashboardStatusTone = 'ok' | 'warning' | 'error' | 'unknown' | 'disabled'
export type DashboardStatusDetails =
  | { type: 'certificate'; name: string; issuer?: string; notBefore?: string; notAfter?: string; daysRemaining?: number }
  | { type: 'device'; name: string; connectionStatus: string; version?: string; managementAddress?: string; lastCommunicationAt?: string }
  | { type: 'applicationAsset'; name: string; platform?: string; protocolPort: string; certificateDaysRemaining?: number }
  | { type: 'gateway'; name: string; region?: string; latencyMs?: number }

export interface DashboardStatusBlock {
  readonly id: string
  readonly label: string
  readonly status: string
  readonly tone: DashboardStatusTone
  readonly detail?: string
  readonly details?: DashboardStatusDetails
  readonly updatedAt?: string
  readonly targetPath?: string
}

export interface DashboardStatusGroup {
  readonly key: string
  readonly title: string
  readonly summary: string
  readonly total: number
  readonly blocks: DashboardStatusBlock[]
}

export interface DashboardCertificateStatusItem {
  readonly certificateAssetId: string
  readonly certificateVersionId?: string
  readonly name: string
  readonly primaryDomain: string
  readonly issuer?: string
  readonly notBefore?: string
  readonly notAfter?: string
  readonly daysRemaining?: number
  readonly state: DashboardCertificateState
  readonly chainStatus?: string
  readonly bindingCount: number
  readonly updatedAt?: string
}

export interface DashboardAuditItem {
  readonly id: string
  readonly eventType: string
  readonly actorType: string
  readonly actorId: string
  readonly action: string
  readonly resourceType: string
  readonly resourceId?: string
  readonly result: string
  readonly riskLevel: string
  readonly requestId?: string
  readonly detail?: unknown
  readonly presentation: AuditPresentation
  readonly createdAt: string
}

export interface DashboardQuickAction {
  readonly key: string
  readonly title: string
  readonly description: string
  readonly path: string
  readonly permission: string
}

export interface DashboardSystemResources {
  readonly cpuUsage: number | null
  readonly memoryUsage: number
}

export interface DashboardOverview {
  readonly generatedAt: string
  readonly systemResources: DashboardSystemResources
  readonly metrics: DashboardMetric[]
  readonly quickActions: DashboardQuickAction[]
  readonly statusGroups: DashboardStatusGroup[]
  readonly certificateStatuses: DashboardCertificateStatusItem[]
  readonly recentAudits: DashboardAuditItem[]
}

export function getDashboardOverview(): Promise<ApiResult<DashboardOverview>> {
  return apiClient.get<DashboardOverview>(toClientPath(DASHBOARD_OVERVIEW_PATH))
}

export function getDashboardResources(): Promise<ApiResult<DashboardSystemResources>> {
  return apiClient.get<DashboardSystemResources>(toClientPath(DASHBOARD_RESOURCES_PATH))
}

export function listDashboardRisks(query?: BusinessListQuery) {
  return listRecords(RISK_EVENTS_PATH, query)
}
