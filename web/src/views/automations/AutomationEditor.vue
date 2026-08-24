<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AutomationConfiguration, AutomationRecord } from '@/api/modules/automations.api'

const props = defineProps<{ automation?: AutomationRecord | null }>()
const emit = defineEmits<{ save: [payload: AutomationConfiguration & { name: string; description?: string }]; cancel: [] }>()
const { t } = useI18n()

const form = reactive({ name: '', description: '', triggerType: 'on_demand', cron: '0 2 * * *', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, expiresWithinDays: 30, environments: 'production', certificateIds: '', maxTargets: 100, concurrency: 5, requireDryRun: true, requireApproval: true, failureCount: 3, planType: 'UPDATE', planMode: 'create_and_execute' })

watch(() => props.automation, (automation) => {
  if (!automation) return
  const trigger = automation.configuration.trigger
  const createAction = automation.configuration.actions.find((action) => action.type === 'create_deployment_plan')
  Object.assign(form, { name: automation.name, description: automation.description ?? '', triggerType: trigger.type, cron: trigger.type === 'schedule' ? trigger.cron : '0 2 * * *', timeZone: trigger.type === 'schedule' ? trigger.timeZone : form.timeZone, expiresWithinDays: automation.configuration.targetSelector.expiresWithinDays ?? 30, environments: automation.configuration.targetSelector.environments?.join(',') ?? '', certificateIds: automation.configuration.targetSelector.certificateIds?.join(',') ?? '', maxTargets: automation.configuration.guardrails.maxTargetsPerRun, concurrency: automation.configuration.guardrails.concurrencyLimit, requireDryRun: automation.configuration.guardrails.requireDryRun, requireApproval: automation.configuration.guardrails.requireApproval, failureCount: automation.configuration.guardrails.failureCountThreshold ?? 3, planType: String(createAction?.config.planType ?? 'UPDATE'), planMode: automation.configuration.actions.some((action) => action.type === 'execute_deployment_plan') ? 'create_and_execute' : 'create_only' })
}, { immediate: true })

const valid = computed(() => form.name.trim() && form.maxTargets > 0 && form.concurrency > 0 && form.concurrency <= form.maxTargets)

function submit() {
  if (!valid.value) return
  emit('save', {
    name: form.name.trim(), description: form.description.trim() || undefined,
    trigger: form.triggerType === 'schedule' ? { type: 'schedule', cron: form.cron, timeZone: form.timeZone } : { type: 'on_demand' },
    targetSelector: { expiresWithinDays: form.expiresWithinDays, environments: form.environments.split(',').map((item) => item.trim()).filter(Boolean), certificateIds: form.certificateIds.split(',').map((item) => item.trim()).filter(Boolean) },
    actions: [
      { type: 'create_deployment_plan', position: 1, config: { planType: form.planType, selectionMode: 'EXPLICIT' } },
      ...(form.planMode === 'create_and_execute' ? [{ type: 'execute_deployment_plan' as const, position: 2, config: { source: 'created_by_previous_action' as const, dryRunFirst: form.requireDryRun } }] : [])
    ],
    guardrails: { maxTargetsPerRun: form.maxTargets, concurrencyLimit: form.concurrency, requirePreview: true, requireDryRun: form.requireDryRun, requireApproval: form.requireApproval, failureCountThreshold: form.failureCount }
  })
}
</script>

<template>
  <form class="automation-editor" @submit.prevent="submit">
    <section class="automation-editor__section automation-editor__section--full">
      <header><h3>{{ t('automations.editor.sections.basic') }}</h3><p>{{ t('automations.editor.sections.basicHelp') }}</p></header>
      <div class="automation-editor__grid">
        <label><span>{{ t('automations.fields.name') }}</span><input v-model="form.name" /></label>
        <label><span>{{ t('automations.fields.description') }}</span><textarea v-model="form.description" /></label>
      </div>
    </section>
    <section class="automation-editor__section automation-editor__section--full">
      <header><h3>{{ t('automations.editor.sections.targets') }}</h3><p>{{ t('automations.editor.sections.targetsHelp') }}</p></header>
      <div class="automation-editor__grid">
        <label><span>{{ t('automations.fields.trigger') }}</span><select v-model="form.triggerType"><option value="on_demand">{{ t('automations.triggers.onDemand') }}</option><option value="schedule">{{ t('automations.triggers.schedule') }}</option></select></label>
        <template v-if="form.triggerType === 'schedule'">
          <label><span>{{ t('automations.fields.cron') }}</span><input v-model="form.cron" /></label>
          <label><span>{{ t('automations.fields.timeZone') }}</span><input v-model="form.timeZone" /></label>
        </template>
        <label><span>{{ t('automations.fields.expiresWithinDays') }}</span><input v-model.number="form.expiresWithinDays" type="number" min="0" /><small>{{ t('automations.fields.expiresWithinDaysHelp') }}</small></label>
        <label><span>{{ t('automations.fields.environments') }}</span><input v-model="form.environments" /><small>{{ t('automations.fields.environmentsHelp') }}</small></label>
        <label class="automation-editor__field--full"><span>{{ t('automations.fields.certificateIds') }}</span><input v-model="form.certificateIds" data-testid="automation-certificate-ids" :placeholder="t('automations.fields.certificateIdsPlaceholder')" /><small>{{ t('automations.fields.certificateIdsHelp') }}</small></label>
      </div>
    </section>
    <section class="automation-editor__section automation-editor__section--full">
      <header><h3>{{ t('automations.editor.sections.plan') }}</h3><p>{{ t('automations.editor.sections.planRelationDescription') }}</p></header>
      <div class="automation-editor__notice"><strong>{{ t('automations.editor.sections.planRelationTitle') }}</strong><p>{{ t('automations.editor.sections.planRelationHelp') }}</p></div>
      <div class="automation-editor__grid">
        <label><span>{{ t('automations.fields.planType') }}</span><select v-model="form.planType"><option value="UPDATE">{{ t('automations.fields.planTypeUpdate') }}</option><option value="INSTALL">{{ t('automations.fields.planTypeInstall') }}</option><option value="VERIFY_ONLY">{{ t('automations.fields.planTypeVerifyOnly') }}</option></select><small>{{ t('automations.fields.planTypeHelp') }}</small></label>
        <label><span>{{ t('automations.fields.planMode') }}</span><select v-model="form.planMode" data-testid="automation-plan-mode"><option value="create_and_execute">{{ t('automations.fields.planModeCreateAndExecute') }}</option><option value="create_only">{{ t('automations.fields.planModeCreateOnly') }}</option></select><small>{{ t('automations.fields.planModeHelp') }}</small></label>
      </div>
      <ol class="automation-editor__chain">
        <li><strong>1</strong><span>{{ t('automations.editor.chain.createPlan') }}</span></li>
        <li v-if="form.requireDryRun"><strong>2</strong><span>{{ t('automations.editor.chain.dryRun') }}</span></li>
        <li v-if="form.requireApproval"><strong>3</strong><span>{{ t('automations.editor.chain.approval') }}</span></li>
        <li v-if="form.planMode === 'create_and_execute'"><strong>4</strong><span>{{ t('automations.editor.chain.executePlan') }}</span></li>
      </ol>
    </section>
    <section class="automation-editor__section automation-editor__section--full">
      <header><h3>{{ t('automations.editor.sections.guardrails') }}</h3><p>{{ t('automations.editor.sections.guardrailsHelp') }}</p></header>
      <div class="automation-editor__grid">
        <label><span>{{ t('automations.fields.maxTargets') }}</span><input v-model.number="form.maxTargets" type="number" min="1" /></label>
        <label><span>{{ t('automations.fields.concurrency') }}</span><input v-model.number="form.concurrency" type="number" min="1" /></label>
        <label><span>{{ t('automations.fields.failureCount') }}</span><input v-model.number="form.failureCount" type="number" min="1" /></label>
        <label class="automation-editor__check"><input v-model="form.requireDryRun" type="checkbox" /><span>{{ t('automations.fields.requireDryRun') }}</span></label>
        <label class="automation-editor__check"><input v-model="form.requireApproval" type="checkbox" /><span>{{ t('automations.fields.requireApproval') }}</span></label>
      </div>
    </section>
    <footer><button class="gc-button" type="button" @click="emit('cancel')">{{ t('automations.actions.cancel') }}</button><button class="gc-button gc-button--primary" type="submit" :disabled="!valid">{{ t('automations.actions.save') }}</button></footer>
  </form>
</template>

<style scoped>
.automation-editor { display: grid; gap: var(--gc-space-5); }
.automation-editor__section { display: grid; gap: var(--gc-space-3); }
.automation-editor__section header { display: grid; gap: var(--gc-space-1); }
.automation-editor__section h3, .automation-editor__section p { margin: 0; }
.automation-editor__section p, .automation-editor small { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.automation-editor__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-4); }
.automation-editor label { display: grid; gap: var(--gc-space-2); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.automation-editor__field--full { grid-column: 1 / -1; }
.automation-editor input, .automation-editor textarea, .automation-editor select { width: 100%; padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-solid); color: var(--gc-color-text); font: inherit; }
.automation-editor textarea { min-height: calc(var(--gc-space-10) + var(--gc-space-8)); resize: vertical; }
.automation-editor__notice { padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-info-border); border-radius: var(--gc-radius-md); background: var(--gc-color-info-soft); color: var(--gc-color-text); }
.automation-editor__notice p { margin: var(--gc-space-1) 0 0; }
.automation-editor__chain { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--gc-space-2); margin: 0; padding: 0; list-style: none; }
.automation-editor__chain li { display: flex; align-items: center; gap: var(--gc-space-2); padding: var(--gc-space-3); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-raised); color: var(--gc-color-text); }
.automation-editor__chain strong { display: grid; place-items: center; min-width: var(--gc-space-6); min-height: var(--gc-space-6); border-radius: var(--gc-radius-md); background: var(--gc-color-info); color: var(--gc-color-text-inverse); }
.automation-editor__check { display: flex !important; align-items: center; }
.automation-editor__check input { width: auto; }
.automation-editor footer { grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: var(--gc-space-3); }
@media (max-width: 760px) { .automation-editor__grid, .automation-editor__chain { grid-template-columns: 1fr; } }
</style>
