<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute } from 'vue-router'
import { GcPageHeader } from '@/design-system/components'
import CertificateDetailPanel from './CertificateDetailPanel.vue'

const route = useRoute()
const { t } = useI18n()
const assetId = computed(() => String(route.params.id ?? ''))
const versionId = computed(() => String(route.query.versionId ?? ''))
</script>

<template>
  <section class="gc-page certificate-detail-view">
    <GcPageHeader
      :title="t('certificates.detail.title')"
      :description="t('certificates.detail.description')"
    >
      <template #actions>
        <RouterLink class="gc-button gc-button--secondary certificate-detail-view__back" to="/certificates">
          {{ t('certificates.detail.backList') }}
        </RouterLink>
      </template>
    </GcPageHeader>

    <CertificateDetailPanel :asset-id="assetId" :version-id="versionId" />
  </section>
</template>

<style scoped>
.certificate-detail-view {
  display: grid;
  gap: var(--gc-space-5);
}
</style>
