<script setup lang="ts">
import SecurityAdminPage, { type SecurityAdminConfig } from './SecurityAdminPage.vue'
import { createGroupRoleMapping, listGroupRoleMappings } from '@/api/modules/security.api'

const config: SecurityAdminConfig = {
  eyebrow: 'GROUP ROLE MAPPING',
  title: '组角色映射',
  description: '把 AD/LDAP 外部组映射成本地角色。多个组命中会叠加角色；未命中不会默认给高权限。',
  resourceName: '组映射',
  columns: [
    { key: 'sourceId', title: '身份源 ID' },
    { key: 'externalGroup', title: '外部组' },
    { key: 'roleId', title: '本地角色' },
    { key: 'enabled', title: '启用' },
    { key: 'updatedAt', title: '更新时间' }
  ],
  load: () => listGroupRoleMappings({ page: 1, pageSize: 100 }),
  create: (body) => createGroupRoleMapping({ ...body, enabled: true }),
  submitLabel: '创建映射',
  fields: [
    { key: 'sourceId', label: '身份源 ID', placeholder: 'ids_xxx' },
    { key: 'externalGroup', label: '外部组', placeholder: 'CN=GCAC-Ops,OU=Groups,DC=example,DC=com' },
    { key: 'roleId', label: '本地角色 ID', placeholder: 'role_operator' }
  ]
}
</script>

<template><SecurityAdminPage :config="config" /></template>
