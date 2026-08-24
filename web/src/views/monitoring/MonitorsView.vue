<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { listDashboardRisks } from '@/api/modules/dashboard.api'
import { listMonitors, scanMonitorRisks } from '@/api/modules/monitors.api'
import { GcEmptyState, GcRiskBadge, GcStatusTag } from '@/design-system/components'
import { readString } from '@/composables/useBusinessPage'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'

const router = useRouter()
const riskCardsState = ref<readonly Record<string, unknown>[]>([])
const riskCardsError = ref('')

const config: BusinessPageConfig = {
  title: '监控告警',
  description: '证书到期、绑定漂移、执行失败、风险事件和告警规则入口。',
  readPermission: 'monitor.read',
  primaryPermission: 'monitor.write',
  primaryActionLabel: '新建告警规则',
  moduleName: 'monitors',
  resourceName: '风险事件',
  defaultStatus: 'READY',
  defaultRisk: 'HIGH',
  showDetailPanel: true,
  showActionPanel: true,
  columns: [
    { key: 'name', title: '监控目标', candidates: ['name', 'targetName', 'resourceName'] },
    { key: 'status', title: '状态', candidates: ['status', 'state'] },
    { key: 'risk', title: '风险', candidates: ['risk', 'riskLevel', 'severity'] },
    { key: 'type', title: '类型', candidates: ['type', 'targetType'] },
    { key: 'checkedAt', title: '最近检查', candidates: ['checkedAt', 'lastCheckedAt', 'updatedAt'], kind: 'date' },
  ],
  metrics: [
    { title: '监控总数', description: '证书、绑定和执行风险目标。', status: 'READY', risk: 'MEDIUM' },
    { title: '高危待处理', description: '即将过期、已漂移或执行失败的告警。', status: 'ERROR', risk: 'HIGH' },
  ],
  detailFields: [
    { label: '风险事件 ID', candidates: ['riskEventId', 'eventId', 'id'] },
    { label: '证书 ID', candidates: ['certificateId'] },
    { label: '绑定 ID', candidates: ['bindingId'] },
    { label: '执行 ID', candidates: ['executionRunId', 'runId'] },
    { label: '处理建议', candidates: ['suggestion', 'recommendation', 'message'] },
  ],
  contextLinks: [
    { label: '查看证书', to: '/certificates', queryKey: 'certificateId', candidates: ['certificateId'] },
    { label: '查看绑定', to: '/bindings', queryKey: 'bindingId', candidates: ['bindingId'] },
    { label: '查看执行记录', to: '/executions', queryKey: 'runId', candidates: ['executionRunId', 'runId'] },
  ],
  emptyTitle: '暂无监控目标',
  emptyDescription: '监控数据暂不可用，请稍后重试或检查后端服务状态。',
  load: () => listMonitors({ page: 1, pageSize: 20, sort: 'detectedAt:desc' }),
  actions: [
    { label: '重新扫描风险', permission: 'monitor.write', danger: false, requiresSelection: false, run: () => scanMonitorRisks({}) },
  ],
}

async function loadRiskCards() {
  try {
    const result = await listDashboardRisks({ page: 1, pageSize: 6, sort: 'detectedAt:desc' })
    riskCardsState.value = result.data?.items ?? []
    riskCardsError.value = ''
  } catch (cause) {
    riskCardsState.value = []
    riskCardsError.value = cause instanceof Error ? cause.message : '风险卡片加载失败'
  }
}

onMounted(() => {
  void loadRiskCards()
})

const riskCards = computed(() => riskCardsState.value)

function jumpByRisk(item: Record<string, unknown>) {
  const certificateId = readString(item, ['certificateId'], '')
  if (certificateId) {
    void router.push({ path: '/certificates', query: { certificateId } })
    return
  }

  const bindingId = readString(item, ['bindingId'], '')
  if (bindingId) {
    void router.push({ path: '/bindings', query: { bindingId } })
    return
  }

  const runId = readString(item, ['executionRunId', 'runId'], '')
  void router.push({ path: '/executions', query: runId ? { runId } : { status: readString(item, ['status', 'state'], '') } })
}
</script>

<template>
  <section class="gc-page gc-monitor-page">
    <section class="gc-card gc-monitor-page__risks" aria-label="风险仪表盘">
      <header>
        <div>
          <strong>风险仪表盘</strong>
          <p>将高风险卡片直接跳转到证书、绑定或执行记录的上下文页面。</p>
        </div>
      </header>
      <GcEmptyState v-if="riskCardsError" title="风险卡片加载失败" :description="riskCardsError" />
      <div v-else class="gc-monitor-page__cards">
        <button
          v-for="item in riskCards"
          :key="readString(item, ['id', 'eventId'], Math.random().toString())"
          class="gc-monitor-page__card"
          type="button"
          @click="jumpByRisk(item)"
        >
          <div class="gc-monitor-page__card-head">
            <strong>{{ readString(item, ['name', 'resourceName', 'title'], '未命名风险') }}</strong>
            <GcRiskBadge :risk="readString(item, ['risk', 'riskLevel', 'severity'], 'HIGH') as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'" />
          </div>
          <p>{{ readString(item, ['message', 'summary', 'suggestion'], '暂无风险摘要') }}</p>
          <footer>
            <GcStatusTag :status="readString(item, ['status', 'state'], 'READY')" />
            <span>{{ readString(item, ['certificateId', 'bindingId', 'executionRunId', 'runId'], '无直接关联资源') }}</span>
          </footer>
        </button>
      </div>
    </section>
    <BusinessResourcePage :config="config" />
  </section>
</template>

<style scoped>
.gc-monitor-page { display: grid; gap: var(--gc-space-5); }
.gc-monitor-page__risks { display: grid; gap: var(--gc-space-4); padding: 24px; }
.gc-monitor-page__risks header strong { font-size: 20px; letter-spacing: -0.03em; }
.gc-monitor-page__risks p { margin: var(--gc-space-1) 0 0; color: var(--gc-color-text-muted); font-weight: 650; }
.gc-monitor-page__cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: var(--gc-space-3); }
.gc-monitor-page__card {
  border: 1px solid var(--gc-color-border);
  border-radius: var(--gc-radius-md);
  padding: var(--gc-space-4);
  background: linear-gradient(180deg, #fff, #fbfdff);
  text-align: left;
  display: grid;
  gap: var(--gc-space-3);
  cursor: pointer;
  box-shadow: var(--gc-shadow-sm);
  transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease;
}
.gc-monitor-page__card:hover { transform: translateY(-2px); box-shadow: var(--gc-shadow-md); border-color: #dbeafe; }
.gc-monitor-page__card-head, .gc-monitor-page__card footer { display: flex; justify-content: space-between; gap: var(--gc-space-2); align-items: center; }
.gc-monitor-page__card p { margin: 0; line-height: 1.55; }
.gc-monitor-page__card footer { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); font-weight: 700; }
</style>
