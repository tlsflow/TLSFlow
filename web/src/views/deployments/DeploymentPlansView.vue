<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { ApiClientError } from '@/api/client'
import { getAssetDetail, listAssets, listManagedTargets } from '@/api/modules/assets.api'
import { decideApproval } from '@/api/modules/audits.api'
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
import { GcConfirmAction, GcDeploymentWizard, GcEmptyState, GcExecutionDetailModal, GcExecutionProgressPanel, GcHelpTip, GcModal, GcPermissionButton, GcStatusTag, GcUserFlowWizard } from '@/design-system/components'
import type { DeploymentWizardInitialPlan, DeploymentWizardPlan } from '@/design-system/components/GcDeploymentWizard.types'
import type { UserFlowStep } from '@/design-system/components/GcUserFlowWizard.vue'
import type { ViewRow } from '@/composables/useBusinessPage'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import { subscribeTaskRealtime, type DeploymentExecutionMode, type TaskRealtimeMessage } from '@/views/tasks/task-events'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import { useAppStore } from '@/stores/app.store'
import { usePermissionStore } from '@/stores/permission.store'
import { createDeploymentPlansPageConfig, createDeploymentPlanUiActions, type DeploymentPlanUiAction } from './deployment-plan.config'
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

interface ExecutionTaskFlight {
  readonly id: number
  readonly label: string
  readonly style: Record<string, string>
}

const pageRef = ref<InstanceType<typeof BusinessResourcePage> | null>(null)
const { t, te } = useI18n()
const router = useRouter()
const appStore = useAppStore()
const permissionStore = usePermissionStore()
const isUserViewMode = computed(() => appStore.viewMode === 'user')
const userPlanItems = ref<ApiRecord[]>([])
const userPlansLoading = ref(false)
const userPlansError = ref('')
const userFlowSteps = computed<UserFlowStep[]>(() => [
  {
    id: 'certificates',
    label: t('viewMode.steps.certificates'),
    help: t('certificates.userView.hero.description'),
    helpLabel: t('certificates.userView.hero.title'),
  },
  {
    id: 'applications',
    label: t('viewMode.steps.applications'),
    help: t('assets.userView.description'),
    helpLabel: t('assets.userView.title'),
  },
  {
    id: 'deployments',
    label: t('viewMode.steps.deployments'),
    help: t('deploymentPlans.userView.description'),
    helpLabel: t('deploymentPlans.userView.title'),
    completed: userPlanItems.value.length > 0,
  },
])
const userPlanActions = computed(() => createDeploymentPlanUiActions(t))
const createDialogOpen = ref(false)
const loading = ref(false)
const editingPlanId = ref('')
const wizardInitialPlan = ref<DeploymentWizardInitialPlan | null>(null)
const errorMessage = ref('')
const infoMessage = ref('')
const approvalHint = ref('')
const approvalFeedback = ref('')
const approvalModalOpen = ref(false)
const approvalPlanRow = ref<ViewRow | null>(null)
const approvalPending = ref(false)
const approvalError = ref('')
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
const detailExecutionRow = ref<ViewRow | null>(null)
const detailExecutionDetail = useExecutionDetail(detailExecutionRow, { t })
const executionDetailModalOpen = ref(false)
const dryRunActionError = ref('')
const executionStarting = ref(false)
const activeExecutionSource = ref<'plan' | 'related'>('plan')
const executionTaskFlights = ref<ExecutionTaskFlight[]>([])
const probingAssetIds = new Set<string>()
let unknownStateProbeTimer: number | null = null
let executionFlightSequence = 0
const executionFlightTimers = new Map<number, number>()
let disposeTaskRealtime: (() => void) | undefined
let deploymentPlanRealtimeReloadTimer: number | null = null
const relatedRecordsLoadedPlanId = ref('')
const detailExecutionLoadedPlanId = ref('')

const unknownStateProbeRetryMs = 15_000
const executionFlightDurationMs = 760
const executionModalCollapseTargetSelector = '.gc-shell__task-button'
const deploymentPlanRealtimeReloadDelayMs = 300
const deploymentExecutionTaskTypes = new Set(['CERTIFICATE_DRY_RUN', 'CERTIFICATE_DEPLOY', 'CERTIFICATE_ROLLBACK'])

function formatDeploymentTime(value: unknown): string {
  return formatBrowserLocalTime(value) || t('common.notAvailable')
}

const pageConfig = computed<BusinessPageConfig>(() => {
  const baseConfig = createDeploymentPlansPageConfig(t)
  return {
    ...baseConfig,
    columns: baseConfig.columns.map((column) => column.kind === 'date'
      ? {
        ...column,
        format: (record) => formatDeploymentTime(readString(record, column.candidates)),
      }
      : column),
    showHeader: false,
    showMetrics: false,
    showDetailPanel: false,
    showActionPanel: false,
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
        label: t('deploymentPlans.actions.review'),
        permission: 'approval.decide',
        reloadAfterRun: false,
        hidden: (row: ViewRow) => String(row.status) !== 'PENDING_APPROVAL' || !readString(row.raw, ['approvalId', 'approval.id', 'approval.approvalId']),
        run: async (row: ViewRow) => {
          openApprovalModal(row)
        },
      },
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
        reloadAfterRun: false,
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

const activeExecutionRow = computed(() => activeExecutionSource.value === 'related' ? relatedExecutionRow.value : dryRunRunRow.value)
const activeExecutionDetail = computed(() => activeExecutionSource.value === 'related' ? relatedExecutionDetail : dryRunExecutionDetail)
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
  return dryRunExecutionDetail.error.value || dryRunActionError.value
})
const activeExecutionLoading = computed(() => executionStarting.value || activeExecutionDetail.value.loading.value)
const detailExecutionViewMode = computed<'dry-run' | 'execution'>(() => {
  const type = readString(detailExecutionRow.value?.raw as ApiRecord | undefined, ['type'], 'dry_run')
  return normalizeExecutionMode(type) === 'dry-run' ? 'dry-run' : 'execution'
})

watch(activeDetailTab, async (tab) => {
  if (!detailPlanRow.value) return
  if (tab === 'versions') {
    await ensureRelatedRecordsLoaded(detailPlanRow.value)
    return
  }
  if (tab === 'execution') {
    await ensureDetailExecutionLoaded(detailPlanRow.value)
  }
})

onMounted(() => {
  disposeTaskRealtime = subscribeTaskRealtime(handleDeploymentTaskRealtime)
})

watch(isUserViewMode, (enabled) => {
  if (enabled) void loadUserPlans()
}, { immediate: true })

onUnmounted(() => {
  clearUnknownStateProbeRetry()
  clearDeploymentPlanRealtimeReload()
  clearExecutionModalTimers()
  disposeTaskRealtime?.()
  disposeTaskRealtime = undefined
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
  const latestObservationsByAssetId = latestCertificateObservationsByAssetId(observationsResult.data?.items ?? [])
  const assetDetails = await loadApplicationAssetDetailMap(page.items ?? [], assets, latestObservationsByAssetId)
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
  latestObservationsByAssetId: ReadonlyMap<string, ApiRecord>,
): Promise<Map<string, ApiRecord>> {
  const applicationAssetIds = Array.from(new Set(
    plans
      .filter((plan) => {
        const applicationAssetId = resolveApplicationAssetIdForPlan(plan, assets)
        if (!applicationAssetId) return false
        const observedNotAfter = Date.parse(readString(latestObservationsByAssetId.get(applicationAssetId), ['notAfter']))
        if (Number.isFinite(observedNotAfter)) return false
        const asset = assets.find((item) => readString(item, ['id']) === applicationAssetId)
        const metadataNotAfter = Date.parse(readString(asset, ['metadata.currentCertificate.notAfter', 'metadata.currentCertificateNotAfter']))
        return !Number.isFinite(metadataNotAfter)
      })
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

function navigateUserFlow(stepId: string) {
  if (stepId === 'certificates') {
    void router.push({ name: 'certificate.list' })
    return
  }
  if (stepId === 'applications') {
    void router.push({ name: 'asset.list' })
    return
  }
  void router.push({ name: 'asset.list' })
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
  relatedRecordsLoadedPlanId.value = ''
  detailExecutionLoadedPlanId.value = ''
  detailExecutionRow.value = null
  await loadDeploymentInputSnapshots(row)
}

async function loadUserPlans() {
  if (!isUserViewMode.value) return
  userPlansLoading.value = true
  userPlansError.value = ''
  try {
    const result = await loadDeploymentPlansPage()
    userPlanItems.value = result.data?.items ?? []
  } catch (cause) {
    userPlansError.value = toErrorMessage(cause, t('deploymentPlans.userView.loadFailed'))
  } finally {
    userPlansLoading.value = false
  }
}

function userPlanRow(plan: ApiRecord): ViewRow {
  return {
    id: readString(plan, ['id', 'planId']),
    name: readString(plan, ['name', 'displayName'], t('deploymentPlans.userView.unnamedPlan')),
    status: readString(plan, ['status', 'state'], 'DRAFT'),
    risk: normalizeRisk(readString(plan, ['risk', 'riskLevel'], 'HIGH')),
    raw: plan,
  }
}

function recommendedUserPlanAction(plan: ApiRecord): DeploymentPlanUiAction | null {
  const status = readString(plan, ['status', 'state'], 'DRAFT')
  const actionKey = ['DRAFT', 'DRY_RUN_PASSED', 'DRY_RUN_FAILED'].includes(status)
    ? 'submit'
    : ['APPROVED', 'READY', 'SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'ROLLED_BACK', 'ROLLBACK_FAILED'].includes(status)
      ? 'execute'
      : null
  if (!actionKey) return null
  return userPlanActions.value.find((action) => action.key === actionKey) ?? null
}

function userPlanActionDisabledReason(plan: ApiRecord) {
  const action = recommendedUserPlanAction(plan)
  return action?.disabledReason?.(userPlanRow(plan)) ?? ''
}

async function runUserPlanAction(plan: ApiRecord) {
  const action = recommendedUserPlanAction(plan)
  if (!action) return
  const row = userPlanRow(plan)
  try {
    const result = await runPlanAction(action.label, row, () => action.run(row))
    await handleActionFeedback(action.label, row, result)
    await loadUserPlans()
  } catch (cause) {
    handleActionError(action.label, row, cause)
  }
}

function userPlanCertificate(plan: ApiRecord) {
  return readString(plan, ['certificateName', 'certificateDomain', 'targetCertificate.primaryDomain', 'certificate.primaryDomain'], t('deploymentPlans.userView.pendingCertificate'))
}

function userPlanApplication(plan: ApiRecord) {
  return readString(plan, ['applicationAssetName', 'targetName', 'targets.0.name', 'targets.0.applicationAssetName'], t('deploymentPlans.userView.pendingApplication'))
}

async function ensureRelatedRecordsLoaded(row: ViewRow): Promise<void> {
  const planId = readString(row.raw, ['id', 'planId'], row.id)
  if (relatedRecordsLoadedPlanId.value === planId || relatedRecordsLoading.value) return
  await loadRelatedRecords(row)
  relatedRecordsLoadedPlanId.value = planId
}

async function ensureDetailExecutionLoaded(row: ViewRow): Promise<void> {
  const planId = readString(row.raw, ['id', 'planId'], row.id)
  if (detailExecutionLoadedPlanId.value === planId) return
  await openExecutionDetailFromPlan(row)
  detailExecutionLoadedPlanId.value = planId
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
  approvalFeedback.value = ''
  approvalError.value = ''
  dryRunRequestId.value = ''
  submitRequestId.value = ''
  dryRunChecks.value = []
  dryRunActionError.value = ''
  executionStarting.value = false
}

function openApprovalModal(row: ViewRow) {
  approvalPlanRow.value = row
  approvalFeedback.value = ''
  approvalError.value = ''
  approvalModalOpen.value = true
}

function closeApprovalModal(force = false) {
  if (approvalPending.value && !force) return
  approvalModalOpen.value = false
  approvalPlanRow.value = null
  approvalError.value = ''
}

async function decideApprovalFromModal(decision: 'approved' | 'rejected') {
  if (approvalPending.value || !approvalPlanRow.value) return
  const row = approvalPlanRow.value
  const approvalId = readString(row.raw, ['approvalId', 'approval.id', 'approval.approvalId'])
  if (!approvalId) {
    approvalError.value = t('deploymentPlans.approval.missingApprovalId')
    return
  }

  approvalPending.value = true
  approvalError.value = ''
  try {
    await decideApproval({ approvalId, decision })
    const planId = readString(row.raw, ['id', 'planId'], row.id)
    const feedback = decision === 'approved'
      ? messageWithOptionalPlanId('deploymentPlans.feedback.approvalApprovedWithPlanId', 'deploymentPlans.feedback.approvalApproved', planId)
      : messageWithOptionalPlanId('deploymentPlans.feedback.approvalRejectedWithPlanId', 'deploymentPlans.feedback.approvalRejected', planId)
    closeApprovalModal(true)
    await pageRef.value?.reload()
    approvalFeedback.value = feedback
  } catch (cause) {
    approvalError.value = toErrorMessage(cause, t('deploymentPlans.approval.decisionFailed'))
  } finally {
    approvalPending.value = false
  }
}

async function closeExecutionDetailModal(options: { reload?: boolean } = {}) {
  clearExecutionModalTimers()
  executionStarting.value = false
  executionDetailModalOpen.value = false
  dryRunActionError.value = ''
  if (options.reload === true) await pageRef.value?.reload()
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
      await loadUserPlans()
      closeCreateDialog(true)
      return
    }
    const planId = await createPlanDraft(plan)
    infoMessage.value = t('deploymentPlans.feedback.savedWithPlanId', { planId })
    editingPlanId.value = planId
    await pageRef.value?.reload()
    await loadUserPlans()
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
    detailExecutionRow.value = null
    return
  }
  const runStatus = readString(latestRun, ['status'], readString(row.raw, ['status'], 'UNKNOWN'))
  const runType = readString(latestRun, ['type'], readString(row.raw, ['latestRunType', 'type'], 'dry_run'))
  detailExecutionRow.value = {
    id: runId,
    name: t('deploymentPlans.execution.fallbackName', { runId }),
    status: runStatus,
    risk: normalizeRisk(readString(row.raw, ['risk', 'riskLevel'], 'HIGH')),
    raw: { id: runId, runId, status: runStatus, type: runType },
  }
}

function openRelatedExecutionDetail(record: RelatedExecutionRecord) {
  clearExecutionModalTimers()
  dryRunActionError.value = ''
  executionStarting.value = false
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
  executionDetailModalOpen.value = true
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
    const preflight = await dryRunDeploymentPlan({ planId })
    dryRunRequestId.value = preflight.requestId
    dryRunChecks.value = extractDryRunChecks(preflight.data)
    infoMessage.value = t('assets.deployment.preflightAvailable', { count: dryRunChecks.value.length })
    await loadUserPlans()
  } catch (cause) {
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

function handleDeploymentTaskRealtime(message: TaskRealtimeMessage) {
  if (message.type !== 'task.changed') return
  const task = message.task
  if (!deploymentExecutionTaskTypes.has(task.taskType)) return
  const planId = firstNonEmptyString(
    stringFromRecord(task.resourceSummary, 'deploymentPlanId'),
    stringFromRecord(task.payload, 'deploymentPlanId'),
    stringFromRecord(task.payload, 'planId'),
  )
  if (!planId) return
  scheduleDeploymentPlanRealtimeReload()
}

function scheduleDeploymentPlanRealtimeReload() {
  if (typeof window === 'undefined') return
  if (deploymentPlanRealtimeReloadTimer !== null) window.clearTimeout(deploymentPlanRealtimeReloadTimer)
  deploymentPlanRealtimeReloadTimer = window.setTimeout(() => {
    deploymentPlanRealtimeReloadTimer = null
    void pageRef.value?.reload()
  }, deploymentPlanRealtimeReloadDelayMs)
}

function clearDeploymentPlanRealtimeReload() {
  if (deploymentPlanRealtimeReloadTimer === null) return
  window.clearTimeout(deploymentPlanRealtimeReloadTimer)
  deploymentPlanRealtimeReloadTimer = null
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
  const mode = executionModeForActionLabel(actionLabel)
  if (mode) openExecutionModalStarting(mode, row)
  try {
    const result = await run()
    if (mode) {
      executionStarting.value = false
      openExecutionModalFromResult(result, mode, row, { autoMinimize: true })
    }
    return result
  } catch (cause) {
    if (mode) executionStarting.value = false
    throw cause
  }
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
    dryRunChecks.value = extractDryRunChecks(readResponseData(result))
    infoMessage.value = t('assets.deployment.preflightAvailable', { count: dryRunChecks.value.length })
  } else if (isDeploymentPlanActionLabel(actionLabel, 'cancel')) {
    infoMessage.value = messageWithOptionalPlanId('deploymentPlans.feedback.cancelledWithPlanId', 'deploymentPlans.feedback.cancelled', planId)
  } else if (isDeploymentPlanActionLabel(actionLabel, 'edit')) {
    infoMessage.value = messageWithOptionalPlanId('deploymentPlans.feedback.loadedDraftWithPlanId', 'deploymentPlans.feedback.loadedDraft', planId)
  }
  if (
    isDeploymentPlanActionLabel(actionLabel, 'dryRun')
    || isDeploymentPlanActionLabel(actionLabel, 'execute')
    || isDeploymentPlanActionLabel(actionLabel, 'rollback')
  ) return
  await pageRef.value?.reload()
}

function handleActionError(actionLabel: string, _row: ViewRow | null, cause: unknown) {
  if (isDryRunActionLabel(actionLabel)) {
    dryRunChecks.value = []
    dryRunRunRow.value = null
    dryRunActionError.value = toErrorMessage(cause, t('deploymentPlans.errors.startDryRunFailed'))
    executionDetailModalOpen.value = true
    return
  }
  if (executionModeForActionLabel(actionLabel)) {
    errorMessage.value = ''
    infoMessage.value = ''
    dryRunActionError.value = toErrorMessage(cause, t('deploymentPlans.errors.actionFailed', { action: actionLabel }))
    return
  }
  errorMessage.value = toErrorMessage(cause, t('deploymentPlans.errors.actionFailed', { action: actionLabel }))
}

function openExecutionModalFromResult(
  result: unknown,
  mode: DeploymentExecutionMode,
  fallbackRow?: ViewRow | null,
  options: { autoMinimize?: boolean } = {},
) {
  clearExecutionModalTimers()
  dryRunActionError.value = ''
  activeExecutionSource.value = 'plan'
  const data = readResponseData(result)
  const run = readRecord(data, ['run'])
  const runId = readString(run, ['id', 'runId']) || readString(data, ['runId'])
  if (!runId) {
    if (options.autoMinimize) {
      launchExecutionTaskFlight(mode)
      dispatchExecutionStartedToast(mode)
    }
    return
  }
  executionDetailModalOpen.value = options.autoMinimize ? false : true
  dryRunRequestId.value = readString(result as ApiRecord, ['requestId'], dryRunRequestId.value)
  dryRunRunRow.value = {
    id: runId,
    name: mode === 'dry-run' ? t('deploymentPlans.execution.dryRunName', { runId }) : t('deploymentPlans.execution.applyName', { runId }),
    status: readString(run, ['status'], 'DISPATCHED'),
    risk: mode === 'dry-run' ? 'MEDIUM' : normalizeRisk(readString(fallbackRow?.raw, ['risk', 'riskLevel'], 'HIGH')),
    raw: run ?? { id: runId },
  }
  if (mode === 'dry-run') {
    dryRunChecks.value = extractDryRunChecks(data)
  } else {
    dryRunChecks.value = []
  }
  if (options.autoMinimize) {
    launchExecutionTaskFlight(mode)
    dispatchExecutionStartedToast(mode)
  }
}

function openExecutionModalStarting(mode: DeploymentExecutionMode, fallbackRow?: ViewRow | null) {
  clearExecutionModalTimers()
  dryRunActionError.value = ''
  dryRunChecks.value = []
  activeExecutionSource.value = 'plan'
  executionStarting.value = true
  dryRunRunRow.value = null
  executionDetailModalOpen.value = false
  if (fallbackRow) {
    dryRunRunRow.value = {
      id: '',
      name: t('deploymentPlans.execution.startingName'),
      status: 'DISPATCHED',
      risk: normalizeRisk(readString(fallbackRow.raw, ['risk', 'riskLevel'], 'HIGH')),
      raw: {},
    }
  }
}

function launchExecutionTaskFlight(mode: DeploymentExecutionMode) {
  if (typeof window === 'undefined') return
  executionStarting.value = false
  const id = executionFlightSequence + 1
  executionFlightSequence = id
  const targetElement = document.querySelector(executionModalCollapseTargetSelector) as HTMLElement | null
  const sourceElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const sourceRect = sourceElement?.getBoundingClientRect()
  const targetRect = targetElement?.getBoundingClientRect()
  const startX = sourceRect ? sourceRect.left + sourceRect.width / 2 : window.innerWidth / 2
  const startY = sourceRect ? sourceRect.top + sourceRect.height / 2 : window.innerHeight / 2
  const endX = targetRect ? targetRect.left + targetRect.width / 2 : window.innerWidth - 64
  const endY = targetRect ? targetRect.top + targetRect.height / 2 : 36
  const flight: ExecutionTaskFlight = {
    id,
    label: executionFlightLabel(mode),
    style: {
      '--execution-flight-start-x': `${startX}px`,
      '--execution-flight-start-y': `${startY}px`,
      '--execution-flight-delta-x': `${endX - startX}px`,
      '--execution-flight-delta-y': `${endY - startY}px`,
      '--execution-flight-arc-y': `${Math.min(-72, Math.max(-160, (endY - startY) / 2 - 96))}px`,
    },
  }
  executionTaskFlights.value = [...executionTaskFlights.value, flight]
  const timer = window.setTimeout(() => removeExecutionTaskFlight(id), executionFlightDurationMs)
  executionFlightTimers.set(id, timer)
}

function clearExecutionModalTimers() {
  executionFlightTimers.forEach((timer) => window.clearTimeout(timer))
  executionFlightTimers.clear()
  executionTaskFlights.value = []
}

function removeExecutionTaskFlight(id: number) {
  const timer = executionFlightTimers.get(id)
  if (timer !== undefined) window.clearTimeout(timer)
  executionFlightTimers.delete(id)
  executionTaskFlights.value = executionTaskFlights.value.filter((item) => item.id !== id)
}

function executionFlightLabel(mode: DeploymentExecutionMode): string {
  if (mode === 'dry-run') return t('tasks.typeLabels.CERTIFICATE_DRY_RUN')
  if (mode === 'rollback') return t('tasks.typeLabels.CERTIFICATE_ROLLBACK')
  return t('tasks.typeLabels.CERTIFICATE_DEPLOY')
}

function dispatchExecutionStartedToast(_mode: DeploymentExecutionMode) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('gcac:toast', { detail: { message: t('deploymentPlans.feedback.executionTaskStarted'), tone: 'info' } }))
}

function executionModeForActionLabel(actionLabel: string): 'apply' | 'rollback' | '' {
  if (isDeploymentPlanActionLabel(actionLabel, 'execute')) return 'apply'
  if (isDeploymentPlanActionLabel(actionLabel, 'rollback')) return 'rollback'
  return ''
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

function workflowExecutionIdentities(record: ApiRecord | null | undefined): ApiRecord[] {
  const values = readPath(record, 'workflowExecutionIdentities')
  if (Array.isArray(values)) {
    return values.filter((item): item is ApiRecord => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
  }
  const legacy = readRecord(record, ['workflowExecutionIdentity'])
  return legacy ? [legacy] : []
}

function workflowIdentityModeLabel(identity: ApiRecord): string {
  return readString(identity, ['mode']) === 'PLUGIN_INTERNAL_WORKFLOW'
    ? detailMessage('deploymentPlans.detail.workflowModePluginInternal', {}, 'deploymentPlans.detail.workflowIdentityUnavailable')
    : detailMessage('deploymentPlans.detail.workflowMode', {}, 'deploymentPlans.detail.workflowIdentityUnavailable')
}

function workflowIdentityVersionLabel(identity: ApiRecord): string {
  const version = readString(identity, ['workflowDslVersion', 'workflowVersion', 'version'])
  return version
    ? detailMessage('deploymentPlans.detail.workflowDslVersion', { version }, 'deploymentPlans.detail.workflowIdentityUnavailable')
    : detailMessage('deploymentPlans.detail.workflowIdentityUnavailable', {}, 'deploymentPlans.fields.workflowDslVersion')
}

function workflowIdentityPluginVersionLabel(identity: ApiRecord): string {
  const version = readString(identity, ['pluginVersion'])
  return version ? detailMessage('deploymentPlans.detail.workflowPluginVersion', { version }, 'deploymentPlans.detail.workflowIdentityUnavailable') : ''
}

function workflowIdentityPluginVersionIdLabel(identity: ApiRecord): string {
  const versionId = readString(identity, ['pluginVersionId'])
  return versionId ? detailMessage('deploymentPlans.detail.workflowPluginVersionId', { versionId }, 'deploymentPlans.detail.workflowIdentityUnavailable') : ''
}

function workflowIdentitySelectionLabel(identity: ApiRecord): string {
  return readString(identity, ['workflowVersionSelection']) === 'LATEST_PUBLISHED'
    ? detailMessage('deploymentPlans.detail.workflowVersionSelectionLatest', {}, 'deploymentPlans.detail.workflowIdentityUnavailable')
    : detailMessage('deploymentPlans.detail.workflowVersionSelectionPinned', {}, 'deploymentPlans.detail.workflowIdentityUnavailable')
}

function detailMessage(key: string, params: Record<string, string | number> = {}, fallbackKey: string): string {
  return te(key) ? t(key, params) : t(fallbackKey, params)
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
  if (Array.isArray(data.checks)) return data.checks as ApiRecord[]
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

function stringFromRecord(record: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!record) return undefined
  const value = record[key]
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
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
    <p v-if="approvalFeedback" class="deployment-plans-page__info deployment-plans-page__approval-feedback">{{ approvalFeedback }}</p>
    <template v-if="isUserViewMode">
      <GcUserFlowWizard
        :steps="userFlowSteps"
        active-step="deployments"
        :title="t('viewMode.steps.deployments')"
        :help="t('deploymentPlans.userView.description')"
        :help-label="t('deploymentPlans.userView.title')"
        :ariaLabel="t('deploymentPlans.userView.listTitle')"
        @select="navigateUserFlow"
      >
        <template #actions>
          <GcPermissionButton permission="deployment.plan.write" @click="openCreateDialog">
            {{ t('deploymentPlans.userView.createAction') }}
          </GcPermissionButton>
        </template>

        <section class="deployment-user-view__content">
          <header class="deployment-user-view__section-head">
            <h3>{{ t('deploymentPlans.userView.listTitle') }}</h3>
            <GcHelpTip
              :content="t('deploymentPlans.userView.listDescription')"
              :ariaLabel="t('deploymentPlans.userView.listTitle')"
            />
          </header>
          <GcEmptyState
            v-if="userPlansError"
            :title="t('deploymentPlans.userView.loadFailed')"
          >
            <p class="deployment-user-view__error">{{ userPlansError }}</p>
            <button class="gc-button" type="button" @click="loadUserPlans">{{ t('businessPage.retry') }}</button>
          </GcEmptyState>
          <div v-else-if="userPlansLoading" class="deployment-user-view__state">{{ t('common.loading') }}</div>
          <GcEmptyState
            v-else-if="userPlanItems.length === 0"
            :title="t('deploymentPlans.userView.emptyTitle')"
          >
            <GcHelpTip
              :content="t('deploymentPlans.userView.emptyDescription')"
              :ariaLabel="t('deploymentPlans.userView.emptyTitle')"
            />
            <GcPermissionButton permission="deployment.plan.write" @click="openCreateDialog">
              {{ t('deploymentPlans.userView.createAction') }}
            </GcPermissionButton>
          </GcEmptyState>
          <div v-else class="deployment-user-view__grid">
            <article v-for="plan in userPlanItems" :key="readString(plan, ['id', 'planId'])" class="gc-card deployment-user-view__card">
              <header class="deployment-user-view__card-head">
                <div>
                  <h3>{{ readString(plan, ['name', 'displayName'], t('deploymentPlans.userView.unnamedPlan')) }}</h3>
                  <p>{{ userPlanCertificate(plan) }} → {{ userPlanApplication(plan) }}</p>
                </div>
                <GcStatusTag :status="readString(plan, ['status', 'state'], 'DRAFT')" />
              </header>
              <div class="deployment-user-view__actions">
                <GcConfirmAction
                  v-if="recommendedUserPlanAction(plan)?.confirmText && permissionStore.hasPermission(recommendedUserPlanAction(plan)?.permission ?? '')"
                  :action-name="recommendedUserPlanAction(plan)?.label ?? ''"
                  :risk-text="recommendedUserPlanAction(plan)?.riskText"
                  :confirm-text="recommendedUserPlanAction(plan)?.confirmText"
                  :danger="recommendedUserPlanAction(plan)?.danger"
                  :disabled="Boolean(userPlanActionDisabledReason(plan))"
                  :disabled-reason="userPlanActionDisabledReason(plan)"
                  @confirm="runUserPlanAction(plan)"
                />
                <GcPermissionButton
                  v-else-if="recommendedUserPlanAction(plan)"
                  :permission="recommendedUserPlanAction(plan)?.permission ?? 'deployment.plan.read'"
                  :disabled="Boolean(userPlanActionDisabledReason(plan))"
                  @click="runUserPlanAction(plan)"
                >
                  {{ recommendedUserPlanAction(plan)?.label }}
                </GcPermissionButton>
                <span v-else class="deployment-user-view__waiting">{{ t('deploymentPlans.userView.waiting') }}</span>
              </div>
            </article>
          </div>
        </section>
      </GcUserFlowWizard>
    </template>

    <BusinessResourcePage v-else ref="pageRef" :config="pageConfig" />

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
        :simple="isUserViewMode"
        @save="handleSave"
        @dry-run="handleDryRun"
        @cancel="closeCreateDialog"
      />
    </GcModal>

    <GcExecutionDetailModal
      :open="executionDetailModalOpen"
      :row="activeExecutionRow"
      :summary="activeExecutionDetail.dryRunSummary.value"
      :steps="activeExecutionDetail.steps.value"
      :lines="activeExecutionDetail.lines.value"
      :loading="activeExecutionLoading"
      :error="activeExecutionError"
      @update:open="(value) => value ? (executionDetailModalOpen = true) : void closeExecutionDetailModal()"
    />

    <Teleport to="body">
      <span
        v-for="flight in executionTaskFlights"
        :key="flight.id"
        class="deployment-execution-flight"
        :style="flight.style"
        aria-hidden="true"
      >
        <span class="deployment-execution-flight__arc">
          <span class="deployment-execution-flight__pill">{{ flight.label }}</span>
        </span>
      </span>
    </Teleport>

    <GcModal
      :open="approvalModalOpen"
      :title="t('deploymentPlans.approval.title')"
      :description="t('deploymentPlans.approval.description')"
      size="lg"
      @update:open="(value) => value ? (approvalModalOpen = true) : closeApprovalModal()"
    >
      <section v-if="approvalPlanRow" class="deployment-plan-approval">
        <p v-if="approvalError" class="deployment-plans-page__error">{{ approvalError }}</p>
        <dl class="deployment-plan-approval__facts">
          <div>
            <dt>{{ t('deploymentPlans.fields.name') }}</dt>
            <dd>{{ readString(approvalPlanRow.raw, ['name', 'title', 'planName'], approvalPlanRow.id) }}</dd>
          </div>
          <div>
            <dt>{{ t('deploymentPlans.fields.planId') }}</dt>
            <dd>{{ readString(approvalPlanRow.raw, ['id', 'planId'], approvalPlanRow.id) }}</dd>
          </div>
          <div>
            <dt>{{ t('deploymentPlans.fields.approvalId') }}</dt>
            <dd>{{ readString(approvalPlanRow.raw, ['approvalId', 'approval.id', 'approval.approvalId']) }}</dd>
          </div>
          <div>
            <dt>{{ t('deploymentPlans.fields.approvalStatus') }}</dt>
            <dd>{{ readString(approvalPlanRow.raw, ['approval.status', 'approvalStatus'], t('deploymentPlans.common.notProvided')) }}</dd>
          </div>
          <div>
            <dt>{{ t('deploymentPlans.approval.requestedBy') }}</dt>
            <dd>{{ readString(approvalPlanRow.raw, ['approval.requestedBy', 'requestedBy', 'createdBy'], t('deploymentPlans.common.notProvided')) }}</dd>
          </div>
          <div>
            <dt>{{ t('deploymentPlans.approval.riskLevel') }}</dt>
            <dd>{{ readString(approvalPlanRow.raw, ['approval.riskLevel', 'riskLevel', 'risk'], t('deploymentPlans.common.notProvided')) }}</dd>
          </div>
          <div>
            <dt>{{ t('deploymentPlans.fields.snapshotHash') }}</dt>
            <dd>{{ readString(approvalPlanRow.raw, ['snapshotHash', 'snapshot.hash'], t('deploymentPlans.common.notProvided')) }}</dd>
          </div>
          <div class="deployment-plan-approval__fact--wide">
            <dt>{{ t('deploymentPlans.fields.targetSummary') }}</dt>
            <dd>{{ readString(approvalPlanRow.raw, ['targetSummary', 'targets.0.certificateBindingId', 'targets.0.executionTargetId'], t('deploymentPlans.common.notProvided')) }}</dd>
          </div>
        </dl>
        <p class="deployment-plan-approval__hint">{{ t('deploymentPlans.approval.decisionHint') }}</p>
      </section>

      <template #actions>
        <button class="gc-button" type="button" :disabled="approvalPending" @click="closeApprovalModal()">
          {{ t('deploymentPlans.common.close') }}
        </button>
        <button class="gc-button gc-button--danger" type="button" :disabled="approvalPending" @click="decideApprovalFromModal('rejected')">
          {{ approvalPending ? t('deploymentPlans.approval.processing') : t('deploymentPlans.actions.reject') }}
        </button>
        <button class="gc-button gc-button--primary" type="button" :disabled="approvalPending" @click="decideApprovalFromModal('approved')">
          {{ approvalPending ? t('deploymentPlans.approval.processing') : t('deploymentPlans.actions.approve') }}
        </button>
      </template>
    </GcModal>

    <GcModal
      v-model:open="detailModalOpen"
      :title="detailPlanRow ? t('deploymentPlans.detail.titleWithName', { name: readString(detailPlanRow.raw, ['name', 'title', 'planName'], detailPlanRow.id) }) : t('deploymentPlans.detail.title')"
      :description="t('deploymentPlans.detail.description')"
      size="xxl"
      width="min(var(--gc-size-modal-wide), calc(100vw - var(--gc-space-8)))"
    >
      <section v-if="detailPlanRow" class="deployment-plan-detail">
        <section class="deployment-plan-detail__hero">
          <div class="deployment-plan-detail__hero-copy">
            <p class="deployment-plan-detail__eyebrow">{{ t('nav.deploymentPlans') }}</p>
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
          <section v-if="workflowExecutionIdentities(detailPlanRow.raw).length" class="deployment-plan-detail__workflow">
            <h3>{{ detailMessage('deploymentPlans.detail.workflowIdentityTitle', {}, 'deploymentPlans.detail.title') }}</h3>
            <ul class="deployment-plan-detail__list">
              <li v-for="identity in workflowExecutionIdentities(detailPlanRow.raw)" :key="`${readString(identity, ['workflowVersionId'])}:${readString(identity, ['mode'])}`" class="deployment-plan-detail__list-item">
                <div class="deployment-plan-detail__list-head">
                  <strong>{{ readString(identity, ['workflowName', 'workflowId'], t('deploymentPlans.detail.workflowIdentityUnavailable')) }}</strong>
                  <span>{{ workflowIdentityModeLabel(identity) }}</span>
                </div>
                <p>{{ workflowIdentityVersionLabel(identity) }}</p>
                <p v-if="workflowIdentityPluginVersionLabel(identity)">{{ workflowIdentityPluginVersionLabel(identity) }}</p>
                <small>
                  {{ workflowIdentitySelectionLabel(identity) }}
                  ·
                  {{ detailMessage('deploymentPlans.detail.workflowVersionId', { versionId: readString(identity, ['workflowVersionId']) }, 'deploymentPlans.detail.workflowIdentityUnavailable') }}
                  <template v-if="workflowIdentityPluginVersionIdLabel(identity)">
                    · {{ workflowIdentityPluginVersionIdLabel(identity) }}
                  </template>
                </small>
              </li>
            </ul>
          </section>
          <section class="deployment-plan-detail__input-sources">
            <h3>{{ detailMessage('deploymentPlans.detail.inputSourcesTitle', {}, 'deploymentPlans.fields.targetSummary') }}</h3>
            <p v-if="deploymentInputSnapshotsLoading" class="deployment-plan-detail__loading">{{ t('common.loading') }}</p>
            <p v-else-if="deploymentInputSnapshotsError" class="deployment-plan-detail__error">{{ deploymentInputSnapshotsError }}</p>
            <ul v-else-if="deploymentInputSourceRows.length" class="deployment-plan-detail__list">
              <li v-for="item in deploymentInputSourceRows" :key="item.id" class="deployment-plan-detail__list-item">
                <div class="deployment-plan-detail__list-head">
                  <strong>{{ item.path }}</strong>
                  <span>{{ detailMessage('deploymentPlans.detail.inputSource', { source: item.source }, 'deploymentPlans.detail.inputSourcesTitle') }}</span>
                </div>
                <p>{{ item.value }}</p>
                <small>{{ detailMessage('deploymentPlans.detail.inputSourceTarget', { targetId: item.targetId }, 'deploymentPlans.detail.targetLabel') }}</small>
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
                <span>{{ formatDeploymentTime(item.updatedAt || item.createdAt) }}</span>
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
          <p v-if="!detailExecutionRow" class="deployment-plan-detail__loading">{{ t('deploymentPlans.detail.noExecutionRecords') }}</p>
          <GcExecutionProgressPanel
            v-else
            :run-id="detailExecutionRow.id"
            :request-id="detailExecutionDetail.requestId.value"
            :summary="detailExecutionDetail.dryRunSummary.value"
            :checks="detailExecutionDetail.dryRunChecks.value"
            :steps="detailExecutionDetail.steps.value"
            :lines="detailExecutionDetail.lines.value"
            :loading="detailExecutionDetail.loading.value"
            :polling="detailExecutionDetail.isPolling.value"
            :error="detailExecutionDetail.error.value"
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

.deployment-user-view__content,
.deployment-user-view__card,
.deployment-user-view__card-head div {
  display: grid;
  gap: var(--gc-space-2);
}

.deployment-user-view__content h3,
.deployment-user-view__content p,
.deployment-user-view__card h3,
.deployment-user-view__card p {
  margin: 0;
}

.deployment-user-view__card-head p {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  line-height: var(--gc-line-height-relaxed);
}

.deployment-user-view__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(calc(var(--gc-space-10) * 6), 1fr));
  gap: var(--gc-space-3);
}

.deployment-user-view__card {
  padding: var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  border-radius: var(--gc-radius-lg);
  background: var(--gc-color-surface-glass);
  box-shadow: var(--gc-shadow-sm);
}

.deployment-user-view__card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--gc-space-3);
}

.deployment-user-view__actions {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--gc-space-2);
}

.deployment-user-view__waiting,
.deployment-user-view__state {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
}

.deployment-user-view__state {
  padding: var(--gc-space-6);
  text-align: center;
}

.deployment-user-view__section-head {
  display: flex !important;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-3);
}

.deployment-user-view__section-head h3 {
  margin: 0;
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-md);
}

.deployment-user-view__error {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
}

@media (max-width: 53.75rem) {
  .deployment-user-view__card-head {
    align-items: stretch;
    flex-direction: column;
  }
}

.deployment-plans-page__dry-run-required {
  display: grid;
  gap: var(--gc-space-3);
}

.deployment-plans-page__dry-run-required-copy {
  margin: 0;
  color: var(--gc-color-text-muted);
  line-height: 1.6;
}

.deployment-plans-page__error,
.deployment-plans-page__info {
  margin: 0;
  border-radius: var(--gc-radius-card);
  padding: var(--gc-space-3) var(--gc-space-4);
  font-weight: 750;
}

.deployment-plans-page__error {
  border: var(--gc-border-width-default) solid var(--gc-color-danger-border);
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-bg);
}

.deployment-plans-page__info {
  border: var(--gc-border-width-default) solid var(--gc-color-info-border);
  color: var(--gc-color-primary-strong);
  background: var(--gc-color-surface-selected);
}

.deployment-plans-page__wizard-message {
  margin-bottom: var(--gc-space-3);
}

.deployment-execution-flight {
  position: fixed;
  top: var(--execution-flight-start-y);
  left: var(--execution-flight-start-x);
  z-index: 70;
  pointer-events: none;
  animation: deployment-execution-flight-x 760ms cubic-bezier(.18, .82, .24, 1) forwards;
}

.deployment-execution-flight__arc {
  display: block;
  animation: deployment-execution-flight-y 760ms cubic-bezier(.2, .7, .15, 1) forwards;
}

.deployment-execution-flight__pill {
  display: inline-flex;
  align-items: center;
  min-height: var(--gc-control-height-sm);
  padding: var(--gc-space-1) var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-primary-border);
  border-radius: var(--gc-radius-pill);
  color: var(--gc-color-primary);
  background: var(--gc-color-surface-overlay);
  box-shadow: var(--gc-shadow-overlay);
  font-size: var(--gc-font-size-xs);
  font-weight: 850;
  white-space: nowrap;
  transform: translate(-50%, -50%);
  animation: deployment-execution-flight-pill 760ms ease forwards;
}

@keyframes deployment-execution-flight-x {
  from {
    transform: translateX(0);
    opacity: 0;
  }
  12% {
    opacity: 1;
  }
  to {
    transform: translateX(var(--execution-flight-delta-x));
    opacity: 0;
  }
}

@keyframes deployment-execution-flight-y {
  0% {
    transform: translateY(0);
  }
  48% {
    transform: translateY(var(--execution-flight-arc-y));
  }
  100% {
    transform: translateY(var(--execution-flight-delta-y));
  }
}

@keyframes deployment-execution-flight-pill {
  0% {
    transform: translate(-50%, -50%) scale(.92);
  }
  55% {
    transform: translate(-50%, -50%) scale(1);
  }
  100% {
    transform: translate(-50%, -50%) scale(.28);
  }
}

.deployment-plan-approval {
  display: grid;
  gap: var(--gc-space-4);
}

.deployment-plan-approval__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-3);
  margin: 0;
}

.deployment-plan-approval__facts div {
  display: grid;
  gap: var(--gc-space-1);
  min-width: 0;
  padding: var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-hover);
}

.deployment-plan-approval__facts dt {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 800;
}

.deployment-plan-approval__facts dd {
  margin: 0;
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-sm);
  font-weight: 750;
  overflow-wrap: anywhere;
}

.deployment-plan-approval__fact--wide {
  grid-column: 1 / -1;
}

.deployment-plan-approval__hint {
  margin: 0;
  color: var(--gc-color-text-muted);
  line-height: 1.6;
}

.deployment-plan-detail {
  display: grid;
  gap: var(--gc-space-3);
}

.deployment-plan-detail__hero {
  display: flex;
  justify-content: space-between;
  align-items: stretch;
  gap: var(--gc-space-4);
  padding: var(--gc-space-4) var(--gc-space-5);
  border: var(--gc-border-width-default) solid var(--gc-color-info-border);
  border-radius: var(--gc-radius-lg);
  background: var(--gc-color-surface-subtle);
}

.deployment-plan-detail__hero-copy {
  display: grid;
  gap: var(--gc-space-1);
  min-width: 0;
}

.deployment-plan-detail__eyebrow {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.deployment-plan-detail__hero-copy h2 {
  margin: 0;
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-lg);
  line-height: 1.06;
  overflow-wrap: anywhere;
}

.deployment-plan-detail__hero-copy span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 700;
}

.deployment-plan-detail__hero-side {
  display: grid;
  align-content: space-between;
  justify-items: end;
  gap: var(--gc-space-2);
  min-width: calc(var(--gc-size-card-min) - var(--gc-space-7));
}

.deployment-plan-detail__spotlight {
  display: grid;
  gap: var(--gc-space-1);
  min-width: calc(var(--gc-size-card-min) - var(--gc-space-7));
  padding: var(--gc-space-3);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-text);
  color: var(--gc-color-surface-solid);
}

.deployment-plan-detail__spotlight small {
  color: var(--gc-color-text-inverse-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 800;
  text-transform: uppercase;
}

.deployment-plan-detail__spotlight strong {
  font-size: var(--gc-font-size-md);
  line-height: 1.15;
}

.deployment-plan-detail__tabs {
  display: inline-flex;
  align-items: center;
  gap: var(--gc-space-2);
  width: fit-content;
  padding: var(--gc-space-1);
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
  border-radius: var(--gc-radius-full);
  background: var(--gc-color-surface-hover);
}

.deployment-plan-detail__tab {
  min-height: var(--gc-control-height-sm);
  padding: 0 var(--gc-space-4);
  border: 0;
  border-radius: var(--gc-radius-full);
  background: transparent;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 800;
  cursor: pointer;
}

.deployment-plan-detail__tab[data-active='true'] {
  background: var(--gc-color-surface-solid);
  color: var(--gc-color-primary);
  box-shadow: var(--gc-shadow-button-primary);
}

.deployment-plan-detail__section {
  display: grid;
  gap: var(--gc-space-3);
  padding: var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  border-radius: var(--gc-radius-modal);
  background: var(--gc-color-surface-glass);
  box-shadow: var(--gc-shadow-sm);
}
.deployment-plan-detail__workflow { display: grid; gap: var(--gc-space-3); }
.deployment-plan-detail__workflow h3 { margin: 0; color: var(--gc-color-text-strong); font-size: var(--gc-font-size-md); }
.deployment-plan-detail__input-sources { display: grid; gap: var(--gc-space-3); }
.deployment-plan-detail__input-sources h3 { margin: 0; color: var(--gc-color-text-strong); font-size: var(--gc-font-size-md); }

.deployment-plan-detail__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-3);
  margin: 0;
}

.deployment-plan-detail__facts div {
  display: grid;
  gap: var(--gc-space-1);
  min-height: calc(var(--gc-space-9) * 2);
  padding: var(--gc-space-3);
  border-radius: var(--gc-radius-card);
  background: var(--gc-color-surface-hover);
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
}

.deployment-plan-detail__facts dt {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.deployment-plan-detail__facts dd {
  margin: 0;
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-sm);
  font-weight: 800;
  overflow-wrap: anywhere;
}

.deployment-plan-detail__list {
  display: grid;
  gap: var(--gc-space-3);
  padding: 0;
  margin: 0;
  list-style: none;
}

.deployment-plan-detail__list-item {
  display: grid;
  gap: var(--gc-space-2);
  padding: var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
  border-radius: var(--gc-radius-card);
  background: var(--gc-color-surface-hover);
}

.deployment-plan-detail__related-list {
  gap: var(--gc-space-2);
}

.deployment-plan-detail__related-item {
  gap: var(--gc-space-2);
  padding: var(--gc-space-2) var(--gc-space-3);
  border-radius: var(--gc-radius-sm);
}

.deployment-plan-detail__related-main {
  display: grid;
  gap: var(--gc-space-1);
}

.deployment-plan-detail__record-tag {
  display: inline-flex;
  align-items: center;
  min-height: calc(var(--gc-space-4) + var(--gc-space-1));
  padding: 0 var(--gc-space-2);
  border-radius: var(--gc-radius-full);
  font-size: var(--gc-font-size-xs);
  font-weight: 700;
  line-height: 1;
  border: var(--gc-border-width-default) solid transparent;
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
  gap: var(--gc-space-2);
  flex-wrap: wrap;
}

.deployment-plan-detail__related-meta span,
.deployment-plan-detail__related-footer small {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  line-height: 1.35;
}

.deployment-plan-detail__related-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gc-space-1) var(--gc-space-3);
}

.deployment-plan-detail__related-item p {
  font-size: var(--gc-font-size-xs);
  line-height: 1.4;
}

.deployment-plan-detail__related-label {
  color: var(--gc-color-muted);
  font-weight: 700;
}

.deployment-plan-detail__related-separator {
  margin: 0 var(--gc-space-2);
  color: var(--gc-color-text-soft);
}

.deployment-plan-detail__related-action {
  min-height: var(--gc-control-height-xs);
  padding: 0 var(--gc-space-3);
  font-size: var(--gc-font-size-xs);
}

.deployment-plan-detail__list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-3);
  flex-wrap: wrap;
}

.deployment-plan-detail__list-item p,
.deployment-plan-detail__list-item small {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
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

@media (max-width: 56.25rem) {
  .deployment-plan-approval__facts {
    grid-template-columns: 1fr;
  }

  .deployment-plan-approval__fact--wide {
    grid-column: auto;
  }

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
