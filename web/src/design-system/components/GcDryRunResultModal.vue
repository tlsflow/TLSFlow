<script setup lang="ts">
import type { ApiRecord } from '@/api/modules/common'
import type { ExecutionLogLine, ExecutionStepLine } from './GcExecutionLogViewer.vue'
import GcExecutionProgressPanel from './GcExecutionProgressPanel.vue'
import GcModal from './GcModal.vue'

interface DryRunSummary {
  state: 'queued' | 'running' | 'pending' | 'passed' | 'warning' | 'failed'
  label: string
  detail: string
  passed: number
  warning: number
  failed: number
  unknown: number
}

const props = withDefaults(defineProps<{
  open: boolean
  title?: string
  description?: string
  loading?: boolean
  runId?: string
  requestId?: string
  summary?: DryRunSummary | null
  checks?: readonly ApiRecord[]
  steps?: readonly ExecutionStepLine[]
  lines?: readonly ExecutionLogLine[]
  error?: string
  polling?: boolean
  showChecklist?: boolean
  mode?: 'dry-run' | 'execution'
}>(), {
  title: 'Dry-run 执行结果',
  description: '',
  showChecklist: true,
  mode: 'dry-run',
})

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

function closeModal() {
  emit('update:open', false)
}
</script>

<template>
  <GcModal
    :open="open"
    :title="props.title"
    :description="props.description"
    size="xxl"
    width="min(1320px, calc(100vw - 24px))"
    @update:open="emit('update:open', $event)"
  >
    <GcExecutionProgressPanel
      :run-id="runId"
      :request-id="requestId"
      :summary="summary"
      :checks="checks"
      :steps="steps"
      :lines="lines"
      :loading="loading"
      :polling="polling"
      :error="error"
      :show-checklist="showChecklist"
      :reveal-on-mount="open"
      :mode="mode"
    />

    <template #actions>
      <button class="gc-button" type="button" @click="closeModal">关闭</button>
    </template>
  </GcModal>
</template>
