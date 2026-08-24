<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { GcModal, GcStatusTag } from '@/design-system/components'
import { listExecutions, rollbackExecution } from '@/api/modules/executions.api'
import { readString, type ViewRow } from '@/composables/useBusinessPage'
import { useExecutionDetail } from '@/composables/useExecutionDetail'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import type { BusinessPageConfig } from '@/views/business-page.types'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'

const route = useRoute()
const detailModalOpen = ref(false)
const detailRow = ref<ViewRow | null>(null)
const activeTab = ref<'summary' | 'steps' | 'logs'>('summary')

const config: BusinessPageConfig = {
  title: '执行记录',
  description: '查看部署执行状态、步骤日志、dry-run 预检结论、失败原因和回滚入口。',
  readPermission: 'execution.read',
  primaryPermission: 'execution.read',
  primaryActionLabel: '刷新列表',
  primaryAction: async () => {},
  moduleName: 'executions',
  resourceName: '执行运行',
  defaultStatus: 'RUNNING',
  defaultRisk: 'MEDIUM',
  showDetailPanel: false,
  showActionPanel: false,
  columns: [
    { key: 'name', title: '执行编号', candidates: ['runNo', 'name', 'id'] },
    { key: 'status', title: '状态', candidates: ['status', 'state', 'result'] },
    { key: 'risk', title: '风险', candidates: ['risk', 'riskLevel'] },
    { key: 'planId', title: '部署计划', candidates: ['deploymentPlanId', 'planId'] },
    { key: 'startedAt', title: '开始时间', candidates: ['startedAt', 'createdAt'], kind: 'date' },
  ],
  metrics: [
    { title: '执行总数', description: '当前可追踪的执行运行。', status: 'RUNNING', risk: 'MEDIUM' },
    { title: '高危待处理', description: '失败、部分成功或需要回滚的执行。', status: 'FAILED', risk: 'HIGH' },
  ],
  detailFields: [
    { label: '执行 ID', candidates: ['id', 'runId'] },
    { label: '部署计划', candidates: ['deploymentPlanId', 'planId'] },
    { label: '运行类型', candidates: ['type'] },
    { label: '执行状态', candidates: ['status', 'state', 'result'] },
    { label: '执行目标', candidates: ['executionTargetId', 'targetSummary', 'targetIds.0'] },
    { label: '外部运行 ID', candidates: ['externalRunId'] },
    { label: '开始时间', candidates: ['startedAt', 'createdAt'] },
    { label: '结束时间', candidates: ['finishedAt', 'updatedAt'] },
    { label: '错误码', candidates: ['errorCode'] },
    { label: '失败原因', candidates: ['failureReason', 'errorMessage', 'error.message'] },
  ],
  contextLinks: [
    { label: '查看部署计划', to: '/deployment-plans', queryKey: 'planId', candidates: ['deploymentPlanId', 'planId'] },
    { label: '查看审计事件', to: '/audits', queryKey: 'runId', candidates: ['id', 'runId'] },
  ],
  emptyTitle: '暂无执行记录',
  emptyDescription: '部署计划执行后会在这里展示日志、状态和审计关联。',
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
      label: '查看详情',
      permission: 'execution.read',
      reloadAfterRun: false,
      run: async (row) => {
        openExecutionDetail(row)
      },
    },
  ],
  actions: [
    {
      label: '发起回滚',
      permission: 'execution.rollback',
      danger: true,
      confirmText: 'ROLLBACK',
      riskText: '回滚会再次改动目标服务证书配置，必须确认备份引用和影响范围。',
      requiresSelection: true,
      run: (row) => rollbackExecution(row?.id ?? '', { dryRun: true }),
    },
  ],
}

const modalExecutionDetail = useExecutionDetail(detailRow)
const modalSummaryCards = computed(() => {
  const summary = modalExecutionDetail.dryRunSummary.value
  if (!summary) return []
  return [
    { label: '通过', value: summary.passed },
    { label: '警告', value: summary.warning },
    { label: '失败', value: summary.failed },
    { label: '未知', value: summary.unknown },
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
      :title="detailRow ? `执行详情 ${detailRow.id}` : '执行详情'"
      description="查看执行运行的基础信息、步骤状态和日志。"
      size="xxl"
      width="min(1280px, calc(100vw - 32px))"
    >
      <section v-if="detailRow" class="execution-detail-modal">
        <section class="execution-detail-modal__hero">
          <div class="execution-detail-modal__hero-copy">
            <p class="execution-detail-modal__eyebrow">Execution Run</p>
            <h2>{{ readString(detailRow.raw, ['runNo', 'name', 'id'], detailRow.id) }}</h2>
            <span>部署计划 {{ readString(detailRow.raw, ['deploymentPlanId', 'planId']) }}</span>
          </div>
          <div class="execution-detail-modal__hero-side">
            <GcStatusTag :status="readString(detailRow.raw, ['status', 'state', 'result'])" />
            <div class="execution-detail-modal__spotlight">
              <small>运行类型</small>
              <strong>{{ readString(detailRow.raw, ['type']) }}</strong>
            </div>
          </div>
        </section>

        <div class="execution-detail-modal__tabs">
          <button class="execution-detail-modal__tab" type="button" :data-active="activeTab === 'summary'" @click="activeTab = 'summary'">概览</button>
          <button class="execution-detail-modal__tab" type="button" :data-active="activeTab === 'steps'" @click="activeTab = 'steps'">步骤</button>
          <button class="execution-detail-modal__tab" type="button" :data-active="activeTab === 'logs'" @click="activeTab = 'logs'">日志</button>
        </div>

        <section v-if="activeTab === 'summary'" class="execution-detail-modal__section">
          <dl class="execution-detail-modal__facts">
            <div>
              <dt>执行 ID</dt>
              <dd>{{ readString(detailRow.raw, ['id', 'runId'], detailRow.id) }}</dd>
            </div>
            <div>
              <dt>部署计划</dt>
              <dd>{{ readString(detailRow.raw, ['deploymentPlanId', 'planId']) }}</dd>
            </div>
            <div>
              <dt>运行类型</dt>
              <dd>{{ readString(detailRow.raw, ['type']) }}</dd>
            </div>
            <div>
              <dt>执行状态</dt>
              <dd>{{ readString(detailRow.raw, ['status', 'state', 'result']) }}</dd>
            </div>
            <div>
              <dt>开始时间</dt>
              <dd>{{ formatBrowserLocalTime(readString(detailRow.raw, ['startedAt', 'createdAt'])) || readString(detailRow.raw, ['startedAt', 'createdAt']) }}</dd>
            </div>
            <div>
              <dt>结束时间</dt>
              <dd>{{ formatBrowserLocalTime(readString(detailRow.raw, ['finishedAt', 'updatedAt'])) || readString(detailRow.raw, ['finishedAt', 'updatedAt']) }}</dd>
            </div>
            <div>
              <dt>错误码</dt>
              <dd>{{ readString(detailRow.raw, ['errorCode']) }}</dd>
            </div>
            <div>
              <dt>失败原因</dt>
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
          <p v-if="modalExecutionDetail.loading.value" class="execution-detail-modal__loading">正在加载步骤...</p>
          <p v-else-if="modalExecutionDetail.error.value" class="execution-detail-modal__error">{{ modalExecutionDetail.error.value }}</p>
          <ul v-else-if="modalExecutionDetail.steps.value.length" class="execution-detail-modal__list">
            <li v-for="step in modalExecutionDetail.steps.value" :key="step.id" class="execution-detail-modal__list-item">
              <div class="execution-detail-modal__list-head">
                <strong>{{ step.name }}</strong>
                <GcStatusTag :status="step.status" />
              </div>
              <p>{{ step.detail ?? '暂无步骤说明' }}</p>
              <small>{{ step.startedAt ?? '未开始' }}{{ step.finishedAt ? ` -> ${step.finishedAt}` : '' }}</small>
            </li>
          </ul>
          <p v-else class="execution-detail-modal__loading">暂无步骤。</p>
        </section>

        <section v-else class="execution-detail-modal__section">
          <p v-if="modalExecutionDetail.loading.value" class="execution-detail-modal__loading">正在加载日志...</p>
          <p v-else-if="modalExecutionDetail.error.value" class="execution-detail-modal__error">{{ modalExecutionDetail.error.value }}</p>
          <ul v-else-if="modalExecutionDetail.lines.value.length" class="execution-detail-modal__logs">
            <li v-for="line in modalExecutionDetail.lines.value" :key="line.id" class="execution-detail-modal__log-item" :data-level="line.level">
              <div class="execution-detail-modal__log-meta">
                <span>{{ line.time }}</span>
                <strong>{{ line.step || '执行日志' }}</strong>
              </div>
              <p>{{ line.message }}</p>
            </li>
          </ul>
          <p v-else class="execution-detail-modal__loading">暂无日志。</p>
        </section>
      </section>

      <template #actions>
        <button class="gc-button" type="button" @click="detailModalOpen = false">关闭</button>
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
  border: 1px solid #d9e5f7;
  border-radius: 18px;
  background:
    radial-gradient(circle at top right, rgb(59 130 246 / 12%), transparent 26%),
    linear-gradient(140deg, #f7fbff 0%, #ffffff 54%, #f3f7fc 100%);
}

.execution-detail-modal__hero-copy {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.execution-detail-modal__eyebrow {
  margin: 0;
  color: #5b6f88;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.execution-detail-modal__hero-copy h2 {
  margin: 0;
  color: #0f172a;
  font-size: 24px;
  line-height: 1.06;
  overflow-wrap: anywhere;
}

.execution-detail-modal__hero-copy span {
  color: #64748b;
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
  background: #0f172a;
  color: #fff;
}

.execution-detail-modal__spotlight small {
  color: rgb(255 255 255 / 68%);
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
  border: 1px solid #dbe6f4;
  border-radius: 999px;
  background: #f8fbff;
}

.execution-detail-modal__tab {
  min-height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #5b6f88;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.execution-detail-modal__tab[data-active='true'] {
  background: #fff;
  color: #0f172a;
  box-shadow: 0 4px 14px rgb(15 23 42 / 10%);
}

.execution-detail-modal__section,
.execution-detail-modal__summary {
  display: grid;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid #e3ebf5;
  border-radius: 16px;
  background: linear-gradient(180deg, #ffffff, #fbfdff);
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
  background: #f8fbff;
  border: 1px solid #e4edf8;
}

.execution-detail-modal__facts dt {
  color: #64748b;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.execution-detail-modal__facts dd {
  margin: 0;
  color: #0f172a;
  font-size: 13px;
  font-weight: 800;
  overflow-wrap: anywhere;
}

.execution-detail-modal__summary-head {
  display: grid;
  gap: 4px;
}

.execution-detail-modal__summary-head strong {
  color: #0f172a;
  font-size: 15px;
}

.execution-detail-modal__summary-head span {
  color: #64748b;
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
  border: 1px solid #e4edf8;
  background: #f8fbff;
}

.execution-detail-modal__summary-grid small {
  color: #64748b;
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
}

.execution-detail-modal__summary-grid strong {
  font-size: 18px;
  color: #0f172a;
}

.execution-detail-modal__summary[data-state='passed'] {
  border-color: #bbf7d0;
  background: #f0fdf4;
}

.execution-detail-modal__summary[data-state='warning'] {
  border-color: #fde68a;
  background: #fffbeb;
}

.execution-detail-modal__summary[data-state='failed'] {
  border-color: #fecaca;
  background: #fef2f2;
}

.execution-detail-modal__summary[data-state='pending'],
.execution-detail-modal__summary[data-state='queued'],
.execution-detail-modal__summary[data-state='running'] {
  border-color: #bfdbfe;
  background: #eff6ff;
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
  border: 1px solid #e4edf8;
  border-radius: 12px;
  background: #f8fbff;
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
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.execution-detail-modal__log-meta strong {
  color: #0f172a;
  font-size: 12px;
}

.execution-detail-modal__log-item[data-level='error'] {
  border-color: #fecaca;
  background: #fef2f2;
}

.execution-detail-modal__log-item[data-level='warn'] {
  border-color: #fde68a;
  background: #fffbeb;
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
