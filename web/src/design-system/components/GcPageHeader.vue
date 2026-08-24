<script setup lang="ts">
defineProps<{
  title: string
  description?: string
}>()
</script>

<template>
  <header class="gc-page-header">
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
  min-width: 0;
}
h1 {
  margin: 0;
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-heading-md);
  line-height: var(--gc-line-height-tight);
  letter-spacing: 0;
  overflow-wrap: anywhere;
}
p {
  max-width: min(100%, var(--gc-size-content-readable));
  margin: var(--gc-space-2) 0 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-label);
  font-weight: 520;
  line-height: var(--gc-line-height-relaxed);
  overflow-wrap: anywhere;
}
.gc-page-header__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--gc-space-2); min-width: 0; padding-top: var(--gc-space-1); }

@media (max-width: 40rem) {
  .gc-page-header__actions {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
