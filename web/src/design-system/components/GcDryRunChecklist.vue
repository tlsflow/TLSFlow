<script setup lang="ts">
import { computed } from 'vue'
import type { ApiRecord } from '@/api/modules/common'

type DryRunStatus = 'passed' | 'failed' | 'warning' | 'unknown'

const props = withDefaults(defineProps<{
  items: readonly ApiRecord[]
  title?: string
  description?: string
}>(), {
  title: 'Dry-run 预检结论',
  description: '这里只展示真实只读预检结果，不复用模糊 capability 文案。',
})

const summary = computed(() => props.items.reduce<Record<DryRunStatus, number>>((acc, item) => {
  const status = normalizeStatus(String(item.status ?? 'unknown'))
  acc[status] += 1
  return acc
}, { passed: 0, failed: 0, warning: 0, unknown: 0 }))

function normalizeStatus(value: string): DryRunStatus {
  if (value === 'passed') return 'passed'
  if (value === 'failed') return 'failed'
  if (value === 'warning') return 'warning'
  return 'unknown'
}

function readDetail(item: ApiRecord): string {
  const detail = item.detail
  if (typeof detail === 'string') return detail
  if (detail && typeof detail === 'object') return JSON.stringify(detail)
  return ''
}
</script>

<template>
  <section class="gc-card gc-dry-run-checklist" aria-label="dry-run 预检结论">
    <header class="gc-dry-run-checklist__header">
      <div>
        <strong>{{ title }}</strong>
        <p>{{ description }}</p>
      </div>
      <ul class="gc-dry-run-checklist__summary">
        <li>通过 {{ summary.passed }}</li>
        <li>失败 {{ summary.failed }}</li>
        <li>警告 {{ summary.warning }}</li>
        <li>未知 {{ summary.unknown }}</li>
      </ul>
    </header>

    <p v-if="items.length === 0" class="gc-dry-run-checklist__empty">尚未生成 dry-run 预检结果。</p>

    <ul v-else class="gc-dry-run-checklist__list">
      <li v-for="item in items" :key="String(item.key ?? item.label ?? item.id)" class="gc-dry-run-checklist__item">
        <div class="gc-dry-run-checklist__main">
          <strong>{{ String(item.label ?? item.key ?? '未命名检查项') }}</strong>
          <span class="gc-dry-run-checklist__status" :class="`is-${String(item.status ?? 'unknown')}`">
            {{ String(item.status ?? 'unknown') }}
          </span>
        </div>
        <p v-if="readDetail(item)" class="gc-dry-run-checklist__detail">{{ readDetail(item) }}</p>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.gc-dry-run-checklist { display: grid; gap: var(--gc-space-3); }
.gc-dry-run-checklist__header { display: flex; justify-content: space-between; gap: var(--gc-space-4); align-items: flex-start; }
.gc-dry-run-checklist__header p { margin: var(--gc-space-1) 0 0; color: var(--gc-color-text-muted); }
.gc-dry-run-checklist__summary { display: flex; flex-wrap: wrap; gap: var(--gc-space-2); margin: 0; padding: 0; list-style: none; color: var(--gc-color-text-muted); }
.gc-dry-run-checklist__list { display: grid; gap: var(--gc-space-2); margin: 0; padding: 0; list-style: none; }
.gc-dry-run-checklist__item { border: 1px solid var(--gc-color-border); border-radius: 8px; padding: 12px; background: var(--gc-color-surface-soft); display: grid; gap: var(--gc-space-2); }
.gc-dry-run-checklist__main { display: flex; justify-content: space-between; gap: var(--gc-space-2); align-items: center; }
.gc-dry-run-checklist__status { border-radius: 999px; padding: 2px 8px; font-size: var(--gc-font-size-xs); font-weight: 700; text-transform: uppercase; }
.gc-dry-run-checklist__status.is-passed { color: var(--gc-color-success); background: var(--gc-color-success-bg); }
.gc-dry-run-checklist__status.is-failed { color: var(--gc-color-danger); background: var(--gc-color-danger-bg); }
.gc-dry-run-checklist__status.is-warning { color: var(--gc-color-warning); background: var(--gc-color-warning-bg); }
.gc-dry-run-checklist__status.is-unknown { color: var(--gc-color-text-muted); background: var(--gc-color-surface-muted); }
.gc-dry-run-checklist__detail, .gc-dry-run-checklist__empty { margin: 0; color: var(--gc-color-text-muted); }
</style>
