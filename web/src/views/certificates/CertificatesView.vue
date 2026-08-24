<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { ApiClientError } from '@/api/client'
import { listAssets } from '@/api/modules/assets.api'
import { listAutomations } from '@/api/modules/automations.api'
import {
  deleteCertificateVersion,
  getCertificateAssetDetail,
  importCertificate,
  listCertificates,
  listCertificateVersions,
  validateCertificateImport,
} from '@/api/modules/certificates.api'
import type { ApiRecord } from '@/api/modules/common'
import {
  GcConfirmAction,
  GcCard,
  GcDataTable,
  GcEmptyState,
  GcHelpTip,
  GcModal,
  GcButton,
  GcPageToolbar,
  GcPermissionButton,
  GcProgressBar,
  GcStatusTag,
  GcUserFlowWizard,
  GcSimpleFlowWizard,
} from '@/design-system/components'
import type { DataTableColumn } from '@/design-system/components/GcDataTable.vue'
import type { UserFlowStep } from '@/design-system/components/GcUserFlowWizard.vue'
import type { SimpleFlowSection } from '@/design-system/components/GcSimpleFlowWizard.vue'
import type { StatusTone } from '@/design-system/status/status-map'
import { useAppStore } from '@/stores/app.store'
import { usePermissionStore } from '@/stores/permission.store'
import CertificateDetailPanel from './CertificateDetailPanel.vue'
import CertificateImportForm from './CertificateImportForm.vue'
import CertificateTrustRootsModalContent from './CertificateTrustRootsModalContent.vue'
import {
  buildCertificateImportPayload,
  type CertificateImportValidationResult,
  createCertificateImportDraft,
  isMaterialReady,
  resetCertificateImportDraft,
} from './certificate-import.shared'
import { readPath, readString, toErrorState, type CertificatePageError } from './certificate-view-utils'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'

interface CertificateVersionRow extends Record<string, string> {
  readonly id: string
  readonly assetId: string
  readonly certificateName: string
  readonly associatedAsset: string
  readonly sourceType: CertificateSourceTypeKey
  readonly sourceTypeLabel: string
  readonly sourceTypeTone: StatusTone
  readonly notBefore: string
  readonly notAfter: string
  readonly issuer: string
  readonly subject: string
  readonly status: string
  readonly lifecycle: string
  readonly lifecycleKey: LifecycleStatusKey
}

type VersionSortField = 'certificateName' | 'notBefore' | 'notAfter' | 'issuer' | 'subject' | 'status'
type VersionSortOrder = 'asc' | 'desc'
type LifecycleStatusKey = 'unknown' | 'expired' | 'expiringSoon' | 'valid'
type CertificateSourceTypeKey = 'manual' | 'internal_ca' | 'enterprise_ca' | 'external_api' | 'acme' | 'unknown'
type CertificateCardSourceKey = 'manual' | 'acme' | 'unknown'
type CertificateCategory = 'all' | LifecycleStatusKey
type AssetPresentation = 'cards' | 'list'
const EXPIRING_SOON_DAYS = 10
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

const route = useRoute()
const router = useRouter()
const { t, te } = useI18n()
const appStore = useAppStore()
const permissionStore = usePermissionStore()
const initialQuery = route.query ?? {}
const filters = reactive<Record<string, string>>({
  keyword: typeof initialQuery.keyword === 'string' ? initialQuery.keyword : '',
  primaryDomain: typeof initialQuery.primaryDomain === 'string' ? initialQuery.primaryDomain : '',
  status: typeof initialQuery.status === 'string' ? initialQuery.status : '',
})

const assetsLoading = ref(false)
const versionsLoading = ref(false)
const assetsError = ref<CertificatePageError | null>(null)
const versionsError = ref<CertificatePageError | null>(null)
const assets = ref<ApiRecord[]>([])
const versions = ref<ApiRecord[]>([])
const assetLifecycleMap = ref<Record<string, LifecycleStatusKey>>({})
const assetVersionCountMap = ref<Record<string, number>>({})
const assetVersionSummaryMap = ref<Record<string, ApiRecord>>({})
const selectedAssetId = ref('')
const selectedRouteAsset = ref<ApiRecord | null>(null)
const professionalAssetPresentation = ref<AssetPresentation>('cards')
const certificateCategory = ref<CertificateCategory>('all')
const filtersVisible = ref(false)
const versionFilterKeyword = ref('')
const versionFilterStatus = ref('')
const versionSortField = ref<VersionSortField>('notAfter')
const versionSortOrder = ref<VersionSortOrder>('asc')
let versionRequestSequence = 0
let skipSelectedAssetVersionRequest = false

const importDialogOpen = ref(false)
const trustRootsDialogOpen = ref(false)
const trustRootTargetId = ref('')
const versionsDialogOpen = ref(false)
const detailDialogOpen = ref(false)
const importLoading = ref(false)
const importValidating = ref(false)
const deletingVersionId = ref('')
const versionActionError = ref<CertificatePageError | null>(null)
const importError = ref('')
const importResultId = ref('')
const importValidationResult = ref<CertificateImportValidationResult | null>(null)
const detailVersionId = ref('')
const detailAssetId = ref('')
const draft = reactive(createCertificateImportDraft())
const applicationAssetCount = ref<number | null>(null)
const automationPlanCount = ref<number | null>(null)
const activeAutomationPlanCount = ref<number | null>(null)

const assetDomainGroups = computed(() => {
  const groups = new Map<string, ApiRecord[]>()
  assets.value.forEach((record) => {
    const assetId = readId(record)
    const domainName = readAssetName(record)
    if (!assetId || !domainName) return
    if ((assetVersionCountMap.value[assetId] ?? 0) <= 0) return
    const current = groups.get(domainName)
    if (current) {
      current.push(record)
      return
    }
    groups.set(domainName, [record])
  })
  return groups
})
const displayedAssets = computed(() =>
  [...assetDomainGroups.value.values()]
    .map(selectRepresentativeAsset)
    .filter((record): record is ApiRecord => Boolean(record)),
)
const visibleAssets = computed(() => {
  if (certificateCategory.value === 'all') return displayedAssets.value
  return displayedAssets.value.filter((record) => readAssetLifecycleStatusKey(record) === certificateCategory.value)
})
const selectedAsset = computed(() =>
  displayedAssets.value.find((item) => readId(item) === selectedAssetId.value)
  ?? (readId(selectedRouteAsset.value ?? {}) === selectedAssetId.value ? selectedRouteAsset.value : null),
)
const selectedDomainName = computed(() => (selectedAsset.value ? readAssetName(selectedAsset.value) : t('certificates.list.fallbacks.unselectedDomain')))
const selectedAssetMemberIds = computed(() => {
  if (!selectedAsset.value) return []
  return (assetDomainGroups.value.get(readAssetName(selectedAsset.value)) ?? [])
    .map((item) => readId(item))
    .filter(Boolean)
})
const assetCount = computed(() => displayedAssets.value.length)
const isProfessionalView = computed(() => appStore.viewMode === 'professional')
const canReadApplicationAssets = computed(() => permissionStore.hasPermission('service_asset.read'))
const canReadAutomationPlans = computed(() => permissionStore.hasPermission('automation.read'))
const expiredAssetCount = computed(() => displayedAssets.value.filter((item) => readAssetLifecycleStatusKey(item) === 'expired').length)
const expiringSoonAssetCount = computed(() => displayedAssets.value.filter((item) => readAssetLifecycleStatusKey(item) === 'expiringSoon').length)
const userFlowSteps = computed<UserFlowStep[]>(() => [
  {
    id: 'certificates',
    label: t('viewMode.steps.certificates'),
    help: t('certificates.userView.hero.description'),
    helpLabel: t('certificates.userView.hero.title'),
    completed: assetCount.value > 0,
  },
  {
    id: 'applications',
    label: t('viewMode.steps.applications'),
    help: t('certificates.userView.steps.applications.description'),
    helpLabel: t('certificates.userView.steps.applications.title'),
    completed: (applicationAssetCount.value ?? 0) > 0,
  },
  {
    id: 'deployments',
    label: t('viewMode.steps.deployments'),
    help: t('certificates.userView.steps.automations.description'),
    helpLabel: t('certificates.userView.steps.automations.title'),
    completed: (activeAutomationPlanCount.value ?? 0) > 0,
  },
])
const simpleFlowSections = computed<SimpleFlowSection[]>(() => [
  {
    id: 'certificates',
    label: t('certificates.userView.simple.sections.certificates.title'),
    help: t('certificates.userView.simple.sections.certificates.help'),
    helpLabel: t('certificates.userView.simple.sections.certificates.title'),
  },
  {
    id: 'applications',
    label: t('certificates.userView.simple.sections.applications.title'),
    help: t('certificates.userView.simple.sections.applications.help'),
    helpLabel: t('certificates.userView.simple.sections.applications.title'),
  },
])
const activeSimpleSection = ref('certificates')
const attentionAssets = computed(() =>
  displayedAssets.value
    .map((record) => {
      const lifecycleKey = readAssetLifecycleStatusKey(record)
      return {
        id: readId(record),
        name: readAssetName(record),
        lifecycleKey,
        lifecycle: formatLifecycleStatus(lifecycleKey),
        expiresAt: readAssetExpiry(record),
      }
    })
    .filter((item) => item.id && (item.lifecycleKey === 'expired' || item.lifecycleKey === 'expiringSoon'))
    .sort((left, right) => compareAttentionAssets(left, right))
    .slice(0, 4),
)
const rawVersionRows = computed<CertificateVersionRow[]>(() =>
  versions.value.map((record, index) => {
    const id = readString(record, ['id', 'certificateVersionId'], `certver-${index + 1}`)
    const notBefore = formatDateOnly(readString(record, ['notBefore'], t('certificates.detailPanel.fallbacks.unknown')))
    const notAfter = formatDateOnly(readString(record, ['notAfter'], t('certificates.detailPanel.fallbacks.unknown')))
    const status = readString(record, ['status', 'state'], 'MANAGED')
    const lifecycleKey = resolveLifecycleStatusKey(notAfter, status)
    const sourceType = resolveCertificateSourceTypeKey(readString(record, ['sourceType'], ''))
    return {
      id,
      assetId: readString(record, ['certificateAssetId'], selectedAssetId.value || 'unknown-asset'),
      certificateName: readString(record, ['commonName', 'subject.commonName', 'name'], id),
      associatedAsset: selectedDomainName.value,
      sourceType,
      sourceTypeLabel: t(`certificates.list.sourceTypes.${sourceType}`),
      sourceTypeTone: certificateSourceTypeTone(sourceType),
      notBefore,
      notAfter,
      issuer: readString(record, ['issuer.commonName', 'issuer.organization', 'issuer.raw'], t('certificates.detailPanel.fallbacks.unknownIssuer')),
      subject: readString(record, ['subject.commonName', 'subject.organization', 'subject.raw'], t('certificates.detailPanel.fallbacks.unknownSubject')),
      status,
      lifecycle: formatLifecycleStatus(lifecycleKey),
      lifecycleKey,
    }
  }),
)
const assetColumns = computed<DataTableColumn<ApiRecord>[]>(() => [
  { key: 'domain', title: t('certificates.list.filters.domain'), width: '18%' },
  { key: 'status', title: t('certificates.list.columns.status'), width: '10%' },
  { key: 'validity', title: t('certificates.detailPanel.validity.title'), width: '25%' },
  { key: 'expires', title: t('certificates.userView.simple.fields.expires'), width: '13%' },
  { key: 'source', title: t('certificates.userView.simple.fields.source'), width: '12%' },
  { key: 'version', title: t('certificates.detailPanel.fields.version'), width: '10%' },
  { key: 'actions', title: t('agents.columns.actions'), width: '12%' },
])
const versionColumns = computed<DataTableColumn<CertificateVersionRow>[]>(() => [
  { key: 'certificateName', title: t('certificates.detailPanel.summary.certificateName'), width: '12%' },
  { key: 'notBefore', title: t('certificates.list.columns.notBefore'), width: '10%' },
  { key: 'notAfter', title: t('certificates.list.columns.notAfter'), width: '10%' },
  { key: 'issuer', title: t('certificates.detailPanel.summary.issuer'), width: '16%' },
  { key: 'subject', title: t('certificates.detailPanel.summary.subject'), width: '12%' },
  { key: 'associatedAsset', title: t('certificates.list.columns.associatedAsset'), width: '12%' },
  { key: 'sourceType', title: t('certificates.list.columns.sourceType'), width: '9%' },
  { key: 'status', title: t('certificates.list.columns.status'), width: '8%' },
  { key: 'id', title: t('certificates.list.columns.certificateVersionId'), width: '12%' },
  { key: 'actions', title: t('agents.columns.actions'), width: 'var(--gc-size-card-min)' },
])
const versionRows = computed<CertificateVersionRow[]>(() => {
  const keyword = versionFilterKeyword.value.trim().toLowerCase()
  const status = versionFilterStatus.value.trim()
  const rows = rawVersionRows.value.filter((row) => {
    if (status && row.status !== status && row.lifecycleKey !== status) return false
    if (!keyword) return true
    const haystack = [
      row.certificateName,
      row.notBefore,
      row.notAfter,
      row.issuer,
      row.subject,
      row.associatedAsset,
      row.sourceTypeLabel,
      row.id,
    ].join('\n').toLowerCase()
    return haystack.includes(keyword)
  })
  return [...rows].sort(compareVersionRows)
})
const versionCount = computed(() => versionRows.value.length)
const canDeleteVersion = computed(() => permissionStore.hasPermission('certificate.lifecycle'))

const hasCertificateMaterial = computed(() => isMaterialReady(draft))

watch(selectedAssetId, () => {
  if (skipSelectedAssetVersionRequest) {
    skipSelectedAssetVersionRequest = false
    return
  }
  void requestVersionsForSelectedAsset()
})

watch(
  () => route.query.rootId,
  (value) => {
    const rootId = typeof value === 'string' ? value : ''
    if (!rootId) return
    trustRootTargetId.value = rootId
    trustRootsDialogOpen.value = true
  },
  { immediate: true },
)

watch(
  () => [
    draft.format,
    draft.importMethod,
    draft.certificatePem,
    draft.pfxBase64,
    draft.pfxPassword,
    draft.privateKeyPem,
    draft.name,
  ],
  () => {
    importValidationResult.value = null
    if (!importLoading.value && !importValidating.value) {
      importError.value = ''
    }
  },
)

onMounted(() => {
  const assetId = typeof route.query.assetId === 'string' ? route.query.assetId : ''
  if (route.query.versionsModal === '1' && assetId) {
    void openRouteVersionsDialog(assetId)
  }
  void loadAssets()
  void loadGuideContext()
})

function readId(record: ApiRecord) {
  return readString(record, ['id', 'certificateId'], '')
}

function readAssetName(record: ApiRecord) {
  return readString(record, ['primaryDomain', 'name', 'commonName'], t('certificates.list.fallbacks.unnamedDomain'))
}

function readAssetSubtitle(record: ApiRecord) {
  const sourceType = readAssetSourceType(record)
  const sourceTypeLabel = t(`certificates.list.sourceTypes.${sourceType}`)
  return readString(readAssetVersion(record), ['notAfter'], readString(record, ['updatedAt'], sourceTypeLabel))
}

function readAssetIssuer(record: ApiRecord) {
  const version = readAssetVersion(record)
  return readString(
    version ?? record,
    ['issuer.commonName', 'issuer.organization', 'issuer.raw'],
    t('certificates.detailPanel.fallbacks.unknownIssuer'),
  )
}

function readAssetVersion(record: ApiRecord | null): ApiRecord | null {
  if (!record) return null
  const assetId = readId(record)
  const summary = assetId ? assetVersionSummaryMap.value[assetId] : undefined
  if (summary) return summary
  const currentVersion = readPath(record, 'currentVersion')
  return currentVersion && typeof currentVersion === 'object' && !Array.isArray(currentVersion)
    ? currentVersion as ApiRecord
    : null
}

function readAssetSourceType(record: ApiRecord | null) {
  return resolveCertificateSourceTypeKey(readAssetRawSourceType(record))
}

function readAssetRawSourceType(record: ApiRecord | null) {
  return readString(readAssetVersion(record), ['sourceType'], readString(record, ['sourceType'], '')).trim().toLowerCase()
}

function readAssetCardSourceType(record: ApiRecord | null): CertificateCardSourceKey {
  const sourceType = readAssetRawSourceType(record)
  if (sourceType === 'manual') return 'manual'
  if (sourceType === 'acme' || sourceType === 'external_api') return 'acme'
  return 'unknown'
}

function assetCardSourceLabel(record: ApiRecord | null) {
  return t(`certificates.userView.simple.sourceLabels.${readAssetCardSourceType(record)}`)
}

function assetCardSourceTone(record: ApiRecord | null): StatusTone {
  switch (readAssetCardSourceType(record)) {
    case 'manual':
      return 'info'
    case 'acme':
      return 'success'
    default:
      return 'muted'
  }
}

function readAssetRemainingLabel(record: ApiRecord) {
  const expiresAt = Date.parse(readAssetExpiry(record))
  if (Number.isNaN(expiresAt)) return t('agents.certificate.statusUnknown')
  const remainingDays = Math.ceil((expiresAt - Date.now()) / MILLISECONDS_PER_DAY)
  if (remainingDays < 0) return t('agents.certificate.expiredDays', { days: Math.abs(remainingDays) })
  if (remainingDays === 0) return t('agents.certificate.expiresToday')
  return t('agents.certificate.remainingDays', { days: remainingDays })
}

function readAssetValidityProgress(record: ApiRecord) {
  const expiresAt = Date.parse(readAssetExpiry(record))
  const startsAt = Date.parse(readAssetNotBefore(record))
  if (!Number.isNaN(expiresAt) && !Number.isNaN(startsAt) && expiresAt > startsAt) {
    return Math.round(Math.min(Math.max((expiresAt - Date.now()) / (expiresAt - startsAt), 0), 1) * 100)
  }
  const lifecycle = readAssetLifecycleStatusKey(record)
  if (lifecycle === 'valid') return 100
  if (lifecycle === 'expiringSoon') return 10
  return 0
}

function assetCardAriaLabel(record: ApiRecord) {
  return t('dashboard.statusBlock.detail.certificateRemaining', {
    name: readAssetName(record),
    days: readAssetRemainingLabel(record),
  })
}

function versionTriggerId(assetId: string) {
  return `certificate-record-trigger-${assetId}`
}

function versionDialogPanelId(assetId: string) {
  return `certificate-versions-dialog-${assetId}`
}

function buildCertificateRouteQuery() {
  const query: Record<string, string> = {}
  const keyword = filters.keyword.trim()
  const primaryDomain = filters.primaryDomain.trim()
  const status = filters.status.trim()
  if (keyword) query.keyword = keyword
  if (primaryDomain) query.primaryDomain = primaryDomain
  if (status) query.status = status
  return query
}

function syncCertificateRouteQuery() {
  void router.replace({ path: '/certificates', query: buildCertificateRouteQuery() })
}

function formatDateOnly(value: string) {
  return formatBrowserLocalTime(value, { includeTime: false }) || t('common.notAvailable')
}

function readAssetExpiry(record: ApiRecord | null) {
  return readString(readAssetVersion(record) ?? record, ['notAfter', 'expiresAt'], '')
}

function readAssetNotBefore(record: ApiRecord | null) {
  return readString(readAssetVersion(record) ?? record, ['notBefore'], '')
}

function compareAttentionAssets(
  left: { readonly lifecycleKey: LifecycleStatusKey; readonly expiresAt: string; readonly id: string },
  right: { readonly lifecycleKey: LifecycleStatusKey; readonly expiresAt: string; readonly id: string },
) {
  const priorityDiff = attentionAssetPriority(left.lifecycleKey) - attentionAssetPriority(right.lifecycleKey)
  if (priorityDiff !== 0) return priorityDiff
  const leftTime = Date.parse(left.expiresAt)
  const rightTime = Date.parse(right.expiresAt)
  const normalizedLeftTime = Number.isNaN(leftTime) ? Number.MAX_SAFE_INTEGER : leftTime
  const normalizedRightTime = Number.isNaN(rightTime) ? Number.MAX_SAFE_INTEGER : rightTime
  if (normalizedLeftTime !== normalizedRightTime) return normalizedLeftTime - normalizedRightTime
  return left.id.localeCompare(right.id)
}

function attentionAssetPriority(status: LifecycleStatusKey) {
  if (status === 'expired') return 0
  if (status === 'expiringSoon') return 1
  if (status === 'valid') return 2
  return 3
}

async function loadAssets() {
  assetsLoading.value = true
  assetsError.value = null
  try {
    const result = await listCertificates({
      page: 1,
      pageSize: 100,
      sort: 'updatedAt:desc',
      keyword: filters.keyword,
      filters: {
        primaryDomain: filters.primaryDomain,
        status: filters.status,
      },
    })
    assets.value = [...(result.data?.items ?? [])]
    await loadAssetLifecycleStatuses(assets.value)
    if (
      selectedAssetId.value
      && !selectedRouteAsset.value
      && !displayedAssets.value.some((item) => readId(item) === selectedAssetId.value)
    ) {
      selectedAssetId.value = ''
    }
  } catch (cause) {
    assetsError.value = toErrorState(cause)
    assets.value = []
    assetLifecycleMap.value = {}
    assetVersionCountMap.value = {}
    assetVersionSummaryMap.value = {}
    if (!selectedRouteAsset.value) selectedAssetId.value = ''
  } finally {
    assetsLoading.value = false
  }
}

async function loadAssetLifecycleStatuses(records: ApiRecord[]) {
  const entries = await Promise.all(records.map(async (record) => {
    const assetId = readId(record)
    if (!assetId) return ['', { lifecycle: 'unknown' as const, total: 0, version: null }] as const
    try {
      const result = await listCertificateVersions({
        page: 1,
        pageSize: 1,
        sort: 'notAfter:desc',
        filters: {
          certificateAssetId: assetId,
        },
      })
      const latest = (result.data?.items?.[0] ?? null) as ApiRecord | null
      const notAfter = readString(latest, ['notAfter'], '')
      return [assetId, {
        lifecycle: resolveLifecycleStatusKey(notAfter, readString(latest, ['status', 'state'], 'MANAGED')),
        total: Number(result.data?.total ?? 0),
        version: latest,
      }] as const
    } catch {
      return [assetId, { lifecycle: readAssetLifecycleStatusKey(record), total: 0, version: readAssetVersion(record) }] as const
    }
  }))
  assetLifecycleMap.value = Object.fromEntries(entries.filter(([assetId]) => assetId).map(([assetId, state]) => [assetId, state.lifecycle]))
  assetVersionCountMap.value = Object.fromEntries(entries.filter(([assetId]) => assetId).map(([assetId, state]) => [assetId, state.total]))
  assetVersionSummaryMap.value = Object.fromEntries(entries.filter(([assetId, state]) => assetId && state.version).map(([assetId, state]) => [assetId, state.version as ApiRecord]))
}

function isCurrentVersionRequest(requestId: number, ownerAssetId: string) {
  return requestId === versionRequestSequence && ownerAssetId === selectedAssetId.value
}

async function requestVersionsForSelectedAsset() {
  const ownerAssetId = selectedAssetId.value
  const assetIds = [...selectedAssetMemberIds.value]
  const requestId = ++versionRequestSequence

  versions.value = []
  versionsError.value = null
  versionActionError.value = null
  if (!ownerAssetId || assetIds.length === 0) {
    versionsLoading.value = false
    return
  }

  versionsLoading.value = true
  await loadVersions(assetIds, ownerAssetId, requestId)
}

async function loadVersions(assetIds: string[], ownerAssetId: string, requestId: number) {
  try {
    const results = await Promise.all(assetIds.map((assetId) => listCertificateVersions({
      page: 1,
      pageSize: 100,
      sort: 'createdAt:desc',
      filters: {
        certificateAssetId: assetId,
      },
    })))
    const merged = new Map<string, ApiRecord>()
    results.forEach((result) => {
      ;(result.data?.items ?? []).forEach((item) => {
        const versionId = readString(item, ['id', 'certificateVersionId'], '')
        if (!versionId || merged.has(versionId)) return
        merged.set(versionId, item)
      })
    })
    if (!isCurrentVersionRequest(requestId, ownerAssetId)) return
    versions.value = [...merged.values()]
  } catch (cause) {
    if (!isCurrentVersionRequest(requestId, ownerAssetId)) return
    versionsError.value = toErrorState(cause)
    versions.value = []
  } finally {
    if (isCurrentVersionRequest(requestId, ownerAssetId)) {
      versionsLoading.value = false
    }
  }
}

function updateFilters() {
  syncCertificateRouteQuery()
  void loadAssets()
}

function clearFilters() {
  filters.keyword = ''
  filters.primaryDomain = ''
  filters.status = ''
  updateFilters()
}

function toggleFilters() {
  filtersVisible.value = !filtersVisible.value
}

function selectCertificateCategory(category: CertificateCategory) {
  certificateCategory.value = category
  if (selectedAssetId.value && !selectedRouteAsset.value && !visibleAssets.value.some((item) => readId(item) === selectedAssetId.value)) {
    selectedAssetId.value = ''
  }
}

function presentationLabel(presentation: AssetPresentation) {
  const directKey = `assets.presentation.${presentation}`
  if (te(directKey)) return t(directKey)
  return t(`dashboard.quickActions.assets.presentation.${presentation}`)
}

function selectAsset(assetId: string) {
  if (!assetId) return
  const nextAssetId = assetId === selectedAssetId.value ? '' : assetId
  if (nextAssetId === selectedAssetId.value) return
  versionActionError.value = null
  selectedAssetId.value = nextAssetId
}

function openVersionsDialog(assetId: string) {
  if (!assetId) return
  versionActionError.value = null
  selectedRouteAsset.value = null
  selectedAssetId.value = assetId
  versionsDialogOpen.value = true
}

async function openRouteVersionsDialog(assetId: string) {
  if (!assetId) return
  const requestId = ++versionRequestSequence
  skipSelectedAssetVersionRequest = true
  selectedAssetId.value = assetId
  selectedRouteAsset.value = { id: assetId }
  versions.value = []
  versionsError.value = null
  versionActionError.value = null
  versionsLoading.value = true
  versionsDialogOpen.value = true

  try {
    const result = await getCertificateAssetDetail(assetId)
    if (requestId !== versionRequestSequence || selectedAssetId.value !== assetId) return
    const asset = result.data ?? null
    selectedRouteAsset.value = asset
    const routeVersions = Array.isArray(asset?.versions) ? asset.versions as ApiRecord[] : []
    versions.value = routeVersions
    assetVersionCountMap.value = {
      ...assetVersionCountMap.value,
      [assetId]: routeVersions.length,
    }
    const currentVersion = readAssetVersion(asset)
    if (currentVersion) {
      assetVersionSummaryMap.value = {
        ...assetVersionSummaryMap.value,
        [assetId]: currentVersion,
      }
      assetLifecycleMap.value = {
        ...assetLifecycleMap.value,
        [assetId]: resolveLifecycleStatusKey(
          readString(currentVersion, ['notAfter'], ''),
          readString(currentVersion, ['status', 'state'], 'MANAGED'),
        ),
      }
    }
  } catch (cause) {
    if (requestId !== versionRequestSequence || selectedAssetId.value !== assetId) return
    versionsError.value = toErrorState(cause)
  } finally {
    if (requestId === versionRequestSequence && selectedAssetId.value === assetId) {
      versionsLoading.value = false
    }
  }
}

function openImportDialog() {
  importError.value = ''
  importResultId.value = ''
  importValidationResult.value = null
  resetCertificateImportDraft(draft)
  importDialogOpen.value = true
}

function closeImportDialog() {
  if (importLoading.value) return
  importDialogOpen.value = false
}

function openTrustRootsDialog() {
  trustRootTargetId.value = ''
  trustRootsDialogOpen.value = true
}

async function loadGuideContext() {
  const tasks: Array<Promise<void>> = []
  applicationAssetCount.value = null
  automationPlanCount.value = null
  activeAutomationPlanCount.value = null

  if (canReadApplicationAssets.value) {
    tasks.push(
      listAssets({ page: 1, pageSize: 1, sort: 'updatedAt:desc' })
        .then((result) => {
          applicationAssetCount.value = Number(result.data?.total ?? 0)
        })
        .catch(() => {
          applicationAssetCount.value = null
        }),
    )
  }

  if (canReadAutomationPlans.value) {
    tasks.push(
      listAutomations()
        .then((items) => {
          automationPlanCount.value = items.length
          activeAutomationPlanCount.value = items.filter((item) => item.status === 'active').length
        })
        .catch(() => {
          automationPlanCount.value = null
          activeAutomationPlanCount.value = null
        }),
    )
  }

  if (tasks.length > 0) {
    await Promise.all(tasks)
  }
}

function formatGuideCount(value: number | null) {
  return value === null ? t('certificates.userView.common.notAvailable') : String(value)
}

function openApplicationWorkspace() {
  void router.push({ name: 'asset.list', query: { entry: 'certificate-user-view', action: 'create' } })
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

async function submitImport() {
  if (!hasCertificateMaterial.value) {
    importError.value = t('certificates.list.errors.materialRequiredForFormat')
    return
  }
  if (!importValidationResult.value?.importable) {
    importError.value = t('certificates.import.errors.needPassedValidation')
    return
  }
  importLoading.value = true
  importError.value = ''
  importResultId.value = ''
  try {
    const result = await importCertificate(buildCertificateImportPayload(draft))
    importResultId.value = String(result.data?.id ?? result.data?.certificateId ?? result.data?.certificateAssetId ?? '')
    importDialogOpen.value = false
    importValidationResult.value = null
    resetCertificateImportDraft(draft)
    await loadAssets()
  } catch (cause) {
    if (cause instanceof ApiClientError) {
      importError.value = `${cause.message}（${cause.errorCode}）`
      return
    }
    importError.value = cause instanceof Error ? cause.message : t('certificates.list.errors.importFailedWithCheck')
  } finally {
    importLoading.value = false
  }
}

async function validateImportDraft() {
  if (!hasCertificateMaterial.value) {
    importError.value = t('certificates.import.errors.materialRequiredBeforeValidate')
    importValidationResult.value = null
    return
  }
  importValidating.value = true
  importError.value = ''
  importValidationResult.value = null
  try {
    const result = await validateCertificateImport(buildCertificateImportPayload(draft))
    importValidationResult.value = result.data as unknown as CertificateImportValidationResult
  } catch (cause) {
    if (cause instanceof ApiClientError) {
      importError.value = `${cause.message}（${cause.errorCode}）`
      return
    }
    importError.value = cause instanceof Error ? cause.message : t('certificates.list.errors.validateFailedWithCheck')
  } finally {
    importValidating.value = false
  }
}

function readAssetLifecycleStatus(record: ApiRecord | null) {
  return formatLifecycleStatus(readAssetLifecycleStatusKey(record))
}

function readAssetLifecycleStatusKey(record: ApiRecord | null): LifecycleStatusKey {
  if (!record) return 'unknown'
  const assetId = readId(record)
  if (assetId && assetLifecycleMap.value[assetId]) return assetLifecycleMap.value[assetId]
  const expiry = readAssetExpiry(record)
  if (!expiry) return 'unknown'
  return resolveLifecycleStatusKey(formatDateOnly(expiry))
}

function resolveLifecycleStatusKey(notAfter: string, status = ''): LifecycleStatusKey {
  const normalizedStatus = status.toUpperCase()
  if (normalizedStatus === 'EXPIRED') return 'expired'
  const expiresAt = Date.parse(notAfter)
  if (Number.isNaN(expiresAt)) return 'unknown'
  const diffMs = expiresAt - Date.now()
  if (diffMs < 0) return 'expired'
  if (diffMs <= EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000) return 'expiringSoon'
  return 'valid'
}

function formatLifecycleStatus(status: LifecycleStatusKey) {
  return t(`certificates.list.lifecycle.${status}`)
}

function resolveCertificateSourceTypeKey(value: string): CertificateSourceTypeKey {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'manual' || normalized === 'internal_ca' || normalized === 'enterprise_ca' || normalized === 'external_api' || normalized === 'acme') return normalized
  return 'unknown'
}

function certificateSourceTypeTone(sourceType: CertificateSourceTypeKey): StatusTone {
  return sourceType === 'manual' || sourceType === 'unknown' ? 'muted' : 'info'
}

function lifecycleStatusTone(status: LifecycleStatusKey): StatusTone {
  switch (status) {
    case 'valid':
      return 'success'
    case 'expiringSoon':
      return 'warning'
    case 'expired':
      return 'danger'
    default:
      return 'muted'
  }
}

function selectRepresentativeAsset(records: ApiRecord[]) {
  return [...records].sort(compareAssetRecords)[0]
}

function compareAssetRecords(left: ApiRecord, right: ApiRecord) {
  const leftId = readId(left)
  const rightId = readId(right)
  const countDiff = (assetVersionCountMap.value[rightId] ?? 0) - (assetVersionCountMap.value[leftId] ?? 0)
  if (countDiff !== 0) return countDiff
  const leftTime = Date.parse(readAssetExpiry(left) || readString(left, ['updatedAt'], ''))
  const rightTime = Date.parse(readAssetExpiry(right) || readString(right, ['updatedAt'], ''))
  const normalizedLeftTime = Number.isNaN(leftTime) ? -1 : leftTime
  const normalizedRightTime = Number.isNaN(rightTime) ? -1 : rightTime
  if (normalizedLeftTime !== normalizedRightTime) return normalizedRightTime - normalizedLeftTime
  return leftId.localeCompare(rightId)
}

function normalizeSortValue(row: CertificateVersionRow, field: VersionSortField) {
  switch (field) {
    case 'notBefore':
      return normalizeDateValue(row.notBefore)
    case 'notAfter':
      return normalizeDateValue(row.notAfter)
    case 'status':
      return `${row.lifecycleKey}|${row.status}`.toLowerCase()
    default:
      return String(row[field] ?? '').toLowerCase()
  }
}

function normalizeDateValue(value: string) {
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? -1 : timestamp
}

function compareVersionRows(left: CertificateVersionRow, right: CertificateVersionRow) {
  const field = versionSortField.value
  const leftValue = normalizeSortValue(left, field)
  const rightValue = normalizeSortValue(right, field)
  if (leftValue === rightValue) return left.id.localeCompare(right.id)
  const result = leftValue > rightValue ? 1 : -1
  return versionSortOrder.value === 'asc' ? result : -result
}

function toggleVersionSort(field: VersionSortField) {
  if (versionSortField.value === field) {
    versionSortOrder.value = versionSortOrder.value === 'asc' ? 'desc' : 'asc'
    return
  }
  versionSortField.value = field
  versionSortOrder.value = field === 'notAfter' ? 'asc' : 'desc'
}

function sortIndicator(field: VersionSortField) {
  if (versionSortField.value !== field) return ''
  return versionSortOrder.value === 'asc' ? '↑' : '↓'
}

function clearVersionFilters() {
  versionFilterKeyword.value = ''
  versionFilterStatus.value = ''
}

function openDetailDialog(row: CertificateVersionRow) {
  detailAssetId.value = row.assetId
  detailVersionId.value = row.id
  detailDialogOpen.value = true
}

async function removeVersion(row: CertificateVersionRow) {
  if (!row.id || deletingVersionId.value) return
  const ownerAssetId = row.assetId
  deletingVersionId.value = row.id
  versionActionError.value = null
  try {
    await deleteCertificateVersion(row.id)
    if (detailDialogOpen.value && detailVersionId.value === row.id) {
      detailDialogOpen.value = false
      detailVersionId.value = ''
      detailAssetId.value = ''
    }
    await requestVersionsForSelectedAsset()
    await loadAssets()
  } catch (cause) {
    if (selectedAssetMemberIds.value.includes(ownerAssetId)) {
      versionActionError.value = toErrorState(cause)
    }
  } finally {
    deletingVersionId.value = ''
  }
}
</script>

<template>
  <section class="gc-page certificate-page">
    <div v-if="importResultId" class="certificate-page__inline-success" role="status">
      <strong>{{ t('certificates.banners.importSucceeded', { id: importResultId }) }}</strong>
    </div>

    <template v-if="isProfessionalView">
      <section class="certificate-page__metrics" :aria-label="t('businessPage.metricsAria')">
        <article class="certificate-page__metric">
          <span>{{ t('certificates.userView.simple.stats.total') }}</span>
          <strong>{{ assetsLoading ? t('common.notAvailable') : assetCount }}</strong>
          <small>{{ t('certificates.list.assets.title') }}</small>
        </article>
        <article class="certificate-page__metric certificate-page__metric--warning">
          <span>{{ t('certificates.userView.simple.stats.expiring') }}</span>
          <strong>{{ assetsLoading ? t('common.notAvailable') : expiringSoonAssetCount }}</strong>
          <small>{{ t('certificates.userView.simple.fields.expires') }}</small>
        </article>
        <article class="certificate-page__metric certificate-page__metric--danger">
          <span>{{ t('certificates.userView.simple.stats.expired') }}</span>
          <strong>{{ assetsLoading ? t('common.notAvailable') : expiredAssetCount }}</strong>
          <small>{{ t('certificates.list.lifecycle.expired') }}</small>
        </article>
      </section>

      <section class="certificate-page__workspace-head" :aria-label="t('certificates.list.assets.title')">
        <div class="certificate-page__workspace-view">
          <div class="certificate-page__presentation-toggle" role="group" :aria-label="t('certificates.list.assets.title')">
            <GcButton
              variant="ghost"
              class="certificate-page__presentation-toggle-button"
              :class="{ 'certificate-page__presentation-toggle-button--active': professionalAssetPresentation === 'cards' }"
              :aria-pressed="professionalAssetPresentation === 'cards'"
              :aria-label="presentationLabel('cards')"
              @click="professionalAssetPresentation = 'cards'"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h5v5H5V5Zm9 0h5v5h-5V5ZM5 14h5v5H5v-5Zm9 0h5v5h-5v-5Z" /></svg>
            </GcButton>
            <GcButton
              variant="ghost"
              class="certificate-page__presentation-toggle-button"
              :class="{ 'certificate-page__presentation-toggle-button--active': professionalAssetPresentation === 'list' }"
              :aria-pressed="professionalAssetPresentation === 'list'"
              :aria-label="presentationLabel('list')"
              @click="professionalAssetPresentation = 'list'"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h2v2H5V6Zm4 0h10v2H9V6ZM5 11h2v2H5v-2Zm4 0h10v2H9v-2ZM5 16h2v2H5v-2Zm4 0h10v2H9v-2Z" /></svg>
            </GcButton>
          </div>
          <div class="certificate-page__category-tabs" role="group" :aria-label="t('certificates.list.filters.status')">
            <button
              class="certificate-page__category-tab"
              :class="{ 'certificate-page__category-tab--active': certificateCategory === 'all' }"
              type="button"
              :aria-pressed="certificateCategory === 'all'"
              @click="selectCertificateCategory('all')"
            >
              {{ t('businessPage.all') }}
            </button>
            <button
              class="certificate-page__category-tab"
              :class="{ 'certificate-page__category-tab--active': certificateCategory === 'valid' }"
              type="button"
              :aria-pressed="certificateCategory === 'valid'"
              @click="selectCertificateCategory('valid')"
            >
              {{ t('certificates.list.lifecycle.valid') }}
            </button>
            <button
              class="certificate-page__category-tab"
              :class="{ 'certificate-page__category-tab--active': certificateCategory === 'expiringSoon' }"
              type="button"
              :aria-pressed="certificateCategory === 'expiringSoon'"
              @click="selectCertificateCategory('expiringSoon')"
            >
              {{ t('certificates.list.lifecycle.expiringSoon') }}
            </button>
            <button
              class="certificate-page__category-tab"
              :class="{ 'certificate-page__category-tab--active': certificateCategory === 'expired' }"
              type="button"
              :aria-pressed="certificateCategory === 'expired'"
              @click="selectCertificateCategory('expired')"
            >
              {{ t('certificates.list.lifecycle.expired') }}
            </button>
          </div>
        </div>

        <GcPageToolbar class="certificate-page__toolbar-actions">
          <template #actions>
            <GcButton variant="secondary" @click="toggleFilters">
              {{ t('certificates.list.actions.toggleFilters') }}
            </GcButton>
            <GcPermissionButton class="gc-button" permission="certificate.asset.read" @click="openTrustRootsDialog">
              {{ t('certificates.trustRoots.actions.open') }}
            </GcPermissionButton>
          </template>
          <template #primary>
            <GcPermissionButton class="gc-button gc-button--primary" permission="certificate.import" @click="openImportDialog">
              {{ t('certificates.import.title') }}
            </GcPermissionButton>
          </template>
        </GcPageToolbar>
      </section>

      <section v-if="filtersVisible" class="certificate-page__toolbar">
        <section class="gc-card certificate-page__filters">
          <label class="certificate-page__filter">
            <span class="certificate-page__filter-label">{{ t('certificates.list.filters.keyword') }}</span>
            <input v-model="filters.keyword" :placeholder="t('certificates.list.placeholders.assetKeyword')" @change="updateFilters" />
          </label>
          <label class="certificate-page__filter">
            <span class="certificate-page__filter-label">{{ t('certificates.list.filters.domain') }}</span>
            <input v-model="filters.primaryDomain" :placeholder="t('certificates.list.placeholders.primaryDomain')" @change="updateFilters" />
          </label>
          <label class="certificate-page__filter">
            <span class="certificate-page__filter-label">{{ t('certificates.list.filters.status') }}</span>
            <select v-model="filters.status" @change="updateFilters">
              <option value="">{{ t('businessPage.all') }}</option>
              <option value="MANAGED">{{ t('designSystem.status.MANAGED') }}</option>
              <option value="EXPIRED">{{ t('designSystem.status.EXPIRED') }}</option>
              <option value="REVOKED">{{ t('designSystem.status.REVOKED') }}</option>
            </select>
          </label>
          <div class="certificate-page__filter-actions">
            <GcButton variant="secondary" @click="clearFilters">{{ t('businessPage.clearFilters') }}</GcButton>
          </div>
        </section>
      </section>

      <section class="certificate-page__workspace">
        <section class="certificate-page__assets" :aria-label="t('certificates.list.assets.title')">
          <header class="certificate-page__panel-header">
            <div>
              <h2>{{ t('certificates.list.assets.title') }}</h2>
              <p>{{ t('certificates.userView.simple.sections.certificates.help') }}</p>
            </div>
          </header>

          <GcEmptyState v-if="assetsError" class="certificate-page__empty-state" :title="t('certificates.list.assets.loadFailed')" :description="assetsError.message">
            <p>{{ t('businessPage.errorCode', { code: assetsError.errorCode }) }}</p>
            <GcButton variant="secondary" @click="loadAssets">{{ t('businessPage.retry') }}</GcButton>
          </GcEmptyState>

          <div v-else-if="assetsLoading" class="certificate-page__state">{{ t('certificates.detailPanel.states.loading') }}</div>

          <GcEmptyState v-else-if="visibleAssets.length === 0" class="certificate-page__empty-state" :title="t('certificates.list.assets.empty')" />

          <div v-else class="certificate-page__asset-card-list" :class="`certificate-page__asset-card-list--${professionalAssetPresentation}`">
            <template v-if="professionalAssetPresentation === 'cards'">
              <div
                v-for="asset in visibleAssets"
                :key="readId(asset)"
                class="certificate-page__asset-record"
                :class="{ 'certificate-page__asset-record--selected': readId(asset) === selectedAssetId }"
              >
                <GcCard
                  as="article"
                  class="certificate-page__asset-card"
                  interactive
                  :class="`certificate-page__asset-card--${readAssetLifecycleStatusKey(asset)}`"
                  :selected="readId(asset) === selectedAssetId"
                  :ariaLabel="assetCardAriaLabel(asset)"
                  @click="openVersionsDialog(readId(asset))"
                >
                  <template #header>
                    <span class="certificate-page__asset-card-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24"><path d="M7 4.5h10A2.5 2.5 0 0 1 19.5 7v10A2.5 2.5 0 0 1 17 19.5H7A2.5 2.5 0 0 1 4.5 17V7A2.5 2.5 0 0 1 7 4.5Z" /><path d="m8.5 12 2.1 2.1L15.7 9" /></svg>
                    </span>
                    <button
                      :id="versionTriggerId(readId(asset))"
                      class="certificate-page__asset-record-trigger"
                      type="button"
                      :aria-expanded="versionsDialogOpen && readId(asset) === selectedAssetId"
                      :aria-controls="versionDialogPanelId(readId(asset))"
                      :aria-label="assetCardAriaLabel(asset)"
                      @click.stop="openVersionsDialog(readId(asset))"
                    >
                      <span class="certificate-page__asset-card-heading">
                        <strong>{{ readAssetName(asset) }}</strong>
                        <span>{{ readAssetIssuer(asset) }}</span>
                      </span>
                      <span class="certificate-page__asset-card-status">
                        <GcStatusTag
                          :status="readAssetLifecycleStatusKey(asset)"
                          :label="readAssetLifecycleStatus(asset)"
                          :tone="lifecycleStatusTone(readAssetLifecycleStatusKey(asset))"
                        />
                      </span>
                    </button>
                  </template>
                  <template #body>
                    <section class="certificate-page__asset-card-validity">
                      <div class="certificate-page__asset-card-validity-header">
                        <span>{{ t('certificates.detailPanel.validity.title') }}</span>
                        <strong>{{ readAssetRemainingLabel(asset) }}</strong>
                      </div>
                      <GcProgressBar
                        :value="readAssetValidityProgress(asset)"
                        :tone="lifecycleStatusTone(readAssetLifecycleStatusKey(asset))"
                        outlined
                        :ariaLabel="assetCardAriaLabel(asset)"
                      />
                    </section>
                    <dl class="certificate-page__asset-card-metadata">
                      <div>
                        <dt>{{ t('certificates.userView.simple.fields.expires') }}</dt>
                        <dd>{{ readAssetExpiry(asset) ? formatDateOnly(readAssetExpiry(asset)) : t('certificates.userView.common.notAvailable') }}</dd>
                      </div>
                      <div>
                        <dt>{{ t('certificates.userView.simple.fields.source') }}</dt>
                        <dd class="certificate-page__asset-card-source-value">
                          <GcStatusTag
                            :status="readAssetCardSourceType(asset)"
                            :label="assetCardSourceLabel(asset)"
                            :tone="assetCardSourceTone(asset)"
                          />
                        </dd>
                      </div>
                      <div>
                        <dt>{{ t('certificates.detailPanel.fields.version') }}</dt>
                        <dd>{{ t('certificates.userView.simple.versionCountShort', { count: assetVersionCountMap[readId(asset)] ?? 0 }) }}</dd>
                      </div>
                    </dl>
                  </template>
                </GcCard>
              </div>
            </template>

            <GcDataTable
              v-else
              class="certificate-page__asset-table"
              :columns="assetColumns"
              :rows="visibleAssets"
              :ariaLabel="t('certificates.list.assets.title')"
            >
              <template #cell-domain="{ row }">
                <button
                  class="certificate-page__asset-table-domain"
                  type="button"
                  :aria-label="assetCardAriaLabel(row)"
                  @click="openVersionsDialog(readId(row))"
                >
                  <strong>{{ readAssetName(row) }}</strong>
                  <span>{{ readAssetIssuer(row) }}</span>
                </button>
              </template>
              <template #cell-status="{ row }">
                <GcStatusTag
                  :status="readAssetLifecycleStatusKey(row)"
                  :label="readAssetLifecycleStatus(row)"
                  :tone="lifecycleStatusTone(readAssetLifecycleStatusKey(row))"
                />
              </template>
              <template #cell-validity="{ row }">
                <div class="certificate-page__asset-table-validity">
                  <strong>{{ readAssetRemainingLabel(row) }}</strong>
                  <GcProgressBar
                    :value="readAssetValidityProgress(row)"
                    :tone="lifecycleStatusTone(readAssetLifecycleStatusKey(row))"
                    outlined
                    :ariaLabel="assetCardAriaLabel(row)"
                  />
                </div>
              </template>
              <template #cell-expires="{ row }">
                {{ readAssetExpiry(row) ? formatDateOnly(readAssetExpiry(row)) : t('certificates.userView.common.notAvailable') }}
              </template>
              <template #cell-source="{ row }">
                <GcStatusTag
                  :status="readAssetCardSourceType(row)"
                  :label="assetCardSourceLabel(row)"
                  :tone="assetCardSourceTone(row)"
                />
              </template>
              <template #cell-version="{ row }">
                {{ t('certificates.userView.simple.versionCountShort', { count: assetVersionCountMap[readId(row)] ?? 0 }) }}
              </template>
              <template #cell-actions="{ row }">
                <GcButton variant="secondary" @click="openVersionsDialog(readId(row))">
                  {{ t('agents.actions.detail') }}
                </GcButton>
              </template>
            </GcDataTable>
          </div>
        </section>

      </section>
    </template>

    <section v-else class="certificate-user-view">
      <GcSimpleFlowWizard
        :sections="simpleFlowSections"
        :active-section="activeSimpleSection"
        :title="t('certificates.userView.simple.title')"
        :subtitle="t('certificates.userView.simple.subtitle')"
        :ariaLabel="t('certificates.userView.summary.ariaLabel')"
        @select="activeSimpleSection = $event"
      >
        <template #actions>
          <GcPermissionButton class="certificate-page__import-button" permission="certificate.import" @click="openImportDialog">
            {{ t('certificates.userView.hero.primaryAction') }}
          </GcPermissionButton>
        </template>

        <!-- 证书管理区域 -->
        <section v-if="activeSimpleSection === 'certificates'" class="certificate-simple-view__section">
          <div class="certificate-simple-view__stats">
            <article class="certificate-simple-view__stat-card">
              <span class="certificate-simple-view__stat-label">{{ t('certificates.userView.simple.stats.total') }}</span>
              <strong class="certificate-simple-view__stat-value">{{ assetCount }}</strong>
            </article>
            <article class="certificate-simple-view__stat-card certificate-simple-view__stat-card--warning">
              <span class="certificate-simple-view__stat-label">{{ t('certificates.userView.simple.stats.expiring') }}</span>
              <strong class="certificate-simple-view__stat-value">{{ expiringSoonAssetCount }}</strong>
            </article>
            <article class="certificate-simple-view__stat-card certificate-simple-view__stat-card--danger">
              <span class="certificate-simple-view__stat-label">{{ t('certificates.userView.simple.stats.expired') }}</span>
              <strong class="certificate-simple-view__stat-value">{{ expiredAssetCount }}</strong>
            </article>
          </div>

          <div class="certificate-simple-view__content">
            <GcEmptyState
              v-if="assetsError"
              :title="t('certificates.list.assets.loadFailed')"
            >
              <p class="certificate-simple-view__error">{{ assetsError.message }}</p>
              <GcButton variant="secondary" @click="loadAssets">{{ t('businessPage.retry') }}</GcButton>
            </GcEmptyState>

            <div v-else-if="assetsLoading" class="certificate-simple-view__loading">
              {{ t('common.loading') }}
            </div>

            <GcEmptyState
              v-else-if="displayedAssets.length === 0"
              :title="t('certificates.userView.simple.empty.title')"
            >
              <p>{{ t('certificates.userView.simple.empty.description') }}</p>
              <GcPermissionButton permission="certificate.import" @click="openImportDialog">
                {{ t('certificates.userView.hero.primaryAction') }}
              </GcPermissionButton>
            </GcEmptyState>

            <div v-else class="certificate-simple-view__list">
              <article
                v-for="asset in displayedAssets"
                :key="readId(asset)"
                class="certificate-simple-view__card"
                @click="selectAsset(readId(asset))"
              >
                <div class="certificate-simple-view__card-header">
                  <div class="certificate-simple-view__card-title">
                    <strong>{{ readAssetName(asset) }}</strong>
                    <GcStatusTag
                      :status="readAssetLifecycleStatusKey(asset)"
                      :label="readAssetLifecycleStatus(asset)"
                      :tone="lifecycleStatusTone(readAssetLifecycleStatusKey(asset))"
                    />
                  </div>
                  <span class="certificate-simple-view__card-meta">
                    {{ t('certificates.userView.simple.versionCountShort', { count: assetVersionCountMap[readId(asset)] ?? 0 }) }}
                  </span>
                </div>
                <div class="certificate-simple-view__card-body">
                  <div class="certificate-simple-view__card-field">
                    <span class="certificate-simple-view__field-label">{{ t('certificates.userView.simple.fields.expires') }}</span>
                    <span class="certificate-simple-view__field-value">{{ readAssetExpiry(asset) ? formatDateOnly(readAssetExpiry(asset)) : t('certificates.userView.common.notAvailable') }}</span>
                  </div>
                  <div class="certificate-simple-view__card-field">
                    <span class="certificate-simple-view__field-label">{{ t('certificates.userView.simple.fields.source') }}</span>
                    <span class="certificate-simple-view__field-value">
                      <GcStatusTag
                        :status="readAssetCardSourceType(asset)"
                        :label="assetCardSourceLabel(asset)"
                        :tone="assetCardSourceTone(asset)"
                      />
                    </span>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </section>

        <!-- 应用关联区域 -->
        <section v-else-if="activeSimpleSection === 'applications'" class="certificate-simple-view__section">
          <div class="certificate-simple-view__app-header">
            <p class="certificate-simple-view__app-description">
              {{ t('certificates.userView.simple.applications.description') }}
            </p>
          </div>

          <div class="certificate-simple-view__content">
            <div v-if="assetsLoading || !selectedAsset" class="certificate-simple-view__loading">
              {{ selectedAsset ? t('common.loading') : t('certificates.userView.simple.applications.selectPrompt') }}
            </div>

            <div v-else class="certificate-simple-view__app-details">
              <div class="certificate-simple-view__selected-cert">
                <h3>{{ t('certificates.userView.simple.applications.selectedCertificate') }}</h3>
                <div class="certificate-simple-view__cert-badge">
                  <strong>{{ readAssetName(selectedAsset) }}</strong>
                  <GcStatusTag
                    :status="readAssetLifecycleStatusKey(selectedAsset)"
                    :label="readAssetLifecycleStatus(selectedAsset)"
                    :tone="lifecycleStatusTone(readAssetLifecycleStatusKey(selectedAsset))"
                  />
                </div>
              </div>

              <div class="certificate-simple-view__app-list">
                <h3>{{ t('certificates.userView.simple.applications.connectedApps', { count: applicationAssetCount ?? 0 }) }}</h3>
                <p v-if="(applicationAssetCount ?? 0) === 0" class="certificate-simple-view__empty-message">
                  {{ t('certificates.userView.simple.applications.noApps') }}
                </p>
                <button
                  v-if="canReadApplicationAssets"
                  class="gc-button gc-button--primary certificate-simple-view__action-button"
                  type="button"
                  @click="openApplicationWorkspace"
                >
                  {{ t('certificates.userView.simple.applications.addApp') }}
                </button>
              </div>

              <div v-if="(activeAutomationPlanCount ?? 0) > 0" class="certificate-simple-view__automation-info">
                <h4>{{ t('certificates.userView.simple.applications.automationTitle') }}</h4>
                <div class="certificate-simple-view__automation-stats">
                  <div class="certificate-simple-view__automation-stat">
                    <span>{{ t('certificates.userView.simple.applications.activeAutomations') }}</span>
                    <strong>{{ formatGuideCount(activeAutomationPlanCount) }}</strong>
                  </div>
                  <div class="certificate-simple-view__automation-stat">
                    <span>{{ t('certificates.userView.simple.applications.totalAutomations') }}</span>
                    <strong>{{ formatGuideCount(automationPlanCount) }}</strong>
                  </div>
                </div>
                <p class="certificate-simple-view__automation-description">
                  {{ t('certificates.userView.simple.applications.automationDescription') }}
                </p>
              </div>
            </div>
          </div>
        </section>
      </GcSimpleFlowWizard>
    </section>

    <GcModal
      v-model:open="trustRootsDialogOpen"
      :title="t('certificates.trustRoots.title')"
      size="xxl"
    >
      <CertificateTrustRootsModalContent :open="trustRootsDialogOpen" :root-id="trustRootTargetId" />
    </GcModal>

    <GcModal
      v-model:open="versionsDialogOpen"
      :title="selectedAsset ? t('certificates.list.versions.titleWithDomain', { domain: readAssetName(selectedAsset) }) : t('certificates.list.versions.title')"
      :description="t('certificates.list.versions.description')"
      :ariaLabel="t('certificates.list.versions.title')"
      max-height="calc(100vh - var(--gc-space-10))"
      size="xxl"
    >
      <section
        v-if="selectedAsset"
        :id="versionDialogPanelId(readId(selectedAsset))"
        class="certificate-page__versions certificate-page__versions--modal"
        role="region"
        :aria-labelledby="versionTriggerId(readId(selectedAsset))"
      >
        <div class="certificate-page__versions-body">
          <div v-if="versionActionError" class="certificate-page__inline-error" role="alert">
            <strong>{{ t('certificates.list.errors.deleteFailed') }}</strong>
            <span>{{ versionActionError.message }}</span>
            <span v-if="versionActionError.errorCode">{{ t('businessPage.errorCode', { code: versionActionError.errorCode }) }}</span>
          </div>
          <GcEmptyState v-if="versionsError" class="certificate-page__empty-state" :title="t('certificates.list.versions.loadFailed')" :description="versionsError.message">
            <p>{{ t('businessPage.errorCode', { code: versionsError.errorCode }) }}</p>
            <GcButton variant="secondary" @click="requestVersionsForSelectedAsset">{{ t('businessPage.retry') }}</GcButton>
          </GcEmptyState>

          <div v-else-if="versionsLoading" class="certificate-page__state">{{ t('certificates.detailPanel.states.loading') }}</div>

          <GcEmptyState
            v-else-if="versionRows.length === 0"
            class="certificate-page__empty-state"
            :title="t('certificates.list.versions.emptyForDomain')"
            :description="t('certificates.list.versions.emptyForDomainDescription')"
          />

          <GcDataTable v-else class="certificate-page__version-table" :columns="versionColumns" :rows="versionRows" :empty-text="t('certificates.list.versions.empty')" :ariaLabel="t('certificates.list.versions.titleWithDomain', { domain: readAssetName(selectedAsset) })">
            <template #toolbar>
              <div class="certificate-page__table-toolbar">
                <div class="certificate-page__table-heading">
                  <strong>{{ t('certificates.list.versions.toolbar') }}</strong>
                  <span>{{ t('certificates.list.versions.currentCount', { count: versionCount }) }}</span>
                </div>
                <div class="certificate-page__table-controls">
                  <label class="certificate-page__table-filter">
                    <span>{{ t('certificates.list.filters.keyword') }}</span>
                    <input v-model="versionFilterKeyword" :placeholder="t('certificates.list.placeholders.versionKeyword')" />
                  </label>
                  <label class="certificate-page__table-filter">
                    <span>{{ t('certificates.list.filters.status') }}</span>
                    <select v-model="versionFilterStatus">
                      <option value="">{{ t('businessPage.all') }}</option>
                      <option value="valid">{{ t('certificates.list.lifecycle.valid') }}</option>
                      <option value="expiringSoon">{{ t('certificates.list.lifecycle.expiringSoon') }}</option>
                      <option value="expired">{{ t('certificates.list.lifecycle.expired') }}</option>
                      <option value="MANAGED">{{ t('designSystem.status.MANAGED') }}</option>
                      <option value="EXPIRED">{{ t('designSystem.status.EXPIRED') }}</option>
                      <option value="REVOKED">{{ t('designSystem.status.REVOKED') }}</option>
                    </select>
                  </label>
                  <GcButton variant="secondary" @click="clearVersionFilters">{{ t('certificates.list.actions.clear') }}</GcButton>
                </div>
              </div>
            </template>
            <template #header-certificateName>
              <button class="certificate-page__header-sort" type="button" @click="toggleVersionSort('certificateName')">
                {{ t('certificates.detailPanel.summary.certificateName') }} {{ sortIndicator('certificateName') }}
              </button>
            </template>
            <template #header-notBefore>
              <button class="certificate-page__header-sort" type="button" @click="toggleVersionSort('notBefore')">
                {{ t('certificates.list.columns.notBefore') }} {{ sortIndicator('notBefore') }}
              </button>
            </template>
            <template #header-notAfter>
              <button class="certificate-page__header-sort" type="button" @click="toggleVersionSort('notAfter')">
                {{ t('certificates.list.columns.notAfter') }} {{ sortIndicator('notAfter') }}
              </button>
            </template>
            <template #header-issuer>
              <button class="certificate-page__header-sort" type="button" @click="toggleVersionSort('issuer')">
                {{ t('certificates.detailPanel.summary.issuer') }} {{ sortIndicator('issuer') }}
              </button>
            </template>
            <template #header-subject>
              <button class="certificate-page__header-sort" type="button" @click="toggleVersionSort('subject')">
                {{ t('certificates.detailPanel.summary.subject') }} {{ sortIndicator('subject') }}
              </button>
            </template>
            <template #header-status>
              <button class="certificate-page__header-sort" type="button" @click="toggleVersionSort('status')">
                {{ t('certificates.list.columns.status') }} {{ sortIndicator('status') }}
              </button>
            </template>
            <template #cell-certificateName="{ row }">
              <div class="certificate-page__cell-main">
                <strong>{{ row.certificateName }}</strong>
              </div>
            </template>
            <template #cell-status="{ row }">
              <GcStatusTag :status="row.lifecycleKey" :label="row.lifecycle" :tone="lifecycleStatusTone(row.lifecycleKey)" />
            </template>
            <template #cell-sourceType="{ row }">
              <GcStatusTag :status="row.sourceType" :label="row.sourceTypeLabel" :tone="row.sourceTypeTone" />
            </template>
            <template #cell-id="{ row }">
              <code class="certificate-page__version-id">{{ row.id }}</code>
            </template>
            <template #cell-actions="{ row }">
              <div class="certificate-page__row-actions">
                <GcButton variant="secondary" @click="openDetailDialog(row as CertificateVersionRow)">{{ t('agents.actions.detail') }}</GcButton>
                <GcConfirmAction
                  v-if="canDeleteVersion"
                  :action-name="t('agents.actions.delete')"
                  :impact-count="1"
                  :risk-text="t('certificates.list.actions.deleteRisk')"
                  confirm-text="DELETE"
                  @confirm="removeVersion(row as CertificateVersionRow)"
                />
              </div>
            </template>
          </GcDataTable>
        </div>
      </section>
    </GcModal>

    <GcModal
      v-model:open="detailDialogOpen"
      :title="t('certificates.detail.title')"
      :description="t('certificates.detail.description')"
      size="xxl"
    >
      <CertificateDetailPanel :asset-id="detailAssetId" :version-id="detailVersionId" />
    </GcModal>

    <GcModal
      v-model:open="importDialogOpen"
      :title="t('certificates.import.title')"
      :description="t('certificates.list.import.description')"
      size="xxl"
    >
      <CertificateImportForm
        :draft="draft"
        :loading="importLoading"
        :validating="importValidating"
        :error="importError"
        :result-id="importResultId"
        :validation-result="importValidationResult"
        @validate="validateImportDraft"
        @submit="submitImport"
        @cancel="closeImportDialog"
      />
    </GcModal>
  </section>
</template>

<style scoped>
.certificate-page__inline-success {
  display: grid;
  gap: var(--gc-space-1);
  padding: var(--gc-space-3) var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-success-border);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-success-soft);
  color: var(--gc-color-success);
}

.certificate-user-view {
  display: grid;
  gap: var(--gc-space-4);
}

.certificate-simple-view__section {
  display: grid;
  gap: var(--gc-space-5);
}

.certificate-simple-view__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--gc-space-4);
}

.certificate-simple-view__stat-card {
  display: flex;
  flex-direction: column;
  gap: var(--gc-space-3);
  padding: var(--gc-space-5);
  border-radius: var(--gc-radius-xl);
  background: var(--gc-color-surface-glass);
  border: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  transition: all 0.25s ease;
}

.certificate-simple-view__stat-card:hover {
  border-color: var(--gc-color-primary-border);
  transform: translateY(calc(-1 * var(--gc-space-1)));
  box-shadow: var(--gc-shadow-hover);
}

.certificate-simple-view__stat-card--warning {
  background: var(--gc-color-warning-soft);
  border-color: var(--gc-color-warning-border);
}

.certificate-simple-view__stat-card--danger {
  background: var(--gc-color-danger-soft);
  border-color: var(--gc-color-danger-border);
}

.certificate-simple-view__stat-label {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: 700;
}

.certificate-simple-view__stat-value {
  color: var(--gc-color-text);
  font-size: calc(var(--gc-font-size-2xl) + var(--gc-space-2));
  font-weight: 900;
  line-height: 1;
}

.certificate-simple-view__stat-card--warning .certificate-simple-view__stat-value {
  color: var(--gc-color-warning);
}

.certificate-simple-view__stat-card--danger .certificate-simple-view__stat-value {
  color: var(--gc-color-danger);
}

.certificate-simple-view__content {
  min-height: calc(var(--gc-space-10) * 10);
}

.certificate-simple-view__loading,
.certificate-simple-view__error {
  display: grid;
  place-items: center;
  min-height: calc(var(--gc-space-10) * 5);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
}

.certificate-simple-view__list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(calc(var(--gc-size-card-min) + var(--gc-space-10) * 4), 1fr));
  gap: var(--gc-space-4);
}

.certificate-simple-view__card {
  display: grid;
  gap: var(--gc-space-3);
  padding: var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  border-radius: var(--gc-radius-lg);
  background: var(--gc-color-surface-glass);
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.certificate-simple-view__card:hover {
  border-color: var(--gc-color-primary-border);
  background: var(--gc-color-surface-hover);
  transform: translateY(calc(-1 * var(--gc-space-1)));
  box-shadow: var(--gc-shadow-md);
}

.certificate-simple-view__card-header {
  display: grid;
  gap: var(--gc-space-2);
}

.certificate-simple-view__card-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-3);
}

.certificate-simple-view__card-title strong {
  flex: 1;
  min-width: 0;
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-md);
  font-weight: 750;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.certificate-simple-view__card-meta {
  color: var(--gc-color-text-soft);
  font-size: var(--gc-font-size-xs);
  font-weight: 650;
}

.certificate-simple-view__card-body {
  display: grid;
  gap: var(--gc-space-2);
  padding-top: var(--gc-space-2);
  border-top: var(--gc-border-width-default) solid var(--gc-color-border-subtle);
}

.certificate-simple-view__card-field {
  display: flex;
  justify-content: space-between;
  gap: var(--gc-space-3);
  align-items: baseline;
}

.certificate-simple-view__field-label {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 700;
}

.certificate-simple-view__field-value {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-sm);
  font-weight: 650;
  text-align: right;
}

.certificate-simple-view__app-header {
  padding: var(--gc-space-4);
  border-radius: var(--gc-radius-lg);
  background: var(--gc-color-surface-hover);
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
}

.certificate-simple-view__app-description {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  line-height: var(--gc-line-height-relaxed);
}

.certificate-simple-view__app-details {
  display: grid;
  gap: var(--gc-space-5);
}

.certificate-simple-view__selected-cert,
.certificate-simple-view__app-list,
.certificate-simple-view__automation-info {
  display: grid;
  gap: var(--gc-space-3);
  padding: var(--gc-space-5);
  border-radius: var(--gc-radius-lg);
  background: var(--gc-color-surface-solid);
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
}

.certificate-simple-view__selected-cert h3,
.certificate-simple-view__app-list h3,
.certificate-simple-view__automation-info h4 {
  margin: 0;
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-md);
  font-weight: 750;
}

.certificate-simple-view__cert-badge {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-3);
  padding: var(--gc-space-3);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-hover);
}

.certificate-simple-view__cert-badge strong {
  flex: 1;
  min-width: 0;
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-md);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.certificate-simple-view__empty-message {
  margin: 0;
  padding: var(--gc-space-4);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  text-align: center;
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-hover);
}

.certificate-simple-view__action-button {
  justify-self: start;
}

.certificate-simple-view__automation-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-3);
}

.certificate-simple-view__automation-stat {
  display: flex;
  flex-direction: column;
  gap: var(--gc-space-2);
  padding: var(--gc-space-3);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-hover);
}

.certificate-simple-view__automation-stat span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 700;
}

.certificate-simple-view__automation-stat strong {
  color: var(--gc-color-primary);
  font-size: var(--gc-font-size-xl);
  font-weight: 900;
  line-height: 1;
}

.certificate-simple-view__automation-description {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  line-height: var(--gc-line-height-relaxed);
}

@media (max-width: 48rem) {
  .certificate-simple-view__stats {
    grid-template-columns: 1fr;
  }

  .certificate-simple-view__list {
    grid-template-columns: 1fr;
  }

  .certificate-simple-view__automation-stats {
    grid-template-columns: 1fr;
  }
}

.certificate-page {
  display: flex;
  flex-direction: column;
  gap: var(--gc-space-5);
  flex: 1;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.certificate-page__header {
  flex: 0 0 auto;
}

.certificate-page__metrics {
  display: none;
}

.certificate-page__metric {
  display: grid;
  gap: var(--gc-space-2);
  min-height: var(--gc-space-12);
  border: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  border-radius: var(--gc-radius-card);
  padding: var(--gc-space-4);
  background: var(--gc-color-surface-panel);
  box-shadow: var(--gc-shadow-card);
}

.certificate-page__metric span,
.certificate-page__metric small {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 750;
}

.certificate-page__metric strong {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-2xl);
  line-height: var(--gc-line-height-tight);
}

.certificate-page__metric--warning {
  border-color: var(--gc-color-warning-border);
  background: var(--gc-color-warning-soft);
}

.certificate-page__metric--warning strong {
  color: var(--gc-color-warning);
}

.certificate-page__metric--danger {
  border-color: var(--gc-color-danger-border);
  background: var(--gc-color-danger-soft);
}

.certificate-page__metric--danger strong {
  color: var(--gc-color-danger);
}

.certificate-page__toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--gc-space-4);
  align-items: stretch;
}

.certificate-page__workspace-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-4);
  flex: 0 0 auto;
}

.certificate-page__workspace-view {
  display: inline-flex;
  align-items: center;
  gap: var(--gc-space-4);
  min-width: 0;
}

.certificate-page__toolbar-actions {
  flex: 0 1 auto;
}

.certificate-page__category-tabs,
.certificate-page__presentation-toggle {
  display: flex;
  align-items: center;
  gap: var(--gc-space-1);
  min-width: 0;
  padding: var(--gc-space-1);
  border: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  border-radius: var(--gc-radius-control);
  background: var(--gc-color-surface-muted);
}

.certificate-page__category-tabs {
  flex-wrap: wrap;
}

.certificate-page__category-tab {
  min-height: var(--gc-control-height-sm);
  padding: 0 var(--gc-space-3);
  border: 0;
  border-radius: var(--gc-radius-control);
  color: var(--gc-color-text-muted);
  background: transparent;
  font-size: var(--gc-font-size-xs);
  font-weight: var(--gc-font-weight-semibold);
  cursor: pointer;
}

.certificate-page__category-tab:hover,
.certificate-page__category-tab--active {
  color: var(--gc-color-primary);
  background: var(--gc-color-surface-solid);
  box-shadow: var(--gc-shadow-sm);
}

.certificate-page__category-tab:focus-visible,
.certificate-page__asset-record-trigger:focus-visible {
  outline: none;
  box-shadow: var(--gc-shadow-focus);
}

.certificate-page__presentation-toggle-button {
  width: var(--gc-control-height-sm);
  min-width: var(--gc-control-height-sm);
  min-height: var(--gc-control-height-sm);
  padding: 0;
  box-shadow: none;
}

.certificate-page__presentation-toggle-button svg,
.certificate-page__asset-card-icon svg {
  width: var(--gc-size-icon-md);
  height: var(--gc-size-icon-md);
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.certificate-page__presentation-toggle-button--active {
  color: var(--gc-color-primary);
  background: var(--gc-color-primary-bg);
  box-shadow: var(--gc-shadow-sm);
}

.certificate-page__filters {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) minmax(var(--gc-size-card-min), calc(var(--gc-size-card-min) + var(--gc-space-10))) auto;
  gap: var(--gc-space-2);
  align-items: center;
  padding: var(--gc-space-4);
  border-radius: var(--gc-radius-control);
  border: var(--gc-border-width-default) solid var(--gc-color-border-subtle);
  background: var(--gc-color-surface-glass);
  box-shadow: var(--gc-shadow-sm);
}

.certificate-page__filter {
  display: flex;
  align-items: center;
  gap: var(--gc-space-2);
  min-width: 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 600;
  letter-spacing: .01em;
}

.certificate-page__filter-label {
  flex: 0 0 auto;
  white-space: nowrap;
}

.certificate-page__filter input,
.certificate-page__filter select {
  flex: 1;
  width: auto;
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-card);
  min-height: var(--gc-space-8);
  padding: var(--gc-space-2) var(--gc-space-3);
  color: var(--gc-color-text);
  background: var(--gc-color-surface-glass);
}

.certificate-page__filter-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: var(--gc-space-2);
  min-height: var(--gc-space-8);
}

.certificate-page__workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--gc-space-4);
  align-items: start;
  min-width: 0;
}

.certificate-page__assets,
.certificate-page__versions {
  display: grid;
  gap: var(--gc-space-3);
  min-width: 0;
  background: transparent;
}

.certificate-page__panel-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--gc-space-3);
  padding: 0 0 var(--gc-space-3);
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border-subtle);
}

.certificate-page__panel-header h2,
.certificate-page__panel-header p {
  margin: 0;
}

.certificate-page__panel-header h2 {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-md);
  font-weight: 650;
  letter-spacing: 0;
}

.certificate-page__panel-header p,
.certificate-page__panel-header span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  line-height: 1.5;
}

.certificate-page__asset-card-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, var(--gc-size-certificate-card-min));
  gap: var(--gc-space-4);
  align-content: start;
  justify-content: start;
  min-width: 0;
}

.certificate-page__asset-record {
  display: grid;
  gap: var(--gc-space-3);
  width: var(--gc-size-certificate-card-min);
  min-width: 0;
  align-content: start;
}

.certificate-page__asset-card-list--list {
  display: block;
}

.certificate-page__asset-card {
  width: var(--gc-size-certificate-card-min);
  min-width: var(--gc-size-certificate-card-min);
  border-color: var(--gc-color-border-muted);
  transition: border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease;
}

.certificate-page__asset-card:hover {
  border-color: var(--gc-color-primary-border);
  box-shadow: var(--gc-shadow-hover);
  transform: translateY(calc(-1 * var(--gc-space-tight)));
}

.certificate-page__asset-card :deep(.gc-pro-card__header) {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  padding-bottom: 0;
  border-bottom: 0;
}

.certificate-page__asset-card-icon {
  display: grid;
  place-items: center;
  width: var(--gc-control-height-sm);
  height: var(--gc-control-height-sm);
  border-radius: var(--gc-radius-control);
  color: var(--gc-color-primary);
  background: var(--gc-color-primary-soft);
}

.certificate-page__asset-card :deep(.gc-pro-card__body) {
  display: grid;
  gap: var(--gc-space-3);
}

.certificate-page__asset-card-heading {
  display: grid;
  gap: var(--gc-space-1);
  min-width: 0;
}

.certificate-page__asset-record-trigger {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--gc-space-3);
  width: 100%;
  min-width: 0;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.certificate-page__panel-kicker {
  color: var(--gc-color-text-soft);
  font-size: var(--gc-font-size-overline);
  font-weight: var(--gc-font-weight-semibold);
  letter-spacing: .08em;
  text-transform: uppercase;
}

.certificate-page__asset-card-status {
  display: inline-flex;
  align-items: center;
  gap: var(--gc-space-2);
  flex: 0 0 auto;
}

.certificate-page__asset-card-heading strong,
.certificate-page__asset-card-heading span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.certificate-page__asset-card-heading strong {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-sm);
  font-weight: var(--gc-font-weight-semibold);
}

.certificate-page__asset-card-heading span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.certificate-page__asset-card-validity {
  display: grid;
  gap: var(--gc-space-2);
  padding: var(--gc-space-3);
  border-radius: var(--gc-radius-control);
  background: var(--gc-color-surface-muted);
}

.certificate-page__asset-card-validity-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--gc-space-2);
}

.certificate-page__asset-card-validity-header span {
  color: var(--gc-color-text-soft);
  font-size: var(--gc-font-size-overline);
  font-weight: var(--gc-font-weight-semibold);
}

.certificate-page__asset-card-validity-header strong {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-xs);
  font-weight: var(--gc-font-weight-semibold);
  text-align: right;
}

.certificate-page__asset-card--valid .certificate-page__asset-card-validity-header strong {
  color: var(--gc-color-success);
}

.certificate-page__asset-card--expiringSoon .certificate-page__asset-card-validity-header strong {
  color: var(--gc-color-warning);
}

.certificate-page__asset-card--expired .certificate-page__asset-card-validity-header strong {
  color: var(--gc-color-danger);
}

.certificate-page__asset-card-metadata {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  column-gap: var(--gc-space-5);
  row-gap: var(--gc-space-3);
  margin: 0;
}

.certificate-page__asset-card-metadata div {
  display: grid;
  gap: var(--gc-space-1);
  min-width: 0;
}

.certificate-page__asset-card-metadata dt {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: var(--gc-font-weight-semibold);
}

.certificate-page__asset-card-metadata dd {
  margin: 0;
  overflow: hidden;
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-xs);
  font-weight: var(--gc-font-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.certificate-page__asset-card-source-value {
  display: flex;
  align-items: center;
  min-height: var(--gc-control-height-sm);
}

.certificate-page__asset-table {
  min-width: 0;
}

.certificate-page__asset-table :deep(table) {
  min-width: calc(var(--gc-size-certificate-card-min) * 3.5);
  table-layout: fixed;
}

.certificate-page__asset-table :deep(th),
.certificate-page__asset-table :deep(td) {
  white-space: nowrap;
}

.certificate-page__asset-table :deep(td) {
  overflow: hidden;
  text-overflow: ellipsis;
}

.certificate-page__asset-table :deep(td:last-child) {
  overflow: visible;
  text-overflow: clip;
}

.certificate-page__asset-table-domain {
  display: grid;
  gap: var(--gc-space-1);
  width: 100%;
  min-width: 0;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.certificate-page__asset-table-domain strong,
.certificate-page__asset-table-domain span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.certificate-page__asset-table-domain strong {
  color: var(--gc-color-text-strong);
  font-weight: var(--gc-font-weight-semibold);
}

.certificate-page__asset-table-domain span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.certificate-page__asset-table-domain:focus-visible {
  outline: none;
  box-shadow: var(--gc-shadow-focus);
}

.certificate-page__asset-table-validity {
  display: grid;
  gap: var(--gc-space-2);
  min-width: 0;
}

.certificate-page__asset-table-validity strong {
  overflow: hidden;
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.certificate-page__state {
  padding: var(--gc-space-6) var(--gc-space-3);
  color: var(--gc-color-text-muted);
  text-align: center;
  font-size: var(--gc-font-size-xs);
  font-weight: 600;
}

.certificate-page__inline-error {
  display: grid;
  gap: var(--gc-space-1);
  padding: var(--gc-space-3) var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-danger-border);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-danger-soft);
  color: var(--gc-color-danger);
}

.certificate-page__versions-body {
  display: grid;
  gap: var(--gc-space-3);
  min-width: 0;
}

.certificate-page__versions {
  grid-template-rows: auto auto;
  padding: var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  border-radius: var(--gc-radius-control);
  background: var(--gc-color-surface-panel);
  box-shadow: var(--gc-shadow-card);
}

.certificate-page__versions--modal {
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.certificate-page__assets {
  grid-template-rows: auto auto;
}

.certificate-page__assets > .certificate-page__state,
.certificate-page__assets > .certificate-page__empty-state,
.certificate-page__versions-body > .certificate-page__state,
.certificate-page__versions-body > .certificate-page__empty-state {
  display: grid;
  flex: 1;
  align-content: center;
  justify-items: center;
  overflow: auto;
  min-height: 0;
}

.certificate-page__assets > .certificate-page__selection-empty-state {
  flex: 0;
  min-height: auto;
}

.certificate-page :deep(.certificate-page__empty-state) {
  border: 0;
  border-radius: 0;
  padding: var(--gc-space-6) var(--gc-space-3);
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
}

.certificate-page__versions :deep(.gc-button) {
  width: fit-content;
}

.certificate-page__version-table {
  min-height: 0;
  overflow: hidden;
}

.certificate-page__version-table :deep(table) {
  table-layout: fixed;
}

.certificate-page__table-toolbar {
  display: flex;
  justify-content: space-between;
  gap: var(--gc-space-4);
  align-items: flex-start;
  flex-wrap: wrap;
}

.certificate-page__table-heading {
  display: grid;
  gap: var(--gc-space-1);
  color: var(--gc-color-text-muted);
}

.certificate-page__table-heading strong {
  color: var(--gc-color-text);
}

.certificate-page__table-controls {
  display: flex;
  gap: var(--gc-space-3);
  align-items: end;
  flex-wrap: wrap;
}

.certificate-page__table-filter {
  display: grid;
  gap: var(--gc-space-1);
  min-width: var(--gc-size-card-min);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 600;
}

.certificate-page__table-filter input,
.certificate-page__table-filter select {
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-card);
  min-height: var(--gc-control-height-sm);
  padding: var(--gc-space-2) var(--gc-space-3);
  color: var(--gc-color-text);
  background: var(--gc-color-surface-solid);
}

.certificate-page__header-sort {
  display: inline-flex;
  align-items: center;
  gap: var(--gc-space-1);
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.certificate-page__header-sort:hover {
  color: var(--gc-color-text);
}

.certificate-page__cell-main,
.certificate-page__cell-stack {
  display: grid;
  gap: var(--gc-space-1);
  min-width: 0;
}

.certificate-page__version-table :deep(th),
.certificate-page__version-table :deep(td) {
  white-space: nowrap;
}

.certificate-page__version-table :deep(td) {
  overflow: hidden;
  text-overflow: ellipsis;
}

.certificate-page__version-table :deep(th:last-child),
.certificate-page__version-table :deep(td:last-child) {
  position: sticky;
  right: 0;
  z-index: 1;
  background: var(--gc-color-surface-solid);
  box-shadow: calc(-1 * var(--gc-space-2)) 0 var(--gc-space-3) var(--gc-color-surface-overlay);
}

.certificate-page__version-table :deep(th:last-child) {
  z-index: 2;
  background: var(--gc-color-surface-muted);
  box-shadow: calc(-1 * var(--gc-space-2)) 0 var(--gc-space-3) var(--gc-color-surface-subtle);
}

.certificate-page__version-table :deep(td:last-child) {
  overflow: visible;
  text-overflow: clip;
}

.certificate-page__cell-stack span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  overflow: hidden;
  text-overflow: ellipsis;
}

.certificate-page__cell-main strong,
.certificate-page__cell-stack strong {
  overflow: hidden;
  text-overflow: ellipsis;
}

.certificate-page__version-id {
  font-size: var(--gc-font-size-xs);
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: bottom;
}

.certificate-page__version-table :deep(td:last-child .gc-button) {
  min-width: calc(var(--gc-space-7) * 2);
}

.certificate-page__row-actions {
  display: flex;
  align-items: center;
  gap: var(--gc-space-2);
  min-width: max-content;
}

@media (max-width: 75rem) {
  .certificate-page__metrics {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .certificate-simple-view__stats {
    grid-template-columns: 1fr;
  }

  .certificate-page {
    height: auto;
    min-height: 0;
    overflow: visible;
  }

  .certificate-page__filters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .certificate-page__workspace {
    grid-template-columns: 1fr;
    overflow: visible;
  }

  .certificate-page__assets {
    padding-right: 0;
    padding-bottom: var(--gc-space-3);
    border-right: 0;
    border-bottom: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  }

  .certificate-page__versions {
    padding-top: var(--gc-space-3);
    padding-left: 0;
  }

  .certificate-page__assets,
  .certificate-page__versions,
  .certificate-page__versions-body,
  .certificate-page__asset-card-list {
    min-height: auto;
    overflow: visible;
  }
}

@media (max-width: 56.25rem) {
  .certificate-page__metrics {
    grid-template-columns: 1fr;
  }

  .certificate-simple-view__list {
    grid-template-columns: 1fr;
  }

  .certificate-simple-view__automation-stats {
    grid-template-columns: 1fr;
  }

  .certificate-page__filter-actions {
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .certificate-page__filter {
    display: grid;
    gap: var(--gc-space-1);
  }

  .certificate-page__filter input,
  .certificate-page__filter select {
    width: 100%;
  }

  .certificate-page__panel-header,
  .certificate-page__table-toolbar {
    flex-direction: column;
  }

}

@media (max-width: 40rem) {
  .certificate-page__filters {
    grid-template-columns: 1fr;
  }

  .certificate-page__table-controls {
    width: 100%;
  }

  .certificate-page__table-filter {
    min-width: 100%;
  }
}
</style>
