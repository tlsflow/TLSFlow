<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { GcModal, GcStatusTag, GcTabs } from '@/design-system/components'
import { getTask, listMonitoringProbes, listTasks, type TaskCategory, type TaskDetail, type TaskRun, type TaskStatus } from '@/api/modules/tasks.api'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()

const PAGE_SIZE = 100
const HISTORY_BATCH_SIZE = 20
const RECENT_COMPLETED_COUNT = 5
const ACTIVE_STATUSES: ReadonlySet<TaskStatus> = new Set(['QUEUED', 'RUNNING', 'RETRY_WAITING', 'CANCELLING'])
const COMPLETED_STATUSES: ReadonlySet<TaskStatus> = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED'])
const KNOWN_TASK_CATEGORIES: ReadonlySet<TaskCategory> = new Set(['EXECUTION', 'MONITORING', 'SYSTEM'])
type TaskTabCategory = TaskCategory | 'OTHER'

const loading = ref(false)
const detailLoading = ref(false)
const error = ref('')
const detailError = ref('')
const tasks = ref<readonly TaskRun[]>([])
const quickActiveTasks = ref<TaskRun[]>([])
const quickRecentCompleted = ref<TaskRun[]>([])
const quickHistoryBuffer = ref<TaskRun[]>([])
const quickPage = ref(1)
const quickHasMore = ref(true)
const quickScroll = ref<HTMLElement | null>(null)
const detail = ref<TaskDetail | null>(null)
const monitoringProbes = ref<readonly Record<string, unknown>[]>([])
const keyword = ref('')
const showAllTasks = ref(false)
const allTasksModalOpen = ref(false)
const allTasks = ref<TaskRun[]>([])
const allTasksKeyword = ref('')
const allTasksLoading = ref(false)
const allTasksError = ref('')
const allTasksPage = ref(1)
const allTasksHasMore = ref(true)
const allTasksScroll = ref<HTMLElement | null>(null)
const allTasksCategory = ref<TaskTabCategory>('EXECUTION')
const detailTask = computed(() => detail.value?.task ?? null)
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
    void loadQuickTasks(true)
  } else {
    window.removeEventListener('keydown', handleKeydown)
    allTasksModalOpen.value = false
    detail.value = null
  }
}, { immediate: true })
watch(showAllTasks, () => {
  if (props.open) void loadQuickTasks(true)
})
watch(allTasksCategory, () => {
  if (allTasksModalOpen.value) void loadAllTasks(true)
})

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
})

function mergeTasks(existing: readonly TaskRun[], incoming: readonly TaskRun[]): TaskRun[] {
  const merged = new Map(existing.map((task) => [task.id, task]))
  incoming.forEach((task) => merged.set(task.id, task))
  return [...merged.values()]
}

function isOtherTask(task: TaskRun): boolean {
  return !KNOWN_TASK_CATEGORIES.has(task.category)
}

function syncQuickTasks(): void {
  tasks.value = mergeTasks(quickActiveTasks.value, quickRecentCompleted.value)
}

function appendQuickHistoryBatch(size = HISTORY_BATCH_SIZE): void {
  if (quickHistoryBuffer.value.length === 0) return
  quickRecentCompleted.value = [
    ...quickRecentCompleted.value,
    ...quickHistoryBuffer.value.splice(0, size),
  ]
  syncQuickTasks()
}

function resetQuickTasks(): void {
  tasks.value = []
  quickActiveTasks.value = []
  quickRecentCompleted.value = []
  quickHistoryBuffer.value = []
  quickPage.value = 1
  quickHasMore.value = true
}

async function requestQuickPage(): Promise<void> {
  if (!quickHasMore.value) return
  const result = await listTasks({
    page: quickPage.value,
    pageSize: PAGE_SIZE,
    keyword: keyword.value.trim() || undefined,
    includeAll: showAllTasks.value,
    filters: showAllTasks.value ? undefined : { category: 'EXECUTION' },
  })
  const data = result.data
  const items = data?.items ?? []
  quickActiveTasks.value = mergeTasks(
    quickActiveTasks.value,
    items.filter((task) => ACTIVE_STATUSES.has(task.status)),
  )
  quickHistoryBuffer.value = mergeTasks(
    quickHistoryBuffer.value,
    items.filter((task) => COMPLETED_STATUSES.has(task.status)),
  )
  const currentPage = data?.page ?? quickPage.value
  const pageSize = data?.pageSize ?? PAGE_SIZE
  const total = data?.total ?? 0
  quickPage.value = currentPage + 1
  quickHasMore.value = currentPage * pageSize < total && items.length > 0
}

async function loadQuickTasks(reset = false): Promise<void> {
  if (loading.value) return
  if (reset) resetQuickTasks()
  if (!quickHasMore.value && tasks.value.length > 0) return
  loading.value = true
  error.value = ''
  try {
    if (reset) {
      do {
        await requestQuickPage()
        while (quickRecentCompleted.value.length < RECENT_COMPLETED_COUNT && quickHistoryBuffer.value.length > 0) {
          appendQuickHistoryBatch(RECENT_COMPLETED_COUNT - quickRecentCompleted.value.length)
        }
      } while (quickHasMore.value && quickRecentCompleted.value.length < RECENT_COMPLETED_COUNT)
    } else if (quickHistoryBuffer.value.length > 0) {
      appendQuickHistoryBatch()
    } else {
      await requestQuickPage()
      appendQuickHistoryBatch()
    }
    syncQuickTasks()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('tasks.messages.loadFailed')
  } finally {
    loading.value = false
  }
}

function handleQuickScroll(event: Event): void {
  const element = event.currentTarget as HTMLElement
  if (element.scrollHeight - element.scrollTop - element.clientHeight < 80) {
    void loadQuickTasks()
  }
}

function openAllTasks(): void {
  allTasksKeyword.value = keyword.value
  allTasksCategory.value = 'EXECUTION'
  allTasksModalOpen.value = true
  void loadAllTasks(true)
}

function resetAllTasks(): void {
  allTasks.value = []
  allTasksPage.value = 1
  allTasksHasMore.value = true
  allTasksError.value = ''
}

async function loadAllTasks(reset = false): Promise<void> {
  if (allTasksLoading.value) return
  if (reset) resetAllTasks()
  if (!allTasksHasMore.value && allTasks.value.length > 0) return
  allTasksLoading.value = true
  allTasksError.value = ''
  try {
    const result = await listTasks({
      page: allTasksPage.value,
      pageSize: PAGE_SIZE,
      keyword: allTasksKeyword.value.trim() || undefined,
      includeAll: allTasksCategory.value === 'OTHER',
      filters: allTasksCategory.value === 'OTHER' ? undefined : { category: allTasksCategory.value },
    })
    const data = result.data
    const fetchedItems = data?.items ?? []
    const items = allTasksCategory.value === 'OTHER' ? fetchedItems.filter(isOtherTask) : fetchedItems
    const currentPage = data?.page ?? allTasksPage.value
    const pageSize = data?.pageSize ?? PAGE_SIZE
    const total = data?.total ?? 0
    allTasks.value = mergeTasks(allTasks.value, items)
    allTasksPage.value = currentPage + 1
    allTasksHasMore.value = currentPage * pageSize < total && items.length > 0
  } catch (cause) {
    allTasksError.value = cause instanceof Error ? cause.message : t('tasks.messages.loadFailed')
  } finally {
    allTasksLoading.value = false
  }
}

function handleAllTasksScroll(event: Event): void {
  const element = event.currentTarget as HTMLElement
  if (element.scrollHeight - element.scrollTop - element.clientHeight < 80) {
    void loadAllTasks()
  }
}

async function openTask(task: TaskRun): Promise<void> {
  detail.value = null
  monitoringProbes.value = []
  allTasksModalOpen.value = false
  detailLoading.value = true
  detailError.value = ''
  try {
    const result = await getTask(task.id)
    detail.value = result.data ?? null
    if (task.category === 'MONITORING') {
      const probes = await listMonitoringProbes(task.id, { page: 1, pageSize: 20 })
      monitoringProbes.value = probes.data?.items ?? []
    }
  } catch (cause) {
    detailError.value = cause instanceof Error ? cause.message : t('tasks.messages.detailFailed')
  } finally {
    detailLoading.value = false
  }
}

function closeDetail(): void {
  detail.value = null
  monitoringProbes.value = []
}

function submitQuickSearch(): void {
  void loadQuickTasks(true)
}

function submitAllTasksSearch(): void {
  void loadAllTasks(true)
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
        <button class="gc-icon-button task-popover__close" type="button" :aria-label="t('designSystem.modal.closeAria')" @click="emit('close')">
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <div class="task-popover__body">
        <div v-if="detail" class="task-drawer__detail">
          <button class="gc-button" type="button" @click="closeDetail">{{ t('tasks.actions.backToList') }}</button>
          <div class="task-drawer__detail-header">
            <div>
              <p class="task-drawer__eyebrow">{{ detailTask?.id }}</p>
              <h3>{{ detailTask?.taskType }}</h3>
            </div>
            <GcStatusTag :status="detailTask?.status ?? 'UNKNOWN'" :tone="statusTone(detailTask?.status ?? 'QUEUED')" />
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
            <section class="task-drawer__section">
              <h4>{{ t('tasks.sections.timeline') }}</h4>
              <ol class="task-drawer__timeline">
                <li v-for="event in visibleDetailEvents" :key="String(event.id)">
                  <strong>{{ recordValue(event, 'eventType') }}</strong>
                  <time>{{ localTime(recordValue(event, 'createdAt')) }}</time>
                  <span>{{ recordValue(event, 'eventData') }}</span>
                </li>
              </ol>
            </section>
            <section class="task-drawer__section">
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
              <pre class="task-drawer__json">{{ JSON.stringify(detail.events.filter((event) => event.eventType === 'LOG'), null, 2) || t('tasks.values.empty') }}</pre>
            </section>
            <section class="task-drawer__section">
              <h4>{{ t('tasks.sections.children') }}</h4>
              <div v-if="detail.childTasks.length === 0" class="task-drawer__empty">{{ t('tasks.values.empty') }}</div>
              <div v-for="child in detail.childTasks" :key="child.id" class="task-drawer__record">
                <strong>{{ child.taskType }}</strong><span>{{ child.id }}</span><GcStatusTag :status="child.status" :tone="statusTone(child.status)" />
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
            <label class="task-drawer__switch">
              <input
                v-model="showAllTasks"
                type="checkbox"
                role="switch"
                :aria-checked="showAllTasks"
              >
              <span class="task-drawer__switch-track" aria-hidden="true"><span /></span>
              <span>{{ t('tasks.filters.includeAll') }}</span>
            </label>
          </form>
          <p v-if="error" class="gc-form-error">{{ error }}</p>
          <div ref="quickScroll" class="task-drawer__scroll" @scroll="handleQuickScroll">
            <div v-if="loading && tasks.length === 0" class="task-drawer__loading">{{ t('common.loading') }}</div>
            <div v-else-if="tasks.length === 0" class="task-drawer__empty">{{ t('tasks.values.empty') }}</div>
            <div v-else class="task-drawer__items">
              <button v-for="task in tasks" :key="task.id" class="task-drawer__item" type="button" @click="openTask(task)">
                <span class="task-drawer__item-main">
                  <strong>{{ task.taskType }}</strong>
                  <small>{{ task.id }}</small>
                  <span>{{ task.requestedBy || t('tasks.values.system') }} · {{ localTime(task.createdAt) }}</span>
                </span>
                <GcStatusTag :status="task.status" :tone="statusTone(task.status)" />
              </button>
            </div>
            <div v-if="loading && tasks.length > 0" class="task-drawer__loading">{{ t('common.loading') }}</div>
          </div>
          <button class="gc-button gc-button--primary task-drawer__view-all" type="button" @click="openAllTasks">
            {{ t('tasks.actions.viewAll') }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
  <GcModal
    v-model:open="allTasksModalOpen"
    size="xl"
    max-height="60vh"
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
        <div v-else-if="allTasks.length === 0" class="task-drawer__empty">{{ t('tasks.values.empty') }}</div>
        <div v-else class="task-drawer__items">
          <button v-for="task in allTasks" :key="task.id" class="task-drawer__item" type="button" @click="openTask(task)">
            <span class="task-drawer__item-main">
              <strong>{{ task.taskType }}</strong>
              <small>{{ task.id }}</small>
              <span>{{ task.requestedBy || t('tasks.values.system') }} · {{ localTime(task.createdAt) }}</span>
            </span>
            <GcStatusTag :status="task.status" :tone="statusTone(task.status)" />
          </button>
        </div>
        <div v-if="allTasksLoading && allTasks.length > 0" class="task-drawer__loading">{{ t('common.loading') }}</div>
      </div>
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
  width: min(48rem, calc(100vw - var(--gc-space-8)));
  max-height: min(44rem, calc(100vh - var(--gc-space-8)));
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
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gc-space-5);
}

.task-drawer__list,
.task-drawer__all-list {
  overflow: hidden;
}

.task-drawer__detail {
  overflow: auto;
}

.task-drawer__toolbar {
  display: flex;
  align-items: center;
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
  border-radius: 50%;
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
  flex: 1 1 0;
  width: 100%;
  min-height: 0;
  overflow: auto;
  scrollbar-gutter: stable;
}

.task-drawer__all-list {
  min-height: 0;
}

.task-drawer__all-tabs {
  min-width: 0;
  overflow-x: auto;
}

.task-drawer__all-scroll {
  max-height: calc(60vh - var(--gc-space-10));
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
  text-align: left;
  cursor: pointer;
}

.task-drawer__item:hover {
  border-color: var(--gc-color-primary-border);
  background: var(--gc-color-primary-soft);
}

.task-drawer__item-main {
  display: grid;
  gap: var(--gc-space-1);
  min-width: 0;
}

.task-drawer__item-main strong,
.task-drawer__item-main small,
.task-drawer__item-main span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-drawer__item-main small,
.task-drawer__item-main span,
.task-drawer__eyebrow {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
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
  padding: var(--gc-space-6) 0;
  color: var(--gc-color-text-muted);
  text-align: center;
}

@media (max-width: 35rem) {
  .task-popover {
    right: calc(var(--gc-space-4) * -1);
    width: min(48rem, calc(100vw - var(--gc-space-4)));
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
