import { apiClient, createIdempotencyKey } from '@/api/client'
import { listRecords, postAction, toClientPath, type ApiBody, type BusinessListQuery, type ApiRecord, type ApiRecordResult } from './common'

const HOSTS_PATH = '/api/v1/hosts'
const SERVICE_ASSETS_PATH = '/api/v1/service-assets'
const APPLICATIONS_PATH = '/api/v1/applications'
const FRAMEWORK_INSTANCES_PATH = '/api/v1/framework-instances'
const SITE_ASSETS_PATH = '/api/v1/site-assets'
const MANAGED_TARGETS_PATH = '/api/v1/managed-targets'
const MANAGED_TARGET_SNAPSHOTS_PATH = '/api/v1/managed-target-snapshots'
const DISCOVERY_RUNS_PATH = '/api/v1/discovery-runs'
const CAPABILITIES_PATH = '/api/v1/capabilities/definitions'
const CAPABILITY_DECLARATIONS_PATH = '/api/v1/capabilities/declarations'
const CAPABILITY_REQUIREMENTS_PATH = '/api/v1/capabilities/requirements'
const AGENTS_PATH = '/api/v1/agents'
const APPLICATION_CERTIFICATE_SUPPLY_POLICY_PATH = '/api/v1/application-assets'

export interface UnifiedAssetRef {
  readonly rootType: 'DEVICE' | 'SERVICE_ASSET'
  readonly id: string
}

export function listAssets(query?: BusinessListQuery) {
  return listRecords('/api/v1/assets', query)
}

/** 读取统一资产详情；具体根资产由服务端根据 assetRef 解析。 */
export function getAssetDetail(assetRef: UnifiedAssetRef): Promise<ApiRecordResult> {
  const params = new URLSearchParams({ rootType: assetRef.rootType, id: assetRef.id })
  return apiClient.get<ApiRecord>(`${toClientPath('/api/v1/assets/detail')}?${params.toString()}`)
}

/** 执行统一资产生命周期动作；权限与根资产派发由服务端完成。 */
export function executeAssetAction(assetRef: UnifiedAssetRef, action: 'DELETE'): Promise<ApiRecordResult> {
  return postAction('/api/v1/assets/actions', { assetRef, action }, `asset_${action.toLowerCase()}`)
}

/** 查询统一资产列表中的云服务资产。 */
export function listCloudServiceAssets(query: BusinessListQuery = {}) {
  return listRecords('/api/v1/assets', {
    ...query,
    filters: { ...(query.filters ?? {}), assetKind: 'CLOUD_SERVICE' },
  })
}

/** 读取任意 ServiceAsset 的统一详情，包含证书与受管目标关联上下文。 */
export function getServiceAssetDetail(serviceAssetId: string): Promise<ApiRecordResult> {
  return apiClient.get<ApiRecord>(`${toClientPath(`${SERVICE_ASSETS_PATH}/detail`)}?serviceAssetId=${encodeURIComponent(serviceAssetId)}`)
}

export function listApplications(query?: BusinessListQuery) {
  return listRecords(APPLICATIONS_PATH, query)
}

export function getApplicationDetail(applicationId: string): Promise<ApiRecordResult> {
  return apiClient.get<ApiRecord>(`${toClientPath(`${APPLICATIONS_PATH}/detail`)}?applicationId=${encodeURIComponent(applicationId)}`)
}

/** 部署弹窗专用轻量详情；不读取快照、证书投影或执行兼容性。 */
export function getApplicationDeploymentDetail(applicationAssetId: string): Promise<ApiRecordResult> {
  return apiClient.get<ApiRecord>(`${toClientPath(`${APPLICATIONS_PATH}/deployment-detail`)}?applicationId=${encodeURIComponent(applicationAssetId)}`)
}

/** 编辑首屏专用轻量详情，不包含证书投影、联动诊断和执行兼容性。 */
export function getApplicationEditDetail(applicationId: string): Promise<ApiRecordResult> {
  return apiClient.get<ApiRecord>(`${toClientPath(`${APPLICATIONS_PATH}/edit-detail`)}?applicationId=${encodeURIComponent(applicationId)}`)
}

export function getApplicationAssetLinkageStatus(applicationAssetId: string): Promise<ApiRecordResult> {
  return apiClient.get<ApiRecord>(toClientPath(`${APPLICATIONS_PATH}/${encodeURIComponent(applicationAssetId)}/linkage-status`))
}

/** 查询应用级证书供应策略。响应仅包含候选证书和脱敏的 SecretRef。 */
export function getApplicationCertificateSupplyPolicy(applicationAssetId: string): Promise<ApiRecordResult> {
  return apiClient.get<ApiRecord>(toClientPath(`${APPLICATION_CERTIFICATE_SUPPLY_POLICY_PATH}/${encodeURIComponent(applicationAssetId)}/certificate-supply-policy`))
}

/** 保存应用级证书供应策略；后端会追加不可变策略版本。 */
export function saveApplicationCertificateSupplyPolicy(applicationAssetId: string, payload: ApiBody): Promise<ApiRecordResult> {
  return apiClient.request<ApiRecord>(toClientPath(`${APPLICATION_CERTIFICATE_SUPPLY_POLICY_PATH}/${encodeURIComponent(applicationAssetId)}/certificate-supply-policy`), {
    method: 'PUT',
    body: payload,
    idempotencyKey: createIdempotencyKey('application_certificate_supply_policy_save'),
  })
}

/** 只读预览应用级证书供应策略，不创建申请、密钥或部署计划。 */
export function previewApplicationCertificateSupplyPolicy(applicationAssetId: string, payload: ApiBody): Promise<ApiRecordResult> {
  return apiClient.post<ApiRecord>(toClientPath(`${APPLICATION_CERTIFICATE_SUPPLY_POLICY_PATH}/${encodeURIComponent(applicationAssetId)}/certificate-supply-policy/preview`), payload)
}

/** 创建专属证书部署父任务；签发与标准部署由后端统一编排。 */
export function enqueueApplicationCertificateDeployment(applicationAssetId: string, reapply = false): Promise<ApiRecordResult> {
  return apiClient.post<ApiRecord>(toClientPath(`${APPLICATION_CERTIFICATE_SUPPLY_POLICY_PATH}/${encodeURIComponent(applicationAssetId)}/certificate-supply-policy/deploy`), { reapply }, {
    idempotencyKey: createIdempotencyKey('application_certificate_deployment'),
  })
}

export function repairApplicationAssetLinkage(applicationAssetId: string): Promise<ApiRecordResult> {
  return apiClient.post<ApiRecord>(toClientPath(`${APPLICATIONS_PATH}/${encodeURIComponent(applicationAssetId)}/linkage-repair`), {}, {
    idempotencyKey: createIdempotencyKey('application_asset_linkage_repair'),
  })
}

export function createServiceAsset(payload: ApiBody) {
  return postAction(APPLICATIONS_PATH, payload, 'application_create')
}

export function updateServiceAsset(serviceAssetId: string, payload: ApiBody) {
  return patchAction(SERVICE_ASSETS_PATH, { ...payload, id: serviceAssetId }, 'service_asset_update')
}

export function deleteServiceAsset(serviceAssetId: string) {
  return postAction(`${SERVICE_ASSETS_PATH}/delete`, { id: serviceAssetId }, 'service_asset_delete')
}

export function createHost(payload: ApiBody) {
  return postAction(HOSTS_PATH, payload, 'host_create')
}

export function updateHost(hostId: string, payload: ApiBody) {
  return patchAction(HOSTS_PATH, { ...payload, id: hostId }, 'host_update')
}

export function deleteHost(hostId: string, payload: ApiBody = {}) {
  return postAction(`${HOSTS_PATH}/delete`, { ...payload, id: hostId }, 'host_delete')
}

export function listFrameworkInstances(query?: BusinessListQuery) {
  return listRecords(FRAMEWORK_INSTANCES_PATH, query)
}

export function listSiteAssets(query?: BusinessListQuery) {
  return listRecords(SITE_ASSETS_PATH, query)
}

export function listManagedTargets(query?: BusinessListQuery) {
  return listRecords(MANAGED_TARGETS_PATH, query)
}

export function getManagedTargetEffectiveCapability(managedTargetId: string, capabilityKey: string, applicationAssetId?: string): Promise<ApiRecordResult> {
  const query = applicationAssetId ? `?applicationAssetId=${encodeURIComponent(applicationAssetId)}` : ''
  return apiClient.get<ApiRecord>(toClientPath(`${MANAGED_TARGETS_PATH}/${encodeURIComponent(managedTargetId)}/deployment-capabilities/${encodeURIComponent(capabilityKey)}${query}`))
}

export function listManagedTargetCompatiblePlugins(managedTargetId: string, capabilityKey: string, applicationAssetId?: string, locale?: string): Promise<ApiRecordResult> {
  const search = new URLSearchParams({ capabilityKey })
  if (applicationAssetId) search.set('applicationAssetId', applicationAssetId)
  if (locale) search.set('locale', locale)
  return apiClient.get<ApiRecord>(toClientPath(`${MANAGED_TARGETS_PATH}/${encodeURIComponent(managedTargetId)}/compatible-plugins?${search.toString()}`))
}

export function saveApplicationAssetManagedTarget(applicationAssetId: string, payload: ApiBody): Promise<ApiRecordResult> {
  return apiClient.request<ApiRecord>(toClientPath(`/api/v1/application-assets/${encodeURIComponent(applicationAssetId)}/managed-target`), {
    method: 'PUT',
    body: payload,
    idempotencyKey: createIdempotencyKey('application_asset_managed_target_save'),
  })
}

export function saveApplicationManagedTarget(applicationId: string, payload: ApiBody): Promise<ApiRecordResult> {
  return apiClient.request<ApiRecord>(toClientPath(`/api/v1/application-targets`), {
    method: 'POST',
    body: { ...payload, applicationId },
    idempotencyKey: createIdempotencyKey('application_target_save'),
  })
}

export function saveApplicationAssetStandaloneWorkflow(applicationAssetId: string, payload: ApiBody): Promise<ApiRecordResult> {
  return apiClient.request<ApiRecord>(toClientPath(`/api/v1/application-assets/${encodeURIComponent(applicationAssetId)}/standalone-workflow`), {
    method: 'PUT',
    body: payload,
    idempotencyKey: createIdempotencyKey('application_asset_standalone_workflow_save'),
  })
}

export function createManagedTarget(payload: ApiBody) {
  return postAction(MANAGED_TARGETS_PATH, payload, 'managed_target_create')
}

export function listManagedTargetSnapshots(query?: BusinessListQuery) {
  return listRecords(MANAGED_TARGET_SNAPSHOTS_PATH, query)
}

export function createFrameworkInstance(payload: ApiBody) {
  return postAction(FRAMEWORK_INSTANCES_PATH, payload, 'service_instance_create')
}

export function createSiteAsset(payload: ApiBody) {
  return postAction(SITE_ASSETS_PATH, payload, 'site_asset_create')
}

export function updateFrameworkInstance(serviceInstanceId: string, payload: ApiBody) {
  return patchAction(FRAMEWORK_INSTANCES_PATH, { ...payload, id: serviceInstanceId }, 'service_instance_update')
}

export function deleteFrameworkInstance(serviceInstanceId: string, payload: ApiBody = {}) {
  return postAction(`${FRAMEWORK_INSTANCES_PATH}/delete`, { ...payload, id: serviceInstanceId }, 'service_instance_delete')
}

export function listCapabilities(query?: BusinessListQuery) {
  return listRecords(CAPABILITIES_PATH, query)
}

export function listCapabilityDeclarations(query?: BusinessListQuery) {
  return listRecords(CAPABILITY_DECLARATIONS_PATH, query)
}

export function createManualCapabilityDeclaration(payload: ApiBody) {
  return postAction(`${CAPABILITY_DECLARATIONS_PATH}/manual`, payload, 'capability_manual_declaration')
}

export function listCapabilityRequirements(query?: BusinessListQuery) {
  return listRecords(CAPABILITY_REQUIREMENTS_PATH, query)
}

export function createCapabilityRequirement(payload: ApiBody) {
  return postAction(CAPABILITY_REQUIREMENTS_PATH, payload, 'capability_requirement_create')
}

export function matchCapabilityRequirement(payload: ApiBody) {
  return postAction('/api/v1/capabilities/match', payload, 'capability_match')
}

export function evaluateCapabilityCompatibility(payload: ApiBody) {
  return postAction('/api/v1/capabilities/compatibility/evaluate', payload, 'capability_compatibility_evaluate')
}

export function listAgents(query?: BusinessListQuery) {
  return listRecords(AGENTS_PATH, query)
}

export function listAgentTaskQueue(agentId: string, query: BusinessListQuery = {}) {
  return listRecords(`${AGENTS_PATH}/${encodeURIComponent(agentId)}/tasks`, { page: 1, pageSize: 10, ...query })
}

export function listAgentCapabilities(agentId: string, query: BusinessListQuery = {}) {
  return listRecords(`${AGENTS_PATH}/${encodeURIComponent(agentId)}/capabilities`, { page: 1, pageSize: 20, ...query })
}

export function checkAgentUpgrade(agentId: string) {
  return apiClient.post<ApiRecord>(toClientPath(`${AGENTS_PATH}/upgrades/check`), { agentId }, {
    idempotencyKey: createIdempotencyKey('agent_upgrade_check')
  })
}

export function dispatchAgentUpgrade(agentId: string, planId: string) {
  return postAction(`${AGENTS_PATH}/${encodeURIComponent(agentId)}/upgrades`, { planId }, 'agent_upgrade_dispatch')
}

export function createAgentEnrollmentToken(payload: ApiBody) {
  return postAction(`${AGENTS_PATH}/enrollment-tokens`, payload, 'agent_enrollment_token')
}

export function createAgentInstallMaterials(payload: ApiBody) {
  return postAction(`${AGENTS_PATH}/install-materials`, payload, 'agent_install_materials')
}

/** 创建 Windows Go Full Agent 安装会话，返回可直接复制到目标主机执行的 PowerShell 命令。 */
export function createWindowsGoInstallSession(payload: ApiBody = {}): Promise<ApiRecordResult> {
  return apiClient.post<ApiRecord>(toClientPath(`${AGENTS_PATH}/install-sessions/windows-go`), payload, {
    idempotencyKey: createIdempotencyKey('windows_go_install_session'),
  })
}

/** 创建独立 Windows AD CS Agent 安装会话。 */
export function createWindowsAdcsInstallSession(payload: ApiBody = {}): Promise<ApiRecordResult> {
  return apiClient.post<ApiRecord>(toClientPath(`${AGENTS_PATH}/install-sessions/windows-adcs`), payload, {
    idempotencyKey: createIdempotencyKey('windows_adcs_install_session'),
  })
}

export function startDiscovery(payload: ApiBody) {
  return postAction(DISCOVERY_RUNS_PATH, payload, 'asset_discovery')
}

export function listDiscoverySnapshots(query?: BusinessListQuery) {
  return listRecords('/api/v1/discovery-snapshots', query)
}

export function previewDiscoveryMerge(payload: ApiBody) {
  return postAction('/api/v1/discovery-snapshots/merge-preview', payload, 'discovery_merge_preview')
}

export function deleteAgent(agentId: string, payload: ApiBody = {}) {
  return postAction(`${AGENTS_PATH}/delete`, { ...payload, agentId }, 'agent_delete')
}

function patchAction(path: string, body: ApiBody = {}, idempotencyPrefix = 'action'): Promise<ApiRecordResult> {
  return apiClient.request<ApiRecord>(toClientPath(path), {
    method: 'PATCH',
    body,
    idempotencyKey: createIdempotencyKey(idempotencyPrefix)
  })
}
