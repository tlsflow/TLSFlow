<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { ApiClientError } from '@/api/client'
import { importCertificate } from '@/api/modules/certificates.api'
import { GcEmptyState, GcPageHeader } from '@/design-system/components'

interface ImportDraft {
  format: 'PEM' | 'DER' | 'PFX' | 'JKS' | 'P7B'
  certificatePem: string
  certificateDerBase64: string
  privateKeyPem: string
  name: string
  tagsText: string
  sourceType: string
}

type ImportFormat = ImportDraft['format']

const formatOptions: Array<{ key: ImportFormat; label: string; supported: boolean; hint: string }> = [
  { key: 'PEM', label: 'PEM', supported: true, hint: '后端支持：certificatePem，可粘贴完整证书链。' },
  { key: 'DER', label: 'DER', supported: true, hint: '后端支持：certificateDerBase64，先转 Base64 再提交。' },
  { key: 'PFX', label: 'PFX / PKCS#12', supported: false, hint: '后端导入接口暂未声明 PFX 请求体，当前只展示入口。' },
  { key: 'JKS', label: 'JKS', supported: false, hint: '后端导入接口暂未声明 JKS 请求体，当前只展示入口。' },
  { key: 'P7B', label: 'P7B / PKCS#7', supported: false, hint: '后端导入接口暂未声明 P7B 请求体，当前只展示入口。' }
]

const draft = reactive<ImportDraft>({
  format: 'PEM',
  certificatePem: '',
  certificateDerBase64: '',
  privateKeyPem: '',
  name: '',
  tagsText: '',
  sourceType: 'manual'
})
const loading = ref(false)
const error = ref('')
const requestId = ref('')
const resultId = ref('')

const selectedFormat = computed(() => formatOptions.find((item) => item.key === draft.format) ?? formatOptions[0])
const materialReady = computed(() => draft.format === 'PEM' ? Boolean(draft.certificatePem.trim()) : draft.format === 'DER' ? Boolean(draft.certificateDerBase64.trim()) : false)
const submitDisabled = computed(() => loading.value || !selectedFormat.value.supported || !materialReady.value)

function buildPayload() {
  const tags = draft.tagsText.split(',').map((tag) => tag.trim()).filter(Boolean)
  return {
    ...(draft.certificatePem.trim() ? { certificatePem: draft.certificatePem.trim() } : {}),
    ...(draft.certificateDerBase64.trim() ? { certificateDerBase64: draft.certificateDerBase64.trim() } : {}),
    ...(draft.privateKeyPem.trim() ? { privateKeyPem: draft.privateKeyPem.trim() } : {}),
    ...(draft.name.trim() ? { name: draft.name.trim() } : {}),
    ...(tags.length ? { tags } : {}),
    sourceType: draft.sourceType
  }
}

async function submitImport() {
  if (!selectedFormat.value.supported) {
    error.value = `${selectedFormat.value.label} 后端暂不支持导入。`
    return
  }
  if (!materialReady.value) {
    error.value = '必须提供当前格式对应的证书材料。'
    return
  }
  loading.value = true
  error.value = ''
  requestId.value = ''
  resultId.value = ''
  try {
    const result = await importCertificate(buildPayload())
    requestId.value = result.requestId
    resultId.value = String(result.data?.id ?? result.data?.certificateId ?? result.data?.certificateAssetId ?? '')
  } catch (cause) {
    if (cause instanceof ApiClientError) {
      error.value = `${cause.message}（${cause.errorCode}）`
      requestId.value = cause.requestId
      return
    }
    error.value = cause instanceof Error ? cause.message : '导入失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <section class="gc-page certificate-import-page">
    <GcPageHeader title="导入证书" description="展示后端真实支持能力：PEM/DER 可提交；PFX/JKS/P7B 仅保留入口并明确不可用。">
      <template #actions>
        <RouterLink class="gc-button" to="/certificates">返回证书列表</RouterLink>
      </template>
    </GcPageHeader>

    <section class="certificate-import-page__capabilities" aria-label="后端导入能力">
      <button
        v-for="format in formatOptions"
        :key="format.key"
        class="gc-card certificate-import-page__format"
        :class="{ 'certificate-import-page__format--active': draft.format === format.key, 'certificate-import-page__format--disabled': !format.supported }"
        type="button"
        @click="draft.format = format.key"
      >
        <strong>{{ format.label }}</strong>
        <span>{{ format.supported ? '后端支持' : '不可用' }}</span>
        <p>{{ format.hint }}</p>
      </button>
    </section>

    <GcEmptyState v-if="!selectedFormat.supported" title="该格式暂不可用" :description="selectedFormat.hint">
      <p>不要在前端伪造 PFX/JKS/P7B 导入。等后端契约声明字段后再接入。</p>
    </GcEmptyState>

    <form class="gc-card certificate-import-page__form" @submit.prevent="submitImport">
      <label v-if="draft.format === 'PEM'" class="certificate-import-page__field certificate-import-page__field--full">
        <span>证书 PEM / 证书链</span>
        <textarea v-model="draft.certificatePem" rows="10" spellcheck="false" placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----" />
      </label>
      <label v-if="draft.format === 'DER'" class="certificate-import-page__field certificate-import-page__field--full">
        <span>DER Base64</span>
        <textarea v-model="draft.certificateDerBase64" rows="5" spellcheck="false" placeholder="把 DER 二进制转为 Base64 后粘贴" />
      </label>
      <label class="certificate-import-page__field certificate-import-page__field--full">
        <span>私钥 PEM（可选）</span>
        <textarea v-model="draft.privateKeyPem" rows="5" spellcheck="false" placeholder="-----BEGIN PRIVATE KEY-----" />
      </label>
      <label class="certificate-import-page__field">
        <span>资产名称（可选）</span>
        <input v-model="draft.name" placeholder="默认使用 CN 或 SAN" />
      </label>
      <label class="certificate-import-page__field">
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
      <label class="certificate-import-page__field certificate-import-page__field--full">
        <span>标签（逗号分隔）</span>
        <input v-model="draft.tagsText" placeholder="prod, nginx, wildcard" />
      </label>

      <p v-if="error" class="certificate-import-page__error">{{ error }}</p>
      <p v-if="requestId" class="certificate-import-page__request">requestId：{{ requestId }}</p>
      <p v-if="resultId" class="certificate-import-page__success">导入成功：{{ resultId }}</p>

      <footer>
        <button class="gc-button gc-button--danger" type="submit" :disabled="submitDisabled">{{ loading ? '导入中...' : '确认导入' }}</button>
      </footer>
    </form>
  </section>
</template>

<style scoped>
.certificate-import-page { display: grid; gap: var(--gc-space-5); }
.certificate-import-page__capabilities { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: var(--gc-space-3); }
.certificate-import-page__format { display: grid; gap: var(--gc-space-2); padding: 18px; text-align: left; cursor: pointer; }
.certificate-import-page__format strong { font-size: 18px; }
.certificate-import-page__format span { width: fit-content; border-radius: 999px; padding: 3px 9px; background: #e0f2fe; color: #075985; font-size: 12px; font-weight: 900; }
.certificate-import-page__format p { margin: 0; color: var(--gc-color-text-muted); line-height: 1.55; }
.certificate-import-page__format--active { border-color: #60a5fa; box-shadow: 0 0 0 4px rgb(96 165 250 / 12%); }
.certificate-import-page__format--disabled span { color: #991b1b; background: #fee2e2; }
.certificate-import-page__form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-4); padding: 24px; }
.certificate-import-page__field { display: grid; gap: var(--gc-space-2); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); font-weight: 850; }
.certificate-import-page__field--full, .certificate-import-page__form footer, .certificate-import-page__error, .certificate-import-page__request, .certificate-import-page__success { grid-column: 1 / -1; }
.certificate-import-page__field input, .certificate-import-page__field select, .certificate-import-page__field textarea { width: 100%; border: 1px solid var(--gc-color-border); border-radius: 12px; padding: 10px 12px; color: var(--gc-color-text); background: var(--gc-color-surface-muted); }
.certificate-import-page__field textarea { min-height: 110px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; }
.certificate-import-page__error { color: var(--gc-color-danger); font-weight: 850; }
.certificate-import-page__request { color: var(--gc-color-text-muted); font-weight: 800; }
.certificate-import-page__success { color: #047857; font-weight: 900; }
@media (max-width: 800px) { .certificate-import-page__form { grid-template-columns: 1fr; } }
</style>
