<script setup lang="ts">
import SecurityAdminPage, { type SecurityAdminConfig } from './SecurityAdminPage.vue'
import { createPermissionPolicy, listPermissionPolicies } from '@/api/modules/security.api'

function parseCsv(value: unknown): string[] {
  return String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean)
}

const config: SecurityAdminConfig = {
  eyebrow: 'SECURITY POLICIES',
  title: '权限策略',
  description: '维护 RBAC allow/deny 策略。动作和资源类型用逗号分隔，作用域默认按租户隔离。',
  resourceName: '权限策略',
  columns: [
    { key: 'id', title: '策略 ID' },
    { key: 'subjectType', title: '主体类型' },
    { key: 'subjectId', title: '主体 ID' },
    { key: 'effect', title: '效果' },
    { key: 'actions', title: '动作' },
    { key: 'resourceTypes', title: '资源类型' },
    { key: 'scope', title: '作用域' }
  ],
  load: () => listPermissionPolicies({ page: 1, pageSize: 100 }),
  create: (body) => createPermissionPolicy({
    subjectType: body.subjectType,
    subjectId: body.subjectId,
    effect: body.effect,
    actions: parseCsv(body.actions),
    resourceTypes: parseCsv(body.resourceTypes),
    scope: { tenantId: body.tenantId || '*' }
  }),
  submitLabel: '创建策略',
  fields: [
    { key: 'subjectType', label: '主体类型', type: 'select', options: [
      { label: '角色', value: 'role' },
      { label: '用户', value: 'user' },
      { label: '插件', value: 'plugin' },
      { label: '执行器', value: 'executor' }
    ] },
    { key: 'subjectId', label: '主体 ID', placeholder: 'role_operator' },
    { key: 'effect', label: '效果', type: 'select', options: [{ label: '允许', value: 'allow' }, { label: '拒绝', value: 'deny' }] },
    { key: 'actions', label: '动作', placeholder: 'dashboard.read,certificate.asset.read' },
    { key: 'resourceTypes', label: '资源类型', placeholder: 'dashboard,certificate' },
    { key: 'tenantId', label: '租户作用域', placeholder: '*' }
  ]
}
</script>

<template><SecurityAdminPage :config="config" /></template>
