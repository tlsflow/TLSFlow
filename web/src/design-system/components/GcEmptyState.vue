<script setup lang="ts">
defineProps<{ title: string; description?: string }>()
</script>

<template>
  <section class="gc-card gc-empty-state" aria-live="polite">
    <h2>{{ title }}</h2>
    <p v-if="description">{{ description }}</p>
    <slot />
  </section>
</template>

<style scoped>
.gc-empty-state {
  display: grid;
  justify-items: center;
  gap: var(--gc-space-2);
  text-align: center;
  padding: var(--gc-size-empty-state-padding) var(--gc-space-8);
  color: var(--gc-color-text-muted);
  border-radius: var(--gc-radius-lg);
  background: var(--gc-color-surface-glass);
}
h2 {
  margin: 0;
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-heading-xs);
  line-height: var(--gc-line-height-tight);
  letter-spacing: 0;
  overflow-wrap: anywhere;
}
p {
  max-width: var(--gc-size-content-readable);
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  line-height: var(--gc-line-height-relaxed);
  overflow-wrap: anywhere;
}
</style>
