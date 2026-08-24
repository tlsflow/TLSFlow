<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { type LocationQueryRaw, useRoute, useRouter } from 'vue-router'
import { GcModal } from '@/design-system/components'
import type { DeviceOnboardingInitialSelection } from '@/views/devices/device-onboarding.model'
import ApplicationOnboardingView from './ApplicationOnboardingView.vue'

type FooterPrimaryAction = 'RESOURCE' | 'TARGET' | 'CERTIFICATE' | 'COMPLETE' | null
interface OnboardingFooterActions {
  visible: boolean
  showCancel: boolean
  showPrevious: boolean
  previousDisabled: boolean
  primaryAction: FooterPrimaryAction
  primaryLabel: string
  primaryDisabled: boolean
}
interface OnboardingViewController {
  goPrevious: () => void
  runFooterPrimary: () => Promise<void>
  cancel: () => Promise<void>
}

function emptyFooterActions(): OnboardingFooterActions {
  return {
    visible: false,
    showCancel: false,
    showPrevious: false,
    previousDisabled: true,
    primaryAction: null,
    primaryLabel: '',
    primaryDisabled: true,
  }
}

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
const onboardingView = ref<OnboardingViewController | null>(null)
const footerActions = ref<OnboardingFooterActions>(emptyFooterActions())
const modelOpen = computed({
  get: () => props.open,
  set: (value: boolean) => {
    if (!value) {
      footerActions.value = emptyFooterActions()
      void clearOnboardingRoute()
    }
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

function updateFooterActions(actions: OnboardingFooterActions): void {
  footerActions.value = actions
}

function goPrevious(): void {
  onboardingView.value?.goPrevious()
}

function runFooterPrimary(): void {
  void onboardingView.value?.runFooterPrimary()
}

function cancel(): void {
  void onboardingView.value?.cancel()
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
      ref="onboardingView"
      embedded
      @close="modelOpen = false"
      @custom-manual="openCustomManual"
      @add-device="openDeviceOnboarding"
      @footer-actions-change="updateFooterActions"
    />
    <template v-if="footerActions.visible" #actions>
      <button v-if="footerActions.showCancel" class="gc-button gc-button--ghost" type="button" @click="cancel">{{ t('applicationOnboarding.actions.cancel') }}</button>
      <button v-if="footerActions.showPrevious" class="gc-button gc-button--secondary" type="button" :disabled="footerActions.previousDisabled" @click="goPrevious">{{ t('applicationOnboarding.actions.previous') }}</button>
      <button v-if="footerActions.primaryAction" class="gc-button gc-button--primary" type="button" :disabled="footerActions.primaryDisabled" @click="runFooterPrimary">{{ footerActions.primaryLabel }}</button>
    </template>
  </GcModal>
</template>
