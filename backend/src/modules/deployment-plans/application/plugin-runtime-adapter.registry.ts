import { AppError } from '../../../common/errors/app-error.js';
import type { ResolvedManagedTargetContext } from '../../assets/application/managed-target-context.resolver.js';
import type { ServiceAssetDto } from '../../assets/dto/assets.dto.js';
import type { ResolvedDeploymentInputV1 } from '../../deployment-inputs/dto/resolved-deployment-input.dto.js';
import type { ResolvedDeploymentCapability } from '../../plugins/application/deployment-capability.resolver.js';
import { buildCertificateVerificationTarget } from './certificate-verification-target.js';

export interface RuntimeCompileInput {
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

export class AgentAtomicRuntimeAdapter implements PluginRuntimeAdapter {
  readonly runtime = 'AGENT_ATOMIC' as const;

  supports(capability: ResolvedDeploymentCapability): boolean {
    return capability.pluginRuntime === this.runtime && capability.executionLocation === 'AGENT';
  }

  async compile(input: RuntimeCompileInput): Promise<RuntimeExecutionRequest> {
    const agentId = input.context.agent?.id;
    if (!agentId) throw new AppError('CAPABILITY_MISSING', 'Agent Atomic Runtime 缺少可用 Agent 连接', { managedTargetId: input.context.managedTarget.id });
    return {
      executorType: 'AGENT',
      executionTargetId: agentId,
      requiredCapabilities: ['agent.atomic_plan.execute'],
      payload: {
        pluginRuntimeCapability: immutableCapabilitySnapshot(input.capability),
        actionType: 'agent.atomic_plan.execute',
        actionSchemaVersion: '1.0',
        agentId,
        pluginBindingId: input.capability.binding.id,
        applicationAssetId: input.applicationAsset.id,
        certificateBindingId: input.certificateBindingId,
        managedTargetId: input.context.managedTarget.id,
        certificateVerification: hostCertificateVerification(input),
        resolvedDeploymentInput: input.resolvedInput,
        siteAssetId: input.context.siteAsset?.id,
        frameworkType: input.context.frameworkType,
        siteName: input.context.siteAsset?.siteName,
        bindingSelector: {
          bindingInformation: input.context.siteAsset?.bindingInformation ?? input.context.managedTarget.bindingKey,
          hostHeader: input.context.siteAsset?.hostHeader,
          port: input.context.siteAsset?.port,
          protocol: input.context.siteAsset?.protocol,
        },
        managedTargetSnapshot: {
          id: input.context.managedTarget.id,
          targetType: input.context.managedTarget.targetType,
          targetKey: input.context.managedTarget.targetKey,
          bindingKey: input.context.managedTarget.bindingKey,
          frameworkInstanceId: input.context.serviceInstance?.id,
          siteAssetId: input.context.siteAsset?.id,
          hostId: input.context.host.id,
        },
      },
    };
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
    const frameworkType = input.context.frameworkType
      ?? input.capability.plugin.manifest.supportedProducts?.[0]
      ?? input.context.managedTarget.metadata.frameworkType as string | undefined;
    if (!frameworkType) {
      throw new AppError('CAPABILITY_MISSING', 'TRUSTED_JS Runtime 缺少目标框架类型', {
        pluginVersionId: input.capability.pluginVersionId,
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
          providerKey: input.capability.plugin.manifest.providerKey,
          frameworkType,
          target: buildTrustedJsTarget(input, frameworkType),
        },
      },
    };
  }
}

export function createDefaultPluginRuntimeAdapterRegistry(): PluginRuntimeAdapterRegistry {
  return new PluginRuntimeAdapterRegistry()
    .register(new AgentAtomicRuntimeAdapter())
    .register(new WorkflowDslRuntimeAdapter())
    .register(new TrustedJsRuntimeAdapter());
}

function immutableCapabilitySnapshot(capability: ResolvedDeploymentCapability) {
  return {
    assignmentId: capability.assignment.id,
    assignmentOwnerType: capability.assignment.ownerType,
    assignmentOwnerId: capability.assignment.ownerId,
    assignmentPrecedence: capability.assignment.precedence,
    pluginVersionId: capability.pluginVersionId,
    pluginBindingId: capability.binding.id,
    pluginBindingVersion: capability.binding.version,
    runtime: capability.pluginRuntime,
    executionLocation: capability.executionLocation,
    capabilityKey: capability.assignment.capabilityKey,
  };
}

function buildTrustedJsTarget(input: RuntimeCompileInput, frameworkType: string): Record<string, unknown> {
  const domain = input.context.siteAsset?.hostHeader
    ?? input.applicationAsset.sniName
    ?? input.applicationAsset.address;
  const metadata = Object.keys(input.context.managedTarget.metadata ?? {}).length > 0
    ? structuredClone(input.context.managedTarget.metadata)
    : {};
  return {
    frameworkType,
    resourceId: input.context.managedTarget.targetKey,
    ...(domain ? { domain } : {}),
    ...(typeof input.context.managedTarget.metadata.listenerId === 'string'
      ? { listenerId: input.context.managedTarget.metadata.listenerId }
      : {}),
    metadata,
  };
}
