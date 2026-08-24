<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AutomationConfiguration, AutomationRecord } from '@/api/modules/automations.api'

const props = defineProps<{ automation?: AutomationRecord | null }>()
const emit = defineEmits<{ save: [payload: AutomationConfiguration & { name: string; description?: string }]; cancel: [] }>()
const { t } = useI18n()

const form = reactive({ name: '', description: '', triggerType: 'on_demand', cron: '0 2 * * *', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, expiresWithinDays: 30, environments: 'production', maxTargets: 100, concurrency: 5, requireDryRun: true, requireApproval: true, failureCount: 3 })

watch(() => props.automation, (automation) => {
  if (!automation) return
  const trigger = automation.configuration.trigger
  Object.assign(form, { name: automation.name, description: automation.description ?? '', triggerType: trigger.type, cron: trigger.type === 'schedule' ? trigger.cron : '0 2 * * *', timeZone: trigger.type === 'schedule' ? trigger.timeZone : form.timeZone, expiresWithinDays: automation.configuration.targetSelector.expiresWithinDays ?? 30, environments: automation.configuration.targetSelector.environments?.join(',') ?? '', maxTargets: automation.configuration.guardrails.maxTargetsPerRun, concurrency: automation.configuration.guardrails.concurrencyLimit, requireDryRun: automation.configuration.guardrails.requireDryRun, requireApproval: automation.configuration.guardrails.requireApproval, failureCount: automation.configuration.guardrails.failureCountThreshold ?? 3 })
}, { immediate: true })

const valid = computed(() => form.name.trim() && form.maxTargets > 0 && form.concurrency > 0 && form.concurrency <= form.maxTargets)

function submit() {
  if (!valid.value) return
  emit('save', {
    name: form.name.trim(), description: form.description.trim() || undefined,
    trigger: form.triggerType === 'schedule' ? { type: 'schedule', cron: form.cron, timeZone: form.timeZone } : { type: 'on_demand' },
    targetSelector: { expiresWithinDays: form.expiresWithinDays, environments: form.environments.split(',').map((item) => item.trim()).filter(Boolean) },
    actions: [
      { type: 'create_deployment_plan', position: 1, config: { workflowTemplateId: 'default' } },
      { type: 'execute_deployment_plan', position: 2, config: { source: 'created_by_previous_action', dryRunFirst: form.requireDryRun } }
    ],
    guardrails: { maxTargetsPerRun: form.maxTargets, concurrencyLimit: form.concurrency, requirePreview: true, requireDryRun: form.requireDryRun, requireApproval: form.requireApproval, failureCountThreshold: form.failureCount }
  })
}
</script>

<template>
  <form class="automation-editor" @submit.prevent="submit">
    <label><span>{{ t('automations.fields.name') }}</span><input v-model="form.name" /></label>
    <label><span>{{ t('automations.fields.description') }}</span><textarea v-model="form.description" /></label>
    <label><span>{{ t('automations.fields.trigger') }}</span><select v-model="form.triggerType"><option value="on_demand">{{ t('automations.triggers.onDemand') }}</option><option value="schedule">{{ t('automations.triggers.schedule') }}</option></select></label>
    <template v-if="form.triggerType === 'schedule'">
      <label><span>{{ t('automations.fields.cron') }}</span><input v-model="form.cron" /></label>
      <label><span>{{ t('automations.fields.timeZone') }}</span><input v-model="form.timeZone" /></label>
    </template>
    <label><span>{{ t('automations.fields.expiresWithinDays') }}</span><input v-model.number="form.expiresWithinDays" type="number" min="0" /></label>
    <label><span>{{ t('automations.fields.environments') }}</span><input v-model="form.environments" /></label>
    <label><span>{{ t('automations.fields.maxTargets') }}</span><input v-model.number="form.maxTargets" type="number" min="1" /></label>
    <label><span>{{ t('automations.fields.concurrency') }}</span><input v-model.number="form.concurrency" type="number" min="1" /></label>
    <label><span>{{ t('automations.fields.failureCount') }}</span><input v-model.number="form.failureCount" type="number" min="1" /></label>
    <label class="automation-editor__check"><input v-model="form.requireDryRun" type="checkbox" /><span>{{ t('automations.fields.requireDryRun') }}</span></label>
    <label class="automation-editor__check"><input v-model="form.requireApproval" type="checkbox" /><span>{{ t('automations.fields.requireApproval') }}</span></label>
    <footer><button class="gc-button" type="button" @click="emit('cancel')">{{ t('automations.actions.cancel') }}</button><button class="gc-button gc-button--primary" type="submit" :disabled="!valid">{{ t('automations.actions.save') }}</button></footer>
  </form>
</template>

<style scoped>
.automation-editor { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-4); }
.automation-editor label { display: grid; gap: var(--gc-space-2); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.automation-editor input, .automation-editor textarea, .automation-editor select { width: 100%; padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-solid); color: var(--gc-color-text); font: inherit; }
.automation-editor textarea { min-height: calc(var(--gc-space-10) + var(--gc-space-8)); resize: vertical; }
.automation-editor__check { display: flex !important; align-items: center; }
.automation-editor__check input { width: auto; }
.automation-editor footer { grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: var(--gc-space-3); }
</style>
