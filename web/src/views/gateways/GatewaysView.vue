<script setup lang="ts">
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import { listGateways, probeGateway } from '@/api/modules/gateways.api'

const config: BusinessPageConfig = {
  title: '网关',
  description: '隔离区 Gateway、可达目标、协议适配器、负载、成功率和故障切换入口。',
  readPermission: 'gateway.read',
  primaryPermission: 'gateway.write',
  primaryActionLabel: '登记网关',
  moduleName: 'gateways',
  resourceName: '网关',
  defaultStatus: 'ONLINE',
  defaultRisk: 'MEDIUM',
  columns: [
    { key: 'name', title: '网关名称', candidates: ['name', 'gatewayName', 'id'] },
    { key: 'status', title: '状态', candidates: ['status', 'state', 'onlineStatus'] },
    { key: 'risk', title: '风险', candidates: ['risk', 'riskLevel'] },
    { key: 'zone', title: '隔离区', candidates: ['zoneName', 'zoneId', 'networkZone'] },
    { key: 'load', title: '当前负载', candidates: ['currentLoad', 'load', 'activeTasks'] }
  ],
  metrics: [
    { title: '网关总数', description: '当前租户可用的 Gateway 和隔离区代理节点。', status: 'ONLINE', risk: 'MEDIUM' },
    { title: '高危待处理', description: '离线、不可达、负载过高或能力缺失的 Gateway。', status: 'OFFLINE', risk: 'HIGH' }
  ],
  detailFields: [
    { label: '网关 ID', candidates: ['id', 'gatewayId'] },
    { label: '名称', candidates: ['name', 'gatewayName'] },
    { label: '隔离区', candidates: ['zoneName', 'zoneId', 'networkZone'] },
    { label: '适配器', candidates: ['adapters', 'protocols', 'supportedProtocols'] },
    { label: '能力', candidates: ['capabilities', 'capabilityKeys'] },
    { label: '当前负载', candidates: ['currentLoad', 'load', 'activeTasks'] },
    { label: '成功率', candidates: ['successRate', 'statistics.successRate'] },
    { label: '最近心跳', candidates: ['lastSeenAt', 'heartbeatAt', 'updatedAt'] }
  ],
  contextLinks: [
    { label: '查看资产', to: '/assets', queryKey: 'gatewayId', candidates: ['id', 'gatewayId'] },
    { label: '查看执行记录', to: '/executions', queryKey: 'gatewayId', candidates: ['id', 'gatewayId'] }
  ],
  emptyTitle: '暂无网关',
  emptyDescription: '如目标网络无法直连，请登记 Gateway 并验证协议适配器和可达范围。',
  load: () => listGateways({ page: 1, pageSize: 20, sort: 'updatedAt:desc' }),
  actions: [
    { label: '探测网关可达性', permission: 'gateway.write', danger: true, confirmText: 'PROBE', riskText: '探测会访问隔离区目标网络，请确认范围和协议不会触发安全设备误报。', requiresSelection: true, run: (row) => probeGateway(row?.id ?? '', { dryRun: true }) }
  ]
}
</script>

<template><BusinessResourcePage :config="config" /></template>
