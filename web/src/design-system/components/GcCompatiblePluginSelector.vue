<script setup lang="ts">
import type { ApiRecord } from '@/api/modules/common'
import { useI18n } from 'vue-i18n'

defineProps<{
  modelValue: string
  items: ApiRecord[]
  loading?: boolean
  required?: boolean
  label: string
  selectText: string
  loadingText: string
  emptyText: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const { t, te } = useI18n()

function pluginLabel(plugin: ApiRecord): string {
  const displayName = text(plugin.displayName)
  if (displayName) return displayName
  const displayNameKey = text(plugin.displayNameKey)
  if (displayNameKey && te(displayNameKey)) return t(displayNameKey)
  return text(plugin.pluginId) || text(plugin.pluginVersionId)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
</script>

<template>
  <label class="gc-compatible-plugin-selector">
    <span class="gc-compatible-plugin-selector__label">
      {{ label }}
      <span v-if="required" class="gc-compatible-plugin-selector__required" aria-hidden="true">*</span>
    </span>
    <select class="gc-native-select" :value="modelValue" :disabled="loading" :required="required" @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)">
      <option value="">{{ loading ? loadingText : items.length ? selectText : emptyText }}</option>
      <option v-for="plugin in items" :key="String(plugin.pluginVersionId)" :value="String(plugin.pluginVersionId)">
        {{ pluginLabel(plugin) }} · {{ String(plugin.version ?? '') }} · {{ String(plugin.runtime ?? '') }}
      </option>
    </select>
  </label>
</template>

<style scoped>
.gc-compatible-plugin-selector {
  display: grid;
  gap: var(--gc-space-2);
}

.gc-compatible-plugin-selector__label {
  color: var(--gc-color-text-secondary);
  font-size: var(--gc-font-size-sm);
}

.gc-compatible-plugin-selector__required {
  color: var(--gc-color-danger);
}
</style>
