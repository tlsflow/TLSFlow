<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import {
  getDashboardOverview,
  type DashboardCertificateState,
  type DashboardMetric,
  type DashboardOverview,
  type DashboardQuickAction,
  type DashboardStatusBlock,
  type DashboardStatusGroup,
} from '@/api/modules/dashboard.api'
import { usePermissionStore } from '@/stores/permission.store'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import { usePolling } from '@/composables/usePolling'
import { auditReadableTitle, auditResultLabel, auditSummary, auditTypeLabel } from '@/utils/audit-format'
import type { StatusTone } from '@/design-system/status/status-map'
import { GcButton, GcDonutChart, GcPageHeader, GcStatusTag, GcTrendChart } from '@/design-system/components'

const permissionStore = usePermissionStore()
const { t, te } = useI18n()
const legacyCertificateDetailPattern = /^(.+)\uff0c\u5269\u4f59 (.+) \u5929$/
const legacyUnknownText = '\u672a\u77e5'
const legacyDashboardStatusMap = new Map<string, string>([
  ['\u6b63\u5e38', 'valid'],
  ['\u5373\u5c06\u5230\u671f', 'expiring'],
  ['\u4e34\u8fd1\u5230\u671f', 'critical'],
  ['\u5df2\u8fc7\u671f', 'expired'],
  [legacyUnknownText, 'unknown'],
  ['ACTIVE', 'active'],
  ['DELETED', 'deleted'],
  ['DISABLED', 'disabled'],
  ['INACTIVE', 'inactive'],
  ['OFFLINE', 'offline'],
  ['ONLINE', 'online'],
  ['RETIRED', 'retired'],
  ['STALE', 'stale'],
  ['UNREACHABLE', 'unreachable'],
  ['UPGRADING', 'upgrading'],
  ['active', 'active'],
  ['deleted', 'deleted'],
  ['disabled', 'disabled'],
  ['inactive', 'inactive'],
  ['offline', 'offline'],
  ['online', 'online'],
  ['retired', 'retired'],
  ['revoked', 'revoked'],
  ['stale', 'stale'],
  ['unreachable', 'unreachable'],
  ['upgrading', 'upgrading'],
])
const activityBucketCount = 8
const overview = ref<DashboardOverview | null>(null)
const loading = ref(false)
const error = ref('')
const activeTooltip = ref<DashboardStatusBlock | null>(null)
let activeLoad: Promise<void> | null = null

const visibleQuickActions = computed(() =>
  (overview.value?.quickActions ?? []).filter((action) => permissionStore.hasPermission(action.permission)),
)

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

const dashboardStatusTotal = computed(() =>
  dashboardStatusDistribution.value.reduce((total, item) => total + item.value, 0),
)

const dashboardActivityTrend = computed(() => buildActivityTrend(overview.value?.recentAudits ?? []))

const dashboardActivityTone = computed<StatusTone>(() => {
  const audits = overview.value?.recentAudits ?? []
  if (audits.some((item) => item.result === 'failure')) return 'danger'
  if (audits.some((item) => item.result === 'denied')) return 'warning'
  return audits.length ? 'info' : 'muted'
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
    overview.value = result.data
    error.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('dashboard.errors.loadFailed')
  } finally {
    loading.value = false
  }
}

usePolling(loadOverview, { intervalMs: 30_000, immediate: true })

onMounted(() => {
  window.addEventListener('dashboard:refresh', loadOverview)
})

onBeforeUnmount(() => {
  window.removeEventListener('dashboard:refresh', loadOverview)
})

function stateLabel(state: DashboardCertificateState): string {
  const labels: Record<DashboardCertificateState, string> = {
    valid: t('dashboard.certificateState.valid'),
    expiring: t('dashboard.certificateState.expiring'),
    critical: t('dashboard.certificateState.critical'),
    expired: t('dashboard.certificateState.expired'),
    unknown: t('dashboard.certificateState.unknown'),
  }
  return labels[state]
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

function daysText(value: number | undefined): string {
  if (value === undefined) return t('dashboard.days.notRecorded')
  if (value < 0) return t('dashboard.days.expired', { days: Math.abs(value) })
  if (value === 0) return t('dashboard.days.expiresToday')
  return t('dashboard.days.remaining', { days: value })
}

function dashboardText(key: string, fallback: string, params?: Record<string, unknown>): string {
  return te(key) ? t(key, params ?? {}) : fallback
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
  const abnormalCount = group.blocks.filter((block) => block.tone === 'warning' || block.tone === 'error' || block.tone === 'unknown').length
  if (abnormalCount === 0 && group.blocks.length > 0 && group.blocks.every((block) => block.tone === 'disabled')) {
    return t('dashboard.legend.disabled')
  }
  return abnormalCount > 0
    ? t('dashboard.statusGroups.summary.needsAttention', { count: abnormalCount })
    : t('dashboard.statusGroups.summary.allNormal')
}

function statusBlockStatus(block: DashboardStatusBlock): string {
  const normalized = normalizeDashboardStatus(block.status)
  return normalized
    ? dashboardText(`dashboard.statusBlock.status.${normalized}`, block.status)
    : block.status
}

function statusBlockDetail(group: DashboardStatusGroup, block: DashboardStatusBlock): string {
  if (!block.detail) return ''
  if (group.key !== 'certificates') return block.detail
  const match = block.detail.match(legacyCertificateDetailPattern)
  if (!match) return block.detail
  const days = match[2] === legacyUnknownText ? t('dashboard.days.notRecorded') : t('dashboard.days.remaining', { days: match[2] })
  return t('dashboard.statusBlock.detail.certificateRemaining', { name: match[1], days })
}

function normalizeDashboardStatus(value: string): string {
  return legacyDashboardStatusMap.get(value) ?? ''
}

function blockTitle(group: DashboardStatusGroup, block: DashboardStatusBlock): string {
  const parts = [block.label, statusBlockStatus(block), statusBlockDetail(group, block), block.updatedAt ? formatBrowserLocalTime(block.updatedAt, { includeSeconds: false }) : '']
  return parts.filter(Boolean).join(' / ')
}

function auditTone(result: string): StatusTone {
  if (result === 'success') return 'success'
  if (result === 'failure') return 'danger'
  if (result === 'denied') return 'warning'
  return 'info'
}

function showTooltip(block: DashboardStatusBlock) {
  activeTooltip.value = block
}

function hideTooltip() {
  activeTooltip.value = null
}

function buildActivityTrend(audits: DashboardOverview['recentAudits']) {
  const timestamps = audits
    .map((item) => Date.parse(item.createdAt))
    .filter((value): value is number => Number.isFinite(value))
    .sort((left, right) => left - right)

  if (timestamps.length < 2) return []
  const start = timestamps[0]
  const end = timestamps[timestamps.length - 1]
  if (end <= start) return []

  const bucketCount = Math.min(activityBucketCount, timestamps.length)
  const bucketSize = (end - start) / bucketCount
  const values = Array.from({ length: bucketCount }, () => 0)
  for (const timestamp of timestamps) {
    const index = Math.min(bucketCount - 1, Math.floor((timestamp - start) / bucketSize))
    values[index] += 1
  }
  return values.map((value) => ({ value }))
}
</script>

<template>
  <section class="gc-page dashboard-page">
    <GcPageHeader
      class="dashboard-page__header"
      :title="t('app.dashboard')"
      :description="t('nav.dashboardDesc')"
    >
      <template #actions>
        <span v-if="overview?.generatedAt" class="dashboard-page__updated">
          {{ t('dashboard.assets.updatedAt', { time: formatBrowserLocalTime(overview.generatedAt) }) }}
        </span>
        <GcButton variant="primary" :loading="loading" @click="loadOverview">
          {{ t('common.refresh') }}
        </GcButton>
      </template>
    </GcPageHeader>

    <div v-if="error" class="dashboard-page__error" role="alert">
      <span>{{ error }}</span>
      <GcButton variant="secondary" @click="loadOverview">{{ t('businessPage.retry') }}</GcButton>
    </div>

    <section
      class="dashboard-page__metrics"
      :aria-label="t('dashboard.aria.metrics')"
      :aria-busy="loading && !overview"
    >
      <article
        v-for="metric in overview?.metrics ?? []"
        :key="metric.key"
        class="dashboard-metric"
        :class="`dashboard-metric--${metricTone(metric.trend)}`"
        :data-trend="metric.trend"
      >
        <span class="dashboard-metric__title">{{ metricTitle(metric) }}</span>
        <strong>{{ metric.value }}</strong>
        <p>{{ metricDescription(metric) }}</p>
      </article>
      <template v-if="!overview && loading">
        <article v-for="index in 6" :key="index" class="dashboard-metric dashboard-metric--loading">
          <span class="dashboard-metric__title">{{ t('dashboard.loading.title') }}</span>
          <strong>--</strong>
          <p>{{ t('dashboard.loading.description') }}</p>
        </article>
      </template>
    </section>

    <nav v-if="visibleQuickActions.length" class="dashboard-actions" :aria-label="t('dashboard.aria.quickActions')">
      <RouterLink
        v-for="action in visibleQuickActions"
        :key="action.key"
        class="dashboard-action"
        :to="action.path"
      >
        <span class="dashboard-action__icon" aria-hidden="true">›</span>
        <span class="dashboard-action__content">
          <strong>{{ quickActionTitle(action) }}</strong>
          <small>{{ quickActionDescription(action) }}</small>
        </span>
        <span class="dashboard-action__arrow" aria-hidden="true">→</span>
      </RouterLink>
    </nav>

    <section class="dashboard-grid">
      <section class="gc-card dashboard-panel dashboard-panel--status" :aria-label="t('dashboard.aria.statusHeatmap')">
        <header class="dashboard-panel__header">
          <div>
            <h2>{{ t('dashboard.aria.statusHeatmap') }}</h2>
            <p v-if="overview?.generatedAt">{{ t('dashboard.assets.updatedAt', { time: formatBrowserLocalTime(overview.generatedAt) }) }}</p>
          </div>
        </header>

        <div class="dashboard-status-summary">
          <GcDonutChart
            :segments="dashboardStatusDistribution"
            :ariaLabel="t('dashboard.aria.statusHeatmap')"
            :empty-label="t('dashboard.empty.noObjects')"
          >
            <template #center>
              <strong class="dashboard-status-summary__total">{{ dashboardStatusTotal }}</strong>
            </template>
          </GcDonutChart>
          <div class="dashboard-status-summary__legend" :aria-label="t('dashboard.aria.statusLegend')">
            <span v-for="item in dashboardStatusDistribution" :key="item.tone">
              <i :class="`dashboard-status-summary__dot dashboard-status-summary__dot--${item.tone}`" aria-hidden="true" />
              <strong>{{ item.value }}</strong>
              <small>{{ dashboardStatusToneLabel(item.tone) }}</small>
            </span>
          </div>
        </div>

        <div v-if="overview && overview.statusGroups.length" class="dashboard-status-groups" :aria-label="t('dashboard.aria.statusHeatmap')">
          <section v-for="group in overview.statusGroups" :key="group.key" class="dashboard-status-group">
            <header class="dashboard-status-group__header">
              <div class="dashboard-status-group__title">
                <span class="dashboard-status-group__dot" :class="`dashboard-status-group__dot--${statusGroupTone(group)}`" aria-hidden="true" />
                <strong>{{ statusGroupTitle(group) }}</strong>
              </div>
              <strong class="dashboard-status-group__total">{{ group.total }}</strong>
            </header>
            <div class="dashboard-status-group__summary">
              <GcStatusTag :status="group.key" :label="statusGroupSummary(group)" :tone="statusGroupTone(group)" />
            </div>
            <div v-if="group.blocks.length" class="dashboard-heatmap__blocks">
              <span
                v-for="block in group.blocks"
                :key="block.id"
                class="dashboard-heatmap__block-wrap"
                @mouseenter="showTooltip(block)"
                @mouseleave="hideTooltip"
                @focusin="showTooltip(block)"
                @focusout="hideTooltip"
                @keydown.esc="hideTooltip"
              >
                <component
                  :is="block.targetPath ? RouterLink : 'span'"
                  class="dashboard-heatmap__block"
                  :class="`dashboard-heatmap__block--${block.tone}`"
                  :to="block.targetPath || undefined"
                  :tabindex="block.targetPath ? undefined : 0"
                  :aria-label="blockTitle(group, block)"
                />
                <span v-if="activeTooltip?.id === block.id" class="dashboard-heatmap__tooltip" role="tooltip">
                  <strong>{{ block.label }}</strong>
                  <span>{{ statusBlockStatus(block) }}</span>
                  <small v-if="statusBlockDetail(group, block)">{{ statusBlockDetail(group, block) }}</small>
                  <time v-if="block.updatedAt">{{ formatBrowserLocalTime(block.updatedAt, { includeSeconds: false }) }}</time>
                </span>
              </span>
            </div>
            <div v-else class="dashboard-heatmap__empty">{{ t('dashboard.empty.noObjects') }}</div>
          </section>
        </div>
        <div v-else-if="overview" class="dashboard-empty">{{ t('dashboard.empty.noObjects') }}</div>
      </section>

      <section class="gc-card dashboard-panel dashboard-panel--audits" :aria-label="t('dashboard.audit.title')">
        <header class="dashboard-panel__header">
          <div>
            <h2>{{ t('dashboard.audit.title') }}</h2>
            <p>{{ t('dashboard.audit.description') }}</p>
          </div>
          <RouterLink class="gc-button gc-button--secondary" to="/audits">{{ t('nav.audits') }}</RouterLink>
        </header>

        <div class="dashboard-activity" :aria-label="t('dashboard.audit.title')">
          <GcTrendChart
            v-if="overview"
            data-testid="dashboard-activity-chart"
            :data="dashboardActivityTrend"
            :tone="dashboardActivityTone"
            :ariaLabel="t('dashboard.audit.title')"
            :empty-label="t('dashboard.empty.noAuditLogs')"
          />
          <div v-else class="dashboard-activity__loading">{{ t('dashboard.loading.description') }}</div>
        </div>

        <ol class="dashboard-audits">
          <li v-for="item in overview?.recentAudits ?? []" :key="item.id">
            <GcStatusTag
              class="dashboard-audits__result"
              :status="item.result"
              :label="auditResultLabel(item.result, t)"
              :tone="auditTone(item.result)"
            />
            <div class="dashboard-audits__body">
              <div class="dashboard-audits__title-row">
                <strong>{{ auditReadableTitle(item, t) }}</strong>
                <span class="dashboard-audits__type">{{ auditTypeLabel(item, t) }}</span>
              </div>
              <p>{{ auditSummary(item, t) }}</p>
            </div>
            <time>{{ formatBrowserLocalTime(item.createdAt, { includeSeconds: false }) }}</time>
          </li>
        </ol>

        <div v-if="overview && overview.recentAudits.length === 0" class="dashboard-empty">
          {{ t('dashboard.empty.noAuditLogs') }}
        </div>
      </section>
    </section>

    <section class="gc-card dashboard-panel dashboard-panel--certificates" :aria-label="t('dashboard.aria.certificateStatusList')">
      <header class="dashboard-panel__header">
        <div>
          <h2>{{ t('dashboard.assets.title') }}</h2>
          <p v-if="overview?.generatedAt">{{ t('dashboard.assets.updatedAt', { time: formatBrowserLocalTime(overview.generatedAt) }) }}</p>
        </div>
        <RouterLink class="gc-button gc-button--secondary" to="/assets">{{ t('nav.assets') }}</RouterLink>
      </header>

      <div class="dashboard-table" role="table" :aria-label="t('dashboard.aria.certificateStatusList')">
        <div class="dashboard-table__row dashboard-table__row--head" role="row">
          <span role="columnheader">{{ t('dashboard.table.certificate') }}</span>
          <span role="columnheader">{{ t('dashboard.table.domain') }}</span>
          <span role="columnheader">{{ t('dashboard.table.status') }}</span>
          <span role="columnheader">{{ t('dashboard.table.remainingTime') }}</span>
          <span role="columnheader">{{ t('dashboard.table.bindings') }}</span>
        </div>
        <div
          v-for="item in overview?.certificateStatuses ?? []"
          :key="item.certificateAssetId"
          class="dashboard-table__row"
          role="row"
        >
          <span role="cell">
            <strong>{{ item.name }}</strong>
            <small>{{ item.notAfter ? formatBrowserLocalTime(item.notAfter, { includeSeconds: false }) : t('dashboard.table.notAfterMissing') }}</small>
          </span>
          <span role="cell">{{ item.primaryDomain }}</span>
          <span role="cell">
            <GcStatusTag
              :status="item.state"
              :label="stateLabel(item.state)"
              :tone="item.state === 'valid' ? 'success' : item.state === 'expiring' ? 'warning' : item.state === 'critical' || item.state === 'expired' ? 'danger' : 'muted'"
            />
          </span>
          <span role="cell">{{ daysText(item.daysRemaining) }}</span>
          <span role="cell">{{ item.bindingCount }}</span>
        </div>
      </div>

      <div v-if="overview && overview.certificateStatuses.length === 0" class="dashboard-empty">
        {{ t('dashboard.empty.noCertificateStatus') }}
      </div>
    </section>
  </section>
</template>

<style scoped>
.dashboard-page {
  gap: var(--gc-space-section);
}

.dashboard-page__header {
  margin-bottom: 0;
}

.dashboard-page__updated {
  align-self: center;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: var(--gc-font-weight-semibold);
}

.dashboard-page__error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-3);
  margin: 0;
  border: var(--gc-border-width-default) solid var(--gc-color-danger-border);
  border-radius: var(--gc-radius-control);
  padding: var(--gc-space-3) var(--gc-space-4);
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-bg);
  font-weight: var(--gc-font-weight-semibold);
}

.dashboard-page__metrics {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: var(--gc-space-3);
}

.dashboard-metric {
  display: grid;
  grid-template-rows: auto auto 1fr;
  gap: var(--gc-space-2);
  min-height: calc(var(--gc-space-12) * 3);
  border: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  border-radius: var(--gc-radius-card);
  border-top-width: var(--gc-border-width-thick);
  border-top-color: var(--gc-color-border-soft);
  padding: var(--gc-space-4);
  background: var(--gc-color-surface-panel);
  box-shadow: var(--gc-shadow-sm);
}

.dashboard-metric--success { border-top-color: var(--gc-color-success); }
.dashboard-metric--warning { border-top-color: var(--gc-color-warning); }
.dashboard-metric--danger { border-top-color: var(--gc-color-danger); }

.dashboard-metric__title {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: var(--gc-font-weight-semibold);
  line-height: var(--gc-line-height-relaxed);
}

.dashboard-metric strong {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-2xl);
  line-height: var(--gc-line-height-tight);
  font-weight: 800;
  letter-spacing: 0;
}

.dashboard-metric p {
  align-self: end;
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  line-height: var(--gc-line-height-relaxed);
}

.dashboard-metric--loading {
  opacity: var(--gc-opacity-disabled);
}

.dashboard-actions {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: var(--gc-space-3);
}

.dashboard-action {
  display: grid;
  grid-template-columns: var(--gc-space-7) minmax(0, 1fr) max-content;
  align-items: center;
  gap: var(--gc-space-3);
  min-width: 0;
  min-height: var(--gc-space-9);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-control);
  padding: var(--gc-space-3);
  color: var(--gc-color-text);
  background: var(--gc-color-surface-field);
  box-shadow: var(--gc-shadow-sm);
}

.dashboard-action:hover {
  border-color: var(--gc-color-primary-border);
  background: var(--gc-color-surface-hover);
  box-shadow: var(--gc-shadow-md);
}

.dashboard-action:focus-visible,
.dashboard-heatmap__block:focus-visible {
  outline: none;
  box-shadow: var(--gc-shadow-focus);
}

.dashboard-action__icon {
  display: grid;
  place-items: center;
  width: var(--gc-space-7);
  height: var(--gc-space-7);
  border-radius: var(--gc-radius-control);
  color: var(--gc-color-primary);
  background: var(--gc-color-primary-soft);
  font-size: var(--gc-font-size-lg);
  font-weight: 800;
}

.dashboard-action__content {
  display: grid;
  gap: var(--gc-space-1);
  min-width: 0;
}

.dashboard-action__content strong,
.dashboard-action__content small {
  min-width: 0;
  overflow-wrap: anywhere;
}

.dashboard-action__content strong {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-sm);
  font-weight: var(--gc-font-weight-semibold);
}

.dashboard-action__content small {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  line-height: var(--gc-line-height-relaxed);
}

.dashboard-action__arrow {
  color: var(--gc-color-primary);
  font-size: var(--gc-font-size-lg);
  font-weight: 800;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(0, 0.92fr);
  gap: var(--gc-space-4);
  align-items: start;
}

.dashboard-panel {
  min-width: 0;
  padding: 0;
  overflow: hidden;
}

.dashboard-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--gc-space-4);
  padding: var(--gc-space-4);
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border);
  background: var(--gc-color-surface-muted);
}

.dashboard-panel__header > div {
  min-width: 0;
}

.dashboard-panel__header h2,
.dashboard-panel__header p {
  margin: 0;
}

.dashboard-panel__header h2 {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-lg);
  line-height: var(--gc-line-height-tight);
  letter-spacing: 0;
}

.dashboard-panel__header p {
  margin-top: var(--gc-space-1);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: var(--gc-font-weight-semibold);
  line-height: var(--gc-line-height-relaxed);
}

.dashboard-status-summary {
  display: grid;
  grid-template-columns: minmax(calc(var(--gc-space-12) * 3), var(--gc-size-card-min)) minmax(0, 1fr);
  align-items: center;
  gap: var(--gc-space-5);
  padding: var(--gc-space-4);
}

.dashboard-status-summary .gc-donut-chart {
  justify-self: center;
}

.dashboard-status-summary__total {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-heading-sm);
  font-weight: 800;
}

.dashboard-status-summary__legend {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-3);
}

.dashboard-status-summary__legend span {
  display: grid;
  grid-template-columns: var(--gc-space-2) max-content minmax(0, 1fr);
  align-items: center;
  gap: var(--gc-space-2);
  min-width: 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: var(--gc-font-weight-semibold);
}

.dashboard-status-summary__legend strong {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-md);
}

.dashboard-status-summary__legend small {
  min-width: 0;
  overflow-wrap: anywhere;
}

.dashboard-status-summary__dot,
.dashboard-status-group__dot {
  display: block;
  border-radius: var(--gc-radius-full);
  background: var(--gc-color-muted);
}

.dashboard-status-summary__dot {
  width: var(--gc-space-2);
  height: var(--gc-space-2);
}

.dashboard-status-group__dot {
  width: var(--gc-space-2);
  height: var(--gc-space-2);
  flex: 0 0 auto;
}

.dashboard-status-summary__dot--success,
.dashboard-status-group__dot--success { background: var(--gc-color-success); }
.dashboard-status-summary__dot--warning,
.dashboard-status-group__dot--warning { background: var(--gc-color-warning); }
.dashboard-status-summary__dot--danger,
.dashboard-status-group__dot--danger { background: var(--gc-color-danger); }
.dashboard-status-summary__dot--info,
.dashboard-status-group__dot--info { background: var(--gc-color-info); }
.dashboard-status-summary__dot--muted,
.dashboard-status-group__dot--muted { background: var(--gc-color-muted); }

.dashboard-status-groups {
  display: grid;
  border-top: var(--gc-border-width-default) solid var(--gc-color-border);
}

.dashboard-status-group {
  display: grid;
  gap: var(--gc-space-2);
  min-width: 0;
  padding: var(--gc-space-3) var(--gc-space-4);
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border-subtle);
}

.dashboard-status-group__header,
.dashboard-status-group__title,
.dashboard-status-group__summary {
  display: flex;
  align-items: center;
  min-width: 0;
}

.dashboard-status-group__header {
  justify-content: space-between;
  gap: var(--gc-space-3);
}

.dashboard-status-group__title {
  gap: var(--gc-space-2);
}

.dashboard-status-group__title strong {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-sm);
  font-weight: var(--gc-font-weight-semibold);
}

.dashboard-status-group__total {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-md);
  font-weight: 800;
}

.dashboard-status-group__summary {
  gap: var(--gc-space-2);
}

.dashboard-heatmap__blocks {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--gc-space-7), var(--gc-space-7)));
  grid-auto-rows: var(--gc-space-7);
  gap: var(--gc-space-2);
  align-content: start;
  max-height: calc(var(--gc-size-log-viewer-max-height) / 2);
  overflow: auto;
  padding: var(--gc-space-1) var(--gc-space-1) var(--gc-space-1) 0;
}

.dashboard-heatmap__block-wrap {
  position: relative;
  display: block;
  width: var(--gc-space-7);
  height: var(--gc-space-7);
}

.dashboard-heatmap__block {
  display: block;
  width: var(--gc-space-7);
  height: var(--gc-space-7);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-control);
  box-shadow: inset 0 var(--gc-space-hairline) 0 var(--gc-color-surface-muted);
}

.dashboard-heatmap__block:hover {
  transform: translateY(calc(-1 * var(--gc-space-hairline)));
  box-shadow: var(--gc-shadow-md);
}

.dashboard-heatmap__tooltip {
  position: absolute;
  left: 50%;
  bottom: calc(100% + var(--gc-space-2));
  z-index: 1;
  display: grid;
  gap: var(--gc-space-1);
  width: max-content;
  min-width: calc(var(--gc-size-card-min) + var(--gc-space-1));
  max-width: calc(var(--gc-size-card-min) + var(--gc-space-12));
  padding: var(--gc-space-2) var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border-strong);
  border-radius: var(--gc-radius-control);
  color: var(--gc-color-text);
  background: var(--gc-color-surface-overlay);
  box-shadow: var(--gc-shadow-lg);
  transform: translateX(-50%);
  pointer-events: none;
}

.dashboard-heatmap__tooltip strong,
.dashboard-heatmap__tooltip span,
.dashboard-heatmap__tooltip small,
.dashboard-heatmap__tooltip time {
  min-width: 0;
  overflow-wrap: anywhere;
}

.dashboard-heatmap__tooltip strong {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-sm);
  font-weight: 800;
}

.dashboard-heatmap__tooltip span,
.dashboard-heatmap__tooltip small,
.dashboard-heatmap__tooltip time {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: var(--gc-font-weight-semibold);
  line-height: var(--gc-line-height-relaxed);
}

.dashboard-heatmap__block--ok { background: var(--gc-color-success); }
.dashboard-heatmap__block--warning { background: var(--gc-color-warning); }
.dashboard-heatmap__block--error { background: var(--gc-color-danger); }
.dashboard-heatmap__block--unknown { background: var(--gc-color-info); }
.dashboard-heatmap__block--disabled { background: var(--gc-color-muted); }

.dashboard-heatmap__empty {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: var(--gc-font-weight-semibold);
}

.dashboard-activity {
  min-height: calc(var(--gc-space-12) * 2);
  padding: var(--gc-space-3) var(--gc-space-4);
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border);
  background: var(--gc-color-surface-muted);
}

.dashboard-activity .gc-trend-chart {
  min-height: calc(var(--gc-space-12) + var(--gc-space-6));
}

.dashboard-activity__loading {
  display: grid;
  place-items: center;
  min-height: calc(var(--gc-space-12) + var(--gc-space-6));
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: var(--gc-font-weight-semibold);
}

.dashboard-audits {
  display: grid;
  max-height: var(--gc-size-log-viewer-max-height);
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}

.dashboard-audits li {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr) max-content;
  gap: var(--gc-space-2) var(--gc-space-3);
  align-items: start;
  min-width: 0;
  padding: var(--gc-space-3) var(--gc-space-4);
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border-subtle);
}

.dashboard-audits__result {
  margin-top: var(--gc-space-hairline);
  white-space: nowrap;
}

.dashboard-audits__body {
  display: grid;
  gap: var(--gc-space-1);
  min-width: 0;
}

.dashboard-audits__title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--gc-space-1);
  min-width: 0;
}

.dashboard-audits__title-row strong,
.dashboard-audits__body p {
  min-width: 0;
  overflow-wrap: anywhere;
}

.dashboard-audits__title-row strong {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-md);
  line-height: var(--gc-line-height-tight);
  font-weight: 800;
}

.dashboard-audits__type {
  display: inline-flex;
  align-items: center;
  min-height: var(--gc-space-6);
  border-radius: var(--gc-radius-pill);
  padding: 0 var(--gc-space-2);
  color: var(--gc-color-primary);
  background: var(--gc-color-primary-soft);
  font-size: var(--gc-font-size-xs);
  font-weight: var(--gc-font-weight-semibold);
  line-height: var(--gc-line-height-tight);
  white-space: nowrap;
}

.dashboard-audits__body p {
  margin: 0;
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-sm);
  line-height: var(--gc-line-height-relaxed);
  font-weight: var(--gc-font-weight-semibold);
}

.dashboard-audits time {
  padding-top: var(--gc-space-hairline);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: var(--gc-font-weight-semibold);
  white-space: nowrap;
}

.dashboard-panel--certificates {
  overflow: hidden;
}

.dashboard-table {
  display: grid;
  overflow-x: auto;
}

.dashboard-table__row {
  display: grid;
  grid-template-columns:
    minmax(calc(var(--gc-size-card-min) + var(--gc-space-3)), 1.3fr)
    minmax(calc(var(--gc-space-10) * 4), 1fr)
    calc(var(--gc-space-12) * 2)
    calc(var(--gc-space-12) * 2)
    calc(var(--gc-space-12) + var(--gc-space-6));
  gap: var(--gc-space-3);
  align-items: center;
  min-height: calc(var(--gc-space-12) + var(--gc-space-2));
  min-width: calc(var(--gc-size-card-min) * 3);
  padding: var(--gc-space-2) var(--gc-space-4);
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border-subtle);
}

.dashboard-table__row--head {
  min-height: var(--gc-space-10);
  color: var(--gc-color-text-muted);
  background: var(--gc-color-surface-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: var(--gc-font-weight-semibold);
}

.dashboard-table__row > span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.dashboard-table__row > span:first-child {
  display: grid;
  gap: var(--gc-space-hairline);
}

.dashboard-table__row strong {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-sm);
}

.dashboard-table__row small {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.dashboard-empty {
  display: grid;
  place-items: center;
  min-height: calc(var(--gc-space-12) * 3);
  padding: var(--gc-space-4);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: var(--gc-font-weight-semibold);
  text-align: center;
}

@media (max-width: 80rem) {
  .dashboard-page__metrics,
  .dashboard-actions {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .dashboard-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 47.5rem) {
  .dashboard-page__metrics,
  .dashboard-actions {
    grid-template-columns: 1fr;
  }

  .dashboard-page__updated {
    width: 100%;
  }

  .dashboard-status-summary {
    grid-template-columns: 1fr;
  }

  .dashboard-status-summary__legend {
    grid-template-columns: 1fr;
  }

  .dashboard-panel__header {
    flex-direction: column;
  }

  .dashboard-panel__header .gc-button {
    align-self: flex-start;
  }

  .dashboard-audits li {
    grid-template-columns: max-content minmax(0, 1fr);
  }

  .dashboard-audits time {
    grid-column: 2;
    padding-top: 0;
    white-space: normal;
  }

  .dashboard-table__row {
    grid-template-columns: 1fr;
    gap: var(--gc-space-2);
    align-items: start;
    min-width: 0;
  }

  .dashboard-table__row--head {
    display: none;
  }
}
</style>
