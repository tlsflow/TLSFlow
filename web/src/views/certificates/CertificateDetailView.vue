<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { GcPageHeader } from '@/design-system/components'
import CertificateDetailPanel from './CertificateDetailPanel.vue'

const route = useRoute()
const assetId = computed(() => String(route.params.id ?? ''))
const versionId = computed(() => String(route.query.versionId ?? ''))
</script>

<template>
  <section class="gc-page certificate-detail-view">
    <GcPageHeader
      title="证书详情"
      description="展示证书版本详情、格式产物和关联资产。"
    >
      <template #actions>
        <RouterLink class="gc-button" to="/certificates">返回列表</RouterLink>
      </template>
    </GcPageHeader>

    <CertificateDetailPanel :asset-id="assetId" :version-id="versionId" />
  </section>
</template>

<style scoped>
.certificate-detail-view {
  display: grid;
  gap: 12px;
}
</style>
