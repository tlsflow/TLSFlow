<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { listCertificateFormats, listCertificates, listCertificateUsages, listCertificateVersions } from '@/api/modules/certificates.api'
import type { ApiRecord } from '@/api/modules/common'
import { GcDataTable, GcEmptyState, GcPageHeader, GcRiskBadge, GcStatusTag } from '@/design-system/components'
import type { DataTableColumn } from '@/design-system/components/GcDataTable.vue'
import { firstRecord, formatList, readPath, readString, toErrorState, type CertificatePageError } from './certificate-view-utils'

const route = useRoute()
const certificateId = computed(() => String(route.params.id ?? ''))
const loading = ref(false)
const error = ref<CertificatePageError | null>(null)
const requestIds = ref<string[]>([])
const asset = ref<ApiRecord | null>(null)
const versions = ref<ApiRecord[]>([])
const formats = ref<ApiRecord[]>([])
const usages = ref<ApiRecord[]>([])

const versionColumns: DataTableColumn<ApiRecord>[] = [
  { key: 'version', title: '版本' },
  { key: 'status', title: '状态' },
  { key: 'notAfter', title: '到期' },
  { key: 'fingerprintSha256', title: '指纹' }
]
const formatColumns: DataTableColumn<ApiRecord>[] = [
  { key: 'format', title: '格式' },
  { key: 'status', title: '状态' },
  { key: 'secretRef', title: 'Secret 引用' }
]
const usageColumns: DataTableColumn<ApiRecord>[] = [
  { key: 'domainName', title: '域名/目标' },
  { key: 'status', title: '状态' },
  { key: 'resourceId', title: '资源' }
]

const chainText = computed(() => {
  const chain = readPath(asset.value, 'chain')
  const certChain = readPath(asset.value, 'certificateChain')
  if (Array.isArray(chain)) return formatList(chain)
  if (Array.isArray(certChain)) return formatList(certChain)
  return readString(asset.value, ['chainSummary', 'issuerChain', 'currentVersion.chainSummary'])
})

async function loadDetail() {
  loading.value = true
  error.value = null
  requestIds.value = []
  try {
    const [assetResult, versionResult, formatResult, usageResult] = await Promise.all([
      listCertificates({ page: 1, pageSize: 1, filters: { id: certificateId.value, certificateId: certificateId.value } }),
      listCertificateVersions({ page: 1, pageSize: 50, sort: 'createdAt:desc', filters: { certificateId: certificateId.value, certificateAssetId: certificateId.value } }),
      listCertificateFormats({ page: 1, pageSize: 50, filters: { certificateId: certificateId.value, certificateAssetId: certificateId.value } }),
      listCertificateUsages({ page: 1, pageSize: 50, filters: { certificateId: certificateId.value } })
    ])
    requestIds.value = [assetResult.requestId, versionResult.requestId, formatResult.requestId, usageResult.requestId]
    asset.value = firstRecord(assetResult)
    versions.value = [...(versionResult.data?.items ?? [])]
    formats.value = [...(formatResult.data?.items ?? [])]
    usages.value = [...(usageResult.data?.items ?? [])]
  } catch (cause) {
    error.value = toErrorState(cause)
  } finally {
    loading.value = false
  }
}

onMounted(() => void loadDetail())
</script>

<template>
  <section class="gc-page certificate-detail">
    <GcPageHeader :title="readString(asset, ['name', 'primaryDomain', 'commonName'], certificateId)" description="证书链、版本、格式产物和使用关系聚合视图。">
      <template #actions>
        <RouterLink class="gc-button" :to="`/certificates/${certificateId}/usages`">使用关系</RouterLink>
        <RouterLink class="gc-button" :to="`/certificates/${certificateId}/formats`">格式产物</RouterLink>
        <RouterLink class="gc-button" to="/certificates">返回列表</RouterLink>
      </template>
    </GcPageHeader>

    <GcEmptyState v-if="error" title="证书详情加载失败" :description="error.message">
      <p>错误码：{{ error.errorCode }}</p>
      <p>requestId：{{ error.requestId }}</p>
      <button class="gc-button" type="button" @click="loadDetail">重试</button>
    </GcEmptyState>

    <p v-else-if="loading" class="certificate-detail__loading">加载中...</p>

    <template v-else>
      <section class="gc-card certificate-detail__summary">
        <div><span>证书 ID</span><strong>{{ certificateId }}</strong></div>
        <div><span>主域名</span><strong>{{ readString(asset, ['primaryDomain', 'commonName', 'name']) }}</strong></div>
        <div><span>状态</span><GcStatusTag :status="readString(asset, ['status', 'state'], 'MANAGED')" /></div>
        <div><span>风险</span><GcRiskBadge :risk="readString(asset, ['risk', 'riskLevel'], 'MEDIUM') as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'" /></div>
        <div><span>SAN</span><strong>{{ readString(asset, ['subjectAltNames', 'sans']) }}</strong></div>
        <div><span>到期时间</span><strong>{{ readString(asset, ['notAfter', 'expiresAt', 'currentVersion.notAfter']) }}</strong></div>
        <div class="certificate-detail__full"><span>证书链</span><strong>{{ chainText }}</strong></div>
        <div class="certificate-detail__full"><span>requestId</span><strong>{{ requestIds.join(' / ') || '等待请求' }}</strong></div>
      </section>

      <GcDataTable :columns="versionColumns" :rows="versions" empty-text="暂无版本">
        <template #toolbar><strong>证书版本</strong></template>
      </GcDataTable>
      <GcDataTable :columns="formatColumns" :rows="formats" empty-text="暂无格式产物">
        <template #toolbar><strong>格式产物</strong></template>
      </GcDataTable>
      <GcDataTable :columns="usageColumns" :rows="usages" empty-text="暂无使用关系">
        <template #toolbar><strong>使用关系</strong></template>
      </GcDataTable>
    </template>
  </section>
</template>

<style scoped>
.certificate-detail { display: grid; gap: var(--gc-space-5); }
.certificate-detail__loading { margin: 0; color: var(--gc-color-text-muted); font-weight: 850; }
.certificate-detail__summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gc-space-4); padding: 24px; }
.certificate-detail__summary div { display: grid; gap: var(--gc-space-1); }
.certificate-detail__summary span { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); font-weight: 850; }
.certificate-detail__summary strong { overflow-wrap: anywhere; }
.certificate-detail__full { grid-column: 1 / -1; }
@media (max-width: 900px) { .certificate-detail__summary { grid-template-columns: 1fr; } }
</style>
