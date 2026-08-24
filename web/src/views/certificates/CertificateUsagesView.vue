<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { listCertificateUsages } from '@/api/modules/certificates.api'
import type { ApiRecord } from '@/api/modules/common'
import { GcDataTable, GcEmptyState, GcPageHeader, GcStatusTag } from '@/design-system/components'
import type { DataTableColumn } from '@/design-system/components/GcDataTable.vue'
import { toErrorState, type CertificatePageError } from './certificate-view-utils'

const route = useRoute()
const certificateId = computed(() => String(route.params.id ?? ''))
const rows = ref<ApiRecord[]>([])
const requestId = ref('')
const loading = ref(false)
const error = ref<CertificatePageError | null>(null)
const columns: DataTableColumn<ApiRecord>[] = [
  { key: 'domainName', title: '域名/目标' },
  { key: 'status', title: '状态' },
  { key: 'resourceType', title: '资源类型' },
  { key: 'resourceId', title: '资源 ID' },
  { key: 'updatedAt', title: '更新时间' }
]

async function loadUsages() {
  loading.value = true
  error.value = null
  try {
    const result = await listCertificateUsages({ page: 1, pageSize: 100, filters: { certificateId: certificateId.value } })
    requestId.value = result.requestId
    rows.value = [...(result.data?.items ?? [])]
  } catch (cause) {
    error.value = toErrorState(cause)
  } finally {
    loading.value = false
  }
}

onMounted(() => void loadUsages())
</script>

<template>
  <section class="gc-page certificate-subpage">
    <GcPageHeader title="证书使用关系" :description="`证书 ${certificateId} 的绑定、部署目标和资源引用。`">
      <template #actions>
        <RouterLink class="gc-button" :to="`/certificates/${certificateId}`">返回详情</RouterLink>
      </template>
    </GcPageHeader>
    <GcEmptyState v-if="error" title="使用关系加载失败" :description="error.message">
      <p>错误码：{{ error.errorCode }}</p><p>requestId：{{ error.requestId }}</p>
    </GcEmptyState>
    <GcDataTable v-else :columns="columns" :rows="rows" :loading="loading" empty-text="暂无使用关系">
      <template #toolbar><strong>requestId：{{ requestId || '等待请求' }}</strong></template>
      <template #cell-status="{ row }"><GcStatusTag :status="String(row.status ?? 'UNKNOWN')" /></template>
    </GcDataTable>
  </section>
</template>

<style scoped>.certificate-subpage { display: grid; gap: var(--gc-space-5); }</style>
