import { readApiRequestContext } from '@/api/client'
import type { TaskRun, TaskStatus } from '@/api/modules/tasks.api'
import { TENANT_CONTEXT_CHANGED_EVENT } from '@/stores/tenant-context.events'

export interface TaskRealtimeSnapshotMessage {
  readonly type: 'snapshot'
  readonly activeTasks: readonly TaskRun[]
  readonly recentTasks?: readonly TaskRun[]
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
  readonly recentTasks: readonly TaskRun[]
  readonly activeCount: number
  readonly hasActive: boolean
  readonly connected: boolean
}

export type DeploymentExecutionMode = 'dry-run' | 'apply' | 'rollback'

export const RECENT_TASK_LIMIT = 10

export interface DeploymentExecutionOpenDetail {
  readonly taskId?: string
  readonly runId: string
  readonly deploymentPlanId?: string
  readonly mode: DeploymentExecutionMode
  readonly planName?: string
  readonly status?: string
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly summary?: string
}

const DEPLOYMENT_EXECUTION_OPEN_EVENT = 'gcac:deployment-execution:open'
const ACTIVE_TASK_STATUSES = new Set(['QUEUED', 'RUNNING', 'RETRY_WAITING', 'WAITING_RESULT', 'AWAITING_CONFIRMATION', 'CANCELLING'])
const TERMINAL_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED'])
const EXECUTION_TASK_TYPES = new Set([
  'CERTIFICATE_DRY_RUN',
  'CERTIFICATE_DEPLOY',
  'CERTIFICATE_VERIFY',
  'CERTIFICATE_ROLLBACK',
  'AGENT_INSTALL',
  'AGENT_UPDATE',
  'PLUGIN_REFERENCE_REFRESH',
  'DEPLOYMENT_PLAN_REFRESH',
])
const DEPLOYMENT_EXECUTION_TASK_TYPES = new Set([
  'CERTIFICATE_DRY_RUN',
  'CERTIFICATE_DEPLOY',
  'CERTIFICATE_ROLLBACK',
])
const VISIBLE_SYSTEM_TASK_TYPES = new Set([
  'ACME_CERTIFICATE_RENEWAL',
])
const realtimeListeners = new Set<(message: TaskRealtimeMessage) => void>()
const activityListeners = new Set<(state: TaskActivityState) => void>()
const activeExecutionTasks = new Map<string, TaskRun>()
const recentTasks = new Map<string, TaskRun>()

let socket: WebSocket | undefined
let reconnectTimer: number | undefined
let connectStarted = false
let realtimeConnected = false
let pendingDeploymentExecutionOpen: DeploymentExecutionOpenDetail | undefined

let tenantContextListenerAttached = false

export function isExecutionTask(task: TaskRun): boolean {
  return task.category === 'EXECUTION' || EXECUTION_TASK_TYPES.has(task.taskType)
}

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.has(status)
}

export function isAutomationTask(task: TaskRun): boolean {
  return task.taskType === 'AUTOMATION_RUN'
}

/** 中文说明：兼容历史任务中复用了 CERTIFICATE_DEPLOY 的审批占位记录。 */
export function isDeploymentApprovalTask(task: TaskRun): boolean {
  return task.taskType === 'DEPLOYMENT_APPROVAL'
    || task.payload?.executionType === 'approval'
    || task.resourceSummary?.executionType === 'approval'
}

/** 中文说明：只有真正的部署运行才可跳转执行详情或触发部署成功提示。 */
export function isDeploymentExecutionTask(task: TaskRun): boolean {
  return DEPLOYMENT_EXECUTION_TASK_TYPES.has(task.taskType) && !isDeploymentApprovalTask(task)
}

export function isDeploymentRunTask(task: TaskRun): boolean {
  return isDeploymentExecutionTask(task) && Boolean(firstString(
    task.payload?.runId,
    task.resourceSummary?.runId,
    task.progress?.runId,
    task.resourceSummary?.executionRunId,
    task.payload?.executionRunId,
  ))
}

export function isPendingApprovalTask(task: TaskRun): boolean {
  if (!ACTIVE_TASK_STATUSES.has(task.status)) return false
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
 * 中文说明：快速区只展示需要用户关注的业务动作。ACME 续签虽然归类为系统任务，
 * 但会改变证书状态，因此必须与执行任务一起展示；其余后台任务仍留在完整任务列表中。
 */
export function isQuickTask(task: TaskRun): boolean {
  return isExecutionTask(task)
    || isAutomationTask(task)
    || isPendingApprovalTask(task)
    || VISIBLE_SYSTEM_TASK_TYPES.has(task.taskType)
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
  listener(currentRealtimeSnapshot())
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

export function currentTaskActivity(): TaskActivityState {
  return currentActivityState()
}

export function isTaskRealtimeConnected(): boolean {
  return realtimeConnected
}

export function resetTaskRealtimeConnection(): void {
  clearReconnectTimer()
  connectStarted = false
  socket?.close()
  socket = undefined
  realtimeConnected = false
  activeExecutionTasks.clear()
  recentTasks.clear()
  emitActivity()
  if (realtimeListeners.size > 0) ensureTaskRealtimeConnection()
}

function ensureTaskRealtimeConnection(): void {
  if (typeof window === 'undefined') return
  if (!tenantContextListenerAttached) {
    window.addEventListener(TENANT_CONTEXT_CHANGED_EVENT, resetTaskRealtimeConnection)
    tenantContextListenerAttached = true
  }
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
  const contextVersion = requestContext?.tenantContextVersion?.trim()
  if (contextVersion) url.searchParams.set('contextVersion', contextVersion)
  return url.toString()
}

function parseRealtimeMessage(raw: unknown): TaskRealtimeMessage | undefined {
  try {
    const payload = typeof raw === 'string' ? JSON.parse(raw) as TaskRealtimeMessage : undefined
    if (!payload || typeof payload !== 'object' || typeof payload.type !== 'string') return undefined
    if (payload.type === 'snapshot' && Array.isArray(payload.activeTasks)) {
      return { ...payload, recentTasks: Array.isArray(payload.recentTasks) ? payload.recentTasks : [] }
    }
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
    recentTasks.clear()
    message.recentTasks?.forEach((task) => {
      if (isTrackedRecentTask(task)) recentTasks.set(task.id, task)
    })
  } else if (isTrackedActiveTask(message.task)) {
    activeExecutionTasks.set(message.task.id, message.task)
    recentTasks.delete(message.task.id)
  } else if (activeExecutionTasks.has(message.task.id)) {
    activeExecutionTasks.delete(message.task.id)
    if (isTrackedRecentTask(message.task)) recentTasks.set(message.task.id, message.task)
  } else if (isTrackedRecentTask(message.task)) {
    recentTasks.set(message.task.id, message.task)
  }
  pruneRecentTasks()
  realtimeListeners.forEach((listener) => listener(message))
  emitActivity()
}

function emitActivity(): void {
  const state = currentActivityState()
  activityListeners.forEach((listener) => listener(state))
}

function currentActivityState(): TaskActivityState {
  const activeTasks = sortTasks([...activeExecutionTasks.values()])
  const completedTasks = sortTasks([...recentTasks.values()]).slice(0, RECENT_TASK_LIMIT)
  return {
    activeTasks,
    recentTasks: completedTasks,
    activeCount: activeTasks.length,
    hasActive: activeTasks.length > 0,
    connected: realtimeConnected,
  }
}

function currentRealtimeSnapshot(): TaskRealtimeSnapshotMessage {
  const state = currentActivityState()
  return {
    type: 'snapshot',
    activeTasks: state.activeTasks,
    recentTasks: state.recentTasks,
    emittedAt: new Date().toISOString(),
  }
}

function pruneRecentTasks(): void {
  const retained = sortTasks([...recentTasks.values()]).slice(0, 50)
  recentTasks.clear()
  retained.forEach((task) => recentTasks.set(task.id, task))
}

function isTrackedActiveTask(task: TaskRun): boolean {
  return ACTIVE_TASK_STATUSES.has(task.status) && isQuickTask(task)
}

function isTrackedRecentTask(task: TaskRun): boolean {
  return isTerminalTaskStatus(task.status) && isQuickTask(task)
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
