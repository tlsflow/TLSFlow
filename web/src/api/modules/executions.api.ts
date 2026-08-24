import { listRecords, postAction, type ApiBody, type BusinessListQuery } from './common'

const EXECUTION_RUNS_PATH = '/api/v1/execution-runs'
const EXECUTION_STEPS_PATH = '/api/v1/execution-steps'

export function listExecutions(query?: BusinessListQuery) {
  return listRecords(EXECUTION_RUNS_PATH, query)
}

export function listExecutionSteps(query?: BusinessListQuery) {
  return listRecords(EXECUTION_STEPS_PATH, query)
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
