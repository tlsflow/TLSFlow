<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { GcStatusTag } from '@/design-system/components'
import DeviceCertificateCard from './DeviceCertificateCard.vue'
import type { DeviceBoundCertificateView, DeviceCertificateSelection, DeviceSiteBindingView, DeviceSiteView } from '../device-detail.model'

defineProps<{ site: DeviceSiteView }>()
const { t } = useI18n()
const emit = defineEmits<{
  'certificate-click': [selection: DeviceCertificateSelection]
}>()

function selectCertificate(certificate: DeviceBoundCertificateView, site: DeviceSiteView, binding: DeviceSiteBindingView) {
  emit('certificate-click', { certificate, site, binding })
}
</script>

<template>
  <article class="agent-detail-modal__site-card">
    <header class="agent-detail-modal__site-head">
      <div class="agent-detail-modal__site-head-main">
        <p class="agent-detail-modal__site-name">{{ site.name }}</p>
        <p class="agent-detail-modal__site-path">
          {{ site.endpoint?.protocol || site.presentation?.typeLabel || site.kind }} · {{ site.endpoint?.address || site.endpoint?.hostName || t('devices.unifiedDetail.values.empty') }}
        </p>
      </div>
      <div class="agent-detail-modal__site-meta">
        <GcStatusTag v-if="site.status" :status="site.status" />
        <strong>{{ site.presentation?.typeLabel || site.kind }}</strong>
      </div>
    </header>
    <dl class="agent-detail-modal__endpoint-grid">
      <div><dt>{{ t('devices.unifiedDetail.fields.address') }}</dt><dd>{{ site.endpoint?.address || t('devices.unifiedDetail.values.empty') }}</dd></div>
      <div><dt>{{ t('devices.unifiedDetail.fields.port') }}</dt><dd>{{ site.endpoint?.port ?? t('devices.unifiedDetail.values.empty') }}</dd></div>
      <div><dt>{{ t('devices.unifiedDetail.fields.protocol') }}</dt><dd>{{ site.endpoint?.protocol || t('devices.unifiedDetail.values.empty') }}</dd></div>
      <div><dt>{{ t('devices.unifiedDetail.fields.hostName') }}</dt><dd>{{ site.endpoint?.hostName || t('devices.unifiedDetail.values.empty') }}</dd></div>
    </dl>
    <div v-if="site.bindings.length" class="agent-detail-modal__site-bindings">
      <template v-for="binding in site.bindings" :key="binding.id">
        <DeviceCertificateCard
          v-if="binding.certificate"
          variant="binding"
          :certificate="binding.certificate"
          @select="certificate => selectCertificate(certificate, site, binding)"
        />
        <div v-else class="agent-detail-modal__binding-empty">
          {{ t('devices.unifiedDetail.values.unbound') }}
        </div>
      </template>
    </div>
    <p v-else class="agent-detail-modal__site-empty">{{ t('devices.unifiedDetail.empty.bindings') }}</p>
  </article>
</template>

<style scoped>
.agent-detail-modal__site-card { display: grid; min-width: 0; gap: var(--gc-space-2); padding: var(--gc-space-2); border: var(--gc-border-width-default) solid var(--gc-color-border-soft); border-radius: var(--gc-radius-sm); background: var(--gc-color-surface-glass); box-shadow: var(--gc-shadow-sm); }
.agent-detail-modal__site-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--gc-space-3); }
.agent-detail-modal__site-head-main { display: grid; min-width: 0; }
.agent-detail-modal__site-name,
.agent-detail-modal__site-path { margin: 0; }
.agent-detail-modal__site-name { color: var(--gc-color-text); font-size: var(--gc-font-size-md); font-weight: 900; line-height: 1.3; overflow-wrap: anywhere; }
.agent-detail-modal__site-path { margin-top: var(--gc-space-1); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); line-height: 1.3; overflow-wrap: anywhere; }
.agent-detail-modal__site-meta { display: grid; justify-items: end; flex-shrink: 0; gap: var(--gc-space-1); min-width: 0; text-align: right; }
.agent-detail-modal__site-meta strong { color: var(--gc-color-text); font-size: var(--gc-font-size-xs); overflow-wrap: anywhere; white-space: nowrap; }
.agent-detail-modal__endpoint-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--gc-space-1); margin: 0; }
.agent-detail-modal__endpoint-grid div { min-width: 0; padding: var(--gc-space-1) var(--gc-space-2); border-radius: var(--gc-radius-sm); background: var(--gc-color-surface-solid); }
.agent-detail-modal__endpoint-grid dt { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); font-weight: 800; }
.agent-detail-modal__endpoint-grid dd { margin: 0; color: var(--gc-color-text); font-size: var(--gc-font-size-xs); font-weight: 700; overflow-wrap: anywhere; }
.agent-detail-modal__site-bindings { display: grid; grid-template-columns: repeat(auto-fit, minmax(calc(var(--gc-space-10) * 5), 1fr)); gap: var(--gc-space-2); }
.agent-detail-modal__binding-empty { padding: var(--gc-space-2); border-radius: var(--gc-radius-sm); background: var(--gc-color-text); color: var(--gc-color-text-inverse-muted); font-size: var(--gc-font-size-xs); }
.agent-detail-modal__site-empty { margin: 0; color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); }
@media (max-width: 68.75rem) { .agent-detail-modal__endpoint-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 47.5rem) { .agent-detail-modal__endpoint-grid { grid-template-columns: 1fr; } }
</style>
