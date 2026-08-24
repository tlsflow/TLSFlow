<script setup lang="ts">
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import { listAssets, startDiscovery } from '@/api/modules/assets.api'

const config: BusinessPageConfig = {
  title: '资产',
  description: '主机、服务实例、Agent 状态、Gateway 路径、兼容等级和最近发现结果。',
  readPermission: 'host.read',
  primaryPermission: 'host.write',
  primaryActionLabel: '登记资产',
  moduleName: 'assets',
  resourceName: '主机资产',
  defaultStatus: 'DISCOVERED',
  defaultRisk: 'MEDIUM',
  columns: [
    { key: 'name', title: '主机名/IP', candidates: ['hostname', 'name', 'ipAddress'] },
    { key: 'status', title: 'Agent 状态', candidates: ['agentStatus', 'status', 'state'] },
    { key: 'risk', title: '风险', candidates: ['risk', 'riskLevel'] },
    { key: 'os', title: '操作系统', candidates: ['os', 'osType', 'platform'] },
    { key: 'compatibility', title: '兼容等级', candidates: ['compatibilityLevel', 'capability.level'] }
  ],
  metrics: [
    { title: '资产总数', description: '当前租户可见主机和服务实例。', status: 'DISCOVERED', risk: 'LOW' },
    { title: '高危待处理', description: '离线、能力缺失或发现失败资产。', status: 'OFFLINE', risk: 'HIGH' }
  ],
  detailFields: [
    { label: '资产 ID', candidates: ['id', 'hostId', 'assetId'] },
    { label: '主机/IP', candidates: ['hostname', 'name', 'ipAddress'] },
    { label: '操作系统', candidates: ['os', 'osType', 'platform'] },
    { label: 'Agent', candidates: ['agentStatus', 'agent.id', 'agentId'] },
    { label: 'Gateway', candidates: ['gatewayName', 'gatewayId'] },
    { label: '兼容等级', candidates: ['compatibilityLevel', 'capability.level'] }
  ],
  contextLinks: [
    { label: '查看绑定', to: '/bindings', queryKey: 'hostId', candidates: ['id', 'hostId', 'assetId'] },
    { label: '查看执行记录', to: '/executions', queryKey: 'hostId', candidates: ['id', 'hostId', 'assetId'] }
  ],
  emptyTitle: '暂无资产',
  emptyDescription: '请先登记主机、接入 Agent/Gateway，或执行一次 Provider 发现。',
  load: () => listAssets({ page: 1, pageSize: 20, sort: 'updatedAt:desc' }),
  actions: [
    { label: '发起资产发现', permission: 'host.write', danger: true, confirmText: 'DISCOVER', riskText: '发现任务可能访问生产网络，请确认目标范围和凭据最小权限。', run: () => startDiscovery({ scope: 'current-filter', dryRun: true }) }
  ]
}
</script>

<template><BusinessResourcePage :config="config" /></template>
