<script setup lang="ts">
defineProps<{
  title: string
  description?: string
}>()
</script>

<template>
  <header class="gc-card gc-page-header">
    <div>
      <h1>{{ title }}</h1>
      <p v-if="description">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="gc-page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.gc-page-header {
  display: flex;
  justify-content: space-between;
  gap: var(--gc-space-4);
  flex-wrap: wrap;
  align-items: flex-start;
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
}
h1 {
  margin: 0;
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-heading-md);
  line-height: 1.1;
  letter-spacing: 0;
}
p {
  max-width: min(100%, var(--gc-size-content-readable));
  margin: var(--gc-space-2) 0 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-label);
  font-weight: 520;
  line-height: 1.6;
}
.gc-page-header__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--gc-space-2); padding-top: var(--gc-space-1); }
.gc-page-header__actions :slotted(.gc-button) {
  min-height: var(--gc-size-icon-button);
  padding-inline: var(--gc-space-panel);
  color: var(--gc-color-surface-solid);
  background: var(--gc-color-primary);
  border-color: var(--gc-color-primary);
  box-shadow: 0 var(--gc-space-2) var(--gc-space-section) var(--gc-color-primary-weak);
}
.gc-page-header__actions :slotted(.gc-button:hover) { background: var(--gc-color-primary-hover); }

@media (max-width: 40rem) {
  .gc-page-header__actions {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
