<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { getAutomationRun, listAutomationRunTargets, retryAutomationRun, stopAutomationRun, type AutomationRunRecord, type AutomationRunTargetRecord } from '@/api/modules/automations.api'
import { GcPageHeader, GcStatusTag } from '@/design-system/components'
import { listTasks, type TaskRun, type TaskStatus } from '@/api/modules/tasks.api'
import { formatMaybeLocalTime } from '@/utils/browser-local-time'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const run = ref<(AutomationRunRecord & { actionResults: unknown[] }) | null>(null)
const targets = ref<AutomationRunTargetRecord[]>([])
const planTasks = ref<Record<string, TaskRun[]>>({})
const runId = computed(() => String(route.params.id))
const DEPLOYMENT_EXECUTION_TASK_TYPES = new Set(['CERTIFICATE_DRY_RUN', 'CERTIFICATE_DEPLOY', 'CERTIFICATE_ROLLBACK'])

async function load() {
  const [runRecord, targetRecords] = await Promise.all([
    getAutomationRun(runId.value),
    listAutomationRunTargets(runId.value),
  ])
  run.value = runRecord
  targets.value = targetRecords
  planTasks.value = await loadPlanTasks(targetRecords)
}

async function stop() {
  await stopAutomationRun(runId.value)
  await load()
}

async function retry() {
  const next = await retryAutomationRun(runId.value)
  await router.push(`/automation-runs/${next.id}`)
}

async function loadPlanTasks(targetRecords: readonly AutomationRunTargetRecord[]): Promise<Record<string, TaskRun[]>> {
  const planIds = [...new Set(targetRecords.map((target) => target.deploymentPlanId).filter((planId): planId is string => Boolean(planId)))]
  const entries = await Promise.all(planIds.map(async (planId) => {
    const result = await listTasks({
      page: 1,
      pageSize: 20,
      filters: { resourceType: 'deploymentPlan', resourceId: planId },
      includeAll: true,
    })
    const items = (result.data?.items ?? [])
      .filter((task) => DEPLOYMENT_EXECUTION_TASK_TYPES.has(task.taskType))
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    return [planId, items] as const
  }))
  return Object.fromEntries(entries)
}

function runProgressPercent(record: AutomationRunRecord | null): number {
  if (!record) return 0
  const total = Number(record.targetSummary.total ?? 0)
  if (total <= 0) return ['succeeded', 'partially_succeeded', 'failed', 'needs_attention', 'stopped', 'cancelled'].includes(record.status) ? 100 : 0
  const completed = Number(record.targetSummary.succeeded ?? 0)
    + Number(record.targetSummary.failed ?? 0)
    + Number(record.targetSummary.skipped ?? 0)
    + Number(record.targetSummary.cancelled ?? 0)
  if (completed >= total) return 100
  return Math.max(record.status === 'waiting_approval' ? 15 : 5, Math.round((completed / total) * 100))
}

function taskTypeLabel(task: TaskRun): string {
  const key = `tasks.typeLabels.${task.taskType}`
  const label = t(key)
  return label === key ? t('tasks.typeLabels.OTHER') : label
}

function taskStatusLabel(status: TaskStatus): string {
  return t(`tasks.status.${status}`)
}

function taskStatusSummary(task: TaskRun): string {
  const summary = firstNonEmptyString(
    stringFromRecord(task.progress, 'summary'),
    stringFromRecord(task.progress, 'message'),
    task.lastErrorMessage,
  )
  return summary ? `${taskStatusLabel(task.status)} · ${summary}` : taskStatusLabel(task.status)
}

function taskProgressPercent(task: TaskRun): number {
  const explicit = firstFiniteNumber(
    recordNumberByKeys(task.progress, ['percent', 'percentage', 'progressPercent', 'progress', 'completedPercent']),
    recordNumberByKeys(task.resourceSummary, ['percent', 'percentage', 'progressPercent', 'progress', 'completedPercent']),
  )
  if (explicit !== undefined) return clampPercent(explicit <= 1 ? explicit * 100 : explicit)
  if (task.status === 'SUCCEEDED' || task.status === 'FAILED' || task.status === 'CANCELLED') return 100
  if (task.status === 'RUNNING') return 35
  return 0
}

function targetTasks(target: AutomationRunTargetRecord): TaskRun[] {
  return target.deploymentPlanId ? (planTasks.value[target.deploymentPlanId] ?? []) : []
}

function automationActionLabel(actionType?: string): string {
  if (actionType === 'create_deployment_plan') return t('automations.editor.chain.createPlan')
  if (actionType === 'execute_deployment_plan') return t('automations.editor.chain.executePlan')
  if (actionType === 'send_notification') return t('reports.groups.values.send_notification')
  return t('common.notAvailable')
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

function recordNumberByKeys(record: Record<string, unknown> | undefined, keys: readonly string[]): number | undefined {
  if (!record) return undefined
  for (const key of keys) {
    const value = record[key]
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
    if (Number.isFinite(number)) return number
  }
  return undefined
}

function firstFiniteNumber(...values: Array<number | undefined>): number | undefined {
  return values.find((value): value is number => typeof value === 'number' && Number.isFinite(value))
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

onMounted(load)
</script>

<template>
  <section v-if="run" class="run-detail">
    <GcPageHeader :title="run.automationNameSnapshot" :description="t('automations.runDetail.description', { version: run.automationVersion })">
      <template #actions>
        <button class="gc-button" type="button" @click="stop">{{ t('automations.actions.stop') }}</button>
        <button class="gc-button gc-button--primary" type="button" @click="retry">{{ t('automations.actions.retryFailed') }}</button>
      </template>
    </GcPageHeader>

    <section class="run-detail__hero" :aria-label="t('automations.aria.progress')">
      <div class="run-detail__hero-head">
        <GcStatusTag :status="run.status" />
        <strong>{{ run.targetSummary.succeeded || 0 }}/{{ run.targetSummary.total || 0 }}</strong>
      </div>
      <div class="run-detail__progress" :style="{ '--automation-progress': `${runProgressPercent(run)}%` }">
        <span />
      </div>
    </section>

    <section class="run-detail__summary" :aria-label="t('automations.aria.progress')">
      <div v-for="key in ['total', 'pending', 'running', 'waitingApproval', 'succeeded', 'failed', 'skipped', 'cancelled']" :key="key">
        <span>{{ t(`automations.progress.${key}`) }}</span>
        <strong>{{ run.targetSummary[key] || 0 }}</strong>
      </div>
    </section>

    <dl class="run-detail__facts">
      <div><dt>{{ t('automations.fields.startedAt') }}</dt><dd>{{ formatMaybeLocalTime(run.startedAt, t('automations.common.notAvailable')) }}</dd></div>
      <div><dt>{{ t('automations.fields.finishedAt') }}</dt><dd>{{ formatMaybeLocalTime(run.finishedAt, t('automations.common.notAvailable')) }}</dd></div>
      <div><dt>{{ t('automations.fields.failureStage') }}</dt><dd>{{ run.failureStage ? t(`automations.failureStages.${run.failureStage}`) : t('automations.common.notAvailable') }}</dd></div>
      <div><dt>{{ t('automations.fields.parentRun') }}</dt><dd>{{ run.parentRunId || t('automations.common.notAvailable') }}</dd></div>
      <div><dt>{{ t('automations.runDetail.sourceType') }}</dt><dd>{{ run.triggerContext?.sourceType || t('automations.common.notAvailable') }}</dd></div>
      <div><dt>{{ t('automations.runDetail.certificateVersion') }}</dt><dd>{{ run.triggerContext?.certificateVersionId || t('automations.common.notAvailable') }}</dd></div>
      <div><dt>{{ t('automations.runDetail.approvalId') }}</dt><dd>{{ run.approvalId || t('automations.common.notAvailable') }}</dd></div>
      <div><dt>{{ t('automations.runDetail.deliveryId') }}</dt><dd>{{ run.deliveryId || t('automations.common.notAvailable') }}</dd></div>
    </dl>

    <section v-if="run.triggerContext" class="run-detail__event">
      <h3>{{ t('automations.runDetail.triggerContext') }}</h3>
      <p>{{ run.triggerContext.eventType || t('automations.common.notAvailable') }} · {{ formatMaybeLocalTime(run.triggerContext.occurredAt, t('automations.common.notAvailable')) }}</p>
      <p>{{ (run.triggerContext.domains || []).join(', ') || t('automations.common.notAvailable') }}</p>
      <p>{{ t('automations.runDetail.excludedReasons') }}: {{ JSON.stringify(run.triggerContext.excludedReasons || {}) }}</p>
    </section>

    <div class="run-targets">
      <article v-for="target in targets" :key="target.id">
        <header>
          <div class="run-targets__title">
            <strong>{{ target.targetSnapshot.assetName || target.targetSnapshot.certificateName }}</strong>
            <span>{{ target.targetSnapshot.certificateName }} · {{ target.targetSnapshot.environment || t('automations.common.notAvailable') }}</span>
          </div>
          <GcStatusTag :status="target.status" />
        </header>
        <p>{{ target.currentAction ? automationActionLabel(target.currentAction) : t('automations.common.notAvailable') }}</p>
        <p>{{ target.failureStage ? t(`automations.failureStages.${target.failureStage}`) : t('automations.runDetail.noFailure') }}</p>
        <p v-if="target.errorCode">{{ target.errorCode }} · {{ target.errorMessage }}</p>

        <section v-if="targetTasks(target).length > 0" class="run-targets__tasks">
          <h4>{{ t('deploymentPlans.links.executions') }}</h4>
          <article v-for="task in targetTasks(target)" :key="task.id" class="run-targets__task">
            <div class="run-targets__task-head">
              <div>
                <strong>{{ taskTypeLabel(task) }}</strong>
                <p>{{ taskStatusSummary(task) }}</p>
              </div>
              <GcStatusTag :status="task.status" />
            </div>
            <div class="run-targets__task-progress" :style="{ '--automation-progress': `${taskProgressPercent(task)}%` }">
              <span />
            </div>
            <small>{{ task.requestedBy || t('tasks.values.system') }} · {{ formatMaybeLocalTime(task.createdAt, t('common.notAvailable')) }}</small>
          </article>
        </section>

        <footer>
          <button v-if="target.deploymentPlanId" class="gc-button" type="button" @click="router.push(`/deployment-plans?id=${target.deploymentPlanId}`)">{{ t('automations.actions.openPlan') }}</button>
          <button v-if="target.executionRunId" class="gc-button" type="button" @click="router.push(`/executions?id=${target.executionRunId}`)">{{ t('automations.actions.openExecution') }}</button>
        </footer>
      </article>
    </div>
  </section>
</template>

<style scoped>
.run-detail,
.run-targets {
  display: grid;
  gap: var(--gc-space-4);
}

.run-detail__hero {
  display: grid;
  gap: var(--gc-space-3);
  padding: var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
  border-radius: var(--gc-radius-lg);
  background: var(--gc-color-surface-raised);
}

.run-detail__hero-head,
.run-targets header,
.run-targets footer,
.run-targets__task-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-3);
  flex-wrap: wrap;
}

.run-detail__progress,
.run-targets__task-progress {
  position: relative;
  height: var(--gc-space-2);
  overflow: hidden;
  border-radius: var(--gc-radius-pill);
  background: var(--gc-color-surface-muted);
}

.run-detail__progress span,
.run-targets__task-progress span {
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  width: var(--automation-progress, 0%);
  border-radius: inherit;
  background: var(--gc-color-primary);
}

.run-detail__summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(calc(var(--gc-space-10) * 2), 1fr));
  gap: var(--gc-space-3);
}

.run-detail__summary div {
  display: grid;
  gap: var(--gc-space-1);
  padding: var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-solid);
}

.run-detail__summary span,
.run-targets__title span,
.run-targets p,
.run-targets small {
  color: var(--gc-color-text-muted);
}

.run-detail__summary strong {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-xl);
}

.run-detail__facts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--gc-space-3);
  margin: 0;
}

.run-detail__facts div,
.run-detail__event,
.run-targets > article,
.run-targets__task {
  padding: var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-raised);
}

.run-detail__facts dt,
.run-targets p {
  color: var(--gc-color-text-muted);
}

.run-detail__facts dd {
  margin: var(--gc-space-1) 0 0;
  color: var(--gc-color-text);
}

.run-detail__event,
.run-targets > article,
.run-targets__tasks {
  display: grid;
  gap: var(--gc-space-2);
}

.run-detail__event h3,
.run-detail__event p,
.run-targets p,
.run-targets__task p,
.run-targets__tasks h4 {
  margin: 0;
}

.run-targets__title {
  display: grid;
  gap: var(--gc-space-1);
}

@media (max-width: 960px) {
  .run-detail__facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .run-detail__facts {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
