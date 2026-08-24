<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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
const platformKeyword = ref('')
const platformSelectionActive = ref(true)
const modelOpen = computed({
  get: () => props.open,
  set: (value: boolean) => {
    if (!value) {
      footerActions.value = emptyFooterActions()
      platformKeyword.value = ''
      platformSelectionActive.value = true
      void clearOnboardingRoute()
    }
    emit('update:open', value)
  },
})

watch(() => props.open, (open) => {
  if (!open) return
  platformKeyword.value = ''
  platformSelectionActive.value = true
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

function updatePlatformSelection(active: boolean): void {
  platformSelectionActive.value = active
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
    dialog-class="application-onboarding-modal"
    :title="t('applicationOnboarding.title')"
    :description="t('applicationOnboarding.description')"
  >
    <template #header-actions>
      <label v-if="platformSelectionActive" class="application-onboarding-modal__search">
        <span class="application-onboarding-modal__sr-only">{{ t('applicationOnboarding.platforms.searchLabel') }}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4.5 4.5" />
        </svg>
        <input
          v-model="platformKeyword"
          type="search"
          autocomplete="off"
          :placeholder="t('applicationOnboarding.platforms.searchPlaceholder')"
          :aria-label="t('applicationOnboarding.platforms.searchLabel')"
        >
      </label>
    </template>
    <ApplicationOnboardingView
      v-if="modelOpen"
      ref="onboardingView"
      embedded
      v-model:platform-keyword="platformKeyword"
      @close="modelOpen = false"
      @custom-manual="openCustomManual"
      @add-device="openDeviceOnboarding"
      @platform-selection-change="updatePlatformSelection"
      @footer-actions-change="updateFooterActions"
    />
    <template v-if="footerActions.visible" #actions>
      <button v-if="footerActions.showCancel" class="gc-button gc-button--ghost" type="button" @click="cancel">{{ t('applicationOnboarding.actions.cancel') }}</button>
      <button v-if="footerActions.showPrevious" class="gc-button gc-button--secondary" type="button" :disabled="footerActions.previousDisabled" @click="goPrevious">{{ t('applicationOnboarding.actions.previous') }}</button>
      <button v-if="footerActions.primaryAction" class="gc-button gc-button--primary" type="button" :disabled="footerActions.primaryDisabled" @click="runFooterPrimary">{{ footerActions.primaryLabel }}</button>
    </template>
  </GcModal>
</template>

<style scoped>
.application-onboarding-modal__search { position: relative; display: flex; flex: 0 0 min(45vw, var(--gc-size-application-onboarding-search)); align-items: center; inline-size: min(45vw, var(--gc-size-application-onboarding-search)); min-inline-size: 0; }
.application-onboarding-modal__search svg { position: absolute; inset-inline-start: var(--gc-space-3); inline-size: var(--gc-size-icon-md); block-size: var(--gc-size-icon-md); color: var(--gc-color-text-soft); fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: var(--gc-border-width-thick); pointer-events: none; }
.application-onboarding-modal__search input { inline-size: 100%; min-block-size: var(--gc-control-height-md); padding: 0 var(--gc-space-3) 0 calc(var(--gc-space-3) + var(--gc-size-icon-md) + var(--gc-space-2)); color: var(--gc-color-text); font-size: var(--gc-font-size-sm); background: var(--gc-color-surface-field); border: var(--gc-border-width) solid var(--gc-color-border); border-radius: var(--gc-radius-control); }
.application-onboarding-modal__search input::placeholder { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); opacity: 1; }
.application-onboarding-modal__search input:focus { outline: none; border-color: var(--gc-color-primary-border-strong); box-shadow: var(--gc-shadow-focus); }
.application-onboarding-modal__sr-only { position: absolute; inline-size: var(--gc-space-hairline); block-size: var(--gc-space-hairline); padding: 0; margin: calc(var(--gc-space-hairline) * -1); overflow: hidden; white-space: nowrap; clip-path: inset(50%); border: 0; }
:global(.application-onboarding-modal .gc-modal__header > div:first-child) { flex: 1 1 auto; min-inline-size: 0; }
:global(.application-onboarding-modal .gc-modal__header-actions) { flex: 0 0 auto; min-inline-size: 0; }
@media (max-width: 48rem) {
  :global(.application-onboarding-modal .gc-modal__header) { flex-wrap: wrap; }
  :global(.application-onboarding-modal .gc-modal__header-actions) { flex: 1 1 100%; }
  .application-onboarding-modal__search { flex: 1 1 auto; inline-size: min(70vw, var(--gc-size-application-onboarding-search)); }
}
</style>
