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
  color: #05070d;
  font-size: clamp(26px, 2.5vw, 34px);
  line-height: 1.1;
  letter-spacing: -0.045em;
}
p {
  max-width: min(100%, 960px);
  margin: var(--gc-space-2) 0 0;
  color: var(--gc-color-text-muted);
  font-size: 14px;
  font-weight: 520;
  line-height: 1.6;
}
.gc-page-header__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--gc-space-2); padding-top: var(--gc-space-1); }
.gc-page-header__actions :slotted(.gc-button) {
  min-height: 36px;
  padding-inline: 14px;
  color: #fff;
  background: var(--gc-color-primary);
  border-color: var(--gc-color-primary);
  box-shadow: 0 8px 20px rgb(37 99 235 / 18%);
}
.gc-page-header__actions :slotted(.gc-button:hover) { background: var(--gc-color-primary-hover); }

@media (max-width: 640px) {
  .gc-page-header__actions {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
