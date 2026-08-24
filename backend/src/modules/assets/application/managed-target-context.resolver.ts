import { AppError } from '../../../common/errors/app-error.js';
import type { AgentRegistration } from '../../agents/schema/agents.schema.js';
import type { DeviceAssetDto } from '../../device-assets/dto/device-assets.dto.js';
import type { HostDto, ManagedTargetDto, ServiceAssetDto, ServiceInstanceDto, SiteAssetDto } from '../dto/assets.dto.js';

export type DeploymentDriverKind = 'AGENT_NATIVE' | 'AGENT_PLUGIN' | 'DEVICE_PLUGIN';
export type ExecutionLocation = 'AGENT' | 'CONTROL_PLANE' | 'GATEWAY';

export interface ResolvedManagedTargetContext {
  managedTarget: ManagedTargetDto;
  host: HostDto;
  siteAsset?: SiteAssetDto;
  serviceAsset?: ServiceAssetDto;
  serviceInstance?: ServiceInstanceDto;
  agent?: AgentRegistration;
  deviceAsset?: DeviceAssetDto;
  providerType: ManagedTargetDto['providerType'];
  driverKind: DeploymentDriverKind;
  executionLocation: ExecutionLocation;
}

export interface ManagedTargetAssetsPort {
  getManagedTarget(tenantId: string, managedTargetId: string): Promise<ManagedTargetDto | undefined>;
  getHost(tenantId: string, hostId: string): Promise<HostDto | undefined>;
  getSiteAsset(tenantId: string, siteAssetId: string): Promise<SiteAssetDto | undefined>;
  getServiceAsset(tenantId: string, serviceAssetId: string): Promise<ServiceAssetDto | undefined>;
  getServiceInstance(tenantId: string, serviceInstanceId: string): Promise<ServiceInstanceDto | undefined>;
}

export interface ManagedTargetAgentsPort {
  getRegistration(tenantId: string, agentId: string): Promise<AgentRegistration | undefined>;
}

export interface ManagedTargetDevicesPort {
  get(tenantId: string, deviceAssetId: string): Promise<DeviceAssetDto | undefined>;
}

export class ManagedTargetContextResolver {
  constructor(
    private readonly assets: ManagedTargetAssetsPort,
    private readonly agents: ManagedTargetAgentsPort,
    private readonly devices: ManagedTargetDevicesPort,
  ) {}

  async resolve(tenantId: string, managedTargetId: string): Promise<ResolvedManagedTargetContext> {
    const managedTarget = await this.assets.getManagedTarget(tenantId, managedTargetId);
    if (!managedTarget) throw targetError('受管目标不存在或不属于当前租户', 'MANAGED_TARGET_NOT_FOUND', { managedTargetId });
    if (managedTarget.status === 'DISABLED' || managedTarget.status === 'DELETED') {
      throw targetError('受管目标不可用于部署', 'MANAGED_TARGET_UNAVAILABLE', { managedTargetId, status: managedTarget.status });
    }
    if (!managedTarget.hostId) throw targetError('受管目标缺少 Host', 'MANAGED_TARGET_RELATION_INVALID', { managedTargetId });
    const host = await this.assets.getHost(tenantId, managedTarget.hostId);
    if (!host) throw targetError('受管目标关联的 Host 不存在', 'MANAGED_TARGET_RELATION_INVALID', { managedTargetId, hostId: managedTarget.hostId });
    const related = await this.loadRelated(tenantId, managedTarget);
    if (managedTarget.agentId) return this.resolveAgent(tenantId, managedTarget, host, related);
    if (managedTarget.deviceAssetId) return this.resolveDevice(tenantId, managedTarget, host, related);
    throw targetError('受管目标没有 Agent 或设备所有者', 'MANAGED_TARGET_RELATION_INVALID', { managedTargetId });
  }

  private async resolveAgent(tenantId: string, managedTarget: ManagedTargetDto, host: HostDto, related: RelatedContext): Promise<ResolvedManagedTargetContext> {
    if (host.agentId !== managedTarget.agentId) throw targetError('受管目标与 Host 的 Agent 关系冲突', 'MANAGED_TARGET_RELATION_INVALID', { managedTargetId: managedTarget.id });
    const agent = await this.agents.getRegistration(tenantId, managedTarget.agentId!);
    if (!agent || ['disabled', 'revoked'].includes(agent.status)) {
      throw targetError('受管目标关联的 Agent 不可用', 'MANAGED_TARGET_OWNER_UNAVAILABLE', { managedTargetId: managedTarget.id, agentId: managedTarget.agentId });
    }
    return { managedTarget, host, agent, ...related, providerType: managedTarget.providerType, driverKind: 'AGENT_NATIVE', executionLocation: 'AGENT' };
  }

  private async resolveDevice(tenantId: string, managedTarget: ManagedTargetDto, host: HostDto, related: RelatedContext): Promise<ResolvedManagedTargetContext> {
    const deviceAsset = await this.devices.get(tenantId, managedTarget.deviceAssetId!);
    if (!deviceAsset || deviceAsset.hostId !== host.id) {
      throw targetError('受管目标与设备 Host 关系冲突', 'MANAGED_TARGET_RELATION_INVALID', { managedTargetId: managedTarget.id, deviceAssetId: managedTarget.deviceAssetId });
    }
    return {
      managedTarget,
      host,
      deviceAsset,
      ...related,
      providerType: managedTarget.providerType,
      driverKind: 'DEVICE_PLUGIN',
      executionLocation: deviceAsset.gatewayId ? 'GATEWAY' : 'CONTROL_PLANE',
    };
  }

  private async loadRelated(tenantId: string, managedTarget: ManagedTargetDto): Promise<RelatedContext> {
    const [siteAsset, serviceAsset, serviceInstance] = await Promise.all([
      managedTarget.siteAssetId ? this.assets.getSiteAsset(tenantId, managedTarget.siteAssetId) : undefined,
      managedTarget.serviceAssetId ? this.assets.getServiceAsset(tenantId, managedTarget.serviceAssetId) : undefined,
      managedTarget.serviceInstanceId ? this.assets.getServiceInstance(tenantId, managedTarget.serviceInstanceId) : undefined,
    ]);
    if (managedTarget.siteAssetId && !siteAsset) throw targetError('受管目标关联的 SiteAsset 不存在', 'MANAGED_TARGET_RELATION_INVALID', { managedTargetId: managedTarget.id });
    if (managedTarget.serviceAssetId && !serviceAsset) throw targetError('受管目标关联的 ServiceAsset 不存在', 'MANAGED_TARGET_RELATION_INVALID', { managedTargetId: managedTarget.id });
    if (managedTarget.serviceInstanceId && !serviceInstance) throw targetError('受管目标关联的 ServiceInstance 不存在', 'MANAGED_TARGET_RELATION_INVALID', { managedTargetId: managedTarget.id });
    return { siteAsset, serviceAsset, serviceInstance };
  }
}

type RelatedContext = Pick<ResolvedManagedTargetContext, 'siteAsset' | 'serviceAsset' | 'serviceInstance'>;

function targetError(message: string, code: string, detail: Record<string, unknown>): AppError {
  return new AppError('VALIDATION_FAILED', message, { code, ...detail });
}
