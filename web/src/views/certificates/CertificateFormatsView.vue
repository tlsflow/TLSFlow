<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { ApiClientError } from '@/api/client'
import { createCertificateFormat, generateCertificateFormatExport, listCertificateFormats, requestCertificateFormatExport } from '@/api/modules/certificates.api'
import type { ApiRecord } from '@/api/modules/common'
import { GcDataTable, GcEmptyState, GcPageHeader, GcStatusTag } from '@/design-system/components'
import type { DataTableColumn } from '@/design-system/components/GcDataTable.vue'
import { toErrorState, type CertificatePageError } from './certificate-view-utils'

const route = useRoute()
const certificateId = computed(() => String(route.params.id ?? ''))
const rows = ref<ApiRecord[]>([])
const requestId = ref('')
const loading = ref(false)
const actionError = ref('')
const actionRequestId = ref('')
const error = ref<CertificatePageError | null>(null)
const draft = reactive({ format: 'PEM', certificateVersionId: '', containsPrivateKey: false, passwordSecretRef: '', alias: '' })
const formatOptions = [
  { value: 'PEM', label: 'PEM', supported: true },
  { value: 'DER', label: 'DER', supported: true },
  { value: 'PFX', label: 'PFX / PKCS#12', supported: true },
  { value: 'JKS', label: 'JKS', supported: true },
  { value: 'P7B', label: 'P7B / PKCS#7', supported: true }
]
const selectedFormat = computed(() => formatOptions.find((item) => item.value === draft.format) ?? formatOptions[0])
const columns: DataTableColumn<ApiRecord>[] = [
  { key: 'format', title: '格式' },
  { key: 'status', title: '状态' },
  { key: 'certificateVersionId', title: '版本 ID' },
  { key: 'secretRef', title: 'Secret 引用' },
  { key: 'createdAt', title: '创建时间' }
]

async function loadFormats() {
  loading.value = true
  error.value = null
  try {
    const result = await listCertificateFormats({ page: 1, pageSize: 100, filters: { certificateId: certificateId.value, certificateAssetId: certificateId.value } })
    requestId.value = result.requestId
    rows.value = [...(result.data?.items ?? [])]
  } catch (cause) {
    error.value = toErrorState(cause)
  } finally {
    loading.value = false
  }
}

function payload() {
  return {
    certificateId: certificateId.value,
    certificateAssetId: certificateId.value,
    ...(draft.certificateVersionId.trim() ? { certificateVersionId: draft.certificateVersionId.trim() } : {}),
    format: draft.format.toLowerCase(),
    containsPrivateKey: draft.format === 'PFX' || draft.format === 'JKS' ? true : draft.containsPrivateKey,
    ...(draft.passwordSecretRef.trim() ? { passwordSecretRef: draft.passwordSecretRef.trim() } : {}),
    ...(draft.alias.trim() ? { parameters: { alias: draft.alias.trim() } } : {})
  }
}

async function planExport() {
  actionError.value = ''
  actionRequestId.value = ''
  try {
    const result = await requestCertificateFormatExport(payload())
    actionRequestId.value = result.requestId
  } catch (cause) {
    if (cause instanceof ApiClientError) {
      actionError.value = `${cause.message}（${cause.errorCode}）`
      actionRequestId.value = cause.requestId
    } else actionError.value = cause instanceof Error ? cause.message : '导出规划失败'
  }
}

async function generateExport() {
  actionError.value = ''
  actionRequestId.value = ''
  if (!draft.certificateVersionId.trim()) {
    actionError.value = '真实导出必须填写证书版本 ID。'
    return
  }
  if ((draft.format === 'PFX' || draft.format === 'JKS') && !draft.passwordSecretRef.trim()) {
    actionError.value = 'PFX/JKS 真实导出必须填写 passwordSecretRef。'
    return
  }
  try {
    const result = await generateCertificateFormatExport(payload())
    actionRequestId.value = result.requestId
    await loadFormats()
  } catch (cause) {
    if (cause instanceof ApiClientError) {
      actionError.value = `${cause.message}（${cause.errorCode}）`
      actionRequestId.value = cause.requestId
    } else actionError.value = cause instanceof Error ? cause.message : '生成格式产物失败'
  }
}

async function createFormat() {
  actionError.value = ''
  actionRequestId.value = ''
  if (!selectedFormat.value.supported) {
    actionError.value = `${selectedFormat.value.label} 当前能力声明不可创建。`
    return
  }
  try {
    const result = await createCertificateFormat(payload())
    actionRequestId.value = result.requestId
    await loadFormats()
  } catch (cause) {
    if (cause instanceof ApiClientError) {
      actionError.value = `${cause.message}（${cause.errorCode}）`
      actionRequestId.value = cause.requestId
    } else actionError.value = cause instanceof Error ? cause.message : '创建格式失败'
  }
}

onMounted(() => void loadFormats())
</script>

<template>
  <section class="gc-page certificate-formats">
    <GcPageHeader title="证书格式产物" :description="`证书 ${certificateId} 的 PEM/DER/PFX/JKS/P7B 真实格式产物入口。`">
      <template #actions><RouterLink class="gc-button" :to="`/certificates/${certificateId}`">返回详情</RouterLink></template>
    </GcPageHeader>

    <section class="gc-card certificate-formats__actions">
      <label><span>目标格式</span><select v-model="draft.format"><option v-for="item in formatOptions" :key="item.value" :value="item.value">{{ item.label }} - 可用</option></select></label>
      <label><span>版本 ID</span><input v-model="draft.certificateVersionId" placeholder="certver-..." /></label>
      <label><span>passwordSecretRef（PFX/JKS）</span><input v-model="draft.passwordSecretRef" placeholder="secret://pfx_password/sec_...#current" /></label>
      <label><span>Alias（可选）</span><input v-model="draft.alias" placeholder="例如 gcac-cert" /></label>
      <label><span>包含私钥（PEM）</span><select v-model="draft.containsPrivateKey"><option :value="false">否</option><option :value="true">是</option></select></label>
      <button class="gc-button" type="button" @click="planExport">规划导出</button>
      <button class="gc-button gc-button--danger" type="button" :disabled="!selectedFormat.supported" @click="generateExport">生成真实产物</button>
      <button class="gc-button" type="button" :disabled="!selectedFormat.supported" @click="createFormat">创建外部格式记录</button>
      <p>PFX/JKS 必须使用后端已有的 passwordSecretRef；页面不接收明文导出密码。</p>
      <p v-if="actionError" class="certificate-formats__error">{{ actionError }}</p>
      <p v-if="actionRequestId">requestId：{{ actionRequestId }}</p>
    </section>

    <GcEmptyState v-if="error" title="格式产物加载失败" :description="error.message"><p>错误码：{{ error.errorCode }}</p><p>requestId：{{ error.requestId }}</p></GcEmptyState>
    <GcDataTable v-else :columns="columns" :rows="rows" :loading="loading" empty-text="暂无格式产物">
      <template #toolbar><strong>列表 requestId：{{ requestId || '等待请求' }}</strong></template>
      <template #cell-status="{ row }"><GcStatusTag :status="String(row.status ?? 'UNKNOWN')" /></template>
    </GcDataTable>
  </section>
</template>

<style scoped>
.certificate-formats { display: grid; gap: var(--gc-space-5); }
.certificate-formats__actions { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--gc-space-3); align-items: end; padding: 20px; }
.certificate-formats__actions label { display: grid; gap: var(--gc-space-1); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); font-weight: 850; }
.certificate-formats__actions input, .certificate-formats__actions select { border: 1px solid var(--gc-color-border); border-radius: 12px; padding: 10px 12px; }
.certificate-formats__actions p { grid-column: 1 / -1; margin: 0; color: var(--gc-color-text-muted); font-weight: 800; }
.certificate-formats__error { color: var(--gc-color-danger) !important; }
@media (max-width: 1000px) { .certificate-formats__actions { grid-template-columns: 1fr; } }
</style>
