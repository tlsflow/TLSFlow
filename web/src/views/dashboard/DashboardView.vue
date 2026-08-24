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
import { GcButton, GcDonutChart, GcPageHeader, GcStatusTag } from '@/design-system/components'

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

function quickActionTitle(action: DashboardQuickAction): string {
  return dashboardText(`dashboard.quickActions.${action.key}.title`, action.title)
}

function quickActionDescription(action: DashboardQuickAction): string {
  return dashboardText(`dashboard.quickActions.${action.key}.description`, action.description)
}

function statusGroupTitle(group: DashboardStatusGroup): string {
  return dashboardText(`dashboard.statusGroups.${group.key}.title`, group.title)
}

function statusGroupSummary(group: DashboardStatusGroup): string {
  const abnormalCount = group.blocks.filter((block) => block.tone === 'warning' || block.tone === 'error' || block.tone === 'unknown').length
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

function showTooltip(block: DashboardStatusBlock) {
  activeTooltip.value = block
}

function hideTooltip() {
  activeTooltip.value = null
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
        <GcButton variant="primary" :loading="loading" @click="loadOverview">
          {{ t('common.refresh') }}
        </GcButton>
      </template>
    </GcPageHeader>

    <div v-if="error" class="dashboard-page__error" role="alert">
      <span>{{ error }}</span>
      <GcButton variant="secondary" @click="loadOverview">{{ t('businessPage.retry') }}</GcButton>
    </div>

    <section class="dashboard-page__metrics" :aria-label="t('dashboard.aria.metrics')">
      <article
        v-for="metric in overview?.metrics ?? []"
        :key="metric.key"
        class="dashboard-metric"
        :data-trend="metric.trend"
      >
        <span>{{ metricTitle(metric) }}</span>
        <strong>{{ metric.value }}</strong>
        <p>{{ metricDescription(metric) }}</p>
      </article>
      <template v-if="!overview && loading">
        <article v-for="index in 6" :key="index" class="dashboard-metric dashboard-metric--loading">
          <span>{{ t('dashboard.loading.title') }}</span>
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
        <span>
          <strong>{{ quickActionTitle(action) }}</strong>
          <small>{{ quickActionDescription(action) }}</small>
        </span>
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
      </section>

      <section class="gc-card dashboard-panel dashboard-panel--certificates" :aria-label="t('dashboard.aria.assetHeatmap')">
        <header class="dashboard-panel__header">
          <div>
            <h2>{{ t('dashboard.assets.title') }}</h2>
            <p v-if="overview?.generatedAt">{{ t('dashboard.assets.updatedAt', { time: formatBrowserLocalTime(overview.generatedAt) }) }}</p>
          </div>
          <RouterLink class="gc-button" to="/assets">{{ t('nav.assets') }}</RouterLink>
        </header>

        <div class="dashboard-heatmap" :aria-label="t('dashboard.aria.statusHeatmap')">
          <section
            v-for="group in overview?.statusGroups ?? []"
            :key="group.key"
            class="dashboard-heatmap__group"
          >
            <header>
              <div>
                <strong>{{ statusGroupTitle(group) }}</strong>
                <span>{{ t('dashboard.assets.groupCount', { summary: statusGroupSummary(group), total: group.total }) }}</span>
              </div>
            </header>
            <div v-if="group.blocks.length" class="dashboard-heatmap__blocks">
              <span
                v-for="block in group.blocks"
                :key="block.id"
                class="dashboard-heatmap__block-wrap"
                @mouseenter="showTooltip(block)"
                @mouseleave="hideTooltip"
                @focusin="showTooltip(block)"
                @focusout="hideTooltip"
              >
                <component
                  :is="block.targetPath ? RouterLink : 'span'"
                  class="dashboard-heatmap__block"
                  :class="`dashboard-heatmap__block--${block.tone}`"
                  :to="block.targetPath"
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
          <footer class="dashboard-heatmap__legend" :aria-label="t('dashboard.aria.statusLegend')">
            <span><i class="dashboard-heatmap__dot dashboard-heatmap__dot--ok"></i>{{ t('dashboard.legend.ok') }}</span>
            <span><i class="dashboard-heatmap__dot dashboard-heatmap__dot--warning"></i>{{ t('dashboard.legend.warning') }}</span>
            <span><i class="dashboard-heatmap__dot dashboard-heatmap__dot--error"></i>{{ t('dashboard.legend.error') }}</span>
            <span><i class="dashboard-heatmap__dot dashboard-heatmap__dot--unknown"></i>{{ t('dashboard.legend.unknown') }}</span>
            <span><i class="dashboard-heatmap__dot dashboard-heatmap__dot--disabled"></i>{{ t('dashboard.legend.disabled') }}</span>
          </footer>
        </div>

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

      <section class="gc-card dashboard-panel dashboard-panel--audits" :aria-label="t('dashboard.audit.title')">
        <header class="dashboard-panel__header">
          <div>
            <h2>{{ t('dashboard.audit.title') }}</h2>
            <p>{{ t('dashboard.audit.description') }}</p>
          </div>
          <RouterLink class="gc-button" to="/audits">{{ t('nav.audits') }}</RouterLink>
        </header>

        <ol class="dashboard-audits">
          <li v-for="item in overview?.recentAudits ?? []" :key="item.id" :data-result="item.result">
            <span class="dashboard-audits__result" :data-result="item.result">
              {{ auditResultLabel(item.result, t) }}
            </span>
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
  </section>
</template>

<style scoped>
.dashboard-page {
  gap: var(--gc-space-5);
}

.dashboard-page__header {
  margin-bottom: var(--gc-space-1);
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
  font-weight: 750;
}

.dashboard-page__metrics {
  display: grid;
  grid-template-columns: repeat(6, minmax(var(--gc-size-card-min), 1fr));
  gap: var(--gc-space-3);
}

.dashboard-metric {
  display: grid;
  gap: var(--gc-space-2);
  min-height: calc(var(--gc-space-12) * 3);
  border: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  border-radius: var(--gc-radius-card);
  padding: var(--gc-space-4);
  background: var(--gc-color-surface-panel);
  box-shadow: var(--gc-shadow-sm);
}

.dashboard-metric span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: 850;
}

.dashboard-metric strong {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-2xl);
  line-height: var(--gc-line-height-tight);
  font-weight: 950;
  letter-spacing: 0;
}

.dashboard-metric p {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  line-height: 1.45;
}

.dashboard-metric[data-trend="good"] {
  border-top: var(--gc-border-width-thick) solid var(--gc-color-success);
}

.dashboard-metric[data-trend="warning"] {
  border-top: var(--gc-border-width-thick) solid var(--gc-color-warning);
}

.dashboard-metric[data-trend="danger"] {
  border-top: var(--gc-border-width-thick) solid var(--gc-color-danger);
}

.dashboard-metric--loading {
  opacity: .72;
}

.dashboard-actions {
  display: grid;
  grid-template-columns: repeat(6, minmax(var(--gc-size-card-min), 1fr));
  gap: var(--gc-space-3);
}

.dashboard-action {
  display: flex;
  align-items: center;
  gap: var(--gc-space-3);
  min-height: var(--gc-space-9);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-control);
  padding: var(--gc-space-3);
  background: var(--gc-color-surface-field);
  box-shadow: var(--gc-shadow-sm);
}

.dashboard-action:hover {
  border-color: var(--gc-color-primary-border);
  background: var(--gc-color-surface-solid);
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
  font-weight: 900;
}

.dashboard-action span:last-child {
  display: grid;
  gap: var(--gc-space-1);
  min-width: 0;
}

.dashboard-action strong {
  font-size: var(--gc-font-size-sm);
}

.dashboard-action small {
  color: var(--gc-color-text-muted);
  line-height: 1.35;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-4);
  align-items: start;
}

.dashboard-panel {
  border-radius: var(--gc-radius-card);
  padding: 0;
  overflow: hidden;
}

.dashboard-panel--status {
  min-height: calc(var(--gc-space-12) * 6);
}

.dashboard-panel--certificates {
  grid-column: 1 / -1;
  grid-row: 2;
}

.dashboard-panel--audits {
  grid-column: 2;
  grid-row: 1;
}

.dashboard-status-summary {
  display: grid;
  grid-template-columns: minmax(calc(var(--gc-space-12) * 3), calc(var(--gc-size-card-min) + var(--gc-space-7))) minmax(0, 1fr);
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
  font-weight: 900;
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
  font-weight: 750;
}

.dashboard-status-summary__legend strong {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-md);
}

.dashboard-status-summary__legend small {
  overflow-wrap: anywhere;
}

.dashboard-status-summary__dot {
  width: var(--gc-space-2);
  height: var(--gc-space-2);
  border-radius: var(--gc-radius-full);
  background: var(--gc-color-muted);
}

.dashboard-status-summary__dot--success { background: var(--gc-color-success); }
.dashboard-status-summary__dot--warning { background: var(--gc-color-warning); }
.dashboard-status-summary__dot--danger { background: var(--gc-color-danger); }
.dashboard-status-summary__dot--info { background: var(--gc-color-info); }
.dashboard-status-summary__dot--muted { background: var(--gc-color-muted); }

.dashboard-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-4);
  padding: var(--gc-space-4);
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border);
  background: var(--gc-color-surface-muted);
}

.dashboard-panel__header h2,
.dashboard-panel__header p {
  margin: 0;
}

.dashboard-panel__header h2 {
  font-size: var(--gc-font-size-lg);
  letter-spacing: 0;
}

.dashboard-panel__header p {
  margin-top: var(--gc-space-1);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: 650;
}

.dashboard-heatmap {
  display: grid;
  gap: var(--gc-space-4);
  padding: var(--gc-space-4);
}

.dashboard-heatmap__group {
  display: grid;
  grid-template-columns: minmax(calc(var(--gc-space-10) * 3), calc(var(--gc-size-card-min) - var(--gc-space-2) - (var(--gc-space-hairline) * 2))) minmax(0, 1fr);
  gap: var(--gc-space-3);
  align-items: start;
  min-height: var(--gc-space-12);
}

.dashboard-heatmap__group header {
  min-width: 0;
}

.dashboard-heatmap__group strong {
  display: block;
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-sm);
  font-weight: 900;
}

.dashboard-heatmap__group span {
  display: block;
  margin-top: var(--gc-space-1);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 750;
  line-height: 1.35;
}

.dashboard-heatmap__blocks {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--gc-space-7), var(--gc-space-7)));
  grid-auto-rows: var(--gc-space-7);
  gap: var(--gc-space-2);
  align-content: start;
  min-height: var(--gc-space-9);
}

.dashboard-heatmap__block {
  display: block;
  width: var(--gc-space-7);
  height: var(--gc-space-7);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-control);
  box-shadow: inset 0 var(--gc-space-hairline) 0 var(--gc-color-surface-muted);
}

.dashboard-heatmap__block-wrap {
  position: relative;
  display: block;
  width: var(--gc-space-7);
  height: var(--gc-space-7);
}

.dashboard-heatmap__block:hover {
  transform: translateY(calc(-1 * var(--gc-space-hairline)));
  box-shadow: var(--gc-shadow-md);
}

.dashboard-heatmap__tooltip {
  position: absolute;
  left: 50%;
  bottom: calc(100% + var(--gc-space-2));
  z-index: 30;
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

.dashboard-heatmap__tooltip::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 100%;
  width: var(--gc-space-2);
  height: var(--gc-space-2);
  border-right: var(--gc-border-width-default) solid var(--gc-color-border-strong);
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border-strong);
  background: var(--gc-color-surface-overlay);
  transform: translate(-50%, calc(-1 * var(--gc-space-1))) rotate(45deg);
}

.dashboard-heatmap__tooltip strong {
  overflow-wrap: anywhere;
  font-size: var(--gc-font-size-sm);
  font-weight: 900;
}

.dashboard-heatmap__tooltip span,
.dashboard-heatmap__tooltip small,
.dashboard-heatmap__tooltip time {
  overflow-wrap: anywhere;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 750;
}

.dashboard-heatmap__block--ok,
.dashboard-heatmap__dot--ok {
  background: var(--gc-color-success);
}

.dashboard-heatmap__block--warning,
.dashboard-heatmap__dot--warning {
  background: var(--gc-color-warning);
}

.dashboard-heatmap__block--error,
.dashboard-heatmap__dot--error {
  background: var(--gc-color-danger);
}

.dashboard-heatmap__block--unknown,
.dashboard-heatmap__dot--unknown {
  background: var(--gc-color-text-soft);
}

.dashboard-heatmap__block--disabled,
.dashboard-heatmap__dot--disabled {
  background: var(--gc-color-text-muted);
}

.dashboard-heatmap__empty {
  display: flex;
  align-items: center;
  min-height: var(--gc-space-6);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: 750;
}

.dashboard-heatmap__legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gc-space-2) var(--gc-space-3);
  padding-top: var(--gc-space-1);
  border-top: var(--gc-border-width-default) solid var(--gc-color-border);
}

.dashboard-heatmap__legend span {
  display: inline-flex;
  align-items: center;
  gap: var(--gc-space-1);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 800;
}

.dashboard-heatmap__dot {
  width: var(--gc-space-2);
  height: var(--gc-space-2);
  border-radius: var(--gc-radius-sm);
}

.dashboard-table {
  display: grid;
  border-top: var(--gc-border-width-default) solid var(--gc-color-border);
}

.dashboard-table__row {
  display: grid;
  grid-template-columns:
    minmax(calc(var(--gc-size-card-min) + var(--gc-space-3) - (var(--gc-space-hairline) * 2)), 1.3fr)
    minmax(calc(var(--gc-space-10) * 4), 1fr)
    calc((var(--gc-space-12) * 2) + var(--gc-space-3) + (var(--gc-space-hairline) * 2))
    calc((var(--gc-space-12) * 2) + var(--gc-space-3) + (var(--gc-space-hairline) * 2))
    calc(var(--gc-space-12) + var(--gc-space-6));
  gap: var(--gc-space-3);
  align-items: center;
  min-height: calc(var(--gc-space-12) + var(--gc-space-2));
  padding: var(--gc-space-2) var(--gc-space-4);
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border-subtle);
}

.dashboard-table__row--head {
  min-height: var(--gc-space-10);
  color: var(--gc-color-text-muted);
  background: var(--gc-color-surface-soft);
  font-size: var(--gc-font-size-xs);
  font-weight: 850;
}

.dashboard-table__row span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.dashboard-table__row span:first-child {
  display: grid;
  gap: var(--gc-space-hairline);
}

.dashboard-table__row strong {
  font-size: var(--gc-font-size-sm);
}

.dashboard-table__row small {
  color: var(--gc-color-text-muted);
}

.dashboard-audits {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.dashboard-audits li {
  display: grid;
  grid-template-columns: calc(var(--gc-space-12) + var(--gc-space-2)) minmax(0, 1fr) max-content;
  gap: var(--gc-space-2) var(--gc-space-3);
  align-items: start;
  padding: var(--gc-space-3) var(--gc-space-4);
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border-subtle);
}

.dashboard-audits__result {
  display: inline-grid;
  place-items: center;
  min-width: var(--gc-space-12);
  min-height: var(--gc-space-6);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-pill);
  padding: 0 var(--gc-space-2);
  color: var(--gc-color-text-muted);
  background: var(--gc-color-surface-soft);
  font-size: var(--gc-font-size-xs);
  font-weight: 900;
  white-space: nowrap;
}

.dashboard-audits__result[data-result="success"] {
  color: var(--gc-color-success);
  background: var(--gc-color-success-bg);
  border-color: var(--gc-color-success-border);
}

.dashboard-audits__result[data-result="failure"] {
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-bg);
  border-color: var(--gc-color-danger-border);
}

.dashboard-audits__result[data-result="denied"] {
  color: var(--gc-color-warning);
  background: var(--gc-color-warning-bg);
  border-color: var(--gc-color-warning-border);
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
  overflow-wrap: anywhere;
}

.dashboard-audits__title-row strong {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-md);
  line-height: 1.25;
  font-weight: 950;
}

.dashboard-audits__type {
  display: inline-flex;
  align-items: center;
  min-height: var(--gc-space-6);
  border-radius: var(--gc-radius-pill);
  padding: 0 var(--gc-space-2);
  font-size: var(--gc-font-size-xs);
  font-weight: 850;
  line-height: 1;
  white-space: nowrap;
}

.dashboard-audits__type {
  color: var(--gc-color-primary);
  background: var(--gc-color-primary-soft);
}

.dashboard-audits__body p {
  margin: 0;
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-sm);
  line-height: 1.45;
  font-weight: 700;
}

.dashboard-audits time {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 700;
}

.dashboard-audits time {
  padding-top: var(--gc-space-hairline);
  white-space: nowrap;
}

.dashboard-empty {
  display: grid;
  place-items: center;
  min-height: calc(var(--gc-space-12) * 4);
  color: var(--gc-color-text-muted);
  font-weight: 850;
}

@media (max-width: 80rem) {
  .dashboard-page__metrics,
  .dashboard-actions {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .dashboard-grid {
    grid-template-columns: 1fr;
  }

  .dashboard-panel--certificates,
  .dashboard-panel--audits {
    grid-column: auto;
    grid-row: auto;
  }
}

@media (max-width: 47.5rem) {
  .dashboard-page__metrics,
  .dashboard-actions {
    grid-template-columns: 1fr;
  }

  .dashboard-heatmap__group {
    grid-template-columns: 1fr;
  }

  .dashboard-status-summary {
    grid-template-columns: 1fr;
  }

  .dashboard-status-summary__legend {
    grid-template-columns: 1fr;
  }

  .dashboard-table__row {
    grid-template-columns: 1fr;
    gap: var(--gc-space-2);
    align-items: start;
  }

  .dashboard-table__row--head {
    display: none;
  }

  .dashboard-audits li {
    grid-template-columns: 1fr;
  }

  .dashboard-audits__result {
    justify-self: start;
  }

  .dashboard-audits time {
    padding-top: 0;
    white-space: normal;
  }
}
</style>
