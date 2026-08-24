<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { ApiClientError } from '@/api/client'
import {
  deleteCertificateVersion,
  importCertificate,
  listCertificates,
  listCertificateVersions,
  validateCertificateImport,
} from '@/api/modules/certificates.api'
import type { ApiRecord } from '@/api/modules/common'
import {
  GcConfirmAction,
  GcDataTable,
  GcEmptyState,
  GcModal,
  GcPermissionButton,
} from '@/design-system/components'
import type { DataTableColumn } from '@/design-system/components/GcDataTable.vue'
import { usePermissionStore } from '@/stores/permission.store'
import CertificateDetailPanel from './CertificateDetailPanel.vue'
import CertificateImportForm from './CertificateImportForm.vue'
import {
  buildCertificateImportPayload,
  type CertificateImportValidationResult,
  createCertificateImportDraft,
  isMaterialReady,
  resetCertificateImportDraft,
} from './certificate-import.shared'
import { readString, toErrorState, type CertificatePageError } from './certificate-view-utils'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'

interface CertificateVersionRow extends Record<string, string> {
  readonly id: string
  readonly assetId: string
  readonly certificateName: string
  readonly associatedAsset: string
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
const EXPIRING_SOON_DAYS = 10

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
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
const selectedAssetId = ref('')
const versionFilterKeyword = ref('')
const versionFilterStatus = ref('')
const versionSortField = ref<VersionSortField>('notAfter')
const versionSortOrder = ref<VersionSortOrder>('asc')

const importDialogOpen = ref(false)
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
const selectedAsset = computed(() => displayedAssets.value.find((item) => readId(item) === selectedAssetId.value) ?? null)
const selectedDomainName = computed(() => (selectedAsset.value ? readAssetName(selectedAsset.value) : t('certificates.list.fallbacks.unselectedDomain')))
const selectedAssetMemberIds = computed(() => {
  if (!selectedAsset.value) return []
  return (assetDomainGroups.value.get(readAssetName(selectedAsset.value)) ?? [])
    .map((item) => readId(item))
    .filter(Boolean)
})
const assetCount = computed(() => displayedAssets.value.length)
const rawVersionRows = computed<CertificateVersionRow[]>(() =>
  versions.value.map((record, index) => {
    const id = readString(record, ['id', 'certificateVersionId'], `certver-${index + 1}`)
    const notBefore = formatDateOnly(readString(record, ['notBefore'], t('certificates.detailPanel.fallbacks.unknown')))
    const notAfter = formatDateOnly(readString(record, ['notAfter'], t('certificates.detailPanel.fallbacks.unknown')))
    const status = readString(record, ['status', 'state'], 'MANAGED')
    const lifecycleKey = resolveLifecycleStatusKey(notAfter, status)
    return {
      id,
      assetId: readString(record, ['certificateAssetId'], selectedAssetId.value || 'unknown-asset'),
      certificateName: readString(record, ['commonName', 'subject.commonName', 'name'], id),
      associatedAsset: selectedDomainName.value,
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
const versionColumns = computed<DataTableColumn<CertificateVersionRow>[]>(() => [
  { key: 'certificateName', title: t('certificates.detailPanel.summary.certificateName'), width: '12%' },
  { key: 'notBefore', title: t('certificates.list.columns.notBefore'), width: '10%' },
  { key: 'notAfter', title: t('certificates.list.columns.notAfter'), width: '10%' },
  { key: 'issuer', title: t('certificates.detailPanel.summary.issuer'), width: '16%' },
  { key: 'subject', title: t('certificates.detailPanel.summary.subject'), width: '12%' },
  { key: 'associatedAsset', title: t('certificates.list.columns.associatedAsset'), width: '12%' },
  { key: 'status', title: t('certificates.list.columns.status'), width: '8%' },
  { key: 'id', title: t('certificates.list.columns.certificateVersionId'), width: '12%' },
  { key: 'actions', title: t('agents.columns.actions'), width: '168px' },
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
      row.id,
    ].join('\n').toLowerCase()
    return haystack.includes(keyword)
  })
  return [...rows].sort(compareVersionRows)
})
const versionCount = computed(() => versionRows.value.length)
const canDeleteVersion = computed(() => permissionStore.hasPermission('certificate.lifecycle'))

const hasCertificateMaterial = computed(() => isMaterialReady(draft))

watch(selectedAssetId, async (assetId) => {
  if (!assetId) {
    versions.value = []
    versionsError.value = null
    return
  }
  await loadVersions(selectedAssetMemberIds.value)
})

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

onMounted(async () => {
  await loadAssets()
})

function readId(record: ApiRecord) {
  return readString(record, ['id', 'certificateId'], '')
}

function readAssetName(record: ApiRecord) {
  return readString(record, ['primaryDomain', 'name', 'commonName'], t('certificates.list.fallbacks.unnamedDomain'))
}

function readAssetSubtitle(record: ApiRecord) {
  return readString(record, ['sourceType', 'currentVersion.notAfter', 'updatedAt'], t('certificates.list.fallbacks.noSupplement'))
}

function formatDateOnly(value: string) {
  return formatBrowserLocalTime(value, { includeTime: false }) || value
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
    const nextSelectedId = displayedAssets.value.some((item) => readId(item) === selectedAssetId.value)
      ? selectedAssetId.value
      : readId(displayedAssets.value[0] as ApiRecord)
    selectedAssetId.value = nextSelectedId
  } catch (cause) {
    assetsError.value = toErrorState(cause)
    assets.value = []
    assetLifecycleMap.value = {}
    assetVersionCountMap.value = {}
    selectedAssetId.value = ''
  } finally {
    assetsLoading.value = false
  }
}

async function loadAssetLifecycleStatuses(records: ApiRecord[]) {
  const entries = await Promise.all(records.map(async (record) => {
    const assetId = readId(record)
    if (!assetId) return ['', { lifecycle: 'unknown' as const, total: 0 }] as const
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
        lifecycle: resolveLifecycleStatusKey(formatDateOnly(notAfter), readString(latest, ['status', 'state'], 'MANAGED')),
        total: Number(result.data?.total ?? 0),
      }] as const
    } catch {
      return [assetId, { lifecycle: readAssetLifecycleStatusKey(record), total: 0 }] as const
    }
  }))
  assetLifecycleMap.value = Object.fromEntries(entries.filter(([assetId]) => assetId).map(([assetId, state]) => [assetId, state.lifecycle]))
  assetVersionCountMap.value = Object.fromEntries(entries.filter(([assetId]) => assetId).map(([assetId, state]) => [assetId, state.total]))
}

async function loadVersions(assetIds: string[]) {
  if (assetIds.length === 0) {
    versions.value = []
    versionsError.value = null
    return
  }
  versionsLoading.value = true
  versionsError.value = null
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
    versions.value = [...merged.values()]
  } catch (cause) {
    versionsError.value = toErrorState(cause)
    versions.value = []
  } finally {
    versionsLoading.value = false
  }
}

function updateFilters() {
  const query = Object.fromEntries(Object.entries(filters).filter(([, value]) => value))
  void router.replace({ path: '/certificates', query })
  void loadAssets()
}

function clearFilters() {
  filters.keyword = ''
  filters.primaryDomain = ''
  filters.status = ''
  updateFilters()
}

function selectAsset(assetId: string) {
  if (!assetId || assetId === selectedAssetId.value) return
  selectedAssetId.value = assetId
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
  const expiry = readString(record, ['currentVersion.notAfter', 'expiresAt', 'notAfter'], '')
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

function selectRepresentativeAsset(records: ApiRecord[]) {
  return [...records].sort(compareAssetRecords)[0]
}

function compareAssetRecords(left: ApiRecord, right: ApiRecord) {
  const leftId = readId(left)
  const rightId = readId(right)
  const countDiff = (assetVersionCountMap.value[rightId] ?? 0) - (assetVersionCountMap.value[leftId] ?? 0)
  if (countDiff !== 0) return countDiff
  const leftTime = Date.parse(readString(left, ['currentVersion.notAfter', 'updatedAt'], ''))
  const rightTime = Date.parse(readString(right, ['currentVersion.notAfter', 'updatedAt'], ''))
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
  deletingVersionId.value = row.id
  versionActionError.value = null
  try {
    await deleteCertificateVersion(row.id)
    if (detailDialogOpen.value && detailVersionId.value === row.id) {
      detailDialogOpen.value = false
      detailVersionId.value = ''
      detailAssetId.value = ''
    }
    if (selectedAssetId.value) {
      await loadVersions(selectedAssetMemberIds.value)
    }
    await loadAssets()
  } catch (cause) {
    versionActionError.value = toErrorState(cause)
  } finally {
    deletingVersionId.value = ''
  }
}
</script>

<template>
  <section class="gc-page certificate-page">
    <section class="certificate-page__toolbar">
      <section class="gc-card certificate-page__filters">
        <label class="certificate-page__filter">
          <span class="certificate-page__filter-label">{{ t('certificates.list.filters.keyword') }}</span>
          <input v-model="filters.keyword" :placeholder="t('certificates.list.placeholders.assetKeyword')" @change="updateFilters" />
        </label>
        <label class="certificate-page__filter">
          <span class="certificate-page__filter-label">{{ t('certificates.list.filters.domain') }}</span>
          <input v-model="filters.primaryDomain" placeholder="example.com" @change="updateFilters" />
        </label>
        <label class="certificate-page__filter">
          <span class="certificate-page__filter-label">{{ t('certificates.list.filters.status') }}</span>
          <select v-model="filters.status" @change="updateFilters">
            <option value="">{{ t('businessPage.all') }}</option>
            <option value="MANAGED">MANAGED</option>
            <option value="EXPIRED">EXPIRED</option>
            <option value="REVOKED">REVOKED</option>
          </select>
        </label>
        <div class="certificate-page__filter-actions">
          <button class="gc-button" type="button" @click="clearFilters">{{ t('businessPage.clearFilters') }}</button>
        </div>
      </section>

      <div class="certificate-page__toolbar-actions">
        <GcPermissionButton class="certificate-page__import-button" permission="certificate.import" @click="openImportDialog">
          {{ t('certificates.import.title') }}
        </GcPermissionButton>
      </div>
    </section>

    <section class="certificate-page__workspace">
      <aside class="certificate-page__assets">
        <header class="certificate-page__panel-header">
          <div>
            <h2>{{ t('certificates.list.assets.title') }}</h2>
          </div>
          <span>{{ t('businessPage.total', { count: assetCount }) }}</span>
        </header>

        <GcEmptyState v-if="assetsError" class="certificate-page__empty-state" :title="t('certificates.list.assets.loadFailed')" :description="assetsError.message">
          <p>{{ t('businessPage.errorCode', { code: assetsError.errorCode }) }}</p>
          <button class="gc-button" type="button" @click="loadAssets">{{ t('businessPage.retry') }}</button>
        </GcEmptyState>

        <div v-else-if="assetsLoading" class="certificate-page__state">{{ t('certificates.detailPanel.states.loading') }}</div>

        <GcEmptyState v-else-if="displayedAssets.length === 0" class="certificate-page__empty-state" :title="t('certificates.list.assets.empty')" />

        <div v-else class="certificate-page__asset-list">
          <button
            v-for="asset in displayedAssets"
            :key="readId(asset)"
            class="certificate-page__asset-item"
            :class="{ 'certificate-page__asset-item--active': readId(asset) === selectedAssetId }"
            type="button"
            @click="selectAsset(readId(asset))"
          >
            <div class="certificate-page__asset-main">
              <strong>{{ readAssetName(asset) }}</strong>
              <span>{{ readAssetSubtitle(asset) }}</span>
            </div>
            <div class="certificate-page__asset-side">
              <span class="certificate-page__lifecycle">{{ readAssetLifecycleStatus(asset) }}</span>
            </div>
          </button>
        </div>
      </aside>

      <section class="certificate-page__versions">
        <header class="certificate-page__panel-header">
          <div>
            <h2>{{ selectedAsset ? t('certificates.list.versions.titleWithDomain', { domain: selectedDomainName }) : t('certificates.list.versions.title') }}</h2>
            <p>{{ t('certificates.list.versions.description') }}</p>
          </div>
        </header>

        <div class="certificate-page__versions-body">
          <div v-if="versionActionError" class="certificate-page__inline-error" role="alert">
            <strong>{{ t('certificates.list.errors.deleteFailed') }}</strong>
            <span>{{ versionActionError.message }}</span>
            <span v-if="versionActionError.errorCode">{{ t('businessPage.errorCode', { code: versionActionError.errorCode }) }}</span>
          </div>
          <GcEmptyState v-if="versionsError" class="certificate-page__empty-state" :title="t('certificates.list.versions.loadFailed')" :description="versionsError.message">
            <p>{{ t('businessPage.errorCode', { code: versionsError.errorCode }) }}</p>
            <button class="gc-button" type="button" @click="selectedAssetId && loadVersions(selectedAssetMemberIds)">{{ t('businessPage.retry') }}</button>
          </GcEmptyState>

          <div v-else-if="versionsLoading" class="certificate-page__state">{{ t('certificates.detailPanel.states.loading') }}</div>

          <GcEmptyState
            v-else-if="!selectedAsset"
            class="certificate-page__empty-state"
            :title="t('certificates.list.assets.unselectedTitle')"
            :description="t('certificates.list.assets.unselectedDescription')"
          />

          <GcEmptyState
            v-else-if="versionRows.length === 0"
            class="certificate-page__empty-state"
            :title="t('certificates.list.versions.emptyForDomain')"
            :description="t('certificates.list.versions.emptyForDomainDescription')"
          />

          <GcDataTable v-else class="certificate-page__version-table" :columns="versionColumns" :rows="versionRows" :empty-text="t('certificates.list.versions.empty')">
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
                      <option value="MANAGED">MANAGED</option>
                      <option value="EXPIRED">EXPIRED</option>
                      <option value="REVOKED">REVOKED</option>
                    </select>
                  </label>
                  <button class="gc-button" type="button" @click="clearVersionFilters">{{ t('certificates.list.actions.clear') }}</button>
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
              <span class="certificate-page__lifecycle">{{ row.lifecycle }}</span>
            </template>
            <template #cell-id="{ row }">
              <code class="certificate-page__version-id">{{ row.id }}</code>
            </template>
            <template #cell-actions="{ row }">
              <div class="certificate-page__row-actions">
                <button class="gc-button" type="button" @click="openDetailDialog(row as CertificateVersionRow)">{{ t('agents.actions.detail') }}</button>
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
    </section>

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
.certificate-page {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.certificate-page__toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: stretch;
}

.certificate-page__filters {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) minmax(180px, 220px) auto;
  gap: 8px;
  align-items: center;
  padding: 0;
  border-radius: 16px;
}

.certificate-page__filter {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--gc-color-text-muted);
  font-size: 12px;
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
  border: 1px solid var(--gc-color-border);
  border-radius: 12px;
  min-height: 32px;
  padding: 6px 10px;
  color: var(--gc-color-text);
  background: var(--gc-color-surface-glass);
}

.certificate-page__filter-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  min-height: 32px;
}

.certificate-page__toolbar-actions {
  display: flex;
  align-items: stretch;
}

.certificate-page__import-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  padding: 0 18px;
  border: 0;
  border-radius: 16px;
  color: var(--gc-color-surface-solid);
  background: linear-gradient(180deg, var(--gc-color-primary), var(--gc-color-primary-hover));
  box-shadow: 0 10px 24px var(--gc-color-primary-weak);
  font-weight: 700;
  white-space: nowrap;
}

.certificate-page__import-button:hover {
  background: linear-gradient(180deg, var(--gc-color-primary), var(--gc-color-primary-hover));
}

.certificate-page__import-button:focus-visible {
  outline: 2px solid var(--gc-color-primary-border);
  outline-offset: 2px;
}

.certificate-page__workspace {
  display: grid;
  grid-template-columns: minmax(220px, 260px) minmax(0, 1fr);
  gap: 0;
  align-items: stretch;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.certificate-page__assets,
.certificate-page__versions {
  display: grid;
  gap: 12px;
  min-height: 0;
  overflow: hidden;
  background: transparent;
}

.certificate-page__panel-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
  padding: 4px 0 10px;
  border-bottom: 1px solid var(--gc-color-border-subtle);
}

.certificate-page__panel-header h2,
.certificate-page__panel-header p {
  margin: 0;
}

.certificate-page__panel-header h2 {
  color: var(--gc-color-text);
  font-size: 17px;
  font-weight: 650;
  letter-spacing: -0.04em;
}

.certificate-page__panel-header p,
.certificate-page__panel-header span {
  color: var(--gc-color-text-muted);
  font-size: 11px;
  line-height: 1.5;
}

.certificate-page__asset-list {
  display: grid;
  gap: 6px;
  align-content: start;
  min-height: 0;
  overflow: auto;
  padding-right: 10px;
}

.certificate-page__asset-item {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  border: 1px solid transparent;
  border-radius: 12px;
  padding: 10px 11px;
  background: var(--gc-color-surface-soft);
  text-align: left;
  cursor: pointer;
  transition: border-color .16s ease, background .16s ease, box-shadow .16s ease;
}

.certificate-page__asset-item:hover {
  border-color: var(--gc-color-border-soft);
  background: var(--gc-color-surface-muted);
  box-shadow: 0 4px 14px var(--gc-color-border-subtle);
}

.certificate-page__asset-item--active {
  border-color: var(--gc-color-primary-border);
  box-shadow: inset 0 0 0 1px var(--gc-color-primary-weak);
  background: linear-gradient(180deg, var(--gc-color-surface-panel), var(--gc-color-surface-selected));
}

.certificate-page__asset-main {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.certificate-page__asset-main strong {
  color: var(--gc-color-text);
  font-size: 13px;
  font-weight: 650;
  overflow-wrap: anywhere;
}

.certificate-page__asset-main span {
  color: var(--gc-color-text-muted);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.certificate-page__asset-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}

.certificate-page__lifecycle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 24px;
  padding: 0 10px;
  border: 1px solid var(--gc-color-border-soft);
  border-radius: 999px;
  background: var(--gc-color-surface-glass);
  color: var(--gc-color-text-muted);
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}

.certificate-page__state {
  padding: 24px 12px;
  color: var(--gc-color-text-muted);
  text-align: center;
  font-size: 12px;
  font-weight: 600;
}

.certificate-page__inline-error {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--gc-color-danger-border);
  border-radius: 14px;
  background: var(--gc-color-danger-soft);
  color: var(--gc-color-danger);
}

.certificate-page__versions-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow: hidden;
}

.certificate-page__versions {
  min-width: 0;
  grid-template-rows: auto minmax(0, 1fr);
  padding-left: 20px;
}

.certificate-page__assets {
  grid-template-rows: auto minmax(0, 1fr);
  padding-right: 18px;
  border-right: 1px solid var(--gc-color-border-soft);
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

.certificate-page :deep(.certificate-page__empty-state) {
  border: 0;
  border-radius: 0;
  padding: 24px 12px;
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
  gap: 16px;
  align-items: flex-start;
  flex-wrap: wrap;
}

.certificate-page__table-heading {
  display: grid;
  gap: 4px;
  color: var(--gc-color-text-muted);
}

.certificate-page__table-heading strong {
  color: var(--gc-color-text);
}

.certificate-page__table-controls {
  display: flex;
  gap: 10px;
  align-items: end;
  flex-wrap: wrap;
}

.certificate-page__table-filter {
  display: grid;
  gap: 4px;
  min-width: 180px;
  color: var(--gc-color-text-muted);
  font-size: 12px;
  font-weight: 600;
}

.certificate-page__table-filter input,
.certificate-page__table-filter select {
  border: 1px solid var(--gc-color-border);
  border-radius: 12px;
  min-height: 34px;
  padding: 6px 10px;
  color: var(--gc-color-text);
  background: var(--gc-color-surface-solid);
}

.certificate-page__header-sort {
  display: inline-flex;
  align-items: center;
  gap: 4px;
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
  gap: 4px;
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
  box-shadow: -8px 0 12px var(--gc-color-surface-overlay);
}

.certificate-page__version-table :deep(th:last-child) {
  z-index: 2;
  background: var(--gc-color-surface-muted);
  box-shadow: -8px 0 12px var(--gc-color-surface-subtle);
}

.certificate-page__version-table :deep(td:last-child) {
  overflow: visible;
  text-overflow: clip;
}

.certificate-page__cell-stack span {
  color: var(--gc-color-text-muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.certificate-page__cell-main strong,
.certificate-page__cell-stack strong {
  overflow: hidden;
  text-overflow: ellipsis;
}

.certificate-page__version-id {
  font-size: 12px;
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: bottom;
}

.certificate-page__version-table :deep(td:last-child .gc-button) {
  min-width: 56px;
}

.certificate-page__row-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: max-content;
}

@media (max-width: 1200px) {
  .certificate-page {
    height: auto;
    min-height: 0;
    overflow: visible;
  }

  .certificate-page__toolbar {
    grid-template-columns: 1fr;
  }

  .certificate-page__filters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .certificate-page__toolbar-actions {
    justify-content: flex-end;
  }

  .certificate-page__workspace {
    grid-template-columns: 1fr;
    overflow: visible;
  }

  .certificate-page__assets {
    padding-right: 0;
    padding-bottom: 12px;
    border-right: 0;
    border-bottom: 1px solid var(--gc-color-border-soft);
  }

  .certificate-page__versions {
    padding-top: 12px;
    padding-left: 0;
  }

  .certificate-page__assets,
  .certificate-page__versions,
  .certificate-page__versions-body,
  .certificate-page__asset-list {
    min-height: auto;
    overflow: visible;
  }
}

@media (max-width: 900px) {
  .certificate-page__filter-actions {
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .certificate-page__filter {
    display: grid;
    gap: 4px;
  }

  .certificate-page__filter input,
  .certificate-page__filter select {
    width: 100%;
  }

  .certificate-page__toolbar-actions {
    justify-content: stretch;
  }

  .certificate-page__import-button {
    width: 100%;
    min-height: 44px;
  }

  .certificate-page__panel-header,
  .certificate-page__table-toolbar {
    flex-direction: column;
  }

  .certificate-page__asset-side {
    align-items: flex-start;
  }
}

@media (max-width: 640px) {
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
