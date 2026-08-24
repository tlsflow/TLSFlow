<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { listSecrets } from '@/api/modules/security.api'
import type { ApiRecord } from '@/api/modules/common'

const model = defineModel<string>({ default: '' })
const props = withDefaults(defineProps<{ label?: string; disabled?: boolean; required?: boolean; acceptedTypes?: string[] }>(), {
  acceptedTypes: () => [],
})
const { t } = useI18n()
const loading = ref(false)
const items = ref<ApiRecord[]>([])
const options = computed(() => items.value.filter((item) =>
  item.status !== 'deleted'
  && (props.acceptedTypes.length === 0 || props.acceptedTypes.includes(String(item.type ?? '')))))

onMounted(async () => {
  loading.value = true
  try {
    const result = await listSecrets({ page: 1, pageSize: 200 })
    items.value = [...(result.data?.items ?? [])]
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <label class="gc-secret-ref-select">
    <span>{{ label ?? t('credentials.fields.secretRef') }}</span>
    <select v-model="model" :disabled="disabled || loading" :required="required">
      <option value="">{{ loading ? t('common.loading') : t('credentials.placeholders.selectSecret') }}</option>
      <option v-for="item in options" :key="String(item.id)" :value="String(item.secretRef ?? '')">{{ item.name ?? item.id }}</option>
    </select>
  </label>
</template>

<style scoped>
.gc-secret-ref-select { display: flex; flex-direction: column; gap: var(--gc-space-2); }
.gc-secret-ref-select select { border: var(--gc-space-hairline) solid var(--gc-color-border); border-radius: var(--gc-radius-sm); padding: var(--gc-space-2) var(--gc-space-3); background: var(--gc-color-surface); color: var(--gc-color-text); }
</style>
