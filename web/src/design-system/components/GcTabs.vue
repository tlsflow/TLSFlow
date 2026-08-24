<script setup lang="ts">
export interface GcTabOption {
  readonly value: string
  readonly label: string
}

defineProps<{
  /** 当前选中的标签值。 */
  modelValue: string
  /** 标签项列表。 */
  tabs: readonly GcTabOption[]
  /** 辅助技术读取的标签组名称。 */
  ariaLabel?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()
</script>

<template>
  <nav class="gc-tabs" :aria-label="ariaLabel">
    <button
      v-for="tab in tabs"
      :key="tab.value"
      class="gc-tabs__item"
      type="button"
      :data-active="modelValue === tab.value"
      @click="emit('update:modelValue', tab.value)"
    >
      {{ tab.label }}
    </button>
  </nav>
</template>

<style scoped>
.gc-tabs {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
  padding: 4px;
  border: 1px solid var(--gc-color-border-muted);
  border-radius: 999px;
  background: var(--gc-color-surface-hover);
}

.gc-tabs__item {
  min-height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--gc-color-text-muted);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
  transition: background-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease;
}

.gc-tabs__item[data-active='true'] {
  background: var(--gc-color-surface-solid);
  color: var(--gc-color-text);
  box-shadow: 0 4px 14px var(--gc-color-border);
}
</style>
