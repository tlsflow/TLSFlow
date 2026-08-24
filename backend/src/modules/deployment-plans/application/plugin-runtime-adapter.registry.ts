import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { ResolvedManagedTargetContext } from '../../assets/application/managed-target-context.resolver.js';
import type { ServiceAssetDto } from '../../assets/dto/assets.dto.js';
import type { ResolvedDeploymentInputV1 } from '../../deployment-inputs/dto/resolved-deployment-input.dto.js';
import type { ResolvedDeploymentCapability } from '../../plugins/application/deployment-capability.resolver.js';
import { buildCertificateVerificationTarget } from './certificate-verification-target.js';
import { computeAgentPlanDigest, type AgentPlanV1 } from '../../agents/security/agent-security.contract.js';
import { validateCertificateUpdateInputContract } from '../../deployment-inputs/certificate-update/certificate-update.contract.js';
import { resolveCertificateUpdateSnapshot } from '../../deployment-inputs/certificate-update/certificate-update-input.service.js';
import { compileCertificateUpdatePlanTemplate } from '../../deployment-inputs/certificate-update/certificate-update-plan.service.js';

export interface RuntimeCompileInput {
  tenantId?: string;
  capability: ResolvedDeploymentCapability;
  context: ResolvedManagedTargetContext;
  applicationAsset: Pick<ServiceAssetDto, 'id' | 'address' | 'sniName' | 'port' | 'protocol' | 'displayName' | 'verifyUrl'>;
  resolvedInput: ResolvedDeploymentInputV1;
  certificateBindingId?: string;
  workflow?: {
    workflowId: string;
    workflowVersionId: string;
    executionMode?: 'PLUGIN_RUNNER';
  };
}

export interface RuntimeExecutionRequest {
  executorType: 'AGENT' | 'WORKFLOW' | 'PLUGIN_RUNNER';
  executionTargetId: string;
  requiredCapabilities: string[];
  gatewayRoute?: {
    gatewayId?: string;
    adapter: 'relay.tcp';
    delegatedTargetId: string;
  };
  payload: Record<string, unknown>;
}

function hostCertificateVerification(input: RuntimeCompileInput): Record<string, unknown> {
  return buildCertificateVerificationTarget({
    applicationAsset: input.applicationAsset,
    managedTargetContext: input.context,
    sourceLabel: 'MANAGED_HOST',
  });
}

export interface PluginRuntimeAdapter {
  readonly runtime: ResolvedDeploymentCapability['pluginRuntime'];
  supports(capability: ResolvedDeploymentCapability): boolean;
  compile(input: RuntimeCompileInput): Promise<RuntimeExecutionRequest>;
}

export class PluginRuntimeAdapterRegistry {
  private readonly adapters = new Map<ResolvedDeploymentCapability['pluginRuntime'], PluginRuntimeAdapter>();

  register(adapter: PluginRuntimeAdapter): this {
    if (this.adapters.has(adapter.runtime)) throw new AppError('SYSTEM_INTERNAL_ERROR', '重复注册插件 Runtime Adapter', { runtime: adapter.runtime });
    this.adapters.set(adapter.runtime, adapter);
    return this;
  }

  async compile(input: RuntimeCompileInput): Promise<RuntimeExecutionRequest> {
    const adapter = this.adapters.get(input.capability.pluginRuntime);
    if (!adapter || !adapter.supports(input.capability)) {
      throw new AppError('CAPABILITY_MISSING', '没有可用的插件 Runtime Adapter', { runtime: input.capability.pluginRuntime });
    }
    return adapter.compile(input);
  }
}

export class WorkflowDslRuntimeAdapter implements PluginRuntimeAdapter {
  readonly runtime = 'WORKFLOW_DSL' as const;

  supports(capability: ResolvedDeploymentCapability): boolean {
    return capability.pluginRuntime === this.runtime
      && (capability.executionLocation !== 'AGENT'
        || Boolean(capability.plugin.manifest.resources.agentPlans?.[capability.assignment.capabilityKey]));
  }

  async compile(input: RuntimeCompileInput): Promise<RuntimeExecutionRequest> {
    const agentPlanPath = input.capability.plugin.manifest.resources.agentPlans?.[input.capability.assignment.capabilityKey];
    if (input.capability.executionLocation === 'AGENT' && agentPlanPath) {
      return this.compileAgentPlanResource(input, agentPlanPath);
    }
    if (input.capability.executionLocation === 'AGENT') {
      throw new AppError('CAPABILITY_MISSING', 'Agent 执行位置缺少 Agent Plan 资源');
    }
    if (!input.workflow) throw new AppError('SYSTEM_INTERNAL_ERROR', 'Workflow DSL Runtime 缺少已发布工作流快照');
    if (input.workflow.executionMode === 'PLUGIN_RUNNER') {
      throw new AppError('VALIDATION_FAILED', '包级 PLUGIN_RUNNER Workflow 请求已禁止，Runner 只能由 plugin.action 步骤调用', {
        workflowVersionId: input.workflow.workflowVersionId,
        executionMode: input.workflow.executionMode,
      });
    }
    if (input.capability.executionLocation === 'GATEWAY') {
      throw new AppError('VALIDATION_FAILED', 'Gateway 仅支持鉴权后的 TCP Relay，不能作为 Workflow 或业务插件执行位置', {
        reason: 'GATEWAY_RELAY_ONLY',
        managedTargetId: input.context.managedTarget.id,
      });
    }
    return {
      executorType: 'WORKFLOW',
      executionTargetId: input.context.managedTarget.id,
      requiredCapabilities: ['workflow.run'],
      gatewayRoute: undefined,
      payload: {
        pluginRuntimeCapability: immutableCapabilitySnapshot(input.capability),
        certificateVerification: hostCertificateVerification(input),
        resolvedDeploymentInput: input.resolvedInput,
        workflowRequest: {
          workflowId: input.workflow.workflowId,
          workflowVersionSelection: 'FIXED',
          workflowVersionId: input.workflow.workflowVersionId,
          runner: 'CONTROL_PLANE',
          gatewayId: undefined,
          pluginVersionId: input.capability.pluginVersionId,
          pluginBindingId: input.capability.binding.id,
          capabilityKey: input.capability.assignment.capabilityKey,
          applicationAssetId: input.applicationAsset.id,
          certificateBindingId: input.certificateBindingId,
          managedTargetId: input.context.managedTarget.id,
          siteAssetId: input.context.siteAsset?.id,
        },
      },
    };
  }

  private compileAgentPlanResource(input: RuntimeCompileInput, templatePath: string): RuntimeExecutionRequest {
    const agentId = input.context.agent?.id;
    const tenantId = input.tenantId;
    if (!agentId || !tenantId) throw new AppError('CAPABILITY_MISSING', 'Agent Plan Runtime 缺少 Agent 或租户上下文');
    const contractPath = input.capability.plugin.manifest.resources.inputContracts?.[input.capability.assignment.capabilityKey];
    const contractText = contractPath ? input.capability.plugin.resources[contractPath] : undefined;
    const templateText = input.capability.plugin.resources[templatePath];
    if (!contractText || !templateText) throw new AppError('CAPABILITY_MISSING', '双资源插件缺少输入合同或 Agent Plan 模板');
    let contract: unknown;
    try {
      contract = JSON.parse(contractText);
    } catch (error) {
      throw new AppError('VALIDATION_FAILED', '证书更新输入合同不是有效 JSON', { cause: error instanceof Error ? error.message : String(error) });
    }
    const certificateContract = validateCertificateUpdateInputContract(contract);
    if (certificateContract.pluginId !== input.capability.plugin.manifest.pluginId) {
      throw new AppError('VALIDATION_FAILED', '证书更新输入合同与 PluginVersion 身份不一致');
    }
    const resourceHash = resourceAggregateHash(input.capability.plugin.resourceSha256);
    const snapshot = resolveCertificateUpdateSnapshot(input.resolvedInput, certificateContract, {
      pluginVersionId: input.capability.pluginVersionId,
      resourceHash,
    });
    const compiled = compileCertificateUpdatePlanTemplate({
      templateText,
      snapshot,
      resolvedInput: input.resolvedInput,
      pluginVersionId: input.capability.pluginVersionId,
      agentId,
      tenantId,
      workflowVersionId: input.workflow?.workflowVersionId,
      resourceHash,
    });
    return {
      executorType: 'AGENT',
      executionTargetId: agentId,
      requiredCapabilities: ['agent.plan.execute'],
      payload: {
        pluginRuntimeCapability: immutableCapabilitySnapshot(input.capability),
        certificateVerification: hostCertificateVerification(input),
        resolvedDeploymentInput: input.resolvedInput,
        certificateUpdateSnapshot: snapshot,
        actionType: 'agent.plan.execute',
        plan: compiled.plan,
        executionAuthorization: compiled.authorization,
        workflowRequest: input.workflow ? {
          workflowId: input.workflow.workflowId,
          workflowVersionSelection: 'FIXED',
          workflowVersionId: input.workflow.workflowVersionId,
          pluginVersionId: input.capability.pluginVersionId,
          pluginBindingId: input.capability.binding.id,
          capabilityKey: input.capability.assignment.capabilityKey,
          executionLocation: 'AGENT',
        } : undefined,
      },
    };
  }
}

export class AgentPlanRuntimeAdapter implements PluginRuntimeAdapter {
  readonly runtime = 'AGENT_PLAN' as const;

  supports(capability: ResolvedDeploymentCapability): boolean {
    return capability.pluginRuntime === this.runtime && capability.executionLocation === 'AGENT';
  }

  async compile(input: RuntimeCompileInput): Promise<RuntimeExecutionRequest> {
    const agentId = input.context.agent?.id;
    const tenantId = input.tenantId;
    if (!agentId || !tenantId) throw new AppError('CAPABILITY_MISSING', 'Agent Plan Runtime 缺少 Agent 或租户上下文');
    const templatePath = input.capability.plugin.manifest.resources.agentPlans?.[input.capability.assignment.capabilityKey];
    const templateText = templatePath ? input.capability.plugin.resources[templatePath] : undefined;
    if (!templateText) throw new AppError('CAPABILITY_MISSING', 'Agent Plan 插件缺少计划模板');
    const template = JSON.parse(templateText) as { plan: Omit<AgentPlanV1, 'agentId' | 'tenantId' | 'pluginVersionId' | 'planDigest' | 'tokenId' | 'policyDecisionId' | 'nonce' | 'expiresAt'>; authorization: Record<string, unknown> };
    const planBase = {
      ...template.plan,
      agentId,
      tenantId,
      pluginVersionId: input.capability.pluginVersionId,
      tokenId: 'draft-token',
      policyDecisionId: 'draft-decision',
      nonce: 'draft-nonce',
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      planDigest: '',
    } as AgentPlanV1;
    planBase.planDigest = computeAgentPlanDigest(planBase);
    return {
      executorType: 'AGENT',
      executionTargetId: agentId,
      requiredCapabilities: ['agent.plan.execute'],
      payload: {
        pluginRuntimeCapability: immutableCapabilitySnapshot(input.capability),
        certificateVerification: hostCertificateVerification(input),
        resolvedDeploymentInput: input.resolvedInput,
        actionType: 'agent.plan.execute',
        plan: planBase,
        executionAuthorization: template.authorization,
      },
    };
  }
}

export function createDefaultPluginRuntimeAdapterRegistry(): PluginRuntimeAdapterRegistry {
  return new PluginRuntimeAdapterRegistry()
    .register(new AgentPlanRuntimeAdapter())
    .register(new WorkflowDslRuntimeAdapter());
}

function immutableCapabilitySnapshot(capability: ResolvedDeploymentCapability) {
  return {
    assignmentId: capability.assignment.id,
    assignmentOwnerType: capability.assignment.ownerType,
    assignmentOwnerId: capability.assignment.ownerId,
    assignmentPrecedence: capability.assignment.precedence,
    pluginId: capability.plugin.manifest.pluginId,
    pluginVersionId: capability.pluginVersionId,
    pluginVersion: capability.plugin.manifest.version,
    pluginBindingId: capability.binding.id,
    pluginBindingVersion: capability.binding.version,
    runtime: capability.pluginRuntime,
    executionLocation: capability.executionLocation,
    capabilityKey: capability.assignment.capabilityKey,
    packageSha256: capability.plugin.packageSha256,
    manifestSha256: capability.plugin.manifestSha256,
    resourceSha256: structuredClone(capability.plugin.resourceSha256),
    resourceHash: resourceAggregateHash(capability.plugin.resourceSha256),
  };
}

function resourceAggregateHash(resourceHashes: Record<string, string>): string {
  const ordered = Object.fromEntries(
    Object.entries(resourceHashes).sort(([left], [right]) => left.localeCompare(right)),
  );
  return `sha256:${createHash('sha256').update(JSON.stringify(ordered), 'utf8').digest('hex')}`;
}
