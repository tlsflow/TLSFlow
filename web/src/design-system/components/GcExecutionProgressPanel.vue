<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ApiRecord } from '@/api/modules/common'
import type { ExecutionLogLine, ExecutionStepLine } from './GcExecutionLogViewer.vue'
import GcDryRunChecklist from './GcDryRunChecklist.vue'
import GcExecutionLogViewer from './GcExecutionLogViewer.vue'

const LOG_FOLLOW_THRESHOLD_PX = 24

type SummaryState = 'queued' | 'running' | 'pending' | 'passed' | 'warning' | 'failed'
type TaskStatus = 'queued' | 'running' | 'passed' | 'warning' | 'failed' | 'skipped'
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
    completed: tasks.filter((task) => ['passed', 'warning', 'failed', 'skipped'].includes(task.status)).length,
    running: tasks.filter((task) => task.status === 'running').length,
    queued: tasks.filter((task) => task.status === 'queued').length,
  }
})
const allTasksRevealed = computed(() => true)

const isDryRunMode = computed(() => props.mode === 'dry-run')
const processLabel = computed(() => isDryRunMode.value
  ? t('designSystem.executionProgress.process.dryRun')
  : t('designSystem.executionProgress.process.execution'))

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
  .filter((task) => ['running', 'passed', 'warning', 'failed', 'skipped'].includes(task.status))
  .map((task) => {
    return {
      id: task.id,
      title: task.title,
      detail: task.subtitle,
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
const latestFeedSignature = computed(() => {
  const items = executionFeed.value
  const latest = items[items.length - 1]
  return latest ? `${items.length}:${latest.id}:${latest.status}:${latest.timeLabel}` : '0'
})

watch(
  latestFeedSignature,
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
    const stepType = step.stepType || step.name
    return {
      id: step.id,
      title: humanizeStepTitle(stepType, props.mode),
      subtitle: buildTaskSubtitle(status, stepType, checks, step.detail),
      status,
      timeLabel: formatTimeLabel(step.startedAt, step.finishedAt),
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
    output.set(stepName, list)
  }
  for (const [stepName, list] of output.entries()) {
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
  if (value === 'SKIPPED') return 'skipped'
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
  if (tasks.every((task) => task.status === 'queued')) return 'queued'
  if (tasks.some((task) => task.status === 'running' || task.status === 'queued')) return 'running'
  return 'passed'
}

function humanizeStepTitle(name: string, mode: 'dry-run' | 'execution'): string {
  const upper = name.toUpperCase()
  if (upper.startsWith('DISCOVER') || upper.startsWith('PREPARE')) return t('designSystem.executionProgress.step.prepare')
  if (upper.startsWith('VERIFY')) return t('designSystem.executionProgress.step.verify')
  if (upper.startsWith('BACKUP')) return t('designSystem.executionProgress.step.backup')
  if (upper.startsWith('INSTALL') || upper.startsWith('UPDATE') || upper.startsWith('CUSTOM')) {
    return mode === 'execution'
      ? t('designSystem.executionProgress.step.updateExecution')
      : t('designSystem.executionProgress.step.updateDryRun')
  }
  if (upper.startsWith('RELOAD')) return t('designSystem.executionProgress.step.reload')
  return name
}

function defaultSubtitle(status: TaskStatus): string {
  if (status === 'running') return t('designSystem.executionProgress.subtitle.running')
  if (status === 'queued') return t('designSystem.executionProgress.subtitle.queued')
  if (status === 'failed') return t('designSystem.executionProgress.subtitle.failed')
  if (status === 'skipped') return t('designSystem.executionProgress.subtitle.skipped')
  return t('designSystem.executionProgress.subtitle.completed')
}

function buildTaskSubtitle(
  status: TaskStatus,
  stepType: string,
  checks: Array<{ id: string; label: string; detail: string; status: CheckStatus }>,
  detail?: string,
): string {
  if (status === 'failed') return t('designSystem.executionProgress.subtitle.failedFriendly')
  if (status === 'skipped') return detail?.trim() || t('designSystem.executionProgress.subtitle.skipped')
  const operation = lifecycleOperationDescription(stepType)
  if (operation) return operation
  if (checks.length > 0) return defaultSubtitle(status)
  return detail?.trim() || defaultSubtitle(status)
}

function lifecycleOperationDescription(stepType: string): string {
  const upper = stepType.toUpperCase()
  if (upper.startsWith('DISCOVER') || upper.startsWith('PREPARE')) return t('designSystem.executionProgress.operation.prepare')
  if (upper.startsWith('BACKUP')) return t('designSystem.executionProgress.operation.backup')
  if (upper.startsWith('INSTALL') || upper.startsWith('UPDATE') || upper.startsWith('CUSTOM')) return t('designSystem.executionProgress.operation.update')
  if (upper.startsWith('RELOAD')) return t('designSystem.executionProgress.operation.reload')
  if (upper.startsWith('VERIFY')) return t('designSystem.executionProgress.operation.verify')
  if (upper.startsWith('ROLLBACK')) return t('designSystem.executionProgress.operation.rollback')
  return ''
}

function formatTimeLabel(startedAt?: string, finishedAt?: string): string {
  if (startedAt && finishedAt) return `${startedAt} -> ${finishedAt}`
  return startedAt || finishedAt || t('designSystem.executionProgress.time.waitingStart')
}

function statusBadgeText(status: TaskStatus): string {
  if (status === 'queued') return t('designSystem.executionProgress.status.queued')
  if (status === 'running') return t('designSystem.executionProgress.status.running')
  if (status === 'warning') return t('designSystem.executionProgress.status.warning')
  if (status === 'failed') return t('designSystem.executionProgress.status.failed')
  if (status === 'skipped') return t('designSystem.executionProgress.status.skipped')
  return t('designSystem.executionProgress.status.completed')
}

function taskDotText(status: TaskStatus): string {
  if (status === 'queued') return '○'
  if (status === 'running') return '◐'
  if (status === 'failed' || status === 'warning') return '!'
  if (status === 'skipped') return '–'
  return '✓'
}

function feedStatusText(status: TaskStatus): string {
  if (status === 'running') return t('designSystem.executionProgress.progress.running')
  if (status === 'failed') return t('designSystem.executionProgress.feed.failed')
  if (status === 'warning') return t('designSystem.executionProgress.feed.warning')
  if (status === 'skipped') return t('designSystem.executionProgress.feed.skipped')
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
  gap: var(--gc-space-4);
  min-width: 0;
}

.gc-dry-run-modern__error {
  margin: 0;
  border-radius: var(--gc-radius-card);
  padding: var(--gc-space-3) var(--gc-space-panel);
  border: var(--gc-border-width-default) solid var(--gc-color-danger-border);
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-bg);
}

.gc-dry-run-modern__hero {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(var(--gc-size-dry-run-aside-min), 0.7fr);
  gap: var(--gc-space-3) var(--gc-space-5);
  padding: var(--gc-space-3) var(--gc-space-4);
  border-radius: var(--gc-radius-control);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
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
  gap: var(--gc-space-2);
  min-width: 0;
}

.gc-dry-run-modern__hero-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-3);
  flex-wrap: wrap;
}

.gc-dry-run-modern__hero-head strong {
  font-size: clamp(var(--gc-font-size-heading-xs), 2vw, var(--gc-font-size-heading-sm));
  line-height: 1.1;
}

.gc-dry-run-modern__hero-badge,
.gc-dry-run-modern__section-pill,
.gc-dry-run-modern__task-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--gc-space-8);
  padding: 0 var(--gc-space-3);
  border-radius: var(--gc-radius-full);
  font-size: var(--gc-font-size-label);
  font-weight: 800;
  white-space: nowrap;
}

.gc-dry-run-modern__hero-badge,
.gc-dry-run-modern__section-pill {
  color: var(--gc-color-text);
  background: var(--gc-color-surface-glass);
  border: var(--gc-border-width-default) solid var(--gc-color-border-strong);
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
  font-size: var(--gc-font-size-sm);
}

.gc-dry-run-modern__hero-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gc-space-2);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.gc-dry-run-modern__hero-progress {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: var(--gc-space-2);
}

.gc-dry-run-modern__hero-progress strong {
  font-size: var(--gc-font-size-xl);
  line-height: 1;
}

.gc-dry-run-modern__hero-progress span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-label);
}

.gc-dry-run-modern__progress-track {
  width: 100%;
  height: var(--gc-size-progress);
  border-radius: var(--gc-radius-full);
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
  gap: var(--gc-space-2);
  margin: 0;
}

.gc-dry-run-modern__metrics div {
  display: grid;
  gap: var(--gc-border-width-thick);
  padding: var(--gc-space-control) var(--gc-space-3);
  border-radius: var(--gc-radius-control);
  background: var(--gc-color-surface);
  border: var(--gc-border-width-default) solid var(--gc-color-muted-bg);
}

.gc-dry-run-modern__metrics dt {
  font-size: var(--gc-font-size-xs);
  color: var(--gc-color-text-muted);
  font-weight: 700;
}

.gc-dry-run-modern__metrics dd {
  margin: 0;
  font-size: var(--gc-font-size-lg);
  font-weight: 850;
}

.gc-dry-run-modern__layout {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-4);
  align-items: start;
}

.gc-dry-run-modern__tasks,
.gc-dry-run-modern__events {
  display: grid;
  gap: var(--gc-space-panel);
}

.gc-dry-run-modern__aside {
  display: grid;
  gap: var(--gc-space-4);
}

.gc-dry-run-modern__activity {
  display: grid;
  gap: var(--gc-space-panel);
}

.gc-dry-run-modern__section-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--gc-space-3);
  flex-wrap: wrap;
}

.gc-dry-run-modern__task-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--gc-space-control);
}

.gc-dry-run-modern__task {
  display: grid;
  grid-template-columns: var(--gc-space-6) minmax(0, 1fr);
  gap: var(--gc-space-control);
}

.gc-dry-run-modern__task-rail {
  display: grid;
  justify-items: center;
  grid-template-rows: auto 1fr;
  gap: var(--gc-space-compact);
}

.gc-dry-run-modern__task-dot {
  display: inline-grid;
  place-items: center;
  width: var(--gc-space-5);
  height: var(--gc-space-5);
  border-radius: var(--gc-radius-full);
  background: var(--gc-color-muted-bg);
  color: var(--gc-color-text);
  font-weight: 800;
  font-size: var(--gc-font-size-caption);
}

.gc-dry-run-modern__task-line {
  width: var(--gc-border-width-thick);
  min-height: var(--gc-space-7);
  background: var(--gc-color-border-strong);
}

.gc-dry-run-modern__task-card {
  display: grid;
  gap: var(--gc-space-compact);
  padding: var(--gc-space-3) var(--gc-space-panel);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-control);
  background: var(--gc-color-surface-solid);
  box-shadow: var(--gc-shadow-sm);
  transition: border-color 180ms ease, background 180ms ease, box-shadow 180ms ease, transform 180ms ease;
}

.gc-dry-run-modern__task[data-active='true'] .gc-dry-run-modern__task-card {
  border-color: var(--gc-color-primary-border-strong);
  background: var(--gc-color-primary-soft);
  box-shadow: var(--gc-shadow-hover);
  transform: translateY(calc(var(--gc-space-hairline) * -1));
}

.gc-dry-run-modern__task[data-status='passed'] .gc-dry-run-modern__task-dot {
  color: var(--gc-color-surface-solid);
  background: var(--gc-color-success);
}

.gc-dry-run-modern__task[data-status='running'] .gc-dry-run-modern__task-dot {
  color: var(--gc-color-surface-solid);
  background: var(--gc-color-info);
  box-shadow: var(--gc-shadow-focus);
}

.gc-dry-run-modern__task[data-status='warning'] .gc-dry-run-modern__task-dot {
  color: var(--gc-color-surface-solid);
  background: var(--gc-color-warning);
}

.gc-dry-run-modern__task[data-status='failed'] .gc-dry-run-modern__task-dot {
  color: var(--gc-color-surface-solid);
  background: var(--gc-color-danger);
}

.gc-dry-run-modern__task[data-status='skipped'] .gc-dry-run-modern__task-dot {
  color: var(--gc-color-text-muted);
  background: var(--gc-color-muted-bg);
}

.gc-dry-run-modern__task[data-status='passed'] .gc-dry-run-modern__task-line {
  background: var(--gc-color-success-border);
}

.gc-dry-run-modern__task[data-status='running'] .gc-dry-run-modern__task-badge {
  color: var(--gc-color-info);
  background: var(--gc-color-info-soft);
}

.gc-dry-run-modern__task[data-status='passed'] .gc-dry-run-modern__task-badge {
  color: var(--gc-color-success);
  background: var(--gc-color-success-soft);
}

.gc-dry-run-modern__task[data-status='failed'] .gc-dry-run-modern__task-badge {
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-soft);
}

.gc-dry-run-modern__task[data-status='skipped'] .gc-dry-run-modern__task-badge {
  color: var(--gc-color-text-muted);
  background: var(--gc-color-muted-bg);
}

.gc-dry-run-modern__task-head {
  display: flex;
  justify-content: space-between;
  gap: var(--gc-space-3);
  align-items: flex-start;
  flex-wrap: wrap;
}

.gc-dry-run-modern__task-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gc-space-2);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.gc-dry-run-modern__event-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--gc-space-control);
}

.gc-dry-run-modern__event-list li {
  display: grid;
  gap: var(--gc-space-1);
  padding: var(--gc-space-3) var(--gc-space-panel);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-control);
}

.gc-dry-run-modern__event-preview {
  display: grid;
  gap: var(--gc-space-1);
  padding: var(--gc-space-3) var(--gc-space-panel);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-control);
  background: var(--gc-color-surface-soft);
}

.gc-dry-run-modern__event-request {
  justify-self: start;
  border: 0;
  background: transparent;
  color: var(--gc-color-text-muted);
  padding: 0;
  font-size: var(--gc-font-size-xs);
}

.gc-dry-run-modern__feed-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--gc-space-control);
  max-height: 60vh;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.gc-dry-run-modern__feed-item {
  display: grid;
  grid-template-columns: var(--gc-space-7) minmax(0, 1fr);
  gap: var(--gc-space-control);
  align-items: start;
  padding: var(--gc-space-3) var(--gc-space-panel);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-control);
  background: var(--gc-color-surface-solid);
}

.gc-dry-run-modern__feed-icon {
  display: inline-grid;
  place-items: center;
  width: var(--gc-size-icon-lg);
  height: var(--gc-size-icon-lg);
  border-radius: var(--gc-radius-full);
  font-size: var(--gc-font-size-label);
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

.gc-dry-run-modern__feed-item[data-status='skipped'] .gc-dry-run-modern__feed-icon {
  color: var(--gc-color-text-muted);
  background: var(--gc-color-muted-bg);
}

.gc-dry-run-modern__feed-copy {
  display: grid;
  gap: var(--gc-space-1);
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

@media (max-width: 60rem) {
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
