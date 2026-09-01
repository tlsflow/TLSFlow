<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiClientError } from '@/api/client'
import { listCredentials, type CredentialProfileDetail, type CredentialProfileSummary } from '@/api/modules/credentials.api'
import GcButton from './GcButton.vue'
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
  if (value !== '__gcac_create_credential__') {
    model.value = value
    return
  }
  model.value = ''
  createOpen.value = true
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
              <option value="__gcac_create_credential__">{{ t('credentials.actions.create') }}</option>
              <option value="">{{ loading ? t('common.loading') : t('acme.create.placeholders.dnsCredential') }}</option>
              <option v-for="item in filtered" :key="item.id" :value="item.id">{{ item.name }}</option>
            </select>
            <GcButton class="gc-acme-dns-credential__refresh" variant="icon" :aria-label="t('credentials.actions.refresh')" :title="t('credentials.actions.refresh')" :disabled="disabled || loading || !providerId" @click="load">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0 1 4M20 5v6h-6" /></svg>
            </GcButton>
          </div>
        </label>
      </div>
      <pre v-if="credentialTemplate" class="gc-acme-dns-credential__template">{{ credentialTemplate }}</pre>
    </div>
    <GcCredentialCreateModal v-model:open="createOpen" :kinds="['DNS_PROVIDER']" :metadata="{ credentialType: 'acme-dns', providerId, providerName, format: 'lego-env' }" :name-prefix="`${providerName} DNS`" @created="onCreated" />
    <p v-if="error" class="gc-acme-dns-credential__error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.gc-acme-dns-credential { display: grid; gap: var(--gc-space-3); }
.gc-acme-dns-credential__content { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: end; gap: var(--gc-space-3); }
.gc-acme-dns-credential__controls { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: var(--gc-space-3); min-width: 0; }
.gc-acme-dns-credential__controls :deep(.gc-button) { height: var(--gc-control-height-md); min-height: var(--gc-control-height-md); }
.gc-acme-dns-credential__select-wrap { position: relative; min-width: 0; }
.gc-acme-dns-credential__select-wrap select { box-sizing: border-box; width: 100%; padding-right: var(--gc-space-10); }
.gc-acme-dns-credential__refresh { position: absolute; top: 50%; right: var(--gc-space-1); width: var(--gc-control-height-sm); height: var(--gc-control-height-sm); min-height: var(--gc-control-height-sm); transform: translateY(-50%); }
.gc-acme-dns-credential__refresh svg { width: var(--gc-size-icon-sm); height: var(--gc-size-icon-sm); fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.gc-acme-dns-credential__template { box-sizing: border-box; height: var(--gc-control-height-md); max-height: var(--gc-control-height-md); overflow: auto; margin: 0; padding: var(--gc-space-2) var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-sm); background: var(--gc-color-surface-muted); color: var(--gc-color-text-muted); font-family: var(--gc-font-family); font-size: var(--gc-font-size-xs); white-space: pre-wrap; overflow-wrap: anywhere; }
.gc-acme-dns-credential__error { margin: 0; color: var(--gc-color-danger); }
@media (max-width: 48rem) { .gc-acme-dns-credential__content, .gc-acme-dns-credential__controls { grid-template-columns: 1fr; } }
</style>
