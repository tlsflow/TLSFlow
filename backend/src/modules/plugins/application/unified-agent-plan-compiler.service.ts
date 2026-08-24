import { AppError } from '../../../common/errors/app-error.js';
import { posix, win32 } from 'node:path';
import {
  agentV2ContractTypes,
  sha256Digest,
  validateAgentCapabilityToken,
  validateAgentLocalPolicy,
  validateAgentPlan,
  computeAgentPlanDigest,
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
import type { AgentLocalCommandRuleV1 } from '../../agents/security/agent-security.contract.js';
import type {
  PolicyAuthorityProvisioningRequestV1,
  SignedAgentLocalPolicyMaterialV1,
} from '../../agents/security/policy-authority.service.js';
import type {
  UnifiedAgentPlanAuthorizationDependenciesV1,
} from './unified-agent-plan-authorization.port.js';
import { certificateUpdatePluginIds } from '../canonical-plugin-id/canonical-plugin-id.registry.js';
import { canonicalResourceHash } from '../../../shared/plugin-resource-hash.js';
import { validateCertificateUpdateInputContract } from '../../deployment-inputs/certificate-update/certificate-update.contract.js';
import { resolveCertificateUpdateSnapshot, assertCertificateUpdatePlanBinding } from '../../deployment-inputs/certificate-update/certificate-update-input.service.js';
import { bindCertificateUpdatePlanArtifacts } from '../../deployment-inputs/certificate-update/certificate-update-plan.service.js';

export interface AgentV2PlanExecutionEnvelopeV1 {
  actionType: 'agent.plan.validate' | 'agent.plan.execute';
  actionSchemaVersion: '1.0';
  plan: AgentPlanV1;
  token: AgentCapabilityTokenV1;
  policyDecision: PolicyAuthorityDecisionV1;
  /** Policy Authority 签发的稳定 Agent 能力材料；只含本地上限，不含 Artifact 摘要。 */
  localPolicyMaterial?: SignedAgentLocalPolicyMaterialV1;
  /** 宿主本地策略状态只作为诊断返回，不改变 Agent 端失败关闭边界。 */
  diagnostics?: string[];
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
    resolvedInput?: ResolvedDeploymentInputV1;
    /** 根证书安装使用宿主通用合同，不读取证书部署 Artifact。 */
    purpose?: 'deployment' | 'certificate_trust';
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
    if (input.purpose !== 'certificate_trust' && certificateUpdatePluginIds.includes(plan.pluginId as never)) {
      if (!input.resolvedInput) failClosed(input, '证书更新插件缺少统一部署输入快照');
      const contractPath = plugin.manifest.resources.inputContracts?.[plan.capability];
      const contractText = contractPath ? plugin.resources[contractPath] : undefined;
      if (!contractText) failClosed(input, '证书更新插件缺少固定输入合同资源');
      let rawContract: unknown;
      try {
        rawContract = JSON.parse(contractText);
      } catch (error) {
        failClosed(input, '证书更新输入合同 JSON 无效', error);
      }
      const contract = validateCertificateUpdateInputContract(rawContract);
      if (contract.pluginId !== plan.pluginId) failClosed(input, '证书更新输入合同与计划 Plugin ID 不一致');
      const snapshot = resolveCertificateUpdateSnapshot(input.resolvedInput, contract, {
        pluginVersionId: input.pluginVersionId,
        resourceHash: canonicalResourceHash(plugin.resourceSha256),
      });
      // 历史草案可能只保存了 Artifact 摘要；执行前重新从密封输入绑定实际字节，
      // 并用绑定后的完整计划重新计算摘要，确保授权范围覆盖真实写入内容。
      plan = bindCertificateUpdatePlanArtifacts(plan, snapshot, input.resolvedInput);
      assertCertificateUpdatePlanBinding(plan, snapshot);
      if (actionType === 'agent.plan.execute' && !plan.writeEffect) failClosed(input, 'Apply 计划必须声明 writeEffect=true');
      if (actionType === 'agent.plan.validate' && plan.writeEffect) {
        // dry-run 复用同一份计划结构，但明确把副作用标志切换为 false，
        // Agent 只能执行 validate，不得把预演误当成写操作。
        plan = { ...plan, writeEffect: false, planDigest: '' };
        plan.planDigest = computeAgentPlanDigest(plan);
      }
    }
    const authorization = readAuthorizationRequest(request.authorization, input);
    // commandRules 的唯一事实来源是已验证的 Plan 操作。旧执行快照可能没有该字段，
    // 或仍保留旧版参数模板；继续沿用它会让 PA 在 provisioning 阶段正确拒绝当前命令。
    // 从 Plan 重新投影只会覆盖实际存在的 command.execute_allowlisted 操作，不会扩大权限。
    authorization.commandRules = deriveCommandRulesFromPlan(plan, input);
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

      const diagnostics: string[] = [];
      let localPolicy: ReturnType<typeof validateAgentLocalPolicy> | undefined;
      if (!dependencies.localPolicy) {
        diagnostics.push('宿主未注入本地策略来源；交由 Agent 端失败关闭校验');
      } else {
        try {
          localPolicy = validateAgentLocalPolicy(await dependencies.localPolicy.resolve({ agentId: input.agentId, tenantId: input.tenantId }));
          if (localPolicy.agentId !== input.agentId) diagnostics.push('宿主本地策略 Agent 身份不匹配');
          if (localPolicy.disabled) diagnostics.push('宿主本地策略已禁用');
          if (authorization.actions.some((action) => !localPolicy!.allowedActions.includes(action))) diagnostics.push('宿主本地策略未覆盖全部 Plan 操作');
        } catch (error) {
          diagnostics.push(`宿主本地策略诊断失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // 生产 PA 已提供 provisioning 时，由统一编译链自动完成授权规则装配；
      // 首次装配没有宿主 localPolicy 时，使用当前已编译 Plan 生成不含 Artifact 摘要的
      // 能力上限候选，交给 PA 签名。已有 localPolicy 仍按严格上限校验。
      let localPolicyMaterial: SignedAgentLocalPolicyMaterialV1 | undefined;
      if (typeof dependencies.policyAuthority.provisionAgentPlan === 'function') {
        const localPolicyCoversPlan = localPolicy !== undefined && localPolicyCoversAuthorization(localPolicy, authorization);
        const provisioningLocalPolicy = localPolicyCoversPlan && localPolicy
          ? localPolicy
          : createBootstrapLocalPolicy(plan, authorization, input.agentId);
        const provisioning = await dependencies.policyAuthority.provisionAgentPlan({
          tenantId: input.tenantId,
          agentId: input.agentId,
          pluginId: plan.pluginId,
          pluginVersionId: plan.pluginVersionId,
          capability: plan.capability,
          planDigest: plan.planDigest,
          policyRef: authorization.policyRef,
          policyVersion: authorization.policyVersion,
          actions: [...authorization.actions],
          allowedPaths: [...authorization.allowedPaths],
          allowedServices: [...authorization.allowedServices],
          commandRules: [...authorization.commandRules],
          artifactDigests: [...authorization.artifactDigests],
          ...(authorization.approvalRef ? { approvalRef: authorization.approvalRef } : {}),
          lifetimeSeconds: authorization.lifetimeSeconds,
          ...(!localPolicyCoversPlan ? { bootstrapLocalPolicy: true } : {}),
          currentLocalPolicy: provisioningLocalPolicy,
          compiledPlan: plan,
        } satisfies PolicyAuthorityProvisioningRequestV1);
        localPolicyMaterial = provisioning.localPolicyMaterial;
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
      const policyDecision = validatePolicyAuthorityDecision(result.decision);
      // Policy Authority 的拒绝结果按合同可以不带 Token；先核验 Decision，避免把策略拒绝误报成 Token 合同错误。
      if (!policyDecision.allowed) {
        throw new AppError('AGENT_AUTHORIZATION_UNAVAILABLE', 'Policy Authority 拒绝 Agent v2 生产授权', {
          tenantId: input.tenantId,
          agentId: input.agentId,
          pluginVersionId: input.pluginVersionId,
          pluginBindingId: input.pluginBindingId,
          policyRef: authorization.policyRef,
          policyVersion: authorization.policyVersion,
          reason: policyDecision.reason ?? 'Policy Authority 未提供拒绝原因',
          fallback: false,
        });
      }
      if (!result.token) failClosed(input, 'Policy Authority 允许授权但未签发 Agent Capability Token');
      const token = validateAgentCapabilityToken(result.token);
      assertAuthorizationResult(input, plan, authorization, token, policyDecision);
      const boundPlan = validateAgentPlan({
        ...plan,
        tokenId: token.tokenId,
        policyDecisionId: policyDecision.decisionId,
        nonce: token.nonce,
        expiresAt: earlierDate(plan.expiresAt, token.expiresAt, policyDecision.validUntil),
      });
      return {
        actionType,
        actionSchemaVersion: '1.0',
        plan: boundPlan,
        token,
        policyDecision,
        ...(localPolicyMaterial ? { localPolicyMaterial } : {}),
        ...(diagnostics.length > 0 ? { diagnostics } : {}),
      };
    } catch (error) {
      if (error instanceof AppError && error.errorCode === 'AGENT_AUTHORIZATION_UNAVAILABLE') throw error;
      failClosed(input, 'Agent v2 生产授权签发或绑定失败', error);
    }
  }
}

function localPolicyCoversAuthorization(
  localPolicy: ReturnType<typeof validateAgentLocalPolicy>,
  authorization: AuthorizationRequest,
): boolean {
  if (localPolicy.disabled || authorization.actions.some((action) => !localPolicy.allowedActions.includes(action))) return false;
  if (authorization.allowedServices.some((service) => !localPolicy.serviceRules.includes(service))) return false;
  for (const path of authorization.allowedPaths) {
    const covering = localPolicy.pathRules.filter((rule) => isPathWithin(path, rule.prefix));
    if (covering.length === 0 || authorization.actions.some((action) => action.startsWith('filesystem.')
      && !covering.some((rule) => rule.operations.includes(action)))) return false;
  }
  return authorization.commandRules.every((command) => localPolicy.commandRules.some((candidate) => sha256Digest(candidate) === sha256Digest(command)));
}

function createBootstrapLocalPolicy(
  plan: AgentPlanV1,
  authorization: AuthorizationRequest,
  agentId: string,
): ReturnType<typeof validateAgentLocalPolicy> {
  const operations = [...authorization.actions];
  return validateAgentLocalPolicy({
    policyVersion: 'gcac.agent-security/v1',
    agentId,
    authorityKeyIds: ['bootstrap-pending'],
    allowedActions: [...authorization.actions],
    pathRules: [...authorization.allowedPaths].map((prefix) => ({ prefix, operations })),
    serviceRules: [...authorization.allowedServices],
    commandRules: structuredClone(authorization.commandRules),
    disabled: false,
    updatedAt: plan.expiresAt,
  });
}

interface AuthorizationRequest {
  grantId: string;
  policyRef: string;
  policyVersion: string;
  actions: string[];
  allowedPaths: string[];
  allowedServices: string[];
  commandRules: AgentLocalCommandRuleV1[];
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
  const commandRules = readCommandRules(record.commandRules, input);
  const artifactDigests = readStringArray(record.artifactDigests, 'artifactDigests', input);
  const lifetimeSeconds = record.lifetimeSeconds;
  if (!Number.isInteger(lifetimeSeconds) || (lifetimeSeconds as number) < 1) failClosed(input, '授权生命周期无效');
  const approvalRef = record.approvalRef === undefined ? undefined : readRequiredString(record.approvalRef, 'approvalRef', input);
  return { grantId, policyRef, policyVersion, actions, allowedPaths, allowedServices, commandRules, artifactDigests, ...(approvalRef ? { approvalRef } : {}), lifetimeSeconds: lifetimeSeconds as number };
}

function readCommandRules(value: unknown, input: { tenantId: string; agentId: string; pluginVersionId: string; pluginBindingId: string }): AgentLocalCommandRuleV1[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) failClosed(input, '授权 commandRules 必须是数组');
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) failClosed(input, `授权 commandRules.${index} 必须是对象`);
    const rule = item as Record<string, unknown>;
    const strings = (field: string): string[] => {
      const values = rule[field];
      if (!Array.isArray(values) || values.some((entry) => typeof entry !== 'string')) failClosed(input, `授权 commandRules.${index}.${field} 无效`);
      return [...values as string[]];
    };
    if (typeof rule.executablePath !== 'string' || typeof rule.executableSha256 !== 'string'
      || typeof rule.workingDirectory !== 'string' || (rule.childProcessPolicy !== 'deny' && rule.childProcessPolicy !== 'allow-listed')
      || !Number.isInteger(rule.timeoutSeconds) || !Number.isInteger(rule.outputLimitBytes)) {
      failClosed(input, `授权 commandRules.${index} 字段无效`);
    }
    return {
      executablePath: rule.executablePath,
      executableSha256: rule.executableSha256,
      argumentTemplate: strings('argumentTemplate'),
      environmentAllowlist: strings('environmentAllowlist'),
      workingDirectory: rule.workingDirectory,
      networkScopes: strings('networkScopes'),
      childProcessPolicy: rule.childProcessPolicy,
      timeoutSeconds: rule.timeoutSeconds as number,
      outputLimitBytes: rule.outputLimitBytes as number,
    } satisfies AgentLocalCommandRuleV1;
  });
}

function deriveCommandRulesFromPlan(
  plan: AgentPlanV1,
  input: { tenantId: string; agentId: string; pluginVersionId: string; pluginBindingId: string },
): AgentLocalCommandRuleV1[] {
  const commandInputs = plan.operations
    .filter((operation) => operation.operationType === 'command.execute_allowlisted')
    .map((operation) => operation.input);
  // 复用同一套字段校验，确保派生规则与外部授权规则遵循完全相同的合同。
  return readCommandRules(commandInputs, input).filter((rule, index, rules) => {
    const digest = sha256Digest(rule);
    return rules.findIndex((candidate) => sha256Digest(candidate) === digest) === index;
  });
}

function assertAuthorizationResult(
  input: { tenantId: string; agentId: string; pluginVersionId: string; pluginBindingId: string },
  plan: AgentPlanV1,
  request: AuthorizationRequest,
  token: AgentCapabilityTokenV1,
  decision: PolicyAuthorityDecisionV1,
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
    || !samePathArray(token.allowedPaths, request.allowedPaths) || !samePathArray(decision.allowedPaths, request.allowedPaths)
    || !sameStringArray(token.allowedServices, request.allowedServices) || !sameStringArray(decision.allowedServices, request.allowedServices)
    || !sameStringArray(token.artifactDigests, request.artifactDigests) || !sameStringArray(decision.artifactDigests, request.artifactDigests)
    || token.approvalRef !== request.approvalRef || decision.approvalRef !== request.approvalRef) {
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
    if (operation.operationType === 'command.execute_allowlisted') {
      const executablePath = typeof operation.input.executablePath === 'string' ? operation.input.executablePath : undefined;
      const workingDirectory = typeof operation.input.workingDirectory === 'string' ? operation.input.workingDirectory : undefined;
      const executableSha256 = typeof operation.input.executableSha256 === 'string' ? operation.input.executableSha256 : undefined;
      if (!executablePath || !request.allowedPaths.some((prefix) => isPathWithin(executablePath, prefix))) {
        failClosed(input, '授权 allowedPaths 未覆盖配置检查程序路径');
      }
      if (!workingDirectory || !request.allowedPaths.some((prefix) => isPathWithin(workingDirectory, prefix))) {
        failClosed(input, '授权 allowedPaths 未覆盖配置检查工作目录');
      }
      if (!executableSha256 || !request.artifactDigests.includes(executableSha256)) {
        failClosed(input, '授权 artifactDigests 未覆盖配置检查程序摘要');
      }
    }
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

/** Token/Decision 合同会规范化 Windows 路径分隔符；比较前统一到同一规范，避免 C:/ 与 C:\\ 被误判为不同授权。 */
function samePathArray(left: readonly string[], right: readonly string[]): boolean {
  return sameStringArray(left.map(normalizeComparablePath), right.map(normalizeComparablePath));
}

function normalizeComparablePath(value: string): string {
  if (value.startsWith('/')) return posix.normalize(value);
  return win32.normalize(value.replaceAll('/', '\\'));
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
