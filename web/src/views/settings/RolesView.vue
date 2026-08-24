<script setup lang="ts">
import SecurityAdminPage, { type SecurityAdminConfig } from './SecurityAdminPage.vue'
import { createRole, listRoles } from '@/api/modules/security.api'

const config: SecurityAdminConfig = {
  eyebrow: 'SECURITY ROLES',
  title: '角色管理',
  description: '角色是权限策略的主要承载体。不要给每个用户单独堆策略，那会很快变成不可维护的垃圾。',
  resourceName: '角色',
  columns: [
    { key: 'id', title: '角色 ID' },
    { key: 'code', title: '编码' },
    { key: 'name', title: '名称' },
    { key: 'builtin', title: '内置' },
    { key: 'policyCount', title: '策略数' },
    { key: 'permissions', title: '权限点' }
  ],
  load: () => listRoles({ page: 1, pageSize: 50 }),
  create: (body) => createRole(body),
  submitLabel: '创建角色',
  fields: [
    { key: 'code', label: '角色编码', placeholder: 'operator' },
    { key: 'name', label: '角色名称', placeholder: '证书操作员' },
    { key: 'description', label: '说明', placeholder: '负责证书日常操作' }
  ]
}
</script>

<template><SecurityAdminPage :config="config" /></template>
