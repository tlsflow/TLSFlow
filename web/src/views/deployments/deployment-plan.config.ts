import { createDeploymentPlan, dryRunDeploymentPlan, executeDeploymentPlan, listDeploymentPlans, submitDeploymentPlan, cancelDeploymentPlan, deleteDraftDeploymentPlan } from '@/api/modules/deployments.api'
import { rollbackExecution } from '@/api/modules/executions.api'
import type { ApiRecord } from '@/api/modules/common'
import type { ViewRow } from '@/composables/useBusinessPage'
import type { BusinessPageConfig } from '@/views/business-page.types'

export type DeploymentPlanStatus =
  | 'DRAFT'
  | 'DRY_RUN_PASSED'
  | 'DRY_RUN_FAILED'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'READY'
  | 'RUNNING'
  | 'SUCCESS'
  | 'PARTIAL_SUCCESS'
  | 'FAILED'
  | 'CANCELLED'
  | 'CANCELED'
  | 'ROLLED_BACK'
  | 'ROLLBACK_FAILED'

export interface DeploymentPlanUiAction {
  readonly key: 'dry-run' | 'submit' | 'execute' | 'cancel' | 'rollback' | 'delete'
  readonly label: string
  readonly permission: string
  readonly danger?: boolean
  readonly confirmText?: string
  readonly riskText: string
  readonly visibleWhen: readonly string[]
  readonly run: (row: ViewRow) => Promise<unknown>
  readonly disabledReason?: (row: ViewRow) => string
}

export const deploymentPlanActions = {
  createDeploymentPlan,
  dryRunDeploymentPlan,
  submitDeploymentPlan,
  executeDeploymentPlan,
  cancelDeploymentPlan,
  deleteDraftDeploymentPlan,
  rollbackExecution,
}

export const deploymentPlanUiActions: readonly DeploymentPlanUiAction[] = [
  {
    key: 'dry-run',
    label: 'Dry-run 影响预览',
    permission: 'deployment.plan.write',
    danger: false,
    riskText: '只生成影响预览，不会执行正式部署。',
    visibleWhen: ['DRAFT', 'DRY_RUN_FAILED', 'PENDING_APPROVAL', 'READY', 'SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'ROLLED_BACK', 'ROLLBACK_FAILED'],
    run: (row) => dryRunDeploymentPlan({ planId: requirePlanId(row) }),
  },
  {
    key: 'submit',
    label: '提交审批',
    permission: 'deployment.plan.write',
    confirmText: 'SUBMIT',
    riskText: '提交后计划会进入审批或待执行状态。',
    visibleWhen: ['DRAFT', 'DRY_RUN_PASSED'],
    run: (row) => submitDeploymentPlan(requirePlanId(row)),
  },
  {
    key: 'execute',
    label: '执行部署',
    permission: 'deployment.plan.execute',
    danger: true,
    confirmText: 'EXECUTE',
    riskText: '执行会修改目标证书配置。已完成或失败的计划再次执行也使用这个入口；执行前应先运行 Dry-run 影响预览。',
    visibleWhen: ['APPROVED', 'READY', 'SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'ROLLED_BACK', 'ROLLBACK_FAILED'],
    run: (row) => executeDeploymentPlan(requirePlanId(row), isFinishedPlan(row) ? { reason: 'deployment-plan-reexecute' } : {}),
    disabledReason: (row) => {
      if (!isFinishedPlan(row) && !canExecute(row)) return '缺少审批通过信息，不能执行。'
      if (!hasPassedLatestDryRun(row)) return '正式执行前必须先完成一次成功的 Dry-run 影响预览。'
      return ''
    },
  },
  {
    key: 'cancel',
    label: '取消计划',
    permission: 'deployment.plan.write',
    confirmText: 'CANCEL',
    riskText: '只取消尚未完成的部署计划，不回退已经完成的部署。',
    visibleWhen: ['DRAFT', 'DRY_RUN_PASSED', 'PENDING_APPROVAL', 'APPROVED', 'READY', 'RUNNING'],
    run: (row) => cancelDeploymentPlan(requirePlanId(row)),
  },
  {
    key: 'rollback',
    label: '回滚执行',
    permission: 'execution.rollback',
    danger: true,
    confirmText: 'ROLLBACK',
    riskText: '回滚会再次修改目标服务证书配置，必须使用真实 runId。',
    visibleWhen: ['SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'ROLLBACK_FAILED'],
    run: (row) => rollbackExecution(requireLatestRunId(row), { planId: requirePlanId(row), reason: 'deployment-plan-rollback' }),
    disabledReason: (row) => latestRunId(row) ? '' : '缺少 runId，不能回滚。',
  },
  {
    key: 'delete',
    label: '删除计划',
    permission: 'deployment.plan.write',
    danger: true,
    confirmText: 'DELETE',
    riskText: '会硬删除计划、部署目标、执行记录和对应审计历史，不可恢复。',
    visibleWhen: ['DRAFT', 'DRY_RUN_PASSED', 'DRY_RUN_FAILED', 'PENDING_APPROVAL', 'APPROVED', 'READY', 'RUNNING', 'SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'CANCELLED', 'CANCELED', 'ROLLED_BACK', 'ROLLBACK_FAILED'],
    run: (row) => deleteDraftDeploymentPlan(requirePlanId(row)),
  },
]

export const deploymentPlansPageConfig: BusinessPageConfig = {
  title: '部署计划',
  description: '计划预览、影响范围、审批、执行批次、验证和回滚入口。',
  readPermission: 'deployment.plan.read',
  primaryPermission: 'deployment.plan.write',
  primaryActionLabel: '创建部署计划',
  moduleName: 'deployment-plans',
  resourceName: '部署计划',
  defaultStatus: 'PENDING_APPROVAL',
  defaultRisk: 'HIGH',
  showDetailPanel: true,
  showActionPanel: true,
  columns: [
    { key: 'name', title: '计划名称', candidates: ['name', 'title', 'planName'] },
    { key: 'status', title: '状态', candidates: ['status', 'state'] },
    { key: 'currentAssetCertificateExpiresAt', title: '当前证书结束时间', candidates: ['currentAssetCertificate.expiresAt'], kind: 'date' },
    { key: 'updateNeeded', title: '需要更新', candidates: ['updateNeeded'] },
    { key: 'scheduledAt', title: '计划时间', candidates: ['scheduledAt', 'createdAt'], kind: 'date' },
    { key: 'actions', title: '操作', candidates: [] },
  ],
  metrics: [
    { title: '计划总数', description: '等待审批、待执行和运行中的计划。', status: 'PENDING_APPROVAL', risk: 'HIGH' },
    { title: '高危待处理', description: '影响生产服务或缺少回滚能力的计划。', status: 'PENDING_APPROVAL', risk: 'CRITICAL' },
  ],
  detailFields: [
    { label: '计划 ID', candidates: ['id', 'planId'] },
    { label: '计划名称', candidates: ['name', 'title', 'planName'] },
    { label: '计划状态', candidates: ['status', 'state'] },
    { label: '审批状态', candidates: ['approval.status', 'approvalStatus'] },
    { label: '证书版本 ID', candidates: ['certificateVersionId'] },
    { label: '证书格式配置 ID', candidates: ['certificateFormatId'] },
    { label: '当前证书结束时间', candidates: ['currentAssetCertificate.expiresAt', 'currentAssetCertificateExpiresAt', 'currentAssetCertificateNotAfter'] },
    { label: '需要更新', candidates: ['updateNeeded'] },
    { label: '目标绑定摘要', candidates: ['targetSummary', 'targets.0.certificateBindingId', 'targets.0.executionTargetId'] },
    { label: '最新执行批次', candidates: ['latestRunId', 'latestRun.id', 'runs.0.id', 'executionRuns.0.id'] },
    { label: '审批 ID', candidates: ['approvalId', 'approval.id', 'approval.approvalId'] },
    { label: '快照 Hash', candidates: ['snapshotHash', 'snapshot.hash', 'dryRun.snapshotHash'] },
    { label: '失败原因', candidates: ['failureReason', 'error.message', 'latestRun.failureReason'] },
    { label: '创建时间', candidates: ['createdAt'] },
    { label: '更新时间', candidates: ['updatedAt'] },
  ],
  contextLinks: [
    { label: '查看执行记录', to: '/executions', queryKey: 'planId', candidates: ['id', 'planId'] },
    { label: '查看相关绑定', to: '/bindings', queryKey: 'planId', candidates: ['id', 'planId'] },
  ],
  emptyTitle: '暂无部署计划',
  emptyDescription: '先从证书或绑定进入部署向导，生成影响预览后再提交计划。',
  load: () => listDeploymentPlans({ page: 1, pageSize: 20, sort: 'updatedAt:desc' }),
  actions: deploymentPlanUiActions
    .filter((action) => action.key !== 'delete')
    .map((action) => ({
      label: action.label,
      permission: action.permission,
      danger: action.danger,
      confirmText: action.confirmText,
      riskText: action.riskText,
      requiresSelection: true,
      hidden: (row) => !row || !action.visibleWhen.includes(String(row.status)),
      disabledReason: (row) => {
        if (!row) return '缺少部署计划选择'
        return action.disabledReason?.(row) ?? ''
      },
      run: async (row) => {
        if (!row) throw new Error('缺少部署计划选择')
        return action.run(row)
      },
    })),
  rowActions: deploymentPlanUiActions.map((action) => ({
    label: action.label,
    permission: action.permission,
    danger: action.danger,
    confirmText: action.confirmText,
    riskText: action.riskText,
    hidden: (row: ViewRow) => !action.visibleWhen.includes(String(row.status)),
    run: async (row: ViewRow) => action.run(row),
  })),
}

export function requirePlanId(row: ViewRow): string {
  const planId = stringFromCandidates(row.raw, ['id', 'planId']) || row.id
  if (!planId) throw new Error('缺少部署计划 ID，已阻止空 planId 请求')
  return planId
}

export function latestRunId(row: ViewRow): string {
  return stringFromCandidates(row.raw, [
    'latestRunId',
    'runId',
    'latestRun.id',
    'latestRun.runId',
    'runs.0.id',
    'runs.0.runId',
    'executionRuns.0.id',
    'executionRuns.0.runId',
  ])
}

function requireLatestRunId(row: ViewRow): string {
  const runId = latestRunId(row)
  if (!runId) throw new Error('缺少执行批次 runId，已阻止空 runId 请求')
  return runId
}

function canExecute(row: ViewRow): boolean {
  if (String(row.status) === 'APPROVED') return true
  const approvalStatus = stringFromCandidates(row.raw, ['approvalStatus', 'approval.status'])
  if (approvalStatus === 'NOT_REQUIRED' || approvalStatus === 'APPROVED') return true
  return Boolean(stringFromCandidates(row.raw, ['approvalId', 'approval.id', 'approval.approvalId', 'approvedBy']))
}

function isFinishedPlan(row: ViewRow): boolean {
  return ['SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'ROLLED_BACK', 'ROLLBACK_FAILED'].includes(String(row.status))
}

function hasPassedLatestDryRun(row: ViewRow): boolean {
  const latestRunType = stringFromCandidates(row.raw, ['latestRun.type', 'runs.0.type', 'executionRuns.0.type']).toLowerCase()
  const latestRunStatus = stringFromCandidates(row.raw, ['latestRun.status', 'runs.0.status', 'executionRuns.0.status']).toUpperCase()
  return latestRunType === 'dry_run' && latestRunStatus === 'SUCCESS'
}

function stringFromCandidates(record: ApiRecord, candidates: readonly string[]): string {
  for (const candidate of candidates) {
    const value = readPath(record, candidate)
    if (value === undefined || value === null || value === '') continue
    return String(value)
  }
  return ''
}

function readPath(record: ApiRecord, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined
    if (Array.isArray(current) && /^\d+$/.test(segment)) return current[Number(segment)]
    return (current as Record<string, unknown>)[segment]
  }, record)
}
