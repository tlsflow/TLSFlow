<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute } from 'vue-router'
import { ApiClientError } from '@/api/client'
import {
  createCertificateFormat,
  listCertificateFormats,
} from '@/api/modules/certificates.api'
import type { ApiRecord } from '@/api/modules/common'
import { GcDataTable, GcEmptyState, GcPageHeader, GcStatusTag } from '@/design-system/components'
import type { DataTableColumn } from '@/design-system/components/GcDataTable.vue'
import { toErrorState, type CertificatePageError } from './certificate-view-utils'

const route = useRoute()
const { t } = useI18n()
const certificateId = computed(() => String(route.params.id ?? ''))
const rows = ref<ApiRecord[]>([])
const loading = ref(false)
const actionError = ref('')
const error = ref<CertificatePageError | null>(null)
const draft = reactive({ format: 'PEM', certificateVersionId: '', containsPrivateKey: false, passwordSecretRef: '', alias: '' })
const formatOptions = [
  { value: 'PEM', label: 'PEM', supported: true },
  { value: 'DER', label: 'DER', supported: true },
  { value: 'PFX', label: 'PFX / PKCS#12', supported: true },
  { value: 'JKS', label: 'JKS', supported: true },
  { value: 'P7B', label: 'P7B / PKCS#7', supported: true },
]
const selectedFormat = computed(() => formatOptions.find((item) => item.value === draft.format) ?? formatOptions[0])
const columns = computed<DataTableColumn<ApiRecord>[]>(() => [
  { key: 'format', title: t('certificates.formats.columns.format') },
  { key: 'status', title: t('certificates.formats.columns.status') },
  { key: 'certificateVersionId', title: t('certificates.formats.columns.certificateVersionId') },
  { key: 'secretRef', title: t('certificates.formats.columns.secretRef') },
  { key: 'createdAt', title: t('certificates.formats.columns.createdAt') },
])

async function loadFormats() {
  loading.value = true
  error.value = null
  try {
    const result = await listCertificateFormats({ page: 1, pageSize: 100, filters: { certificateId: certificateId.value, certificateAssetId: certificateId.value } })
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
    ...(draft.alias.trim() ? { parameters: { alias: draft.alias.trim() } } : {}),
  }
}

async function createFormat() {
  actionError.value = ''
  if (!selectedFormat.value.supported) {
    actionError.value = t('certificates.formats.unsupported', { format: selectedFormat.value.label })
    return
  }
  try {
    await createCertificateFormat(payload())
    await loadFormats()
  } catch (cause) {
    if (cause instanceof ApiClientError) {
      actionError.value = `${cause.message}（${cause.errorCode}）`
    } else {
      actionError.value = cause instanceof Error ? cause.message : t('certificates.formats.createFailed')
    }
  }
}

onMounted(() => void loadFormats())
</script>

<template>
  <section class="gc-page certificate-formats">
    <GcPageHeader :title="t('certificates.formats.title')" :description="t('certificates.formats.description', { id: certificateId })">
      <template #actions><RouterLink class="gc-button" :to="`/certificates/${certificateId}`">{{ t('certificates.usages.backDetail') }}</RouterLink></template>
    </GcPageHeader>

    <section class="gc-card certificate-formats__actions">
      <label><span>{{ t('certificates.formats.fields.targetFormat') }}</span><select v-model="draft.format"><option v-for="item in formatOptions" :key="item.value" :value="item.value">{{ t('certificates.formats.optionAvailable', { label: item.label }) }}</option></select></label>
      <label><span>{{ t('certificates.formats.fields.versionId') }}</span><input v-model="draft.certificateVersionId" placeholder="certver-..." /></label>
      <label><span>{{ t('certificates.formats.fields.passwordSecretRef') }}</span><input v-model="draft.passwordSecretRef" placeholder="secret://pfx_password/sec_...#current" /></label>
      <label><span>{{ t('certificates.formats.fields.alias') }}</span><input v-model="draft.alias" :placeholder="t('certificates.formats.placeholders.alias')" /></label>
      <label><span>{{ t('certificates.formats.fields.containsPrivateKey') }}</span><select v-model="draft.containsPrivateKey"><option :value="false">{{ t('agents.common.no') }}</option><option :value="true">{{ t('agents.common.yes') }}</option></select></label>
      <button class="gc-button" type="button" :disabled="!selectedFormat.supported" @click="createFormat">{{ t('certificates.formats.create') }}</button>
      <p>{{ t('certificates.formats.hint') }}</p>
      <p v-if="actionError" class="certificate-formats__error">{{ actionError }}</p>
    </section>

    <GcEmptyState v-if="error" :title="t('certificates.formats.loadFailed')" :description="error.message">
      <p>{{ t('businessPage.errorCode', { code: error.errorCode }) }}</p>
    </GcEmptyState>
    <GcDataTable v-else :columns="columns" :rows="rows" :loading="loading" :empty-text="t('certificates.formats.empty')">
      <template #toolbar><strong>{{ t('certificates.formats.toolbar') }}</strong></template>
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
