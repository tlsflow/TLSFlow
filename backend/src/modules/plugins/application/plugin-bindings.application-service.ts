import { AppError } from '../../../common/errors/app-error.js';
import { newId } from '../../../shared/id.js';
import type { CapabilityAssignmentV1, PluginBindingV1 } from '../dto/plugin-bindings.dto.js';
import { PluginBindingsRepository } from '../repository/plugin-bindings.repository.js';

type CreatePluginBindingInput = Omit<PluginBindingV1, 'id' | 'tenantId' | 'status' | 'version' | 'createdAt' | 'updatedAt'>;

/** 中文说明：CloudAccountAsset 只承载云账号连接和资源识别，不再承载证书生命周期能力。 */
export const cloudAccountIdentificationCapabilities = [
  'cloud.service.connection-test',
  'cloud.service.discover',
] as const;

export function isCloudAccountIdentificationCapability(capabilityKey: string): boolean {
  return (cloudAccountIdentificationCapabilities as readonly string[]).includes(capabilityKey);
}

export class PluginBindingsApplicationService {
  constructor(private readonly repository = new PluginBindingsRepository()) {}

  async getBinding(bindingId: string): Promise<PluginBindingV1 | undefined> {
    return this.repository.getBinding(bindingId);
  }

  async getTenantBinding(tenantId: string, bindingId: string): Promise<PluginBindingV1> {
    const binding = await this.repository.getBinding(bindingId);
    if (!binding || binding.tenantId !== tenantId) throw new AppError('RESOURCE_NOT_FOUND', 'PluginBinding 不存在', { bindingId });
    return binding;
  }

  async getTenantBindingForUpdate(tenantId: string, bindingId: string): Promise<PluginBindingV1> {
    const binding = await this.repository.getBindingForUpdate(tenantId, bindingId);
    if (!binding || binding.tenantId !== tenantId) throw new AppError('RESOURCE_NOT_FOUND', 'PluginBinding 不存在', { bindingId });
    return binding;
  }

  async listOwnerAssignments(tenantId: string, ownerType: CapabilityAssignmentV1['ownerType'], ownerId: string): Promise<CapabilityAssignmentV1[]> {
    return this.repository.listOwnerAssignments(tenantId, ownerType, ownerId);
  }

  async updateBinding(
    tenantId: string,
    bindingId: string,
    input: Partial<Pick<PluginBindingV1, 'inputBindings' | 'managedContext' | 'status'>> & { expectedVersion: number },
  ): Promise<PluginBindingV1> {
    const binding = await this.getTenantBinding(tenantId, bindingId);
    if (binding.version !== input.expectedVersion) throw new AppError('RESOURCE_VERSION_CONFLICT', 'PluginBinding 版本冲突', { bindingId, expectedVersion: input.expectedVersion, actualVersion: binding.version });
    if (binding.mode === 'STANDALONE' && input.managedContext) throw new AppError('VALIDATION_FAILED', 'Standalone Binding 不能保存 managedContext');
    assertManagedContext(input.managedContext);
    const next = {
      ...binding,
      inputBindings: input.inputBindings ?? binding.inputBindings,
      managedContext: input.managedContext ?? binding.managedContext,
      status: input.status ?? binding.status,
      version: binding.version + 1,
      updatedAt: new Date().toISOString(),
    };
    return this.repository.updateBinding(next, input.expectedVersion);
  }

  async createBinding(tenantId: string, input: CreatePluginBindingInput): Promise<PluginBindingV1> {
    if (input.mode === 'MANAGED' && !hasManagedContextOwner(input.managedContext)) {
      throw new AppError('VALIDATION_FAILED', 'Managed Binding 必须提供 hostId 或标准 ServiceAsset 所有者');
    }
    if (input.mode === 'STANDALONE' && input.managedContext) throw new AppError('VALIDATION_FAILED', 'Standalone Binding 不能保存 managedContext');
    assertManagedContext(input.managedContext);
    for (const [slot, value] of Object.entries(input.inputBindings.credentials)) {
      if (!slot.trim() || !value.credentialId?.trim()) throw new AppError('VALIDATION_FAILED', 'Credential Binding 必须使用非空 credentialId');
    }
    const now = new Date().toISOString();
    return this.repository.saveBinding({ ...input, id: newId('plgb'), tenantId, status: 'ACTIVE', version: 1, createdAt: now, updatedAt: now });
  }

  async assignCapability(tenantId: string, input: Omit<CapabilityAssignmentV1, 'id' | 'tenantId' | 'status' | 'createdAt' | 'updatedAt'>): Promise<CapabilityAssignmentV1> {
    const binding = await this.repository.getBinding(input.pluginBindingId);
    if (!binding || binding.tenantId !== tenantId || binding.pluginVersionId !== input.pluginVersionId) throw new AppError('VALIDATION_FAILED', 'Capability Assignment 与 Binding 不一致');
    if (input.ownerType === 'CLOUD_ACCOUNT_ASSET' && !isCloudAccountIdentificationCapability(input.capabilityKey)) {
      throw new AppError('VALIDATION_FAILED', '云账号只允许绑定连接测试和资源发现能力，证书生命周期必须使用 V1 DSL Workflow', {
        ownerType: input.ownerType,
        capabilityKey: input.capabilityKey,
      });
    }
    if (input.ownerType === 'CLOUD_ACCOUNT_ASSET' && binding.managedContext?.cloudAccountAssetId !== input.ownerId) {
      throw new AppError('VALIDATION_FAILED', '云账号 Capability Assignment 必须绑定同一 CloudAccountAsset', {
        ownerId: input.ownerId,
        cloudAccountAssetId: binding.managedContext?.cloudAccountAssetId,
      });
    }
    if ((input.ownerType === 'APPLICATION_ASSET' || input.ownerType === 'SERVICE_ASSET') && binding.managedContext?.serviceAssetId
      && (binding.managedContext.serviceAssetId ?? binding.managedContext.assetId) !== input.ownerId) {
      throw new AppError('VALIDATION_FAILED', 'ServiceAsset Capability Assignment 必须绑定同一 ServiceAsset', {
        ownerId: input.ownerId,
        serviceAssetId: binding.managedContext.serviceAssetId ?? binding.managedContext.assetId,
      });
    }
    const now = new Date().toISOString();
    return this.repository.saveAssignment({ ...input, id: newId('capa'), tenantId, status: 'ACTIVE', createdAt: now, updatedAt: now });
  }

  async disableOwnerAssignment(tenantId: string, input: { ownerType: CapabilityAssignmentV1['ownerType']; ownerId: string; capabilityKey: string }): Promise<void> {
    await this.repository.disableAssignment(tenantId, input.ownerType, input.ownerId, input.capabilityKey, new Date().toISOString());
  }

  async listAssignmentCandidates(tenantId: string, capabilityKey: string, owners: { deviceId?: string; managedTargetId?: string; applicationAssetId?: string; serviceAssetId?: string; cloudAccountAssetId?: string }): Promise<CapabilityAssignmentV1[]> {
    const assignments = await this.repository.listAssignments(tenantId, capabilityKey);
    return [
      assignments.find((item) => item.ownerType === 'APPLICATION_ASSET' && item.ownerId === owners.applicationAssetId),
      assignments.find((item) => item.ownerType === 'SERVICE_ASSET' && item.ownerId === owners.serviceAssetId),
      assignments.find((item) => item.ownerType === 'CLOUD_ACCOUNT_ASSET' && item.ownerId === owners.cloudAccountAssetId),
      assignments.find((item) => item.ownerType === 'MANAGED_TARGET' && item.ownerId === owners.managedTargetId),
      assignments.find((item) => item.ownerType === 'DEVICE' && item.ownerId === owners.deviceId),
    ].filter((item): item is CapabilityAssignmentV1 => Boolean(item));
  }

  async resolveAssignment(tenantId: string, capabilityKey: string, owners: { deviceId?: string; managedTargetId?: string; applicationAssetId?: string; serviceAssetId?: string; cloudAccountAssetId?: string }): Promise<CapabilityAssignmentV1 | undefined> {
    return (await this.listAssignmentCandidates(tenantId, capabilityKey, owners))[0];
  }
}

function assertManagedContext(context: PluginBindingV1['managedContext'] | undefined): void {
  if (!context) return;
  const unknownFields = Object.keys(context).filter((key) => key !== 'hostId' && key !== 'managedTargetId' && key !== 'serviceAssetId' && key !== 'assetId' && key !== 'cloudAccountAssetId');
  if (unknownFields.length > 0) {
    throw new AppError('VALIDATION_FAILED', 'Managed Binding 只允许保存 Host、ManagedTarget 或 CloudAccountAsset 身份，也支持标准 ServiceAsset', { unknownFields });
  }
  if (!hasManagedContextOwner(context)) throw new AppError('VALIDATION_FAILED', 'Managed Binding 必须包含一个所有者上下文');
  if (context.cloudAccountAssetId && context.hostId) {
    throw new AppError('VALIDATION_FAILED', 'CloudAccountAsset Binding 不能同时携带 Host');
  }
  if ((context.serviceAssetId || context.assetId) && (context.hostId || context.cloudAccountAssetId)) {
    throw new AppError('VALIDATION_FAILED', '标准 ServiceAsset Binding 不能同时携带其他所有者');
  }
  if (context.serviceAssetId && context.assetId) {
    throw new AppError('VALIDATION_FAILED', '标准 ServiceAsset Binding 不能同时携带 serviceAssetId 和历史 assetId');
  }
}

function hasManagedContextOwner(context: PluginBindingV1['managedContext'] | undefined): boolean {
  return Boolean(context?.hostId || context?.serviceAssetId || context?.assetId || context?.cloudAccountAssetId);
}
