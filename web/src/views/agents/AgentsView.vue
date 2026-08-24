<script setup lang="ts">
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import { disableAgent, listAgents } from '@/api/modules/assets.api'

const config: BusinessPageConfig = {
  title: 'Agent',
  description: 'Full Agent、Legacy Agent、在线状态、心跳、能力集合和兼容 API 版本。',
  readPermission: 'agent.read',
  primaryPermission: 'agent.write',
  primaryActionLabel: '签发接入令牌',
  moduleName: 'agents',
  resourceName: 'Agent',
  defaultStatus: 'ONLINE',
  defaultRisk: 'MEDIUM',
  columns: [
    { key: 'name', title: 'Agent 名称', candidates: ['name', 'hostname', 'agentName'] },
    { key: 'status', title: '在线状态', candidates: ['status', 'onlineStatus', 'state'] },
    { key: 'risk', title: '风险', candidates: ['risk', 'riskLevel'] },
    { key: 'version', title: '版本', candidates: ['version', 'apiVersion'] },
    { key: 'lastSeenAt', title: '最近心跳', candidates: ['lastSeenAt', 'heartbeatAt'], kind: 'date' }
  ],
  metrics: [
    { title: 'Agent 总数', description: 'Full、Legacy 和脚本包节点统一入口。', status: 'ONLINE', risk: 'MEDIUM' },
    { title: '高危待处理', description: '离线、版本不兼容或能力异常 Agent。', status: 'OFFLINE', risk: 'HIGH' }
  ],
  emptyTitle: '暂无 Agent',
  emptyDescription: '请签发接入令牌并安装 Agent；老旧环境走 Legacy 或脚本包路径。',
  load: () => listAgents({ page: 1, pageSize: 20, sort: 'lastSeenAt:desc' }),
  actions: [
    { label: '禁用 Agent', permission: 'agent.write', danger: true, confirmText: 'DISABLE', riskText: '禁用 Agent 会影响自动部署和监控能力。', requiresSelection: true, run: (row) => disableAgent(row?.id ?? '', { dryRun: true }) }
  ]
}
</script>

<template><BusinessResourcePage :config="config" /></template>
