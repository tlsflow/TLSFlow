<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { GcModal, GcPluginForm, type PluginFormSchema } from '@/design-system/components'
import { listDeviceOnboardingPlatforms, onboardManagedDevice } from '@/api/modules/devices.api'
import { getUnifiedPluginUiResources, listPluginCatalog } from '@/api/modules/plugins.api'
import type { ApiRecord } from '@/api/modules/common'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import {
  buildDeviceOnboardingPayload,
  normalizeDeviceOnboardingResult,
  validateDeviceOnboarding,
  type DeviceOnboardingPlatform,
  type DeviceOnboardingResultView,
} from './device-onboarding.model'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean]; completed: [] }>()
const { t, locale } = useI18n()
const platforms = ref<DeviceOnboardingPlatform[]>([])
const selectedKey = ref('')
const values = ref<Record<string, unknown>>({})
const pluginForm = ref<PluginFormSchema | null>(null)
const pluginMessages = ref<Record<string, string>>({})
const pluginDisplayNames = ref<Record<string, string>>({})
const failedPlatformLogos = ref(new Set<string>())
const pending = ref(false)
const error = ref('')
const result = ref<DeviceOnboardingResultView | null>(null)
const commandCopied = ref(false)
const step = ref<1 | 2 | 3>(1)

const selected = computed(() => platforms.value.find((item) => item.key === selectedKey.value))
const missingFields = computed(() => {
  if (!selected.value) return []
  if (selected.value.pluginVersionId) return requiredPluginFields(pluginForm.value, values.value)
  return validateDeviceOnboarding(selected.value, values.value)
})
const canSubmit = computed(() => Boolean(selected.value) && missingFields.value.length === 0 && !pending.value)
const isAgentInstall = computed(() => selected.value?.onboardingKind === 'AGENT_INSTALL')
const platformGroupDefinitions = [
  { key: 'windows', platformGroup: 'WINDOWS', titleKey: 'devices.onboarding.groups.windows' },
  { key: 'other', platformGroup: 'OTHER', titleKey: 'devices.onboarding.groups.other' },
] as const
const platformGroups = computed(() => [
  ...platformGroupDefinitions.map((definition) => ({
    key: definition.key,
    title: t(definition.titleKey),
    platforms: platforms.value.filter((platform) => platform.group === definition.platformGroup),
  })),
].filter((group) => group.platforms.length > 0))

watch(() => props.open, async (open) => {
  if (!open) return
  step.value = 1
  selectedKey.value = ''
  values.value = { tlsVerify: true }
  result.value = null
  commandCopied.value = false
  failedPlatformLogos.value = new Set()
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

function platformLogoUrl(platform: DeviceOnboardingPlatform): string | undefined {
  const staticLogos: Record<string, string> = {
    'windows-server-2008-r2': '/platform-logos/windows-server-2008-r2.svg',
    'windows-server-2012-r2': '/platform-logos/windows-server-2012-r2.svg',
    'windows-server-2016-plus': '/platform-logos/windows-server-2016-plus.svg',
    linux: '/platform-logos/linux.svg',
  }
  const value = platform.logoUrl ?? staticLogos[platform.key]
  if (!value || failedPlatformLogos.value.has(platform.key) || typeof window === 'undefined') return undefined
  try {
    const url = new URL(value, window.location.origin)
    if (url.origin !== window.location.origin) return undefined
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return undefined
  }
}

function platformInitial(platform: DeviceOnboardingPlatform): string {
  return platformLabel(platform).trim().slice(0, 1).toLocaleUpperCase()
}

function markPlatformLogoFailed(platformKey: string) {
  failedPlatformLogos.value = new Set([...failedPlatformLogos.value, platformKey])
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
    commandCopied.value = false
    step.value = 3
    if (!platform.onboardingKind || platform.onboardingKind !== 'AGENT_INSTALL') emit('completed')
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
  commandCopied.value = false
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
    group: 'OTHER',
    logoUrl: typeof item.logoUrl === 'string' ? item.logoUrl : undefined,
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
    commandCopied.value = false
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

async function copyInstallCommand() {
  const command = result.value?.installCommand
  if (!command) return
  commandCopied.value = await copyToClipboard(command)
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 浏览器未授予剪贴板权限时回退到兼容实现。
    }
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  document.body.removeChild(textarea)
  return copied
}
</script>

<template>
  <GcModal
    :open="open"
    :title="t('devices.onboarding.title')"
    :description="t('devices.onboarding.description')"
    size="xxl"
    max-height="calc(100vh - var(--gc-space-10))"
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

      <div v-if="step === 1" class="device-wizard__platform-groups" :aria-label="t('devices.onboarding.platformAria')">
        <section v-for="group in platformGroups" :key="group.key" class="device-wizard__platform-group">
          <h3>{{ group.title }}</h3>
          <div class="device-wizard__platforms">
            <button
              v-for="platform in group.platforms"
              :key="platform.key"
              type="button"
              class="device-wizard__platform"
              :class="{ 'device-wizard__platform--active': selectedKey === platform.key }"
              :disabled="pending"
              @click="selectPlatform(platform.key)"
            >
              <span class="device-wizard__platform-logo" :class="{ 'device-wizard__platform-logo--fallback': !platformLogoUrl(platform) }">
                <img v-if="platformLogoUrl(platform)" :src="platformLogoUrl(platform)" alt="" @error="markPlatformLogoFailed(platform.key)">
                <span v-else aria-hidden="true">{{ platformInitial(platform) }}</span>
              </span>
              <span class="device-wizard__platform-copy">
                <strong>{{ platformLabel(platform) }}</strong>
                <span>{{ platform.productFamily }}</span>
              </span>
            </button>
          </div>
        </section>
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
        <p v-if="isAgentInstall && result.expiresAt" class="device-wizard__expiry">
          {{ t('devices.onboarding.expiresAt') }}：{{ formatBrowserLocalTime(result.expiresAt) || '-' }}
        </p>
        <div v-if="isAgentInstall" class="device-wizard__command">
          <pre><code>{{ result.installCommand }}</code></pre>
          <button
            class="device-wizard__copy-button"
            :class="{ 'device-wizard__copy-button--copied': commandCopied }"
            type="button"
            :disabled="!result.installCommand"
            :aria-label="commandCopied ? t('devices.actions.copied') : t('devices.actions.copyCommand')"
            :title="commandCopied ? t('devices.actions.copied') : t('devices.actions.copyCommand')"
            @click="copyInstallCommand"
          >
            <svg v-if="commandCopied" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m5 12 4 4L19 6" />
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="8" y="8" width="11" height="11" rx="2" />
              <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
            </svg>
            <span class="device-wizard__sr-only" aria-live="polite">{{ commandCopied ? t('devices.actions.copied') : '' }}</span>
          </button>
        </div>
        <p v-if="isAgentInstall" class="device-wizard__hint">{{ t('devices.onboarding.tokenHint') }}</p>
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
        {{ pending ? t('common.loading') : isAgentInstall ? t('devices.actions.generateCommand') : t('devices.actions.add') }}
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
.device-wizard__platform-groups { display: grid; min-block-size: 0; max-block-size: min(54vh, calc(100vh - (var(--gc-space-10) * 5))); gap: var(--gc-space-section); padding-inline-end: var(--gc-space-2); overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.device-wizard__platform-group { display: grid; gap: var(--gc-space-3); }
.device-wizard__platform-group h3 { margin: 0; color: var(--gc-color-text-strong); font-size: var(--gc-font-size-heading-xs); font-weight: var(--gc-font-weight-semibold); }
.device-wizard__platforms { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--gc-space-3); }
.device-wizard__platform { display: grid; grid-template-columns: calc(var(--gc-space-4) * 3) minmax(0, 1fr); align-items: start; gap: var(--gc-space-2); padding: var(--gc-space-3); text-align: left; color: var(--gc-color-text); cursor: pointer; background: var(--gc-color-surface-soft); border: var(--gc-space-hairline) solid var(--gc-color-border); border-radius: var(--gc-radius-card); box-shadow: var(--gc-shadow-sm); transition: border-color 160ms ease, background 160ms ease, box-shadow 160ms ease, transform 160ms ease; }
.device-wizard__platform:hover:not(:disabled) { background: var(--gc-color-surface); border-color: var(--gc-color-primary-border-strong); box-shadow: var(--gc-shadow-hover); transform: translateY(calc(var(--gc-space-hairline) * -1)); }
.device-wizard__platform:focus-visible { outline: none; box-shadow: var(--gc-shadow-focus); }
.device-wizard__platform:disabled { cursor: wait; opacity: var(--gc-opacity-disabled); }
.device-wizard__platform--active { border-color: var(--gc-color-primary); background: var(--gc-color-primary-soft); box-shadow: var(--gc-shadow-primary); }
.device-wizard__platform-logo { display: flex; align-items: center; justify-content: flex-start; inline-size: calc(var(--gc-space-4) * 3); block-size: calc(var(--gc-space-4) * 3); overflow: hidden; background: var(--gc-color-surface); border: var(--gc-space-hairline) solid var(--gc-color-border-subtle); border-radius: var(--gc-radius-control); }
.device-wizard__platform-logo img { max-inline-size: none; inline-size: auto; block-size: 100%; }
.device-wizard__platform-logo--fallback { color: var(--gc-color-primary); background: var(--gc-color-primary-soft); font-size: var(--gc-font-size-heading-sm); font-weight: var(--gc-font-weight-semibold); }
.device-wizard__platform-copy { display: grid; min-inline-size: 0; gap: var(--gc-space-compact); }
.device-wizard__platform-copy strong { color: var(--gc-color-text-strong); font-size: var(--gc-font-size-label); line-height: var(--gc-line-height-tight); overflow-wrap: anywhere; }
.device-wizard__platform-copy > span { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-caption); line-height: var(--gc-line-height-tight); overflow-wrap: anywhere; }
.device-wizard__form { display: grid; gap: var(--gc-space-3); }
.device-wizard__form label { display: grid; gap: var(--gc-space-2); }
.device-wizard__form input { padding: var(--gc-space-3); color: var(--gc-color-text); background: var(--gc-color-surface-field); border: var(--gc-space-hairline) solid var(--gc-color-border); border-radius: var(--gc-radius-sm); }
.device-wizard__notice { color: var(--gc-color-warning); background: var(--gc-color-warning-soft); border: var(--gc-space-hairline) solid var(--gc-color-warning-border); border-radius: var(--gc-radius-sm); padding: var(--gc-space-3); }
.device-wizard__error { color: var(--gc-color-danger); }
.device-wizard__result { display: grid; gap: var(--gc-space-3); padding: var(--gc-space-3); background: var(--gc-color-success-soft); border: var(--gc-space-hairline) solid var(--gc-color-success-border); border-radius: var(--gc-radius-sm); }
.device-wizard__command { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: var(--gc-space-3); }
.device-wizard__result pre { overflow: auto; margin: 0; padding: var(--gc-space-3); color: var(--gc-color-text-inverse); background: var(--gc-color-code-bg); border-radius: var(--gc-radius-sm); white-space: pre-wrap; }
.device-wizard__result code { overflow-wrap: anywhere; }
.device-wizard__result dl, .device-wizard__result p { margin: 0; }
.device-wizard__expiry, .device-wizard__hint { color: var(--gc-color-text-muted); }
.device-wizard__copy-button { display: grid; place-items: center; padding: var(--gc-space-3); color: var(--gc-color-text-inverse); cursor: pointer; background: var(--gc-gradient-primary); border: var(--gc-space-hairline) solid var(--gc-color-primary-border-strong); border-radius: var(--gc-radius-md); box-shadow: var(--gc-shadow-primary); }
.device-wizard__copy-button:hover { background: var(--gc-color-primary-hover); transform: translateY(calc(var(--gc-space-hairline) * -1)); }
.device-wizard__copy-button:focus-visible { outline: none; box-shadow: var(--gc-shadow-focus); }
.device-wizard__copy-button:disabled { cursor: not-allowed; opacity: var(--gc-opacity-disabled); transform: none; }
.device-wizard__copy-button--copied { color: var(--gc-color-text-inverse); background: var(--gc-color-success); border-color: var(--gc-color-success-border); box-shadow: var(--gc-shadow-sm); }
.device-wizard__copy-button svg { inline-size: var(--gc-space-5); block-size: var(--gc-space-5); stroke: currentColor; stroke-width: var(--gc-border-width-thick); stroke-linecap: round; stroke-linejoin: round; }
.device-wizard__sr-only { position: absolute; inline-size: var(--gc-space-hairline); block-size: var(--gc-space-hairline); padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

@media (max-width: 64rem) {
  .device-wizard__platforms { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 48rem) {
  .device-wizard__platform-groups { max-block-size: none; padding-inline-end: 0; overflow: visible; }
  .device-wizard__platforms { grid-template-columns: 1fr; }
  .device-wizard__command { grid-template-columns: 1fr; }
}
</style>
