import { apiClient, createRequestId, readApiRequestContext } from '@/api/client'
import { i18n } from '@/i18n'
import { listRecords, postAction, toClientPath, type ApiBody, type ApiRecord, type BusinessListQuery } from './common'
import { buildListPath } from './common'
import type { ApiPage } from './common'

const EXECUTION_RUNS_PATH = '/api/v1/execution-runs'
const EXECUTION_STEPS_PATH = '/api/v1/execution-steps'
const AGENT_TASK_LOGS_PATH = '/api/v1/agents/tasks/logs'

export function listExecutions(query?: BusinessListQuery) {
  return listRecords(EXECUTION_RUNS_PATH, query)
}

export function listExecutionsByPlanId(deploymentPlanId: string, query: Omit<BusinessListQuery, 'filters'> = {}) {
  const path = buildListPath(EXECUTION_RUNS_PATH, query)
  const separator = path.includes('?') ? '&' : '?'
  return apiClient.get<ApiPage>(`${path}${separator}deploymentPlanId=${encodeURIComponent(deploymentPlanId)}`)
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

export interface ExecutionDetailStreamSnapshot {
  readonly run?: ApiRecord
  readonly steps?: readonly ApiRecord[]
  readonly emittedAt?: string
}

export interface ExecutionDetailStreamEvent {
  readonly type: 'snapshot' | 'run' | 'step' | 'log'
  readonly runId: string
  readonly tenantId?: string
  readonly run?: ApiRecord
  readonly step?: ApiRecord
  readonly log?: ApiRecord
  readonly emittedAt?: string
}

export async function streamExecutionDetail(
  runId: string,
  handlers: {
    onSnapshot?: (snapshot: ExecutionDetailStreamSnapshot) => void
    onEvent?: (event: ExecutionDetailStreamEvent) => void
    onError?: (error: Error) => void
  },
): Promise<() => void> {
  const controller = new AbortController()
  const headers = new Headers()
  headers.set('Accept', 'text/event-stream')
  headers.set('X-Request-Id', createRequestId())

  const requestContext = readApiRequestContext()
  if (requestContext?.actorId) {
    headers.set('X-Actor-Id', requestContext.actorId)
    headers.set('X-Actor-Type', requestContext.actorType ?? 'user')
  }
  if (requestContext?.tenantId) {
    headers.set('X-Tenant-Id', requestContext.tenantId)
  }

  const response = await fetch(`${(import.meta.env.VITE_API_BASE_URL ?? '/api')}${toClientPath(`${EXECUTION_RUNS_PATH}/stream`)}?runId=${encodeURIComponent(runId)}`, {
    method: 'GET',
    credentials: 'include',
    headers,
    signal: controller.signal,
  })

  if (!response.ok || !response.body) {
    throw new Error(i18n.global.t('executions.errors.streamConnectFailed', { status: response.status }))
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let closed = false

  const pump = async () => {
    try {
      while (!closed) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let boundary = findSseBoundary(buffer)
        while (boundary) {
          const rawEvent = buffer.slice(0, boundary.index)
          buffer = buffer.slice(boundary.index + boundary.length)
          consumeSseEvent(rawEvent, handlers)
          boundary = findSseBoundary(buffer)
        }
      }
    } catch (cause) {
      if (closed) return
      handlers.onError?.(cause instanceof Error ? cause : new Error(String(cause)))
    }
  }

  void pump()

  return () => {
    closed = true
    controller.abort()
  }
}

function findSseBoundary(buffer: string): { index: number; length: number } | null {
  const match = /\r?\n\r?\n/.exec(buffer)
  return match ? { index: match.index, length: match[0].length } : null
}

function consumeSseEvent(
  rawEvent: string,
  handlers: {
    onSnapshot?: (snapshot: ExecutionDetailStreamSnapshot) => void
    onEvent?: (event: ExecutionDetailStreamEvent) => void
    onError?: (error: Error) => void
  },
) {
  const lines = rawEvent.split('\n').map((line) => line.replace(/\r$/, ''))
  let eventName = 'message'
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith(':')) continue
    if (line.startsWith('event:')) eventName = line.slice('event:'.length).trim()
    if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim())
  }
  if (dataLines.length === 0) return
  try {
    const parsed = JSON.parse(dataLines.join('\n')) as ExecutionDetailStreamSnapshot | ExecutionDetailStreamEvent
    if (eventName === 'snapshot') {
      handlers.onSnapshot?.(parsed as ExecutionDetailStreamSnapshot)
      return
    }
    handlers.onEvent?.(parsed as ExecutionDetailStreamEvent)
  } catch (cause) {
    handlers.onError?.(cause instanceof Error ? cause : new Error(String(cause)))
  }
}
