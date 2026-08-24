<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiClientError } from '@/api/client'
import { importCertificate, validateCertificateImport } from '@/api/modules/certificates.api'
import { GcModal } from '@/design-system/components'
import CertificateImportForm from './CertificateImportForm.vue'
import {
  buildCertificateImportPayload,
  type CertificateImportValidationResult,
  createCertificateImportDraft,
  isMaterialReady,
} from './certificate-import.shared'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  imported: [id: string]
}>()

const { t } = useI18n()
const draft = reactive(createCertificateImportDraft())
const loading = ref(false)
const validating = ref(false)
const error = ref('')
const resultId = ref('')
const validationResult = ref<CertificateImportValidationResult | null>(null)

const modelOpen = computed({
  get() {
    return props.open
  },
  set(value: boolean) {
    emit('update:open', value)
  },
})

function resetState(): void {
  Object.assign(draft, createCertificateImportDraft())
  loading.value = false
  validating.value = false
  error.value = ''
  resultId.value = ''
  validationResult.value = null
}

watch(() => props.open, (open) => {
  if (open) resetState()
}, { immediate: true })

async function validateImport(): Promise<void> {
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
    error.value = cause instanceof ApiClientError
      ? `${cause.message}（${cause.errorCode}）`
      : cause instanceof Error ? cause.message : t('certificates.import.errors.validateFailed')
  } finally {
    validating.value = false
  }
}

async function submitImport(): Promise<void> {
  if (!validationResult.value?.importable) {
    error.value = t('certificates.import.errors.needPassedValidation')
    return
  }
  loading.value = true
  error.value = ''
  try {
    const result = await importCertificate(buildCertificateImportPayload(draft))
    resultId.value = String(result.data?.id ?? result.data?.certificateId ?? result.data?.certificateAssetId ?? '')
    emit('imported', resultId.value)
    modelOpen.value = false
  } catch (cause) {
    error.value = cause instanceof ApiClientError
      ? `${cause.message}（${cause.errorCode}）`
      : cause instanceof Error ? cause.message : t('certificates.import.errors.importFailed')
  } finally {
    loading.value = false
  }
}

function cancelImport(): void {
  modelOpen.value = false
}
</script>

<template>
  <GcModal
    v-model:open="modelOpen"
    size="lg"
    :title="t('certificates.importForm.source.manual.title')"
    :busy="loading || validating"
  >
    <CertificateImportForm
      :draft="draft"
      :loading="loading"
      :validating="validating"
      :error="error"
      :result-id="resultId"
      :validation-result="validationResult"
      :show-source="false"
      :show-format-description="false"
      :initial-step="'format'"
      @validate="validateImport"
      @submit="submitImport"
      @cancel="cancelImport"
    />
  </GcModal>
</template>
