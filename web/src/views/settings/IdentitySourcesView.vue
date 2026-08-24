<script setup lang="ts">
import SecurityAdminPage, { type SecurityAdminConfig } from './SecurityAdminPage.vue'
import { createIdentitySource, listIdentitySources } from '@/api/modules/security.api'

const config: SecurityAdminConfig = {
  eyebrow: 'IDENTITY SOURCES',
  title: '身份源',
  description: '配置 Microsoft Active Directory 或标准 LDAP。外部目录只负责认证和组信息，授权仍走本地 RBAC。',
  resourceName: '身份源',
  columns: [
    { key: 'name', title: '名称' },
    { key: 'type', title: '类型' },
    { key: 'enabled', title: '启用' },
    { key: 'url', title: '服务器' },
    { key: 'baseDn', title: 'Base DN' },
    { key: 'defaultRoleId', title: '默认角色' },
    { key: 'tlsMode', title: 'TLS' }
  ],
  load: () => listIdentitySources({ page: 1, pageSize: 50 }),
  create: (body) => createIdentitySource({
    ...body,
    enabled: true,
    requireGroupMapping: String(body.requireGroupMapping ?? 'true') !== 'false'
  }),
  submitLabel: '创建身份源',
  fields: [
    { key: 'name', label: '名称', placeholder: '企业 AD' },
    { key: 'type', label: '类型', type: 'select', options: [
      { label: 'Microsoft Active Directory', value: 'active_directory' },
      { label: '标准 LDAP', value: 'ldap' }
    ] },
    { key: 'url', label: '服务器 URL', placeholder: 'ldaps://ad.example.com:636' },
    { key: 'baseDn', label: 'Base DN', placeholder: 'DC=example,DC=com' },
    { key: 'userDnTemplate', label: '用户 DN/UPN 模板', placeholder: '{{username}}@example.com' },
    { key: 'userFilter', label: '用户过滤器', placeholder: '(uid={{username}})' },
    { key: 'groupFilter', label: '组过滤器', placeholder: '(member={{userDn}})' },
    { key: 'bindDn', label: '服务账号 DN', placeholder: 'CN=svc-gcac,OU=Users,DC=example,DC=com' },
    { key: 'bindPasswordSecretRef', label: '服务账号密码 SecretRef', placeholder: 'secret://password/xxx@current' },
    { key: 'defaultRoleId', label: '默认角色 ID', placeholder: 'role_auditor' },
    { key: 'tlsMode', label: 'TLS 模式', type: 'select', options: [
      { label: 'LDAPS', value: 'ldaps' },
      { label: 'StartTLS', value: 'starttls' },
      { label: '无 TLS', value: 'none' }
    ] },
    { key: 'requireGroupMapping', label: '必须命中组映射', type: 'select', options: [
      { label: '是', value: 'true' },
      { label: '否', value: 'false' }
    ] }
  ]
}
</script>

<template><SecurityAdminPage :config="config" /></template>
