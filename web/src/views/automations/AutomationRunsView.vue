<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { listAutomationRuns, type AutomationRunRecord } from '@/api/modules/automations.api'
import { GcPageHeader, GcStatusTag } from '@/design-system/components'
import { formatMaybeLocalTime } from '@/utils/browser-local-time'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const items = ref<AutomationRunRecord[]>([])
onMounted(async () => { items.value = await listAutomationRuns(typeof route.query.automationId === 'string' ? route.query.automationId : undefined) })
</script>

<template>
  <section class="runs-page">
    <GcPageHeader :title="t('automations.runs.title')" :description="t('automations.runs.description')" />
    <div class="runs-table" role="table" :aria-label="t('automations.aria.runs')">
      <button v-for="run in items" :key="run.id" class="runs-table__row" type="button" @click="router.push(`/automation-runs/${run.id}`)">
        <span>{{ run.automationNameSnapshot }}</span><span>{{ t(`automations.triggerTypes.${run.triggerType}`) }}</span><GcStatusTag :status="run.status" /><span>{{ t('automations.runs.progress', { succeeded: run.targetSummary.succeeded || 0, total: run.targetSummary.total || 0 }) }}</span><span>{{ run.failureStage ? t(`automations.failureStages.${run.failureStage}`) : t('automations.common.notAvailable') }}</span><span>{{ formatMaybeLocalTime(run.createdAt, t('automations.common.notAvailable')) }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.runs-page, .runs-table { display: grid; gap: var(--gc-space-4); }
.runs-table__row { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: var(--gc-space-3); align-items: center; padding: var(--gc-space-4); border: var(--gc-border-width-default) solid var(--gc-color-border-muted); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-solid); color: var(--gc-color-text); text-align: left; cursor: pointer; }
.runs-table__row:hover { background: var(--gc-color-surface-hover); box-shadow: var(--gc-shadow-hover); }
</style>
