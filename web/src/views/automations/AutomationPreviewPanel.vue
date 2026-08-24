<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { GcButton, GcCard, GcEmptyState, GcStatusTag } from '@/design-system/components'
import type { AutomationPreviewRecord } from '@/api/modules/automations.api'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
withDefaults(defineProps<{ preview: AutomationPreviewRecord | null; loading?: boolean; showConfirm?: boolean }>(), {
  showConfirm: true,
})
const emit = defineEmits<{ confirm: [] }>()
const { t } = useI18n()

function previewExecutableCount(preview: AutomationPreviewRecord): number {
  return Math.max(preview.executableCount ?? 0, preview.items.filter((item) => item.executable).length)
}

function previewSkipCount(preview: AutomationPreviewRecord): number {
  return preview.items.filter((item) => item.excludedReason === 'certificate_already_up_to_date').length
}

function previewAttentionCount(preview: AutomationPreviewRecord): number {
  return preview.items.filter((item) => (
    item.target.certificateVersionImpact === 'downgrade'
    || item.target.certificateVersionImpact === 'missing_current'
    || (item.excludedReason !== undefined && item.excludedReason !== 'certificate_already_up_to_date')
  )).length
}

function exclusionLabel(reason?: string): string {
  const knownReasons = new Set(['permission_denied', 'missing_version', 'version_not_deployable', 'binding_not_managed', 'environment_not_allowed', 'binding_missing', 'asset_missing_deployment_capability', 'certificate_version_downgrade', 'certificate_already_up_to_date', 'filter_not_matched', 'runtime_context_required'])
  return t(`automations.exclusions.${reason && knownReasons.has(reason) ? reason : 'unknown'}`)
}

function impactLabel(impact?: string): string {
  const knownImpacts = new Set(['upgrade', 'same', 'downgrade', 'missing_current'])
  return t(`automations.preview.impact.${impact && knownImpacts.has(impact) ? impact : 'unknown'}`)
}

function impactTone(impact?: string): 'success' | 'warning' | 'danger' | 'info' | 'muted' {
  if (impact === 'upgrade') return 'success'
  if (impact === 'same') return 'info'
  if (impact === 'downgrade') return 'danger'
  if (impact === 'missing_current') return 'warning'
  return 'muted'
}

function expiryLabel(value?: string): string {
  return value ? (formatBrowserLocalTime(value, { includeTime: false }) || t('automations.common.notAvailable')) : t('automations.common.notAvailable')
}

function rowStatusLabel(item: AutomationPreviewRecord['items'][number]): string {
  if (item.excludedReason === 'certificate_already_up_to_date') return t('automations.preview.skipUpdate')
  if (item.target.certificateVersionImpact) return impactLabel(item.target.certificateVersionImpact)
  return item.executable ? t('automations.preview.ready') : exclusionLabel(item.excludedReason)
}

function rowStatusTone(item: AutomationPreviewRecord['items'][number]): 'success' | 'warning' | 'danger' | 'info' | 'muted' {
  if (item.excludedReason === 'certificate_already_up_to_date') return 'muted'
  if (item.target.certificateVersionImpact) return impactTone(item.target.certificateVersionImpact)
  return item.executable ? 'success' : 'warning'
}
</script>

<template>
  <section class="preview-panel" :aria-label="t('automations.aria.preview')">
    <p v-if="loading" class="preview-panel__hint">{{ t('common.loading') }}</p>
    <template v-else-if="preview">
      <div v-if="preview.versionImpactSummary" class="preview-panel__metrics preview-panel__metrics--impact">
        <GcCard as="div" class="preview-panel__metric"><strong>{{ t('automations.preview.affected', { count: preview.versionImpactSummary.total }) }}</strong></GcCard>
        <GcCard as="div" class="preview-panel__metric"><strong>{{ t('automations.preview.executable', { count: previewExecutableCount(preview) }) }}</strong></GcCard>
        <GcCard as="div" class="preview-panel__metric"><strong>{{ t('automations.preview.skip', { count: previewSkipCount(preview) }) }}</strong></GcCard>
        <GcCard as="div" class="preview-panel__metric"><strong>{{ t('automations.preview.downgrade', { count: previewAttentionCount(preview) }) }}</strong></GcCard>
      </div>
      <div v-else class="preview-panel__metrics">
        <GcCard as="div" class="preview-panel__metric"><strong>{{ t('automations.preview.matched', { count: preview.totalMatched }) }}</strong></GcCard>
        <GcCard as="div" class="preview-panel__metric"><strong>{{ t('automations.preview.executable', { count: previewExecutableCount(preview) }) }}</strong></GcCard>
        <GcCard as="div" class="preview-panel__metric"><strong>{{ t('automations.preview.excluded', { count: preview.excludedCount }) }}</strong></GcCard>
      </div>
      <ul>
        <li v-for="item in preview.items" :key="item.target.bindingId || item.target.assetId || item.target.certificateVersionId || item.target.certificateName" class="preview-panel__item">
          <GcCard as="article" class="preview-panel__item-card">
            <div class="preview-panel__cell preview-panel__cell--primary">
              <strong>{{ item.target.assetName || item.target.certificateName }}</strong>
            </div>
            <template v-if="item.target.certificateVersionImpact">
              <div class="preview-panel__cell">
                <span class="preview-panel__field-tag">{{ t('automations.preview.expiryLabel') }}</span>
                <span>{{ expiryLabel(item.target.currentCertificateNotAfter) }} → {{ expiryLabel(item.target.targetCertificateNotAfter) }}</span>
              </div>
              <div class="preview-panel__cell preview-panel__cell--status">
                <GcStatusTag :status="item.excludedReason || item.target.certificateVersionImpact" :label="rowStatusLabel(item)" :tone="rowStatusTone(item)" />
              </div>
            </template>
            <div v-else class="preview-panel__cell preview-panel__cell--status">
              <GcStatusTag :status="item.executable ? 'ready' : (item.excludedReason || 'unknown')" :label="item.executable ? t('automations.preview.ready') : exclusionLabel(item.excludedReason)" :tone="item.executable ? 'success' : 'warning'" />
            </div>
          </GcCard>
        </li>
      </ul>
      <GcButton v-if="showConfirm" variant="primary" :disabled="previewExecutableCount(preview) === 0" @click="emit('confirm')">{{ t('automations.actions.confirmRun') }}</GcButton>
    </template>
    <GcEmptyState v-else :title="t('automations.preview.title')" :description="t('automations.preview.description')" />
  </section>
</template>

<style scoped>
.preview-panel { display: grid; gap: var(--gc-space-4); }
.preview-panel__hint { margin: 0; color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.preview-panel__metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gc-space-3); }
.preview-panel__metrics--impact { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.preview-panel__metric :deep(.gc-pro-card__body) { display: grid; }
.preview-panel__metric :deep(strong) { color: var(--gc-color-text-strong); font-size: var(--gc-font-size-md); }
.preview-panel ul { display: grid; gap: var(--gc-space-2); margin: 0; padding: 0; list-style: none; }
.preview-panel__item-card :deep(.gc-pro-card__body) { display: grid; grid-template-columns: 1.2fr 1fr 0.8fr; gap: var(--gc-space-3); align-items: center; }
.preview-panel__cell { display: grid; gap: var(--gc-space-1); min-width: 0; }
.preview-panel__cell--primary strong { margin: 0; color: var(--gc-color-text); font-size: var(--gc-font-size-md); overflow-wrap: anywhere; }
.preview-panel__cell--status { justify-items: start; }
.preview-panel__field-tag {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  border-radius: var(--gc-radius-full);
  padding: var(--gc-space-hairline) var(--gc-space-2);
  background: var(--gc-color-surface-panel);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: var(--gc-font-weight-semibold);
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
}

@media (max-width: 45rem) {
  .preview-panel__metrics,
  .preview-panel__metrics--impact,
  .preview-panel__item-card :deep(.gc-pro-card__body) {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
