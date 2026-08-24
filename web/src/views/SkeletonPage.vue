<script setup lang="ts">
import { computed } from 'vue'
import { GcCapabilityBadge, GcDataTable, GcEmptyState, GcExecutionLogViewer, GcPageHeader, GcRiskBadge, GcSecretInput, GcStatusTag } from '@/design-system/components'
import type { DataTableColumn } from '@/design-system/components/GcDataTable.vue'
import type { ExecutionLogLine } from '@/design-system/components/GcExecutionLogViewer.vue'

const props = defineProps<{
  title: string
  description: string
  moduleName: string
  risk?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  status?: string
}>()

interface SkeletonRow extends Record<string, unknown> {
  readonly id: string
  readonly name: string
  readonly status: string
  readonly risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
}

const columns: DataTableColumn<SkeletonRow>[] = [
  { key: 'name', title: '名称' },
  { key: 'status', title: '状态' },
  { key: 'risk', title: '风险等级' },
  { key: 'id', title: '资源 ID' }
]

const rows = computed<SkeletonRow[]>(() => [
  {
    id: `${props.moduleName}-placeholder`,
    name: `${props.title}占位资源`,
    status: props.status ?? 'READY',
    risk: props.risk ?? 'LOW'
  }
])

const logs: ExecutionLogLine[] = [
  {
    id: 'log-placeholder',
    time: new Date().toISOString(),
    level: 'info',
    step: 'skeleton',
    message: '执行日志查看器占位：后续业务页面接入真实日志流。',
    requestId: 'req_placeholder'
  }
]
</script>

<template>
  <section class="gc-page">
    <GcPageHeader :title="title" :description="description">
      <template #actions>
        <button class="gc-button gc-button--primary" type="button">主操作占位</button>
      </template>
    </GcPageHeader>

    <div class="gc-card gc-page__toolbar">
      <div>
        <GcStatusTag :status="status ?? 'READY'" />
        <GcRiskBadge :risk="risk ?? 'LOW'" />
        <GcCapabilityBadge capability="file.write" :available="true" confidence="mock" />
      </div>
      <GcSecretInput placeholder="SecretRef 占位输入" />
    </div>

    <GcDataTable :columns="columns" :rows="rows">
      <template #cell-status="{ row }">
        <GcStatusTag :status="String(row.status)" />
      </template>
      <template #cell-risk="{ row }">
        <GcRiskBadge :risk="row.risk as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'" />
      </template>
    </GcDataTable>

    <GcExecutionLogViewer v-if="moduleName === 'executions' || moduleName === 'deploymentPlans'" :lines="logs" />

    <GcEmptyState title="业务实现待接入" description="004 只建立页面骨架，不实现完整业务页面；028 将在这些入口上填充真实交互。" />
  </section>
</template>
