<script setup lang="ts">
defineProps<{
  content: string
  ariaLabel: string
}>()
</script>

<template>
  <span class="gc-help-tip">
    <button class="gc-help-tip__button" type="button" :aria-label="ariaLabel">
      <span aria-hidden="true">?</span>
    </button>
    <span class="gc-help-tip__popover" role="tooltip">{{ content }}</span>
  </span>
</template>

<style scoped>
.gc-help-tip {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
  vertical-align: middle;
}

.gc-help-tip__button {
  display: inline-grid;
  place-items: center;
  width: calc(var(--gc-space-4) + var(--gc-space-1));
  height: calc(var(--gc-space-4) + var(--gc-space-1));
  padding: 0;
  border: var(--gc-border-width-default) solid var(--gc-color-border-strong);
  border-radius: var(--gc-radius-full);
  color: var(--gc-color-text-muted);
  background: var(--gc-color-surface-solid);
  font: inherit;
  font-size: var(--gc-font-size-xs);
  font-weight: 900;
  line-height: 1;
  cursor: help;
  transition: border-color .18s ease, color .18s ease, background .18s ease;
}

.gc-help-tip__button:hover,
.gc-help-tip__button:focus-visible {
  border-color: var(--gc-color-primary-border-strong);
  color: var(--gc-color-primary);
  background: var(--gc-color-primary-soft);
  outline: none;
}

.gc-help-tip__popover {
  position: absolute;
  top: calc(100% + var(--gc-space-2));
  right: 0;
  z-index: var(--gc-z-tooltip);
  width: max-content;
  max-width: calc(var(--gc-size-card-min) + var(--gc-space-10));
  padding: var(--gc-space-3) var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-border-strong);
  border-radius: var(--gc-radius-md);
  color: var(--gc-color-text);
  background: var(--gc-color-surface-overlay);
  box-shadow: var(--gc-shadow-overlay);
  font-size: var(--gc-font-size-xs);
  font-weight: 650;
  line-height: var(--gc-line-height-relaxed);
  white-space: normal;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translateY(calc(var(--gc-space-1) * -1));
  transition: opacity .18s ease, transform .18s ease, visibility .18s ease;
}

.gc-help-tip:hover .gc-help-tip__popover,
.gc-help-tip:focus-within .gc-help-tip__popover {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
}
</style>
