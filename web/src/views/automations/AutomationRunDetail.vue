<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { getAutomationRun, listAutomationRunTargets, retryAutomationRun, stopAutomationRun, type AutomationRunRecord, type AutomationRunTargetRecord } from '@/api/modules/automations.api'
import { GcPageHeader, GcStatusTag } from '@/design-system/components'
import { formatMaybeLocalTime } from '@/utils/browser-local-time'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const run = ref<(AutomationRunRecord & { actionResults: unknown[] }) | null>(null)
const targets = ref<AutomationRunTargetRecord[]>([])
const runId = computed(() => String(route.params.id))

async function load() { run.value = await getAutomationRun(runId.value); targets.value = await listAutomationRunTargets(runId.value) }
async function stop() { await stopAutomationRun(runId.value); await load() }
async function retry() { const next = await retryAutomationRun(runId.value); await router.push(`/automation-runs/${next.id}`) }
onMounted(load)
</script>

<template>
  <section v-if="run" class="run-detail">
    <GcPageHeader :title="run.automationNameSnapshot" :description="t('automations.runDetail.description', { version: run.automationVersion })">
      <template #actions><button class="gc-button" type="button" @click="stop">{{ t('automations.actions.stop') }}</button><button class="gc-button gc-button--primary" type="button" @click="retry">{{ t('automations.actions.retryFailed') }}</button></template>
    </GcPageHeader>
    <section class="run-detail__summary" :aria-label="t('automations.aria.progress')">
      <div v-for="key in ['total', 'pending', 'running', 'waitingApproval', 'succeeded', 'failed', 'skipped', 'cancelled']" :key="key"><span>{{ t(`automations.progress.${key}`) }}</span><strong>{{ run.targetSummary[key] || 0 }}</strong></div>
    </section>
    <dl class="run-detail__facts"><div><dt>{{ t('automations.fields.startedAt') }}</dt><dd>{{ formatMaybeLocalTime(run.startedAt, t('automations.common.notAvailable')) }}</dd></div><div><dt>{{ t('automations.fields.finishedAt') }}</dt><dd>{{ formatMaybeLocalTime(run.finishedAt, t('automations.common.notAvailable')) }}</dd></div><div><dt>{{ t('automations.fields.failureStage') }}</dt><dd>{{ run.failureStage ? t(`automations.failureStages.${run.failureStage}`) : t('automations.common.notAvailable') }}</dd></div><div><dt>{{ t('automations.fields.parentRun') }}</dt><dd>{{ run.parentRunId || t('automations.common.notAvailable') }}</dd></div><div><dt>{{ t('automations.runDetail.sourceType') }}</dt><dd>{{ run.triggerContext?.sourceType || t('automations.common.notAvailable') }}</dd></div><div><dt>{{ t('automations.runDetail.certificateVersion') }}</dt><dd>{{ run.triggerContext?.certificateVersionId || t('automations.common.notAvailable') }}</dd></div><div><dt>{{ t('automations.runDetail.approvalId') }}</dt><dd>{{ run.approvalId || t('automations.common.notAvailable') }}</dd></div><div><dt>{{ t('automations.runDetail.deliveryId') }}</dt><dd>{{ run.deliveryId || t('automations.common.notAvailable') }}</dd></div></dl>
    <section v-if="run.triggerContext" class="run-detail__event">
      <h3>{{ t('automations.runDetail.triggerContext') }}</h3>
      <p>{{ run.triggerContext.eventType || t('automations.common.notAvailable') }} · {{ formatMaybeLocalTime(run.triggerContext.occurredAt, t('automations.common.notAvailable')) }}</p>
      <p>{{ (run.triggerContext.domains || []).join(', ') || t('automations.common.notAvailable') }}</p>
      <p>{{ t('automations.runDetail.excludedReasons') }}: {{ JSON.stringify(run.triggerContext.excludedReasons || {}) }}</p>
    </section>
    <div class="run-targets">
      <article v-for="target in targets" :key="target.id"><header><strong>{{ target.targetSnapshot.certificateName }}</strong><GcStatusTag :status="target.status" /></header><p>{{ target.targetSnapshot.assetName || t('automations.common.notAvailable') }} · {{ target.targetSnapshot.environment || t('automations.common.notAvailable') }}</p><p>{{ target.failureStage ? t(`automations.failureStages.${target.failureStage}`) : t('automations.runDetail.noFailure') }}</p><p v-if="target.errorCode">{{ target.errorCode }} · {{ target.errorMessage }}</p><footer><button v-if="target.deploymentPlanId" class="gc-button" type="button" @click="router.push(`/deployment-plans?id=${target.deploymentPlanId}`)">{{ t('automations.actions.openPlan') }}</button><button v-if="target.executionRunId" class="gc-button" type="button" @click="router.push(`/executions?id=${target.executionRunId}`)">{{ t('automations.actions.openExecution') }}</button></footer></article>
    </div>
  </section>
</template>

<style scoped>
.run-detail, .run-targets { display: grid; gap: var(--gc-space-4); }
.run-detail__summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(calc(var(--gc-space-10) * 2), 1fr)); gap: var(--gc-space-3); }
.run-detail__summary div { display: grid; gap: var(--gc-space-1); padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border-muted); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-solid); }
.run-detail__summary span { color: var(--gc-color-text-muted); }
.run-detail__summary strong { color: var(--gc-color-text); font-size: var(--gc-font-size-xl); }
.run-detail__facts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--gc-space-3); margin: 0; }
.run-detail__facts div, .run-detail__event, .run-targets article { padding: var(--gc-space-4); border: var(--gc-border-width-default) solid var(--gc-color-border-muted); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-raised); }
.run-detail__facts dt, .run-targets p { color: var(--gc-color-text-muted); }
.run-detail__facts dd { margin: var(--gc-space-1) 0 0; color: var(--gc-color-text); }
.run-detail__event { display: grid; gap: var(--gc-space-2); }
.run-detail__event h3, .run-detail__event p { margin: 0; }
.run-targets article { display: grid; gap: var(--gc-space-2); }
.run-targets header, .run-targets footer { display: flex; justify-content: space-between; gap: var(--gc-space-3); flex-wrap: wrap; }
.run-targets p { margin: 0; }
</style>
