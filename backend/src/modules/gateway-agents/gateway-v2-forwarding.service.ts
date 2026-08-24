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
  consume(binding: GatewayV2ReplayBinding): void;
}

export interface GatewayV2NonceStorePort {
  assertV2NonceAvailable(binding: GatewayV2ReplayBinding): void;
  consumeV2Nonce(taskId: string, binding: GatewayV2ReplayBinding): unknown;
}

/** 把 nonce 消费记录写回 GatewayTask，重启后仍能从持久化任务拒绝重放。 */
export class GatewayTaskReplayGuard implements GatewayV2ReplayGuardPort {
  constructor(private readonly store: GatewayV2NonceStorePort) {}

  assertAvailable(binding: GatewayV2ReplayBinding): void {
    this.store.assertV2NonceAvailable(binding);
  }

  consume(binding: GatewayV2ReplayBinding): void {
    const taskId = binding.taskId;
    if (!taskId) throw new AppError('SYSTEM_INTERNAL_ERROR', 'Gateway v2 nonce 消费缺少 GatewayTask ID');
    this.store.consumeV2Nonce(taskId, binding);
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

  consume(binding: { tenantId: string; agentId: string; tokenId: string; nonce: string; revocationRef: string }): void {
    this.assertAvailable(binding);
    this.consumed.add(nonceKey(binding));
  }
}

export class GatewayV2ForwardingService {
  prepare(task: GatewayTask, processTenantId: string, requestId: string, now = new Date()): GatewayAgentV2ForwardRequest {
    if (task.tenantId !== processTenantId) {
      throw new AppError('AUTH_FORBIDDEN', 'GatewayTask 租户与 Gateway 进程不一致', { reason: 'GATEWAY_CROSS_TENANT_DENIED', taskTenantId: task.tenantId, processTenantId });
    }
    if (task.action !== 'gateway.forward.agent_task' && task.action !== 'gateway.forward.direct_control') {
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
    const forwardingGrant = validateForwardingGrant(task.forwardingGrant);

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

  validateResult(request: GatewayAgentV2ForwardRequest, result: GatewayAgentV2ForwardResult): GatewayAgentV2ForwardResult {
    if (!result || result.accepted !== true) throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Gateway 未收到 Agent v2 的有效接受结果');
    if (result.tenantId !== request.tenantId || result.agentId !== request.token.agentId || result.actionType !== request.actionType
      || result.tokenId !== request.token.tokenId || result.planDigest !== request.token.planDigest
      || result.nonce !== request.token.nonce || result.revocationRef !== request.policyDecision.revocationRef
      || result.grantId !== request.grant.grantId || result.forwardingGrantId !== request.forwardingGrant.id) {
      throw new AppError('AUTH_FORBIDDEN', 'Agent v2 转发结果绑定不一致', { reason: 'GATEWAY_RECEIPT_BINDING_DENIED' });
    }
    const receipt = result.receipt ? validateAgentExecutionReceipt(result.receipt) : undefined;
    if (request.actionType === 'agent.plan.execute' || request.actionType === 'agent.execution.receipt') {
      if (!receipt) throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Agent v2 写入操作缺少真实 Execution Receipt', { reason: 'GATEWAY_RECEIPT_REQUIRED' });
      assertReceiptBinding(receipt, request.grant, request.token, request.plan);
      if (!receipt.nonceConsumed) throw new AppError('AUTH_FORBIDDEN', 'Agent v2 Receipt 未确认 nonce 已消费', { reason: 'GATEWAY_NONCE_NOT_CONSUMED' });
    }
    return { ...result, ...(receipt ? { receipt } : {}) };
  }
}

/** 默认的真实 HTTP 转发端口。没有目标地址或 Agent 无响应时只抛错，不生成成功结果。 */
export class HttpGatewayAgentV2Forwarder implements GatewayAgentV2Forwarder {
  async forward(request: GatewayAgentV2ForwardRequest): Promise<GatewayAgentV2ForwardResult> {
    const baseUrl = targetBaseUrl(request.target.host, request.target.port);
    const start = await fetchJson(`${baseUrl}/api/v1/control/actions/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': request.requestId },
      body: JSON.stringify({
        action: request.actionType,
        actionType: request.actionType,
        requestId: request.requestId,
        agentId: request.token.agentId,
        tenantId: request.tenantId,
        token: request.token,
        policyDecision: request.policyDecision,
        ...(request.plan ? { plan: request.plan } : {}),
        ...(request.receipt ? { receipt: request.receipt } : {}),
        gatewayGrant: request.grant,
        forwardingGrant: request.forwardingGrant,
      }),
    }, 5_000);
    const actionId = stringValue(start.actionId, 'Agent v2 actionId');
    const deadline = Date.now() + 125_000;
    while (Date.now() < deadline) {
      const body = await fetchJson(`${baseUrl}/api/v1/control/actions/status?actionId=${encodeURIComponent(actionId)}`, {
        method: 'GET',
        headers: { 'x-request-id': request.requestId },
      }, 5_000);
      if (body.status === 'completed') {
        return {
          accepted: true,
          tenantId: stringValue(body.tenantId ?? request.tenantId, 'Agent v2 result tenantId'),
          agentId: stringValue(body.agentId ?? request.token.agentId, 'Agent v2 result agentId'),
          actionType: normalizeAction(body.actionType ?? body.action ?? request.actionType),
          tokenId: stringValue(body.tokenId ?? request.token.tokenId, 'Agent v2 result tokenId'),
          planDigest: stringValue(body.planDigest ?? request.token.planDigest, 'Agent v2 result planDigest'),
          nonce: stringValue(body.nonce ?? request.token.nonce, 'Agent v2 result nonce'),
          revocationRef: stringValue(body.revocationRef ?? request.policyDecision.revocationRef, 'Agent v2 result revocationRef'),
          grantId: stringValue(body.grantId ?? request.grant.grantId, 'Agent v2 result grantId'),
          forwardingGrantId: stringValue(body.forwardingGrantId ?? request.forwardingGrant.id, 'Agent v2 result forwardingGrantId'),
          receipt: readRecord(body.receipt)
            ? readRecord(body.receipt) as unknown as AgentExecutionReceiptV1
            : readRecord(readRecord(body.detail)?.receipt) as unknown as AgentExecutionReceiptV1 | undefined,
          detail: readRecord(body.detail),
        };
      }
      await sleep(200);
    }
    throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Agent v2 转发超时，写入结果不明', { reason: 'GATEWAY_FORWARD_TIMEOUT', actionId });
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
    || token.nonce !== decision.nonce || token.planDigest !== decision.planDigest
    || !sameArrays(token.actions, decision.actions) || !sameArrays(token.allowedPaths, decision.allowedPaths)
    || !sameArrays(token.allowedServices, decision.allowedServices) || !sameArrays(token.artifactDigests, decision.artifactDigests)) {
    throw new AppError('AUTH_FORBIDDEN', 'AgentCapabilityTokenV1 与 PolicyAuthorityDecisionV1 绑定不一致', { reason: 'GATEWAY_AUTHORIZATION_BINDING_DENIED' });
  }
  if (task.gatewayId !== forwardingGrant.gatewayId || task.delegatedTargetId !== forwardingGrant.delegatedTargetId
    || task.executionRunId !== forwardingGrant.executionRunId || task.stepId !== forwardingGrant.stepId
    || task.adapter !== forwardingGrant.routeChannel || forwardingGrant.taskType !== task.action
    || (task.action === 'gateway.forward.agent_task' && task.adapter !== 'forward.agent_task')
    || (task.action === 'gateway.forward.direct_control' && task.adapter !== 'forward.direct_control')
    || forwardingGrant.status !== 'active' || forwardingGrant.remainingUses !== 1
    || forwardingGrant.tenantId !== processTenantId) {
    throw new AppError('AUTH_FORBIDDEN', 'ForwardingGrant 与 Gateway v2 请求范围不一致', { reason: 'GATEWAY_FORWARDING_GRANT_BINDING_DENIED' });
  }
  if (grant.tenantId !== processTenantId || grant.agentId !== token.agentId || grant.actionType !== actionType
    || grant.planDigest !== token.planDigest || grant.pluginId !== token.pluginId || grant.pluginVersionId !== token.pluginVersionId
    || grant.tokenId !== token.tokenId || grant.nonce !== token.nonce || grant.revocationRef !== decision.revocationRef
    || grant.forwardingGrantId !== forwardingGrant.id || (task.planId !== undefined && grant.planId !== task.planId)) {
    throw new AppError('AUTH_FORBIDDEN', 'Gateway Grant 与 Agent v2 授权材料不一致', { reason: 'GATEWAY_GRANT_BINDING_DENIED' });
  }
  if (plan) {
    if (plan.agentId !== token.agentId || plan.tenantId !== token.tenantId || plan.pluginId !== token.pluginId || plan.pluginVersionId !== token.pluginVersionId
      || plan.planDigest !== token.planDigest || plan.tokenId !== token.tokenId || plan.nonce !== token.nonce || plan.policyDecisionId !== decision.decisionId
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
  const fields = ['grantId', 'tenantId', 'agentId', 'actionType', 'planId', 'planDigest', 'pluginId', 'pluginVersionId', 'tokenId', 'nonce', 'revocationRef', 'forwardingGrantId'];
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

function validateForwardingGrant(value: unknown): ForwardingGrant {
  if (!value) throw new AppError('AUTH_FORBIDDEN', 'Gateway v2 转发缺少 ForwardingGrant', { reason: 'GATEWAY_FORWARDING_GRANT_REQUIRED' });
  const grant = record(value, 'ForwardingGrant');
  if (grant.status !== 'active' || grant.remainingUses !== 1 || typeof grant.tenantId !== 'string') throw new AppError('AUTH_FORBIDDEN', 'Gateway v2 需要绑定的单次 ForwardingGrant', { reason: 'GATEWAY_FORWARDING_GRANT_REQUIRED' });
  if (Date.parse(grant.expiresAt as string) <= Date.now()) throw new AppError('AUTH_FORBIDDEN', 'ForwardingGrant 已过期', { reason: 'GATEWAY_FORWARDING_GRANT_EXPIRED' });
  return grant as unknown as ForwardingGrant;
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

function stringValue(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new AppError('EXECUTION_TARGET_UNAVAILABLE', `${name} 缺失`);
  return value;
}

function readRecord(value: unknown): Record<string, any> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : undefined;
}

function nonceKey(binding: { tenantId: string; agentId: string; tokenId: string; nonce: string }): string {
  return [binding.tenantId, binding.agentId, binding.tokenId, binding.nonce].join(':');
}

function targetBaseUrl(host: string | undefined, port: number | undefined): string {
  if (!host || !port) throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Gateway v2 转发缺少真实 Agent 地址', { reason: 'GATEWAY_TARGET_ADDRESS_REQUIRED' });
  return host.startsWith('http://') || host.startsWith('https://') ? `${host}:${port}` : `http://${host}:${port}`;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<Record<string, any>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.text();
    const value = body.trim() ? JSON.parse(body) as unknown : undefined;
    if (!response.ok || !value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Agent v2 转发返回异常', { statusCode: response.status });
    return value as Record<string, any>;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Agent v2 转发连接失败', { cause: error instanceof Error ? error.message : String(error) });
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
