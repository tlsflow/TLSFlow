import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  listAgentTaskLogsByTaskId,
  listExecutionStepsByRunId,
  streamExecutionDetail,
  type ExecutionDetailStreamEvent,
  type ExecutionDetailStreamSnapshot,
} from '@/api/modules/executions.api'
import type { ApiRecord } from '@/api/modules/common'
import type { ExecutionLogLine, ExecutionStepLine } from '@/design-system/components/GcExecutionLogViewer.vue'
import { usePolling } from './usePolling'
import { readPath, readString, translateWithFallback, type I18nParams, type I18nTranslate, type ViewRow } from './useBusinessPage'

export interface ExecutionDryRunSummary {
  readonly state: 'queued' | 'running' | 'pending' | 'passed' | 'warning' | 'failed'
  readonly label: string
  readonly detail: string
  readonly passed: number
  readonly warning: number
  readonly failed: number
  readonly unknown: number
}

type DryRunStatus = 'passed' | 'failed' | 'warning' | 'unknown'
type ExecutionDetailText = (key: ExecutionDetailI18nKey, params?: I18nParams) => string

export interface UseExecutionDetailOptions {
  readonly t?: I18nTranslate
}

const terminalRunStatuses = new Set(['SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED', 'ROLLBACK_SUCCESS', 'ROLLBACK_FAILED'])
const EXECUTION_DETAIL_I18N_KEYS = [
  'executionDetail.error.loadStepsFailed',
  'executionDetail.error.streamConnectFailed',
  'executionDetail.step.nameFallback',
  'executionDetail.dryRun.failedNoChecks.label',
  'executionDetail.dryRun.failedNoChecks.detail',
  'executionDetail.dryRun.queued.label',
  'executionDetail.dryRun.queued.detail',
  'executionDetail.dryRun.running.label',
  'executionDetail.dryRun.running.detail',
  'executionDetail.dryRun.pending.label',
  'executionDetail.dryRun.pending.detail',
  'executionDetail.dryRun.receiving.label',
  'executionDetail.dryRun.receiving.detail',
  'executionDetail.dryRun.failed.label',
  'executionDetail.dryRun.failed.detail',
  'executionDetail.dryRun.warning.label',
  'executionDetail.dryRun.warning.detail',
  'executionDetail.dryRun.passed.label',
  'executionDetail.dryRun.passed.detail',
  'executionDetail.step.dryRunCheckSummary',
  'executionDetail.step.dryRunPending.queued',
  'executionDetail.step.dryRunPending.running',
  'executionDetail.step.dryRunPending.failed',
  'executionDetail.step.dryRunPending.finished',
  'executionDetail.step.dryRunDiscover',
  'executionDetail.step.dryRunVerify',
  'executionDetail.step.dryRunCreated',
  'executionDetail.step.failure.emptyMessage',
  'executionDetail.step.failure.issue',
  'executionDetail.agent.taskSuffix',
  'executionDetail.step.running.dispatched',
  'executionDetail.step.running.waitingAgentResult',
  'executionDetail.step.pending.waitingDependency',
  'executionDetail.step.verifyRecovered.detail',
  'executionDetail.step.verifyRecovered.originalSuffix',
  'executionDetail.step.resultReturned.withTask',
  'executionDetail.step.resultReturned.withoutTask',
  'executionDetail.step.createdFallback',
  'executionDetail.log.verifyRecovered',
  'executionDetail.workflowStep.failedDefault',
  'executionDetail.workflowStep.skipped',
  'executionDetail.workflowStep.successAssertions',
  'executionDetail.workflowStep.success',
  'executionDetail.binding.hostMissing',
  'executionDetail.site.unnamed',
  'executionDetail.provider.target',
] as const

type ExecutionDetailI18nKey = typeof EXECUTION_DETAIL_I18N_KEYS[number]

function createExecutionDetailText(t: I18nTranslate | undefined): ExecutionDetailText {
  return (key, params) => translateWithFallback(t, key, key, params)
}

export function useExecutionDetail(selectedRow: { readonly value: ViewRow | null }, options: UseExecutionDetailOptions = {}) {
  const text = createExecutionDetailText(options.t)
  const loading = ref(false)
  const requestId = ref('')
  const steps = ref<ExecutionStepLine[]>([])
  const lines = ref<ExecutionLogLine[]>([])
  const error = ref('')
  const dryRunSummary = ref<ExecutionDryRunSummary | null>(null)
  const dryRunChecks = ref<ApiRecord[]>([])
  const isStreaming = ref(false)

  const stepRecords = ref<ApiRecord[]>([])
  const agentLogsByTaskId = ref(new Map<string, readonly ApiRecord[]>())
  let lastLoadedRunId = ''
  let stopStream: (() => void) | null = null

  const runId = computed(() => {
    const row = selectedRow.value
    if (!row) return ''
    return readString(row.raw, ['id', 'runId'], row.id)
  })

  const runStatus = computed(() => {
    const row = selectedRow.value
    if (!row) return ''
    return readString(row.raw, ['status', 'state', 'result'], '').toUpperCase()
  })

  async function load() {
    if (!runId.value) {
      resetState()
      return
    }

    loading.value = true
    error.value = ''
    try {
      const result = await listExecutionStepsByRunId(runId.value, {
        page: 1,
        pageSize: 200,
        sort: 'startedAt:asc',
      })
      requestId.value = result.requestId
      const items = [...(result.data?.items ?? [])]
      stepRecords.value = items
      agentLogsByTaskId.value = await loadAgentLogsByTaskId(items)
      recomputeView()
      lastLoadedRunId = runId.value
    } catch (cause) {
      resetState()
      error.value = cause instanceof Error ? cause.message : text('executionDetail.error.loadStepsFailed')
    } finally {
      loading.value = false
    }
  }

  function resetState() {
    stepRecords.value = []
    agentLogsByTaskId.value = new Map()
    steps.value = []
    lines.value = []
    dryRunSummary.value = null
    dryRunChecks.value = []
    lastLoadedRunId = ''
  }

  function recomputeView() {
    const displayItems = stepRecords.value
    const logItems = expandWorkflowStepRecords(stepRecords.value)
    steps.value = displayItems.map((record, index) => ({
      id: readString(record, ['id', 'stepId'], `${runId.value}-step-${index + 1}`),
      name: readString(record, ['name', 'stepName'], text('executionDetail.step.nameFallback', { index: index + 1 })),
      stepType: readString(record, ['stepType', 'type'], ''),
      status: readString(record, ['status', 'state', 'result'], 'UNKNOWN'),
      detail: buildStepDetail(record, index, text),
      startedAt: formatStepRange(record, 'start'),
      finishedAt: formatStepRange(record, 'end'),
      requestId: readString(record, ['requestId'], ''),
    }))
    lines.value = logItems.flatMap((record, index) => buildLogLines(record, index, agentLogsByTaskId.value.get(readDispatchTaskId(record)) ?? [], text))
    dryRunSummary.value = summarizeDryRun(stepRecords.value, text)
    dryRunChecks.value = collectDryRunChecks(stepRecords.value)
  }

  async function connectStream() {
    disconnectStream()
    if (!runId.value || terminalRunStatuses.has(runStatus.value)) {
      isStreaming.value = false
      return
    }

    try {
      stopStream = await streamExecutionDetail(runId.value, {
        onSnapshot: (snapshot) => {
          applySnapshot(snapshot)
        },
        onEvent: (event) => {
          void applyEvent(event)
        },
        onError: () => {
          isStreaming.value = false
          void polling.start()
        },
      })
      isStreaming.value = true
    } catch (cause) {
      isStreaming.value = false
      error.value = cause instanceof Error ? cause.message : text('executionDetail.error.streamConnectFailed')
    }
  }

  function disconnectStream() {
    if (!stopStream) return
    stopStream()
    stopStream = null
    isStreaming.value = false
  }

  function applySnapshot(snapshot: ExecutionDetailStreamSnapshot) {
    const items = [...(snapshot.steps ?? [])]
    if (items.length > 0) {
      stepRecords.value = items
      void refreshAgentLogsForItems(items)
      recomputeView()
    }
  }

  async function applyEvent(event: ExecutionDetailStreamEvent) {
    if (event.type === 'step' && event.step) {
      upsertStep(event.step)
      const taskId = readDispatchTaskId(event.step)
      if (taskId) {
        await refreshAgentLogForTask(taskId)
      }
      recomputeView()
      return
    }
    if (event.type === 'log' && event.log) {
      mergeAgentLog(event.log)
      recomputeView()
    }
  }

  function upsertStep(step: ApiRecord) {
    const items = [...stepRecords.value]
    const id = readString(step, ['id', 'stepId'], '')
    const index = items.findIndex((item) => readString(item, ['id', 'stepId'], '') === id)
    if (index >= 0) items[index] = step
    else items.push(step)
    items.sort((left, right) => {
      const leftNo = Number(readPath(left, 'stepNo') ?? 0)
      const rightNo = Number(readPath(right, 'stepNo') ?? 0)
      return leftNo - rightNo
    })
    stepRecords.value = items
  }

  async function refreshAgentLogsForItems(items: readonly ApiRecord[]) {
    agentLogsByTaskId.value = await loadAgentLogsByTaskId(items)
    recomputeView()
  }

  async function refreshAgentLogForTask(taskId: string) {
    try {
      const result = await listAgentTaskLogsByTaskId(taskId)
      const next = new Map(agentLogsByTaskId.value)
      next.set(taskId, result.data ?? [])
      agentLogsByTaskId.value = next
    } catch {
      // 日志查询失败不阻断主视图
    }
  }

  function mergeAgentLog(log: ApiRecord) {
    const taskId = readString(log, ['taskId'], '')
    if (!taskId) return
    const next = new Map(agentLogsByTaskId.value)
    const current = [...(next.get(taskId) ?? [])]
    const logId = readString(log, ['id'], '')
    if (!current.some((item) => readString(item, ['id'], '') === logId)) {
      current.push(log)
      current.sort((left, right) => Number(readPath(left, 'sequence') ?? 0) - Number(readPath(right, 'sequence') ?? 0))
      next.set(taskId, current)
      agentLogsByTaskId.value = next
    }
  }

  const polling = usePolling(() => load(), {
    intervalMs: 5_000,
    immediate: false,
    stopWhen: () => !runId.value || terminalRunStatuses.has(runStatus.value) || isStreaming.value,
  })

  watch([runId, runStatus], async ([value, status]) => {
    if (!value) {
      disconnectStream()
      polling.stop()
      resetState()
      return
    }
    if (value !== lastLoadedRunId) {
      await load()
    }
    if (terminalRunStatuses.has(status)) {
      disconnectStream()
      polling.stop()
      return
    }
    await connectStream()
    if (!isStreaming.value) {
      void polling.start()
    } else {
      polling.stop()
    }
  }, { immediate: true })

  onBeforeUnmount(() => {
    disconnectStream()
    polling.stop()
  })

  return {
    loading,
    requestId,
    steps,
    lines,
    error,
    dryRunSummary,
    dryRunChecks,
    isPolling: polling.isPolling,
    isStreaming,
    reload: load,
  }
}

async function loadAgentLogsByTaskId(items: readonly ApiRecord[]): Promise<Map<string, readonly ApiRecord[]>> {
  const taskIds = [...new Set(items.map(readDispatchTaskId).filter(Boolean))]
  const pairs = await Promise.all(taskIds.map(async (taskId) => {
    try {
      const result = await listAgentTaskLogsByTaskId(taskId)
      return [taskId, result.data ?? []] as const
    } catch {
      return [taskId, []] as const
    }
  }))
  return new Map(pairs)
}

function readDispatchTaskId(record: Record<string, unknown>): string {
  return readString(record, ['inputSnapshot.dispatchDetail.taskId', 'inputSnapshot.resultDetail.taskId', 'inputSnapshot.resultDetail.failure.taskId'], '')
}

function collectDryRunChecks(items: readonly Record<string, unknown>[]): ApiRecord[] {
  const checks = expandWorkflowStepRecords(items).flatMap((item) => {
    const resultDetail = readObject(item, 'inputSnapshot.resultDetail')
    return readArray(resultDetail, 'dryRunChecks')
  })
  return mergeDryRunChecks(checks)
}

function summarizeDryRun(items: readonly Record<string, unknown>[], text: ExecutionDetailText): ExecutionDryRunSummary | null {
  const dryRunItems = expandWorkflowStepRecords(items).filter((item) => readPath(item, 'inputSnapshot.dryRun') === true)
  if (dryRunItems.length === 0) return null

  let hasChecks = false
  let queuedCount = 0
  let runningCount = 0
  let failedStepCount = 0
  let finishedWithoutChecks = 0
  const collectedChecks: ApiRecord[] = []

  for (const item of dryRunItems) {
    const stepStatus = String(readPath(item, 'status') ?? '').toUpperCase()
    if (stepStatus === 'PENDING' || stepStatus === 'DISPATCHED') queuedCount += 1
    if (stepStatus === 'RUNNING') runningCount += 1
    if (stepStatus === 'FAILED' || stepStatus === 'TIMEOUT' || stepStatus === 'CANCELLED') failedStepCount += 1

    const resultDetail = readObject(item, 'inputSnapshot.resultDetail')
    const checks = readArray(resultDetail, 'dryRunChecks')
    if (checks.length > 0) {
      hasChecks = true
      collectedChecks.push(...checks)
    } else if (readObject(resultDetail, 'dryRunSummary')) {
      hasChecks = true
    } else if (['SUCCESS', 'SKIPPED'].includes(stepStatus)) {
      finishedWithoutChecks += 1
    }
  }

  const counts = countDryRunStatuses(mergeDryRunChecks(collectedChecks))

  if (failedStepCount > 0 && !hasChecks) {
    return {
      state: 'failed',
      label: text('executionDetail.dryRun.failedNoChecks.label'),
      detail: text('executionDetail.dryRun.failedNoChecks.detail', { failedStepCount }),
      ...counts,
    }
  }

  if (!hasChecks) {
    if (queuedCount === dryRunItems.length) {
      return { state: 'queued', label: text('executionDetail.dryRun.queued.label'), detail: text('executionDetail.dryRun.queued.detail'), passed: 0, warning: 0, failed: 0, unknown: 0 }
    }
    if (runningCount > 0 || queuedCount > 0) {
      return { state: 'running', label: text('executionDetail.dryRun.running.label'), detail: text('executionDetail.dryRun.running.detail'), passed: 0, warning: 0, failed: 0, unknown: 0 }
    }
    return { state: 'pending', label: text('executionDetail.dryRun.pending.label'), detail: text('executionDetail.dryRun.pending.detail', { finishedWithoutChecks }), passed: 0, warning: 0, failed: 0, unknown: 0 }
  }

  if (queuedCount > 0 || runningCount > 0) {
    return {
      state: 'running',
      label: text('executionDetail.dryRun.receiving.label'),
      detail: text('executionDetail.dryRun.receiving.detail', counts),
      ...counts,
    }
  }

  if (counts.failed > 0) {
    return {
      state: 'failed',
      label: text('executionDetail.dryRun.failed.label'),
      detail: text('executionDetail.dryRun.failed.detail', counts),
      ...counts,
    }
  }

  if (counts.warning > 0 || counts.unknown > 0) {
    return {
      state: 'warning',
      label: text('executionDetail.dryRun.warning.label'),
      detail: text('executionDetail.dryRun.warning.detail', counts),
      ...counts,
    }
  }

  return {
    state: 'passed',
    label: text('executionDetail.dryRun.passed.label'),
    detail: text('executionDetail.dryRun.passed.detail', counts),
    ...counts,
  }
}

function buildStepDetail(record: Record<string, unknown>, index: number, text: ExecutionDetailText): string {
  const resultDetail = readObject(record, 'inputSnapshot.resultDetail')
  const workflowStepResult = readObject(resultDetail, 'workflowStepResult')
  if (workflowStepResult) return buildWorkflowStepDetail(workflowStepResult, index, text)
  const dispatchDetail = readObject(record, 'inputSnapshot.dispatchDetail')
  const failureDetail = readObject(resultDetail, 'failure')
  const verificationRecovery = readObject(resultDetail, 'verificationRecovery')
  const dryRunSummary = readObject(resultDetail, 'dryRunSummary')
  const dryRunChecks = readArray(resultDetail, 'dryRunChecks')
  const stepType = readString(record, ['stepType', 'type'], '')
  const stepStatus = String(readPath(record, 'status') ?? '').toUpperCase()
  const lastErrorCode = readString(record, ['lastErrorCode'], '')
  const lastErrorMessage = readString(record, ['lastErrorMessage'], '')
  const lastErrorDetails = readObject(record, 'lastErrorDetails')
  const resultErrorCode = readString(resultDetail ?? {}, ['errorCode'], '')
  const resultErrorMessage = readString(resultDetail ?? {}, ['errorMessage', 'message', 'detail', 'summary'], '')
  const failureMessage = readString(failureDetail ?? {}, ['errorMessage', 'message'], '')
  const taskId = readString(dispatchDetail ?? {}, ['taskId'], '') || readString(resultDetail ?? {}, ['taskId'], '')
  const siteName = readPath(record, 'inputSnapshot.siteName')
  const verifyUrl = readString(record, ['inputSnapshot.verifyUrl'], '')
  const bindingSelector = readObject(record, 'inputSnapshot.bindingSelector')
  const hostHeader = readPath(bindingSelector ?? {}, 'hostHeader')
  const port = readPath(bindingSelector ?? {}, 'port')
  const providerLabel = inferProviderLabel(record, text)

  if (dryRunChecks.length > 0) {
    const passed = readCount(dryRunSummary, 'passed')
    const failed = readCount(dryRunSummary, 'failed')
    const warning = readCount(dryRunSummary, 'warning')
    const unknown = readCount(dryRunSummary, 'unknown')
    const topChecks = dryRunChecks
      .slice(0, 3)
      .map((item) => `${stringValue(item.label ?? item.key, 'check')}: ${stringValue(item.status, 'unknown')}`)
      .join('；')
    return text('executionDetail.step.dryRunCheckSummary', { passed, warning, failed, unknown, topChecks })
  }

  if (['FAILED', 'TIMEOUT', 'CANCELLED'].includes(stepStatus)) {
    const code = lastErrorCode || resultErrorCode || stringValue(readPath(failureDetail ?? {}, 'errorCode'), 'STEP_FAILED')
    const message = lastErrorMessage || resultErrorMessage || failureMessage || text('executionDetail.step.failure.emptyMessage')
    const issues = readArray(lastErrorDetails, 'issues').map((issue) => formatExecutionInputIssue(issue, text))
    const issueDetail = issues.length > 0 ? `；${issues.join('；')}` : ''
    return `${code}: ${message}${issueDetail}${taskId ? text('executionDetail.agent.taskSuffix', { taskId }) : ''}`
  }

  if (readPath(record, 'inputSnapshot.dryRun') === true) {
    const pendingText = stepStatus === 'PENDING' || stepStatus === 'DISPATCHED'
      ? text('executionDetail.step.dryRunPending.queued')
      : stepStatus === 'RUNNING'
        ? text('executionDetail.step.dryRunPending.running')
        : ['FAILED', 'TIMEOUT', 'CANCELLED'].includes(stepStatus)
          ? text('executionDetail.step.dryRunPending.failed')
          : text('executionDetail.step.dryRunPending.finished')
    if (stepType === 'DISCOVER') {
      return text('executionDetail.step.dryRunDiscover', {
        providerLabel,
        siteName: stringValue(siteName, text('executionDetail.site.unnamed')),
        binding: formatBinding(hostHeader, port, text),
        pendingText,
      })
    }
    if (stepType === 'VERIFY') {
      return text('executionDetail.step.dryRunVerify', {
        providerLabel,
        binding: formatBinding(hostHeader, port, text),
        pendingText,
      })
    }
    return text('executionDetail.step.dryRunCreated', { pendingText })
  }

  if (stepStatus === 'RUNNING') {
    return taskId
      ? text('executionDetail.step.running.dispatched', { taskId })
      : text('executionDetail.step.running.waitingAgentResult')
  }

  if (stepStatus === 'PENDING') {
    return text('executionDetail.step.pending.waitingDependency')
  }

  if (stepStatus === 'SUCCESS' && stepType === 'VERIFY' && verificationRecovery) {
    const remoteTarget = readString(resultDetail ?? {}, ['verify.target'], verifyUrl || formatBinding(hostHeader, port, text))
    const originalError = readString(verificationRecovery, ['originalErrorMessage'], '')
    return text('executionDetail.step.verifyRecovered.detail', {
      remoteTarget,
      originalError: originalError ? text('executionDetail.step.verifyRecovered.originalSuffix', { originalError }) : '',
    })
  }

  if (resultDetail) {
    const mode = readString(resultDetail, ['mode'], '')
    const executor = readString(resultDetail, ['executor'], '')
    if (mode || executor) {
      return taskId
        ? text('executionDetail.step.resultReturned.withTask', { executor: executor || 'executor', mode: mode || 'result', taskId })
        : text('executionDetail.step.resultReturned.withoutTask', { executor: executor || 'executor', mode: mode || 'result' })
    }
  }

  return readString(record, ['message', 'detail', 'summary'], text('executionDetail.step.createdFallback', { index: index + 1 }))
}

function formatExecutionInputIssue(issue: Record<string, unknown>, text: ExecutionDetailText): string {
  return text('executionDetail.step.failure.issue', {
    category: stringValue(issue.category, '-'),
    slot: stringValue(issue.slot, '-'),
    path: stringValue(issue.path, '-'),
    source: stringValue(issue.source ?? issue.bindingLayer, '-'),
    remediation: stringValue(issue.remediation ?? issue.messageKey, '-'),
  })
}

function buildLogLines(record: Record<string, unknown>, index: number, agentLogs: readonly ApiRecord[], text: ExecutionDetailText): ExecutionLogLine[] {
  const baseTime = formatLocalTime(readString(record, ['updatedAt', 'finishedAt', 'startedAt', 'createdAt'], ''))
  const baseStep = readString(record, ['name', 'stepName'], text('executionDetail.step.nameFallback', { index: index + 1 }))
  const baseId = readString(record, ['id', 'stepId'], String(index + 1))
  const resultDetail = readObject(record, 'inputSnapshot.resultDetail')
  const workflowStepResult = readObject(resultDetail, 'workflowStepResult')
  if (workflowStepResult) return buildWorkflowStepLogLines(record, workflowStepResult, baseId, baseTime, baseStep, text)
  const verificationRecovery = readObject(resultDetail, 'verificationRecovery')
  const dryRunChecks = readArray(resultDetail, 'dryRunChecks')

  if (dryRunChecks.length > 0) {
    return dryRunChecks.map((item, checkIndex) => ({
      id: `line-${baseId}-${checkIndex + 1}`,
      time: baseTime,
      level: normalizeCheckLevel(item.status),
      step: baseStep,
      message: `${stringValue(item.label ?? item.key, 'check')}: ${stringValue(item.detail ?? item.status, 'unknown')}`,
      requestId: readString(record, ['requestId'], ''),
    }))
  }

  const baseLine = {
    id: `line-${baseId}`,
    time: baseTime,
    level: normalizeLevel(readPath(record, 'logLevel') ?? readPath(record, 'severity') ?? readPath(record, 'status')),
    step: baseStep,
    message: buildStepDetail(record, index, text),
    requestId: readString(record, ['requestId'], ''),
  }
  const recoveredVerifySuccess = String(readPath(record, 'status') ?? '').toUpperCase() === 'SUCCESS'
    && verificationRecovery
    && readString(record, ['stepType', 'type'], '') === 'VERIFY'
  const normalizedAgentLogs = recoveredVerifySuccess
    ? agentLogs.filter((log) => !matchesRecoveredVerificationFailure(verificationRecovery, log))
    : agentLogs

  const agentLines = normalizedAgentLogs.map((log, logIndex) => ({
    id: `line-${baseId}-agent-${readString(log, ['id'], String(logIndex + 1))}`,
    time: formatLocalTime(readString(log, ['emittedAt', 'createdAt'], '')) || baseTime,
    level: normalizeLevel(readPath(log, 'level')),
    step: baseStep,
    message: `[Agent] ${readString(log, ['message'], '')}`,
    requestId: readString(log, ['requestId'], ''),
  }))
  const recoveryLine = verificationRecovery ? [{
    id: `line-${baseId}-recovery`,
    time: baseTime,
    level: 'warn' as const,
    step: baseStep,
    message: text('executionDetail.log.verifyRecovered'),
    requestId: readString(record, ['requestId'], ''),
  }] : []
  return [baseLine, ...recoveryLine, ...agentLines]
}

function matchesRecoveredVerificationFailure(
  verificationRecovery: Record<string, unknown> | undefined,
  log: ApiRecord,
): boolean {
  if (!verificationRecovery) return false
  const message = readString(log, ['message'], '')
  const originalErrorCode = readString(verificationRecovery, ['originalErrorCode'], '')
  const originalErrorMessage = readString(verificationRecovery, ['originalErrorMessage'], '')
  return Boolean(
    (originalErrorCode && message.includes(originalErrorCode))
    || (originalErrorMessage && message.includes(originalErrorMessage)),
  )
}

function expandWorkflowStepRecords(items: readonly ApiRecord[]): ApiRecord[] {
  return items.flatMap((item, index) => {
    const resultDetail = readObject(item, 'inputSnapshot.resultDetail')
    const projectedSteps = readArray(resultDetail, 'workflowExecutionSteps')
    if (projectedSteps.length > 0) {
      return projectedSteps.map((step, stepIndex) => ({
        ...item,
        id: readString(step, ['id'], `workflow-projection-${index + 1}-${stepIndex + 1}`),
        name: readString(step, ['name'], `workflow-${stepIndex + 1}`),
        status: readString(step, ['status'], 'UNKNOWN'),
        stepType: readString(step, ['stepType'], 'CUSTOM'),
        startedAt: readString(step, ['startedAt'], readString(item, ['startedAt', 'createdAt'], '')),
        finishedAt: readString(step, ['finishedAt'], ''),
        dependsOn: readArray(step, 'dependsOn'),
        inputSnapshot: {
          ...(readObject(item, 'inputSnapshot') ?? {}),
          resultDetail: {
            ...(resultDetail ?? {}),
            workflowStepResult: step,
            workflowRollback: readPath(step, 'compensation') === true,
          },
        },
      }))
    }
    const workflowRun = readObject(resultDetail, 'workflowRun')
    const workflowProgress = readObject(resultDetail, 'workflowProgress')
    const completedStepResults = readArray(workflowRun, 'stepResults')
    const progressStepResults = readArray(workflowProgress, 'steps')
    const stepResults = completedStepResults.length > 0 ? completedStepResults : progressStepResults
    const rollbackResults = readArray(workflowRun, 'rollbackResults')
    const workflowResults = [
      ...stepResults.map((step) => ({ step, rollback: false })),
      ...rollbackResults.map((step) => ({ step, rollback: true })),
    ]
    if (workflowResults.length === 0) return [item]
    const parentId = readString(item, ['id', 'stepId'], `workflow-${index + 1}`)
    const workflowRunId = readString(workflowRun ?? workflowProgress ?? {}, ['id'], '')
    return workflowResults.map(({ step, rollback }, stepIndex) => {
      const name = readString(step, ['name'], `${rollback ? 'rollback' : 'workflow'}-${stepIndex + 1}`)
      const status = mapWorkflowStepStatus(readString(step, ['status'], ''))
      return {
        ...item,
        id: `${parentId}:workflow:${rollback ? 'rollback:' : ''}${name}`,
        name: rollback ? `rollback.${name}` : name,
        status,
        stepType: readString(step, ['type'], readString(item, ['stepType', 'type'], 'WORKFLOW')).toUpperCase(),
        startedAt: readString(step, ['startedAt'], readString(item, ['startedAt', 'createdAt'], '')),
        finishedAt: readString(step, ['finishedAt'], ''),
        inputSnapshot: {
          ...(readObject(item, 'inputSnapshot') ?? {}),
          resultDetail: {
            ...(resultDetail ?? {}),
            workflowRunId,
            workflowStepResult: step,
            workflowRollback: rollback,
          },
        },
      }
    })
  })
}

function mapWorkflowStepStatus(status: string): string {
  const current = status.trim().toLowerCase()
  if (current === 'queued') return 'PENDING'
  if (current === 'running') return 'RUNNING'
  if (current === 'success') return 'SUCCESS'
  if (current === 'failed') return 'FAILED'
  if (current === 'skipped') return 'SKIPPED'
  return status.toUpperCase() || 'UNKNOWN'
}

function buildWorkflowStepDetail(step: Record<string, unknown>, index: number, text: ExecutionDetailText): string {
  const status = readString(step, ['status'], '')
  const errorCode = readString(step, ['errorCode'], '')
  const errorMessage = readString(step, ['errorMessage'], '')
  const assertions = readArray(step, 'assertions')
  const failedAssertions = assertions.filter((item) => readPath(item, 'passed') === false)
  if (status === 'running') return text('executionDetail.step.running.dispatched')
  if (status === 'queued') return text('executionDetail.step.pending.waitingDependency')
  if (status === 'failed') {
    return `${errorCode || 'WORKFLOW_STEP_FAILED'}: ${errorMessage || failedAssertions[0]?.message || text('executionDetail.workflowStep.failedDefault', { index: index + 1 })}`
  }
  if (status === 'skipped') return text('executionDetail.workflowStep.skipped')
  if (assertions.length > 0) {
    return text('executionDetail.workflowStep.successAssertions', { passed: assertions.length - failedAssertions.length, total: assertions.length })
  }
  return text('executionDetail.workflowStep.success')
}

function buildWorkflowStepLogLines(record: Record<string, unknown>, step: Record<string, unknown>, baseId: string, baseTime: string, baseStep: string, text: ExecutionDetailText): ExecutionLogLine[] {
  const logs = readStringList(readPath(step, 'logs'))
  const status = readString(step, ['status'], '')
  const requestId = readString(record, ['requestId'], '')
  const primary: ExecutionLogLine = {
    id: `line-${baseId}`,
    time: baseTime,
    level: normalizeLevel(status),
    step: baseStep,
    message: buildWorkflowStepDetail(step, 0, text),
    requestId,
  }
  return [
    primary,
    ...logs.map((message, index) => ({
      id: `line-${baseId}-workflow-${index + 1}`,
      time: baseTime,
      level: normalizeLevel(status),
      step: baseStep,
      message,
      requestId,
    })),
  ]
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean)
}

function mergeDryRunChecks(checks: readonly ApiRecord[]): ApiRecord[] {
  const byKey = new Map<string, ApiRecord>()
  for (const check of checks) {
    const key = stringValue(check.key ?? check.label ?? check.id, '')
    if (!key) continue
    const existing = byKey.get(key)
    if (!existing || statusRank(check.status) >= statusRank(existing.status)) {
      byKey.set(key, { ...existing, ...check })
    }
  }
  return [...byKey.values()]
}

function countDryRunStatuses(checks: readonly ApiRecord[]) {
  const counts = { passed: 0, warning: 0, failed: 0, unknown: 0 }
  for (const check of checks) counts[normalizeDryRunStatus(check.status)] += 1
  return counts
}

function normalizeDryRunStatus(value: unknown): DryRunStatus {
  const current = String(value ?? '').toLowerCase()
  if (current === 'passed' || current === 'success') return 'passed'
  if (current === 'failed' || current === 'error') return 'failed'
  if (current === 'warning' || current === 'warn') return 'warning'
  return 'unknown'
}

function statusRank(value: unknown): number {
  const status = normalizeDryRunStatus(value)
  if (status === 'failed') return 4
  if (status === 'warning') return 3
  if (status === 'unknown') return 2
  return 1
}

function formatStepRange(record: Record<string, unknown>, side: 'start' | 'end'): string {
  const value = side === 'start'
    ? readString(record, ['startedAt', 'createdAt'], '')
    : readString(record, ['finishedAt', 'updatedAt'], '')
  return formatLocalTime(value)
}

function formatLocalTime(value: string): string {
  if (!value) return ''
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return value
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(time))
}

function normalizeLevel(value: unknown): ExecutionLogLine['level'] {
  const current = String(value ?? '').toUpperCase()
  if (current === 'FAILED' || current === 'ERROR' || current === 'TIMEOUT') return 'error'
  if (current === 'WARN' || current === 'WARNING' || current === 'PENDING_APPROVAL') return 'warn'
  return 'info'
}

function normalizeCheckLevel(value: unknown): ExecutionLogLine['level'] {
  const current = String(value ?? '').toLowerCase()
  if (current === 'failed' || current === 'error') return 'error'
  if (current === 'warning' || current === 'warn' || current === 'manualrisk') return 'warn'
  return 'info'
}

function readObject(record: unknown, path: string): Record<string, unknown> | undefined {
  const value = path ? readPath(record as Record<string, unknown>, path) : record
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function readArray(record: Record<string, unknown> | undefined, path: string): Record<string, unknown>[] {
  const value = record ? readPath(record, path) : undefined
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : []
}

function readCount(record: Record<string, unknown> | undefined, key: string): number {
  const value = record?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function formatBinding(hostHeader: unknown, port: unknown, text: ExecutionDetailText): string {
  const host = stringValue(hostHeader, text('executionDetail.binding.hostMissing'))
  const portValue = typeof port === 'number' || typeof port === 'string' ? String(port) : '443'
  return `${host}:${portValue}`
}

function stringValue(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return fallback
}

function inferProviderLabel(record: Record<string, unknown>, text: ExecutionDetailText): string {
  const providerType = readString(record, ['inputSnapshot.providerType'], '').trim().toUpperCase()
  if (providerType === 'NGINX') return 'NGINX'
  if (providerType === 'IIS') return 'IIS'
  const type = readString(record, ['inputSnapshot.type'], '').trim().toLowerCase()
  if (type.startsWith('linux.nginx.')) return 'NGINX'
  if (type.startsWith('windows.iis.')) return 'IIS'
  return text('executionDetail.provider.target')
}
