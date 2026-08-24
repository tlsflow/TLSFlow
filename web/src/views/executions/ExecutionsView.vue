<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { GcEmptyState, GcModal, GcPageHeader, GcPageToolbar, GcStatusTag } from '@/design-system/components'
import { listAssets } from '@/api/modules/assets.api'
import type { ApiRecord } from '@/api/modules/common'
import { listDeploymentPlans } from '@/api/modules/deployments.api'
import { listExecutions } from '@/api/modules/executions.api'
import { readPath, readString, type ViewRow } from '@/composables/useBusinessPage'
import { useExecutionDetail } from '@/composables/useExecutionDetail'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'

interface AssetInfo {
  readonly id: string
  readonly name: string
  readonly managedTargetId: string
}

interface PlanInfo {
  readonly id: string
  readonly name: string
  readonly assets: readonly AssetInfo[]
}

interface ExecutionListRow extends ViewRow {
  readonly planName: string
  readonly assetNames: readonly string[]
  readonly assetIds: readonly string[]
  readonly runTypeLabel: string
  readonly runNumberLabel: string
  readonly startedAtLabel: string
  readonly logSummary: string
  readonly sourceLabel: string
}

const PAGE_SIZE = 20

const route = useRoute()
const { t } = useI18n()
const allRows = ref<ExecutionListRow[]>([])
const loading = ref(false)
const error = ref('')
const currentPage = ref(1)
const detailModalOpen = ref(false)
const detailRow = ref<ExecutionListRow | null>(null)
const activeTab = ref<'summary' | 'steps' | 'logs'>('summary')

const filteredRows = computed(() => {
  const runId = queryValue('runId')
  const planId = queryValue('planId')
  const hostId = queryValue('hostId')
  const status = queryValue('status').toUpperCase()

  return allRows.value.filter((row) => {
    if (runId && row.id !== runId) return false
    if (planId && readString(row.raw, ['deploymentPlanId', 'planId'], '') !== planId) return false
    if (hostId && !row.assetIds.includes(hostId) && readString(row.raw, ['executionTargetId'], '') !== hostId) return false
    if (status && row.status.toUpperCase() !== status) return false
    return true
  })
})
const pageCount = computed(() => Math.max(1, Math.ceil(filteredRows.value.length / PAGE_SIZE)))
const visibleRows = computed(() => {
  const start = (currentPage.value - 1) * PAGE_SIZE
  return filteredRows.value.slice(start, start + PAGE_SIZE)
})
const visibleRange = computed(() => {
  if (filteredRows.value.length === 0) return { start: 0, end: 0 }
  const start = (currentPage.value - 1) * PAGE_SIZE + 1
  return { start, end: Math.min(start + PAGE_SIZE - 1, filteredRows.value.length) }
})

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

watch(filteredRows, () => {
  currentPage.value = Math.min(currentPage.value, pageCount.value)
})

onMounted(() => {
  void loadExecutions()
})

async function loadExecutions() {
  loading.value = true
  error.value = ''
  try {
    const executionResult = await listExecutions({ page: 1, pageSize: 200, sort: 'startedAt:desc' })
    const [planResult, assetResult] = await Promise.allSettled([
      listDeploymentPlans({ page: 1, pageSize: 200 }),
      listAssets({ page: 1, pageSize: 200 }),
    ])
    const executions = executionResult.data?.items ?? []
    const plans = planResult.status === 'fulfilled' ? planResult.value.data?.items ?? [] : []
    const assets = assetResult.status === 'fulfilled' ? assetResult.value.data?.items ?? [] : []
    allRows.value = buildExecutionRows(executions, plans, assets)
    currentPage.value = 1
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('executions.errors.loadFailed')
    allRows.value = []
  } finally {
    loading.value = false
  }
}

function buildExecutionRows(executions: readonly ApiRecord[], plans: readonly ApiRecord[], assets: readonly ApiRecord[]): ExecutionListRow[] {
  const assetMaps = buildAssetMaps(assets)
  const planMap = buildPlanMap(plans, assetMaps.byId, assetMaps.byManagedTargetId)

  return executions
    .map((record, index) => toExecutionRow(record, index, planMap, assetMaps.byId, assetMaps.byManagedTargetId))
    .sort((left, right) => timestamp(right.raw) - timestamp(left.raw))
}

function buildAssetMaps(assets: readonly ApiRecord[]) {
  const byId = new Map<string, AssetInfo>()
  const byManagedTargetId = new Map<string, AssetInfo>()

  for (const asset of assets) {
    const id = readString(asset, ['id'], '')
    if (!id) continue
    const info: AssetInfo = {
      id,
      name: readString(asset, ['displayName', 'name', 'address'], id),
      managedTargetId: readString(asset, ['targetBinding.managedTargetId', 'managedTargetId'], ''),
    }
    byId.set(id, info)
    if (info.managedTargetId) byManagedTargetId.set(info.managedTargetId, info)
  }

  return { byId, byManagedTargetId }
}

function buildPlanMap(
  plans: readonly ApiRecord[],
  assetsById: ReadonlyMap<string, AssetInfo>,
  assetsByManagedTargetId: ReadonlyMap<string, AssetInfo>,
): Map<string, PlanInfo> {
  const planMap = new Map<string, PlanInfo>()

  for (const plan of plans) {
    const id = readString(plan, ['id', 'planId'], '')
    if (!id) continue
    const resolvedAssets = readRecordArray(readPath(plan, 'targets'))
      .map((target) => resolveTargetAsset(target, assetsById, assetsByManagedTargetId))
      .filter((asset): asset is AssetInfo => Boolean(asset))
    planMap.set(id, {
      id,
      name: readString(plan, ['name', 'title'], id),
      assets: uniqueAssets(resolvedAssets),
    })
  }

  return planMap
}

function resolveTargetAsset(
  target: ApiRecord,
  assetsById: ReadonlyMap<string, AssetInfo>,
  assetsByManagedTargetId: ReadonlyMap<string, AssetInfo>,
): AssetInfo | undefined {
  const candidates = [
    readString(target, ['applicationAssetId'], ''),
    readString(target, ['serviceAssetId'], ''),
    readString(target, ['strategyPayload.applicationAssetId'], ''),
    readString(target, ['strategyPayload.serviceAssetId'], ''),
    readString(target, ['strategyPayload.workflowRequest.applicationAssetId'], ''),
    readString(target, ['executionTargetId'], ''),
  ].filter(Boolean)

  for (const candidate of candidates) {
    const asset = assetsById.get(candidate) ?? assetsByManagedTargetId.get(candidate)
    if (asset) return asset
  }
  return undefined
}

function toExecutionRow(
  record: ApiRecord,
  index: number,
  planMap: ReadonlyMap<string, PlanInfo>,
  assetsById: ReadonlyMap<string, AssetInfo>,
  assetsByManagedTargetId: ReadonlyMap<string, AssetInfo>,
): ExecutionListRow {
  const id = readString(record, ['id', 'runId'], `execution-${index + 1}`)
  const status = readString(record, ['status', 'state', 'result'], 'PENDING')
  const planId = readString(record, ['deploymentPlanId', 'planId'], '')
  const plan = planMap.get(planId)
  const directTargetId = readString(record, ['executionTargetId'], '')
  const directAsset = assetsById.get(directTargetId) ?? assetsByManagedTargetId.get(directTargetId)
  const assets = uniqueAssets([...(plan?.assets ?? []), ...(directAsset ? [directAsset] : [])])

  return {
    id,
    name: id,
    status,
    risk: 'MEDIUM',
    raw: record,
    planName: plan?.name ?? (planId || t('executions.list.planUnknown')),
    assetNames: assets.length > 0 ? assets.map((asset) => asset.name) : [t('executions.list.assetUnknown')],
    assetIds: assets.map((asset) => asset.id),
    runTypeLabel: executionTypeLabel(readString(record, ['type'], '')),
    runNumberLabel: t('executions.list.runNumber', { number: readString(record, ['runNo'], '—') }),
    startedAtLabel: formatListTime(readString(record, ['startedAt', 'createdAt'], '')),
    logSummary: executionLogSummary(record, status),
    sourceLabel: executionSourceLabel(record),
  }
}

function executionSourceLabel(record: ApiRecord): string {
  const sourceType = readString(record, ['summary.executionSource.type', 'executionSource.type'], 'deployment_plan')
  return sourceType === 'automation' ? t('automations.title') : t('deploymentPlans.title')
}

function executionTypeLabel(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'dry_run') return t('executions.types.dryRun')
  if (normalized === 'apply') return t('executions.types.apply')
  if (normalized === 'rollback') return t('executions.types.rollback')
  if (normalized === 'retry') return t('executions.types.retry')
  return value || t('executions.types.unknown')
}

function executionLogSummary(record: ApiRecord, status: string): string {
  const errorMessage = readString(record, ['errorMessage', 'failureReason', 'error.message'], '')
  if (errorMessage) return errorMessage

  const normalizedStatus = status.toUpperCase()
  if (normalizedStatus === 'RUNNING') return t('executions.list.logRunning')
  if (normalizedStatus === 'PENDING' || normalizedStatus === 'QUEUED') return t('executions.list.logPending')
  if (normalizedStatus === 'FAILED') {
    return t('executions.list.logFailed', { code: readString(record, ['errorCode'], t('executions.list.errorCodeUnknown')) })
  }
  if (normalizedStatus === 'SUCCESS') {
    return t('executions.list.logSuccess', { duration: executionDuration(record) })
  }
  return t('executions.list.logCompleted')
}

function executionDuration(record: ApiRecord): string {
  const startedAt = Date.parse(readString(record, ['startedAt', 'createdAt'], ''))
  const finishedAt = Date.parse(readString(record, ['finishedAt', 'updatedAt'], ''))
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt) {
    return t('executions.list.durationUnknown')
  }
  const seconds = Math.max(0, Math.round((finishedAt - startedAt) / 1000))
  if (seconds < 60) return t('executions.list.durationSeconds', { count: seconds })
  return t('executions.list.durationMinutes', { count: Math.round(seconds / 60) })
}

function openExecutionDetail(row: ExecutionListRow) {
  detailRow.value = row
  detailModalOpen.value = true
  activeTab.value = 'summary'
  void modalExecutionDetail.reload()
}

function goToPage(page: number) {
  currentPage.value = Math.min(Math.max(page, 1), pageCount.value)
}

function queryValue(key: string): string {
  const value = route.query[key]
  return typeof value === 'string' ? value : ''
}

function timestamp(record: ApiRecord): number {
  const parsed = Date.parse(readString(record, ['startedAt', 'createdAt'], ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function formatListTime(value: string): string {
  return formatBrowserLocalTime(value, { includeSeconds: false }) || t('executions.list.timeUnknown')
}

function formatDetailTime(value: unknown): string {
  return formatBrowserLocalTime(value) || t('common.notAvailable')
}

function formatStepStartTime(value: unknown): string {
  return formatBrowserLocalTime(value) || t('executions.detail.notStarted')
}

function readRecordArray(value: unknown): ApiRecord[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is ApiRecord => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
}

function uniqueAssets(assets: readonly AssetInfo[]): AssetInfo[] {
  return [...new Map(assets.map((asset) => [asset.id, asset])).values()]
}
</script>

<template>
  <section class="gc-page execution-page">
    <GcPageHeader :title="t('executions.title')" :description="t('executions.description')" />
    <GcPageToolbar>
      <template #actions>
        <button class="gc-button" type="button" :disabled="loading" @click="loadExecutions">
          {{ loading ? t('executions.actions.refreshing') : t('executions.actions.refreshList') }}
        </button>
      </template>
    </GcPageToolbar>

    <GcEmptyState v-if="error" :title="t('executions.errors.loadFailed')" :description="error">
      <button class="gc-button" type="button" @click="loadExecutions">{{ t('common.refresh') }}</button>
    </GcEmptyState>

    <section v-else class="gc-card execution-list" :aria-label="t('executions.list.ariaLabel')">
      <header class="execution-list__header">
        <div>
          <h2>{{ t('executions.list.title') }}</h2>
          <p>{{ t('executions.list.summary', { total: filteredRows.length }) }}</p>
        </div>
        <span v-if="filteredRows.length" class="execution-list__range">
          {{ t('executions.list.range', { start: visibleRange.start, end: visibleRange.end, total: filteredRows.length }) }}
        </span>
      </header>

      <div v-if="loading" class="execution-list__state" role="status" aria-live="polite">{{ t('designSystem.dataTable.loading') }}</div>
      <div v-else-if="visibleRows.length" class="execution-list__table-wrap">
        <table class="execution-list__table">
          <thead>
            <tr>
              <th scope="col">{{ t('executions.fields.status') }}</th>
              <th scope="col">{{ t('executions.fields.deploymentPlan') }}</th>
              <th scope="col">{{ t('tasks.fields.triggerSource') }}</th>
              <th scope="col">{{ t('executions.list.assetsLabel') }}</th>
              <th scope="col">{{ t('executions.fields.runType') }}</th>
              <th scope="col">{{ t('executions.list.logLabel') }}</th>
              <th scope="col">{{ t('executions.fields.startedAt') }}</th>
              <th scope="col">{{ t('executions.actions.viewDetail') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in visibleRows"
              :key="item.id"
              class="execution-list__record"
              tabindex="0"
              role="button"
              :aria-label="t('executions.list.openDetailAria', { plan: item.planName, id: item.id })"
              @click="openExecutionDetail(item)"
              @keydown.enter="openExecutionDetail(item)"
              @keydown.space.prevent="openExecutionDetail(item)"
            >
              <td class="execution-list__status"><GcStatusTag :status="item.status" /></td>
              <td class="execution-list__plan">
                <strong>{{ item.planName }}</strong>
                <small>{{ item.id }}</small>
              </td>
              <td class="execution-list__source-cell">
                <span class="execution-list__source">{{ item.sourceLabel }}</span>
              </td>
              <td class="execution-list__assets">
                <span v-for="asset in item.assetNames" :key="asset" class="execution-list__asset">{{ asset }}</span>
              </td>
              <td class="execution-list__run-cell">
                <span class="execution-list__type">{{ item.runTypeLabel }}</span>
                <small>{{ item.runNumberLabel }}</small>
              </td>
              <td class="execution-list__log">{{ item.logSummary }}</td>
              <td class="execution-list__time"><time>{{ item.startedAtLabel }}</time></td>
              <td class="execution-list__action">{{ t('executions.list.viewDetailHint') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <GcEmptyState v-else :title="t('executions.empty.title')" :description="t('executions.empty.description')" />

      <footer v-if="filteredRows.length > PAGE_SIZE" class="execution-list__pagination">
        <button class="gc-button" type="button" :disabled="currentPage <= 1" @click="goToPage(currentPage - 1)">
          {{ t('executions.list.previousPage') }}
        </button>
        <span>{{ t('executions.list.pageSummary', { page: currentPage, pages: pageCount }) }}</span>
        <button class="gc-button" type="button" :disabled="currentPage >= pageCount" @click="goToPage(currentPage + 1)">
          {{ t('executions.list.nextPage') }}
        </button>
      </footer>
    </section>

    <GcModal
      v-model:open="detailModalOpen"
      :title="detailRow ? t('executions.detail.titleWithId', { id: detailRow.id }) : t('executions.detail.title')"
      :description="t('executions.detail.description')"
      size="xxl"
    >
      <section v-if="detailRow" class="execution-detail-modal">
        <section class="execution-detail-modal__hero">
          <div class="execution-detail-modal__hero-copy">
            <p class="execution-detail-modal__eyebrow">{{ t('executions.detail.eyebrow') }}</p>
            <h2>{{ detailRow.planName }}</h2>
            <span>{{ detailRow.id }}</span>
          </div>
          <div class="execution-detail-modal__hero-side">
            <GcStatusTag :status="detailRow.status" />
            <div class="execution-detail-modal__spotlight">
              <small>{{ t('executions.fields.runType') }}</small>
              <strong>{{ detailRow.runTypeLabel }}</strong>
            </div>
          </div>
        </section>

        <div class="execution-detail-modal__tabs" role="tablist" :aria-label="t('executions.detail.title')">
          <button class="execution-detail-modal__tab" type="button" role="tab" :aria-selected="activeTab === 'summary'" :data-active="activeTab === 'summary'" @click="activeTab = 'summary'">{{ t('executions.tabs.summary') }}</button>
          <button class="execution-detail-modal__tab" type="button" role="tab" :aria-selected="activeTab === 'steps'" :data-active="activeTab === 'steps'" @click="activeTab = 'steps'">{{ t('executions.tabs.steps') }}</button>
          <button class="execution-detail-modal__tab" type="button" role="tab" :aria-selected="activeTab === 'logs'" :data-active="activeTab === 'logs'" @click="activeTab = 'logs'">{{ t('executions.tabs.logs') }}</button>
        </div>

        <section v-if="activeTab === 'summary'" class="execution-detail-modal__section">
          <dl class="execution-detail-modal__facts">
            <div>
              <dt>{{ t('executions.fields.executionId') }}</dt>
              <dd>{{ detailRow.id }}</dd>
            </div>
            <div>
              <dt>{{ t('executions.fields.deploymentPlan') }}</dt>
              <dd>{{ detailRow.planName }}</dd>
            </div>
            <div>
              <dt>{{ t('tasks.fields.triggerSource') }}</dt>
              <dd>{{ detailRow.sourceLabel }}</dd>
            </div>
            <div>
              <dt>{{ t('executions.fields.target') }}</dt>
              <dd>{{ detailRow.assetNames.join(', ') }}</dd>
            </div>
            <div>
              <dt>{{ t('executions.fields.status') }}</dt>
              <dd>{{ readString(detailRow.raw, ['status', 'state', 'result']) }}</dd>
            </div>
            <div>
              <dt>{{ t('executions.fields.startedAt') }}</dt>
              <dd>{{ formatDetailTime(readString(detailRow.raw, ['startedAt', 'createdAt'])) }}</dd>
            </div>
            <div>
              <dt>{{ t('executions.fields.finishedAt') }}</dt>
              <dd>{{ formatDetailTime(readString(detailRow.raw, ['finishedAt', 'updatedAt'])) }}</dd>
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
              <small>{{ formatStepStartTime(step.startedAt) }}{{ step.finishedAt ? ` -> ${formatDetailTime(step.finishedAt)}` : '' }}</small>
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
.execution-page {
  gap: var(--gc-space-5);
}

.execution-list {
  overflow: hidden;
  border-radius: var(--gc-radius-lg);
  padding: 0;
  border: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  background: var(--gc-color-surface-glass);
  box-shadow: var(--gc-shadow-sm);
}

.execution-list__header,
.execution-list__pagination {
  display: flex;
  justify-content: space-between;
  gap: var(--gc-space-4);
  align-items: center;
  padding: var(--gc-space-4);
  background: var(--gc-color-surface-glass);
}

.execution-list__header {
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border);
}

.execution-list__header h2,
.execution-list__header p {
  margin: 0;
}

.execution-list__header h2 {
  font-size: var(--gc-font-size-lg);
}

.execution-list__header p,
.execution-list__range,
.execution-list__pagination span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: 650;
}

.execution-list__header p {
  margin-top: var(--gc-space-1);
}

.execution-list__range {
  white-space: nowrap;
}

.execution-list__state {
  padding: var(--gc-space-10) var(--gc-space-4);
  text-align: center;
  color: var(--gc-color-text-muted);
  font-weight: 850;
}

.execution-list__table-wrap {
  overflow-x: auto;
}

.execution-list__table {
  width: 100%;
  min-width: 74rem;
  border-collapse: collapse;
  table-layout: fixed;
}

.execution-list__table th,
.execution-list__table td {
  padding: var(--gc-space-3) var(--gc-space-4);
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border-subtle);
  text-align: left;
  vertical-align: middle;
}

.execution-list__table th {
  color: var(--gc-color-text-muted);
  background: var(--gc-color-surface-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 850;
  white-space: nowrap;
}

.execution-list__table th:nth-child(1) { width: 7rem; }
.execution-list__table th:nth-child(2) { width: 17%; }
.execution-list__table th:nth-child(3) { width: 9rem; }
.execution-list__table th:nth-child(4) { width: 15%; }
.execution-list__table th:nth-child(5) { width: 10rem; }
.execution-list__table th:nth-child(6) { width: 25%; }
.execution-list__table th:nth-child(7) { width: 10rem; }
.execution-list__table th:nth-child(8) { width: 8rem; }

.execution-list__record {
  color: var(--gc-color-text);
  cursor: pointer;
}

.execution-list__record:hover,
.execution-list__record:focus-visible {
  background: var(--gc-color-surface-hover);
}

.execution-list__record:focus-visible {
  outline: 0;
  box-shadow: inset var(--gc-shadow-focus);
}

.execution-list__plan,
.execution-list__run-cell {
  display: grid;
  gap: var(--gc-space-1);
  min-width: 0;
}

.execution-list__plan strong {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-sm);
  font-weight: 900;
  overflow-wrap: anywhere;
}

.execution-list__source {
  width: fit-content;
  padding: var(--gc-space-1) var(--gc-space-2);
  border: var(--gc-border-width-default) solid var(--gc-color-info-border);
  border-radius: var(--gc-radius-full);
  color: var(--gc-color-info);
  background: var(--gc-color-info-bg);
  font-size: var(--gc-font-size-xs);
  font-weight: 800;
}

.execution-list__plan small,
.execution-list__run-cell small {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  overflow-wrap: anywhere;
}

.execution-list__type,
.execution-list__run,
.execution-list__asset {
  display: inline-flex;
  align-items: center;
  min-height: var(--gc-space-6);
  border-radius: var(--gc-radius-xl);
  padding: 0 var(--gc-space-2);
  font-size: var(--gc-font-size-xs);
  font-weight: 800;
  line-height: 1;
}

.execution-list__type {
  color: var(--gc-color-primary);
  background: var(--gc-color-primary-soft);
}

.execution-list__run {
  color: var(--gc-color-text-muted);
  background: var(--gc-color-surface-soft);
}

.execution-list__label {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 850;
}

.execution-list__asset {
  margin: var(--gc-space-1) var(--gc-space-1) var(--gc-space-1) 0;
  border: var(--gc-border-width-default) solid var(--gc-color-info-border);
  color: var(--gc-color-info);
  background: var(--gc-color-info-bg);
}

.execution-list__log {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-xs);
  font-weight: 650;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.execution-list__time {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 700;
  white-space: nowrap;
}

.execution-list__action {
  color: var(--gc-color-primary);
  font-size: var(--gc-font-size-xs);
  font-weight: 800;
  white-space: nowrap;
}

.execution-list__pagination {
  justify-content: flex-end;
  border-top: var(--gc-border-width-default) solid var(--gc-color-border);
}

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

@media (max-width: 56.25rem) {
  .execution-list__header,
  .execution-list__pagination,
  .execution-detail-modal__hero {
    grid-template-columns: 1fr;
    align-items: flex-start;
  }

  .execution-list__header,
  .execution-list__pagination,
  .execution-detail-modal__hero {
    display: grid;
  }

  .execution-detail-modal__hero-side {
    justify-items: start;
  }

  .execution-detail-modal__facts,
  .execution-detail-modal__summary-grid {
    grid-template-columns: 1fr;
  }
}
</style>
