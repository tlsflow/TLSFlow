<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { listCredentials, type CredentialKind, type CredentialProfileSummary } from '@/api/modules/credentials.api'

const model = defineModel<string>({ default: '' })
const props = withDefaults(defineProps<{
  label?: string
  hint?: string
  disabled?: boolean
  required?: boolean
  acceptedKinds?: CredentialKind[]
  acceptedScopes?: string[]
}>(), {
  acceptedKinds: () => [],
  acceptedScopes: () => [],
})

const { t } = useI18n()
const loading = ref(false)
const options = ref<CredentialProfileSummary[]>([])
const filtered = computed(() => options.value.filter((item) =>
  item.status === 'active'
  && (props.acceptedKinds.length === 0 || props.acceptedKinds.includes(item.kind))
  && (props.acceptedScopes.length === 0 || props.acceptedScopes.includes(item.scopeType))))

onMounted(async () => {
  loading.value = true
  try {
    const result = await listCredentials({ kinds: props.acceptedKinds })
    options.value = result.data?.items ?? []
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <label class="gc-credential-select">
    <span>{{ label ?? t('credentials.fields.credential') }}</span>
    <select v-model="model" :disabled="disabled || loading" :required="required">
      <option value="">{{ loading ? t('common.loading') : t('credentials.placeholders.select') }}</option>
      <option v-for="item in filtered" :key="item.id" :value="item.id">
        {{ item.name }}{{ item.username ? ` · ${item.username}` : '' }}
      </option>
    </select>
    <small v-if="hint">{{ hint }}</small>
  </label>
</template>

<style scoped>
.gc-credential-select { display: flex; flex-direction: column; gap: var(--gc-space-2); }
.gc-credential-select select { border: var(--gc-space-hairline) solid var(--gc-color-border); border-radius: var(--gc-radius-sm); padding: var(--gc-space-2) var(--gc-space-3); background: var(--gc-color-surface); color: var(--gc-color-text); }
.gc-credential-select small { color: var(--gc-color-text-muted); }
</style>
