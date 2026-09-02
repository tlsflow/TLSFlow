<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = withDefaults(defineProps<{
  content: string
  ariaLabel: string
  clickOnly?: boolean
}>(), {
  clickOnly: false,
})

const root = ref<HTMLElement | null>(null)
const open = ref(false)

function toggle(): void {
  if (props.clickOnly) open.value = !open.value
}

function closeWhenOutside(event: MouseEvent): void {
  if (props.clickOnly && root.value && !root.value.contains(event.target as Node)) open.value = false
}

onMounted(() => document.addEventListener('click', closeWhenOutside))
onBeforeUnmount(() => document.removeEventListener('click', closeWhenOutside))
</script>

<template>
  <span ref="root" class="gc-help-tip" :class="{ 'gc-help-tip--click-only': clickOnly, 'gc-help-tip--open': open }">
    <button class="gc-help-tip__button" type="button" :aria-label="ariaLabel" :aria-expanded="clickOnly ? open : undefined" @click.stop="toggle">
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
  inset-inline-start: 0;
  z-index: var(--gc-z-tooltip);
  width: min(22rem, calc(100vw - var(--gc-space-8)));
  max-width: calc(100vw - var(--gc-space-8));
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

.gc-help-tip--click-only:hover .gc-help-tip__popover,
.gc-help-tip--click-only:focus-within .gc-help-tip__popover {
  opacity: 0;
  visibility: hidden;
  transform: translateY(calc(var(--gc-space-1) * -1));
}

.gc-help-tip--click-only.gc-help-tip--open .gc-help-tip__popover {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transform: translateY(0);
}
</style>
