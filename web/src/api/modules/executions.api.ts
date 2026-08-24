import { listRecords, postAction, type ApiBody, type ApiRecord, type BusinessListQuery } from './common'
import { buildListPath } from './common'
import { apiClient } from '@/api/client'
import type { ApiPage } from './common'

const EXECUTION_RUNS_PATH = '/api/v1/execution-runs'
const EXECUTION_STEPS_PATH = '/api/v1/execution-steps'
const AGENT_TASK_LOGS_PATH = '/api/v1/agents/tasks/logs'

export function listExecutions(query?: BusinessListQuery) {
  return listRecords(EXECUTION_RUNS_PATH, query)
}

export function listExecutionSteps(query?: BusinessListQuery) {
  return listRecords(EXECUTION_STEPS_PATH, query)
}

export function listExecutionStepsByRunId(executionRunId: string, query: Omit<BusinessListQuery, 'filters'> = {}) {
  const path = buildListPath(EXECUTION_STEPS_PATH, query)
  const separator = path.includes('?') ? '&' : '?'
  return apiClient.get<ApiPage>(`${path}${separator}executionRunId=${encodeURIComponent(executionRunId)}`)
}

export function listAgentTaskLogsByTaskId(taskId: string) {
  return apiClient.get<readonly ApiRecord[]>(`${AGENT_TASK_LOGS_PATH.slice('/api'.length)}?taskId=${encodeURIComponent(taskId)}`)
}

export function retryExecution(runId: string, payload: ApiBody = {}) {
  return postAction(`${EXECUTION_RUNS_PATH}/retry`, { ...payload, runId }, 'execution_retry')
}

export function rollbackExecution(runId: string, payload: ApiBody = {}) {
  return postAction(`${EXECUTION_RUNS_PATH}/rollback`, { ...payload, runId }, 'execution_rollback')
}

export function cancelExecution(runId: string, payload: ApiBody = {}) {
  return postAction(`${EXECUTION_RUNS_PATH}/cancel`, { ...payload, runId }, 'execution_cancel')
}
