<script setup lang="ts">
import { ref } from 'vue'
import DeviceAssetEditModal from '@/views/devices/DeviceAssetEditModal.vue'
import type { UnifiedAssetRef } from './UnifiedAssetDetailModal.vue'

const open = ref(false)
const deviceId = ref('')
const serviceAssetId = ref('')
const emit = defineEmits<{ completed: [] }>()

function show(assetRef: UnifiedAssetRef): void {
  deviceId.value = assetRef.rootType === 'DEVICE' ? assetRef.id : ''
  serviceAssetId.value = assetRef.rootType === 'SERVICE_ASSET' ? assetRef.id : ''
  open.value = true
}

defineExpose({ open: show })
</script>

<template>
  <DeviceAssetEditModal
    v-model:open="open"
    :device-id="deviceId"
    :service-asset-id="serviceAssetId"
    @completed="emit('completed')"
  />
</template>
