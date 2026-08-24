<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { GcEmptyState } from '@/design-system/components'
import DeviceSiteCard from '../cards/DeviceSiteCard.vue'
import type { DeviceCertificateSelection, DeviceSiteView } from '../device-detail.model'

defineProps<{
  sites: readonly DeviceSiteView[];
  loading?: boolean;
}>()
const { t } = useI18n()
const emit = defineEmits<{
  'certificate-click': [selection: DeviceCertificateSelection]
}>()
</script>

<template>
  <section v-if="loading" class="agent-detail-modal__section agent-detail-modal__site-loading" :aria-busy="true" role="status" aria-live="polite">
    <span class="agent-detail-modal__site-spinner" aria-hidden="true" />
    <span>{{ t('common.loading') }}</span>
  </section>
  <section v-else-if="sites.length" class="agent-detail-modal__section" :aria-label="t('devices.unifiedDetail.aria.sites')">
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
.agent-detail-modal__section { padding: var(--gc-space-2); border: var(--gc-border-width-default) solid var(--gc-color-border-muted); border-radius: var(--gc-radius-md); background: var(--gc-gradient-surface); }
.agent-detail-modal__site-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-2); }
.agent-detail-modal__site-loading { display: flex; align-items: center; justify-content: center; min-height: var(--gc-size-card-min); gap: var(--gc-space-2); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); font-weight: 700; }
.agent-detail-modal__site-spinner { width: var(--gc-space-5); aspect-ratio: 1; border: var(--gc-border-width-thick) solid var(--gc-color-primary-border); border-top-color: var(--gc-color-primary); border-radius: var(--gc-radius-full); animation: device-sites-spin 700ms linear infinite; }
@keyframes device-sites-spin { to { transform: rotate(1turn); } }
@media (max-width: 64rem) { .agent-detail-modal__site-grid { grid-template-columns: 1fr; } }
</style>
