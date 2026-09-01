<script setup lang="ts">
import { ref } from 'vue'
import type { UnifiedAssetRef } from '@/api/modules/assets.api'
import ManagedDeviceDetailModal from '@/views/devices/details/ManagedDeviceDetailModal.vue'

export type { UnifiedAssetRef }

const modal = ref<InstanceType<typeof ManagedDeviceDetailModal> | null>(null)

async function open(assetRef: UnifiedAssetRef): Promise<void> {
  await modal.value?.openUnified(assetRef)
}

defineExpose({ open })
</script>

<template>
  <ManagedDeviceDetailModal ref="modal" />
</template>
