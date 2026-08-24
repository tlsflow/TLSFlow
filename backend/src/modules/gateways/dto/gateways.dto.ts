import type { GatewayAdapterType, GatewayStatus, ReachabilityStatus, ZonePolicy, ZoneType } from '../../gateway-agents/index.js';

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

export interface GatewayCredentialSessionDto {
  id: string;
  tenantId: string;
  taskId: string;
  secretRef: { ref: string };
  grantRef: { ref: string };
  gatewayId: string;
  targetId: string;
  protocol: GatewayAdapterType;
  allowedActions: string[];
  remainingUses: number;
  expiresAt: string;
  status: 'active' | 'revoked' | 'expired' | 'used';
  createdAt: string;
  revokedAt?: string;
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
  protocols: GatewayAdapterType[];
  requiredCapabilities?: string[];
  destructive?: boolean;
  action?: string;
}


export interface ProbeGatewayInput {
  gatewayId: string;
  targetId: string;
  protocol: GatewayAdapterType;
  port?: number;
  status?: ReachabilityStatus;
  latencyMs?: number;
  ttlSeconds?: number;
  zoneId?: string;
}
