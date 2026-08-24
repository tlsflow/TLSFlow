<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiClientError } from '@/api/client'
import { createCredential, listCredentials, type CredentialProfileSummary } from '@/api/modules/credentials.api'

const model = defineModel<string>({ default: '' })
const props = withDefaults(defineProps<{
  providerId: string
  providerName: string
  credentialTemplate: string
  disabled?: boolean
  required?: boolean
}>(), { disabled: false, required: false })

const { t } = useI18n()
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const creating = ref(false)
const options = ref<CredentialProfileSummary[]>([])
const values = reactive<Record<string, string>>({})

const filtered = computed(() => options.value.filter((item) =>
  item.status === 'active'
  && item.kind === 'DNS_PROVIDER'
  && readMetadata(item.metadata, 'providerId') === props.providerId))
const selected = computed(() => filtered.value.find((item) => item.id === model.value))

watch(() => props.providerId, async () => {
  creating.value = false
  error.value = ''
  resetValues()
  await load()
})

onMounted(load)

async function load(): Promise<void> {
  if (!props.providerId) {
    options.value = []
    return
  }
  loading.value = true
  try {
    const result = await listCredentials({ kinds: ['DNS_PROVIDER'] })
    options.value = result.data?.items ?? []
    if (model.value && !filtered.value.some((item) => item.id === model.value)) model.value = ''
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : t('acme.create.messages.credentialsLoadFailed')
  } finally {
    loading.value = false
  }
}

function resetValues(): void {
  for (const key of Object.keys(values)) delete values[key]
}

function openCreate(): void {
  error.value = ''
  resetValues()
  creating.value = true
}

function closeCreate(): void {
  if (!saving.value) creating.value = false
}

async function saveCredential(): Promise<void> {
  if (!props.providerId || !values.config?.trim()) {
    error.value = t('acme.create.messages.credentialFieldsRequired')
    return
  }
  saving.value = true
  error.value = ''
  try {
    const config = values.config.trim()
    const result = await createCredential({
      name: `${props.providerName} DNS`,
      kind: 'DNS_PROVIDER',
      scopeType: 'global',
      metadata: {
        credentialType: 'acme-dns',
        providerId: props.providerId,
        providerName: props.providerName,
        format: 'lego-env',
      },
      secretValues: { config: { plainText: config, type: 'password' } },
    })
    const id = result.data?.id
    if (!id) throw new Error(t('acme.create.messages.credentialCreateFailed'))
    model.value = id
    options.value = [...options.value, result.data]
    creating.value = false
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : cause instanceof Error ? cause.message : t('acme.create.messages.credentialCreateFailed')
  } finally {
    saving.value = false
  }
}

function readMetadata(metadata: Record<string, unknown> | undefined, key: string): string {
  return metadata && typeof metadata[key] === 'string' ? metadata[key] as string : ''
}
</script>

<template>
  <div class="gc-acme-credential">
    <div class="gc-acme-credential__row">
      <label class="gc-acme-credential__select">
        <span>{{ t('acme.create.fields.dnsCredential') }}</span>
        <select v-model="model" :disabled="disabled || loading || creating" :required="required">
          <option value="">{{ loading ? t('common.loading') : t('acme.create.placeholders.dnsCredential') }}</option>
          <option v-for="item in filtered" :key="item.id" :value="item.id">{{ item.name }}</option>
        </select>
      </label>
      <button class="gc-button gc-button--compact" type="button" :disabled="disabled || !providerId || saving" @click="creating ? closeCreate() : openCreate()">
        {{ creating ? t('common.cancel') : t('acme.create.actions.createCredential') }}
      </button>
    </div>
    <small v-if="selected" class="gc-acme-credential__selected">{{ t('acme.create.messages.selectedCredential', { name: selected.name }) }}</small>
    <pre class="gc-acme-credential__example">{{ credentialTemplate }}</pre>
    <div v-if="creating" class="gc-acme-credential__editor">
      <label class="gc-acme-credential__config">
        <span>{{ t('acme.create.fields.credentialConfig') }}</span>
        <textarea v-model="values.config" rows="8" :placeholder="t('acme.create.placeholders.credentialValue')" autocomplete="off" spellcheck="false" />
        <small>{{ t('credentials.hints.encrypted') }}</small>
      </label>
      <button class="gc-button gc-button--primary gc-button--compact" type="button" :disabled="saving" @click="saveCredential">{{ t('acme.create.actions.saveCredential') }}</button>
    </div>
    <p v-if="error" class="gc-acme-credential__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.gc-acme-credential { display: grid; gap: var(--gc-space-2); }
.gc-acme-credential__row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: var(--gc-space-2); }
.gc-acme-credential__select, .gc-acme-credential__editor label { display: grid; gap: var(--gc-space-1); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.gc-acme-credential select { min-height: var(--gc-control-height-md); padding: 0 var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-field); color: var(--gc-color-text); }
.gc-acme-credential__config { display: grid; gap: var(--gc-space-1); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.gc-acme-credential__config textarea { min-height: var(--gc-control-height-xl); padding: var(--gc-space-2) var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-field); color: var(--gc-color-text); font-family: var(--gc-font-family); resize: vertical; }
.gc-acme-credential__config small { color: var(--gc-color-text-muted); }
.gc-acme-credential__selected { color: var(--gc-color-success); }
.gc-acme-credential__example { max-height: var(--gc-size-modal-max-height); overflow: auto; margin: 0; padding: var(--gc-space-2); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-sm); background: var(--gc-color-surface-muted); color: var(--gc-color-text-muted); font-family: var(--gc-font-family); font-size: var(--gc-font-size-xs); white-space: pre-wrap; overflow-wrap: anywhere; }
.gc-acme-credential__editor { display: grid; gap: var(--gc-space-2); padding: var(--gc-space-3); border-inline-start: var(--gc-border-width-strong) solid var(--gc-color-info-border); background: var(--gc-color-info-bg); }
.gc-acme-credential__error { margin: 0; color: var(--gc-color-danger); font-size: var(--gc-font-size-sm); }
@media (max-width: 40rem) { .gc-acme-credential__row { grid-template-columns: 1fr; } }
</style>
