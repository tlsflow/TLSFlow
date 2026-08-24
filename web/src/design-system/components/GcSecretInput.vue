<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const model = defineModel<string>({ default: '' })
defineProps<{ label?: string; placeholder?: string; hint?: string }>()
const { t } = useI18n()
</script>

<template>
  <label class="gc-secret-input">
    <span>{{ label ?? t('designSystem.secretInput.label') }}</span>
    <input v-model="model" type="password" :placeholder="placeholder ?? t('designSystem.secretInput.placeholder')" autocomplete="new-password" />
    <small>{{ hint ?? t('designSystem.secretInput.hint') }}</small>
  </label>
</template>

<style scoped>
.gc-secret-input { display: flex; flex-direction: column; gap: var(--gc-space-2); }
.gc-secret-input input { border: var(--gc-space-hairline) solid var(--gc-color-border); border-radius: var(--gc-radius-sm); padding: var(--gc-space-2) var(--gc-space-3); }
.gc-secret-input small { color: var(--gc-color-text-muted); }
</style>
