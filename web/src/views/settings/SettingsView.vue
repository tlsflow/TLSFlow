<script setup lang="ts">
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import { listSettings } from '@/api/modules/settings.api'

const config: BusinessPageConfig = {
  title: '系统设置',
  description: '租户、用户、权限、Secret 元数据、运行健康和前端排查信息。',
  readPermission: 'settings.read',
  primaryPermission: 'settings.write',
  primaryActionLabel: '修改设置',
  moduleName: 'settings',
  resourceName: '配置项',
  defaultStatus: 'READY',
  defaultRisk: 'MEDIUM',
  columns: [
    { key: 'name', title: '配置项', candidates: ['name', 'key', 'secretName'] },
    { key: 'status', title: '状态', candidates: ['status', 'state'] },
    { key: 'risk', title: '风险', candidates: ['risk', 'riskLevel'] },
    { key: 'type', title: '类型', candidates: ['type', 'secretType'] },
    { key: 'updatedAt', title: '更新时间', candidates: ['updatedAt', 'createdAt'], kind: 'date' }
  ],
  metrics: [
    { title: '配置总数', description: '租户、权限和 Secret 元数据入口。', status: 'READY', risk: 'MEDIUM' },
    { title: '高危待处理', description: '权限、Secret 或运行健康异常。', status: 'ERROR', risk: 'HIGH' }
  ],
  emptyTitle: '暂无系统配置数据',
  emptyDescription: '设置页只展示引用和元数据，不展示 Secret 明文。',
  load: () => listSettings({ page: 1, pageSize: 20 }),
  actions: [
    { label: '保存高危设置', permission: 'settings.write', danger: true, confirmText: 'SAVE', riskText: '系统设置可能影响认证、权限和 Secret 使用范围。' }
  ]
}
</script>

<template><BusinessResourcePage :config="config" /></template>
