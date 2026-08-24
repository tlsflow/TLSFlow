<script setup lang="ts">
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { GcExecutionLogViewer } from '@/design-system/components'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import { listExecutions, rollbackExecution } from '@/api/modules/executions.api'
import type { ViewRow } from '@/composables/useBusinessPage'
import { useExecutionDetail } from '@/composables/useExecutionDetail'

const route = useRoute()
const selectedRow = ref<ViewRow | null>(null)

const config: BusinessPageConfig = {
  title: '执行记录',
  description: '部署执行状态、步骤日志、失败原因、重试建议和回滚入口。',
  readPermission: 'execution.read',
  primaryPermission: 'execution.read',
  primaryActionLabel: '查看实时日志',
  moduleName: 'executions',
  resourceName: '执行运行',
  defaultStatus: 'RUNNING',
  defaultRisk: 'MEDIUM',
  showDetailPanel: true,
  showActionPanel: true,
  columns: [
    { key: 'name', title: '执行编号', candidates: ['runNo', 'name', 'id'] },
    { key: 'status', title: '状态', candidates: ['status', 'state', 'result'] },
    { key: 'risk', title: '风险', candidates: ['risk', 'riskLevel'] },
    { key: 'planId', title: '部署计划', candidates: ['deploymentPlanId', 'planId'] },
    { key: 'startedAt', title: '开始时间', candidates: ['startedAt', 'createdAt'], kind: 'date' }
  ],
  metrics: [
    { title: '执行总数', description: '当前可追踪的执行运行。', status: 'RUNNING', risk: 'MEDIUM' },
    { title: '高危待处理', description: '失败、部分成功或需要回滚的执行。', status: 'FAILED', risk: 'HIGH' }
  ],
  detailFields: [
    { label: '执行 ID', candidates: ['id', 'runId'] },
    { label: '部署计划', candidates: ['deploymentPlanId', 'planId'] },
    { label: '执行目标', candidates: ['targetSummary', 'targets', 'targetIds'] },
    { label: '步骤状态', candidates: ['steps', 'stepResults', 'workflow.steps'] },
    { label: '审批记录', candidates: ['approval.status', 'approvalResult', 'approvedBy'] },
    { label: '回滚入口', candidates: ['rollbackRunId', 'rollbackStatus', 'rollback.available'] },
    { label: '失败原因', candidates: ['failureReason', 'error.message'] }
  ],
  contextLinks: [
    { label: '查看部署计划', to: '/deployment-plans', queryKey: 'planId', candidates: ['deploymentPlanId', 'planId'] },
    { label: '查看审计事件', to: '/audits', queryKey: 'runId', candidates: ['id', 'runId'] }
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
      status: typeof route.query.status === 'string' ? route.query.status : undefined
    }
  }),
  onSelectionChange: (row) => {
    selectedRow.value = row
  },
  actions: [
    { label: '发起回滚', permission: 'execution.rollback', danger: true, confirmText: 'ROLLBACK', riskText: '回滚会再次改动目标服务证书配置，必须确认备份引用和影响范围。', requiresSelection: true, run: (row) => rollbackExecution(row?.id ?? '', { dryRun: true }) }
  ]
}

const executionDetail = useExecutionDetail(selectedRow)
</script>

<template>
  <section class="gc-page gc-execution-page">
    <BusinessResourcePage :config="config" />
    <GcExecutionLogViewer
      :lines="executionDetail.lines.value"
      :steps="executionDetail.steps.value"
      :polling="executionDetail.isPolling.value"
      mode="polling"
    />
  </section>
</template>

<style scoped>
.gc-execution-page { display: grid; gap: var(--gc-space-4); }
</style>
