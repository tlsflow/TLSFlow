<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

export type CapabilityState = 'satisfied' | 'missing' | 'unknown' | 'manualRisk'
export type CapabilityLevel = 'L1' | 'L2' | 'L3' | 'L4' | 'L5'

export interface CapabilityMatrixItem {
  readonly key: string
  readonly label: string
  readonly state: CapabilityState
  readonly level: CapabilityLevel
  readonly source?: string
  readonly detail?: string
}

const props = defineProps<{
  items: readonly CapabilityMatrixItem[]
  title?: string
  description?: string
}>()

const { t } = useI18n()

const displayTitle = computed(() => props.title ?? t('designSystem.capability.title'))
const displayDescription = computed(() => props.description ?? t('designSystem.capability.description'))

const stateMeta = {
  satisfied: { labelKey: 'designSystem.capability.satisfied', tone: 'ok' },
  missing: { labelKey: 'designSystem.capability.missing', tone: 'missing' },
  unknown: { labelKey: 'designSystem.capability.unknown', tone: 'unknown' },
  manualRisk: { labelKey: 'designSystem.capability.manualRisk', tone: 'manual' }
} as const

const summary = computed(() => props.items.reduce<Record<CapabilityState, number>>((acc, item) => {
  acc[item.state] += 1
  return acc
}, { satisfied: 0, missing: 0, unknown: 0, manualRisk: 0 }))
</script>

<template>
  <section class="gc-card gc-capability-matrix" :aria-label="t('designSystem.capability.matrixLabel')">
    <header class="gc-capability-matrix__header">
      <div>
        <strong>{{ displayTitle }}</strong>
        <p>{{ displayDescription }}</p>
      </div>
      <ul class="gc-capability-matrix__summary">
        <li>{{ t('designSystem.capability.satisfied') }} {{ summary.satisfied }}</li>
        <li>{{ t('designSystem.capability.missing') }} {{ summary.missing }}</li>
        <li>{{ t('designSystem.capability.unknown') }} {{ summary.unknown }}</li>
        <li>{{ t('designSystem.capability.manualRisk') }} {{ summary.manualRisk }}</li>
      </ul>
    </header>

    <p v-if="items.length === 0" class="gc-capability-matrix__empty">{{ t('designSystem.capability.empty') }}</p>

    <ul v-else class="gc-capability-matrix__list">
      <li v-for="item in items" :key="item.key" class="gc-capability-matrix__item">
        <div class="gc-capability-matrix__main">
          <strong>{{ item.label }}</strong>
          <span class="gc-capability-matrix__level">{{ item.level }}</span>
        </div>
        <div class="gc-capability-matrix__meta">
          <span class="gc-capability-matrix__state" :class="`gc-capability-matrix__state--${stateMeta[item.state].tone}`">
            {{ t(stateMeta[item.state].labelKey) }}
          </span>
          <span v-if="item.source" class="gc-capability-matrix__source">{{ item.source }}</span>
        </div>
        <p v-if="item.detail" class="gc-capability-matrix__detail">{{ item.detail }}</p>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.gc-capability-matrix { display: grid; gap: var(--gc-space-3); }
.gc-capability-matrix__header { display: flex; justify-content: space-between; gap: var(--gc-space-4); align-items: flex-start; }
.gc-capability-matrix__header p { margin: var(--gc-space-1) 0 0; color: var(--gc-color-text-muted); }
.gc-capability-matrix__summary { display: flex; flex-wrap: wrap; gap: var(--gc-space-2); margin: 0; padding: 0; list-style: none; color: var(--gc-color-text-muted); }
.gc-capability-matrix__list { display: grid; gap: var(--gc-space-3); margin: 0; padding: 0; list-style: none; }
.gc-capability-matrix__item { border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); padding: var(--gc-space-3); display: grid; gap: var(--gc-space-2); }
.gc-capability-matrix__main, .gc-capability-matrix__meta { display: flex; flex-wrap: wrap; gap: var(--gc-space-2); align-items: center; justify-content: space-between; }
.gc-capability-matrix__level { border-radius: var(--gc-radius-full); background: var(--gc-color-surface-muted); padding: var(--gc-border-width-thick) var(--gc-space-2); font-size: var(--gc-font-size-xs); font-weight: 700; }
.gc-capability-matrix__state { border-radius: var(--gc-radius-full); padding: var(--gc-border-width-thick) var(--gc-space-2); font-size: var(--gc-font-size-xs); font-weight: 700; }
.gc-capability-matrix__state--ok { color: var(--gc-color-success); background: var(--gc-color-success-bg); }
.gc-capability-matrix__state--missing { color: var(--gc-color-danger); background: var(--gc-color-danger-bg); }
.gc-capability-matrix__state--unknown { color: var(--gc-color-warning); background: var(--gc-color-warning-bg); }
.gc-capability-matrix__state--manual { color: var(--gc-color-info); background: var(--gc-color-info-bg); }
.gc-capability-matrix__source, .gc-capability-matrix__detail, .gc-capability-matrix__empty { color: var(--gc-color-text-muted); }
.gc-capability-matrix__detail { margin: 0; }
</style>
