import { listRecords, postAction, type ApiBody, type BusinessListQuery } from './common'

const GATEWAYS_PATH = '/api/v1/gateways'

export interface GatewayRoutePayload extends ApiBody {
  readonly zoneId: string
  readonly targetId: string
  readonly protocols: readonly string[]
  readonly requiredCapabilities?: readonly string[]
  readonly destructive?: boolean
}

export interface GatewayProbePayload extends ApiBody {
  readonly gatewayId?: string
  readonly targetId: string
  readonly protocol: string
  readonly port: number
}

export interface GatewayStatusPayload extends ApiBody {
  readonly gatewayId: string
  readonly action?: 'disable' | 'revoke' | 'status' | 'heartbeat' | 'register'
  readonly status?: 'online' | 'offline' | 'disabled' | 'revoked' | 'upgrading'
  readonly agentId?: string
  readonly zoneIds?: readonly string[]
  readonly adapters?: readonly string[]
  readonly capabilities?: readonly string[]
  readonly currentLoad?: number
  readonly maxConcurrentTasks?: number
  readonly successRate?: number
}

export function listGateways(query?: BusinessListQuery) {
  return listRecords(GATEWAYS_PATH, query)
}

export function routeGateway(payload: GatewayRoutePayload) {
  return postAction(`${GATEWAYS_PATH}/route`, payload, 'gateway_route')
}

export function probeGateway(payload: GatewayProbePayload) {
  return postAction(`${GATEWAYS_PATH}/probe`, payload, 'gateway_probe')
}

export function updateGatewayStatus(payload: GatewayStatusPayload) {
  return postAction(`${GATEWAYS_PATH}/status`, payload, 'gateway_status')
}
