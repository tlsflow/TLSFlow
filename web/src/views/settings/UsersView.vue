<script setup lang="ts">
import SecurityAdminPage, { type SecurityAdminConfig } from './SecurityAdminPage.vue'
import { createUser, listUsers } from '@/api/modules/security.api'

const config: SecurityAdminConfig = {
  eyebrow: 'SECURITY USERS',
  title: '用户管理',
  description: '管理控制台用户、租户、启用状态和角色。用户是否能访问资源，最终以后端 RBAC 判断为准。',
  resourceName: '用户',
  columns: [
    { key: 'username', title: '用户名' },
    { key: 'displayName', title: '显示名' },
    { key: 'email', title: '邮箱' },
    { key: 'identityProvider', title: '来源' },
    { key: 'externalSourceId', title: '身份源 ID' },
    { key: 'status', title: '状态' },
    { key: 'tenantName', title: '租户' },
    { key: 'roleNames', title: '角色' },
    { key: 'lastSyncedAt', title: '最近同步' },
    { key: 'updatedAt', title: '更新时间' }
  ],
  load: () => listUsers({ page: 1, pageSize: 50 }),
  create: (body) => createUser(body),
  submitLabel: '创建用户',
  fields: [
    { key: 'username', label: '用户名', placeholder: 'operator' },
    { key: 'displayName', label: '显示名', placeholder: '证书操作员' },
    { key: 'password', label: '初始密码', type: 'password', placeholder: '至少使用开发期强密码' },
    { key: 'roleId', label: '初始角色 ID', placeholder: 'role_admin 或自定义角色 ID' }
  ]
}
</script>

<template><SecurityAdminPage :config="config" /></template>
