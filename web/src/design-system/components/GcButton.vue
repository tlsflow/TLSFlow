<script setup lang="ts">
import { computed } from 'vue'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'icon'

const props = withDefaults(defineProps<{
  /** 按钮的语义变体。 */
  variant?: ButtonVariant
  /** 原生按钮类型。 */
  type?: 'button' | 'submit' | 'reset'
  /** 禁止交互。 */
  disabled?: boolean
  /** 提交或异步动作进行中；忙碌态同时禁止交互。 */
  loading?: boolean
  /** 仅在图标无法由可见内容说明时传入翻译后的无障碍名称。 */
  ariaLabel?: string
  /** 原生 title，必须由调用方传入已翻译文案。 */
  title?: string
}>(), {
  variant: 'secondary',
  type: 'button',
  disabled: false,
  loading: false,
})

const classes = computed(() => [
  'gc-button',
  props.variant === 'icon' ? 'gc-icon-button' : '',
  `gc-button--${props.variant}`,
  props.loading ? 'gc-button--loading' : '',
].filter(Boolean))
</script>

<template>
  <button
    :type="type"
    :class="classes"
    :disabled="disabled || loading"
    :aria-label="ariaLabel"
    :aria-busy="loading || undefined"
    :title="title"
  >
    <span class="gc-button__content"><slot /></span>
  </button>
</template>

<style scoped>
.gc-button {
  min-height: var(--gc-control-height-sm);
  border-color: var(--gc-color-border);
  border-radius: var(--gc-radius-sm);
  color: var(--gc-color-text);
  background: var(--gc-color-surface-panel);
  padding: var(--gc-space-2) var(--gc-space-3);
}

.gc-button--primary {
  border-color: var(--gc-color-primary);
  color: var(--gc-color-text-inverse);
  background: var(--gc-color-primary);
  box-shadow: var(--gc-shadow-primary);
}

.gc-button--primary:hover {
  background: var(--gc-color-primary-hover);
}

.gc-button--secondary:hover {
  border-color: var(--gc-color-primary-border);
  background: var(--gc-color-surface-hover);
  box-shadow: var(--gc-shadow-hover);
}

.gc-button--ghost {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
}

.gc-button--ghost:hover {
  border-color: var(--gc-color-border-subtle);
  background: var(--gc-color-surface-hover);
  box-shadow: none;
}

.gc-button--icon {
  width: var(--gc-control-height-sm);
  min-width: var(--gc-control-height-sm);
  padding: 0;
}

.gc-button--loading .gc-button__content {
  opacity: var(--gc-opacity-disabled);
}

.gc-button__content {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--gc-space-2);
}

.gc-button:focus-visible {
  outline: none;
  box-shadow: var(--gc-shadow-focus);
}
</style>
