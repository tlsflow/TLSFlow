<script setup lang="ts">
import { reactive, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { ApiClientError } from '@/api/client'
import { importCertificate, validateCertificateImport } from '@/api/modules/certificates.api'
import { GcPageHeader } from '@/design-system/components'
import CertificateImportForm from './CertificateImportForm.vue'
import {
  buildCertificateImportPayload,
  type CertificateImportValidationResult,
  createCertificateImportDraft,
  isMaterialReady,
} from './certificate-import.shared'

const router = useRouter()
const draft = reactive(createCertificateImportDraft())
const loading = ref(false)
const validating = ref(false)
const error = ref('')
const resultId = ref('')
const validationResult = ref<CertificateImportValidationResult | null>(null)

async function validateImport() {
  if (!isMaterialReady(draft)) {
    error.value = '必须先完成导入材料填写，才能开始校验。'
    validationResult.value = null
    return
  }
  validating.value = true
  error.value = ''
  validationResult.value = null
  try {
    const result = await validateCertificateImport(buildCertificateImportPayload(draft))
    validationResult.value = result.data as unknown as CertificateImportValidationResult
  } catch (cause) {
    if (cause instanceof ApiClientError) {
      error.value = `${cause.message}（${cause.errorCode}）`
      return
    }
    error.value = cause instanceof Error ? cause.message : '校验失败'
  } finally {
    validating.value = false
  }
}

async function submitImport() {
  if (!validationResult.value?.importable) {
    error.value = '请先完成第 3 步校验，并确保校验通过后再导入。'
    return
  }
  loading.value = true
  error.value = ''
  resultId.value = ''
  try {
    const result = await importCertificate(buildCertificateImportPayload(draft))
    resultId.value = String(result.data?.id ?? result.data?.certificateId ?? result.data?.certificateAssetId ?? '')
  } catch (cause) {
    if (cause instanceof ApiClientError) {
      error.value = `${cause.message}（${cause.errorCode}）`
      return
    }
    error.value = cause instanceof Error ? cause.message : '导入失败'
  } finally {
    loading.value = false
  }
}

function cancelImport() {
  void router.push('/certificates')
}
</script>

<template>
  <section class="gc-page certificate-import-page">
    <GcPageHeader
      title="导入证书"
      description="当前仅支持 PEM + KEY 和 PFX；PFX 仅支持文件导入。导入材料必须包含服务器证书、完整中间证书链和私钥，根证书不是强制项。"
    >
      <template #actions>
        <RouterLink class="gc-button" to="/certificates">返回证书列表</RouterLink>
      </template>
    </GcPageHeader>

    <CertificateImportForm
      :draft="draft"
      :loading="loading"
      :validating="validating"
      :error="error"
      :result-id="resultId"
      :validation-result="validationResult"
      @validate="validateImport"
      @submit="submitImport"
      @cancel="cancelImport"
    />
  </section>
</template>

<style scoped>
.certificate-import-page {
  display: grid;
  gap: var(--gc-space-5);
}
</style>
