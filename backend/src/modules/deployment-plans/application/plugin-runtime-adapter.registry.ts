import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { ResolvedManagedTargetContext } from '../../assets/application/managed-target-context.resolver.js';
import type { ServiceAssetDto } from '../../assets/dto/assets.dto.js';
import type { ResolvedDeploymentInputV1 } from '../../deployment-inputs/dto/resolved-deployment-input.dto.js';
import type { ResolvedDeploymentCapability } from '../../plugins/application/deployment-capability.resolver.js';
import { buildCertificateVerificationTarget } from './certificate-verification-target.js';
import { computeAgentPlanDigest, type AgentPlanV1 } from '../../agents/security/agent-security.contract.js';

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
  };
}

export interface RuntimeExecutionRequest {
  executorType: 'AGENT' | 'WORKFLOW' | 'TRUSTED_JS';
  executionTargetId: string;
  requiredCapabilities: string[];
  gatewayRoute?: {
    gatewayId?: string;
    adapter: 'curl';
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
    return capability.pluginRuntime === this.runtime && capability.executionLocation !== 'AGENT';
  }

  async compile(input: RuntimeCompileInput): Promise<RuntimeExecutionRequest> {
    if (!input.workflow) throw new AppError('SYSTEM_INTERNAL_ERROR', 'Workflow DSL Runtime 缺少已发布工作流快照');
    const gatewayId = input.capability.executionLocation === 'GATEWAY' ? input.context.deviceAsset?.gatewayId : undefined;
    if (input.capability.executionLocation === 'GATEWAY' && !gatewayId) {
      throw new AppError('CAPABILITY_MISSING', 'Workflow DSL Runtime 缺少 Gateway 连接', { managedTargetId: input.context.managedTarget.id });
    }
    return {
      executorType: 'WORKFLOW',
      executionTargetId: input.context.managedTarget.id,
      requiredCapabilities: gatewayId ? ['workflow.run', 'gateway.dispatch'] : ['workflow.run'],
      gatewayRoute: gatewayId ? { gatewayId, adapter: 'curl', delegatedTargetId: input.context.managedTarget.id } : undefined,
      payload: {
        pluginRuntimeCapability: immutableCapabilitySnapshot(input.capability),
        certificateVerification: hostCertificateVerification(input),
        resolvedDeploymentInput: input.resolvedInput,
        workflowRequest: {
          workflowId: input.workflow.workflowId,
          workflowVersionSelection: 'PINNED',
          workflowVersionId: input.workflow.workflowVersionId,
          runner: gatewayId ? 'GATEWAY' : 'CONTROL_PLANE',
          gatewayId,
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
}

export class TrustedJsRuntimeAdapter implements PluginRuntimeAdapter {
  readonly runtime = 'TRUSTED_JS' as const;

  supports(capability: ResolvedDeploymentCapability): boolean {
    return capability.pluginRuntime === this.runtime;
  }

  async compile(input: RuntimeCompileInput): Promise<RuntimeExecutionRequest> {
    const cloudAccountAssetId = input.context.managedTarget.assetId;
    if (!cloudAccountAssetId) {
      throw new AppError('CAPABILITY_MISSING', 'TRUSTED_JS Runtime 缺少云账号资产引用', {
        pluginVersionId: input.capability.pluginVersionId,
        capabilityKey: input.capability.assignment.capabilityKey,
        managedTargetId: input.context.managedTarget.id,
      });
    }
    return {
      executorType: 'TRUSTED_JS',
      executionTargetId: input.context.managedTarget.id,
      requiredCapabilities: [input.capability.assignment.capabilityKey],
      payload: {
        pluginRuntimeCapability: immutableCapabilitySnapshot(input.capability),
        certificateVerification: hostCertificateVerification(input),
        resolvedDeploymentInput: input.resolvedInput,
        trustedJsRequest: {
          cloudAccountAssetId,
          target: buildTrustedJsTarget(input),
        },
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
    .register(new WorkflowDslRuntimeAdapter())
    .register(new TrustedJsRuntimeAdapter());
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
  const entries = Object.entries(resourceHashes).sort(([left], [right]) => left.localeCompare(right));
  return `sha256:${createHash('sha256').update(JSON.stringify(entries), 'utf8').digest('hex')}`;
}

function buildTrustedJsTarget(input: RuntimeCompileInput): Record<string, unknown> {
  const domain = input.context.siteAsset?.hostHeader
    ?? input.applicationAsset.sniName
    ?? input.applicationAsset.address;
  const metadata = structuredClone(input.context.managedTarget.metadata ?? {});
  return {
    resourceId: input.context.managedTarget.targetKey,
    ...(domain ? { domain } : {}),
    ...(typeof input.context.managedTarget.metadata.listenerId === 'string'
      ? { listenerId: input.context.managedTarget.metadata.listenerId }
      : {}),
    metadata,
  };
}
