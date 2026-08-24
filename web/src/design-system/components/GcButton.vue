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
