import { computed, ref, watch } from 'vue'
import { listExecutionSteps } from '@/api/modules/executions.api'
import type { ExecutionLogLine, ExecutionStepLine } from '@/design-system/components/GcExecutionLogViewer.vue'
import { usePolling } from './usePolling'
import { readPath, readString, type ViewRow } from './useBusinessPage'

export function useExecutionDetail(selectedRow: { readonly value: ViewRow | null }) {
  const loading = ref(false)
  const requestId = ref('')
  const steps = ref<ExecutionStepLine[]>([])
  const lines = ref<ExecutionLogLine[]>([])
  const error = ref('')

  const runId = computed(() => {
    const row = selectedRow.value
    if (!row) return ''
    return readString(row.raw, ['id', 'runId'], row.id)
  })

  async function load() {
    if (!runId.value) {
      steps.value = []
      lines.value = []
      return
    }

    loading.value = true
    error.value = ''
    try {
      const result = await listExecutionSteps({
        page: 1,
        pageSize: 50,
        sort: 'startedAt:asc',
        filters: { runId: runId.value }
      })
      requestId.value = result.requestId
      const items = result.data?.items ?? []
      steps.value = items.map((record, index) => ({
        id: readString(record, ['id', 'stepId'], `${runId.value}-step-${index + 1}`),
        name: readString(record, ['name', 'stepName'], `步骤 ${index + 1}`),
        status: readString(record, ['status', 'state', 'result'], 'UNKNOWN'),
        detail: readString(record, ['message', 'detail', 'summary'], '等待后端补充步骤描述'),
        startedAt: readString(record, ['startedAt', 'createdAt'], ''),
        finishedAt: readString(record, ['finishedAt', 'updatedAt'], ''),
        requestId: readString(record, ['requestId'], '')
      }))
      lines.value = items.map((record, index) => ({
        id: `line-${readString(record, ['id', 'stepId'], String(index + 1))}`,
        time: readString(record, ['updatedAt', 'finishedAt', 'startedAt', 'createdAt'], '未知时间'),
        level: normalizeLevel(readPath(record, 'logLevel') ?? readPath(record, 'severity') ?? readPath(record, 'status')),
        step: readString(record, ['name', 'stepName'], `步骤 ${index + 1}`),
        message: readString(record, ['message', 'detail', 'summary'], '步骤状态已刷新'),
        requestId: readString(record, ['requestId'], '')
      }))
    } catch (cause) {
      steps.value = []
      lines.value = []
      error.value = cause instanceof Error ? cause.message : '执行步骤查询失败'
    } finally {
      loading.value = false
    }
  }

  watch(runId, () => {
    void load()
  }, { immediate: true })

  const polling = usePolling(() => load(), {
    intervalMs: 15_000,
    immediate: false,
    stopWhen: () => !runId.value
  })

  return {
    loading,
    requestId,
    steps,
    lines,
    error,
    isPolling: polling.isPolling,
    reload: load
  }
}

function normalizeLevel(value: unknown): ExecutionLogLine['level'] {
  const current = String(value ?? '').toUpperCase()
  if (current === 'FAILED' || current === 'ERROR') return 'error'
  if (current === 'WARN' || current === 'WARNING' || current === 'PENDING_APPROVAL') return 'warn'
  if (current === 'DEBUG') return 'debug'
  return 'info'
}
