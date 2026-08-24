<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{ capability: string; available?: boolean; confidence?: string }>()

const { t } = useI18n()
</script>

<template>
  <span class="gc-capability" :class="available ? 'gc-capability--ok' : 'gc-capability--missing'">
    {{ capability }} · {{ available ? t('designSystem.capability.available') : t('designSystem.capability.missing') }}<template v-if="confidence"> · {{ confidence }}</template>
  </span>
</template>

<style scoped>
.gc-capability { display: inline-flex; border-radius: 999px; padding: 3px 8px; font-size: var(--gc-font-size-xs); }
.gc-capability--ok { color: var(--gc-color-success); background: var(--gc-color-success-bg); }
.gc-capability--missing { color: var(--gc-color-danger); background: var(--gc-color-danger-bg); }
</style>
