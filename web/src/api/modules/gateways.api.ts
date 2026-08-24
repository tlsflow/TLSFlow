import { listRecords, postAction, type ApiBody, type BusinessListQuery } from './common'

const GATEWAYS_PATH = '/api/v1/gateways'

export function listGateways(query?: BusinessListQuery) {
  return listRecords(GATEWAYS_PATH, query)
}

export function probeGateway(gatewayId: string, payload: ApiBody = {}) {
  return postAction(`${GATEWAYS_PATH}/${encodeURIComponent(gatewayId)}:probe`, payload, 'gateway_probe')
}
