<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { GcStatusTag } from '@/design-system/components'
import { formatBrowserLocalTime, getExpiryCountdown } from '@/utils/browser-local-time'
import type { DeviceBoundCertificateView } from '../device-detail.model'

const props = withDefaults(defineProps<{
  certificate: DeviceBoundCertificateView
  variant?: 'resource' | 'binding'
}>(), {
  variant: 'resource',
})
const { t } = useI18n()
const emit = defineEmits<{
  select: [certificate: DeviceBoundCertificateView]
}>()

const expiryCountdown = computed(() => {
  if (props.variant !== 'binding') return null
  return getExpiryCountdown(props.certificate.notAfter)
})
</script>

<template>
  <article
    class="agent-detail-modal__certificate-card"
    :data-variant="variant"
    role="button"
    tabindex="0"
    @click="emit('select', certificate)"
    @keydown.enter="emit('select', certificate)"
    @keydown.space.prevent="emit('select', certificate)"
  >
    <header class="agent-detail-modal__certificate-head">
      <strong>{{ certificate.name || certificate.subject || t('devices.unifiedDetail.values.unknownCertificate') }}</strong>
      <GcStatusTag v-if="certificate.status" :status="certificate.status" />
    </header>
    <dl class="agent-detail-modal__certificate-grid">
      <div><dt>{{ t('devices.unifiedDetail.fields.subject') }}</dt><dd>{{ certificate.subject || t('devices.unifiedDetail.values.empty') }}</dd></div>
      <div><dt>{{ t('devices.unifiedDetail.fields.issuer') }}</dt><dd>{{ certificate.issuer || t('devices.unifiedDetail.values.empty') }}</dd></div>
      <div><dt>{{ t('devices.unifiedDetail.fields.notBefore') }}</dt><dd>{{ certificate.notBefore ? formatBrowserLocalTime(certificate.notBefore) : t('devices.unifiedDetail.values.empty') }}</dd></div>
      <div><dt>{{ t('devices.unifiedDetail.fields.notAfter') }}</dt><dd>{{ certificate.notAfter ? formatBrowserLocalTime(certificate.notAfter) : t('devices.unifiedDetail.values.empty') }}</dd></div>
    </dl>
    <p
      v-if="expiryCountdown"
      class="agent-detail-modal__certificate-expiry"
      :data-tone="expiryCountdown.expired ? 'danger' : 'success'"
    >
      {{ t(
        expiryCountdown.expired
          ? 'devices.expiryCountdown.expired'
          : 'devices.expiryCountdown.remaining',
        { days: expiryCountdown.days },
      ) }}
    </p>
  </article>
</template>

<style scoped>
.agent-detail-modal__certificate-card { display: grid; min-width: 0; gap: var(--gc-space-1); padding: var(--gc-space-2); border: var(--gc-border-width-default) solid var(--gc-color-border-soft); border-radius: var(--gc-radius-sm); background: var(--gc-color-surface-glass); box-shadow: var(--gc-shadow-sm); cursor: pointer; transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease; }
.agent-detail-modal__certificate-card:hover,
.agent-detail-modal__certificate-card:focus-visible { transform: translateY(calc(var(--gc-space-hairline) * -1)); border-color: var(--gc-color-primary-border-strong); box-shadow: var(--gc-shadow-md); outline: none; }
.agent-detail-modal__certificate-card[data-variant='binding'] { border-color: transparent; background: var(--gc-color-text); color: var(--gc-color-surface-solid); }
.agent-detail-modal__certificate-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--gc-space-2); }
.agent-detail-modal__certificate-head strong { color: var(--gc-color-text); font-size: var(--gc-font-size-sm); overflow-wrap: anywhere; }
.agent-detail-modal__certificate-card[data-variant='binding'] .agent-detail-modal__certificate-head strong { color: var(--gc-color-surface-solid); }
.agent-detail-modal__certificate-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-1) var(--gc-space-2); margin: 0; }
.agent-detail-modal__certificate-grid div { min-width: 0; }
.agent-detail-modal__certificate-grid dt { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); font-weight: 800; }
.agent-detail-modal__certificate-grid dd { margin: 0; color: var(--gc-color-text); font-size: var(--gc-font-size-xs); font-weight: 700; overflow-wrap: anywhere; }
.agent-detail-modal__certificate-card[data-variant='binding'] .agent-detail-modal__certificate-grid dt { color: var(--gc-color-text-inverse-muted); }
.agent-detail-modal__certificate-card[data-variant='binding'] .agent-detail-modal__certificate-grid dd { color: var(--gc-color-surface-solid); }
.agent-detail-modal__certificate-expiry { margin: 0; font-size: var(--gc-font-size-xs); font-weight: 900; }
.agent-detail-modal__certificate-expiry[data-tone='success'] { color: var(--gc-color-success); }
.agent-detail-modal__certificate-expiry[data-tone='danger'] { color: var(--gc-color-danger); }
@media (max-width: 47.5rem) { .agent-detail-modal__certificate-grid { grid-template-columns: 1fr; } }
</style>
