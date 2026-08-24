import { apiClient } from '@/api/client'
import { toClientPath } from './common'

export type ReportType = 'incident_window' | 'risk_response' | 'automation_effectiveness'

export interface ReportMetricResult {
  metricKey: string
  metricVersion: number
  labelKey: string
  value: number
  sampleCount: number
  incompleteSampleCount?: number
  numerator?: number
  denominator?: number
}

export interface ReportOverview {
  reportType: ReportType
  asOf: string
  metricVersions: Record<string, number>
  metrics: ReportMetricResult[]
  groups: Array<{ dimension: string; value: string; count: number }>
  warnings: string[]
}

export interface ReportTrendPoint {
  snapshotDate: string
  metrics: Array<{ metricKey: string; metricVersion: number; value: number; sampleCount: number }>
  complete: boolean
}

export interface ReportItemPage {
  items: Record<string, unknown>[]
  page: number
  pageSize: number
  total: number
  asOf: string
}

export interface ReportRun {
  id: string
  reportType: ReportType
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'expired'
  timeZone: string
  dataAsOf: string
  createdAt: string
  finishedAt?: string
  errorMessage?: string
}

export interface ReportQueryInput {
  dateFrom: string
  dateTo: string
  asOf?: string
  metricKey?: string
  environment?: string
  ownerId?: string
  assetId?: string
  tag?: string
  severity?: string
  riskType?: string
  automationId?: string
  failureStage?: string
  page?: number
  pageSize?: number
}

const reportPath: Record<ReportType, string> = {
  incident_window: 'incident-window',
  risk_response: 'risk-response',
  automation_effectiveness: 'automation-effectiveness'
}

export async function getReportOverview(type: ReportType, query: ReportQueryInput): Promise<ReportOverview> {
  return requireData(await apiClient.get<ReportOverview>(withQuery(`/api/v1/reports/${reportPath[type]}/overview`, query)))
}

export async function getReportTrends(type: ReportType, query: ReportQueryInput): Promise<ReportTrendPoint[]> {
  return requireData(await apiClient.get<ReportTrendPoint[]>(withQuery(`/api/v1/reports/${reportPath[type]}/trends`, query)))
}

export async function getReportItems(type: ReportType, query: ReportQueryInput): Promise<ReportItemPage> {
  return requireData(await apiClient.get<ReportItemPage>(withQuery(`/api/v1/reports/${reportPath[type]}/items`, query)))
}

export async function createReportRun(type: ReportType, query: ReportQueryInput, timeZone: string): Promise<ReportRun> {
  return requireData(await apiClient.post<ReportRun>(toClientPath('/api/v1/report-runs'), { reportType: type, filters: query, timeZone }))
}

export async function listReportRuns(): Promise<ReportRun[]> {
  const result = requireData(await apiClient.get<{ items: ReportRun[] }>(toClientPath('/api/v1/report-runs')))
  return result.items
}

export async function downloadReportRun(id: string): Promise<void> {
  const response = await apiClient.download(toClientPath(`/api/v1/report-runs/${encodeURIComponent(id)}/download`))
  const blob = await response.blob()
  const disposition = response.headers.get('content-disposition') ?? ''
  const fileName = disposition.match(/filename="([^"]+)"/)?.[1] ?? 'report.csv'
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

function withQuery(path: string, query: ReportQueryInput): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  return `${toClientPath(path)}?${params.toString()}`
}

function requireData<T>(result: { data?: T; message?: string }): T {
  if (result.data === undefined) throw new Error(result.message || 'REPORT_RESPONSE_EMPTY')
  return result.data
}
