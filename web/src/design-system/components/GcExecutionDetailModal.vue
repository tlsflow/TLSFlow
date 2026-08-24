<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ExecutionDetailStep, ExecutionDryRunSummary } from '@/composables/useExecutionDetail'
import { readString, type ViewRow } from '@/composables/useBusinessPage'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import type { ExecutionLogLine } from './GcExecutionLogViewer.vue'
import GcModal from './GcModal.vue'
import GcStatusTag from './GcStatusTag.vue'

export interface ExecutionDetailModalRow extends ViewRow {
  readonly planName?: string
  readonly assetNames?: readonly string[]
  readonly targetLabel?: string
  readonly runTypeLabel?: string
  readonly sourceLabel?: string
}

const props = withDefaults(defineProps<{
  open: boolean
  row?: ExecutionDetailModalRow | null
  summary?: ExecutionDryRunSummary | null
  steps?: readonly ExecutionDetailStep[]
  lines?: readonly ExecutionLogLine[]
  targetLabel?: string
  startedAt?: string
  finishedAt?: string
  loading?: boolean
  error?: string
  canRecoverUnknownResult?: boolean
  recoveringUnknownResult?: boolean
}>(), {
  row: null,
  summary: null,
  steps: () => [],
  lines: () => [],
  targetLabel: '',
  startedAt: '',
  finishedAt: '',
  loading: false,
  error: '',
  canRecoverUnknownResult: false,
  recoveringUnknownResult: false,
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  recover: []
}>()

const { t } = useI18n()
const activeTab = ref<'summary' | 'steps' | 'logs'>('summary')

const modalTitle = computed(() => props.row
  ? t('executions.detail.titleWithId', { id: props.row.id })
  : t('executions.detail.title'))

const planName = computed(() => {
  const row = props.row
  if (!row) return t('common.notAvailable')
  return row.planName || readString(row.raw, ['planName', 'deploymentPlanName', 'name'], row.name || row.id)
})

const sourceLabel = computed(() => {
  const row = props.row
  if (!row) return t('common.notAvailable')
  return row.sourceLabel || readString(row.raw, ['sourceLabel', 'source', 'triggerSource'], t('tasks.values.system'))
})

const targetLabel = computed(() => {
  const row = props.row
  if (!row) return t('common.notAvailable')
  if (props.targetLabel) return props.targetLabel
  if (row.targetLabel) return row.targetLabel
  if (row.assetNames?.length) return row.assetNames.join(', ')
  return readString(row.raw, ['assetNames', 'targetSummary', 'executionTargetName', 'targetName', 'target'], t('common.notAvailable'))
})

const runTypeLabel = computed(() => {
  const row = props.row
  if (!row) return t('executions.types.unknown')
  if (row.runTypeLabel) return row.runTypeLabel
  const type = readString(row.raw, ['type', 'runType', 'executionType'], '').trim().toLowerCase()
  if (type === 'dry_run' || type === 'dry-run') return t('executions.types.dryRun')
  if (type === 'rollback') return t('executions.types.rollback')
  if (type === 'retry') return t('executions.types.retry')
  if (type === 'apply' || type === 'execution') return t('executions.types.apply')
  return t('executions.types.unknown')
})

const modalSummaryCards = computed(() => {
  const summary = props.summary
  if (!summary) return []
  return [
    { label: t('executions.summary.passed'), value: summary.passed },
    { label: t('executions.summary.warning'), value: summary.warning },
    { label: t('executions.summary.failed'), value: summary.failed },
    { label: t('executions.summary.unknown'), value: summary.unknown },
  ]
})

const resolvedStartedAt = computed(() => props.startedAt
  || rawValue(['startedAt', 'latestRun.startedAt', 'run.startedAt'], '')
  || selectStepTime('startedAt')
  || rawValue(['createdAt'], ''))
const resolvedFinishedAt = computed(() => props.finishedAt
  || rawValue(['finishedAt', 'latestRun.finishedAt', 'run.finishedAt'], '')
  || selectStepTime('finishedAt')
  || rawValue(['updatedAt'], ''))

watch([() => props.open, () => props.row?.id], ([opened]) => {
  if (opened) activeTab.value = 'summary'
})

function closeModal(): void {
  emit('update:open', false)
}

function formatDetailTime(value: unknown): string {
  return formatBrowserLocalTime(value) || t('common.notAvailable')
}

function formatStepStartTime(value: unknown): string {
  return formatBrowserLocalTime(value) || t('executions.detail.notStarted')
}

function formatLogTime(value: unknown): string {
  return formatBrowserLocalTime(value) || String(value ?? '')
}

function selectStepTime(side: 'startedAt' | 'finishedAt'): string {
  const values = props.steps
    .map((step) => step[side])
    .filter((value): value is string => Boolean(value))
  const parsed = values
    .map((value) => ({ value, time: Date.parse(value) }))
    .filter((item) => Number.isFinite(item.time))
  if (parsed.length === 0) return ''
  return parsed.reduce((selected, current) => (
    side === 'startedAt'
      ? current.time < selected.time ? current : selected
      : current.time > selected.time ? current : selected
  )).value
}

function rawValue(candidates: readonly string[], fallback = t('common.notAvailable')): string {
  return props.row ? readString(props.row.raw, candidates, fallback) : fallback
}
</script>

<template>
  <GcModal
    :open="open"
    :title="modalTitle"
    :description="t('executions.detail.description')"
    size="xxl"
    @update:open="emit('update:open', $event)"
  >
    <section v-if="row" class="execution-detail-modal">
      <section class="execution-detail-modal__hero">
        <div class="execution-detail-modal__hero-copy">
          <p class="execution-detail-modal__eyebrow">{{ t('executions.detail.eyebrow') }}</p>
          <h2>{{ planName }}</h2>
          <span>{{ row.id }}</span>
        </div>
        <div class="execution-detail-modal__hero-side">
          <GcStatusTag :status="row.status" />
          <div class="execution-detail-modal__spotlight">
            <small>{{ t('executions.fields.runType') }}</small>
            <strong>{{ runTypeLabel }}</strong>
          </div>
        </div>
      </section>

      <div class="execution-detail-modal__tabs" role="tablist" :aria-label="t('executions.detail.title')">
        <button class="execution-detail-modal__tab" type="button" role="tab" :aria-selected="activeTab === 'summary'" :data-active="activeTab === 'summary'" @click="activeTab = 'summary'">{{ t('executions.tabs.summary') }}</button>
        <button class="execution-detail-modal__tab" type="button" role="tab" :aria-selected="activeTab === 'steps'" :data-active="activeTab === 'steps'" @click="activeTab = 'steps'">{{ t('executions.tabs.steps') }}</button>
        <button class="execution-detail-modal__tab" type="button" role="tab" :aria-selected="activeTab === 'logs'" :data-active="activeTab === 'logs'" @click="activeTab = 'logs'">{{ t('executions.tabs.logs') }}</button>
      </div>

      <section v-if="activeTab === 'summary'" class="execution-detail-modal__section">
        <p v-if="error" class="execution-detail-modal__error-banner" role="alert">{{ error }}</p>
        <article v-if="steps.some((step) => step.unknownResult)" class="execution-detail-modal__unknown" role="status" aria-live="polite">
          <div>
            <strong>{{ t('executionDetail.step.unknownResult') }}</strong>
            <p>{{ t('executions.detail.unknownResultDescription') }}</p>
          </div>
          <button
            v-if="canRecoverUnknownResult"
            class="gc-button gc-button--primary"
            type="button"
            :disabled="recoveringUnknownResult"
            @click="emit('recover')"
          >
            {{ recoveringUnknownResult ? t('executionDetail.recovery.running') : t('executionDetail.recovery.confirm') }}
          </button>
        </article>
        <dl class="execution-detail-modal__facts">
          <div>
            <dt>{{ t('executions.fields.executionId') }}</dt>
            <dd>{{ row.id }}</dd>
          </div>
          <div>
            <dt>{{ t('executions.fields.deploymentPlan') }}</dt>
            <dd>{{ planName }}</dd>
          </div>
          <div>
            <dt>{{ t('tasks.fields.triggerSource') }}</dt>
            <dd>{{ sourceLabel }}</dd>
          </div>
          <div>
            <dt>{{ t('executions.fields.target') }}</dt>
            <dd>{{ targetLabel }}</dd>
          </div>
          <div>
            <dt>{{ t('executions.fields.status') }}</dt>
            <dd>{{ rawValue(['status', 'state', 'result'], row.status) }}</dd>
          </div>
          <div>
            <dt>{{ t('executions.fields.startedAt') }}</dt>
            <dd>{{ formatDetailTime(resolvedStartedAt) }}</dd>
          </div>
          <div>
            <dt>{{ t('executions.fields.finishedAt') }}</dt>
            <dd>{{ formatDetailTime(resolvedFinishedAt) }}</dd>
          </div>
          <div>
            <dt>{{ t('executions.fields.errorCode') }}</dt>
            <dd>{{ rawValue(['errorCode']) }}</dd>
          </div>
          <div>
            <dt>{{ t('executions.fields.failureReason') }}</dt>
            <dd>{{ rawValue(['failureReason', 'errorMessage', 'error.message']) }}</dd>
          </div>
        </dl>

        <article
          v-if="summary"
          class="execution-detail-modal__summary"
          :data-state="summary.state"
        >
          <div class="execution-detail-modal__summary-head">
            <strong>{{ summary.label }}</strong>
            <span>{{ summary.detail }}</span>
          </div>
          <div class="execution-detail-modal__summary-grid">
            <div v-for="item in modalSummaryCards" :key="item.label">
              <small>{{ item.label }}</small>
              <strong>{{ item.value }}</strong>
            </div>
          </div>
        </article>
      </section>

      <section v-else-if="activeTab === 'steps'" class="execution-detail-modal__section">
        <p v-if="loading" class="execution-detail-modal__loading">{{ t('executions.detail.loadingSteps') }}</p>
        <p v-else-if="error" class="execution-detail-modal__error">{{ error }}</p>
        <template v-else>
          <header v-if="steps.some((step) => step.unknownResult)" class="execution-detail-modal__unknown execution-detail-modal__unknown--steps">
            <div>
              <strong>{{ t('executionDetail.step.unknownResult') }}</strong>
              <p>{{ t('executions.detail.unknownResultDescription') }}</p>
            </div>
            <button
              v-if="canRecoverUnknownResult"
              class="gc-button gc-button--primary"
              type="button"
              :disabled="recoveringUnknownResult"
              @click="emit('recover')"
            >
              {{ recoveringUnknownResult ? t('executionDetail.recovery.running') : t('executionDetail.recovery.confirm') }}
            </button>
          </header>
          <ul v-if="steps.length" class="execution-detail-modal__list">
            <li v-for="step in steps" :key="step.id" class="execution-detail-modal__list-item">
              <div class="execution-detail-modal__list-head">
                <strong>{{ step.name }}</strong>
                <GcStatusTag :status="step.status" />
              </div>
              <p>{{ step.detail ?? t('executions.detail.noStepDetail') }}</p>
              <small>{{ formatStepStartTime(step.startedAt) }}{{ step.finishedAt ? ` -> ${formatDetailTime(step.finishedAt)}` : '' }}</small>
              <div v-if="step.diagnostics?.length" class="execution-detail-modal__diagnostics">
                <strong>{{ t('executionDetail.step.diagnosticsTitle') }}</strong>
                <dl>
                  <div v-for="diagnostic in step.diagnostics" :key="`${step.id}-${diagnostic.label}`">
                    <dt>{{ diagnostic.label }}</dt>
                    <dd>{{ diagnostic.value }}</dd>
                  </div>
                </dl>
                <details v-if="step.structuredDetail">
                  <summary>{{ t('executionDetail.step.structuredDetail') }}</summary>
                  <pre>{{ step.structuredDetail }}</pre>
                </details>
              </div>
            </li>
          </ul>
          <p v-else class="execution-detail-modal__loading">{{ t('executions.detail.noSteps') }}</p>
        </template>
      </section>

      <section v-else class="execution-detail-modal__section">
        <p v-if="loading" class="execution-detail-modal__loading">{{ t('executions.detail.loadingLogs') }}</p>
        <p v-else-if="error" class="execution-detail-modal__error">{{ error }}</p>
        <ul v-else-if="lines.length" class="execution-detail-modal__logs">
          <li v-for="line in lines" :key="line.id" class="execution-detail-modal__log-item" :data-level="line.level">
            <div class="execution-detail-modal__log-meta">
              <span>{{ formatLogTime(line.time) }}</span>
              <strong>{{ line.step || t('executions.tabs.logs') }}</strong>
            </div>
            <p>{{ line.message }}</p>
          </li>
        </ul>
        <p v-else class="execution-detail-modal__loading">{{ t('executions.detail.noLogs') }}</p>
      </section>
    </section>
    <p v-else-if="error" class="execution-detail-modal__error-banner" role="alert">{{ error }}</p>

    <template #actions>
      <button class="gc-button" type="button" @click="closeModal">{{ t('designSystem.dryRunResult.close') }}</button>
    </template>
  </GcModal>
</template>

<style scoped>
.execution-detail-modal {
  display: grid;
  gap: var(--gc-space-3);
  min-width: 0;
}

.execution-detail-modal__hero {
  display: flex;
  justify-content: space-between;
  align-items: stretch;
  gap: var(--gc-space-4);
  padding: var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-info-border);
  border-radius: var(--gc-radius-lg);
  background: var(--gc-color-surface-subtle);
}

.execution-detail-modal__hero-copy,
.execution-detail-modal__hero-side,
.execution-detail-modal__summary-head {
  display: grid;
  gap: var(--gc-space-1);
}

.execution-detail-modal__hero-copy {
  min-width: 0;
}

.execution-detail-modal__eyebrow {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 850;
}

.execution-detail-modal__hero-copy h2 {
  margin: 0;
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-xl);
  line-height: 1.1;
  overflow-wrap: anywhere;
}

.execution-detail-modal__hero-copy span,
.execution-detail-modal__summary-head span,
.execution-detail-modal__list-item p,
.execution-detail-modal__log-item p,
.execution-detail-modal__list-item small,
.execution-detail-modal__log-meta span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.execution-detail-modal__hero-side {
  align-content: space-between;
  justify-items: end;
  min-width: calc(var(--gc-space-10) * 4);
}

.execution-detail-modal__spotlight {
  display: grid;
  gap: var(--gc-space-1);
  min-width: calc(var(--gc-space-10) * 4);
  padding: var(--gc-space-3);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-text);
  color: var(--gc-color-surface-solid);
}

.execution-detail-modal__spotlight small {
  color: var(--gc-color-text-inverse-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 800;
}

.execution-detail-modal__tabs {
  display: inline-flex;
  align-items: center;
  gap: var(--gc-space-1);
  width: fit-content;
  padding: var(--gc-space-1);
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
  border-radius: var(--gc-radius-xl);
  background: var(--gc-color-surface-hover);
}

.execution-detail-modal__tab {
  min-height: var(--gc-space-8);
  border: 0;
  border-radius: var(--gc-radius-xl);
  padding: 0 var(--gc-space-4);
  background: transparent;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 800;
  cursor: pointer;
}

.execution-detail-modal__tab[data-active='true'] {
  background: var(--gc-color-surface-solid);
  color: var(--gc-color-primary);
  box-shadow: var(--gc-shadow-button-primary);
}

.execution-detail-modal__section,
.execution-detail-modal__summary {
  display: grid;
  gap: var(--gc-space-3);
  padding: var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
  border-radius: var(--gc-radius-lg);
  background: var(--gc-color-surface-solid);
}

.execution-detail-modal__unknown {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--gc-space-4);
  padding: var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-warning-border);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-warning-soft);
  color: var(--gc-color-text);
}

.execution-detail-modal__unknown strong,
.execution-detail-modal__unknown p {
  margin: 0;
}

.execution-detail-modal__unknown p {
  margin-top: var(--gc-space-1);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  line-height: 1.5;
}

.execution-detail-modal__unknown--steps {
  margin-bottom: var(--gc-space-3);
}

.execution-detail-modal__facts,
.execution-detail-modal__summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-3);
  margin: 0;
}

.execution-detail-modal__facts div,
.execution-detail-modal__summary-grid > div {
  display: grid;
  gap: var(--gc-space-1);
  padding: var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-hover);
}

.execution-detail-modal__facts dt,
.execution-detail-modal__summary-grid small {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 800;
}

.execution-detail-modal__facts dd,
.execution-detail-modal__summary-grid strong {
  margin: 0;
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-sm);
  font-weight: 800;
  overflow-wrap: anywhere;
}

.execution-detail-modal__summary-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.execution-detail-modal__summary[data-state='passed'] {
  border-color: var(--gc-color-success-border);
  background: var(--gc-color-success-soft);
}

.execution-detail-modal__summary[data-state='warning'] {
  border-color: var(--gc-color-warning-border);
  background: var(--gc-color-warning-soft);
}

.execution-detail-modal__summary[data-state='failed'] {
  border-color: var(--gc-color-danger-border);
  background: var(--gc-color-danger-soft);
}

.execution-detail-modal__list,
.execution-detail-modal__logs {
  display: grid;
  gap: var(--gc-space-3);
  padding: 0;
  margin: 0;
  list-style: none;
}

.execution-detail-modal__list-item,
.execution-detail-modal__log-item {
  display: grid;
  gap: var(--gc-space-2);
  padding: var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-hover);
}

.execution-detail-modal__list-head,
.execution-detail-modal__log-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-3);
  flex-wrap: wrap;
}

.execution-detail-modal__list-item p,
.execution-detail-modal__log-item p,
.execution-detail-modal__list-item small {
  margin: 0;
}

.execution-detail-modal__diagnostics {
  display: grid;
  gap: var(--gc-space-2);
  padding-top: var(--gc-space-2);
  border-top: var(--gc-border-width-default) solid var(--gc-color-border-muted);
}

.execution-detail-modal__diagnostics > strong {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-xs);
}

.execution-detail-modal__diagnostics dl {
  display: grid;
  gap: var(--gc-space-1);
  margin: 0;
}

.execution-detail-modal__diagnostics dl div {
  display: grid;
  grid-template-columns: minmax(8rem, 0.35fr) minmax(0, 1fr);
  gap: var(--gc-space-2);
}

.execution-detail-modal__diagnostics dt,
.execution-detail-modal__diagnostics dd {
  margin: 0;
  font-size: var(--gc-font-size-xs);
  overflow-wrap: anywhere;
}

.execution-detail-modal__diagnostics dt {
  color: var(--gc-color-text-muted);
  font-weight: 800;
}

.execution-detail-modal__diagnostics dd {
  color: var(--gc-color-text);
  white-space: pre-wrap;
}

.execution-detail-modal__diagnostics details {
  border-top: var(--gc-border-width-default) solid var(--gc-color-border-muted);
  padding-top: var(--gc-space-2);
}

.execution-detail-modal__diagnostics summary {
  color: var(--gc-color-primary);
  cursor: pointer;
  font-size: var(--gc-font-size-xs);
  font-weight: 800;
}

.execution-detail-modal__diagnostics pre {
  max-height: 18rem;
  margin: var(--gc-space-2) 0 0;
  overflow: auto;
  border-radius: var(--gc-radius-sm);
  padding: var(--gc-space-3);
  background: var(--gc-color-code-bg);
  color: var(--gc-color-text-inverse);
  font-size: var(--gc-font-size-xs);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.execution-detail-modal__log-item[data-level='error'] {
  border-color: var(--gc-color-danger-border);
  background: var(--gc-color-danger-soft);
}

.execution-detail-modal__log-item[data-level='warn'] {
  border-color: var(--gc-color-warning-border);
  background: var(--gc-color-warning-soft);
}

.execution-detail-modal__loading,
.execution-detail-modal__error {
  margin: 0;
}

.execution-detail-modal__error-banner {
  margin: 0;
  padding: var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-danger-border);
  border-radius: var(--gc-radius-md);
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-bg);
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.execution-detail-modal__error {
  color: var(--gc-color-danger);
}

@media (max-width: 56.25rem) {
  .execution-detail-modal__hero {
    grid-template-columns: 1fr;
    align-items: flex-start;
    display: grid;
  }

  .execution-detail-modal__hero-side {
    justify-items: start;
  }

  .execution-detail-modal__unknown {
    display: grid;
    align-items: flex-start;
  }

  .execution-detail-modal__facts,
  .execution-detail-modal__summary-grid {
    grid-template-columns: 1fr;
  }

  .execution-detail-modal__diagnostics dl div {
    grid-template-columns: 1fr;
  }
}
</style>
