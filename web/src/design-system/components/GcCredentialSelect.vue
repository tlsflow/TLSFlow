<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { listCredentials, type CredentialKind, type CredentialProfileDetail, type CredentialProfileSummary } from '@/api/modules/credentials.api'
import GcButton from './GcButton.vue'
import GcCredentialCreateModal from './GcCredentialCreateModal.vue'

const model = defineModel<string>({ default: '' })
const props = withDefaults(defineProps<{
  label?: string
  hint?: string
  disabled?: boolean
  required?: boolean
  acceptedKinds?: CredentialKind[]
  acceptedScopes?: string[]
  requiredMetadata?: Record<string, string>
  refreshKey?: number
  options?: Array<{ id: string; value?: string; label?: string; kind?: string; username?: string; status?: CredentialProfileSummary['status']; metadata?: Record<string, unknown> }>
  valueKey?: 'id' | 'secretRef'
  createEnabled?: boolean
  secretTemplate?: string
}>(), {
  acceptedKinds: () => [],
  acceptedScopes: () => [],
  requiredMetadata: () => ({}),
  options: undefined,
  valueKey: 'id',
  createEnabled: true,
  secretTemplate: '',
})

const { t } = useI18n()
const loading = ref(false)
const options = ref<CredentialProfileSummary[]>(normalizeOptions(props.options ?? []))
const createOpen = ref(false)
const createKinds = computed(() => props.acceptedKinds)
const createMetadata = computed(() => Object.fromEntries(Object.entries(props.requiredMetadata)))
const filtered = computed(() => options.value.filter((item) =>
  item.status === 'active'
  && (props.acceptedKinds.length === 0 || props.acceptedKinds.includes(item.kind))
  && (props.acceptedScopes.length === 0 || props.acceptedScopes.includes(item.scopeType))
  && Object.entries(props.requiredMetadata).every(([key, value]) => item.metadata?.[key] === value)))

async function load(force = false): Promise<void> {
  loading.value = true
  try {
    if (props.options && (props.valueKey === 'secretRef' || !force)) {
      options.value = normalizeOptions(props.options)
    } else {
      const result = await listCredentials({ kinds: props.acceptedKinds })
      const fetched = result.data?.items ?? []
      options.value = fetched.length > 0 || !props.options ? fetched : normalizeOptions(props.options)
    }
  } finally {
    loading.value = false
  }
}

function normalizeOptions(items: NonNullable<typeof props.options>): CredentialProfileSummary[] {
  return items.map((item) => ({
    id: item.value ?? item.id,
    name: item.label ?? item.id,
    kind: (item.kind ?? props.acceptedKinds[0] ?? 'USERNAME_PASSWORD') as CredentialKind,
    scopeType: 'global',
    username: item.username,
    status: item.status ?? 'active',
    version: 0,
    updatedAt: '',
    metadata: item.metadata,
  }))
}

onMounted(() => {
  void load()
})

watch(() => props.refreshKey, () => {
  void load(true)
})

watch(() => props.options, () => {
  if (props.options) void load()
}, { deep: true })

defineExpose({ reload: () => load(true) })

function onSelection(value: string): void {
  if (value !== '__gcac_create_credential__') {
    model.value = value
    return
  }
  model.value = ''
  createOpen.value = true
}

function onCreated(credential: CredentialProfileDetail): void {
  const selectedValue = props.valueKey === 'secretRef' ? (credential.secretSlots?.config ?? credential.id) : credential.id
  options.value = [...options.value, { ...credential, id: selectedValue, status: credential.status ?? 'active' }]
  model.value = selectedValue
}
</script>

<template>
  <label class="gc-credential-select">
    <span>{{ label ?? t('credentials.fields.credential') }}</span>
    <div class="gc-credential-select__control">
      <select :value="model" :disabled="disabled || loading" :required="required" @change="onSelection(($event.target as HTMLSelectElement).value)">
        <option v-if="createEnabled" value="__gcac_create_credential__">{{ t('credentials.actions.create') }}</option>
        <option value="">{{ loading ? t('common.loading') : t('credentials.placeholders.select') }}</option>
        <option v-for="item in filtered" :key="item.id" :value="item.id">
          {{ item.name }}{{ item.username ? ` · ${item.username}` : '' }}
        </option>
      </select>
      <GcButton class="gc-credential-select__refresh" variant="icon" :aria-label="t('credentials.actions.refresh')" :title="t('credentials.actions.refresh')" :disabled="disabled || loading" @click="load(true)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0 1 4M20 5v6h-6" /></svg>
      </GcButton>
    </div>
    <small v-if="hint">{{ hint }}</small>
  </label>
  <GcCredentialCreateModal v-model:open="createOpen" :kinds="createKinds" :metadata="createMetadata" :secret-template="secretTemplate" @created="onCreated" />
</template>

<style scoped>
.gc-credential-select { display: flex; flex-direction: column; gap: var(--gc-space-2); }
.gc-credential-select__control { position: relative; min-width: 0; }
.gc-credential-select select { box-sizing: border-box; width: 100%; border: var(--gc-space-hairline) solid var(--gc-color-border); border-radius: var(--gc-radius-sm); padding: var(--gc-space-2) var(--gc-space-10) var(--gc-space-2) var(--gc-space-3); background: var(--gc-color-surface); color: var(--gc-color-text); }
.gc-credential-select__refresh { position: absolute; top: 50%; right: var(--gc-space-1); width: var(--gc-control-height-sm); height: var(--gc-control-height-sm); min-height: var(--gc-control-height-sm); transform: translateY(-50%); }
.gc-credential-select__refresh svg { width: var(--gc-size-icon-sm); height: var(--gc-size-icon-sm); fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.gc-credential-select small { color: var(--gc-color-text-muted); }
</style>
