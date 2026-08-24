<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SecurityAdminPage, { type SecurityAdminConfig } from './SecurityAdminPage.vue'
import { createPermissionPolicy, listPermissionPolicies } from '@/api/modules/security.api'

function parseCsv(value: unknown): string[] {
  return String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean)
}

const { t } = useI18n()

const config = computed<SecurityAdminConfig>(() => ({
  resourceName: t('settings.permissionPolicies.resourceName'),
  columns: [
    { key: 'id', title: t('settings.permissionPolicies.columns.id') },
    { key: 'subjectType', title: t('settings.permissionPolicies.columns.subjectType') },
    { key: 'subjectId', title: t('settings.permissionPolicies.columns.subjectId') },
    { key: 'effect', title: t('settings.permissionPolicies.columns.effect') },
    { key: 'actions', title: t('settings.permissionPolicies.columns.actions') },
    { key: 'resourceTypes', title: t('settings.permissionPolicies.columns.resourceTypes') },
    { key: 'scope', title: t('settings.permissionPolicies.columns.scope') }
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
  submitLabel: t('settings.permissionPolicies.actions.create'),
  fields: [
    { key: 'subjectType', label: t('settings.permissionPolicies.fields.subjectType'), type: 'select', options: [
      { label: t('settings.permissionPolicies.subjectTypes.role'), value: 'role' },
      { label: t('settings.permissionPolicies.subjectTypes.user'), value: 'user' },
      { label: t('settings.permissionPolicies.subjectTypes.plugin'), value: 'plugin' },
      { label: t('settings.permissionPolicies.subjectTypes.executor'), value: 'executor' }
    ] },
    { key: 'subjectId', label: t('settings.permissionPolicies.fields.subjectId'), placeholder: 'role_operator' },
    { key: 'effect', label: t('settings.permissionPolicies.fields.effect'), type: 'select', options: [{ label: t('settings.permissionPolicies.effects.allow'), value: 'allow' }, { label: t('settings.permissionPolicies.effects.deny'), value: 'deny' }] },
    { key: 'actions', label: t('settings.permissionPolicies.fields.actions'), placeholder: 'dashboard.read,certificate.asset.read' },
    { key: 'resourceTypes', label: t('settings.permissionPolicies.fields.resourceTypes'), placeholder: 'dashboard,certificate' },
    { key: 'tenantId', label: t('settings.permissionPolicies.fields.tenantId'), placeholder: '*' }
  ]
}))
</script>

<template><SecurityAdminPage :config="config" /></template>
