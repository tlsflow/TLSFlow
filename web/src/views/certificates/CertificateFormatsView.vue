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
import { GcButton, GcCard, GcDataTable, GcEmptyState, GcPageHeader, GcStatusTag } from '@/design-system/components'
import type { DataTableColumn } from '@/design-system/components/GcDataTable.vue'
import type { StatusTone } from '@/design-system/status/status-map'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
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

function formatDateTime(value: unknown) {
  const raw = String(value ?? '')
  return formatBrowserLocalTime(raw) || t('agents.common.none')
}

function formatStatusTone(value: unknown): StatusTone {
  switch (String(value ?? '').toUpperCase()) {
    case 'READY':
    case 'AVAILABLE':
    case 'SUCCESS':
    case 'COMPLETED':
      return 'success'
    case 'PENDING':
    case 'PROCESSING':
    case 'CREATING':
      return 'info'
    case 'UNSUPPORTED':
    case 'WARNING':
      return 'warning'
    case 'FAILED':
    case 'ERROR':
      return 'danger'
    default:
      return 'muted'
  }
}

onMounted(() => void loadFormats())
</script>

<template>
  <section class="gc-page certificate-formats">
    <GcPageHeader :title="t('certificates.formats.title')" :description="t('certificates.formats.description', { id: certificateId })">
      <template #actions>
        <RouterLink class="gc-button gc-button--secondary certificate-formats__back" :to="`/certificates/${certificateId}`">
          {{ t('certificates.usages.backDetail') }}
        </RouterLink>
      </template>
    </GcPageHeader>

    <GcCard as="section" class="certificate-formats__form-card">
      <template #header>
        <div class="certificate-formats__form-header">
          <h2>{{ t('certificates.formats.create') }}</h2>
          <p>{{ t('certificates.formats.hint') }}</p>
        </div>
      </template>

      <form class="certificate-formats__form" @submit.prevent="createFormat">
        <label class="gc-form-field">
          <span>{{ t('certificates.formats.fields.targetFormat') }}</span>
          <select v-model="draft.format">
            <option v-for="item in formatOptions" :key="item.value" :value="item.value">
              {{ t('certificates.formats.optionAvailable', { label: item.label }) }}
            </option>
          </select>
        </label>
        <label class="gc-form-field">
          <span>{{ t('certificates.formats.fields.versionId') }}</span>
          <input v-model="draft.certificateVersionId" placeholder="certver-..." />
        </label>
        <label class="gc-form-field">
          <span>{{ t('certificates.formats.fields.passwordSecretRef') }}</span>
          <input v-model="draft.passwordSecretRef" placeholder="secret://pfx_password/sec_...#current" />
        </label>
        <label class="gc-form-field">
          <span>{{ t('certificates.formats.fields.alias') }}</span>
          <input v-model="draft.alias" :placeholder="t('certificates.formats.placeholders.alias')" />
        </label>
        <label class="gc-form-field">
          <span>{{ t('certificates.formats.fields.containsPrivateKey') }}</span>
          <select v-model="draft.containsPrivateKey">
            <option :value="false">{{ t('agents.common.no') }}</option>
            <option :value="true">{{ t('agents.common.yes') }}</option>
          </select>
        </label>
        <div class="certificate-formats__form-actions">
          <GcButton type="submit" variant="primary" :disabled="!selectedFormat.supported">
            {{ t('certificates.formats.create') }}
          </GcButton>
        </div>
        <p v-if="actionError" class="certificate-formats__error" role="alert">{{ actionError }}</p>
      </form>
    </GcCard>

    <GcEmptyState v-if="error" :title="t('certificates.formats.loadFailed')" :description="error.message">
      <p>{{ t('businessPage.errorCode', { code: error.errorCode }) }}</p>
    </GcEmptyState>
    <GcDataTable v-else dense :columns="columns" :rows="rows" :loading="loading" :empty-text="t('certificates.formats.empty')" pagination>
      <template #toolbar>
        <div class="certificate-formats__table-toolbar">
          <strong>{{ t('certificates.formats.toolbar') }}</strong>
          <span>{{ t('businessPage.total', { count: rows.length }) }}</span>
        </div>
      </template>
      <template #cell-status="{ row }">
        <GcStatusTag :status="String(row.status ?? 'UNKNOWN')" :tone="formatStatusTone(row.status)" />
      </template>
      <template #cell-createdAt="{ row }">{{ formatDateTime(row.createdAt) }}</template>
    </GcDataTable>
  </section>
</template>

<style scoped>
.certificate-formats {
  display: grid;
  gap: var(--gc-space-5);
}

.certificate-formats__form-header {
  display: grid;
  gap: var(--gc-space-1);
}

.certificate-formats__form-header h2,
.certificate-formats__form-header p,
.certificate-formats__error {
  margin: 0;
}

.certificate-formats__form-header h2 {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-lg);
  line-height: var(--gc-line-height-tight);
}

.certificate-formats__form-header p {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  line-height: var(--gc-line-height-relaxed);
}

.certificate-formats__form {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  align-items: end;
  gap: var(--gc-space-4);
}

.certificate-formats__form-actions,
.certificate-formats__error {
  grid-column: 1 / -1;
}

.certificate-formats__form-actions {
  display: flex;
  justify-content: flex-end;
}

.certificate-formats__error {
  border: var(--gc-border-width-default) solid var(--gc-color-danger-border);
  border-radius: var(--gc-radius-md);
  padding: var(--gc-space-3);
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-soft);
  font-size: var(--gc-font-size-sm);
  line-height: var(--gc-line-height-relaxed);
}

.certificate-formats__table-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-3);
}

.certificate-formats__table-toolbar strong {
  color: var(--gc-color-text-strong);
}

.certificate-formats__table-toolbar span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
}

@media (max-width: 72rem) {
  .certificate-formats__form {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 48rem) {
  .certificate-formats__form {
    grid-template-columns: 1fr;
  }

  .certificate-formats__form-actions {
    justify-content: stretch;
  }

  .certificate-formats__form-actions :deep(.gc-button) {
    width: 100%;
  }
}
</style>
