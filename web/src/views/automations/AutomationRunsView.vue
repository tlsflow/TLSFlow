<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { listAutomationRuns, type AutomationRunRecord } from '@/api/modules/automations.api'
import { GcEmptyState, GcPageHeader, GcStatusTag } from '@/design-system/components'
import { formatMaybeLocalTime } from '@/utils/browser-local-time'
import { translateDynamic } from '@/i18n/translate'

const { t, te } = useI18n()
const route = useRoute()
const router = useRouter()
const items = ref<AutomationRunRecord[]>([])
const loading = ref(false)
const error = ref('')

async function loadRuns() {
  loading.value = true
  error.value = ''
  try {
    items.value = await listAutomationRuns(typeof route.query.automationId === 'string' ? route.query.automationId : undefined)
  } catch (cause) {
    items.value = []
    error.value = cause instanceof Error ? cause.message : t('automations.errors.loadFailed')
  } finally {
    loading.value = false
  }
}

onMounted(() => { void loadRuns() })
</script>

<template>
  <section class="runs-page">
    <GcPageHeader :title="t('automations.runs.title')" :description="t('automations.runs.description')" />
    <section class="runs-workspace" :aria-label="t('automations.aria.runs')">
      <header class="runs-workspace__header">
        <div>
          <span class="runs-workspace__eyebrow">{{ t('automations.title') }}</span>
          <h2>{{ t('automations.history.summary', { count: items.length }) }}</h2>
        </div>
        <button class="gc-button" type="button" :disabled="loading" @click="loadRuns">
          {{ loading ? t('common.loading') : t('common.refresh') }}
        </button>
      </header>

      <GcEmptyState v-if="error" :title="t('automations.errors.loadFailed')" :description="error">
        <button class="gc-button" type="button" @click="loadRuns">{{ t('common.refresh') }}</button>
      </GcEmptyState>
      <div v-else-if="loading" class="runs-workspace__state" role="status" aria-live="polite">{{ t('common.loading') }}</div>
      <GcEmptyState v-else-if="items.length === 0" :title="t('automations.history.empty')" :description="t('automations.runs.description')" />
      <div v-else class="runs-table" role="table" :aria-label="t('automations.aria.runs')">
        <div class="runs-table__head" role="row">
          <span role="columnheader">{{ t('automations.fields.name') }}</span>
          <span role="columnheader">{{ t('automations.columns.trigger') }}</span>
          <span role="columnheader">{{ t('automations.columns.status') }}</span>
          <span role="columnheader">{{ t('automations.runs.progress', { succeeded: 0, total: 0 }) }}</span>
          <span role="columnheader">{{ t('automations.fields.failureStage') }}</span>
          <span role="columnheader">{{ t('automations.fields.startedAt') }}</span>
        </div>
        <button v-for="run in items" :key="run.id" class="runs-table__row" type="button" role="row" @click="router.push(`/automation-runs/${run.id}`)">
          <span class="runs-table__name" role="cell">{{ run.automationNameSnapshot }}</span>
          <span role="cell">{{ translateDynamic(t, te, 'automations.triggerTypes', run.triggerType) }}</span>
          <span role="cell"><GcStatusTag :status="run.status" /></span>
          <span role="cell">{{ t('automations.runs.progress', { succeeded: run.targetSummary.succeeded || 0, total: run.targetSummary.total || 0 }) }}</span>
          <span role="cell">{{ run.failureStage ? translateDynamic(t, te, 'automations.failureStages', run.failureStage) : t('automations.common.notAvailable') }}</span>
          <time role="cell">{{ formatMaybeLocalTime(run.createdAt, t('automations.common.notAvailable')) }}</time>
        </button>
      </div>
    </section>
  </section>
</template>

<style scoped>
.runs-page,
.runs-workspace,
.runs-table {
  display: grid;
  gap: var(--gc-space-4);
}

.runs-workspace {
  padding: var(--gc-space-5);
  border: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  border-radius: var(--gc-radius-lg);
  background: var(--gc-color-surface-glass);
  box-shadow: var(--gc-shadow-sm);
}

.runs-workspace__header,
.runs-table__head,
.runs-table__row {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr) minmax(0, .9fr) minmax(0, 1.2fr) minmax(0, 1.2fr) minmax(0, 1.2fr);
  gap: var(--gc-space-3);
  align-items: center;
}

.runs-workspace__header {
  grid-template-columns: minmax(0, 1fr) auto;
  padding-bottom: var(--gc-space-4);
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border-muted);
}

.runs-workspace__header h2,
.runs-workspace__header p {
  margin: 0;
}

.runs-workspace__header h2 {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-lg);
}

.runs-workspace__eyebrow {
  color: var(--gc-color-primary);
  font-size: var(--gc-font-size-xs);
  font-weight: 800;
  text-transform: uppercase;
}

.runs-table__head {
  padding: var(--gc-space-3) var(--gc-space-4);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-muted);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 800;
}

.runs-table__row {
  width: 100%;
  padding: var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-glass);
  color: var(--gc-color-text);
  text-align: left;
  cursor: pointer;
}

.runs-table__row:hover,
.runs-table__row:focus-visible {
  border-color: var(--gc-color-primary);
  background: var(--gc-color-surface-hover);
  box-shadow: var(--gc-shadow-hover);
}

.runs-table__row:focus-visible {
  outline: none;
  box-shadow: var(--gc-shadow-focus);
}

.runs-table__row > * {
  min-width: 0;
  overflow-wrap: anywhere;
}

.runs-table__name {
  color: var(--gc-color-text);
  font-weight: 800;
}

.runs-workspace__state {
  padding: var(--gc-space-10) var(--gc-space-4);
  color: var(--gc-color-text-muted);
  text-align: center;
}

@media (max-width: 60rem) {
  .runs-table {
    overflow-x: auto;
  }

  .runs-table__head,
  .runs-table__row {
    min-width: calc(var(--gc-space-10) * 30);
  }
}

@media (max-width: 40rem) {
  .runs-workspace {
    padding: var(--gc-space-4);
  }

  .runs-workspace__header {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
