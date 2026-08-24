import { apiClient } from '@/api/client'
import { buildListPath, toClientPath, type BusinessListQuery } from './common'

export type TaskCategory = 'EXECUTION' | 'MONITORING' | 'SYSTEM'
export type TaskStatus = 'QUEUED' | 'RUNNING' | 'RETRY_WAITING' | 'WAITING_RESULT' | 'AWAITING_CONFIRMATION' | 'CANCELLING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'

export interface TaskRun {
  readonly id: string
  readonly tenantId: string
  readonly taskType: string
  readonly definitionVersion: number
  readonly category: TaskCategory
  readonly status: TaskStatus
  readonly requestedBy?: string
  readonly triggerSource: string
  readonly resourceSummary?: Record<string, unknown>
  readonly payload?: Record<string, unknown>
  readonly progress?: Record<string, unknown>
  readonly createdAt: string
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly lastErrorCode?: string
  readonly lastErrorMessage?: string
}

export interface TaskDetail {
  readonly task: TaskRun
  readonly attempts: readonly Record<string, unknown>[]
  readonly events: readonly Record<string, unknown>[]
  readonly childTasks: readonly TaskRun[]
  readonly resourceRefs: readonly Record<string, unknown>[]
  readonly auditEvents: readonly Record<string, unknown>[]
}

export interface TaskPage {
  readonly items: readonly TaskRun[]
  readonly page: number
  readonly pageSize: number
  readonly total: number
}

export interface MonitoringProbePage {
  readonly items: readonly Record<string, unknown>[]
  readonly page: number
  readonly pageSize: number
  readonly total: number
}

export interface TaskQuery extends BusinessListQuery {
  readonly includeAll?: boolean
}

export function listTasks(query: TaskQuery = {}) {
  const path = buildListPath('/api/v1/tasks', query)
  const separator = path.includes('?') ? '&' : '?'
  return apiClient.get<TaskPage>(`${path}${separator}includeAll=${query.includeAll === true ? 'true' : 'false'}`)
}

export function getTask(taskId: string) {
  return apiClient.get<TaskDetail>(toClientPath(`/api/v1/tasks/${encodeURIComponent(taskId)}`))
}

export function cancelTask(taskId: string, reason: string) {
  return apiClient.post<TaskRun>(toClientPath(`/api/v1/tasks/${encodeURIComponent(taskId)}/cancel`), { reason })
}

export function forceCancelTask(taskId: string, reason: string) {
  return apiClient.post<TaskRun>(toClientPath(`/api/v1/tasks/${encodeURIComponent(taskId)}/force-cancel`), { reason })
}

export function retryTask(taskId: string) {
  return apiClient.post<TaskRun>(toClientPath(`/api/v1/tasks/${encodeURIComponent(taskId)}/retry`), {})
}

export function listMonitoringProbes(taskId: string, query: BusinessListQuery = {}) {
  return apiClient.get<MonitoringProbePage>(buildListPath(`/api/v1/monitoring/task-runs/${encodeURIComponent(taskId)}/probes`, query))
}
