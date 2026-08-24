<script setup lang="ts">
import { computed } from 'vue'

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

const props = withDefaults(defineProps<{
  items: readonly CapabilityMatrixItem[]
  title?: string
  description?: string
}>(), {
  title: '能力兼容性',
  description: '只展示后端 capability 接口可确认的结果；未知项不会假装成功。'
})

const stateMeta = {
  satisfied: { label: '满足', tone: 'ok' },
  missing: { label: '缺失', tone: 'missing' },
  unknown: { label: '未知', tone: 'unknown' },
  manualRisk: { label: '人工确认', tone: 'manual' }
} as const

const summary = computed(() => props.items.reduce<Record<CapabilityState, number>>((acc, item) => {
  acc[item.state] += 1
  return acc
}, { satisfied: 0, missing: 0, unknown: 0, manualRisk: 0 }))
</script>

<template>
  <section class="gc-card gc-capability-matrix" aria-label="能力兼容性矩阵">
    <header class="gc-capability-matrix__header">
      <div>
        <strong>{{ title }}</strong>
        <p>{{ description }}</p>
      </div>
      <ul class="gc-capability-matrix__summary">
        <li>满足 {{ summary.satisfied }}</li>
        <li>缺失 {{ summary.missing }}</li>
        <li>未知 {{ summary.unknown }}</li>
        <li>人工确认 {{ summary.manualRisk }}</li>
      </ul>
    </header>

    <p v-if="items.length === 0" class="gc-capability-matrix__empty">暂无 capability 数据，前端保持降级展示。</p>

    <ul v-else class="gc-capability-matrix__list">
      <li v-for="item in items" :key="item.key" class="gc-capability-matrix__item">
        <div class="gc-capability-matrix__main">
          <strong>{{ item.label }}</strong>
          <span class="gc-capability-matrix__level">{{ item.level }}</span>
        </div>
        <div class="gc-capability-matrix__meta">
          <span class="gc-capability-matrix__state" :class="`gc-capability-matrix__state--${stateMeta[item.state].tone}`">
            {{ stateMeta[item.state].label }}
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
.gc-capability-matrix__item { border: 1px solid var(--gc-color-border); border-radius: var(--gc-radius-md); padding: var(--gc-space-3); display: grid; gap: var(--gc-space-2); }
.gc-capability-matrix__main, .gc-capability-matrix__meta { display: flex; flex-wrap: wrap; gap: var(--gc-space-2); align-items: center; justify-content: space-between; }
.gc-capability-matrix__level { border-radius: 999px; background: var(--gc-color-surface-muted); padding: 2px 8px; font-size: var(--gc-font-size-xs); font-weight: 700; }
.gc-capability-matrix__state { border-radius: 999px; padding: 2px 8px; font-size: var(--gc-font-size-xs); font-weight: 700; }
.gc-capability-matrix__state--ok { color: var(--gc-color-success); background: var(--gc-color-success-bg); }
.gc-capability-matrix__state--missing { color: var(--gc-color-danger); background: var(--gc-color-danger-bg); }
.gc-capability-matrix__state--unknown { color: var(--gc-color-warning); background: var(--gc-color-warning-bg); }
.gc-capability-matrix__state--manual { color: var(--gc-color-info); background: var(--gc-color-info-bg); }
.gc-capability-matrix__source, .gc-capability-matrix__detail, .gc-capability-matrix__empty { color: var(--gc-color-text-muted); }
.gc-capability-matrix__detail { margin: 0; }
</style>
