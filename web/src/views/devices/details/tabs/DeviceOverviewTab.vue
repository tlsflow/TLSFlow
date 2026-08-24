<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { GcStatusTag } from '@/design-system/components'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import type { DeviceDetailField, DeviceDetailSection } from '../device-detail.model'

defineProps<{ sections: readonly DeviceDetailSection[] }>()
const { t } = useI18n()

function displayValue(field: DeviceDetailField): string {
  if (field.value === null || field.value === '') return t('devices.unifiedDetail.values.empty')
  if (field.valueType === 'DATETIME') return formatBrowserLocalTime(field.value) || t('devices.unifiedDetail.values.empty')
  if (field.valueType === 'BOOLEAN') return field.value ? t('devices.unifiedDetail.values.yes') : t('devices.unifiedDetail.values.no')
  return String(field.value)
}
</script>

<template>
  <div class="agent-detail-modal__sections">
    <section v-for="section in sections" :key="section.key" class="agent-detail-modal__section">
      <header class="agent-detail-modal__section-head">
        <h3>{{ t(`devices.unifiedDetail.sections.${section.key}`) }}</h3>
      </header>
      <dl class="agent-detail-modal__grid">
        <div v-for="field in section.fields" :key="field.key" class="agent-detail-modal__item">
          <dt>{{ t(`devices.unifiedDetail.fields.${field.key}`) }}</dt>
          <dd>
            <GcStatusTag v-if="field.valueType === 'STATUS'" :status="String(field.value ?? 'UNKNOWN')" />
            <span v-else>{{ displayValue(field) }}</span>
          </dd>
        </div>
      </dl>
    </section>
  </div>
</template>

<style scoped>
.agent-detail-modal__sections { display: grid; gap: var(--gc-space-2); }
.agent-detail-modal__section { display: grid; gap: var(--gc-space-2); padding: var(--gc-space-2); border: var(--gc-border-width-default) solid var(--gc-color-border-muted); border-radius: var(--gc-radius-md); background: var(--gc-gradient-surface); }
.agent-detail-modal__section-head h3 { margin: 0; color: var(--gc-color-text); font-size: var(--gc-font-size-sm); }
.agent-detail-modal__grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--gc-space-1) var(--gc-space-2); margin: 0; }
.agent-detail-modal__item { display: grid; min-width: 0; gap: var(--gc-space-1); padding: var(--gc-space-1) var(--gc-space-2); border: var(--gc-border-width-default) solid var(--gc-color-border-muted); border-radius: var(--gc-radius-sm); background: var(--gc-color-surface-hover); }
.agent-detail-modal__item dt { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); font-weight: 800; text-transform: uppercase; }
.agent-detail-modal__item dd { margin: 0; color: var(--gc-color-text); font-size: var(--gc-font-size-xs); font-weight: 800; line-height: 1.25; overflow-wrap: anywhere; white-space: pre-line; }
@media (max-width: 75rem) { .agent-detail-modal__grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 56.25rem) { .agent-detail-modal__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 47.5rem) { .agent-detail-modal__grid { grid-template-columns: 1fr; } }
</style>
