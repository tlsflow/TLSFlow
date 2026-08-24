<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiClientError } from '@/api/client'
import { createCredential, listCredentials, type CredentialProfileSummary } from '@/api/modules/credentials.api'
import GcButton from './GcButton.vue'

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
const creating = ref(false)
const error = ref('')
const options = ref<CredentialProfileSummary[]>([])
const values = reactive<Record<string, string>>({})
const filtered = computed(() => options.value.filter((item) => (
  item.status === 'active'
  && item.kind === 'DNS_PROVIDER'
  && readMetadata(item.metadata, 'providerId') === props.providerId
)))

watch(() => props.providerId, () => {
  creating.value = false
  error.value = ''
  model.value = ''
  void load()
})

onMounted(() => {
  void load()
})

async function load(): Promise<void> {
  if (!props.providerId) {
    options.value = []
    return
  }
  loading.value = true
  try {
    const result = await listCredentials({ kinds: ['DNS_PROVIDER'] })
    options.value = result.data?.items ?? []
  } catch (caught) {
    error.value = caught instanceof ApiClientError ? caught.message : t('acme.create.messages.credentialsLoadFailed')
  } finally {
    loading.value = false
  }
}

async function saveCredential(): Promise<void> {
  if (!props.providerId || !values.config?.trim()) {
    error.value = t('acme.create.messages.credentialFieldsRequired')
    return
  }
  saving.value = true
  error.value = ''
  try {
    const result = await createCredential({
      name: `${props.providerName} DNS`,
      kind: 'DNS_PROVIDER',
      scopeType: 'global',
      metadata: { credentialType: 'acme-dns', providerId: props.providerId, providerName: props.providerName, format: 'lego-env' },
      secretValues: { config: { plainText: values.config.trim(), type: 'password' } },
    })
    if (!result.data?.id) throw new Error(t('acme.create.messages.credentialCreateFailed'))
    options.value = [...options.value, result.data]
    model.value = result.data.id
    creating.value = false
    values.config = ''
  } catch (caught) {
    error.value = caught instanceof ApiClientError ? caught.message : caught instanceof Error ? caught.message : t('acme.create.messages.credentialCreateFailed')
  } finally {
    saving.value = false
  }
}

function readMetadata(metadata: Record<string, unknown> | undefined, key: string): string {
  return metadata && typeof metadata[key] === 'string' ? metadata[key] : ''
}
</script>

<template>
  <section class="gc-acme-dns-credential">
    <div class="gc-acme-dns-credential__content">
      <div class="gc-acme-dns-credential__controls">
        <label class="gc-form-field">
          <span>{{ t('acme.create.fields.dnsCredential') }}</span>
          <select v-model="model" :disabled="disabled || loading || creating" :required="required">
            <option value="">{{ loading ? t('common.loading') : t('acme.create.placeholders.dnsCredential') }}</option>
            <option v-for="item in filtered" :key="item.id" :value="item.id">{{ item.name }}</option>
          </select>
        </label>
        <GcButton variant="secondary" :disabled="disabled || !providerId || saving" @click="creating = !creating">{{ creating ? t('common.cancel') : t('acme.create.actions.createCredential') }}</GcButton>
      </div>
      <pre v-if="credentialTemplate" class="gc-acme-dns-credential__template">{{ credentialTemplate }}</pre>
    </div>
    <div v-if="creating" class="gc-acme-dns-credential__editor">
      <label class="gc-form-field">
        <span>{{ t('acme.create.fields.credentialConfig') }}</span>
        <textarea v-model="values.config" :placeholder="t('acme.create.placeholders.credentialValue')" autocomplete="off" spellcheck="false" />
      </label>
      <GcButton variant="primary" :loading="saving" @click="saveCredential">{{ t('acme.create.actions.saveCredential') }}</GcButton>
    </div>
    <p v-if="error" class="gc-acme-dns-credential__error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.gc-acme-dns-credential { display: grid; gap: var(--gc-space-3); }
.gc-acme-dns-credential__content { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: end; gap: var(--gc-space-3); }
.gc-acme-dns-credential__controls { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: var(--gc-space-3); min-width: 0; }
.gc-acme-dns-credential__controls :deep(.gc-button) { height: var(--gc-control-height-md); min-height: var(--gc-control-height-md); }
.gc-acme-dns-credential__template { box-sizing: border-box; height: var(--gc-control-height-md); max-height: var(--gc-control-height-md); overflow: auto; margin: 0; padding: var(--gc-space-2) var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-sm); background: var(--gc-color-surface-muted); color: var(--gc-color-text-muted); font-family: var(--gc-font-family); font-size: var(--gc-font-size-xs); white-space: pre-wrap; overflow-wrap: anywhere; }
.gc-acme-dns-credential__editor { display: grid; gap: var(--gc-space-3); padding: var(--gc-space-3); border-inline-start: var(--gc-border-width-strong) solid var(--gc-color-info-border); background: var(--gc-color-info-bg); }
.gc-acme-dns-credential__editor textarea { min-height: var(--gc-control-height-xl); resize: vertical; }
.gc-acme-dns-credential__error { margin: 0; color: var(--gc-color-danger); }
@media (max-width: 48rem) { .gc-acme-dns-credential__content, .gc-acme-dns-credential__controls { grid-template-columns: 1fr; } }
</style>
