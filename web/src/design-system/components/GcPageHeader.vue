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
  gap: var(--gc-space-6);
  align-items: flex-start;
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
}
h1 {
  margin: 0;
  color: #05070d;
  font-size: clamp(32px, 3.2vw, 46px);
  line-height: 1.08;
  letter-spacing: -0.055em;
}
p {
  max-width: 860px;
  margin: var(--gc-space-3) 0 0;
  color: var(--gc-color-text-muted);
  font-size: 18px;
  font-weight: 650;
}
.gc-page-header__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--gc-space-2); padding-top: var(--gc-space-3); }
.gc-page-header__actions :slotted(.gc-button) {
  min-height: 44px;
  padding-inline: 18px;
  color: #fff;
  background: var(--gc-color-primary);
  border-color: var(--gc-color-primary);
  box-shadow: 0 12px 24px rgb(37 99 235 / 24%);
}
.gc-page-header__actions :slotted(.gc-button:hover) { background: var(--gc-color-primary-hover); }
</style>
