export type ZoneType = 'production' | 'dmz' | 'office' | 'device' | 'legacy' | 'custom';
export type GatewayStatus = 'online' | 'offline' | 'disabled' | 'revoked' | 'upgrading';
export type GatewayAdapterType = 'ssh' | 'winrm' | 'curl' | 'smb' | 'wmi' | string;
export type ReachabilityStatus = 'reachable' | 'unreachable' | 'unknown' | 'expired';
export type CredentialSessionStatus = 'active' | 'revoked' | 'expired' | 'used';
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

export interface SecretRef {
  ref: string;
}

export interface GrantRef {
  ref: string;
}

export interface CredentialSession {
  id: string;
  taskId: string;
  operatorId?: string;
  executionRunId?: string;
  stepId?: string;
  auditRefs: string[];
  secretRef: SecretRef;
  grantRef: GrantRef;
  gatewayId: string;
  targetId: string;
  protocol: GatewayAdapterType;
  allowedActions: string[];
  remainingUses: number;
  expiresAt: string;
  status: CredentialSessionStatus;
  createdAt: string;
  revokedAt?: string;
  usedAt?: string;
  expiredAt?: string;
}

export interface GatewayTaskTarget {
  id: string;
  zoneId: string;
  host?: string;
  port?: number;
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
  adapter: GatewayAdapterType;
  action: string;
  payload: Record<string, unknown>;
  credentialSessionId?: string;
  credentialLeaseId?: string;
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
  credentialSessionId?: string;
  credentialLeaseId?: string;
  action: string;
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
  /** 本次任务动作，用于 ZonePolicy.allowedActions 和审批策略判定。 */
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

export interface CredentialIssueRequest {
  taskId: string;
  operatorId?: string;
  executionRunId?: string;
  stepId?: string;
  auditRef?: string;
  gatewayId: string;
  targetId: string;
  protocol: GatewayAdapterType;
  secretRef: string;
  requestedActions: string[];
  ttlSeconds?: number;
  maxUses?: number;
  now?: Date;
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
  action: string;
  payload?: Record<string, unknown>;
  credentialSessionId?: string;
  credentialLeaseId?: string;
  now?: Date;
}

export interface AdapterContext {
  gatewayId: string;
  credentialSessionId?: string;
  grantRef?: GrantRef;
}

export interface PrecheckResult {
  ok: boolean;
  reason?: string;
}

export interface AdapterExecutionResult {
  success: boolean;
  status: 'success' | 'failed';
  summary: string;
  evidence: Omit<GatewayEvidence, 'id' | 'createdAt'>[];
}

export interface GatewayAdapterDescriptor {
  type: GatewayAdapterType;
  displayName: string;
  capabilities: string[];
  supportedActions: string[];
  mockSafe: true;
  precheck(ctx: AdapterContext): Promise<PrecheckResult> | PrecheckResult;
  run(ctx: AdapterContext, task: GatewayTask): Promise<AdapterExecutionResult> | AdapterExecutionResult;
}
