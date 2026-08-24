<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getCertificateTrustRootDetail, getCertificateVersionDetail, listCertificateTrustRoots } from '@/api/modules/certificates.api'
import type { ApiRecord } from '@/api/modules/common'
import { GcEmptyState, GcStatusTag } from '@/design-system/components'
import type { StatusTone } from '@/design-system/status/status-map'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import { readString, toErrorState, type CertificatePageError } from './certificate-view-utils'

const props = defineProps<{
  open: boolean
}>()

const { t } = useI18n()

const loading = ref(false)
const detailLoading = ref(false)
const listError = ref<CertificatePageError | null>(null)
const detailError = ref<CertificatePageError | null>(null)
const assetError = ref<CertificatePageError | null>(null)
const roots = ref<ApiRecord[]>([])
const managedSummary = ref<ApiRecord | null>(null)
const selectedRootKey = ref('')
const selectedRootDetail = ref<ApiRecord | null>(null)
const relatedAssetGroups = ref<RelatedAssetGroup[]>([])
const expandedAssetIds = ref<string[]>([])
const managedRootItems = computed(() => readRecords(managedSummary.value?.items))
const rootGroups = computed<RootGroup[]>(() => buildRootGroups(roots.value, managedRootItems.value))
const selectedRootGroup = computed(() =>
  rootGroups.value.find((item) => item.key === selectedRootKey.value) ?? null,
)
const observations = computed<ApiRecord[]>(() => {
  const value = selectedRootDetail.value?.observations
  return Array.isArray(value) ? value.filter((item): item is ApiRecord => Boolean(item) && typeof item === 'object') : []
})
const managedTotal = computed(() => rootGroups.value.length)
const managedResolved = computed(() => rootGroups.value.filter((group) => rootGroupStatus(group) === 'resolved').length)
const managedMissing = computed(() => rootGroups.value.filter((group) => rootGroupStatus(group) === 'missing').length)
const managedInvalidChain = computed(() => rootGroups.value.filter((group) => rootGroupStatus(group) === 'invalid_chain').length)
const relatedAssets = computed(() => relatedAssetGroups.value)

watch(
  () => props.open,
  (open) => {
    if (open) {
      void loadRoots()
      return
    }
    selectedRootDetail.value = null
    relatedAssetGroups.value = []
    expandedAssetIds.value = []
    detailError.value = null
    assetError.value = null
  },
  { immediate: true },
)

async function loadRoots() {
  loading.value = true
  listError.value = null
  detailError.value = null
  assetError.value = null
  selectedRootDetail.value = null
  relatedAssetGroups.value = []
  expandedAssetIds.value = []
  try {
    const result = await listCertificateTrustRoots({
      page: 1,
      pageSize: 100,
      sort: 'updatedAt:desc',
    })
    roots.value = [...(result.data?.items ?? [])]
    managedSummary.value = readRecord((result.data as unknown as ApiRecord | undefined)?.managedSummary)
    const nextKey = rootGroups.value.some((item) => item.key === selectedRootKey.value)
      ? selectedRootKey.value
      : rootGroups.value[0]?.key ?? ''
    selectedRootKey.value = nextKey
    if (nextKey) {
      await loadRootDetail(nextKey)
      return
    }
  } catch (cause) {
    listError.value = toErrorState(cause)
    roots.value = []
    managedSummary.value = null
    selectedRootKey.value = ''
    selectedRootDetail.value = null
    relatedAssetGroups.value = []
    assetError.value = null
  } finally {
    loading.value = false
  }
}

async function loadRootDetail(rootKey: string) {
  const group = rootGroups.value.find((item) => item.key === rootKey)
  if (!group) {
    selectedRootDetail.value = null
    relatedAssetGroups.value = []
    expandedAssetIds.value = []
    detailError.value = null
    return
  }
  detailLoading.value = true
  detailError.value = null
  assetError.value = null
  selectedRootDetail.value = null
  relatedAssetGroups.value = []
  expandedAssetIds.value = []
  try {
    const detailPromise = group.rootRecordId
      ? getCertificateTrustRootDetail(group.rootRecordId)
      : Promise.resolve({ data: null })
    const [detailResult, assetResult] = await Promise.allSettled([
      detailPromise,
      buildRelatedAssetGroups(group.managedItems),
    ])
    if (detailResult.status === 'fulfilled') {
      selectedRootDetail.value = detailResult.value.data ?? null
    } else {
      detailError.value = toErrorState(detailResult.reason)
    }
    if (assetResult.status === 'fulfilled') {
      relatedAssetGroups.value = assetResult.value
    } else {
      assetError.value = toErrorState(assetResult.reason)
    }
  } catch (cause) {
    detailError.value = toErrorState(cause)
  } finally {
    detailLoading.value = false
  }
}

function selectRoot(rootKey: string) {
  if (!rootKey || rootKey === selectedRootKey.value) return
  selectedRootKey.value = rootKey
  void loadRootDetail(rootKey)
}

function formatDateTime(value: string) {
  return formatBrowserLocalTime(value) || value || '—'
}

function formatDn(record: ApiRecord | null | undefined, key: 'subject' | 'issuer') {
  return readString(record, [`${key}.commonName`, `${key}.organization`, `${key}.raw`], '—')
}

function rootValidationTone(status: string): StatusTone {
  switch (status) {
    case 'verified':
      return 'success'
    case 'expired':
      return 'warning'
    case 'rejected':
      return 'danger'
    default:
      return 'muted'
  }
}

function observationTone(status: string): StatusTone {
  switch (status) {
    case 'accepted':
      return 'success'
    case 'failed':
    case 'rejected':
      return 'danger'
    case 'candidate':
      return 'warning'
    default:
      return 'muted'
  }
}

function managedRootTone(status: string): StatusTone {
  switch (status) {
    case 'resolved':
      return 'success'
    case 'missing':
      return 'danger'
    default:
      return 'warning'
  }
}

async function buildRelatedAssetGroups(items: ApiRecord[]): Promise<RelatedAssetGroup[]> {
  if (items.length === 0) return []
  const versionDetails = new Map<string, ApiRecord>()
  const versionIds = [...new Set(items.map((item) => readString(item, ['certificateVersionId'], '')).filter(Boolean))]
  const results = await Promise.allSettled(versionIds.map(async (versionId) => {
    const result = await getCertificateVersionDetail(versionId)
    return [versionId, readRecord(result.data)] as const
  }))
  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    const [versionId, detail] = result.value
    if (detail) versionDetails.set(versionId, detail)
  }

  const grouped = new Map<string, RelatedAssetGroup>()
  for (const item of items) {
    const versionId = readString(item, ['certificateVersionId'], '')
    const versionDetail = versionDetails.get(versionId)
    const version = versionDetail ?? {
      id: versionId,
      commonName: readString(item, ['certificateName', 'fingerprintSha256']),
      fingerprintSha256: readString(item, ['fingerprintSha256']),
    }
    const asset = versionDetail ? readRecord(versionDetail.asset) : null
    const assetId = readString(asset ?? item, ['id', 'certificateAssetId'], '')
    if (!assetId) continue
    const resolvedAsset = asset ?? {
      id: assetId,
      name: readString(item, ['certificateName', 'certificateAssetId'], assetId),
      primaryDomain: readString(item, ['certificateName'], ''),
    }
    const relation = { ...item }
    const relatedVersion = { relation, version, asset: resolvedAsset }
    const current = grouped.get(assetId)
    if (current) {
      current.versions.push(relatedVersion)
      continue
    }
    grouped.set(assetId, {
      asset: resolvedAsset,
      versions: [relatedVersion],
    })
  }
  return [...grouped.values()].sort((left, right) => compareAssetGroups(left, right))
}

function readNumber(record: ApiRecord | null | undefined, key: string): number {
  const value = record?.[key]
  return typeof value === 'number' ? value : Number(value ?? 0)
}

function readRecord(value: unknown): ApiRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ApiRecord : null
}

function compareAssetGroups(left: RelatedAssetGroup, right: RelatedAssetGroup): number {
  const leftName = readString(left.asset, ['name', 'primaryDomain', 'id'], '')
  const rightName = readString(right.asset, ['name', 'primaryDomain', 'id'], '')
  return leftName.localeCompare(rightName)
}

function rootGroupName(group: RootGroup): string {
  return formatDn(group.rootRecord, 'subject') !== '—'
    ? formatDn(group.rootRecord, 'subject')
    : group.fingerprintSha256 || t('certificates.trustRoots.summary.rootFingerprintUnavailable')
}

function rootAssetCount(group: RootGroup): number {
  return new Set(group.managedItems.map((item) => readString(item, ['certificateAssetId'], '')).filter(Boolean)).size
}

function assetVersionCount(group: RelatedAssetGroup): number {
  return group.versions.length
}

function assetGroupId(group: RelatedAssetGroup): string {
  return readString(group.asset, ['id'], '')
}

function isAssetExpanded(group: RelatedAssetGroup): boolean {
  return expandedAssetIds.value.includes(assetGroupId(group))
}

function toggleAssetExpanded(group: RelatedAssetGroup) {
  const assetId = assetGroupId(group)
  if (!assetId) return
  if (expandedAssetIds.value.includes(assetId)) {
    expandedAssetIds.value = expandedAssetIds.value.filter((item) => item !== assetId)
    return
  }
  expandedAssetIds.value = [...expandedAssetIds.value, assetId]
}

function readRecords(value: unknown): ApiRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is ApiRecord => Boolean(item) && typeof item === 'object')
    : []
}

function buildRootGroups(rootRecords: ApiRecord[], managedItems: ApiRecord[]): RootGroup[] {
  const groups = new Map<string, RootGroup>()
  for (const root of rootRecords) {
    const fingerprint = readString(root, ['fingerprintSha256'], '')
    const rootId = readString(root, ['id'], '')
    const key = fingerprint || rootId
    if (!key) continue
    groups.set(key, {
      key,
      fingerprintSha256: fingerprint,
      rootRecord: root,
      rootRecordId: rootId,
      managedItems: [],
      resolvedCount: 0,
      missingCount: 0,
      invalidCount: 0,
    })
  }
  for (const item of managedItems) {
    const fingerprint = readString(item, ['rootFingerprintSha256'], '')
    const rootId = readString(item, ['rootCertificateId'], '')
    const key = fingerprint || rootId || `unknown:${readString(item, ['certificateVersionId'], '')}`
    if (!key) continue
    const current = groups.get(key) ?? {
      key,
      fingerprintSha256: fingerprint,
      rootRecord: rootRecords.find((root) =>
        readString(root, ['id'], '') === rootId
        || readString(root, ['fingerprintSha256'], '') === fingerprint,
      ) ?? null,
      rootRecordId: rootId,
      managedItems: [],
      resolvedCount: 0,
      missingCount: 0,
      invalidCount: 0,
    }
    if (!current.rootRecordId && current.rootRecord) {
      current.rootRecordId = readString(current.rootRecord, ['id'], '')
    }
    current.managedItems.push(item)
    switch (readString(item, ['rootStatus'], 'missing')) {
      case 'resolved':
        current.resolvedCount += 1
        break
      case 'invalid_chain':
        current.invalidCount += 1
        break
      default:
        current.missingCount += 1
        break
    }
    groups.set(key, current)
  }
  return [...groups.values()].sort((left, right) => {
    const leftName = readString(left.rootRecord, ['subject.commonName', 'subject.organization', 'fingerprintSha256', 'id'], left.key)
    const rightName = readString(right.rootRecord, ['subject.commonName', 'subject.organization', 'fingerprintSha256', 'id'], right.key)
    return leftName.localeCompare(rightName)
  })
}

function rootGroupStatus(group: RootGroup): string {
  if (group.resolvedCount > 0 || group.rootRecordId) return 'resolved'
  if (group.missingCount > 0) return 'missing'
  return 'invalid_chain'
}

interface RelatedAssetGroup {
  asset: ApiRecord
  versions: Array<{
    relation: ApiRecord
    version: ApiRecord
    asset: ApiRecord
  }>
}

interface RootGroup {
  key: string
  fingerprintSha256: string
  rootRecord: ApiRecord | null
  rootRecordId: string
  managedItems: ApiRecord[]
  resolvedCount: number
  missingCount: number
  invalidCount: number
}
</script>

<template>
  <section class="trust-roots-modal">
    <header class="trust-roots-modal__toolbar">
      <div>
        <strong>{{ t('certificates.trustRoots.toolbar.title') }}</strong>
        <p>{{ t('certificates.trustRoots.toolbar.description', { count: rootGroups.length }) }}</p>
      </div>
      <button class="gc-button" type="button" :disabled="loading" @click="loadRoots">
        {{ t('certificates.trustRoots.actions.refresh') }}
      </button>
    </header>

    <GcEmptyState
      v-if="listError"
      class="trust-roots-modal__empty"
      :title="t('certificates.trustRoots.states.loadFailed')"
      :description="listError.message"
    >
      <p>{{ t('businessPage.errorCode', { code: listError.errorCode }) }}</p>
    </GcEmptyState>

    <div v-else-if="loading" class="trust-roots-modal__state">{{ t('certificates.detailPanel.states.loading') }}</div>

    <template v-else>
      <section v-if="managedTotal > 0" class="trust-roots-modal__summary">
        <div class="trust-roots-modal__summary-card">
          <strong>{{ managedTotal }}</strong>
          <span>{{ t('certificates.trustRoots.summary.managedVersions') }}</span>
        </div>
        <div class="trust-roots-modal__summary-card trust-roots-modal__summary-card--success">
          <strong>{{ managedResolved }}</strong>
          <span>{{ t('certificates.trustRoots.summary.resolvedVersions') }}</span>
        </div>
        <div class="trust-roots-modal__summary-card trust-roots-modal__summary-card--danger">
          <strong>{{ managedMissing }}</strong>
          <span>{{ t('certificates.trustRoots.summary.missingVersions') }}</span>
        </div>
        <div class="trust-roots-modal__summary-card trust-roots-modal__summary-card--warning">
          <strong>{{ managedInvalidChain }}</strong>
          <span>{{ t('certificates.trustRoots.summary.invalidChainVersions') }}</span>
        </div>
      </section>
      <GcEmptyState
        v-if="rootGroups.length === 0"
        class="trust-roots-modal__empty"
        :title="t('certificates.trustRoots.states.emptyTitle')"
        :description="t('certificates.trustRoots.states.emptyDescription')"
      />

      <div v-else class="trust-roots-modal__workspace">
        <aside class="trust-roots-modal__list">
          <button
            v-for="root in rootGroups"
            :key="root.key"
            class="trust-roots-modal__item"
            :class="{ 'trust-roots-modal__item--active': root.key === selectedRootKey }"
            type="button"
            @click="selectRoot(root.key)"
          >
            <div class="trust-roots-modal__item-main">
              <strong>{{ rootGroupName(root) }}</strong>
              <code>{{ root.fingerprintSha256 || t('certificates.trustRoots.summary.rootFingerprintUnavailable') }}</code>
              <span>
                {{ t('certificates.trustRoots.summary.relatedAssetCount', { count: rootAssetCount(root) }) }}
              </span>
            </div>
            <GcStatusTag
              :status="rootGroupStatus(root)"
              :label="t(`certificates.trustRoots.rootStatus.${rootGroupStatus(root)}`)"
              :tone="managedRootTone(rootGroupStatus(root))"
            />
          </button>
        </aside>

        <section class="trust-roots-modal__detail">
          <div v-if="detailError" class="trust-roots-modal__inline-error" role="alert">
            <strong>{{ t('certificates.trustRoots.states.detailFailed') }}</strong>
            <span>{{ detailError.message }}</span>
            <span>{{ t('businessPage.errorCode', { code: detailError.errorCode }) }}</span>
          </div>

          <div v-else-if="detailLoading" class="trust-roots-modal__state">{{ t('certificates.detailPanel.states.loading') }}</div>

          <GcEmptyState
            v-else-if="!selectedRootGroup"
            class="trust-roots-modal__empty"
            :title="t('certificates.trustRoots.states.unselectedTitle')"
            :description="t('certificates.trustRoots.states.unselectedDescription')"
          />

          <div v-else class="trust-roots-modal__detail-body">
            <header class="trust-roots-modal__detail-header">
              <div>
                <h3>{{ rootGroupName(selectedRootGroup) }}</h3>
                <p>{{ t('certificates.trustRoots.detail.subtitle') }}</p>
              </div>
              <div class="trust-roots-modal__status-group">
                <GcStatusTag
                  :status="rootGroupStatus(selectedRootGroup)"
                  :label="t(`certificates.trustRoots.rootStatus.${rootGroupStatus(selectedRootGroup)}`)"
                  :tone="managedRootTone(rootGroupStatus(selectedRootGroup))"
                />
                <GcStatusTag
                  v-if="selectedRootDetail"
                  :status="readString(selectedRootDetail, ['validationStatus'], 'pending')"
                  :label="t(`certificates.trustRoots.validationStatus.${readString(selectedRootDetail, ['validationStatus'], 'pending')}`)"
                  :tone="rootValidationTone(readString(selectedRootDetail, ['validationStatus'], 'pending'))"
                />
              </div>
            </header>

            <section class="trust-roots-modal__card">
              <dl class="trust-roots-modal__grid">
                <div>
                  <dt>{{ t('certificates.trustRoots.fields.fingerprintSha256') }}</dt>
                  <dd><code>{{ selectedRootGroup.fingerprintSha256 || t('certificates.trustRoots.summary.rootFingerprintUnavailable') }}</code></dd>
                </div>
                <div v-if="selectedRootDetail">
                  <dt>{{ t('certificates.trustRoots.fields.serialNumber') }}</dt>
                  <dd>{{ readString(selectedRootDetail, ['serialNumber']) }}</dd>
                </div>
                <div v-if="selectedRootDetail">
                  <dt>{{ t('certificates.trustRoots.fields.subject') }}</dt>
                  <dd>{{ formatDn(selectedRootDetail, 'subject') }}</dd>
                </div>
                <div v-if="selectedRootDetail">
                  <dt>{{ t('certificates.trustRoots.fields.issuer') }}</dt>
                  <dd>{{ formatDn(selectedRootDetail, 'issuer') }}</dd>
                </div>
                <div v-if="selectedRootDetail">
                  <dt>{{ t('certificates.trustRoots.fields.notBefore') }}</dt>
                  <dd>{{ formatDateTime(readString(selectedRootDetail, ['notBefore'])) }}</dd>
                </div>
                <div v-if="selectedRootDetail">
                  <dt>{{ t('certificates.trustRoots.fields.notAfter') }}</dt>
                  <dd>{{ formatDateTime(readString(selectedRootDetail, ['notAfter'])) }}</dd>
                </div>
                <div>
                  <dt>{{ t('certificates.trustRoots.fields.relatedAssets') }}</dt>
                  <dd>{{ t('businessPage.total', { count: rootAssetCount(selectedRootGroup) }) }}</dd>
                </div>
                <div>
                  <dt>{{ t('certificates.trustRoots.fields.relatedVersions') }}</dt>
                  <dd>{{ t('businessPage.total', { count: selectedRootGroup.managedItems.length }) }}</dd>
                </div>
              </dl>
              <p v-if="!selectedRootDetail" class="trust-roots-modal__hint">
                {{ t('certificates.trustRoots.states.rootNotInLibrary') }}
              </p>
            </section>

            <section class="trust-roots-modal__card">
              <header class="trust-roots-modal__section-header">
                <strong>{{ t('certificates.trustRoots.sections.relatedAssets') }}</strong>
                <span>{{ t('businessPage.total', { count: relatedAssets.length }) }}</span>
              </header>
              <div v-if="assetError" class="trust-roots-modal__inline-error" role="alert">
                <strong>{{ t('certificates.trustRoots.states.assetLoadFailed') }}</strong>
                <span>{{ assetError.message }}</span>
                <span>{{ t('businessPage.errorCode', { code: assetError.errorCode }) }}</span>
              </div>
              <GcEmptyState
                v-else-if="relatedAssets.length === 0"
                class="trust-roots-modal__empty trust-roots-modal__empty--embedded"
                :title="t('certificates.trustRoots.states.emptyAssets')"
              />
              <div v-else class="trust-roots-modal__asset-list">
                <article v-for="group in relatedAssets" :key="readString(group.asset, ['id'])" class="trust-roots-modal__asset-card">
                  <header class="trust-roots-modal__asset-header">
                    <div class="trust-roots-modal__asset-title">
                      <strong>{{ readString(group.asset, ['name', 'primaryDomain', 'id']) }}</strong>
                      <p>{{ readString(group.asset, ['primaryDomain']) }}</p>
                    </div>
                    <div class="trust-roots-modal__asset-actions">
                      <span class="trust-roots-modal__asset-count">{{ t('businessPage.total', { count: group.versions.length }) }}</span>
                      <button class="trust-roots-modal__toggle-button" type="button" @click="toggleAssetExpanded(group)">
                        {{ isAssetExpanded(group) ? t('certificates.trustRoots.actions.collapseVersions') : t('certificates.trustRoots.actions.expandVersions') }}
                      </button>
                    </div>
                  </header>
                  <dl class="trust-roots-modal__asset-meta">
                    <div>
                      <dt>{{ t('certificates.columns.certificateAssetId') }}</dt>
                      <dd><code>{{ readString(group.asset, ['id']) }}</code></dd>
                    </div>
                    <div>
                      <dt>{{ t('certificates.columns.primaryDomain') }}</dt>
                      <dd>{{ readString(group.asset, ['primaryDomain']) }}</dd>
                    </div>
                    <div>
                      <dt>{{ t('certificates.trustRoots.fields.relatedVersions') }}</dt>
                      <dd>{{ t('businessPage.total', { count: assetVersionCount(group) }) }}</dd>
                    </div>
                  </dl>
                  <ul v-if="isAssetExpanded(group)" class="trust-roots-modal__version-list">
                    <li v-for="item in group.versions" :key="readString(item.version, ['id'])" class="trust-roots-modal__version-item">
                      <div class="trust-roots-modal__version-main">
                        <strong>{{ readString(item.version, ['commonName', 'certificateName', 'fingerprintSha256']) }}</strong>
                        <code>{{ readString(item.version, ['fingerprintSha256']) }}</code>
                        <span>{{ t(`certificates.trustRoots.rootStatus.${readString(item.relation, ['rootStatus'], 'missing')}`) }}</span>
                      </div>
                      <GcStatusTag
                        :status="readString(item.relation, ['rootStatus'], 'missing')"
                        :label="t(`certificates.trustRoots.rootStatus.${readString(item.relation, ['rootStatus'], 'missing')}`)"
                        :tone="managedRootTone(readString(item.relation, ['rootStatus'], 'missing'))"
                      />
                    </li>
                  </ul>
                </article>
              </div>
            </section>

            <section class="trust-roots-modal__card">
              <header class="trust-roots-modal__section-header">
                <strong>{{ t('certificates.trustRoots.sections.observations') }}</strong>
                <span>{{ t('businessPage.total', { count: observations.length }) }}</span>
              </header>
              <GcEmptyState
                v-if="observations.length === 0"
                class="trust-roots-modal__empty trust-roots-modal__empty--embedded"
                :title="t('certificates.trustRoots.states.emptyObservations')"
              />
              <ul v-else class="trust-roots-modal__record-list">
                <li v-for="item in observations" :key="readString(item, ['id'])" class="trust-roots-modal__record-item">
                  <div class="trust-roots-modal__record-main">
                    <strong>{{ t(`certificates.trustRoots.sourceTypes.${readString(item, ['sourceType'], 'manual')}`) }}</strong>
                    <span>{{ formatDateTime(readString(item, ['observedAt'])) }}</span>
                    <code>{{ readString(item, ['observedFingerprint']) }}</code>
                  </div>
                  <GcStatusTag
                    :status="readString(item, ['status'], 'candidate')"
                    :label="t(`certificates.trustRoots.observationStatus.${readString(item, ['status'], 'candidate')}`)"
                    :tone="observationTone(readString(item, ['status'], 'candidate'))"
                  />
                </li>
              </ul>
            </section>
          </div>
        </section>
      </div>
    </template>
  </section>
</template>

<style scoped>
.trust-roots-modal {
  display: grid;
  gap: 12px;
  min-height: min(72vh, 880px);
}

.trust-roots-modal__toolbar,
.trust-roots-modal__detail-header,
.trust-roots-modal__section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.trust-roots-modal__toolbar strong,
.trust-roots-modal__detail-header h3,
.trust-roots-modal__section-header strong {
  color: var(--gc-color-text);
}

.trust-roots-modal__toolbar p,
.trust-roots-modal__detail-header p,
.trust-roots-modal__section-header span {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: 12px;
}

.trust-roots-modal__workspace {
  display: grid;
  grid-template-columns: minmax(240px, 300px) minmax(0, 1fr);
  gap: 16px;
  min-height: 0;
}

.trust-roots-modal__summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.trust-roots-modal__summary-card {
  display: grid;
  gap: 4px;
  padding: 14px;
  border: 1px solid var(--gc-color-border-soft);
  border-radius: 16px;
  background: var(--gc-color-surface-soft);
}

.trust-roots-modal__summary-card strong {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-xl);
  line-height: 1;
}

.trust-roots-modal__summary-card span {
  color: var(--gc-color-text-muted);
  font-size: 12px;
}

.trust-roots-modal__summary-card--success {
  border-color: var(--gc-color-success-border);
  background: var(--gc-color-success-soft);
}

.trust-roots-modal__summary-card--danger {
  border-color: var(--gc-color-danger-border);
  background: var(--gc-color-danger-soft);
}

.trust-roots-modal__summary-card--warning {
  border-color: var(--gc-color-warning-border);
  background: var(--gc-color-warning-soft);
}

.trust-roots-modal__list,
.trust-roots-modal__detail {
  min-height: 0;
}

.trust-roots-modal__list {
  display: grid;
  gap: 8px;
  align-content: start;
  overflow: auto;
  padding-right: 8px;
}

.trust-roots-modal__item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  padding: 12px;
  border: 1px solid var(--gc-color-border-soft);
  border-radius: 14px;
  background: var(--gc-color-surface-soft);
  text-align: left;
  transition: border-color .16s ease, background .16s ease, box-shadow .16s ease;
}

.trust-roots-modal__item:hover {
  border-color: var(--gc-color-primary-border);
  background: var(--gc-color-surface-muted);
}

.trust-roots-modal__item--active {
  border-color: var(--gc-color-primary-border);
  background: var(--gc-color-surface-selected);
  box-shadow: inset 0 0 0 1px var(--gc-color-primary-weak);
}

.trust-roots-modal__item-main,
.trust-roots-modal__record-main {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.trust-roots-modal__item-main strong,
.trust-roots-modal__record-main strong {
  font-size: 13px;
  font-weight: 650;
  overflow-wrap: anywhere;
}

.trust-roots-modal__item-main span,
.trust-roots-modal__asset-title p,
.trust-roots-modal__version-main span {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.trust-roots-modal__item-main code,
.trust-roots-modal__record-main code,
.trust-roots-modal__version-main code {
  color: var(--gc-color-text-muted);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.trust-roots-modal__detail {
  display: grid;
  min-height: 0;
}

.trust-roots-modal__detail-body {
  display: grid;
  gap: 12px;
  min-height: 0;
  overflow: auto;
  padding-right: 4px;
}

.trust-roots-modal__status-group {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.trust-roots-modal__card {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--gc-color-border-soft);
  border-radius: 16px;
  background: var(--gc-color-surface-soft);
}

.trust-roots-modal__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
}

.trust-roots-modal__grid div {
  display: grid;
  gap: 4px;
}

.trust-roots-modal__grid dt {
  color: var(--gc-color-text-muted);
  font-size: 12px;
}

.trust-roots-modal__grid dd {
  margin: 0;
  color: var(--gc-color-text);
  overflow-wrap: anywhere;
}

.trust-roots-modal__hint {
  margin: 0;
  padding: 12px;
  border: 1px dashed var(--gc-color-warning-border);
  border-radius: 14px;
  background: var(--gc-color-warning-soft);
  color: var(--gc-color-text-muted);
  font-size: 12px;
  line-height: 1.6;
}

.trust-roots-modal__asset-list,
.trust-roots-modal__version-list,
.trust-roots-modal__record-list {
  display: grid;
  gap: 8px;
}

.trust-roots-modal__asset-card {
  display: grid;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--gc-color-border-subtle);
  border-radius: 14px;
  background: var(--gc-color-surface-panel);
}

.trust-roots-modal__asset-header,
.trust-roots-modal__version-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.trust-roots-modal__asset-title,
.trust-roots-modal__version-main {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.trust-roots-modal__asset-title strong,
.trust-roots-modal__version-main strong {
  color: var(--gc-color-text);
  font-size: 13px;
  font-weight: 650;
  overflow-wrap: anywhere;
}

.trust-roots-modal__asset-count {
  color: var(--gc-color-text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.trust-roots-modal__asset-actions {
  display: grid;
  justify-items: end;
  gap: 8px;
}

.trust-roots-modal__toggle-button {
  padding: 6px 10px;
  border: 1px solid var(--gc-color-border-soft);
  border-radius: 999px;
  background: var(--gc-color-surface-soft);
  color: var(--gc-color-text);
  font-size: 12px;
  font-weight: 600;
  transition: border-color .16s ease, background .16s ease;
}

.trust-roots-modal__toggle-button:hover {
  border-color: var(--gc-color-primary-border);
  background: var(--gc-color-surface-selected);
}

.trust-roots-modal__asset-meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
}

.trust-roots-modal__asset-meta div {
  display: grid;
  gap: 4px;
}

.trust-roots-modal__asset-meta dt {
  color: var(--gc-color-text-muted);
  font-size: 12px;
}

.trust-roots-modal__asset-meta dd {
  margin: 0;
  color: var(--gc-color-text);
  overflow-wrap: anywhere;
}

.trust-roots-modal__version-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.trust-roots-modal__version-item {
  padding: 10px 12px;
  border: 1px solid var(--gc-color-border-subtle);
  border-radius: 12px;
  background: var(--gc-color-surface-soft);
}

.trust-roots-modal__record-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.trust-roots-modal__record-item {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--gc-color-border-subtle);
  border-radius: 12px;
  background: var(--gc-color-surface-panel);
}

.trust-roots-modal__record-main span {
  color: var(--gc-color-text-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.trust-roots-modal__state {
  display: grid;
  align-content: center;
  justify-items: center;
  min-height: 280px;
  color: var(--gc-color-text-muted);
  font-size: 12px;
  font-weight: 600;
}

.trust-roots-modal__inline-error {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--gc-color-danger-border);
  border-radius: 14px;
  background: var(--gc-color-danger-soft);
  color: var(--gc-color-danger);
}

.trust-roots-modal :deep(.trust-roots-modal__empty) {
  box-shadow: none;
}

.trust-roots-modal :deep(.trust-roots-modal__empty--embedded) {
  padding: 12px 0;
  background: transparent;
  border: 0;
}

@media (max-width: 960px) {
  .trust-roots-modal {
    min-height: 0;
  }

  .trust-roots-modal__summary,
  .trust-roots-modal__workspace,
  .trust-roots-modal__grid,
  .trust-roots-modal__asset-meta {
    grid-template-columns: 1fr;
  }

  .trust-roots-modal__list,
  .trust-roots-modal__detail-body {
    overflow: visible;
    padding-right: 0;
  }
}
</style>
