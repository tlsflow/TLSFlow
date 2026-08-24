<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { AutomationPreviewRecord } from '@/api/modules/automations.api'
defineProps<{ preview: AutomationPreviewRecord | null; loading?: boolean }>()
const emit = defineEmits<{ confirm: [] }>()
const { t } = useI18n()

function exclusionLabel(reason?: string): string {
  const knownReasons = new Set(['permission_denied', 'missing_version', 'version_not_deployable', 'binding_not_managed', 'environment_not_allowed'])
  return t(`automations.exclusions.${reason && knownReasons.has(reason) ? reason : 'unknown'}`)
}
</script>

<template>
  <section class="preview-panel" :aria-label="t('automations.aria.preview')">
    <p v-if="loading">{{ t('common.loading') }}</p>
    <template v-else-if="preview">
      <div class="preview-panel__metrics"><strong>{{ t('automations.preview.matched', { count: preview.totalMatched }) }}</strong><strong>{{ t('automations.preview.executable', { count: preview.executableCount }) }}</strong><strong>{{ t('automations.preview.excluded', { count: preview.excludedCount }) }}</strong></div>
      <ul><li v-for="item in preview.items" :key="item.target.bindingId"><span>{{ item.target.certificateName }}</span><span>{{ item.target.environment || t('automations.common.notAvailable') }}</span><span>{{ item.executable ? t('automations.preview.ready') : exclusionLabel(item.excludedReason) }}</span></li></ul>
      <button class="gc-button gc-button--primary" type="button" :disabled="preview.executableCount === 0" @click="emit('confirm')">{{ t('automations.actions.confirmRun') }}</button>
    </template>
  </section>
</template>

<style scoped>
.preview-panel { display: grid; gap: var(--gc-space-4); }
.preview-panel__metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gc-space-3); }
.preview-panel__metrics strong, .preview-panel li { padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border-muted); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-raised); }
.preview-panel ul { display: grid; gap: var(--gc-space-2); margin: 0; padding: 0; list-style: none; }
.preview-panel li { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gc-space-3); }
</style>
