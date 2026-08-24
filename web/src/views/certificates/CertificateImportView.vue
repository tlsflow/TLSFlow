<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
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
const { t } = useI18n()
const draft = reactive(createCertificateImportDraft())
const loading = ref(false)
const validating = ref(false)
const error = ref('')
const resultId = ref('')
const validationResult = ref<CertificateImportValidationResult | null>(null)

async function validateImport() {
  if (!isMaterialReady(draft)) {
    error.value = t('certificates.import.errors.materialRequiredBeforeValidate')
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
    error.value = cause instanceof Error ? cause.message : t('certificates.import.errors.validateFailed')
  } finally {
    validating.value = false
  }
}

async function submitImport() {
  if (!validationResult.value?.importable) {
    error.value = t('certificates.import.errors.needPassedValidation')
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
    error.value = cause instanceof Error ? cause.message : t('certificates.import.errors.importFailed')
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
      :title="t('certificates.import.title')"
      :description="t('certificates.import.description')"
    >
      <template #actions>
        <RouterLink class="gc-button gc-button--secondary certificate-import-page__back" to="/certificates">
          {{ t('certificates.import.backList') }}
        </RouterLink>
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
