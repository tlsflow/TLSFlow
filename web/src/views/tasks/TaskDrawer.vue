<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { getAutomationRun, listAutomationRunTargets, type AutomationRunRecord, type AutomationRunTargetRecord } from '@/api/modules/automations.api'
import { decideApproval } from '@/api/modules/audits.api'
import { getCertificateAssetDetail } from '@/api/modules/certificates.api'
import { GcButton, GcEmptyState, GcModal, GcProgressBar, GcStatusTag, GcTabs } from '@/design-system/components'
import { listDeploymentPlans } from '@/api/modules/deployments.api'
import { internalCaApi, type InternalCaRecord } from '@/api/modules/internal-ca.api'
import { getTask, listMonitoringProbes, listTasks, type TaskCategory, type TaskDetail, type TaskRun, type TaskStatus } from '@/api/modules/tasks.api'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import { translateDynamic } from '@/i18n/translate'
import { currentTaskActivity, isAutomationApprovalTask, isExecutionTask, isQuickTask, subscribeTaskActivity, subscribeTaskRealtime, type DeploymentExecutionMode, type DeploymentExecutionOpenDetail, type TaskActivityState, type TaskRealtimeMessage } from './task-events'
import { buildAcmeTaskAttemptHistory, type AcmeTaskAttemptState } from './acme-task-history'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const { t, te } = useI18n()
const router = useRouter()

const PAGE_SIZE = 100
const RECENT_COMPLETED_COUNT = 5
const MONITORING_TASK_TYPES: ReadonlySet<string> = new Set([
  'MONITORING_BATCH',
  'MONITORING_PROBE',
])
const SYSTEM_TASK_TYPES: ReadonlySet<string> = new Set([
  'CA_NODE_TASK',
  'CA_RECORD_SYNC',
  'CERTIFICATE_REVOCATION',
  'CRL_PUBLISH',
  'TRUST_DISTRIBUTION',
  'GATEWAY_DELEGATION',
  'WORKFLOW_RUN',
  'AUTOMATION_RUN',
  'REPORT_EXPORT',
  'NOTIFICATION_DELIVERY',
])
const DEPLOYMENT_EXECUTION_TASK_TYPES: ReadonlySet<string> = new Set([
  'CERTIFICATE_DRY_RUN',
  'CERTIFICATE_DEPLOY',
  'CERTIFICATE_ROLLBACK',
])
type TaskTabCategory = TaskCategory | 'OTHER'
interface AcmeRenewalTaskPresentation {
  readonly providerName: string
  readonly certificateName: string
}

const detailLoading = ref(false)
const detailError = ref('')
const quickActiveTasks = ref<TaskRun[]>([])
const quickRecentCompleted = ref<TaskRun[]>([])
const detail = ref<TaskDetail | null>(null)
const monitoringProbes = ref<readonly Record<string, unknown>[]>([])
const automationRun = ref<(AutomationRunRecord & { actionResults: unknown[] }) | null>(null)
const automationTargets = ref<AutomationRunTargetRecord[]>([])
const taskApprovalPending = ref(false)
const taskApprovalError = ref('')
const approvalModalOpen = ref(false)
const approvalTask = ref<TaskRun | null>(null)
const approvalLoading = ref(false)
const approvalLoadError = ref('')
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

watch(() => props.open, (open) => {
  if (open) {
    window.addEventListener('keydown', handleKeydown)
  } else {
    window.removeEventListener('keydown', handleKeydown)
    if (!switchingToAllTasks.value) allTasksModalOpen.value = false
    detail.value = null
    resetAutomationDetail()
  }
}, { immediate: true })
watch(allTasksCategory, () => {
  if (!allTasksModalOpen.value) return
  if (allTasksLoading.value) {
    allTasksReloadQueued.value = true
    return
  }
  void loadAllTasks(true)
})
watch(approvalModalOpen, (open) => {
  if (!open) {
    approvalTask.value = null
    approvalLoading.value = false
    approvalLoadError.value = ''
    resetAutomationDetail()
  }
})

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  disposeTaskActivity?.()
  disposeTaskRealtime?.()
  disposeTaskActivity = undefined
  disposeTaskRealtime = undefined
})

onMounted(() => {
  disposeTaskActivity = subscribeTaskActivity(applyQuickTaskActivity)
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
  applyQuickTasksState({
    active: sortTasks(state.activeTasks.filter((task) => matchesTaskKeyword(task, keywordValue))),
    recent: sortTasks(state.recentTasks.filter((task) => matchesTaskKeyword(task, keywordValue))).slice(0, RECENT_COMPLETED_COUNT),
  })
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
  if (taskNeedsApproval(task)) {
    await openApprovalTask(task)
    return
  }
  const executionOpenDetail = deploymentExecutionOpenDetail(task)
  if (executionOpenDetail) {
    detail.value = null
    monitoringProbes.value = []
    resetAutomationDetail()
    allTasksModalOpen.value = false
    emit('close')
    await router.push({ name: 'execution.list', query: { runId: executionOpenDetail.runId } })
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

async function openApprovalTask(task: TaskRun): Promise<void> {
  detail.value = null
  monitoringProbes.value = []
  resetAutomationDetail()
  approvalTask.value = task
  approvalModalOpen.value = true
  allTasksModalOpen.value = false
  emit('close')
  approvalLoading.value = true
  approvalLoadError.value = ''
  try {
    await loadAutomationTaskDetail(task)
  } catch (cause) {
    approvalLoadError.value = cause instanceof Error ? cause.message : t('tasks.messages.detailFailed')
  } finally {
    approvalLoading.value = false
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
}

function closeApprovalModal(): void {
  approvalModalOpen.value = false
  approvalTask.value = null
  approvalLoading.value = false
  approvalLoadError.value = ''
  resetAutomationDetail()
}

function submitQuickSearch(): void {
  applyQuickTaskActivity(currentTaskActivity())
}

function submitAllTasksSearch(): void {
  void loadAllTasks(true)
}

function applyRealtimeTaskSnapshot(message: TaskRealtimeMessage): void {
  if (message.type === 'snapshot') {
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
  applyRealtimeTaskToAllTasks(task)
  if (detailTask.value?.id === task.id && detail.value) {
    detail.value = { ...detail.value, task }
  }
  if (approvalTask.value?.id === task.id) approvalTask.value = task
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
  if (['RUNNING', 'CANCELLING'].includes(status)) return 'info'
  if (status === 'RETRY_WAITING') return 'warning'
  return 'muted'
}

function localTime(value?: string): string {
  return value ? formatBrowserLocalTime(value, { includeSeconds: false }) || value : t('common.notAvailable')
}

function recordValue(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return value === undefined || value === null ? t('common.notAvailable') : typeof value === 'string' ? value : JSON.stringify(value)
}

function taskStatusLabel(task: TaskRun): string {
  if (isAutomationApprovalTask(task)) return t('tasks.status.WAITING_APPROVAL')
  return translateDynamic(t, te, 'tasks.status', task.status)
}

function taskTypeLabel(task: TaskRun): string {
  const key = `tasks.typeLabels.${task.taskType}`
  const label = t(key)
  return label === key ? t('tasks.typeLabels.OTHER') : label
}

function taskRelatedName(task: TaskRun): string {
  if (task.taskType === 'ACME_CERTIFICATE_RENEWAL') {
    const presentation = acmeRenewalTaskPresentations.value[task.id]
    return presentation
      ? t('tasks.relatedNames.acmeRenewal', {
        provider: presentation.providerName,
        certificate: presentation.certificateName,
      })
      : taskTypeLabel(task)
  }
  if (DEPLOYMENT_EXECUTION_TASK_TYPES.has(task.taskType)) {
    const planId = taskDeploymentPlanId(task)
    if (planId && deploymentPlanNames.value[planId]) return deploymentPlanNames.value[planId]
  }
  const candidate = normalizeTaskRelatedName(firstNonEmptyString(
    recordStringByKeys(task.resourceSummary, ['displayName', 'name', 'planName', 'assetDisplayName', 'assetName', 'providerDisplayName', 'providerName', 'pluginName', 'workflowName', 'applicationName', 'siteName', 'bindingName', 'bindingDisplayName', 'certificateName', 'technologyName', 'targetName']),
    recordStringByKeys(task.payload, ['displayName', 'name', 'planName', 'deploymentPlanName', 'pluginName', 'workflowName', 'workflowId', 'providerDisplayName', 'providerName', 'providerKey', 'operationKey', 'technologyName', 'siteName', 'bindingName', 'bindingInformation', 'agentId', 'certificateAssetId', 'deploymentPlanId', 'renewalJobId', 'certificateRequestId', 'targetPluginVersionId', 'pluginId', 'scope']),
  ))
  if (DEPLOYMENT_EXECUTION_TASK_TYPES.has(task.taskType) && isRecordId(candidate, 'pln_')) return t('tasks.relatedNames.deploymentPlan')
  return candidate ?? taskTypeLabel(task)
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
  return DEPLOYMENT_EXECUTION_TASK_TYPES.has(task.taskType)
}

function isAutomationTask(task: TaskRun | null | undefined): task is TaskRun {
  return task?.taskType === 'AUTOMATION_RUN'
}

function shouldRenderTaskProgress(task: TaskRun): boolean {
  return isDeploymentExecutionTask(task) || isAutomationTask(task)
}

function taskProgressPercent(task: TaskRun): number {
  const explicit = firstFiniteNumber(
    recordNumberByKeys(task.progress, ['percent', 'percentage', 'progressPercent', 'progress', 'completedPercent']),
    recordNumberByKeys(task.resourceSummary, ['percent', 'percentage', 'progressPercent', 'progress', 'completedPercent']),
    recordNumberByKeys(task.payload, ['percent', 'percentage', 'progressPercent', 'progress', 'completedPercent']),
  )
  if (explicit !== undefined) return clampPercent(explicit <= 1 ? explicit * 100 : explicit)
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
  return 0
}

function taskAutomationRunId(task: TaskRun): string | undefined {
  return firstNonEmptyString(
    stringFromRecord(task.payload, 'runId'),
    stringFromRecord(task.progress, 'automationRunId'),
    stringFromRecord(task.resourceSummary, 'automationRunId'),
  )
}

function taskApprovalId(task: TaskRun): string | undefined {
  return firstNonEmptyString(
    stringFromRecord(task.progress, 'approvalId'),
    stringFromRecord(task.resourceSummary, 'approvalId'),
    stringFromRecord(task.payload, 'approvalId'),
  )
}

function taskNeedsApproval(task: TaskRun | null | undefined): boolean {
  return Boolean(task && taskApprovalId(task) && isAutomationApprovalTask(task))
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
  taskApprovalPending.value = false
  taskApprovalError.value = ''
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

async function decideDetailTaskApproval(decision: 'approved' | 'rejected'): Promise<void> {
  const task = detailTask.value ?? approvalTask.value
  if (!task) return
  const approvalId = taskApprovalId(task)
  if (!approvalId) {
    taskApprovalError.value = t('deploymentPlans.approval.missingApprovalId')
    return
  }
  taskApprovalPending.value = true
  taskApprovalError.value = ''
  try {
    await decideApproval({ approvalId, decision })
    if (approvalModalOpen.value) {
      closeApprovalModal()
    } else {
      await refreshTaskDetail(task.id)
    }
  } catch (cause) {
    taskApprovalError.value = cause instanceof Error ? cause.message : t('deploymentPlans.approval.decisionFailed')
  } finally {
    taskApprovalPending.value = false
  }
}

function sortTasks(tasks: readonly TaskRun[]): TaskRun[] {
  return [...tasks].sort((left, right) => {
    const createdCompare = Date.parse(right.createdAt) - Date.parse(left.createdAt)
    if (createdCompare !== 0) return createdCompare
    return right.id.localeCompare(left.id)
  })
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
  if (value === 'builtin-catalog') return t('tasks.relatedNames.builtinCatalog')
  return value
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
    summary: taskResultSummary(task),
  }
}

function isRecordId(value: string | undefined, prefix: string): boolean {
  return typeof value === 'string' && value.startsWith(prefix)
}

async function resolveDeploymentPlanNames(tasks: readonly TaskRun[]): Promise<void> {
  const missingPlanIds = Array.from(new Set(tasks
    .filter((task) => DEPLOYMENT_EXECUTION_TASK_TYPES.has(task.taskType))
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
          <p>{{ t('tasks.description') }}</p>
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
              <p class="task-drawer__eyebrow">{{ detailTask?.id }}</p>
              <h3>{{ detailTask ? taskRelatedName(detailTask) : '' }}</h3>
              <p v-if="detailTask" class="task-drawer__eyebrow">{{ taskTypeLabel(detailTask) }}</p>
            </div>
            <GcStatusTag
              :status="detailTask?.status ?? 'UNKNOWN'"
              :label="detailTask ? taskStatusLabel(detailTask) : undefined"
              :tone="statusTone(detailTask?.status ?? 'QUEUED')"
            />
          </div>
          <p v-if="detailError" class="gc-form-error">{{ detailError }}</p>
          <div v-if="detailLoading" class="task-drawer__loading">{{ t('common.loading') }}</div>
          <template v-else>
            <dl class="task-drawer__facts">
              <div><dt>{{ t('tasks.fields.requestedBy') }}</dt><dd>{{ detailTask?.requestedBy || t('tasks.values.system') }}</dd></div>
              <div><dt>{{ t('tasks.fields.triggerSource') }}</dt><dd>{{ detailTask?.triggerSource }}</dd></div>
              <div><dt>{{ t('tasks.fields.createdAt') }}</dt><dd>{{ localTime(detailTask?.createdAt) }}</dd></div>
              <div><dt>{{ t('tasks.fields.startedAt') }}</dt><dd>{{ localTime(detailTask?.startedAt) }}</dd></div>
              <div><dt>{{ t('tasks.fields.finishedAt') }}</dt><dd>{{ localTime(detailTask?.finishedAt) }}</dd></div>
              <div><dt>{{ t('tasks.fields.error') }}</dt><dd>{{ detailTask?.lastErrorMessage || t('common.notAvailable') }}</dd></div>
            </dl>
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
            <section v-else class="task-drawer__section">
              <h4>{{ t('tasks.sections.timeline') }}</h4>
              <ol class="task-drawer__timeline">
                <li v-for="event in visibleDetailEvents" :key="String(event.id)">
                  <strong>{{ recordValue(event, 'eventType') }}</strong>
                  <time>{{ localTime(recordValue(event, 'createdAt')) }}</time>
                  <span>{{ recordValue(event, 'eventData') }}</span>
                </li>
              </ol>
            </section>
            <section v-if="detailTask && isAutomationTask(detailTask) && automationRun" class="task-drawer__section">
              <h4>{{ t('tasks.typeLabels.AUTOMATION_RUN') }}</h4>
              <div class="task-drawer__automation-overview">
                <p class="task-drawer__item-summary">{{ taskStatusSummary(detailTask) }}</p>
                <GcProgressBar
                  class="task-drawer__item-progress"
                  :value="taskProgressPercent(detailTask)"
                  :tone="statusTone(detailTask.status)"
                  captionInside
                  :ariaLabel="taskStatusSummary(detailTask)"
                >
                  <span class="task-drawer__item-progress-text">{{ taskProgressPercent(detailTask) }}%</span>
                </GcProgressBar>
                <div v-if="taskNeedsApproval(detailTask)" class="task-drawer__automation-actions">
                  <GcButton variant="primary" :loading="taskApprovalPending" @click="decideDetailTaskApproval('approved')">
                    {{ t('deploymentPlans.actions.approve') }}
                  </GcButton>
                  <GcButton :loading="taskApprovalPending" @click="decideDetailTaskApproval('rejected')">
                    {{ t('deploymentPlans.actions.reject') }}
                  </GcButton>
                  <span v-if="taskApprovalPending" class="task-drawer__item-meta">{{ t('deploymentPlans.approval.processing') }}</span>
                </div>
                <p v-if="taskApprovalError" class="gc-form-error">{{ taskApprovalError }}</p>
              </div>
              <GcEmptyState v-if="automationTargets.length === 0" class="task-drawer__empty task-drawer__empty--section" :title="t('tasks.values.empty')" />
              <div v-for="target in automationTargets" :key="target.id" class="task-drawer__record">
                <div class="task-drawer__record-header">
                  <strong>{{ target.targetSnapshot.assetName || target.targetSnapshot.certificateName }}</strong>
                  <GcStatusTag :status="target.status" />
                </div>
                <span>{{ target.targetSnapshot.certificateName }} · {{ target.targetSnapshot.environment || t('common.notAvailable') }}</span>
                <span>{{ automationActionLabel(target.currentAction) }}</span>
                <p v-if="target.errorMessage">{{ target.errorCode }} · {{ target.errorMessage }}</p>
                <div class="task-drawer__record-actions">
                  <GcButton v-if="target.deploymentPlanId" @click="router.push(`/executions?planId=${target.deploymentPlanId}`)">{{ t('automations.actions.openPlan') }}</GcButton>
                  <GcButton v-if="target.executionRunId" @click="router.push(`/executions?runId=${target.executionRunId}`)">{{ t('automations.actions.openExecution') }}</GcButton>
                </div>
              </div>
            </section>
            <section v-if="detailTask?.taskType !== 'ACME_CERTIFICATE_RENEWAL'" class="task-drawer__section">
              <h4>{{ t('tasks.sections.attempts') }}</h4>
              <div v-for="attempt in detail.attempts" :key="String(attempt.id)" class="task-drawer__record">
                <strong>#{{ recordValue(attempt, 'attemptNo') }} · {{ recordValue(attempt, 'status') }}</strong>
                <span>{{ recordValue(attempt, 'workerId') }}</span>
                <time>{{ localTime(recordValue(attempt, 'startedAt')) }}</time>
                <p v-if="attempt.errorSummary">{{ attempt.errorSummary }}</p>
              </div>
            </section>
            <section v-if="detailTask?.category !== 'MONITORING'" class="task-drawer__section">
              <h4>{{ t('tasks.sections.logs') }}</h4>
              <details class="task-drawer__raw-logs">
                <summary>{{ t('tasks.actions.viewRawLogs') }}</summary>
                <pre class="task-drawer__json">{{ JSON.stringify(detail.events, null, 2) || t('tasks.values.empty') }}</pre>
              </details>
            </section>
            <section class="task-drawer__section">
              <h4>{{ t('tasks.sections.children') }}</h4>
              <GcEmptyState v-if="detail.childTasks.length === 0" class="task-drawer__empty task-drawer__empty--section" :title="t('tasks.values.empty')" />
              <div v-for="child in detail.childTasks" :key="child.id" class="task-drawer__record">
                <strong>{{ child.taskType }}</strong><span>{{ child.id }}</span><GcStatusTag :status="child.status" :label="taskStatusLabel(child)" :tone="statusTone(child.status)" />
              </div>
            </section>
            <section class="task-drawer__section">
              <h4>{{ t('tasks.sections.errors') }}</h4>
              <p>{{ detailTask?.lastErrorCode || t('tasks.values.none') }} · {{ detailTask?.lastErrorMessage || t('tasks.values.none') }}</p>
            </section>
            <section class="task-drawer__section">
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
                  <GcButton v-for="task in quickActiveTasks" :key="task.id" class="task-drawer__item" @click="openTask(task)">
                    <span class="task-drawer__item-main">
                      <span class="task-drawer__item-header">
                        <small class="task-drawer__item-type">{{ taskTypeLabel(task) }}</small>
                        <strong class="task-drawer__item-title">{{ taskRelatedName(task) }}</strong>
                      </span>
                      <span v-if="!shouldRenderTaskProgress(task)" class="task-drawer__item-summary">{{ taskStatusSummary(task) }}</span>
                      <span class="task-drawer__item-meta-row">
                        <small class="task-drawer__item-meta">{{ task.requestedBy || t('tasks.values.system') }} · {{ localTime(task.createdAt) }}</small>
                        <GcProgressBar
                          v-if="shouldRenderTaskProgress(task)"
                          class="task-drawer__item-progress"
                          :value="taskProgressPercent(task)"
                          :tone="statusTone(task.status)"
                          captionInside
                          :ariaLabel="taskStatusSummary(task)"
                        >
                          <span class="task-drawer__item-progress-text">{{ taskProgressPercent(task) }}%</span>
                        </GcProgressBar>
                      </span>
                    </span>
                    <GcStatusTag :status="task.status" :label="taskStatusLabel(task)" :tone="statusTone(task.status)" />
                  </GcButton>
                </div>
              </section>
              <section class="task-drawer__group">
                <header class="task-drawer__group-header">
                  <h3>{{ t('tasks.quick.recent') }}</h3>
                  <span class="task-drawer__group-count">{{ quickRecentCompleted.length }}</span>
                </header>
                <GcEmptyState v-if="quickRecentCompleted.length === 0" class="task-drawer__empty task-drawer__empty--section" :title="t('tasks.values.empty')" />
                <div v-else class="task-drawer__items">
                  <GcButton v-for="task in quickRecentCompleted" :key="task.id" class="task-drawer__item" @click="openTask(task)">
                    <span class="task-drawer__item-main">
                      <span class="task-drawer__item-header">
                        <small class="task-drawer__item-type">{{ taskTypeLabel(task) }}</small>
                        <strong class="task-drawer__item-title">{{ taskRelatedName(task) }}</strong>
                      </span>
                      <span v-if="!shouldRenderTaskProgress(task)" class="task-drawer__item-summary">{{ taskStatusSummary(task) }}</span>
                      <span class="task-drawer__item-meta-row">
                        <small class="task-drawer__item-meta">{{ task.requestedBy || t('tasks.values.system') }} · {{ localTime(task.createdAt) }}</small>
                        <GcProgressBar
                          v-if="shouldRenderTaskProgress(task)"
                          class="task-drawer__item-progress"
                          :value="taskProgressPercent(task)"
                          :tone="statusTone(task.status)"
                          captionInside
                          :ariaLabel="taskStatusSummary(task)"
                        >
                          <span class="task-drawer__item-progress-text">{{ taskProgressPercent(task) }}%</span>
                        </GcProgressBar>
                      </span>
                    </span>
                    <GcStatusTag :status="task.status" :label="taskStatusLabel(task)" :tone="statusTone(task.status)" />
                  </GcButton>
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
    :description="t('tasks.description')"
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
          <GcButton v-for="task in allTasks" :key="task.id" class="task-drawer__item" @click="openTask(task)">
            <span class="task-drawer__item-main">
              <span class="task-drawer__item-header">
                <small class="task-drawer__item-type">{{ taskTypeLabel(task) }}</small>
                <strong class="task-drawer__item-title">{{ taskRelatedName(task) }}</strong>
              </span>
              <span v-if="!shouldRenderTaskProgress(task)" class="task-drawer__item-summary">{{ taskStatusSummary(task) }}</span>
              <span class="task-drawer__item-meta-row">
                <small class="task-drawer__item-meta">{{ task.requestedBy || t('tasks.values.system') }} · {{ localTime(task.createdAt) }}</small>
                <GcProgressBar
                  v-if="shouldRenderTaskProgress(task)"
                  class="task-drawer__item-progress"
                  :value="taskProgressPercent(task)"
                  :tone="statusTone(task.status)"
                  captionInside
                  :ariaLabel="taskStatusSummary(task)"
                >
                  <span class="task-drawer__item-progress-text">{{ taskProgressPercent(task) }}%</span>
                </GcProgressBar>
              </span>
            </span>
            <GcStatusTag :status="task.status" :label="taskStatusLabel(task)" :tone="statusTone(task.status)" />
          </GcButton>
        </div>
      </div>
    </div>
  </GcModal>
  <GcModal
    v-model:open="approvalModalOpen"
    size="lg"
    :title="t('deploymentPlans.approval.title')"
    :description="t('deploymentPlans.approval.description')"
  >
    <div class="task-drawer__approval-view">
      <div v-if="approvalLoading" class="task-drawer__loading">{{ t('common.loading') }}</div>
      <p v-else-if="approvalLoadError" class="gc-form-error">{{ approvalLoadError }}</p>
      <template v-else-if="approvalTask">
        <header class="task-drawer__approval-header">
          <div>
            <small class="task-drawer__item-type">{{ taskTypeLabel(approvalTask) }}</small>
            <h3>{{ automationRun?.automationNameSnapshot || taskRelatedName(approvalTask) }}</h3>
            <p>{{ t('automations.runs.title') }} · {{ taskAutomationRunId(approvalTask) || t('common.notAvailable') }}</p>
          </div>
          <GcStatusTag :status="approvalTask.status" :label="taskStatusLabel(approvalTask)" :tone="statusTone(approvalTask.status)" />
        </header>
        <div class="task-drawer__approval-summary">
          <div class="task-drawer__record">
            <span>{{ t('deploymentPlans.approval.requestedBy') }}</span>
            <strong>{{ approvalTask.requestedBy || t('tasks.values.system') }}</strong>
          </div>
          <div class="task-drawer__record">
            <span>{{ t('deploymentPlans.approval.riskLevel') }}</span>
            <strong>{{ recordValue(approvalTask.resourceSummary || {}, 'riskLevel') }}</strong>
          </div>
          <div class="task-drawer__record">
            <span>{{ t('tasks.fields.createdAt') }}</span>
            <time>{{ localTime(approvalTask.createdAt) }}</time>
          </div>
          <div class="task-drawer__record">
            <span>{{ t('automations.runs.progress', { succeeded: automationRun?.targetSummary.succeeded || 0, total: automationRun?.targetSummary.total || 0 }) }}</span>
            <strong>{{ recordValue(approvalTask.resourceSummary || {}, 'summary') }}</strong>
          </div>
        </div>
        <section class="task-drawer__section">
          <h4>{{ t('automations.editor.sections.targets') }}</h4>
          <GcEmptyState v-if="automationTargets.length === 0" class="task-drawer__empty task-drawer__empty--section" :title="t('tasks.values.empty')" />
          <div v-for="target in automationTargets" :key="target.id" class="task-drawer__record task-drawer__approval-target">
            <div class="task-drawer__record-header">
              <strong>{{ target.targetSnapshot.assetName || target.targetSnapshot.certificateName || t('common.notAvailable') }}</strong>
              <GcStatusTag :status="target.status" />
            </div>
            <span>{{ target.targetSnapshot.certificateName || t('common.notAvailable') }}</span>
            <span>{{ target.targetSnapshot.environment || t('common.notAvailable') }}</span>
          </div>
        </section>
        <p v-if="taskApprovalError" class="gc-form-error">{{ taskApprovalError }}</p>
        <footer class="task-drawer__approval-actions">
          <span>{{ t('deploymentPlans.approval.decisionHint') }}</span>
          <div>
            <GcButton variant="primary" :loading="taskApprovalPending" @click="decideDetailTaskApproval('approved')">
              {{ t('deploymentPlans.actions.approve') }}
            </GcButton>
            <GcButton :loading="taskApprovalPending" @click="decideDetailTaskApproval('rejected')">
              {{ t('deploymentPlans.actions.reject') }}
            </GcButton>
          </div>
        </footer>
      </template>
    </div>
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
  max-height: calc(100vh - var(--gc-space-8));
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
  gap: var(--gc-space-4);
  padding: var(--gc-space-4) var(--gc-space-5);
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border);
}

.task-popover__header h2,
.task-popover__header p {
  margin: 0;
}

.task-popover__header h2 {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-lg);
}

.task-popover__header p {
  margin-top: var(--gc-space-1);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
}

.task-popover__close {
  flex: 0 0 auto;
}

.task-popover__body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  padding: var(--gc-space-4) var(--gc-space-5) var(--gc-space-5);
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

:deep(.gc-modal__body) {
  display: flex;
  min-height: 0;
}

.task-drawer__list,
.task-drawer__all-list {
  overflow: hidden;
}

.task-drawer__detail {
  overflow: auto;
}

.task-drawer__approval-view {
  display: flex;
  flex-direction: column;
  gap: var(--gc-space-5);
  min-height: 0;
  overflow: auto;
}

.task-drawer__approval-header,
.task-drawer__approval-actions,
.task-drawer__record-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--gc-space-4);
}

.task-drawer__approval-header h3,
.task-drawer__approval-header p {
  margin: 0;
}

.task-drawer__approval-header h3 {
  margin-top: var(--gc-space-1);
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-xl);
}

.task-drawer__approval-header p,
.task-drawer__approval-actions > span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
}

.task-drawer__approval-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-3);
}

.task-drawer__approval-summary .task-drawer__record {
  gap: var(--gc-space-1);
}

.task-drawer__approval-target {
  gap: var(--gc-space-2);
}

.task-drawer__approval-actions {
  align-items: center;
  padding-top: var(--gc-space-3);
  border-top: var(--gc-border-width-default) solid var(--gc-color-border);
}

.task-drawer__approval-actions > div {
  display: flex;
  gap: var(--gc-space-2);
  flex: 0 0 auto;
}

@media (max-width: 42rem) {
  .task-drawer__approval-summary {
    grid-template-columns: 1fr;
  }

  .task-drawer__approval-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .task-drawer__approval-actions > div {
    width: 100%;
  }

  .task-drawer__approval-actions button {
    flex: 1 1 0;
  }
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

.task-drawer__group {
  display: grid;
  gap: var(--gc-space-2);
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

.task-drawer__scroll,
.task-drawer__all-scroll {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 0;
  overflow: auto;
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
  min-height: calc(var(--gc-space-8) * 8);
}

.task-drawer__view-all {
  width: 100%;
}

.task-drawer__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-3);
  width: 100%;
  padding: var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-sm);
  color: var(--gc-color-text);
  background: var(--gc-color-surface-field);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.task-drawer__item :deep(.gc-button__content) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-3);
  width: 100%;
  min-width: 0;
}

.task-drawer__item:hover {
  border-color: var(--gc-color-primary-border);
  background: var(--gc-color-primary-soft);
}

.task-drawer__item-main {
  flex: 1 1 auto;
  display: grid;
  gap: var(--gc-space-2);
  min-width: 0;
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

.task-drawer__item-meta-row {
  display: flex;
  align-items: center;
  gap: var(--gc-space-3);
  min-width: 0;
  flex-wrap: nowrap;
}

.task-drawer__item-meta-row .task-drawer__item-meta {
  flex: 0 1 auto;
  min-width: 0;
}

.task-drawer__item-progress {
  flex: 1 1 0;
  min-width: calc((var(--gc-space-10) * 3) + var(--gc-space-2));
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

.task-drawer__detail-header h3,
.task-drawer__eyebrow {
  margin: 0;
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
  .task-popover {
    right: calc(var(--gc-space-4) * -1);
    width: min(var(--gc-size-task-popover), calc(100vw - var(--gc-space-4)));
  }

  .task-drawer__facts {
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
