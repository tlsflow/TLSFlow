<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute } from 'vue-router'
import { listCertificateUsages } from '@/api/modules/certificates.api'
import type { ApiRecord } from '@/api/modules/common'
import { GcDataTable, GcEmptyState, GcPageHeader, GcStatusTag } from '@/design-system/components'
import type { DataTableColumn } from '@/design-system/components/GcDataTable.vue'
import type { StatusTone } from '@/design-system/status/status-map'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import { toErrorState, type CertificatePageError } from './certificate-view-utils'

const route = useRoute()
const { t } = useI18n()
const certificateId = computed(() => String(route.params.id ?? ''))
const rows = ref<ApiRecord[]>([])
const loading = ref(false)
const error = ref<CertificatePageError | null>(null)
const columns = computed<DataTableColumn<ApiRecord>[]>(() => [
  { key: 'domainName', title: t('certificates.usages.columns.domainName') },
  { key: 'status', title: t('certificates.usages.columns.status') },
  { key: 'resourceType', title: t('certificates.usages.columns.resourceType') },
  { key: 'resourceId', title: t('certificates.usages.columns.resourceId') },
  { key: 'updatedAt', title: t('certificates.usages.columns.updatedAt') },
])

async function loadUsages() {
  loading.value = true
  error.value = null
  try {
    const result = await listCertificateUsages({ page: 1, pageSize: 100, filters: { certificateId: certificateId.value } })
    rows.value = [...(result.data?.items ?? [])]
  } catch (cause) {
    error.value = toErrorState(cause)
  } finally {
    loading.value = false
  }
}

function formatDateTime(value: unknown) {
  const raw = String(value ?? '')
  return formatBrowserLocalTime(raw) || t('agents.common.none')
}

function usageStatusTone(value: unknown): StatusTone {
  switch (String(value ?? '').toUpperCase()) {
    case 'ACTIVE':
    case 'SUCCESS':
    case 'HEALTHY':
    case 'ONLINE':
      return 'success'
    case 'PENDING':
    case 'RUNNING':
    case 'PROCESSING':
      return 'info'
    case 'DEGRADED':
    case 'WARNING':
      return 'warning'
    case 'FAILED':
    case 'ERROR':
    case 'OFFLINE':
      return 'danger'
    default:
      return 'muted'
  }
}

onMounted(() => void loadUsages())
</script>

<template>
  <section class="gc-page certificate-subpage">
    <GcPageHeader :title="t('certificates.usages.title')" :description="t('certificates.usages.description', { id: certificateId })">
      <template #actions>
        <RouterLink class="gc-button gc-button--secondary certificate-usages__back" :to="`/certificates/${certificateId}`">
          {{ t('certificates.usages.backDetail') }}
        </RouterLink>
      </template>
    </GcPageHeader>
    <GcEmptyState v-if="error" :title="t('certificates.usages.loadFailed')" :description="error.message">
      <p>{{ t('businessPage.errorCode', { code: error.errorCode }) }}</p>
    </GcEmptyState>
    <GcDataTable v-else dense :columns="columns" :rows="rows" :loading="loading" :empty-text="t('certificates.usages.empty')">
      <template #toolbar>
        <div class="certificate-usages__table-toolbar">
          <strong>{{ t('certificates.usages.toolbar') }}</strong>
          <span>{{ t('businessPage.total', { count: rows.length }) }}</span>
        </div>
      </template>
      <template #cell-status="{ row }">
        <GcStatusTag :status="String(row.status ?? 'UNKNOWN')" :tone="usageStatusTone(row.status)" />
      </template>
      <template #cell-updatedAt="{ row }">{{ formatDateTime(row.updatedAt) }}</template>
    </GcDataTable>
  </section>
</template>

<style scoped>
.certificate-subpage {
  display: grid;
  gap: var(--gc-space-5);
}

.certificate-usages__table-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-3);
}

.certificate-usages__table-toolbar strong {
  color: var(--gc-color-text-strong);
}

.certificate-usages__table-toolbar span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
}
</style>
