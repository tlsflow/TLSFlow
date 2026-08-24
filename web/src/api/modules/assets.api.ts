import { listRecords, postAction, type ApiBody, type BusinessListQuery } from './common'

const HOSTS_PATH = '/api/v1/hosts'
const SERVICE_INSTANCES_PATH = '/api/v1/service-instances'
const DISCOVERY_RUNS_PATH = '/api/v1/discovery-runs'
const CAPABILITIES_PATH = '/api/v1/capabilities/definitions'
const AGENTS_PATH = '/api/v1/agents'

export function listAssets(query?: BusinessListQuery) {
  return listRecords(HOSTS_PATH, query)
}

export function listServiceInstances(query?: BusinessListQuery) {
  return listRecords(SERVICE_INSTANCES_PATH, query)
}

export function listCapabilities(query?: BusinessListQuery) {
  return listRecords(CAPABILITIES_PATH, query)
}

export function listAgents(query?: BusinessListQuery) {
  return listRecords(AGENTS_PATH, query)
}

export function startDiscovery(payload: ApiBody) {
  return postAction(DISCOVERY_RUNS_PATH, payload, 'asset_discovery')
}

export function disableAgent(agentId: string, payload: ApiBody = {}) {
  return postAction(`${AGENTS_PATH}/${encodeURIComponent(agentId)}:disable`, payload, 'agent_disable')
}
