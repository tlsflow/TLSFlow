import { AppError } from '../../common/errors/app-error.js';
import type {
  AgentCapabilityTokenV1,
  AgentExecutionReceiptV1,
  AgentPlanV1,
  AgentV2ContractType,
  PolicyAuthorityDecisionV1,
} from '../agents/security/agent-security.contract.js';

export type ZoneType = 'production' | 'dmz' | 'office' | 'device' | 'custom';
export type GatewayStatus = 'online' | 'offline' | 'disabled' | 'revoked' | 'upgrading';
export const GatewayRouteChannels = ['probe.tcp', 'probe.http', 'probe.agent', 'forward.agent_task', 'forward.direct_control'] as const;
export type GatewayRouteChannel = (typeof GatewayRouteChannels)[number];
export type GatewayAdapterType = GatewayRouteChannel | string;
export const GatewayTaskTypes = ['gateway.probe', 'gateway.forward.agent_task', 'gateway.forward.direct_control'] as const;
export type GatewayTaskType = (typeof GatewayTaskTypes)[number];
export type ReachabilityStatus = 'reachable' | 'unreachable' | 'unknown' | 'expired';
export type ForwardingGrantStatus = 'active' | 'used' | 'expired' | 'revoked';
export type GatewayTaskStatus = 'queued' | 'acknowledged' | 'running' | 'success' | 'failed' | 'cancelled' | 'timeout' | 'unknown';
/** 仅保留“需要 Gateway”这一阻断提示，不允许把它解释为另一条执行路径。 */
export type FallbackSuggestion = 'gateway_required';

export function assertGatewayRouteChannel(value: unknown, field = 'routeChannel'): GatewayRouteChannel {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (GatewayRouteChannels.includes(normalized as GatewayRouteChannel)) return normalized as GatewayRouteChannel;
  throw new AppError('VALIDATION_FAILED', `Gateway 路由通道不受支持：${String(value)}`, { field, value });
}

export function assertGatewayTaskType(value: unknown, field = 'taskType'): GatewayTaskType {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (GatewayTaskTypes.includes(normalized as GatewayTaskType)) return normalized as GatewayTaskType;
  throw new AppError('VALIDATION_FAILED', `Gateway 任务类型不受支持：${String(value)}`, { field, value });
}

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
  /** Gateway 允许的路由/探测通道。 */
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
  /** Gateway 支持的路由/探测通道。 */
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
  /** v2 转发必须绑定租户；旧任务没有该字段时会在 v2 门禁处拒绝。 */
  tenantId?: string;
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

/**
 * Gateway 自身的窄 Grant。它不能替代 AgentCapabilityToken 或 PolicyAuthorityDecision，
 * 只负责把控制面的授权链绑定到本次 Gateway 转发。
 */
export interface GatewayGrantV1 {
  grantId: string;
  tenantId: string;
  agentId: string;
  actionType: AgentV2ContractType;
  planId: string;
  planDigest: string;
  pluginId: string;
  pluginVersionId: string;
  tokenId: string;
  nonce: string;
  revocationRef: string;
  forwardingGrantId: string;
}

/** Gateway 传给真实 Agent v2 转发端口的完整授权请求。 */
export interface GatewayAgentV2ForwardRequest {
  actionType: AgentV2ContractType;
  tenantId: string;
  target: GatewayTaskTarget;
  grant: GatewayGrantV1;
  forwardingGrant: ForwardingGrant;
  token: AgentCapabilityTokenV1;
  policyDecision: PolicyAuthorityDecisionV1;
  plan?: AgentPlanV1;
  receipt?: AgentExecutionReceiptV1;
  requestId: string;
}

/** 转发端口返回的原始 Agent v2 结果；Gateway 不会把它转换成合成成功。 */
export interface GatewayAgentV2ForwardResult {
  accepted: boolean;
  tenantId: string;
  agentId: string;
  actionType: AgentV2ContractType;
  tokenId: string;
  planDigest: string;
  nonce: string;
  revocationRef: string;
  grantId: string;
  forwardingGrantId: string;
  receipt?: AgentExecutionReceiptV1;
  detail?: Record<string, unknown>;
}

export interface GatewayAgentV2Forwarder {
  forward(request: GatewayAgentV2ForwardRequest): Promise<GatewayAgentV2ForwardResult>;
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
  /** 实际值只能是 probe.* 或 forward.* 路由通道。 */
  adapter: GatewayAdapterType;
  /** Gateway 任务类型：gateway.probe / gateway.forward.agent_task / gateway.forward.direct_control。 */
  action: GatewayTaskType | string;
  payload: Record<string, unknown>;
  grant?: GatewayGrantV1;
  v2NonceBinding?: { tenantId: string; agentId: string; tokenId: string; nonce: string; revocationRef: string; consumedAt: string };
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
  status: Extract<GatewayTaskStatus, 'success' | 'failed' | 'cancelled' | 'timeout' | 'unknown'>;
  summary: string;
  exitCode?: number;
  errorCode?: string;
  errorMessage?: string;
  evidenceIds: string[];
  evidenceRef?: string;
  finishedAt: string;
  /** Agent v2 结果状态；UNKNOWN 表示写入是否发生无法确认。 */
  executionStatus?: 'SUCCESS' | 'FAILED' | 'UNKNOWN' | 'CANCELLED';
  receipt?: AgentExecutionReceiptV1;
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
  grant?: GatewayGrantV1;
  forwardingGrant?: ForwardingGrant;
  now?: Date;
}
