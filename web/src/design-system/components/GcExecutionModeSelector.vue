<script setup lang="ts">
import type { StatusTone } from '@/design-system/status/status-map'

export type ExecutionModeOption = {
  value: string
  label: string
  description: string
  tone?: StatusTone
  disabled?: boolean
}

defineProps<{
  modelValue: string
  label: string
  options: readonly ExecutionModeOption[]
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <fieldset class="gc-execution-mode-selector">
    <legend>{{ label }}</legend>
    <label
      v-for="option in options"
      :key="option.value"
      class="gc-execution-mode-selector__option"
      :data-selected="modelValue === option.value ? 'true' : 'false'"
      :data-tone="option.tone ?? 'muted'"
    >
      <input
        type="radio"
        :value="option.value"
        :checked="modelValue === option.value"
        :disabled="option.disabled"
        @change="emit('update:modelValue', option.value)"
      />
      <span>
        <strong>{{ option.label }}</strong>
        <small>{{ option.description }}</small>
      </span>
    </label>
  </fieldset>
</template>

<style scoped>
.gc-execution-mode-selector {
  display: grid;
  gap: var(--gc-space-3);
  margin: 0;
  padding: 0;
  border: 0;
}

.gc-execution-mode-selector legend {
  margin-bottom: var(--gc-space-2);
  color: var(--gc-color-text-secondary);
  font-size: var(--gc-font-size-sm);
}

.gc-execution-mode-selector__option {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--gc-space-3);
  align-items: start;
  padding: var(--gc-space-3);
  border: var(--gc-border-width) solid var(--gc-color-border);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-subtle);
  cursor: pointer;
}

.gc-execution-mode-selector__option[data-selected='true'][data-tone='info'] {
  border-color: var(--gc-color-info-border);
  background: var(--gc-color-info-soft);
}

.gc-execution-mode-selector__option[data-selected='true'][data-tone='warning'] {
  border-color: var(--gc-color-warning-border);
  background: var(--gc-color-warning-soft);
}

.gc-execution-mode-selector__option span {
  display: grid;
  gap: var(--gc-space-1);
}

.gc-execution-mode-selector__option small {
  color: var(--gc-color-text-muted);
}
</style>
