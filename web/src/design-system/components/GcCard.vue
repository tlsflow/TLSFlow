<script setup lang="ts">
withDefaults(defineProps<{
  /** 语义化根元素。 */
  as?: 'article' | 'section' | 'div'
  /** 交互态卡片使用悬停样式。 */
  interactive?: boolean
  /** 选中态卡片使用主题选中表面。 */
  selected?: boolean
  /** 由调用方传入的翻译后区域名称。 */
  ariaLabel?: string
}>(), {
  as: 'section',
  interactive: false,
  selected: false,
})
</script>

<template>
  <component
    :is="as"
    class="gc-card gc-pro-card"
    :class="{
      'gc-pro-card--interactive': interactive,
      'gc-pro-card--selected': selected,
    }"
    :aria-label="ariaLabel"
  >
    <header v-if="$slots.header" class="gc-pro-card__header">
      <slot name="header" />
    </header>
    <div class="gc-pro-card__body">
      <slot name="body"><slot /></slot>
    </div>
    <footer v-if="$slots.footer" class="gc-pro-card__footer">
      <slot name="footer" />
    </footer>
  </component>
</template>

<style scoped>
.gc-pro-card {
  display: grid;
  gap: var(--gc-space-4);
  min-width: 0;
  padding: var(--gc-space-4);
}

.gc-pro-card__header,
.gc-pro-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-3);
  min-width: 0;
}

.gc-pro-card__body { min-width: 0; }

.gc-pro-card__header {
  padding-bottom: var(--gc-space-3);
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border);
}

.gc-pro-card__footer {
  padding-top: var(--gc-space-3);
  border-top: var(--gc-border-width-default) solid var(--gc-color-border);
}

.gc-pro-card--interactive {
  cursor: pointer;
  transition: border-color 180ms ease, background 180ms ease, box-shadow 180ms ease;
}

.gc-pro-card--interactive:hover {
  border-color: var(--gc-color-primary-border);
  background: var(--gc-color-surface-hover);
  box-shadow: var(--gc-shadow-hover);
}

.gc-pro-card--selected {
  border-color: var(--gc-color-primary);
  background: var(--gc-color-surface-selected);
}

@media (prefers-reduced-motion: reduce) {
  .gc-pro-card--interactive {
    transition: none;
  }
}
</style>
