<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
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
  transitionName?: string
  collapseTargetSelector?: string
}>(), {
  description: '',
  showChecklist: true,
  mode: 'dry-run',
  transitionName: 'gc-modal',
  collapseTargetSelector: '',
})

const { t } = useI18n()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const displayTitle = computed(() => props.title ?? t('designSystem.dryRunResult.title'))

function closeModal() {
  emit('update:open', false)
}
</script>

<template>
  <GcModal
    :open="open"
    :title="displayTitle"
    :description="props.description"
    size="xxl"
    width="min(1320px, calc(100vw - 24px))"
    :transition-name="props.transitionName"
    :collapse-target-selector="props.collapseTargetSelector"
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
      <button class="gc-button" type="button" @click="closeModal">{{ t('designSystem.dryRunResult.close') }}</button>
    </template>
  </GcModal>
</template>
