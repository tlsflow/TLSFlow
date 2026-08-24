<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { GcEmptyState } from '@/design-system/components'
import DeviceCertificateCard from '../cards/DeviceCertificateCard.vue'
import type { DeviceCertificateSelection, DeviceCertificateView } from '../device-detail.model'

defineProps<{ certificates: readonly DeviceCertificateView[] }>()
const { t } = useI18n()
const emit = defineEmits<{
  'certificate-click': [selection: DeviceCertificateSelection]
}>()
</script>

<template>
  <section v-if="certificates.length" class="agent-detail-modal__section" :aria-label="t('devices.unifiedDetail.aria.certificates')">
    <div class="agent-detail-modal__certificate-list" role="list">
      <DeviceCertificateCard
        v-for="certificate in certificates"
        :key="certificate.id"
        :certificate="certificate"
        role="listitem"
        @select="selected => emit('certificate-click', { certificate: selected })"
      />
    </div>
  </section>
  <GcEmptyState v-else :title="t('devices.unifiedDetail.empty.certificates')" />
</template>

<style scoped>
.agent-detail-modal__section { padding: var(--gc-space-2); border: var(--gc-border-width-default) solid var(--gc-color-border-muted); border-radius: var(--gc-radius-md); background: var(--gc-gradient-surface); }
.agent-detail-modal__certificate-list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gc-space-2); }
@media (max-width: 68.75rem) { .agent-detail-modal__certificate-list { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 47.5rem) { .agent-detail-modal__certificate-list { grid-template-columns: 1fr; } }
</style>
