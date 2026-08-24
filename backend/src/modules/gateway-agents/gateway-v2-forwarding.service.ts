import { AppError } from '../../common/errors/app-error.js';
import {
  agentV2ContractTypes,
  validateAgentCapabilityToken,
  validateAgentExecutionReceipt,
  validateAgentPlan,
  validatePolicyAuthorityDecision,
  type AgentCapabilityTokenV1,
  type AgentExecutionReceiptV1,
  type AgentPlanV1,
  type AgentV2ContractType,
  type PolicyAuthorityDecisionV1,
} from '../agents/security/agent-security.contract.js';
import type {
  ForwardingGrant,
  GatewayAgentV2ForwardRequest,
  GatewayAgentV2ForwardResult,
  GatewayAgentV2Forwarder,
  GatewayGrantV1,
  GatewayTask,
} from './gateway-agent.types.js';

export interface GatewayV2ReplayBinding {
  tenantId: string;
  agentId: string;
  tokenId: string;
  nonce: string;
  revocationRef: string;
  taskId?: string;
}

export interface GatewayV2ReplayGuardPort {
  assertAvailable(binding: GatewayV2ReplayBinding): void;
  consume(binding: GatewayV2ReplayBinding, consumedForwardingGrant?: ForwardingGrant): void;
}

export interface GatewayV2NonceStorePort {
  assertV2NonceAvailable(binding: GatewayV2ReplayBinding): void;
  consumeV2NonceAndForwardingGrant(taskId: string, binding: GatewayV2ReplayBinding, consumedForwardingGrant: ForwardingGrant): unknown;
}

/** 把 nonce 消费记录写回 GatewayTask，重启后仍能从持久化任务拒绝重放。 */
export class GatewayTaskReplayGuard implements GatewayV2ReplayGuardPort {
  constructor(private readonly store: GatewayV2NonceStorePort) {}

  assertAvailable(binding: GatewayV2ReplayBinding): void {
    this.store.assertV2NonceAvailable(binding);
  }

  consume(binding: GatewayV2ReplayBinding, consumedForwardingGrant?: ForwardingGrant): void {
    const taskId = binding.taskId;
    if (!taskId) throw new AppError('SYSTEM_INTERNAL_ERROR', 'Gateway v2 nonce 消费缺少 GatewayTask ID');
    if (!consumedForwardingGrant) throw new AppError('SYSTEM_INTERNAL_ERROR', 'Gateway v2 nonce 消费缺少已绑定的 ForwardingGrant');
    this.store.consumeV2NonceAndForwardingGrant(taskId, binding, consumedForwardingGrant);
  }
}

/** Gateway 进程级原子 nonce 门禁；同一进程内不允许同一授权材料再次转发。 */
export class GatewayV2ReplayGuard implements GatewayV2ReplayGuardPort {
  private readonly consumed = new Set<string>();
  private readonly revoked = new Set<string>();

  revoke(revocationRef: string): void {
    this.revoked.add(revocationRef);
  }

  assertAvailable(binding: { tenantId: string; agentId: string; tokenId: string; nonce: string; revocationRef: string }): void {
    if (this.revoked.has(binding.revocationRef)) {
      throw new AppError('AUTH_FORBIDDEN', 'Gateway 拒绝已撤销的 Agent v2 授权', { reason: 'GATEWAY_V2_REVOCATION_REVOKED', revocationRef: binding.revocationRef });
    }
    if (this.consumed.has(nonceKey(binding))) {
      throw new AppError('AUTH_FORBIDDEN', 'Gateway 拒绝重复使用 Agent v2 nonce', { reason: 'GATEWAY_V2_NONCE_REPLAY', tokenId: binding.tokenId, nonce: binding.nonce });
    }
  }

  consume(binding: { tenantId: string; agentId: string; tokenId: string; nonce: string; revocationRef: string }, _consumedForwardingGrant?: ForwardingGrant): void {
    this.assertAvailable(binding);
    this.consumed.add(nonceKey(binding));
  }
}

export class GatewayV2ForwardingService {
  prepare(task: GatewayTask, processTenantId: string, requestId: string, now = new Date()): GatewayAgentV2ForwardRequest {
    if (task.tenantId !== processTenantId) {
      throw new AppError('AUTH_FORBIDDEN', 'GatewayTask 租户与 Gateway 进程不一致', { reason: 'GATEWAY_CROSS_TENANT_DENIED', taskTenantId: task.tenantId, processTenantId });
    }
    if (!task.tenantId || !task.planId || !task.executionRunId || !task.stepId || task.target.id !== task.delegatedTargetId) {
      throw new AppError('AUTH_FORBIDDEN', 'GatewayTask 缺少 Agent v2 执行绑定', { reason: 'GATEWAY_V2_TASK_BINDING_REQUIRED', taskId: task.id });
    }
    if (task.action !== 'gateway.forward.agent_task') {
      throw new AppError('VALIDATION_FAILED', 'Gateway v2 只允许转发 Agent 任务，禁止合成 probe 结果', { reason: 'GATEWAY_SYNTHETIC_ROUTE_FORBIDDEN', action: task.action });
    }

    const source = record(task.payload, 'Gateway v2 payload');
    const actionType = normalizeAction(source.actionType);
    const token = validateAgentCapabilityToken(source.token);
    const policyDecision = validatePolicyAuthorityDecision(source.policyDecision);
    const plan = actionType === 'agent.plan.validate' || actionType === 'agent.plan.execute'
      ? validateAgentPlan(source.plan)
      : undefined;
    const receipt = actionType === 'agent.execution.receipt'
      ? validateAgentExecutionReceipt(source.receipt)
      : undefined;
    const grant = validateGatewayGrant(source.grant ?? task.grant);
    if (source.grant && task.grant && !sameGrant(source.grant, task.grant)) {
      throw new AppError('AUTH_FORBIDDEN', 'Gateway payload Grant 与 GatewayTask Grant 不一致', { reason: 'GATEWAY_GRANT_DUPLICATE_BINDING_DENIED' });
    }
    const forwardingGrant = validateForwardingGrant(task.forwardingGrant, now);

    assertTimeBinding(token, policyDecision, plan, now);
    assertAuthorizationBinding(task, processTenantId, actionType, token, policyDecision, plan, receipt, grant, forwardingGrant);
    if (receipt) assertReceiptBinding(receipt, grant, token, plan);

    return structuredClone({
      actionType,
      tenantId: processTenantId,
      target: task.target,
      grant,
      forwardingGrant,
      token,
      policyDecision,
      ...(plan ? { plan } : {}),
      ...(receipt ? { receipt } : {}),
      requestId,
    });
  }

  validateResult(request: GatewayAgentV2ForwardRequest, result: GatewayAgentV2ForwardResult, now = new Date()): GatewayAgentV2ForwardResult {
    if (!result || result.accepted !== true) throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Gateway 未收到 Agent v2 的有效接受结果');
    if (result.tenantId !== request.tenantId || result.agentId !== request.token.agentId || result.actionType !== request.actionType
      || result.tokenId !== request.token.tokenId || result.planDigest !== request.token.planDigest
      || result.nonce !== request.token.nonce || result.revocationRef !== request.policyDecision.revocationRef
      || result.grantId !== request.grant.grantId || result.forwardingGrantId !== request.forwardingGrant.id) {
      throw new AppError('AUTH_FORBIDDEN', 'Agent v2 转发结果绑定不一致', { reason: 'GATEWAY_RECEIPT_BINDING_DENIED' });
    }
    const receipt = result.receipt ? validateAgentExecutionReceipt(result.receipt) : undefined;
    if (receipt) {
      assertReceiptBinding(receipt, request.grant, request.token, request.plan);
      assertReceiptTime(receipt, request.token, now);
    }
    if (request.actionType === 'agent.plan.execute' || request.actionType === 'agent.execution.receipt') {
      if (!receipt) throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Agent v2 写入操作缺少真实 Execution Receipt', { reason: 'GATEWAY_RECEIPT_REQUIRED' });
      if (!receipt.nonceConsumed) throw new AppError('AUTH_FORBIDDEN', 'Agent v2 Receipt 未确认 nonce 已消费', { reason: 'GATEWAY_NONCE_NOT_CONSUMED' });
    }
    return { ...result, ...(receipt ? { receipt } : {}) };
  }
}

/**
 * Gateway 生产默认没有已装配的 Agent v2 传输端口时必须失败关闭。
 * Agent v2 只能通过显式注入的 Forwarder 接入，禁止恢复旧 HTTP 控制端点。
 */
export class FailClosedGatewayAgentV2Forwarder implements GatewayAgentV2Forwarder {
  async forward(_request: GatewayAgentV2ForwardRequest): Promise<GatewayAgentV2ForwardResult> {
    throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Gateway Agent v2 传输端口未装配，拒绝执行', {
      reason: 'GATEWAY_AGENT_V2_TRANSPORT_NOT_ASSEMBLED',
      fallback: false,
    });
  }
}

function assertAuthorizationBinding(
  task: GatewayTask,
  processTenantId: string,
  actionType: AgentV2ContractType,
  token: AgentCapabilityTokenV1,
  decision: PolicyAuthorityDecisionV1,
  plan: AgentPlanV1 | undefined,
  receipt: AgentExecutionReceiptV1 | undefined,
  grant: GatewayGrantV1,
  forwardingGrant: ForwardingGrant,
): void {
  const sameArrays = (left: readonly string[], right: readonly string[]) => left.length === right.length && left.every((value) => right.includes(value));
  if (token.agentId !== forwardingGrant.delegatedAgentId || token.tenantId !== processTenantId
    || decision.agentId !== token.agentId || decision.tenantId !== token.tenantId || !decision.allowed
    || token.pluginId !== decision.pluginId || token.pluginVersionId !== decision.pluginVersionId || token.capability !== decision.capability
    || token.policyRef !== decision.policyRef || token.policyVersion !== decision.policyVersion || token.tokenId !== decision.tokenId
    || token.nonce !== decision.nonce || token.planDigest !== decision.planDigest || token.authorityKeyId !== decision.authorityKeyId
    || token.approvalRef !== decision.approvalRef
    || !sameArrays(token.actions, decision.actions) || !sameArrays(token.allowedPaths, decision.allowedPaths)
    || !sameArrays(token.allowedServices, decision.allowedServices) || !sameArrays(token.artifactDigests, decision.artifactDigests)) {
    throw new AppError('AUTH_FORBIDDEN', 'AgentCapabilityTokenV1 与 PolicyAuthorityDecisionV1 绑定不一致', { reason: 'GATEWAY_AUTHORIZATION_BINDING_DENIED' });
  }
  if (task.gatewayId !== forwardingGrant.gatewayId || task.delegatedTargetId !== forwardingGrant.delegatedTargetId
    || task.executionRunId !== forwardingGrant.executionRunId || task.stepId !== forwardingGrant.stepId
    || task.adapter !== forwardingGrant.routeChannel || forwardingGrant.taskType !== task.action
    || task.adapter !== 'forward.agent_task'
    || forwardingGrant.status !== 'active' || forwardingGrant.remainingUses !== 1
    || forwardingGrant.tenantId !== processTenantId || !task.planId) {
    throw new AppError('AUTH_FORBIDDEN', 'ForwardingGrant 与 Gateway v2 请求范围不一致', { reason: 'GATEWAY_FORWARDING_GRANT_BINDING_DENIED' });
  }
  if (grant.tenantId !== processTenantId || grant.agentId !== token.agentId || grant.actionType !== actionType
    || grant.planDigest !== token.planDigest || grant.pluginId !== token.pluginId || grant.pluginVersionId !== token.pluginVersionId
    || grant.capability !== token.capability || grant.tokenId !== token.tokenId || grant.policyDecisionId !== decision.decisionId
    || grant.nonce !== token.nonce || grant.revocationRef !== decision.revocationRef
    || grant.forwardingGrantId !== forwardingGrant.id || grant.planId !== task.planId) {
    throw new AppError('AUTH_FORBIDDEN', 'Gateway Grant 与 Agent v2 授权材料不一致', { reason: 'GATEWAY_GRANT_BINDING_DENIED' });
  }
  if (plan) {
    if (plan.agentId !== token.agentId || plan.tenantId !== token.tenantId || plan.pluginId !== token.pluginId || plan.pluginVersionId !== token.pluginVersionId
      || plan.capability !== token.capability || plan.planDigest !== token.planDigest || plan.tokenId !== token.tokenId || plan.nonce !== token.nonce || plan.policyDecisionId !== decision.decisionId
      || plan.planId !== grant.planId) {
      throw new AppError('AUTH_FORBIDDEN', 'Agent v2 Plan 与授权材料不一致', { reason: 'GATEWAY_PLAN_BINDING_DENIED' });
    }
    assertOperationScope(plan, token, decision);
  }
  if (receipt) assertReceiptBinding(receipt, grant, token, plan);
}

function assertReceiptBinding(receipt: AgentExecutionReceiptV1, grant: GatewayGrantV1, token: AgentCapabilityTokenV1, plan: AgentPlanV1 | undefined): void {
  if (receipt.agentId !== token.agentId || receipt.tenantId !== token.tenantId || receipt.tokenId !== token.tokenId
    || receipt.planDigest !== token.planDigest || (plan && (receipt.planId !== plan.planId || !plan.operations.some((operation) => operation.operationId === receipt.operationId))) || receipt.planId !== grant.planId) {
    throw new AppError('AUTH_FORBIDDEN', 'AgentExecutionReceiptV1 与本次授权不一致', { reason: 'GATEWAY_RECEIPT_BINDING_DENIED' });
  }
}

function assertOperationScope(plan: AgentPlanV1, token: AgentCapabilityTokenV1, decision: PolicyAuthorityDecisionV1): void {
  const allowedPath = (value: string) => token.allowedPaths.some((root) => value === root || value.startsWith(`${root.replace(/[\\/]$/, '')}/`) || value.startsWith(`${root.replace(/[\\/]$/, '')}\\`));
  const pathKeys = ['path', 'sourcePath', 'destinationPath', 'backupPath', 'restorePath'];
  const serviceKeys = ['service', 'serviceName', 'name'];
  const artifactKeys = ['artifactDigest', 'artifactSha256', 'artifactDigests'];
  for (const operation of plan.operations) {
    if (!token.actions.includes(operation.operationType) || !decision.actions.includes(operation.operationType)) {
      throw new AppError('AUTH_FORBIDDEN', 'Agent v2 Plan 包含未授权操作', { reason: 'GATEWAY_OPERATION_DENIED', operationType: operation.operationType });
    }
    const input = operation.input;
    for (const key of pathKeys) if (typeof input[key] === 'string' && !allowedPath(input[key] as string)) throw new AppError('AUTH_FORBIDDEN', 'Agent v2 Plan 路径超出授权范围', { reason: 'GATEWAY_PATH_SCOPE_DENIED', operationId: operation.operationId, field: key });
    for (const key of serviceKeys) if (typeof input[key] === 'string' && !token.allowedServices.includes(input[key] as string)) throw new AppError('AUTH_FORBIDDEN', 'Agent v2 Plan 服务超出授权范围', { reason: 'GATEWAY_SERVICE_SCOPE_DENIED', operationId: operation.operationId, field: key });
    for (const key of artifactKeys) {
      const values = Array.isArray(input[key]) ? input[key] as unknown[] : [input[key]];
      for (const value of values) if (typeof value === 'string' && !token.artifactDigests.includes(value)) throw new AppError('AUTH_FORBIDDEN', 'Agent v2 Plan Artifact 摘要超出授权范围', { reason: 'GATEWAY_ARTIFACT_SCOPE_DENIED', operationId: operation.operationId, field: key });
    }
  }
}

function assertTimeBinding(token: AgentCapabilityTokenV1, decision: PolicyAuthorityDecisionV1, plan: AgentPlanV1 | undefined, now: Date): void {
  const nowMs = now.getTime();
  if (nowMs < Date.parse(token.issuedAt) || nowMs >= Date.parse(token.expiresAt) || nowMs < Date.parse(decision.issuedAt) || nowMs >= Date.parse(decision.validUntil)
    || (plan && (nowMs >= Date.parse(plan.expiresAt) || Date.parse(plan.expiresAt) > Date.parse(token.expiresAt) || Date.parse(plan.expiresAt) > Date.parse(decision.validUntil)))) {
    throw new AppError('AUTH_FORBIDDEN', 'Agent v2 授权材料已过期或尚未生效', { reason: 'GATEWAY_AUTHORIZATION_EXPIRED' });
  }
}

function validateGatewayGrant(value: unknown): GatewayGrantV1 {
  const grant = record(value, 'GatewayGrantV1');
  const fields = ['grantId', 'tenantId', 'agentId', 'actionType', 'planId', 'planDigest', 'pluginId', 'pluginVersionId', 'capability', 'tokenId', 'policyDecisionId', 'nonce', 'revocationRef', 'forwardingGrantId'];
  for (const field of fields) if (typeof grant[field] !== 'string' || !(grant[field] as string).trim()) throw new AppError('AUTH_FORBIDDEN', `Gateway Grant 缺少 ${field}`, { reason: 'GATEWAY_GRANT_REQUIRED', field });
  normalizeAction(grant.actionType);
  return grant as unknown as GatewayGrantV1;
}

function sameGrant(left: unknown, right: unknown): boolean {
  const leftGrant = validateGatewayGrant(left);
  const rightGrant = validateGatewayGrant(right);
  return Object.keys(leftGrant).length === Object.keys(rightGrant).length
    && Object.keys(leftGrant).every((key) => leftGrant[key as keyof GatewayGrantV1] === rightGrant[key as keyof GatewayGrantV1]);
}

function validateForwardingGrant(value: unknown, now: Date): ForwardingGrant {
  if (!value) throw new AppError('AUTH_FORBIDDEN', 'Gateway v2 转发缺少 ForwardingGrant', { reason: 'GATEWAY_FORWARDING_GRANT_REQUIRED' });
  const grant = record(value, 'ForwardingGrant');
  const requiredFields = ['id', 'gatewayId', 'delegatedTargetId', 'delegatedAgentId', 'tenantId', 'taskType', 'routeChannel', 'executionRunId', 'stepId', 'expiresAt', 'status', 'maxUses', 'remainingUses', 'issuedAt'];
  for (const field of requiredFields) {
    if (grant[field] === undefined || grant[field] === null || (typeof grant[field] === 'string' && !grant[field].trim())) {
      throw new AppError('AUTH_FORBIDDEN', `ForwardingGrant 缺少 ${field}`, { reason: 'GATEWAY_FORWARDING_GRANT_REQUIRED', field });
    }
  }
  if (grant.status !== 'active' || grant.maxUses !== 1 || grant.remainingUses !== 1) throw new AppError('AUTH_FORBIDDEN', 'Gateway v2 需要绑定的单次 ForwardingGrant', { reason: 'GATEWAY_FORWARDING_GRANT_REQUIRED' });
  const expiresAt = Date.parse(grant.expiresAt as string);
  const issuedAt = Date.parse(grant.issuedAt as string);
  if (!Number.isFinite(expiresAt) || !Number.isFinite(issuedAt) || expiresAt <= now.getTime() || issuedAt > now.getTime()) throw new AppError('AUTH_FORBIDDEN', 'ForwardingGrant 已过期或尚未生效', { reason: 'GATEWAY_FORWARDING_GRANT_EXPIRED' });
  return grant as unknown as ForwardingGrant;
}

function assertReceiptTime(receipt: AgentExecutionReceiptV1, token: AgentCapabilityTokenV1, now: Date): void {
  const completedAt = Date.parse(receipt.completedAt);
  const startedAt = Date.parse(receipt.startedAt);
  const issuedAt = Date.parse(token.issuedAt);
  const expiresAt = Date.parse(token.expiresAt);
  const clockSkewMs = 5_000;
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt)
    || startedAt < issuedAt - clockSkewMs
    || completedAt < startedAt
    || completedAt > now.getTime() + clockSkewMs
    || completedAt >= expiresAt) {
    throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Agent v2 Receipt 迟到、超前或超出授权时间窗', { reason: 'GATEWAY_LATE_RECEIPT' });
  }
}

function normalizeAction(value: unknown): AgentV2ContractType {
  const action = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!agentV2ContractTypes.includes(action as AgentV2ContractType)) throw new AppError('VALIDATION_FAILED', 'Gateway 只允许 Agent v2 四个长期动作', { reason: 'GATEWAY_ACTION_NOT_ALLOWED', action });
  return action as AgentV2ContractType;
}

function record(value: unknown, name: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('VALIDATION_FAILED', `${name} 必须是对象`);
  return value as Record<string, any>;
}

function readRecord(value: unknown): Record<string, any> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : undefined;
}

function nonceKey(binding: { tenantId: string; agentId: string; tokenId: string; nonce: string }): string {
  return [binding.tenantId, binding.agentId, binding.tokenId, binding.nonce].join(':');
}
