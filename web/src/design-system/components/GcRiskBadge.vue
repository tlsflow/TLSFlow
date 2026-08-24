<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { resolveRiskMeta, type RiskCode } from '@/design-system/status/risk-map'

const props = defineProps<{ risk: RiskCode }>()
const { t } = useI18n()
const meta = computed(() => resolveRiskMeta(props.risk, t))
</script>

<template>
  <span class="gc-risk" :class="`gc-risk--${meta.tone}`" :title="meta.description">
    {{ t('designSystem.riskBadge.levelPrefix') }}{{ meta.label }}
  </span>
</template>

<style scoped>
.gc-risk { display: inline-flex; align-items: center; border-radius: var(--gc-radius-sm); padding: var(--gc-space-badge-block) var(--gc-space-2); font-size: var(--gc-font-size-xs); font-weight: 700; }
.gc-risk--success { color: var(--gc-color-success); background: var(--gc-color-success-bg); }
.gc-risk--warning { color: var(--gc-color-warning); background: var(--gc-color-warning-bg); }
.gc-risk--danger { color: var(--gc-color-danger); background: var(--gc-color-danger-bg); }
.gc-risk--info { color: var(--gc-color-info); background: var(--gc-color-info-bg); }
.gc-risk--muted { color: var(--gc-color-muted); background: var(--gc-color-muted-bg); }
</style>
