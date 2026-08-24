<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SecurityAdminPage, { type SecurityAdminConfig } from './SecurityAdminPage.vue'
import { createGroupRoleMapping, listGroupRoleMappings } from '@/api/modules/security.api'

const { t } = useI18n()

const config = computed<SecurityAdminConfig>(() => ({
  resourceName: t('settings.groupRoleMappings.resourceName'),
  columns: [
    { key: 'sourceId', title: t('settings.groupRoleMappings.columns.sourceId') },
    { key: 'externalGroup', title: t('settings.groupRoleMappings.columns.externalGroup') },
    { key: 'roleId', title: t('settings.groupRoleMappings.columns.roleId') },
    { key: 'enabled', title: t('settings.groupRoleMappings.columns.enabled') },
    { key: 'updatedAt', title: t('settings.groupRoleMappings.columns.updatedAt') }
  ],
  load: () => listGroupRoleMappings({ page: 1, pageSize: 100 }),
  create: (body) => createGroupRoleMapping({ ...body, enabled: true }),
  submitLabel: t('settings.groupRoleMappings.actions.create'),
  fields: [
    { key: 'sourceId', label: t('settings.groupRoleMappings.fields.sourceId'), placeholder: 'ids_xxx' },
    { key: 'externalGroup', label: t('settings.groupRoleMappings.fields.externalGroup'), placeholder: 'CN=GCAC-Ops,OU=Groups,DC=example,DC=com' },
    { key: 'roleId', label: t('settings.groupRoleMappings.fields.roleId'), placeholder: 'role_operator' }
  ]
}))
</script>

<template><SecurityAdminPage :config="config" /></template>
