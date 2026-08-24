<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { GcModal, GcPluginForm, GcStatusTag, type PluginFormSchema } from '@/design-system/components'
import { listDeviceOnboardingPlatforms, onboardManagedDevice } from '@/api/modules/devices.api'
import { getUnifiedPluginUiResources, listPluginCatalog } from '@/api/modules/plugins.api'
import type { ApiRecord } from '@/api/modules/common'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import { buildDeviceOnboardingPayload, normalizeDeviceOnboardingResult, validateDeviceOnboarding, type DeviceOnboardingPlatform, type DeviceOnboardingResultView } from './device-onboarding.model'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean]; completed: [] }>()
const { t, locale } = useI18n()
const platforms = ref<DeviceOnboardingPlatform[]>([])
const selectedKey = ref('')
const values = ref<Record<string, unknown>>({})
const pluginForm = ref<PluginFormSchema | null>(null)
const pluginMessages = ref<Record<string, string>>({})
const pluginDisplayNames = ref<Record<string, string>>({})
const pending = ref(false)
const error = ref('')
const result = ref<DeviceOnboardingResultView | null>(null)
const step = ref<1 | 2 | 3>(1)

const selected = computed(() => platforms.value.find((item) => item.key === selectedKey.value))
const missingFields = computed(() => {
  if (!selected.value) return []
  if (selected.value.pluginVersionId) return requiredPluginFields(pluginForm.value, values.value)
  return validateDeviceOnboarding(selected.value, values.value)
})
const canSubmit = computed(() => Boolean(selected.value) && missingFields.value.length === 0 && !pending.value)
const isAgentInstall = computed(() => selected.value?.onboardingKind === 'AGENT_INSTALL')

watch(() => props.open, async (open) => {
  if (!open) return
  step.value = 1
  selectedKey.value = ''
  values.value = { tlsVerify: true }
  result.value = null
  if (platforms.value.length > 0) return
  error.value = ''
  try {
    const [agentResponse, catalogResponse] = await Promise.all([
      listDeviceOnboardingPlatforms(),
      listPluginCatalog({ page: 1, pageSize: 500 }),
    ])
    const agentPlatforms = [...(agentResponse.data ?? [])] as unknown as DeviceOnboardingPlatform[]
    const pluginPlatforms = (catalogResponse.data?.items ?? []).filter(isManagedDevicePlugin).map(toPluginPlatform)
    const localized = await Promise.all(pluginPlatforms.map(async (platform) => {
      const response = await getUnifiedPluginUiResources(platform.pluginVersionId ?? '', locale.value)
      const messages = asRecord(asRecord(response.data).locale).messages
      return [platform.key, String(asRecord(messages)[platform.displayNameKey] ?? platform.productFamily)] as const
    }))
    pluginDisplayNames.value = Object.fromEntries(localized)
    platforms.value = [...agentPlatforms, ...pluginPlatforms]
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('devices.errors.platformsLoadFailed')
  }
}, { immediate: true })

function platformLabel(platform: DeviceOnboardingPlatform): string {
  if (platform.pluginVersionId) return pluginDisplayNames.value[platform.key] ?? platform.productFamily
  return t(platform.displayNameKey)
}

function fieldLabel(key: string): string {
  return t(`devices.onboarding.fields.${key}`)
}

async function submit(platform = selected.value) {
  if (!platform || pending.value) return
  if (missingFields.value.length > 0) {
    error.value = t('devices.errors.onboardingValidationFailed')
    return
  }
  pending.value = true
  error.value = ''
  try {
    const payload = buildDeviceOnboardingPayload(platform, values.value)
    const response = await onboardManagedDevice(payload)
    result.value = normalizeDeviceOnboardingResult(platform, response.data ?? {})
    step.value = 3
    emit('completed')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('devices.errors.onboardingFailed')
  } finally {
    pending.value = false
  }
}

async function selectPlatform(platformKey: string) {
  const platform = platforms.value.find((item) => item.key === platformKey)
  selectedKey.value = platformKey
  values.value = { tlsVerify: true }
  pluginForm.value = null
  pluginMessages.value = {}
  result.value = null
  error.value = ''
  if (!platform) return
  if (platform.pluginVersionId) {
    pending.value = true
    try {
      const response = await getUnifiedPluginUiResources(platform.pluginVersionId, locale.value)
      const payload = asRecord(response.data)
      pluginForm.value = asRecord(payload.forms).device as PluginFormSchema | undefined ?? null
      pluginMessages.value = asRecord(asRecord(payload.locale).messages) as Record<string, string>
      values.value = defaultFormValues(pluginForm.value)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : t('devices.errors.platformsLoadFailed')
      return
    } finally {
      pending.value = false
    }
  }
  if (platform.onboardingKind === 'AGENT_INSTALL' && platform.supportStatus === 'SUPPORTED') {
    step.value = 3
    await submit(platform)
    return
  }
  step.value = 2
}

function isManagedDevicePlugin(item: ApiRecord): boolean {
  if (item.catalogType !== 'UNIFIED_PLUGIN' || item.status !== 'ENABLED' || item.runtime !== 'WORKFLOW_DSL') return false
  if (item.scope !== 'MANAGED' && item.scope !== 'BOTH') return false
  const capabilities = Array.isArray(item.capabilities) ? item.capabilities : []
  const keys = new Set(capabilities.map((capability) => String(asRecord(capability).key ?? '')))
  return keys.has('device.connection.test') && keys.has('device.discover')
}

function toPluginPlatform(item: ApiRecord): DeviceOnboardingPlatform {
  const pluginVersionId = String(item.pluginVersionId ?? item.id ?? '')
  return {
    key: `plugin:${pluginVersionId}`,
    displayNameKey: String(item.displayNameKey ?? item.pluginId ?? ''),
    productFamily: String(item.pluginId ?? ''),
    managementMethod: 'PLUGIN',
    onboardingKind: 'API_CONNECTION',
    supportStatus: 'SUPPORTED',
    formSchema: [],
    pluginVersionId,
    pluginId: String(item.pluginId ?? ''),
  }
}

function defaultFormValues(schema: PluginFormSchema | null): Record<string, unknown> {
  return Object.fromEntries((schema?.sections ?? []).flatMap((section) => section.fields)
    .filter((field) => field.defaultValue !== undefined)
    .map((field) => [field.key, field.defaultValue]))
}

function requiredPluginFields(schema: PluginFormSchema | null, currentValues: Record<string, unknown>): string[] {
  return (schema?.sections ?? []).flatMap((section) => section.fields)
    .filter((field) => field.required && isMissingFormValue(currentValues[field.key] ?? field.defaultValue))
    .map((field) => field.key)
}

function isMissingFormValue(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim() === ''
  return Array.isArray(value) && value.length === 0
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function previousStep() {
  if (step.value === 3) {
    result.value = null
    if (isAgentInstall.value) {
      selectedKey.value = ''
      step.value = 1
      return
    }
    step.value = 2
    return
  }
  selectedKey.value = ''
  step.value = 1
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
      <ol class="device-wizard__steps" :class="{ 'device-wizard__steps--agent': isAgentInstall }" :aria-label="t('devices.onboarding.stepsAria')">
        <li :class="{ active: step === 1, done: step > 1 }" :aria-current="step === 1 ? 'step' : undefined">
          <span class="device-wizard__step-marker" aria-hidden="true">
            <svg v-if="step > 1" viewBox="0 0 24 24" fill="none">
              <path d="m5 12 4 4L19 6" />
            </svg>
            <span v-else>1</span>
          </span>
          <span>{{ t('devices.onboarding.steps.platform') }}</span>
        </li>
        <li v-if="!isAgentInstall" :class="{ active: step === 2, done: step > 2 }" :aria-current="step === 2 ? 'step' : undefined">
          <span class="device-wizard__step-marker" aria-hidden="true">
            <svg v-if="step > 2" viewBox="0 0 24 24" fill="none">
              <path d="m5 12 4 4L19 6" />
            </svg>
            <span v-else>2</span>
          </span>
          <span>{{ t('devices.onboarding.steps.configure') }}</span>
        </li>
        <li :class="{ active: step === 3 }" :aria-current="step === 3 ? 'step' : undefined">
          <span class="device-wizard__step-marker" aria-hidden="true">{{ isAgentInstall ? 2 : 3 }}</span>
          <span>{{ isAgentInstall ? t('devices.onboarding.steps.install') : t('devices.onboarding.steps.confirm') }}</span>
        </li>
      </ol>

      <div v-if="step === 1" class="device-wizard__platforms" :aria-label="t('devices.onboarding.platformAria')">
        <button
          v-for="platform in platforms"
          :key="platform.key"
          type="button"
          class="device-wizard__platform"
          :class="{ 'device-wizard__platform--active': selectedKey === platform.key }"
          :disabled="pending"
          @click="selectPlatform(platform.key)"
        >
          <strong>{{ platformLabel(platform) }}</strong>
          <span>{{ platform.productFamily }}</span>
          <GcStatusTag :status="platform.supportStatus" />
        </button>
      </div>

      <p v-if="error" class="device-wizard__error">{{ error }}</p>
      <p v-if="pending && isAgentInstall" class="device-wizard__notice">{{ t('common.loading') }}</p>
      <section v-if="step === 2 && selected" class="device-wizard__form">
        <p v-if="selected.supportStatus !== 'SUPPORTED'" class="device-wizard__notice">
          {{ t('devices.onboarding.unsupported') }}
        </p>
        <GcPluginForm
          v-if="selected.pluginVersionId && pluginForm"
          v-model="values"
          :schema="pluginForm"
          :plugin-messages="pluginMessages"
        />
        <label v-for="field in selected.pluginVersionId ? [] : selected.formSchema" :key="field.key">
          <span>{{ fieldLabel(field.key) }}</span>
          <input
            v-if="field.type !== 'BOOLEAN'"
            v-model="values[field.key]"
            :type="field.type === 'SECRET_INPUT' ? 'password' : field.type === 'NUMBER' ? 'number' : 'text'"
            :autocomplete="field.type === 'SECRET_INPUT' ? 'new-password' : 'off'"
          >
          <input v-else v-model="values[field.key]" type="checkbox">
        </label>
      </section>

      <section v-if="step === 3 && selected && result" class="device-wizard__result">
        <strong>{{ isAgentInstall ? t('devices.onboarding.installReady') : t('devices.onboarding.completed') }}</strong>
        <p v-if="isAgentInstall">{{ t('devices.onboarding.installDescription') }}</p>
        <div v-if="isAgentInstall && result.installMaterials" class="device-wizard__materials">
          <dl>
            <div><dt>{{ t('devices.onboarding.installationId') }}</dt><dd>{{ result.installMaterials.installationId }}</dd></div>
            <div><dt>{{ t('devices.onboarding.expiresAt') }}</dt><dd>{{ formatBrowserLocalTime(result.installMaterials.expiresAt) || '-' }}</dd></div>
          </dl>
          <pre><code>{{ JSON.stringify(result.installMaterials, null, 2) }}</code></pre>
        </div>
        <dl v-else>
          <div><dt>{{ t('devices.onboarding.connectionStatus') }}</dt><dd>{{ result.onboardingKind === 'PLUGIN_MANAGED' ? t('devices.onboarding.completed') : result.connectionSucceeded ? t('devices.onboarding.connectionTested') : t('devices.onboarding.connectionTestFailed') }}</dd></div>
          <div v-if="result.connectionErrorCode"><dt>{{ t('devices.onboarding.connectionErrorCode') }}</dt><dd>{{ result.connectionErrorCode }}</dd></div>
        </dl>
      </section>
    </div>
    <template #actions>
      <button class="gc-button" type="button" @click="emit('update:open', false)">{{ t('devices.actions.cancel') }}</button>
      <button v-if="step > 1" class="gc-button" type="button" @click="previousStep">{{ t('devices.actions.previous') }}</button>
      <button v-if="step === 2" class="gc-button gc-button--primary" type="button" :disabled="!canSubmit" @click="submit()">
        {{ pending ? t('common.loading') : isAgentInstall ? t('devices.actions.prepareMaterials') : t('devices.actions.add') }}
      </button>
      <button v-if="step === 3" class="gc-button gc-button--primary" type="button" @click="emit('update:open', false)">{{ t('devices.actions.finish') }}</button>
    </template>
  </GcModal>
</template>

<style scoped>
.device-wizard { display: grid; gap: var(--gc-space-4); }
.device-wizard__steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gc-space-2); padding: 0; margin: 0; list-style: none; }
.device-wizard__steps--agent { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.device-wizard__steps li { display: flex; align-items: center; gap: var(--gc-space-3); padding: var(--gc-space-3); color: var(--gc-color-text-muted); background: var(--gc-color-surface-soft); border: var(--gc-space-hairline) solid transparent; border-radius: var(--gc-radius-sm); }
.device-wizard__steps li.active { color: var(--gc-color-text-inverse); background: var(--gc-gradient-primary); border-color: var(--gc-color-primary-border-strong); box-shadow: var(--gc-shadow-primary); }
.device-wizard__steps li.done { color: var(--gc-color-success); background: var(--gc-color-surface); border-color: var(--gc-color-success-border); }
.device-wizard__step-marker { display: grid; flex: 0 0 auto; place-items: center; inline-size: var(--gc-space-6); block-size: var(--gc-space-6); color: inherit; background: var(--gc-color-surface); border-radius: var(--gc-radius-xl); }
.device-wizard__steps li.active .device-wizard__step-marker { color: var(--gc-color-primary); }
.device-wizard__steps li.done .device-wizard__step-marker { color: var(--gc-color-text-inverse); background: var(--gc-color-success); }
.device-wizard__step-marker svg { inline-size: var(--gc-space-4); block-size: var(--gc-space-4); stroke: currentColor; stroke-width: var(--gc-border-width-thick); stroke-linecap: round; stroke-linejoin: round; }
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
.device-wizard__materials { display: grid; gap: var(--gc-space-3); }
.device-wizard__materials dl { display: grid; gap: var(--gc-space-2); margin: 0; }
.device-wizard__materials dl > div { display: grid; grid-template-columns: minmax(8rem, auto) minmax(0, 1fr); gap: var(--gc-space-3); }
.device-wizard__materials dt { color: var(--gc-color-text-muted); }
.device-wizard__materials dd { margin: 0; overflow-wrap: anywhere; }
.device-wizard__result pre { overflow: auto; margin: 0; padding: var(--gc-space-3); color: var(--gc-color-text-inverse); background: var(--gc-color-code-bg); border-radius: var(--gc-radius-sm); white-space: pre-wrap; }
.device-wizard__result code { overflow-wrap: anywhere; }
.device-wizard__result dl, .device-wizard__result p { margin: 0; }
</style>
