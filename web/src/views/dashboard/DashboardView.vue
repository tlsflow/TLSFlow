<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import {
  getDashboardOverview,
  getDashboardResources,
  type DashboardMetric,
  type DashboardOverview,
  type DashboardQuickAction,
  type DashboardStatusBlock,
  type DashboardStatusDetails,
  type DashboardStatusGroup,
} from '@/api/modules/dashboard.api'
import { usePermissionStore } from '@/stores/permission.store'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import { usePolling } from '@/composables/usePolling'
import { auditReadableTitle, auditResultLabel, auditSummary } from '@/utils/audit-format'
import type { StatusTone } from '@/design-system/status/status-map'
import { GcButton, GcStatusTag, GcTrendChart } from '@/design-system/components'
import CertificateAddModal from '@/views/certificates/CertificateAddModal.vue'

interface ResourceMetric {
  readonly key: 'cpu' | 'memory'
  readonly value: number | null
  readonly tone: StatusTone
}

interface QuickStartAction {
  readonly key: 'certificateImport' | 'deployment'
  readonly path?: string
  readonly opensCertificateSource?: boolean
  readonly label: string
  readonly emphasis: 'primary' | 'secondary'
}

const permissionStore = usePermissionStore()
const { t, te } = useI18n()
const overview = ref<DashboardOverview | null>(null)
const systemResources = ref<DashboardOverview['systemResources'] | null>(null)
const loading = ref(false)
const error = ref('')
const activeTooltip = ref<DashboardStatusBlock | null>(null)
const certificateAddOpen = ref(false)
let activeLoad: Promise<void> | null = null

const visibleQuickActions = computed(() =>
  (overview.value?.quickActions ?? []).filter((action) => permissionStore.hasPermission(action.permission)),
)

const quickStartActions = computed<readonly QuickStartAction[]>(() => {
  const actions: QuickStartAction[] = []

  if (permissionStore.hasPermission('certificate.import')) {
    actions.push({
      key: 'certificateImport',
      opensCertificateSource: true,
      label: t('dashboard.quickStart.addCertificate'),
      emphasis: 'secondary',
    })
  }

  if (permissionStore.hasPermission('service_asset.manage')) {
    actions.push({
      key: 'deployment',
      path: '/applications/onboarding',
      label: t('dashboard.quickStart.deployExistingApplication'),
      emphasis: 'primary',
    })
  }

  return actions
})

function openQuickStartAction(action: QuickStartAction): void {
  if (action.opensCertificateSource) certificateAddOpen.value = true
}

const topMetricKeys = ['validCertificates', 'expiringCertificates', 'applications', 'activeAgents', 'activeGateways']

const topMetrics = computed(() => topMetricKeys
  .map((key) => overview.value?.metrics.find((metric) => metric.key === key))
  .filter((metric): metric is DashboardMetric => Boolean(metric)))

const dashboardStatusDistribution = computed(() => {
  const values: Record<StatusTone, number> = {
    success: 0,
    warning: 0,
    danger: 0,
    info: 0,
    muted: 0,
  }

  for (const group of overview.value?.statusGroups ?? []) {
    for (const block of group.blocks) values[dashboardStatusTone(block.tone)] += 1
  }

  return (['success', 'warning', 'danger', 'info', 'muted'] as const)
    .map((tone) => ({ tone, value: values[tone] }))
})

const dashboardHealth = computed(() => {
  const blocks = (overview.value?.statusGroups ?? []).flatMap((group) => group.blocks)
  const abnormalCount = blocks.filter((block) => ['warning', 'error', 'unknown'].includes(block.tone)).length
  const healthyCount = blocks.filter((block) => block.tone === 'ok').length
  const total = blocks.length
  const evaluableCount = healthyCount + abnormalCount
  const tone: StatusTone = total === 0 || evaluableCount === 0
    ? 'muted'
    : blocks.some((block) => block.tone === 'error')
      ? 'danger'
      : abnormalCount > 0
        ? 'warning'
        : 'success'

  return {
    healthyCount,
    abnormalCount,
    total,
    percentage: evaluableCount ? Math.round((healthyCount / evaluableCount) * 100) : 0,
    tone,
  }
})

const resourceMetrics = computed<readonly ResourceMetric[]>(() => {
  const resources = systemResources.value ?? overview.value?.systemResources
  return [
    { key: 'cpu', value: resources?.cpuUsage ?? null, tone: resourceTone(resources?.cpuUsage ?? null) },
    { key: 'memory', value: resources?.memoryUsage ?? null, tone: resourceTone(resources?.memoryUsage ?? null) },
  ]
})

const trendCards = computed(() => {
  const audits = overview.value?.recentAudits ?? []
  const successCount = audits.filter((item) => item.result === 'success').length
  const successRate = audits.length ? Math.round((successCount / audits.length) * 1000) / 10 : null
  const statusObjects = (overview.value?.statusGroups ?? []).flatMap((group) => group.blocks)
  const certificateStatuses = overview.value?.certificateStatuses ?? []
  const attentionCertificates = certificateStatuses.filter((item) => ['critical', 'expired', 'expiring'].includes(item.state)).length

  return [
    {
      key: 'auditSuccess',
      title: t('dashboard.trends.auditSuccess.title'),
      value: successRate === null ? '--' : `${successRate}%`,
      suffix: t('dashboard.trends.auditSuccess.suffix'),
      delta: successRate === null ? t('dashboard.trends.noDelta') : `${successCount}/${audits.length}`,
      tone: successRate !== null && successRate < 90 ? 'warning' as StatusTone : 'success' as StatusTone,
      data: buildTimestampTrend(audits.map((item) => item.createdAt)),
    },
    {
      key: 'managedObjects',
      title: t('dashboard.trends.managedObjects.title'),
      value: statusObjects.length ? `${dashboardHealth.value.healthyCount}/${statusObjects.length}` : '--',
      suffix: t('dashboard.trends.managedObjects.suffix'),
      delta: dashboardHealth.value.total ? `${dashboardHealth.value.percentage}%` : t('dashboard.trends.noDelta'),
      tone: dashboardHealth.value.tone,
      data: buildTimestampTrend(statusObjects.map((item) => item.updatedAt)),
    },
    {
      key: 'certificateAttention',
      title: t('dashboard.trends.certificateAttention.title'),
      value: attentionCertificates,
      suffix: t('dashboard.trends.certificateAttention.suffix'),
      delta: certificateStatuses.length ? `${certificateStatuses.length - attentionCertificates}/${certificateStatuses.length}` : t('dashboard.trends.noDelta'),
      tone: attentionCertificates > 0 ? 'warning' as StatusTone : 'success' as StatusTone,
      data: buildTimestampTrend(certificateStatuses.map((item) => item.updatedAt)),
    },
  ]
})

async function loadOverview() {
  if (activeLoad) return activeLoad
  const request = loadOverviewOnce()
  activeLoad = request
  try {
    await request
  } finally {
    if (activeLoad === request) activeLoad = null
  }
}

async function loadOverviewOnce() {
  loading.value = true
  try {
    const result = await getDashboardOverview()
    if (!result.data) throw new Error(t('dashboard.errors.missingOverviewData'))
    overview.value = sanitizeDashboardOverview(result.data)
    systemResources.value = overview.value.systemResources
    error.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('dashboard.errors.loadFailed')
  } finally {
    loading.value = false
  }
}

function sanitizeDashboardOverview(value: DashboardOverview): DashboardOverview {
  // 旧服务可能把无活跃版本的证书资产作为 unknown 返回；没有版本 ID 的状态不能进入热力图。
  if (value.certificateStatuses.length === 0) return value
  const visibleCertificateAssetIds = new Set(
    value.certificateStatuses
      .filter((item) => Boolean(item.certificateVersionId))
      .map((item) => item.certificateAssetId),
  )
  const certificateStatuses = value.certificateStatuses.filter((item) => Boolean(item.certificateVersionId))
  const statusGroups = value.statusGroups.map((group) => {
    if (group.key !== 'certificates') return group
    const blocks = group.blocks.filter((block) => visibleCertificateAssetIds.has(block.id))
    return blocks.length === group.blocks.length && group.total === blocks.length
      ? group
      : { ...group, total: blocks.length, blocks }
  })
  return { ...value, certificateStatuses, statusGroups }
}

function resourceTone(value: number | null): StatusTone {
  if (value === null) return 'muted'
  if (value >= 85) return 'danger'
  if (value >= 70) return 'warning'
  return 'info'
}

async function loadSystemResources() {
  try {
    const result = await getDashboardResources()
    if (result.data) systemResources.value = result.data
  } catch {
    // 资源采样失败不能覆盖最近一次总览数据，也不阻塞结构化内容。
  }
}

usePolling(loadOverview, { intervalMs: 300_000, immediate: true })
usePolling(loadSystemResources, { intervalMs: 30_000, immediate: false })

onMounted(() => {
  window.addEventListener('dashboard:refresh', loadOverview)
})

onBeforeUnmount(() => {
  window.removeEventListener('dashboard:refresh', loadOverview)
})

function dashboardText(key: string, fallback: string, params?: Record<string, unknown>): string {
  return te(key) ? t(key, params ?? {}) : fallback
}

function resourceLabel(metric: ResourceMetric): string {
  return t(`dashboard.resources.${metric.key}`)
}

function resourceValue(metric: ResourceMetric): string {
  return metric.value === null ? '--' : `${metric.value}%`
}

function resourceAriaLabel(metric: ResourceMetric): string {
  return metric.value === null
    ? t('dashboard.resources.unavailableAria', { metric: resourceLabel(metric) })
    : t('dashboard.resources.usageAria', { metric: resourceLabel(metric), value: metric.value })
}

function metricTitle(metric: DashboardMetric): string {
  return dashboardText(`dashboard.metrics.${metric.key}.title`, metric.title)
}

function metricDescription(metric: DashboardMetric): string {
  return dashboardText(`dashboard.metrics.${metric.key}.description`, metric.description)
}

function metricTone(trend: DashboardMetric['trend']): StatusTone {
  if (trend === 'good') return 'success'
  if (trend === 'warning') return 'warning'
  if (trend === 'danger') return 'danger'
  return 'muted'
}

function metricIconPath(metric: DashboardMetric): string {
  const icons: Record<string, string> = {
    activeAgents: 'M7 5.5h10A2.5 2.5 0 0 1 19.5 8v8A2.5 2.5 0 0 1 17 18.5H7A2.5 2.5 0 0 1 4.5 16V8A2.5 2.5 0 0 1 7 5.5Zm2.5 4v.01M14 9.5h2.5M9.5 13h7',
    activeGateways: 'M12 3.5 19 7v5c0 4-2.4 7.5-7 9-4.6-1.5-7-5-7-9V7l7-3.5Zm-2.5 8 1.7 1.7 3.8-3.8',
    applications: 'M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 17.5v-11Zm4 1.5h6M9 12h6M9 16h3',
    expiringCertificates: 'M12 4.5a7.5 7.5 0 1 1-7.5 7.5M12 7v5l3 2M12 2.5v2M21.5 12h-2',
    validCertificates: 'M12 3.5 19 7v5c0 4-2.4 7.5-7 9-4.6-1.5-7-5-7-9V7l7-3.5Zm-2.5 8 1.7 1.7 3.8-3.8',
  }
  return icons[metric.key] ?? 'M12 5v14M5 12h14'
}

function quickActionTitle(action: DashboardQuickAction): string {
  return dashboardText(`dashboard.quickActions.${action.key}.title`, action.title)
}

function quickActionDescription(action: DashboardQuickAction): string {
  return dashboardText(`dashboard.quickActions.${action.key}.description`, action.description)
}

function statusGroupTitle(group: DashboardStatusGroup): string {
  return dashboardText(`dashboard.statusGroups.${group.key}.title`, group.title)
}

function statusGroupTone(group: DashboardStatusGroup): StatusTone {
  if (group.total === 0) return 'muted'
  if (group.blocks.some((block) => block.tone === 'error')) return 'danger'
  if (group.blocks.some((block) => block.tone === 'warning')) return 'warning'
  if (group.blocks.some((block) => block.tone === 'unknown')) return 'info'
  if (group.blocks.some((block) => block.tone === 'ok')) return 'success'
  return 'muted'
}

function statusGroupSummary(group: DashboardStatusGroup): string {
  if (group.total === 0) return t('dashboard.empty.noObjects')
  const abnormalCount = group.blocks.filter((block) => ['warning', 'error', 'unknown'].includes(block.tone)).length
  return abnormalCount > 0
    ? t('dashboard.statusGroups.summary.needsAttention', { count: abnormalCount })
    : t('dashboard.statusGroups.summary.allNormal')
}

function dashboardStatusTone(tone: DashboardStatusBlock['tone']): StatusTone {
  if (tone === 'ok') return 'success'
  if (tone === 'warning') return 'warning'
  if (tone === 'error') return 'danger'
  if (tone === 'unknown') return 'info'
  return 'muted'
}

function dashboardStatusToneLabel(tone: StatusTone): string {
  if (tone === 'success') return t('dashboard.legend.ok')
  if (tone === 'warning') return t('dashboard.legend.warning')
  if (tone === 'danger') return t('dashboard.legend.error')
  if (tone === 'info') return t('dashboard.legend.unknown')
  return t('dashboard.legend.disabled')
}

function statusBlockStatus(block: DashboardStatusBlock): string {
  const normalized = normalizeDashboardStatus(block.status)
  return normalized ? dashboardText(`dashboard.statusBlock.status.${normalized}`, block.status) : block.status
}

function blockTitle(group: DashboardStatusGroup, block: DashboardStatusBlock): string {
  return [
    block.label,
    statusBlockStatus(block),
    block.detail,
    block.updatedAt ? formatBrowserLocalTime(block.updatedAt, { includeSeconds: false }) : '',
  ].filter(Boolean).join(' / ')
}

function statusDetailRows(details?: DashboardStatusDetails): Array<{ label: string; value: string }> {
  if (!details) return []
  const rows: Array<{ label: string; value: string }> = []
  const add = (label: string, value: string | number | undefined) => {
    rows.push({ label, value: value === undefined || value === '' ? '--' : String(value) })
  }
  if (details.type === 'certificate') {
    add(t('dashboard.statusBlock.tooltip.name'), details.name)
    add(t('dashboard.statusBlock.tooltip.issuer'), details.issuer)
    add(t('dashboard.statusBlock.tooltip.startTime'), details.notBefore ? formatBrowserLocalTime(details.notBefore, { includeSeconds: false }) : undefined)
    add(t('dashboard.statusBlock.tooltip.endTime'), details.notAfter ? formatBrowserLocalTime(details.notAfter, { includeSeconds: false }) : undefined)
    add(t('dashboard.statusBlock.tooltip.daysRemaining'), details.daysRemaining)
  } else if (details.type === 'device') {
    add(t('dashboard.statusBlock.tooltip.name'), details.name)
    add(t('dashboard.statusBlock.tooltip.connectionStatus'), statusBlockStatus({ status: details.connectionStatus } as DashboardStatusBlock))
    add(t('dashboard.statusBlock.tooltip.version'), details.version)
    add(t('dashboard.statusBlock.tooltip.managementAddress'), details.managementAddress)
    add(t('dashboard.statusBlock.tooltip.lastCommunicationTime'), details.lastCommunicationAt ? formatBrowserLocalTime(details.lastCommunicationAt, { includeSeconds: false }) : undefined)
  } else if (details.type === 'applicationAsset') {
    add(t('dashboard.statusBlock.tooltip.name'), details.name)
    add(t('dashboard.statusBlock.tooltip.platform'), details.platform)
    add(t('dashboard.statusBlock.tooltip.protocolPort'), details.protocolPort)
    add(t('dashboard.statusBlock.tooltip.certificateDaysRemaining'), details.certificateDaysRemaining)
  } else {
    add(t('dashboard.statusBlock.tooltip.name'), details.name)
    add(t('dashboard.statusBlock.tooltip.region'), details.region)
    add(t('dashboard.statusBlock.tooltip.latency'), details.latencyMs === undefined ? undefined : `${details.latencyMs} ms`)
  }
  return rows
}

function normalizeDashboardStatus(value: string): string {
  const map: Record<string, string> = {
    正常: 'valid',
    即将到期: 'expiring',
    临近到期: 'critical',
    已过期: 'expired',
    ACTIVE: 'active',
    DISABLED: 'disabled',
    OFFLINE: 'offline',
    ONLINE: 'online',
    active: 'active',
    disabled: 'disabled',
    offline: 'offline',
    online: 'online',
    stale: 'stale',
    unreachable: 'unreachable',
  }
  return map[value] ?? ''
}

function auditTone(result: string): StatusTone {
  if (result === 'success') return 'success'
  if (result === 'failure') return 'danger'
  if (result === 'denied') return 'warning'
  return 'info'
}

function auditIconPath(result: string): string {
  if (result === 'success') return 'M12 3.5 19 7v5c0 4-2.4 7.5-7 9-4.6-1.5-7-5-7-9V7l7-3.5Zm-2.5 8 1.7 1.7 3.8-3.8'
  if (result === 'failure') return 'M12 3.5 20 18.5H4L12 3.5Zm0 5v4M12 15.5h.01'
  if (result === 'denied') return 'M7 7l10 10M17 7 7 17M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Z'
  return 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Zm0 5v.01M12 11v5'
}

function buildTimestampTrend(values: readonly (string | undefined)[]) {
  const timestamps = values
    .map((value) => (value ? Date.parse(value) : Number.NaN))
    .filter((value): value is number => Number.isFinite(value))
    .sort((left, right) => left - right)
  if (timestamps.length < 2) return []
  const start = timestamps[0]
  const end = timestamps[timestamps.length - 1]
  if (end <= start) return []
  const bucketCount = Math.min(8, timestamps.length)
  const bucketSize = (end - start) / bucketCount
  const buckets = Array.from({ length: bucketCount }, () => 0)
  for (const timestamp of timestamps) {
    const index = Math.min(bucketCount - 1, Math.floor((timestamp - start) / bucketSize))
    buckets[index] += 1
  }
  return buckets.map((value) => ({ value }))
}
</script>

<template>
  <section class="gc-page dashboard-page">
    <div v-if="error" class="dashboard-page__error" role="alert">
      <span>{{ error }}</span>
      <GcButton variant="secondary" @click="loadOverview">{{ t('businessPage.retry') }}</GcButton>
    </div>

    <section class="dashboard-primary-grid" :aria-label="t('dashboard.aria.metrics')">
      <div class="dashboard-metric-grid" :aria-busy="loading && !overview">
        <article class="dashboard-resource-card">
          <header class="dashboard-card-header">
            <h2>{{ t('dashboard.resources.title') }}</h2>
          </header>
          <div class="dashboard-resource-list">
            <div v-for="metric in resourceMetrics" :key="metric.key" class="dashboard-resource-row">
              <div class="dashboard-resource-row__label">
                <span>{{ resourceLabel(metric) }}</span>
                <strong>{{ resourceValue(metric) }}</strong>
              </div>
              <div class="dashboard-resource-track" role="progressbar" :aria-label="resourceAriaLabel(metric)" :aria-valuemin="0" :aria-valuemax="100" :aria-valuenow="metric.value ?? undefined">
                <span :class="`dashboard-resource-track__fill dashboard-resource-track__fill--${metric.tone}`" :style="{ width: `${metric.value ?? 0}%` }" />
              </div>
            </div>
          </div>
        </article>

        <template v-if="topMetrics.length">
          <article v-for="metric in topMetrics" :key="metric.key" class="dashboard-metric-card" :class="`dashboard-metric-card--${metricTone(metric.trend)}`">
            <div class="dashboard-metric-card__topline">
              <span class="dashboard-metric-card__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path :d="metricIconPath(metric)" /></svg>
              </span>
              <strong class="dashboard-metric-card__value">{{ metric.value }}</strong>
            </div>
            <span class="dashboard-metric-card__title">{{ metricTitle(metric) }}</span>
            <span class="dashboard-metric-card__description">{{ metricDescription(metric) }}</span>
          </article>
        </template>

        <template v-else-if="loading">
          <article v-for="index in 5" :key="index" class="dashboard-metric-card dashboard-metric-card--loading">
            <div class="dashboard-metric-card__topline">
              <span class="dashboard-metric-card__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
              </span>
              <strong class="dashboard-metric-card__value">--</strong>
            </div>
            <span class="dashboard-metric-card__title">{{ t('dashboard.loading.title') }}</span>
            <span class="dashboard-metric-card__description">{{ t('dashboard.loading.description') }}</span>
          </article>
        </template>
      </div>

      <section class="dashboard-quick-start" :aria-label="t('dashboard.quickStart.title')">
        <div class="dashboard-quick-start__content">
          <span class="dashboard-quick-start__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="m13 2-8 12h6l-1 8 9-13h-6l0-7Z" /></svg>
          </span>
          <h2>{{ t('dashboard.quickStart.title') }}</h2>
          <p>{{ t('dashboard.quickStart.description') }}</p>
        </div>
        <div class="dashboard-quick-start__footer">
          <component
            :is="action.opensCertificateSource ? 'button' : RouterLink"
            v-for="action in quickStartActions"
            :key="action.key"
            type="button"
            class="dashboard-quick-start__button"
            :class="`dashboard-quick-start__button--${action.emphasis}`"
            :to="action.path"
            @click="openQuickStartAction(action)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 8v8M8 12h8" /></svg>
            {{ action.label }}
          </component>
          <span v-if="quickStartActions.length === 0" class="dashboard-quick-start__button dashboard-quick-start__button--disabled">{{ t('dashboard.quickStart.unavailable') }}</span>
        </div>
      </section>
    </section>

    <section class="dashboard-trend-grid" :aria-label="t('dashboard.trends.title')">
      <article v-for="card in trendCards" :key="card.key" class="dashboard-trend-card">
        <div class="dashboard-trend-card__heading">
          <span>{{ card.title }}</span>
          <strong :class="`dashboard-trend-card__delta dashboard-trend-card__delta--${card.tone}`">{{ card.delta }}</strong>
        </div>
        <div class="dashboard-trend-card__value">
          <strong>{{ card.value }}</strong>
          <span>{{ card.suffix }}</span>
        </div>
        <GcTrendChart :data="card.data" :tone="card.tone" :ariaLabel="card.title" :emptyLabel="t('dashboard.empty.noTrend')" />
      </article>
    </section>

    <section class="dashboard-status-row">
      <section class="dashboard-panel dashboard-panel--asset-heatmap" :aria-label="t('dashboard.aria.statusHeatmap')">
        <header class="dashboard-panel__header">
          <div>
            <h2>{{ t('dashboard.aria.statusHeatmap') }}</h2>
            <p v-if="overview?.generatedAt">{{ t('dashboard.assets.updatedAt', { time: formatBrowserLocalTime(overview.generatedAt) }) }}</p>
          </div>
        </header>
        <div v-if="overview?.statusGroups.length" class="dashboard-status-groups">
          <section v-for="group in overview.statusGroups" :key="group.key" class="dashboard-status-group">
            <header class="dashboard-status-group__header">
              <div class="dashboard-status-group__title">
                <span class="dashboard-status-group__dot" :class="`dashboard-status-group__dot--${statusGroupTone(group)}`" aria-hidden="true" />
                <strong>{{ statusGroupTitle(group) }}</strong>
              </div>
              <strong class="dashboard-status-group__total">{{ group.total }}</strong>
            </header>
            <p class="dashboard-status-group__summary">{{ statusGroupSummary(group) }}</p>
            <div v-if="group.blocks.length" class="dashboard-heatmap__blocks">
              <span v-for="block in group.blocks" :key="block.id" class="dashboard-heatmap__block-wrap" :class="{ 'dashboard-heatmap__block-wrap--tooltip-open': activeTooltip?.id === block.id }" @mouseenter="activeTooltip = block" @mouseleave="activeTooltip = null" @focusin="activeTooltip = block" @focusout="activeTooltip = null">
                <component :is="block.targetPath ? RouterLink : 'span'" class="dashboard-heatmap__block" :class="`dashboard-heatmap__block--${block.tone}`" :to="block.targetPath || undefined" :tabindex="block.targetPath ? undefined : 0" :aria-label="blockTitle(group, block)" />
                <span v-if="activeTooltip?.id === block.id" class="dashboard-heatmap__tooltip" role="tooltip">
                  <strong>{{ block.label }}</strong>
                  <span v-for="row in statusDetailRows(block.details)" :key="row.label" class="dashboard-heatmap__tooltip-row">
                    <b>{{ row.label }}</b>{{ row.value }}
                  </span>
                  <time v-if="!block.details && block.updatedAt">{{ formatBrowserLocalTime(block.updatedAt, { includeSeconds: false }) }}</time>
                </span>
              </span>
            </div>
            <div v-else class="dashboard-heatmap__empty">{{ t('dashboard.empty.noObjects') }}</div>
          </section>
        </div>
        <div v-else class="dashboard-empty">{{ t('dashboard.empty.noObjects') }}</div>
        <footer class="dashboard-heatmap__legend" :aria-label="t('dashboard.aria.statusLegend')">
          <span v-for="item in dashboardStatusDistribution" :key="item.tone">
            <i :class="`dashboard-heatmap__legend-dot dashboard-heatmap__legend-dot--${item.tone}`" aria-hidden="true" />
            {{ dashboardStatusToneLabel(item.tone) }}
          </span>
        </footer>
      </section>

      <section class="dashboard-panel dashboard-panel--wizard" :aria-label="t('dashboard.quickWizard.title')">
        <header class="dashboard-panel__header">
          <div>
            <h2>{{ t('dashboard.quickWizard.title') }}</h2>
          </div>
        </header>
        <nav v-if="visibleQuickActions.length" class="dashboard-wizard" :aria-label="t('dashboard.aria.quickActions')">
          <RouterLink v-for="(action, index) in visibleQuickActions" :key="action.key" class="dashboard-wizard__step" :to="action.path">
            <span class="dashboard-wizard__index">{{ index + 1 }}</span>
            <span class="dashboard-wizard__content">
              <strong>{{ quickActionTitle(action) }}</strong>
              <small>{{ quickActionDescription(action) }}</small>
            </span>
            <span class="dashboard-wizard__arrow" aria-hidden="true">→</span>
          </RouterLink>
        </nav>
        <div v-else class="dashboard-empty">{{ t('dashboard.empty.noQuickActions') }}</div>
      </section>
    </section>

    <section class="dashboard-audit-row">
      <section class="dashboard-panel dashboard-panel--recent-log" :aria-label="t('dashboard.recentLog.title')">
        <header class="dashboard-panel__header dashboard-panel__header--compact">
          <div>
            <h2>{{ t('dashboard.recentLog.title') }}</h2>
          </div>
          <span class="dashboard-live-indicator"><i aria-hidden="true" />{{ t('dashboard.recentLog.live') }}</span>
        </header>
        <ol class="dashboard-audits">
          <li v-for="item in overview?.recentAudits ?? []" :key="item.id">
            <span class="dashboard-audits__icon" :class="`dashboard-audits__icon--${auditTone(item.result)}`" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path :d="auditIconPath(item.result)" /></svg>
            </span>
            <div class="dashboard-audits__body">
              <div class="dashboard-audits__title-row">
                <strong>{{ auditReadableTitle(item, t) }}</strong>
                <GcStatusTag :status="item.result" :label="auditResultLabel(item.result, t)" :tone="auditTone(item.result)" />
              </div>
              <p>{{ auditSummary(item, t) }}</p>
              <time>{{ formatBrowserLocalTime(item.createdAt, { includeSeconds: false }) }}</time>
            </div>
          </li>
        </ol>
        <div v-if="overview && overview.recentAudits.length === 0" class="dashboard-empty">{{ t('dashboard.empty.noAuditLogs') }}</div>
      </section>
    </section>

    <CertificateAddModal v-model:open="certificateAddOpen" @imported="loadOverview" />
  </section>
</template>

<style scoped>
.dashboard-page {
  gap: var(--gc-space-6);
  min-width: 0;
  padding: var(--gc-space-6);
  background: transparent;
}

.dashboard-card-header,
.dashboard-panel__header,
.dashboard-trend-card__heading,
.dashboard-metric-card__topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-3);
  min-width: 0;
}

.dashboard-panel__header h2,
.dashboard-panel__header p,
.dashboard-card-header h2 {
  margin: 0;
}

.dashboard-page__error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-danger-border);
  border-radius: var(--gc-radius-card);
  padding: var(--gc-space-3) var(--gc-space-4);
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-bg);
  font-weight: var(--gc-font-weight-semibold);
}

.dashboard-primary-grid {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(calc(var(--gc-size-card-min) + var(--gc-space-10)), 1fr);
  gap: var(--gc-space-6);
  align-items: stretch;
}

.dashboard-metric-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-auto-rows: calc(var(--gc-space-12) + var(--gc-space-12) + var(--gc-space-12) + var(--gc-space-compact));
  gap: var(--gc-space-3);
  min-width: 0;
}

.dashboard-resource-card,
.dashboard-metric-card,
.dashboard-trend-card,
.dashboard-panel {
  min-width: 0;
  border: var(--gc-border-width-default) solid var(--gc-color-border-subtle);
  border-radius: var(--gc-radius-xl);
  background: var(--gc-color-surface-workspace-glass);
  box-shadow: var(--gc-shadow-card);
  backdrop-filter: blur(var(--gc-space-4));
  -webkit-backdrop-filter: blur(var(--gc-space-4));
}

.dashboard-resource-card,
.dashboard-metric-card,
.dashboard-trend-card {
  padding: var(--gc-space-4);
}

.dashboard-resource-card {
  display: grid;
  align-content: start;
  gap: var(--gc-space-2);
  padding: var(--gc-space-3);
}

.dashboard-card-header h2 {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-body);
  font-weight: 800;
}

.dashboard-resource-list {
  display: grid;
  gap: var(--gc-space-2);
}

.dashboard-resource-row {
  display: grid;
  gap: var(--gc-space-1);
}

.dashboard-resource-row__label {
  display: flex;
  justify-content: space-between;
  gap: var(--gc-space-3);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
}

.dashboard-resource-row__label strong {
  color: var(--gc-color-text-strong);
}

.dashboard-resource-track {
  height: var(--gc-space-compact);
  overflow: hidden;
  border-radius: var(--gc-radius-full);
  background: var(--gc-color-surface-muted);
}

.dashboard-resource-track__fill {
  display: block;
  height: 100%;
  min-width: 0;
  border-radius: inherit;
  transition: width 180ms ease;
}

.dashboard-resource-track__fill--info { background: var(--gc-color-info); }
.dashboard-resource-track__fill--success { background: var(--gc-color-success); }
.dashboard-resource-track__fill--warning { background: var(--gc-color-warning); }
.dashboard-resource-track__fill--danger { background: var(--gc-color-danger); }
.dashboard-resource-track__fill--muted { background: var(--gc-color-muted); }

.dashboard-metric-card {
  display: grid;
  align-content: space-between;
  gap: var(--gc-space-1);
}

.dashboard-metric-card__topline {
  align-items: flex-start;
}

.dashboard-metric-card__icon,
.dashboard-quick-start__icon {
  display: grid;
  place-items: center;
  width: var(--gc-space-8);
  height: var(--gc-space-8);
  border-radius: var(--gc-radius-md);
  color: var(--gc-color-primary);
  background: var(--gc-color-primary-soft);
}

.dashboard-metric-card__icon svg,
.dashboard-quick-start__icon svg {
  width: var(--gc-size-icon-md);
  height: var(--gc-size-icon-md);
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: var(--gc-border-width-thick);
}

.dashboard-metric-card--warning .dashboard-metric-card__icon { color: var(--gc-color-warning); background: var(--gc-color-warning-soft); }
.dashboard-metric-card--danger .dashboard-metric-card__icon { color: var(--gc-color-danger); background: var(--gc-color-danger-soft); }
.dashboard-metric-card--success .dashboard-metric-card__icon { color: var(--gc-color-success); background: var(--gc-color-success-soft); }

.dashboard-metric-card__value {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-heading-sm);
  font-weight: 800;
  line-height: var(--gc-line-height-tight);
}

.dashboard-metric-card__title {
  color: var(--gc-color-text-secondary);
  font-size: var(--gc-font-size-xs);
  font-weight: 700;
}

.dashboard-metric-card__description {
  color: var(--gc-color-text-soft);
  font-size: var(--gc-font-size-caption);
  line-height: var(--gc-line-height-relaxed);
}

.dashboard-metric-card--loading { opacity: var(--gc-opacity-disabled); }

.dashboard-quick-start {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: var(--gc-space-4);
  min-width: 0;
  min-height: 100%;
  position: relative;
  overflow: hidden;
  border: var(--gc-border-width-default) solid var(--gc-color-primary-border);
  border-radius: var(--gc-radius-xl);
  padding: var(--gc-space-5);
  background: linear-gradient(135deg, var(--gc-color-primary-weak), var(--gc-color-surface-glass));
  box-shadow: var(--gc-shadow-card);
}

.dashboard-quick-start__content {
  position: relative;
  z-index: 1;
  display: grid;
  align-content: start;
  gap: var(--gc-space-3);
}

.dashboard-quick-start__content h2 {
  max-width: 16ch;
  margin: 0;
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-heading-xs);
  line-height: var(--gc-line-height-tight);
  font-weight: 800;
}

.dashboard-quick-start__content p {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  line-height: var(--gc-line-height-relaxed);
}

.dashboard-quick-start__footer {
  position: relative;
  z-index: 1;
  display: grid;
  gap: var(--gc-space-3);
}

.dashboard-quick-start__button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--gc-space-2);
  min-height: calc(var(--gc-control-height-comfortable) + var(--gc-space-hairline));
  border-radius: var(--gc-radius-lg);
  padding: 0 var(--gc-space-4);
  color: var(--gc-color-text-inverse);
  background: var(--gc-color-primary);
  box-shadow: var(--gc-shadow-button-primary);
  font-size: var(--gc-font-size-sm);
  font-weight: 800;
  text-align: center;
}

.dashboard-quick-start__button svg {
  width: var(--gc-size-icon-sm);
  height: var(--gc-size-icon-sm);
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: var(--gc-border-width-thick);
}

.dashboard-quick-start__button:hover { background: var(--gc-color-primary-hover); }
.dashboard-quick-start__button--secondary {
  border: var(--gc-border-width-default) solid var(--gc-color-primary-border);
  color: var(--gc-color-primary-strong);
  background: var(--gc-color-primary-soft);
  box-shadow: none;
}
.dashboard-quick-start__button--secondary:hover { background: var(--gc-color-primary-bg); }
.dashboard-quick-start__button--disabled { color: var(--gc-color-text-muted); background: var(--gc-color-surface-muted); box-shadow: none; }

.dashboard-trend-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-auto-rows: calc(var(--gc-space-12) + var(--gc-space-12) + var(--gc-space-12) + var(--gc-space-compact));
  gap: var(--gc-space-6);
}

.dashboard-trend-card {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: var(--gc-space-1);
  height: 100%;
  min-height: 0;
  overflow: hidden;
  padding: var(--gc-space-2);
}

.dashboard-trend-card__heading {
  color: var(--gc-color-text-secondary);
  font-size: var(--gc-font-size-sm);
}

.dashboard-trend-card__delta {
  font-size: var(--gc-font-size-xs);
}

.dashboard-trend-card__delta--success { color: var(--gc-color-success); }
.dashboard-trend-card__delta--warning { color: var(--gc-color-warning); }
.dashboard-trend-card__delta--danger { color: var(--gc-color-danger); }
.dashboard-trend-card__delta--info { color: var(--gc-color-info); }
.dashboard-trend-card__delta--muted { color: var(--gc-color-text-soft); }

.dashboard-trend-card__value {
  display: flex;
  align-items: baseline;
  gap: var(--gc-space-2);
}

.dashboard-trend-card__value strong {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-heading-sm);
  font-weight: 800;
}

.dashboard-trend-card__value span {
  color: var(--gc-color-text-soft);
  font-size: var(--gc-font-size-xs);
}

.dashboard-trend-card :deep(.gc-trend-chart) {
  align-self: end;
  min-width: 0;
  min-height: 0;
  height: 100%;
  max-height: calc(var(--gc-space-12) + var(--gc-space-compact));
  margin-top: 0;
  aspect-ratio: auto;
}

.dashboard-trend-card :deep(.gc-trend-chart__canvas) { overflow: hidden; }

.dashboard-status-row {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(calc(var(--gc-size-card-min) + var(--gc-space-8)), 1fr);
  gap: var(--gc-space-6);
  align-items: stretch;
}

.dashboard-audit-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--gc-space-6);
}

.dashboard-panel {
  overflow: hidden;
}

.dashboard-panel--asset-heatmap {
  overflow: visible;
}

.dashboard-panel--wizard {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.dashboard-panel__header {
  align-items: flex-start;
  padding: var(--gc-space-6) var(--gc-space-6) var(--gc-space-4);
  background: transparent;
}

.dashboard-panel__header--compact { align-items: center; }

.dashboard-panel__header h2 {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-heading-xs);
  line-height: var(--gc-line-height-tight);
  font-weight: 800;
}

.dashboard-panel__header p {
  margin-top: var(--gc-space-1);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  line-height: var(--gc-line-height-relaxed);
}

.dashboard-status-group__dot {
  display: block;
  border-radius: var(--gc-radius-full);
  background: var(--gc-color-muted);
}

.dashboard-status-group__dot { width: var(--gc-space-2); height: var(--gc-space-2); flex: 0 0 auto; }
.dashboard-status-group__dot--success { background: var(--gc-color-success); }
.dashboard-status-group__dot--warning { background: var(--gc-color-warning); }
.dashboard-status-group__dot--danger { background: var(--gc-color-danger); }
.dashboard-status-group__dot--info { background: var(--gc-color-info); }
.dashboard-status-group__dot--muted { background: var(--gc-color-muted); }

.dashboard-status-groups {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0;
  padding: 0 var(--gc-space-6) var(--gc-space-4);
  border-top: 0;
}

.dashboard-status-group {
  display: grid;
  grid-template-columns: minmax(calc(var(--gc-size-card-min) - var(--gc-space-5)), 0.8fr) minmax(0, 2fr);
  grid-template-rows: auto auto;
  column-gap: var(--gc-space-5);
  row-gap: var(--gc-space-1);
  min-width: 0;
  padding: var(--gc-space-3) 0;
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border-subtle);
  background: transparent;
}

.dashboard-status-group:last-child { border-bottom: 0; }

.dashboard-status-group__header,
.dashboard-status-group__title {
  display: flex;
  align-items: center;
  min-width: 0;
}

.dashboard-status-group__header { justify-content: space-between; gap: var(--gc-space-3); }
.dashboard-status-group__title { gap: var(--gc-space-2); }
.dashboard-status-group__title strong { color: var(--gc-color-text-strong); font-size: var(--gc-font-size-sm); }
.dashboard-status-group__total { color: var(--gc-color-text-strong); font-size: var(--gc-font-size-md); font-weight: 800; }
.dashboard-status-group__header,
.dashboard-status-group__summary { grid-column: 1; }
.dashboard-status-group__summary {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-caption);
  line-height: var(--gc-line-height-tight);
}

.dashboard-heatmap__blocks {
  grid-column: 2;
  grid-row: 1 / span 2;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: var(--gc-space-2);
  min-height: var(--gc-space-8);
  overflow: visible;
  padding: var(--gc-space-1) 0;
}

.dashboard-heatmap__block-wrap { position: relative; z-index: 0; display: block; min-width: 0; }
.dashboard-heatmap__block-wrap--tooltip-open { z-index: 2; }
.dashboard-heatmap__block { display: block; width: var(--gc-space-8); height: var(--gc-space-8); border: var(--gc-border-width-default) solid var(--dashboard-block-tone, var(--gc-color-muted)); border-radius: var(--gc-radius-sm); background: var(--dashboard-block-tone, var(--gc-color-muted)); box-shadow: inset 0 var(--gc-border-width-thick) 0 var(--gc-color-border-strong), var(--gc-shadow-sm); transition: transform 160ms ease, box-shadow 160ms ease; }
.dashboard-heatmap__block:hover { transform: translateY(calc(var(--gc-space-tight) * -1)); box-shadow: inset 0 var(--gc-border-width-thick) 0 var(--gc-color-border-strong), var(--gc-shadow-md); }
.dashboard-heatmap__block--ok { --dashboard-block-tone: var(--gc-color-success); }
.dashboard-heatmap__block--warning { --dashboard-block-tone: var(--gc-color-warning); }
.dashboard-heatmap__block--error { --dashboard-block-tone: var(--gc-color-danger); }
.dashboard-heatmap__block--unknown { --dashboard-block-tone: var(--gc-color-info); }
.dashboard-heatmap__block--disabled { --dashboard-block-tone: var(--gc-color-muted); }

.dashboard-heatmap__tooltip {
  position: absolute;
  left: 50%;
  bottom: calc(100% + var(--gc-space-2));
  z-index: 1;
  display: grid;
  gap: var(--gc-space-1);
  width: max-content;
  min-width: var(--gc-size-card-min);
  max-width: calc(var(--gc-size-card-min) + var(--gc-space-12));
  padding: var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border-strong);
  border-radius: var(--gc-radius-md);
  color: var(--gc-color-text);
  background: var(--gc-color-surface-overlay);
  box-shadow: var(--gc-shadow-lg);
  transform: translateX(-50%);
  pointer-events: none;
}

.dashboard-heatmap__tooltip strong { color: var(--gc-color-text-strong); font-size: var(--gc-font-size-sm); }
.dashboard-heatmap__tooltip span,
.dashboard-heatmap__tooltip time { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); }
.dashboard-heatmap__tooltip-row { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--gc-space-2); overflow-wrap: anywhere; }
.dashboard-heatmap__tooltip-row b { color: var(--gc-color-text-soft); font-weight: var(--gc-font-weight-medium); }

.dashboard-heatmap__legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gc-space-4);
  padding: var(--gc-space-3) var(--gc-space-6) var(--gc-space-4);
  border-top: var(--gc-border-width-default) solid var(--gc-color-border-subtle);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.dashboard-heatmap__legend span { display: inline-flex; align-items: center; gap: var(--gc-space-2); }
.dashboard-heatmap__legend-dot { width: var(--gc-space-2); height: var(--gc-space-2); border-radius: var(--gc-radius-sm); background: var(--gc-color-muted); }
.dashboard-heatmap__legend-dot--success { background: var(--gc-color-success); }
.dashboard-heatmap__legend-dot--warning { background: var(--gc-color-warning); }
.dashboard-heatmap__legend-dot--danger { background: var(--gc-color-danger); }
.dashboard-heatmap__legend-dot--info { background: var(--gc-color-info); }
.dashboard-heatmap__legend-dot--muted { background: var(--gc-color-muted); }

.dashboard-wizard {
  display: grid;
  flex: 1 1 auto;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--gc-size-card-min)), 1fr));
  grid-auto-rows: minmax(var(--gc-size-step-min-height), 1fr);
  gap: var(--gc-space-2);
  min-width: 0;
  padding: 0 var(--gc-space-5) var(--gc-space-5);
}
.dashboard-wizard__step { display: grid; grid-template-columns: var(--gc-size-step-index) minmax(0, 1fr) max-content; align-items: center; gap: var(--gc-space-3); min-width: 0; min-height: 0; padding: var(--gc-space-3); border: var(--gc-border-width-default) solid transparent; border-radius: var(--gc-radius-lg); color: var(--gc-color-text); }
.dashboard-wizard__step:last-child { border-bottom: 0; }
.dashboard-wizard__step:hover { border-color: var(--gc-color-primary-border); background: var(--gc-color-primary-soft); }
.dashboard-wizard__index { display: grid; place-items: center; width: var(--gc-size-step-index); height: var(--gc-size-step-index); border-radius: var(--gc-radius-full); color: var(--gc-color-primary-strong); background: var(--gc-color-primary-soft); font-size: var(--gc-font-size-sm); font-weight: 800; }
.dashboard-wizard__content { display: grid; gap: var(--gc-space-1); min-width: 0; }
.dashboard-wizard__content strong,
.dashboard-wizard__content small { min-width: 0; overflow-wrap: anywhere; }
.dashboard-wizard__content strong { color: var(--gc-color-text-strong); font-size: var(--gc-font-size-sm); }
.dashboard-wizard__content small { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); line-height: var(--gc-line-height-relaxed); }
.dashboard-wizard__arrow { color: var(--gc-color-primary); font-size: var(--gc-font-size-lg); font-weight: 800; }

.dashboard-live-indicator { display: inline-flex; align-items: center; gap: var(--gc-space-2); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); font-weight: var(--gc-font-weight-semibold); }
.dashboard-live-indicator i { width: var(--gc-space-2); height: var(--gc-space-2); border-radius: var(--gc-radius-full); background: var(--gc-color-success); }

.dashboard-audits { display: grid; grid-template-columns: minmax(0, 1fr); max-height: var(--gc-size-log-viewer-max-height); margin: 0; padding: var(--gc-space-2) var(--gc-space-3) var(--gc-space-3); overflow: auto; list-style: none; }
.dashboard-audits li { display: grid; grid-template-columns: var(--gc-space-8) minmax(0, 1fr); gap: var(--gc-space-3); align-items: start; min-width: 0; padding: var(--gc-space-3); border-radius: var(--gc-radius-lg); }
.dashboard-audits li:hover { background: var(--gc-color-surface-muted); }
.dashboard-audits li:last-child { border-bottom: 0; }
.dashboard-audits__icon { display: grid; place-items: center; width: var(--gc-space-8); height: var(--gc-space-8); border-radius: var(--gc-radius-lg); color: var(--gc-color-info); background: var(--gc-color-info-bg); }
.dashboard-audits__icon--success { color: var(--gc-color-success); background: var(--gc-color-success-bg); }
.dashboard-audits__icon--warning { color: var(--gc-color-warning); background: var(--gc-color-warning-bg); }
.dashboard-audits__icon--danger { color: var(--gc-color-danger); background: var(--gc-color-danger-bg); }
.dashboard-audits__icon svg { width: var(--gc-size-icon-sm); height: var(--gc-size-icon-sm); fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: var(--gc-border-width-thick); }
.dashboard-audits__body { display: grid; gap: var(--gc-space-1); min-width: 0; }
.dashboard-audits__title-row { display: flex; align-items: center; justify-content: space-between; gap: var(--gc-space-2); min-width: 0; }
.dashboard-audits__title-row strong,
.dashboard-audits__body p { min-width: 0; overflow-wrap: anywhere; }
.dashboard-audits__title-row strong { color: var(--gc-color-text-strong); font-size: var(--gc-font-size-sm); line-height: var(--gc-line-height-tight); }
.dashboard-audits__body p { margin: 0; color: var(--gc-color-text); font-size: var(--gc-font-size-xs); line-height: var(--gc-line-height-relaxed); }
.dashboard-audits time { color: var(--gc-color-text-soft); font-size: var(--gc-font-size-xs); }

.dashboard-empty { display: grid; place-items: center; min-height: calc(var(--gc-space-12) * 2); padding: var(--gc-space-5); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); text-align: center; }

.dashboard-wizard__step:focus-visible,
.dashboard-quick-start__button:focus-visible,
.dashboard-heatmap__block:focus-visible { outline: none; box-shadow: var(--gc-shadow-focus); }

@media (max-width: 90rem) {
  .dashboard-primary-grid { grid-template-columns: minmax(0, 1.7fr) minmax(calc(var(--gc-size-card-min) + var(--gc-space-6)), 1fr); }
  .dashboard-metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 70rem) {
  .dashboard-primary-grid,
  .dashboard-status-row,
  .dashboard-audit-row { grid-template-columns: 1fr; }
  .dashboard-quick-start { min-height: auto; }
}

@media (max-width: 48rem) {
  .dashboard-page { padding: var(--gc-space-3); }
  .dashboard-metric-grid,
  .dashboard-trend-grid,
  .dashboard-status-groups { grid-template-columns: 1fr; }
  .dashboard-wizard { grid-template-columns: 1fr; }
  .dashboard-status-group { grid-template-columns: 1fr; grid-template-rows: auto; row-gap: var(--gc-space-2); }
  .dashboard-status-group__header,
  .dashboard-status-group__summary,
  .dashboard-heatmap__blocks { grid-column: 1; grid-row: auto; }
  .dashboard-panel__header { flex-direction: column; }
  .dashboard-panel__header .gc-button { align-self: flex-start; }
  .dashboard-audits__title-row { align-items: flex-start; flex-direction: column; }
}
</style>
