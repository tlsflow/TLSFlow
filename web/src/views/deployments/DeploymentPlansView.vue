<script setup lang="ts">
import { computed, ref } from 'vue'
import { ApiClientError } from '@/api/client'
import { listAssets } from '@/api/modules/assets.api'
import type { ApiRecord } from '@/api/modules/common'
import { listCertificates, listCertificateFormats, listCertificateVersions } from '@/api/modules/certificates.api'
import { useExecutionDetail } from '@/composables/useExecutionDetail'
import { listExecutionsByPlanId } from '@/api/modules/executions.api'
import {
  createDeploymentPlanFromApplicationAsset,
  deleteDraftDeploymentPlan,
  dryRunDeploymentPlan,
  executeDeploymentPlan,
  listDeploymentPlans,
  submitDeploymentPlan,
} from '@/api/modules/deployments.api'
import { GcDeploymentWizard, GcModal, GcStatusTag } from '@/design-system/components'
import type { DeploymentWizardPlan } from '@/design-system/components/GcDeploymentWizard.vue'
import type { ViewRow } from '@/composables/useBusinessPage'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import { deploymentPlansPageConfig } from './deployment-plan.config'

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

const pageRef = ref<InstanceType<typeof BusinessResourcePage> | null>(null)
const createDialogOpen = ref(false)
const loading = ref(false)
const editingPlanId = ref('')
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
const activeDetailTab = ref<'summary' | 'versions' | 'execution'>('summary')
const relatedExecutionModalOpen = ref(false)
const relatedExecutionRow = ref<ViewRow | null>(null)
const relatedExecutionDetail = useExecutionDetail(relatedExecutionRow)

const certificateItems = ref<ApiRecord[]>([])
const certificateVersionItems = ref<ApiRecord[]>([])
const certificateFormatItems = ref<ApiRecord[]>([])
const targetItems = ref<ApiRecord[]>([])
const dryRunChecks = ref<ApiRecord[]>([])
const dryRunExecutionDetail = useExecutionDetail(dryRunRunRow)

const pageConfig: BusinessPageConfig = {
  ...deploymentPlansPageConfig,
  showHeader: false,
  showMetrics: false,
  showDetailPanel: false,
  showActionPanel: false,
  showToolbarDangerHint: false,
  primaryAction: openCreateDialog,
  actions: (deploymentPlansPageConfig.actions ?? []).map((action) => ({
    ...action,
    run: async (row) => {
      const result = await runPlanAction(action.label, row ?? null, () => action.run?.(row))
      await handleActionFeedback(action.label, row ?? null, result)
    },
  })),
  rowActions: [
    {
      label: '详情',
      permission: 'deployment.plan.read',
      reloadAfterRun: false,
      run: async (row) => {
        await openDetailDialog(row)
      },
    },
    {
      label: '编辑草稿',
      permission: 'deployment.plan.write',
      hidden: (row) => String(row.status) !== 'DRAFT',
      reloadAfterRun: false,
      run: async (row) => {
        await openEditDialog(row)
      },
    },
    {
      label: '基于此计划新建草稿',
      permission: 'deployment.plan.write',
      hidden: (row) => ['DRAFT', 'RUNNING'].includes(String(row.status)),
      reloadAfterRun: false,
      run: async (row) => {
        await openCloneDialog(row)
      },
    },
    ...((deploymentPlansPageConfig.rowActions ?? []).map((action) => ({
      ...action,
      run: async (row: ViewRow) => {
        const result = await runPlanAction(action.label, row, () => action.run?.(row))
        await handleActionFeedback(action.label, row, result)
      },
    }))),
  ],
}

const modalTitle = computed(() => (editingPlanId.value ? '编辑部署计划草稿' : '创建部署计划'))
const modalDescription = computed(() => {
  if (loading.value) return '正在加载部署目标与证书数据。'
  if (editingPlanId.value) return `当前正在编辑草稿计划 ${editingPlanId.value}。保存会重建草稿，dry-run、提交和执行会作用于当前草稿。`
  return '从应用资产选择部署目标，再选择证书版本与证书格式配置。'
})
const detailExecutionSummaryCards = computed(() => {
  const summary = dryRunExecutionDetail.dryRunSummary.value
  if (!summary) return []
  return [
    { label: '通过', value: summary.passed },
    { label: '警告', value: summary.warning },
    { label: '失败', value: summary.failed },
    { label: '未知', value: summary.unknown },
  ]
})
const relatedExecutionSummaryCards = computed(() => {
  const summary = relatedExecutionDetail.dryRunSummary.value
  if (!summary) return []
  return [
    { label: '通过', value: summary.passed },
    { label: '警告', value: summary.warning },
    { label: '失败', value: summary.failed },
    { label: '未知', value: summary.unknown },
  ]
})

async function openCreateDialog() {
  createDialogOpen.value = true
  editingPlanId.value = ''
  resetMessages()
  await loadWizardOptions()
}

async function openEditDialog(row: ViewRow) {
  createDialogOpen.value = true
  editingPlanId.value = readString(row.raw, ['id', 'planId'])
  resetMessages()
  await loadWizardOptions()
}

async function openCloneDialog(row: ViewRow) {
  createDialogOpen.value = true
  editingPlanId.value = ''
  resetMessages()
  const sourcePlanId = readString(row.raw, ['id', 'planId'])
  infoMessage.value = sourcePlanId
    ? `将基于计划 ${sourcePlanId} 创建新的部署草稿，原计划和执行记录会保留。`
    : '将创建新的部署草稿，原计划和执行记录会保留。'
  await loadWizardOptions()
}

function closeCreateDialog() {
  if (loading.value) return
  createDialogOpen.value = false
  editingPlanId.value = ''
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
  ])
}

function resetMessages() {
  errorMessage.value = ''
  infoMessage.value = ''
  approvalHint.value = ''
  dryRunRequestId.value = ''
  submitRequestId.value = ''
  dryRunChecks.value = []
}

async function loadWizardOptions() {
  loading.value = true
  errorMessage.value = ''
  try {
    const [assetsResult, certificatesResult, versionsResult, formatsResult] = await Promise.all([
      listAssets({ page: 1, pageSize: 200, sort: 'updatedAt:desc' }),
      listCertificates({ page: 1, pageSize: 200, sort: 'updatedAt:desc' }),
      fetchAllPages((page, pageSize) => listCertificateVersions({ page, pageSize, sort: 'createdAt:desc' })),
      fetchAllPages((page, pageSize) => listCertificateFormats({ page, pageSize, sort: 'createdAt:desc' })),
    ])

    certificateItems.value = [...(certificatesResult.data?.items ?? [])]
    certificateVersionItems.value = versionsResult
    certificateFormatItems.value = formatsResult
    targetItems.value = (assetsResult.data?.items ?? [])
      .map(normalizeApplicationAssetTarget)
      .filter((item): item is ApiRecord => item !== null)
  } catch (cause) {
    errorMessage.value = toErrorMessage(cause, '加载部署计划创建数据失败')
  } finally {
    loading.value = false
  }
}

async function handleSave(plan: DeploymentWizardPlan) {
  if (!plan.applicationAssetId) {
    errorMessage.value = '缺少应用资产 ID，无法保存部署计划。'
    return
  }
  loading.value = true
  resetMessages()
  try {
    if (editingPlanId.value) {
      await deleteDraftDeploymentPlan(editingPlanId.value, { reason: 'wizard-edit-recreate' })
    }
    const planId = await createPlanDraft(plan)
    infoMessage.value = `部署计划草稿已保存。planId: ${planId}`
    editingPlanId.value = planId
    await pageRef.value?.reload()
  } catch (cause) {
    errorMessage.value = toErrorMessage(cause, '保存部署计划草稿失败')
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
    relatedRecordsError.value = toErrorMessage(cause, '加载关联记录失败')
  } finally {
    relatedRecordsLoading.value = false
  }
}

async function openExecutionDetailFromPlan(row: ViewRow) {
  const runId = readString(readRecord(row.raw, ['latestRun']), ['id', 'runId'])
    || readString(row.raw, ['latestRunId', 'runId'])
  if (!runId) {
    dryRunRunRow.value = null
    return
  }
  dryRunRunRow.value = {
    id: runId,
    name: `执行 ${runId}`,
    status: readString(row.raw, ['status'], 'UNKNOWN'),
    risk: normalizeRisk(readString(row.raw, ['risk', 'riskLevel'], 'HIGH')),
    raw: { id: runId, runId, status: readString(row.raw, ['status'], 'UNKNOWN') },
  }
}

function openRelatedExecutionDetail(record: RelatedExecutionRecord) {
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
  relatedExecutionModalOpen.value = true
}

async function handleDryRun(plan: DeploymentWizardPlan) {
  if (!plan.applicationAssetId) {
    errorMessage.value = '缺少应用资产 ID，无法发起 dry-run。'
    return
  }
  loading.value = true
  resetMessages()
  try {
    const planId = await ensurePlanId(plan)
    const dryRun = await dryRunDeploymentPlan({ planId })
    dryRunRequestId.value = dryRun.requestId
    openExecutionModalFromResult(dryRun, 'dry-run')
    dryRunChecks.value = extractDryRunChecks(dryRun.data)
    const runId = dryRunRunRow.value?.id ?? ''
    infoMessage.value = runId
      ? `dry-run 已发起，当前在模态框中显示执行状态。runId: ${runId}`
      : 'dry-run 已发起，但返回中缺少 runId。'
    await pageRef.value?.reload()
  } catch (cause) {
    dryRunRunRow.value = null
    errorMessage.value = toErrorMessage(cause, '发起 dry-run 失败')
  } finally {
    loading.value = false
  }
}

async function handleSubmit(plan: DeploymentWizardPlan) {
  if (!plan.applicationAssetId) {
    errorMessage.value = '缺少应用资产 ID，无法提交部署计划。'
    return
  }
  loading.value = true
  resetMessages()
  try {
    const planId = await ensurePlanId(plan)
    const submitted = await submitDeploymentPlan(planId)
    submitRequestId.value = submitted.requestId
    const status = String(submitted.data?.status ?? '')
    approvalHint.value = status === 'PENDING_APPROVAL'
      ? '该计划已提交审批，等待审批完成后才能执行。'
      : status === 'READY'
        ? '该计划已进入 READY，可以继续执行部署。'
        : ''
    infoMessage.value = approvalHint.value || '部署计划已提交。'
    await pageRef.value?.reload()
  } catch (cause) {
    errorMessage.value = toErrorMessage(cause, '提交部署计划失败')
  } finally {
    loading.value = false
  }
}

async function handleExecute(plan: DeploymentWizardPlan) {
  if (!plan.applicationAssetId) {
    errorMessage.value = '缺少应用资产 ID，无法执行部署计划。'
    return
  }
  loading.value = true
  resetMessages()
  try {
    const planId = await ensurePlanId(plan)
    const submitted = await submitDeploymentPlan(planId)
    submitRequestId.value = submitted.requestId
    const status = String(submitted.data?.status ?? '')
    if (status === 'PENDING_APPROVAL') {
      approvalHint.value = '该计划已进入审批，当前不能直接执行。'
      infoMessage.value = approvalHint.value
      await pageRef.value?.reload()
      return
    }
    const executed = await executeDeploymentPlan(planId)
    openExecutionModalFromResult(executed, 'apply')
    infoMessage.value = `部署执行已发起。requestId: ${executed.requestId}`
    await pageRef.value?.reload()
    createDialogOpen.value = false
  } catch (cause) {
    errorMessage.value = toErrorMessage(cause, '执行部署计划失败')
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
  const created = await createDeploymentPlanFromApplicationAsset({
    applicationAssetId: plan.applicationAssetId,
    selectionMode: plan.selectionMode,
    targetCertificateVersionId: plan.selectionMode === 'EXPLICIT' ? plan.certificateVersionId : undefined,
    certificateFormatId: plan.certificateFormatId,
  })
  const planId = String(created.data?.id ?? '')
  if (!planId) throw new Error('创建部署计划成功但未返回 planId')
  return planId
}

async function runPlanAction(actionLabel: string, row: ViewRow | null, run: () => Promise<unknown> | undefined): Promise<unknown> {
  const result = await run()
  if (actionLabel === 'Dry-run 影响预览') {
    openExecutionModalFromResult(result, 'dry-run', row)
  } else if (actionLabel === '执行部署' || actionLabel === '重新执行') {
    openExecutionModalFromResult(result, 'apply', row)
  }
  return result
}

async function handleActionFeedback(actionLabel: string, row: ViewRow | null, result?: unknown) {
  const planId = row ? readString(row.raw, ['id', 'planId']) : ''
  const runId = readString(readRecord(readResponseData(result), ['run']), ['id', 'runId'])
    || readString(readResponseData(result), ['runId', 'id'])
  if (actionLabel === '删除计划' || actionLabel === '删除草稿') {
    infoMessage.value = planId ? `部署计划已删除。planId: ${planId}` : '部署计划已删除。'
  } else if (actionLabel === '提交审批') {
    infoMessage.value = planId ? `部署计划已提交。planId: ${planId}` : '部署计划已提交。'
  } else if (actionLabel === '执行部署' || actionLabel === '重新执行') {
    infoMessage.value = runId
      ? `部署执行已触发，正在模态框中显示执行过程。runId: ${runId}`
      : (planId ? `部署执行已触发。planId: ${planId}` : '部署执行已触发。')
  } else if (actionLabel === 'Dry-run 影响预览') {
    infoMessage.value = runId
      ? `dry-run 已触发，正在模态框中显示预检过程。runId: ${runId}`
      : (planId ? `dry-run 已触发。planId: ${planId}` : 'dry-run 已触发。')
  } else if (actionLabel === '取消计划') {
    infoMessage.value = planId ? `部署计划已取消。planId: ${planId}` : '部署计划已取消。'
  } else if (actionLabel === '编辑草稿') {
    infoMessage.value = planId ? `已加载草稿计划。planId: ${planId}` : '已加载草稿计划。'
  }
  await pageRef.value?.reload()
}

function openExecutionModalFromResult(result: unknown, mode: 'dry-run' | 'apply', fallbackRow?: ViewRow | null) {
  const data = readResponseData(result)
  const run = readRecord(data, ['run'])
  const runId = readString(run, ['id', 'runId']) || readString(data, ['runId'])
  if (!runId) return
  dryRunRequestId.value = readString(result as ApiRecord, ['requestId'], dryRunRequestId.value)
  dryRunRunRow.value = {
    id: runId,
    name: mode === 'dry-run' ? `Dry-run ${runId}` : `部署执行 ${runId}`,
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

function readResponseData(result: unknown): ApiRecord | undefined {
  if (!result || typeof result !== 'object') return undefined
  const data = (result as { data?: unknown }).data
  if (data && typeof data === 'object' && !Array.isArray(data)) return data as ApiRecord
  return result as ApiRecord
}

function normalizeApplicationAssetTarget(item: ApiRecord): ApiRecord | null {
  const applicationAssetId = readString(item, ['id'])
  const managedTargetId = readString(item, ['targetBinding.managedTargetId'])
  const siteAssetId = readString(item, ['targetBinding.siteAssetId'])
  if (!applicationAssetId || !managedTargetId || !siteAssetId) return null

  const displayName = readString(item, ['displayName', 'address', 'domainName'], applicationAssetId)
  const siteName = readString(item, ['targetBindingDetail.siteAsset.siteName', 'targetBinding.metadata.siteName'], siteAssetId)
  const bindingSummary = readString(
    item,
    ['targetBindingDetail.siteAsset.bindingInformation', 'targetBinding.metadata.bindingInformation', 'targetBinding.bindingKey'],
    '未提供绑定信息',
  )
  const hostHeader = readString(
    item,
    ['targetBindingDetail.siteAsset.hostHeader', 'targetBinding.metadata.hostHeader', 'address'],
    '未提供 host header',
  )
  const port = readString(item, ['targetBindingDetail.siteAsset.port', 'targetBinding.metadata.port', 'port'], '443')

  return {
    id: applicationAssetId,
    applicationAssetId,
    name: displayName,
    displayName,
    siteName,
    bindingSummary,
    bindingName: bindingSummary,
    managedTargetId,
    managedTargetLabel: `${hostHeader}:${port}`,
    siteAssetId,
  }
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
      :title="modalTitle"
      :description="modalDescription"
      size="xxl"
      width="1120px"
    >
      <section class="deployment-plans-page__wizard">
        <p v-if="errorMessage" class="deployment-plans-page__error">{{ errorMessage }}</p>
        <p v-else-if="infoMessage" class="deployment-plans-page__info">{{ infoMessage }}</p>

        <GcDeploymentWizard
          :certificates="certificateItems"
          :certificate-versions="certificateVersionItems"
          :certificate-formats="certificateFormatItems"
          :targets="targetItems"
          :loading="loading"
          :dry-run-request-id="dryRunRequestId"
          :submit-request-id="submitRequestId"
          :approval-hint="approvalHint"
          :dry-run-checks="dryRunChecks"
          @save="handleSave"
          @dry-run="handleDryRun"
          @submit="handleSubmit"
          @execute="handleExecute"
        />
      </section>

      <template #actions>
        <button class="gc-button" type="button" :disabled="loading" @click="closeCreateDialog">关闭</button>
      </template>
    </GcModal>

    <GcModal
      v-model:open="detailModalOpen"
      :title="detailPlanRow ? `部署计划 ${readString(detailPlanRow.raw, ['name', 'title', 'planName'], detailPlanRow.id)}` : '部署计划详情'"
      description="查看计划基础信息、关联记录与最近一次执行结果。"
      size="xxl"
      width="min(1240px, calc(100vw - 32px))"
    >
      <section v-if="detailPlanRow" class="deployment-plan-detail">
        <section class="deployment-plan-detail__hero">
          <div class="deployment-plan-detail__hero-copy">
            <p class="deployment-plan-detail__eyebrow">Deployment Plan</p>
            <h2>{{ readString(detailPlanRow.raw, ['name', 'title', 'planName'], detailPlanRow.id) }}</h2>
            <span>计划 ID {{ readString(detailPlanRow.raw, ['id', 'planId']) }}</span>
          </div>
          <div class="deployment-plan-detail__hero-side">
            <GcStatusTag :status="readString(detailPlanRow.raw, ['status', 'state'])" />
            <div class="deployment-plan-detail__spotlight">
              <small>影响目标数</small>
              <strong>{{ readString(detailPlanRow.raw, ['targetCount', 'affectedCount', 'targets.length']) }}</strong>
            </div>
          </div>
        </section>

        <div class="deployment-plan-detail__tabs">
          <button class="deployment-plan-detail__tab" type="button" :data-active="activeDetailTab === 'summary'" @click="activeDetailTab = 'summary'">概览</button>
          <button class="deployment-plan-detail__tab" type="button" :data-active="activeDetailTab === 'versions'" @click="activeDetailTab = 'versions'">关联记录</button>
          <button class="deployment-plan-detail__tab" type="button" :data-active="activeDetailTab === 'execution'" @click="activeDetailTab = 'execution'">最近执行</button>
        </div>

        <section v-if="activeDetailTab === 'summary'" class="deployment-plan-detail__section">
          <dl class="deployment-plan-detail__facts">
            <div><dt>计划 ID</dt><dd>{{ readString(detailPlanRow.raw, ['id', 'planId']) }}</dd></div>
            <div><dt>计划状态</dt><dd>{{ readString(detailPlanRow.raw, ['status', 'state']) }}</dd></div>
            <div><dt>审批状态</dt><dd>{{ readString(detailPlanRow.raw, ['approval.status', 'approvalStatus']) }}</dd></div>
            <div><dt>证书版本 ID</dt><dd>{{ readString(detailPlanRow.raw, ['certificateVersionId']) }}</dd></div>
            <div><dt>证书格式配置 ID</dt><dd>{{ readString(detailPlanRow.raw, ['certificateFormatId']) }}</dd></div>
            <div><dt>目标绑定摘要</dt><dd>{{ readString(detailPlanRow.raw, ['targetSummary', 'targets.0.certificateBindingId', 'targets.0.executionTargetId']) }}</dd></div>
            <div><dt>最新执行批次</dt><dd>{{ readString(detailPlanRow.raw, ['latestRunId', 'latestRun.id', 'runs.0.id', 'executionRuns.0.id']) }}</dd></div>
            <div><dt>失败原因</dt><dd>{{ readString(detailPlanRow.raw, ['failureReason', 'error.message', 'latestRun.failureReason']) }}</dd></div>
          </dl>
        </section>

        <section v-else-if="activeDetailTab === 'versions'" class="deployment-plan-detail__section">
          <p v-if="relatedRecordsLoading" class="deployment-plan-detail__loading">正在加载关联记录...</p>
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
                    {{ item.kind === 'dry-run' ? 'Dry-run' : '证书更新' }}
                  </span>
                  <GcStatusTag :status="item.status" />
                  <button class="gc-button deployment-plan-detail__related-action" type="button" @click="openRelatedExecutionDetail(item)">查看日志</button>
                </div>
              </div>
              <div class="deployment-plan-detail__related-meta">
                <span>计划 {{ item.planId }}</span>
                <span>运行 {{ item.runId }}</span>
                <span>来源 {{ item.createdReason }}</span>
                <span>{{ formatBrowserLocalTime(item.updatedAt || item.createdAt) || item.updatedAt || item.createdAt }}</span>
              </div>
              <p>
                <span class="deployment-plan-detail__related-label">目标</span>
                {{ item.targetSummary || '未提供目标摘要' }}
                <span class="deployment-plan-detail__related-separator">·</span>
                <span class="deployment-plan-detail__related-label">证书版本</span>
                {{ item.certificateVersionId || '未提供' }}
              </p>
            </li>
          </ul>
          <p v-else class="deployment-plan-detail__loading">暂无关联记录。</p>
        </section>

        <section v-else class="deployment-plan-detail__section">
          <p v-if="!dryRunRunRow" class="deployment-plan-detail__loading">当前计划还没有执行记录。</p>
          <template v-else>
            <article
              v-if="dryRunExecutionDetail.dryRunSummary.value"
              class="deployment-plan-detail__summary"
              :data-state="dryRunExecutionDetail.dryRunSummary.value.state"
            >
              <div class="deployment-plan-detail__summary-head">
                <strong>{{ dryRunExecutionDetail.dryRunSummary.value.label }}</strong>
                <span>{{ dryRunExecutionDetail.dryRunSummary.value.detail }}</span>
              </div>
              <div class="deployment-plan-detail__summary-grid">
                <div v-for="item in detailExecutionSummaryCards" :key="item.label">
                  <small>{{ item.label }}</small>
                  <strong>{{ item.value }}</strong>
                </div>
              </div>
            </article>

            <ul v-if="dryRunExecutionDetail.steps.value.length" class="deployment-plan-detail__list">
              <li v-for="step in dryRunExecutionDetail.steps.value" :key="step.id" class="deployment-plan-detail__list-item">
                <div class="deployment-plan-detail__list-head">
                  <strong>{{ step.name }}</strong>
                  <GcStatusTag :status="step.status" />
                </div>
                <p>{{ step.detail ?? '暂无步骤说明' }}</p>
                <small>{{ step.startedAt ?? '未开始' }}{{ step.finishedAt ? ` -> ${step.finishedAt}` : '' }}</small>
              </li>
            </ul>

            <ul v-if="dryRunExecutionDetail.lines.value.length" class="deployment-plan-detail__logs">
              <li v-for="line in dryRunExecutionDetail.lines.value.slice(0, 20)" :key="line.id" class="deployment-plan-detail__log-item" :data-level="line.level">
                <div class="deployment-plan-detail__log-meta">
                  <span>{{ line.time }}</span>
                  <strong>{{ line.step || '执行日志' }}</strong>
                </div>
                <p>{{ line.message }}</p>
              </li>
            </ul>
          </template>
        </section>
      </section>

      <template #actions>
        <button class="gc-button" type="button" @click="detailModalOpen = false">关闭</button>
      </template>
    </GcModal>

    <GcModal
      v-model:open="relatedExecutionModalOpen"
      :title="relatedExecutionRow ? `执行详情 ${relatedExecutionRow.id}` : '执行详情'"
      description="查看关联记录对应执行的步骤状态和详细日志。"
      size="xxl"
      width="min(1280px, calc(100vw - 32px))"
    >
      <section v-if="relatedExecutionRow" class="execution-detail-modal">
        <section class="execution-detail-modal__hero">
          <div class="execution-detail-modal__hero-copy">
            <p class="execution-detail-modal__eyebrow">Related Execution</p>
            <h2>{{ readString(relatedExecutionRow.raw, ['planName', 'name', 'id'], relatedExecutionRow.id) }}</h2>
            <span>部署计划 {{ readString(relatedExecutionRow.raw, ['deploymentPlanId', 'planId']) }}</span>
          </div>
          <div class="execution-detail-modal__hero-side">
            <GcStatusTag :status="readString(relatedExecutionRow.raw, ['status', 'state', 'result'])" />
            <div class="execution-detail-modal__spotlight">
              <small>运行类型</small>
              <strong>{{ readString(relatedExecutionRow.raw, ['type']) || 'unknown' }}</strong>
            </div>
          </div>
        </section>

        <section class="execution-detail-modal__section">
          <dl class="execution-detail-modal__facts">
            <div>
              <dt>执行 ID</dt>
              <dd>{{ readString(relatedExecutionRow.raw, ['id', 'runId'], relatedExecutionRow.id) }}</dd>
            </div>
            <div>
              <dt>部署计划</dt>
              <dd>{{ readString(relatedExecutionRow.raw, ['deploymentPlanId', 'planId']) }}</dd>
            </div>
            <div>
              <dt>运行类型</dt>
              <dd>{{ readString(relatedExecutionRow.raw, ['type']) }}</dd>
            </div>
            <div>
              <dt>执行状态</dt>
              <dd>{{ readString(relatedExecutionRow.raw, ['status', 'state', 'result']) }}</dd>
            </div>
            <div>
              <dt>创建时间</dt>
              <dd>{{ formatBrowserLocalTime(readString(relatedExecutionRow.raw, ['createdAt'])) || readString(relatedExecutionRow.raw, ['createdAt']) }}</dd>
            </div>
            <div>
              <dt>更新时间</dt>
              <dd>{{ formatBrowserLocalTime(readString(relatedExecutionRow.raw, ['updatedAt'])) || readString(relatedExecutionRow.raw, ['updatedAt']) }}</dd>
            </div>
          </dl>

          <article
            v-if="relatedExecutionDetail.dryRunSummary.value"
            class="execution-detail-modal__summary"
            :data-state="relatedExecutionDetail.dryRunSummary.value.state"
          >
            <div class="execution-detail-modal__summary-head">
              <strong>{{ relatedExecutionDetail.dryRunSummary.value.label }}</strong>
              <span>{{ relatedExecutionDetail.dryRunSummary.value.detail }}</span>
            </div>
            <div class="execution-detail-modal__summary-grid">
              <div v-for="item in relatedExecutionSummaryCards" :key="item.label">
                <small>{{ item.label }}</small>
                <strong>{{ item.value }}</strong>
              </div>
            </div>
          </article>

          <p v-if="relatedExecutionDetail.loading.value" class="execution-detail-modal__loading">正在加载步骤和日志...</p>
          <p v-else-if="relatedExecutionDetail.error.value" class="execution-detail-modal__error">{{ relatedExecutionDetail.error.value }}</p>
          <template v-else>
            <ul v-if="relatedExecutionDetail.steps.value.length" class="execution-detail-modal__list">
              <li v-for="step in relatedExecutionDetail.steps.value" :key="step.id" class="execution-detail-modal__list-item">
                <div class="execution-detail-modal__list-head">
                  <strong>{{ step.name }}</strong>
                  <GcStatusTag :status="step.status" />
                </div>
                <p>{{ step.detail ?? '暂无步骤说明' }}</p>
                <small>{{ step.startedAt ?? '未开始' }}{{ step.finishedAt ? ` -> ${step.finishedAt}` : '' }}</small>
              </li>
            </ul>
            <p v-else class="execution-detail-modal__loading">暂无步骤。</p>

            <ul v-if="relatedExecutionDetail.lines.value.length" class="execution-detail-modal__logs">
              <li v-for="line in relatedExecutionDetail.lines.value" :key="line.id" class="execution-detail-modal__log-item" :data-level="line.level">
                <div class="execution-detail-modal__log-meta">
                  <span>{{ line.time }}</span>
                  <strong>{{ line.step || '执行日志' }}</strong>
                </div>
                <p>{{ line.message }}</p>
              </li>
            </ul>
            <p v-else class="execution-detail-modal__loading">暂无日志。</p>
          </template>
        </section>
      </section>

      <template #actions>
        <button class="gc-button" type="button" @click="relatedExecutionModalOpen = false">关闭</button>
      </template>
    </GcModal>
  </section>
</template>

<style scoped>
.deployment-plans-page {
  display: grid;
  gap: var(--gc-space-4);
}

.deployment-plans-page :deep(.business-page__row-actions) {
  gap: 6px;
  flex-wrap: wrap;
}

.deployment-plans-page__wizard {
  display: grid;
  gap: var(--gc-space-3);
}

.deployment-plans-page__error,
.deployment-plans-page__info {
  margin: 0;
  border-radius: 12px;
  padding: 12px 14px;
  font-weight: 750;
}

.deployment-plans-page__error {
  border: 1px solid #fecaca;
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-bg);
}

.deployment-plans-page__info {
  border: 1px solid #dbeafe;
  color: #1d4ed8;
  background: #eff6ff;
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
  border: 1px solid #d9e5f7;
  border-radius: 18px;
  background:
    radial-gradient(circle at top right, rgb(59 130 246 / 12%), transparent 26%),
    linear-gradient(140deg, #f7fbff 0%, #ffffff 54%, #f3f7fc 100%);
}

.deployment-plan-detail__hero-copy {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.deployment-plan-detail__eyebrow {
  margin: 0;
  color: #5b6f88;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.deployment-plan-detail__hero-copy h2 {
  margin: 0;
  color: #0f172a;
  font-size: 24px;
  line-height: 1.06;
  overflow-wrap: anywhere;
}

.deployment-plan-detail__hero-copy span {
  color: #64748b;
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
  background: #0f172a;
  color: #fff;
}

.deployment-plan-detail__spotlight small {
  color: rgb(255 255 255 / 68%);
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
  border: 1px solid #dbe6f4;
  border-radius: 999px;
  background: #f8fbff;
}

.deployment-plan-detail__tab {
  min-height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #5b6f88;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.deployment-plan-detail__tab[data-active='true'] {
  background: #fff;
  color: #0f172a;
  box-shadow: 0 4px 14px rgb(15 23 42 / 10%);
}

.deployment-plan-detail__section,
.deployment-plan-detail__summary {
  display: grid;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid #e3ebf5;
  border-radius: 16px;
  background: linear-gradient(180deg, #ffffff, #fbfdff);
}

.deployment-plan-detail__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
}

.deployment-plan-detail__facts div,
.deployment-plan-detail__summary-grid > div {
  display: grid;
  gap: 5px;
  min-height: 70px;
  padding: 10px 12px;
  border-radius: 12px;
  background: #f8fbff;
  border: 1px solid #e4edf8;
}

.deployment-plan-detail__facts dt,
.deployment-plan-detail__summary-grid small {
  color: #64748b;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.deployment-plan-detail__facts dd {
  margin: 0;
  color: #0f172a;
  font-size: 13px;
  font-weight: 800;
  overflow-wrap: anywhere;
}

.deployment-plan-detail__summary-head {
  display: grid;
  gap: 4px;
}

.deployment-plan-detail__summary-head strong {
  color: #0f172a;
  font-size: 15px;
}

.deployment-plan-detail__summary-head span {
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}

.deployment-plan-detail__summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.deployment-plan-detail__summary-grid strong {
  font-size: 18px;
  color: #0f172a;
}

.deployment-plan-detail__summary[data-state='passed'] {
  border-color: #bbf7d0;
  background: #f0fdf4;
}

.deployment-plan-detail__summary[data-state='warning'] {
  border-color: #fde68a;
  background: #fffbeb;
}

.deployment-plan-detail__summary[data-state='failed'] {
  border-color: #fecaca;
  background: #fef2f2;
}

.deployment-plan-detail__summary[data-state='pending'],
.deployment-plan-detail__summary[data-state='queued'],
.deployment-plan-detail__summary[data-state='running'] {
  border-color: #bfdbfe;
  background: #eff6ff;
}

.deployment-plan-detail__list,
.deployment-plan-detail__logs {
  display: grid;
  gap: 10px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.deployment-plan-detail__list-item,
.deployment-plan-detail__log-item {
  display: grid;
  gap: 6px;
  padding: 12px;
  border: 1px solid #e4edf8;
  border-radius: 12px;
  background: #f8fbff;
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
  color: #1d4ed8;
  background: #dbeafe;
  border-color: #bfdbfe;
}

.deployment-plan-detail__record-tag[data-kind='certificate-update'] {
  color: #0f766e;
  background: #ccfbf1;
  border-color: #99f6e4;
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
  color: #64748b;
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
  color: #475569;
  font-weight: 700;
}

.deployment-plan-detail__related-separator {
  margin: 0 6px;
  color: #94a3b8;
}

.deployment-plan-detail__related-action {
  min-height: 30px;
  padding: 0 12px;
  font-size: 12px;
}

.deployment-plan-detail__list-head,
.deployment-plan-detail__log-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.deployment-plan-detail__list-item p,
.deployment-plan-detail__list-item small,
.deployment-plan-detail__log-meta span,
.deployment-plan-detail__log-item p {
  margin: 0;
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.deployment-plan-detail__log-meta strong {
  color: #0f172a;
  font-size: 12px;
}

.deployment-plan-detail__log-item[data-level='error'] {
  border-color: #fecaca;
  background: #fef2f2;
}

.deployment-plan-detail__log-item[data-level='warn'] {
  border-color: #fde68a;
  background: #fffbeb;
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

  .deployment-plan-detail__facts,
  .deployment-plan-detail__summary-grid {
    grid-template-columns: 1fr;
  }

  .deployment-plan-detail__related-action {
    width: 100%;
  }
}

.execution-detail-modal {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.execution-detail-modal__hero {
  display: flex;
  justify-content: space-between;
  align-items: stretch;
  gap: 14px;
  padding: 16px 18px;
  border: 1px solid #d9e5f7;
  border-radius: 18px;
  background:
    radial-gradient(circle at top right, rgb(59 130 246 / 12%), transparent 26%),
    linear-gradient(140deg, #f7fbff 0%, #ffffff 54%, #f3f7fc 100%);
}

.execution-detail-modal__hero-copy {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.execution-detail-modal__eyebrow {
  margin: 0;
  color: #5b6f88;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.execution-detail-modal__hero-copy h2 {
  margin: 0;
  color: #0f172a;
  font-size: 24px;
  line-height: 1.06;
  overflow-wrap: anywhere;
}

.execution-detail-modal__hero-copy span {
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}

.execution-detail-modal__hero-side {
  display: grid;
  align-content: space-between;
  justify-items: end;
  gap: 8px;
  min-width: 150px;
}

.execution-detail-modal__spotlight {
  display: grid;
  gap: 4px;
  min-width: 150px;
  padding: 10px 12px;
  border-radius: 14px;
  background: #0f172a;
  color: #fff;
}

.execution-detail-modal__spotlight small {
  color: rgb(255 255 255 / 68%);
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
}

.execution-detail-modal__spotlight strong {
  font-size: 16px;
  line-height: 1.15;
}

.execution-detail-modal__section,
.execution-detail-modal__summary {
  display: grid;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid #e3ebf5;
  border-radius: 16px;
  background: linear-gradient(180deg, #ffffff, #fbfdff);
}

.execution-detail-modal__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
}

.execution-detail-modal__facts div,
.execution-detail-modal__summary-grid > div {
  display: grid;
  gap: 5px;
  min-height: 70px;
  padding: 10px 12px;
  border-radius: 12px;
  background: #f8fbff;
  border: 1px solid #e4edf8;
}

.execution-detail-modal__facts dt,
.execution-detail-modal__summary-grid small {
  color: #64748b;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.execution-detail-modal__facts dd {
  margin: 0;
  color: #0f172a;
  font-size: 13px;
  font-weight: 800;
  overflow-wrap: anywhere;
}

.execution-detail-modal__summary-head {
  display: grid;
  gap: 4px;
}

.execution-detail-modal__summary-head strong {
  color: #0f172a;
  font-size: 15px;
}

.execution-detail-modal__summary-head span {
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}

.execution-detail-modal__summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.execution-detail-modal__summary-grid strong {
  font-size: 18px;
  color: #0f172a;
}

.execution-detail-modal__summary[data-state='passed'] {
  border-color: #bbf7d0;
  background: #f0fdf4;
}

.execution-detail-modal__summary[data-state='warning'] {
  border-color: #fde68a;
  background: #fffbeb;
}

.execution-detail-modal__summary[data-state='failed'] {
  border-color: #fecaca;
  background: #fef2f2;
}

.execution-detail-modal__summary[data-state='pending'],
.execution-detail-modal__summary[data-state='queued'],
.execution-detail-modal__summary[data-state='running'] {
  border-color: #bfdbfe;
  background: #eff6ff;
}

.execution-detail-modal__list,
.execution-detail-modal__logs {
  display: grid;
  gap: 10px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.execution-detail-modal__logs {
  max-height: 420px;
  overflow: auto;
}

.execution-detail-modal__list-item,
.execution-detail-modal__log-item {
  display: grid;
  gap: 6px;
  padding: 12px;
  border: 1px solid #e4edf8;
  border-radius: 12px;
  background: #f8fbff;
}

.execution-detail-modal__list-head,
.execution-detail-modal__log-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.execution-detail-modal__list-item p,
.execution-detail-modal__list-item small,
.execution-detail-modal__log-meta span,
.execution-detail-modal__log-item p {
  margin: 0;
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.execution-detail-modal__log-meta strong {
  color: #0f172a;
  font-size: 12px;
}

.execution-detail-modal__log-item[data-level='error'] {
  border-color: #fecaca;
  background: #fef2f2;
}

.execution-detail-modal__log-item[data-level='warn'] {
  border-color: #fde68a;
  background: #fffbeb;
}

.execution-detail-modal__loading,
.execution-detail-modal__error {
  margin: 0;
}

.execution-detail-modal__error {
  color: var(--gc-color-danger);
}

@media (max-width: 900px) {
  .execution-detail-modal__hero {
    display: grid;
    grid-template-columns: 1fr;
  }

  .execution-detail-modal__facts,
  .execution-detail-modal__summary-grid {
    grid-template-columns: 1fr;
  }
}
</style>
