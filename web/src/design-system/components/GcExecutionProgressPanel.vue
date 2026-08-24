<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ApiRecord } from '@/api/modules/common'
import type { ExecutionLogLine, ExecutionStepLine } from './GcExecutionLogViewer.vue'
import GcDryRunChecklist from './GcDryRunChecklist.vue'
import GcExecutionLogViewer from './GcExecutionLogViewer.vue'

const LOG_FOLLOW_THRESHOLD_PX = 24

type SummaryState = 'queued' | 'running' | 'pending' | 'passed' | 'warning' | 'failed'
type TaskStatus = 'queued' | 'running' | 'passed' | 'warning' | 'failed'
type CheckStatus = 'passed' | 'warning' | 'failed' | 'unknown'
type TaskCheck = {
  id: string
  label: string
  detail: string
  status: CheckStatus
}

interface DryRunSummary {
  state: SummaryState
  label: string
  detail: string
  passed: number
  warning: number
  failed: number
  unknown: number
}

interface VisibleTask {
  id: string
  title: string
  subtitle: string
  status: TaskStatus
  timeLabel: string
  rawStatus: string
}

interface ExecutionFeedItem {
  id: string
  title: string
  detail: string
  status: TaskStatus
  timeLabel: string
}

const props = withDefaults(defineProps<{
  loading?: boolean
  runId?: string
  requestId?: string
  summary?: DryRunSummary | null
  checks?: readonly ApiRecord[]
  steps?: readonly ExecutionStepLine[]
  lines?: readonly ExecutionLogLine[]
  error?: string
  polling?: boolean
  showChecklist?: boolean
  revealOnMount?: boolean
  mode?: 'dry-run' | 'execution'
}>(), {
  showChecklist: true,
  revealOnMount: true,
  mode: 'dry-run',
})

const logExpanded = ref(false)
const feedListRef = ref<HTMLUListElement | null>(null)
const followLatestFeedItem = ref(true)
const { t } = useI18n()

const taskChecksByStep = computed(() => groupLinesByStep(props.lines ?? []))
const rawTasks = computed<VisibleTask[]>(() => buildVisibleTasksFromChecks(props.steps ?? [], taskChecksByStep.value))
const counts = computed(() => {
  const tasks = rawTasks.value
  return {
    total: tasks.length,
    completed: tasks.filter((task) => ['passed', 'warning', 'failed'].includes(task.status)).length,
    running: tasks.filter((task) => task.status === 'running').length,
    queued: tasks.filter((task) => task.status === 'queued').length,
  }
})
const allTasksRevealed = computed(() => true)

const isDryRunMode = computed(() => props.mode === 'dry-run')
const processLabel = computed(() => isDryRunMode.value ? 'Dry-run' : t('designSystem.executionProgress.process.execution'))

const heroState = computed<SummaryState>(() => {
  if (props.error) return 'failed'
  return props.summary?.state ?? inferStateFromTasks(rawTasks.value)
})
const displayState = computed<SummaryState>(() => {
  if (props.error) return 'failed'
  return heroState.value
})
const displayCounts = computed(() => ({
  total: counts.value.total,
  completed: counts.value.completed,
  running: counts.value.running,
  queued: counts.value.queued,
}))

const heroDetail = computed(() => {
  if (props.error) return props.error
  if (props.summary) {
    const total = props.summary.passed + props.summary.warning + props.summary.failed + props.summary.unknown
    if (props.summary.state === 'passed') return t('designSystem.executionProgress.detail.summaryPassed', { passed: props.summary.passed })
    if (props.summary.state === 'warning') return t('designSystem.executionProgress.detail.summaryWarning', { total, warning: props.summary.warning })
    if (props.summary.state === 'failed') return t('designSystem.executionProgress.detail.summaryFailed', { total, failed: props.summary.failed })
    if (props.summary.state === 'running') {
      return t('designSystem.executionProgress.detail.stepsCompleted', {
        completed: displayCounts.value.completed,
        total: Math.max(displayCounts.value.total, 1),
      })
    }
    if (props.summary.state === 'queued') return t('designSystem.executionProgress.detail.waitingStart')
    return t('designSystem.executionProgress.detail.summaryReturned', { total })
  }
  if (counts.value.total === 0) return t('designSystem.executionProgress.detail.waitingSteps')
  return t('designSystem.executionProgress.detail.stepsCompleted', {
    completed: displayCounts.value.completed,
    total: Math.max(displayCounts.value.total, 1),
  })
})

const progressPercent = computed(() => {
  const total = Math.max(displayCounts.value.total, 1)
  const value = Math.round((displayCounts.value.completed / total) * 100)
  if (displayState.value === 'queued') return 8
  if (displayState.value === 'running' && value === 0) return 18
  if (['passed', 'warning', 'failed'].includes(displayState.value) && counts.value.total > 0) return 100
  return Math.min(100, Math.max(0, value))
})

const progressLabel = computed(() => {
  if (props.error) return t('designSystem.executionProgress.progress.processFailed', { process: processLabel.value })
  if (displayState.value === 'queued') return t('designSystem.executionProgress.progress.queued')
  if (displayState.value === 'running') return t('designSystem.executionProgress.progress.running')
  if (displayState.value === 'pending') return t('designSystem.executionProgress.progress.pending')
  if (displayState.value === 'warning') return t('designSystem.executionProgress.progress.warning')
  if (displayState.value === 'failed') return t('designSystem.executionProgress.progress.failed')
  return t('designSystem.executionProgress.progress.completed')
})
const heroBadgeLabel = computed(() => (
  allTasksRevealed.value ? (props.summary?.label ?? progressLabel.value) : progressLabel.value
))

const activeTaskIndex = computed(() => {
  const tasks = rawTasks.value
  const runningIndex = tasks.findIndex((task) => task.status === 'running')
  if (runningIndex >= 0) return runningIndex
  const queuedIndex = tasks.findIndex((task) => task.status === 'queued')
  if (queuedIndex >= 0) return queuedIndex
  return tasks.length - 1
})

const visibleTasks = computed(() => rawTasks.value)
const executionFeed = computed<ExecutionFeedItem[]>(() => visibleTasks.value
  .filter((task) => ['running', 'passed', 'warning', 'failed'].includes(task.status))
  .map((task) => {
    const checks = taskChecksByStep.value.get(taskTitleKey(task)) ?? []
    const latestCheck = checks[checks.length - 1]
    return {
      id: task.id,
      title: task.title,
      detail: latestCheck?.detail || latestCheck?.label || task.subtitle,
      status: task.status,
      timeLabel: task.timeLabel,
    }
  }))

const heroMetrics = computed(() => {
  const summary = props.summary
  if (summary && allTasksRevealed.value) {
    return [
      { label: t('designSystem.executionProgress.metrics.passed'), value: String(summary.passed) },
      { label: t('designSystem.executionProgress.metrics.warning'), value: String(summary.warning) },
      { label: t('designSystem.executionProgress.metrics.failed'), value: String(summary.failed) },
      { label: t('designSystem.executionProgress.metrics.unknown'), value: String(summary.unknown) },
    ]
  }
  return [
    { label: t('designSystem.executionProgress.metrics.totalTasks'), value: String(Math.max(displayCounts.value.total, 1)) },
    { label: t('designSystem.executionProgress.metrics.completed'), value: String(displayCounts.value.completed) },
    { label: t('designSystem.executionProgress.metrics.running'), value: String(displayCounts.value.running) },
    { label: t('designSystem.executionProgress.metrics.queued'), value: String(displayCounts.value.queued) },
  ]
})

watch(
  () => executionFeed.value.map((item) => `${item.id}:${item.status}:${item.timeLabel}:${item.detail}`).join('|'),
  async () => {
    if (!followLatestFeedItem.value) return
    await nextTick()
    scrollFeedToLatest()
  },
  { immediate: true, flush: 'post' },
)

watch(
  () => [props.runId, props.requestId] as const,
  async () => {
    followLatestFeedItem.value = true
    await nextTick()
    scrollFeedToLatest()
  },
)

function handleFeedScroll() {
  const element = feedListRef.value
  if (!element) return
  const remaining = element.scrollHeight - element.scrollTop - element.clientHeight
  followLatestFeedItem.value = remaining <= LOG_FOLLOW_THRESHOLD_PX
}

function scrollFeedToLatest() {
  const element = feedListRef.value
  if (!element) return
  element.scrollTop = element.scrollHeight
}

function buildVisibleTasksFromChecks(
  steps: readonly ExecutionStepLine[],
  lineGroups: Map<string, TaskCheck[]>,
): VisibleTask[] {
  return steps.map((step) => {
    const rawStatus = String(step.status ?? '').toUpperCase()
    const status = normalizeTaskStatus(rawStatus)
    const checks = lineGroups.get(step.name) ?? []
    return {
      id: step.id,
      title: humanizeStepTitle(step.name, props.mode),
      subtitle: buildTaskSubtitle(status, checks, step.detail),
      status,
      timeLabel: formatTimeLabel(step.startedAt, step.finishedAt),
      rawStatus,
    }
  })
}

function groupLinesByStep(lines: readonly ExecutionLogLine[]): Map<string, TaskCheck[]> {
  const output = new Map<string, TaskCheck[]>()
  for (const line of lines) {
    const stepName = line.step?.trim()
    if (!stepName) continue
    const list = output.get(stepName) ?? []
    const parts = splitMessage(line.message)
    list.push({
      id: line.id,
      label: parts.title,
      detail: parts.detail,
      status: normalizeCheckStatus(line.level),
    })
    output.set(stepName, dedupeChecks(list))
  }
  return output
}

function dedupeChecks(items: TaskCheck[]): TaskCheck[] {
  const byKey = new Map<string, TaskCheck>()
  for (const item of items) {
    const key = `${item.label}::${item.detail}`
    if (!byKey.has(key)) byKey.set(key, item)
  }
  return [...byKey.values()]
}

function splitMessage(message: string): { title: string; detail: string } {
  const normalized = message.trim()
  const index = normalized.indexOf(':')
  if (index <= 0) {
    return {
      title: normalized || t('designSystem.executionProgress.event.defaultTitle'),
      detail: normalized || t('designSystem.executionProgress.event.waitingDetail'),
    }
  }
  return {
    title: normalized.slice(0, index).trim(),
    detail: normalized.slice(index + 1).trim() || normalized.slice(0, index).trim(),
  }
}

function normalizeTaskStatus(value: string): TaskStatus {
  if (value === 'SUCCESS') return 'passed'
  if (value === 'RUNNING') return 'running'
  if (value === 'FAILED' || value === 'TIMEOUT' || value === 'CANCELLED') return 'failed'
  return 'queued'
}

function normalizeCheckStatus(level: ExecutionLogLine['level']): CheckStatus {
  if (level === 'error') return 'failed'
  if (level === 'warn') return 'warning'
  if (level === 'debug') return 'unknown'
  return 'passed'
}

function inferStateFromTasks(tasks: readonly VisibleTask[]): SummaryState {
  if (tasks.length === 0) return 'queued'
  if (tasks.some((task) => task.status === 'failed')) return 'failed'
  if (tasks.some((task) => task.status === 'running')) return 'running'
  if (tasks.some((task) => task.status === 'queued')) return 'queued'
  return 'passed'
}

function humanizeStepTitle(name: string, mode: 'dry-run' | 'execution'): string {
  const upper = name.toUpperCase()
  if (upper.startsWith('DISCOVER')) return t('designSystem.executionProgress.step.discover')
  if (upper.startsWith('VERIFY')) return t('designSystem.executionProgress.step.verify')
  if (upper.startsWith('BACKUP')) return t('designSystem.executionProgress.step.backup')
  if (upper.startsWith('INSTALL')) {
    return mode === 'execution'
      ? t('designSystem.executionProgress.step.installExecution')
      : t('designSystem.executionProgress.step.installDryRun')
  }
  if (upper.startsWith('RELOAD')) return t('designSystem.executionProgress.step.reload')
  return name
}

function defaultSubtitle(status: TaskStatus): string {
  if (status === 'running') return t('designSystem.executionProgress.subtitle.running')
  if (status === 'queued') return t('designSystem.executionProgress.subtitle.queued')
  if (status === 'failed') return t('designSystem.executionProgress.subtitle.failed')
  return t('designSystem.executionProgress.subtitle.completed')
}

function buildTaskSubtitle(
  status: TaskStatus,
  checks: Array<{ id: string; label: string; detail: string; status: CheckStatus }>,
  detail?: string,
): string {
  if (checks.length > 0) {
    const summary = countCheckStatuses(checks)
    const total = summary.passed + summary.warning + summary.failed + summary.unknown
    if (summary.failed > 0) return t('designSystem.executionProgress.subtitle.failedChecks', { total, failed: summary.failed })
    if (summary.warning > 0) return t('designSystem.executionProgress.subtitle.warningChecks', { total, warning: summary.warning })
    if (status === 'running') return t('designSystem.executionProgress.subtitle.runningChecks', { total })
    return t('designSystem.executionProgress.subtitle.passedChecks', { total })
  }
  return detail?.trim() || defaultSubtitle(status)
}

function countCheckStatuses(checks: Array<{ status: CheckStatus }>): Record<CheckStatus, number> {
  return checks.reduce<Record<CheckStatus, number>>((summary, check) => {
    summary[check.status] += 1
    return summary
  }, {
    passed: 0,
    warning: 0,
    failed: 0,
    unknown: 0,
  })
}

function formatTimeLabel(startedAt?: string, finishedAt?: string): string {
  if (startedAt && finishedAt) return `${startedAt} -> ${finishedAt}`
  return startedAt || finishedAt || t('designSystem.executionProgress.time.waitingStart')
}

function taskTitleKey(task: VisibleTask): string {
  const step = (props.steps ?? []).find((item) => item.id === task.id)
  return step?.name ?? task.title
}

function statusBadgeText(status: TaskStatus): string {
  if (status === 'queued') return t('designSystem.executionProgress.status.queued')
  if (status === 'running') return t('designSystem.executionProgress.status.running')
  if (status === 'warning') return t('designSystem.executionProgress.status.warning')
  if (status === 'failed') return t('designSystem.executionProgress.status.failed')
  return t('designSystem.executionProgress.status.completed')
}

function taskDotText(status: TaskStatus): string {
  if (status === 'queued') return '○'
  if (status === 'running') return '◐'
  if (status === 'failed' || status === 'warning') return '!'
  return '✓'
}

function feedStatusText(status: TaskStatus): string {
  if (status === 'running') return t('designSystem.executionProgress.progress.running')
  if (status === 'failed') return t('designSystem.executionProgress.feed.failed')
  if (status === 'warning') return t('designSystem.executionProgress.feed.warning')
  return t('designSystem.executionProgress.feed.completed')
}
</script>

<template>
  <section class="gc-dry-run-modern">
    <p v-if="error" class="gc-dry-run-modern__error">{{ error }}</p>

    <section class="gc-dry-run-modern__hero" :data-state="displayState" :aria-label="t('designSystem.executionProgress.aria.progressOverview')">
      <div class="gc-dry-run-modern__hero-copy">
        <div class="gc-dry-run-modern__hero-head">
          <strong>{{ progressLabel }}</strong>
          <span class="gc-dry-run-modern__hero-badge">{{ heroBadgeLabel }}</span>
        </div>
        <p>{{ heroDetail }}</p>
        <div class="gc-dry-run-modern__hero-meta">
          <span v-if="loading">{{ t('designSystem.executionProgress.loading.refreshing') }}</span>
          <span v-if="polling">{{ t('designSystem.executionProgress.loading.pollingFallback') }}</span>
        </div>
      </div>
        <div class="gc-dry-run-modern__hero-side">
          <div class="gc-dry-run-modern__hero-progress">
            <strong>{{ progressPercent }}%</strong>
            <span>{{ displayCounts.completed }}/{{ Math.max(displayCounts.total, 1) }}</span>
          </div>
          <div class="gc-dry-run-modern__progress-track" aria-hidden="true">
            <span :style="{ width: `${progressPercent}%` }" />
        </div>
      </div>
      <dl class="gc-dry-run-modern__metrics">
        <div v-for="metric in heroMetrics" :key="metric.label">
          <dt>{{ metric.label }}</dt>
          <dd>{{ metric.value }}</dd>
        </div>
      </dl>
    </section>

    <section class="gc-dry-run-modern__layout">
      <section class="gc-card gc-dry-run-modern__tasks" :aria-label="t('designSystem.executionProgress.aria.taskList')">
        <header class="gc-dry-run-modern__section-head">
          <div>
            <strong>{{ t('designSystem.executionProgress.section.taskProgress') }}</strong>
          </div>
          <span class="gc-dry-run-modern__section-pill">
            {{ t('designSystem.executionProgress.section.completedCount', { completed: displayCounts.completed, total: displayCounts.total || 1 }) }}
          </span>
        </header>

        <ol v-if="visibleTasks.length" class="gc-dry-run-modern__task-list">
          <li
            v-for="(task, index) in visibleTasks"
            :key="task.id"
            class="gc-dry-run-modern__task"
            :data-status="task.status"
            :data-active="index === activeTaskIndex"
          >
            <div class="gc-dry-run-modern__task-rail" aria-hidden="true">
              <span class="gc-dry-run-modern__task-dot">{{ taskDotText(task.status) }}</span>
              <span v-if="index < visibleTasks.length - 1" class="gc-dry-run-modern__task-line" />
            </div>

            <article class="gc-dry-run-modern__task-card">
              <div class="gc-dry-run-modern__task-head">
                <div>
                  <strong>{{ task.title }}</strong>
                  <p>{{ task.subtitle }}</p>
                </div>
                <span class="gc-dry-run-modern__task-badge">{{ statusBadgeText(task.status) }}</span>
              </div>

              <div class="gc-dry-run-modern__task-meta">
                <span>{{ task.timeLabel }}</span>
                <span>{{ task.rawStatus }}</span>
              </div>
            </article>
          </li>
        </ol>

        <p v-else class="gc-dry-run-modern__empty">{{ t('designSystem.executionProgress.empty.tasks') }}</p>

      </section>

      <aside class="gc-dry-run-modern__aside">
        <section class="gc-card gc-dry-run-modern__activity" :aria-label="t('designSystem.executionProgress.aria.executionLog')">
          <header class="gc-dry-run-modern__section-head">
            <div>
              <strong>{{ t('designSystem.executionProgress.section.executionLog') }}</strong>
            </div>
            <button
              v-if="requestId"
              class="gc-button"
              type="button"
              @click="logExpanded = !logExpanded"
            >
              {{ logExpanded ? t('designSystem.executionProgress.log.collapse') : t('designSystem.executionProgress.log.expand') }}
            </button>
          </header>

          <ul
            v-if="executionFeed.length"
            ref="feedListRef"
            class="gc-dry-run-modern__feed-list"
            @scroll.passive="handleFeedScroll"
          >
            <li v-for="item in executionFeed" :key="item.id" class="gc-dry-run-modern__feed-item" :data-status="item.status">
              <span class="gc-dry-run-modern__feed-icon" aria-hidden="true">
                {{ taskDotText(item.status) }}
              </span>
              <div class="gc-dry-run-modern__feed-copy">
                <strong>{{ item.title }}</strong>
                <span>{{ item.detail }}</span>
                <small>{{ item.timeLabel }} · {{ feedStatusText(item.status) }}</small>
              </div>
            </li>
          </ul>
          <p v-else class="gc-dry-run-modern__empty">{{ t('designSystem.executionProgress.empty.activity') }}</p>
        </section>

        <GcDryRunChecklist
          v-if="isDryRunMode && showChecklist"
          :items="checks ?? []"
          :title="t('designSystem.executionProgress.checklist.title')"
        />
      </aside>
    </section>

    <GcExecutionLogViewer
      v-if="logExpanded"
      :lines="lines ?? []"
      :steps="steps ?? []"
      :polling="polling"
      :streaming="!polling"
      mode="live"
    />
  </section>
</template>

<style scoped>
.gc-dry-run-modern {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.gc-dry-run-modern__error {
  margin: 0;
  border-radius: 12px;
  padding: 12px 14px;
  border: 1px solid var(--gc-color-danger-border);
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-bg);
}

.gc-dry-run-modern__hero {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(240px, 0.7fr);
  gap: 12px 18px;
  padding: 12px 16px;
  border-radius: 8px;
  border: 1px solid var(--gc-color-border);
  background:
    linear-gradient(135deg, var(--gc-color-surface-overlay), var(--gc-color-surface-subtle)),
    linear-gradient(120deg, var(--gc-color-info-border), var(--gc-color-success-bg));
}

.gc-dry-run-modern__hero[data-state='failed'] {
  background:
    linear-gradient(135deg, var(--gc-color-surface-overlay), var(--gc-color-danger-soft)),
    linear-gradient(120deg, var(--gc-color-danger-border), var(--gc-color-danger-bg));
}

.gc-dry-run-modern__hero[data-state='warning'] {
  background:
    linear-gradient(135deg, var(--gc-color-surface-overlay), var(--gc-color-warning-soft)),
    linear-gradient(120deg, var(--gc-color-warning-border), var(--gc-color-warning-bg));
}

.gc-dry-run-modern__hero[data-state='queued'],
.gc-dry-run-modern__hero[data-state='running'],
.gc-dry-run-modern__hero[data-state='pending'] {
  background:
    linear-gradient(135deg, var(--gc-color-surface-overlay), var(--gc-color-surface-selected)),
    linear-gradient(120deg, var(--gc-color-primary-border), var(--gc-color-info-border));
}

.gc-dry-run-modern__hero-copy,
.gc-dry-run-modern__hero-side {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.gc-dry-run-modern__hero-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.gc-dry-run-modern__hero-head strong {
  font-size: clamp(18px, 2vw, 22px);
  line-height: 1.1;
}

.gc-dry-run-modern__hero-badge,
.gc-dry-run-modern__section-pill,
.gc-dry-run-modern__task-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 800;
  white-space: nowrap;
}

.gc-dry-run-modern__hero-badge,
.gc-dry-run-modern__section-pill {
  color: var(--gc-color-text);
  background: var(--gc-color-surface-glass);
  border: 1px solid var(--gc-color-border-strong);
}

.gc-dry-run-modern__hero p,
.gc-dry-run-modern__section-head p,
.gc-dry-run-modern__task-head p,
.gc-dry-run-modern__empty {
  margin: 0;
  color: var(--gc-color-text-muted);
  overflow-wrap: anywhere;
}

.gc-dry-run-modern__hero p {
  font-size: 14px;
}

.gc-dry-run-modern__hero-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--gc-color-text-muted);
  font-size: 12px;
}

.gc-dry-run-modern__hero-progress {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 8px;
}

.gc-dry-run-modern__hero-progress strong {
  font-size: 28px;
  line-height: 1;
}

.gc-dry-run-modern__hero-progress span {
  color: var(--gc-color-text-muted);
  font-size: 13px;
}

.gc-dry-run-modern__progress-track {
  width: 100%;
  height: 8px;
  border-radius: 999px;
  background: var(--gc-color-muted-bg);
  overflow: hidden;
}

.gc-dry-run-modern__progress-track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--gc-color-text), var(--gc-color-primary-strong) 55%, var(--gc-color-success));
  transition: width 360ms ease;
}

.gc-dry-run-modern__metrics {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}

.gc-dry-run-modern__metrics div {
  display: grid;
  gap: 2px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--gc-color-surface);
  border: 1px solid var(--gc-color-muted-bg);
}

.gc-dry-run-modern__metrics dt {
  font-size: 12px;
  color: var(--gc-color-text-muted);
  font-weight: 700;
}

.gc-dry-run-modern__metrics dd {
  margin: 0;
  font-size: 20px;
  font-weight: 850;
}

.gc-dry-run-modern__layout {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
}

.gc-dry-run-modern__tasks,
.gc-dry-run-modern__events {
  display: grid;
  gap: 14px;
}

.gc-dry-run-modern__aside {
  display: grid;
  gap: 16px;
}

.gc-dry-run-modern__activity {
  display: grid;
  gap: 14px;
}

.gc-dry-run-modern__section-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  flex-wrap: wrap;
}

.gc-dry-run-modern__task-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 10px;
}

.gc-dry-run-modern__task {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 10px;
}

.gc-dry-run-modern__task-rail {
  display: grid;
  justify-items: center;
  grid-template-rows: auto 1fr;
  gap: 6px;
}

.gc-dry-run-modern__task-dot {
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: var(--gc-color-muted-bg);
  color: var(--gc-color-text);
  font-weight: 800;
  font-size: 11px;
}

.gc-dry-run-modern__task-line {
  width: 2px;
  min-height: 28px;
  background: var(--gc-color-border-strong);
}

.gc-dry-run-modern__task-card {
  display: grid;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid var(--gc-color-border);
  border-radius: 8px;
  background: var(--gc-color-surface-solid);
}

.gc-dry-run-modern__task-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  flex-wrap: wrap;
}

.gc-dry-run-modern__task-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--gc-color-text-muted);
  font-size: 12px;
}

.gc-dry-run-modern__event-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 10px;
}

.gc-dry-run-modern__event-list li {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--gc-color-border);
  border-radius: 8px;
}

.gc-dry-run-modern__event-preview {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--gc-color-border);
  border-radius: 8px;
  background: var(--gc-color-surface-soft);
}

.gc-dry-run-modern__event-request {
  justify-self: start;
  border: 0;
  background: transparent;
  color: var(--gc-color-text-muted);
  padding: 0;
  font-size: 12px;
}

.gc-dry-run-modern__feed-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 10px;
  max-height: 60vh;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.gc-dry-run-modern__feed-item {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  padding: 12px 14px;
  border: 1px solid var(--gc-color-border);
  border-radius: 8px;
  background: var(--gc-color-surface-solid);
}

.gc-dry-run-modern__feed-icon {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 900;
  color: var(--gc-color-surface-solid);
  background: var(--gc-color-success);
}

.gc-dry-run-modern__feed-item[data-status='warning'] .gc-dry-run-modern__feed-icon {
  background: var(--gc-color-warning);
}

.gc-dry-run-modern__feed-item[data-status='running'] .gc-dry-run-modern__feed-icon {
  background: var(--gc-color-info);
}

.gc-dry-run-modern__feed-item[data-status='failed'] .gc-dry-run-modern__feed-icon {
  background: var(--gc-color-danger);
}

.gc-dry-run-modern__feed-copy {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.gc-dry-run-modern__feed-copy strong,
.gc-dry-run-modern__feed-copy span,
.gc-dry-run-modern__feed-copy small {
  overflow-wrap: anywhere;
}

.gc-dry-run-modern__feed-copy span,
.gc-dry-run-modern__feed-copy small {
  color: var(--gc-color-text-muted);
}

@media (max-width: 960px) {
  .gc-dry-run-modern__hero,
  .gc-dry-run-modern__layout {
    grid-template-columns: 1fr;
  }

  .gc-dry-run-modern__metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .gc-dry-run-modern__hero-progress {
    justify-self: start;
    justify-content: flex-start;
  }
}
</style>
