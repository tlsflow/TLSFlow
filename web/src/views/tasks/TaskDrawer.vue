<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { getAutomationRun, listAutomationRunTargets, type AutomationRunRecord, type AutomationRunTargetRecord } from '@/api/modules/automations.api'
import { getCertificateAssetDetail } from '@/api/modules/certificates.api'
import { GcButton, GcEmptyState, GcModal, GcProgressBar, GcStatusTag, GcTabs } from '@/design-system/components'
import { listDeploymentPlans } from '@/api/modules/deployments.api'
import { internalCaApi, type InternalCaRecord } from '@/api/modules/internal-ca.api'
import { forceCancelTask, getTask, listMonitoringProbes, listTasks, type TaskCategory, type TaskDetail, type TaskRun, type TaskStatus } from '@/api/modules/tasks.api'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import { translateDynamic } from '@/i18n/translate'
import { currentTaskActivity, dispatchOpenDeploymentExecution, isDeploymentExecutionTask as isRealDeploymentExecutionTask, isExecutionTask, isQuickTask, RECENT_TASK_LIMIT, subscribeTaskActivity, subscribeTaskRealtime, type DeploymentExecutionMode, type DeploymentExecutionOpenDetail, type TaskActivityState, type TaskRealtimeMessage } from './task-events'
import { buildAcmeTaskAttemptHistory, type AcmeTaskAttemptState } from './acme-task-history'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const { t, te } = useI18n()
const router = useRouter()

const PAGE_SIZE = 100
const TASK_FALLBACK_REFRESH_INTERVAL_MS = 15_000
const QUICK_ACTIVE_STATUSES: readonly TaskStatus[] = [
  'QUEUED',
  'RUNNING',
  'RETRY_WAITING',
  'WAITING_RESULT',
  'AWAITING_CONFIRMATION',
  'CANCELLING',
]
const QUICK_COMPLETED_STATUSES: readonly TaskStatus[] = ['SUCCEEDED', 'FAILED', 'CANCELLED']
const QUICK_ACTIVE_STATUS_SET: ReadonlySet<TaskStatus> = new Set(QUICK_ACTIVE_STATUSES)
const QUICK_COMPLETED_STATUS_SET: ReadonlySet<TaskStatus> = new Set(QUICK_COMPLETED_STATUSES)
const MONITORING_TASK_TYPES: ReadonlySet<string> = new Set([
  'MONITORING_BATCH',
  'MONITORING_PROBE',
])
const SYSTEM_TASK_TYPES: ReadonlySet<string> = new Set([
  'CERTIFICATE_REVOCATION',
  'CRL_PUBLISH',
  'TRUST_DISTRIBUTION',
  'GATEWAY_DELEGATION',
  'WORKFLOW_RUN',
  'AUTOMATION_RUN',
  'REPORT_EXPORT',
  'NOTIFICATION_DELIVERY',
])
const PLUGIN_REFRESH_EVENT_TYPES: ReadonlySet<string> = new Set([
  'CREATED',
  'CLAIMED',
  'STARTED',
  'PROGRESS',
  'RETRY_SCHEDULED',
  'WAITING_RESULT',
  'AWAITING_CONFIRMATION',
  'CANCEL_REQUESTED',
  'SUCCEEDED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
])
type TaskTabCategory = TaskCategory | 'OTHER'
interface AcmeRenewalTaskPresentation {
  readonly providerName: string
  readonly certificateName: string
}

interface PluginRefreshVersion {
  readonly id?: string
  readonly pluginId?: string
  readonly version?: string
  readonly status?: string
}

type PluginRefreshChangeType = 'ADDED' | 'UPDATED' | 'REMOVED' | 'UNCHANGED'

interface PluginRefreshChange {
  readonly pluginId: string
  readonly before?: PluginRefreshVersion
  readonly after?: PluginRefreshVersion
  readonly changeType: PluginRefreshChangeType
}

interface PluginRefreshProjection {
  readonly attempted?: number
  readonly projected?: number
  readonly skipped?: number
  readonly failed: readonly Record<string, unknown>[]
}

interface PluginRefreshResult {
  readonly available: boolean
  readonly refreshedAt?: string
  readonly versions: readonly PluginRefreshVersion[]
  readonly beforeVersions: readonly PluginRefreshVersion[]
  readonly changes: readonly PluginRefreshChange[]
  readonly projection: PluginRefreshProjection
}

interface PluginRefreshTimelineItem {
  readonly id: string
  readonly createdAt: string
  readonly description: string
  readonly tone: 'success' | 'warning' | 'danger' | 'info' | 'muted'
}

const detailLoading = ref(false)
const detailError = ref('')
const quickLoading = ref(false)
const quickRefreshQueued = ref(false)
const realtimeConnected = ref(false)
const quickActiveTasks = ref<TaskRun[]>([])
const quickRecentCompleted = ref<TaskRun[]>([])
const fallbackActiveTasks = ref<TaskRun[]>([])
const fallbackRecentCompleted = ref<TaskRun[]>([])
const detail = ref<TaskDetail | null>(null)
const monitoringProbes = ref<readonly Record<string, unknown>[]>([])
const automationRun = ref<(AutomationRunRecord & { actionResults: unknown[] }) | null>(null)
const automationTargets = ref<AutomationRunTargetRecord[]>([])
const forceCancelLoading = ref(false)
const forceCancelError = ref('')
const forceCancelConfirmOpen = ref(false)
const forceCancelTarget = ref<TaskRun | null>(null)
const keyword = ref('')
const appliedQuickKeyword = ref('')
const allTasksModalOpen = ref(false)
const switchingToAllTasks = ref(false)
const allTasks = ref<TaskRun[]>([])
const allTasksKeyword = ref('')
const allTasksLoading = ref(false)
const allTasksError = ref('')
const allTasksPage = ref(1)
const allTasksHasMore = ref(true)
const allTasksScroll = ref<HTMLElement | null>(null)
const allTasksCategory = ref<TaskTabCategory>('EXECUTION')
const allTasksReloadQueued = ref(false)
const deploymentPlanNames = ref<Record<string, string>>({})
const deploymentPlanNameRequests = new Set<string>()
const deploymentPlanNameMisses = new Set<string>()
const acmeRenewalTaskPresentations = ref<Record<string, AcmeRenewalTaskPresentation>>({})
const acmeRenewalTaskPresentationRequests = new Set<string>()
const acmeRenewalTaskPresentationMisses = new Set<string>()
let disposeTaskActivity: (() => void) | undefined
let disposeTaskRealtime: (() => void) | undefined
let taskRefreshTimer: number | undefined
const detailTask = computed(() => detail.value?.task ?? null)
const acmeAttemptHistory = computed(() => detailTask.value?.taskType === 'ACME_CERTIFICATE_RENEWAL'
  ? buildAcmeTaskAttemptHistory(detail.value?.attempts ?? [])
  : [])
const allTaskTabs = computed(() => [
  { value: 'EXECUTION', label: t('tasks.tabs.execution') },
  { value: 'MONITORING', label: t('tasks.tabs.monitoring') },
  { value: 'SYSTEM', label: t('tasks.tabs.system') },
  { value: 'OTHER', label: t('tasks.tabs.other') },
])
const visibleDetailEvents = computed(() => {
  const events = detail.value?.events ?? []
  return detailTask.value?.category === 'MONITORING'
    ? events.filter((event) => event.eventType !== 'LOG')
    : events
})
const pluginRefreshResult = computed(() => buildPluginRefreshResult(detail.value?.events ?? []))
const pluginRefreshEnabledCount = computed(() => pluginRefreshResult.value.versions.filter((version) => version.status?.toUpperCase() === 'ENABLED').length)
const pluginRefreshTimeline = computed(() => buildPluginRefreshTimeline(detail.value?.events ?? [], detailTask.value))
watch(() => props.open, (open) => {
  if (open) {
    window.addEventListener('keydown', handleKeydown)
    void nextTick(() => {
      // 中文说明：实时首帧可能尚未到达，先用接口补齐历史记录；有实时数据时不重复请求。
      if (!realtimeConnected.value || (quickActiveTasks.value.length === 0 && quickRecentCompleted.value.length === 0)) {
        void refreshQuickTasks()
      }
    })
  } else {
    window.removeEventListener('keydown', handleKeydown)
    if (!switchingToAllTasks.value) allTasksModalOpen.value = false
    detail.value = null
    resetAutomationDetail()
  }
}, { immediate: true })
watch([() => props.open, realtimeConnected], ([open, connected]) => {
  updateTaskRefreshTimer(Boolean(open) && !connected)
}, { immediate: true })
watch(allTasksCategory, () => {
  if (!allTasksModalOpen.value) return
  if (allTasksLoading.value) {
    allTasksReloadQueued.value = true
    return
  }
  void loadAllTasks(true)
})
watch(forceCancelConfirmOpen, (open) => {
  if (open || forceCancelLoading.value) return
  forceCancelTarget.value = null
  forceCancelError.value = ''
})

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  stopTaskRefreshTimer()
  disposeTaskActivity?.()
  disposeTaskRealtime?.()
  disposeTaskActivity = undefined
  disposeTaskRealtime = undefined
})

onMounted(() => {
  disposeTaskActivity = subscribeTaskActivity((state) => {
    realtimeConnected.value = state.connected
    applyQuickTaskActivity(state)
  })
  disposeTaskRealtime = subscribeTaskRealtime((message) => {
    handleRealtimeMessage(message)
  })
})

function mergeTasks(existing: readonly TaskRun[], incoming: readonly TaskRun[]): TaskRun[] {
  const merged = new Map(existing.map((task) => [task.id, task]))
  incoming.forEach((task) => merged.set(task.id, task))
  return sortTasks([...merged.values()])
}

function taskTabCategory(task: TaskRun): TaskTabCategory {
  if (isExecutionTask(task)) return 'EXECUTION'
  if (task.category === 'MONITORING' || MONITORING_TASK_TYPES.has(task.taskType)) return 'MONITORING'
  if (task.category === 'SYSTEM' || SYSTEM_TASK_TYPES.has(task.taskType)) return 'SYSTEM'
  return 'OTHER'
}

function matchesAllTaskScope(task: TaskRun): boolean {
  return taskTabCategory(task) === allTasksCategory.value
}

function allTasksQueryCategory(): TaskCategory | undefined {
  return allTasksCategory.value === 'OTHER' ? undefined : allTasksCategory.value
}

function applyQuickTasksState(next: { active: TaskRun[]; recent: TaskRun[] }): void {
  if (!sameTaskList(quickActiveTasks.value, next.active)) quickActiveTasks.value = next.active
  if (!sameTaskList(quickRecentCompleted.value, next.recent)) quickRecentCompleted.value = next.recent
  resolveTaskPresentations([...next.active, ...next.recent])
}

function applyQuickTaskActivity(state: TaskActivityState): void {
  appliedQuickKeyword.value = keyword.value.trim()
  const keywordValue = appliedQuickKeyword.value
  const activeTasks = mergeTasks(fallbackActiveTasks.value, state.activeTasks)
  const recentTasks = mergeTasks(fallbackRecentCompleted.value, state.recentTasks)
  applyQuickTasksState({
    active: sortTasks(activeTasks.filter((task) => QUICK_ACTIVE_STATUS_SET.has(task.status) && isQuickTask(task) && matchesTaskKeyword(task, keywordValue))),
    recent: sortTasks(recentTasks.filter((task) => QUICK_COMPLETED_STATUS_SET.has(task.status) && isQuickTask(task) && matchesTaskKeyword(task, keywordValue))).slice(0, RECENT_TASK_LIMIT),
  })
}

async function requestQuickTasks(status: TaskStatus): Promise<TaskRun[]> {
  const result = await listTasks({
    page: 1,
    pageSize: PAGE_SIZE,
    keyword: keyword.value.trim() || undefined,
    filters: { status },
    includeAll: true,
  })
  return [...(result.data?.items ?? [])]
}

async function refreshQuickTasks(): Promise<void> {
  if (quickLoading.value) {
    quickRefreshQueued.value = true
    return
  }
  quickLoading.value = true
  try {
    const batches = await Promise.all([
      ...QUICK_ACTIVE_STATUSES.map((status) => requestQuickTasks(status)),
      ...QUICK_COMPLETED_STATUSES.map((status) => requestQuickTasks(status)),
    ])
    const tasks = batches.flat().filter(isQuickTask)
    const active = tasks.filter((task) => QUICK_ACTIVE_STATUS_SET.has(task.status))
    const recent = tasks.filter((task) => QUICK_COMPLETED_STATUS_SET.has(task.status))
    // 中文说明：接口结果只作为兜底；实时状态已存在时由实时任务覆盖同一 ID，避免旧响应回写旧状态。
    fallbackActiveTasks.value = mergeTasks(active, fallbackActiveTasks.value).filter((task) => QUICK_ACTIVE_STATUS_SET.has(task.status) && isQuickTask(task))
    fallbackRecentCompleted.value = mergeTasks(recent, fallbackRecentCompleted.value).filter((task) => QUICK_COMPLETED_STATUS_SET.has(task.status) && isQuickTask(task)).slice(0, 50)
    applyQuickTaskActivity(currentTaskActivity())
  } catch {
    // 中文说明：实时流仍会继续工作，兜底请求失败时不清空已经展示的任务。
  } finally {
    quickLoading.value = false
    if (quickRefreshQueued.value && props.open && !realtimeConnected.value) {
      quickRefreshQueued.value = false
      void refreshQuickTasks()
    } else {
      quickRefreshQueued.value = false
    }
  }
}

function updateTaskRefreshTimer(shouldRun: boolean): void {
  if (!shouldRun) {
    stopTaskRefreshTimer()
    return
  }
  if (taskRefreshTimer !== undefined) return
  taskRefreshTimer = window.setInterval(() => {
    if (props.open && !realtimeConnected.value) void refreshQuickTasks()
  }, TASK_FALLBACK_REFRESH_INTERVAL_MS)
}

function stopTaskRefreshTimer(): void {
  if (taskRefreshTimer === undefined) return
  window.clearInterval(taskRefreshTimer)
  taskRefreshTimer = undefined
}

async function openAllTasks(): Promise<void> {
  allTasksKeyword.value = keyword.value
  allTasksCategory.value = 'EXECUTION'
  allTasksReloadQueued.value = false
  switchingToAllTasks.value = true
  emit('close')
  await nextTick()
  allTasksModalOpen.value = true
  switchingToAllTasks.value = false
  void loadAllTasks(true)
}

function applyAllTasksState(next: {
  items: TaskRun[]
  page: number
  hasMore: boolean
}): void {
  if (!sameTaskList(allTasks.value, next.items)) allTasks.value = next.items
  allTasksPage.value = next.page
  allTasksHasMore.value = next.hasMore
  resolveTaskPresentations(next.items)
}

async function requestAllTasksPage(page: number): Promise<{
  items: TaskRun[]
  page: number
  hasMore: boolean
}> {
  const result = await listTasks({
    page,
    pageSize: PAGE_SIZE,
    keyword: allTasksKeyword.value.trim() || undefined,
    filters: allTasksQueryCategory() ? { category: allTasksQueryCategory() } : undefined,
    includeAll: true,
  })
  const data = result.data
  const fetchedItems = (data?.items ?? []).filter(matchesAllTaskScope)
  const currentPage = data?.page ?? page
  const pageSize = data?.pageSize ?? PAGE_SIZE
  const total = data?.total ?? 0
  return {
    items: fetchedItems,
    page: currentPage + 1,
    hasMore: currentPage * pageSize < total,
  }
}

async function loadAllTasks(reset = false): Promise<void> {
  if (allTasksLoading.value) return
  if (!reset && !allTasksHasMore.value && allTasks.value.length > 0) return
  allTasksLoading.value = true
  allTasksError.value = ''
  try {
    let nextItems = reset ? [] : [...allTasks.value]
    let nextPage = reset ? 1 : allTasksPage.value
    let nextHasMore = reset ? true : allTasksHasMore.value
    do {
      const response = await requestAllTasksPage(nextPage)
      nextItems = reset ? sortTasks(response.items) : mergeTasks(nextItems, response.items)
      nextPage = response.page
      nextHasMore = response.hasMore
    } while (reset && nextItems.length === 0 && nextHasMore)
    applyAllTasksState({ items: nextItems, page: nextPage, hasMore: nextHasMore })
  } catch (cause) {
    allTasksError.value = cause instanceof Error ? cause.message : t('tasks.messages.loadFailed')
  } finally {
    allTasksLoading.value = false
    if (allTasksReloadQueued.value && allTasksModalOpen.value) {
      allTasksReloadQueued.value = false
      void loadAllTasks(true)
    } else {
      allTasksReloadQueued.value = false
    }
  }
}

function handleAllTasksScroll(event: Event): void {
  const element = event.currentTarget as HTMLElement
  if (element.scrollHeight - element.scrollTop - element.clientHeight < 80) {
    void loadAllTasks()
  }
}

async function openTask(task: TaskRun): Promise<void> {
  forceCancelError.value = ''
  const executionOpenDetail = deploymentExecutionOpenDetail(task)
  if (executionOpenDetail) {
    detail.value = null
    monitoringProbes.value = []
    resetAutomationDetail()
    allTasksModalOpen.value = false
    emit('close')
    dispatchOpenDeploymentExecution(executionOpenDetail)
    return
  }
  detail.value = null
  monitoringProbes.value = []
  resetAutomationDetail()
  allTasksModalOpen.value = false
  detailLoading.value = true
  detailError.value = ''
  try {
    const loadedDetail = await refreshTaskDetail(task.id)
    if (loadedDetail?.task) {
      resolveTaskPresentations([loadedDetail.task])
    }
  } catch (cause) {
    detailError.value = cause instanceof Error ? cause.message : t('tasks.messages.detailFailed')
  } finally {
    detailLoading.value = false
  }
}

async function refreshTaskDetail(taskId: string): Promise<TaskDetail | null> {
  const result = await getTask(taskId)
  detail.value = result.data ?? null
  resetAutomationDetail()
  if (detail.value?.task.category === 'MONITORING') {
    const probes = await listMonitoringProbes(taskId, { page: 1, pageSize: 20 })
    monitoringProbes.value = probes.data?.items ?? []
    return detail.value
  }
  monitoringProbes.value = []
  if (detail.value?.task && isAutomationTask(detail.value.task)) {
    await loadAutomationTaskDetail(detail.value.task)
  }
  return detail.value
}

function closeDetail(): void {
  detail.value = null
  monitoringProbes.value = []
  resetAutomationDetail()
  forceCancelError.value = ''
}

function submitQuickSearch(): void {
  applyQuickTaskActivity(currentTaskActivity())
}

function submitAllTasksSearch(): void {
  void loadAllTasks(true)
}

function applyRealtimeTaskSnapshot(message: TaskRealtimeMessage): void {
  if (message.type === 'snapshot') {
    const active = message.activeTasks.filter((task) => QUICK_ACTIVE_STATUS_SET.has(task.status) && isQuickTask(task))
    const recent = (message.recentTasks ?? []).filter((task) => QUICK_COMPLETED_STATUS_SET.has(task.status) && isQuickTask(task))
    // 中文说明：空首帧不能抹掉 REST 兜底结果，避免代理或服务端暂时没有推送历史记录时面板变空。
    if (active.length > 0 || recent.length > 0 || (fallbackActiveTasks.value.length === 0 && fallbackRecentCompleted.value.length === 0)) {
      fallbackActiveTasks.value = active
      fallbackRecentCompleted.value = recent.slice(0, 50)
    }
    message.activeTasks.forEach((task) => applyRealtimeTaskToAllTasks(task))
    message.recentTasks?.forEach((task) => applyRealtimeTaskToAllTasks(task))
    return
  }
  applyRealtimeTaskChange(message.task)
}

function handleRealtimeMessage(message: TaskRealtimeMessage): void {
  if (message.type === 'snapshot' || message.type === 'task.changed') {
    applyRealtimeTaskSnapshot(message)
  }
}

function applyRealtimeTaskChange(task: TaskRun): void {
  updateFallbackTask(task)
  applyRealtimeTaskToAllTasks(task)
  if (detailTask.value?.id === task.id && detail.value) {
    detail.value = { ...detail.value, task }
  }
  if (forceCancelTarget.value?.id === task.id) {
    forceCancelTarget.value = task
    if (!canForceCancel(task) && !forceCancelLoading.value) forceCancelConfirmOpen.value = false
  }
}

function updateFallbackTask(task: TaskRun): void {
  const active = fallbackActiveTasks.value.filter((item) => item.id !== task.id)
  const recent = fallbackRecentCompleted.value.filter((item) => item.id !== task.id)
  if (!isQuickTask(task)) {
    fallbackActiveTasks.value = active
    fallbackRecentCompleted.value = recent
    return
  }
  if (QUICK_ACTIVE_STATUS_SET.has(task.status)) active.push(task)
  if (QUICK_COMPLETED_STATUS_SET.has(task.status)) recent.unshift(task)
  fallbackActiveTasks.value = sortTasks(active)
  fallbackRecentCompleted.value = sortTasks(recent).slice(0, 50)
}

function applyLocalTaskChange(task: TaskRun): void {
  const active = quickActiveTasks.value.filter((item) => item.id !== task.id)
  const recent = quickRecentCompleted.value.filter((item) => item.id !== task.id)
  if (matchesTaskKeyword(task, appliedQuickKeyword.value) && isQuickTask(task)) {
    if (canForceCancel(task)) active.push(task)
    else recent.unshift(task)
  }
  applyQuickTasksState({
    active: sortTasks(active),
    recent: sortTasks(recent).slice(0, RECENT_TASK_LIMIT),
  })
}

function applyRealtimeTaskToAllTasks(task: TaskRun): void {
  if (!allTasksModalOpen.value) return
  const next = allTasks.value.filter((item) => item.id !== task.id)
  if (matchesAllTaskScope(task) && matchesAllTaskKeyword(task)) next.push(task)
  applyAllTasksState({ items: sortTasks(next), page: allTasksPage.value, hasMore: allTasksHasMore.value })
}

function matchesAllTaskKeyword(task: TaskRun): boolean {
  return matchesTaskKeyword(task, allTasksKeyword.value)
}

function matchesTaskKeyword(task: TaskRun, keywordValue: string): boolean {
  const query = keywordValue.trim().toLocaleLowerCase()
  if (!query) return true
  return [task.id, task.taskType, task.lastErrorMessage ?? '']
    .some((value) => value.toLocaleLowerCase().includes(query))
}

function statusTone(status: TaskStatus): 'success' | 'warning' | 'danger' | 'info' | 'muted' {
  if (status === 'SUCCEEDED') return 'success'
  if (['FAILED', 'CANCELLED'].includes(status)) return 'danger'
  if (['RUNNING', 'WAITING_RESULT', 'CANCELLING'].includes(status)) return 'info'
  if (status === 'AWAITING_CONFIRMATION') return 'warning'
  if (status === 'RETRY_WAITING') return 'warning'
  return 'muted'
}

function taskStatusTone(task: TaskRun): 'success' | 'warning' | 'danger' | 'info' | 'muted' {
  // 自动化任务的统一状态可能已经收敛为 SUCCEEDED，但目标中仍存在失败项。
  // 这表示“部分成功”，必须保留警告色，不能伪装成全量成功。
  if (isAutomationTask(task) && automationTaskMetric(task, 'failed') > 0 && !['FAILED', 'CANCELLED'].includes(task.status)) return 'warning'
  return statusTone(task.status)
}

function localTime(value?: string): string {
  return value ? formatBrowserLocalTime(value, { includeSeconds: false }) || value : t('common.notAvailable')
}

function recordValue(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return value === undefined || value === null ? t('common.notAvailable') : typeof value === 'string' ? value : JSON.stringify(value)
}

function eventTypeOf(event: Record<string, unknown>): string {
  return String(event.eventType ?? event.type ?? '').toUpperCase()
}

function recordFromUnknown(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function eventDataRecord(event: Record<string, unknown>): Record<string, unknown> | undefined {
  const value = event.eventData
  const record = recordFromUnknown(value)
  if (record) return record
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    return recordFromUnknown(JSON.parse(value))
  } catch {
    return undefined
  }
}

function buildPluginRefreshResult(events: readonly Record<string, unknown>[]): PluginRefreshResult {
  const terminalEvent = [...events].reverse().find((event) => ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(eventTypeOf(event)))
  const eventData = terminalEvent ? eventDataRecord(terminalEvent) : undefined
  const result = recordFromUnknown(eventData?.result) ?? recordFromUnknown(eventData?.detail) ?? eventData
  const versions = Array.isArray(result?.versions)
    ? result.versions.flatMap((item) => pluginRefreshVersionFromUnknown(item))
    : []
  const explicitBeforeVersions = firstArrayFromRecord(result, ['beforeVersions', 'previousVersions', 'before'])
    .flatMap((item) => pluginRefreshVersionFromUnknown(item))
  const beforeVersions = explicitBeforeVersions.length > 0
    ? explicitBeforeVersions
    : (Array.isArray(result?.versions) ? result.versions.flatMap((item) => pluginRefreshPreviousVersionFromUnknown(item)) : [])
  const changes = buildPluginRefreshChanges(
    Array.isArray(result?.changes) ? result.changes : [],
    beforeVersions,
    versions,
  )
  const projection = recordFromUnknown(result?.projection)
  const failed = Array.isArray(projection?.failed)
    ? projection.failed.flatMap((item) => {
      const record = recordFromUnknown(item)
      return record ? [record] : []
    })
    : []
  return {
    available: Boolean(result && (
      Array.isArray(result.versions)
      || Array.isArray(result.changes)
      || Array.isArray(result.beforeVersions)
      || recordFromUnknown(result.projection)
      || stringFromRecord(result, 'refreshedAt')
    )),
    refreshedAt: stringFromRecord(result, 'refreshedAt'),
    versions,
    beforeVersions,
    changes,
    projection: {
      attempted: numberFromRecord(projection, 'attempted'),
      projected: numberFromRecord(projection, 'projected'),
      skipped: numberFromRecord(projection, 'skipped'),
      failed,
    },
  }
}

function firstArrayFromRecord(record: Record<string, unknown> | undefined, keys: readonly string[]): unknown[] {
  for (const key of keys) {
    if (Array.isArray(record?.[key])) return record[key] as unknown[]
  }
  return []
}

function pluginRefreshVersionFromUnknown(value: unknown): PluginRefreshVersion[] {
  const record = recordFromUnknown(value)
  if (!record) return []
  return [{
    id: firstNonEmptyString(stringFromRecord(record, 'id'), stringFromRecord(record, 'pluginVersionId')),
    pluginId: firstNonEmptyString(stringFromRecord(record, 'pluginId'), stringFromRecord(record, 'pluginKey'), stringFromRecord(record, 'id')),
    version: firstNonEmptyString(stringFromRecord(record, 'version'), stringFromRecord(record, 'currentVersion'), stringFromRecord(record, 'previousVersion')),
    status: firstNonEmptyString(stringFromRecord(record, 'status'), stringFromRecord(record, 'currentStatus'), stringFromRecord(record, 'previousStatus')),
  }]
}

function pluginRefreshPreviousVersionFromUnknown(value: unknown): PluginRefreshVersion[] {
  const record = recordFromUnknown(value)
  if (!record) return []
  const version = firstNonEmptyString(
    stringFromRecord(record, 'previousVersion'),
    stringFromRecord(record, 'beforeVersion'),
  )
  const status = firstNonEmptyString(
    stringFromRecord(record, 'previousStatus'),
    stringFromRecord(record, 'beforeStatus'),
  )
  if (!version && !status) return []
  return [{
    id: firstNonEmptyString(stringFromRecord(record, 'previousId'), stringFromRecord(record, 'beforeId')),
    pluginId: firstNonEmptyString(stringFromRecord(record, 'pluginId'), stringFromRecord(record, 'pluginKey')),
    version,
    status,
  }]
}

function buildPluginRefreshChanges(
  rawChanges: readonly unknown[],
  beforeVersions: readonly PluginRefreshVersion[],
  afterVersions: readonly PluginRefreshVersion[],
): PluginRefreshChange[] {
  const parsed = rawChanges.flatMap((item) => {
    const record = recordFromUnknown(item)
    if (!record) return []
    const pluginId = firstNonEmptyString(stringFromRecord(record, 'pluginId'), stringFromRecord(record, 'pluginKey'))
    if (!pluginId) return []
    const before = pluginRefreshVersionFromUnknown(record.before ?? record.previous).at(0) ?? pluginRefreshLegacyVersion(record, 'previous')
    const after = pluginRefreshVersionFromUnknown(record.after ?? record.current).at(0) ?? pluginRefreshLegacyVersion(record, 'current')
    const changeType = normalizePluginRefreshChangeType(stringFromRecord(record, 'changeType'))
    return [{
      pluginId,
      ...(before ? { before: { ...before, pluginId } } : {}),
      ...(after ? { after: { ...after, pluginId } } : {}),
      changeType: changeType ?? inferPluginRefreshChangeType(before, after),
    }]
  })
  if (parsed.length > 0) return parsed

  const beforeByPlugin = new Map(beforeVersions.flatMap((version) => version.pluginId ? [[version.pluginId, version] as const] : []))
  const afterByPlugin = new Map(afterVersions.flatMap((version) => version.pluginId ? [[version.pluginId, version] as const] : []))
  const pluginIds = new Set([...beforeByPlugin.keys(), ...afterByPlugin.keys()])
  return [...pluginIds].sort((left, right) => left.localeCompare(right)).map((pluginId) => {
    const before = beforeByPlugin.get(pluginId)
    const after = afterByPlugin.get(pluginId)
    return {
      pluginId,
      ...(before ? { before } : {}),
      ...(after ? { after } : {}),
      changeType: inferPluginRefreshChangeType(before, after),
    }
  })
}

function pluginRefreshLegacyVersion(record: Record<string, unknown>, side: 'previous' | 'current'): PluginRefreshVersion | undefined {
  const version = firstNonEmptyString(
    side === 'previous' ? stringFromRecord(record, 'previousVersion') : stringFromRecord(record, 'currentVersion'),
    side === 'previous' ? stringFromRecord(record, 'beforeVersion') : stringFromRecord(record, 'afterVersion'),
  )
  const status = firstNonEmptyString(
    side === 'previous' ? stringFromRecord(record, 'previousStatus') : stringFromRecord(record, 'currentStatus'),
    side === 'previous' ? stringFromRecord(record, 'beforeStatus') : stringFromRecord(record, 'afterStatus'),
  )
  return version || status ? { version, status } : undefined
}

function normalizePluginRefreshChangeType(value?: string): PluginRefreshChangeType | undefined {
  const normalized = value?.toUpperCase()
  return normalized === 'ADDED' || normalized === 'UPDATED' || normalized === 'REMOVED' || normalized === 'UNCHANGED'
    ? normalized
    : undefined
}

function inferPluginRefreshChangeType(before?: PluginRefreshVersion, after?: PluginRefreshVersion): PluginRefreshChangeType {
  if (!before) return 'ADDED'
  if (!after) return 'REMOVED'
  return before.version !== after.version || before.status !== after.status ? 'UPDATED' : 'UNCHANGED'
}

function buildPluginRefreshTimeline(events: readonly Record<string, unknown>[], task: TaskRun | null): PluginRefreshTimelineItem[] {
  if (task?.taskType !== 'PLUGIN_REFERENCE_REFRESH') return []
  const result = buildPluginRefreshResult(events)
  return events
    .filter((event) => PLUGIN_REFRESH_EVENT_TYPES.has(eventTypeOf(event)))
    .map((event, index) => {
      const eventType = eventTypeOf(event)
      const eventData = eventDataRecord(event)
      return {
        id: String(event.id ?? `${eventType || 'event'}-${index + 1}`),
        createdAt: firstNonEmptyString(stringFromRecord(event, 'createdAt'), stringFromRecord(event, 'timestamp')) ?? task.createdAt,
        description: pluginRefreshEventDescription(eventType, task, eventData, result),
        tone: pluginRefreshEventTone(eventType),
      }
    })
}

function pluginRefreshEventDescription(
  eventType: string,
  task: TaskRun,
  eventData: Record<string, unknown> | undefined,
  result: PluginRefreshResult,
): string {
  if (eventType === 'SUCCEEDED') {
    return t('tasks.pluginRefresh.events.succeeded', {
      versions: result.versions.length,
      projected: pluginRefreshCount(result.projection.projected, result.available),
    })
  }
  if (eventType === 'FAILED') {
    return t('tasks.pluginRefresh.events.failed', {
      reason: firstNonEmptyString(stringFromRecord(eventData, 'errorMessage'), task.lastErrorMessage) ?? t('tasks.values.none'),
    })
  }
  const eventKey: Record<string, string> = {
    CREATED: 'created',
    CLAIMED: 'claimed',
    STARTED: 'started',
    PROGRESS: 'progress',
    RETRY_SCHEDULED: 'retryScheduled',
    WAITING_RESULT: 'waitingResult',
    AWAITING_CONFIRMATION: 'awaitingConfirmation',
    CANCEL_REQUESTED: 'cancelRequested',
    EXPIRED: 'expired',
    CANCELLED: 'cancelled',
  }
  return t(`tasks.pluginRefresh.events.${eventKey[eventType] ?? 'progress'}`)
}

function pluginRefreshEventTone(eventType: string): PluginRefreshTimelineItem['tone'] {
  if (eventType === 'SUCCEEDED') return 'success'
  if (['FAILED', 'EXPIRED', 'CANCELLED'].includes(eventType)) return 'danger'
  if (['RETRY_SCHEDULED', 'AWAITING_CONFIRMATION', 'CANCEL_REQUESTED'].includes(eventType)) return 'warning'
  if (['CLAIMED', 'STARTED', 'PROGRESS', 'WAITING_RESULT'].includes(eventType)) return 'info'
  return 'muted'
}

function pluginRefreshTaskSummary(task: TaskRun): string {
  const result = pluginRefreshResult.value
  if (task.status === 'SUCCEEDED') {
    return t('tasks.pluginRefresh.summary.succeeded', {
      versions: result.versions.length,
      projected: pluginRefreshCount(result.projection.projected, result.available),
    })
  }
  if (task.status === 'FAILED') return task.lastErrorMessage || t('tasks.pluginRefresh.summary.failed')
  if (task.status === 'CANCELLED') return t('tasks.pluginRefresh.summary.cancelled')
  if (task.status === 'RETRY_WAITING') return t('tasks.pluginRefresh.summary.retryWaiting')
  if (task.status === 'WAITING_RESULT') return t('tasks.pluginRefresh.summary.waitingResult')
  if (task.status === 'AWAITING_CONFIRMATION') return t('tasks.pluginRefresh.summary.awaitingConfirmation')
  if (task.status === 'CANCELLING') return t('tasks.pluginRefresh.summary.cancelling')
  if (task.status === 'QUEUED') return t('tasks.pluginRefresh.summary.queued')
  return t('tasks.pluginRefresh.summary.running')
}

function pluginRefreshScope(task: TaskRun): string {
  const scope = firstNonEmptyString(
    stringFromRecord(task.payload, 'scope'),
    stringFromRecord(task.resourceSummary, 'scope'),
  )
  return normalizeTaskRelatedName(scope) ?? t('tasks.pluginRefresh.values.unavailable')
}

function pluginRefreshCount(value: number | undefined, available = true): string {
  return !available || value === undefined ? t('tasks.pluginRefresh.values.unavailable') : String(value)
}

function pluginRefreshVersionLabel(version: PluginRefreshVersion): string {
  const pluginId = version.pluginId || t('tasks.pluginRefresh.values.unavailable')
  return version.version ? `${pluginId} · ${version.version}` : pluginId
}

function pluginRefreshStatusLabel(status?: string): string {
  const normalized = status?.toUpperCase()
  if (normalized === 'ENABLED' || normalized === 'ACTIVE') return t('tasks.pluginRefresh.versionStatus.enabled')
  if (normalized === 'DISABLED' || normalized === 'RETIRED') return t('tasks.pluginRefresh.versionStatus.disabled')
  return t('tasks.pluginRefresh.versionStatus.other')
}

function pluginRefreshVersionStatusLabel(version: PluginRefreshVersion): string {
  if (pluginRefreshChangeForVersion(version)?.changeType === 'ADDED') {
    return t('tasks.pluginRefresh.versionStatus.added')
  }
  return pluginRefreshStatusLabel(version.status)
}

function pluginRefreshVersionTone(status?: string): 'success' | 'warning' | 'danger' | 'info' | 'muted' {
  const normalized = status?.toUpperCase()
  if (normalized === 'ENABLED' || normalized === 'ACTIVE') return 'success'
  if (normalized === 'DISABLED' || normalized === 'RETIRED') return 'muted'
  return 'warning'
}

function pluginRefreshVersionValue(version?: PluginRefreshVersion): string {
  return version?.version || t('tasks.pluginRefresh.values.unavailable')
}

function pluginRefreshChangeForVersion(version: PluginRefreshVersion): PluginRefreshChange | undefined {
  const pluginId = version.pluginId
  return pluginId ? pluginRefreshResult.value.changes.find((change) => change.pluginId === pluginId) : undefined
}

function pluginRefreshVersionTransition(version: PluginRefreshVersion): string | undefined {
  const change = pluginRefreshChangeForVersion(version)
  if (!change || change.changeType === 'UNCHANGED') return undefined
  const before = pluginRefreshVersionValue(change.before)
  const after = pluginRefreshVersionValue(change.after)
  return before === after ? undefined : `${before} → ${after}`
}

function pluginRefreshStatusTransition(version: PluginRefreshVersion): string | undefined {
  const change = pluginRefreshChangeForVersion(version)
  if (!change || change.changeType === 'UNCHANGED' || !change.before || !change.after) return undefined
  const before = pluginRefreshStatusLabel(change.before.status)
  const after = pluginRefreshStatusLabel(change.after.status)
  return before === after ? undefined : `${before} → ${after}`
}

function pluginRefreshFailureTarget(failure: Record<string, unknown>): string {
  return firstNonEmptyString(
    stringFromRecord(failure, 'agentId'),
    stringFromRecord(failure, 'tenantId'),
  ) ?? t('tasks.pluginRefresh.values.unavailable')
}

function pluginRefreshFailureMessage(failure: Record<string, unknown>): string {
  return firstNonEmptyString(
    stringFromRecord(failure, 'error'),
    stringFromRecord(failure, 'errorMessage'),
    stringFromRecord(failure, 'message'),
  ) ?? t('tasks.pluginRefresh.values.unavailable')
}

function taskTriggerSourceLabel(task: TaskRun): string {
  if (task.taskType === 'PLUGIN_REFERENCE_REFRESH') return t('tasks.pluginRefresh.values.triggerSource')
  if (
    task.triggerSource === 'automation.external_api'
    || (isAutomationTask(task) && automationRun.value?.triggerContext?.sourceType === 'external_api')
  ) return t('tasks.values.externalApi')
  return task.triggerSource
}

function taskStatusLabel(task: TaskRun): string {
  if (isAutomationTask(task) && task.status === 'SUCCEEDED' && automationTaskMetric(task, 'failed') > 0) {
    return t('designSystem.status.PARTIAL_SUCCESS')
  }
  return translateDynamic(t, te, 'tasks.status', task.status)
}

function taskTypeLabel(task: TaskRun): string {
  const key = `tasks.typeLabels.${task.taskType}`
  const label = t(key)
  return label === key ? t('tasks.typeLabels.OTHER') : label
}

function taskRelatedName(task: TaskRun): string {
  const isDeploymentTask = isDeploymentExecutionTask(task)
  if (task.taskType === 'ACME_CERTIFICATE_RENEWAL') {
    const presentation = acmeRenewalTaskPresentations.value[task.id]
    return presentation
      ? t('tasks.relatedNames.acmeRenewal', {
        provider: presentation.providerName,
        certificate: presentation.certificateName,
      })
      : taskTypeLabel(task)
  }
  if (isDeploymentExecutionTask(task)) {
    const planId = taskDeploymentPlanId(task)
    if (planId && deploymentPlanNames.value[planId]) return normalizeDeploymentResourceName(deploymentPlanNames.value[planId]) ?? deploymentPlanNames.value[planId]
  }
  const candidate = normalizeTaskRelatedName(firstNonEmptyString(
    recordStringByKeys(task.resourceSummary, ['resourceName', 'displayName', 'name', 'planName', 'assetDisplayName', 'assetName', 'providerDisplayName', 'providerName', 'pluginName', 'workflowName', 'applicationName', 'siteName', 'bindingName', 'bindingDisplayName', 'certificateName', 'technologyName', 'targetName']),
    recordStringByKeys(task.payload, ['displayName', 'name', 'planName', 'deploymentPlanName', 'pluginName', 'workflowName', 'workflowId', 'providerDisplayName', 'providerName', 'providerKey', 'operationKey', 'technologyName', 'siteName', 'bindingName', 'bindingInformation', 'agentId', 'certificateAssetId', 'deploymentPlanId', 'renewalJobId', 'certificateRequestId', 'targetPluginVersionId', 'pluginId', 'scope']),
  ))
  if (isDeploymentExecutionTask(task) && isRecordId(candidate, 'pln_')) return t('tasks.relatedNames.deploymentPlan')
  return isDeploymentTask ? normalizeDeploymentResourceName(candidate) ?? taskTypeLabel(task) : candidate ?? taskTypeLabel(task)
}

function taskDisplayTitle(task: TaskRun): string {
  const action = taskTypeLabel(task)
  const name = taskRelatedName(task)
  return `${action} · ${name === action ? task.id : name}`
}

function taskResultSummary(task: TaskRun): string {
  if (task.status === 'FAILED' || task.status === 'CANCELLED') {
    return firstNonEmptyString(
      task.lastErrorMessage,
      stringFromRecord(task.progress, 'errorMessage'),
      stringFromRecord(task.progress, 'status'),
    ) ?? taskStatusLabel(task)
  }
  return firstNonEmptyString(
    stringFromRecord(task.progress, 'summary'),
    stringFromRecord(task.progress, 'message'),
    stringFromRecord(task.progress, 'status'),
    stringFromRecord(task.resourceSummary, 'summary'),
  ) ?? taskStatusLabel(task)
}

function taskOverview(task: TaskRun): string {
  if (task.status === 'FAILED' || task.status === 'CANCELLED') return taskResultSummary(task)
  return firstNonEmptyString(
    stringFromRecord(task.progress, 'summary'),
    stringFromRecord(task.progress, 'message'),
    stringFromRecord(task.progress, 'detail'),
    stringFromRecord(task.progress, 'status'),
    stringFromRecord(task.resourceSummary, 'summary'),
  ) ?? (te(`tasks.summaryTemplates.${task.status}`)
    ? t(`tasks.summaryTemplates.${task.status}`, { task: taskTypeLabel(task) })
    : taskStatusLabel(task))
}

function taskStatusSummary(task: TaskRun): string {
  if (task.taskType === 'AGENT_UPDATE') return agentUpgradeSummary(task)
  if (task.taskType === 'ACME_CERTIFICATE_RENEWAL') return acmeRenewalTaskSummary(task)
  const status = taskStatusLabel(task)
  const overview = taskOverview(task)
  return overview === status ? overview : `${status} · ${overview}`
}

function acmeRenewalTaskSummary(task: TaskRun): string {
  if (task.status === 'FAILED' || task.status === 'CANCELLED') {
    return firstNonEmptyString(
      task.lastErrorMessage,
      stringFromRecord(task.progress, 'errorMessage'),
    ) ?? acmeAttemptLabel(task.status === 'FAILED' ? 'failed' : 'cancelled')
  }
  if (task.status === 'QUEUED') return acmeAttemptLabel('queued')
  if (task.status === 'RUNNING') return acmeAttemptLabel('running')
  if (task.status === 'RETRY_WAITING') return acmeAttemptLabel('retryWaiting')
  if (task.status === 'SUCCEEDED') return acmeAttemptLabel('succeeded')
  return taskStatusLabel(task)
}

function agentUpgradeSummary(task: TaskRun): string {
  if (task.status === 'FAILED' || task.status === 'CANCELLED') {
    return task.lastErrorMessage || t('tasks.agentUpdate.summary.failed')
  }
  const code = firstNonEmptyString(
    stringFromRecord(task.progress, 'summaryCode'),
    stringFromRecord(task.resourceSummary, 'summaryCode'),
  ) ?? agentUpgradePhase(task)
  const key = `tasks.agentUpdate.summary.${code}`
  if (!te(key)) return t(`tasks.summaryTemplates.${task.status}`, { task: taskTypeLabel(task) })
  return t(key, {
    currentVersion: agentUpgradeVersion(task, 'currentVersion'),
    targetVersion: agentUpgradeVersion(task, 'targetVersion'),
  })
}

function agentUpgradePhase(task: TaskRun): string {
  const phase = firstNonEmptyString(
    stringFromRecord(task.progress, 'phase'),
    stringFromRecord(task.resourceSummary, 'phase'),
  )
  if (phase) return phase
  if (task.status === 'SUCCEEDED') return 'succeeded'
  if (task.status === 'FAILED' || task.status === 'CANCELLED') return 'failed'
  if (task.status === 'RUNNING') return 'upgrading'
  return 'queued'
}

function agentUpgradePhaseLabel(task: TaskRun): string {
  const key = `tasks.agentUpdate.phases.${agentUpgradePhase(task)}`
  return te(key) ? t(key) : agentUpgradePhase(task)
}

function agentUpgradeVersion(task: TaskRun, key: 'currentVersion' | 'targetVersion'): string {
  return firstNonEmptyString(
    stringFromRecord(task.progress, key),
    stringFromRecord(task.resourceSummary, key),
    stringFromRecord(task.payload, key),
  ) ?? t('tasks.agentUpdate.values.unknown')
}

function agentUpgradeEventLabel(event: Record<string, unknown>): string {
  const eventType = String(event.eventType ?? '').toUpperCase()
  const key = `tasks.agentUpdate.events.${eventType.toLowerCase()}`
  return te(key) ? t(key) : eventType
}

function agentUpgradeProgress(task: TaskRun): number {
  if (task.status === 'SUCCEEDED' || task.status === 'FAILED' || task.status === 'CANCELLED') return 100
  const phase = agentUpgradePhase(task)
  if (phase === 'queued') return 10
  if (phase === 'dispatching') return 25
  if (phase === 'accepted') return 45
  if (phase === 'upgrading') return 70
  if (phase === 'status_checking') return 80
  return 35
}

function acmeAttemptLabel(state: AcmeTaskAttemptState): string {
  return t(`tasks.acmeHistory.${state}.title`)
}

function acmeAttemptDescription(state: AcmeTaskAttemptState): string {
  return t(`tasks.acmeHistory.${state}.description`)
}

function acmeAttemptTone(state: AcmeTaskAttemptState): 'success' | 'warning' | 'danger' | 'info' | 'muted' {
  if (state === 'succeeded') return 'success'
  if (state === 'retryWaiting') return 'warning'
  if (state === 'failed' || state === 'cancelled') return 'danger'
  if (state === 'running') return 'info'
  return 'muted'
}

function isDeploymentExecutionTask(task: TaskRun): boolean {
  return isRealDeploymentExecutionTask(task)
}

function isAutomationTask(task: TaskRun | null | undefined): task is TaskRun {
  return task?.taskType === 'AUTOMATION_RUN'
}

function shouldRenderTaskProgress(task: TaskRun): boolean {
  return isDeploymentExecutionTask(task) || task.taskType === 'AUTOMATION_RUN' || task.taskType === 'AGENT_UPDATE'
}

function taskProgressPercent(task: TaskRun): number {
  const explicit = firstFiniteNumber(
    recordNumberByKeys(task.progress, ['percent', 'percentage', 'progressPercent', 'progress', 'completedPercent']),
    recordNumberByKeys(task.resourceSummary, ['percent', 'percentage', 'progressPercent', 'progress', 'completedPercent']),
    recordNumberByKeys(task.payload, ['percent', 'percentage', 'progressPercent', 'progress', 'completedPercent']),
  )
  if (explicit !== undefined) return clampPercent(explicit <= 1 ? explicit * 100 : explicit)
  if (task.taskType === 'AGENT_UPDATE') return agentUpgradeProgress(task)
  const completed = firstFiniteNumber(
    recordNumberByKeys(task.progress, ['completed', 'completedSteps', 'finishedSteps', 'done']),
    recordNumberByKeys(task.resourceSummary, ['completed', 'completedSteps', 'finishedSteps', 'done']),
  )
  const total = firstFiniteNumber(
    recordNumberByKeys(task.progress, ['total', 'totalSteps', 'stepCount']),
    recordNumberByKeys(task.resourceSummary, ['total', 'totalSteps', 'stepCount']),
  )
  if (completed !== undefined && total !== undefined && total > 0) return clampPercent((completed / total) * 100)
  if (task.status === 'SUCCEEDED') return 100
  if (task.status === 'FAILED' || task.status === 'CANCELLED') return 100
  if (task.status === 'RUNNING') return 35
  if (task.status === 'WAITING_RESULT') return 50
  if (task.status === 'AWAITING_CONFIRMATION') return 50
  return 0
}

interface AutomationTaskMetrics {
  total: number
  succeeded: number
  failed: number
  completed: number
}

function automationTaskMetric(task: TaskRun, key: 'total' | 'succeeded' | 'failed' | 'running'): number {
  const keys: Record<typeof key, readonly string[]> = {
    total: ['totalTargets', 'total'],
    succeeded: ['succeededTargets', 'succeeded'],
    failed: ['failedTargets', 'failed'],
    running: ['runningTargets', 'running'],
  }
  return firstFiniteNumber(
    recordNumberByKeys(task.progress, keys[key]),
    recordNumberByKeys(task.resourceSummary, keys[key]),
    recordNumberByKeys(task.payload, keys[key]),
  ) ?? 0
}

function automationTaskMetrics(task: TaskRun): AutomationTaskMetrics {
  const total = automationTaskMetric(task, 'total')
  const succeeded = automationTaskMetric(task, 'succeeded')
  const failed = automationTaskMetric(task, 'failed')
  return {
    total,
    succeeded,
    failed,
    completed: Math.min(total, succeeded + failed),
  }
}

function automationRunMetric(key: 'total' | 'succeeded' | 'failed' | 'running'): number {
  const value = automationRun.value?.targetSummary?.[key]
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value))
  return detailTask.value ? automationTaskMetric(detailTask.value, key) : 0
}

function automationRunProgressText(): string {
  return t('automations.runs.progress', {
    succeeded: automationRunMetric('succeeded'),
    total: automationRunMetric('total'),
  })
}

function automationFailureStageLabel(stage?: string): string {
  if (!stage) return t('automations.runDetail.noFailure')
  return translateDynamic(t, te, 'automations.failureStages', stage)
}

function taskAutomationRunId(task: TaskRun): string | undefined {
  return firstNonEmptyString(
    stringFromRecord(task.payload, 'runId'),
    stringFromRecord(task.progress, 'automationRunId'),
    stringFromRecord(task.resourceSummary, 'automationRunId'),
  )
}

function canForceCancel(task: TaskRun | null | undefined): boolean {
  return Boolean(task && ['QUEUED', 'RUNNING', 'RETRY_WAITING', 'WAITING_RESULT', 'AWAITING_CONFIRMATION', 'CANCELLING'].includes(task.status))
}

function requestForceEndTask(task: TaskRun | null | undefined): void {
  if (!task || !canForceCancel(task) || forceCancelLoading.value) return
  forceCancelTarget.value = task
  forceCancelError.value = ''
  forceCancelConfirmOpen.value = true
}

function closeForceCancelConfirm(force = false): void {
  if (forceCancelLoading.value && !force) return
  forceCancelConfirmOpen.value = false
  forceCancelTarget.value = null
  forceCancelError.value = ''
}

async function confirmForceEndTask(): Promise<void> {
  const task = forceCancelTarget.value
  if (!task || forceCancelLoading.value) return
  const returnToListAfterCancel = detail.value?.task.id === task.id
  forceCancelLoading.value = true
  forceCancelError.value = ''
  try {
    const result = await forceCancelTask(task.id, t('tasks.actions.forceCancelReason'))
    const updated = result.data
    if (updated) {
      applyRealtimeTaskChange(updated)
      applyLocalTaskChange(updated)
      if (detail.value?.task.id === updated.id) detail.value = { ...detail.value, task: updated }
      closeForceCancelConfirm(true)
      if (returnToListAfterCancel) returnToTaskList()
    }
  } catch (cause) {
    forceCancelError.value = cause instanceof Error ? cause.message : t('tasks.messages.forceCancelFailed')
  } finally {
    forceCancelLoading.value = false
  }
}

function automationActionLabel(actionType?: string): string {
  if (actionType === 'create_deployment_plan') return t('automations.editor.chain.createPlan')
  if (actionType === 'execute_deployment_plan') return t('automations.editor.chain.executePlan')
  if (actionType === 'send_notification') return t('reports.groups.values.send_notification')
  return t('common.notAvailable')
}

function resetAutomationDetail(): void {
  automationRun.value = null
  automationTargets.value = []
}

async function loadAutomationTaskDetail(task: TaskRun): Promise<void> {
  const runId = taskAutomationRunId(task)
  if (!runId) return
  const [runRecord, targetRecords] = await Promise.all([
    getAutomationRun(runId),
    listAutomationRunTargets(runId),
  ])
  automationRun.value = runRecord
  automationTargets.value = targetRecords
}

function returnToTaskList(): void {
  closeDetail()
  forceCancelConfirmOpen.value = false
  forceCancelTarget.value = null
  forceCancelError.value = ''
  allTasksModalOpen.value = true
  void loadAllTasks(true)
}

function sortTasks(tasks: readonly TaskRun[]): TaskRun[] {
  return [...tasks].sort((left, right) => {
    // 中文说明：最近完成队列按任务最后一次状态变为终态的时间排序。
    // 历史数据可能缺少 finishedAt，因此按 startedAt、createdAt 逐级回退。
    const statusTimeCompare = taskStatusTimestamp(right) - taskStatusTimestamp(left)
    if (statusTimeCompare !== 0) return statusTimeCompare
    // 中文说明：父自动化与子任务在同一时刻完成时，父任务固定排在前面，
    // 用户先看到批量操作的整体结果，再查看单个资产的执行结果。
    const automationPriorityCompare = Number(right.taskType === 'AUTOMATION_RUN') - Number(left.taskType === 'AUTOMATION_RUN')
    if (automationPriorityCompare !== 0) return automationPriorityCompare
    return right.id.localeCompare(left.id)
  })
}

function taskStatusTimestamp(task: Pick<TaskRun, 'finishedAt' | 'startedAt' | 'createdAt'>): number {
  for (const value of [task.finishedAt, task.startedAt, task.createdAt]) {
    if (!value) continue
    const timestamp = Date.parse(value)
    if (Number.isFinite(timestamp)) return timestamp
  }
  return 0
}

function sameTaskList(left: readonly TaskRun[], right: readonly TaskRun[]): boolean {
  if (left.length !== right.length) return false
  return left.every((task, index) => taskSignature(task) === taskSignature(right[index]))
}

function taskSignature(task?: TaskRun): string {
  if (!task) return ''
  return [
    task.id,
    task.taskType,
    task.status,
    task.requestedBy ?? '',
    task.createdAt,
    task.startedAt ?? '',
    task.finishedAt ?? '',
    task.lastErrorCode ?? '',
    task.lastErrorMessage ?? '',
    JSON.stringify(task.resourceSummary ?? {}),
    JSON.stringify(task.payload ?? {}),
    JSON.stringify(task.progress ?? {}),
  ].join('|')
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function stringFromRecord(record: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!record) return undefined
  const value = record[key]
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

function numberFromRecord(record: Record<string, unknown> | undefined, key: string): number | undefined {
  if (!record) return undefined
  const value = record[key]
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(number) ? number : undefined
}

function recordNumberByKeys(record: Record<string, unknown> | undefined, keys: readonly string[]): number | undefined {
  if (!record) return undefined
  for (const key of keys) {
    const value = numberFromRecord(record, key)
    if (value !== undefined) return value
  }
  return undefined
}

function firstFiniteNumber(...values: Array<number | undefined>): number | undefined {
  return values.find((value): value is number => typeof value === 'number' && Number.isFinite(value))
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function recordStringByKeys(record: Record<string, unknown> | undefined, keys: readonly string[]): string | undefined {
  if (!record) return undefined
  for (const key of keys) {
    const value = stringFromRecord(record, key)
    if (value) return value
  }
  return undefined
}

function normalizeTaskRelatedName(value?: string): string | undefined {
  if (!value) return undefined
  if (value === 'builtin-catalog' || value === 'plugin-catalog') return t('tasks.relatedNames.pluginCatalog')
  return value
}

function normalizeDeploymentResourceName(value?: string): string | undefined {
  const normalized = normalizeTaskRelatedName(value)
  if (!normalized) return undefined
  const legacyName = normalized.replace(/\s+证书部署$/, '').trim()
  return legacyName || normalized
}

function taskDeploymentPlanId(task: TaskRun): string | undefined {
  return firstNonEmptyString(
    stringFromRecord(task.resourceSummary, 'deploymentPlanId'),
    stringFromRecord(task.payload, 'deploymentPlanId'),
    stringFromRecord(task.payload, 'planId'),
  )
}

function taskExecutionRunId(task: TaskRun): string | undefined {
  return firstNonEmptyString(
    stringFromRecord(task.payload, 'runId'),
    stringFromRecord(task.resourceSummary, 'runId'),
    stringFromRecord(task.progress, 'runId'),
    stringFromRecord(task.resourceSummary, 'executionRunId'),
    stringFromRecord(task.payload, 'executionRunId'),
  )
}

function deploymentExecutionMode(taskType: string): DeploymentExecutionMode | undefined {
  if (taskType === 'CERTIFICATE_DRY_RUN') return 'dry-run'
  if (taskType === 'CERTIFICATE_DEPLOY') return 'apply'
  if (taskType === 'CERTIFICATE_ROLLBACK') return 'rollback'
  return undefined
}

function deploymentExecutionOpenDetail(task: TaskRun): DeploymentExecutionOpenDetail | undefined {
  if (!isDeploymentExecutionTask(task)) return undefined
  const mode = deploymentExecutionMode(task.taskType)
  if (!mode) return undefined
  const runId = taskExecutionRunId(task)
  if (!runId) return undefined
  return {
    taskId: task.id,
    runId,
    deploymentPlanId: taskDeploymentPlanId(task),
    mode,
    planName: taskRelatedName(task),
    status: task.status,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    summary: taskResultSummary(task),
  }
}

function isRecordId(value: string | undefined, prefix: string): boolean {
  return typeof value === 'string' && value.startsWith(prefix)
}

async function resolveDeploymentPlanNames(tasks: readonly TaskRun[]): Promise<void> {
  const missingPlanIds = Array.from(new Set(tasks
    .filter(isDeploymentExecutionTask)
    .map(taskDeploymentPlanId)
    .filter((planId): planId is string => {
      if (!planId) return false
      return !deploymentPlanNames.value[planId] && !deploymentPlanNameRequests.has(planId) && !deploymentPlanNameMisses.has(planId)
    })))
  if (missingPlanIds.length === 0) return
  missingPlanIds.forEach((planId) => deploymentPlanNameRequests.add(planId))
  const resolved: Record<string, string> = {}
  try {
    let page = 1
    let hasMore = true
    const pending = new Set(missingPlanIds)
    while (hasMore && pending.size > 0) {
      const result = await listDeploymentPlans({ page, pageSize: PAGE_SIZE })
      const data = result.data
      for (const item of data?.items ?? []) {
        const id = stringFromRecord(item, 'id')
        if (!id || !pending.has(id)) continue
        const name = firstNonEmptyString(
          stringFromRecord(item, 'name'),
          stringFromRecord(item, 'title'),
          stringFromRecord(item, 'planName'),
          stringFromRecord(item, 'displayName'),
        )
        if (name && !isRecordId(name, 'pln_')) resolved[id] = name
        pending.delete(id)
      }
      const currentPage = data?.page ?? page
      const pageSize = data?.pageSize ?? PAGE_SIZE
      const total = data?.total ?? 0
      hasMore = currentPage * pageSize < total
      page = currentPage + 1
    }
  } catch {
    // 中文说明：任务列表不能因为名称补全失败而中断，后续刷新会继续尝试解析。
  } finally {
    missingPlanIds.forEach((planId) => deploymentPlanNameRequests.delete(planId))
  }
  missingPlanIds
    .filter((planId) => !resolved[planId])
    .forEach((planId) => deploymentPlanNameMisses.add(planId))
  if (Object.keys(resolved).length > 0) deploymentPlanNames.value = { ...deploymentPlanNames.value, ...resolved }
}

function resolveTaskPresentations(tasks: readonly TaskRun[]): void {
  void resolveDeploymentPlanNames(tasks)
  void resolveAcmeRenewalTaskPresentations(tasks)
}

async function resolveAcmeRenewalTaskPresentations(tasks: readonly TaskRun[]): Promise<void> {
  const pending = tasks
    .filter((task) => task.taskType === 'ACME_CERTIFICATE_RENEWAL')
    .map((task) => ({ task, renewalJobId: taskRenewalJobId(task) }))
    .filter((item): item is { task: TaskRun; renewalJobId: string } => Boolean(item.renewalJobId))
    .filter(({ task }) => !acmeRenewalTaskPresentations.value[task.id]
      && !acmeRenewalTaskPresentationRequests.has(task.id)
      && !acmeRenewalTaskPresentationMisses.has(task.id))
  if (pending.length === 0) return

  pending.forEach(({ task }) => acmeRenewalTaskPresentationRequests.add(task.id))
  try {
    const [jobsResult, policiesResult, providersResult] = await Promise.all([
      internalCaApi.listAcmeRenewalJobs(),
      internalCaApi.listAcmeRenewalPolicies(),
      internalCaApi.listAcmeProviders(),
    ])
    const jobs = recordsFromApi(jobsResult.data)
    const policies = recordsFromApi(policiesResult.data)
    const providers = recordsFromApi(providersResult.data)
    const jobById = new Map(jobs.map((job) => [recordString(job, 'id'), job]))
    const policyById = new Map(policies.map((policy) => [recordString(policy, 'id'), policy]))
    const providerById = new Map(providers.map((provider) => [recordString(provider, 'id'), provider]))
    const assetIds = Array.from(new Set(pending
      .map(({ renewalJobId }) => jobById.get(renewalJobId))
      .map((job) => job ? policyById.get(recordString(job, 'policyId')) : undefined)
      .map((policy) => policy ? recordString(policy, 'certificateAssetId') : '')
      .filter(Boolean)))
    const assets = await Promise.all(assetIds.map(async (assetId) => {
      const result = await getCertificateAssetDetail(assetId)
      return [assetId, certificateAssetName(result.data)] as const
    }))
    const assetNameById = new Map(assets.filter(([, name]) => Boolean(name)))
    const resolved: Record<string, AcmeRenewalTaskPresentation> = {}
    for (const { task, renewalJobId } of pending) {
      const job = jobById.get(renewalJobId)
      const policy = job ? policyById.get(recordString(job, 'policyId')) : undefined
      const provider = policy ? providerById.get(recordString(policy, 'providerId')) : undefined
      const certificateName = policy ? assetNameById.get(recordString(policy, 'certificateAssetId')) : undefined
      const providerName = provider ? firstNonEmptyString(recordString(provider, 'name'), recordString(provider, 'displayName')) : undefined
      if (certificateName && providerName) resolved[task.id] = { certificateName, providerName }
    }
    pending
      .filter(({ task }) => !resolved[task.id])
      .forEach(({ task }) => acmeRenewalTaskPresentationMisses.add(task.id))
    if (Object.keys(resolved).length > 0) {
      acmeRenewalTaskPresentations.value = { ...acmeRenewalTaskPresentations.value, ...resolved }
    }
  } catch {
    // 中文说明：展示名称补全失败时保留 ACME 类型标签，避免泄露内部续签作业 ID。
  } finally {
    pending.forEach(({ task }) => acmeRenewalTaskPresentationRequests.delete(task.id))
  }
}

function taskRenewalJobId(task: TaskRun): string | undefined {
  return firstNonEmptyString(
    stringFromRecord(task.payload, 'renewalJobId'),
    stringFromRecord(task.resourceSummary, 'renewalJobId'),
  )
}

function recordsFromApi(value: unknown): InternalCaRecord[] {
  if (Array.isArray(value)) return value.map(asRecord).filter((item) => Object.keys(item).length > 0)
  const record = asRecord(value)
  return Array.isArray(record.items) ? recordsFromApi(record.items) : Object.keys(record).length > 0 ? [record] : []
}

function certificateAssetName(value: unknown): string | undefined {
  const record = asRecord(value)
  const asset = asRecord(record.asset)
  return firstNonEmptyString(
    recordString(asset, 'name'),
    recordString(asset, 'primaryDomain'),
    recordString(record, 'name'),
    recordString(record, 'primaryDomain'),
  )
}

function asRecord(value: unknown): InternalCaRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as InternalCaRecord : {}
}

function recordString(record: InternalCaRecord, key: string): string {
  return typeof record[key] === 'string' ? record[key].trim() : ''
}
</script>

<template>
  <Transition name="task-popover">
    <div
      v-if="open"
      class="task-popover"
      role="dialog"
      aria-labelledby="global-task-popover-title"
    >
      <span class="task-popover__anchor" aria-hidden="true" />
      <header class="task-popover__header">
        <div>
          <h2 id="global-task-popover-title">{{ t('tasks.title') }}</h2>
        </div>
        <GcButton variant="icon" class="task-popover__close" :aria-label="t('designSystem.modal.closeAria')" @click="emit('close')">
          <span aria-hidden="true">×</span>
        </GcButton>
      </header>
      <div class="task-popover__body">
        <div v-if="detail" class="task-drawer__detail">
          <GcButton @click="closeDetail">{{ t('tasks.actions.backToList') }}</GcButton>
          <div class="task-drawer__detail-header">
            <div>
              <p v-if="detailTask?.taskType !== 'PLUGIN_REFERENCE_REFRESH'" class="task-drawer__eyebrow">{{ detailTask?.id }}</p>
              <p v-else class="task-drawer__eyebrow">{{ t('tasks.pluginRefresh.subtitle') }}</p>
              <h3>{{ detailTask ? taskDisplayTitle(detailTask) : '' }}</h3>
              <p v-if="detailTask && detailTask.taskType !== 'PLUGIN_REFERENCE_REFRESH'" class="task-drawer__eyebrow">{{ taskTypeLabel(detailTask) }}</p>
            </div>
            <GcStatusTag
              :status="detailTask?.status ?? 'UNKNOWN'"
              :label="detailTask ? taskStatusLabel(detailTask) : undefined"
              :tone="detailTask ? taskStatusTone(detailTask) : statusTone('QUEUED')"
            />
          </div>
          <div v-if="detailTask && canForceCancel(detailTask)" class="task-drawer__detail-actions">
            <GcButton v-if="canForceCancel(detailTask)" class="gc-button--danger" :loading="forceCancelLoading" @click="requestForceEndTask(detailTask)">
              {{ t('tasks.actions.forceCancel') }}
            </GcButton>
          </div>
          <p v-if="forceCancelError" class="gc-form-error">{{ forceCancelError }}</p>
          <p v-if="detailError" class="gc-form-error">{{ detailError }}</p>
          <div v-if="detailLoading" class="task-drawer__loading">{{ t('common.loading') }}</div>
          <template v-else-if="detailTask?.taskType === 'PLUGIN_REFERENCE_REFRESH'">
            <section class="task-drawer__plugin-summary">
              <div class="task-drawer__plugin-summary-copy">
                <span class="task-drawer__plugin-kicker">{{ t('tasks.pluginRefresh.overview.kicker') }}</span>
                <h4>{{ pluginRefreshTaskSummary(detailTask) }}</h4>
                <p>{{ t('tasks.pluginRefresh.overview.description', { scope: pluginRefreshScope(detailTask) }) }}</p>
              </div>
              <div class="task-drawer__plugin-summary-status">
                <GcStatusTag :status="detailTask.status" :label="taskStatusLabel(detailTask)" :tone="statusTone(detailTask.status)" />
                <span>{{ localTime(pluginRefreshResult.refreshedAt || detailTask.finishedAt || detailTask.createdAt) }}</span>
              </div>
            </section>
            <dl class="task-drawer__plugin-metrics">
              <div>
                <dt>{{ t('tasks.pluginRefresh.metrics.catalogVersions') }}</dt>
                <dd>{{ pluginRefreshCount(pluginRefreshResult.versions.length, pluginRefreshResult.available) }}</dd>
              </div>
              <div>
                <dt>{{ t('tasks.pluginRefresh.metrics.enabledVersions') }}</dt>
                <dd>{{ pluginRefreshCount(pluginRefreshEnabledCount, pluginRefreshResult.available) }}</dd>
              </div>
              <div>
                <dt>{{ t('tasks.pluginRefresh.metrics.agentsProjected') }}</dt>
                <dd>{{ pluginRefreshCount(pluginRefreshResult.projection.projected, pluginRefreshResult.available) }}</dd>
              </div>
              <div>
                <dt>{{ t('tasks.pluginRefresh.metrics.agentsFailed') }}</dt>
                <dd :class="{ 'task-drawer__plugin-metric-value--danger': pluginRefreshResult.projection.failed.length > 0 }">{{ pluginRefreshCount(pluginRefreshResult.projection.failed.length, pluginRefreshResult.available) }}</dd>
              </div>
            </dl>
            <section class="task-drawer__section">
              <div class="task-drawer__section-heading">
                <h4>{{ t('tasks.pluginRefresh.sections.timeline') }}</h4>
                <span>{{ pluginRefreshTimeline.length }}</span>
              </div>
              <ol v-if="pluginRefreshTimeline.length > 0" class="task-drawer__plugin-timeline">
                <li v-for="item in pluginRefreshTimeline" :key="item.id" :data-tone="item.tone">
                  <span class="task-drawer__plugin-timeline-dot" aria-hidden="true" />
                  <div>
                    <strong>{{ item.description }}</strong>
                    <time>{{ localTime(item.createdAt) }}</time>
                  </div>
                </li>
              </ol>
              <GcEmptyState v-else class="task-drawer__empty task-drawer__empty--section" :title="t('tasks.values.empty')" />
            </section>
            <section class="task-drawer__section">
              <div class="task-drawer__section-heading">
                <h4>{{ t('tasks.pluginRefresh.sections.catalogVersions') }}</h4>
                <span>{{ pluginRefreshCount(pluginRefreshResult.versions.length, pluginRefreshResult.available) }}</span>
              </div>
              <div v-if="pluginRefreshResult.versions.length > 0" class="task-drawer__plugin-versions">
                <div v-for="version in pluginRefreshResult.versions" :key="version.id || `${version.pluginId}-${version.version}`" class="task-drawer__plugin-version">
                  <div>
                    <strong>{{ pluginRefreshVersionLabel(version) }}</strong>
                    <span v-if="pluginRefreshVersionTransition(version)" class="task-drawer__plugin-version-transition">
                      {{ pluginRefreshVersionTransition(version) }}
                    </span>
                    <span v-if="pluginRefreshStatusTransition(version)" class="task-drawer__plugin-status-transition">
                      {{ pluginRefreshStatusTransition(version) }}
                    </span>
                  </div>
                  <GcStatusTag :status="version.status || 'UNKNOWN'" :label="pluginRefreshVersionStatusLabel(version)" :tone="pluginRefreshVersionTone(version.status)" />
                </div>
              </div>
              <GcEmptyState v-else class="task-drawer__empty task-drawer__empty--section" :title="t('tasks.pluginRefresh.values.noVersions')" />
            </section>
            <section v-if="pluginRefreshResult.projection.failed.length > 0" class="task-drawer__section">
              <div class="task-drawer__section-heading">
                <h4>{{ t('tasks.pluginRefresh.sections.failures') }}</h4>
                <span class="task-drawer__plugin-failure-count">{{ pluginRefreshResult.projection.failed.length }}</span>
              </div>
              <div class="task-drawer__plugin-failures">
                <div v-for="(failure, index) in pluginRefreshResult.projection.failed" :key="`${pluginRefreshFailureTarget(failure)}-${index}`" class="task-drawer__plugin-failure">
                  <strong>{{ pluginRefreshFailureTarget(failure) }}</strong>
                  <span>{{ pluginRefreshFailureMessage(failure) }}</span>
                </div>
              </div>
            </section>
            <details class="task-drawer__technical-details">
              <summary>{{ t('tasks.pluginRefresh.actions.showTechnicalDetails') }}</summary>
              <dl class="task-drawer__facts task-drawer__facts--technical">
                <div><dt>{{ t('tasks.fields.requestedBy') }}</dt><dd>{{ detailTask.requestedBy || t('tasks.values.system') }}</dd></div>
                <div><dt>{{ t('tasks.fields.triggerSource') }}</dt><dd>{{ taskTriggerSourceLabel(detailTask) }}</dd></div>
                <div><dt>{{ t('tasks.fields.createdAt') }}</dt><dd>{{ localTime(detailTask.createdAt) }}</dd></div>
                <div><dt>{{ t('tasks.fields.startedAt') }}</dt><dd>{{ localTime(detailTask.startedAt) }}</dd></div>
                <div><dt>{{ t('tasks.fields.finishedAt') }}</dt><dd>{{ localTime(detailTask.finishedAt) }}</dd></div>
                <div><dt>{{ t('tasks.pluginRefresh.fields.taskId') }}</dt><dd>{{ detailTask.id }}</dd></div>
              </dl>
              <pre class="task-drawer__json">{{ JSON.stringify(detail.events, null, 2) || t('tasks.values.empty') }}</pre>
            </details>
          </template>
          <template v-else>
            <dl class="task-drawer__facts">
              <div><dt>{{ t('tasks.fields.requestedBy') }}</dt><dd>{{ detailTask?.requestedBy || t('tasks.values.system') }}</dd></div>
              <div><dt>{{ t('tasks.fields.triggerSource') }}</dt><dd>{{ detailTask ? taskTriggerSourceLabel(detailTask) : '' }}</dd></div>
              <div><dt>{{ t('tasks.fields.createdAt') }}</dt><dd>{{ localTime(detailTask?.createdAt) }}</dd></div>
              <div><dt>{{ t('tasks.fields.startedAt') }}</dt><dd>{{ localTime(detailTask?.startedAt) }}</dd></div>
              <div><dt>{{ t('tasks.fields.finishedAt') }}</dt><dd>{{ localTime(detailTask?.finishedAt) }}</dd></div>
              <div><dt>{{ t('tasks.fields.error') }}</dt><dd>{{ detailTask?.lastErrorMessage || t('common.notAvailable') }}</dd></div>
            </dl>
            <section v-if="detailTask?.taskType === 'AGENT_UPDATE'" class="task-drawer__section task-drawer__agent-update">
              <div class="task-drawer__section-heading">
                <h4>{{ t('tasks.agentUpdate.title') }}</h4>
                <GcStatusTag :status="detailTask.status" :label="taskStatusLabel(detailTask)" :tone="statusTone(detailTask.status)" />
              </div>
              <p class="task-drawer__agent-update-summary">{{ agentUpgradeSummary(detailTask) }}</p>
              <GcProgressBar
                class="task-drawer__item-progress"
                :value="agentUpgradeProgress(detailTask)"
                :tone="statusTone(detailTask.status)"
                captionInside
                :ariaLabel="agentUpgradeSummary(detailTask)"
              >
                <span class="task-drawer__item-progress-text">{{ agentUpgradeProgress(detailTask) }}%</span>
              </GcProgressBar>
              <dl class="task-drawer__facts task-drawer__agent-update-facts">
                <div><dt>{{ t('tasks.agentUpdate.fields.target') }}</dt><dd>{{ taskRelatedName(detailTask) }}</dd></div>
                <div><dt>{{ t('tasks.agentUpdate.fields.currentVersion') }}</dt><dd>{{ agentUpgradeVersion(detailTask, 'currentVersion') }}</dd></div>
                <div><dt>{{ t('tasks.agentUpdate.fields.targetVersion') }}</dt><dd class="task-drawer__agent-update-target">{{ agentUpgradeVersion(detailTask, 'targetVersion') }}</dd></div>
                <div><dt>{{ t('tasks.agentUpdate.fields.phase') }}</dt><dd>{{ agentUpgradePhaseLabel(detailTask) }}</dd></div>
                <div><dt>{{ t('tasks.agentUpdate.fields.planId') }}</dt><dd>{{ recordValue(detailTask.payload ?? {}, 'planId') }}</dd></div>
                <div><dt>{{ t('tasks.agentUpdate.fields.transactionId') }}</dt><dd>{{ recordValue(detailTask.payload ?? {}, 'transactionId') }}</dd></div>
              </dl>
              <p v-if="detailTask.lastErrorMessage" class="task-drawer__agent-update-error">{{ detailTask.lastErrorMessage }}</p>
              <div class="task-drawer__agent-update-events">
                <h5>{{ t('tasks.agentUpdate.timelineTitle') }}</h5>
                <ol class="task-drawer__timeline">
                  <li v-for="event in visibleDetailEvents" :key="String(event.id)">
                    <strong>{{ agentUpgradeEventLabel(event) }}</strong>
                    <time>{{ localTime(recordValue(event, 'createdAt')) }}</time>
                  </li>
                </ol>
              </div>
            </section>
            <section v-if="detailTask?.taskType === 'ACME_CERTIFICATE_RENEWAL'" class="task-drawer__section">
              <h4>{{ t('tasks.sections.acmeHistory') }}</h4>
              <GcEmptyState v-if="acmeAttemptHistory.length === 0" class="task-drawer__empty task-drawer__empty--section" :title="t('tasks.values.empty')" />
              <ol v-else class="task-drawer__acme-history">
                <li
                  v-for="attempt in acmeAttemptHistory"
                  :key="attempt.id"
                  class="task-drawer__acme-attempt"
                  :class="`task-drawer__acme-attempt--${attempt.state}`"
                >
                  <div class="task-drawer__acme-attempt-header">
                    <div>
                      <strong>{{ acmeAttemptLabel(attempt.state) }}</strong>
                      <time>{{ localTime(attempt.finishedAt || attempt.startedAt) }}</time>
                    </div>
                    <GcStatusTag :status="attempt.state" :label="acmeAttemptLabel(attempt.state)" :tone="acmeAttemptTone(attempt.state)" />
                  </div>
                  <p>{{ acmeAttemptDescription(attempt.state) }}</p>
                </li>
              </ol>
            </section>
            <section v-else-if="detailTask?.taskType !== 'AGENT_UPDATE' && detailTask?.taskType !== 'AUTOMATION_RUN'" class="task-drawer__section">
              <h4>{{ t('tasks.sections.timeline') }}</h4>
              <ol class="task-drawer__timeline">
                <li v-for="event in visibleDetailEvents" :key="String(event.id)">
                  <strong>{{ recordValue(event, 'eventType') }}</strong>
                  <time>{{ localTime(recordValue(event, 'createdAt')) }}</time>
                  <span>{{ recordValue(event, 'eventData') }}</span>
                </li>
              </ol>
            </section>
            <dl v-if="detailTask && isAutomationTask(detailTask)" class="task-drawer__facts task-drawer__automation-facts">
              <div><dt>{{ t('tasks.fields.requestedBy') }}</dt><dd>{{ detailTask.requestedBy || t('tasks.values.system') }}</dd></div>
              <div><dt>{{ t('tasks.fields.triggerSource') }}</dt><dd>{{ taskTriggerSourceLabel(detailTask) }}</dd></div>
              <div><dt>{{ t('tasks.fields.createdAt') }}</dt><dd>{{ localTime(detailTask.createdAt) }}</dd></div>
              <div><dt>{{ t('tasks.fields.startedAt') }}</dt><dd>{{ localTime(detailTask.startedAt) }}</dd></div>
              <div><dt>{{ t('tasks.fields.finishedAt') }}</dt><dd>{{ localTime(detailTask.finishedAt) }}</dd></div>
            </dl>
            <section v-if="detailTask && isAutomationTask(detailTask) && automationRun" class="task-drawer__section task-drawer__automation-detail">
              <h4>{{ t('tasks.typeLabels.AUTOMATION_RUN') }}</h4>
              <div class="task-drawer__automation-overview">
                <p class="task-drawer__item-summary">
                  {{ taskStatusLabel(detailTask) }} · {{ automationRunProgressText() }}
                </p>
                <GcProgressBar
                  class="task-drawer__item-progress"
                  :value="taskProgressPercent(detailTask)"
                  :tone="taskStatusTone(detailTask)"
                  captionInside
                  :ariaLabel="taskStatusSummary(detailTask)"
                >
                  <span class="task-drawer__item-progress-text">{{ taskProgressPercent(detailTask) }}%</span>
                </GcProgressBar>
                <dl class="task-drawer__automation-metrics">
                  <div>
                    <dt>{{ t('automations.progress.total') }}</dt>
                    <dd>{{ automationRunMetric('total') }}</dd>
                  </div>
                  <div>
                    <dt>{{ t('automations.progress.succeeded') }}</dt>
                    <dd class="task-drawer__automation-metric--success">{{ automationRunMetric('succeeded') }}</dd>
                  </div>
                  <div>
                    <dt>{{ t('automations.progress.failed') }}</dt>
                    <dd :class="{ 'task-drawer__automation-metric--danger': automationRunMetric('failed') > 0 }">{{ automationRunMetric('failed') }}</dd>
                  </div>
                  <div>
                    <dt>{{ t('automations.progress.running') }}</dt>
                    <dd>{{ automationRunMetric('running') }}</dd>
                  </div>
                  <div>
                    <dt>{{ t('automations.runs.progress', { succeeded: automationRunMetric('succeeded'), total: automationRunMetric('total') }) }}</dt>
                    <dd>{{ automationRunProgressText() }}</dd>
                  </div>
                </dl>
                <p v-if="detailTask.lastErrorMessage" class="task-drawer__automation-error">{{ detailTask.lastErrorMessage }}</p>
              </div>
              <GcEmptyState v-if="automationTargets.length === 0" class="task-drawer__empty task-drawer__empty--section" :title="t('tasks.values.empty')" />
              <div v-for="target in automationTargets" :key="target.id" class="task-drawer__record">
                <div class="task-drawer__record-header">
                  <div class="task-drawer__automation-target-title">
                    <strong>{{ target.targetSnapshot.assetName || target.targetSnapshot.certificateName }}</strong>
                    <span>{{ target.targetSnapshot.certificateName }} · {{ target.targetSnapshot.environment || t('common.notAvailable') }}</span>
                  </div>
                  <GcStatusTag :status="target.status" />
                </div>
                <dl class="task-drawer__automation-target-facts">
                  <div>
                    <dt>{{ t('automations.detail.fields.actionChain') }}</dt>
                    <dd>{{ automationActionLabel(target.currentAction) }}</dd>
                  </div>
                  <div v-if="target.failureStage">
                    <dt>{{ t('automations.fields.failureStage') }}</dt>
                    <dd>{{ automationFailureStageLabel(target.failureStage) }}</dd>
                  </div>
                </dl>
                <p v-if="target.errorMessage" class="task-drawer__automation-target-error">{{ target.errorMessage }}</p>
                <details v-if="target.errorCode" class="task-drawer__automation-target-technical">
                  <summary>{{ t('tasks.pluginRefresh.actions.showTechnicalDetails') }}</summary>
                  <code>{{ target.errorCode }}</code>
                </details>
                <div class="task-drawer__record-actions">
                  <GcButton v-if="target.deploymentPlanId" @click="router.push(`/executions?planId=${target.deploymentPlanId}`)">{{ t('automations.actions.openPlan') }}</GcButton>
                  <GcButton v-if="target.executionRunId" @click="router.push(`/executions?runId=${target.executionRunId}`)">{{ t('automations.actions.openExecution') }}</GcButton>
                </div>
              </div>
              <details class="task-drawer__technical-details">
                <summary>{{ t('tasks.pluginRefresh.actions.showTechnicalDetails') }}</summary>
                <section class="task-drawer__automation-technical-section">
                  <h5>{{ t('tasks.sections.timeline') }}</h5>
                  <ol class="task-drawer__timeline">
                    <li v-for="event in visibleDetailEvents" :key="String(event.id)">
                      <strong>{{ recordValue(event, 'eventType') }}</strong>
                      <time>{{ localTime(recordValue(event, 'createdAt')) }}</time>
                      <span>{{ recordValue(event, 'eventData') }}</span>
                    </li>
                  </ol>
                </section>
                <section class="task-drawer__automation-technical-section">
                  <h5>{{ t('tasks.sections.attempts') }}</h5>
                  <div v-for="attempt in detail.attempts" :key="String(attempt.id)" class="task-drawer__record">
                    <strong>#{{ recordValue(attempt, 'attemptNo') }} · {{ recordValue(attempt, 'status') }}</strong>
                    <span>{{ recordValue(attempt, 'workerId') }}</span>
                    <time>{{ localTime(recordValue(attempt, 'startedAt')) }}</time>
                    <p v-if="attempt.errorSummary">{{ attempt.errorSummary }}</p>
                  </div>
                </section>
                <section class="task-drawer__automation-technical-section">
                  <h5>{{ t('tasks.sections.logs') }}</h5>
                  <pre class="task-drawer__json">{{ JSON.stringify(detail.events, null, 2) || t('tasks.values.empty') }}</pre>
                </section>
                <section class="task-drawer__automation-technical-section">
                  <h5>{{ t('tasks.sections.audit') }}</h5>
                  <pre class="task-drawer__json">{{ JSON.stringify(detail.auditEvents, null, 2) || t('tasks.values.empty') }}</pre>
                </section>
              </details>
            </section>
            <section v-if="detailTask?.taskType !== 'ACME_CERTIFICATE_RENEWAL' && detailTask?.taskType !== 'AUTOMATION_RUN'" class="task-drawer__section">
              <h4>{{ t('tasks.sections.attempts') }}</h4>
              <div v-for="attempt in detail.attempts" :key="String(attempt.id)" class="task-drawer__record">
                <strong>#{{ recordValue(attempt, 'attemptNo') }} · {{ recordValue(attempt, 'status') }}</strong>
                <span>{{ recordValue(attempt, 'workerId') }}</span>
                <time>{{ localTime(recordValue(attempt, 'startedAt')) }}</time>
                <p v-if="attempt.errorSummary">{{ attempt.errorSummary }}</p>
              </div>
            </section>
            <section v-if="detailTask?.category !== 'MONITORING' && detailTask?.taskType !== 'AUTOMATION_RUN'" class="task-drawer__section">
              <h4>{{ t('tasks.sections.logs') }}</h4>
              <details class="task-drawer__raw-logs">
                <summary>{{ t('tasks.actions.viewRawLogs') }}</summary>
                <pre class="task-drawer__json">{{ JSON.stringify(detail.events, null, 2) || t('tasks.values.empty') }}</pre>
              </details>
            </section>
            <section v-if="detailTask?.taskType !== 'AUTOMATION_RUN'" class="task-drawer__section">
              <h4>{{ t('tasks.sections.children') }}</h4>
              <GcEmptyState v-if="detail.childTasks.length === 0" class="task-drawer__empty task-drawer__empty--section" :title="t('tasks.values.empty')" />
              <div v-for="child in detail.childTasks" :key="child.id" class="task-drawer__record">
                <strong>{{ child.taskType }}</strong><span>{{ child.id }}</span><GcStatusTag :status="child.status" :label="taskStatusLabel(child)" :tone="statusTone(child.status)" />
              </div>
            </section>
            <section v-if="detailTask?.taskType !== 'AUTOMATION_RUN'" class="task-drawer__section">
              <h4>{{ t('tasks.sections.errors') }}</h4>
              <p>{{ detailTask?.lastErrorCode || t('tasks.values.none') }} · {{ detailTask?.lastErrorMessage || t('tasks.values.none') }}</p>
            </section>
            <section v-if="detailTask?.taskType !== 'AUTOMATION_RUN'" class="task-drawer__section">
              <h4>{{ t('tasks.sections.audit') }}</h4>
              <pre class="task-drawer__json">{{ JSON.stringify(detail.auditEvents, null, 2) || t('tasks.values.empty') }}</pre>
            </section>
            <section v-if="detailTask?.category === 'MONITORING'" class="task-drawer__section">
              <h4>{{ t('tasks.sections.monitoringProbes') }}</h4>
              <div v-for="probe in monitoringProbes" :key="String(probe.id)" class="task-drawer__record">
                <strong>{{ recordValue(probe, 'serviceAssetId') }}</strong><span>{{ recordValue(probe, 'status') }}</span><time>{{ localTime(recordValue(probe, 'checkedAt')) }}</time>
              </div>
            </section>
          </template>
        </div>
        <div v-else class="task-drawer__list">
          <form class="task-drawer__toolbar" @submit.prevent="submitQuickSearch">
            <label class="task-drawer__search">
              <span class="task-drawer__sr-only">{{ t('tasks.filters.keyword') }}</span>
              <input v-model="keyword" :placeholder="t('tasks.filters.keyword')" :aria-label="t('tasks.filters.keyword')" type="search">
            </label>
          </form>
          <div class="task-drawer__scroll">
            <div class="task-drawer__quick-groups">
              <section class="task-drawer__group">
                <header class="task-drawer__group-header">
                  <h3>{{ t('tasks.quick.active') }}</h3>
                  <span class="task-drawer__group-count">{{ quickActiveTasks.length }}</span>
                </header>
                <GcEmptyState v-if="quickActiveTasks.length === 0" class="task-drawer__empty task-drawer__empty--section" :title="t('tasks.values.empty')" />
                <div v-else class="task-drawer__items">
                  <div v-for="task in quickActiveTasks" :key="task.id" class="task-drawer__item">
                    <GcButton class="task-drawer__item-open" @click="openTask(task)">
                      <span class="task-drawer__item-main">
                        <span class="task-drawer__item-header">
                          <small class="task-drawer__item-type">{{ taskTypeLabel(task) }}</small>
                          <strong class="task-drawer__item-title">{{ taskDisplayTitle(task) }}</strong>
                        </span>
                        <span v-if="!shouldRenderTaskProgress(task)" class="task-drawer__item-summary">{{ taskStatusSummary(task) }}</span>
                        <span v-if="isAutomationTask(task)" class="task-drawer__automation-item-stats">
                          <span>{{ t('automations.progress.total') }} {{ automationTaskMetrics(task).total }}</span>
                          <span class="task-drawer__automation-item-stat--success">{{ t('automations.progress.succeeded') }} {{ automationTaskMetrics(task).succeeded }}</span>
                          <span :class="{ 'task-drawer__automation-item-stat--danger': automationTaskMetrics(task).failed > 0 }">{{ t('automations.progress.failed') }} {{ automationTaskMetrics(task).failed }}</span>
                          <span>{{ t('automations.runs.progress', { succeeded: automationTaskMetrics(task).succeeded, total: automationTaskMetrics(task).total }) }}</span>
                        </span>
                        <span class="task-drawer__item-meta-row">
                          <small class="task-drawer__item-meta">{{ task.requestedBy || t('tasks.values.system') }} · {{ localTime(task.createdAt) }}</small>
                        </span>
                        <GcProgressBar
                          v-if="shouldRenderTaskProgress(task)"
                          class="task-drawer__item-progress"
                          :value="taskProgressPercent(task)"
                          :tone="taskStatusTone(task)"
                          captionInside
                          :ariaLabel="taskStatusSummary(task)"
                        >
                          <span class="task-drawer__item-progress-text">{{ taskProgressPercent(task) }}%</span>
                        </GcProgressBar>
                      </span>
                    </GcButton>
                    <span class="task-drawer__item-controls">
                      <GcStatusTag :status="task.status" :label="taskStatusLabel(task)" :tone="taskStatusTone(task)" />
                      <GcButton
                        v-if="canForceCancel(task)"
                        variant="icon"
                        class="task-drawer__item-force gc-button--danger"
                        :aria-label="t('tasks.actions.forceCancel')"
                        :title="t('tasks.actions.forceCancel')"
                        :loading="forceCancelLoading"
                        @click.stop="requestForceEndTask(task)"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                      </GcButton>
                    </span>
                  </div>
                </div>
              </section>
              <section class="task-drawer__group">
                <header class="task-drawer__group-header">
                  <h3>{{ t('tasks.quick.recent') }}</h3>
                  <span class="task-drawer__group-count">{{ quickRecentCompleted.length }}</span>
                </header>
                <GcEmptyState v-if="quickRecentCompleted.length === 0" class="task-drawer__empty task-drawer__empty--section" :title="t('tasks.values.empty')" />
                <div v-else class="task-drawer__items">
                  <div v-for="task in quickRecentCompleted" :key="task.id" class="task-drawer__item">
                    <GcButton class="task-drawer__item-open" @click="openTask(task)">
                      <span class="task-drawer__item-main">
                        <span class="task-drawer__item-header">
                          <small class="task-drawer__item-type">{{ taskTypeLabel(task) }}</small>
                          <strong class="task-drawer__item-title">{{ taskDisplayTitle(task) }}</strong>
                        </span>
                        <span v-if="!shouldRenderTaskProgress(task)" class="task-drawer__item-summary">{{ taskStatusSummary(task) }}</span>
                        <span v-if="isAutomationTask(task)" class="task-drawer__automation-item-stats">
                          <span>{{ t('automations.progress.total') }} {{ automationTaskMetrics(task).total }}</span>
                          <span class="task-drawer__automation-item-stat--success">{{ t('automations.progress.succeeded') }} {{ automationTaskMetrics(task).succeeded }}</span>
                          <span :class="{ 'task-drawer__automation-item-stat--danger': automationTaskMetrics(task).failed > 0 }">{{ t('automations.progress.failed') }} {{ automationTaskMetrics(task).failed }}</span>
                          <span>{{ t('automations.runs.progress', { succeeded: automationTaskMetrics(task).succeeded, total: automationTaskMetrics(task).total }) }}</span>
                        </span>
                        <span class="task-drawer__item-meta-row">
                          <small class="task-drawer__item-meta">{{ task.requestedBy || t('tasks.values.system') }} · {{ localTime(task.createdAt) }}</small>
                        </span>
                        <GcProgressBar
                          v-if="shouldRenderTaskProgress(task)"
                          class="task-drawer__item-progress"
                          :value="taskProgressPercent(task)"
                          :tone="taskStatusTone(task)"
                          captionInside
                          :ariaLabel="taskStatusSummary(task)"
                        >
                          <span class="task-drawer__item-progress-text">{{ taskProgressPercent(task) }}%</span>
                        </GcProgressBar>
                      </span>
                    </GcButton>
                    <span class="task-drawer__item-controls">
                      <GcStatusTag :status="task.status" :label="taskStatusLabel(task)" :tone="taskStatusTone(task)" />
                    </span>
                  </div>
                </div>
              </section>
            </div>
          </div>
          <GcButton variant="primary" class="task-drawer__view-all" @click="openAllTasks">
            {{ t('tasks.actions.viewAll') }}
          </GcButton>
        </div>
      </div>
    </div>
  </Transition>
  <GcModal
    v-model:open="allTasksModalOpen"
    size="xl"
    :title="t('tasks.actions.viewAll')"
  >
    <div class="task-drawer__all-list">
      <form class="task-drawer__toolbar" @submit.prevent="submitAllTasksSearch">
        <label class="task-drawer__search">
          <span class="task-drawer__sr-only">{{ t('tasks.filters.keyword') }}</span>
          <input v-model="allTasksKeyword" :placeholder="t('tasks.filters.keyword')" :aria-label="t('tasks.filters.keyword')" type="search">
        </label>
      </form>
      <div class="task-drawer__all-tabs">
        <GcTabs v-model="allTasksCategory" :tabs="allTaskTabs" :aria-label="t('tasks.aria.tabs')" />
      </div>
      <p v-if="allTasksError" class="gc-form-error">{{ allTasksError }}</p>
      <div ref="allTasksScroll" class="task-drawer__all-scroll" @scroll="handleAllTasksScroll">
        <div v-if="allTasksLoading && allTasks.length === 0" class="task-drawer__loading">{{ t('common.loading') }}</div>
        <GcEmptyState v-else-if="allTasks.length === 0" class="task-drawer__empty task-drawer__empty--section" :title="t('tasks.values.empty')" />
        <div v-else class="task-drawer__items">
          <div v-for="task in allTasks" :key="task.id" class="task-drawer__item">
            <GcButton class="task-drawer__item-open" @click="openTask(task)">
              <span class="task-drawer__item-main">
                <span class="task-drawer__item-header">
                  <small class="task-drawer__item-type">{{ taskTypeLabel(task) }}</small>
                  <strong class="task-drawer__item-title">{{ taskDisplayTitle(task) }}</strong>
                </span>
                <span v-if="!shouldRenderTaskProgress(task)" class="task-drawer__item-summary">{{ taskStatusSummary(task) }}</span>
                <span v-if="isAutomationTask(task)" class="task-drawer__automation-item-stats">
                  <span>{{ t('automations.progress.total') }} {{ automationTaskMetrics(task).total }}</span>
                  <span class="task-drawer__automation-item-stat--success">{{ t('automations.progress.succeeded') }} {{ automationTaskMetrics(task).succeeded }}</span>
                  <span :class="{ 'task-drawer__automation-item-stat--danger': automationTaskMetrics(task).failed > 0 }">{{ t('automations.progress.failed') }} {{ automationTaskMetrics(task).failed }}</span>
                  <span>{{ t('automations.runs.progress', { succeeded: automationTaskMetrics(task).succeeded, total: automationTaskMetrics(task).total }) }}</span>
                </span>
                <span class="task-drawer__item-meta-row">
                  <small class="task-drawer__item-meta">{{ task.requestedBy || t('tasks.values.system') }} · {{ localTime(task.createdAt) }}</small>
                </span>
                <GcProgressBar
                  v-if="shouldRenderTaskProgress(task)"
                  class="task-drawer__item-progress"
                  :value="taskProgressPercent(task)"
                  :tone="taskStatusTone(task)"
                  captionInside
                  :ariaLabel="taskStatusSummary(task)"
                >
                  <span class="task-drawer__item-progress-text">{{ taskProgressPercent(task) }}%</span>
                </GcProgressBar>
              </span>
            </GcButton>
            <span class="task-drawer__item-controls">
              <GcStatusTag :status="task.status" :label="taskStatusLabel(task)" :tone="taskStatusTone(task)" />
              <GcButton
                v-if="canForceCancel(task)"
                variant="icon"
                class="task-drawer__item-force gc-button--danger"
                :aria-label="t('tasks.actions.forceCancel')"
                :title="t('tasks.actions.forceCancel')"
                :loading="forceCancelLoading"
                @click.stop="requestForceEndTask(task)"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
              </GcButton>
            </span>
          </div>
        </div>
      </div>
    </div>
  </GcModal>
  <GcModal
    v-model:open="forceCancelConfirmOpen"
    size="sm"
    :title="t('designSystem.confirm.title', { action: t('tasks.actions.forceCancel') })"
    :description="t('tasks.actions.forceCancelConfirm')"
    :busy="forceCancelLoading"
    :error="forceCancelError"
  >
    <p v-if="forceCancelTarget" class="task-drawer__force-cancel-target">{{ taskRelatedName(forceCancelTarget) }}</p>
    <template #actions>
      <GcButton :disabled="forceCancelLoading" @click="closeForceCancelConfirm">
        {{ t('designSystem.confirm.cancel') }}
      </GcButton>
      <GcButton
        class="gc-button--danger"
        :loading="forceCancelLoading"
        @click="confirmForceEndTask"
      >
        {{ t('designSystem.confirm.confirm') }}
      </GcButton>
    </template>
  </GcModal>
</template>

<style scoped>
.task-popover {
  position: absolute;
  top: calc(100% + var(--gc-space-3));
  right: 0;
  z-index: 35;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  width: min(var(--gc-size-task-popover), calc(100vw - var(--gc-space-8)));
  max-height: 80vh;
  overflow: visible;
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-xl);
  background: var(--gc-color-surface-overlay);
  box-shadow: var(--gc-shadow-overlay);
  transform-origin: top right;
}

.task-popover__anchor {
  position: absolute;
  top: calc(var(--gc-space-2) * -1);
  right: calc(var(--gc-control-height-md) / 2);
  width: var(--gc-space-3);
  height: var(--gc-space-3);
  border-top: var(--gc-border-width-default) solid var(--gc-color-border);
  border-left: var(--gc-border-width-default) solid var(--gc-color-border);
  background: var(--gc-color-surface-overlay);
  transform: rotate(45deg);
}

.task-popover__header {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--gc-space-3);
  padding: var(--gc-space-3) var(--gc-space-4);
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border);
}

.task-popover__header h2 {
  margin: 0;
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-lg);
}

.task-popover__close {
  flex: 0 0 auto;
}

.task-popover__body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  padding: calc(var(--gc-space-3) - var(--gc-space-hairline));
}

.task-popover-enter-active,
.task-popover-leave-active {
  transition: opacity 180ms ease, transform 180ms ease;
}

.task-popover-enter-from,
.task-popover-leave-to {
  opacity: 0;
  transform: translateY(calc(var(--gc-space-2) * -1)) scale(0.98);
}

.task-drawer__list,
.task-drawer__detail,
.task-drawer__all-list {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gc-space-5);
}

.task-popover .task-drawer__list {
  gap: var(--gc-space-3);
}

:deep(.gc-modal__body) {
  display: flex;
  min-height: 0;
  overflow: hidden;
  padding: calc(var(--gc-space-4) - var(--gc-space-hairline));
}

.task-drawer__list,
.task-drawer__all-list {
  overflow: hidden;
}

.task-drawer__detail {
  overflow: auto;
}

.task-drawer__detail-actions,
.task-drawer__record-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--gc-space-4);
}

.task-drawer__toolbar {
  display: flex;
  align-items: center;
}

.task-drawer__quick-groups {
  display: flex;
  flex-direction: column;
  gap: var(--gc-space-4);
  min-height: max-content;
}

.task-popover .task-drawer__quick-groups {
  gap: var(--gc-space-3);
}

.task-drawer__group {
  display: grid;
  gap: var(--gc-space-2);
}

.task-popover .task-drawer__group {
  gap: var(--gc-space-1);
}

.task-drawer__group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-3);
}

.task-drawer__group-header h3 {
  margin: 0;
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-sm);
}

.task-drawer__group-count {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.task-drawer__search {
  flex: 1 1 auto;
  min-width: 0;
}

.task-drawer__search input {
  width: 100%;
  min-width: 0;
  min-height: var(--gc-control-height-md);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-md);
  padding: var(--gc-space-2) var(--gc-space-3);
  color: var(--gc-color-text);
  background: var(--gc-color-surface-field);
}

.task-popover .task-drawer__search input {
  min-height: var(--gc-control-height-sm);
  padding: var(--gc-space-1) var(--gc-space-2);
}

.task-drawer__sr-only {
  position: absolute;
  inline-size: var(--gc-space-hairline);
  block-size: var(--gc-space-hairline);
  padding: 0;
  overflow: hidden;
  border: 0;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}

.task-drawer__search input:focus-visible {
  outline: none;
  border-color: var(--gc-color-primary-border-strong);
  box-shadow: var(--gc-shadow-focus);
}

.task-drawer__switch {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--gc-space-2);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  cursor: pointer;
  user-select: none;
}

.task-drawer__switch input {
  position: absolute;
  inline-size: var(--gc-space-hairline);
  block-size: var(--gc-space-hairline);
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}

.task-drawer__switch-track {
  position: relative;
  display: inline-flex;
  align-items: center;
  width: calc(var(--gc-space-8) + var(--gc-space-2) + (var(--gc-space-hairline) * 2));
  height: calc(var(--gc-space-4) + var(--gc-space-2));
  padding: var(--gc-space-1);
  border-radius: var(--gc-radius-xl);
  background: var(--gc-color-border-strong);
  transition: background-color 160ms ease;
}

.task-drawer__switch-track span {
  width: calc(var(--gc-space-4) + (var(--gc-space-1) / 2));
  height: calc(var(--gc-space-4) + (var(--gc-space-1) / 2));
  border-radius: var(--gc-radius-full);
  background: var(--gc-color-surface-solid);
  box-shadow: var(--gc-shadow-sm);
  transform: translateX(0);
  transition: transform 160ms ease;
}

.task-drawer__switch input:checked + .task-drawer__switch-track {
  background: var(--gc-color-primary);
}

.task-drawer__switch input:checked + .task-drawer__switch-track span {
  transform: translateX(calc(var(--gc-space-4) + (var(--gc-space-1) / 2)));
}

.task-drawer__switch input:focus-visible + .task-drawer__switch-track {
  box-shadow: var(--gc-shadow-focus);
}

.task-drawer__items {
  display: grid;
  gap: var(--gc-space-2);
}

.task-popover .task-drawer__items {
  gap: var(--gc-space-1);
}

.task-drawer__scroll,
.task-drawer__all-scroll {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.task-drawer__scroll {
  min-height: calc(var(--gc-space-8) * 8);
}

.task-drawer__all-list {
  min-height: 0;
}

.task-drawer__all-tabs {
  min-width: 0;
  overflow-x: auto;
}

.task-drawer__all-scroll {
  max-height: calc(100vh - (var(--gc-space-10) * 3));
}

.task-drawer__view-all {
  width: 100%;
}

.task-drawer__item {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  column-gap: var(--gc-space-2);
  width: 100%;
  min-width: 0;
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-sm);
  background: var(--gc-color-surface-field);
}

.task-drawer__item-open {
  grid-column: 1;
  display: flex;
  width: 100%;
  min-width: 0;
  padding: var(--gc-space-3) 0 var(--gc-space-3) var(--gc-space-3);
  border: 0;
  border-radius: inherit;
  color: var(--gc-color-text);
  background: transparent;
  box-shadow: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.task-popover .task-drawer__item-open {
  padding: var(--gc-space-2) 0 var(--gc-space-2) var(--gc-space-2);
}

.task-drawer__item-open:hover:not(:disabled) {
  background: var(--gc-color-primary-soft);
  box-shadow: none;
}

.task-drawer__item-open:focus-visible {
  outline: none;
  box-shadow: var(--gc-shadow-focus);
}

.task-drawer__item-open :deep(.gc-button__content) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-3);
  width: 100%;
  min-width: 0;
}

.task-drawer__item-controls {
  grid-column: 2;
  align-self: start;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: var(--gc-space-1);
  padding: var(--gc-space-3) var(--gc-space-3) 0 0;
  pointer-events: none;
}

.task-drawer__item-controls > * {
  pointer-events: auto;
}

.task-drawer__item-force {
  display: inline-grid;
  place-items: center;
  flex: 0 0 calc(var(--gc-control-height-xs) - var(--gc-space-tight));
  width: calc(var(--gc-control-height-xs) - var(--gc-space-tight));
  min-width: calc(var(--gc-control-height-xs) - var(--gc-space-tight));
  height: calc(var(--gc-control-height-xs) - var(--gc-space-tight));
  min-height: calc(var(--gc-control-height-xs) - var(--gc-space-tight));
  padding: 0;
}

.task-drawer__item-force :deep(.gc-button__content) {
  display: grid;
  place-items: center;
}

.task-drawer__item-force svg {
  width: calc(var(--gc-size-icon-sm) - var(--gc-space-tight));
  height: calc(var(--gc-size-icon-sm) - var(--gc-space-tight));
  fill: currentColor;
}

.task-drawer__force-cancel-target {
  margin: 0;
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-body);
  font-weight: var(--gc-font-weight-semibold);
  overflow-wrap: anywhere;
}

.task-drawer__item-main {
  flex: 1 1 auto;
  display: grid;
  gap: var(--gc-space-2);
  min-width: 0;
}

.task-popover .task-drawer__item-main {
  gap: var(--gc-space-1);
}

.task-drawer__item-header {
  display: flex;
  align-items: center;
  gap: var(--gc-space-2);
  min-width: 0;
}

.task-drawer__item-title,
.task-drawer__item-summary,
.task-drawer__item-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-drawer__item-type {
  flex: 0 0 auto;
  padding: var(--gc-space-tight) var(--gc-space-compact);
  border-radius: var(--gc-radius-pill);
  color: var(--gc-color-primary);
  background: var(--gc-color-primary-soft);
  font-size: var(--gc-font-size-caption);
  line-height: var(--gc-line-height-tight);
  white-space: nowrap;
}

.task-drawer__item-title {
  min-width: 0;
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-body);
  line-height: var(--gc-line-height-tight);
}

.task-drawer__item-summary,
.task-drawer__item-meta,
.task-drawer__eyebrow {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.task-drawer__item-summary {
  color: var(--gc-color-text);
}

.task-drawer__automation-item-stats {
  display: flex;
  align-items: center;
  gap: var(--gc-space-2);
  min-width: 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  flex-wrap: wrap;
}

.task-drawer__automation-item-stat--success {
  color: var(--gc-color-success);
}

.task-drawer__automation-item-stat--danger,
.task-drawer__automation-metric--danger {
  color: var(--gc-color-danger);
}

.task-drawer__item-meta-row {
  display: flex;
  align-items: center;
  gap: var(--gc-space-3);
  min-width: 0;
  flex-wrap: wrap;
}

.task-drawer__item-meta-row .task-drawer__item-meta {
  flex: 0 1 auto;
  min-width: 0;
}

.task-drawer__item-progress {
  display: block;
  width: 100%;
  min-width: 0;
  white-space: nowrap;
}

.task-drawer__item-progress :deep(.gc-progress__caption) {
  display: flex;
  flex-wrap: nowrap;
  justify-content: center;
  color: var(--gc-color-text-inverse);
  font-size: var(--gc-font-size-xs);
  font-weight: var(--gc-font-weight-semibold);
  white-space: nowrap;
}

.task-drawer__item-progress-text {
  flex: 0 0 auto;
  min-width: 0;
  white-space: nowrap;
}

.task-drawer__detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--gc-space-3);
}

.task-drawer__detail-actions {
  justify-content: flex-end;
  flex-wrap: wrap;
  margin-top: var(--gc-space-3);
}

.task-drawer__detail-header h3,
.task-drawer__eyebrow {
  margin: 0;
}

.task-drawer__plugin-summary {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--gc-space-4);
  padding: var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-primary-border);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-primary-soft);
}

.task-drawer__plugin-summary-copy {
  min-width: 0;
}

.task-drawer__plugin-kicker {
  display: block;
  color: var(--gc-color-primary);
  font-size: var(--gc-font-size-xs);
  font-weight: var(--gc-font-weight-semibold);
}

.task-drawer__plugin-summary h4 {
  margin: var(--gc-space-1) 0 0;
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-lg);
}

.task-drawer__plugin-summary p {
  margin: var(--gc-space-1) 0 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
}

.task-drawer__plugin-summary-status {
  display: grid;
  flex: 0 0 auto;
  justify-items: end;
  gap: var(--gc-space-1);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  text-align: right;
}

.task-drawer__plugin-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--gc-space-2);
  margin: 0;
}

.task-drawer__plugin-metrics div {
  min-width: 0;
  padding: var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-sm);
  background: var(--gc-color-surface-field);
}

.task-drawer__plugin-metrics dt,
.task-drawer__plugin-metrics dd {
  margin: 0;
}

.task-drawer__plugin-metrics dt {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.task-drawer__plugin-metrics dd {
  margin-top: var(--gc-space-1);
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-xl);
  font-weight: var(--gc-font-weight-semibold);
}

.task-drawer__plugin-metric-value--danger {
  color: var(--gc-color-danger) !important;
}

.task-drawer__section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-3);
}

.task-drawer__section-heading > span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.task-drawer__plugin-timeline,
.task-drawer__plugin-versions,
.task-drawer__plugin-failures {
  display: grid;
  gap: var(--gc-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.task-drawer__plugin-timeline {
  position: relative;
  padding-inline-start: var(--gc-space-2);
}

.task-drawer__plugin-timeline::before {
  position: absolute;
  inset-block: var(--gc-space-2);
  inset-inline-start: calc(var(--gc-space-2) - var(--gc-space-hairline));
  width: var(--gc-border-width-default);
  background: var(--gc-color-border);
  content: '';
}

.task-drawer__plugin-timeline li {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: var(--gc-space-3);
  min-width: 0;
  padding: var(--gc-space-2) var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-sm);
  background: var(--gc-color-surface-subtle);
}

.task-drawer__plugin-timeline-dot {
  z-index: 1;
  flex: 0 0 var(--gc-space-2);
  width: var(--gc-space-2);
  height: var(--gc-space-2);
  margin-top: var(--gc-space-1);
  border-radius: var(--gc-radius-full);
  background: var(--gc-color-muted);
  box-shadow: 0 0 0 var(--gc-space-1) var(--gc-color-surface-subtle);
}

.task-drawer__plugin-timeline li[data-tone='success'] .task-drawer__plugin-timeline-dot { background: var(--gc-color-success); }
.task-drawer__plugin-timeline li[data-tone='warning'] .task-drawer__plugin-timeline-dot { background: var(--gc-color-warning); }
.task-drawer__plugin-timeline li[data-tone='danger'] .task-drawer__plugin-timeline-dot { background: var(--gc-color-danger); }
.task-drawer__plugin-timeline li[data-tone='info'] .task-drawer__plugin-timeline-dot { background: var(--gc-color-info); }

.task-drawer__plugin-timeline li > div {
  display: grid;
  min-width: 0;
  gap: var(--gc-space-tight);
}

.task-drawer__plugin-timeline strong {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-sm);
  font-weight: var(--gc-font-weight-semibold);
}

.task-drawer__plugin-timeline time,
.task-drawer__plugin-failure span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.task-drawer__plugin-version,
.task-drawer__plugin-failure {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-3);
  min-width: 0;
  padding: var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-sm);
  background: var(--gc-color-surface-field);
}

.task-drawer__plugin-version > div,
.task-drawer__plugin-failure {
  display: grid;
  min-width: 0;
  gap: var(--gc-space-tight);
}

.task-drawer__plugin-version > div {
  align-content: start;
}

.task-drawer__plugin-version-transition,
.task-drawer__plugin-status-transition {
  display: block;
  max-width: 100%;
  overflow-wrap: anywhere;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: var(--gc-font-weight-medium);
}

.task-drawer__plugin-version-transition {
  color: var(--gc-color-primary);
}

.task-drawer__plugin-status-transition {
  color: var(--gc-color-text-secondary);
}

.task-drawer__plugin-version strong,
.task-drawer__plugin-failure strong {
  overflow: hidden;
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-drawer__plugin-failure {
  align-items: flex-start;
  border-color: var(--gc-color-danger-border);
  background: var(--gc-color-danger-bg);
}

.task-drawer__plugin-failure-count {
  color: var(--gc-color-danger) !important;
}

.task-drawer__technical-details {
  border-top: var(--gc-border-width-default) solid var(--gc-color-border);
  padding-top: var(--gc-space-3);
}

.task-drawer__technical-details summary {
  width: fit-content;
  color: var(--gc-color-primary);
  cursor: pointer;
  font-size: var(--gc-font-size-sm);
}

.task-drawer__facts--technical {
  margin-top: var(--gc-space-3);
}

.task-drawer__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-3);
  margin: 0;
}

.task-drawer__facts div {
  min-width: 0;
  padding: var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-sm);
  background: var(--gc-color-surface-field);
}

.task-drawer__facts dt,
.task-drawer__facts dd {
  margin: 0;
}

.task-drawer__facts dt {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.task-drawer__facts dd {
  margin-top: var(--gc-space-1);
  overflow-wrap: anywhere;
  font-size: var(--gc-font-size-sm);
}

.task-drawer__section {
  display: grid;
  gap: var(--gc-space-2);
}

.task-drawer__section h4 {
  margin: 0;
  font-size: var(--gc-font-size-sm);
}

.task-drawer__agent-update {
  padding: var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-primary-border);
  border-radius: var(--gc-radius-card);
  background: var(--gc-color-primary-soft);
}

.task-drawer__agent-update-summary {
  margin: 0;
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-sm);
  line-height: var(--gc-line-height-relaxed);
}

.task-drawer__agent-update-facts {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.task-drawer__agent-update-target {
  color: var(--gc-color-success);
  font-weight: var(--gc-font-weight-semibold);
}

.task-drawer__agent-update-error {
  margin: 0;
  padding: var(--gc-space-3);
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-bg);
  border: var(--gc-border-width-default) solid var(--gc-color-danger-border);
  border-radius: var(--gc-radius-sm);
}

.task-drawer__agent-update-events {
  display: grid;
  gap: var(--gc-space-2);
}

.task-drawer__agent-update-events h5 {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: var(--gc-font-weight-semibold);
}

.task-drawer__timeline {
  display: grid;
  gap: var(--gc-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.task-drawer__acme-history {
  display: grid;
  gap: var(--gc-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.task-drawer__acme-attempt {
  display: grid;
  gap: var(--gc-space-2);
  padding: var(--gc-space-3);
  border-left: calc(var(--gc-space-1) - var(--gc-space-hairline)) solid var(--gc-color-border);
  background: var(--gc-color-surface-subtle);
}

.task-drawer__acme-attempt--running {
  border-left-color: var(--gc-color-info-border);
}

.task-drawer__acme-attempt--retryWaiting {
  border-left-color: var(--gc-color-warning-border);
}

.task-drawer__acme-attempt--succeeded {
  border-left-color: var(--gc-color-success-border);
}

.task-drawer__acme-attempt--failed,
.task-drawer__acme-attempt--cancelled {
  border-left-color: var(--gc-color-danger-border);
}

.task-drawer__acme-attempt-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--gc-space-3);
}

.task-drawer__acme-attempt-header > div {
  display: grid;
  gap: var(--gc-space-1);
}

.task-drawer__acme-attempt time,
.task-drawer__acme-attempt p {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.task-drawer__raw-logs {
  display: grid;
  gap: var(--gc-space-2);
}

.task-drawer__raw-logs summary {
  width: fit-content;
  color: var(--gc-color-primary);
  cursor: pointer;
  font-size: var(--gc-font-size-sm);
}

.task-drawer__timeline li,
.task-drawer__record {
  display: grid;
  gap: var(--gc-space-1);
  padding: var(--gc-space-3);
  border-left: calc(var(--gc-space-1) - var(--gc-space-hairline)) solid var(--gc-color-primary-border);
  background: var(--gc-color-surface-subtle);
}

.task-drawer__timeline time,
.task-drawer__record span,
.task-drawer__record time {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.task-drawer__automation-overview {
  display: grid;
  gap: var(--gc-space-2);
  padding: var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-field);
}

.task-drawer__automation-detail {
  gap: var(--gc-space-3);
}

.task-drawer__automation-metrics {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--gc-space-2);
  margin: 0;
}

.task-drawer__automation-metrics > div {
  display: grid;
  gap: var(--gc-space-1);
  min-width: 0;
  padding: var(--gc-space-2);
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
  border-radius: var(--gc-radius-sm);
  background: var(--gc-color-surface-subtle);
}

.task-drawer__automation-metrics dt,
.task-drawer__automation-metrics dd,
.task-drawer__automation-target-facts dt,
.task-drawer__automation-target-facts dd {
  margin: 0;
}

.task-drawer__automation-metrics dt,
.task-drawer__automation-target-facts dt {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.task-drawer__automation-metrics dd {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-body);
  font-weight: var(--gc-font-weight-semibold);
}

.task-drawer__automation-metric--success {
  color: var(--gc-color-success) !important;
}

.task-drawer__automation-error,
.task-drawer__automation-target-error {
  margin: 0;
  color: var(--gc-color-danger);
  font-size: var(--gc-font-size-xs);
  overflow-wrap: anywhere;
}

.task-drawer__automation-target-title {
  display: grid;
  gap: var(--gc-space-1);
  min-width: 0;
}

.task-drawer__automation-target-title span,
.task-drawer__automation-target-facts dd {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.task-drawer__automation-target-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-2);
  margin: 0;
}

.task-drawer__automation-target-technical {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.task-drawer__automation-target-technical summary,
.task-drawer__technical-details summary {
  width: fit-content;
  color: var(--gc-color-primary);
  cursor: pointer;
}

.task-drawer__automation-target-technical code {
  display: block;
  margin-top: var(--gc-space-1);
  overflow-wrap: anywhere;
}

.task-drawer__automation-technical-section {
  display: grid;
  gap: var(--gc-space-2);
}

.task-drawer__automation-technical-section h5 {
  margin: 0;
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-sm);
}

.task-drawer__automation-actions,
.task-drawer__record-actions,
.task-drawer__record-header {
  display: flex;
  align-items: center;
  gap: var(--gc-space-2);
  flex-wrap: wrap;
  justify-content: space-between;
}

.task-drawer__json {
  max-height: calc(100vh - (var(--gc-space-10) * 2));
  overflow: auto;
  margin: 0;
  padding: var(--gc-space-3);
  border-radius: var(--gc-radius-sm);
  color: var(--gc-color-text-inverse);
  background: var(--gc-color-code-bg);
  font-size: var(--gc-font-size-xs);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.task-drawer__loading,
.task-drawer__empty {
  margin: auto 0;
  padding: var(--gc-space-6) 0;
  color: var(--gc-color-text-muted);
  text-align: center;
}

.task-drawer__empty--section {
  margin: 0;
  padding: var(--gc-space-4);
  border: var(--gc-border-width-default) dashed var(--gc-color-border);
  border-radius: var(--gc-radius-sm);
  background: var(--gc-color-surface-subtle);
}

@media (max-width: 35rem) {
  .task-drawer__plugin-summary {
    flex-direction: column;
  }

  .task-drawer__plugin-summary-status {
    justify-items: start;
    text-align: left;
  }

  .task-drawer__plugin-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .task-drawer__automation-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .task-drawer__automation-target-facts {
    grid-template-columns: minmax(0, 1fr);
  }

  .task-popover {
    right: calc(var(--gc-space-4) * -1);
    width: min(var(--gc-size-task-popover), calc(100vw - var(--gc-space-4)));
  }

  .task-drawer__facts {
    grid-template-columns: minmax(0, 1fr);
  }

  .task-drawer__agent-update-facts {
    grid-template-columns: minmax(0, 1fr);
  }

  .task-drawer__toolbar {
    align-items: stretch;
    flex-direction: column;
  }

}

@media (prefers-reduced-motion: reduce) {
  .task-popover-enter-active,
  .task-popover-leave-active {
    transition: none;
  }
}
</style>
