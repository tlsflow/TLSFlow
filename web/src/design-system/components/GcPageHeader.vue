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
.gc-page-header { display: flex; justify-content: space-between; gap: var(--gc-space-4); align-items: flex-start; }
h1 { margin: 0; font-size: 24px; }
p { margin: var(--gc-space-2) 0 0; color: var(--gc-color-text-muted); }
.gc-page-header__actions { display: flex; gap: var(--gc-space-2); }
</style>
