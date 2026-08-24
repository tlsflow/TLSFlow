import { apiClient } from '@/api/client'
import { listRecords, postAction, toClientPath, type ApiBody, type ApiPage, type BusinessListQuery } from './common'
import { i18n } from '@/i18n'

const DEPLOYMENT_PLANS_PATH = '/api/v1/deployment-plans'

function requireId(value: string, actionName: string): string {
  const id = value.trim()
  if (!id) throw new Error(i18n.global.t('deploymentPlans.errors.missingPlanIdForAction', { action: actionName }))
  return id
}

export function listDeploymentPlans(query?: BusinessListQuery) {
  return listRecords(DEPLOYMENT_PLANS_PATH, query)
}

/** 资产详情只读取该应用资产关联的部署记录，避免先取全量计划再在浏览器端过滤。 */
export function listDeploymentPlansByApplicationAsset(applicationAssetId: string) {
  const id = applicationAssetId.trim()
  if (!id) throw new Error(i18n.global.t('assets.deployment.errors.missingApplicationAssetId'))
  const params = new URLSearchParams({ applicationAssetId: id })
  return apiClient.get<ApiPage>(`${toClientPath(`${DEPLOYMENT_PLANS_PATH}/by-application-asset`)}?${params.toString()}`)
}

export function listDeploymentInputSnapshots(planId: string) {
  const params = new URLSearchParams({ planId: requireId(planId, i18n.global.t('deploymentPlans.actions.detail')) })
  return apiClient.get<ApiPage>(`${toClientPath(`${DEPLOYMENT_PLANS_PATH}/input-snapshots`)}?${params.toString()}`)
}

export function createDeploymentPlan(payload: ApiBody) {
  return postAction(DEPLOYMENT_PLANS_PATH, payload, 'deployment_create')
}

export function createDeploymentPlanFromApplicationAsset(payload: ApiBody) {
  return postAction(`${DEPLOYMENT_PLANS_PATH}/from-application-asset`, payload, 'deployment_from_application_asset')
}

export function updateDeploymentPlanFromApplicationAsset(payload: ApiBody) {
  return postAction(`${DEPLOYMENT_PLANS_PATH}/update-from-application-asset`, payload, 'deployment_update_from_application_asset')
}

export function dryRunDeploymentPlan(payload: ApiBody) {
  const planId = requireId(String(payload.planId ?? ''), 'dry-run')
  return postAction(`${DEPLOYMENT_PLANS_PATH}/dry-run`, { ...payload, planId }, 'deployment_dry_run')
}

export function submitDeploymentPlan(planId: string, payload: ApiBody = {}) {
  return postAction(`${DEPLOYMENT_PLANS_PATH}/submit`, { ...payload, planId: requireId(planId, i18n.global.t('deploymentPlans.apiActions.submit')) }, 'deployment_submit')
}

export function executeDeploymentPlan(planId: string, payload: ApiBody = {}) {
  return postAction(`${DEPLOYMENT_PLANS_PATH}/execute`, { ...payload, planId: requireId(planId, i18n.global.t('deploymentPlans.apiActions.execute')) }, 'deployment_execute')
}

export function cancelDeploymentPlan(planId: string, payload: ApiBody = {}) {
  return postAction(`${DEPLOYMENT_PLANS_PATH}/cancel`, { ...payload, planId: requireId(planId, i18n.global.t('deploymentPlans.apiActions.cancel')) }, 'deployment_cancel')
}

export function deleteDraftDeploymentPlan(planId: string, payload: ApiBody = {}) {
  return postAction(`${DEPLOYMENT_PLANS_PATH}/delete`, { ...payload, planId: requireId(planId, i18n.global.t('deploymentPlans.apiActions.delete')) }, 'deployment_delete')
}
