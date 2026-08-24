<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  getCertificateAssetDetail,
  getCertificateVersionDetail,
  getCertificateVersionUsage,
  listCertificateFormatsByVersionId,
} from '@/api/modules/certificates.api'
import type { ApiRecord } from '@/api/modules/common'
import { GcDataTable, GcEmptyState } from '@/design-system/components'
import type { DataTableColumn } from '@/design-system/components/GcDataTable.vue'
import { readPath, readString, toErrorState, type CertificatePageError } from './certificate-view-utils'

const props = defineProps<{
  assetId: string
  versionId: string
}>()

type DetailTabKey = 'detail' | 'usage'

interface CertificateChainItem {
  readonly fingerprintSha256: string
  readonly displayName: string
  readonly commonName?: string
  readonly subject?: ApiRecord
  readonly issuer?: ApiRecord
  readonly role: 'leaf' | 'intermediate' | 'root'
}

interface DetailField {
  readonly label: string
  readonly value: string
}

const loading = ref(false)
const error = ref<CertificatePageError | null>(null)
const activeTab = ref<DetailTabKey>('detail')
const asset = ref<ApiRecord | null>(null)
const version = ref<ApiRecord | null>(null)
const formats = ref<ApiRecord[]>([])
const usages = ref<ApiRecord[]>([])

const formatColumns: DataTableColumn<ApiRecord>[] = [
  { key: 'format', title: '格式' },
  { key: 'containsPrivateKey', title: '包含私钥', width: '120px' },
  { key: 'artifactRef', title: '产物引用' },
]

const usageColumns: DataTableColumn<ApiRecord>[] = [
  { key: 'domainName', title: '域名/目标' },
  { key: 'bindingType', title: '绑定类型', width: '140px' },
  { key: 'status', title: '状态', width: '120px' },
]

const validityText = computed(() => {
  const notBefore = readString(version.value, ['notBefore'], '未知')
  const notAfter = readString(version.value, ['notAfter'], '未知')
  return `${notBefore} 至 ${notAfter}`
})

const chainCertificates = computed<CertificateChainItem[]>(() => {
  const items = readPath(version.value, 'chainCertificates')
  if (!Array.isArray(items)) return []
  return items
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const record = item as ApiRecord
      return {
        fingerprintSha256: readString(record, ['fingerprintSha256'], ''),
        displayName: readString(record, ['displayName', 'commonName', 'subject.commonName'], '未知证书'),
        commonName: readString(record, ['commonName'], ''),
        subject: readPath(record, 'subject') as ApiRecord | undefined,
        issuer: readPath(record, 'issuer') as ApiRecord | undefined,
        role: (readString(record, ['role'], 'intermediate') || 'intermediate') as CertificateChainItem['role'],
      } satisfies CertificateChainItem
    })
    .filter((item): item is CertificateChainItem => item !== null)
})

const chainDiagnostics = computed<string[]>(() => {
  const diagnostics = readPath(version.value, 'chainDiagnostics')
  return Array.isArray(diagnostics) ? diagnostics.map((item) => String(item)) : []
})

const summaryFields = computed<DetailField[]>(() => [
  { label: '证书名称', value: readString(version.value, ['commonName', 'subject.commonName', 'id'], '未命名证书') },
  { label: '逻辑域名', value: readString(asset.value, ['primaryDomain', 'name'], '未知域名') },
  { label: '有效期', value: validityText.value },
  { label: '颁发者', value: readString(version.value, ['issuer.commonName', 'issuer.organization', 'issuer.raw'], '未知颁发者') },
  { label: '使用者', value: readString(version.value, ['subject.commonName', 'subject.organization', 'subject.raw'], '未知使用者') },
  { label: '序列号', value: readString(version.value, ['serialNumber'], '未知') },
])

const detailSections = computed<Array<{ title: string; fields: DetailField[] }>>(() => [
  {
    title: '主体信息',
    fields: [
      { label: '公用名（CN）', value: readString(version.value, ['subject.commonName'], '不是证书的一部分') },
      { label: '组织（O）', value: readString(version.value, ['subject.organization'], '不是证书的一部分') },
      { label: '组织单位（OU）', value: readString(version.value, ['subject.organizationalUnit'], '不是证书的一部分') },
      { label: '国家/地区（C）', value: readString(version.value, ['subject.country'], '不是证书的一部分') },
      { label: '省/州（ST）', value: readString(version.value, ['subject.state'], '不是证书的一部分') },
      { label: '城市（L）', value: readString(version.value, ['subject.locality'], '不是证书的一部分') },
    ],
  },
  {
    title: '颁发者信息',
    fields: [
      { label: '公用名（CN）', value: readString(version.value, ['issuer.commonName'], '不是证书的一部分') },
      { label: '组织（O）', value: readString(version.value, ['issuer.organization'], '不是证书的一部分') },
      { label: '组织单位（OU）', value: readString(version.value, ['issuer.organizationalUnit'], '不是证书的一部分') },
      { label: '国家/地区（C）', value: readString(version.value, ['issuer.country'], '不是证书的一部分') },
      { label: '省/州（ST）', value: readString(version.value, ['issuer.state'], '不是证书的一部分') },
      { label: '城市（L）', value: readString(version.value, ['issuer.locality'], '不是证书的一部分') },
    ],
  },
  {
    title: '证书字段',
    fields: [
      { label: '版本', value: readString(version.value, ['versionNo'], '未知') },
      { label: '签名算法', value: readString(version.value, ['signatureAlgorithm'], '未知') },
      { label: '公钥算法', value: readString(version.value, ['publicKeyAlgorithm'], '未知') },
      { label: '指纹（SHA-256）', value: readString(version.value, ['fingerprintSha256'], '未知') },
      { label: '链状态', value: readString(version.value, ['chainStatus'], '未知') },
      { label: '可部署', value: readString(version.value, ['deployable'], 'false') === 'true' ? '是' : '否' },
    ],
  },
  {
    title: '扩展字段',
    fields: [
      { label: 'SAN', value: readSanValue() },
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

function readSanValue() {
  const sans = readPath(version.value, 'sans')
  return Array.isArray(sans) && sans.length > 0 ? sans.map((item) => String(item)).join('，') : '暂无'
}

function readUsageField(record: ApiRecord, candidates: string[], fallback: string) {
  return readString(record, candidates, fallback)
}

async function loadDetail() {
  if (!props.assetId || !props.versionId) return
  loading.value = true
  error.value = null
  try {
    const [assetResult, versionResult, formatResult, usageResult] = await Promise.all([
      getCertificateAssetDetail(props.assetId),
      getCertificateVersionDetail(props.versionId),
      listCertificateFormatsByVersionId(props.versionId),
      getCertificateVersionUsage(props.versionId),
    ])
    asset.value = assetResult.data ?? null
    version.value = versionResult.data ?? null
    formats.value = [...(formatResult.data?.items ?? [])]
    usages.value = Array.isArray(usageResult.data?.usages) ? usageResult.data.usages as ApiRecord[] : []
  } catch (cause) {
    error.value = toErrorState(cause)
    asset.value = null
    version.value = null
    formats.value = []
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

        <section class="gc-card certificate-detail-panel__chain-card">
          <header class="certificate-detail-panel__section-header">
            <strong>证书链</strong>
            <span>按叶子、中间、根证书顺序展示</span>
          </header>
          <div v-if="chainCertificates.length === 0" class="certificate-detail-panel__empty">暂无证书链信息</div>
          <ol v-else class="certificate-detail-panel__chain-list">
            <li v-for="item in chainCertificates" :key="item.fingerprintSha256" class="certificate-detail-panel__chain-item">
              <div class="certificate-detail-panel__chain-head">
                <strong>{{ item.displayName }}</strong>
                <span>{{ item.role === 'leaf' ? '叶子证书' : item.role === 'root' ? '根证书' : '中间证书' }}</span>
              </div>
              <p>{{ readUsageField(item.subject ?? {}, ['commonName', 'organization', 'raw'], '未知主体') }}</p>
              <small>签发者：{{ readUsageField(item.issuer ?? {}, ['commonName', 'organization', 'raw'], '未知签发者') }}</small>
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

        <GcDataTable :columns="formatColumns" :rows="formats" empty-text="暂无格式产物">
          <template #toolbar><strong>格式产物</strong></template>
          <template #cell-containsPrivateKey="{ row }">
            {{ readString(row, ['containsPrivateKey'], 'false') === 'true' ? '是' : '否' }}
          </template>
        </GcDataTable>
      </section>

      <section v-else class="certificate-detail-panel__tab-panel">
        <GcDataTable :columns="usageColumns" :rows="usages" empty-text="暂无关联资产">
          <template #toolbar><strong>关联资产</strong></template>
          <template #cell-domainName="{ row }">
            {{ readUsageField(row, ['domainName', 'targetName', 'assetName', 'resourceName'], '未知目标') }}
          </template>
          <template #cell-bindingType="{ row }">
            {{ readUsageField(row, ['bindingType', 'resourceType', 'type'], '未知类型') }}
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
  gap: 16px;
}

.certificate-detail-panel__state,
.certificate-detail-panel__empty {
  padding: 32px 12px;
  color: var(--gc-color-text-muted);
  text-align: center;
  font-size: 13px;
  font-weight: 600;
}

.certificate-detail-panel__tabs {
  display: flex;
  gap: 8px;
  border-bottom: 1px solid var(--gc-color-border);
}

.certificate-detail-panel__tab {
  border: 0;
  border-bottom: 2px solid transparent;
  padding: 10px 4px 12px;
  color: var(--gc-color-text-muted);
  background: transparent;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.certificate-detail-panel__tab.is-active {
  border-bottom-color: var(--gc-color-primary);
  color: var(--gc-color-text);
}

.certificate-detail-panel__tab-panel {
  display: grid;
  gap: 16px;
}

.certificate-detail-panel__summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.certificate-detail-panel__summary article {
  display: grid;
  gap: 6px;
  padding: 16px;
  border: 1px solid rgb(15 23 42 / 6%);
  border-radius: 14px;
  background: rgb(255 255 255 / 68%);
}

.certificate-detail-panel__summary span,
.certificate-detail-panel__field-grid dt,
.certificate-detail-panel__chain-head span,
.certificate-detail-panel__section-header span {
  color: var(--gc-color-text-muted);
  font-size: 12px;
  font-weight: 700;
}

.certificate-detail-panel__summary strong,
.certificate-detail-panel__field-grid dd,
.certificate-detail-panel__chain-item p,
.certificate-detail-panel__chain-item small {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 13px;
  line-height: 1.6;
}

.certificate-detail-panel__detail-card,
.certificate-detail-panel__chain-card {
  padding: 0;
  overflow: hidden;
}

.certificate-detail-panel__section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px;
  border-bottom: 1px solid var(--gc-color-border);
}

.certificate-detail-panel__section-header strong {
  font-size: 18px;
}

.certificate-detail-panel__field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0;
}

.certificate-detail-panel__field-grid div {
  padding: 16px 20px;
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
  gap: 6px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--gc-color-border);
}

.certificate-detail-panel__chain-item:last-child {
  border-bottom: 0;
}

.certificate-detail-panel__chain-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.certificate-detail-panel__chain-head strong {
  font-size: 14px;
}

@media (max-width: 900px) {
  .certificate-detail-panel__summary,
  .certificate-detail-panel__field-grid {
    grid-template-columns: 1fr;
  }

  .certificate-detail-panel__field-grid div:nth-last-child(-n + 2) {
    border-bottom: 1px solid var(--gc-color-border);
  }

  .certificate-detail-panel__field-grid div:last-child {
    border-bottom: 0;
  }

  .certificate-detail-panel__chain-head,
  .certificate-detail-panel__section-header {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
