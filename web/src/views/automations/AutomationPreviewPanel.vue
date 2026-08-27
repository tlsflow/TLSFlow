<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { GcButton, GcEmptyState, GcStatusTag } from '@/design-system/components'
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

function targetName(item: AutomationPreviewRecord['items'][number]): string {
  return item.target.assetName || item.target.assetId || item.target.certificateName
}

function targetLabel(item: AutomationPreviewRecord['items'][number]): string {
  return item.target.assetName || item.target.assetId
    ? t('automations.preview.applicationAsset')
    : t('automations.preview.certificate')
}

function targetReference(item: AutomationPreviewRecord['items'][number]): string {
  const references: string[] = []
  if (item.target.assetName && item.target.certificateName !== item.target.assetName) {
    references.push(`${t('automations.preview.certificate')}：${item.target.certificateName}`)
  }
  if (item.target.assetId) references.push(`${t('automations.preview.applicationAssetId')}：${item.target.assetId}`)
  if (item.target.bindingId) references.push(`${t('automations.preview.bindingId')}：${item.target.bindingId}`)
  return references.join(' · ')
}

function hasMissingCurrentCertificate(preview: AutomationPreviewRecord): boolean {
  return preview.items.some((item) => item.target.certificateVersionImpact === 'missing_current')
}
</script>

<template>
  <section class="preview-panel" :aria-label="t('automations.aria.preview')">
    <p v-if="loading" class="preview-panel__hint">{{ t('common.loading') }}</p>
    <template v-else-if="preview">
      <div class="preview-panel__explanation">
        <p>{{ t('automations.preview.explanation') }}</p>
        <p v-if="hasMissingCurrentCertificate(preview)">{{ t('automations.preview.missingCurrentExplanation') }}</p>
      </div>
      <div v-if="preview.versionImpactSummary" class="preview-panel__metrics preview-panel__metrics--impact">
        <div class="preview-panel__metric"><strong>{{ t('automations.preview.affected', { count: preview.versionImpactSummary.total }) }}</strong></div>
        <div class="preview-panel__metric"><strong>{{ t('automations.preview.executable', { count: previewExecutableCount(preview) }) }}</strong></div>
        <div class="preview-panel__metric"><strong>{{ t('automations.preview.skip', { count: previewSkipCount(preview) }) }}</strong></div>
        <div class="preview-panel__metric"><strong>{{ t('automations.preview.downgrade', { count: previewAttentionCount(preview) }) }}</strong></div>
      </div>
      <div v-else class="preview-panel__metrics">
        <div class="preview-panel__metric"><strong>{{ t('automations.preview.matched', { count: preview.totalMatched }) }}</strong></div>
        <div class="preview-panel__metric"><strong>{{ t('automations.preview.executable', { count: previewExecutableCount(preview) }) }}</strong></div>
        <div class="preview-panel__metric"><strong>{{ t('automations.preview.excluded', { count: preview.excludedCount }) }}</strong></div>
      </div>
      <ul class="preview-panel__items">
        <li v-for="item in preview.items" :key="item.target.bindingId || item.target.assetId || item.target.certificateVersionId || item.target.certificateName" class="preview-panel__item">
          <article class="preview-panel__item-card">
            <div class="preview-panel__cell preview-panel__cell--primary">
              <span class="preview-panel__field-tag">{{ targetLabel(item) }}</span>
              <strong>{{ targetName(item) }}</strong>
              <small v-if="targetReference(item)">{{ targetReference(item) }}</small>
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
          </article>
        </li>
      </ul>
      <GcButton v-if="showConfirm" variant="primary" :disabled="previewExecutableCount(preview) === 0" @click="emit('confirm')">{{ t('automations.actions.confirmRun') }}</GcButton>
    </template>
    <GcEmptyState v-else :title="t('automations.preview.title')" :description="t('automations.preview.description')" />
  </section>
</template>

<style scoped>
.preview-panel { display: grid; gap: var(--gc-space-3); }
.preview-panel__hint { margin: 0; color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.preview-panel__explanation { display: grid; gap: var(--gc-space-1); padding: var(--gc-space-2) var(--gc-space-3); border-left: var(--gc-space-1) solid var(--gc-color-info-border); background: var(--gc-color-info-bg); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); line-height: var(--gc-line-height-relaxed); }
.preview-panel__explanation p { margin: 0; }
.preview-panel__metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gc-space-2); }
.preview-panel__metrics--impact { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.preview-panel__metric { display: flex; align-items: baseline; justify-content: space-between; gap: var(--gc-space-2); padding: var(--gc-space-2) var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border-muted); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-panel); }
.preview-panel__metric span { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); }
.preview-panel__metric strong { color: var(--gc-color-text-strong); font-size: var(--gc-font-size-md); }
.preview-panel__items { display: grid; gap: var(--gc-space-1); margin: 0; padding: 0; list-style: none; }
.preview-panel__item-card { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(10rem, 1fr) minmax(8rem, auto); gap: var(--gc-space-3); align-items: center; padding: var(--gc-space-2) var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border-muted); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-panel); }
.preview-panel__cell { display: grid; gap: var(--gc-space-1); min-width: 0; }
.preview-panel__cell--primary strong { margin: 0; color: var(--gc-color-text); font-size: var(--gc-font-size-sm); overflow-wrap: anywhere; }
.preview-panel__cell--primary small { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); overflow-wrap: anywhere; }
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
  .preview-panel__item-card {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
