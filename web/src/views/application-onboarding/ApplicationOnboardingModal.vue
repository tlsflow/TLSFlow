<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { type LocationQueryRaw, useRoute, useRouter } from 'vue-router'
import { GcModal } from '@/design-system/components'
import type { DeviceOnboardingInitialSelection } from '@/views/devices/device-onboarding.model'
import ApplicationOnboardingView from './ApplicationOnboardingView.vue'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  customManual: []
  addDevice: [initialSelection: DeviceOnboardingInitialSelection]
}>()

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const modelOpen = computed({
  get: () => props.open,
  set: (value: boolean) => {
    if (!value) void clearOnboardingRoute()
    emit('update:open', value)
  },
})

function openCustomManual(): void {
  modelOpen.value = false
  emit('customManual')
}

function openDeviceOnboarding(initialSelection: DeviceOnboardingInitialSelection): void {
  emit('addDevice', initialSelection)
}

async function clearOnboardingRoute(): Promise<void> {
  const query: LocationQueryRaw = { ...route.query }
  delete query.session
  delete query.onboarding
  await router.replace({ query })
}
</script>

<template>
  <GcModal
    v-model:open="modelOpen"
    size="xxl"
    max-height="calc(100vh - var(--gc-space-10))"
    :title="t('applicationOnboarding.title')"
    :description="t('applicationOnboarding.description')"
  >
    <ApplicationOnboardingView
      v-if="modelOpen"
      embedded
      @close="modelOpen = false"
      @custom-manual="openCustomManual"
      @add-device="openDeviceOnboarding"
    />
  </GcModal>
</template>
