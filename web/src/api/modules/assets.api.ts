import { apiClient, createIdempotencyKey } from '@/api/client'
import { listRecords, postAction, toClientPath, type ApiBody, type BusinessListQuery, type ApiRecord, type ApiRecordResult } from './common'

const HOSTS_PATH = '/api/v1/hosts'
const SERVICE_INSTANCES_PATH = '/api/v1/service-instances'
const DISCOVERY_RUNS_PATH = '/api/v1/discovery-runs'
const CAPABILITIES_PATH = '/api/v1/capabilities/definitions'
const AGENTS_PATH = '/api/v1/agents'

export function listAssets(query?: BusinessListQuery) {
  return listRecords(HOSTS_PATH, query)
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

export function listServiceInstances(query?: BusinessListQuery) {
  return listRecords(SERVICE_INSTANCES_PATH, query)
}

export function createServiceInstance(payload: ApiBody) {
  return postAction(SERVICE_INSTANCES_PATH, payload, 'service_instance_create')
}

export function updateServiceInstance(serviceInstanceId: string, payload: ApiBody) {
  return patchAction(SERVICE_INSTANCES_PATH, { ...payload, id: serviceInstanceId }, 'service_instance_update')
}

export function deleteServiceInstance(serviceInstanceId: string, payload: ApiBody = {}) {
  return postAction(`${SERVICE_INSTANCES_PATH}/delete`, { ...payload, id: serviceInstanceId }, 'service_instance_delete')
}

export function listCapabilities(query?: BusinessListQuery) {
  return listRecords(CAPABILITIES_PATH, query)
}

export function listAgents(query?: BusinessListQuery) {
  return listRecords(AGENTS_PATH, query)
}

export function getAgentDetail(agentId: string): Promise<ApiRecordResult> {
  return apiClient.get<ApiRecord>(`${toClientPath(AGENTS_PATH)}/${encodeURIComponent(agentId)}`)
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

function patchAction(path: string, body: ApiBody = {}, idempotencyPrefix = 'action'): Promise<ApiRecordResult> {
  return apiClient.request<ApiRecord>(toClientPath(path), {
    method: 'PATCH',
    body,
    idempotencyKey: createIdempotencyKey(idempotencyPrefix)
  })
}
