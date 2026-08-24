<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { GcEmptyState } from '@/design-system/components'
import DeviceSiteCard from '../cards/DeviceSiteCard.vue'
import type { DeviceCertificateSelection, DeviceSiteView } from '../device-detail.model'

defineProps<{ sites: readonly DeviceSiteView[] }>()
const { t } = useI18n()
const emit = defineEmits<{
  'certificate-click': [selection: DeviceCertificateSelection]
}>()
</script>

<template>
  <section v-if="sites.length" class="agent-detail-modal__section" :aria-label="t('devices.unifiedDetail.aria.sites')">
    <div class="agent-detail-modal__site-grid" role="list">
      <DeviceSiteCard
        v-for="site in sites"
        :key="site.id"
        :site="site"
        role="listitem"
        @certificate-click="emit('certificate-click', $event)"
      />
    </div>
  </section>
  <GcEmptyState v-else :title="t('devices.unifiedDetail.empty.sites')" />
</template>

<style scoped>
.agent-detail-modal__section { padding: var(--gc-space-2); border: var(--gc-border-width-default) solid var(--gc-color-border-muted); border-radius: var(--gc-radius-md); background: linear-gradient(180deg, var(--gc-color-surface-solid), var(--gc-color-surface-raised)); }
.agent-detail-modal__site-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-2); }
@media (max-width: 64rem) { .agent-detail-modal__site-grid { grid-template-columns: 1fr; } }
</style>
