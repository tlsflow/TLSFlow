export type ZoneType = 'production' | 'dmz' | 'office' | 'device' | 'legacy' | 'custom';
export type GatewayStatus = 'online' | 'offline' | 'disabled' | 'revoked' | 'upgrading';
export type GatewayRouteChannel = 'probe.tcp' | 'probe.http' | 'probe.agent' | 'forward.agent_task' | 'forward.direct_control';
export type GatewayAdapterType = GatewayRouteChannel | string;
export type GatewayTaskType = 'gateway.probe' | 'gateway.forward.agent_task' | 'gateway.forward.direct_control';
export type ReachabilityStatus = 'reachable' | 'unreachable' | 'unknown' | 'expired';
export type ForwardingGrantStatus = 'active' | 'used' | 'expired' | 'revoked';
export type GatewayTaskStatus = 'queued' | 'acknowledged' | 'running' | 'success' | 'failed' | 'cancelled' | 'timeout';
export type FallbackSuggestion = 'gateway_required' | 'script_package' | 'manual';

export interface ZoneMaintenanceWindow {
  /** 维护窗口开始时间，格式 HH:mm。 */
  start: string;
  /** 维护窗口结束时间，格式 HH:mm，允许跨天。 */
  end: string;
  /** 可选时区，默认使用 UTC。 */
  timeZone?: string;
  /** 可选星期限制，0 表示周日，1 表示周一。 */
  daysOfWeek?: number[];
}

export interface ZonePolicy {
  priority?: number;
  requireApproval?: boolean;
  allowDirectControlPlaneAccess?: boolean;
  /** 兼容旧字段名。这里表达的是 Gateway 允许的路由/探测通道，不是协议 Adapter。 */
  allowedAdapters?: GatewayAdapterType[];
  allowedActions?: string[];
  maxConcurrentTasks?: number;
  maintenanceWindow?: ZoneMaintenanceWindow;
}


export interface Zone {
  id: string;
  name: string;
  type: ZoneType;
  policy: ZonePolicy;
  enabled: boolean;
}

export interface GatewayAgentProfile {
  id: string;
  agentId: string;
  zoneIds: string[];
  version: string;
  status: GatewayStatus;
  /** 兼容旧字段名。这里表达的是 Gateway 支持的路由/探测通道，不是协议 Adapter。 */
  adapters: GatewayAdapterType[];
  capabilities: string[];
  capabilitySetId: string;
  currentLoad: number;
  maxConcurrentTasks: number;
  successRate: number;
  lastHeartbeatAt?: string;
}

export interface ReachabilityRecord {
  id: string;
  gatewayId: string;
  targetId: string;
  protocol: GatewayAdapterType;
  port?: number;
  status: ReachabilityStatus;
  latencyMs?: number;
  checkedAt: string;
  expiresAt: string;
}

export interface GatewayTaskTarget {
  id: string;
  zoneId: string;
  host?: string;
  port?: number;
}

export interface ForwardingGrant {
  id: string;
  gatewayId: string;
  delegatedTargetId: string;
  delegatedAgentId?: string;
  taskType: GatewayTaskType;
  routeChannel: GatewayAdapterType;
  executionRunId: string;
  stepId: string;
  maxUses: number;
  remainingUses: number;
  expiresAt: string;
  status: ForwardingGrantStatus;
  issuedAt: string;
  usedAt?: string;
  revokedAt?: string;
}

export interface GatewayTask {
  id: string;
  idempotencyKey: string;
  tenantId?: string;
  operatorId?: string;
  planId?: string;
  executionRunId: string;
  stepId: string;
  gatewayId: string;
  delegatedTargetId: string;
  target: GatewayTaskTarget;
  /** 兼容旧字段名。实际值只能是 probe.* 或 forward.* 路由通道。 */
  adapter: GatewayAdapterType;
  /** Gateway 任务类型：gateway.probe / gateway.forward.agent_task / gateway.forward.direct_control。 */
  action: GatewayTaskType | string;
  payload: Record<string, unknown>;
  forwardingGrant?: ForwardingGrant;
  status: GatewayTaskStatus;
  leaseId?: string;
  result?: GatewayTaskResult;
  evidenceIds: string[];
  createdAt: string;
  updatedAt: string;
  acknowledgedAt?: string;
  /** 已和 Agent task logs ack cursor 对齐的 evidence/log 最大连续序号。 */
  evidenceAckCursor?: number;
}


export interface GatewayTaskResult {
  success: boolean;
  status: Extract<GatewayTaskStatus, 'success' | 'failed' | 'cancelled' | 'timeout'>;
  summary: string;
  exitCode?: number;
  errorCode?: string;
  errorMessage?: string;
  evidenceIds: string[];
  evidenceRef?: string;
  finishedAt: string;
}

export interface GatewayEvidence {
  id: string;
  taskId: string;
  operatorId?: string;
  planId?: string;
  executionRunId: string;
  stepId: string;
  gatewayId: string;
  delegatedTargetId: string;
  adapter: GatewayAdapterType;
  forwardingGrantId?: string;
  delegatedAgentId?: string;
  action: GatewayTaskType | string;
  result: GatewayTaskResult['status'];
  evidenceRef: string;
  /** 对齐 Agent task logs 的幂等序号；同一 GatewayTask 内唯一。 */
  sequence?: number;
  kind: 'log' | 'command_summary' | 'response_summary' | 'file_hash' | 'certificate_fingerprint' | 'backup_ref';
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ZoneRouteRequest {
  zoneId: string;
  targetId: string;
  protocols: GatewayAdapterType[];
  requiredCapabilities?: string[];
  /** 本次路由动作，用于 ZonePolicy.allowedActions 和审批策略判定。 */
  action?: string;
  /** 是否属于破坏性任务。 */
  destructive?: boolean;
  /** 已持有同目标执行锁的目标 ID。同一目标禁止并发执行。 */
  lockedTargetIds?: string[];
  now?: Date;
}

export interface GatewayCandidate {
  gateway: GatewayAgentProfile;
  reachability: ReachabilityRecord;
  score: number;
  reasons: string[];
}

export interface ZoneRouteResult {
  status: 'selected' | 'blocked' | 'approvalRequired';
  selectedGateway?: GatewayAgentProfile;
  candidateGateways: GatewayCandidate[];
  missingCapabilities: string[];
  fallbackSuggestions: FallbackSuggestion[];
  blockedReason?:
    | 'zone_disabled'
    | 'no_gateway'
    | 'unreachable'
    | 'capability_missing'
    | 'reachability_expired'
    | 'maintenance_window_closed'
    | 'zone_concurrency_limit'
    | 'action_not_allowed'
    | 'target_locked';
  approvalReason?: 'zone_requires_approval';
}

export interface GatewayDelegatedTaskInput {
  id?: string;
  idempotencyKey: string;
  tenantId?: string;
  operatorId?: string;
  planId?: string;
  executionRunId: string;
  stepId: string;
  gatewayId: string;
  delegatedTargetId: string;
  target: GatewayTaskTarget;
  adapter: GatewayAdapterType;
  action: GatewayTaskType | string;
  payload?: Record<string, unknown>;
  forwardingGrant?: ForwardingGrant;
  now?: Date;
}
