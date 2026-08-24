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
  triggerType: 'api',
  onceRunAt: defaultOnceRunAt(),
  recurrence: 'daily',
  recurrenceTime: '02:00',
  weeklyDay: 1,
  monthlyDay: 1,
  cron: '0 2 * * *',
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  certificateDomains: [] as string[],
  versionSelection: 'latest',
  certificateVersionIds: [] as string[],
  maxTargets: 100,
  concurrency: 5,
  requireDryRun: true,
  requireApproval: true,
  failureCount: 3,
})

const currentStep = ref<1 | 2 | 3>(1)
const certificateAssets = ref<ApiRecord[]>([])
const certificateDomainOptions = ref<Array<{ value: string; label: string }>>([])
const certificateAssetsLoading = ref(false)
const certificateAssetsLoadFailed = ref(false)
const versionOptions = ref<Array<{ id: string; label: string }>>([])
const versionsLoading = ref(false)
const versionsLoadFailed = ref(false)
let certificateAssetsRequest: Promise<void> | null = null
const CERTIFICATE_ASSET_PAGE_SIZE = 200

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
    triggerType: trigger.type === 'on_demand' ? 'api' : trigger.type,
    onceRunAt: trigger.type === 'once' ? toLocalDateTimeInput(trigger.runAt) : defaultOnceRunAt(),
    cron: trigger.type === 'schedule' ? trigger.cron : '0 2 * * *',
    timeZone: trigger.type === 'schedule' ? trigger.timeZone : form.timeZone,
    certificateDomains: (selector.certificateDomains ?? []).map(normalizeDomain),
    versionSelection: selector.certificateVersionSelection ?? 'latest',
    certificateVersionIds: [...(selector.certificateVersionIds ?? [])],
    maxTargets: automation.configuration.guardrails.maxTargetsPerRun,
    concurrency: automation.configuration.guardrails.concurrencyLimit,
    requireDryRun: automation.configuration.guardrails.requireDryRun,
    requireApproval: automation.configuration.guardrails.requireApproval,
    failureCount: automation.configuration.guardrails.failureCountThreshold ?? 3,
  })
  if (trigger.type === 'schedule') applyCronToForm(trigger.cron)
  currentStep.value = 1
}, { immediate: true })

const domains = computed(() => form.certificateDomains.map((item) => item.trim()).filter(Boolean))
const stepProgressWidth = computed(() => `${(currentStep.value / 3) * 100}%`)
const selectedDomainSummary = computed(() => domains.value.length ? domains.value.join(', ') : t('certificates.list.assets.unselectedTitle'))
const valid = computed(() => Boolean(form.name.trim() && domains.value.length && form.maxTargets > 0 && form.concurrency > 0 && form.concurrency <= form.maxTargets && (form.versionSelection === 'latest' || form.certificateVersionIds.length)))
const stepOneReady = computed(() => Boolean(domains.value.length && (form.versionSelection === 'latest' || form.certificateVersionIds.length)))
const stepTwoReady = computed(() => {
  if (form.triggerType === 'api') return true
  if (form.triggerType === 'once') return Boolean(form.onceRunAt && new Date(form.onceRunAt) > new Date())
  return Boolean(form.recurrenceTime && form.timeZone.trim() && (form.recurrence !== 'custom' || form.cron.trim()))
})

watch([() => form.versionSelection, () => form.certificateDomains], () => {
  if (form.versionSelection === 'specific') void loadVersionOptions()
})

function loadCertificateAssets(): Promise<void> {
  if (certificateAssetsRequest) return certificateAssetsRequest

  certificateAssetsRequest = (async () => {
    certificateAssetsLoading.value = true
    certificateAssetsLoadFailed.value = false
    try {
      certificateAssets.value = await loadAllCertificateAssets()
      const domainMap = new Map<string, string>()
      certificateAssets.value.forEach((asset) => {
        const domain = readString(asset, 'primaryDomain') || readString(asset, 'name') || readString(asset, 'commonName')
        const normalized = normalizeDomain(domain)
        if (normalized && !domainMap.has(normalized)) domainMap.set(normalized, domain)
      })
      certificateDomainOptions.value = [...domainMap.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([value, label]) => ({ value, label }))
    } catch {
      certificateAssets.value = []
      certificateDomainOptions.value = []
      certificateAssetsLoadFailed.value = true
    } finally {
      certificateAssetsLoading.value = false
      certificateAssetsRequest = null
    }
  })()

  return certificateAssetsRequest
}

async function loadAllCertificateAssets(): Promise<ApiRecord[]> {
  const records: ApiRecord[] = []
  let page = 1

  while (true) {
    const result = await listCertificates({ page, pageSize: CERTIFICATE_ASSET_PAGE_SIZE, sort: 'updatedAt:desc' })
    const response = result.data
    const items = [...(response?.items ?? [])]
    records.push(...items)

    if (!response || records.length >= response.total || items.length < CERTIFICATE_ASSET_PAGE_SIZE) return records
    page += 1
  }
}

async function loadVersionOptions() {
  versionsLoading.value = true
  versionsLoadFailed.value = false
  try {
    if (!certificateAssets.value.length) await loadCertificateAssets()
    const assets = certificateAssets.value
    const domainSet = new Set(domains.value.map(normalizeDomain))
    const matchedAssets = assets.filter((asset) => domainSet.has(normalizeDomain(readString(asset, 'primaryDomain') || readString(asset, 'name') || readString(asset, 'commonName'))))
    const versionResults = await Promise.all(matchedAssets.map((asset) => listCertificateVersions({ page: 1, pageSize: 100, sort: 'versionNo:desc', filters: { certificateAssetId: readString(asset, 'id') } })))
    versionOptions.value = versionResults.flatMap((result, index) => (result.data?.items ?? []).map((version) => ({
      id: readString(version, 'id'),
      label: `${readString(matchedAssets[index], 'primaryDomain') || readString(matchedAssets[index], 'name')} · ${readString(version, 'versionNo') || readString(version, 'id')}`,
    }))).filter((option) => option.id)
    const availableVersionIds = new Set(versionOptions.value.map((option) => option.id))
    form.certificateVersionIds = form.certificateVersionIds.filter((id) => availableVersionIds.has(id))
  } catch {
    versionOptions.value = []
    versionsLoadFailed.value = true
  } finally {
    versionsLoading.value = false
  }
}

void loadCertificateAssets()

function readString(record: ApiRecord | undefined, key: string): string {
  const value = record?.[key]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.$/, '')
}

function defaultOnceRunAt(): string {
  return toLocalDateTimeInput(new Date(Date.now() + 60 * 60 * 1000).toISOString())
}

function toLocalDateTimeInput(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function applyCronToForm(cron: string) {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = cron.trim().split(/\s+/)
  form.recurrenceTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') form.recurrence = 'daily'
  else if (dayOfMonth === '*' && month === '*' && /^\d$/.test(dayOfWeek ?? '')) {
    form.recurrence = 'weekly'
    form.weeklyDay = Number(dayOfWeek)
  } else if (/^\d{1,2}$/.test(dayOfMonth ?? '') && month === '*' && dayOfWeek === '*') {
    form.recurrence = 'monthly'
    form.monthlyDay = Number(dayOfMonth)
  } else form.recurrence = 'custom'
}

function buildCron(): string {
  if (form.recurrence === 'custom') return form.cron
  const [hour, minute] = form.recurrenceTime.split(':').map(Number)
  if (form.recurrence === 'weekly') return `${minute} ${hour} * * ${form.weeklyDay}`
  if (form.recurrence === 'monthly') return `${minute} ${hour} ${form.monthlyDay} * *`
  return `${minute} ${hour} * * *`
}

function buildTrigger(): AutomationConfiguration['trigger'] {
  if (form.triggerType === 'once') return { type: 'once', runAt: new Date(form.onceRunAt).toISOString() }
  if (form.triggerType === 'schedule') return { type: 'schedule', cron: buildCron(), timeZone: form.timeZone }
  return { type: 'api' }
}

function toggleDomain(domain: string) {
  form.certificateDomains = domains.value.includes(domain)
    ? domains.value.filter((item) => item !== domain)
    : [...domains.value, domain]
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
    trigger: buildTrigger(),
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
      <div class="automation-editor__wizard-title">
        <span class="automation-editor__eyebrow">{{ t('automations.formStep.stepProgress', { current: currentStep, total: 3 }) }}</span>
        <h3>{{ currentStep === 1 ? t('automations.editor.sections.targets') : currentStep === 2 ? t('automations.form.schedule') : t('automations.editor.sections.guardrails') }}</h3>
      </div>
      <div class="automation-editor__progress">
        <div class="automation-editor__progress-bar" aria-hidden="true"><span :style="{ width: stepProgressWidth }"></span></div>
        <ol class="automation-editor__steps" :aria-label="t('automations.formStep.stepProgress', { current: currentStep, total: 3 })">
          <li :class="{ 'is-active': currentStep === 1, 'is-done': currentStep > 1 }"><button type="button" @click="goToStep(1)"><span class="automation-editor__step-index">1</span><strong>{{ t('automations.editor.sections.targets') }}</strong></button></li>
          <li :class="{ 'is-active': currentStep === 2, 'is-done': currentStep > 2 }"><button type="button" :disabled="!stepOneReady" @click="goToStep(2)"><span class="automation-editor__step-index">2</span><strong>{{ t('automations.form.schedule') }}</strong></button></li>
          <li :class="{ 'is-active': currentStep === 3 }"><button type="button" :disabled="!stepOneReady || !stepTwoReady" @click="goToStep(3)"><span class="automation-editor__step-index">3</span><strong>{{ t('automations.editor.sections.guardrails') }}</strong></button></li>
        </ol>
      </div>
    </header>

    <section v-if="currentStep === 1" class="automation-editor__panel">
      <div class="automation-editor__grid">
        <div class="automation-editor__field automation-editor__field--full"><span>{{ t('automations.form.certificateDomains') }}</span><details class="automation-editor__domain-picker" :class="{ 'is-disabled': certificateAssetsLoading || certificateAssetsLoadFailed }"><summary data-testid="automation-certificate-domains" @click="(certificateAssetsLoading || certificateAssetsLoadFailed) && $event.preventDefault()">{{ selectedDomainSummary }}</summary><div class="automation-editor__domain-options" role="group" :aria-label="t('automations.form.certificateDomains')"><label v-for="option in certificateDomainOptions" :key="option.value" class="automation-editor__domain-option"><input data-testid="automation-certificate-domain-option" type="checkbox" :checked="domains.includes(option.value)" :value="option.value" @change="toggleDomain(option.value)" /><span>{{ option.label }}</span></label></div></details><small>{{ t('automations.form.certificateDomainsHelp') }}</small><small v-if="certificateAssetsLoading">{{ t('certificates.detailPanel.states.loading') }}</small><small v-else-if="certificateAssetsLoadFailed">{{ t('certificates.list.assets.loadFailed') }}</small><small v-else-if="certificateDomainOptions.length === 0">{{ t('certificates.list.assets.empty') }}</small></div>
        <label><span>{{ t('automations.form.versionSelection') }}</span><select v-model="form.versionSelection" data-testid="automation-version-selection"><option value="latest">{{ t('automations.form.versionSelectionLatest') }}</option><option value="specific">{{ t('automations.form.versionSelectionSpecific') }}</option></select><small>{{ t('automations.form.versionSelectionHelp') }}</small></label>
        <label v-if="form.versionSelection === 'specific'"><span>{{ t('automations.form.certificateVersionIds') }}</span><select v-model="form.certificateVersionIds" data-testid="automation-certificate-version-ids" multiple><option v-for="option in versionOptions" :key="option.id" :value="option.id">{{ option.label }}</option></select><small>{{ t('automations.form.certificateVersionIdsHelp') }}</small><small v-if="versionsLoading">{{ t('automations.form.versionLoading') }}</small><small v-else-if="versionsLoadFailed">{{ t('automations.form.versionLoadFailed') }}</small><small v-else-if="versionOptions.length === 0">{{ t('automations.form.versionEmpty') }}</small></label>
      </div>
    </section>

    <section v-else-if="currentStep === 2" class="automation-editor__panel">
      <header><h4>{{ t('automations.form.schedule') }}</h4></header>
      <div class="automation-editor__grid">
        <label class="automation-editor__field--full"><span>{{ t('automations.fields.trigger') }}</span><select v-model="form.triggerType" data-testid="automation-trigger"><option value="api">{{ t('automations.scheduleBuilder.api') }}</option><option value="once">{{ t('automations.scheduleBuilder.once') }}</option><option value="schedule">{{ t('automations.scheduleBuilder.recurring') }}</option></select><small>{{ t(`automations.scheduleBuilder.${form.triggerType}Help`) }}</small></label>
        <template v-if="form.triggerType === 'once'"><label><span>{{ t('automations.scheduleBuilder.runAt') }}</span><input v-model="form.onceRunAt" data-testid="automation-once-run-at" type="datetime-local" /></label><label><span>{{ t('automations.fields.timeZone') }}</span><input :value="form.timeZone" disabled /></label></template>
        <template v-else-if="form.triggerType === 'schedule'"><div class="automation-editor__warning automation-editor__field--full"><strong>{{ t('automations.scheduleBuilder.recurringWarningTitle') }}</strong><p>{{ t('automations.scheduleBuilder.recurringWarning') }}</p></div><label><span>{{ t('automations.scheduleBuilder.frequency') }}</span><select v-model="form.recurrence" data-testid="automation-recurrence"><option value="daily">{{ t('automations.scheduleBuilder.daily') }}</option><option value="weekly">{{ t('automations.scheduleBuilder.weekly') }}</option><option value="monthly">{{ t('automations.scheduleBuilder.monthly') }}</option><option v-if="form.recurrence === 'custom'" value="custom">{{ t('automations.scheduleBuilder.legacyCustom') }}</option></select></label><label v-if="form.recurrence !== 'custom'"><span>{{ t('automations.scheduleBuilder.time') }}</span><input v-model="form.recurrenceTime" data-testid="automation-recurrence-time" type="time" /></label><label v-if="form.recurrence === 'weekly'"><span>{{ t('automations.scheduleBuilder.weekday') }}</span><select v-model.number="form.weeklyDay"><option v-for="day in 7" :key="day - 1" :value="day - 1">{{ t(`automations.scheduleBuilder.weekdays.${day - 1}`) }}</option></select></label><label v-if="form.recurrence === 'monthly'"><span>{{ t('automations.scheduleBuilder.monthDay') }}</span><select v-model.number="form.monthlyDay"><option v-for="day in 28" :key="day" :value="day">{{ day }}</option></select></label><label v-if="form.recurrence === 'custom'"><span>{{ t('automations.scheduleBuilder.legacyCron') }}</span><input :value="form.cron" readonly /></label><label><span>{{ t('automations.fields.timeZone') }}</span><input v-model="form.timeZone" readonly /></label></template>
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
.automation-editor__footer { display: flex; align-items: center; justify-content: space-between; gap: var(--gc-space-4); }
.automation-editor__wizard-header { display: grid; gap: var(--gc-space-4); padding-bottom: var(--gc-space-4); border-bottom: var(--gc-border-width-default) solid var(--gc-color-border); }
.automation-editor__wizard-title { display: grid; gap: var(--gc-space-1); }
.automation-editor__eyebrow { color: var(--gc-color-primary); font-size: var(--gc-font-size-sm); font-weight: var(--gc-font-weight-semibold); }
.automation-editor h3, .automation-editor h4, .automation-editor p { margin: 0; }
.automation-editor h3 { color: var(--gc-color-text); font-size: var(--gc-font-size-xl); }
.automation-editor h4 { color: var(--gc-color-text); font-size: var(--gc-font-size-lg); }
.automation-editor__progress { display: grid; gap: var(--gc-space-3); }
.automation-editor__progress-bar { height: var(--gc-space-1); overflow: hidden; border-radius: var(--gc-radius-full); background: var(--gc-color-border-muted); }
.automation-editor__progress-bar span { display: block; height: 100%; border-radius: inherit; background: var(--gc-color-primary); }
.automation-editor__steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gc-space-2); margin: 0; padding: 0; list-style: none; }
.automation-editor__steps li { position: relative; overflow: hidden; border: var(--gc-border-width-default) solid var(--gc-color-border-muted); border-radius: var(--gc-radius-lg); background: var(--gc-color-surface-panel); box-shadow: var(--gc-shadow-sm); }
.automation-editor__steps li::before { position: absolute; inset: 0 auto 0 0; width: var(--gc-space-1); background: transparent; content: ''; }
.automation-editor__steps button { display: flex; align-items: center; gap: var(--gc-space-3); width: 100%; min-height: calc(var(--gc-space-10) + var(--gc-space-6)); padding: var(--gc-space-3) var(--gc-space-4); border: 0; background: transparent; color: var(--gc-color-text-muted); font: inherit; text-align: left; cursor: pointer; }
.automation-editor__steps button strong { min-width: 0; color: inherit; font-size: var(--gc-font-size-sm); line-height: var(--gc-line-height-tight); }
.automation-editor__step-index { display: grid; place-items: center; flex: 0 0 var(--gc-space-8); width: var(--gc-space-8); height: var(--gc-space-8); border-radius: var(--gc-radius-full); background: var(--gc-color-surface-raised); color: var(--gc-color-text-muted); font-weight: var(--gc-font-weight-semibold); }
.automation-editor__steps li.is-active { border-color: var(--gc-color-primary-border-strong); background: var(--gc-color-primary-soft); box-shadow: var(--gc-shadow-md); }
.automation-editor__steps li.is-active::before, .automation-editor__steps li.is-done::before { background: var(--gc-color-primary); }
.automation-editor__steps li.is-active button, .automation-editor__steps li.is-done button { color: var(--gc-color-text); }
.automation-editor__steps li.is-active .automation-editor__step-index, .automation-editor__steps li.is-done .automation-editor__step-index { background: var(--gc-color-primary); color: var(--gc-color-text-inverse); }
.automation-editor__steps button:disabled { cursor: not-allowed; opacity: var(--gc-opacity-disabled); }
.automation-editor__panel { display: grid; gap: var(--gc-space-4); min-height: calc(var(--gc-space-10) + var(--gc-space-8) + var(--gc-space-6)); }
.automation-editor__panel > header { display: grid; gap: var(--gc-space-1); }
.automation-editor__panel p, .automation-editor small { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); line-height: var(--gc-line-height-relaxed); }
.automation-editor__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-4); }
.automation-editor label, .automation-editor__field { display: grid; gap: var(--gc-space-2); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.automation-editor__field--full { grid-column: 1 / -1; }
.automation-editor input, .automation-editor textarea, .automation-editor select { width: 100%; padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-solid); color: var(--gc-color-text); font: inherit; }
.automation-editor__domain-picker { position: relative; }
.automation-editor__domain-picker summary { padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-solid); color: var(--gc-color-text); cursor: pointer; list-style: none; }
.automation-editor__domain-picker summary::-webkit-details-marker { display: none; }
.automation-editor__domain-picker summary::after { float: right; content: '⌄'; color: var(--gc-color-text-muted); }
.automation-editor__domain-picker[open] summary { border-color: var(--gc-color-primary); border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
.automation-editor__domain-picker.is-disabled summary { cursor: not-allowed; opacity: var(--gc-opacity-disabled); }
.automation-editor__domain-options { position: absolute; display: grid; width: 100%; max-height: calc(var(--gc-space-10) * 5); overflow-y: auto; padding: var(--gc-space-2); border: var(--gc-border-width-default) solid var(--gc-color-primary); border-top: 0; border-radius: 0 0 var(--gc-radius-md) var(--gc-radius-md); background: var(--gc-color-surface-solid); box-shadow: var(--gc-shadow-md); }
.automation-editor__domain-option { display: flex !important; grid-template-columns: auto 1fr; align-items: center; padding: var(--gc-space-2); border-radius: var(--gc-radius-sm); color: var(--gc-color-text) !important; }
.automation-editor__domain-option:hover { background: var(--gc-color-surface-raised); }
.automation-editor__domain-option input { width: auto; }
.automation-editor textarea, .automation-editor select[multiple] { min-height: calc(var(--gc-space-10) + var(--gc-space-8)); resize: vertical; }
.automation-editor__summary, .automation-editor__review { display: grid; gap: var(--gc-space-2); padding: var(--gc-space-4); border: var(--gc-border-width-default) solid var(--gc-color-info-border); border-radius: var(--gc-radius-md); background: var(--gc-color-info-soft); }
.automation-editor__warning { display: grid; gap: var(--gc-space-2); padding: var(--gc-space-4); border: var(--gc-border-width-default) solid var(--gc-color-warning-border); border-radius: var(--gc-radius-md); background: var(--gc-color-warning-soft); color: var(--gc-color-text); }
.automation-editor__chain { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gc-space-2); margin: 0; padding: 0; list-style: none; }
.automation-editor__chain li { display: flex; align-items: center; gap: var(--gc-space-2); padding: var(--gc-space-3); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-solid); color: var(--gc-color-text); }
.automation-editor__chain li > strong { display: grid; place-items: center; min-width: var(--gc-space-6); min-height: var(--gc-space-6); border-radius: var(--gc-radius-full); background: var(--gc-color-primary); color: var(--gc-color-text-inverse); }
.automation-editor__check { display: flex !important; align-items: center; }
.automation-editor__check input { width: auto; }
.automation-editor__footer { padding-top: var(--gc-space-4); border-top: var(--gc-border-width-default) solid var(--gc-color-border); }
.automation-editor__footer > div { display: flex; gap: var(--gc-space-2); }
@media (max-width: 900px) { .automation-editor__wizard-header { align-items: stretch; flex-direction: column; } .automation-editor__steps, .automation-editor__grid, .automation-editor__chain { grid-template-columns: 1fr; } .automation-editor__footer { align-items: stretch; flex-direction: column; } .automation-editor__footer > div { justify-content: flex-end; } }
</style>
