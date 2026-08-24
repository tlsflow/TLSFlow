<script setup lang="ts">
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import { exportAuditEvidence, listAudits } from '@/api/modules/audits.api'

const config: BusinessPageConfig = {
  title: '审计日志',
  description: '操作人、资源、动作、结果、IP、请求 ID、审批和证据导出入口。',
  readPermission: 'audit.read',
  primaryPermission: 'audit.export',
  primaryActionLabel: '导出审计证据',
  moduleName: 'audits',
  resourceName: '审计事件',
  defaultStatus: 'SUCCESS',
  defaultRisk: 'LOW',
  columns: [
    { key: 'name', title: '操作/资源', candidates: ['action', 'operation', 'resourceName'] },
    { key: 'status', title: '结果', candidates: ['result', 'status', 'state'] },
    { key: 'risk', title: '风险', candidates: ['risk', 'riskLevel'] },
    { key: 'requestId', title: 'requestId', candidates: ['requestId'] },
    { key: 'createdAt', title: '时间', candidates: ['createdAt', 'timestamp'], kind: 'date' }
  ],
  metrics: [
    { title: '审计总数', description: '可追踪操作、审批和执行证据。', status: 'SUCCESS', risk: 'LOW' },
    { title: '高危待处理', description: '高危操作失败或缺少证据链事件。', status: 'FAILED', risk: 'HIGH' }
  ],
  emptyTitle: '暂无审计事件',
  emptyDescription: '所有危险操作应能通过 requestId、操作 ID 和任务 ID 回溯。',
  load: () => listAudits({ page: 1, pageSize: 20, sort: 'createdAt:desc' }),
  actions: [
    { label: '导出证据包', permission: 'audit.export', danger: true, confirmText: 'EXPORT', riskText: '导出包含操作证据和审计元数据，请确认合规用途。', run: () => exportAuditEvidence({ scope: 'current-filter', dryRun: true }) }
  ]
}
</script>

<template><BusinessResourcePage :config="config" /></template>
