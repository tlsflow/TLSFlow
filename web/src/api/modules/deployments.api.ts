import { listRecords, postAction, type ApiBody, type BusinessListQuery } from './common'

const DEPLOYMENT_PLANS_PATH = '/api/v1/deployment-plans'

function requireId(value: string, actionName: string): string {
  const id = value.trim()
  if (!id) throw new Error(`${actionName} 缺少部署计划 ID，已阻止空 planId 请求`)
  return id
}

export function listDeploymentPlans(query?: BusinessListQuery) {
  return listRecords(DEPLOYMENT_PLANS_PATH, query)
}

export function createDeploymentPlan(payload: ApiBody) {
  return postAction(DEPLOYMENT_PLANS_PATH, payload, 'deployment_create')
}

export function createDeploymentPlanFromApplicationAsset(payload: ApiBody) {
  return postAction(`${DEPLOYMENT_PLANS_PATH}/from-application-asset`, payload, 'deployment_from_application_asset')
}

export function dryRunDeploymentPlan(payload: ApiBody) {
  const planId = requireId(String(payload.planId ?? ''), 'dry-run')
  return postAction(`${DEPLOYMENT_PLANS_PATH}/dry-run`, { ...payload, planId }, 'deployment_dry_run')
}

export function submitDeploymentPlan(planId: string, payload: ApiBody = {}) {
  return postAction(`${DEPLOYMENT_PLANS_PATH}/submit`, { ...payload, planId: requireId(planId, '提交部署计划') }, 'deployment_submit')
}

export function executeDeploymentPlan(planId: string, payload: ApiBody = {}) {
  return postAction(`${DEPLOYMENT_PLANS_PATH}/execute`, { ...payload, planId: requireId(planId, '执行部署计划') }, 'deployment_execute')
}

export function cancelDeploymentPlan(planId: string, payload: ApiBody = {}) {
  return postAction(`${DEPLOYMENT_PLANS_PATH}/cancel`, { ...payload, planId: requireId(planId, '取消部署计划') }, 'deployment_cancel')
}

export function deleteDraftDeploymentPlan(planId: string, payload: ApiBody = {}) {
  return postAction(`${DEPLOYMENT_PLANS_PATH}/delete`, { ...payload, planId: requireId(planId, '删除部署计划') }, 'deployment_delete')
}
