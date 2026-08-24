<script setup lang="ts">
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import { listDashboardRisks } from '@/api/modules/dashboard.api'

const config: BusinessPageConfig = {
  title: '仪表盘',
  description: '展示证书到期、绑定漂移、部署失败、不可自动更新目标和近期风险。',
  readPermission: 'dashboard.read',
  primaryPermission: 'dashboard.read',
  primaryActionLabel: '刷新风险概览',
  moduleName: 'dashboard',
  resourceName: '风险事件',
  defaultStatus: 'READY',
  defaultRisk: 'MEDIUM',
  columns: [
    { key: 'name', title: '风险对象', candidates: ['name', 'resourceName', 'title'] },
    { key: 'status', title: '状态', candidates: ['status', 'state'] },
    { key: 'risk', title: '风险', candidates: ['risk', 'riskLevel', 'severity'] },
    { key: 'updatedAt', title: '更新时间', candidates: ['updatedAt', 'detectedAt', 'createdAt'], kind: 'date' }
  ],
  metrics: [
    { title: '全部风险', description: '来自风险事件接口的当前可见风险。', status: 'READY', risk: 'MEDIUM' },
    { title: '高危待处理', description: '需要优先处理的漂移、失败和过期问题。', status: 'PENDING_APPROVAL', risk: 'HIGH' }
  ],
  emptyTitle: '暂无风险数据',
  emptyDescription: '后端监控数据暂不可用或当前租户没有风险事件。',
  load: () => listDashboardRisks({ page: 1, pageSize: 20, sort: 'detectedAt:desc' }),
  actions: []
}
</script>

<template><BusinessResourcePage :config="config" /></template>
