<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { getDashboardOverview, type DashboardCertificateState, type DashboardOverview, type DashboardStatusBlock } from '@/api/modules/dashboard.api'
import { usePermissionStore } from '@/stores/permission.store'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import { usePolling } from '@/composables/usePolling'
import { auditReadableTitle, auditResultLabel, auditSummary, auditTypeLabel } from '@/utils/audit-format'

const permissionStore = usePermissionStore()
const overview = ref<DashboardOverview | null>(null)
const loading = ref(false)
const error = ref('')
const activeTooltip = ref<DashboardStatusBlock | null>(null)

const visibleQuickActions = computed(() =>
  (overview.value?.quickActions ?? []).filter((action) => permissionStore.hasPermission(action.permission)),
)

async function loadOverview() {
  loading.value = true
  try {
    const result = await getDashboardOverview()
    if (!result.data) throw new Error('总览接口没有返回数据')
    overview.value = result.data
    error.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '总览数据加载失败'
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
    valid: '正常',
    expiring: '即将到期',
    critical: '临近到期',
    expired: '已过期',
    unknown: '未知',
  }
  return labels[state]
}

function daysText(value: number | undefined): string {
  if (value === undefined) return '未记录'
  if (value < 0) return `已过期 ${Math.abs(value)} 天`
  if (value === 0) return '今天到期'
  return `${value} 天`
}

function blockTitle(block: DashboardStatusBlock): string {
  const parts = [block.label, block.status, block.detail, block.updatedAt ? formatBrowserLocalTime(block.updatedAt, { includeSeconds: false }) : '']
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
    <p v-if="error" class="dashboard-page__error">{{ error }}</p>

    <section class="dashboard-page__metrics" aria-label="核心指标">
      <article
        v-for="metric in overview?.metrics ?? []"
        :key="metric.key"
        class="dashboard-metric"
        :data-trend="metric.trend"
      >
        <span>{{ metric.title }}</span>
        <strong>{{ metric.value }}</strong>
        <p>{{ metric.description }}</p>
      </article>
      <template v-if="!overview && loading">
        <article v-for="index in 6" :key="index" class="dashboard-metric dashboard-metric--loading">
          <span>加载中</span>
          <strong>--</strong>
          <p>正在读取总览数据。</p>
        </article>
      </template>
    </section>

    <nav v-if="visibleQuickActions.length" class="dashboard-actions" aria-label="主要功能入口">
      <RouterLink
        v-for="action in visibleQuickActions"
        :key="action.key"
        class="dashboard-action"
        :to="action.path"
      >
        <span class="dashboard-action__icon" aria-hidden="true">›</span>
        <span>
          <strong>{{ action.title }}</strong>
          <small>{{ action.description }}</small>
        </span>
      </RouterLink>
    </nav>

    <section class="dashboard-grid">
      <section class="gc-card dashboard-panel dashboard-panel--certificates" aria-label="应用资产状态热力图">
        <header class="dashboard-panel__header">
          <div>
            <h2>应用资产状态</h2>
            <p v-if="overview?.generatedAt">更新于 {{ formatBrowserLocalTime(overview.generatedAt) }}</p>
          </div>
          <RouterLink class="gc-button" to="/assets">应用资产</RouterLink>
        </header>

        <div class="dashboard-heatmap" aria-label="证书、Agent、网关和应用资产状态">
          <section
            v-for="group in overview?.statusGroups ?? []"
            :key="group.key"
            class="dashboard-heatmap__group"
          >
            <header>
              <div>
                <strong>{{ group.title }}</strong>
                <span>{{ group.summary }} · {{ group.total }} 个</span>
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
                  :aria-label="blockTitle(block)"
                />
                <span v-if="activeTooltip?.id === block.id" class="dashboard-heatmap__tooltip" role="tooltip">
                  <strong>{{ block.label }}</strong>
                  <span>{{ block.status }}</span>
                  <small v-if="block.detail">{{ block.detail }}</small>
                  <time v-if="block.updatedAt">{{ formatBrowserLocalTime(block.updatedAt, { includeSeconds: false }) }}</time>
                </span>
              </span>
            </div>
            <div v-else class="dashboard-heatmap__empty">暂无对象</div>
          </section>
          <footer class="dashboard-heatmap__legend" aria-label="状态图例">
            <span><i class="dashboard-heatmap__dot dashboard-heatmap__dot--ok"></i>正常</span>
            <span><i class="dashboard-heatmap__dot dashboard-heatmap__dot--warning"></i>关注</span>
            <span><i class="dashboard-heatmap__dot dashboard-heatmap__dot--error"></i>异常</span>
            <span><i class="dashboard-heatmap__dot dashboard-heatmap__dot--unknown"></i>未知</span>
            <span><i class="dashboard-heatmap__dot dashboard-heatmap__dot--disabled"></i>禁用</span>
          </footer>
        </div>

        <div class="dashboard-table" role="table" aria-label="证书状态列表">
          <div class="dashboard-table__row dashboard-table__row--head" role="row">
            <span role="columnheader">证书</span>
            <span role="columnheader">域名</span>
            <span role="columnheader">状态</span>
            <span role="columnheader">剩余时间</span>
            <span role="columnheader">绑定</span>
          </div>
          <div
            v-for="item in overview?.certificateStatuses ?? []"
            :key="item.certificateAssetId"
            class="dashboard-table__row"
            role="row"
          >
            <span role="cell">
              <strong>{{ item.name }}</strong>
              <small>{{ item.notAfter ? formatBrowserLocalTime(item.notAfter, { includeSeconds: false }) : '未记录到期时间' }}</small>
            </span>
            <span role="cell">{{ item.primaryDomain }}</span>
            <span role="cell">
              <mark class="dashboard-state" :data-state="item.state">{{ stateLabel(item.state) }}</mark>
            </span>
            <span role="cell">{{ daysText(item.daysRemaining) }}</span>
            <span role="cell">{{ item.bindingCount }}</span>
          </div>
        </div>

        <div v-if="overview && overview.certificateStatuses.length === 0" class="dashboard-empty">
          暂无证书状态数据
        </div>
      </section>

      <section class="gc-card dashboard-panel dashboard-panel--audits" aria-label="最近审计日志">
        <header class="dashboard-panel__header">
          <div>
            <h2>最近审计日志</h2>
            <p>优先展示失败、拒绝、高风险和关键业务变更。</p>
          </div>
          <RouterLink class="gc-button" to="/audits">审计</RouterLink>
        </header>

        <ol class="dashboard-audits">
          <li v-for="item in overview?.recentAudits ?? []" :key="item.id" :data-result="item.result">
            <span class="dashboard-audits__result" :data-result="item.result">
              {{ auditResultLabel(item.result) }}
            </span>
            <div class="dashboard-audits__body">
              <div class="dashboard-audits__title-row">
                <strong>{{ auditReadableTitle(item) }}</strong>
                <span class="dashboard-audits__type">{{ auditTypeLabel(item) }}</span>
              </div>
              <p>{{ auditSummary(item) }}</p>
            </div>
            <time>{{ formatBrowserLocalTime(item.createdAt, { includeSeconds: false }) }}</time>
          </li>
        </ol>

        <div v-if="overview && overview.recentAudits.length === 0" class="dashboard-empty">
          暂无审计日志
        </div>
      </section>
    </section>
  </section>
</template>

<style scoped>
.dashboard-page {
  gap: var(--gc-space-5);
}

.dashboard-page__error {
  margin: 0;
  border: 1px solid var(--gc-color-danger-border);
  border-radius: 8px;
  padding: 12px 14px;
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-bg);
  font-weight: 750;
}

.dashboard-page__metrics {
  display: grid;
  grid-template-columns: repeat(6, minmax(150px, 1fr));
  gap: var(--gc-space-3);
}

.dashboard-metric {
  display: grid;
  gap: var(--gc-space-2);
  min-height: 132px;
  border: 1px solid var(--gc-color-border-soft);
  border-radius: 8px;
  padding: 16px;
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
  font-size: 36px;
  line-height: 1;
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
  border-top: 3px solid var(--gc-color-success);
}

.dashboard-metric[data-trend="warning"] {
  border-top: 3px solid var(--gc-color-warning);
}

.dashboard-metric[data-trend="danger"] {
  border-top: 3px solid var(--gc-color-danger);
}

.dashboard-metric--loading {
  opacity: .72;
}

.dashboard-actions {
  display: grid;
  grid-template-columns: repeat(6, minmax(150px, 1fr));
  gap: var(--gc-space-3);
}

.dashboard-action {
  display: flex;
  align-items: center;
  gap: var(--gc-space-3);
  min-height: 72px;
  border: 1px solid var(--gc-color-border);
  border-radius: 8px;
  padding: 12px;
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
  width: 28px;
  height: 28px;
  border-radius: 8px;
  color: var(--gc-color-primary);
  background: var(--gc-color-primary-soft);
  font-size: 20px;
  font-weight: 900;
}

.dashboard-action span:last-child {
  display: grid;
  gap: 4px;
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
  grid-template-columns: minmax(0, 1fr);
  gap: var(--gc-space-4);
  align-items: start;
}

.dashboard-panel {
  border-radius: 8px;
  padding: 0;
  overflow: hidden;
}

.dashboard-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-4);
  padding: 16px;
  border-bottom: 1px solid var(--gc-color-border);
  background: var(--gc-color-surface-muted);
}

.dashboard-panel__header h2,
.dashboard-panel__header p {
  margin: 0;
}

.dashboard-panel__header h2 {
  font-size: 18px;
  letter-spacing: 0;
}

.dashboard-panel__header p {
  margin-top: 4px;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: 650;
}

.dashboard-heatmap {
  display: grid;
  gap: 16px;
  padding: 16px;
}

.dashboard-heatmap__group {
  display: grid;
  grid-template-columns: minmax(120px, 170px) minmax(0, 1fr);
  gap: 12px;
  align-items: start;
  min-height: 48px;
}

.dashboard-heatmap__group header {
  min-width: 0;
}

.dashboard-heatmap__group strong {
  display: block;
  color: var(--gc-color-text);
  font-size: 14px;
  font-weight: 900;
}

.dashboard-heatmap__group span {
  display: block;
  margin-top: 4px;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 750;
  line-height: 1.35;
}

.dashboard-heatmap__blocks {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(28px, 28px));
  grid-auto-rows: 28px;
  gap: 8px;
  align-content: start;
  min-height: 36px;
}

.dashboard-heatmap__block {
  display: block;
  width: 28px;
  height: 28px;
  border: 1px solid var(--gc-color-border);
  border-radius: 6px;
  box-shadow: inset 0 1px 0 var(--gc-color-surface-muted);
}

.dashboard-heatmap__block-wrap {
  position: relative;
  display: block;
  width: 28px;
  height: 28px;
}

.dashboard-heatmap__block:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 12px var(--gc-color-border-strong);
}

.dashboard-heatmap__tooltip {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 10px);
  z-index: 30;
  display: grid;
  gap: 4px;
  width: max-content;
  min-width: 190px;
  max-width: 280px;
  padding: 10px 12px;
  border: 1px solid var(--gc-color-border-strong);
  border-radius: 8px;
  color: var(--gc-color-text);
  background: var(--gc-color-surface-overlay);
  box-shadow: 0 14px 34px var(--gc-color-border-strong);
  transform: translateX(-50%);
  pointer-events: none;
}

.dashboard-heatmap__tooltip::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 100%;
  width: 10px;
  height: 10px;
  border-right: 1px solid var(--gc-color-border-strong);
  border-bottom: 1px solid var(--gc-color-border-strong);
  background: var(--gc-color-surface-overlay);
  transform: translate(-50%, -5px) rotate(45deg);
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
  min-height: 24px;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: 750;
}

.dashboard-heatmap__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  padding-top: 4px;
  border-top: 1px solid var(--gc-color-border);
}

.dashboard-heatmap__legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 800;
}

.dashboard-heatmap__dot {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.dashboard-table {
  display: grid;
  border-top: 1px solid var(--gc-color-border);
}

.dashboard-table__row {
  display: grid;
  grid-template-columns: minmax(190px, 1.3fr) minmax(160px, 1fr) 110px 110px 70px;
  gap: var(--gc-space-3);
  align-items: center;
  min-height: 56px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--gc-color-border-subtle);
}

.dashboard-table__row--head {
  min-height: 40px;
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
  gap: 3px;
}

.dashboard-table__row strong {
  font-size: var(--gc-font-size-sm);
}

.dashboard-table__row small {
  color: var(--gc-color-text-muted);
}

.dashboard-state {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  border-radius: 999px;
  padding: 0 9px;
  font-size: var(--gc-font-size-xs);
  font-weight: 850;
  background: var(--gc-color-muted-bg);
  color: var(--gc-color-muted);
}

.dashboard-state[data-state="valid"] {
  color: var(--gc-color-success);
  background: var(--gc-color-success-bg);
}

.dashboard-state[data-state="expiring"] {
  color: var(--gc-color-warning);
  background: var(--gc-color-warning-bg);
}

.dashboard-state[data-state="critical"],
.dashboard-state[data-state="expired"] {
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-bg);
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
  grid-template-columns: 56px minmax(0, 1fr) max-content;
  gap: 10px 12px;
  align-items: start;
  padding: 14px 16px;
  border-bottom: 1px solid var(--gc-color-border-subtle);
}

.dashboard-audits__result {
  display: inline-grid;
  place-items: center;
  min-width: 48px;
  min-height: 24px;
  border: 1px solid var(--gc-color-border);
  border-radius: 999px;
  padding: 0 8px;
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
  gap: 6px;
  min-width: 0;
}

.dashboard-audits__title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.dashboard-audits__title-row strong,
.dashboard-audits__body p {
  overflow-wrap: anywhere;
}

.dashboard-audits__title-row strong {
  color: var(--gc-color-text);
  font-size: 15px;
  line-height: 1.25;
  font-weight: 950;
}

.dashboard-audits__type {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  border-radius: 999px;
  padding: 0 8px;
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
  padding-top: 3px;
  white-space: nowrap;
}

.dashboard-empty {
  display: grid;
  place-items: center;
  min-height: 180px;
  color: var(--gc-color-text-muted);
  font-weight: 850;
}

@media (max-width: 1280px) {
  .dashboard-page__metrics,
  .dashboard-actions {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .dashboard-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .dashboard-page__metrics,
  .dashboard-actions {
    grid-template-columns: 1fr;
  }

  .dashboard-heatmap__group {
    grid-template-columns: 1fr;
  }

  .dashboard-table__row {
    grid-template-columns: 1fr;
    gap: 6px;
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
