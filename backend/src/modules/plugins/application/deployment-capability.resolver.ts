import { AppError } from '../../../common/errors/app-error.js';
import type { CapabilityAssignmentV1, PluginBindingV1 } from '../dto/plugin-bindings.dto.js';
import type { UnifiedPluginRuntime, UnifiedPluginVersionRecord } from '../dto/unified-plugins.dto.js';
import { evaluatePluginCompatibility, type PluginCompatibilityContext } from '../capabilities/plugin-compatibility.evaluator.js';
import type { PluginBindingsApplicationService } from './plugin-bindings.application-service.js';

export interface UnifiedPluginVersionReader {
  getVersion(pluginVersionId: string): Promise<UnifiedPluginVersionRecord>;
}

export interface ResolvedDeploymentCapability {
  assignment: CapabilityAssignmentV1;
  binding: PluginBindingV1;
  plugin: UnifiedPluginVersionRecord;
  pluginVersionId: string;
  pluginRuntime: UnifiedPluginRuntime;
  executionLocation: 'AGENT' | 'CONTROL_PLANE' | 'GATEWAY';
  compatibility: ReturnType<typeof evaluatePluginCompatibility>;
}

export class DeploymentCapabilityResolver {
  constructor(
    private readonly bindings: PluginBindingsApplicationService,
    private readonly plugins: UnifiedPluginVersionReader,
  ) {}

  async resolve(input: {
    tenantId: string;
    capabilityKey: string;
    hostId: string;
    managedTargetId: string;
    applicationAssetId?: string;
    executionLocations: Array<'AGENT' | 'CONTROL_PLANE' | 'GATEWAY'>;
    compatibility: Omit<PluginCompatibilityContext, 'executionLocation'>;
  }): Promise<ResolvedDeploymentCapability> {
    const assignment = await this.bindings.resolveAssignment(input.tenantId, input.capabilityKey, {
      deviceId: input.hostId,
      managedTargetId: input.managedTargetId,
      applicationAssetId: input.applicationAssetId,
    });
    if (!assignment) {
      throw new AppError('CAPABILITY_MISSING', '受管目标没有可用的插件能力指派', {
        capabilityKey: input.capabilityKey,
        hostId: input.hostId,
        managedTargetId: input.managedTargetId,
        applicationAssetId: input.applicationAssetId,
      });
    }
    const binding = await this.bindings.getTenantBinding(input.tenantId, assignment.pluginBindingId);
    if (binding.status !== 'ACTIVE' || binding.pluginVersionId !== assignment.pluginVersionId) {
      throw new AppError('CAPABILITY_MISSING', '插件能力指派与绑定状态不一致', { assignmentId: assignment.id });
    }
    if (binding.managedContext?.hostId !== input.hostId) {
      throw new AppError('VALIDATION_FAILED', '插件绑定不属于目标 Host', { pluginBindingId: binding.id, hostId: input.hostId });
    }
    if (binding.managedContext.managedTargetId && binding.managedContext.managedTargetId !== input.managedTargetId) {
      throw new AppError('VALIDATION_FAILED', '插件绑定不属于目标 ManagedTarget', { pluginBindingId: binding.id, managedTargetId: input.managedTargetId });
    }
    const plugin = await this.plugins.getVersion(assignment.pluginVersionId);
    const capability = plugin.manifest.capabilities.find((item) => item.key === input.capabilityKey);
    if (plugin.tenantId !== input.tenantId || plugin.status !== 'ENABLED' || !capability) {
      throw new AppError('CAPABILITY_MISSING', '插件版本未启用或未声明目标能力', { pluginVersionId: plugin.id, capabilityKey: input.capabilityKey });
    }
    const candidateLocations = input.executionLocations.filter((location) => capability.executionLocations.includes(location));
    if (candidateLocations.length === 0) {
      throw new AppError('CAPABILITY_MISSING', '插件能力不支持目标执行位置', {
        pluginVersionId: plugin.id,
        capabilityKey: input.capabilityKey,
        executionLocations: input.executionLocations,
      });
    }
    const evaluations = candidateLocations.map((executionLocation) => ({
      executionLocation,
      compatibility: evaluatePluginCompatibility(plugin.manifest, { ...input.compatibility, executionLocation }),
    }));
    const selected = evaluations.find((item) => item.compatibility.compatible);
    if (!selected) {
      throw new AppError('CAPABILITY_MISSING', '插件与受管目标不兼容', {
        pluginVersionId: plugin.id,
        reasons: evaluations.flatMap((item) => item.compatibility.reasons),
      });
    }
    return {
      assignment,
      binding,
      plugin,
      pluginVersionId: plugin.id,
      pluginRuntime: plugin.runtime,
      executionLocation: selected.executionLocation,
      compatibility: selected.compatibility,
    };
  }
}
