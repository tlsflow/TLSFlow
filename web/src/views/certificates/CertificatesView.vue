<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiClientError } from '@/api/client'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import { importCertificate, listCertificates } from '@/api/modules/certificates.api'
import { GcModal } from '@/design-system/components'

interface CertificateImportDraft {
  certificatePem: string
  certificateDerBase64: string
  privateKeyPem: string
  name: string
  tagsText: string
  sourceType: string
}

const route = useRoute()
const router = useRouter()
const initialQuery = route?.query ?? {}
const pageRef = ref<InstanceType<typeof BusinessResourcePage> | null>(null)
const filters = reactive<Record<string, string>>({
  keyword: typeof initialQuery.keyword === 'string' ? initialQuery.keyword : '',
  certificateId: typeof initialQuery.certificateId === 'string' ? initialQuery.certificateId : '',
  status: typeof initialQuery.status === 'string' ? initialQuery.status : '',
  risk: typeof initialQuery.risk === 'string' ? initialQuery.risk : '',
  sourceType: typeof initialQuery.sourceType === 'string' ? initialQuery.sourceType : ''
})
const importDialogOpen = ref(false)
const importLoading = ref(false)
const importError = ref('')
const importRequestId = ref('')
const draft = reactive<CertificateImportDraft>({
  certificatePem: '',
  certificateDerBase64: '',
  privateKeyPem: '',
  name: '',
  tagsText: '',
  sourceType: 'manual'
})

const hasCertificateMaterial = computed(() => Boolean(draft.certificatePem.trim() || draft.certificateDerBase64.trim()))
const importDisabled = computed(() => importLoading.value || !hasCertificateMaterial.value)

const config: BusinessPageConfig = {
  title: '证书资产',
  description: '证书库、格式、来源、私钥引用、使用关系和到期风险入口。',
  readPermission: 'certificate.asset.read',
  primaryPermission: 'certificate.import',
  primaryActionLabel: '导入证书',
  primaryAction: openImportDialog,
  moduleName: 'certificates',
  resourceName: '证书',
  defaultStatus: 'MANAGED',
  defaultRisk: 'HIGH',
  columns: [
    { key: 'name', title: '主域名/名称', candidates: ['primaryDomain', 'name', 'commonName'] },
    { key: 'status', title: '状态', candidates: ['status', 'state'] },
    { key: 'risk', title: '风险', candidates: ['risk', 'riskLevel'] },
    { key: 'fingerprint', title: '指纹', candidates: ['fingerprintSha256', 'fingerprint', 'currentVersion.fingerprintSha256'] },
    { key: 'expiresAt', title: '到期时间', candidates: ['notAfter', 'expiresAt', 'currentVersion.notAfter'], kind: 'date' }
  ],
  metrics: [
    { title: '证书总数', description: '按域名、SAN、指纹和来源分页查询。', status: 'MANAGED', risk: 'MEDIUM' },
    { title: '高危待处理', description: '过期、私钥缺失或链异常证书。', status: 'EXPIRED', risk: 'HIGH' }
  ],
  detailFields: [
    { label: '证书 ID', candidates: ['id', 'certificateId'] },
    { label: '主域名', candidates: ['primaryDomain', 'commonName', 'name'] },
    { label: 'SAN', candidates: ['subjectAltNames', 'sans'] },
    { label: '指纹', candidates: ['fingerprintSha256', 'fingerprint', 'currentVersion.fingerprintSha256'] },
    { label: '私钥状态', candidates: ['hasPrivateKey', 'currentVersion.hasPrivateKey'] },
    { label: '到期时间', candidates: ['notAfter', 'expiresAt', 'currentVersion.notAfter'] }
  ],
  contextLinks: [
    { label: '查看详情', to: '/certificates/:id', queryKey: 'id', candidates: ['id', 'certificateId'] },
    { label: '查看绑定', to: '/bindings', queryKey: 'certificateId', candidates: ['id', 'certificateId'] },
    { label: '查看部署计划', to: '/deployment-plans', queryKey: 'certificateId', candidates: ['id', 'certificateId'] }
  ],
  emptyTitle: '暂无证书资产',
  emptyDescription: '请通过导入证书或配置证书来源接入数据；不要把私钥明文写进 URL 或日志。',
  filters: [
    { key: 'keyword', label: '关键字', placeholder: '域名 / SAN / 指纹' },
    { key: 'certificateId', label: '证书 ID', placeholder: 'cert-...' },
    { key: 'status', label: '状态', type: 'select', options: [
      { label: 'MANAGED', value: 'MANAGED' },
      { label: 'EXPIRED', value: 'EXPIRED' },
      { label: 'REVOKED', value: 'REVOKED' }
    ] },
    { key: 'risk', label: '风险', type: 'select', options: [
      { label: 'LOW', value: 'LOW' },
      { label: 'MEDIUM', value: 'MEDIUM' },
      { label: 'HIGH', value: 'HIGH' },
      { label: 'CRITICAL', value: 'CRITICAL' }
    ] },
    { key: 'sourceType', label: '来源', type: 'select', options: [
      { label: 'manual', value: 'manual' },
      { label: 'acme', value: 'acme' },
      { label: 'adcs', value: 'adcs' },
      { label: 'enterprise_ca', value: 'enterprise_ca' },
      { label: 'external_api', value: 'external_api' },
      { label: 'certd', value: 'certd' },
      { label: 'allinssl', value: 'allinssl' }
    ] }
  ],
  filterValues: filters,
  onFiltersChange: updateFilters,
  load: () => listCertificates({ page: 1, pageSize: 20, sort: 'updatedAt:desc', keyword: filters.keyword, filters: { certificateId: filters.certificateId, status: filters.status, risk: filters.risk, sourceType: filters.sourceType } }),
  actions: [
    { label: '批量导入证书', permission: 'certificate.import', run: async () => router.push('/certificates/import') },
    { label: '确认导入私钥材料', permission: 'certificate.import', danger: true, confirmText: 'IMPORT', riskText: '导入会保存私钥到受保护 Secret，响应和日志不得泄露私钥明文。', run: async () => openImportDialog() }
  ]
}

function updateFilters(nextFilters: Record<string, string>) {
  Object.keys(filters).forEach((key) => { filters[key] = nextFilters[key] ?? '' })
  const query = Object.fromEntries(Object.entries(filters).filter(([, value]) => value))
  void router?.replace?.({ path: '/certificates', query })
}

function openImportDialog() {
  importError.value = ''
  importRequestId.value = ''
  importDialogOpen.value = true
}

function closeImportDialog() {
  if (importLoading.value) return
  importDialogOpen.value = false
}

function resetDraft() {
  draft.certificatePem = ''
  draft.certificateDerBase64 = ''
  draft.privateKeyPem = ''
  draft.name = ''
  draft.tagsText = ''
  draft.sourceType = 'manual'
}

function buildImportPayload() {
  const tags = draft.tagsText.split(',').map((tag) => tag.trim()).filter(Boolean)
  return {
    ...(draft.certificatePem.trim() ? { certificatePem: draft.certificatePem.trim() } : {}),
    ...(draft.certificateDerBase64.trim() ? { certificateDerBase64: draft.certificateDerBase64.trim() } : {}),
    ...(draft.privateKeyPem.trim() ? { privateKeyPem: draft.privateKeyPem.trim() } : {}),
    ...(draft.name.trim() ? { name: draft.name.trim() } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    sourceType: draft.sourceType
  }
}

async function submitImport() {
  if (!hasCertificateMaterial.value) {
    importError.value = '必须提供证书 PEM 或 DER Base64。'
    return
  }
  importLoading.value = true
  importError.value = ''
  importRequestId.value = ''
  try {
    const result = await importCertificate(buildImportPayload())
    importRequestId.value = result.requestId
    importDialogOpen.value = false
    resetDraft()
    await pageRef.value?.reload()
  } catch (cause) {
    if (cause instanceof ApiClientError) {
      importError.value = `${cause.message}（${cause.errorCode}）`
      importRequestId.value = cause.requestId
      return
    }
    importError.value = cause instanceof Error ? cause.message : '导入失败，请检查输入材料。'
  } finally {
    importLoading.value = false
  }
}
</script>

<template>
  <BusinessResourcePage ref="pageRef" :config="config" />

  <GcModal
    v-model:open="importDialogOpen"
    title="导入证书版本"
    description="粘贴证书 PEM 链或单张 DER Base64；私钥可选，提交后只保存到后端 Secret，不会在响应中回显。"
    size="xl"
  >
    <section class="certificate-import">
      <p class="certificate-import__hint">
        粘贴证书 PEM 链或单张 DER Base64；私钥可选，提交后只保存到后端 Secret，不会在响应中回显。
      </p>

      <label class="certificate-import__field certificate-import__field--full">
        <span>证书 PEM</span>
        <textarea v-model="draft.certificatePem" rows="8" spellcheck="false" placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----" />
      </label>

      <label class="certificate-import__field certificate-import__field--full">
        <span>DER Base64</span>
        <textarea v-model="draft.certificateDerBase64" rows="3" spellcheck="false" placeholder="没有 PEM 时填写 DER Base64" />
      </label>

      <label class="certificate-import__field certificate-import__field--full">
        <span>私钥 PEM（可选）</span>
        <textarea v-model="draft.privateKeyPem" rows="5" spellcheck="false" placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----" />
      </label>

      <div class="certificate-import__grid">
        <label class="certificate-import__field">
          <span>资产名称（可选）</span>
          <input v-model="draft.name" placeholder="默认使用 CN 或 SAN" />
        </label>
        <label class="certificate-import__field">
          <span>来源类型</span>
          <select v-model="draft.sourceType">
            <option value="manual">manual</option>
            <option value="acme">acme</option>
            <option value="adcs">adcs</option>
            <option value="enterprise_ca">enterprise_ca</option>
            <option value="external_api">external_api</option>
            <option value="certd">certd</option>
            <option value="allinssl">allinssl</option>
          </select>
        </label>
      </div>

      <label class="certificate-import__field certificate-import__field--full">
        <span>标签（逗号分隔）</span>
        <input v-model="draft.tagsText" placeholder="prod, nginx, wildcard" />
      </label>

      <p v-if="importError" class="certificate-import__error">{{ importError }}</p>
      <p v-if="importRequestId" class="certificate-import__request">requestId：{{ importRequestId }}</p>

    </section>

    <template #actions>
      <button class="gc-button" type="button" :disabled="importLoading" @click="closeImportDialog">取消</button>
      <button class="gc-button gc-button--danger" type="button" :disabled="importDisabled" @click="submitImport">
        {{ importLoading ? '导入中...' : '确认导入' }}
      </button>
    </template>
  </GcModal>
</template>

<style scoped>
.certificate-import {
  display: grid;
  gap: var(--gc-space-4);
}
.certificate-import__hint,
.certificate-import__error,
.certificate-import__request {
  margin: 0;
}
.certificate-import__hint,
.certificate-import__request {
  color: var(--gc-color-text-muted);
  font-weight: 750;
}
.certificate-import__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-3);
}
.certificate-import__field {
  display: grid;
  gap: var(--gc-space-2);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: 850;
}
.certificate-import__field--full {
  grid-column: 1 / -1;
}
.certificate-import__field input,
.certificate-import__field select,
.certificate-import__field textarea {
  width: 100%;
  border: 1px solid var(--gc-color-border);
  border-radius: 12px;
  padding: 10px 12px;
  color: var(--gc-color-text);
  background: var(--gc-color-surface-muted);
  outline: none;
}
.certificate-import__field textarea {
  min-height: 92px;
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}
.certificate-import__field input:focus,
.certificate-import__field select:focus,
.certificate-import__field textarea:focus {
  border-color: #60a5fa;
  box-shadow: 0 0 0 4px rgb(96 165 250 / 14%);
  background: #fff;
}
.certificate-import__error {
  color: var(--gc-color-danger);
  font-weight: 850;
}
.certificate-import__footer {
  justify-content: flex-end;
  padding-top: var(--gc-space-2);
  border-top: 1px solid var(--gc-color-border);
}
@media (max-width: 760px) {
  .certificate-import__grid {
    grid-template-columns: 1fr;
  }
}
</style>
