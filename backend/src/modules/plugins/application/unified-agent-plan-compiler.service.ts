import { AppError } from '../../../common/errors/app-error.js';
import {
  agentV2ContractTypes,
  sha256Digest,
  validateAgentCapabilityToken,
  validateAgentLocalPolicy,
  validateAgentPlan,
  validatePolicyAuthorityDecision,
  type AgentCapabilityTokenV1,
  type AgentPlanV1,
  type PolicyAuthorityDecisionV1,
} from '../../agents/security/agent-security.contract.js';
import type { ResolvedDeploymentInputV1 } from '../../deployment-inputs/dto/resolved-deployment-input.dto.js';
import {
  isUnifiedPluginVersionAccessibleToTenant,
  type UnifiedPluginsApplicationService,
} from './unified-plugins.application-service.js';
import type {
  UnifiedAgentPlanAuthorizationDependenciesV1,
} from './unified-agent-plan-authorization.port.js';

export interface AgentV2PlanExecutionEnvelopeV1 {
  actionType: 'agent.plan.validate' | 'agent.plan.execute';
  actionSchemaVersion: '1.0';
  plan: AgentPlanV1;
  token: AgentCapabilityTokenV1;
  policyDecision: PolicyAuthorityDecisionV1;
}

/**
 * 宿主不再把插件资源编译成旧 Agent Plan。
 * Agent v2 计划必须先经过固定摘要、Grant、本地策略和生产 Policy Authority 授权，才能进入执行载荷。
 */
export class UnifiedAgentPlanCompilerService {
  private readonly authorizationCache = new Map<string, Promise<AgentV2PlanExecutionEnvelopeV1>>();

  constructor(
    private readonly plugins: UnifiedPluginsApplicationService,
    private readonly authorization?: UnifiedAgentPlanAuthorizationDependenciesV1,
  ) {}

  async compile(input: {
    tenantId: string;
    agentId: string;
    executionRunId: string;
    executionStepId: string;
    pluginVersionId: string;
    pluginBindingId: string;
    resolvedInput: ResolvedDeploymentInputV1;
    executionMode?: 'APPLY' | 'PREFLIGHT' | 'ROLLBACK';
    ttlSeconds?: number;
    v2Request?: {
      actionType?: unknown;
      plan?: unknown;
      token?: unknown;
      policyDecision?: unknown;
      authorization?: {
        grantId?: unknown;
        policyRef?: unknown;
        policyVersion?: unknown;
        actions?: unknown;
        allowedPaths?: unknown;
        allowedServices?: unknown;
        artifactDigests?: unknown;
        approvalRef?: unknown;
        lifetimeSeconds?: unknown;
      };
    };
  }): Promise<AgentV2PlanExecutionEnvelopeV1> {
    // 这些字段由旧调用方传入，但宿主不再从它们推导产品操作或生成计划。
    void input.executionRunId;
    void input.executionStepId;
    void input.resolvedInput;
    void input.executionMode;
    void input.ttlSeconds;

    const request = input.v2Request;
    if (!request) failClosed(input, '缺少完整 Agent v2 授权请求');
    const actionType = readActionType(request.actionType);
    if (actionType !== 'agent.plan.validate' && actionType !== 'agent.plan.execute') {
      failClosed(input, 'Agent Plan 编译只允许 agent.plan.validate 或 agent.plan.execute');
    }
    if (!agentV2ContractTypes.includes(actionType)) {
      failClosed(input, 'Agent Action 不在长期 v2 合同内');
    }

    if (request.token !== undefined || request.policyDecision !== undefined) {
      failClosed(input, '禁止从调用方接收已签发 Token 或 Decision，必须由生产 Policy Authority 接线');
    }

    let plan: AgentPlanV1;
    try {
      plan = validateAgentPlan(request.plan);
    } catch (error) {
      failClosed(input, 'Agent v2 Plan 草案不完整或摘要无效', error);
    }

    if (!plan) failClosed(input, 'Agent v2 Plan 草案缺失');
    const plugin = await this.plugins.getVersion(input.pluginVersionId);
    if (!isUnifiedPluginVersionAccessibleToTenant(plugin, input.tenantId) || plugin.status !== 'ENABLED') {
      throw new AppError('PLUGIN_PERMISSION_DENIED', '固定 PluginVersion 未启用或当前租户不可访问', {
        pluginVersionId: input.pluginVersionId,
      });
    }
    if (plugin.manifest.pluginId !== plan.pluginId) {
      throw new AppError('AGENT_PLUGIN_BINDING_INVALID', 'Agent v2 Plan 与 PluginVersion 身份不一致', {
        pluginId: plan.pluginId,
        pluginVersionId: input.pluginVersionId,
      });
    }
    const authorization = readAuthorizationRequest(request.authorization, input);
    const cacheKey = sha256Digest({
      tenantId: input.tenantId,
      agentId: input.agentId,
      executionRunId: input.executionRunId,
      executionStepId: input.executionStepId,
      pluginVersionId: input.pluginVersionId,
      pluginBindingId: input.pluginBindingId,
      actionType,
      planDigest: plan.planDigest,
      authorization,
    });
    const existing = this.authorizationCache.get(cacheKey);
    if (existing) return structuredClone(await existing);

    const pending = this.issueAndBind(input, actionType, plan, authorization);
    this.authorizationCache.set(cacheKey, pending);
    try {
      return structuredClone(await pending);
    } catch (error) {
      if (this.authorizationCache.get(cacheKey) === pending) this.authorizationCache.delete(cacheKey);
      throw error;
    }
  }

  private async issueAndBind(
    input: {
      tenantId: string;
      agentId: string;
      executionRunId: string;
      executionStepId: string;
      pluginVersionId: string;
      pluginBindingId: string;
    },
    actionType: 'agent.plan.validate' | 'agent.plan.execute',
    plan: AgentPlanV1,
    authorization: AuthorizationRequest,
  ): Promise<AgentV2PlanExecutionEnvelopeV1> {
    const dependencies = this.authorization;
    if (!dependencies) failClosed(input, '生产 Agent Plan 授权依赖未注入');
    try {
      assertDraftBindings(input, plan, authorization);
      dependencies.policyAuthority.assertReady();
      let grant;
      for (const action of authorization.actions) {
        grant = await dependencies.grants.validate({
          grantId: authorization.grantId,
          tenantId: input.tenantId,
          planId: plan.planId,
          runId: input.executionRunId,
          stepId: input.executionStepId,
          executorType: 'AGENT',
          action,
        });
      }
      if (!grant || grant.status !== 'active' || grant.tenantId !== input.tenantId
        || grant.runId !== input.executionRunId || grant.stepId !== input.executionStepId
        || grant.executorType !== 'AGENT') {
        failClosed(input, 'Execution Grant 未绑定当前 Agent Plan 上下文');
      }
      if (authorization.approvalRef !== undefined && grant.approvalId !== authorization.approvalRef) {
        failClosed(input, 'Execution Grant 审批引用与授权请求不一致');
      }
      if (authorization.actions.some((action) => !grant.allowedActions.includes(action))) {
        failClosed(input, 'Execution Grant 未覆盖全部 Agent Plan 操作');
      }

      const localPolicy = validateAgentLocalPolicy(await dependencies.localPolicy.resolve({ agentId: input.agentId, tenantId: input.tenantId }));
      if (localPolicy.agentId !== input.agentId || localPolicy.disabled
        || authorization.actions.some((action) => !localPolicy.allowedActions.includes(action))) {
        failClosed(input, 'Agent 本地策略缺失、禁用或未覆盖全部 Plan 操作');
      }

      const result = await dependencies.policyAuthority.issueAuthorization({
        agentId: input.agentId,
        tenantId: input.tenantId,
        pluginId: plan.pluginId,
        pluginVersionId: input.pluginVersionId,
        capability: plan.capability,
        actions: authorization.actions,
        allowedPaths: authorization.allowedPaths,
        allowedServices: authorization.allowedServices,
        artifactDigests: authorization.artifactDigests,
        policyRef: authorization.policyRef,
        policyVersion: authorization.policyVersion,
        planDigest: plan.planDigest,
        ...(authorization.approvalRef ? { approvalRef: authorization.approvalRef } : {}),
        lifetimeSeconds: authorization.lifetimeSeconds,
      });
      const token = validateAgentCapabilityToken(result.token);
      const policyDecision = validatePolicyAuthorityDecision(result.decision);
      assertAuthorizationResult(input, plan, authorization, token, policyDecision, localPolicy);
      const boundPlan = validateAgentPlan({
        ...plan,
        tokenId: token.tokenId,
        policyDecisionId: policyDecision.decisionId,
        nonce: token.nonce,
        expiresAt: earlierDate(plan.expiresAt, token.expiresAt, policyDecision.validUntil),
      });
      return { actionType, actionSchemaVersion: '1.0', plan: boundPlan, token, policyDecision };
    } catch (error) {
      if (error instanceof AppError && error.errorCode === 'AGENT_AUTHORIZATION_UNAVAILABLE') throw error;
      failClosed(input, 'Agent v2 生产授权签发或绑定失败', error);
    }
  }
}

interface AuthorizationRequest {
  grantId: string;
  policyRef: string;
  policyVersion: string;
  actions: string[];
  allowedPaths: string[];
  allowedServices: string[];
  artifactDigests: string[];
  approvalRef?: string;
  lifetimeSeconds: number;
}

function readAuthorizationRequest(value: unknown, input: { tenantId: string; agentId: string; pluginVersionId: string; pluginBindingId: string }): AuthorizationRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) failClosed(input, '缺少生产授权请求');
  const record = value as Record<string, unknown>;
  const grantId = readRequiredString(record.grantId, 'grantId', input);
  const policyRef = readRequiredString(record.policyRef, 'policyRef', input);
  const policyVersion = readRequiredString(record.policyVersion, 'policyVersion', input);
  const actions = readStringArray(record.actions, 'actions', input, true);
  const allowedPaths = readStringArray(record.allowedPaths, 'allowedPaths', input);
  const allowedServices = readStringArray(record.allowedServices, 'allowedServices', input);
  const artifactDigests = readStringArray(record.artifactDigests, 'artifactDigests', input);
  const lifetimeSeconds = record.lifetimeSeconds;
  if (!Number.isInteger(lifetimeSeconds) || (lifetimeSeconds as number) < 1) failClosed(input, '授权生命周期无效');
  const approvalRef = record.approvalRef === undefined ? undefined : readRequiredString(record.approvalRef, 'approvalRef', input);
  return { grantId, policyRef, policyVersion, actions, allowedPaths, allowedServices, artifactDigests, ...(approvalRef ? { approvalRef } : {}), lifetimeSeconds: lifetimeSeconds as number };
}

function assertAuthorizationResult(
  input: { tenantId: string; agentId: string; pluginVersionId: string; pluginBindingId: string },
  plan: AgentPlanV1,
  request: AuthorizationRequest,
  token: AgentCapabilityTokenV1,
  decision: PolicyAuthorityDecisionV1,
  localPolicy: { authorityKeyIds: string[] },
): void {
  assertBinding('agentId', input.agentId, plan.agentId, token.agentId, decision.agentId);
  assertBinding('tenantId', input.tenantId, plan.tenantId, token.tenantId, decision.tenantId);
  assertBinding('pluginVersionId', input.pluginVersionId, plan.pluginVersionId, token.pluginVersionId, decision.pluginVersionId);
  assertBinding('pluginId', plan.pluginId, token.pluginId, decision.pluginId);
  assertBinding('capability', plan.capability, token.capability, decision.capability);
  assertBinding('planDigest', plan.planDigest, token.planDigest, decision.planDigest);
  if (!decision.allowed || token.policyRef !== request.policyRef || decision.policyRef !== request.policyRef
    || token.policyVersion !== request.policyVersion || decision.policyVersion !== request.policyVersion
    || !sameStringArray(token.actions, request.actions) || !sameStringArray(decision.actions, request.actions)
    || !sameStringArray(token.allowedPaths, request.allowedPaths) || !sameStringArray(decision.allowedPaths, request.allowedPaths)
    || !sameStringArray(token.allowedServices, request.allowedServices) || !sameStringArray(decision.allowedServices, request.allowedServices)
    || !sameStringArray(token.artifactDigests, request.artifactDigests) || !sameStringArray(decision.artifactDigests, request.artifactDigests)
    || token.approvalRef !== request.approvalRef || decision.approvalRef !== request.approvalRef
    || !localPolicy.authorityKeyIds.includes(token.authorityKeyId)) {
    failClosed(input, 'Policy Authority 授权范围、本地信任根或审批引用绑定不一致');
  }
}

function assertDraftBindings(
  input: { tenantId: string; agentId: string; pluginVersionId: string; pluginBindingId: string },
  plan: AgentPlanV1,
  request: AuthorizationRequest,
): void {
  assertBinding('agentId', input.agentId, plan.agentId);
  assertBinding('tenantId', input.tenantId, plan.tenantId);
  assertBinding('pluginVersionId', input.pluginVersionId, plan.pluginVersionId);
  if (plan.approvalRef !== request.approvalRef) failClosed(input, '计划审批引用与授权请求不一致');
  const planActions = [...new Set(plan.operations.map((operation) => operation.operationType))];
  if (!sameStringArray(planActions, request.actions)) failClosed(input, '授权 actions 未固定为计划操作集合');
  for (const operation of plan.operations) {
    const path = typeof operation.input.path === 'string' ? operation.input.path : undefined;
    if (path && !request.allowedPaths.some((prefix) => isPathWithin(path, prefix))) {
      failClosed(input, '授权 allowedPaths 未覆盖计划路径');
    }
    const serviceName = typeof operation.input.serviceName === 'string' ? operation.input.serviceName : undefined;
    if (serviceName && !request.allowedServices.includes(serviceName)) failClosed(input, '授权 allowedServices 未覆盖计划服务');
    const artifactDigest = typeof operation.input.artifactDigest === 'string' ? operation.input.artifactDigest : undefined;
    if (artifactDigest && !request.artifactDigests.includes(artifactDigest)) failClosed(input, '授权 artifactDigests 未覆盖计划 Artifact');
  }
}

function isPathWithin(path: string, prefix: string): boolean {
  const normalizedPath = path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
  const normalizedPrefix = prefix.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
  return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`);
}

function earlierDate(...values: string[]): string {
  const earliest = values.reduce((left, right) => Date.parse(right) < Date.parse(left) ? right : left);
  if (!Number.isFinite(Date.parse(earliest))) throw new Error('授权时间窗无效');
  return earliest;
}

function readRequiredString(value: unknown, field: string, input: { tenantId: string; agentId: string; pluginVersionId: string; pluginBindingId: string }): string {
  if (typeof value !== 'string' || value.trim() === '') failClosed(input, `授权字段 ${field} 缺失`);
  return value;
}

function readStringArray(value: unknown, field: string, input: { tenantId: string; agentId: string; pluginVersionId: string; pluginBindingId: string }, requireNonEmpty = false): string[] {
  if (!Array.isArray(value) || (requireNonEmpty && value.length === 0) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    failClosed(input, `授权字段 ${field} 无效`);
  }
  return [...value as string[]];
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function readActionType(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function assertBinding(field: string, expected: string, ...actual: string[]): void {
  if (actual.some((value) => value !== expected)) {
    throw new AppError('AGENT_AUTHORIZATION_UNAVAILABLE', `Agent v2 授权 ${field} 绑定不一致`, {
      field,
      expected,
      actual,
    });
  }
}

function failClosed(
  input: { tenantId: string; agentId: string; pluginVersionId: string; pluginBindingId: string },
  reason: string,
  cause?: unknown,
): never {
  throw new AppError('AGENT_AUTHORIZATION_UNAVAILABLE', reason, {
    tenantId: input.tenantId,
    agentId: input.agentId,
    pluginVersionId: input.pluginVersionId,
    pluginBindingId: input.pluginBindingId,
    cause: cause instanceof Error ? cause.message : cause === undefined ? undefined : String(cause),
    fallback: false,
  });
}
