<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { GcModal, GcStatusTag, GcTabs } from '@/design-system/components'
import { getTask, listMonitoringProbes, listTasks, type TaskCategory, type TaskDetail, type TaskRun, type TaskStatus } from '@/api/modules/tasks.api'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()

const activeTab = ref<'all' | TaskCategory>('EXECUTION')
const includeAll = ref(false)
const loading = ref(false)
const detailLoading = ref(false)
const error = ref('')
const detailError = ref('')
const tasks = ref<readonly TaskRun[]>([])
const total = ref(0)
const page = ref(1)
const detail = ref<TaskDetail | null>(null)
const monitoringProbes = ref<readonly Record<string, unknown>[]>([])
const keyword = ref('')

const tabs = computed(() => [
  { value: 'all', label: t('tasks.tabs.all') },
  { value: 'EXECUTION', label: t('tasks.tabs.execution') },
  { value: 'MONITORING', label: t('tasks.tabs.monitoring') },
  { value: 'SYSTEM', label: t('tasks.tabs.system') }
])
const selectedCategory = computed<TaskCategory | undefined>(() => activeTab.value === 'all' ? undefined : activeTab.value)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / 20)))
const detailTask = computed(() => detail.value?.task ?? null)

watch(() => props.open, (open) => {
  if (open) void loadTasks(true)
  else detail.value = null
})
watch([activeTab, includeAll], () => {
  if (props.open) void loadTasks(true)
})

async function loadTasks(resetPage = false): Promise<void> {
  if (resetPage) page.value = 1
  loading.value = true
  error.value = ''
  try {
    const result = await listTasks({
      page: page.value,
      pageSize: 20,
      keyword: keyword.value.trim() || undefined,
      includeAll: includeAll.value || activeTab.value === 'all',
      filters: {
        category: selectedCategory.value
      }
    })
    tasks.value = result.data?.items ?? []
    total.value = result.data?.total ?? 0
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('tasks.messages.loadFailed')
  } finally {
    loading.value = false
  }
}

async function openTask(task: TaskRun): Promise<void> {
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

function submitSearch(): void {
  void loadTasks(true)
}

function resetFilters(): void {
  keyword.value = ''
  void loadTasks(true)
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
  <GcModal
    :open="open"
    :title="t('tasks.title')"
    :description="t('tasks.description')"
    size="xl"
    width="min(960px, calc(100vw - 32px))"
    close-on-backdrop
    @update:open="emit('close')"
  >
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
            <li v-for="event in detail.events" :key="String(event.id)">
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
        <section class="task-drawer__section">
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
      <GcTabs v-model="activeTab" :tabs="tabs" :aria-label="t('tasks.aria.tabs')" />
      <form class="task-drawer__toolbar" @submit.prevent="submitSearch">
        <label class="task-drawer__search">
          <span class="sr-only">{{ t('tasks.filters.keyword') }}</span>
          <input v-model="keyword" :placeholder="t('tasks.filters.keyword')" :aria-label="t('tasks.filters.keyword')" type="search">
        </label>
        <label class="task-drawer__switch">
          <input
            v-model="includeAll"
            type="checkbox"
            role="switch"
            :aria-checked="includeAll"
          >
          <span class="task-drawer__switch-track" aria-hidden="true"><span /></span>
          <span>{{ t('tasks.filters.includeAll') }}</span>
        </label>
      </form>
      <p v-if="error" class="gc-form-error">{{ error }}</p>
      <div v-if="loading" class="task-drawer__loading">{{ t('common.loading') }}</div>
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
      <div class="task-drawer__pagination">
        <button class="gc-icon-button" type="button" :disabled="page <= 1" :aria-label="t('tasks.actions.previousPage')" @click="page -= 1; void loadTasks()"><span aria-hidden="true">‹</span></button>
        <span>{{ page }} / {{ pageCount }}</span>
        <button class="gc-icon-button" type="button" :disabled="page >= pageCount" :aria-label="t('tasks.actions.nextPage')" @click="page += 1; void loadTasks()"><span aria-hidden="true">›</span></button>
      </div>
    </div>
  </GcModal>
</template>

<style scoped>
.task-drawer__list,
.task-drawer__detail {
  display: grid;
  gap: var(--gc-space-5);
}

.task-drawer__toolbar {
  display: flex;
  align-items: center;
  gap: var(--gc-space-4);
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
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}

.task-drawer__switch-track {
  position: relative;
  display: inline-flex;
  align-items: center;
  width: 42px;
  height: 24px;
  padding: 3px;
  border-radius: 999px;
  background: var(--gc-color-border-strong);
  transition: background-color 160ms ease;
}

.task-drawer__switch-track span {
  width: 18px;
  height: 18px;
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
  transform: translateX(18px);
}

.task-drawer__switch input:focus-visible + .task-drawer__switch-track {
  box-shadow: var(--gc-shadow-focus);
}

.task-drawer__items {
  display: grid;
  gap: var(--gc-space-2);
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

.task-drawer__pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--gc-space-3);
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
  border-left: 3px solid var(--gc-color-primary-border);
  background: var(--gc-color-surface-subtle);
}

.task-drawer__timeline time,
.task-drawer__record span,
.task-drawer__record time {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.task-drawer__json {
  max-height: 220px;
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

@media (max-width: 560px) {
  .task-drawer__facts {
    grid-template-columns: minmax(0, 1fr);
  }

  .task-drawer__toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .task-drawer__switch {
    justify-content: flex-end;
  }
}
</style>
