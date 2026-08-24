import { createDeploymentPlan, dryRunDeploymentPlan, executeDeploymentPlan, listDeploymentPlans, submitDeploymentPlan } from '@/api/modules/deployments.api'
import type { BusinessPageConfig } from '@/views/business-page.types'

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
  columns: [
    { key: 'name', title: '计划名称', candidates: ['name', 'title', 'planName'] },
    { key: 'status', title: '状态', candidates: ['status', 'state'] },
    { key: 'risk', title: '风险', candidates: ['risk', 'riskLevel'] },
    { key: 'count', title: '影响目标数', candidates: ['targetCount', 'affectedCount'], kind: 'count' },
    { key: 'scheduledAt', title: '计划时间', candidates: ['scheduledAt', 'createdAt'], kind: 'date' }
  ],
  metrics: [
    { title: '计划总数', description: '等待审批、待执行和运行中的计划。', status: 'PENDING_APPROVAL', risk: 'HIGH' },
    { title: '高危待处理', description: '影响生产服务或缺少回滚能力的计划。', status: 'PENDING_APPROVAL', risk: 'CRITICAL' }
  ],
  detailFields: [
    { label: '计划 ID', candidates: ['id', 'planId'] },
    { label: '目标范围', candidates: ['targetSummary', 'targets', 'targetIds', 'affectedTargets'] },
    { label: '部署步骤', candidates: ['steps', 'executionSteps', 'workflow.steps'] },
    { label: '审批状态', candidates: ['approval.status', 'approvalStatus', 'approvedBy'] },
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
  actions: [
    { label: '生成影响预览', permission: 'deployment.plan.write', danger: true, confirmText: 'PREVIEW', riskText: '部署前必须先看影响范围、能力匹配和回滚能力。', run: () => dryRunDeploymentPlan({ planId: '', targetIds: [] }) },
    { label: '执行部署计划', permission: 'deployment.plan.execute', danger: true, confirmText: 'EXECUTE', riskText: '执行会改动生产证书配置，必须确认审批和回滚策略。', requiresSelection: true, run: (row) => executeDeploymentPlan(row?.id ?? '', { dryRun: true }) }
  ]
}

export const deploymentPlanActions = {
  createDeploymentPlan,
  dryRunDeploymentPlan,
  submitDeploymentPlan,
  executeDeploymentPlan
}
