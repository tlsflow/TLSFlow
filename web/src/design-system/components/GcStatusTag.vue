<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { resolveStatusMeta, type StatusTone } from '@/design-system/status/status-map'

const props = defineProps<{
  status: string
  label?: string
  tone?: StatusTone
}>()
const { t } = useI18n()
const meta = computed(() => resolveStatusMeta(props.status, t))
const label = computed(() => props.label ?? meta.value.label)
const tone = computed(() => props.tone ?? meta.value.tone)
</script>

<template>
  <span class="gc-tag" :class="`gc-tag--${tone}`">{{ label }}</span>
</template>

<style scoped>
.gc-tag { display: inline-flex; flex: 0 0 auto; align-items: center; border-radius: var(--gc-radius-full); padding: var(--gc-border-width-thick) var(--gc-space-inline-compact); font-size: var(--gc-font-size-xs); font-weight: 600; white-space: nowrap; }
.gc-tag--success { color: var(--gc-color-success); background: var(--gc-color-success-bg); }
.gc-tag--warning { color: var(--gc-color-warning); background: var(--gc-color-warning-bg); }
.gc-tag--danger { color: var(--gc-color-danger); background: var(--gc-color-danger-bg); }
.gc-tag--info { color: var(--gc-color-info); background: var(--gc-color-info-bg); }
.gc-tag--muted { color: var(--gc-color-muted); background: var(--gc-color-muted-bg); }
</style>
