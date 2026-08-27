<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  getCertificateAssetDetail,
  getCertificateVersionDetail,
  getCertificateVersionUsage,
} from '@/api/modules/certificates.api'
import type { ApiRecord } from '@/api/modules/common'
import { GcDataTable, GcEmptyState } from '@/design-system/components'
import type { DataTableColumn } from '@/design-system/components/GcDataTable.vue'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import { readPath, readString, toErrorState, type CertificatePageError } from './certificate-view-utils'

const props = defineProps<{
  assetId: string
  versionId: string
  contextUsages?: ApiRecord[]
}>()

const { t } = useI18n()

type DetailTabKey = 'detail' | 'usage'

interface CertificateChainItem {
  readonly fingerprintSha256: string
  readonly displayName: string
  readonly subjectText: string
  readonly issuerText: string
  readonly role: 'leaf' | 'intermediate' | 'root'
}

interface DetailField {
  readonly label: string
  readonly value: string
}

interface CertificateUsageRow extends ApiRecord {
  readonly id: string
  readonly resourceId: string
  readonly resourceName: string
  readonly targetName: string
  readonly domainName: string
  readonly assetName: string
  readonly frameworkName: string
  readonly siteName: string
  readonly bindingType: string
  readonly usageSource: string
  readonly status: string
}

const loading = ref(false)
const error = ref<CertificatePageError | null>(null)
const activeTab = ref<DetailTabKey>('detail')
const asset = ref<ApiRecord | null>(null)
const version = ref<ApiRecord | null>(null)
const usages = ref<ApiRecord[]>([])

const currentVersionUsages = computed<CertificateUsageRow[]>(() => {
  const items = [
    ...(props.contextUsages ?? []).map((item) => normalizeUsageRow(item, detailPanelT('sources.agentContext'))),
    ...usages.value.map((item) => normalizeUsageRow(item, detailPanelT('sources.platformBinding'))),
  ].filter((item) =>
    hasApplicationServiceAsset(item) && isCurrentVersionUsage(item, props.versionId),
  )
  const deduped = new Map<string, CertificateUsageRow>()
  for (const item of items) {
    const key = [item.resourceId, item.domainName, item.bindingType, item.usageSource].join('|')
    if (!deduped.has(key)) deduped.set(key, item)
  }
  return [...deduped.values()]
})

const usageColumns = computed<DataTableColumn<ApiRecord>[]>(() => [
  { key: 'domainName', title: detailPanelT('usage.columns.domainName') },
  { key: 'assetName', title: detailPanelT('usage.columns.assetName'), width: '12%' },
  { key: 'frameworkName', title: detailPanelT('usage.columns.frameworkName'), width: '14%' },
  { key: 'siteName', title: detailPanelT('usage.columns.siteName'), width: '16%' },
  { key: 'bindingType', title: detailPanelT('usage.columns.bindingType'), width: '14%' },
  { key: 'usageSource', title: detailPanelT('usage.columns.usageSource'), width: '14%' },
  { key: 'status', title: detailPanelT('usage.columns.status'), width: '10%' },
])

const validityRange = computed(() => ({
  start: formatToMinute(readString(version.value, ['notBefore'], '')),
  end: formatToMinute(readString(version.value, ['notAfter'], '')),
}))

const trustRoots = computed<ApiRecord[]>(() => {
  const value = readPath(version.value, 'trustRoots')
  return Array.isArray(value) ? value.filter((item): item is ApiRecord => Boolean(item) && typeof item === 'object') : []
})

const selectedTrustRoot = computed<ApiRecord | null>(() =>
  trustRoots.value.find((item) => readString(item, ['relation'], '') === 'selected_root')
  ?? trustRoots.value.find((item) => readString(item, ['resolutionStatus'], '') === 'resolved')
  ?? trustRoots.value[0]
  ?? null,
)

const selectedTrustRootRecord = computed<ApiRecord | null>(() => {
  const root = readPath(selectedTrustRoot.value, 'root')
  return root && typeof root === 'object' ? root as ApiRecord : null
})

const selectedTrustRootName = computed(() =>
  readString(
    selectedTrustRootRecord.value,
    ['subject.commonName', 'subject.organization', 'subject.raw', 'fingerprintSha256'],
    detailPanelT('fallbacks.unknownCertificate'),
  ),
)

const isMissingIssuerOnlyResolvedByTrustRoot = computed(() => {
  if (readString(selectedTrustRoot.value, ['resolutionStatus'], '') !== 'resolved') return false
  return readString(version.value, ['chainStatus'], '') === 'incomplete'
})

const chainCertificates = computed<CertificateChainItem[]>(() => {
  const items = readPath(version.value, 'chainCertificates')
  const normalized: CertificateChainItem[] = []
  if (Array.isArray(items)) {
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const record = item as ApiRecord
      const displayName = readString(record, ['displayName', 'commonName', 'subject.commonName'], detailPanelT('fallbacks.unknownCertificate'))
      const subjectText = readString(record, ['subject.commonName', 'subject.organization', 'subject.raw'], displayName)
      const issuerText = readString(record, ['issuer.commonName', 'issuer.organization', 'issuer.raw'], detailPanelT('fallbacks.unknownIssuer'))
      normalized.push({
        fingerprintSha256: readString(record, ['fingerprintSha256'], displayName),
        displayName,
        subjectText,
        issuerText,
        role: (readString(record, ['role'], 'intermediate') || 'intermediate') as CertificateChainItem['role'],
      })
    }
  }
  if (isMissingIssuerOnlyResolvedByTrustRoot.value && selectedTrustRootRecord.value) {
    const fingerprint = readString(selectedTrustRootRecord.value, ['fingerprintSha256'], '')
    const exists = normalized.some((item) => item.fingerprintSha256 === fingerprint)
    if (!exists) {
      const displayName = selectedTrustRootName.value
      normalized.push({
        fingerprintSha256: fingerprint || displayName,
        displayName,
        subjectText: readString(selectedTrustRootRecord.value, ['subject.commonName', 'subject.organization', 'subject.raw'], displayName),
        issuerText: readString(selectedTrustRootRecord.value, ['issuer.commonName', 'issuer.organization', 'issuer.raw'], displayName),
        role: 'root',
      })
    }
  }
  return normalized
})

const chainDiagnosticsRaw = computed<string[]>(() => {
  const diagnostics = readPath(version.value, 'chainDiagnostics')
  return Array.isArray(diagnostics) ? diagnostics.map((item) => String(item)) : []
})

const chainDiagnostics = computed<string[]>(() => {
  if (!isMissingIssuerOnlyResolvedByTrustRoot.value) return chainDiagnosticsRaw.value
  return [
    detailPanelT('diagnostics.rootResolvedFromLibrary', {
      root: selectedTrustRootName.value,
    }),
  ]
})

const summaryFields = computed<DetailField[]>(() => [
  { label: detailPanelT('summary.certificateName'), value: readString(version.value, ['commonName', 'subject.commonName', 'id'], detailPanelT('fallbacks.unnamedCertificate')) },
  { label: detailPanelT('summary.logicalDomain'), value: readString(asset.value, ['primaryDomain', 'name'], detailPanelT('fallbacks.unknownDomain')) },
  { label: detailPanelT('summary.issuer'), value: readString(version.value, ['issuer.commonName', 'issuer.organization', 'issuer.raw'], detailPanelT('fallbacks.unknownIssuer')) },
  { label: detailPanelT('summary.subject'), value: readString(version.value, ['subject.commonName', 'subject.organization', 'subject.raw'], detailPanelT('fallbacks.unknownSubject')) },
  { label: detailPanelT('summary.serialNumber'), value: readString(version.value, ['serialNumber'], detailPanelT('fallbacks.unknown')) },
  { label: detailPanelT('summary.chainStatus'), value: readString(version.value, ['chainStatus'], detailPanelT('fallbacks.unknown')) },
])

const detailSections = computed<Array<{ title: string; fields: DetailField[] }>>(() => [
  {
    title: detailPanelT('sections.subjectInfo'),
    fields: [
      { label: detailPanelT('fields.commonName'), value: readString(version.value, ['subject.commonName'], detailPanelT('fallbacks.notPartOfCertificate')) },
      { label: detailPanelT('fields.organization'), value: readString(version.value, ['subject.organization'], detailPanelT('fallbacks.notPartOfCertificate')) },
      { label: detailPanelT('fields.organizationalUnit'), value: readString(version.value, ['subject.organizationalUnit'], detailPanelT('fallbacks.notPartOfCertificate')) },
      { label: detailPanelT('fields.countryRegion'), value: readString(version.value, ['subject.country'], detailPanelT('fallbacks.notPartOfCertificate')) },
      { label: detailPanelT('fields.stateProvince'), value: readString(version.value, ['subject.state'], detailPanelT('fallbacks.notPartOfCertificate')) },
      { label: detailPanelT('fields.locality'), value: readString(version.value, ['subject.locality'], detailPanelT('fallbacks.notPartOfCertificate')) },
    ],
  },
  {
    title: detailPanelT('sections.issuerInfo'),
    fields: [
      { label: detailPanelT('fields.commonName'), value: readString(version.value, ['issuer.commonName'], detailPanelT('fallbacks.notPartOfCertificate')) },
      { label: detailPanelT('fields.organization'), value: readString(version.value, ['issuer.organization'], detailPanelT('fallbacks.notPartOfCertificate')) },
      { label: detailPanelT('fields.organizationalUnit'), value: readString(version.value, ['issuer.organizationalUnit'], detailPanelT('fallbacks.notPartOfCertificate')) },
      { label: detailPanelT('fields.countryRegion'), value: readString(version.value, ['issuer.country'], detailPanelT('fallbacks.notPartOfCertificate')) },
      { label: detailPanelT('fields.stateProvince'), value: readString(version.value, ['issuer.state'], detailPanelT('fallbacks.notPartOfCertificate')) },
      { label: detailPanelT('fields.locality'), value: readString(version.value, ['issuer.locality'], detailPanelT('fallbacks.notPartOfCertificate')) },
    ],
  },
  {
    title: detailPanelT('sections.certificateFields'),
    fields: [
      { label: detailPanelT('fields.version'), value: readString(version.value, ['versionNo'], detailPanelT('fallbacks.unknown')) },
      { label: detailPanelT('fields.signatureAlgorithm'), value: readString(version.value, ['signatureAlgorithm'], detailPanelT('fallbacks.unknown')) },
      { label: detailPanelT('fields.publicKeyAlgorithm'), value: readString(version.value, ['publicKeyAlgorithm'], detailPanelT('fallbacks.unknown')) },
      { label: detailPanelT('fields.fingerprintSha256'), value: readString(version.value, ['fingerprintSha256'], detailPanelT('fallbacks.unknown')) },
      { label: detailPanelT('fields.san'), value: readSanValue() },
      { label: detailPanelT('fields.deployable'), value: readString(version.value, ['deployable'], 'false') === 'true' ? detailPanelT('values.yes') : detailPanelT('values.no') },
    ],
  },
  {
    title: detailPanelT('sections.extensionFields'),
    fields: [
      { label: detailPanelT('fields.leafStorageRef'), value: readString(version.value, ['leafStorageRef'], detailPanelT('fallbacks.unknown')) },
      { label: detailPanelT('fields.chainCertificateCount'), value: String(chainCertificates.value.length > 0 ? Math.max(chainCertificates.value.length - 1, 0) : 0) },
      { label: detailPanelT('fields.trustRootCertificate'), value: selectedTrustRootName.value },
      { label: detailPanelT('fields.trustRootStatus'), value: selectedTrustRoot.value ? trustRootStatusLabel(selectedTrustRoot.value) : detailPanelT('fallbacks.none') },
      { label: detailPanelT('fields.chainDiagnostics'), value: chainDiagnostics.value.length > 0 ? chainDiagnostics.value.join(detailPanelT('separators.diagnostic')) : detailPanelT('fallbacks.none') },
    ],
  },
])

watch(
  () => [props.assetId, props.versionId],
  () => {
    activeTab.value = 'detail'
    void loadDetail()
  },
  { immediate: true },
)

function detailPanelT(key: string, named?: Record<string, unknown>) {
  const fullKey = `certificates.detailPanel.${key}`
  return named ? t(fullKey, named) : t(fullKey)
}

function formatToMinute(value: string) {
  if (!value) return detailPanelT('fallbacks.unknown')
  return formatBrowserLocalTime(value, { includeSeconds: false }) || value
}

function readSanValue() {
  const sans = readPath(version.value, 'sans')
  return Array.isArray(sans) && sans.length > 0 ? sans.map((item) => String(item)).join(detailPanelT('separators.list')) : detailPanelT('fallbacks.none')
}

function readUsageField(record: ApiRecord, candidates: string[], fallback: string) {
  return readString(record, candidates, fallback)
}

function normalizeUsageRow(record: ApiRecord, fallbackSource: string): CertificateUsageRow {
  const binding = readPath(record, 'binding')
  const serviceAsset = readPath(record, 'serviceAsset')
  const service = readPath(record, 'service')
  const host = readPath(record, 'host')
  const siteAsset = readPath(record, 'siteAsset')
  const managedTarget = readPath(record, 'managedTarget')
  const metadata = readPath(record, 'metadata')

  const bindingRecord = binding && typeof binding === 'object' ? binding as ApiRecord : null
  const serviceAssetRecord = serviceAsset && typeof serviceAsset === 'object' ? serviceAsset as ApiRecord : null
  const serviceRecord = service && typeof service === 'object' ? service as ApiRecord : null
  const hostRecord = host && typeof host === 'object' ? host as ApiRecord : null
  const siteAssetRecord = siteAsset && typeof siteAsset === 'object' ? siteAsset as ApiRecord : null
  const managedTargetRecord = managedTarget && typeof managedTarget === 'object' ? managedTarget as ApiRecord : null
  const metadataRecord = metadata && typeof metadata === 'object' ? metadata as ApiRecord : null

  const resourceId = readString(record, ['resourceId', 'id'], '')
    || readString(bindingRecord, ['id', 'bindingKey'], '')
    || readString(serviceAssetRecord, ['id'], '')
    || readString(siteAssetRecord, ['id'], '')
    || readString(managedTargetRecord, ['id'], '')
    || readString(serviceRecord, ['id'], '')
    || readString(hostRecord, ['id'], '')

  const domainName = readString(serviceAssetRecord, ['displayName'], '')
    || readString(record, ['domainName', 'targetName', 'assetName', 'resourceName'], '')
    || readString(bindingRecord, ['domainName', 'domain'], '')
    || readString(serviceAssetRecord, ['address'], '')
    || readString(serviceRecord, ['displayName'], '')
    || readString(hostRecord, ['hostname', 'primaryIp'], '')

  const targetName = readString(record, ['targetName', 'resourceName'], '')
    || readString(serviceRecord, ['displayName'], '')
    || readString(serviceAssetRecord, ['address'], '')
    || readString(hostRecord, ['hostname', 'primaryIp'], '')
    || domainName

  const resourceName = readString(record, ['resourceName', 'assetName'], '')
    || readString(serviceAssetRecord, ['address'], '')
    || readString(siteAssetRecord, ['siteName'], '')
    || readString(serviceRecord, ['displayName'], '')
    || readString(hostRecord, ['hostname', 'primaryIp'], '')
    || targetName

  const assetName = readString(record, ['assetName', 'agentName'], '')
    || readString(hostRecord, ['displayName', 'hostname', 'agentId', 'primaryIp'], '')
    || readString(managedTargetRecord, ['agentId'], '')
    || readString(siteAssetRecord, ['agentId'], '')
    || readString(metadataRecord, ['agentName', 'agentId'], '')
    || detailPanelT('fallbacks.emptyValue')

  const frameworkName = readString(record, ['frameworkName'], '')
    || readString(serviceRecord, ['providerType', 'frameworkType', 'displayName'], '')
    || readString(bindingRecord, ['metadata.frameworkName', 'metadata.frameworkType'], '')
    || detailPanelT('fallbacks.emptyValue')

  const siteName = readString(record, ['siteName'], '')
    || readString(siteAssetRecord, ['siteName'], '')
    || readString(metadataRecord, ['siteName'], '')
    || readString(bindingRecord, ['metadata.siteName'], '')
    || detailPanelT('fallbacks.emptyValue')

  const bindingType = readString(record, ['bindingType', 'resourceType', 'type'], '')
    || readString(bindingRecord, ['bindingType'], '')
    || detailPanelT('fallbacks.unknownType')

  const status = readString(record, ['status', 'state'], '')
    || readString(bindingRecord, ['status'], '')
    || readString(serviceAssetRecord, ['status'], '')
    || readString(serviceRecord, ['status'], '')
    || readString(hostRecord, ['status'], '')
    || detailPanelT('fallbacks.unknown')

  const usageSource = readString(record, ['usageSource'], '') || fallbackSource

  return {
    ...record,
    id: resourceId || `${bindingType}:${domainName}:${usageSource}`,
    resourceId: resourceId || `${bindingType}:${domainName}`,
    resourceName: resourceName || domainName || detailPanelT('fallbacks.unknownResource'),
    targetName: targetName || domainName || detailPanelT('fallbacks.unknownTarget'),
    domainName: domainName || detailPanelT('fallbacks.unknownTarget'),
    assetName,
    frameworkName,
    siteName,
    bindingType,
    usageSource,
    status,
  }
}

function hasApplicationServiceAsset(record: ApiRecord): boolean {
  const serviceAsset = readPath(record, 'serviceAsset')
  if (!serviceAsset || typeof serviceAsset !== 'object') return false
  const serviceAssetRecord = serviceAsset as ApiRecord
  const serviceAssetId = readString(serviceAssetRecord, ['id'], '')
  const deletedAt = readString(serviceAssetRecord, ['deletedAt'], '')
  const status = readString(serviceAssetRecord, ['status'], '').toUpperCase()
  return Boolean(serviceAssetId) && !deletedAt && status !== 'DELETED'
}

function isCurrentVersionUsage(record: ApiRecord, versionId: string) {
  const binding = readPath(record, 'binding')
  const bindingRecord = binding && typeof binding === 'object' ? binding as ApiRecord : null

  const relatedVersionIds = [
    ...['certificateVersionId', 'targetCertificateVersionId', 'localCertificateVersionId'].map((field) => readString(record, [field], '')),
    ...['certificateVersionId', 'targetCertificateVersionId', 'localCertificateVersionId'].map((field) => readString(bindingRecord, [field], '')),
  ].filter(Boolean)
  // 中文说明：版本 usage 接口会为历史指纹匹配记录补充当前版本标识；
  // 前端只接受明确命中当前版本的记录，禁止用同域名或缺失字段兜底。
  return relatedVersionIds.includes(versionId)
}

function roleLabel(role: CertificateChainItem['role']) {
  if (role === 'leaf') return detailPanelT('chain.roles.leaf')
  if (role === 'root') return detailPanelT('chain.roles.root')
  return detailPanelT('chain.roles.intermediate')
}

function shouldShowSubject(item: CertificateChainItem) {
  return item.subjectText && item.subjectText !== item.displayName
}

function trustRootStatusLabel(record: ApiRecord) {
  const resolutionStatus = readString(record, ['resolutionStatus'], '')
  if (!resolutionStatus) return detailPanelT('fallbacks.none')
  return t(`certificates.trustRoots.resolutionStatus.${resolutionStatus}`)
}

async function loadDetail() {
  if (!props.assetId || !props.versionId) return
  loading.value = true
  error.value = null
  try {
    const [assetResult, versionResult, usageResult] = await Promise.all([
      getCertificateAssetDetail(props.assetId),
      getCertificateVersionDetail(props.versionId),
      getCertificateVersionUsage(props.versionId),
    ])
    asset.value = assetResult.data ?? null
    version.value = versionResult.data ?? null
    usages.value = Array.isArray(usageResult.data?.usages) ? usageResult.data.usages as ApiRecord[] : []
  } catch (cause) {
    error.value = toErrorState(cause)
    asset.value = null
    version.value = null
    usages.value = []
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <section class="certificate-detail-panel">
    <GcEmptyState v-if="error" :title="detailPanelT('errors.loadFailedTitle')" :description="error.message">
      <p>{{ detailPanelT('errors.code', { code: error.errorCode }) }}</p>
      <button class="gc-button" type="button" @click="loadDetail">{{ detailPanelT('actions.retry') }}</button>
    </GcEmptyState>

    <div v-else-if="loading" class="certificate-detail-panel__state">{{ detailPanelT('states.loading') }}</div>

    <template v-else>
      <nav class="certificate-detail-panel__tabs" :aria-label="detailPanelT('tabs.ariaLabel')">
        <button
          class="certificate-detail-panel__tab"
          :class="{ 'is-active': activeTab === 'detail' }"
          type="button"
          @click="activeTab = 'detail'"
        >
          {{ detailPanelT('tabs.detail') }}
        </button>
        <button
          class="certificate-detail-panel__tab"
          :class="{ 'is-active': activeTab === 'usage' }"
          type="button"
          @click="activeTab = 'usage'"
        >
          {{ detailPanelT('tabs.usage') }}
        </button>
      </nav>

      <section v-if="activeTab === 'detail'" class="certificate-detail-panel__tab-panel">
        <section class="certificate-detail-panel__summary">
          <article v-for="field in summaryFields" :key="field.label">
            <span>{{ field.label }}</span>
            <strong>{{ field.value }}</strong>
          </article>
        </section>

        <section class="certificate-detail-panel__validity gc-card">
          <span class="certificate-detail-panel__validity-label">{{ detailPanelT('validity.title') }}</span>
          <div class="certificate-detail-panel__validity-meta">
            <span>{{ detailPanelT('validity.notBefore', { value: validityRange.start }) }}</span>
            <span>{{ detailPanelT('validity.notAfter', { value: validityRange.end }) }}</span>
          </div>
        </section>

        <section class="gc-card certificate-detail-panel__chain-card">
          <header class="certificate-detail-panel__section-header">
            <strong>{{ detailPanelT('chain.title') }}</strong>
          </header>
          <div v-if="chainCertificates.length === 0" class="certificate-detail-panel__empty">{{ detailPanelT('chain.empty') }}</div>
          <ol v-else class="certificate-detail-panel__chain-list">
            <li v-for="item in chainCertificates" :key="item.fingerprintSha256" class="certificate-detail-panel__chain-item">
              <span class="certificate-detail-panel__chain-role">{{ roleLabel(item.role) }}</span>
              <div class="certificate-detail-panel__chain-body">
                <strong>{{ item.displayName }}</strong>
                <p v-if="shouldShowSubject(item)">{{ detailPanelT('chain.subject', { value: item.subjectText }) }}</p>
                <small v-if="item.issuerText !== item.displayName">{{ detailPanelT('chain.issuer', { value: item.issuerText }) }}</small>
              </div>
            </li>
          </ol>
        </section>

        <section v-for="section in detailSections" :key="section.title" class="gc-card certificate-detail-panel__detail-card">
          <header class="certificate-detail-panel__section-header">
            <strong>{{ section.title }}</strong>
          </header>
          <dl class="certificate-detail-panel__field-grid">
            <div v-for="field in section.fields" :key="`${section.title}-${field.label}`">
              <dt>{{ field.label }}</dt>
              <dd>{{ field.value }}</dd>
            </div>
          </dl>
        </section>
      </section>

      <section v-else class="certificate-detail-panel__tab-panel">
        <GcDataTable :columns="usageColumns" :rows="currentVersionUsages" :empty-text="detailPanelT('usage.empty')" pagination>
          <template #toolbar><strong>{{ detailPanelT('usage.toolbar') }}</strong></template>
          <template #cell-domainName="{ row }">
            {{ readUsageField(row, ['domainName', 'targetName', 'assetName', 'resourceName'], detailPanelT('fallbacks.unknownTarget')) }}
          </template>
          <template #cell-assetName="{ row }">
            {{ readUsageField(row, ['assetName'], detailPanelT('fallbacks.emptyValue')) }}
          </template>
          <template #cell-frameworkName="{ row }">
            {{ readUsageField(row, ['frameworkName'], detailPanelT('fallbacks.emptyValue')) }}
          </template>
          <template #cell-siteName="{ row }">
            {{ readUsageField(row, ['siteName'], detailPanelT('fallbacks.emptyValue')) }}
          </template>
          <template #cell-bindingType="{ row }">
            {{ readUsageField(row, ['bindingType', 'resourceType', 'type'], detailPanelT('fallbacks.unknownType')) }}
          </template>
          <template #cell-usageSource="{ row }">
            {{ readUsageField(row, ['usageSource'], detailPanelT('sources.platformBinding')) }}
          </template>
          <template #cell-status="{ row }">
            {{ readUsageField(row, ['status', 'state'], detailPanelT('fallbacks.unknown')) }}
          </template>
        </GcDataTable>
      </section>
    </template>
  </section>
</template>

<style scoped>
.certificate-detail-panel {
  display: grid;
  gap: var(--gc-space-3);
}

.certificate-detail-panel__state,
.certificate-detail-panel__empty {
  padding: var(--gc-space-6) var(--gc-space-3);
  color: var(--gc-color-text-muted);
  text-align: center;
  font-size: var(--gc-font-size-xs);
  font-weight: 600;
}

.certificate-detail-panel__tabs {
  display: flex;
  gap: var(--gc-space-2);
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border);
}

.certificate-detail-panel__tab {
  border: 0;
  border-bottom: var(--gc-border-width-thick) solid transparent;
  padding: var(--gc-space-2) var(--gc-space-1);
  color: var(--gc-color-text-muted);
  background: transparent;
  font-size: var(--gc-font-size-sm);
  font-weight: 700;
  cursor: pointer;
}

.certificate-detail-panel__tab.is-active {
  border-bottom-color: var(--gc-color-primary);
  color: var(--gc-color-primary);
}

.certificate-detail-panel__tab-panel {
  display: grid;
  gap: var(--gc-space-3);
}

.certificate-detail-panel__summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--gc-space-2);
}

.certificate-detail-panel__summary article,
.certificate-detail-panel__validity {
  display: grid;
  gap: var(--gc-space-1);
  padding: var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border-subtle);
  border-radius: var(--gc-radius-card);
  background: var(--gc-color-surface-field);
}

.certificate-detail-panel__summary span,
.certificate-detail-panel__validity-label,
.certificate-detail-panel__field-grid dt,
.certificate-detail-panel__chain-role {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 700;
}

.certificate-detail-panel__summary strong,
.certificate-detail-panel__validity-range,
.certificate-detail-panel__field-grid dd,
.certificate-detail-panel__chain-body p,
.certificate-detail-panel__chain-body small {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: var(--gc-font-size-xs);
  line-height: 1.45;
}

.certificate-detail-panel__validity {
  gap: var(--gc-space-2);
  padding: var(--gc-space-3) var(--gc-space-4);
  background: var(--gc-gradient-surface-soft);
  box-shadow: inset 0 var(--gc-space-hairline) 0 var(--gc-color-surface-field);
}



.certificate-detail-panel__validity-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-2);
  padding-top: var(--gc-space-2);
  border-top: var(--gc-border-width-default) solid var(--gc-color-border-soft);
}

.certificate-detail-panel__validity-meta span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 600;
}

.certificate-detail-panel__detail-card,
.certificate-detail-panel__chain-card {
  padding: 0;
  overflow: hidden;
}

.certificate-detail-panel__section-header {
  display: flex;
  align-items: center;
  gap: var(--gc-space-3);
  padding: var(--gc-space-3);
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border);
}

.certificate-detail-panel__section-header strong {
  font-size: var(--gc-font-size-sm);
}

.certificate-detail-panel__field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0;
}

.certificate-detail-panel__field-grid div {
  padding: var(--gc-space-3);
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border);
}

.certificate-detail-panel__field-grid div:nth-last-child(-n + 2) {
  border-bottom: 0;
}

.certificate-detail-panel__chain-list {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.certificate-detail-panel__chain-item {
  display: grid;
  grid-template-columns: calc(var(--gc-space-12) + var(--gc-space-7)) minmax(0, 1fr);
  gap: var(--gc-space-3);
  align-items: start;
  padding: var(--gc-space-3);
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border);
}

.certificate-detail-panel__chain-item:last-child {
  border-bottom: 0;
}

.certificate-detail-panel__chain-role {
  padding-top: var(--gc-space-1);
}

.certificate-detail-panel__chain-body {
  display: grid;
  gap: var(--gc-space-1);
}

.certificate-detail-panel__chain-body strong {
  overflow-wrap: anywhere;
  font-size: var(--gc-font-size-sm);
  line-height: 1.35;
}

@media (max-width: 56.25rem) {
  .certificate-detail-panel__summary,
  .certificate-detail-panel__field-grid {
    grid-template-columns: 1fr;
  }

  .certificate-detail-panel__validity-meta {
    grid-template-columns: 1fr;
  }

  .certificate-detail-panel__chain-item {
    grid-template-columns: 1fr;
    gap: var(--gc-space-1);
  }
}
</style>
