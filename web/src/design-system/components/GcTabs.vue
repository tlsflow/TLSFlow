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
  gap: var(--gc-space-compact);
  width: fit-content;
  padding: var(--gc-space-1);
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
  border-radius: var(--gc-radius-full);
  background: var(--gc-color-surface-hover);
}

.gc-tabs__item {
  min-height: var(--gc-control-height-sm);
  padding: 0 var(--gc-space-panel);
  border: 0;
  border-radius: var(--gc-radius-full);
  background: transparent;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 800;
  cursor: pointer;
  transition: background-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease;
}

.gc-tabs__item[data-active='true'] {
  background: var(--gc-color-surface-solid);
  color: var(--gc-color-primary);
  box-shadow: 0 var(--gc-space-1) var(--gc-space-panel) var(--gc-color-primary-weak);
}
</style>
