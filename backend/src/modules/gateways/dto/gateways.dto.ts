import type { GatewayAdapterType, GatewayRelayRouteChannel, GatewayStatus, ReachabilityStatus, ZonePolicy, ZoneType } from '../../gateway-agents/index.js';

export interface GatewayZoneDto {
  id: string;
  tenantId: string;
  name: string;
  type: ZoneType;
  policy: ZonePolicy;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayDto {
  id: string;
  tenantId: string;
  agentId: string;
  zoneIds: string[];
  version: string;
  status: GatewayStatus;
  adapters: GatewayAdapterType[];
  capabilities: string[];
  capabilitySetId: string;
  currentLoad: number;
  maxConcurrentTasks: number;
  successRate: number;
  lastHeartbeatAt?: string;
  revokedAt?: string;
  disabledAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayReachabilityDto {
  id: string;
  tenantId: string;
  gatewayId: string;
  targetId: string;
  protocol: GatewayAdapterType;
  port?: number;
  status: ReachabilityStatus;
  latencyMs?: number;
  checkedAt: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterGatewayInput {
  id?: string;
  agentId: string;
  zoneIds: string[];
  version: string;
  adapters: GatewayAdapterType[];
  capabilities?: string[];
  capabilitySetId?: string;
  currentLoad?: number;
  maxConcurrentTasks?: number;
  successRate?: number;
}

export interface UpdateGatewayStatusInput {
  action?: 'register' | 'heartbeat' | 'disable' | 'revoke' | 'status';
  gatewayId?: string;
  agentId?: string;
  status?: GatewayStatus;
  version?: string;
  zoneIds?: string[];
  adapters?: GatewayAdapterType[];
  capabilities?: string[];
  currentLoad?: number;
  maxConcurrentTasks?: number;
  successRate?: number;
}

export interface RouteGatewayInput {
  zoneId: string;
  targetId: string;
  /** 请求方提供的端点必须与控制面登记值完全一致。 */
  targetHost?: string;
  targetPort?: number;
  protocols: GatewayAdapterType[];
  requiredCapabilities?: string[];
  destructive?: boolean;
  action?: string;
  /** 由控制器从当前安全主体注入，不能信任请求体。 */
  callerId?: string;
}


export interface ProbeGatewayInput {
  gatewayId: string;
  targetId: string;
  /** 探测记录只能描述 Relay TCP 可达性，不再触发 Gateway 业务探测。 */
  protocol: GatewayRelayRouteChannel | GatewayAdapterType;
  port?: number;
  status?: ReachabilityStatus;
  latencyMs?: number;
  ttlSeconds?: number;
  zoneId?: string;
}
