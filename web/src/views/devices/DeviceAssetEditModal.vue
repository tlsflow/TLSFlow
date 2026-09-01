<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { GcButton, GcModal, GcPluginForm, type PluginFormSchema } from '@/design-system/components'
import { getDeviceAsset, getManagedDevice, updateDeviceAsset } from '@/api/modules/devices.api'
import { getServiceAssetDetail, updateServiceAsset } from '@/api/modules/assets.api'
import { getUnifiedPluginUiResources, getPluginBinding, updatePluginBinding } from '@/api/modules/plugins.api'
import type { ApiBody } from '@/api/modules/common'

const props = defineProps<{ open: boolean; deviceId?: string; serviceAssetId?: string }>()
const emit = defineEmits<{ 'update:open': [value: boolean]; completed: [] }>()
const { t, locale } = useI18n()

const loading = ref(false)
const saving = ref(false)
const error = ref('')
const unsupported = ref(false)
const asset = ref<Record<string, unknown> | null>(null)
const binding = ref<Record<string, unknown> | null>(null)
const schema = ref<PluginFormSchema | null>(null)
const pluginMessages = ref<Record<string, string>>({})
const values = ref<Record<string, unknown>>({})
const isServiceAsset = computed(() => Boolean(props.serviceAssetId))

const missingFields = computed(() => (schema.value?.sections ?? []).flatMap((section) => section.fields)
  .filter((field) => field.required && isEmpty(values.value[field.key] ?? field.defaultValue))
  .map((field) => field.key))
const canSave = computed(() => !loading.value && !saving.value && !unsupported.value && (isServiceAsset.value || Boolean(schema.value)) && missingFields.value.length === 0)

watch(() => props.open, (open) => {
  if (open) void load()
}, { immediate: true })

async function load(): Promise<void> {
  loading.value = true
  saving.value = false
  error.value = ''
  unsupported.value = false
  asset.value = null
  binding.value = null
  schema.value = null
  pluginMessages.value = {}
  values.value = {}
  try {
    if (props.serviceAssetId) {
      const response = await getServiceAssetDetail(props.serviceAssetId)
      const loadedAsset = asRecord(response.data)
      if (!loadedAsset.id) {
        unsupported.value = true
        return
      }
      asset.value = loadedAsset
      values.value = { displayName: loadedAsset.displayName ?? loadedAsset.address ?? '' }
      return
    }
    if (!props.deviceId) {
      unsupported.value = true
      return
    }
    const deviceResponse = await getManagedDevice(props.deviceId)
    const device = asRecord(deviceResponse.data)
    const extension = asRecord(device.extension)
    if (String(extension.type ?? '').toUpperCase() !== 'PLUGIN') {
      unsupported.value = true
      return
    }
    const deviceAssetId = stringValue(extension.deviceAssetId ?? asRecord(device.extensionSummary).deviceAssetId)
    const bindingId = stringValue(extension.pluginBindingId ?? asRecord(device.extensionSummary).pluginBindingId)
    if (!deviceAssetId || !bindingId) {
      unsupported.value = true
      return
    }
    const [assetResponse, bindingResponse] = await Promise.all([
      getDeviceAsset(deviceAssetId),
      getPluginBinding(bindingId),
    ])
    const loadedAsset = asRecord(assetResponse.data)
    const loadedBinding = asRecord(bindingResponse.data)
    const pluginVersionId = stringValue(loadedBinding.pluginVersionId ?? extension.pluginVersionId)
    if (!pluginVersionId) {
      unsupported.value = true
      return
    }
    const resourceResponse = await getUnifiedPluginUiResources(pluginVersionId, locale.value)
    const resource = asRecord(resourceResponse.data)
    const forms = asRecord(resource.forms)
    const loadedSchema = (isRecord(forms.device) ? forms.device : forms.cloud) as PluginFormSchema | undefined
    if (!loadedSchema) {
      unsupported.value = true
      return
    }
    asset.value = loadedAsset
    binding.value = loadedBinding
    schema.value = loadedSchema
    pluginMessages.value = asRecord(asRecord(resource.locale).messages) as Record<string, string>
    values.value = readFormValues(loadedSchema, loadedAsset, loadedBinding)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('devices.errors.editLoadFailed')
  } finally {
    loading.value = false
  }
}

async function save(): Promise<void> {
  if (!canSave.value || !asset.value) return
  saving.value = true
  error.value = ''
  try {
    if (props.serviceAssetId) {
      await updateServiceAsset(props.serviceAssetId, { displayName: stringValue(values.value.displayName).trim() })
      emit('update:open', false)
      emit('completed')
      return
    }
    if (!binding.value || !schema.value) return
    const nextBinding = buildBinding(schema.value, binding.value, values.value)
    const nextAsset = buildAssetPatch(schema.value, values.value)
    const bindingId = stringValue(binding.value.id)
    const expectedVersion = numberValue(binding.value.version)
    if (!bindingId || expectedVersion === undefined) throw new Error(t('devices.errors.editSaveFailed'))
    await updatePluginBinding({
      bindingId,
      expectedVersion,
      inputBindings: nextBinding,
    })
    await updateDeviceAsset(stringValue(asset.value.id), nextAsset)
    emit('update:open', false)
    emit('completed')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('devices.errors.editSaveFailed')
  } finally {
    saving.value = false
  }
}

function close(): void {
  if (!saving.value) emit('update:open', false)
}

function readFormValues(form: PluginFormSchema, deviceAsset: Record<string, unknown>, pluginBinding: Record<string, unknown>): Record<string, unknown> {
  const input = asRecord(pluginBinding.inputBindings)
  const variables = asRecord(input.variables)
  const connections = asRecord(input.connections)
  const slot = Object.keys(connections)[0] ?? 'default'
  const connection = asRecord(connections[slot])
  const tls = asRecord(connection.tls)
  const credentials = asRecord(input.credentials)
  const credentialId = Object.values(credentials).map((value) => asRecord(value).credentialId).find((value) => typeof value === 'string')
  const defaults = Object.fromEntries(form.sections.flatMap((section) => section.fields)
    .filter((field) => field.defaultValue !== undefined)
    .map((field) => [field.key, field.defaultValue]))
  for (const field of form.sections.flatMap((section) => section.fields)) {
    const standard = field.standardField
    if (standard === 'device.displayName') defaults[field.key] = deviceAsset.displayName
    else if (standard === 'connection.address') defaults[field.key] = deviceAsset.managementAddress ?? connection.host
    else if (standard === 'connection.port') defaults[field.key] = deviceAsset.managementPort ?? connection.port
    else if (standard === 'connection.gatewayId') defaults[field.key] = deviceAsset.gatewayId
    else if (standard === 'authentication.mode') defaults[field.key] = deviceAsset.authMode
    else if (standard === 'authentication.credentialId') defaults[field.key] = credentialId
    else if (standard === 'tls.enabled') defaults[field.key] = tls.enabled ?? true
    else if (standard === 'tls.verifyPeer') defaults[field.key] = tls.verifyPeer ?? deviceAsset.tlsVerify ?? true
    else if (standard === 'tls.ignoreCertificateErrors') defaults[field.key] = tls.verifyPeer === false || deviceAsset.tlsVerify === false
    else if (standard === 'tls.serverName') defaults[field.key] = tls.serverName
    else if (standard === 'tls.caSecretRef') defaults[field.key] = deviceAsset.caSecretId
    else if (!standard && Object.prototype.hasOwnProperty.call(variables, field.key)) defaults[field.key] = variables[field.key]
  }
  return defaults
}

function buildAssetPatch(form: PluginFormSchema, current: Record<string, unknown>): ApiBody {
  const patch: Record<string, unknown> = {}
  for (const field of form.sections.flatMap((section) => section.fields)) {
    const value = current[field.key]
    switch (field.standardField) {
      case 'device.displayName': patch.displayName = value; break
      case 'connection.address': patch.managementAddress = value; break
      case 'connection.port': patch.managementPort = numberValue(value); break
      case 'connection.gatewayId': patch.gatewayId = value ?? ''; break
      case 'authentication.mode': patch.authMode = value; break
      case 'tls.verifyPeer': patch.tlsVerify = Boolean(value); break
      case 'tls.ignoreCertificateErrors': patch.tlsVerify = !Boolean(value); break
      case 'tls.caSecretRef': patch.caSecretId = value ?? ''; break
      default: break
    }
  }
  return patch
}

function buildBinding(form: PluginFormSchema, current: Record<string, unknown>, formValues: Record<string, unknown>): Record<string, unknown> {
  const input = asRecord(current.inputBindings)
  const variables = { ...asRecord(input.variables) }
  const connections = { ...asRecord(input.connections) }
  const credentials = { ...asRecord(input.credentials) }
  const slot = Object.keys(connections)[0] ?? 'default'
  const connection = { ...asRecord(connections[slot]) }
  const tls = { ...asRecord(connection.tls) }
  let credentialSlot = Object.keys(credentials)[0] ?? 'default'
  for (const field of form.sections.flatMap((section) => section.fields)) {
    const value = formValues[field.key]
    if (field.standardField === 'connection.address') connection.host = value
    else if (field.standardField === 'connection.port') connection.port = numberValue(value)
    else if (field.standardField === 'connection.gatewayId') {
      // 网关属于设备资产元数据，Binding 只保存插件工作流的连接输入。
    }
    else if (field.standardField === 'tls.enabled') tls.enabled = Boolean(value)
    else if (field.standardField === 'tls.verifyPeer') tls.verifyPeer = Boolean(value)
    else if (field.standardField === 'tls.ignoreCertificateErrors') tls.verifyPeer = !Boolean(value)
    else if (field.standardField === 'tls.serverName') tls.serverName = value
    else if (field.standardField === 'tls.minimumVersion') tls.minimumVersion = value
    else if (field.standardField === 'authentication.credentialId') {
      if (typeof value === 'string' && value.trim()) credentials[credentialSlot] = { credentialId: value.trim() }
    } else if (!field.standardField) {
      if (isEmpty(value)) delete variables[field.key]
      else variables[field.key] = value
    }
  }
  if (Object.keys(tls).length > 0) connection.tls = tls
  connections[slot] = connection
  if (Object.prototype.hasOwnProperty.call(variables, 'allowInsecureTls')) {
    variables.allowInsecureTls = tls.verifyPeer === false
  }
  return {
    ...input,
    variables,
    connections,
    credentials,
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
}
</script>

<template>
  <GcModal
    :open="props.open"
    :title="t('devices.edit.title')"
    :description="t('devices.edit.description')"
    size="xxl"
    max-height="calc(100vh - var(--gc-space-10))"
    :busy="loading || saving"
    :error="error"
    @update:open="(open) => { if (!open) close() }"
  >
    <p v-if="loading" class="device-edit__notice">{{ t('common.loading') }}</p>
    <p v-else-if="unsupported" class="device-edit__notice">{{ t('devices.edit.unsupported') }}</p>
    <label v-else-if="isServiceAsset" class="device-edit__field">
      <span>{{ t('assets.fields.displayName') }}</span>
      <input v-model="values.displayName" type="text" autocomplete="off" />
    </label>
    <GcPluginForm
      v-else-if="schema"
      v-model="values"
      :schema="schema"
      :plugin-messages="pluginMessages"
    />
    <p v-if="missingFields.length > 0" class="device-edit__validation">{{ t('devices.edit.validation') }}</p>
    <template #actions>
      <GcButton variant="secondary" :disabled="saving" @click="close">{{ t('devices.actions.cancel') }}</GcButton>
      <GcButton variant="primary" :loading="saving" :disabled="!canSave" @click="save">{{ t('devices.edit.save') }}</GcButton>
    </template>
  </GcModal>
</template>

<style scoped>
.device-edit__notice,
.device-edit__validation {
  margin: 0;
  color: var(--gc-color-text-muted);
  line-height: var(--gc-line-height-relaxed);
}

.device-edit__validation {
  margin-top: var(--gc-space-3);
  color: var(--gc-color-danger);
}

.device-edit__field { display: grid; gap: var(--gc-space-2); }
.device-edit__field span { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.device-edit__field input { min-height: var(--gc-control-height-md); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-sm); background: var(--gc-color-surface); color: var(--gc-color-text-primary); font: inherit; padding: 0 var(--gc-space-3); }
</style>
