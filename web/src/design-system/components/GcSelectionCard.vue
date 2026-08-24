<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  /** 选择卡主标题，必须由调用方传入翻译后的文案。 */
  title: string
  /** 选择卡补充说明，必须由调用方传入翻译后的文案。 */
  description?: string
  /** 受控选择状态。 */
  modelValue?: boolean
  /** 兼容直接使用 selected 属性的调用方。 */
  selected?: boolean
  /** 禁止选择。 */
  disabled?: boolean
  /** 需要覆盖默认可见标题时传入翻译后的 ARIA 名称。 */
  ariaLabel?: string
}>(), {
  modelValue: false,
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  select: [value: boolean]
}>()

const isSelected = computed(() => Boolean(props.modelValue) || props.selected === true)

function toggle(): void {
  if (props.disabled) return
  const value = !isSelected.value
  emit('update:modelValue', value)
  emit('select', value)
}
</script>

<template>
  <button
    class="gc-card gc-selection-card"
    :class="{ 'gc-selection-card--selected': isSelected }"
    type="button"
    :disabled="disabled"
    :aria-label="ariaLabel"
    :aria-pressed="isSelected"
    @click="toggle"
  >
    <span v-if="$slots.icon" class="gc-selection-card__icon" aria-hidden="true">
      <slot name="icon" />
    </span>
    <span class="gc-selection-card__content">
      <strong>{{ title }}</strong>
      <span v-if="description" class="gc-selection-card__description">{{ description }}</span>
      <span v-if="$slots.default" class="gc-selection-card__extra"><slot /></span>
    </span>
    <span class="gc-selection-card__indicator" aria-hidden="true" />
  </button>
</template>

<style scoped>
.gc-selection-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--gc-space-3);
  width: 100%;
  min-width: 0;
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-card);
  color: var(--gc-color-text);
  background: var(--gc-color-surface-solid);
  padding: var(--gc-space-4);
  text-align: left;
  cursor: pointer;
  box-shadow: var(--gc-shadow-sm);
  transition: border-color 180ms ease, background 180ms ease, box-shadow 180ms ease;
}

.gc-selection-card:hover {
  border-color: var(--gc-color-primary-border);
  background: var(--gc-color-surface-hover);
  box-shadow: var(--gc-shadow-hover);
}

.gc-selection-card--selected {
  border-color: var(--gc-color-primary);
  background: var(--gc-color-surface-selected);
}

.gc-selection-card:disabled {
  cursor: not-allowed;
  opacity: var(--gc-opacity-disabled);
  box-shadow: none;
}

.gc-selection-card:focus-visible {
  outline: none;
  box-shadow: var(--gc-shadow-focus);
}

.gc-selection-card__icon {
  display: inline-grid;
  width: var(--gc-space-8);
  height: var(--gc-space-8);
  place-items: center;
  border-radius: var(--gc-radius-md);
  color: var(--gc-color-primary-strong);
  background: var(--gc-color-primary-soft);
}

.gc-selection-card__content {
  display: grid;
  min-width: 0;
  gap: var(--gc-space-1);
}

.gc-selection-card__description,
.gc-selection-card__extra {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: 400;
}

.gc-selection-card__indicator {
  width: var(--gc-space-4);
  height: var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-border-strong);
  border-radius: var(--gc-radius-full);
  background: var(--gc-color-surface-solid);
}

.gc-selection-card--selected .gc-selection-card__indicator {
  border-color: var(--gc-color-primary);
  box-shadow: inset 0 0 0 var(--gc-space-1) var(--gc-color-surface-solid);
  background: var(--gc-color-primary);
}

@media (prefers-reduced-motion: reduce) {
  .gc-selection-card {
    transition: none;
  }
}
</style>
