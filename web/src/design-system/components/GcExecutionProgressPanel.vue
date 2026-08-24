<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { ApiRecord } from '@/api/modules/common'
import type { ExecutionLogLine, ExecutionStepLine } from './GcExecutionLogViewer.vue'
import GcDryRunChecklist from './GcDryRunChecklist.vue'
import GcExecutionLogViewer from './GcExecutionLogViewer.vue'

const TASK_REVEAL_INTERVAL_MS = 2000

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

const revealedTaskCount = ref(0)
const eventsExpanded = ref(false)
const logExpanded = ref(false)
let revealTimer: ReturnType<typeof setTimeout> | null = null

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
const allTasksRevealed = computed(() => revealedTaskCount.value >= rawTasks.value.length)

const isDryRunMode = computed(() => props.mode === 'dry-run')
const processLabel = computed(() => isDryRunMode.value ? 'Dry-run' : '执行')

const heroState = computed<SummaryState>(() => {
  if (props.error) return 'failed'
  return props.summary?.state ?? inferStateFromTasks(rawTasks.value)
})
const displayState = computed<SummaryState>(() => {
  if (props.error) return 'failed'
  if (!allTasksRevealed.value && ['passed', 'warning', 'failed'].includes(heroState.value)) return 'running'
  return heroState.value
})
const displayCounts = computed(() => ({
  total: counts.value.total,
  completed: revealedCounts.value.completed,
  running: revealedCounts.value.running,
  queued: Math.max(counts.value.total - revealedCounts.value.completed - revealedCounts.value.running, 0),
}))

const heroDetail = computed(() => {
  if (props.error) return props.error
  if (!allTasksRevealed.value && counts.value.total > 0) {
    return `${displayCounts.value.completed}/${Math.max(displayCounts.value.total, 1)} 步骤已完成`
  }
  if (props.summary) {
    const total = props.summary.passed + props.summary.warning + props.summary.failed + props.summary.unknown
    if (props.summary.state === 'passed') return `${props.summary.passed} 项检查通过`
    if (props.summary.state === 'warning') return `${total} 项已完成，${props.summary.warning} 项警告`
    if (props.summary.state === 'failed') return `${total} 项已完成，${props.summary.failed} 项失败`
    if (props.summary.state === 'running') return `${displayCounts.value.completed}/${Math.max(displayCounts.value.total, 1)} 步骤已完成`
    if (props.summary.state === 'queued') return '等待任务开始执行'
    return `${total} 项检查结果已返回`
  }
  if (counts.value.total === 0) return '等待后端返回执行步骤'
  return `${displayCounts.value.completed}/${Math.max(displayCounts.value.total, 1)} 步骤已完成`
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
  if (props.error) return `${processLabel.value}失败`
  if (displayState.value === 'queued') return '等待调度'
  if (displayState.value === 'running') return '任务推进中'
  if (displayState.value === 'pending') return '等待结果回写'
  if (displayState.value === 'warning') return '已完成，存在风险提示'
  if (displayState.value === 'failed') return '已完成，存在失败项'
  return '全部完成'
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

const visibleTasks = computed(() => {
  const limit = Math.min(revealedTaskCount.value, rawTasks.value.length)
  return rawTasks.value.slice(0, Math.max(limit, 1))
})
const revealedCounts = computed(() => {
  const tasks = visibleTasks.value
  return {
    total: tasks.length,
    completed: tasks.filter((task) => ['passed', 'warning', 'failed'].includes(task.status)).length,
    running: tasks.filter((task) => task.status === 'running').length,
    queued: tasks.filter((task) => task.status === 'queued').length,
  }
})

const recentEvents = computed(() => (props.lines ?? []).slice(-8).reverse())
const latestEvent = computed(() => recentEvents.value[0] ?? null)
const completionFeed = computed<ExecutionFeedItem[]>(() => visibleTasks.value
  .filter((task) => ['passed', 'warning', 'failed'].includes(task.status))
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
      { label: '通过', value: String(summary.passed) },
      { label: '警告', value: String(summary.warning) },
      { label: '失败', value: String(summary.failed) },
      { label: '未知', value: String(summary.unknown) },
    ]
  }
  return [
    { label: '总任务', value: String(Math.max(displayCounts.value.total, 1)) },
    { label: '已完成', value: String(displayCounts.value.completed) },
    { label: '执行中', value: String(displayCounts.value.running) },
    { label: '排队中', value: String(displayCounts.value.queued) },
  ]
})

watch(() => [props.revealOnMount, rawTasks.value.length] as const, ([revealOnMount]) => {
  if (!revealOnMount) {
    clearRevealTimer()
    revealedTaskCount.value = rawTasks.value.length
    return
  }
  scheduleReveal()
}, { immediate: true })

watch(rawTasks, () => {
  if (!props.revealOnMount) {
    revealedTaskCount.value = rawTasks.value.length
    return
  }
  scheduleReveal()
}, { deep: true })

onBeforeUnmount(() => clearRevealTimer())

function clearRevealTimer() {
  if (!revealTimer) return
  clearTimeout(revealTimer)
  revealTimer = null
}

function scheduleReveal() {
  clearRevealTimer()
  const total = rawTasks.value.length
  if (total === 0) {
    revealedTaskCount.value = 0
    return
  }
  if (revealedTaskCount.value === 0) {
    revealedTaskCount.value = 1
  }
  if (revealedTaskCount.value >= total) return
  revealTimer = setTimeout(() => {
    revealedTaskCount.value = Math.min(total, revealedTaskCount.value + 1)
    scheduleReveal()
  }, TASK_REVEAL_INTERVAL_MS)
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
    return { title: normalized || '任务事件', detail: normalized || '等待事件回传' }
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
  if (upper.startsWith('DISCOVER')) return '环境识别'
  if (upper.startsWith('VERIFY')) return '结果校验'
  if (upper.startsWith('BACKUP')) return '前置备份'
  if (upper.startsWith('INSTALL')) return mode === 'execution' ? '证书安装' : '材料加载'
  if (upper.startsWith('RELOAD')) return '服务刷新'
  return name
}

function defaultSubtitle(status: TaskStatus): string {
  if (status === 'running') return '任务已开始，等待后续结果回传。'
  if (status === 'queued') return '任务已创建，等待执行。'
  if (status === 'failed') return '任务已结束，但返回了失败结果。'
  return '任务已完成。'
}

function buildTaskSubtitle(
  status: TaskStatus,
  checks: Array<{ id: string; label: string; detail: string; status: CheckStatus }>,
  detail?: string,
): string {
  if (checks.length > 0) {
    const summary = countCheckStatuses(checks)
    const total = summary.passed + summary.warning + summary.failed + summary.unknown
    if (summary.failed > 0) return `${total} 项检查，${summary.failed} 项失败`
    if (summary.warning > 0) return `${total} 项检查，${summary.warning} 项警告`
    if (status === 'running') return `已回传 ${total} 项检查`
    return `${total} 项检查通过`
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
  return startedAt || finishedAt || '等待开始'
}

function taskTitleKey(task: VisibleTask): string {
  const step = (props.steps ?? []).find((item) => item.id === task.id)
  return step?.name ?? task.title
}

function statusBadgeText(status: TaskStatus): string {
  if (status === 'queued') return '等待中'
  if (status === 'running') return '执行中'
  if (status === 'warning') return '有警告'
  if (status === 'failed') return '失败'
  return '已完成'
}

function taskDotText(status: TaskStatus): string {
  if (status === 'queued') return '○'
  if (status === 'running') return '◐'
  if (status === 'failed' || status === 'warning') return '!'
  return '✓'
}

function feedStatusText(status: TaskStatus): string {
  if (status === 'failed') return '执行失败'
  if (status === 'warning') return '完成，带警告'
  return '执行完成'
}
</script>

<template>
  <section class="gc-dry-run-modern">
    <p v-if="error" class="gc-dry-run-modern__error">{{ error }}</p>

    <section class="gc-dry-run-modern__hero" :data-state="displayState" aria-label="执行进度总览">
      <div class="gc-dry-run-modern__hero-copy">
        <div class="gc-dry-run-modern__hero-head">
          <strong>{{ progressLabel }}</strong>
          <span class="gc-dry-run-modern__hero-badge">{{ heroBadgeLabel }}</span>
        </div>
        <p>{{ heroDetail }}</p>
        <div class="gc-dry-run-modern__hero-meta">
          <span v-if="loading">刷新中</span>
          <span v-if="polling">自动刷新兜底中</span>
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
      <section class="gc-card gc-dry-run-modern__tasks" aria-label="任务列表">
        <header class="gc-dry-run-modern__section-head">
          <div>
            <strong>任务进度</strong>
          </div>
          <span class="gc-dry-run-modern__section-pill">
            {{ displayCounts.completed }}/{{ displayCounts.total || 1 }} 已完成
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

        <p v-else class="gc-dry-run-modern__empty">任务尚未创建，等待后端返回执行步骤。</p>

        <section v-if="isDryRunMode" class="gc-card gc-dry-run-modern__events" aria-label="最新事件">
          <header class="gc-dry-run-modern__section-head">
            <div>
              <strong>最新事件</strong>
            </div>
            <button class="gc-button" type="button" @click="eventsExpanded = !eventsExpanded">
              {{ eventsExpanded ? '收起事件' : '展开事件' }}
            </button>
          </header>

          <ul v-if="recentEvents.length && eventsExpanded" class="gc-dry-run-modern__event-list">
            <li v-for="line in recentEvents" :key="line.id" :data-level="line.level">
              <small>{{ line.time }}</small>
              <strong>{{ line.step || '事件' }}</strong>
              <span>{{ line.message }}</span>
            </li>
          </ul>
          <article v-else-if="latestEvent" class="gc-dry-run-modern__event-preview" :data-level="latestEvent.level">
            <small>{{ latestEvent.time }}</small>
            <strong>{{ latestEvent.step || '事件' }}</strong>
            <span>{{ latestEvent.message }}</span>
          </article>
          <p v-else class="gc-dry-run-modern__empty">还没有事件回传。</p>

          <button
            v-if="requestId"
            class="gc-dry-run-modern__event-request"
            type="button"
            :title="requestId"
            @click="logExpanded = !logExpanded"
          >
            {{ logExpanded ? '收起完整日志' : '查看完整日志' }}
          </button>
        </section>
      </section>

      <aside class="gc-dry-run-modern__aside">
        <section v-if="!isDryRunMode" class="gc-card gc-dry-run-modern__activity" aria-label="执行日志">
          <header class="gc-dry-run-modern__section-head">
            <div>
              <strong>执行日志</strong>
            </div>
            <button
              v-if="requestId"
              class="gc-button"
              type="button"
              @click="logExpanded = !logExpanded"
            >
              {{ logExpanded ? '收起完整日志' : '查看完整日志' }}
            </button>
          </header>

          <ul v-if="completionFeed.length" class="gc-dry-run-modern__feed-list">
            <li v-for="item in completionFeed" :key="item.id" class="gc-dry-run-modern__feed-item" :data-status="item.status">
              <span class="gc-dry-run-modern__feed-icon" aria-hidden="true">
                {{ item.status === 'failed' ? '!' : item.status === 'warning' ? '!' : '✓' }}
              </span>
              <div class="gc-dry-run-modern__feed-copy">
                <strong>{{ item.title }}</strong>
                <span>{{ item.detail }}</span>
                <small>{{ item.timeLabel }} · {{ feedStatusText(item.status) }}</small>
              </div>
            </li>
          </ul>
          <p v-else class="gc-dry-run-modern__empty">等待任务完成后逐条写入执行日志。</p>
        </section>

        <GcDryRunChecklist
          v-else-if="showChecklist"
          :items="checks ?? []"
          title="检查结论"
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
  border: 1px solid #fecaca;
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
    linear-gradient(135deg, rgb(255 255 255 / 96%), rgb(248 250 252 / 92%)),
    linear-gradient(120deg, #dbeafe, #dcfce7);
}

.gc-dry-run-modern__hero[data-state='failed'] {
  background:
    linear-gradient(135deg, rgb(255 255 255 / 96%), rgb(254 242 242 / 92%)),
    linear-gradient(120deg, #fecaca, #fee2e2);
}

.gc-dry-run-modern__hero[data-state='warning'] {
  background:
    linear-gradient(135deg, rgb(255 255 255 / 96%), rgb(255 251 235 / 92%)),
    linear-gradient(120deg, #fde68a, #fef3c7);
}

.gc-dry-run-modern__hero[data-state='queued'],
.gc-dry-run-modern__hero[data-state='running'],
.gc-dry-run-modern__hero[data-state='pending'] {
  background:
    linear-gradient(135deg, rgb(255 255 255 / 96%), rgb(239 246 255 / 92%)),
    linear-gradient(120deg, #bfdbfe, #dbeafe);
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
  color: #0f172a;
  background: rgb(255 255 255 / 74%);
  border: 1px solid rgb(148 163 184 / 28%);
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
  background: rgb(148 163 184 / 18%);
  overflow: hidden;
}

.gc-dry-run-modern__progress-track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #0f172a, #2563eb 55%, #10b981);
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
  background: rgb(255 255 255 / 78%);
  border: 1px solid rgb(148 163 184 / 18%);
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
  background: #e2e8f0;
  color: #0f172a;
  font-weight: 800;
  font-size: 11px;
}

.gc-dry-run-modern__task-line {
  width: 2px;
  min-height: 28px;
  background: #cbd5e1;
}

.gc-dry-run-modern__task-card {
  display: grid;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid var(--gc-color-border);
  border-radius: 8px;
  background: #fff;
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
}

.gc-dry-run-modern__feed-item {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  padding: 12px 14px;
  border: 1px solid var(--gc-color-border);
  border-radius: 8px;
  background: #fff;
}

.gc-dry-run-modern__feed-icon {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 900;
  color: #fff;
  background: #22c55e;
}

.gc-dry-run-modern__feed-item[data-status='warning'] .gc-dry-run-modern__feed-icon {
  background: #f59e0b;
}

.gc-dry-run-modern__feed-item[data-status='failed'] .gc-dry-run-modern__feed-icon {
  background: #ef4444;
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
