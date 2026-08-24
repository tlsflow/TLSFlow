<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { GcModal, GcStatusTag } from '@/design-system/components'
import { listDeviceOnboardingPlatforms, onboardManagedDevice } from '@/api/modules/devices.api'
import { buildDeviceOnboardingPayload, validateDeviceOnboarding, type DeviceOnboardingPlatform } from './device-onboarding.model'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean]; completed: [] }>()
const { t } = useI18n()
const platforms = ref<DeviceOnboardingPlatform[]>([])
const selectedKey = ref('')
const values = ref<Record<string, string | number | boolean>>({ tlsVerify: true })
const pending = ref(false)
const error = ref('')
const result = ref<Record<string, unknown> | null>(null)

const selected = computed(() => platforms.value.find((item) => item.key === selectedKey.value))
const missingFields = computed(() => selected.value ? validateDeviceOnboarding(selected.value, values.value) : [])
const canSubmit = computed(() => Boolean(selected.value) && missingFields.value.length === 0 && !pending.value)

watch(() => props.open, async (open) => {
  if (!open || platforms.value.length > 0) return
  error.value = ''
  try {
    const response = await listDeviceOnboardingPlatforms()
    platforms.value = [...(response.data ?? [])] as unknown as DeviceOnboardingPlatform[]
    selectedKey.value = platforms.value[0]?.key ?? ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('devices.errors.platformsLoadFailed')
  }
}, { immediate: true })

watch(selectedKey, () => {
  values.value = { tlsVerify: true }
  result.value = null
  error.value = ''
})

function fieldLabel(key: string): string {
  return t(`devices.onboarding.fields.${key}`)
}

async function submit() {
  if (!selected.value || !canSubmit.value) return
  pending.value = true
  error.value = ''
  try {
    const payload = buildDeviceOnboardingPayload(selected.value, values.value, window.location.origin)
    const response = await onboardManagedDevice(payload)
    result.value = response.data ?? {}
    emit('completed')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('devices.errors.onboardingFailed')
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <GcModal
    :open="open"
    :title="t('devices.onboarding.title')"
    :description="t('devices.onboarding.description')"
    size="xl"
    @update:open="emit('update:open', $event)"
  >
    <div class="device-wizard">
      <div class="device-wizard__platforms" :aria-label="t('devices.onboarding.platformAria')">
        <button
          v-for="platform in platforms"
          :key="platform.key"
          type="button"
          class="device-wizard__platform"
          :class="{ 'device-wizard__platform--active': selectedKey === platform.key }"
          @click="selectedKey = platform.key"
        >
          <strong>{{ t(platform.displayNameKey) }}</strong>
          <span>{{ platform.productFamily }}</span>
          <GcStatusTag :status="platform.supportStatus" />
        </button>
      </div>

      <p v-if="error" class="device-wizard__error">{{ error }}</p>
      <section v-if="selected" class="device-wizard__form">
        <p v-if="selected.supportStatus !== 'SUPPORTED'" class="device-wizard__notice">
          {{ t('devices.onboarding.unsupported') }}
        </p>
        <label v-for="field in selected.formSchema" :key="field.key">
          <span>{{ fieldLabel(field.key) }}</span>
          <input
            v-if="field.type !== 'BOOLEAN'"
            v-model="values[field.key]"
            :type="field.type === 'SECRET_INPUT' ? 'password' : field.type === 'NUMBER' ? 'number' : 'text'"
            :autocomplete="field.type === 'SECRET_INPUT' ? 'new-password' : 'off'"
          >
          <input v-else v-model="values[field.key]" type="checkbox">
        </label>

        <div v-if="result" class="device-wizard__result">
          <strong>{{ t('devices.onboarding.completed') }}</strong>
          <code v-if="selected.onboardingKind === 'AGENT_INSTALL'">{{ result.installCommand }}</code>
        </div>
      </section>
    </div>
    <template #actions>
      <button class="gc-button" type="button" @click="emit('update:open', false)">{{ t('devices.actions.cancel') }}</button>
      <button class="gc-button gc-button--primary" type="button" :disabled="!canSubmit" @click="submit">
        {{ pending ? t('common.loading') : t('devices.actions.add') }}
      </button>
    </template>
  </GcModal>
</template>

<style scoped>
.device-wizard { display: grid; gap: var(--gc-space-4); }
.device-wizard__platforms { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gc-space-3); }
.device-wizard__platform { display: grid; gap: var(--gc-space-2); padding: var(--gc-space-4); text-align: left; color: var(--gc-color-text); background: var(--gc-color-surface-soft); border: var(--gc-space-hairline) solid var(--gc-color-border); border-radius: var(--gc-radius-md); }
.device-wizard__platform--active { border-color: var(--gc-color-primary); background: var(--gc-color-primary-soft); }
.device-wizard__platform span { color: var(--gc-color-text-muted); }
.device-wizard__form { display: grid; gap: var(--gc-space-3); }
.device-wizard__form label { display: grid; gap: var(--gc-space-2); }
.device-wizard__form input { padding: var(--gc-space-3); color: var(--gc-color-text); background: var(--gc-color-surface-field); border: var(--gc-space-hairline) solid var(--gc-color-border); border-radius: var(--gc-radius-sm); }
.device-wizard__notice { color: var(--gc-color-warning); background: var(--gc-color-warning-soft); border: var(--gc-space-hairline) solid var(--gc-color-warning-border); border-radius: var(--gc-radius-sm); padding: var(--gc-space-3); }
.device-wizard__error { color: var(--gc-color-danger); }
.device-wizard__result { display: grid; gap: var(--gc-space-2); padding: var(--gc-space-3); background: var(--gc-color-success-soft); border: var(--gc-space-hairline) solid var(--gc-color-success-border); border-radius: var(--gc-radius-sm); }
.device-wizard__result code { overflow-wrap: anywhere; }
</style>
