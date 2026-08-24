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

watch(() => props.automation, (automation) => {
  if (!automation) return
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
}, { immediate: true })

const domains = computed(() => form.certificateDomains.split(',').map((item) => item.trim()).filter(Boolean))
const versionOptions = ref<Array<{ id: string; label: string }>>([])
const versionsLoading = ref(false)
const versionsLoadFailed = ref(false)
const valid = computed(() => Boolean(form.name.trim() && domains.value.length && form.maxTargets > 0 && form.concurrency > 0 && form.concurrency <= form.maxTargets && (form.versionSelection === 'latest' || form.certificateVersionIds.length)))

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

function submit() {
  if (!valid.value) return
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
    <section class="automation-editor__section automation-editor__section--full">
      <header><h3>{{ t('automations.editor.sections.basic') }}</h3><p>{{ t('automations.editor.sections.basicHelp') }}</p></header>
      <div class="automation-editor__grid">
        <label><span>{{ t('automations.fields.name') }}</span><input v-model="form.name" /></label>
        <label><span>{{ t('automations.fields.description') }}</span><textarea v-model="form.description" /></label>
      </div>
    </section>

    <section class="automation-editor__section automation-editor__section--full">
      <header><h3>{{ t('automations.editor.sections.targets') }}</h3><p>{{ t('automations.editor.sections.targetsHelp') }}</p></header>
      <div class="automation-editor__notice">
        <strong>{{ t('automations.form.existingAssetTitle') }}</strong>
        <p>{{ t('automations.form.existingAssetDescription') }}</p>
      </div>
      <div class="automation-editor__grid">
        <label class="automation-editor__field--full">
          <span>{{ t('automations.form.certificateDomains') }}</span>
          <input v-model="form.certificateDomains" data-testid="automation-certificate-domains" :placeholder="t('automations.form.certificateDomainsPlaceholder')" />
          <small>{{ t('automations.form.certificateDomainsHelp') }}</small>
        </label>
        <label>
          <span>{{ t('automations.form.versionSelection') }}</span>
          <select v-model="form.versionSelection" data-testid="automation-version-selection">
            <option value="latest">{{ t('automations.form.versionSelectionLatest') }}</option>
            <option value="specific">{{ t('automations.form.versionSelectionSpecific') }}</option>
          </select>
          <small>{{ t('automations.form.versionSelectionHelp') }}</small>
        </label>
        <label v-if="form.versionSelection === 'specific'">
          <span>{{ t('automations.form.certificateVersionIds') }}</span>
          <select v-model="form.certificateVersionIds" data-testid="automation-certificate-version-ids" multiple>
            <option v-for="option in versionOptions" :key="option.id" :value="option.id">{{ option.label }}</option>
          </select>
          <small>{{ t('automations.form.certificateVersionIdsHelp') }}</small>
          <small v-if="versionsLoading">{{ t('automations.form.versionLoading') }}</small>
          <small v-else-if="versionsLoadFailed">{{ t('automations.form.versionLoadFailed') }}</small>
          <small v-else-if="versionOptions.length === 0">{{ t('automations.form.versionEmpty') }}</small>
        </label>
      </div>
    </section>

    <section class="automation-editor__section automation-editor__section--full">
      <header><h3>{{ t('automations.form.schedule') }}</h3><p>{{ t('automations.form.scheduleHelp') }}</p></header>
      <div class="automation-editor__grid">
        <label><span>{{ t('automations.fields.trigger') }}</span><select v-model="form.triggerType" data-testid="automation-trigger"><option value="on_demand">{{ t('automations.triggers.onDemand') }}</option><option value="schedule">{{ t('automations.triggers.schedule') }}</option></select></label>
        <template v-if="form.triggerType === 'schedule'">
          <label><span>{{ t('automations.fields.cron') }}</span><input v-model="form.cron" /></label>
          <label><span>{{ t('automations.fields.timeZone') }}</span><input v-model="form.timeZone" /></label>
        </template>
      </div>
    </section>

    <section class="automation-editor__section automation-editor__section--full">
      <header><h3>{{ t('automations.form.execution') }}</h3><p>{{ t('automations.form.executionHelp') }}</p></header>
      <ol class="automation-editor__chain">
        <li><strong>1</strong><span>{{ t('automations.form.snapshot') }}</span></li>
        <li><strong>2</strong><span>{{ t('automations.editor.chain.createPlan') }}</span></li>
        <li v-if="form.requireDryRun"><strong>3</strong><span>{{ t('automations.editor.chain.dryRun') }}</span></li>
        <li v-if="form.requireApproval"><strong>4</strong><span>{{ t('automations.editor.chain.approval') }}</span></li>
        <li><strong>5</strong><span>{{ t('automations.editor.chain.executePlan') }}</span></li>
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
.automation-editor select[multiple] { min-height: calc(var(--gc-space-10) + var(--gc-space-8)); }
.automation-editor__notice { padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-info-border); border-radius: var(--gc-radius-md); background: var(--gc-color-info-soft); color: var(--gc-color-text); }
.automation-editor__notice p { margin: var(--gc-space-1) 0 0; }
.automation-editor__chain { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: var(--gc-space-2); margin: 0; padding: 0; list-style: none; }
.automation-editor__chain li { display: flex; align-items: center; gap: var(--gc-space-2); padding: var(--gc-space-3); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-raised); color: var(--gc-color-text); }
.automation-editor__chain strong { display: grid; place-items: center; min-width: var(--gc-space-6); min-height: var(--gc-space-6); border-radius: var(--gc-radius-md); background: var(--gc-color-info); color: var(--gc-color-text-inverse); }
.automation-editor__check { display: flex !important; align-items: center; }
.automation-editor__check input { width: auto; }
.automation-editor footer { grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: var(--gc-space-3); }
@media (max-width: 760px) { .automation-editor__grid, .automation-editor__chain { grid-template-columns: 1fr; } }
</style>
