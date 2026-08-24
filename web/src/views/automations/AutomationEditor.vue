<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { listAssets } from '@/api/modules/assets.api'
import type { AutomationConfiguration, AutomationRecord } from '@/api/modules/automations.api'
import { listCertificates, listCertificateVersions } from '@/api/modules/certificates.api'
import type { ApiRecord } from '@/api/modules/common'

const props = defineProps<{ automation?: AutomationRecord | null }>()
const emit = defineEmits<{ save: [payload: AutomationConfiguration & { name: string; description?: string }]; cancel: [] }>()
const { t } = useI18n()

type EditorTriggerType = 'api' | 'once' | 'schedule' | 'certificate_version_created'
type TargetScopeMode = 'all_related_assets' | 'selected_assets'
const AUTOMATION_MAX_TARGETS_PER_RUN = 5000

const form = reactive({
  name: '',
  description: '',
  triggerType: 'certificate_version_created' as EditorTriggerType,
  onceRunAt: defaultOnceRunAt(),
  recurrence: 'daily',
  recurrenceTime: '02:00',
  weeklyDay: 1,
  monthlyDay: 1,
  cron: '0 2 * * *',
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  certificateSources: ['acme', 'manual_import'] as Array<'acme' | 'manual_import'>,
  targetScopeMode: 'all_related_assets' as TargetScopeMode,
  selectedAssetIds: [] as string[],
  certificateDomains: [] as string[],
  versionSelection: 'latest' as 'latest' | 'specific',
  certificateVersionIds: [] as string[],
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
let certificateAssetsRequest: Promise<void> | null = null

const applicationAssets = ref<ApiRecord[]>([])
const applicationAssetOptions = ref<Array<{ value: string; label: string }>>([])
const applicationAssetsLoading = ref(false)
const applicationAssetsLoadFailed = ref(false)
let applicationAssetsRequest: Promise<void> | null = null
const availableAssetSelection = ref<string[]>([])
const selectedAssetSelection = ref<string[]>([])

const versionOptions = ref<Array<{ id: string; label: string }>>([])
const versionsLoading = ref(false)
const versionsLoadFailed = ref(false)

const CERTIFICATE_ASSET_PAGE_SIZE = 200
const APPLICATION_ASSET_PAGE_SIZE = 200

const isEventTrigger = computed(() => form.triggerType === 'certificate_version_created')
const currentStepTitle = computed(() => {
  if (currentStep.value === 1) return t('automations.fields.trigger')
  if (currentStep.value === 2) return t('automations.editor.sections.execution')
  return t('automations.editor.sections.guardrails')
})
const triggerHelpKey = computed(() => {
  if (form.triggerType === 'certificate_version_created') return 'automations.scheduleBuilder.certificateVersionCreatedHelp'
  if (form.triggerType === 'schedule') return 'automations.scheduleBuilder.recurringHelp'
  if (form.triggerType === 'once') return 'automations.scheduleBuilder.onceHelp'
  return 'automations.scheduleBuilder.apiHelp'
})
const domains = computed(() => form.certificateDomains.map((item) => normalizeDomain(item)).filter(Boolean))
const selectedAssetsSummary = computed(() => {
  if (form.targetScopeMode === 'all_related_assets') return t('automations.targetScopes.allRelatedAssets')
  if (form.selectedAssetIds.length === 0) return t('automations.fields.selectedAssetsHelp')
  return form.selectedAssetIds
    .map((id) => applicationAssetOptions.value.find((item) => item.value === id)?.label ?? id)
    .join('、')
})
const selectedApplicationAssetOptions = computed(() => (
  form.selectedAssetIds
    .map((id) => applicationAssetOptions.value.find((item) => item.value === id))
    .filter((item): item is { value: string; label: string } => Boolean(item))
))
const availableApplicationAssetOptions = computed(() => (
  filteredApplicationAssetOptions.value.filter((option) => !form.selectedAssetIds.includes(option.value))
))
const selectedDomainSummary = computed(() => domains.value.length ? domains.value.join(', ') : t('automations.common.allRelated'))
const generatedAutomationName = computed(() => {
  const triggerLabelKey = form.triggerType === 'certificate_version_created'
    ? 'automations.scheduleBuilder.certificateVersionCreated'
    : form.triggerType === 'schedule'
      ? 'automations.scheduleBuilder.recurring'
      : form.triggerType === 'once'
        ? 'automations.scheduleBuilder.once'
        : 'automations.scheduleBuilder.api'
  const segments = [selectedDomainSummary.value, t(triggerLabelKey)]
  if (form.targetScopeMode === 'selected_assets') segments.push(t('automations.targetScopes.selectedAssets'))
  return segments.join(' · ')
})
const filteredApplicationAssetOptions = computed(() => {
  if (domains.value.length === 0) return applicationAssetOptions.value
  const selectedDomainSet = new Set(domains.value)
  const matchedAssetIds = new Set(
    applicationAssets.value
      .filter((asset) => assetMatchesSelectedDomains(asset, selectedDomainSet))
      .map((asset) => readString(asset, 'id'))
      .filter(Boolean),
  )
  if (matchedAssetIds.size === 0) return applicationAssetOptions.value
  return applicationAssetOptions.value.filter((option) => matchedAssetIds.has(option.value))
})
const stepProgressWidth = computed(() => `${(currentStep.value / 3) * 100}%`)
const legacyScopeAnchored = computed(() => (
  domains.value.length > 0
  || form.selectedAssetIds.length > 0
))
const triggerReady = computed(() => {
  if (form.triggerType === 'api') return true
  if (form.triggerType === 'once') return Boolean(form.onceRunAt && new Date(form.onceRunAt) > new Date())
  if (form.triggerType === 'schedule') {
    return Boolean(form.recurrenceTime && form.timeZone.trim() && (form.recurrence !== 'custom' || form.cron.trim()))
  }
  return form.certificateSources.length > 0
})
const executionReady = computed(() => {
  if (form.targetScopeMode === 'selected_assets' && form.selectedAssetIds.length === 0) return false
  return true
})
const valid = computed(() => {
  if (!(form.concurrency > 0 && form.concurrency <= AUTOMATION_MAX_TARGETS_PER_RUN)) return false
  if (!(form.failureCount > 0 && form.failureCount <= AUTOMATION_MAX_TARGETS_PER_RUN)) return false
  if (!triggerReady.value || !executionReady.value) return false
  if (!isEventTrigger.value && form.versionSelection === 'specific' && form.certificateVersionIds.length === 0) return false
  if (!isEventTrigger.value && !legacyScopeAnchored.value) return false
  return true
})

watch(() => props.automation, (automation) => {
  if (!automation) {
    resetForm()
    return
  }

  const trigger = automation.configuration.trigger
  const selector = automation.configuration.targetResolver?.type === 'legacy_target_selector'
    ? (automation.configuration.targetResolver.selector ?? {})
    : (automation.configuration.targetSelector ?? {})
  const filters = automation.configuration.filters ?? []
  const selectedAssetIds = readStringArray(
    filters.find((item) => item.field === 'target.assetId')?.value,
    selector.assetIds ?? [],
  )
  const eventDomains = readStringArray(filters.find((item) => item.field === 'event.domains')?.value)

  Object.assign(form, {
    name: automation.name,
    description: automation.description ?? '',
    triggerType: trigger.type === 'on_demand' ? 'api' : trigger.type,
    onceRunAt: trigger.type === 'once' ? toLocalDateTimeInput(trigger.runAt) : defaultOnceRunAt(),
    cron: trigger.type === 'schedule' ? trigger.cron : '0 2 * * *',
    timeZone: trigger.type === 'schedule' ? trigger.timeZone : Intl.DateTimeFormat().resolvedOptions().timeZone,
    certificateSources: trigger.type === 'certificate_version_created' ? [...(trigger.sources ?? ['acme', 'manual_import'])] : ['acme', 'manual_import'],
    targetScopeMode: selectedAssetIds.length > 0 ? 'selected_assets' : 'all_related_assets',
    selectedAssetIds,
    certificateDomains: (selector.certificateDomains ?? eventDomains).map(normalizeDomain),
    versionSelection: selector.certificateVersionSelection ?? 'latest',
    certificateVersionIds: [...(selector.certificateVersionIds ?? [])],
    concurrency: automation.configuration.guardrails.concurrencyLimit,
    requireDryRun: automation.configuration.guardrails.requireDryRun,
    requireApproval: automation.configuration.guardrails.requireApproval,
    failureCount: automation.configuration.guardrails.failureCountThreshold ?? 3,
  })

  if (trigger.type === 'schedule') applyCronToForm(trigger.cron)
  currentStep.value = 1
}, { immediate: true })

watch([() => form.versionSelection, () => form.certificateDomains], () => {
  if (!isEventTrigger.value && form.versionSelection === 'specific') void loadVersionOptions()
}, { immediate: true })

watch(isEventTrigger, (enabled) => {
  if (enabled) {
    form.versionSelection = 'latest'
    form.certificateVersionIds = []
  }
})

watch(() => form.targetScopeMode, (mode) => {
  if (mode !== 'selected_assets') {
    availableAssetSelection.value = []
    selectedAssetSelection.value = []
  }
})

watch(() => form.selectedAssetIds, () => {
  const selectedIdSet = new Set(form.selectedAssetIds)
  availableAssetSelection.value = availableAssetSelection.value.filter((id) => !selectedIdSet.has(id))
  selectedAssetSelection.value = selectedAssetSelection.value.filter((id) => selectedIdSet.has(id))
}, { deep: true })

void loadCertificateAssets()
void loadApplicationAssets()

function resetForm() {
  Object.assign(form, {
    name: '',
    description: '',
    triggerType: 'certificate_version_created',
    onceRunAt: defaultOnceRunAt(),
    recurrence: 'daily',
    recurrenceTime: '02:00',
    weeklyDay: 1,
    monthlyDay: 1,
    cron: '0 2 * * *',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    certificateSources: ['acme', 'manual_import'],
    targetScopeMode: 'all_related_assets',
    selectedAssetIds: [],
    certificateDomains: [],
    versionSelection: 'latest',
    certificateVersionIds: [],
    concurrency: 5,
    requireDryRun: true,
    requireApproval: true,
    failureCount: 3,
  })
  currentStep.value = 1
}

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

function loadApplicationAssets(): Promise<void> {
  if (applicationAssetsRequest) return applicationAssetsRequest

  applicationAssetsRequest = (async () => {
    applicationAssetsLoading.value = true
    applicationAssetsLoadFailed.value = false
    try {
      applicationAssets.value = await loadAllApplicationAssets()
      applicationAssetOptions.value = applicationAssets.value
        .map((asset) => {
          const value = readString(asset, 'id')
          if (!value) return null
          const environment = readString(asset, 'environment')
          const baseLabel = readString(asset, 'displayName')
            || readString(asset, 'address')
            || readString(asset, 'domainName')
            || readString(asset, 'name')
            || value
          return {
            value,
            label: environment ? `${baseLabel} · ${environment}` : baseLabel,
          }
        })
        .filter((item): item is { value: string; label: string } => Boolean(item))
        .sort((left, right) => left.label.localeCompare(right.label))
    } catch {
      applicationAssets.value = []
      applicationAssetOptions.value = []
      applicationAssetsLoadFailed.value = true
    } finally {
      applicationAssetsLoading.value = false
      applicationAssetsRequest = null
    }
  })()

  return applicationAssetsRequest
}

async function loadAllApplicationAssets(): Promise<ApiRecord[]> {
  const records: ApiRecord[] = []
  let page = 1

  while (true) {
    const result = await listAssets({ page, pageSize: APPLICATION_ASSET_PAGE_SIZE, sort: 'updatedAt:desc' })
    const response = result.data
    const items = [...(response?.items ?? [])]
    records.push(...items)

    if (!response || records.length >= response.total || items.length < APPLICATION_ASSET_PAGE_SIZE) return records
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
    if (matchedAssets.length === 0) {
      versionOptions.value = []
      form.certificateVersionIds = []
      return
    }
    const versionResults = await Promise.all(matchedAssets.map((asset) => listCertificateVersions({
      page: 1,
      pageSize: 100,
      sort: 'versionNo:desc',
      filters: { certificateAssetId: readString(asset, 'id') },
    })))
    versionOptions.value = versionResults
      .flatMap((result, index) => (result.data?.items ?? []).map((version) => ({
        id: readString(version, 'id'),
        label: `${readString(matchedAssets[index], 'primaryDomain') || readString(matchedAssets[index], 'name')} · ${readString(version, 'versionNo') || readString(version, 'id')}`,
      })))
      .filter((option) => option.id)
    const availableVersionIds = new Set(versionOptions.value.map((option) => option.id))
    form.certificateVersionIds = form.certificateVersionIds.filter((id) => availableVersionIds.has(id))
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

function readStringArray(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return [...fallback]
  return value.map((item) => typeof item === 'string' || typeof item === 'number' ? String(item) : '').filter(Boolean)
}

function assetMatchesSelectedDomains(asset: ApiRecord, selectedDomainSet: Set<string>): boolean {
  const candidates = new Set<string>()
  const pushCandidate = (value: unknown) => {
    if (typeof value !== 'string' && typeof value !== 'number') return
    const normalized = normalizeDomain(String(value))
    if (normalized) candidates.add(normalized)
  }

  pushCandidate(asset.primaryDomain)
  pushCandidate(asset.domainName)
  pushCandidate(asset.address)

  const targetBindingDetail = typeof asset.targetBindingDetail === 'object' && asset.targetBindingDetail
    ? asset.targetBindingDetail as ApiRecord
    : undefined
  const certificateBindings = Array.isArray(targetBindingDetail?.certificateBindings)
    ? targetBindingDetail.certificateBindings as ApiRecord[]
    : []
  certificateBindings.forEach((binding) => {
    pushCandidate(binding.domainName)
    pushCandidate(binding.domain)
  })

  if (candidates.size === 0) return false
  return [...selectedDomainSet].some((domain) => candidates.has(domain))
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
  if (form.triggerType === 'certificate_version_created') return { type: 'certificate_version_created', sources: [...form.certificateSources] }
  return { type: 'api' }
}

function buildTargetResolver(): NonNullable<AutomationConfiguration['targetResolver']> {
  if (isEventTrigger.value) return { type: 'certificate_version_targets' }
  return {
    type: 'legacy_target_selector',
    selector: {
      ...(domains.value.length ? { certificateDomains: [...domains.value] } : {}),
      ...(form.targetScopeMode === 'selected_assets' && form.selectedAssetIds.length ? { assetIds: [...form.selectedAssetIds] } : {}),
      certificateVersionSelection: form.versionSelection,
      ...(form.versionSelection === 'specific' ? { certificateVersionIds: [...form.certificateVersionIds] } : {}),
    },
  }
}

function buildFilters(): NonNullable<AutomationConfiguration['filters']> {
  const filters: NonNullable<AutomationConfiguration['filters']> = []
  if (!isEventTrigger.value) return filters
  if (form.certificateSources.length) filters.push({ field: 'event.sourceType', operator: 'in', value: [...form.certificateSources] })
  if (domains.value.length) filters.push({ field: 'event.domains', operator: 'contains_any', value: [...domains.value] })
  if (form.targetScopeMode === 'selected_assets' && form.selectedAssetIds.length) filters.push({ field: 'target.assetId', operator: 'in', value: [...form.selectedAssetIds] })
  return filters
}

function toggleDomain(domain: string) {
  form.certificateDomains = domains.value.includes(domain)
    ? domains.value.filter((item) => item !== domain)
    : [...domains.value, domain]
}

function toggleCertificateSource(source: 'acme' | 'manual_import') {
  form.certificateSources = form.certificateSources.includes(source)
    ? form.certificateSources.filter((item) => item !== source)
    : [...form.certificateSources, source]
}

function toggleAvailableAssetSelection(assetId: string) {
  availableAssetSelection.value = availableAssetSelection.value.includes(assetId)
    ? availableAssetSelection.value.filter((item) => item !== assetId)
    : [...availableAssetSelection.value, assetId]
}

function toggleChosenAssetSelection(assetId: string) {
  selectedAssetSelection.value = selectedAssetSelection.value.includes(assetId)
    ? selectedAssetSelection.value.filter((item) => item !== assetId)
    : [...selectedAssetSelection.value, assetId]
}

function moveAssetsToSelected() {
  if (availableAssetSelection.value.length === 0) return
  const nextIds = [...form.selectedAssetIds]
  availableAssetSelection.value.forEach((assetId) => {
    if (!nextIds.includes(assetId)) nextIds.push(assetId)
  })
  form.selectedAssetIds = nextIds
  availableAssetSelection.value = []
}

function removeAssetsFromSelected() {
  if (selectedAssetSelection.value.length === 0) return
  const removingIds = new Set(selectedAssetSelection.value)
  form.selectedAssetIds = form.selectedAssetIds.filter((assetId) => !removingIds.has(assetId))
  selectedAssetSelection.value = []
}

function clearSelectedAssets() {
  form.selectedAssetIds = []
  availableAssetSelection.value = []
  selectedAssetSelection.value = []
}

function goToStep(step: 1 | 2 | 3) {
  if (step === 1) {
    currentStep.value = 1
    return
  }
  if (step === 2 && triggerReady.value) {
    currentStep.value = 2
    return
  }
  if (step === 3 && triggerReady.value && executionReady.value) currentStep.value = 3
}

function goNext() {
  if (currentStep.value === 1 && triggerReady.value) currentStep.value = 2
  else if (currentStep.value === 2 && executionReady.value) currentStep.value = 3
}

function goPrevious() {
  if (currentStep.value > 1) currentStep.value = (currentStep.value - 1) as 1 | 2 | 3
}

function submit() {
  if (!valid.value || currentStep.value !== 3) return
  const targetResolver = buildTargetResolver()
  const targetSelector = targetResolver.type === 'legacy_target_selector' ? (targetResolver.selector ?? {}) : undefined
  emit('save', {
    name: form.name.trim() || generatedAutomationName.value,
    description: form.description.trim() || undefined,
    trigger: buildTrigger(),
    filters: buildFilters(),
    targetResolver,
    targetSelector,
    approvalStage: form.requireApproval ? { type: 'run', mode: 'before_actions', operationType: 'automation.run.approve', riskLevel: 'high' } : undefined,
    actions: [
      { type: 'create_deployment_plan', position: 1, config: { planType: 'UPDATE', selectionMode: 'EXPLICIT' } },
      { type: 'execute_deployment_plan', position: 2, config: { source: 'created_by_previous_action', dryRunFirst: form.requireDryRun } },
    ],
    guardrails: {
      maxTargetsPerRun: AUTOMATION_MAX_TARGETS_PER_RUN,
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
        <h3>{{ currentStepTitle }}</h3>
      </div>
      <div class="automation-editor__progress">
        <div class="automation-editor__progress-bar" aria-hidden="true"><span :style="{ width: stepProgressWidth }"></span></div>
        <ol class="automation-editor__steps" :aria-label="t('automations.formStep.stepProgress', { current: currentStep, total: 3 })">
          <li :class="{ 'is-active': currentStep === 1, 'is-done': currentStep > 1 }">
            <button type="button" @click="goToStep(1)">
              <span class="automation-editor__step-index">1</span>
              <strong>{{ t('automations.fields.trigger') }}</strong>
            </button>
          </li>
          <li :class="{ 'is-active': currentStep === 2, 'is-done': currentStep > 2 }">
            <button type="button" :disabled="!triggerReady" @click="goToStep(2)">
              <span class="automation-editor__step-index">2</span>
              <strong>{{ t('automations.editor.sections.execution') }}</strong>
            </button>
          </li>
          <li :class="{ 'is-active': currentStep === 3 }">
            <button type="button" :disabled="!triggerReady || !executionReady" @click="goToStep(3)">
              <span class="automation-editor__step-index">3</span>
              <strong>{{ t('automations.editor.sections.guardrails') }}</strong>
            </button>
          </li>
        </ol>
      </div>
    </header>

    <section v-if="currentStep === 1" class="automation-editor__panel">
      <header>
        <h4>{{ t('automations.fields.trigger') }}</h4>
        <p>{{ t('automations.editor.sections.triggerHelp') }}</p>
      </header>
      <div class="automation-editor__grid">
        <label class="automation-editor__field--full">
          <span>{{ t('automations.fields.trigger') }}</span>
          <select v-model="form.triggerType" data-testid="automation-trigger">
            <option value="certificate_version_created">{{ t('automations.scheduleBuilder.certificateVersionCreated') }}</option>
            <option value="api">{{ t('automations.scheduleBuilder.api') }}</option>
            <option value="once">{{ t('automations.scheduleBuilder.once') }}</option>
            <option value="schedule">{{ t('automations.scheduleBuilder.recurring') }}</option>
          </select>
          <small>{{ t(triggerHelpKey) }}</small>
        </label>

        <template v-if="form.triggerType === 'once'">
          <label>
            <span>{{ t('automations.scheduleBuilder.runAt') }}</span>
            <input v-model="form.onceRunAt" data-testid="automation-once-run-at" type="datetime-local" />
          </label>
        </template>

        <template v-else-if="form.triggerType === 'schedule'">
          <div class="automation-editor__warning automation-editor__field--full">
            <strong>{{ t('automations.scheduleBuilder.recurringWarningTitle') }}</strong>
            <p>{{ t('automations.scheduleBuilder.recurringWarning') }}</p>
          </div>
          <label>
            <span>{{ t('automations.scheduleBuilder.frequency') }}</span>
            <select v-model="form.recurrence" data-testid="automation-recurrence">
              <option value="daily">{{ t('automations.scheduleBuilder.daily') }}</option>
              <option value="weekly">{{ t('automations.scheduleBuilder.weekly') }}</option>
              <option value="monthly">{{ t('automations.scheduleBuilder.monthly') }}</option>
              <option v-if="form.recurrence === 'custom'" value="custom">{{ t('automations.scheduleBuilder.legacyCustom') }}</option>
            </select>
          </label>
          <label v-if="form.recurrence !== 'custom'">
            <span>{{ t('automations.scheduleBuilder.time') }}</span>
            <input v-model="form.recurrenceTime" data-testid="automation-recurrence-time" type="time" />
          </label>
          <label v-if="form.recurrence === 'weekly'">
            <span>{{ t('automations.scheduleBuilder.weekday') }}</span>
            <select v-model.number="form.weeklyDay" data-testid="automation-weekday">
              <option v-for="day in 7" :key="day - 1" :value="day - 1">{{ t(`automations.scheduleBuilder.weekdays.${day - 1}`) }}</option>
            </select>
          </label>
          <label v-if="form.recurrence === 'monthly'">
            <span>{{ t('automations.scheduleBuilder.monthDay') }}</span>
            <select v-model.number="form.monthlyDay" data-testid="automation-monthday">
              <option v-for="day in 28" :key="day" :value="day">{{ day }}</option>
            </select>
          </label>
          <label v-if="form.recurrence === 'custom'">
            <span>{{ t('automations.scheduleBuilder.legacyCron') }}</span>
            <input :value="form.cron" readonly />
          </label>
          <label>
            <span>{{ t('automations.fields.timeZone') }}</span>
            <input v-model="form.timeZone" readonly />
          </label>
        </template>

        <template v-else-if="form.triggerType === 'certificate_version_created'">
          <div class="automation-editor__field automation-editor__field--full">
            <span>{{ t('automations.fields.eventSources') }}</span>
            <div class="automation-editor__checkbox-grid">
              <label class="automation-editor__check">
                <input type="checkbox" :checked="form.certificateSources.includes('acme')" @change="toggleCertificateSource('acme')" />
                <span>{{ t('automations.eventSources.acme') }}</span>
              </label>
              <label class="automation-editor__check">
                <input type="checkbox" :checked="form.certificateSources.includes('manual_import')" @change="toggleCertificateSource('manual_import')" />
                <span>{{ t('automations.eventSources.manual_import') }}</span>
              </label>
            </div>
            <small>{{ t('automations.fields.eventSourcesHelp') }}</small>
          </div>
          <div class="automation-editor__summary automation-editor__field--full">
            <strong>{{ t('automations.scheduleBuilder.certificateVersionCreated') }}</strong>
            <p>{{ t('automations.scheduleBuilder.certificateVersionCreatedHelp') }}</p>
          </div>
        </template>

        <div v-else class="automation-editor__summary automation-editor__field--full">
          <strong>{{ t('automations.scheduleBuilder.api') }}</strong>
          <p>{{ t('automations.scheduleBuilder.apiHelp') }}</p>
        </div>
      </div>
    </section>

    <section v-else-if="currentStep === 2" class="automation-editor__panel">
      <header>
        <h4>{{ t('automations.editor.sections.execution') }}</h4>
      </header>

      <div class="automation-editor__grid">
        <div class="automation-editor__field automation-editor__field--full">
          <span>{{ t('automations.form.certificateDomains') }}</span>
          <details class="automation-editor__domain-picker" :class="{ 'is-disabled': certificateAssetsLoading || certificateAssetsLoadFailed }">
            <summary data-testid="automation-certificate-domains" @click="(certificateAssetsLoading || certificateAssetsLoadFailed) && $event.preventDefault()">{{ selectedDomainSummary }}</summary>
            <div class="automation-editor__domain-options" role="group" :aria-label="t('automations.form.certificateDomains')">
              <label v-for="option in certificateDomainOptions" :key="option.value" class="automation-editor__domain-option">
                <input
                  data-testid="automation-certificate-domain-option"
                  type="checkbox"
                  :checked="domains.includes(option.value)"
                  :value="option.value"
                  @change="toggleDomain(option.value)"
                />
                <span>{{ option.label }}</span>
              </label>
            </div>
          </details>
          <small>{{ t('automations.form.certificateDomainsHelp') }}</small>
          <small v-if="certificateAssetsLoading">{{ t('certificates.detailPanel.states.loading') }}</small>
          <small v-else-if="certificateAssetsLoadFailed">{{ t('certificates.list.assets.loadFailed') }}</small>
          <small v-else-if="certificateDomainOptions.length === 0">{{ t('certificates.list.assets.empty') }}</small>
        </div>

        <label v-if="!isEventTrigger">
          <span>{{ t('automations.form.versionSelection') }}</span>
          <select v-model="form.versionSelection" data-testid="automation-version-selection">
            <option value="latest">{{ t('automations.form.versionSelectionLatest') }}</option>
            <option value="specific">{{ t('automations.form.versionSelectionSpecific') }}</option>
          </select>
          <small>{{ t('automations.form.versionSelectionHelp') }}</small>
        </label>
      </div>

      <div class="automation-editor__field">
        <span>{{ t('automations.fields.targetScope') }}</span>
        <div class="automation-editor__scope-grid" role="radiogroup" :aria-label="t('automations.fields.targetScope')">
          <button
            type="button"
            class="automation-editor__scope-card"
            :class="{ 'is-active': form.targetScopeMode === 'all_related_assets' }"
            data-testid="automation-scope-all-related"
            @click="form.targetScopeMode = 'all_related_assets'"
          >
            <strong>{{ t('automations.targetScopes.allRelatedAssets') }}</strong>
            <span>{{ t('automations.targetScopes.allRelatedAssetsHelp') }}</span>
          </button>
          <button
            type="button"
            class="automation-editor__scope-card"
            :class="{ 'is-active': form.targetScopeMode === 'selected_assets' }"
            data-testid="automation-scope-selected-assets"
            @click="form.targetScopeMode = 'selected_assets'"
          >
            <strong>{{ t('automations.targetScopes.selectedAssets') }}</strong>
            <span>{{ t('automations.targetScopes.selectedAssetsHelp') }}</span>
          </button>
        </div>
      </div>

      <label v-if="form.targetScopeMode === 'selected_assets'" class="automation-editor__field--full">
        <span>{{ t('automations.fields.selectedAssets') }}</span>
        <div class="automation-editor__transfer" data-testid="automation-selected-assets">
          <section class="automation-editor__transfer-panel">
            <header>
              <strong>{{ t('automations.assetPicker.available') }}</strong>
              <span>{{ availableApplicationAssetOptions.length }}</span>
            </header>
            <div class="automation-editor__asset-picker">
              <label
                v-for="option in availableApplicationAssetOptions"
                :key="option.value"
                class="automation-editor__asset-option"
                :class="{ 'is-selected': availableAssetSelection.includes(option.value) }"
              >
                <input
                  :checked="availableAssetSelection.includes(option.value)"
                  data-testid="automation-available-asset-option"
                  type="checkbox"
                  :value="option.value"
                  @change="toggleAvailableAssetSelection(option.value)"
                />
                <span>{{ option.label }}</span>
              </label>
              <p v-if="availableApplicationAssetOptions.length === 0" class="automation-editor__empty">
                {{ t('automations.assetPicker.emptyAvailable') }}
              </p>
            </div>
          </section>

          <div class="automation-editor__transfer-actions">
            <button
              class="gc-button gc-button--primary"
              type="button"
              data-testid="automation-transfer-add"
              :disabled="availableAssetSelection.length === 0"
              @click="moveAssetsToSelected"
            >
              {{ t('automations.assetPicker.add') }}
            </button>
            <button
              class="gc-button"
              type="button"
              data-testid="automation-transfer-remove"
              :disabled="selectedAssetSelection.length === 0"
              @click="removeAssetsFromSelected"
            >
              {{ t('automations.assetPicker.remove') }}
            </button>
            <button
              class="gc-button"
              type="button"
              data-testid="automation-transfer-clear"
              :disabled="form.selectedAssetIds.length === 0"
              @click="clearSelectedAssets"
            >
              {{ t('automations.assetPicker.clear') }}
            </button>
          </div>

          <section class="automation-editor__transfer-panel">
            <header>
              <strong>{{ t('automations.assetPicker.selected') }}</strong>
              <span>{{ selectedApplicationAssetOptions.length }}</span>
            </header>
            <div class="automation-editor__asset-picker">
              <label
                v-for="option in selectedApplicationAssetOptions"
                :key="option.value"
                class="automation-editor__asset-option"
                :class="{ 'is-selected': selectedAssetSelection.includes(option.value) }"
              >
                <input
                  :checked="selectedAssetSelection.includes(option.value)"
                  data-testid="automation-chosen-asset-option"
                  type="checkbox"
                  :value="option.value"
                  @change="toggleChosenAssetSelection(option.value)"
                />
                <span>{{ option.label }}</span>
              </label>
              <p v-if="selectedApplicationAssetOptions.length === 0" class="automation-editor__empty">
                {{ t('automations.assetPicker.emptySelected') }}
              </p>
            </div>
          </section>
        </div>
        <small>{{ t('automations.fields.selectedAssetsHelp') }}</small>
        <small v-if="applicationAssetsLoading">{{ t('common.loading') }}</small>
        <small v-else-if="applicationAssetsLoadFailed">{{ t('automations.errors.applicationAssetsLoadFailed') }}</small>
      </label>

      <div v-if="!isEventTrigger" class="automation-editor__summary automation-editor__summary--compact">
        <ol class="automation-editor__chain">
          <li><strong>1</strong><span>{{ t('automations.form.snapshot') }}</span></li>
          <li><strong>2</strong><span>{{ t('automations.editor.chain.createPlan') }}</span></li>
          <li><strong>3</strong><span>{{ t('automations.editor.chain.executePlan') }}</span></li>
        </ol>
      </div>

      <div v-else class="automation-editor__summary automation-editor__summary--compact">
        <p>{{ t('automations.editor.exactVersionFromEvent') }}</p>
      </div>
    </section>

    <section v-else class="automation-editor__panel">
      <header>
        <h4>{{ t('automations.editor.sections.guardrails') }}</h4>
      </header>

      <div class="automation-editor__grid">
        <label v-if="!isEventTrigger && form.versionSelection === 'specific'" class="automation-editor__field--full">
          <span>{{ t('automations.form.certificateVersionIds') }}</span>
          <select v-model="form.certificateVersionIds" data-testid="automation-certificate-version-ids" multiple>
            <option v-for="option in versionOptions" :key="option.id" :value="option.id">{{ option.label }}</option>
          </select>
          <small>{{ t('automations.form.certificateVersionIdsHelp') }}</small>
          <small v-if="versionsLoading">{{ t('automations.form.versionLoading') }}</small>
          <small v-else-if="versionsLoadFailed">{{ t('automations.form.versionLoadFailed') }}</small>
          <small v-else-if="versionOptions.length === 0">{{ t('automations.form.versionEmpty') }}</small>
        </label>

        <label class="automation-editor__field--full">
          <span>{{ t('automations.fields.name') }}</span>
          <input
            v-model="form.name"
            data-testid="automation-name"
            :placeholder="generatedAutomationName"
          />
        </label>

        <label>
          <span>{{ t('automations.fields.concurrency') }}</span>
          <input v-model.number="form.concurrency" type="number" min="1" />
        </label>

        <label>
          <span>{{ t('automations.fields.failureCount') }}</span>
          <input v-model.number="form.failureCount" type="number" min="1" />
        </label>

        <label class="automation-editor__check">
          <input v-model="form.requireDryRun" type="checkbox" />
          <span>{{ t('automations.fields.requireDryRun') }}</span>
        </label>

        <label class="automation-editor__check">
          <input v-model="form.requireApproval" type="checkbox" />
          <span>{{ t('automations.fields.requireApproval') }}</span>
        </label>

        <label class="automation-editor__field--full" data-testid="automation-description-field">
          <span>{{ t('automations.fields.description') }}</span>
          <textarea v-model="form.description" />
        </label>
      </div>

      <div class="automation-editor__review">
        <strong>{{ t('automations.formStep.reviewTitle') }}</strong>
        <p>{{ t('automations.formStep.reviewText', {
          trigger: t(form.triggerType === 'certificate_version_created' ? 'automations.scheduleBuilder.certificateVersionCreated' : form.triggerType === 'schedule' ? 'automations.scheduleBuilder.recurring' : form.triggerType === 'once' ? 'automations.scheduleBuilder.once' : 'automations.scheduleBuilder.api'),
          scope: selectedAssetsSummary,
          domains: selectedDomainSummary,
        }) }}</p>
      </div>
    </section>

    <footer class="automation-editor__footer">
      <button class="gc-button" type="button" @click="emit('cancel')">{{ t('automations.actions.cancel') }}</button>
      <div>
        <button v-if="currentStep > 1" class="gc-button" type="button" data-testid="automation-previous" @click="goPrevious">{{ t('automations.formStep.previous') }}</button>
        <button v-if="currentStep < 3" class="gc-button gc-button--primary" type="button" data-testid="automation-next" :disabled="currentStep === 1 ? !triggerReady : !executionReady" @click="goNext">{{ t('automations.formStep.next') }}</button>
        <button v-else class="gc-button gc-button--primary" type="submit" data-testid="automation-save" :disabled="!valid">{{ t('automations.actions.save') }}</button>
      </div>
    </footer>
  </form>
</template>

<style scoped>
.automation-editor { display: grid; gap: var(--gc-space-4); }
.automation-editor__footer { display: flex; align-items: center; justify-content: space-between; gap: var(--gc-space-4); }
.automation-editor__wizard-header { display: grid; gap: var(--gc-space-3); padding-bottom: var(--gc-space-3); border-bottom: var(--gc-border-width-default) solid var(--gc-color-border); }
.automation-editor__wizard-title { display: grid; gap: var(--gc-space-1); }
.automation-editor__eyebrow { color: var(--gc-color-primary); font-size: var(--gc-font-size-sm); font-weight: var(--gc-font-weight-semibold); }
.automation-editor h3, .automation-editor h4, .automation-editor p { margin: 0; }
.automation-editor h3 { color: var(--gc-color-text); font-size: var(--gc-font-size-xl); }
.automation-editor h4 { color: var(--gc-color-text); font-size: var(--gc-font-size-lg); }
.automation-editor__progress { display: grid; gap: var(--gc-space-2); }
.automation-editor__progress-bar { height: var(--gc-space-1); overflow: hidden; border-radius: var(--gc-radius-full); background: var(--gc-color-border-muted); }
.automation-editor__progress-bar span { display: block; height: 100%; border-radius: inherit; background: var(--gc-color-primary); }
.automation-editor__steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gc-space-2); margin: 0; padding: 0; list-style: none; }
.automation-editor__steps li { position: relative; overflow: hidden; border: var(--gc-border-width-default) solid var(--gc-color-border-muted); border-radius: var(--gc-radius-lg); background: var(--gc-color-surface-panel); box-shadow: var(--gc-shadow-sm); }
.automation-editor__steps li::before { position: absolute; inset: 0 auto 0 0; width: var(--gc-space-1); background: transparent; content: ''; }
.automation-editor__steps button { display: flex; align-items: center; gap: var(--gc-space-2); width: 100%; min-height: calc(var(--gc-space-8) + var(--gc-space-4)); padding: var(--gc-space-2) var(--gc-space-3); border: 0; background: transparent; color: var(--gc-color-text-muted); font: inherit; text-align: left; cursor: pointer; }
.automation-editor__steps button strong { min-width: 0; color: inherit; font-size: var(--gc-font-size-sm); line-height: var(--gc-line-height-tight); }
.automation-editor__step-index { display: grid; place-items: center; flex: 0 0 var(--gc-space-6); width: var(--gc-space-6); height: var(--gc-space-6); border-radius: var(--gc-radius-full); background: var(--gc-color-surface-raised); color: var(--gc-color-text-muted); font-weight: var(--gc-font-weight-semibold); }
.automation-editor__steps li.is-active { border-color: var(--gc-color-primary-border-strong); background: var(--gc-color-primary-soft); box-shadow: var(--gc-shadow-md); }
.automation-editor__steps li.is-active::before, .automation-editor__steps li.is-done::before { background: var(--gc-color-primary); }
.automation-editor__steps li.is-active button, .automation-editor__steps li.is-done button { color: var(--gc-color-text); }
.automation-editor__steps li.is-active .automation-editor__step-index, .automation-editor__steps li.is-done .automation-editor__step-index { background: var(--gc-color-primary); color: var(--gc-color-text-inverse); }
.automation-editor__steps button:disabled { cursor: not-allowed; opacity: var(--gc-opacity-disabled); }
.automation-editor__panel { display: grid; gap: var(--gc-space-3); min-height: calc(var(--gc-space-10) + var(--gc-space-8)); }
.automation-editor__panel > header { display: grid; gap: var(--gc-space-1); }
.automation-editor__panel p, .automation-editor small { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); line-height: var(--gc-line-height-relaxed); }
.automation-editor__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-3); }
.automation-editor label, .automation-editor__field { display: grid; align-content: start; gap: var(--gc-space-1); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.automation-editor__field--full { grid-column: 1 / -1; }
.automation-editor input, .automation-editor textarea, .automation-editor select { width: 100%; border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-solid); color: var(--gc-color-text); font: inherit; }
.automation-editor input:not([type='checkbox']), .automation-editor select:not([multiple]) { align-self: start; height: var(--gc-control-height-md); padding: 0 var(--gc-space-3); }
.automation-editor textarea, .automation-editor select[multiple] { padding: var(--gc-space-3); min-height: calc(var(--gc-space-10) + var(--gc-space-8)); resize: vertical; }
.automation-editor__domain-picker { position: relative; }
.automation-editor__domain-picker summary { padding: var(--gc-space-2) var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-solid); color: var(--gc-color-text); cursor: pointer; list-style: none; }
.automation-editor__domain-picker summary::-webkit-details-marker { display: none; }
.automation-editor__domain-picker summary::after { float: right; content: '⌄'; color: var(--gc-color-text-muted); }
.automation-editor__domain-picker[open] summary { border-color: var(--gc-color-primary); border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
.automation-editor__domain-picker.is-disabled summary { cursor: not-allowed; opacity: var(--gc-opacity-disabled); }
.automation-editor__domain-options { position: absolute; z-index: 2; display: grid; width: 100%; max-height: calc(var(--gc-space-10) * 5); overflow-y: auto; padding: var(--gc-space-2); border: var(--gc-border-width-default) solid var(--gc-color-primary); border-top: 0; border-radius: 0 0 var(--gc-radius-md) var(--gc-radius-md); background: var(--gc-color-surface-solid); box-shadow: var(--gc-shadow-md); }
.automation-editor__domain-option { display: flex !important; grid-template-columns: auto 1fr; align-items: center; padding: var(--gc-space-2); border-radius: var(--gc-radius-sm); color: var(--gc-color-text) !important; }
.automation-editor__domain-option:hover { background: var(--gc-color-surface-raised); }
.automation-editor__domain-option input { width: auto; }
.automation-editor__summary, .automation-editor__review { display: grid; gap: var(--gc-space-2); padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-info-border); border-radius: var(--gc-radius-md); background: var(--gc-color-info-soft); }
.automation-editor__summary--compact { padding: var(--gc-space-2) var(--gc-space-3); }
.automation-editor__warning { display: grid; gap: var(--gc-space-2); padding: var(--gc-space-4); border: var(--gc-border-width-default) solid var(--gc-color-warning-border); border-radius: var(--gc-radius-md); background: var(--gc-color-warning-soft); color: var(--gc-color-text); }
.automation-editor__chain { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gc-space-2); margin: 0; padding: 0; list-style: none; }
.automation-editor__chain li { display: flex; align-items: center; gap: var(--gc-space-2); padding: var(--gc-space-2); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-solid); color: var(--gc-color-text); }
.automation-editor__chain li > strong { display: grid; place-items: center; min-width: var(--gc-space-5); min-height: var(--gc-space-5); border-radius: var(--gc-radius-full); background: var(--gc-color-primary); color: var(--gc-color-text-inverse); font-size: var(--gc-font-size-xs); }
.automation-editor__check { display: flex !important; align-items: center; gap: var(--gc-space-2); }
.automation-editor__check input { width: auto; }
.automation-editor__checkbox-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-3); }
.automation-editor__scope-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-2); }
.automation-editor__scope-card { display: grid; gap: var(--gc-space-1); padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border-muted); border-radius: var(--gc-radius-lg); background: var(--gc-color-surface-panel); color: var(--gc-color-text); text-align: left; cursor: pointer; box-shadow: var(--gc-shadow-sm); }
.automation-editor__scope-card strong { color: var(--gc-color-text); }
.automation-editor__scope-card span { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); line-height: var(--gc-line-height-relaxed); }
.automation-editor__scope-card.is-active { border-color: var(--gc-color-primary-border-strong); background: var(--gc-color-primary-soft); box-shadow: var(--gc-shadow-md); }
.automation-editor__transfer { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: var(--gc-space-2); align-items: stretch; }
.automation-editor__transfer-panel { display: grid; gap: var(--gc-space-1); min-width: 0; }
.automation-editor__transfer-panel > header { display: flex; align-items: center; justify-content: space-between; gap: var(--gc-space-2); color: var(--gc-color-text); }
.automation-editor__transfer-panel > header strong { font-size: var(--gc-font-size-sm); }
.automation-editor__transfer-panel > header span { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.automation-editor__transfer-actions { display: flex; flex-direction: column; justify-content: center; gap: var(--gc-space-2); }
.automation-editor__transfer-actions .gc-button { min-width: 88px; padding-inline: var(--gc-space-3); }
.automation-editor__asset-picker { display: grid; gap: var(--gc-space-1); max-height: 220px; overflow-y: auto; padding: var(--gc-space-2); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-solid); }
.automation-editor__asset-option { display: flex !important; align-items: center; gap: var(--gc-space-2); padding: var(--gc-space-2) var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border-subtle); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-panel); color: var(--gc-color-text) !important; cursor: pointer; transition: border-color 120ms ease, background 120ms ease; }
.automation-editor__asset-option.is-selected { border-color: var(--gc-color-primary-border-strong); background: var(--gc-color-primary-soft); }
.automation-editor__asset-option input { width: auto; }
.automation-editor__empty { padding: var(--gc-space-2); color: var(--gc-color-text-muted); }
.automation-editor__footer { padding-top: var(--gc-space-3); border-top: var(--gc-border-width-default) solid var(--gc-color-border); }
.automation-editor__footer > div { display: flex; gap: var(--gc-space-2); }

@media (max-width: 900px) {
  .automation-editor__steps,
  .automation-editor__grid,
  .automation-editor__chain,
  .automation-editor__scope-grid,
  .automation-editor__checkbox-grid {
    grid-template-columns: 1fr;
  }

  .automation-editor__transfer {
    grid-template-columns: 1fr;
  }

  .automation-editor__transfer-actions {
    flex-direction: row;
    justify-content: flex-start;
  }

  .automation-editor__footer {
    align-items: stretch;
    flex-direction: column;
  }

  .automation-editor__footer > div {
    justify-content: flex-end;
  }
}
</style>
