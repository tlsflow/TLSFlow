import { AppError } from '../../../common/errors/app-error.js';
import {
  validateAgentLocalPolicy,
  validateAgentPlan,
  type AgentPlanV1,
} from './agent-security.contract.js';
import type {
  PolicyAuthorityProvisioningRequestV1,
  PolicyAuthorityProvisioningResultV1,
} from './policy-authority.service.js';
import { validatePolicyAuthorityProvisioningResultV1 } from './policy-authority.service.js';
import type {
  UnifiedAgentPlanLocalPolicyPortV1,
  UnifiedAgentPlanPolicyAuthorityPortV1,
} from '../../plugins/application/unified-agent-plan-authorization.port.js';

/**
 * 管理面 provisioning 输入。调用方只能提交已经编译的 Agent Plan 和授权范围，
 * Agent 本地策略必须由宿主的受信任适配器解析，不能由 HTTP 请求覆盖。
 */
export interface AgentPlanPolicyProvisioningInputV1 {
  tenantId: string;
  agentId: string;
  pluginId: string;
  pluginVersionId: string;
  capability: string;
  planDigest: string;
  policyRef: string;
  policyVersion: string;
  actions: string[];
  allowedPaths: string[];
  allowedServices: string[];
  commandRules: PolicyAuthorityProvisioningRequestV1['commandRules'];
  artifactDigests: string[];
  approvalRef?: string;
  lifetimeSeconds: number;
  bootstrapLocalPolicy?: boolean;
  compiledPlan: unknown;
}

/**
 * 统一的 Policy Authority provisioning 管理入口。
 * 该服务不编译插件、不读取数据库快照，也不持有签名私钥；签名由 Policy Authority
 * 进程或生产服务完成，返回的两类材料由调用方按下发协议处理。
 */
export class AgentPlanPolicyProvisioningServiceV1 {
  constructor(
    private readonly policyAuthority: UnifiedAgentPlanPolicyAuthorityPortV1,
    private readonly localPolicy: UnifiedAgentPlanLocalPolicyPortV1,
  ) {}

  async provision(input: AgentPlanPolicyProvisioningInputV1): Promise<PolicyAuthorityProvisioningResultV1> {
    if (typeof this.policyAuthority.provisionAgentPlan !== 'function') {
      throw unavailable('当前 Policy Authority 未提供 provisioning 入口');
    }
    this.policyAuthority.assertReady();
    const plan = validateAgentPlan(input.compiledPlan);
    assertPlanIdentity(plan, input);
    const currentLocalPolicy = validateAgentLocalPolicy(
      await this.localPolicy.resolve({ agentId: input.agentId, tenantId: input.tenantId }),
    );
    if (currentLocalPolicy.agentId !== input.agentId) {
      throw unavailable('本地策略 Agent 身份与 provisioning 请求不匹配');
    }

    const request: PolicyAuthorityProvisioningRequestV1 = {
      tenantId: input.tenantId,
      agentId: input.agentId,
      pluginId: input.pluginId,
      pluginVersionId: input.pluginVersionId,
      capability: input.capability,
      planDigest: input.planDigest,
      policyRef: input.policyRef,
      policyVersion: input.policyVersion,
      actions: [...input.actions],
      allowedPaths: [...input.allowedPaths],
      allowedServices: [...input.allowedServices],
      commandRules: structuredClone(input.commandRules),
      artifactDigests: [...input.artifactDigests],
      ...(input.approvalRef === undefined ? {} : { approvalRef: input.approvalRef }),
      lifetimeSeconds: input.lifetimeSeconds,
      ...(input.bootstrapLocalPolicy ? { bootstrapLocalPolicy: true } : {}),
      currentLocalPolicy,
      compiledPlan: plan,
    };
    const result = validatePolicyAuthorityProvisioningResultV1(
      await this.policyAuthority.provisionAgentPlan(request),
    );
    assertArtifactIsolation(result, input.artifactDigests);
    return result;
  }
}

function assertPlanIdentity(plan: AgentPlanV1, input: AgentPlanPolicyProvisioningInputV1): void {
  const mismatches: string[] = [];
  if (plan.agentId !== input.agentId) mismatches.push('agentId');
  if (plan.tenantId !== input.tenantId) mismatches.push('tenantId');
  if (plan.pluginId !== input.pluginId) mismatches.push('pluginId');
  if (plan.pluginVersionId !== input.pluginVersionId) mismatches.push('pluginVersionId');
  if (plan.capability !== input.capability) mismatches.push('capability');
  if (plan.planDigest !== input.planDigest) mismatches.push('planDigest');
  if (mismatches.length > 0) throw unavailable(`已编译 Agent Plan 身份不匹配：${mismatches.join(',')}`);
}

function assertArtifactIsolation(
  result: PolicyAuthorityProvisioningResultV1,
  artifactDigests: readonly string[],
): void {
  const localPolicyText = JSON.stringify(result.localPolicyMaterial.localPolicy);
  if (artifactDigests.some((digest) => localPolicyText.includes(digest))) {
    throw unavailable('Agent 本地策略材料包含禁止下发的 Artifact 摘要');
  }
}

function unavailable(message: string): AppError {
  return new AppError('AGENT_AUTHORIZATION_UNAVAILABLE', `Policy Authority provisioning 已失败关闭：${message}`, { fallback: false });
}
