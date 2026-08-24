<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AutomationConfiguration, AutomationRecord } from '@/api/modules/automations.api'
import { listCertificates, listCertificateVersions } from '@/api/modules/certificates.api'
import type { ApiRecord } from '@/api/modules/common'

const props = defineProps<{ automation?: AutomationRecord | null }>()
const emit = defineEmits<{ save: [payload: AutomationConfiguration & { name: string; description?: string }]; cancel: [] }>()
const { t } = useI18n()

const form = reactive({
  name: '',
  description: '',
  triggerType: 'on_demand',
  cron: '0 2 * * *',
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  certificateDomains: '',
  versionSelection: 'latest',
  certificateVersionIds: [] as string[],
  maxTargets: 100,
  concurrency: 5,
  requireDryRun: true,
  requireApproval: true,
  failureCount: 3,
})

const currentStep = ref<1 | 2 | 3>(1)
const versionOptions = ref<Array<{ id: string; label: string }>>([])
const versionsLoading = ref(false)
const versionsLoadFailed = ref(false)

watch(() => props.automation, (automation) => {
  if (!automation) {
    currentStep.value = 1
    return
  }
  const trigger = automation.configuration.trigger
  const selector = automation.configuration.targetSelector
  Object.assign(form, {
    name: automation.name,
    description: automation.description ?? '',
    triggerType: trigger.type,
    cron: trigger.type === 'schedule' ? trigger.cron : '0 2 * * *',
    timeZone: trigger.type === 'schedule' ? trigger.timeZone : form.timeZone,
    certificateDomains: selector.certificateDomains?.join(',') ?? '',
    versionSelection: selector.certificateVersionSelection ?? 'latest',
    certificateVersionIds: [...(selector.certificateVersionIds ?? [])],
    maxTargets: automation.configuration.guardrails.maxTargetsPerRun,
    concurrency: automation.configuration.guardrails.concurrencyLimit,
    requireDryRun: automation.configuration.guardrails.requireDryRun,
    requireApproval: automation.configuration.guardrails.requireApproval,
    failureCount: automation.configuration.guardrails.failureCountThreshold ?? 3,
  })
  currentStep.value = 1
}, { immediate: true })

const domains = computed(() => form.certificateDomains.split(',').map((item) => item.trim()).filter(Boolean))
const valid = computed(() => Boolean(form.name.trim() && domains.value.length && form.maxTargets > 0 && form.concurrency > 0 && form.concurrency <= form.maxTargets && (form.versionSelection === 'latest' || form.certificateVersionIds.length)))
const stepOneReady = computed(() => Boolean(domains.value.length && (form.versionSelection === 'latest' || form.certificateVersionIds.length)))
const stepTwoReady = computed(() => Boolean(form.triggerType === 'on_demand' || (form.cron.trim() && form.timeZone.trim())))

watch([() => form.versionSelection, () => form.certificateDomains], () => {
  if (form.versionSelection === 'specific') void loadVersionOptions()
})

async function loadVersionOptions() {
  versionsLoading.value = true
  versionsLoadFailed.value = false
  try {
    const assets = (await listCertificates({ page: 1, pageSize: 500 })).data?.items ?? []
    const domainSet = new Set(domains.value.map(normalizeDomain))
    const matchedAssets = assets.filter((asset) => certificateDomains(asset).some((domain) => domainSet.has(normalizeDomain(domain))))
    const versionResults = await Promise.all(matchedAssets.map((asset) => listCertificateVersions({ page: 1, pageSize: 100, sort: 'versionNo:desc', filters: { certificateAssetId: readString(asset, 'id') } })))
    versionOptions.value = versionResults.flatMap((result, index) => (result.data?.items ?? []).map((version) => ({
      id: readString(version, 'id'),
      label: `${readString(matchedAssets[index], 'primaryDomain') || readString(matchedAssets[index], 'name')} · ${readString(version, 'versionNo') || readString(version, 'id')}`,
    }))).filter((option) => option.id)
  } catch {
    versionOptions.value = []
    versionsLoadFailed.value = true
  } finally {
    versionsLoading.value = false
  }
}

function readString(record: ApiRecord | undefined, key: string): string {
  const value = record?.[key]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

function certificateDomains(record: ApiRecord): string[] {
  const sans = Array.isArray(record.sans) ? record.sans.filter((item): item is string => typeof item === 'string') : []
  return [readString(record, 'primaryDomain'), ...sans].filter(Boolean)
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.$/, '')
}

function goToStep(step: 1 | 2 | 3) {
  if (step === 1 || (step === 2 && stepOneReady.value) || (step === 3 && stepOneReady.value && stepTwoReady.value)) currentStep.value = step
}

function goNext() {
  if (currentStep.value === 1 && stepOneReady.value) currentStep.value = 2
  else if (currentStep.value === 2 && stepTwoReady.value) currentStep.value = 3
}

function goPrevious() {
  if (currentStep.value > 1) currentStep.value = (currentStep.value - 1) as 1 | 2 | 3
}

function submit() {
  if (!valid.value || currentStep.value !== 3) return
  emit('save', {
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    trigger: form.triggerType === 'schedule' ? { type: 'schedule', cron: form.cron, timeZone: form.timeZone } : { type: 'on_demand' },
    targetSelector: {
      certificateDomains: domains.value,
      certificateVersionSelection: form.versionSelection as 'latest' | 'specific',
      ...(form.versionSelection === 'specific' ? { certificateVersionIds: [...form.certificateVersionIds] } : {}),
    },
    actions: [
      { type: 'create_deployment_plan', position: 1, config: { planType: 'UPDATE', selectionMode: 'EXPLICIT' } },
      { type: 'execute_deployment_plan', position: 2, config: { source: 'created_by_previous_action', dryRunFirst: form.requireDryRun } },
    ],
    guardrails: {
      maxTargetsPerRun: form.maxTargets,
      concurrencyLimit: form.concurrency,
      requirePreview: true,
      requireDryRun: form.requireDryRun,
      requireApproval: form.requireApproval,
      failureCountThreshold: form.failureCount,
    },
  })
}
</script>

<template>
  <form class="automation-editor" @submit.prevent="submit">
    <header class="automation-editor__wizard-header">
      <div>
        <span class="automation-editor__eyebrow">{{ t('automations.formStep.stepProgress', { current: currentStep, total: 3 }) }}</span>
        <h3>{{ currentStep === 1 ? t('automations.editor.sections.targets') : currentStep === 2 ? t('automations.form.schedule') : t('automations.editor.sections.guardrails') }}</h3>
      </div>
      <ol class="automation-editor__steps" :aria-label="t('automations.formStep.stepProgress', { current: currentStep, total: 3 })">
        <li :class="{ 'is-active': currentStep === 1, 'is-done': currentStep > 1 }"><button type="button" @click="goToStep(1)"><strong>1</strong><span>{{ t('automations.editor.sections.targets') }}</span></button></li>
        <li :class="{ 'is-active': currentStep === 2, 'is-done': currentStep > 2 }"><button type="button" :disabled="!stepOneReady" @click="goToStep(2)"><strong>2</strong><span>{{ t('automations.form.schedule') }}</span></button></li>
        <li :class="{ 'is-active': currentStep === 3 }"><button type="button" :disabled="!stepOneReady || !stepTwoReady" @click="goToStep(3)"><strong>3</strong><span>{{ t('automations.editor.sections.guardrails') }}</span></button></li>
      </ol>
    </header>

    <section v-if="currentStep === 1" class="automation-editor__panel">
      <header><h4>{{ t('automations.form.existingAssetTitle') }}</h4><p>{{ t('automations.form.existingAssetDescription') }}</p></header>
      <div class="automation-editor__grid">
        <label class="automation-editor__field--full"><span>{{ t('automations.form.certificateDomains') }}</span><input v-model="form.certificateDomains" data-testid="automation-certificate-domains" :placeholder="t('automations.form.certificateDomainsPlaceholder')" /><small>{{ t('automations.form.certificateDomainsHelp') }}</small></label>
        <label><span>{{ t('automations.form.versionSelection') }}</span><select v-model="form.versionSelection" data-testid="automation-version-selection"><option value="latest">{{ t('automations.form.versionSelectionLatest') }}</option><option value="specific">{{ t('automations.form.versionSelectionSpecific') }}</option></select><small>{{ t('automations.form.versionSelectionHelp') }}</small></label>
        <label v-if="form.versionSelection === 'specific'"><span>{{ t('automations.form.certificateVersionIds') }}</span><select v-model="form.certificateVersionIds" data-testid="automation-certificate-version-ids" multiple><option v-for="option in versionOptions" :key="option.id" :value="option.id">{{ option.label }}</option></select><small>{{ t('automations.form.certificateVersionIdsHelp') }}</small><small v-if="versionsLoading">{{ t('automations.form.versionLoading') }}</small><small v-else-if="versionsLoadFailed">{{ t('automations.form.versionLoadFailed') }}</small><small v-else-if="versionOptions.length === 0">{{ t('automations.form.versionEmpty') }}</small></label>
      </div>
    </section>

    <section v-else-if="currentStep === 2" class="automation-editor__panel">
      <header><h4>{{ t('automations.form.schedule') }}</h4><p>{{ t('automations.form.scheduleHelp') }}</p></header>
      <div class="automation-editor__grid">
        <label><span>{{ t('automations.fields.trigger') }}</span><select v-model="form.triggerType" data-testid="automation-trigger"><option value="on_demand">{{ t('automations.triggers.onDemand') }}</option><option value="schedule">{{ t('automations.triggers.schedule') }}</option></select></label>
        <template v-if="form.triggerType === 'schedule'"><label><span>{{ t('automations.fields.cron') }}</span><input v-model="form.cron" /></label><label><span>{{ t('automations.fields.timeZone') }}</span><input v-model="form.timeZone" /></label></template>
      </div>
      <div class="automation-editor__summary"><strong>{{ t('automations.form.execution') }}</strong><p>{{ t('automations.form.executionHelp') }}</p><ol class="automation-editor__chain"><li><strong>1</strong><span>{{ t('automations.form.snapshot') }}</span></li><li><strong>2</strong><span>{{ t('automations.editor.chain.createPlan') }}</span></li><li><strong>3</strong><span>{{ t('automations.editor.chain.executePlan') }}</span></li></ol></div>
    </section>

    <section v-else class="automation-editor__panel">
      <header><h4>{{ t('automations.editor.sections.guardrails') }}</h4><p>{{ t('automations.editor.sections.guardrailsHelp') }}</p></header>
      <div class="automation-editor__grid"><label><span>{{ t('automations.fields.name') }}</span><input v-model="form.name" /></label><label><span>{{ t('automations.fields.description') }}</span><textarea v-model="form.description" /></label><label><span>{{ t('automations.fields.maxTargets') }}</span><input v-model.number="form.maxTargets" type="number" min="1" /></label><label><span>{{ t('automations.fields.concurrency') }}</span><input v-model.number="form.concurrency" type="number" min="1" /></label><label><span>{{ t('automations.fields.failureCount') }}</span><input v-model.number="form.failureCount" type="number" min="1" /></label><label class="automation-editor__check"><input v-model="form.requireDryRun" type="checkbox" /><span>{{ t('automations.fields.requireDryRun') }}</span></label><label class="automation-editor__check"><input v-model="form.requireApproval" type="checkbox" /><span>{{ t('automations.fields.requireApproval') }}</span></label></div>
      <div class="automation-editor__review"><strong>{{ t('automations.formStep.reviewTitle') }}</strong><p>{{ t('automations.formStep.reviewText', { domains: domains.join(', '), version: form.versionSelection === 'latest' ? t('automations.form.versionSelectionLatest') : t('automations.form.versionSelectionSpecific') }) }}</p></div>
    </section>

    <footer class="automation-editor__footer"><button class="gc-button" type="button" @click="emit('cancel')">{{ t('automations.actions.cancel') }}</button><div><button v-if="currentStep > 1" class="gc-button" type="button" data-testid="automation-previous" @click="goPrevious">{{ t('automations.formStep.previous') }}</button><button v-if="currentStep < 3" class="gc-button gc-button--primary" type="button" data-testid="automation-next" :disabled="currentStep === 1 ? !stepOneReady : !stepTwoReady" @click="goNext">{{ t('automations.formStep.next') }}</button><button v-else class="gc-button gc-button--primary" type="submit" data-testid="automation-save" :disabled="!valid">{{ t('automations.actions.save') }}</button></div></footer>
  </form>
</template>

<style scoped>
.automation-editor { display: grid; gap: var(--gc-space-5); }
.automation-editor__wizard-header, .automation-editor__footer { display: flex; align-items: center; justify-content: space-between; gap: var(--gc-space-4); }
.automation-editor__wizard-header { padding-bottom: var(--gc-space-4); border-bottom: var(--gc-border-width-default) solid var(--gc-color-border); }
.automation-editor__eyebrow { color: var(--gc-color-primary); font-size: var(--gc-font-size-sm); font-weight: var(--gc-font-weight-semibold); }
.automation-editor h3, .automation-editor h4, .automation-editor p { margin: 0; }
.automation-editor h3 { margin-top: var(--gc-space-1); color: var(--gc-color-text); font-size: var(--gc-font-size-xl); }
.automation-editor h4 { color: var(--gc-color-text); font-size: var(--gc-font-size-lg); }
.automation-editor__steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gc-space-2); margin: 0; padding: 0; list-style: none; }
.automation-editor__steps button { display: flex; align-items: center; gap: var(--gc-space-2); min-width: var(--gc-space-10); border: 0; background: transparent; color: var(--gc-color-text-muted); font: inherit; text-align: left; }
.automation-editor__steps strong { display: grid; place-items: center; min-width: var(--gc-space-7); min-height: var(--gc-space-7); border-radius: var(--gc-radius-full); background: var(--gc-color-surface-raised); color: var(--gc-color-text-muted); }
.automation-editor__steps li.is-active button, .automation-editor__steps li.is-done button { color: var(--gc-color-text); }
.automation-editor__steps li.is-active strong, .automation-editor__steps li.is-done strong { background: var(--gc-color-primary); color: var(--gc-color-text-inverse); }
.automation-editor__steps button:disabled { cursor: not-allowed; opacity: var(--gc-opacity-disabled); }
.automation-editor__panel { display: grid; gap: var(--gc-space-4); min-height: calc(var(--gc-space-10) + var(--gc-space-8) + var(--gc-space-6)); }
.automation-editor__panel > header { display: grid; gap: var(--gc-space-1); }
.automation-editor__panel p, .automation-editor small { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); line-height: var(--gc-line-height-relaxed); }
.automation-editor__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-4); }
.automation-editor label { display: grid; gap: var(--gc-space-2); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.automation-editor__field--full { grid-column: 1 / -1; }
.automation-editor input, .automation-editor textarea, .automation-editor select { width: 100%; padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-solid); color: var(--gc-color-text); font: inherit; }
.automation-editor textarea, .automation-editor select[multiple] { min-height: calc(var(--gc-space-10) + var(--gc-space-8)); resize: vertical; }
.automation-editor__summary, .automation-editor__review { display: grid; gap: var(--gc-space-2); padding: var(--gc-space-4); border: var(--gc-border-width-default) solid var(--gc-color-info-border); border-radius: var(--gc-radius-md); background: var(--gc-color-info-soft); }
.automation-editor__chain { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gc-space-2); margin: 0; padding: 0; list-style: none; }
.automation-editor__chain li { display: flex; align-items: center; gap: var(--gc-space-2); padding: var(--gc-space-3); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-solid); color: var(--gc-color-text); }
.automation-editor__chain li > strong { display: grid; place-items: center; min-width: var(--gc-space-6); min-height: var(--gc-space-6); border-radius: var(--gc-radius-full); background: var(--gc-color-primary); color: var(--gc-color-text-inverse); }
.automation-editor__check { display: flex !important; align-items: center; }
.automation-editor__check input { width: auto; }
.automation-editor__footer { padding-top: var(--gc-space-4); border-top: var(--gc-border-width-default) solid var(--gc-color-border); }
.automation-editor__footer > div { display: flex; gap: var(--gc-space-2); }
@media (max-width: 900px) { .automation-editor__wizard-header { align-items: stretch; flex-direction: column; } .automation-editor__steps, .automation-editor__grid, .automation-editor__chain { grid-template-columns: 1fr; } .automation-editor__footer { align-items: stretch; flex-direction: column; } .automation-editor__footer > div { justify-content: flex-end; } }
</style>
