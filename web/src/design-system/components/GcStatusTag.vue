<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { resolveStatusMeta } from '@/design-system/status/status-map'

const props = defineProps<{ status: string }>()
const { t } = useI18n()
const meta = computed(() => resolveStatusMeta(props.status, t))
</script>

<template>
  <span class="gc-tag" :class="`gc-tag--${meta.tone}`">{{ meta.label }}</span>
</template>

<style scoped>
.gc-tag { display: inline-flex; align-items: center; border-radius: 999px; padding: 2px 9px; font-size: var(--gc-font-size-xs); font-weight: 600; }
.gc-tag--success { color: var(--gc-color-success); background: var(--gc-color-success-bg); }
.gc-tag--warning { color: var(--gc-color-warning); background: var(--gc-color-warning-bg); }
.gc-tag--danger { color: var(--gc-color-danger); background: var(--gc-color-danger-bg); }
.gc-tag--info { color: var(--gc-color-info); background: var(--gc-color-info-bg); }
.gc-tag--muted { color: var(--gc-color-muted); background: var(--gc-color-muted-bg); }
</style>
