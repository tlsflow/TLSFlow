<script setup lang="ts">
import type { ApiRecord } from '@/api/modules/common'
import type { ExecutionLogLine, ExecutionStepLine } from './GcExecutionLogViewer.vue'
import GcDryRunChecklist from './GcDryRunChecklist.vue'
import GcExecutionLogViewer from './GcExecutionLogViewer.vue'
import GcModal from './GcModal.vue'

const props = withDefaults(defineProps<{
  open: boolean
  title?: string
  description?: string
  loading?: boolean
  runId?: string
  requestId?: string
  summary?: {
    state: 'queued' | 'running' | 'pending' | 'passed' | 'warning' | 'failed'
    label: string
    detail: string
    passed: number
    warning: number
    failed: number
    unknown: number
  } | null
  checks?: readonly ApiRecord[]
  steps?: readonly ExecutionStepLine[]
  lines?: readonly ExecutionLogLine[]
  error?: string
  polling?: boolean
  showChecklist?: boolean
}>(), {
  title: 'Dry-run 执行结果',
  description: '在当前页面直接查看 dry-run 执行进度、预检结论和步骤日志。',
  showChecklist: true,
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
    width="min(1280px, calc(100vw - 32px))"
    @update:open="emit('update:open', $event)"
  >
    <section class="gc-dry-run-result">
      <p v-if="error" class="gc-dry-run-result__error">{{ error }}</p>

      <section
        v-if="summary"
        class="gc-card gc-dry-run-result__summary"
        :data-state="summary.state"
        aria-label="Dry-run 摘要"
      >
        <div class="gc-dry-run-result__summary-head">
          <div class="gc-dry-run-result__summary-copy">
            <strong>{{ summary.label }}</strong>
            <p>{{ summary.detail }}</p>
          </div>
          <div class="gc-dry-run-result__summary-meta">
            <span v-if="runId">Run: {{ runId }}</span>
            <span v-if="requestId">Request: {{ requestId }}</span>
            <span v-if="loading">刷新中</span>
          </div>
        </div>
        <dl>
          <div>
            <dt>通过</dt>
            <dd>{{ summary.passed }}</dd>
          </div>
          <div>
            <dt>警告</dt>
            <dd>{{ summary.warning }}</dd>
          </div>
          <div>
            <dt>失败</dt>
            <dd>{{ summary.failed }}</dd>
          </div>
          <div>
            <dt>未知</dt>
            <dd>{{ summary.unknown }}</dd>
          </div>
        </dl>
      </section>

      <GcDryRunChecklist
        v-if="props.showChecklist"
        :items="checks ?? []"
        title="预检检查项"
        description="这里展示 dry-run 返回的结构化预检结论。"
      />

      <GcExecutionLogViewer
        :lines="lines ?? []"
        :steps="steps ?? []"
        :polling="polling"
        mode="polling"
      />
    </section>

    <template #actions>
      <button class="gc-button" type="button" @click="closeModal">关闭</button>
    </template>
  </GcModal>
</template>

<style scoped>
.gc-dry-run-result {
  display: grid;
  gap: var(--gc-space-3);
  min-width: 0;
  overflow-x: hidden;
}

.gc-dry-run-result__error {
  margin: 0;
  border-radius: 12px;
  padding: 12px 14px;
  font-weight: 750;
  border: 1px solid #fecaca;
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-bg);
  overflow-wrap: anywhere;
}

.gc-dry-run-result__summary {
  display: grid;
  gap: var(--gc-space-3);
  padding: 20px;
  min-width: 0;
}

.gc-dry-run-result__summary-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--gc-space-3);
  align-items: flex-start;
}

.gc-dry-run-result__summary-copy,
.gc-dry-run-result__summary-copy p,
.gc-dry-run-result__summary-meta {
  min-width: 0;
}

.gc-dry-run-result__summary-copy strong,
.gc-dry-run-result__summary-copy p,
.gc-dry-run-result__summary-meta span {
  overflow-wrap: anywhere;
}

.gc-dry-run-result__summary-copy p {
  margin: var(--gc-space-1) 0 0;
  color: var(--gc-color-text-muted);
}

.gc-dry-run-result__summary-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gc-space-2);
  justify-content: flex-end;
  color: var(--gc-color-text-muted);
}

.gc-dry-run-result__summary dl {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--gc-space-3);
  margin: 0;
}

.gc-dry-run-result__summary dl div {
  border: 1px solid var(--gc-color-border);
  border-radius: 8px;
  padding: 12px;
  background: var(--gc-color-surface-soft);
  min-width: 0;
}

.gc-dry-run-result__summary dt {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: 750;
}

.gc-dry-run-result__summary dd {
  margin: 6px 0 0;
  font-size: var(--gc-font-size-2xl);
  font-weight: 850;
}

.gc-dry-run-result__summary[data-state='passed'] {
  border-color: #bbf7d0;
  background: #f0fdf4;
}

.gc-dry-run-result__summary[data-state='warning'] {
  border-color: #fde68a;
  background: #fffbeb;
}

.gc-dry-run-result__summary[data-state='failed'] {
  border-color: #fecaca;
  background: #fef2f2;
}

.gc-dry-run-result__summary[data-state='pending'],
.gc-dry-run-result__summary[data-state='queued'],
.gc-dry-run-result__summary[data-state='running'] {
  border-color: #bfdbfe;
  background: #eff6ff;
}

@media (max-width: 720px) {
  .gc-dry-run-result__summary-head {
    grid-template-columns: 1fr;
  }

  .gc-dry-run-result__summary-meta {
    justify-content: flex-start;
  }

  .gc-dry-run-result__summary dl {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
