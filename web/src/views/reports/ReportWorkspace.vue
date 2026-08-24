<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePermissionStore } from '@/stores/permission.store'
import { translateDynamic } from '@/i18n/translate'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import {
  createReportRun,
  downloadReportRun,
  getReportItems,
  getReportOverview,
  getReportTrends,
  listReportRuns,
  type ReportItemPage,
  type ReportOverview,
  type ReportRun,
  type ReportTrendPoint,
  type ReportType
} from '@/api/modules/reports.api'

const props = defineProps<{ reportType: ReportType; titleKey: string; descriptionKey: string }>()
const { t, te, locale } = useI18n()
const permissions = usePermissionStore()
const overview = ref<ReportOverview | null>(null)
const trends = ref<ReportTrendPoint[]>([])
const items = ref<ReportItemPage | null>(null)
const runs = ref<ReportRun[]>([])
const selectedMetric = ref<string>()
const loading = ref(false)
const errorKey = ref<string>()
const exporting = ref(false)
const rangeDays = ref(30)
const environment = ref('')
const ownerId = ref('')
const assetId = ref('')
const tag = ref('')
const severity = ref('')
const riskType = ref('')
const automationId = ref('')
const failureStage = ref('')

const query = computed(() => {
  const dateTo = new Date()
  const dateFrom = new Date(dateTo.getTime() - rangeDays.value * 86_400_000)
  return {
    dateFrom: dateFrom.toISOString(),
    dateTo: dateTo.toISOString(),
    asOf: dateTo.toISOString(),
    environment: environment.value || undefined,
    ownerId: ownerId.value || undefined,
    assetId: assetId.value || undefined,
    tag: tag.value || undefined,
    severity: props.reportType === 'risk_response' ? severity.value || undefined : undefined,
    riskType: props.reportType === 'risk_response' ? riskType.value || undefined : undefined,
    automationId: props.reportType === 'automation_effectiveness' ? automationId.value || undefined : undefined,
    failureStage: props.reportType === 'automation_effectiveness' ? failureStage.value || undefined : undefined,
    page: 1,
    pageSize: 100
  }
})
const itemColumns = computed(() => [...new Set((items.value?.items ?? []).flatMap((item) => Object.keys(item)))].slice(0, 8))
const canExport = computed(() => permissions.hasPermission('report.export'))

onMounted(load)
watch(rangeDays, load)

async function load(): Promise<void> {
  loading.value = true
  errorKey.value = undefined
  try {
    const [overviewResult, trendResult, runResult] = await Promise.all([
      getReportOverview(props.reportType, query.value),
      getReportTrends(props.reportType, query.value),
      canExport.value ? listReportRuns() : Promise.resolve([])
    ])
    overview.value = overviewResult
    trends.value = trendResult
    runs.value = runResult.filter((run) => run.reportType === props.reportType)
    await loadItems(selectedMetric.value)
  } catch {
    errorKey.value = 'reports.common.loadFailed'
  } finally {
    loading.value = false
  }
}

function resetFilters(): void {
  environment.value = ''
  ownerId.value = ''
  assetId.value = ''
  tag.value = ''
  severity.value = ''
  riskType.value = ''
  automationId.value = ''
  failureStage.value = ''
  void load()
}

async function loadItems(metricKey?: string): Promise<void> {
  selectedMetric.value = metricKey
  items.value = await getReportItems(props.reportType, { ...query.value, metricKey })
}

async function exportCsv(): Promise<void> {
  exporting.value = true
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const run = await createReportRun(props.reportType, { ...query.value, metricKey: selectedMetric.value }, timeZone)
    runs.value = [run, ...runs.value.filter((item) => item.id !== run.id)]
    if (run.status === 'succeeded') await downloadReportRun(run.id)
  } catch {
    errorKey.value = 'reports.export.failed'
  } finally {
    exporting.value = false
  }
}

function displayMetricValue(metric: ReportOverview['metrics'][number]): string {
  if (metric.metricKey.endsWith('_rate')) return new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 1 }).format(metric.value)
  if (metric.metricKey.includes('average_seconds')) return t('reports.common.secondsValue', { value: metric.value })
  return new Intl.NumberFormat(locale.value).format(metric.value)
}

function displayCell(value: unknown): string {
  if (value === null || value === undefined) return t('reports.common.emptyValue')
  if (typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/u.test(value)) return formatBrowserLocalTime(value)
  return String(value)
}

function columnLabel(column: string): string {
  const key = `reports.columns.${column}`
  return te(key) ? t(key) : t('reports.columns.unknown', { name: column })
}

function groupLabel(kind: 'dimensions' | 'values', value: string): string {
  return translateDynamic(t, te, `reports.groups.${kind}`, value, 'reports.common.emptyValue')
}

function metricLabel(value: string): string {
  return translateDynamic(t, te, 'reports.metrics', value, 'reports.common.emptyValue')
}

function exportStatusLabel(value: string): string {
  return translateDynamic(t, te, 'reports.export.status', value, 'reports.common.emptyValue')
}
</script>

<template>
  <section class="report-page" :aria-label="t('reports.aria.reportPage')">
    <header class="report-header">
      <div>
        <h1>{{ t(titleKey) }}</h1>
        <p>{{ t(descriptionKey) }}</p>
        <small v-if="overview">{{ t('reports.common.dataAsOf', { time: formatBrowserLocalTime(overview.asOf) }) }}</small>
      </div>
      <button v-if="canExport" type="button" :disabled="exporting" @click="exportCsv">
        {{ exporting ? t('reports.export.generating') : t('reports.export.csv') }}
      </button>
    </header>

    <nav class="range-filter" :aria-label="t('reports.aria.rangeFilter')">
      <button v-for="days in [7, 30, 90]" :key="days" type="button" :class="{ active: rangeDays === days }" @click="rangeDays = days">
        {{ t('reports.common.rangeDays', { days }) }}
      </button>
    </nav>

    <form class="filter-panel" :aria-label="t('reports.aria.filters')" @submit.prevent="load">
      <label><span>{{ t('reports.filters.environment') }}</span><input v-model.trim="environment" type="text"></label>
      <label><span>{{ t('reports.filters.ownerId') }}</span><input v-model.trim="ownerId" type="text"></label>
      <label><span>{{ t('reports.filters.assetId') }}</span><input v-model.trim="assetId" type="text"></label>
      <label><span>{{ t('reports.filters.tag') }}</span><input v-model.trim="tag" type="text"></label>
      <template v-if="reportType === 'risk_response'">
        <label>
          <span>{{ t('reports.filters.severity') }}</span>
          <select v-model="severity">
            <option value="">{{ t('reports.filters.all') }}</option>
            <option v-for="value in ['critical', 'high', 'medium', 'low']" :key="value" :value="value">{{ groupLabel('values', value) }}</option>
          </select>
        </label>
        <label><span>{{ t('reports.filters.riskType') }}</span><input v-model.trim="riskType" type="text"></label>
      </template>
      <template v-if="reportType === 'automation_effectiveness'">
        <label><span>{{ t('reports.filters.automationId') }}</span><input v-model.trim="automationId" type="text"></label>
        <label>
          <span>{{ t('reports.filters.failureStage') }}</span>
          <select v-model="failureStage">
            <option value="">{{ t('reports.filters.all') }}</option>
            <option v-for="value in ['selection', 'plan_creation', 'dry_run', 'approval', 'execution', 'verification', 'rollback', 'notification']" :key="value" :value="value">{{ groupLabel('values', value) }}</option>
          </select>
        </label>
      </template>
      <div class="filter-actions">
        <button type="submit">{{ t('reports.filters.apply') }}</button>
        <button type="button" @click="resetFilters">{{ t('reports.filters.reset') }}</button>
      </div>
    </form>

    <p v-if="errorKey" class="error" role="alert">{{ t(errorKey) }}</p>
    <p v-if="loading" class="loading">{{ t('common.loading') }}</p>

    <div v-if="overview" class="metric-grid" :aria-label="t('reports.aria.metrics')">
      <button v-for="metric in overview.metrics" :key="metric.metricKey" type="button" class="metric-card" @click="loadItems(metric.metricKey)">
        <span>{{ t(metric.labelKey) }}</span>
        <strong>{{ displayMetricValue(metric) }}</strong>
        <small>{{ t('reports.common.samples', { count: metric.sampleCount }) }}</small>
      </button>
    </div>

    <section class="panel">
      <h2>{{ t('reports.common.trend') }}</h2>
      <table>
        <thead><tr><th>{{ t('reports.common.date') }}</th><th>{{ t('reports.common.snapshotMetrics') }}</th><th>{{ t('reports.common.completeness') }}</th></tr></thead>
        <tbody>
          <tr v-for="point in trends" :key="point.snapshotDate">
            <td>{{ point.snapshotDate }}</td>
            <td>{{ point.metrics.length }}</td>
            <td>{{ t(point.complete ? 'reports.common.complete' : 'reports.common.incomplete') }}</td>
          </tr>
          <tr v-if="trends.length === 0"><td colspan="3">{{ t('reports.common.noTrend') }}</td></tr>
        </tbody>
      </table>
    </section>

    <section class="panel">
      <h2>{{ t('reports.common.groupBreakdown') }}</h2>
      <div class="table-scroll">
        <table>
          <thead><tr><th>{{ t('reports.common.dimension') }}</th><th>{{ t('reports.common.groupValue') }}</th><th>{{ t('reports.common.count') }}</th></tr></thead>
          <tbody>
            <tr v-for="group in overview?.groups ?? []" :key="`${group.dimension}:${group.value}`">
              <td>{{ groupLabel('dimensions', group.dimension) }}</td>
              <td>{{ groupLabel('values', group.value) }}</td>
              <td>{{ group.count }}</td>
            </tr>
            <tr v-if="!overview?.groups.length"><td colspan="3">{{ t('reports.common.noGroups') }}</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <h2>{{ t('reports.common.drilldown') }}</h2>
      <p v-if="selectedMetric">{{ t('reports.common.selectedMetric', { metric: metricLabel(selectedMetric) }) }}</p>
      <div class="table-scroll">
        <table>
          <thead><tr><th v-for="column in itemColumns" :key="column">{{ columnLabel(column) }}</th></tr></thead>
          <tbody>
            <tr v-for="(item, index) in items?.items ?? []" :key="index"><td v-for="column in itemColumns" :key="column">{{ displayCell(item[column]) }}</td></tr>
            <tr v-if="!items?.items.length"><td :colspan="Math.max(itemColumns.length, 1)">{{ t('reports.common.noItems') }}</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="canExport" class="panel">
      <h2>{{ t('reports.export.history') }}</h2>
      <ul class="run-list">
        <li v-for="run in runs" :key="run.id">
          <span>{{ formatBrowserLocalTime(run.createdAt) }}</span>
          <span>{{ exportStatusLabel(run.status) }}</span>
          <button v-if="run.status === 'succeeded'" type="button" @click="downloadReportRun(run.id)">{{ t('reports.export.download') }}</button>
        </li>
        <li v-if="runs.length === 0">{{ t('reports.export.noHistory') }}</li>
      </ul>
    </section>
  </section>
</template>

<style scoped>
.report-page { display: grid; gap: var(--gc-space-5); }
.report-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--gc-space-4); }
h1, h2, p { margin: 0; }
h1 { color: var(--gc-color-text-strong); font-size: var(--gc-font-size-xl); }
h2 { color: var(--gc-color-text-strong); font-size: var(--gc-font-size-lg); }
p, small { color: var(--gc-color-text-muted); }
button { min-height: var(--gc-control-height-md); padding: 0 var(--gc-space-3); color: var(--gc-color-text); background: var(--gc-color-surface); border: var(--gc-border-width) solid var(--gc-color-border); border-radius: var(--gc-radius-sm); cursor: pointer; }
button:hover, button.active { color: var(--gc-color-primary); border-color: var(--gc-color-primary-border-strong); background: var(--gc-color-primary-soft); }
button:disabled { cursor: wait; opacity: var(--gc-opacity-disabled); }
.range-filter { display: flex; flex-wrap: wrap; gap: var(--gc-space-2); }
.filter-panel { display: grid; grid-template-columns: repeat(auto-fit, minmax(var(--gc-size-card-min), 1fr)); gap: var(--gc-space-3); padding: var(--gc-space-4); background: var(--gc-color-surface); border: var(--gc-border-width) solid var(--gc-color-border); border-radius: var(--gc-radius-md); }
.filter-panel label { display: grid; gap: var(--gc-space-1); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.filter-panel input, .filter-panel select { min-height: var(--gc-control-height-md); padding: 0 var(--gc-space-3); color: var(--gc-color-text); background: var(--gc-color-surface); border: var(--gc-border-width) solid var(--gc-color-border); border-radius: var(--gc-radius-sm); }
.filter-actions { display: flex; align-items: end; gap: var(--gc-space-2); }
.metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(var(--gc-size-card-min), 1fr)); gap: var(--gc-space-3); }
.metric-card { display: grid; gap: var(--gc-space-2); min-height: var(--gc-size-card-min); padding: var(--gc-space-4); text-align: left; box-shadow: var(--gc-shadow-sm); }
.metric-card strong { color: var(--gc-color-text-strong); font-size: var(--gc-font-size-xl); }
.panel { display: grid; gap: var(--gc-space-3); padding: var(--gc-space-4); background: var(--gc-color-surface); border: var(--gc-border-width) solid var(--gc-color-border); border-radius: var(--gc-radius-md); box-shadow: var(--gc-shadow-sm); }
.table-scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: var(--gc-space-3); text-align: left; border-bottom: var(--gc-border-width) solid var(--gc-color-border-subtle); color: var(--gc-color-text); }
th { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.run-list { display: grid; gap: var(--gc-space-2); padding: 0; margin: 0; list-style: none; }
.run-list li { display: flex; align-items: center; justify-content: space-between; gap: var(--gc-space-3); padding: var(--gc-space-2); background: var(--gc-color-surface-muted); border-radius: var(--gc-radius-sm); }
.error { padding: var(--gc-space-3); color: var(--gc-color-danger); background: var(--gc-color-danger-bg); border: var(--gc-border-width) solid var(--gc-color-danger-border); border-radius: var(--gc-radius-sm); }
.loading { color: var(--gc-color-info); }
</style>
