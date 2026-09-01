<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiClientError } from '@/api/client'
import { listCredentials, type CredentialProfileDetail, type CredentialProfileSummary } from '@/api/modules/credentials.api'
import GcCredentialCreateModal from './GcCredentialCreateModal.vue'

const model = defineModel<string>({ default: '' })
const props = withDefaults(defineProps<{
  providerId: string
  providerName: string
  credentialTemplate: string
  disabled?: boolean
  required?: boolean
}>(), { disabled: false, required: false })

const { t } = useI18n()
const CREATE_OPTION = '__gcac_create_credential__'
const REFRESH_OPTION = '__gcac_refresh_credentials__'
const loading = ref(false)
const createOpen = ref(false)
const error = ref('')
const options = ref<CredentialProfileSummary[]>([])
const filtered = computed(() => options.value.filter((item) => (
  item.status === 'active'
  && item.kind === 'DNS_PROVIDER'
  && readMetadata(item.metadata, 'providerId') === props.providerId
)))

watch(() => props.providerId, () => {
  createOpen.value = false
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

function readMetadata(metadata: Record<string, unknown> | undefined, key: string): string {
  return metadata && typeof metadata[key] === 'string' ? metadata[key] : ''
}

function onSelection(value: string): void {
  if (value === CREATE_OPTION) {
    model.value = ''
    createOpen.value = true
    return
  }
  if (value === REFRESH_OPTION) {
    void load()
    return
  }
  model.value = value
}

function onCreated(credential: CredentialProfileDetail): void {
  options.value = [...options.value, { ...credential, status: credential.status ?? 'active' }]
  model.value = credential.id
}
</script>

<template>
  <section class="gc-acme-dns-credential">
    <div class="gc-acme-dns-credential__content">
      <div class="gc-acme-dns-credential__controls">
        <label class="gc-form-field">
          <span>{{ t('acme.create.fields.dnsCredential') }}</span>
          <div class="gc-acme-dns-credential__select-wrap">
            <select :value="model" :disabled="disabled || loading || createOpen" :required="required" @change="onSelection(($event.target as HTMLSelectElement).value)">
              <option :value="CREATE_OPTION">{{ t('credentials.actions.create') }}</option>
              <option :value="REFRESH_OPTION">{{ t('credentials.actions.refresh') }}</option>
              <option value="">{{ loading ? t('common.loading') : t('acme.create.placeholders.dnsCredential') }}</option>
              <option v-for="item in filtered" :key="item.id" :value="item.id">{{ item.name }}</option>
            </select>
          </div>
        </label>
      </div>
      <pre v-if="credentialTemplate" class="gc-acme-dns-credential__template">{{ credentialTemplate }}</pre>
    </div>
    <GcCredentialCreateModal v-model:open="createOpen" :kinds="['DNS_PROVIDER']" :metadata="{ credentialType: 'acme-dns', providerId, providerName, format: 'lego-env' }" :name-prefix="`${providerName} DNS`" :secret-template="credentialTemplate" @created="onCreated" />
    <p v-if="error" class="gc-acme-dns-credential__error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.gc-acme-dns-credential { display: grid; gap: var(--gc-space-3); }
.gc-acme-dns-credential__content { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: end; gap: var(--gc-space-3); }
.gc-acme-dns-credential__controls { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: var(--gc-space-3); min-width: 0; }
.gc-acme-dns-credential__controls :deep(.gc-button) { height: var(--gc-control-height-md); min-height: var(--gc-control-height-md); }
.gc-acme-dns-credential__select-wrap { position: relative; min-width: 0; }
.gc-acme-dns-credential__select-wrap select { box-sizing: border-box; width: 100%; }
.gc-acme-dns-credential__template { box-sizing: border-box; height: var(--gc-control-height-md); max-height: var(--gc-control-height-md); overflow: auto; margin: 0; padding: var(--gc-space-2) var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-sm); background: var(--gc-color-surface-muted); color: var(--gc-color-text-muted); font-family: var(--gc-font-family); font-size: var(--gc-font-size-xs); white-space: pre-wrap; overflow-wrap: anywhere; }
.gc-acme-dns-credential__error { margin: 0; color: var(--gc-color-danger); }
@media (max-width: 48rem) { .gc-acme-dns-credential__content, .gc-acme-dns-credential__controls { grid-template-columns: 1fr; } }
</style>
