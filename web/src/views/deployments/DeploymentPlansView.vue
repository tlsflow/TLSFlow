<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiClientError } from '@/api/client'
import { getAssetDetail, listAssets, listManagedTargets } from '@/api/modules/assets.api'
import type { ApiRecord } from '@/api/modules/common'
import { listCertificates, listCertificateFormats, listCertificateVersions } from '@/api/modules/certificates.api'
import { useExecutionDetail } from '@/composables/useExecutionDetail'
import { listExecutionsByPlanId } from '@/api/modules/executions.api'
import { getWorkflowExecutionBinding, listWorkflowTemplates } from '@/api/modules/workflow-templates.api'
import {
  createDeploymentPlanFromApplicationAsset,
  deleteDraftDeploymentPlan,
  dryRunDeploymentPlan,
  listDeploymentInputSnapshots,
  listDeploymentPlans,
  updateDeploymentPlanFromApplicationAsset,
} from '@/api/modules/deployments.api'
import { listMonitorCertificateObservations, probeMonitorServiceAsset } from '@/api/modules/monitors.api'
import { GcDeploymentWizard, GcDryRunResultModal, GcExecutionProgressPanel, GcModal, GcStatusTag } from '@/design-system/components'
import type { DeploymentWizardInitialPlan, DeploymentWizardPlan } from '@/design-system/components/GcDeploymentWizard.types'
import type { ViewRow } from '@/composables/useBusinessPage'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import { createDeploymentPlansPageConfig } from './deployment-plan.config'
import { enrichDeploymentPlanRecord, resolveApplicationAssetIdForPlan } from './deployment-plan-update-state'

type RelatedRecordKind = 'dry-run' | 'certificate-update'

interface RelatedExecutionRecord {
  readonly id: string
  readonly runId: string
  readonly planId: string
  readonly planName: string
  readonly status: string
  readonly type: string
  readonly kind: RelatedRecordKind
  readonly createdReason: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly targetSummary: string
  readonly certificateVersionId: string
  readonly certificateFormatId: string
  readonly raw: ApiRecord
}

interface DeploymentInputSourceRow {
  readonly id: string
  readonly targetId: string
  readonly path: string
  readonly value: string
  readonly source: string
}

const pageRef = ref<InstanceType<typeof BusinessResourcePage> | null>(null)
const { t } = useI18n()
const createDialogOpen = ref(false)
const loading = ref(false)
const editingPlanId = ref('')
const wizardInitialPlan = ref<DeploymentWizardInitialPlan | null>(null)
const errorMessage = ref('')
const infoMessage = ref('')
const approvalHint = ref('')
const dryRunRequestId = ref('')
const submitRequestId = ref('')
const dryRunRunRow = ref<ViewRow | null>(null)
const detailModalOpen = ref(false)
const detailPlanRow = ref<ViewRow | null>(null)
const relatedRecords = ref<RelatedExecutionRecord[]>([])
const relatedRecordsLoading = ref(false)
const relatedRecordsError = ref('')
const deploymentInputSnapshots = ref<ApiRecord[]>([])
const deploymentInputSnapshotsLoading = ref(false)
const deploymentInputSnapshotsError = ref('')
const activeDetailTab = ref<'summary' | 'versions' | 'execution'>('summary')
const relatedExecutionRow = ref<ViewRow | null>(null)
const relatedExecutionDetail = useExecutionDetail(relatedExecutionRow, { t })

const certificateItems = ref<ApiRecord[]>([])
const certificateVersionItems = ref<ApiRecord[]>([])
const certificateFormatItems = ref<ApiRecord[]>([])
const targetItems = ref<ApiRecord[]>([])
const dryRunChecks = ref<ApiRecord[]>([])
const dryRunExecutionDetail = useExecutionDetail(dryRunRunRow, { t })
const dryRunResultModalOpen = ref(false)
const dryRunActionError = ref('')
const activeExecutionSource = ref<'plan' | 'related'>('plan')
const latestExecutionMode = ref<'dry-run' | 'apply' | 'rollback'>('dry-run')
const latestExecutionRequestId = ref('')
const dryRunRequiredModalOpen = ref(false)
const dryRunRequiredPending = ref(false)
const dryRunRequiredMessage = ref('')
const dryRunRequiredActionLabel = ref('')
const dryRunRequiredRow = ref<ViewRow | null>(null)
const refreshedTerminalRunIds = new Set<string>()
const probingAssetIds = new Set<string>()
let unknownStateProbeTimer: number | null = null

const unknownStateProbeRetryMs = 15_000

const pageConfig = computed<BusinessPageConfig>(() => {
  const baseConfig = createDeploymentPlansPageConfig(t)
  return {
    ...baseConfig,
    showHeader: false,
    showMetrics: false,
    showDetailPanel: false,
    showActionPanel: false,
    showToolbarDangerHint: false,
    load: loadDeploymentPlansPage,
    primaryAction: openCreateDialog,
    actions: (baseConfig.actions ?? []).map((action) => ({
      ...action,
      run: async (row) => {
        try {
          const result = await runPlanAction(action.label, row ?? null, () => action.run?.(row))
          await handleActionFeedback(action.label, row ?? null, result)
        } catch (cause) {
          handleActionError(action.label, row ?? null, cause)
        }
      },
    })),
    rowActions: [
      {
        label: t('deploymentPlans.actions.detail'),
        permission: 'deployment.plan.read',
        reloadAfterRun: false,
        run: async (row) => {
          await openDetailDialog(row)
        },
      },
      {
        label: t('deploymentPlans.actions.edit'),
        permission: 'deployment.plan.write',
        reloadAfterRun: false,
        run: async (row) => {
          await openEditDialog(row)
        },
      },
      ...((baseConfig.rowActions ?? []).map((action) => ({
        ...action,
        run: async (row: ViewRow) => {
          try {
            const result = await runPlanAction(action.label, row, () => action.run?.(row))
            await handleActionFeedback(action.label, row, result)
          } catch (cause) {
            handleActionError(action.label, row, cause)
          }
        },
      }))),
    ],
  }
})

const deploymentPlanActionLabelKeys = {
  dryRun: 'deploymentPlans.actions.dryRun',
  submit: 'deploymentPlans.actions.submit',
  execute: 'deploymentPlans.actions.execute',
  cancel: 'deploymentPlans.actions.cancel',
  rollback: 'deploymentPlans.actions.rollback',
  delete: 'deploymentPlans.actions.delete',
  edit: 'deploymentPlans.actions.edit',
} as const

type DeploymentPlanActionKey = keyof typeof deploymentPlanActionLabelKeys

function deploymentPlanActionLabel(key: DeploymentPlanActionKey): string {
  return t(deploymentPlanActionLabelKeys[key])
}

function isDeploymentPlanActionLabel(label: string, key: DeploymentPlanActionKey): boolean {
  return label === deploymentPlanActionLabel(key)
}

function messageWithOptionalPlanId(keyWithPlanId: string, keyWithoutPlanId: string, planId: string): string {
  return planId ? t(keyWithPlanId, { planId }) : t(keyWithoutPlanId)
}

function isDryRunActionLabel(label: string): boolean {
  return isDeploymentPlanActionLabel(label, 'dryRun') || label.toLowerCase().includes('dry-run')
}

const latestExecutionTitle = computed(() => resolveExecutionDialogTitle(latestExecutionMode.value))
const latestExecutionViewMode = computed<'dry-run' | 'execution'>(() => (
  latestExecutionMode.value === 'dry-run' ? 'dry-run' : 'execution'
))
const activeExecutionRow = computed(() => activeExecutionSource.value === 'related' ? relatedExecutionRow.value : dryRunRunRow.value)
const activeExecutionDetail = computed(() => activeExecutionSource.value === 'related' ? relatedExecutionDetail : dryRunExecutionDetail)
const activeExecutionChecks = computed(() => {
  if (activeExecutionSource.value === 'related') return relatedExecutionDetail.dryRunChecks.value
  return dryRunChecks.value.length ? dryRunChecks.value : dryRunExecutionDetail.dryRunChecks.value
})
const deploymentInputSourceRows = computed<DeploymentInputSourceRow[]>(() => deploymentInputSnapshots.value.flatMap((entity) => {
  const targetId = readString(entity, ['deploymentPlanTargetId'])
  const snapshot = readRecord(entity, ['snapshot'])
  const sources = readRecord(snapshot, ['sources'])
  const input = readRecord(snapshot, ['input'])
  if (!sources || !input) return []
  return Object.entries(sources).flatMap(([path, provenance]) => {
    if (!path.startsWith('variables.')) return []
    const sourceRecord = provenance && typeof provenance === 'object' && !Array.isArray(provenance) ? provenance as ApiRecord : undefined
    return [{
      id: `${targetId}:${path}`,
      targetId,
      path,
      value: displayInputValue(readPath(input, path)),
      source: readString(sourceRecord, ['source'], 'unknown'),
    }]
  })
}))
const activeExecutionError = computed(() => {
  if (activeExecutionSource.value === 'related') return relatedExecutionDetail.error.value
  if (latestExecutionMode.value !== 'dry-run') return dryRunExecutionDetail.error.value
  return dryRunExecutionDetail.error.value || dryRunActionError.value
})
const detailExecutionViewMode = computed<'dry-run' | 'execution'>(() => {
  const type = readString(dryRunRunRow.value?.raw as ApiRecord | undefined, ['type'], 'dry_run')
  return normalizeExecutionMode(type) === 'dry-run' ? 'dry-run' : 'execution'
})
const terminalPlanExecutionRunId = computed(() => {
  if (activeExecutionSource.value !== 'plan') return ''
  const runId = dryRunRunRow.value?.id ?? ''
  if (!runId) return ''
  const steps = dryRunExecutionDetail.steps.value
  if (steps.length === 0) return ''
  return steps.every((step) => isTerminalExecutionStepStatus(step.status)) ? runId : ''
})

watch(terminalPlanExecutionRunId, async (runId) => {
  if (!runId || refreshedTerminalRunIds.has(runId)) return
  refreshedTerminalRunIds.add(runId)
  await pageRef.value?.reload()
})

onUnmounted(() => {
  clearUnknownStateProbeRetry()
})

async function loadDeploymentPlansPage() {
  const [plansResult, versions, assetsResult, observationsResult] = await Promise.all([
    listDeploymentPlans({ page: 1, pageSize: 20, sort: 'updatedAt:desc' }),
    fetchAllPages((page, pageSize) => listCertificateVersions({ page, pageSize, sort: 'createdAt:desc' })),
    fetchAllPages((page, pageSize) => listAssets({ page, pageSize, sort: 'updatedAt:desc' })),
    listMonitorCertificateObservations({ page: 1, pageSize: 200 }),
  ])
  const page = plansResult.data ?? { items: [], page: 1, pageSize: 20, total: 0 }
  const assets = assetsResult
  const assetDetails = await loadApplicationAssetDetailMap(page.items ?? [], assets)
  const latestObservationsByAssetId = latestCertificateObservationsByAssetId(observationsResult.data?.items ?? [])
  const enrichedItems = (page.items ?? []).map((item) => enrichDeploymentPlanRecord(item, versions, assets, assetDetails, latestObservationsByAssetId))
  scheduleUnknownStateProbeRetry(enrichedItems, assets)
  return {
    ...plansResult,
    data: {
      ...page,
      items: enrichedItems,
    },
  }
}

function latestCertificateObservationsByAssetId(items: readonly ApiRecord[]): Map<string, ApiRecord> {
  const output = new Map<string, ApiRecord>()
  for (const item of items) {
    const serviceAssetId = readString(item, ['serviceAssetId'])
    if (!serviceAssetId) continue
    const current = output.get(serviceAssetId)
    const itemTime = Date.parse(readString(item, ['observedAt', 'createdAt']))
    const currentTime = Date.parse(readString(current, ['observedAt', 'createdAt']))
    if (!current || (Number.isFinite(itemTime) && (!Number.isFinite(currentTime) || itemTime > currentTime))) {
      output.set(serviceAssetId, item)
    }
  }
  return output
}

async function loadApplicationAssetDetailMap(
  plans: readonly ApiRecord[],
  assets: readonly ApiRecord[],
): Promise<Map<string, ApiRecord>> {
  const applicationAssetIds = Array.from(new Set(
    plans
      .map((plan) => resolveApplicationAssetIdForPlan(plan, assets))
      .filter(Boolean),
  ))
  const entries = await Promise.all(applicationAssetIds.map(async (applicationAssetId) => {
    try {
      const detail = await getAssetDetail(applicationAssetId)
      return [applicationAssetId, detail.data ?? null] as const
    } catch {
      return [applicationAssetId, null] as const
    }
  }))
  return new Map(entries.filter((entry): entry is readonly [string, ApiRecord] => Boolean(entry[1])))
}

async function openCreateDialog() {
  createDialogOpen.value = true
  editingPlanId.value = ''
  wizardInitialPlan.value = null
  resetMessages()
  await loadWizardOptions()
}

async function openEditDialog(row: ViewRow) {
  createDialogOpen.value = true
  const planId = readString(row.raw, ['id', 'planId'])
  editingPlanId.value = planId
  wizardInitialPlan.value = null
  resetMessages()
  await loadWizardOptions()
  wizardInitialPlan.value = buildInitialPlanFromRow(row.raw)
}

function closeCreateDialog(force = false) {
  if (loading.value && !force) return
  createDialogOpen.value = false
  editingPlanId.value = ''
  wizardInitialPlan.value = null
}

async function openDetailDialog(row: ViewRow) {
  detailPlanRow.value = row
  detailModalOpen.value = true
  activeDetailTab.value = 'summary'
  relatedRecordsError.value = ''
  relatedRecords.value = []
  await Promise.all([
    loadRelatedRecords(row),
    openExecutionDetailFromPlan(row),
    loadDeploymentInputSnapshots(row),
  ])
}

async function loadDeploymentInputSnapshots(row: ViewRow): Promise<void> {
  deploymentInputSnapshotsLoading.value = true
  deploymentInputSnapshotsError.value = ''
  deploymentInputSnapshots.value = []
  try {
    const planId = readString(row.raw, ['id', 'planId'], row.id)
    const result = await listDeploymentInputSnapshots(planId)
    deploymentInputSnapshots.value = [...(result.data?.items ?? [])]
  } catch (cause) {
    deploymentInputSnapshotsError.value = toErrorMessage(cause, t('deploymentPlans.detail.inputSourcesLoadFailed'))
  } finally {
    deploymentInputSnapshotsLoading.value = false
  }
}

function resetMessages() {
  errorMessage.value = ''
  infoMessage.value = ''
  approvalHint.value = ''
  dryRunRequestId.value = ''
  submitRequestId.value = ''
  dryRunChecks.value = []
  dryRunActionError.value = ''
  latestExecutionRequestId.value = ''
}

async function closeDryRunResultModal() {
  dryRunResultModalOpen.value = false
  dryRunActionError.value = ''
  latestExecutionRequestId.value = ''
  await pageRef.value?.reload()
}

function closeDryRunRequiredModal(force = false) {
  if (dryRunRequiredPending.value && !force) return
  dryRunRequiredModalOpen.value = false
  dryRunRequiredMessage.value = ''
  dryRunRequiredActionLabel.value = ''
  dryRunRequiredRow.value = null
}

async function loadWizardOptions() {
  loading.value = true
  errorMessage.value = ''
  try {
    const [assetsResult, targetsResult, certificatesResult, versionsResult, formatsResult] = await Promise.all([
      listAssets({ page: 1, pageSize: 200, sort: 'updatedAt:desc' }),
      fetchAllPages((page, pageSize) => listManagedTargets({ page, pageSize, sort: 'updatedAt:desc' })),
      listCertificates({ page: 1, pageSize: 200, sort: 'updatedAt:desc' }),
      fetchAllPages((page, pageSize) => listCertificateVersions({ page, pageSize, sort: 'createdAt:desc' })),
      fetchAllPages((page, pageSize) => listCertificateFormats({ page, pageSize, sort: 'createdAt:desc' })),
    ])

    certificateItems.value = [...(certificatesResult.data?.items ?? [])]
    certificateVersionItems.value = versionsResult
    certificateFormatItems.value = formatsResult
    const assets = assetsResult.data?.items ?? []
    const managedTargetsById = new Map(targetsResult.map((item) => [readString(item, ['id']), item]))
    const [workflowExecutionBindingsById, workflowTemplates] = await Promise.all([
      loadWorkflowExecutionBindings(assets),
      loadWorkflowTemplatesForTargets(),
    ])
    const workflowTemplatesById = new Map(workflowTemplates.map((item) => [readString(item, ['id']), item]))
    targetItems.value = assets
      .map((item) => normalizeApplicationAssetTarget(item, managedTargetsById, workflowExecutionBindingsById, workflowTemplatesById))
      .filter((item): item is ApiRecord => item !== null)
  } catch (cause) {
    errorMessage.value = toErrorMessage(cause, t('deploymentPlans.errors.loadCreateDataFailed'))
  } finally {
    loading.value = false
  }
}

async function handleSave(plan: DeploymentWizardPlan) {
  if (!plan.applicationAssetId) {
    errorMessage.value = t('deploymentPlans.errors.missingApplicationAssetIdForSave')
    return
  }
  loading.value = true
  resetMessages()
  try {
    if (editingPlanId.value) {
      const updated = await updateDeploymentPlanDraft(editingPlanId.value, plan)
      infoMessage.value = t('deploymentPlans.feedback.savedWithPlanId', { planId: String(updated.data?.id ?? editingPlanId.value) })
      await pageRef.value?.reload()
      closeCreateDialog(true)
      return
    }
    const planId = await createPlanDraft(plan)
    infoMessage.value = t('deploymentPlans.feedback.savedWithPlanId', { planId })
    editingPlanId.value = planId
    await pageRef.value?.reload()
    closeCreateDialog(true)
  } catch (cause) {
    errorMessage.value = toErrorMessage(cause, t('deploymentPlans.errors.saveFailed'))
  } finally {
    loading.value = false
  }
}

async function loadRelatedRecords(row: ViewRow) {
  relatedRecordsLoading.value = true
  relatedRecordsError.value = ''
  try {
    const currentPlanId = readString(row.raw, ['id', 'planId'])
    const currentTargetKeys = collectTargetKeys(row.raw)
    const plansResult = await listDeploymentPlans({ page: 1, pageSize: 200, sort: 'updatedAt:desc' })
    const plans = [...(plansResult.data?.items ?? [])]
    const matchingPlans = plans.filter((plan) => {
      const planId = readString(plan, ['id', 'planId'])
      if (!planId) return false
      if (planId === currentPlanId) return true
      const targetKeys = collectTargetKeys(plan)
      return [...targetKeys].some((key) => currentTargetKeys.has(key))
    })

    const records = (await Promise.all(matchingPlans.map(async (plan) => {
      const planId = readString(plan, ['id', 'planId'])
      if (!planId) return []
      const runsResult = await listExecutionsByPlanId(planId, { page: 1, pageSize: 200, sort: 'createdAt:desc' })
      const runs = [...(runsResult.data?.items ?? [])]
      return runs
        .map((run) => {
          const runId = readString(run, ['id', 'runId'])
          const kind = normalizeRelatedRecordKind(readString(run, ['type'], '').toLowerCase())
          if (!runId || !kind) return null
          return buildRelatedExecutionRecord(plan, run, runId, kind)
        })
        .filter((item): item is RelatedExecutionRecord => item !== null)
    }))).flat().sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))

    relatedRecords.value = dedupeRelatedRecords(records)
  } catch (cause) {
    relatedRecordsError.value = toErrorMessage(cause, t('deploymentPlans.errors.loadRelatedRecordsFailed'))
  } finally {
    relatedRecordsLoading.value = false
  }
}

async function openExecutionDetailFromPlan(row: ViewRow) {
  const latestRun = readRecord(row.raw, ['latestRun'])
  const runId = readString(latestRun, ['id', 'runId'])
    || readString(row.raw, ['latestRunId', 'runId'])
  if (!runId) {
    dryRunRunRow.value = null
    return
  }
  const runStatus = readString(latestRun, ['status'], readString(row.raw, ['status'], 'UNKNOWN'))
  const runType = readString(latestRun, ['type'], readString(row.raw, ['latestRunType', 'type'], 'dry_run'))
  dryRunRunRow.value = {
    id: runId,
    name: t('deploymentPlans.execution.fallbackName', { runId }),
    status: runStatus,
    risk: normalizeRisk(readString(row.raw, ['risk', 'riskLevel'], 'HIGH')),
    raw: { id: runId, runId, status: runStatus, type: runType },
  }
}

function openRelatedExecutionDetail(record: RelatedExecutionRecord) {
  dryRunActionError.value = ''
  activeExecutionSource.value = 'related'
  relatedExecutionRow.value = {
    id: record.runId,
    name: record.planName,
    status: record.status,
    risk: record.kind === 'dry-run' ? 'MEDIUM' : normalizeRisk(readString(record.raw, ['risk', 'riskLevel'], 'HIGH')),
    raw: {
      id: record.runId,
      runId: record.runId,
      deploymentPlanId: record.planId,
      status: record.status,
      type: record.type,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      planName: record.planName,
    },
  }
  latestExecutionMode.value = normalizeExecutionMode(record.type)
  latestExecutionRequestId.value = ''
  dryRunResultModalOpen.value = true
}

async function handleDryRun(plan: DeploymentWizardPlan) {
  if (!plan.applicationAssetId) {
    errorMessage.value = t('deploymentPlans.errors.missingApplicationAssetIdForDryRun')
    return
  }
  loading.value = true
  resetMessages()
  try {
    const planId = await ensurePlanId(plan)
    const dryRun = await dryRunDeploymentPlan({ planId })
    dryRunRequestId.value = dryRun.requestId
    openExecutionModalFromResult(dryRun, 'dry-run')
    dryRunResultModalOpen.value = true
    dryRunChecks.value = extractDryRunChecks(dryRun.data)
    const runId = dryRunRunRow.value?.id ?? ''
    infoMessage.value = runId
      ? t('deploymentPlans.feedback.dryRunStartedWithRunId', { runId })
      : t('deploymentPlans.feedback.dryRunStartedMissingRunId')
    await pageRef.value?.reload()
  } catch (cause) {
    dryRunRunRow.value = null
    errorMessage.value = toErrorMessage(cause, t('deploymentPlans.errors.startDryRunFailed'))
  } finally {
    loading.value = false
  }
}

async function ensurePlanId(plan: DeploymentWizardPlan): Promise<string> {
  if (editingPlanId.value) return editingPlanId.value
  const planId = await createPlanDraft(plan)
  editingPlanId.value = planId
  return planId
}

async function createPlanDraft(plan: DeploymentWizardPlan): Promise<string> {
  const applicationAssetId = plan.applicationAssetId
  if (!applicationAssetId) throw new Error(t('deploymentPlans.errors.missingApplicationAssetIdForSave'))
  const created = await createDeploymentPlanFromApplicationAsset({
    applicationAssetId,
    selectionMode: plan.selectionMode,
    targetCertificateVersionId: plan.certificateVersionId || undefined,
    certificateFormatId: plan.certificateFormatId || undefined,
  })
  const planId = String(created.data?.id ?? '')
  if (!planId) throw new Error(t('deploymentPlans.errors.createReturnedMissingPlanId'))
  await probeApplicationAssetCertificate(applicationAssetId)
  return planId
}

async function probeApplicationAssetCertificate(applicationAssetId: string): Promise<boolean> {
  if (!applicationAssetId || probingAssetIds.has(applicationAssetId)) return false
  probingAssetIds.add(applicationAssetId)
  try {
    await probeMonitorServiceAsset({
      serviceAssetId: applicationAssetId,
      timeoutMs: 10000,
    })
    return true
  } catch {
    return false
  } finally {
    probingAssetIds.delete(applicationAssetId)
  }
}

function scheduleUnknownStateProbeRetry(plans: readonly ApiRecord[], assets: readonly ApiRecord[]) {
  const applicationAssetIds = unknownUpdateApplicationAssetIds(plans, assets)
  clearUnknownStateProbeRetry()
  if (applicationAssetIds.length === 0) return
  unknownStateProbeTimer = window.setTimeout(() => {
    unknownStateProbeTimer = null
    void retryUnknownStateProbe(applicationAssetIds)
  }, unknownStateProbeRetryMs)
}

function clearUnknownStateProbeRetry() {
  if (!unknownStateProbeTimer) return
  window.clearTimeout(unknownStateProbeTimer)
  unknownStateProbeTimer = null
}

async function retryUnknownStateProbe(applicationAssetIds: readonly string[]) {
  await Promise.all(applicationAssetIds.map((applicationAssetId) => probeApplicationAssetCertificate(applicationAssetId)))
  await pageRef.value?.reload()
}

function unknownUpdateApplicationAssetIds(plans: readonly ApiRecord[], assets: readonly ApiRecord[]): string[] {
  return [...new Set(plans
    .filter((plan) => readString(plan, ['updateNeeded']) === 'UNKNOWN')
    .map((plan) => resolveApplicationAssetIdForPlan(plan, assets))
    .filter(Boolean))]
}

async function updateDeploymentPlanDraft(planId: string, plan: DeploymentWizardPlan) {
  return updateDeploymentPlanFromApplicationAsset({
    planId,
    applicationAssetId: plan.applicationAssetId,
    selectionMode: plan.selectionMode,
    targetCertificateVersionId: plan.certificateVersionId || undefined,
    certificateFormatId: plan.certificateFormatId || undefined,
  })
}

async function runPlanAction(actionLabel: string, row: ViewRow | null, run: () => Promise<unknown> | undefined): Promise<unknown> {
  const result = await run()
  if (isDeploymentPlanActionLabel(actionLabel, 'dryRun')) {
    openExecutionModalFromResult(result, 'dry-run', row)
  } else if (isDeploymentPlanActionLabel(actionLabel, 'execute')) {
    openExecutionModalFromResult(result, 'apply', row)
  } else if (isDeploymentPlanActionLabel(actionLabel, 'rollback')) {
    openExecutionModalFromResult(result, 'rollback', row)
  }
  return result
}

async function handleActionFeedback(actionLabel: string, row: ViewRow | null, result?: unknown) {
  const planId = row ? readString(row.raw, ['id', 'planId']) : ''
  const runId = readString(readRecord(readResponseData(result), ['run']), ['id', 'runId'])
    || readString(readResponseData(result), ['runId', 'id'])
  if (isDeploymentPlanActionLabel(actionLabel, 'delete')) {
    infoMessage.value = messageWithOptionalPlanId('deploymentPlans.feedback.deletedWithPlanId', 'deploymentPlans.feedback.deleted', planId)
  } else if (isDeploymentPlanActionLabel(actionLabel, 'submit')) {
    infoMessage.value = messageWithOptionalPlanId('deploymentPlans.feedback.submittedWithPlanId', 'deploymentPlans.feedback.submitted', planId)
  } else if (isDeploymentPlanActionLabel(actionLabel, 'execute')) {
    infoMessage.value = runId
      ? t('deploymentPlans.feedback.executeTriggeredWithRunId', { runId })
      : messageWithOptionalPlanId('deploymentPlans.feedback.executeTriggeredWithPlanId', 'deploymentPlans.feedback.executeTriggered', planId)
  } else if (isDeploymentPlanActionLabel(actionLabel, 'dryRun')) {
    infoMessage.value = runId
      ? t('deploymentPlans.feedback.dryRunTriggeredWithRunId', { runId })
      : messageWithOptionalPlanId('deploymentPlans.feedback.dryRunTriggeredWithPlanId', 'deploymentPlans.feedback.dryRunTriggered', planId)
  } else if (isDeploymentPlanActionLabel(actionLabel, 'cancel')) {
    infoMessage.value = messageWithOptionalPlanId('deploymentPlans.feedback.cancelledWithPlanId', 'deploymentPlans.feedback.cancelled', planId)
  } else if (isDeploymentPlanActionLabel(actionLabel, 'edit')) {
    infoMessage.value = messageWithOptionalPlanId('deploymentPlans.feedback.loadedDraftWithPlanId', 'deploymentPlans.feedback.loadedDraft', planId)
  }
  await pageRef.value?.reload()
}

function handleActionError(actionLabel: string, row: ViewRow | null, cause: unknown) {
  if (shouldPromptDryRun(actionLabel, cause)) {
    dryRunRequiredRow.value = row
    dryRunRequiredActionLabel.value = actionLabel
    dryRunRequiredMessage.value = toErrorMessage(cause, t('deploymentPlans.disabled.needDryRun'))
    dryRunRequiredModalOpen.value = true
    errorMessage.value = ''
    infoMessage.value = ''
    return
  }
  if (isDryRunActionLabel(actionLabel)) {
    dryRunResultModalOpen.value = true
    errorMessage.value = ''
    infoMessage.value = ''
    dryRunChecks.value = []
    dryRunRunRow.value = null
    dryRunActionError.value = toErrorMessage(cause, t('deploymentPlans.errors.startDryRunFailed'))
    return
  }
  errorMessage.value = toErrorMessage(cause, t('deploymentPlans.errors.actionFailed', { action: actionLabel }))
}

function shouldPromptDryRun(actionLabel: string, cause: unknown): boolean {
  if (!isDeploymentPlanActionLabel(actionLabel, 'execute')) return false
  const message = toErrorMessage(cause, '').toLowerCase()
  return message.includes('dry-run')
}

async function runRequiredDryRun() {
  if (!dryRunRequiredRow.value || dryRunRequiredPending.value) return
  const row = dryRunRequiredRow.value
  dryRunRequiredPending.value = true
  closeDryRunRequiredModal(true)
  try {
    const dryRunLabel = deploymentPlanActionLabel('dryRun')
    const result = await runPlanAction(
      dryRunLabel,
      row,
      () => dryRunDeploymentPlan({ planId: readString(row.raw, ['id', 'planId']) }),
    )
    await handleActionFeedback(dryRunLabel, row, result)
  } catch (cause) {
    handleActionError(deploymentPlanActionLabel('dryRun'), row, cause)
  } finally {
    dryRunRequiredPending.value = false
  }
}

function openExecutionModalFromResult(result: unknown, mode: 'dry-run' | 'apply' | 'rollback', fallbackRow?: ViewRow | null) {
  dryRunActionError.value = ''
  activeExecutionSource.value = 'plan'
  const data = readResponseData(result)
  const run = readRecord(data, ['run'])
  const runId = readString(run, ['id', 'runId']) || readString(data, ['runId'])
  if (!runId) return
  latestExecutionMode.value = mode
  latestExecutionRequestId.value = readString(result as ApiRecord, ['requestId'], '')
  dryRunResultModalOpen.value = true
  dryRunRequestId.value = readString(result as ApiRecord, ['requestId'], dryRunRequestId.value)
  dryRunRunRow.value = {
    id: runId,
    name: mode === 'dry-run' ? `Dry-run ${runId}` : t('deploymentPlans.execution.applyName', { runId }),
    status: readString(run, ['status'], 'DISPATCHED'),
    risk: mode === 'dry-run' ? 'MEDIUM' : normalizeRisk(readString(fallbackRow?.raw, ['risk', 'riskLevel'], 'HIGH')),
    raw: run ?? { id: runId },
  }
  if (mode === 'dry-run') {
    dryRunChecks.value = extractDryRunChecks(data)
  } else {
    dryRunChecks.value = []
  }
}

function resolveExecutionDialogTitle(mode: 'dry-run' | 'apply' | 'rollback'): string {
  if (mode === 'rollback') return t('deploymentPlans.execution.rollbackTitle')
  if (mode === 'apply') return t('deploymentPlans.execution.applyTitle')
  return t('deploymentPlans.execution.dryRunTitle')
}

function isTerminalExecutionStepStatus(status: string): boolean {
  return ['SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED', 'CANCELED', 'SKIPPED'].includes(status.toUpperCase())
}

function normalizeExecutionMode(type: string): 'dry-run' | 'apply' | 'rollback' {
  const normalized = type.trim().toLowerCase()
  if (normalized === 'rollback') return 'rollback'
  if (normalized === 'dry_run') return 'dry-run'
  return 'apply'
}

function readResponseData(result: unknown): ApiRecord | undefined {
  if (!result || typeof result !== 'object') return undefined
  const data = (result as { data?: unknown }).data
  if (data && typeof data === 'object' && !Array.isArray(data)) return data as ApiRecord
  return result as ApiRecord
}

function normalizeApplicationAssetTarget(
  item: ApiRecord,
  managedTargetsById: ReadonlyMap<string, ApiRecord>,
  workflowExecutionBindingsById: ReadonlyMap<string, ApiRecord>,
  workflowTemplatesById: ReadonlyMap<string, ApiRecord>,
): ApiRecord | null {
  const applicationAssetId = readString(item, ['id'])
  if (!applicationAssetId) return null

  const deploymentStrategyType = readString(item, ['deploymentStrategy.type', 'metadata.deploymentStrategy.type'])
  if (deploymentStrategyType === 'WORKFLOW') {
    return normalizeWorkflowApplicationAssetTarget(
      item,
      applicationAssetId,
      workflowExecutionBindingsById,
      workflowTemplatesById,
    )
  }

  const managedTargetId = readString(item, ['deploymentStrategy.managedTarget.managedTargetId', 'targetBinding.managedTargetId'])
  const managedTarget = managedTargetsById.get(managedTargetId)
  const certificateFormatId = readString(item, [
    'deploymentStrategy.managedTarget.certificateFormatId',
    'metadata.deploymentStrategy.managedTarget.certificateFormatId',
    'certificateFormatId',
    'metadata.certificateFormatId',
  ])
  const certificateBindings = Array.isArray(readPath(item, 'targetBindingDetail.certificateBindings'))
    ? readPath(item, 'targetBindingDetail.certificateBindings') as ApiRecord[]
    : []
  const certificateBindingId = readString(certificateBindings[0], ['id'])
  if (!managedTargetId) return null

  const displayName = readString(item, ['displayName', 'address', 'domainName'], applicationAssetId)
  const targetType = readString(managedTarget, ['targetType'])
  const targetKey = readString(managedTarget, ['targetKey'])
  const bindingKey = readString(managedTarget, ['bindingKey'])
  const siteAssetId = readString(managedTarget, ['siteId'])
  const siteName = readString(item, ['targetBinding.metadata.siteName'])
  const frameworkLabel = readString(managedTarget, ['frameworkInstanceId'])
  const executionLocations = readString(managedTarget, ['executionLocations'])
  const bindingSummary = readString(item, ['targetBinding.metadata.bindingInformation'], bindingKey || targetKey || targetType)

  return {
    id: applicationAssetId,
    applicationAssetId,
    name: displayName,
    displayName,
    frameworkLabel,
    siteName,
    bindingSummary,
    bindingName: bindingSummary,
    managedTargetId,
    managedTargetLabel: buildManagedTargetLabel(targetType, targetKey, managedTargetId),
    siteAssetId,
    targetType,
    targetKey,
    executionLocations,
    certificateBindingId,
    certificateFormatId,
    certificateFormatLabel: certificateFormatLabelById(certificateFormatId),
  }
}

function normalizeWorkflowApplicationAssetTarget(
  item: ApiRecord,
  applicationAssetId: string,
  workflowExecutionBindingsById: ReadonlyMap<string, ApiRecord>,
  workflowTemplatesById: ReadonlyMap<string, ApiRecord>,
): ApiRecord {
  const displayName = readString(item, ['displayName', 'address', 'domainName'], applicationAssetId)
  const workflowExecutionBindingId = readString(item, [
    'deploymentStrategy.workflow.workflowExecutionBindingId',
    'metadata.deploymentStrategy.workflow.workflowExecutionBindingId',
  ])
  const workflowExecutionBinding = workflowExecutionBindingsById.get(workflowExecutionBindingId)
  const workflowId = readString(workflowExecutionBinding, ['workflowTemplateId']) || readString(item, [
    'deploymentStrategy.workflow.workflowId',
    'metadata.deploymentStrategy.workflow.workflowId',
  ])
  const workflowTemplate = workflowTemplatesById.get(workflowId)
  const workflowName = readString(workflowTemplate, ['name', 'displayName'], workflowId)
  const workflowRunner = readString(workflowExecutionBinding, ['runner']) || readString(item, [
    'deploymentStrategy.workflow.runner',
    'metadata.deploymentStrategy.workflow.runner',
  ])
  const certificateFormatId = workflowCertificateFormatId(workflowExecutionBinding)
  const targetSourceLabel = workflowName
    ? t('designSystem.deploymentWizard.target.workflowModeWithName', { name: workflowName })
    : t('designSystem.deploymentWizard.target.workflowMode')

  return {
    id: applicationAssetId,
    applicationAssetId,
    name: displayName,
    displayName,
    domainName: readString(item, ['address', 'domainName']),
    bindingSummary: workflowName,
    bindingName: workflowName,
    targetType: 'WORKFLOW',
    targetKey: workflowExecutionBindingId || workflowId,
    executionLocations: workflowRunner,
    targetSourceLabel,
    certificateFormatId,
    certificateFormatLabel: certificateFormatLabelById(certificateFormatId),
    workflowId,
    workflowName,
    workflowExecutionBindingId,
  }
}

async function loadWorkflowExecutionBindings(assets: readonly ApiRecord[]): Promise<Map<string, ApiRecord>> {
  const bindingIds = [...new Set(assets.map((item) => readString(item, [
    'deploymentStrategy.workflow.workflowExecutionBindingId',
    'metadata.deploymentStrategy.workflow.workflowExecutionBindingId',
  ])).filter(Boolean))]
  const entries = await Promise.all(bindingIds.map(async (bindingId) => {
    try {
      const result = await getWorkflowExecutionBinding(bindingId)
      const binding = result.data && typeof result.data === 'object' && !Array.isArray(result.data)
        ? result.data as ApiRecord
        : undefined
      return [bindingId, binding] as const
    } catch {
      return [bindingId, undefined] as const
    }
  }))
  return new Map(entries.filter((entry): entry is readonly [string, ApiRecord] => Boolean(entry[1])))
}

async function loadWorkflowTemplatesForTargets(): Promise<ApiRecord[]> {
  try {
    return await fetchAllPages((page, pageSize) => listWorkflowTemplates({ page, pageSize, sort: 'updatedAt:desc' }))
  } catch {
    return []
  }
}

function workflowCertificateFormatId(binding: ApiRecord | undefined): string {
  const artifacts = readRecord(binding, ['inputBindings.artifacts'])
  if (!artifacts) return ''
  for (const artifactBinding of Object.values(artifacts)) {
    if (!artifactBinding || typeof artifactBinding !== 'object' || Array.isArray(artifactBinding)) continue
    const certificateFormatId = readString(artifactBinding as ApiRecord, ['certificateFormatId'])
    if (certificateFormatId) return certificateFormatId
  }
  return ''
}

function buildManagedTargetLabel(targetType: string, targetKey: string, managedTargetId: string): string {
  return [targetType, targetKey].filter(Boolean).join(' / ') || managedTargetId
}

function certificateFormatLabelById(certificateFormatId: string): string {
  if (!certificateFormatId) return t('deploymentPlans.common.notConfigured')
  const item = certificateFormatItems.value.find((format) => readString(format, ['id']) === certificateFormatId)
  if (!item) return certificateFormatId
  const configName = readString(item, ['parameters.configName', 'parameters.alias', 'parameters.friendlyName', 'name'], certificateFormatId)
  const format = readString(item, ['format'], 'unknown').toUpperCase()
  const platform = [readString(item, ['parameters.systemPlatform']), readString(item, ['parameters.runtimePlatform'])].filter(Boolean).join('/')
  return [configName, format, platform].filter(Boolean).join(' / ')
}

function buildInitialPlanFromRow(row: ApiRecord): DeploymentWizardInitialPlan {
  const certificateVersionId = readString(row, ['certificateVersionId'])
  const certificateVersion = certificateVersionItems.value.find((item) => readString(item, ['id', 'certificateVersionId']) === certificateVersionId)
  const selectionMode = readString(row, ['selectionMode'], 'EXPLICIT')
  return {
    certificateId: readString(certificateVersion, ['certificateAssetId', 'certificateId']),
    certificateVersionId,
    applicationAssetId: resolveApplicationAssetIdFromPlan(row),
    selectionMode: selectionMode === 'LATEST_AUTO' ? 'LATEST_AUTO' : 'EXPLICIT',
  }
}

function resolveApplicationAssetIdFromPlan(row: ApiRecord): string {
  const targets = Array.isArray(row.targets) ? row.targets as ApiRecord[] : []
  const target = targets[0]
  const certificateBindingId = readString(target, ['certificateBindingId'])
  const executionTargetId = readString(target, ['executionTargetId'])
  const matched = targetItems.value.find((item) => (
    readString(item, ['applicationAssetId', 'id']) === readString(target, ['applicationAssetId', 'serviceAssetId'])
    || (certificateBindingId && readString(item, ['certificateBindingId']) === certificateBindingId)
    || (executionTargetId && readString(item, ['managedTargetId']) === executionTargetId)
  ))
  return readString(matched, ['applicationAssetId', 'id'], readString(target, ['applicationAssetId', 'serviceAssetId']))
}

function extractDryRunChecks(data: ApiRecord | undefined): ApiRecord[] {
  if (!data) return []
  const steps = Array.isArray(data.steps) ? data.steps as ApiRecord[] : []
  for (const step of steps) {
    const resultDetail = readPath(step, 'inputSnapshot.resultDetail')
    if (resultDetail && typeof resultDetail === 'object') {
      const checks = (resultDetail as Record<string, unknown>).dryRunChecks
      if (Array.isArray(checks)) return checks as ApiRecord[]
    }
  }
  return []
}

function readRecord(record: ApiRecord | null | undefined, candidates: readonly string[]): ApiRecord | undefined {
  for (const candidate of candidates) {
    const value = readPath(record, candidate)
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as ApiRecord
  }
  return undefined
}

function toErrorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof ApiClientError) return cause.message
  if (cause instanceof Error && cause.message.trim()) return cause.message
  return fallback
}

function readPath(record: ApiRecord | null | undefined, path: string): unknown {
  if (!record) return undefined
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[segment]
  }, record)
}

function readString(record: ApiRecord | null | undefined, candidates: readonly string[], fallback = ''): string {
  for (const candidate of candidates) {
    const value = readPath(record, candidate)
    if (value === undefined || value === null || value === '') continue
    return String(value)
  }
  return fallback
}

function displayInputValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return t('deploymentPlans.common.notProvided')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function normalizeRisk(value: string): ViewRow['risk'] {
  const risk = value.toUpperCase()
  return risk === 'LOW' || risk === 'MEDIUM' || risk === 'HIGH' || risk === 'CRITICAL' ? risk : 'HIGH'
}

function collectTargetKeys(record: ApiRecord | null | undefined): Set<string> {
  const targets = Array.isArray(record?.targets) ? record.targets as ApiRecord[] : []
  return new Set(
    targets.flatMap((target) => [
      readString(target, ['certificateBindingId']),
      readString(target, ['executionTargetId']),
    ].filter(Boolean)),
  )
}

function normalizeRelatedRecordKind(type: string): RelatedRecordKind | '' {
  if (type === 'dry_run') return 'dry-run'
  if (type === 'apply' || type === 'rollback') return 'certificate-update'
  return ''
}

function buildRelatedExecutionRecord(
  plan: ApiRecord,
  run: ApiRecord | undefined,
  runId: string,
  kind: RelatedRecordKind,
): RelatedExecutionRecord {
  const planId = readString(plan, ['id', 'planId'])
  const planName = readString(plan, ['name', 'title', 'planName'], planId)
  return {
    id: `${planId}:${runId}`,
    runId,
    planId,
    planName,
    status: readString(run, ['status'], readString(plan, ['status', 'state'], 'UNKNOWN')),
    type: readString(run, ['type'], ''),
    kind,
    createdReason: readString(plan, ['createdReason'], 'MANUAL'),
    createdAt: readString(run, ['createdAt'], readString(plan, ['createdAt'])),
    updatedAt: readString(run, ['updatedAt', 'finishedAt'], readString(plan, ['updatedAt'])),
    targetSummary: readString(plan, ['targetSummary', 'targets.0.certificateBindingId', 'targets.0.executionTargetId']),
    certificateVersionId: readString(plan, ['certificateVersionId']),
    certificateFormatId: readString(plan, ['certificateFormatId']),
    raw: {
      ...plan,
      latestRun: run,
      latestRunId: runId,
    },
  }
}

function dedupeRelatedRecords(records: readonly RelatedExecutionRecord[]): RelatedExecutionRecord[] {
  const seen = new Set<string>()
  return records.filter((record) => {
    if (seen.has(record.runId)) return false
    seen.add(record.runId)
    return true
  })
}

async function fetchAllPages(
  loader: (page: number, pageSize: number) => Promise<{ data?: { items?: readonly ApiRecord[]; total?: number; pageSize?: number } }>,
  pageSize = 200,
): Promise<ApiRecord[]> {
  const items: ApiRecord[] = []
  let page = 1
  let total = Number.POSITIVE_INFINITY

  while (items.length < total) {
    const result = await loader(page, pageSize)
    const currentItems = result.data?.items ?? []
    const currentTotal = Number(result.data?.total ?? currentItems.length)
    items.push(...currentItems)
    total = Number.isFinite(currentTotal) ? currentTotal : items.length
    if (currentItems.length < pageSize) break
    page += 1
  }

  return items
}
</script>

<template>
  <section class="deployment-plans-page">
    <BusinessResourcePage ref="pageRef" :config="pageConfig" />

    <GcModal
      v-model:open="createDialogOpen"
      size="xxl"
      width="var(--gc-size-modal-wide)"
      frameless
    >
      <p v-if="errorMessage" class="deployment-plans-page__error deployment-plans-page__wizard-message">{{ errorMessage }}</p>
      <p v-else-if="infoMessage" class="deployment-plans-page__info deployment-plans-page__wizard-message">{{ infoMessage }}</p>

      <GcDeploymentWizard
        :certificates="certificateItems"
        :certificate-versions="certificateVersionItems"
        :certificate-formats="certificateFormatItems"
        :targets="targetItems"
        :loading="loading"
        :initial-plan="wizardInitialPlan"
        :dry-run-request-id="dryRunRequestId"
        :submit-request-id="submitRequestId"
        :approval-hint="approvalHint"
        :dry-run-checks="dryRunChecks"
        @save="handleSave"
        @dry-run="handleDryRun"
        @cancel="closeCreateDialog"
      />
    </GcModal>

    <GcDryRunResultModal
      :open="dryRunResultModalOpen"
      :title="latestExecutionTitle"
      :run-id="activeExecutionRow?.id"
      :request-id="latestExecutionRequestId || activeExecutionDetail.requestId.value || dryRunRequestId"
      :summary="activeExecutionDetail.dryRunSummary.value"
      :checks="activeExecutionChecks"
      :steps="activeExecutionDetail.steps.value"
      :lines="activeExecutionDetail.lines.value"
      :loading="activeExecutionDetail.loading.value"
      :polling="activeExecutionDetail.isPolling.value"
      :error="activeExecutionError"
      :mode="latestExecutionViewMode"
      @update:open="(value) => value ? (dryRunResultModalOpen = true) : void closeDryRunResultModal()"
    />

    <GcModal
      v-model:open="dryRunRequiredModalOpen"
      :title="t('deploymentPlans.dryRunRequired.title')"
      :description="t('deploymentPlans.dryRunRequired.description')"
      size="md"
      width="560px"
      :close-on-backdrop="!dryRunRequiredPending"
    >
      <section class="deployment-plans-page__dry-run-required">
        <p class="deployment-plans-page__error">{{ dryRunRequiredMessage }}</p>
        <p class="deployment-plans-page__dry-run-required-copy">
          {{ t('deploymentPlans.dryRunRequired.copy', { action: dryRunRequiredActionLabel || deploymentPlanActionLabel('execute') }) }}
        </p>
      </section>

      <template #actions>
        <button class="gc-button" type="button" :disabled="dryRunRequiredPending" @click="closeDryRunRequiredModal()">{{ t('deploymentPlans.common.cancel') }}</button>
        <button class="gc-button gc-button--primary" type="button" :disabled="dryRunRequiredPending" @click="runRequiredDryRun">
          {{ dryRunRequiredPending ? t('deploymentPlans.dryRunRequired.runningAction') : t('deploymentPlans.dryRunRequired.primaryAction') }}
        </button>
      </template>
    </GcModal>

    <GcModal
      v-model:open="detailModalOpen"
      :title="detailPlanRow ? t('deploymentPlans.detail.titleWithName', { name: readString(detailPlanRow.raw, ['name', 'title', 'planName'], detailPlanRow.id) }) : t('deploymentPlans.detail.title')"
      :description="t('deploymentPlans.detail.description')"
      size="xxl"
      width="min(1240px, calc(100vw - 32px))"
    >
      <section v-if="detailPlanRow" class="deployment-plan-detail">
        <section class="deployment-plan-detail__hero">
          <div class="deployment-plan-detail__hero-copy">
            <p class="deployment-plan-detail__eyebrow">Deployment Plan</p>
            <h2>{{ readString(detailPlanRow.raw, ['name', 'title', 'planName'], detailPlanRow.id) }}</h2>
            <span>{{ t('deploymentPlans.detail.planIdLine', { planId: readString(detailPlanRow.raw, ['id', 'planId']) }) }}</span>
          </div>
          <div class="deployment-plan-detail__hero-side">
            <GcStatusTag :status="readString(detailPlanRow.raw, ['status', 'state'])" />
            <div class="deployment-plan-detail__spotlight">
              <small>{{ t('deploymentPlans.fields.updateNeeded') }}</small>
              <GcStatusTag :status="readString(detailPlanRow.raw, ['updateNeeded'], 'UNKNOWN')" />
            </div>
          </div>
        </section>

        <div class="deployment-plan-detail__tabs">
          <button class="deployment-plan-detail__tab" type="button" :data-active="activeDetailTab === 'summary'" @click="activeDetailTab = 'summary'">{{ t('deploymentPlans.detail.tabs.summary') }}</button>
          <button class="deployment-plan-detail__tab" type="button" :data-active="activeDetailTab === 'versions'" @click="activeDetailTab = 'versions'">{{ t('deploymentPlans.detail.tabs.relatedRecords') }}</button>
          <button class="deployment-plan-detail__tab" type="button" :data-active="activeDetailTab === 'execution'" @click="activeDetailTab = 'execution'">{{ t('deploymentPlans.detail.tabs.latestExecution') }}</button>
        </div>

        <section v-if="activeDetailTab === 'summary'" class="deployment-plan-detail__section">
          <dl class="deployment-plan-detail__facts">
            <div><dt>{{ t('deploymentPlans.fields.planId') }}</dt><dd>{{ readString(detailPlanRow.raw, ['id', 'planId']) }}</dd></div>
            <div><dt>{{ t('deploymentPlans.fields.status') }}</dt><dd>{{ readString(detailPlanRow.raw, ['status', 'state']) }}</dd></div>
            <div><dt>{{ t('deploymentPlans.fields.approvalStatus') }}</dt><dd>{{ readString(detailPlanRow.raw, ['approval.status', 'approvalStatus']) }}</dd></div>
            <div><dt>{{ t('deploymentPlans.fields.certificateVersionId') }}</dt><dd>{{ readString(detailPlanRow.raw, ['certificateVersionId']) }}</dd></div>
            <div><dt>{{ t('deploymentPlans.fields.certificateFormatId') }}</dt><dd>{{ readString(detailPlanRow.raw, ['certificateFormatId']) }}</dd></div>
            <div><dt>{{ t('deploymentPlans.fields.targetSummary') }}</dt><dd>{{ readString(detailPlanRow.raw, ['targetSummary', 'targets.0.certificateBindingId', 'targets.0.executionTargetId']) }}</dd></div>
            <div><dt>{{ t('deploymentPlans.fields.latestRun') }}</dt><dd>{{ readString(detailPlanRow.raw, ['latestRunId', 'latestRun.id', 'runs.0.id', 'executionRuns.0.id']) }}</dd></div>
            <div><dt>{{ t('deploymentPlans.fields.failureReason') }}</dt><dd>{{ readString(detailPlanRow.raw, ['failureReason', 'error.message', 'latestRun.failureReason']) }}</dd></div>
          </dl>
          <section class="deployment-plan-detail__input-sources">
            <h3>{{ t('deploymentPlans.detail.inputSourcesTitle') }}</h3>
            <p v-if="deploymentInputSnapshotsLoading" class="deployment-plan-detail__loading">{{ t('common.loading') }}</p>
            <p v-else-if="deploymentInputSnapshotsError" class="deployment-plan-detail__error">{{ deploymentInputSnapshotsError }}</p>
            <ul v-else-if="deploymentInputSourceRows.length" class="deployment-plan-detail__list">
              <li v-for="item in deploymentInputSourceRows" :key="item.id" class="deployment-plan-detail__list-item">
                <div class="deployment-plan-detail__list-head">
                  <strong>{{ item.path }}</strong>
                  <span>{{ t('deploymentPlans.detail.inputSource', { source: item.source }) }}</span>
                </div>
                <p>{{ item.value }}</p>
                <small>{{ t('deploymentPlans.detail.inputSourceTarget', { targetId: item.targetId }) }}</small>
              </li>
            </ul>
            <p v-else class="deployment-plan-detail__loading">{{ t('deploymentPlans.detail.noInputSources') }}</p>
          </section>
        </section>

        <section v-else-if="activeDetailTab === 'versions'" class="deployment-plan-detail__section">
          <p v-if="relatedRecordsLoading" class="deployment-plan-detail__loading">{{ t('deploymentPlans.detail.loadingRelatedRecords') }}</p>
          <p v-else-if="relatedRecordsError" class="deployment-plan-detail__error">{{ relatedRecordsError }}</p>
          <ul v-else-if="relatedRecords.length" class="deployment-plan-detail__list deployment-plan-detail__related-list">
            <li v-for="item in relatedRecords" :key="item.id" class="deployment-plan-detail__list-item deployment-plan-detail__related-item">
              <div class="deployment-plan-detail__list-head">
                <div class="deployment-plan-detail__related-main">
                  <strong>{{ item.planName }}</strong>
                </div>
                <div class="deployment-plan-detail__related-status">
                  <span
                    class="deployment-plan-detail__record-tag"
                    :data-kind="item.kind"
                  >
                    {{ item.kind === 'dry-run' ? t('deploymentPlans.detail.recordKinds.dryRun') : t('deploymentPlans.detail.recordKinds.certificateUpdate') }}
                  </span>
                  <GcStatusTag :status="item.status" />
                  <button class="gc-button deployment-plan-detail__related-action" type="button" @click="openRelatedExecutionDetail(item)">{{ t('deploymentPlans.detail.viewLogs') }}</button>
                </div>
              </div>
              <div class="deployment-plan-detail__related-meta">
                <span>{{ t('deploymentPlans.detail.relatedPlan', { planId: item.planId }) }}</span>
                <span>{{ t('deploymentPlans.detail.relatedRun', { runId: item.runId }) }}</span>
                <span>{{ t('deploymentPlans.detail.relatedSource', { source: item.createdReason }) }}</span>
                <span>{{ formatBrowserLocalTime(item.updatedAt || item.createdAt) || item.updatedAt || item.createdAt }}</span>
              </div>
              <p>
                <span class="deployment-plan-detail__related-label">{{ t('deploymentPlans.detail.targetLabel') }}</span>
                {{ item.targetSummary || t('deploymentPlans.detail.noTargetSummary') }}
                <span class="deployment-plan-detail__related-separator">·</span>
                <span class="deployment-plan-detail__related-label">{{ t('deploymentPlans.detail.certificateVersionLabel') }}</span>
                {{ item.certificateVersionId || t('deploymentPlans.common.notProvided') }}
              </p>
            </li>
          </ul>
          <p v-else class="deployment-plan-detail__loading">{{ t('deploymentPlans.detail.emptyRelatedRecords') }}</p>
        </section>

        <section v-else class="deployment-plan-detail__section">
          <p v-if="!dryRunRunRow" class="deployment-plan-detail__loading">{{ t('deploymentPlans.detail.noExecutionRecords') }}</p>
          <GcExecutionProgressPanel
            v-else
            :run-id="dryRunRunRow.id"
            :request-id="dryRunExecutionDetail.requestId.value"
            :summary="dryRunExecutionDetail.dryRunSummary.value"
            :checks="dryRunExecutionDetail.dryRunChecks.value"
            :steps="dryRunExecutionDetail.steps.value"
            :lines="dryRunExecutionDetail.lines.value"
            :loading="dryRunExecutionDetail.loading.value"
            :polling="dryRunExecutionDetail.isPolling.value"
            :error="dryRunExecutionDetail.error.value"
            :reveal-on-mount="false"
            :mode="detailExecutionViewMode"
          />
        </section>
      </section>

      <template #actions>
        <button class="gc-button" type="button" @click="detailModalOpen = false">{{ t('deploymentPlans.common.close') }}</button>
      </template>
    </GcModal>
  </section>
</template>

<style scoped>
.deployment-plans-page {
  display: grid;
  gap: var(--gc-space-4);
}

.deployment-plans-page__dry-run-required {
  display: grid;
  gap: 12px;
}

.deployment-plans-page__dry-run-required-copy {
  margin: 0;
  color: var(--gc-color-text-muted);
  line-height: 1.6;
}

.deployment-plans-page__error,
.deployment-plans-page__info {
  margin: 0;
  border-radius: 12px;
  padding: 12px 14px;
  font-weight: 750;
}

.deployment-plans-page__error {
  border: 1px solid var(--gc-color-danger-border);
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-bg);
}

.deployment-plans-page__info {
  border: 1px solid var(--gc-color-info-border);
  color: var(--gc-color-primary-strong);
  background: var(--gc-color-surface-selected);
}

.deployment-plans-page__wizard-message {
  margin-bottom: 10px;
}

.deployment-plan-detail {
  display: grid;
  gap: 12px;
}

.deployment-plan-detail__hero {
  display: flex;
  justify-content: space-between;
  align-items: stretch;
  gap: 14px;
  padding: 16px 18px;
  border: 1px solid var(--gc-color-info-border);
  border-radius: 18px;
  background:
    radial-gradient(circle at top right, var(--gc-color-primary-soft), transparent 26%),
    linear-gradient(140deg, var(--gc-color-surface-hover) 0%, var(--gc-color-surface-solid) 54%, var(--gc-color-surface-subtle) 100%);
}

.deployment-plan-detail__hero-copy {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.deployment-plan-detail__eyebrow {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.deployment-plan-detail__hero-copy h2 {
  margin: 0;
  color: var(--gc-color-text);
  font-size: 24px;
  line-height: 1.06;
  overflow-wrap: anywhere;
}

.deployment-plan-detail__hero-copy span {
  color: var(--gc-color-text-muted);
  font-size: 12px;
  font-weight: 700;
}

.deployment-plan-detail__hero-side {
  display: grid;
  align-content: space-between;
  justify-items: end;
  gap: 8px;
  min-width: 150px;
}

.deployment-plan-detail__spotlight {
  display: grid;
  gap: 4px;
  min-width: 150px;
  padding: 10px 12px;
  border-radius: 14px;
  background: var(--gc-color-text);
  color: var(--gc-color-surface-solid);
}

.deployment-plan-detail__spotlight small {
  color: var(--gc-color-text-inverse-muted);
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
}

.deployment-plan-detail__spotlight strong {
  font-size: 16px;
  line-height: 1.15;
}

.deployment-plan-detail__tabs {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
  padding: 4px;
  border: 1px solid var(--gc-color-border-muted);
  border-radius: 999px;
  background: var(--gc-color-surface-hover);
}

.deployment-plan-detail__tab {
  min-height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--gc-color-text-muted);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.deployment-plan-detail__tab[data-active='true'] {
  background: var(--gc-color-surface-solid);
  color: var(--gc-color-text);
  box-shadow: 0 4px 14px var(--gc-color-border);
}

.deployment-plan-detail__section {
  display: grid;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--gc-color-border-muted);
  border-radius: 16px;
  background: linear-gradient(180deg, var(--gc-color-surface-solid), var(--gc-color-surface-raised));
}
.deployment-plan-detail__input-sources { display: grid; gap: var(--gc-space-3); }
.deployment-plan-detail__input-sources h3 { margin: 0; color: var(--gc-color-text-strong); font-size: var(--gc-font-size-md); }

.deployment-plan-detail__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
}

.deployment-plan-detail__facts div {
  display: grid;
  gap: 5px;
  min-height: 70px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--gc-color-surface-hover);
  border: 1px solid var(--gc-color-border-muted);
}

.deployment-plan-detail__facts dt {
  color: var(--gc-color-text-muted);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.deployment-plan-detail__facts dd {
  margin: 0;
  color: var(--gc-color-text);
  font-size: 13px;
  font-weight: 800;
  overflow-wrap: anywhere;
}

.deployment-plan-detail__list {
  display: grid;
  gap: 10px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.deployment-plan-detail__list-item {
  display: grid;
  gap: 6px;
  padding: 12px;
  border: 1px solid var(--gc-color-border-muted);
  border-radius: 12px;
  background: var(--gc-color-surface-hover);
}

.deployment-plan-detail__related-list {
  gap: 6px;
}

.deployment-plan-detail__related-item {
  gap: 6px;
  padding: 9px 12px;
  border-radius: 10px;
}

.deployment-plan-detail__related-main {
  display: grid;
  gap: 2px;
}

.deployment-plan-detail__record-tag {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  border: 1px solid transparent;
}

.deployment-plan-detail__record-tag[data-kind='dry-run'] {
  color: var(--gc-color-primary-strong);
  background: var(--gc-color-info-border);
  border-color: var(--gc-color-primary-border);
}

.deployment-plan-detail__record-tag[data-kind='certificate-update'] {
  color: var(--gc-color-success);
  background: var(--gc-color-success-soft);
  border-color: var(--gc-color-success-border);
}

.deployment-plan-detail__related-status {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.deployment-plan-detail__related-meta span,
.deployment-plan-detail__related-footer small {
  color: var(--gc-color-text-muted);
  font-size: 11px;
  line-height: 1.35;
}

.deployment-plan-detail__related-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
}

.deployment-plan-detail__related-item p {
  font-size: 11px;
  line-height: 1.4;
}

.deployment-plan-detail__related-label {
  color: var(--gc-color-muted);
  font-weight: 700;
}

.deployment-plan-detail__related-separator {
  margin: 0 6px;
  color: var(--gc-color-text-soft);
}

.deployment-plan-detail__related-action {
  min-height: 30px;
  padding: 0 12px;
  font-size: 12px;
}

.deployment-plan-detail__list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.deployment-plan-detail__list-item p,
.deployment-plan-detail__list-item small {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.deployment-plan-detail__loading,
.deployment-plan-detail__error {
  margin: 0;
}

.deployment-plan-detail__error {
  color: var(--gc-color-danger);
}

@media (max-width: 900px) {
  .deployment-plan-detail__hero {
    display: grid;
    grid-template-columns: 1fr;
  }

  .deployment-plan-detail__facts {
    grid-template-columns: 1fr;
  }

  .deployment-plan-detail__related-action {
    width: 100%;
  }
}

</style>
