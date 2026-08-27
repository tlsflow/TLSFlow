import { AppError } from '../../../common/errors/app-error.js';
import type { CapabilityAssignmentV1, PluginBindingV1 } from '../dto/plugin-bindings.dto.js';
import type { UnifiedPluginRuntime, UnifiedPluginVersionRecord } from '../dto/unified-plugins.dto.js';
import { evaluatePluginCompatibility, type PluginCompatibilityContext } from '../capabilities/plugin-compatibility.evaluator.js';
import type { PluginBindingsApplicationService } from './plugin-bindings.application-service.js';
import { isUnifiedPluginVersionAccessibleToTenant } from './unified-plugins.application-service.js';

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
    /** 设备目标的 Host；云目标不提供该字段。 */
    hostId?: string;
    /** 云目标所有者；与 hostId 二选一。 */
    cloudAccountAssetId?: string;
    managedTargetId: string;
    applicationAssetId?: string;
    executionLocations: Array<'AGENT' | 'CONTROL_PLANE' | 'GATEWAY'>;
    compatibility: Omit<PluginCompatibilityContext, 'executionLocation'>;
  }): Promise<ResolvedDeploymentCapability> {
    const candidates = await this.bindings.listAssignmentCandidates(input.tenantId, input.capabilityKey, {
      deviceId: input.hostId,
      cloudAccountAssetId: input.cloudAccountAssetId,
      managedTargetId: input.managedTargetId,
      applicationAssetId: input.applicationAssetId,
    });
    const rejected: Array<{ assignmentId: string; pluginBindingId: string; reason: string }> = [];
    for (const assignment of candidates) {
      const binding = await this.bindings.getTenantBinding(input.tenantId, assignment.pluginBindingId);
      if (binding.status !== 'ACTIVE' || binding.pluginVersionId !== assignment.pluginVersionId) {
        rejected.push({ assignmentId: assignment.id, pluginBindingId: binding.id, reason: '绑定状态或插件版本不一致' });
        continue;
      }
      if (!isBindingInTargetContext(binding, input)) {
        rejected.push({ assignmentId: assignment.id, pluginBindingId: binding.id, reason: '绑定上下文不属于当前受管目标' });
        continue;
      }
      const plugin = await this.plugins.getVersion(assignment.pluginVersionId);
      const capability = plugin.manifest.capabilities.find((item) => item.key === input.capabilityKey);
      // 已退休版本仍可被已有 Binding 精确引用，用于历史执行和回滚；目录和新指派仍只暴露 ENABLED。
      if (!isUnifiedPluginVersionAccessibleToTenant(plugin, input.tenantId) || ['DISABLED', 'QUARANTINED', 'IMPORTED', 'PENDING_APPROVAL'].includes(plugin.status) || !capability) {
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
        compatibility: evaluatePluginCompatibility(plugin.manifest, { ...input.compatibility, executionLocation }, capability),
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
    if (candidates.length === 0) {
      throw new AppError('CAPABILITY_MISSING', '受管目标没有可用的插件能力指派', {
        capabilityKey: input.capabilityKey,
        hostId: input.hostId,
        cloudAccountAssetId: input.cloudAccountAssetId,
        managedTargetId: input.managedTargetId,
        applicationAssetId: input.applicationAssetId,
      });
    }
    throw new AppError('CAPABILITY_MISSING', '受管目标没有上下文匹配的插件能力指派', {
      capabilityKey: input.capabilityKey,
      hostId: input.hostId,
      cloudAccountAssetId: input.cloudAccountAssetId,
      managedTargetId: input.managedTargetId,
      applicationAssetId: input.applicationAssetId,
      rejected,
    });
  }
}

function isBindingInTargetContext(
  binding: PluginBindingV1,
  input: { hostId?: string; cloudAccountAssetId?: string; managedTargetId: string },
): boolean {
  if (binding.mode !== 'MANAGED') return false;
  const context = binding.managedContext;
  if (!context) return false;
  if (input.hostId && context.hostId !== input.hostId) return false;
  if (input.cloudAccountAssetId && context.cloudAccountAssetId !== input.cloudAccountAssetId) return false;
  if (!input.hostId && !input.cloudAccountAssetId) return false;
  return !context.managedTargetId || context.managedTargetId === input.managedTargetId;
}
