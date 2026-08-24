<script setup lang="ts">
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import { disablePlugin, listPlugins } from '@/api/modules/plugins.api'

const config: BusinessPageConfig = {
  title: '插件',
  description: '插件包、Provider、权限声明、签名校验、沙箱状态和隔离入口。',
  readPermission: 'plugin.read',
  primaryPermission: 'plugin.write',
  primaryActionLabel: '安装插件',
  moduleName: 'plugins',
  resourceName: '插件',
  defaultStatus: 'READY',
  defaultRisk: 'HIGH',
  columns: [
    { key: 'name', title: '插件名称', candidates: ['name', 'displayName', 'pluginName'] },
    { key: 'status', title: '状态', candidates: ['status', 'sandboxStatus', 'state'] },
    { key: 'risk', title: '风险', candidates: ['risk', 'riskLevel', 'permissionRisk'] },
    { key: 'version', title: '版本', candidates: ['version', 'currentVersion'] },
    { key: 'signature', title: '签名', candidates: ['signatureStatus', 'signature.status'] }
  ],
  metrics: [
    { title: '插件总数', description: '已安装和可升级插件。', status: 'READY', risk: 'HIGH' },
    { title: '高危待处理', description: '高危权限、签名异常或沙箱隔离插件。', status: 'ERROR', risk: 'CRITICAL' }
  ],
  emptyTitle: '暂无插件',
  emptyDescription: '安装插件前必须查看权限差异、签名和回滚策略。',
  load: () => listPlugins({ page: 1, pageSize: 20, sort: 'updatedAt:desc' }),
  actions: [
    { label: '禁用插件', permission: 'plugin.write', danger: true, confirmText: 'DISABLE', riskText: '禁用插件会影响 Provider、模板和执行器能力。', requiresSelection: true, run: (row) => disablePlugin(row?.id ?? '', { dryRun: true }) }
  ]
}
</script>

<template><BusinessResourcePage :config="config" /></template>
