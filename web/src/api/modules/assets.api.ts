import { apiClient, createIdempotencyKey } from '@/api/client'
import { listRecords, postAction, toClientPath, type ApiBody, type BusinessListQuery, type ApiRecord, type ApiRecordResult } from './common'

const HOSTS_PATH = '/api/v1/hosts'
const SERVICE_ASSETS_PATH = '/api/v1/service-assets'
const FRAMEWORK_INSTANCES_PATH = '/api/v1/framework-instances'
const SITE_ASSETS_PATH = '/api/v1/site-assets'
const MANAGED_TARGETS_PATH = '/api/v1/managed-targets'
const MANAGED_TARGET_SNAPSHOTS_PATH = '/api/v1/managed-target-snapshots'
const DISCOVERY_RUNS_PATH = '/api/v1/discovery-runs'
const CAPABILITIES_PATH = '/api/v1/capabilities/definitions'
const CAPABILITY_DECLARATIONS_PATH = '/api/v1/capabilities/declarations'
const CAPABILITY_REQUIREMENTS_PATH = '/api/v1/capabilities/requirements'
const AGENTS_PATH = '/api/v1/agents'

export function listAssets(query?: BusinessListQuery) {
  return listRecords(SERVICE_ASSETS_PATH, query)
}

export function createServiceAsset(payload: ApiBody) {
  return postAction(SERVICE_ASSETS_PATH, payload, 'service_asset_create')
}

export function updateServiceAsset(serviceAssetId: string, payload: ApiBody) {
  return patchAction(SERVICE_ASSETS_PATH, { ...payload, id: serviceAssetId }, 'service_asset_update')
}

export function deleteServiceAsset(serviceAssetId: string) {
  return postAction(`${SERVICE_ASSETS_PATH}/delete`, { id: serviceAssetId }, 'service_asset_delete')
}

export function getAssetDetail(serviceAssetId: string): Promise<ApiRecordResult> {
  return apiClient.get<ApiRecord>(`${toClientPath(SERVICE_ASSETS_PATH)}/detail?serviceAssetId=${encodeURIComponent(serviceAssetId)}`)
}

export function projectWorkflowBinding(payload: ApiBody): Promise<ApiRecordResult> {
  return apiClient.post<ApiRecord>(toClientPath(`${SERVICE_ASSETS_PATH}/workflow-binding-projection`), payload)
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

export function getAgentDetail(agentId: string): Promise<ApiRecordResult> {
  return apiClient.get<ApiRecord>(`${toClientPath(AGENTS_PATH)}/detail?agentId=${encodeURIComponent(agentId)}`)
}

export function requestAgentCapabilityRescan(agentId: string): Promise<ApiRecordResult> {
  return apiClient.post<ApiRecord>(toClientPath(`${AGENTS_PATH}/${encodeURIComponent(agentId)}/rescan`), {}, {
    idempotencyKey: createIdempotencyKey('agent_capability_rescan'),
  })
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

export function createAgentEnrollmentToken(payload: ApiBody) {
  return postAction(`${AGENTS_PATH}/enrollment-tokens`, payload, 'agent_enrollment_token')
}

export function createLinuxGoInstallSession(payload: ApiBody) {
  return postAction(
    `${AGENTS_PATH}/install-sessions/linux-go`,
    payload,
    'agent_linux_go_install_session',
    { publicBaseUrl: typeof window !== 'undefined' ? window.location.origin : undefined }
  )
}

export function createWindowsPowerShellInstallSession(payload: ApiBody) {
  return postAction(
    `${AGENTS_PATH}/install-sessions/windows-powershell`,
    payload,
    'agent_windows_ps_install',
    { publicBaseUrl: typeof window !== 'undefined' ? window.location.origin : undefined }
  )
}

export function createWindowsCompatibilityInstallSession(payload: ApiBody) {
  return postAction(
    `${AGENTS_PATH}/install-sessions/windows-compatibility`,
    payload,
    'agent_windows_compatibility_install',
    { publicBaseUrl: typeof window !== 'undefined' ? window.location.origin : undefined }
  )
}

export function createGatewayEnableSession(payload: ApiBody) {
  return postAction(
    `${AGENTS_PATH}/gateway-enable-sessions`,
    payload,
    'agent_gateway_enable_session',
    { publicBaseUrl: typeof window !== 'undefined' ? window.location.origin : undefined }
  )
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

export function disableAgent(agentId: string, payload: ApiBody = {}) {
  return postAction(`${AGENTS_PATH}/disable`, { ...payload, agentId }, 'agent_disable')
}

export function enableAgent(agentId: string, payload: ApiBody = {}) {
  return postAction(`${AGENTS_PATH}/enable`, { ...payload, agentId }, 'agent_enable')
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
