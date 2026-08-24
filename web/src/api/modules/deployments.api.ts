import { listRecords, postAction, type ApiBody, type BusinessListQuery } from './common'

const DEPLOYMENT_PLANS_PATH = '/api/v1/deployment-plans'

export function listDeploymentPlans(query?: BusinessListQuery) {
  return listRecords(DEPLOYMENT_PLANS_PATH, query)
}

export function createDeploymentPlan(payload: ApiBody) {
  return postAction(DEPLOYMENT_PLANS_PATH, payload, 'deployment_create')
}

export function dryRunDeploymentPlan(payload: ApiBody) {
  return postAction(`${DEPLOYMENT_PLANS_PATH}/dry-run`, payload, 'deployment_dry_run')
}

export function submitDeploymentPlan(planId: string, payload: ApiBody = {}) {
  return postAction(`${DEPLOYMENT_PLANS_PATH}/submit`, { ...payload, planId }, 'deployment_submit')
}

export function executeDeploymentPlan(planId: string, payload: ApiBody = {}) {
  return postAction(`${DEPLOYMENT_PLANS_PATH}/execute`, { ...payload, planId }, 'deployment_execute')
}

export function cancelDeploymentPlan(planId: string, payload: ApiBody = {}) {
  return postAction(`${DEPLOYMENT_PLANS_PATH}/cancel`, { ...payload, planId }, 'deployment_cancel')
}
