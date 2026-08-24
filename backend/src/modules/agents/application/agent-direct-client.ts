import { AppError } from '../../../common/errors/app-error.js';
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
  type AgentSecurityStatus,
  type PolicyAuthorityDecisionV1,
} from '../security/agent-security.contract.js';
import type { AgentDirectControlState, AgentRegistration } from '../schema/agents.schema.js';

export interface AgentDirectActionExecuteRequest {
  actionType: AgentV2ContractType;
  inputs: Record<string, unknown>;
  requestId?: string;
  onProgress?: (detail: Record<string, unknown>) => Promise<void> | void;
}

export interface AgentDirectActionExecuteResult {
  directControl: AgentDirectControlState;
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
  detail?: Record<string, unknown>;
  taskId?: string;
  actionId?: string;
  status?: string;
  outcome?: AgentSecurityStatus;
}

export class AgentDirectClient {
  async executeAction(agent: AgentRegistration, request: AgentDirectActionExecuteRequest): Promise<AgentDirectActionExecuteResult> {
    const actionType = normalizeV2Action(request.actionType);
    const v2Request = buildAgentV2Request(agent, actionType, request.inputs, request.requestId);
    const persistedDirectControl = requireReachableDirectControl(agent);
    const baseUrl = buildDirectControlBaseUrl(persistedDirectControl.listenAddress!);
    const directControl = await resolveDirectControlForAction(
      baseUrl,
      agent,
      persistedDirectControl,
      actionType,
      request.requestId,
    );
    try {
      const startResponse = await fetchWithTimeout(`${baseUrl}/api/v1/control/actions/start`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': request.requestId ?? `agent-direct-action-start:${actionType}`,
        },
        body: JSON.stringify(v2Request),
      }, 5_000);
      const startBody = await safeReadJson(startResponse) as Record<string, unknown> | undefined;
      if (!startResponse.ok || typeof startBody?.actionId !== 'string') {
        throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Agent 直连启动任务失败', {
          agentId: agent.id,
          actionType,
          statusCode: startResponse.status,
          response: startBody,
          fallback: false,
        });
      }
      const actionId = startBody.actionId;
      const statusBody = await this.waitActionCompleted(baseUrl, agent, actionType, actionId, request.requestId, request.onProgress);
      return {
        directControl,
        success: statusBody.success === true,
        errorCode: typeof statusBody.errorCode === 'string' ? statusBody.errorCode : undefined,
        errorMessage: typeof statusBody.errorMessage === 'string' ? statusBody.errorMessage : undefined,
        detail: readRecord(statusBody.detail),
        taskId: typeof statusBody.taskId === 'string' ? statusBody.taskId : undefined,
        actionId,
        status: typeof statusBody.status === 'string' ? statusBody.status : 'completed',
        outcome: resolveAgentExecutionOutcome(statusBody, actionType),
      };
    } catch (error) {
      if (error instanceof AppError && error.errorCode === 'AGENT_AUTHORIZATION_UNAVAILABLE') throw error;
      throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Agent 直连执行连接失败', {
        agentId: agent.id,
        actionType,
        cause: error instanceof Error ? error.message : String(error),
        fallback: false,
      });
    }
  }

  private async waitActionCompleted(
    baseUrl: string,
    agent: AgentRegistration,
    actionType: string,
    actionId: string,
    requestId?: string,
    onProgress?: (detail: Record<string, unknown>) => Promise<void> | void,
  ): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 125_000;
    let lastProgressSignature = '';
    while (Date.now() < deadline) {
      let response: Response;
      try {
        response = await fetchWithTimeout(`${baseUrl}/api/v1/control/actions/status?actionId=${encodeURIComponent(actionId)}`, {
          method: 'GET',
          headers: {
            'x-request-id': requestId ?? `agent-direct-action-status:${actionType}`,
          },
        }, 5_000);
      } catch (error) {
        throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Agent 直连结果查询失败', {
          agentId: agent.id,
          actionType,
          actionId,
          cause: error instanceof Error ? error.message : String(error),
        });
      }
      const body = await safeReadJson(response) as Record<string, unknown> | undefined;
      if (!response.ok || !body) {
        throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Agent 直连结果查询返回异常', {
          agentId: agent.id,
          actionType,
          actionId,
          statusCode: response.status,
          response: body,
        });
      }
      if (body.status === 'completed') {
        return body;
      }
      const progress = readRecord(body.detail);
      if (progress) {
        const progressSignature = JSON.stringify(progress);
        if (progressSignature !== lastProgressSignature) {
          lastProgressSignature = progressSignature;
          await onProgress?.(progress);
        }
      }
      await sleep(200);
    }
    throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Agent 直连结果查询超时', {
      agentId: agent.id,
      actionType,
      actionId,
    });
  }
}

function normalizeV2Action(value: string): AgentV2ContractType {
  const action = value.trim().toLowerCase();
  if (!agentV2ContractTypes.includes(action as AgentV2ContractType)) {
    throw new AppError('AGENT_AUTHORIZATION_UNAVAILABLE', 'Agent 直连只允许 Agent v2 四个长期动作', {
      actionType: value,
      allowedActions: agentV2ContractTypes,
      fallback: false,
    });
  }
  return action as AgentV2ContractType;
}

function buildAgentV2Request(
  agent: AgentRegistration,
  actionType: AgentV2ContractType,
  inputs: Record<string, unknown>,
  requestId?: string,
): Record<string, unknown> {
  const source = readRecord(inputs);
  if (!source) failAuthorization(agent, actionType, '缺少 Agent v2 请求载荷');
  rejectLegacyInputFields(source, agent, actionType);

  let token: AgentCapabilityTokenV1;
  let policyDecision: PolicyAuthorityDecisionV1;
  try {
    token = validateAgentCapabilityToken(source.token);
    policyDecision = validatePolicyAuthorityDecision(source.policyDecision);
  } catch (error) {
    failAuthorization(agent, actionType, '缺少完整 AgentCapabilityTokenV1 或 PolicyAuthorityDecisionV1', error);
  }
  assertSecurityBinding(agent, actionType, token, policyDecision);

  const plan = actionType === 'agent.plan.validate' || actionType === 'agent.plan.execute'
    ? validatePlanForAction(source.plan, agent, actionType, token, policyDecision)
    : undefined;
  const receipt = actionType === 'agent.execution.receipt'
    ? validateReceiptForAction(source.receipt, agent, token)
    : undefined;
  const generatedRequestId = requestId?.trim() || `agent-v2:${agent.id}:${token.tokenId}:${actionType}`;

  return {
    action: actionType,
    requestId: generatedRequestId,
    agentId: agent.id,
    tenantId: agent.tenantId,
    pluginId: token.pluginId,
    pluginVersion: token.pluginVersionId,
    capability: token.capability,
    actions: token.actions,
    paths: token.allowedPaths,
    services: token.allowedServices,
    artifactDigests: token.artifactDigests,
    planDigest: token.planDigest,
    token,
    policyDecision,
    ...(plan ? { plan } : {}),
    ...(receipt ? { receipt } : {}),
  };
}

function validatePlanForAction(
  value: unknown,
  agent: AgentRegistration,
  actionType: AgentV2ContractType,
  token: AgentCapabilityTokenV1,
  policyDecision: PolicyAuthorityDecisionV1,
): AgentPlanV1 {
  let plan: AgentPlanV1;
  try {
    plan = validateAgentPlan(value);
  } catch (error) {
    failAuthorization(agent, actionType, 'Agent v2 Plan 不完整或摘要无效', error);
  }
  if (plan.agentId !== agent.id || plan.tenantId !== agent.tenantId
    || plan.pluginId !== token.pluginId || plan.pluginVersionId !== token.pluginVersionId
    || plan.capability !== token.capability || plan.planDigest !== token.planDigest
    || plan.tokenId !== token.tokenId || plan.nonce !== token.nonce
    || plan.policyDecisionId !== policyDecision.decisionId) {
    failAuthorization(agent, actionType, 'Agent v2 Plan、Token 和 Policy Decision 绑定不一致');
  }
  return plan;
}

function validateReceiptForAction(value: unknown, agent: AgentRegistration, token: AgentCapabilityTokenV1): AgentExecutionReceiptV1 {
  let receipt: AgentExecutionReceiptV1;
  try {
    receipt = validateAgentExecutionReceipt(value);
  } catch (error) {
    failAuthorization(agent, 'agent.execution.receipt', 'Agent Execution Receipt 不完整或摘要无效', error);
  }
  if (receipt.agentId !== agent.id || receipt.tenantId !== agent.tenantId || receipt.tokenId !== token.tokenId || receipt.planDigest !== token.planDigest) {
    failAuthorization(agent, 'agent.execution.receipt', 'Agent Execution Receipt 绑定不一致');
  }
  return receipt;
}

function assertSecurityBinding(agent: AgentRegistration, actionType: AgentV2ContractType, token: AgentCapabilityTokenV1, policyDecision: PolicyAuthorityDecisionV1): void {
  if (token.agentId !== agent.id || token.tenantId !== agent.tenantId
    || policyDecision.agentId !== agent.id || policyDecision.tenantId !== agent.tenantId
    || token.pluginId !== policyDecision.pluginId || token.pluginVersionId !== policyDecision.pluginVersionId
    || token.capability !== policyDecision.capability || token.policyRef !== policyDecision.policyRef
    || token.policyVersion !== policyDecision.policyVersion || token.nonce !== policyDecision.nonce
    || token.planDigest !== policyDecision.planDigest || token.tokenId !== policyDecision.tokenId
    || !sameStringSet(token.actions, policyDecision.actions) || !policyDecision.allowed) {
    failAuthorization(agent, actionType, 'Policy Authority 授权材料绑定不一致');
  }
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function rejectLegacyInputFields(source: Record<string, unknown>, agent: AgentRegistration, actionType: AgentV2ContractType): void {
  const forbidden = ['type', 'command', 'shell', 'script', 'powershell', 'cmd', 'exec'];
  const present = forbidden.filter((key) => Object.prototype.hasOwnProperty.call(source, key));
  if (present.length > 0) {
    failAuthorization(agent, actionType, 'Agent v2 请求包含已删除的旧执行字段', { forbiddenFields: present });
  }
}

function failAuthorization(agent: AgentRegistration, actionType: AgentV2ContractType, message: string, cause?: unknown, details: Record<string, unknown> = {}): never {
  throw new AppError('AGENT_AUTHORIZATION_UNAVAILABLE', message, {
    agentId: agent.id,
    tenantId: agent.tenantId,
    actionType,
    cause: cause instanceof Error ? cause.message : cause === undefined ? undefined : String(cause),
    fallback: false,
    ...details,
  });
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function requireReachableDirectControl(agent: AgentRegistration): AgentDirectControlState {
  const directControl = agent.directControl;
  if (!directControl?.enabled) {
    throw new AppError('VALIDATION_FAILED', 'Agent 未启用直连控制', { agentId: agent.id });
  }
  if (!directControl.reachable) {
    throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Agent 直连控制当前不可达', { agentId: agent.id });
  }
  if (!directControl.listenAddress) {
    throw new AppError('VALIDATION_FAILED', 'Agent 直连控制缺少监听地址', { agentId: agent.id });
  }
  return directControl;
}

async function resolveDirectControlForAction(
  baseUrl: string,
  agent: AgentRegistration,
  persistedDirectControl: AgentDirectControlState,
  action: string,
  requestId?: string,
): Promise<AgentDirectControlState> {
  if (persistedDirectControl.supportedActions.includes(action)) return persistedDirectControl;

  let response: Response;
  try {
    response = await fetchWithTimeout(`${baseUrl}/api/v1/control/health`, {
      method: 'GET',
      headers: {
        'x-request-id': requestId ?? `agent-direct-health:${action}`,
      },
    }, 5_000);
  } catch (error) {
    throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Agent 直连健康检查失败', {
      agentId: agent.id,
      action,
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  const body = await safeReadJson(response);
  const directControl = readDirectControlState(readRecord(body)?.directControl);
  if (!response.ok || !directControl) {
    throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Agent 直连健康检查返回异常', {
      agentId: agent.id,
      action,
      statusCode: response.status,
      response: body,
    });
  }
  if (!directControl.enabled || !directControl.reachable) {
    throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Agent 直连控制当前不可达', {
      agentId: agent.id,
      action,
      directControl,
    });
  }
  if (!directControl.supportedActions.includes(action)) {
    throw new AppError('CAPABILITY_MISSING', `Agent 未声明 ${action} 能力`, {
      agentId: agent.id,
      action,
      supportedActions: directControl.supportedActions,
      capabilitySource: 'runtime-health',
    });
  }
  return directControl;
}

function buildDirectControlBaseUrl(listenAddress: string): string {
  const normalized = listenAddress.trim();
  if (!normalized) throw new AppError('VALIDATION_FAILED', 'Agent 直连监听地址为空');
  return `http://${normalized}`;
}

async function safeReadJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readDirectControlState(value: unknown): AgentDirectControlState | undefined {
  const record = readRecord(value);
  if (!record || typeof record.enabled !== 'boolean' || typeof record.reachable !== 'boolean') return undefined;
  if (!Array.isArray(record.supportedActions) || !record.supportedActions.every((item) => typeof item === 'string')) return undefined;
  return {
    enabled: record.enabled,
    reachable: record.reachable,
    listenAddress: typeof record.listenAddress === 'string' ? record.listenAddress : undefined,
    protocolVersion: typeof record.protocolVersion === 'string' ? record.protocolVersion : undefined,
    supportedActions: record.supportedActions,
    lastReadyAt: typeof record.lastReadyAt === 'string' ? record.lastReadyAt : undefined,
    lastDirectError: typeof record.lastDirectError === 'string' ? record.lastDirectError : undefined,
  };
}

function resolveAgentExecutionOutcome(body: Record<string, unknown>, actionType: AgentV2ContractType): AgentSecurityStatus {
  const detail = readRecord(body.detail);
  const receipt = readRecord(body.receipt) ?? readRecord(detail?.receipt);
  const explicit = [body.outcome, body.executionStatus, body.status, receipt?.status, detail?.status]
    .map((value) => typeof value === 'string' ? value.trim().toUpperCase() : '')
    .find((value): value is AgentSecurityStatus => value === 'SUCCESS' || value === 'FAILED' || value === 'UNKNOWN' || value === 'CANCELLED');
  if (explicit) return explicit;
  if (body.success === true) return 'SUCCESS';
  // plan.execute 可能已经完成写入但响应丢失，失败时只能保持 UNKNOWN。
  return actionType === 'agent.plan.execute' ? 'UNKNOWN' : 'FAILED';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
