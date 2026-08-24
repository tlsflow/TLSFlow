import { createDeploymentPlan, dryRunDeploymentPlan, executeDeploymentPlan, listDeploymentPlans, submitDeploymentPlan, cancelDeploymentPlan, deleteDraftDeploymentPlan } from '@/api/modules/deployments.api'
import { rollbackExecution } from '@/api/modules/executions.api'
import type { ApiRecord } from '@/api/modules/common'
import type { ViewRow } from '@/composables/useBusinessPage'
import { i18n } from '@/i18n'
import type { BusinessPageConfig } from '@/views/business-page.types'
import type { I18nTranslate } from '@/composables/useBusinessPage'

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

function defaultT(key: string, params?: Record<string, string | number>): string {
  return i18n.global.t(key, params ?? {})
}

export function createDeploymentPlanUiActions(t: I18nTranslate = defaultT): readonly DeploymentPlanUiAction[] {
  return [
  {
    key: 'dry-run',
    label: t('deploymentPlans.actions.dryRun'),
    permission: 'deployment.plan.write',
    danger: false,
    riskText: t('deploymentPlans.actions.dryRunRisk'),
    visibleWhen: ['DRAFT', 'DRY_RUN_FAILED', 'PENDING_APPROVAL', 'READY', 'SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'ROLLED_BACK', 'ROLLBACK_FAILED'],
    run: (row) => dryRunDeploymentPlan({ planId: requirePlanId(row) }),
  },
  {
    key: 'submit',
    label: t('deploymentPlans.actions.submit'),
    permission: 'deployment.plan.write',
    confirmText: 'SUBMIT',
    riskText: t('deploymentPlans.actions.submitRisk'),
    visibleWhen: ['DRAFT', 'DRY_RUN_PASSED'],
    run: (row) => submitDeploymentPlan(requirePlanId(row)),
  },
  {
    key: 'execute',
    label: t('deploymentPlans.actions.execute'),
    permission: 'deployment.plan.execute',
    danger: true,
    confirmText: 'EXECUTE',
    riskText: t('deploymentPlans.actions.executeRisk'),
    visibleWhen: ['APPROVED', 'READY', 'SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'ROLLED_BACK', 'ROLLBACK_FAILED'],
    run: (row) => executeDeploymentPlan(requirePlanId(row), isFinishedPlan(row) ? { reason: 'deployment-plan-reexecute' } : {}),
    disabledReason: (row) => {
      if (!isFinishedPlan(row) && !canExecute(row)) return t('deploymentPlans.disabled.missingApproval')
      if (!hasPassedLatestDryRun(row)) return t('deploymentPlans.disabled.needDryRun')
      return ''
    },
  },
  {
    key: 'cancel',
    label: t('deploymentPlans.actions.cancel'),
    permission: 'deployment.plan.write',
    confirmText: 'CANCEL',
    riskText: t('deploymentPlans.actions.cancelRisk'),
    visibleWhen: ['DRAFT', 'DRY_RUN_PASSED', 'PENDING_APPROVAL', 'APPROVED', 'READY', 'RUNNING'],
    run: (row) => cancelDeploymentPlan(requirePlanId(row)),
  },
  {
    key: 'rollback',
    label: t('deploymentPlans.actions.rollback'),
    permission: 'execution.rollback',
    danger: true,
    confirmText: 'ROLLBACK',
    riskText: t('deploymentPlans.actions.rollbackRisk'),
    visibleWhen: ['SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'ROLLBACK_FAILED'],
    run: (row) => rollbackExecution(requireLatestRunId(row), { planId: requirePlanId(row), reason: 'deployment-plan-rollback' }),
    disabledReason: (row) => latestRunId(row) ? '' : t('deploymentPlans.disabled.missingRunId'),
  },
  {
    key: 'delete',
    label: t('deploymentPlans.actions.delete'),
    permission: 'deployment.plan.write',
    danger: true,
    confirmText: 'DELETE',
    riskText: t('deploymentPlans.actions.deleteRisk'),
    visibleWhen: ['DRAFT', 'DRY_RUN_PASSED', 'DRY_RUN_FAILED', 'PENDING_APPROVAL', 'APPROVED', 'READY', 'RUNNING', 'SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'CANCELLED', 'CANCELED', 'ROLLED_BACK', 'ROLLBACK_FAILED'],
    run: (row) => deleteDraftDeploymentPlan(requirePlanId(row)),
  },
  ]
}

export const deploymentPlanUiActions: readonly DeploymentPlanUiAction[] = createDeploymentPlanUiActions()

export function createDeploymentPlansPageConfig(t: I18nTranslate = defaultT): BusinessPageConfig {
  const uiActions = createDeploymentPlanUiActions(t)
  return {
  title: t('deploymentPlans.title'),
  description: t('deploymentPlans.description'),
  readPermission: 'deployment.plan.read',
  primaryPermission: 'deployment.plan.write',
  primaryActionLabel: t('deploymentPlans.actions.create'),
  moduleName: 'deployment-plans',
  resourceName: t('deploymentPlans.resourceName'),
  defaultStatus: 'PENDING_APPROVAL',
  defaultRisk: 'HIGH',
  showDetailPanel: true,
  showActionPanel: true,
  columns: [
    { key: 'name', title: t('deploymentPlans.columns.name'), candidates: ['name', 'title', 'planName'] },
    { key: 'status', title: t('deploymentPlans.columns.status'), candidates: ['status', 'state'] },
    { key: 'currentAssetCertificateExpiresAt', title: t('deploymentPlans.columns.currentAssetCertificateExpiresAt'), candidates: ['currentAssetCertificate.expiresAt'], kind: 'date' },
    { key: 'updateNeeded', title: t('deploymentPlans.columns.updateNeeded'), candidates: ['updateNeeded'] },
    { key: 'scheduledAt', title: t('deploymentPlans.columns.scheduledAt'), candidates: ['scheduledAt', 'createdAt'], kind: 'date' },
    { key: 'actions', title: t('deploymentPlans.columns.actions'), candidates: [] },
  ],
  metrics: [
    { title: t('deploymentPlans.metrics.total.title'), description: t('deploymentPlans.metrics.total.description'), status: 'PENDING_APPROVAL', risk: 'HIGH', kind: 'total' },
    { title: t('deploymentPlans.metrics.risky.title'), description: t('deploymentPlans.metrics.risky.description'), status: 'PENDING_APPROVAL', risk: 'CRITICAL' },
  ],
  detailFields: [
    { label: t('deploymentPlans.fields.planId'), candidates: ['id', 'planId'] },
    { label: t('deploymentPlans.fields.name'), candidates: ['name', 'title', 'planName'] },
    { label: t('deploymentPlans.fields.status'), candidates: ['status', 'state'] },
    { label: t('deploymentPlans.fields.approvalStatus'), candidates: ['approval.status', 'approvalStatus'] },
    { label: t('deploymentPlans.fields.certificateVersionId'), candidates: ['certificateVersionId'] },
    { label: t('deploymentPlans.fields.certificateFormatId'), candidates: ['certificateFormatId'] },
    { label: t('deploymentPlans.fields.currentAssetCertificateExpiresAt'), candidates: ['currentAssetCertificate.expiresAt', 'currentAssetCertificateExpiresAt', 'currentAssetCertificateNotAfter'] },
    { label: t('deploymentPlans.fields.updateNeeded'), candidates: ['updateNeeded'] },
    { label: t('deploymentPlans.fields.targetSummary'), candidates: ['targetSummary', 'targets.0.certificateBindingId', 'targets.0.executionTargetId'] },
    { label: t('deploymentPlans.fields.latestRun'), candidates: ['latestRunId', 'latestRun.id', 'runs.0.id', 'executionRuns.0.id'] },
    { label: t('deploymentPlans.fields.approvalId'), candidates: ['approvalId', 'approval.id', 'approval.approvalId'] },
    { label: t('deploymentPlans.fields.snapshotHash'), candidates: ['snapshotHash', 'snapshot.hash', 'dryRun.snapshotHash'] },
    { label: t('deploymentPlans.fields.failureReason'), candidates: ['failureReason', 'error.message', 'latestRun.failureReason'] },
    { label: t('deploymentPlans.fields.createdAt'), candidates: ['createdAt'] },
    { label: t('deploymentPlans.fields.updatedAt'), candidates: ['updatedAt'] },
  ],
  contextLinks: [
    { label: t('deploymentPlans.links.executions'), to: '/executions', queryKey: 'planId', candidates: ['id', 'planId'] },
    { label: t('deploymentPlans.links.bindings'), to: '/bindings', queryKey: 'planId', candidates: ['id', 'planId'] },
  ],
  emptyTitle: t('deploymentPlans.empty.title'),
  emptyDescription: t('deploymentPlans.empty.description'),
  load: () => listDeploymentPlans({ page: 1, pageSize: 20, sort: 'updatedAt:desc' }),
  actions: uiActions
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
        if (!row) return t('deploymentPlans.disabled.missingSelection')
        return action.disabledReason?.(row) ?? ''
      },
      run: async (row) => {
        if (!row) throw new Error(t('deploymentPlans.disabled.missingSelection'))
        return action.run(row)
      },
    })),
  rowActions: uiActions.map((action) => ({
    label: action.label,
    permission: action.permission,
    danger: action.danger,
    confirmText: action.confirmText,
    riskText: action.riskText,
    hidden: (row: ViewRow) => !action.visibleWhen.includes(String(row.status)),
    run: async (row: ViewRow) => action.run(row),
  })),
}
}

export const deploymentPlansPageConfig: BusinessPageConfig = createDeploymentPlansPageConfig()

export function requirePlanId(row: ViewRow): string {
  const planId = stringFromCandidates(row.raw, ['id', 'planId']) || row.id
  if (!planId) throw new Error(defaultT('deploymentPlans.errors.missingPlanId'))
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
  if (!runId) throw new Error(defaultT('deploymentPlans.errors.missingRunIdRequest'))
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
