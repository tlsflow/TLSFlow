<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { GcModal, GcStatusTag } from '@/design-system/components'
import { listExecutions, rollbackExecution } from '@/api/modules/executions.api'
import { readString, type ViewRow } from '@/composables/useBusinessPage'
import { useExecutionDetail } from '@/composables/useExecutionDetail'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import type { BusinessPageConfig } from '@/views/business-page.types'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'

const route = useRoute()
const { t } = useI18n()
const detailModalOpen = ref(false)
const detailRow = ref<ViewRow | null>(null)
const activeTab = ref<'summary' | 'steps' | 'logs'>('summary')

const config = computed<BusinessPageConfig>(() => ({
  title: t('executions.title'),
  description: t('executions.description'),
  readPermission: 'execution.read',
  primaryPermission: 'execution.read',
  primaryActionLabel: t('executions.actions.refreshList'),
  primaryAction: async () => {},
  moduleName: 'executions',
  resourceName: t('executions.resourceName'),
  defaultStatus: 'RUNNING',
  defaultRisk: 'MEDIUM',
  showDetailPanel: false,
  showActionPanel: false,
  columns: [
    { key: 'name', title: t('executions.columns.name'), candidates: ['runNo', 'name', 'id'] },
    { key: 'status', title: t('executions.columns.status'), candidates: ['status', 'state', 'result'] },
    { key: 'risk', title: t('executions.columns.risk'), candidates: ['risk', 'riskLevel'] },
    { key: 'planId', title: t('executions.columns.planId'), candidates: ['deploymentPlanId', 'planId'] },
    { key: 'startedAt', title: t('executions.columns.startedAt'), candidates: ['startedAt', 'createdAt'], kind: 'date' },
  ],
  metrics: [
    { title: t('executions.metrics.total.title'), description: t('executions.metrics.total.description'), status: 'RUNNING', risk: 'MEDIUM', kind: 'total' },
    { title: t('executions.metrics.risky.title'), description: t('executions.metrics.risky.description'), status: 'FAILED', risk: 'HIGH' },
  ],
  detailFields: [
    { label: t('executions.fields.executionId'), candidates: ['id', 'runId'] },
    { label: t('executions.fields.deploymentPlan'), candidates: ['deploymentPlanId', 'planId'] },
    { label: t('executions.fields.runType'), candidates: ['type'] },
    { label: t('executions.fields.status'), candidates: ['status', 'state', 'result'] },
    { label: t('executions.fields.target'), candidates: ['executionTargetId', 'targetSummary', 'targetIds.0'] },
    { label: t('executions.fields.externalRunId'), candidates: ['externalRunId'] },
    { label: t('executions.fields.startedAt'), candidates: ['startedAt', 'createdAt'] },
    { label: t('executions.fields.finishedAt'), candidates: ['finishedAt', 'updatedAt'] },
    { label: t('executions.fields.errorCode'), candidates: ['errorCode'] },
    { label: t('executions.fields.failureReason'), candidates: ['failureReason', 'errorMessage', 'error.message'] },
  ],
  contextLinks: [
    { label: t('executions.links.deploymentPlan'), to: '/deployment-plans', queryKey: 'planId', candidates: ['deploymentPlanId', 'planId'] },
    { label: t('executions.links.auditEvents'), to: '/audits', queryKey: 'runId', candidates: ['id', 'runId'] },
  ],
  emptyTitle: t('executions.empty.title'),
  emptyDescription: t('executions.empty.description'),
  load: () => listExecutions({
    page: 1,
    pageSize: 20,
    sort: 'startedAt:desc',
    filters: {
      runId: typeof route.query.runId === 'string' ? route.query.runId : undefined,
      planId: typeof route.query.planId === 'string' ? route.query.planId : undefined,
      hostId: typeof route.query.hostId === 'string' ? route.query.hostId : undefined,
      status: typeof route.query.status === 'string' ? route.query.status : undefined,
    },
  }),
  rowActions: [
    {
      label: t('executions.actions.viewDetail'),
      permission: 'execution.read',
      reloadAfterRun: false,
      run: async (row) => {
        openExecutionDetail(row)
      },
    },
  ],
  actions: [
    {
      label: t('executions.actions.rollback'),
      permission: 'execution.rollback',
      danger: true,
      confirmText: 'ROLLBACK',
      riskText: t('executions.actions.rollbackRisk'),
      requiresSelection: true,
      run: (row) => rollbackExecution(row?.id ?? '', { dryRun: true }),
    },
  ],
}))

const modalExecutionDetail = useExecutionDetail(detailRow, { t })
const modalSummaryCards = computed(() => {
  const summary = modalExecutionDetail.dryRunSummary.value
  if (!summary) return []
  return [
    { label: t('executions.summary.passed'), value: summary.passed },
    { label: t('executions.summary.warning'), value: summary.warning },
    { label: t('executions.summary.failed'), value: summary.failed },
    { label: t('executions.summary.unknown'), value: summary.unknown },
  ]
})

function openExecutionDetail(row: ViewRow) {
  detailRow.value = row
  detailModalOpen.value = true
  activeTab.value = 'summary'
  void modalExecutionDetail.reload()
}
</script>

<template>
  <section class="gc-page gc-execution-page">
    <BusinessResourcePage :config="config" />

    <GcModal
      v-model:open="detailModalOpen"
      :title="detailRow ? t('executions.detail.titleWithId', { id: detailRow.id }) : t('executions.detail.title')"
      :description="t('executions.detail.description')"
      size="xxl"
      width="min(1280px, calc(100vw - 32px))"
    >
      <section v-if="detailRow" class="execution-detail-modal">
        <section class="execution-detail-modal__hero">
          <div class="execution-detail-modal__hero-copy">
            <p class="execution-detail-modal__eyebrow">Execution Run</p>
            <h2>{{ readString(detailRow.raw, ['runNo', 'name', 'id'], detailRow.id) }}</h2>
            <span>{{ t('executions.detail.planLabel', { plan: readString(detailRow.raw, ['deploymentPlanId', 'planId']) }) }}</span>
          </div>
          <div class="execution-detail-modal__hero-side">
            <GcStatusTag :status="readString(detailRow.raw, ['status', 'state', 'result'])" />
            <div class="execution-detail-modal__spotlight">
              <small>{{ t('executions.fields.runType') }}</small>
              <strong>{{ readString(detailRow.raw, ['type']) }}</strong>
            </div>
          </div>
        </section>

        <div class="execution-detail-modal__tabs">
          <button class="execution-detail-modal__tab" type="button" :data-active="activeTab === 'summary'" @click="activeTab = 'summary'">{{ t('executions.tabs.summary') }}</button>
          <button class="execution-detail-modal__tab" type="button" :data-active="activeTab === 'steps'" @click="activeTab = 'steps'">{{ t('executions.tabs.steps') }}</button>
          <button class="execution-detail-modal__tab" type="button" :data-active="activeTab === 'logs'" @click="activeTab = 'logs'">{{ t('executions.tabs.logs') }}</button>
        </div>

        <section v-if="activeTab === 'summary'" class="execution-detail-modal__section">
          <dl class="execution-detail-modal__facts">
            <div>
              <dt>{{ t('executions.fields.executionId') }}</dt>
              <dd>{{ readString(detailRow.raw, ['id', 'runId'], detailRow.id) }}</dd>
            </div>
            <div>
              <dt>{{ t('executions.fields.deploymentPlan') }}</dt>
              <dd>{{ readString(detailRow.raw, ['deploymentPlanId', 'planId']) }}</dd>
            </div>
            <div>
              <dt>{{ t('executions.fields.runType') }}</dt>
              <dd>{{ readString(detailRow.raw, ['type']) }}</dd>
            </div>
            <div>
              <dt>{{ t('executions.fields.status') }}</dt>
              <dd>{{ readString(detailRow.raw, ['status', 'state', 'result']) }}</dd>
            </div>
            <div>
              <dt>{{ t('executions.fields.startedAt') }}</dt>
              <dd>{{ formatBrowserLocalTime(readString(detailRow.raw, ['startedAt', 'createdAt'])) || readString(detailRow.raw, ['startedAt', 'createdAt']) }}</dd>
            </div>
            <div>
              <dt>{{ t('executions.fields.finishedAt') }}</dt>
              <dd>{{ formatBrowserLocalTime(readString(detailRow.raw, ['finishedAt', 'updatedAt'])) || readString(detailRow.raw, ['finishedAt', 'updatedAt']) }}</dd>
            </div>
            <div>
              <dt>{{ t('executions.fields.errorCode') }}</dt>
              <dd>{{ readString(detailRow.raw, ['errorCode']) }}</dd>
            </div>
            <div>
              <dt>{{ t('executions.fields.failureReason') }}</dt>
              <dd>{{ readString(detailRow.raw, ['failureReason', 'errorMessage', 'error.message']) }}</dd>
            </div>
          </dl>

          <article
            v-if="modalExecutionDetail.dryRunSummary.value"
            class="execution-detail-modal__summary"
            :data-state="modalExecutionDetail.dryRunSummary.value.state"
          >
            <div class="execution-detail-modal__summary-head">
              <strong>{{ modalExecutionDetail.dryRunSummary.value.label }}</strong>
              <span>{{ modalExecutionDetail.dryRunSummary.value.detail }}</span>
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
          <p v-if="modalExecutionDetail.loading.value" class="execution-detail-modal__loading">{{ t('executions.detail.loadingSteps') }}</p>
          <p v-else-if="modalExecutionDetail.error.value" class="execution-detail-modal__error">{{ modalExecutionDetail.error.value }}</p>
          <ul v-else-if="modalExecutionDetail.steps.value.length" class="execution-detail-modal__list">
            <li v-for="step in modalExecutionDetail.steps.value" :key="step.id" class="execution-detail-modal__list-item">
              <div class="execution-detail-modal__list-head">
                <strong>{{ step.name }}</strong>
                <GcStatusTag :status="step.status" />
              </div>
              <p>{{ step.detail ?? t('executions.detail.noStepDetail') }}</p>
              <small>{{ step.startedAt ?? t('executions.detail.notStarted') }}{{ step.finishedAt ? ` -> ${step.finishedAt}` : '' }}</small>
            </li>
          </ul>
          <p v-else class="execution-detail-modal__loading">{{ t('executions.detail.noSteps') }}</p>
        </section>

        <section v-else class="execution-detail-modal__section">
          <p v-if="modalExecutionDetail.loading.value" class="execution-detail-modal__loading">{{ t('executions.detail.loadingLogs') }}</p>
          <p v-else-if="modalExecutionDetail.error.value" class="execution-detail-modal__error">{{ modalExecutionDetail.error.value }}</p>
          <ul v-else-if="modalExecutionDetail.lines.value.length" class="execution-detail-modal__logs">
            <li v-for="line in modalExecutionDetail.lines.value" :key="line.id" class="execution-detail-modal__log-item" :data-level="line.level">
              <div class="execution-detail-modal__log-meta">
                <span>{{ line.time }}</span>
                <strong>{{ line.step || t('executions.tabs.logs') }}</strong>
              </div>
              <p>{{ line.message }}</p>
            </li>
          </ul>
          <p v-else class="execution-detail-modal__loading">{{ t('executions.detail.noLogs') }}</p>
        </section>
      </section>

      <template #actions>
        <button class="gc-button" type="button" @click="detailModalOpen = false">{{ t('designSystem.dryRunResult.close') }}</button>
      </template>
    </GcModal>
  </section>
</template>

<style scoped>
.gc-execution-page {
  display: grid;
  gap: var(--gc-space-4);
}

.gc-execution-page :deep(.gc-data-table th),
.gc-execution-page :deep(.gc-data-table td) {
  white-space: nowrap;
}

.execution-detail-modal {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.execution-detail-modal__hero {
  display: flex;
  justify-content: space-between;
  align-items: stretch;
  gap: 14px;
  padding: 16px 18px;
  border: 1px solid var(--gc-color-info-border);
  border-radius: 18px;
  background:
    radial-gradient(circle at top right, var(--gc-color-primary-soft), transparent 26%),
    linear-gradient(140deg, var(--gc-color-surface-hover) 0%, var(--gc-color-surface-solid) 54%, var(--gc-color-surface-subtle) 100%);
}

.execution-detail-modal__hero-copy {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.execution-detail-modal__eyebrow {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.execution-detail-modal__hero-copy h2 {
  margin: 0;
  color: var(--gc-color-text);
  font-size: 24px;
  line-height: 1.06;
  overflow-wrap: anywhere;
}

.execution-detail-modal__hero-copy span {
  color: var(--gc-color-text-muted);
  font-size: 12px;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.execution-detail-modal__hero-side {
  display: grid;
  align-content: space-between;
  justify-items: end;
  gap: 8px;
  min-width: 150px;
}

.execution-detail-modal__spotlight {
  display: grid;
  gap: 4px;
  min-width: 150px;
  padding: 10px 12px;
  border-radius: 14px;
  background: var(--gc-color-text);
  color: var(--gc-color-surface-solid);
}

.execution-detail-modal__spotlight small {
  color: var(--gc-color-text-inverse-muted);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.execution-detail-modal__spotlight strong {
  font-size: 16px;
  line-height: 1.15;
  overflow-wrap: anywhere;
}

.execution-detail-modal__tabs {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
  padding: 4px;
  border: 1px solid var(--gc-color-border-muted);
  border-radius: 999px;
  background: var(--gc-color-surface-hover);
}

.execution-detail-modal__tab {
  min-height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--gc-color-text-muted);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.execution-detail-modal__tab[data-active='true'] {
  background: var(--gc-color-surface-solid);
  color: var(--gc-color-text);
  box-shadow: 0 4px 14px var(--gc-color-border);
}

.execution-detail-modal__section,
.execution-detail-modal__summary {
  display: grid;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--gc-color-border-muted);
  border-radius: 16px;
  background: linear-gradient(180deg, var(--gc-color-surface-solid), var(--gc-color-surface-raised));
}

.execution-detail-modal__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
}

.execution-detail-modal__facts div {
  display: grid;
  gap: 5px;
  min-height: 70px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--gc-color-surface-hover);
  border: 1px solid var(--gc-color-border-muted);
}

.execution-detail-modal__facts dt {
  color: var(--gc-color-text-muted);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.execution-detail-modal__facts dd {
  margin: 0;
  color: var(--gc-color-text);
  font-size: 13px;
  font-weight: 800;
  overflow-wrap: anywhere;
}

.execution-detail-modal__summary-head {
  display: grid;
  gap: 4px;
}

.execution-detail-modal__summary-head strong {
  color: var(--gc-color-text);
  font-size: 15px;
}

.execution-detail-modal__summary-head span {
  color: var(--gc-color-text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.execution-detail-modal__summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.execution-detail-modal__summary-grid > div {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--gc-color-border-muted);
  background: var(--gc-color-surface-hover);
}

.execution-detail-modal__summary-grid small {
  color: var(--gc-color-text-muted);
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
}

.execution-detail-modal__summary-grid strong {
  font-size: 18px;
  color: var(--gc-color-text);
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

.execution-detail-modal__summary[data-state='pending'],
.execution-detail-modal__summary[data-state='queued'],
.execution-detail-modal__summary[data-state='running'] {
  border-color: var(--gc-color-primary-border);
  background: var(--gc-color-surface-selected);
}

.execution-detail-modal__list,
.execution-detail-modal__logs {
  display: grid;
  gap: 10px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.execution-detail-modal__list-item,
.execution-detail-modal__log-item {
  display: grid;
  gap: 6px;
  padding: 12px;
  border: 1px solid var(--gc-color-border-muted);
  border-radius: 12px;
  background: var(--gc-color-surface-hover);
}

.execution-detail-modal__list-head,
.execution-detail-modal__log-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.execution-detail-modal__list-item p,
.execution-detail-modal__log-item p,
.execution-detail-modal__list-item small,
.execution-detail-modal__log-meta span {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.execution-detail-modal__log-meta strong {
  color: var(--gc-color-text);
  font-size: 12px;
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

.execution-detail-modal__error {
  color: var(--gc-color-danger);
}

@media (max-width: 900px) {
  .execution-detail-modal__summary-grid,
  .execution-detail-modal__facts {
    grid-template-columns: 1fr;
  }

  .execution-detail-modal__hero {
    grid-template-columns: 1fr;
    display: grid;
  }
}
</style>
