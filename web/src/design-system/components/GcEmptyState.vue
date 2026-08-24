<script setup lang="ts">
defineProps<{ title: string; description?: string }>()
</script>

<template>
  <section class="gc-card gc-empty-state">
    <h2>{{ title }}</h2>
    <p v-if="description">{{ description }}</p>
    <slot />
  </section>
</template>

<style scoped>
.gc-empty-state { text-align: center; padding: var(--gc-space-8); color: var(--gc-color-text-muted); }
h2 { color: var(--gc-color-text); margin-top: 0; }
</style>
