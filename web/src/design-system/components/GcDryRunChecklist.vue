<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ApiRecord } from '@/api/modules/common'

const props = withDefaults(defineProps<{
  items: readonly ApiRecord[]
  title?: string
  embedded?: boolean
}>(), {
  embedded: false,
})

const { t } = useI18n()

const displayTitle = computed(() => props.title ?? t('designSystem.dryRunChecklist.title'))

function readDetail(item: ApiRecord): string {
  return formatStructuredValue(item.detail)
}

function readEvidence(item: ApiRecord): string {
  return formatStructuredValue(item.evidence)
}

function formatStructuredValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function statusKey(item: ApiRecord): 'passed' | 'failed' | 'warning' | 'unknown' {
  const status = String(item.status ?? 'unknown').toLowerCase()
  return status === 'passed' || status === 'failed' || status === 'warning' || status === 'unknown'
    ? status
    : 'unknown'
}
</script>

<template>
  <section
    class="gc-dry-run-checklist"
    :class="{ 'gc-card': !embedded, 'gc-dry-run-checklist--embedded': embedded }"
    :aria-label="t('designSystem.dryRunChecklist.ariaLabel')"
  >
    <header class="gc-dry-run-checklist__header">
      <strong>{{ displayTitle }}</strong>
    </header>

    <p v-if="items.length === 0" class="gc-dry-run-checklist__empty">{{ t('designSystem.dryRunChecklist.empty') }}</p>

    <ul v-else class="gc-dry-run-checklist__list">
      <li v-for="item in items" :key="String(item.key ?? item.label ?? item.id)" class="gc-dry-run-checklist__item">
        <div class="gc-dry-run-checklist__main">
          <strong>{{ String(item.label ?? item.key ?? t('designSystem.dryRunChecklist.unnamedCheck')) }}</strong>
          <span class="gc-dry-run-checklist__status" :class="`is-${statusKey(item)}`">
            {{ t(`designSystem.dryRunChecklist.status.${statusKey(item)}`) }}
          </span>
        </div>
        <p v-if="readDetail(item)" class="gc-dry-run-checklist__detail">{{ readDetail(item) }}</p>
        <details v-if="readEvidence(item)" class="gc-dry-run-checklist__evidence">
          <summary>{{ t('designSystem.dryRunChecklist.evidence') }}</summary>
          <pre>{{ readEvidence(item) }}</pre>
        </details>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.gc-dry-run-checklist { display: grid; gap: var(--gc-space-3); }
.gc-dry-run-checklist__header { display: flex; gap: var(--gc-space-4); align-items: center; }
.gc-dry-run-checklist__list { display: grid; gap: var(--gc-space-2); margin: 0; padding: 0; list-style: none; }
.gc-dry-run-checklist__item { border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-control); padding: var(--gc-space-3); background: var(--gc-color-surface-soft); display: grid; gap: var(--gc-space-2); }
.gc-dry-run-checklist__main { display: flex; justify-content: space-between; gap: var(--gc-space-2); align-items: center; }
.gc-dry-run-checklist__status { border-radius: var(--gc-radius-full); padding: var(--gc-border-width-thick) var(--gc-space-2); font-size: var(--gc-font-size-xs); font-weight: 700; text-transform: uppercase; }
.gc-dry-run-checklist__status.is-passed { color: var(--gc-color-success); background: var(--gc-color-success-bg); }
.gc-dry-run-checklist__status.is-failed { color: var(--gc-color-danger); background: var(--gc-color-danger-bg); }
.gc-dry-run-checklist__status.is-warning { color: var(--gc-color-warning); background: var(--gc-color-warning-bg); }
.gc-dry-run-checklist__status.is-unknown { color: var(--gc-color-text-muted); background: var(--gc-color-surface-muted); }
.gc-dry-run-checklist__detail, .gc-dry-run-checklist__empty { margin: 0; color: var(--gc-color-text-muted); }
.gc-dry-run-checklist__evidence { display: grid; gap: var(--gc-space-2); color: var(--gc-color-text-secondary); }
.gc-dry-run-checklist__evidence summary { cursor: pointer; font-size: var(--gc-font-size-xs); font-weight: var(--gc-font-weight-semibold); }
.gc-dry-run-checklist__evidence pre { margin: 0; padding: var(--gc-space-2); overflow-wrap: anywhere; white-space: pre-wrap; color: var(--gc-color-text-secondary); background: var(--gc-color-surface-field); font: inherit; font-size: var(--gc-font-size-xs); line-height: var(--gc-line-height-relaxed); }
</style>
