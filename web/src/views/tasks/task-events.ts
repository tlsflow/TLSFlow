import { readApiRequestContext } from '@/api/client'
import type { TaskRun } from '@/api/modules/tasks.api'

export interface GlobalTaskRefreshDetail {
  readonly taskId?: string
  readonly source?: string
}

export interface TaskRealtimeSnapshotMessage {
  readonly type: 'snapshot'
  readonly activeTasks: readonly TaskRun[]
  readonly emittedAt: string
}

export interface TaskRealtimeChangedMessage {
  readonly type: 'task.changed'
  readonly task: TaskRun
  readonly emittedAt: string
}

export type TaskRealtimeMessage = TaskRealtimeSnapshotMessage | TaskRealtimeChangedMessage

export interface TaskActivityState {
  readonly activeTasks: readonly TaskRun[]
  readonly activeCount: number
  readonly hasActive: boolean
  readonly connected: boolean
}

export type DeploymentExecutionMode = 'dry-run' | 'apply' | 'rollback'

export interface DeploymentExecutionOpenDetail {
  readonly taskId?: string
  readonly runId: string
  readonly deploymentPlanId?: string
  readonly mode: DeploymentExecutionMode
  readonly planName?: string
  readonly status?: string
  readonly summary?: string
}

const GLOBAL_TASK_REFRESH_EVENT = 'gcac:tasks:refresh'
const DEPLOYMENT_EXECUTION_OPEN_EVENT = 'gcac:deployment-execution:open'
const ACTIVE_TASK_STATUSES = new Set(['QUEUED', 'RUNNING', 'RETRY_WAITING', 'CANCELLING'])
const EXECUTION_TASK_TYPES = new Set([
  'CERTIFICATE_DRY_RUN',
  'CERTIFICATE_DEPLOY',
  'CERTIFICATE_VERIFY',
  'CERTIFICATE_ROLLBACK',
  'PROVIDER_OPERATION',
  'AGENT_INSTALL',
  'AGENT_UPDATE',
  'AGENT_CAPABILITY_RESCAN',
  'PLUGIN_REFERENCE_REFRESH',
  'DEPLOYMENT_PLAN_REFRESH',
])
const realtimeListeners = new Set<(message: TaskRealtimeMessage) => void>()
const activityListeners = new Set<(state: TaskActivityState) => void>()
const activeExecutionTasks = new Map<string, TaskRun>()

let socket: WebSocket | undefined
let reconnectTimer: number | undefined
let connectStarted = false
let realtimeConnected = false
let pendingDeploymentExecutionOpen: DeploymentExecutionOpenDetail | undefined

export function isExecutionTask(task: TaskRun): boolean {
  return task.category === 'EXECUTION' || EXECUTION_TASK_TYPES.has(task.taskType)
}

export function isAutomationTask(task: TaskRun): boolean {
  return task.taskType === 'AUTOMATION_RUN'
}

export function isPendingApprovalTask(task: TaskRun): boolean {
  const approvalId = firstString(task.progress?.approvalId, task.resourceSummary?.approvalId)
  if (!approvalId) return false
  const status = firstString(task.progress?.status, task.resourceSummary?.status)
  const approvalStatus = firstString(task.progress?.approvalStatus, task.resourceSummary?.approvalStatus)
  return status === 'waiting_approval'
    || approvalStatus === 'pending'
    || task.progress?.approvalPending === true
    || task.resourceSummary?.approvalPending === true
}

export function isAutomationApprovalTask(task: TaskRun): boolean {
  return isAutomationTask(task) && isPendingApprovalTask(task)
}

/**
 * 中文说明：快速区只展示会改变业务状态的执行任务和自动化运行任务，
 * 触发投递、监控采集、报表导出等后台任务留在完整任务列表中。
 */
export function isQuickTask(task: TaskRun): boolean {
  return isExecutionTask(task) || isAutomationTask(task) || isPendingApprovalTask(task)
}

export function dispatchGlobalTaskRefresh(detail: GlobalTaskRefreshDetail = {}): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<GlobalTaskRefreshDetail>(GLOBAL_TASK_REFRESH_EVENT, { detail }))
}

export function subscribeGlobalTaskRefresh(
  listener: (detail: GlobalTaskRefreshDetail) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined
  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<GlobalTaskRefreshDetail | undefined>
    listener(customEvent.detail ?? {})
  }
  window.addEventListener(GLOBAL_TASK_REFRESH_EVENT, handler as EventListener)
  return () => window.removeEventListener(GLOBAL_TASK_REFRESH_EVENT, handler as EventListener)
}

export function dispatchOpenDeploymentExecution(detail: DeploymentExecutionOpenDetail): void {
  pendingDeploymentExecutionOpen = detail
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<DeploymentExecutionOpenDetail>(DEPLOYMENT_EXECUTION_OPEN_EVENT, { detail }))
}

export function subscribeOpenDeploymentExecution(
  listener: (detail: DeploymentExecutionOpenDetail) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined
  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<DeploymentExecutionOpenDetail | undefined>
    if (!customEvent.detail) return
    pendingDeploymentExecutionOpen = undefined
    listener(customEvent.detail)
  }
  window.addEventListener(DEPLOYMENT_EXECUTION_OPEN_EVENT, handler as EventListener)
  if (pendingDeploymentExecutionOpen) {
    const detail = pendingDeploymentExecutionOpen
    pendingDeploymentExecutionOpen = undefined
    window.setTimeout(() => listener(detail), 0)
  }
  return () => window.removeEventListener(DEPLOYMENT_EXECUTION_OPEN_EVENT, handler as EventListener)
}

export function subscribeTaskRealtime(
  listener: (message: TaskRealtimeMessage) => void,
): () => void {
  realtimeListeners.add(listener)
  ensureTaskRealtimeConnection()
  return () => {
    realtimeListeners.delete(listener)
  }
}

export function subscribeTaskActivity(
  listener: (state: TaskActivityState) => void,
): () => void {
  activityListeners.add(listener)
  listener(currentActivityState())
  ensureTaskRealtimeConnection()
  return () => {
    activityListeners.delete(listener)
  }
}

export function isTaskRealtimeConnected(): boolean {
  return realtimeConnected
}

function ensureTaskRealtimeConnection(): void {
  if (typeof window === 'undefined') return
  if (connectStarted && socket) return
  const url = buildTaskRealtimeUrl()
  if (!url) return
  connectStarted = true
  clearReconnectTimer()
  const nextSocket = new WebSocket(url)
  socket = nextSocket
  nextSocket.addEventListener('open', () => {
    if (socket !== nextSocket) return
    realtimeConnected = true
    emitActivity()
  })
  nextSocket.addEventListener('message', (event) => {
    if (socket !== nextSocket) return
    const message = parseRealtimeMessage(event.data)
    if (!message) return
    applyRealtimeMessage(message)
  })
  nextSocket.addEventListener('close', () => {
    if (socket !== nextSocket) return
    socket = undefined
    realtimeConnected = false
    emitActivity()
    scheduleReconnect()
  })
  nextSocket.addEventListener('error', () => {
    if (socket !== nextSocket) return
    realtimeConnected = false
    emitActivity()
  })
}

function scheduleReconnect(): void {
  if (reconnectTimer !== undefined) return
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = undefined
    connectStarted = false
    ensureTaskRealtimeConnection()
  }, 3_000)
}

function clearReconnectTimer(): void {
  if (reconnectTimer === undefined) return
  window.clearTimeout(reconnectTimer)
  reconnectTimer = undefined
}

function buildTaskRealtimeUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined
  const requestContext = readApiRequestContext()
  const tenantId = requestContext?.tenantId?.trim()
  if (!tenantId) return undefined
  const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api'
  const baseUrl = new URL(trimTrailingSlash(apiBase) || '/api', window.location.origin)
  const protocol = baseUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = new URL(`${baseUrl.pathname}/v1/tasks/stream`, `${protocol}//${baseUrl.host}`)
  url.searchParams.set('tenantId', tenantId)
  return url.toString()
}

function parseRealtimeMessage(raw: unknown): TaskRealtimeMessage | undefined {
  try {
    const payload = typeof raw === 'string' ? JSON.parse(raw) as TaskRealtimeMessage : undefined
    if (!payload || typeof payload !== 'object' || typeof payload.type !== 'string') return undefined
    if (payload.type === 'snapshot' && Array.isArray(payload.activeTasks)) return payload
    if (payload.type === 'task.changed' && payload.task && typeof payload.task === 'object') return payload
    return undefined
  } catch {
    return undefined
  }
}

function applyRealtimeMessage(message: TaskRealtimeMessage): void {
  if (message.type === 'snapshot') {
    activeExecutionTasks.clear()
    message.activeTasks.forEach((task) => {
      if (isTrackedActiveTask(task)) activeExecutionTasks.set(task.id, task)
    })
  } else if (isTrackedActiveTask(message.task)) {
    activeExecutionTasks.set(message.task.id, message.task)
  } else if (activeExecutionTasks.has(message.task.id)) {
    activeExecutionTasks.delete(message.task.id)
  }
  realtimeListeners.forEach((listener) => listener(message))
  if (message.type === 'task.changed') {
    dispatchGlobalTaskRefresh({ taskId: message.task.id, source: 'websocket' })
  }
  emitActivity()
}

function emitActivity(): void {
  const state = currentActivityState()
  activityListeners.forEach((listener) => listener(state))
}

function currentActivityState(): TaskActivityState {
  const activeTasks = sortTasks([...activeExecutionTasks.values()])
  return {
    activeTasks,
    activeCount: activeTasks.length,
    hasActive: activeTasks.length > 0,
    connected: realtimeConnected,
  }
}

function isTrackedActiveTask(task: TaskRun): boolean {
  return ACTIVE_TASK_STATUSES.has(task.status) && isQuickTask(task)
}

function sortTasks(tasks: readonly TaskRun[]): TaskRun[] {
  return [...tasks].sort((left, right) => {
    const finishedCompare = compareTime(right.createdAt, left.createdAt)
    if (finishedCompare !== 0) return finishedCompare
    return right.id.localeCompare(left.id)
  })
}

function compareTime(left?: string, right?: string): number {
  const leftValue = left ? Date.parse(left) : 0
  const rightValue = right ? Date.parse(right) : 0
  return leftValue - rightValue
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim()
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}
