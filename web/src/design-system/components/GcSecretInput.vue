<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const model = defineModel<string>({ default: '' })
defineProps<{ label?: string; placeholder?: string }>()
const { t } = useI18n()
</script>

<template>
  <label class="gc-secret-input">
    <span>{{ label ?? t('designSystem.secretInput.label') }}</span>
    <input v-model="model" :placeholder="placeholder ?? t('designSystem.secretInput.placeholder')" autocomplete="off" />
    <small>{{ t('designSystem.secretInput.hint') }}</small>
  </label>
</template>

<style scoped>
.gc-secret-input { display: flex; flex-direction: column; gap: var(--gc-space-2); }
.gc-secret-input input { border: 1px solid var(--gc-color-border); border-radius: var(--gc-radius-sm); padding: 8px 10px; }
.gc-secret-input small { color: var(--gc-color-text-muted); }
</style>
