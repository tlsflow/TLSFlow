<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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
  readonly bindingType: string
  readonly usageSource: string
  readonly status: string
}

const loading = ref(false)
const error = ref<CertificatePageError | null>(null)
const activeTab = ref<DetailTabKey>('detail')
const asset = ref<ApiRecord | null>(null)
const version = ref<ApiRecord | null>(null)
const usages = ref<CertificateUsageRow[]>([])

const mergedUsages = computed<CertificateUsageRow[]>(() => {
  const items = [
    ...(props.contextUsages ?? []).map((item) => normalizeUsageRow(item, 'Agent上下文')),
    ...usages.value.map((item) => normalizeUsageRow(item, '平台绑定记录')),
  ]
  const deduped = new Map<string, CertificateUsageRow>()
  for (const item of items) {
    const key = [item.resourceId, item.domainName, item.bindingType, item.usageSource].join('|')
    if (!deduped.has(key)) deduped.set(key, item)
  }
  return [...deduped.values()]
})

const usageColumns: DataTableColumn<ApiRecord>[] = [
  { key: 'domainName', title: '域名/目标' },
  { key: 'bindingType', title: '绑定类型', width: '140px' },
  { key: 'usageSource', title: '来源', width: '140px' },
  { key: 'status', title: '状态', width: '120px' },
]

const validityRange = computed(() => ({
  start: formatToMinute(readString(version.value, ['notBefore'], '')),
  end: formatToMinute(readString(version.value, ['notAfter'], '')),
}))

const validityText = computed(() => `${validityRange.value.start} 至 ${validityRange.value.end}`)

const chainCertificates = computed<CertificateChainItem[]>(() => {
  const items = readPath(version.value, 'chainCertificates')
  if (!Array.isArray(items)) return []
  const normalized: CertificateChainItem[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const record = item as ApiRecord
    const displayName = readString(record, ['displayName', 'commonName', 'subject.commonName'], '未知证书')
    const subjectText = readString(record, ['subject.commonName', 'subject.organization', 'subject.raw'], displayName)
    const issuerText = readString(record, ['issuer.commonName', 'issuer.organization', 'issuer.raw'], '未知签发者')
    normalized.push({
      fingerprintSha256: readString(record, ['fingerprintSha256'], displayName),
      displayName,
      subjectText,
      issuerText,
      role: (readString(record, ['role'], 'intermediate') || 'intermediate') as CertificateChainItem['role'],
    })
  }
  return normalized
})

const chainDiagnostics = computed<string[]>(() => {
  const diagnostics = readPath(version.value, 'chainDiagnostics')
  return Array.isArray(diagnostics) ? diagnostics.map((item) => String(item)) : []
})

const summaryFields = computed<DetailField[]>(() => [
  { label: '证书名称', value: readString(version.value, ['commonName', 'subject.commonName', 'id'], '未命名证书') },
  { label: '逻辑域名', value: readString(asset.value, ['primaryDomain', 'name'], '未知域名') },
  { label: '颁发者', value: readString(version.value, ['issuer.commonName', 'issuer.organization', 'issuer.raw'], '未知颁发者') },
  { label: '使用者', value: readString(version.value, ['subject.commonName', 'subject.organization', 'subject.raw'], '未知使用者') },
  { label: '序列号', value: readString(version.value, ['serialNumber'], '未知') },
  { label: '链状态', value: readString(version.value, ['chainStatus'], '未知') },
])

const detailSections = computed<Array<{ title: string; fields: DetailField[] }>>(() => [
  {
    title: '主体信息',
    fields: [
      { label: '公用名(CN)', value: readString(version.value, ['subject.commonName'], '不是证书的一部分') },
      { label: '组织(O)', value: readString(version.value, ['subject.organization'], '不是证书的一部分') },
      { label: '组织单位(OU)', value: readString(version.value, ['subject.organizationalUnit'], '不是证书的一部分') },
      { label: '国家/地区(C)', value: readString(version.value, ['subject.country'], '不是证书的一部分') },
      { label: '省/州(ST)', value: readString(version.value, ['subject.state'], '不是证书的一部分') },
      { label: '城市(L)', value: readString(version.value, ['subject.locality'], '不是证书的一部分') },
    ],
  },
  {
    title: '颁发者信息',
    fields: [
      { label: '公用名(CN)', value: readString(version.value, ['issuer.commonName'], '不是证书的一部分') },
      { label: '组织(O)', value: readString(version.value, ['issuer.organization'], '不是证书的一部分') },
      { label: '组织单位(OU)', value: readString(version.value, ['issuer.organizationalUnit'], '不是证书的一部分') },
      { label: '国家/地区(C)', value: readString(version.value, ['issuer.country'], '不是证书的一部分') },
      { label: '省/州(ST)', value: readString(version.value, ['issuer.state'], '不是证书的一部分') },
      { label: '城市(L)', value: readString(version.value, ['issuer.locality'], '不是证书的一部分') },
    ],
  },
  {
    title: '证书字段',
    fields: [
      { label: '版本', value: readString(version.value, ['versionNo'], '未知') },
      { label: '签名算法', value: readString(version.value, ['signatureAlgorithm'], '未知') },
      { label: '公钥算法', value: readString(version.value, ['publicKeyAlgorithm'], '未知') },
      { label: 'SHA-256 指纹', value: readString(version.value, ['fingerprintSha256'], '未知') },
      { label: 'SAN', value: readSanValue() },
      { label: '可部署', value: readString(version.value, ['deployable'], 'false') === 'true' ? '是' : '否' },
    ],
  },
  {
    title: '扩展字段',
    fields: [
      { label: '叶子证书引用', value: readString(version.value, ['leafStorageRef'], '未知') },
      { label: '链证书数量', value: String(chainCertificates.value.length > 0 ? Math.max(chainCertificates.value.length - 1, 0) : 0) },
      { label: '链诊断', value: chainDiagnostics.value.length > 0 ? chainDiagnostics.value.join('；') : '暂无' },
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

function formatToMinute(value: string) {
  if (!value) return '未知'
  return formatBrowserLocalTime(value, { includeSeconds: false }) || value
}

function readSanValue() {
  const sans = readPath(version.value, 'sans')
  return Array.isArray(sans) && sans.length > 0 ? sans.map((item) => String(item)).join('，') : '暂无'
}

function readUsageField(record: ApiRecord, candidates: string[], fallback: string) {
  return readString(record, candidates, fallback)
}

function normalizeUsageRow(record: ApiRecord, fallbackSource: string): CertificateUsageRow {
  const binding = readPath(record, 'binding')
  const serviceAsset = readPath(record, 'serviceAsset')
  const service = readPath(record, 'service')
  const host = readPath(record, 'host')

  const bindingRecord = binding && typeof binding === 'object' ? binding as ApiRecord : null
  const serviceAssetRecord = serviceAsset && typeof serviceAsset === 'object' ? serviceAsset as ApiRecord : null
  const serviceRecord = service && typeof service === 'object' ? service as ApiRecord : null
  const hostRecord = host && typeof host === 'object' ? host as ApiRecord : null

  const resourceId = readString(record, ['resourceId', 'id'], '')
    || readString(bindingRecord, ['id', 'bindingKey'], '')
    || readString(serviceAssetRecord, ['id'], '')
    || readString(serviceRecord, ['id'], '')
    || readString(hostRecord, ['id'], '')

  const domainName = readString(record, ['domainName', 'targetName', 'assetName', 'resourceName'], '')
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
    || readString(serviceRecord, ['displayName'], '')
    || readString(hostRecord, ['hostname', 'primaryIp'], '')
    || targetName

  const bindingType = readString(record, ['bindingType', 'resourceType', 'type'], '')
    || readString(bindingRecord, ['bindingType'], '')
    || '未知类型'

  const status = readString(record, ['status', 'state'], '')
    || readString(bindingRecord, ['status'], '')
    || readString(serviceAssetRecord, ['status'], '')
    || readString(serviceRecord, ['status'], '')
    || readString(hostRecord, ['status'], '')
    || '未知'

  const usageSource = readString(record, ['usageSource'], '') || fallbackSource

  return {
    ...record,
    id: resourceId || `${bindingType}:${domainName}:${usageSource}`,
    resourceId: resourceId || `${bindingType}:${domainName}`,
    resourceName: resourceName || domainName || '未知资源',
    targetName: targetName || domainName || '未知目标',
    domainName: domainName || '未知目标',
    bindingType,
    usageSource,
    status,
  }
}

function roleLabel(role: CertificateChainItem['role']) {
  if (role === 'leaf') return '叶子证书'
  if (role === 'root') return '根证书'
  return '中间证书'
}

function shouldShowSubject(item: CertificateChainItem) {
  return item.subjectText && item.subjectText !== item.displayName
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
    usages.value = Array.isArray(usageResult.data?.usages)
      ? (usageResult.data.usages as ApiRecord[]).map((item) => normalizeUsageRow(item, '平台绑定记录'))
      : []
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
    <GcEmptyState v-if="error" title="证书详情加载失败" :description="error.message">
      <p>错误码：{{ error.errorCode }}</p>
      <button class="gc-button" type="button" @click="loadDetail">重试</button>
    </GcEmptyState>

    <div v-else-if="loading" class="certificate-detail-panel__state">加载中...</div>

    <template v-else>
      <nav class="certificate-detail-panel__tabs" aria-label="证书详情标签">
        <button
          class="certificate-detail-panel__tab"
          :class="{ 'is-active': activeTab === 'detail' }"
          type="button"
          @click="activeTab = 'detail'"
        >
          详情
        </button>
        <button
          class="certificate-detail-panel__tab"
          :class="{ 'is-active': activeTab === 'usage' }"
          type="button"
          @click="activeTab = 'usage'"
        >
          关联资产
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
          <span class="certificate-detail-panel__validity-label">证书有效期</span>
          <div class="certificate-detail-panel__validity-meta">
            <span>生效：{{ validityRange.start }}</span>
            <span>到期：{{ validityRange.end }}</span>
          </div>
        </section>

        <section class="gc-card certificate-detail-panel__chain-card">
          <header class="certificate-detail-panel__section-header">
            <strong>证书链</strong>
          </header>
          <div v-if="chainCertificates.length === 0" class="certificate-detail-panel__empty">暂无证书链信息</div>
          <ol v-else class="certificate-detail-panel__chain-list">
            <li v-for="item in chainCertificates" :key="item.fingerprintSha256" class="certificate-detail-panel__chain-item">
              <span class="certificate-detail-panel__chain-role">{{ roleLabel(item.role) }}</span>
              <div class="certificate-detail-panel__chain-body">
                <strong>{{ item.displayName }}</strong>
                <p v-if="shouldShowSubject(item)">主体：{{ item.subjectText }}</p>
                <small v-if="item.issuerText !== item.displayName">签发者：{{ item.issuerText }}</small>
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
        <GcDataTable :columns="usageColumns" :rows="mergedUsages" empty-text="暂无关联资产">
          <template #toolbar><strong>关联资产</strong></template>
          <template #cell-domainName="{ row }">
            {{ readUsageField(row, ['domainName', 'targetName', 'assetName', 'resourceName'], '未知目标') }}
          </template>
          <template #cell-bindingType="{ row }">
            {{ readUsageField(row, ['bindingType', 'resourceType', 'type'], '未知类型') }}
          </template>
          <template #cell-usageSource="{ row }">
            {{ readUsageField(row, ['usageSource'], '平台绑定记录') }}
          </template>
          <template #cell-status="{ row }">
            {{ readUsageField(row, ['status', 'state'], '未知') }}
          </template>
        </GcDataTable>
      </section>
    </template>
  </section>
</template>

<style scoped>
.certificate-detail-panel {
  display: grid;
  gap: 10px;
}

.certificate-detail-panel__state,
.certificate-detail-panel__empty {
  padding: 20px 10px;
  color: var(--gc-color-text-muted);
  text-align: center;
  font-size: 12px;
  font-weight: 600;
}

.certificate-detail-panel__tabs {
  display: flex;
  gap: 6px;
  border-bottom: 1px solid var(--gc-color-border);
}

.certificate-detail-panel__tab {
  border: 0;
  border-bottom: 2px solid transparent;
  padding: 6px 4px 8px;
  color: var(--gc-color-text-muted);
  background: transparent;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.certificate-detail-panel__tab.is-active {
  border-bottom-color: var(--gc-color-primary);
  color: var(--gc-color-text);
}

.certificate-detail-panel__tab-panel {
  display: grid;
  gap: 10px;
}

.certificate-detail-panel__summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.certificate-detail-panel__summary article,
.certificate-detail-panel__validity {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid rgb(15 23 42 / 6%);
  border-radius: 12px;
  background: rgb(255 255 255 / 72%);
}

.certificate-detail-panel__summary span,
.certificate-detail-panel__validity-label,
.certificate-detail-panel__field-grid dt,
.certificate-detail-panel__chain-role {
  color: var(--gc-color-text-muted);
  font-size: 11px;
  font-weight: 700;
}

.certificate-detail-panel__summary strong,
.certificate-detail-panel__validity-range,
.certificate-detail-panel__field-grid dd,
.certificate-detail-panel__chain-body p,
.certificate-detail-panel__chain-body small {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 12px;
  line-height: 1.45;
}

.certificate-detail-panel__validity {
  gap: 8px;
  padding: 12px 14px;
  background: linear-gradient(135deg, rgb(236 245 255 / 96%), rgb(249 252 255 / 98%));
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 70%);
}



.certificate-detail-panel__validity-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding-top: 6px;
  border-top: 1px solid rgb(15 23 42 / 8%);
}

.certificate-detail-panel__validity-meta span {
  color: var(--gc-color-text-muted);
  font-size: 11px;
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
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--gc-color-border);
}

.certificate-detail-panel__section-header strong {
  font-size: 14px;
}

.certificate-detail-panel__field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0;
}

.certificate-detail-panel__field-grid div {
  padding: 10px 12px;
  border-bottom: 1px solid var(--gc-color-border);
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
  grid-template-columns: 76px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  padding: 10px 12px;
  border-bottom: 1px solid var(--gc-color-border);
}

.certificate-detail-panel__chain-item:last-child {
  border-bottom: 0;
}

.certificate-detail-panel__chain-role {
  padding-top: 2px;
}

.certificate-detail-panel__chain-body {
  display: grid;
  gap: 2px;
}

.certificate-detail-panel__chain-body strong {
  overflow-wrap: anywhere;
  font-size: 13px;
  line-height: 1.35;
}

@media (max-width: 900px) {
  .certificate-detail-panel__summary,
  .certificate-detail-panel__field-grid {
    grid-template-columns: 1fr;
  }

  .certificate-detail-panel__validity-meta {
    grid-template-columns: 1fr;
  }

  .certificate-detail-panel__chain-item {
    grid-template-columns: 1fr;
    gap: 4px;
  }
}
</style>
