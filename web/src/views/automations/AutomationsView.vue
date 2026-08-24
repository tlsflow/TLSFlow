<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { listCertificates, listCertificateVersions } from '@/api/modules/certificates.api'
import { listAssets } from '@/api/modules/assets.api'
import type { ApiPageResult, ApiRecord } from '@/api/modules/common'
import {
  automationAction,
  createAutomation,
  deleteAutomation,
  listAutomationRuns,
  listAutomations,
  previewAutomation,
  runAutomation,
  updateAutomation,
  type AutomationConfiguration,
  type AutomationRecord,
  type AutomationPreviewRecord,
  type AutomationRunRecord,
  listAutomationRunTargets,
  type AutomationRunTargetRecord,
} from '@/api/modules/automations.api'
import { listTasks, type TaskRun } from '@/api/modules/tasks.api'
import { readString, type ViewRow } from '@/composables/useBusinessPage'
import { GcButton, GcCard, GcEmptyState, GcModal, GcStatusTag } from '@/design-system/components'
import { formatMaybeLocalTime } from '@/utils/browser-local-time'
import { translateDynamic } from '@/i18n/translate'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import AutomationEditor from './AutomationEditor.vue'
import AutomationPreviewPanel from './AutomationPreviewPanel.vue'

const { t, te } = useI18n()
const router = useRouter()
const pageRef = ref<InstanceType<typeof BusinessResourcePage> | null>(null)
const editorOpen = ref(false)
const detailOpen = ref(false)
const historyOpen = ref(false)
const manualRunOpen = ref(false)
const editing = ref<AutomationRecord | null>(null)
const detailRow = ref<ViewRow | null>(null)
const historyAutomation = ref<AutomationRecord | null>(null)
const historyItems = ref<AutomationRunRecord[]>([])
const historyLoading = ref(false)
const historyDetails = ref<Record<string, { targets: AutomationRunTargetRecord[]; tasksByPlan: Record<string, TaskRun[]> }>>({})
const manualRunAutomation = ref<AutomationRecord | null>(null)
const manualRunVersionId = ref('')
const manualRunVersions = ref<ApiRecord[]>([])
const manualRunLoading = ref(false)
const manualRunPreview = ref<AutomationPreviewRecord | null>(null)
const manualRunPreviewLoading = ref(false)
const manualRunPreviewError = ref('')
const manualRunSubmitting = ref(false)
const manualRunError = ref('')
const manualRunStopOnError = ref(false)
const applicationAssets = ref<ApiRecord[]>([])
const applicationAssetsLoaded = ref(false)
let applicationAssetsRequest: Promise<void> | null = null

const pageConfig = computed<BusinessPageConfig>(() => ({
  title: t('automations.title'),
  description: t('automations.description'),
  showHeader: false,
  showMetrics: false,
  readPermission: 'automation.read',
  primaryPermission: 'automation.create',
  primaryActionLabel: t('automations.actions.create'),
  primaryAction: openCreate,
  moduleName: 'automations',
  resourceName: t('automations.title'),
  defaultStatus: 'draft',
  defaultRisk: 'MEDIUM',
  showDetailPanel: false,
  showActionPanel: false,
  showTotalInPagination: true,
  columns: [
    { key: 'name', title: t('automations.fields.name'), candidates: ['name'] },
    { key: 'status', title: t('automations.columns.status'), candidates: ['status'] },
    {
      key: 'trigger',
      title: t('automations.columns.trigger'),
      candidates: ['configuration.trigger.type'],
      format: (record) => t(triggerLabelKey(readString(record, ['configuration.trigger.type'], 'api'))),
    },
    {
      key: 'targetScope',
      title: t('automations.fields.targetScope'),
      candidates: [],
      format: (record) => targetScopeSummary(record as unknown as AutomationRecord),
    },
    { key: 'nextRunAt', title: t('automations.columns.nextRun'), candidates: ['nextRunAt'], kind: 'date' },
    { key: 'lastRunAt', title: t('automations.columns.lastRun'), candidates: ['lastRunAt'], kind: 'date' },
    { key: 'actions', title: t('automations.columns.actions'), candidates: [] },
  ],
  metrics: [],
  emptyTitle: t('automations.empty'),
  emptyDescription: t('automations.description'),
  load: loadAutomationsPage,
  clientSidePagination: true,
  actions: [],
  rowActions: [
    {
      label: t('automations.actions.detail'),
      permission: 'automation.read',
      reloadAfterRun: false,
      run: async (row) => {
        await openDetail(row)
      },
    },
    {
      label: t('automations.actions.edit'),
      permission: 'automation.update',
      reloadAfterRun: false,
      hidden: (row) => automationFromRow(row).status === 'deleted',
      run: async (row) => {
        editing.value = automationFromRow(row)
        editorOpen.value = true
      },
    },
    {
      label: t('automations.actions.copy'),
      permission: 'automation.create',
      reloadAfterRun: true,
      hidden: (row) => automationFromRow(row).status === 'deleted',
      run: async (row) => {
        await automationAction(automationFromRow(row).id, 'copy')
      },
    },
    {
      label: t('automations.actions.enable'),
      permission: 'automation.update',
      reloadAfterRun: true,
      hidden: (row) => automationFromRow(row).status === 'active' || automationFromRow(row).status === 'deleted',
      run: async (row) => {
        const automation = automationFromRow(row)
        await automationAction(automation.id, 'enable', automation.version)
      },
    },
    {
      label: t('automations.actions.disable'),
      permission: 'automation.update',
      reloadAfterRun: true,
      hidden: (row) => automationFromRow(row).status !== 'active',
      run: async (row) => {
        const automation = automationFromRow(row)
        await automationAction(automation.id, 'disable', automation.version)
      },
    },
    {
      label: t('automations.actions.runNow'),
      permission: 'automation.execute',
      reloadAfterRun: false,
      hidden: (row) => automationFromRow(row).status === 'deleted',
      run: async (row) => {
        await runNow(automationFromRow(row))
      },
    },
    {
      label: t('automations.actions.history'),
      permission: 'automation.read',
      reloadAfterRun: false,
      run: async (row) => {
        await openHistory(automationFromRow(row))
      },
    },
    {
      label: t('automations.actions.delete'),
      permission: 'automation.delete',
      danger: true,
      confirmText: t('automations.actions.delete'),
      reloadAfterRun: true,
      hidden: (row) => automationFromRow(row).status === 'deleted',
      run: async (row) => {
        const automation = automationFromRow(row)
        await deleteAutomation(automation.id, automation.version)
      },
    },
  ],
}))

const detailRecord = computed(() => (detailRow.value ? automationFromRow(detailRow.value) : null))
const detailDescription = computed(() => detailRecord.value?.description?.trim() || t('automations.emptyDescription'))
const detailActionSummary = computed(() => (
  detailRecord.value ? actionSummary(detailRecord.value) : t('automations.common.notAvailable')
))
const detailTargetScope = computed(() => (
  detailRecord.value ? targetScopeSummary(detailRecord.value) : t('automations.common.notAvailable')
))
const detailCertificateDomains = computed(() => (
  detailRecord.value ? domainSummary(detailRecord.value) : t('automations.common.notAvailable')
))
const detailAssetNames = computed(() => (
  detailRecord.value ? involvedAssetNames(detailRecord.value) : []
))
const detailAssetSummary = computed(() => (
  detailRecord.value ? involvedAssetSummary(detailRecord.value) : t('automations.common.notAvailable')
))
const detailVersionSelection = computed(() => (
  detailRecord.value ? versionSelectionSummary(detailRecord.value) : t('automations.common.notAvailable')
))
const detailEventSources = computed(() => (
  detailRecord.value ? eventSourceSummary(detailRecord.value) : t('automations.common.notAvailable')
))
const historySummary = computed(() => t('automations.history.summary', { count: historyItems.value.length }))

function automationFromRow(row: ViewRow): AutomationRecord {
  return row.raw as unknown as AutomationRecord
}

async function loadAutomationsPage(): Promise<ApiPageResult> {
  const items = await listAutomations()
  type AutomationPageItems = NonNullable<NonNullable<ApiPageResult['data']>['items']>
  return {
    requestId: 'automation-list',
    data: {
      items: items as unknown as AutomationPageItems,
      page: 1,
      pageSize: Math.max(items.length, 1),
      total: items.length,
    },
  } as ApiPageResult
}

async function refreshList() {
  await pageRef.value?.reload()
}

function openCreate() {
  editing.value = null
  editorOpen.value = true
}

async function save(payload: AutomationConfiguration & { name: string; description?: string }) {
  if (editing.value) {
    await updateAutomation(editing.value.id, {
      expectedVersion: editing.value.version,
      name: payload.name,
      description: payload.description,
      configuration: payload,
    })
  } else {
    await createAutomation(payload)
  }
  editorOpen.value = false
  await refreshList()
}

async function ensureApplicationAssetsLoaded() {
  if (applicationAssetsLoaded.value) return
  if (applicationAssetsRequest) return applicationAssetsRequest

  applicationAssetsRequest = (async () => {
    applicationAssets.value = await loadAllApplicationAssets()
    applicationAssetsLoaded.value = true
  })()

  try {
    await applicationAssetsRequest
  } finally {
    applicationAssetsRequest = null
  }
}

async function openDetail(row: ViewRow) {
  detailRow.value = row
  await ensureApplicationAssetsLoaded()
  detailOpen.value = true
}

async function openHistory(item: AutomationRecord, prependedRun?: AutomationRunRecord) {
  historyAutomation.value = item
  historyOpen.value = true
  historyLoading.value = true
  try {
    const runs = await listAutomationRuns(item.id)
    historyItems.value = prependedRun
      ? [prependedRun, ...runs.filter((run) => run.id !== prependedRun.id)]
      : runs
    historyDetails.value = {}
    await loadHistoryDetails(historyItems.value)
  } finally {
    historyLoading.value = false
  }
}

async function loadHistoryDetails(runs: readonly AutomationRunRecord[]): Promise<void> {
  const details = await Promise.all(runs.map(async (run) => {
    const targets = await listAutomationRunTargets(run.id)
    const planIds = [...new Set(targets.map((target) => target.deploymentPlanId).filter((id): id is string => Boolean(id)))]
    const taskEntries = await Promise.all(planIds.map(async (planId) => {
      const result = await listTasks({ page: 1, pageSize: 50, filters: { resourceType: 'deploymentPlan', resourceId: planId }, includeAll: true })
      return [planId, (result.data?.items ?? []).filter((task) => ['CERTIFICATE_DRY_RUN', 'CERTIFICATE_DEPLOY', 'CERTIFICATE_ROLLBACK'].includes(task.taskType)).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))] as const
    }))
    return [run.id, { targets, tasksByPlan: Object.fromEntries(taskEntries) }] as const
  }))
  historyDetails.value = Object.fromEntries(details)
}

function historyTargetTasks(runId: string, target: AutomationRunTargetRecord): TaskRun[] {
  return target.deploymentPlanId ? historyDetails.value[runId]?.tasksByPlan[target.deploymentPlanId] ?? [] : []
}

function historyTaskSummary(task: TaskRun): string {
  const message = typeof task.lastErrorMessage === 'string' && task.lastErrorMessage.trim()
    ? task.lastErrorMessage
    : typeof task.progress?.message === 'string' && task.progress.message.trim()
      ? task.progress.message
      : typeof task.progress?.summary === 'string' ? task.progress.summary : ''
  const statusLabel = translateDynamic(t, te, 'tasks.status', task.status)
  return message ? `${statusLabel} · ${message}` : statusLabel
}

async function runNow(item: AutomationRecord) {
  if (item.configuration.trigger.type === 'certificate_version_created') {
    await openManualRun(item)
    return
  }
  const run = await runAutomation(item.id, item.version)
  await refreshList()
  await openHistory(item, run)
}

async function openManualRun(item: AutomationRecord) {
  manualRunAutomation.value = item
  manualRunVersionId.value = ''
  manualRunVersions.value = []
  manualRunPreview.value = null
  manualRunPreviewError.value = ''
  manualRunPreviewLoading.value = false
  manualRunError.value = ''
  manualRunStopOnError.value = false
  manualRunOpen.value = true
  manualRunLoading.value = true
  try {
    manualRunVersions.value = await loadManualRunVersions(item)
    manualRunVersionId.value = manualRunVersions.value.length === 1
      ? manualRunVersionKey(manualRunVersions.value[0])
      : ''
  } catch (error) {
    manualRunVersions.value = []
    manualRunError.value = error instanceof Error ? error.message : t('common.unknownError')
  } finally {
    manualRunLoading.value = false
  }
}

async function loadManualRunPreview() {
  const automation = manualRunAutomation.value
  const versionId = manualRunVersionId.value
  if (!automation || !versionId) {
    manualRunPreview.value = null
    manualRunPreviewError.value = ''
    return
  }

  manualRunPreviewLoading.value = true
  manualRunPreviewError.value = ''
  const previewAutomationId = automation.id
  const previewVersionId = versionId
  try {
    const selectedVersion = manualRunVersions.value.find((version) => manualRunVersionKey(version) === versionId)
    const triggerContext = {
      certificateVersionId: versionId,
      certificateAssetId: selectedVersion ? readString(selectedVersion, ['certificateAssetId'], '') : undefined,
      sourceType: selectedVersion ? readString(selectedVersion, ['sourceType'], '') : undefined,
    }
    const preview = await previewAutomation(automation.id, { triggerContext })
    if (manualRunAutomation.value?.id !== previewAutomationId || manualRunVersionId.value !== previewVersionId) return
    manualRunPreview.value = preview
  } catch (error) {
    manualRunPreview.value = null
    manualRunPreviewError.value = error instanceof Error ? error.message : t('common.unknownError')
  } finally {
    manualRunPreviewLoading.value = false
  }
}

async function submitManualRun() {
  const automation = manualRunAutomation.value
  if (!automation || !manualRunVersionId.value || manualRunSubmitting.value) return
  if (!manualRunPreview.value || manualRunExecutableCount.value === 0) return
  manualRunSubmitting.value = true
  manualRunError.value = ''
  try {
    const selectedVersion = manualRunVersions.value.find((version) => manualRunVersionKey(version) === manualRunVersionId.value)
    const run = await runAutomation(automation.id, automation.version, {
      triggerContext: {
        certificateVersionId: manualRunVersionId.value,
        certificateAssetId: selectedVersion ? readString(selectedVersion, ['certificateAssetId'], '') : '',
        sourceType: selectedVersion ? readString(selectedVersion, ['sourceType'], '') : '',
      },
      executionOptions: {
        stopOnError: manualRunStopOnError.value,
      },
    })
    manualRunOpen.value = false
    await refreshList()
    await openHistory(automation, run)
  } catch (error) {
    manualRunError.value = error instanceof Error ? error.message : t('common.unknownError')
  } finally {
    manualRunSubmitting.value = false
  }
}

function manualRunVersionKey(version: ApiRecord): string {
  return readString(version, ['id', 'certificateVersionId'], '')
}

function manualRunVersionLabel(version: ApiRecord): string {
  const name = readString(version, ['commonName', 'subject.commonName', 'name'], manualRunVersionKey(version))
  const asset = readString(version, ['primaryDomain', 'certificateAssetName', 'certificateAssetId'], '')
  const notAfter = formatMaybeLocalTime(readString(version, ['notAfter'], ''), t('automations.common.notAvailable'))
  return [name, asset, notAfter].filter(Boolean).join(' · ')
}

const manualRunExecutableCount = computed(() => {
  const preview = manualRunPreview.value
  if (!preview) return 0
  return Math.max(preview.executableCount ?? 0, preview.items.filter((item) => item.executable).length)
})

watch(manualRunVersionId, () => {
  if (!manualRunOpen.value) return
  if (!manualRunVersionId.value) {
    manualRunPreview.value = null
    manualRunPreviewError.value = ''
    return
  }
  void loadManualRunPreview()
})

async function loadManualRunVersions(item: AutomationRecord): Promise<ApiRecord[]> {
  const domains = automationDomains(item)
  const assetsById = new Map<string, ApiRecord>()

  if (domains.length > 0) {
    const results = await Promise.all(domains.map((domain) => listCertificates({
      page: 1,
      pageSize: 100,
      sort: 'updatedAt:desc',
      filters: { primaryDomain: domain },
    })))
    results.forEach((result) => {
      result.data?.items?.forEach((asset) => {
        const assetId = readString(asset, ['id', 'certificateId'], '')
        if (assetId) assetsById.set(assetId, asset)
      })
    })
  } else {
    const result = await listCertificates({ page: 1, pageSize: 200, sort: 'updatedAt:desc' })
    result.data?.items?.forEach((asset) => {
      const assetId = readString(asset, ['id', 'certificateId'], '')
      if (assetId) assetsById.set(assetId, asset)
    })
  }

  if (assetsById.size === 0) return []

  const results = await Promise.all([...assetsById.keys()].map((assetId) => listCertificateVersions({
    page: 1,
    pageSize: 100,
    sort: 'createdAt:desc',
    filters: { certificateAssetId: assetId },
  })))

  const merged = new Map<string, ApiRecord>()
  results.forEach((result) => {
    result.data?.items?.forEach((version) => {
      const versionId = manualRunVersionKey(version)
      if (versionId && !merged.has(versionId)) merged.set(versionId, version)
    })
  })

  return [...merged.values()].sort((left, right) => Date.parse(readString(right, ['createdAt'], '')) - Date.parse(readString(left, ['createdAt'], '')))
}

function triggerLabelKey(triggerType: string): string {
  if (triggerType === 'api') return 'automations.scheduleBuilder.api'
  if (triggerType === 'once') return 'automations.scheduleBuilder.once'
  if (triggerType === 'schedule') return 'automations.scheduleBuilder.recurring'
  if (triggerType === 'certificate_version_created') return 'automations.scheduleBuilder.certificateVersionCreated'
  return 'automations.triggers.onDemand'
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => typeof item === 'string' || typeof item === 'number' ? String(item) : '').filter(Boolean)
}

function readFilterValues(item: AutomationRecord, field: string): string[] {
  return readStringArray(item.configuration.filters?.find((filter) => filter.field === field)?.value)
}

function automationDomains(item: AutomationRecord): string[] {
  return [...new Set([
    ...readFilterValues(item, 'event.domains').map(normalizeDomain),
  ])].filter(Boolean)
}

function domainSummary(item: AutomationRecord): string {
  const values = automationDomains(item)
  return values.length ? values.join(', ') : t('automations.common.allRelated')
}

function selectedAssetIds(item: AutomationRecord): string[] {
  return [...new Set([
    ...readStringArray(item.configuration.targetResolver.assetIds),
    ...readFilterValues(item, 'target.assetId'),
  ])]
}

function targetScopeSummary(item: AutomationRecord): string {
  const explicitAssetIds = selectedAssetIds(item)
  if (explicitAssetIds.length > 0) return `${t('automations.targetScopes.selectedAssets')} (${explicitAssetIds.length})`
  return t('automations.targetScopes.allRelatedAssets')
}

function actionSummary(item: AutomationRecord): string {
  return item.configuration.actions.map((action) => translateDynamic(t, te, 'automations.actionTypes', action.type)).join(' / ')
}

function eventSourceSummary(item: AutomationRecord): string {
  if (item.configuration.trigger.type !== 'certificate_version_created') return t('automations.common.notAvailable')
  const sources = item.configuration.trigger.sources ?? []
  if (sources.length === 0) return t('automations.common.notAvailable')
  return sources.map((source) => translateDynamic(t, te, 'automations.eventSources', source)).join(' / ')
}

function versionSelectionSummary(item: AutomationRecord): string {
  return item.configuration.trigger.type === 'certificate_version_created'
    ? t('automations.values.fixedByEvent')
    : t('automations.common.notAvailable')
}

function booleanSummary(value: boolean): string {
  return value ? t('automations.values.enabled') : t('automations.values.disabled')
}

function detailDateValue(field: 'createdAt' | 'updatedAt'): string {
  if (!detailRow.value) return t('automations.common.notAvailable')
  return formatMaybeLocalTime(readString(detailRow.value.raw, [field], ''), t('automations.common.notAvailable'))
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.$/, '')
}

function assetDisplayName(asset: ApiRecord): string {
  const id = readString(asset, ['id'], '')
  const environment = readString(asset, ['environment'], '')
  const baseLabel = readString(asset, ['displayName', 'address', 'domainName', 'name'], id)
  return environment && environment !== '—' ? `${baseLabel} · ${environment}` : baseLabel
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

function involvedAssetNames(item: AutomationRecord): string[] {
  if (!applicationAssetsLoaded.value) return []

  const explicitAssetIds = selectedAssetIds(item)
  if (explicitAssetIds.length > 0) {
    const selectedIdSet = new Set(explicitAssetIds)
    return applicationAssets.value
      .filter((asset) => selectedIdSet.has(readString(asset, ['id'], '')))
      .map(assetDisplayName)
  }

  const domains = automationDomains(item)
  if (domains.length === 0) return []
  const selectedDomainSet = new Set(domains)
  return applicationAssets.value
    .filter((asset) => assetMatchesSelectedDomains(asset, selectedDomainSet))
    .map(assetDisplayName)
}

function involvedAssetSummary(item: AutomationRecord): string {
  const names = involvedAssetNames(item)
  if (names.length > 0) return t('automations.detail.assetCount', { count: names.length })
  const explicitAssetCount = selectedAssetIds(item).length
  if (explicitAssetCount > 0) return t('automations.detail.assetCount', { count: explicitAssetCount })
  return t('automations.detail.assetsResolvedAtRuntime')
}

async function loadAllApplicationAssets(): Promise<ApiRecord[]> {
  const records: ApiRecord[] = []
  let page = 1
  const pageSize = 200

  while (true) {
    const result = await listAssets({ page, pageSize, sort: 'updatedAt:desc' })
    const response = result.data
    const items = [...(response?.items ?? [])]
    records.push(...items)
    if (!response || records.length >= response.total || items.length < pageSize) return records
    page += 1
  }
}
</script>

<template>
  <section class="automations-page">
    <BusinessResourcePage ref="pageRef" :config="pageConfig" />

    <GcModal
      v-model:open="detailOpen"
      :title="t('automations.detail.title')"
      :description="t('automations.detail.description')"
      size="xl"
      width="var(--gc-size-modal-wide)"
    >
      <template v-if="detailRecord">
        <section class="automation-detail">
          <header class="automation-detail__hero">
            <div class="automation-detail__hero-copy">
              <div class="automation-detail__title-row">
                <div>
                  <h2>{{ detailRecord.name }}</h2>
                  <p>{{ detailDescription }}</p>
                </div>
                <GcStatusTag :status="detailRecord.status" />
              </div>
              <div class="automation-detail__meta">
                <span>{{ t(triggerLabelKey(detailRecord.configuration.trigger.type)) }}</span>
                <span>{{ detailTargetScope }}</span>
                <span>{{ detailAssetSummary }}</span>
              </div>
            </div>
          </header>

          <section class="automation-detail__section">
            <dl class="automation-detail__facts">
              <div>
                <dt>{{ t('automations.detail.fields.automationId') }}</dt>
                <dd>{{ detailRecord.id }}</dd>
              </div>
              <div>
                <dt>{{ t('automations.detail.fields.currentVersion') }}</dt>
                <dd>{{ detailRecord.currentVersion }}</dd>
              </div>
              <div>
                <dt>{{ t('automations.detail.fields.recordVersion') }}</dt>
                <dd>{{ detailRecord.version }}</dd>
              </div>
              <div>
                <dt>{{ t('automations.columns.trigger') }}</dt>
                <dd>{{ t(triggerLabelKey(detailRecord.configuration.trigger.type)) }}</dd>
              </div>
              <div>
                <dt>{{ t('automations.detail.fields.eventSources') }}</dt>
                <dd>{{ detailEventSources }}</dd>
              </div>
              <div>
                <dt>{{ t('automations.detail.fields.certificateDomains') }}</dt>
                <dd>{{ detailCertificateDomains }}</dd>
              </div>
              <div>
                <dt>{{ t('automations.fields.targetScope') }}</dt>
                <dd>{{ detailTargetScope }}</dd>
              </div>
              <div>
                <dt>{{ t('automations.detail.fields.versionSelection') }}</dt>
                <dd>{{ detailVersionSelection }}</dd>
              </div>
              <div>
                <dt>{{ t('automations.detail.fields.actionChain') }}</dt>
                <dd>{{ detailActionSummary }}</dd>
              </div>
              <div>
                <dt>{{ t('automations.fields.concurrency') }}</dt>
                <dd>{{ detailRecord.configuration.guardrails.concurrencyLimit }}</dd>
              </div>
              <div>
                <dt>{{ t('automations.fields.failureCount') }}</dt>
                <dd>{{ detailRecord.configuration.guardrails.failureCountThreshold ?? t('automations.common.notAvailable') }}</dd>
              </div>
              <div>
                <dt>{{ t('automations.fields.requireApproval') }}</dt>
                <dd>{{ booleanSummary(detailRecord.configuration.guardrails.requireApproval) }}</dd>
              </div>
              <div v-if="detailRecord.configuration.trigger.type === 'schedule'">
                <dt>{{ t('automations.scheduleBuilder.legacyCron') }}</dt>
                <dd>{{ detailRecord.configuration.trigger.cron }}</dd>
              </div>
              <div v-if="detailRecord.configuration.trigger.type === 'schedule'">
                <dt>{{ t('automations.fields.timeZone') }}</dt>
                <dd>{{ detailRecord.configuration.trigger.timeZone }}</dd>
              </div>
              <div v-if="detailRecord.configuration.trigger.type === 'once'">
                <dt>{{ t('automations.scheduleBuilder.runAt') }}</dt>
                <dd>{{ formatMaybeLocalTime(detailRecord.configuration.trigger.runAt, t('automations.common.notAvailable')) }}</dd>
              </div>
              <div>
                <dt>{{ t('automations.detail.fields.nextRun') }}</dt>
                <dd>{{ formatMaybeLocalTime(detailRecord.nextRunAt, t('automations.common.notAvailable')) }}</dd>
              </div>
              <div>
                <dt>{{ t('automations.detail.fields.lastRun') }}</dt>
                <dd>{{ formatMaybeLocalTime(detailRecord.lastRunAt, t('automations.common.notAvailable')) }}</dd>
              </div>
              <div>
                <dt>{{ t('deploymentPlans.fields.createdAt') }}</dt>
                <dd>{{ detailDateValue('createdAt') }}</dd>
              </div>
              <div>
                <dt>{{ t('deploymentPlans.fields.updatedAt') }}</dt>
                <dd>{{ detailDateValue('updatedAt') }}</dd>
              </div>
            </dl>
          </section>

          <section class="automation-detail__section">
            <div class="automation-detail__section-header">
              <h3>{{ t('automations.detail.fields.involvedAssets') }}</h3>
              <span>{{ detailAssetSummary }}</span>
            </div>
            <div v-if="detailAssetNames.length" class="automation-detail__asset-list">
              <span v-for="assetName in detailAssetNames" :key="assetName" class="automation-detail__asset-chip">{{ assetName }}</span>
            </div>
            <p v-else class="automation-detail__asset-hint">{{ t('automations.detail.assetsResolvedAtRuntime') }}</p>
          </section>
        </section>
      </template>

      <template #actions>
        <GcButton @click="detailOpen = false">{{ t('common.close') }}</GcButton>
      </template>
    </GcModal>

    <GcModal
      v-model:open="historyOpen"
      :title="t('automations.history.title')"
      :description="historyAutomation ? historyAutomation.name : t('automations.history.description')"
      size="xl"
      width="var(--gc-size-modal-wide)"
    >
      <section class="automation-history">
        <header class="automation-history__header">
          <strong>{{ historySummary }}</strong>
          <span v-if="historyAutomation">{{ t('automations.history.latestTarget', { name: historyAutomation.name }) }}</span>
        </header>

        <p v-if="historyLoading" class="automation-history__hint">{{ t('common.loading') }}</p>
        <GcEmptyState
          v-else-if="historyItems.length === 0"
          :title="t('automations.history.empty')"
          :description="t('automations.history.description')"
        />
        <div v-else class="automation-history__list">
          <article v-for="run in historyItems" :key="run.id" class="automation-history__item">
            <div class="automation-history__topline">
              <strong>{{ formatMaybeLocalTime(run.createdAt, t('automations.common.notAvailable')) }}</strong>
              <GcStatusTag :status="run.status" />
            </div>
            <div class="automation-history__meta">
              <span>{{ t(`automations.triggerTypes.${run.triggerType}`) }}</span>
              <span>{{ t('automations.runs.progress', { succeeded: run.targetSummary.succeeded || 0, total: run.targetSummary.total || 0 }) }}</span>
              <span>{{ run.failureStage ? t(`automations.failureStages.${run.failureStage}`) : t('automations.common.notAvailable') }}</span>
            </div>
            <div class="automation-history__ids">
              <span>{{ run.id }}</span>
              <span>{{ run.approvalId || t('automations.common.notAvailable') }}</span>
            </div>
            <section v-if="historyDetails[run.id]" class="automation-history__targets">
              <header class="automation-history__targets-header">
                <strong>{{ t('automations.detail.fields.involvedAssets') }}</strong>
                <span>{{ run.targetSummary.succeeded || 0 }}/{{ run.targetSummary.total || 0 }}</span>
              </header>
              <article v-for="target in historyDetails[run.id].targets" :key="target.id" class="automation-history__target">
                <div class="automation-history__target-head">
                  <div>
                    <strong>{{ target.targetSnapshot.assetName || target.targetSnapshot.certificateName }}</strong>
                    <span>{{ target.targetSnapshot.certificateName }} · {{ target.targetSnapshot.environment || t('automations.common.notAvailable') }}</span>
                  </div>
                  <GcStatusTag :status="target.status" />
                </div>
                <div class="automation-history__target-facts">
                  <span>{{ target.currentAction || t('automations.common.notAvailable') }}</span>
                  <span>{{ target.failureStage ? t(`automations.failureStages.${target.failureStage}`) : t('automations.runDetail.noFailure') }}</span>
                  <span v-if="target.errorCode">{{ target.errorCode }} · {{ target.errorMessage }}</span>
                </div>
                <div v-if="historyTargetTasks(run.id, target).length" class="automation-history__execution-list">
                  <div v-for="task in historyTargetTasks(run.id, target)" :key="task.id" class="automation-history__execution">
                    <div>
                      <strong>{{ t(`tasks.typeLabels.${task.taskType}`) }}</strong>
                      <span>{{ historyTaskSummary(task) }}</span>
                    </div>
                    <GcStatusTag :status="task.status" />
                  </div>
                </div>
                <div class="automation-history__target-actions">
                  <GcButton v-if="target.deploymentPlanId" @click="router.push(`/executions?planId=${target.deploymentPlanId}`)">{{ t('automations.actions.openPlan') }}</GcButton>
                  <GcButton v-if="target.executionRunId" @click="router.push(`/executions?runId=${target.executionRunId}`)">{{ t('automations.actions.openExecution') }}</GcButton>
                </div>
              </article>
            </section>
          </article>
        </div>
      </section>

      <template #actions>
        <GcButton @click="historyOpen = false">{{ t('common.close') }}</GcButton>
      </template>
    </GcModal>

    <GcModal
      v-model:open="manualRunOpen"
      :title="t('automations.manualRun.title')"
      :description="t('automations.manualRun.description')"
      size="xl"
      width="var(--gc-size-modal-wide)"
    >
      <section class="gc-form-panel automation-manual-run">
        <label class="gc-form-field automation-manual-run__field">
          <span>{{ t('automations.manualRun.versionLabel') }}</span>
          <select v-model="manualRunVersionId" :disabled="manualRunLoading || manualRunSubmitting">
            <option value="">{{ t('automations.manualRun.versionPlaceholder') }}</option>
            <option v-for="version in manualRunVersions" :key="manualRunVersionKey(version)" :value="manualRunVersionKey(version)">
              {{ manualRunVersionLabel(version) }}
            </option>
          </select>
          <small>{{ t('automations.manualRun.help') }}</small>
        </label>

        <GcCard as="section" class="automation-manual-run__options">
          <div class="automation-manual-run__option-list">
            <label>
              <input v-model="manualRunStopOnError" type="checkbox" :disabled="manualRunSubmitting" />
              <span>{{ t('automations.manualRun.stopOnError') }}</span>
            </label>
          </div>
        </GcCard>

        <p v-if="manualRunLoading || manualRunPreviewLoading" class="automation-manual-run__hint">{{ t('common.loading') }}</p>
        <p v-else-if="manualRunVersions.length === 0" class="automation-manual-run__hint">{{ t('automations.manualRun.empty') }}</p>
        <p v-if="manualRunPreviewError" class="gc-form-error automation-manual-run__message">{{ manualRunPreviewError }}</p>
        <p v-if="manualRunError" class="gc-form-error automation-manual-run__message">{{ manualRunError }}</p>
        <AutomationPreviewPanel
          v-if="manualRunPreview || manualRunPreviewLoading"
          :loading="manualRunPreviewLoading"
          :preview="manualRunPreview"
          :show-confirm="false"
        />
      </section>

      <template #actions>
        <GcButton @click="manualRunOpen = false">{{ t('common.cancel') }}</GcButton>
        <GcButton
          variant="primary"
          :loading="manualRunSubmitting"
          :disabled="manualRunLoading || manualRunPreviewLoading || manualRunSubmitting || !manualRunVersionId || !manualRunPreview || manualRunExecutableCount === 0"
          @click="submitManualRun"
        >
          {{ t('automations.manualRun.start') }}
        </GcButton>
      </template>
    </GcModal>

    <GcModal
      v-model:open="editorOpen"
      :title="editing ? t('automations.editor.editTitle') : t('automations.editor.createTitle')"
      size="xxl"
      width="var(--gc-size-modal-wide)"
    >
      <AutomationEditor :automation="editing" @save="save" @cancel="editorOpen = false" />
    </GcModal>
  </section>
</template>

<style scoped>
.automations-page {
  display: grid;
  gap: var(--gc-space-4);
}

.automation-detail,
.automation-history {
  display: grid;
  gap: var(--gc-space-3);
}

.automation-detail__hero {
  display: grid;
  gap: var(--gc-space-2);
  padding: var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  border-radius: var(--gc-radius-lg);
  background: var(--gc-color-surface-glass);
  box-shadow: var(--gc-shadow-sm);
}

.automation-detail__hero-copy,
.automation-history__list {
  display: grid;
  gap: var(--gc-space-2);
}

.automation-detail__title-row,
.automation-detail__section-header,
.automation-history__header,
.automation-history__topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-3);
  flex-wrap: wrap;
}

.automation-detail__hero-copy h2,
.automation-detail__hero-copy p,
.automation-detail__section-header h3,
.automation-detail__facts dt,
.automation-detail__facts dd,
.automation-history__item strong,
.automation-history__item span,
.automation-history__hint {
  margin: 0;
}

.automation-history__targets {
  display: grid;
  gap: var(--gc-space-2);
  margin-top: var(--gc-space-2);
  padding-top: var(--gc-space-3);
  border-top: var(--gc-border-width-default) solid var(--gc-color-border-muted);
}

.automation-history__targets-header,
.automation-history__target-head,
.automation-history__execution,
.automation-history__target-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-3);
  flex-wrap: wrap;
}

.automation-history__targets-header span,
.automation-history__target-head span,
.automation-history__target-facts,
.automation-history__execution span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.automation-history__target {
  display: grid;
  gap: var(--gc-space-2);
  padding: var(--gc-space-3);
  border-left: var(--gc-space-1) solid var(--gc-color-info-border);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-panel);
}

.automation-history__target-head > div,
.automation-history__execution > div {
  display: grid;
  gap: var(--gc-space-1);
  min-width: 0;
}

.automation-history__target-facts {
  display: flex;
  gap: var(--gc-space-3);
  flex-wrap: wrap;
}

.automation-history__execution-list {
  display: grid;
  gap: var(--gc-space-2);
}

.automation-history__execution {
  padding: var(--gc-space-2) var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-glass);
}

.automation-detail__hero-copy h2 {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-lg);
}

.automation-detail__hero-copy p,
.automation-detail__meta,
.automation-detail__section-header span,
.automation-history__header span,
.automation-history__meta,
.automation-history__ids,
.automation-history__hint,
.automation-detail__asset-hint {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  line-height: var(--gc-line-height-relaxed);
}

.automation-detail__meta,
.automation-history__meta,
.automation-history__ids {
  display: flex;
  align-items: center;
  gap: var(--gc-space-2);
  flex-wrap: wrap;
}

.automation-detail__section {
  display: grid;
  gap: var(--gc-space-2);
}

.automation-detail__section-header h3 {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-md);
}

.automation-detail__facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--gc-space-2);
}

.automation-detail__facts div,
.automation-history__item {
  display: grid;
  gap: var(--gc-space-1);
  padding: var(--gc-space-2) var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-panel);
}

.automation-detail__facts dt {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.automation-detail__facts dd {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-sm);
  line-height: var(--gc-line-height-relaxed);
  overflow-wrap: anywhere;
}

.automation-detail__asset-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gc-space-2);
}

.automation-detail__asset-chip {
  display: inline-flex;
  align-items: center;
  padding: var(--gc-space-1) var(--gc-space-2);
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
  border-radius: var(--gc-radius-full);
  background: var(--gc-color-surface-panel);
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-sm);
}

.automation-manual-run {
  display: grid;
  gap: var(--gc-space-3);
}

.automation-manual-run__option-list {
  display: flex;
  align-items: center;
  gap: var(--gc-space-4);
  flex-wrap: wrap;
}

.automation-manual-run__option-list label {
  display: inline-flex;
  align-items: center;
  gap: var(--gc-space-2);
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-sm);
}

.automation-manual-run__field {
  display: grid;
  gap: var(--gc-space-2);
}

.automation-manual-run__field span,
.automation-manual-run__field small,
.automation-manual-run__hint,
.automation-manual-run__message {
  font-size: var(--gc-font-size-sm);
  line-height: var(--gc-line-height-relaxed);
}

.automation-manual-run__field span {
  color: var(--gc-color-text);
}

.automation-manual-run__field small,
.automation-manual-run__hint {
  color: var(--gc-color-text-muted);
}

.automation-manual-run__message {
  margin: 0;
}

@media (max-width: 60rem) {
  .automation-detail__facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 45rem) {
  .automation-detail__facts {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
