<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ApiRecord } from '@/api/modules/common'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import type { CapabilityMatrixItem } from './GcCapabilityMatrix.vue'
import type { DeploymentWizardInitialPlan, DeploymentWizardPlan } from './GcDeploymentWizard.types'

type WizardStep = 1 | 2 | 3

const props = withDefaults(defineProps<{
  certificates: readonly ApiRecord[]
  certificateVersions: readonly ApiRecord[]
  certificateFormats: readonly ApiRecord[]
  targets: readonly ApiRecord[]
  loading?: boolean
  dryRunRequestId?: string
  submitRequestId?: string
  approvalHint?: string
  initialCertificateId?: string | null
  initialPlan?: DeploymentWizardInitialPlan | null
  dryRunChecks?: readonly ApiRecord[]
}>(), {
  loading: false,
  dryRunRequestId: '',
  submitRequestId: '',
  approvalHint: '',
  initialCertificateId: null,
  initialPlan: null,
  dryRunChecks: () => [],
})

const emit = defineEmits<{
  save: [plan: DeploymentWizardPlan]
  dryRun: [plan: DeploymentWizardPlan]
  submit: [plan: DeploymentWizardPlan]
  execute: [plan: DeploymentWizardPlan]
  cancel: []
}>()

const { t } = useI18n()

const LATEST_VERSION_MARKER = '__LATEST__'

const currentStep = ref<WizardStep>(1)
const selectedCertificateId = ref('')
const selectedCertificateVersionId = ref('')
const selectedTargetId = ref('')
const targetKeyword = ref('')

const certificateAssetOptions = computed(() => {
  const grouped = new Map<string, ApiRecord & { relatedAssetIds: string[] }>()
  for (const item of props.certificates) {
    const domain = normalizeDomainKey(readString(item, ['primaryDomain', 'name', 'commonName'], readString(item, ['id', 'certificateId'])))
    const id = readString(item, ['id', 'certificateId'])
    if (!domain || !id) continue
    const existing = grouped.get(domain)
    if (existing) {
      existing.relatedAssetIds = [...new Set([...existing.relatedAssetIds, id])]
      continue
    }
    grouped.set(domain, {
      ...item,
      id,
      primaryDomain: readString(item, ['primaryDomain', 'name', 'commonName'], domain),
      relatedAssetIds: [id],
    })
  }
  return [...grouped.values()].sort((left, right) => certificateAssetLabel(left).localeCompare(certificateAssetLabel(right)))
})

const selectedCertificateAssetIds = computed(() => {
  const selected = certificateAssetOptions.value.find((item) => readString(item, ['id', 'certificateId']) === selectedCertificateId.value)
  return selected?.relatedAssetIds ?? (selectedCertificateId.value ? [selectedCertificateId.value] : [])
})

watch(() => props.initialCertificateId, (value) => {
  if (value) selectedCertificateId.value = resolveCertificateOptionId(value)
}, { immediate: true })

watch(() => props.initialPlan, (plan) => {
  if (!plan) {
    selectedCertificateId.value = props.initialCertificateId ?? readString(certificateAssetOptions.value[0], ['id', 'certificateId'])
    selectedCertificateVersionId.value = ''
    selectedTargetId.value = readString(props.targets[0], ['id'])
    targetKeyword.value = ''
    currentStep.value = 1
    return
  }
  selectedCertificateId.value = resolveCertificateOptionId(plan.certificateId ?? '')
  selectedCertificateVersionId.value = plan.selectionMode === 'LATEST_AUTO'
    ? LATEST_VERSION_MARKER
    : (plan.certificateVersionId ?? '')
  selectedTargetId.value = plan.applicationAssetId ?? ''
  currentStep.value = 1
}, { immediate: true, deep: true })

watch(() => props.certificates, () => {
  if (!selectedCertificateId.value && certificateAssetOptions.value[0]) {
    selectedCertificateId.value = readString(certificateAssetOptions.value[0], ['id', 'certificateId'])
    return
  }
  if (selectedCertificateId.value && !certificateAssetOptions.value.some((item) => readString(item, ['id', 'certificateId']) === selectedCertificateId.value)) {
    selectedCertificateId.value = readString(certificateAssetOptions.value[0], ['id', 'certificateId'])
  }
}, { immediate: true })

const filteredVersions = computed(() => {
  if (!selectedCertificateId.value) return []
  const assetIds = new Set(selectedCertificateAssetIds.value)
  return props.certificateVersions.filter((item) => assetIds.has(readString(item, ['certificateAssetId', 'certificateId'])))
})

const sortedVersions = computed(() =>
  [...filteredVersions.value].sort((left, right) => {
    const rightNotAfter = Date.parse(readString(right, ['notAfter', 'validTo', 'expiresAt']))
    const leftNotAfter = Date.parse(readString(left, ['notAfter', 'validTo', 'expiresAt']))
    if (Number.isFinite(rightNotAfter) && Number.isFinite(leftNotAfter) && rightNotAfter !== leftNotAfter) return rightNotAfter - leftNotAfter

    const rightCreatedAt = Date.parse(readString(right, ['createdAt', 'issuedAt']))
    const leftCreatedAt = Date.parse(readString(left, ['createdAt', 'issuedAt']))
    if (Number.isFinite(rightCreatedAt) && Number.isFinite(leftCreatedAt) && rightCreatedAt !== leftCreatedAt) return rightCreatedAt - leftCreatedAt

    return readString(right, ['id']).localeCompare(readString(left, ['id']))
  }),
)

const latestVersion = computed(() => sortedVersions.value[0] ?? null)

watch(sortedVersions, (items) => {
  if (selectedCertificateVersionId.value === LATEST_VERSION_MARKER && latestVersion.value) return
  if (items.some((item) => readString(item, ['id', 'certificateVersionId']) === selectedCertificateVersionId.value)) return
  selectedCertificateVersionId.value = latestVersion.value ? LATEST_VERSION_MARKER : ''
}, { immediate: true })

const resolvedCertificateVersionId = computed(() =>
  selectedCertificateVersionId.value === LATEST_VERSION_MARKER
    ? readString(latestVersion.value, ['id', 'certificateVersionId'])
    : selectedCertificateVersionId.value,
)

const filteredTargets = computed(() => {
  const keyword = targetKeyword.value.trim().toLowerCase()
  if (!keyword) return props.targets
  return props.targets.filter((item) => {
    const haystack = [
      readString(item, ['name', 'displayName', 'domainName']),
      readString(item, ['siteName']),
      readString(item, ['bindingName', 'bindingSummary']),
      readString(item, ['managedTargetLabel', 'managedTargetId']),
      readString(item, ['workflowLabel', 'workflowVersionLabel', 'runnerLabel', 'verifyUrl']),
    ].join(' ').toLowerCase()
    return haystack.includes(keyword)
  })
})

watch(filteredTargets, (items) => {
  if (items.some((item) => readString(item, ['id']) === selectedTargetId.value)) return
  selectedTargetId.value = items[0] ? readString(items[0], ['id']) : ''
}, { immediate: true })

const selectedTargets = computed(() =>
  props.targets.filter((item) => readString(item, ['id']) === selectedTargetId.value),
)

const selectedCertificate = computed(() =>
  certificateAssetOptions.value.find((item) => readString(item, ['id', 'certificateId']) === selectedCertificateId.value) ?? null,
)
const selectedVersion = computed(() =>
  props.certificateVersions.find((item) => readString(item, ['id', 'certificateVersionId']) === resolvedCertificateVersionId.value) ?? null,
)
const selectedTarget = computed(() => selectedTargets.value[0] ?? null)

const stepOneReady = computed(() => Boolean(
  selectedCertificateId.value
  && resolvedCertificateVersionId.value,
))
const stepTwoReady = computed(() => Boolean(stepOneReady.value && selectedTargetId.value))
const currentAvailableStep = computed<WizardStep>(() => {
  if (!stepOneReady.value) return 1
  if (!stepTwoReady.value) return 2
  return 3
})

watch(currentAvailableStep, (step) => {
  if (currentStep.value > step) currentStep.value = step
}, { immediate: true })

const capabilityItems = computed<CapabilityMatrixItem[]>(() => [{
  key: 'target-selection',
  label: t('designSystem.deploymentWizard.capability.targetSelection'),
  state: selectedTargets.value.length > 0 ? 'manualRisk' : 'missing',
  level: 'L3',
  source: t('designSystem.deploymentWizard.capability.targetSource'),
  detail: selectedTargets.value.length > 0
    ? t('designSystem.deploymentWizard.capability.targetSelectedDetail')
    : t('designSystem.deploymentWizard.capability.targetMissingDetail'),
}])

const previewSummary = computed(() => {
  if (!stepOneReady.value) return t('designSystem.deploymentWizard.preview.needCertificate')
  if (!stepTwoReady.value) return t('designSystem.deploymentWizard.preview.needTarget')
  return t('designSystem.deploymentWizard.preview.ready', { count: selectedTargets.value.length })
})

const canOperate = computed(() => Boolean(
  selectedCertificateId.value
  && resolvedCertificateVersionId.value
  && selectedTargetId.value,
))

const dryRunCheckSummary = computed(() => props.dryRunChecks.reduce<{
  passed: number
  failed: number
  warning: number
  unknown: number
}>((summary, item) => {
  const status = String(item.status ?? 'unknown')
  if (status === 'passed') summary.passed += 1
  else if (status === 'failed') summary.failed += 1
  else if (status === 'warning') summary.warning += 1
  else summary.unknown += 1
  return summary
}, { passed: 0, failed: 0, warning: 0, unknown: 0 }))

const hasDryRunChecks = computed(() => props.dryRunChecks.length > 0)
const latestStatusText = computed(() => {
  if (props.approvalHint) return props.approvalHint
  if (hasDryRunChecks.value) return t('designSystem.deploymentWizard.status.checksReturned')
  if (props.dryRunRequestId) return t('designSystem.deploymentWizard.status.dryRunStarted')
  if (props.submitRequestId) return t('designSystem.deploymentWizard.status.submitted')
  return t('designSystem.deploymentWizard.status.default')
})

const readinessTone = computed(() => {
  if (hasDryRunChecks.value && dryRunCheckSummary.value.failed > 0) return 'danger'
  if (hasDryRunChecks.value && dryRunCheckSummary.value.warning > 0) return 'warning'
  if (hasDryRunChecks.value && dryRunCheckSummary.value.passed > 0) return 'success'
  if (canOperate.value) return 'info'
  return 'muted'
})

const canGoPrevious = computed(() => currentStep.value > 1)
const canGoNext = computed(() => (
  (currentStep.value === 1 && stepOneReady.value)
  || (currentStep.value === 2 && stepTwoReady.value)
))
const progressPercent = computed(() => `${(currentStep.value / 3) * 100}%`)

function buildPlan(): DeploymentWizardPlan {
  const primaryTarget = selectedTargets.value[0]
  const targetMode = readString(primaryTarget, ['targetMode'])
  return {
    certificateId: selectedCertificateId.value,
    certificateVersionId: resolvedCertificateVersionId.value,
    targetIds: selectedTargetId.value ? [selectedTargetId.value] : [],
    applicationAssetId: readString(primaryTarget, ['applicationAssetId']) || undefined,
    selectionMode: targetMode === 'WORKFLOW' ? 'EXPLICIT' : selectedCertificateVersionId.value === LATEST_VERSION_MARKER ? 'LATEST_AUTO' : 'EXPLICIT',
    capabilityItems: capabilityItems.value,
    dryRunChecks: props.dryRunChecks,
    previewSummary: previewSummary.value,
    dryRunSummary: props.dryRunRequestId ? t('designSystem.deploymentWizard.plan.dryRunCompleted') : undefined,
    submitSummary: props.submitRequestId ? t('designSystem.deploymentWizard.plan.submitCompleted') : undefined,
  }
}

function goToStep(step: WizardStep) {
  if (step > currentAvailableStep.value) return
  currentStep.value = step
}

function goPrevious() {
  if (currentStep.value === 2) currentStep.value = 1
  else if (currentStep.value === 3) currentStep.value = 2
}

function goNext() {
  if (currentStep.value === 1 && stepOneReady.value) currentStep.value = 2
  else if (currentStep.value === 2 && stepTwoReady.value) currentStep.value = 3
}

function versionLabel(item: ApiRecord): string {
  const id = readString(item, ['id', 'certificateVersionId'], t('designSystem.deploymentWizard.fallback.unnamedVersion'))
  const notBefore = formatDate(readString(item, ['notBefore', 'validFrom', 'issuedAt']))
  const notAfter = formatDate(readString(item, ['notAfter', 'validTo', 'expiresAt']))
  if (!notBefore && !notAfter) return id
  return t('designSystem.deploymentWizard.version.range', {
    id,
    notBefore: notBefore || t('designSystem.deploymentWizard.fallback.unknownStart'),
    notAfter: notAfter || t('designSystem.deploymentWizard.fallback.unknownEnd'),
  })
}

function autoLatestVersionLabel(current: ApiRecord | null): string {
  const currentLabel = current ? versionLabel(current) : t('designSystem.deploymentWizard.version.noDeployableVersion')
  return t('designSystem.deploymentWizard.version.autoLatest', { current: currentLabel })
}

function selectedVersionSummary(): string {
  if (selectedCertificateVersionId.value === LATEST_VERSION_MARKER) {
    return autoLatestVersionLabel(latestVersion.value)
  }
  return selectedVersion.value ? versionLabel(selectedVersion.value) : t('designSystem.deploymentWizard.fallback.unselected')
}

function certificateAssetLabel(item: ApiRecord): string {
  return readString(item, ['primaryDomain', 'name', 'commonName'], readString(item, ['id']))
}

function resolveCertificateOptionId(assetId: string): string {
  if (!assetId) return ''
  const matched = certificateAssetOptions.value.find((item) => item.relatedAssetIds.includes(assetId))
  return readString(matched, ['id', 'certificateId'], assetId)
}

function targetLabel(item: ApiRecord): string {
  const name = readString(item, ['name', 'displayName', 'domainName'], readString(item, ['id']))
  const targetMode = readString(item, ['targetMode'])
  if (targetMode === 'WORKFLOW') {
    const workflow = readString(item, ['workflowLabel'], t('designSystem.deploymentWizard.fallback.unselectedWorkflow'))
    const runner = readString(item, ['runnerLabel'], t('designSystem.deploymentWizard.fallback.unconfiguredRunner'))
    return `${name} / ${t('designSystem.deploymentWizard.target.workflowMode')} / ${workflow} / ${runner}`
  }
  const siteName = readString(item, ['siteName'], t('designSystem.deploymentWizard.fallback.unnamedSite'))
  const binding = readString(item, ['bindingName', 'bindingSummary'], t('designSystem.deploymentWizard.fallback.missingBinding'))
  return `${name} / ${siteName} / ${binding}`
}

function formatDate(value: string): string {
  if (!value) return ''
  return formatBrowserLocalTime(value, { includeTime: false }) || value
}

function stepState(step: WizardStep): 'done' | 'active' | 'pending' {
  if (step < currentStep.value) return 'done'
  if (step === currentStep.value) return 'active'
  return 'pending'
}

function stepStateLabel(step: WizardStep): string {
  const state = stepState(step)
  if (state === 'done') return t('designSystem.deploymentWizard.stepState.done')
  if (state === 'active') return t('designSystem.deploymentWizard.stepState.active')
  return t('designSystem.deploymentWizard.stepState.pending')
}

function readCheckDetail(item: ApiRecord): string {
  const detail = item.detail
  if (typeof detail === 'string') return detail
  if (detail && typeof detail === 'object') return JSON.stringify(detail)
  return ''
}

function readPath(record: ApiRecord | null | undefined, path: string): unknown {
  if (!record) return undefined
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[segment]
  }, record)
}

function readString(record: ApiRecord | null | undefined, candidates: readonly string[], fallback = ''): string {
  for (const key of candidates) {
    const value = readPath(record, key)
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) return value.join(', ')
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }
  return fallback
}

function normalizeDomainKey(value: string): string {
  return value.trim().toLowerCase()
}
</script>

<template>
  <section class="gc-card gc-deployment-wizard" :aria-label="t('designSystem.deploymentWizard.aria.wizard')">
    <header class="gc-deployment-wizard__header">
      <div class="gc-deployment-wizard__title">
        <span class="gc-deployment-wizard__eyebrow">{{ t('designSystem.deploymentWizard.title') }}</span>
        <strong>{{ t('designSystem.deploymentWizard.subtitle') }}</strong>
      </div>
      <div class="gc-deployment-wizard__header-meta">
        <span class="gc-deployment-wizard__status" :class="`is-${readinessTone}`">
          {{ t('designSystem.deploymentWizard.currentStep', { current: currentStep, total: 3 }) }}
        </span>
        <span class="gc-deployment-wizard__count">{{ t('designSystem.deploymentWizard.selectedTargetCount', { count: selectedTargets.length }) }}</span>
      </div>
    </header>

    <div class="gc-deployment-wizard__progress">
      <div class="gc-deployment-wizard__progress-bar">
        <span class="gc-deployment-wizard__progress-fill" :style="{ width: progressPercent }"></span>
      </div>
      <ol class="gc-deployment-wizard__steps" :aria-label="t('designSystem.deploymentWizard.aria.steps')">
        <li class="gc-deployment-wizard__step" :class="`is-${stepState(1)}`">
          <button type="button" class="gc-deployment-wizard__step-button" @click="goToStep(1)">
            <span class="gc-deployment-wizard__step-index">1</span>
            <div class="gc-deployment-wizard__step-copy">
              <strong>{{ t('designSystem.deploymentWizard.steps.certificate.title') }}</strong>
              <p>{{ t('designSystem.deploymentWizard.steps.certificate.description') }}</p>
              <span class="gc-deployment-wizard__step-state">{{ stepStateLabel(1) }}</span>
            </div>
          </button>
        </li>
        <li class="gc-deployment-wizard__step" :class="`is-${stepState(2)}`">
          <button type="button" class="gc-deployment-wizard__step-button" :disabled="currentAvailableStep < 2" @click="goToStep(2)">
            <span class="gc-deployment-wizard__step-index">2</span>
            <div class="gc-deployment-wizard__step-copy">
              <strong>{{ t('designSystem.deploymentWizard.steps.target.title') }}</strong>
              <p>{{ t('designSystem.deploymentWizard.steps.target.description') }}</p>
              <span class="gc-deployment-wizard__step-state">{{ stepStateLabel(2) }}</span>
            </div>
          </button>
        </li>
        <li class="gc-deployment-wizard__step" :class="`is-${stepState(3)}`">
          <button type="button" class="gc-deployment-wizard__step-button" :disabled="currentAvailableStep < 3" @click="goToStep(3)">
            <span class="gc-deployment-wizard__step-index">3</span>
            <div class="gc-deployment-wizard__step-copy">
              <strong>{{ t('designSystem.deploymentWizard.steps.submit.title') }}</strong>
              <p>{{ t('designSystem.deploymentWizard.steps.submit.description') }}</p>
              <span class="gc-deployment-wizard__step-state">{{ stepStateLabel(3) }}</span>
            </div>
          </button>
        </li>
      </ol>
    </div>

    <section class="gc-deployment-wizard__panel">
      <template v-if="currentStep === 1">
        <header class="gc-deployment-wizard__panel-header">
          <div>
            <h3>{{ t('designSystem.deploymentWizard.panels.certificateTitle') }}</h3>
          </div>
          <span class="gc-deployment-wizard__panel-state" :class="`is-${stepOneReady ? 'done' : 'active'}`">
            {{ stepOneReady ? t('designSystem.deploymentWizard.panelState.readyNext') : t('designSystem.deploymentWizard.panelState.pending') }}
          </span>
        </header>

        <div class="gc-deployment-wizard__field-grid">
          <label class="gc-form-field">
            <span>{{ t('designSystem.deploymentWizard.fields.certificateAsset') }}</span>
            <select v-model="selectedCertificateId" :disabled="loading">
              <option v-for="item in certificateAssetOptions" :key="readString(item, ['id', 'certificateId'])" :value="readString(item, ['id', 'certificateId'])">
                {{ certificateAssetLabel(item) }}
              </option>
            </select>
          </label>

          <label class="gc-form-field">
            <span>{{ t('designSystem.deploymentWizard.fields.certificateVersion') }}</span>
            <select v-model="selectedCertificateVersionId" :disabled="loading || sortedVersions.length === 0">
              <option v-if="latestVersion" :value="LATEST_VERSION_MARKER">
                {{ autoLatestVersionLabel(latestVersion) }}
              </option>
              <option v-for="item in sortedVersions" :key="readString(item, ['id', 'certificateVersionId'])" :value="readString(item, ['id', 'certificateVersionId'])">
                {{ versionLabel(item) }}
              </option>
            </select>
          </label>

        </div>

        <div class="gc-deployment-wizard__summary-grid">
          <div class="gc-deployment-wizard__summary-item">
            <span>{{ t('designSystem.deploymentWizard.fields.certificateAsset') }}</span>
            <strong>{{ readString(selectedCertificate, ['primaryDomain', 'name', 'commonName'], t('designSystem.deploymentWizard.fallback.unselected')) }}</strong>
          </div>
          <div class="gc-deployment-wizard__summary-item">
            <span>{{ t('designSystem.deploymentWizard.fields.certificateVersion') }}</span>
            <strong>{{ selectedVersionSummary() }}</strong>
          </div>
        </div>
      </template>

      <template v-else-if="currentStep === 2">
        <header class="gc-deployment-wizard__panel-header">
          <div>
            <h3>{{ t('designSystem.deploymentWizard.panels.targetTitle') }}</h3>
          </div>
          <span class="gc-deployment-wizard__panel-state" :class="`is-${stepTwoReady ? 'done' : 'active'}`">
            {{ stepTwoReady ? t('designSystem.deploymentWizard.panelState.readyNext') : t('designSystem.deploymentWizard.panelState.pending') }}
          </span>
        </header>

        <div class="gc-deployment-wizard__field-grid">
          <label class="gc-form-field gc-deployment-wizard__field-span-2">
            <span>{{ t('designSystem.deploymentWizard.fields.keyword') }}</span>
            <input v-model.trim="targetKeyword" type="text" :disabled="loading || targets.length === 0" :placeholder="t('designSystem.deploymentWizard.placeholders.targetKeyword')" />
          </label>

          <label class="gc-form-field gc-deployment-wizard__field-span-2">
            <span>{{ t('designSystem.deploymentWizard.fields.applicationTarget') }}</span>
            <select v-model="selectedTargetId" :disabled="loading || filteredTargets.length === 0">
              <option value="">{{ filteredTargets.length === 0 ? t('designSystem.deploymentWizard.empty.noTargets') : t('designSystem.deploymentWizard.placeholders.selectTarget') }}</option>
              <option v-for="item in filteredTargets" :key="readString(item, ['id'])" :value="readString(item, ['id'])">
                {{ targetLabel(item) }}
              </option>
            </select>
          </label>
        </div>

        <div v-if="selectedTarget" class="gc-deployment-wizard__target-card">
          <div class="gc-deployment-wizard__target-head">
            <strong>{{ readString(selectedTarget, ['name', 'displayName', 'domainName'], readString(selectedTarget, ['id'])) }}</strong>
            <span>{{ readString(selectedTarget, ['targetMode']) === 'WORKFLOW' ? t('designSystem.deploymentWizard.target.workflowMode') : readString(selectedTarget, ['managedTargetLabel', 'managedTargetId'], t('designSystem.deploymentWizard.fallback.unrecognizedManagedTarget')) }}</span>
          </div>
          <dl v-if="readString(selectedTarget, ['targetMode']) === 'WORKFLOW'" class="gc-deployment-wizard__target-meta">
            <div>
              <dt>{{ t('designSystem.deploymentWizard.fields.workflow') }}</dt>
              <dd>{{ readString(selectedTarget, ['workflowLabel'], t('designSystem.deploymentWizard.fallback.unselectedWorkflow')) }}</dd>
            </div>
            <div>
              <dt>{{ t('designSystem.deploymentWizard.fields.version') }}</dt>
              <dd>{{ readString(selectedTarget, ['workflowVersionLabel'], t('designSystem.deploymentWizard.fallback.unselectedVersion')) }}</dd>
            </div>
            <div>
              <dt>{{ t('designSystem.deploymentWizard.fields.runner') }}</dt>
              <dd>{{ readString(selectedTarget, ['runnerLabel'], t('designSystem.deploymentWizard.fallback.unconfigured')) }}</dd>
            </div>
            <div>
              <dt>{{ t('designSystem.deploymentWizard.fields.verifyUrl') }}</dt>
              <dd>{{ readString(selectedTarget, ['verifyUrl'], t('designSystem.deploymentWizard.fallback.generatedByApplicationEntry')) }}</dd>
            </div>
            <div>
              <dt>{{ t('designSystem.deploymentWizard.fields.certificateVariable') }}</dt>
              <dd>{{ readString(selectedTarget, ['certificateBindingSummary'], t('designSystem.deploymentWizard.fallback.unboundCertificateVariable')) }}</dd>
            </div>
          </dl>
          <dl v-else class="gc-deployment-wizard__target-meta">
            <div>
              <dt>{{ t('designSystem.deploymentWizard.fields.site') }}</dt>
              <dd>{{ readString(selectedTarget, ['siteName'], t('designSystem.deploymentWizard.fallback.unnamedSite')) }}</dd>
            </div>
            <div>
              <dt>{{ t('designSystem.deploymentWizard.fields.binding') }}</dt>
              <dd>{{ readString(selectedTarget, ['bindingName', 'bindingSummary'], t('designSystem.deploymentWizard.fallback.missingBinding')) }}</dd>
            </div>
            <div>
              <dt>{{ t('designSystem.deploymentWizard.fields.managedTarget') }}</dt>
              <dd>{{ readString(selectedTarget, ['managedTargetLabel', 'managedTargetId'], t('designSystem.deploymentWizard.fallback.unrecognizedManagedTarget')) }}</dd>
            </div>
            <div>
              <dt>{{ t('designSystem.deploymentWizard.fields.artifactConfig') }}</dt>
              <dd>{{ readString(selectedTarget, ['certificateFormatLabel'], t('designSystem.deploymentWizard.fallback.unconfigured')) }}</dd>
            </div>
          </dl>
        </div>
        <p v-else class="gc-deployment-wizard__empty">{{ t('designSystem.deploymentWizard.empty.selectTarget') }}</p>
      </template>

      <template v-else>
        <header class="gc-deployment-wizard__panel-header">
          <div>
            <h3>{{ t('designSystem.deploymentWizard.panels.submitTitle') }}</h3>
          </div>
          <span class="gc-deployment-wizard__panel-state" :class="`is-${canOperate ? 'active' : 'pending'}`">
            {{ canOperate ? t('designSystem.deploymentWizard.panelState.operable') : t('designSystem.deploymentWizard.panelState.needPrerequisites') }}
          </span>
        </header>

        <dl class="gc-deployment-wizard__review-list">
          <div>
            <dt>{{ t('designSystem.deploymentWizard.fields.certificateAsset') }}</dt>
            <dd>{{ readString(selectedCertificate, ['primaryDomain', 'name', 'commonName'], t('designSystem.deploymentWizard.fallback.unselected')) }}</dd>
          </div>
          <div>
            <dt>{{ t('designSystem.deploymentWizard.fields.certificateVersion') }}</dt>
            <dd>{{ selectedVersionSummary() }}</dd>
          </div>
          <div>
            <dt>{{ t('designSystem.deploymentWizard.fields.deploymentTarget') }}</dt>
            <dd>{{ selectedTarget ? targetLabel(selectedTarget) : t('designSystem.deploymentWizard.fallback.unselected') }}</dd>
          </div>
        </dl>

        <p class="gc-deployment-wizard__preview-text">{{ previewSummary }}</p>

        <div class="gc-deployment-wizard__feedback-inline" :class="`is-${readinessTone}`">
          <strong>{{ t('designSystem.deploymentWizard.status.current') }}</strong>
          <p>{{ latestStatusText }}</p>
        </div>

        <div v-if="hasDryRunChecks" class="gc-deployment-wizard__check-summary">
          <span class="gc-deployment-wizard__check-pill is-passed">{{ t('designSystem.deploymentWizard.checks.passed', { count: dryRunCheckSummary.passed }) }}</span>
          <span class="gc-deployment-wizard__check-pill is-warning">{{ t('designSystem.deploymentWizard.checks.warning', { count: dryRunCheckSummary.warning }) }}</span>
          <span class="gc-deployment-wizard__check-pill is-failed">{{ t('designSystem.deploymentWizard.checks.failed', { count: dryRunCheckSummary.failed }) }}</span>
          <span class="gc-deployment-wizard__check-pill is-unknown">{{ t('designSystem.deploymentWizard.checks.unknown', { count: dryRunCheckSummary.unknown }) }}</span>
        </div>

        <ul v-if="hasDryRunChecks" class="gc-deployment-wizard__check-list">
          <li v-for="item in dryRunChecks" :key="String(item.key ?? item.label ?? item.id)" class="gc-deployment-wizard__check-item">
            <div class="gc-deployment-wizard__check-head">
              <strong>{{ String(item.label ?? item.key ?? t('designSystem.deploymentWizard.checks.unnamed')) }}</strong>
              <span class="gc-deployment-wizard__check-status" :class="`is-${String(item.status ?? 'unknown')}`">
                {{ String(item.status ?? 'unknown') }}
              </span>
            </div>
            <p v-if="readCheckDetail(item)">{{ readCheckDetail(item) }}</p>
          </li>
        </ul>
      </template>
    </section>

    <footer class="gc-deployment-wizard__footer">
      <button class="gc-button" type="button" :disabled="!canGoPrevious || loading" @click="goPrevious">{{ t('designSystem.deploymentWizard.actions.previous') }}</button>

      <div class="gc-deployment-wizard__footer-actions">
        <button class="gc-button" type="button" :disabled="loading" @click="emit('cancel')">{{ t('designSystem.deploymentWizard.actions.cancel') }}</button>
        <button v-if="currentStep < 3" class="gc-button gc-button--primary" type="button" :disabled="!canGoNext || loading" @click="goNext">{{ t('designSystem.deploymentWizard.actions.next') }}</button>
        <template v-else>
          <button class="gc-button gc-button--primary" type="button" :disabled="!canOperate || loading" @click="emit('dryRun', buildPlan())">{{ t('designSystem.deploymentWizard.actions.dryRun') }}</button>
          <button class="gc-button" type="button" :disabled="!canOperate || loading" @click="emit('save', buildPlan())">{{ t('designSystem.deploymentWizard.actions.save') }}</button>
        </template>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.gc-deployment-wizard {
  display: grid;
  gap: 12px;
  padding: 6px;
  border-radius: 20px;
  background:
    radial-gradient(circle at top right, var(--gc-color-info-border), transparent 30%),
    linear-gradient(180deg, var(--gc-color-surface-subtle), var(--gc-color-surface-raised));
}

.gc-deployment-wizard__header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  padding: 0 2px;
}

.gc-deployment-wizard__eyebrow {
  display: inline-flex;
  margin-bottom: 6px;
  color: var(--gc-color-primary);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.gc-deployment-wizard__title strong {
  display: block;
  font-size: 24px;
  line-height: 1.15;
  letter-spacing: 0;
}

.gc-deployment-wizard__header-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: flex-end;
}

.gc-deployment-wizard__status,
.gc-deployment-wizard__panel-state,
.gc-deployment-wizard__check-status,
.gc-deployment-wizard__step-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  font-size: var(--gc-font-size-xs);
  font-weight: 700;
}

.gc-deployment-wizard__status,
.gc-deployment-wizard__panel-state,
.gc-deployment-wizard__check-status {
  padding: 6px 12px;
  border: 1px solid transparent;
  box-shadow: 0 6px 14px var(--gc-color-border-subtle);
}

.gc-deployment-wizard__status.is-success,
.gc-deployment-wizard__panel-state.is-done,
.gc-deployment-wizard__check-status.is-passed {
  color: var(--gc-color-success);
  background: var(--gc-color-success-bg);
  border-color: var(--gc-color-success-bg);
}

.gc-deployment-wizard__status.is-warning,
.gc-deployment-wizard__check-status.is-warning {
  color: var(--gc-color-warning);
  background: var(--gc-color-warning-bg);
  border-color: var(--gc-color-warning-bg);
}

.gc-deployment-wizard__status.is-danger,
.gc-deployment-wizard__check-status.is-failed {
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-bg);
  border-color: var(--gc-color-danger-bg);
}

.gc-deployment-wizard__status.is-info,
.gc-deployment-wizard__panel-state.is-active {
  color: var(--gc-color-info);
  background: var(--gc-color-info-bg);
  border-color: var(--gc-color-primary-weak);
}

.gc-deployment-wizard__status.is-muted,
.gc-deployment-wizard__panel-state.is-pending,
.gc-deployment-wizard__check-status.is-unknown {
  color: var(--gc-color-text-muted);
  background: var(--gc-color-surface-muted);
  border-color: var(--gc-color-muted-bg);
}

.gc-deployment-wizard__count {
  color: var(--gc-color-text-muted);
  font-size: 13px;
  font-weight: 600;
  padding: 5px 10px;
  border: 1px solid var(--gc-color-border-muted);
  border-radius: 999px;
  background: var(--gc-color-surface-glass);
}

.gc-deployment-wizard__progress {
  display: grid;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--gc-color-surface-muted);
  border-radius: 18px;
  background:
    linear-gradient(180deg, var(--gc-color-surface-overlay), var(--gc-color-surface-subtle));
  box-shadow:
    inset 0 1px 0 var(--gc-color-surface-glass),
    0 8px 20px var(--gc-color-border-subtle);
}

.gc-deployment-wizard__progress-bar {
  position: relative;
  height: 6px;
  border-radius: 999px;
  background: var(--gc-color-border-muted);
  overflow: hidden;
}

.gc-deployment-wizard__progress-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--gc-color-primary), var(--gc-color-primary));
  box-shadow: 0 0 0 1px var(--gc-color-surface-muted) inset;
  transition: width 180ms ease;
}

.gc-deployment-wizard__steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.gc-deployment-wizard__step {
  position: relative;
  border: 1px solid var(--gc-color-border-muted);
  border-radius: 14px;
  background: var(--gc-color-surface-panel);
  box-shadow:
    inset 0 1px 0 var(--gc-color-surface),
    0 6px 14px var(--gc-color-border-subtle);
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;
}

.gc-deployment-wizard__step::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  border-radius: 14px 0 0 14px;
  background: transparent;
}

.gc-deployment-wizard__step-button {
  display: flex;
  width: 100%;
  gap: 10px;
  align-items: center;
  min-height: 76px;
  padding: 12px 14px;
  border: 0;
  outline: 0;
  appearance: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.gc-deployment-wizard__step-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.gc-deployment-wizard__step-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.gc-deployment-wizard__step strong {
  display: block;
  font-size: 15px;
  line-height: 1.2;
}

.gc-deployment-wizard__step p {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: 12px;
  line-height: 1.35;
}

.gc-deployment-wizard__step-state {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  margin-top: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--gc-color-surface-subtle);
  color: var(--gc-color-text-muted);
  font-size: 11px;
  font-weight: 700;
}

.gc-deployment-wizard__step-index {
  width: 30px;
  min-width: 30px;
  height: 30px;
  background: linear-gradient(180deg, var(--gc-color-surface-solid), var(--gc-color-surface-subtle));
  color: var(--gc-color-text-muted);
  border: 1px solid var(--gc-color-border-strong);
  box-shadow: 0 4px 10px var(--gc-color-border-subtle);
}

.gc-deployment-wizard__step.is-active {
  border-color: var(--gc-color-primary-border);
  background: linear-gradient(180deg, var(--gc-color-surface-selected), var(--gc-color-surface-subtle));
  box-shadow:
    inset 0 1px 0 var(--gc-color-surface-panel),
    0 10px 18px var(--gc-color-primary-soft);
  transform: translateY(-1px);
}

.gc-deployment-wizard__step.is-active::before {
  background: linear-gradient(180deg, var(--gc-color-primary), var(--gc-color-primary));
}

.gc-deployment-wizard__step.is-active .gc-deployment-wizard__step-index,
.gc-deployment-wizard__step.is-done .gc-deployment-wizard__step-index {
  color: var(--gc-color-surface-solid);
  border-color: transparent;
  background: linear-gradient(180deg, var(--gc-color-primary), var(--gc-color-primary));
  box-shadow: 0 6px 14px var(--gc-color-primary-weak);
}

.gc-deployment-wizard__step.is-active .gc-deployment-wizard__step-state {
  background: var(--gc-color-info-border);
  color: var(--gc-color-primary-strong);
}

.gc-deployment-wizard__step.is-done {
  border-color: var(--gc-color-success-border);
  background: linear-gradient(180deg, var(--gc-color-success-soft), var(--gc-color-surface-subtle));
  box-shadow:
    inset 0 1px 0 var(--gc-color-surface-panel),
    0 8px 16px var(--gc-color-success-soft);
}

.gc-deployment-wizard__step.is-done::before {
  background: linear-gradient(180deg, var(--gc-color-success), var(--gc-color-success));
}

.gc-deployment-wizard__step.is-done .gc-deployment-wizard__step-state {
  background: var(--gc-color-success-bg);
  color: var(--gc-color-success);
}

.gc-deployment-wizard__panel {
  display: grid;
  gap: 14px;
  min-height: 0;
  border: 1px solid var(--gc-color-surface-muted);
  border-radius: 20px;
  padding: 16px;
  background:
    linear-gradient(180deg, var(--gc-color-surface-overlay), var(--gc-color-surface-subtle));
  box-shadow:
    inset 0 1px 0 var(--gc-color-surface-glass),
    0 12px 28px var(--gc-color-border-subtle);
}

.gc-deployment-wizard__panel-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  padding-bottom: 0;
  border-bottom: 1px solid var(--gc-color-border-muted);
}

.gc-deployment-wizard__panel-header h3 {
  margin: 0;
  font-size: 24px;
  line-height: 1.15;
}

.gc-deployment-wizard__field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.gc-deployment-wizard__field-span-2 {
  grid-column: 1 / -1;
}

.gc-deployment-wizard :deep(.gc-form-field) {
  min-width: 0;
  gap: 8px;
}

.gc-deployment-wizard :deep(.gc-form-field > span) {
  color: var(--gc-color-muted);
  font-size: 13px;
  font-weight: 700;
}

.gc-deployment-wizard :deep(.gc-form-field input),
.gc-deployment-wizard :deep(.gc-form-field select) {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  min-height: 44px;
  box-sizing: border-box;
  border-radius: 12px;
  border-color: var(--gc-color-border-strong);
  background: var(--gc-color-surface-overlay);
  box-shadow:
    inset 0 1px 2px var(--gc-color-border-subtle),
    0 1px 0 var(--gc-color-surface-muted);
  padding-inline: 14px;
  transition:
    border-color 140ms ease,
    box-shadow 140ms ease,
    background-color 140ms ease;
}

.gc-deployment-wizard :deep(.gc-form-field select) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gc-deployment-wizard :deep(.gc-form-field input:focus),
.gc-deployment-wizard :deep(.gc-form-field select:focus) {
  outline: none;
  border-color: var(--gc-color-primary-border-strong);
  box-shadow:
    0 0 0 4px var(--gc-color-primary-weak),
    inset 0 1px 2px var(--gc-color-border-subtle);
}

.gc-deployment-wizard__summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.gc-deployment-wizard__summary-item,
.gc-deployment-wizard__target-card,
.gc-deployment-wizard__feedback-inline,
.gc-deployment-wizard__check-item {
  border: 1px solid var(--gc-color-border-muted);
  border-radius: 16px;
  background:
    linear-gradient(180deg, var(--gc-color-surface-overlay), var(--gc-color-surface-subtle));
  box-shadow:
    inset 0 1px 0 var(--gc-color-surface-glass),
    0 10px 24px var(--gc-color-border-subtle);
}

.gc-deployment-wizard__summary-item {
  display: grid;
  gap: 8px;
  padding: 14px;
}

.gc-deployment-wizard__summary-item span,
.gc-deployment-wizard__review-list dt,
.gc-deployment-wizard__target-meta dt {
  color: var(--gc-color-text-muted);
  font-size: 13px;
  font-weight: 700;
}

.gc-deployment-wizard__summary-item strong,
.gc-deployment-wizard__review-list dd,
.gc-deployment-wizard__target-meta dd {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 16px;
  line-height: 1.25;
}

.gc-deployment-wizard__summary-item small {
  color: var(--gc-color-text-muted);
  overflow-wrap: anywhere;
  font-size: 13px;
  line-height: 1.4;
}

.gc-deployment-wizard__tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.gc-deployment-wizard__tag,
.gc-deployment-wizard__check-pill {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  padding: 5px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.gc-deployment-wizard__tag {
  border: 1px solid var(--gc-color-primary-border);
  background: var(--gc-color-surface-selected);
  color: var(--gc-color-primary-strong);
}

.gc-deployment-wizard__target-card {
  display: grid;
  gap: 12px;
  padding: 16px;
}

.gc-deployment-wizard__target-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: baseline;
}

.gc-deployment-wizard__target-head strong {
  font-size: 20px;
  line-height: 1.15;
}

.gc-deployment-wizard__target-head span {
  color: var(--gc-color-text-muted);
  font-size: 14px;
  font-weight: 600;
}

.gc-deployment-wizard__target-meta,
.gc-deployment-wizard__review-list {
  display: grid;
  gap: 12px;
  margin: 0;
}

.gc-deployment-wizard__review-list {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.gc-deployment-wizard__target-meta div,
.gc-deployment-wizard__review-list div {
  display: grid;
  gap: 8px;
}

.gc-deployment-wizard__target-meta div:first-child,
.gc-deployment-wizard__review-list div:first-child {
  padding-top: 0;
}

.gc-deployment-wizard__review-list div {
  padding: 14px 16px;
  border: 1px solid var(--gc-color-border-muted);
  border-radius: 16px;
  background:
    linear-gradient(180deg, var(--gc-color-surface-overlay), var(--gc-color-surface-subtle));
  box-shadow:
    inset 0 1px 0 var(--gc-color-surface-field),
    0 10px 22px var(--gc-color-border-subtle);
}

.gc-deployment-wizard__target-meta div {
  padding-top: 12px;
  border-top: 1px solid var(--gc-color-border-muted);
}

.gc-deployment-wizard__review-list dd,
.gc-deployment-wizard__target-meta dd {
  margin: 0;
  font-size: 15px;
  line-height: 1.4;
}

.gc-deployment-wizard__preview-text,
.gc-deployment-wizard__empty {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: 15px;
  line-height: 1.6;
}

.gc-deployment-wizard__feedback-inline {
  display: grid;
  gap: 8px;
  padding: 14px 16px;
}

.gc-deployment-wizard__feedback-inline strong {
  font-size: 15px;
}

.gc-deployment-wizard__feedback-inline p {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: 14px;
  line-height: 1.5;
}

.gc-deployment-wizard__feedback-inline.is-success {
  border-color: var(--gc-color-success-border);
  background: linear-gradient(180deg, var(--gc-color-success-soft), var(--gc-color-surface-subtle));
}

.gc-deployment-wizard__feedback-inline.is-warning {
  border-color: var(--gc-color-warning-border);
  background: linear-gradient(180deg, var(--gc-color-warning-soft), var(--gc-color-surface-subtle));
}

.gc-deployment-wizard__feedback-inline.is-danger {
  border-color: var(--gc-color-danger-border);
  background: linear-gradient(180deg, var(--gc-color-danger-soft), var(--gc-color-surface-subtle));
}

.gc-deployment-wizard__feedback-inline.is-info {
  border-color: var(--gc-color-primary-weak);
  background: linear-gradient(180deg, var(--gc-color-surface-selected), var(--gc-color-surface-subtle));
}

.gc-deployment-wizard__hint {
  margin: 0;
  color: var(--gc-color-danger);
  font-size: 14px;
  font-weight: 700;
}

.gc-deployment-wizard__check-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
}

.gc-deployment-wizard__check-pill {
  border: 1px solid transparent;
}

.gc-deployment-wizard__check-pill.is-passed {
  color: var(--gc-color-success);
  border-color: var(--gc-color-success-bg);
  background: var(--gc-color-success-bg);
}

.gc-deployment-wizard__check-pill.is-warning {
  color: var(--gc-color-warning);
  border-color: var(--gc-color-warning-bg);
  background: var(--gc-color-warning-bg);
}

.gc-deployment-wizard__check-pill.is-failed {
  color: var(--gc-color-danger);
  border-color: var(--gc-color-danger-bg);
  background: var(--gc-color-danger-bg);
}

.gc-deployment-wizard__check-pill.is-unknown {
  color: var(--gc-color-text-muted);
  border-color: var(--gc-color-muted-bg);
  background: var(--gc-color-surface-muted);
}

.gc-deployment-wizard__check-list {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.gc-deployment-wizard__check-item {
  display: grid;
  gap: 10px;
  padding: 14px;
}

.gc-deployment-wizard__check-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
}

.gc-deployment-wizard__check-head strong {
  font-size: 16px;
}

.gc-deployment-wizard__check-item p {
  margin: 0;
  color: var(--gc-color-text-muted);
  line-height: 1.55;
}

.gc-deployment-wizard__footer {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid var(--gc-color-surface-muted);
  border-radius: 16px;
  background:
    linear-gradient(180deg, var(--gc-color-surface-overlay), var(--gc-color-surface-subtle));
  box-shadow:
    inset 0 1px 0 var(--gc-color-surface-glass),
    0 8px 20px var(--gc-color-border-subtle);
}

.gc-deployment-wizard__footer-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
}

.gc-deployment-wizard__footer :deep(.gc-button) {
  min-height: 40px;
  padding-inline: 16px;
  border-radius: 12px;
}

@media (max-width: 780px) {
  .gc-deployment-wizard__steps,
  .gc-deployment-wizard__field-grid,
  .gc-deployment-wizard__summary-grid,
  .gc-deployment-wizard__review-list {
    grid-template-columns: minmax(0, 1fr);
  }

  .gc-deployment-wizard__header,
  .gc-deployment-wizard__panel-header,
  .gc-deployment-wizard__target-head,
  .gc-deployment-wizard__footer {
    flex-direction: column;
  }

  .gc-deployment-wizard__header-meta,
  .gc-deployment-wizard__footer-actions {
    justify-content: flex-start;
    width: 100%;
  }

  .gc-deployment-wizard__panel {
    min-height: auto;
    padding: 16px;
  }

  .gc-deployment-wizard__title strong {
    font-size: 22px;
  }

  .gc-deployment-wizard__panel-header h3 {
    font-size: 22px;
  }

  .gc-deployment-wizard__target-head strong,
  .gc-deployment-wizard__summary-item strong {
    font-size: 18px;
  }
}
</style>
