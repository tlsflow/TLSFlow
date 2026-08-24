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
import { readPath, readString, type ViewRow } from './useBusinessPage'

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

const terminalRunStatuses = new Set(['SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED', 'ROLLBACK_SUCCESS', 'ROLLBACK_FAILED'])

export function useExecutionDetail(selectedRow: { readonly value: ViewRow | null }) {
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
      error.value = cause instanceof Error ? cause.message : '查询执行步骤失败'
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
    const items = expandWorkflowStepRecords(stepRecords.value)
    steps.value = items.map((record, index) => ({
      id: readString(record, ['id', 'stepId'], `${runId.value}-step-${index + 1}`),
      name: readString(record, ['name', 'stepName'], `步骤 ${index + 1}`),
      status: readString(record, ['status', 'state', 'result'], 'UNKNOWN'),
      detail: buildStepDetail(record, index),
      startedAt: formatStepRange(record, 'start'),
      finishedAt: formatStepRange(record, 'end'),
      requestId: readString(record, ['requestId'], ''),
    }))
    lines.value = items.flatMap((record, index) => buildLogLines(record, index, agentLogsByTaskId.value.get(readDispatchTaskId(record)) ?? []))
    dryRunSummary.value = summarizeDryRun(items)
    dryRunChecks.value = collectDryRunChecks(items)
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
      error.value = cause instanceof Error ? cause.message : '连接执行详情流失败'
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

function summarizeDryRun(items: readonly Record<string, unknown>[]): ExecutionDryRunSummary | null {
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
      label: 'Dry-run 执行失败',
      detail: `已有 ${failedStepCount} 个预检步骤失败或超时，Agent 没有回传结构化结论。`,
      ...counts,
    }
  }

  if (!hasChecks) {
    if (queuedCount === dryRunItems.length) {
      return { state: 'queued', label: 'Dry-run 排队中', detail: '预检任务已创建，等待开始执行。', passed: 0, warning: 0, failed: 0, unknown: 0 }
    }
    if (runningCount > 0 || queuedCount > 0) {
      return { state: 'running', label: 'Dry-run 执行中', detail: '预检已开始，等待结构化结果回传。', passed: 0, warning: 0, failed: 0, unknown: 0 }
    }
    return { state: 'pending', label: 'Dry-run 已结束但无结论', detail: `共有 ${finishedWithoutChecks} 个步骤已结束，但没有 dryRunChecks / dryRunSummary。`, passed: 0, warning: 0, failed: 0, unknown: 0 }
  }

  if (queuedCount > 0 || runningCount > 0) {
    return {
      state: 'running',
      label: 'Dry-run 回传中',
      detail: `已收到部分结论：通过 ${counts.passed}，警告 ${counts.warning}，失败 ${counts.failed}，未知 ${counts.unknown}。`,
      ...counts,
    }
  }

  if (counts.failed > 0) {
    return {
      state: 'failed',
      label: 'Dry-run 失败',
      detail: `预检失败 ${counts.failed} 项，警告 ${counts.warning} 项，通过 ${counts.passed} 项。`,
      ...counts,
    }
  }

  if (counts.warning > 0 || counts.unknown > 0) {
    return {
      state: 'warning',
      label: 'Dry-run 有风险提示',
      detail: `预检已完成：通过 ${counts.passed} 项，警告 ${counts.warning} 项，未知 ${counts.unknown} 项。`,
      ...counts,
    }
  }

  return {
    state: 'passed',
    label: 'Dry-run 成功',
    detail: `预检全部通过，共 ${counts.passed} 项。`,
    ...counts,
  }
}

function buildStepDetail(record: Record<string, unknown>, index: number): string {
  const resultDetail = readObject(record, 'inputSnapshot.resultDetail')
  const workflowStepResult = readObject(resultDetail, 'workflowStepResult')
  if (workflowStepResult) return buildWorkflowStepDetail(workflowStepResult, index)
  const dispatchDetail = readObject(record, 'inputSnapshot.dispatchDetail')
  const failureDetail = readObject(resultDetail, 'failure')
  const verificationRecovery = readObject(resultDetail, 'verificationRecovery')
  const dryRunSummary = readObject(resultDetail, 'dryRunSummary')
  const dryRunChecks = readArray(resultDetail, 'dryRunChecks')
  const stepType = readString(record, ['stepType', 'type'], '')
  const stepStatus = String(readPath(record, 'status') ?? '').toUpperCase()
  const lastErrorCode = readString(record, ['lastErrorCode'], '')
  const lastErrorMessage = readString(record, ['lastErrorMessage'], '')
  const resultErrorCode = readString(resultDetail ?? {}, ['errorCode'], '')
  const resultErrorMessage = readString(resultDetail ?? {}, ['errorMessage', 'message', 'detail', 'summary'], '')
  const failureMessage = readString(failureDetail ?? {}, ['errorMessage', 'message'], '')
  const taskId = readString(dispatchDetail ?? {}, ['taskId'], '') || readString(resultDetail ?? {}, ['taskId'], '')
  const siteName = readPath(record, 'inputSnapshot.siteName')
  const verifyUrl = readString(record, ['inputSnapshot.verifyUrl'], '')
  const bindingSelector = readObject(record, 'inputSnapshot.bindingSelector')
  const hostHeader = readPath(bindingSelector ?? {}, 'hostHeader')
  const port = readPath(bindingSelector ?? {}, 'port')
  const providerLabel = inferProviderLabel(record)

  if (dryRunChecks.length > 0) {
    const passed = readCount(dryRunSummary, 'passed')
    const failed = readCount(dryRunSummary, 'failed')
    const warning = readCount(dryRunSummary, 'warning')
    const unknown = readCount(dryRunSummary, 'unknown')
    const topChecks = dryRunChecks
      .slice(0, 3)
      .map((item) => `${stringValue(item.label ?? item.key, 'check')}: ${stringValue(item.status, 'unknown')}`)
      .join('；')
    return `预检结论：通过 ${passed} / 警告 ${warning} / 失败 ${failed} / 未知 ${unknown}。${topChecks}`
  }

  if (readPath(record, 'inputSnapshot.dryRun') === true) {
    const pendingText = stepStatus === 'PENDING' || stepStatus === 'DISPATCHED'
      ? '当前仍在队列中，尚未开始执行。'
      : stepStatus === 'RUNNING'
        ? '当前步骤执行中，等待 Agent 回传结论。'
        : ['FAILED', 'TIMEOUT', 'CANCELLED'].includes(stepStatus)
          ? '当前步骤执行失败，且还没有拿到结构化预检结论。'
          : '当前步骤已结束，但还没有拿到结构化预检结论。'
    if (stepType === 'DISCOVER') {
      return `只读预检：识别部署目标与 ${providerLabel} 站点上下文。站点 ${stringValue(siteName, '未命名站点')}，绑定 ${formatBinding(hostHeader, port)}。${pendingText}`
    }
    if (stepType === 'VERIFY') {
      return `只读预检：校验证书材料、目标绑定和域名匹配。目标 ${providerLabel} 绑定 ${formatBinding(hostHeader, port)}。${pendingText}`
    }
    return `只读预检已创建。${pendingText}`
  }

  if (['FAILED', 'TIMEOUT', 'CANCELLED'].includes(stepStatus)) {
    const code = lastErrorCode || resultErrorCode || stringValue(readPath(failureDetail ?? {}, 'errorCode'), 'STEP_FAILED')
    const message = lastErrorMessage || resultErrorMessage || failureMessage || '后端未收到具体错误消息'
    return `${code}: ${message}${taskId ? `（Agent taskId=${taskId}）` : ''}`
  }

  if (stepStatus === 'RUNNING') {
    return taskId
      ? `已派发 Agent 任务 taskId=${taskId}，等待 Agent 回传执行结果。`
      : '步骤正在执行，尚未拿到 Agent taskId 或执行结果。'
  }

  if (stepStatus === 'PENDING') {
    return '步骤等待前置步骤完成。'
  }

  if (stepStatus === 'SUCCESS' && stepType === 'VERIFY' && verificationRecovery) {
    const remoteTarget = readString(resultDetail ?? {}, ['verify.target'], verifyUrl || formatBinding(hostHeader, port))
    const originalError = readString(verificationRecovery, ['originalErrorMessage'], '')
    return `Agent 侧远程 TLS 探测失败，但控制面已对 ${remoteTarget} 完成真实 TLS 验证并确认目标证书匹配。${originalError ? `原始 Agent 错误：${originalError}` : ''}`
  }

  if (resultDetail) {
    const mode = readString(resultDetail, ['mode'], '')
    const executor = readString(resultDetail, ['executor'], '')
    if (mode || executor) return `${executor || 'executor'} ${mode || 'result'} 已返回。${taskId ? `Agent taskId=${taskId}` : ''}`
  }

  return readString(record, ['message', 'detail', 'summary'], `步骤 ${index + 1} 已创建，等待后端补充说明`)
}

function buildLogLines(record: Record<string, unknown>, index: number, agentLogs: readonly ApiRecord[] = []): ExecutionLogLine[] {
  const baseTime = formatLocalTime(readString(record, ['updatedAt', 'finishedAt', 'startedAt', 'createdAt'], ''))
  const baseStep = readString(record, ['name', 'stepName'], `步骤 ${index + 1}`)
  const baseId = readString(record, ['id', 'stepId'], String(index + 1))
  const resultDetail = readObject(record, 'inputSnapshot.resultDetail')
  const workflowStepResult = readObject(resultDetail, 'workflowStepResult')
  if (workflowStepResult) return buildWorkflowStepLogLines(record, workflowStepResult, baseId, baseTime, baseStep)
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
    message: buildStepDetail(record, index),
    requestId: readString(record, ['requestId'], ''),
  }
  const recoveredVerifySuccess = String(readPath(record, 'status') ?? '').toUpperCase() === 'SUCCESS'
    && verificationRecovery
    && readString(record, ['stepType', 'type'], '') === 'VERIFY'
  const normalizedAgentLogs = recoveredVerifySuccess
    ? agentLogs.filter((log) => {
      const message = readString(log, ['message'], '')
      return !message.includes('TLS 证书验证失败') && !message.includes('任务执行失败: TLS 连接失败')
    })
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
    message: '[ControlPlane] Agent 侧远程 TLS 探测失败，但控制面已完成真实 TLS 验证并确认目标证书匹配。',
    requestId: readString(record, ['requestId'], ''),
  }] : []
  return [baseLine, ...recoveryLine, ...agentLines]
}

function expandWorkflowStepRecords(items: readonly ApiRecord[]): ApiRecord[] {
  return items.flatMap((item, index) => {
    const resultDetail = readObject(item, 'inputSnapshot.resultDetail')
    const workflowRun = readObject(resultDetail, 'workflowRun')
    const stepResults = readArray(workflowRun, 'stepResults')
    const rollbackResults = readArray(workflowRun, 'rollbackResults')
    const workflowResults = [
      ...stepResults.map((step) => ({ step, rollback: false })),
      ...rollbackResults.map((step) => ({ step, rollback: true })),
    ]
    if (workflowResults.length === 0) return [item]
    const parentId = readString(item, ['id', 'stepId'], `workflow-${index + 1}`)
    const workflowRunId = readString(workflowRun ?? {}, ['id'], '')
    return workflowResults.map(({ step, rollback }, stepIndex) => {
      const name = readString(step, ['name'], `${rollback ? 'rollback' : 'workflow'}-${stepIndex + 1}`)
      const status = mapWorkflowStepStatus(readString(step, ['status'], ''))
      return {
        ...item,
        id: `${parentId}:workflow:${rollback ? 'rollback:' : ''}${name}`,
        name: rollback ? `rollback.${name}` : name,
        status,
        stepType: readString(step, ['type'], readString(item, ['stepType', 'type'], 'WORKFLOW')).toUpperCase(),
        startedAt: readString(item, ['startedAt', 'createdAt'], ''),
        finishedAt: readString(item, ['finishedAt', 'updatedAt'], ''),
        inputSnapshot: {
          ...(readObject(item, 'inputSnapshot') ?? {}),
          resultDetail: {
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
  if (current === 'success') return 'SUCCESS'
  if (current === 'failed') return 'FAILED'
  if (current === 'skipped') return 'SKIPPED'
  return status.toUpperCase() || 'UNKNOWN'
}

function buildWorkflowStepDetail(step: Record<string, unknown>, index: number): string {
  const status = readString(step, ['status'], '')
  const errorCode = readString(step, ['errorCode'], '')
  const errorMessage = readString(step, ['errorMessage'], '')
  const assertions = readArray(step, 'assertions')
  const failedAssertions = assertions.filter((item) => readPath(item, 'passed') === false)
  if (status === 'failed') {
    return `${errorCode || 'WORKFLOW_STEP_FAILED'}: ${errorMessage || failedAssertions[0]?.message || `工作流节点 ${index + 1} 执行失败`}`
  }
  if (status === 'skipped') return '工作流节点已跳过，条件未满足。'
  if (assertions.length > 0) {
    return `工作流节点执行成功，断言通过 ${assertions.length - failedAssertions.length}/${assertions.length}。`
  }
  return '工作流节点执行成功。'
}

function buildWorkflowStepLogLines(record: Record<string, unknown>, step: Record<string, unknown>, baseId: string, baseTime: string, baseStep: string): ExecutionLogLine[] {
  const logs = readStringList(readPath(step, 'logs'))
  const status = readString(step, ['status'], '')
  const requestId = readString(record, ['requestId'], '')
  const primary: ExecutionLogLine = {
    id: `line-${baseId}`,
    time: baseTime,
    level: normalizeLevel(status),
    step: baseStep,
    message: buildWorkflowStepDetail(step, 0),
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

function formatBinding(hostHeader: unknown, port: unknown): string {
  const host = stringValue(hostHeader, '未提供 host header')
  const portValue = typeof port === 'number' || typeof port === 'string' ? String(port) : '443'
  return `${host}:${portValue}`
}

function stringValue(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return fallback
}

function inferProviderLabel(record: Record<string, unknown>): string {
  const providerType = readString(record, ['inputSnapshot.providerType'], '').trim().toUpperCase()
  if (providerType === 'NGINX') return 'NGINX'
  if (providerType === 'IIS') return 'IIS'
  const type = readString(record, ['inputSnapshot.type'], '').trim().toLowerCase()
  if (type.startsWith('linux.nginx.')) return 'NGINX'
  if (type.startsWith('windows.iis.')) return 'IIS'
  return '目标'
}
