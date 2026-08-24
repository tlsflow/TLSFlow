import { createDeploymentPlan, dryRunDeploymentPlan, executeDeploymentPlan, listDeploymentPlans, submitDeploymentPlan, cancelDeploymentPlan } from '@/api/modules/deployments.api'
import { retryExecution, rollbackExecution } from '@/api/modules/executions.api'
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
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELED'
  | 'ROLLED_BACK'
  | 'ROLLBACK_FAILED'

export interface DeploymentPlanUiAction {
  readonly key: 'dry-run' | 'submit' | 'execute' | 'cancel' | 'retry' | 'rollback'
  readonly label: string
  readonly permission: string
  readonly danger?: boolean
  readonly confirmText?: string
  readonly riskText: string
  readonly visibleWhen: readonly string[]
  readonly run: (row: ViewRow) => Promise<unknown>
  readonly disabledReason?: (row: ViewRow) => string
}

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
  columns: [
    { key: 'name', title: '计划名称', candidates: ['name', 'title', 'planName'] },
    { key: 'status', title: '状态', candidates: ['status', 'state'] },
    { key: 'risk', title: '风险', candidates: ['risk', 'riskLevel'] },
    { key: 'count', title: '影响目标数', candidates: ['targetCount', 'affectedCount', 'targets.length'], kind: 'count' },
    { key: 'scheduledAt', title: '计划时间', candidates: ['scheduledAt', 'createdAt'], kind: 'date' }
  ],
  metrics: [
    { title: '计划总数', description: '等待审批、待执行和运行中的计划。', status: 'PENDING_APPROVAL', risk: 'HIGH' },
    { title: '高危待处理', description: '影响生产服务或缺少回滚能力的计划。', status: 'PENDING_APPROVAL', risk: 'CRITICAL' }
  ],
  detailFields: [
    { label: '计划 ID', candidates: ['id', 'planId'] },
    { label: '目标范围', candidates: ['targetSummary', 'targets', 'targetIds', 'affectedTargets'] },
    { label: '执行批次', candidates: ['runs', 'executionRuns', 'latestRun'] },
    { label: '部署步骤', candidates: ['steps', 'executionSteps', 'workflow.steps'] },
    { label: '审批 ID', candidates: ['approvalId', 'approval.id', 'approval.approvalId'] },
    { label: '审批状态', candidates: ['approval.status', 'approvalStatus', 'approvedBy'] },
    { label: '快照 Hash', candidates: ['snapshotHash', 'snapshot.hash', 'dryRun.snapshotHash'] },
    { label: '失败原因', candidates: ['failureReason', 'error.message', 'latestRun.failureReason'] },
    { label: '回滚策略', candidates: ['rollbackPlan', 'rollbackStrategy', 'rollback.enabled'] },
    { label: '计划时间', candidates: ['scheduledAt', 'createdAt'] }
  ],
  contextLinks: [
    { label: '查看执行记录', to: '/executions', queryKey: 'planId', candidates: ['id', 'planId'] },
    { label: '查看相关绑定', to: '/bindings', queryKey: 'planId', candidates: ['id', 'planId'] }
  ],
  emptyTitle: '暂无部署计划',
  emptyDescription: '先从证书或绑定进入部署向导，生成影响预览后再提交计划。',
  load: () => listDeploymentPlans({ page: 1, pageSize: 20, sort: 'updatedAt:desc' }),
  // 中文说明：部署计划页动作需要按状态显隐和禁用；通用 BusinessResourcePage 的动作模型不够，页面内单独渲染，避免空 planId。
  actions: []
}

export const deploymentPlanActions = {
  createDeploymentPlan,
  dryRunDeploymentPlan,
  submitDeploymentPlan,
  executeDeploymentPlan,
  cancelDeploymentPlan,
  retryExecution,
  rollbackExecution
}

export const deploymentPlanUiActions: readonly DeploymentPlanUiAction[] = [
  {
    key: 'dry-run',
    label: 'Dry-run 影响预览',
    permission: 'deployment.plan.write',
    confirmText: 'PREVIEW',
    riskText: '只生成真实影响预览，不执行部署；必须带真实 planId。',
    visibleWhen: ['DRAFT', 'DRY_RUN_FAILED'],
    run: (row) => dryRunDeploymentPlan({ planId: requirePlanId(row) })
  },
  {
    key: 'submit',
    label: '提交审批',
    permission: 'deployment.plan.write',
    confirmText: 'SUBMIT',
    riskText: '提交后可能进入审批或待执行状态，后端会返回 approvalId。',
    visibleWhen: ['DRAFT', 'DRY_RUN_PASSED'],
    run: (row) => submitDeploymentPlan(requirePlanId(row))
  },
  {
    key: 'execute',
    label: '执行部署',
    permission: 'deployment.plan.execute',
    danger: true,
    confirmText: 'EXECUTE',
    riskText: '执行会改动目标证书配置，必须已有审批或处于可执行状态。',
    visibleWhen: ['APPROVED', 'READY'],
    run: (row) => executeDeploymentPlan(requirePlanId(row)),
    disabledReason: (row) => hasApprovalHint(row) ? '' : '缺少 approvalId，不能执行'
  },
  {
    key: 'cancel',
    label: '取消计划',
    permission: 'deployment.plan.write',
    confirmText: 'CANCEL',
    riskText: '只取消尚未完成的部署计划，不会伪造 dryRun。',
    visibleWhen: ['DRAFT', 'DRY_RUN_PASSED', 'PENDING_APPROVAL', 'APPROVED', 'READY', 'RUNNING'],
    run: (row) => cancelDeploymentPlan(requirePlanId(row))
  },
  {
    key: 'retry',
    label: '重试执行',
    permission: 'deployment.plan.execute',
    danger: true,
    confirmText: 'RETRY',
    riskText: '重试失败执行批次，需要从计划 runs 中取得真实 runId。',
    visibleWhen: ['FAILED'],
    run: (row) => retryExecution(requireLatestRunId(row), { planId: requirePlanId(row), reason: 'deployment-plan-retry' }),
    disabledReason: (row) => latestRunId(row) ? '' : '缺少 runId，不能重试'
  },
  {
    key: 'rollback',
    label: '回滚执行',
    permission: 'execution.rollback',
    danger: true,
    confirmText: 'ROLLBACK',
    riskText: '回滚会再次改动目标服务证书配置，必须使用真实 runId。',
    visibleWhen: ['FAILED', 'SUCCEEDED', 'ROLLBACK_FAILED'],
    run: (row) => rollbackExecution(requireLatestRunId(row), { planId: requirePlanId(row), reason: 'deployment-plan-rollback' }),
    disabledReason: (row) => latestRunId(row) ? '' : '缺少 runId，不能回滚'
  }
]

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
    'executionRuns.0.runId'
  ])
}

function requireLatestRunId(row: ViewRow): string {
  const runId = latestRunId(row)
  if (!runId) throw new Error('缺少执行批次 runId，已阻止空 runId 请求')
  return runId
}

function hasApprovalHint(row: ViewRow): boolean {
  return Boolean(stringFromCandidates(row.raw, ['approvalId', 'approval.id', 'approval.approvalId', 'approvedBy']))
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
