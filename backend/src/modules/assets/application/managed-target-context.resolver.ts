import { AppError } from '../../../common/errors/app-error.js';
import type { AgentRegistration } from '../../agents/schema/agents.schema.js';
import type { DeviceAssetDto } from '../../device-assets/dto/device-assets.dto.js';
import type { FrameworkInstanceDto, HostDto, ManagedTargetDto, SiteAssetDto } from '../dto/assets.dto.js';

export type ExecutionLocation = 'AGENT' | 'CONTROL_PLANE' | 'GATEWAY';

export interface ResolvedManagedTargetTopology {
  managedTarget: ManagedTargetDto;
  host: HostDto;
  siteAsset?: SiteAssetDto;
  serviceInstance?: FrameworkInstanceDto;
  deviceAsset?: DeviceAssetDto;
  discoveryProviderKey: string;
  frameworkType?: string;
}

export interface ResolvedManagedTargetContext extends ResolvedManagedTargetTopology {
  agent?: AgentRegistration;
  availableExecutionLocations: ExecutionLocation[];
}

export interface ManagedTargetAssetsPort {
  getManagedTarget(tenantId: string, managedTargetId: string): Promise<ManagedTargetDto | undefined>;
  getHost(tenantId: string, hostId: string): Promise<HostDto | undefined>;
  getSiteAsset(tenantId: string, siteAssetId: string): Promise<SiteAssetDto | undefined>;
  getFrameworkInstance(tenantId: string, serviceInstanceId: string): Promise<FrameworkInstanceDto | undefined>;
}

export interface ManagedTargetAgentsPort {
  getRegistration(tenantId: string, agentId: string): Promise<AgentRegistration | undefined>;
}

export interface ManagedTargetDevicesPort {
  findByHostId(tenantId: string, hostId: string): Promise<DeviceAssetDto | undefined>;
}

export class ManagedTargetContextResolver {
  constructor(
    private readonly assets: ManagedTargetAssetsPort,
    private readonly agents: ManagedTargetAgentsPort,
    private readonly devices: ManagedTargetDevicesPort,
  ) {}

  async resolveTopology(tenantId: string, managedTargetId: string): Promise<ResolvedManagedTargetTopology> {
    const managedTarget = await this.assets.getManagedTarget(tenantId, managedTargetId);
    if (!managedTarget) throw targetError('受管目标不存在或不属于当前租户', 'MANAGED_TARGET_NOT_FOUND', { managedTargetId });
    if (managedTarget.status === 'DISABLED' || managedTarget.status === 'DELETED') {
      throw targetError('受管目标不可用于部署', 'MANAGED_TARGET_UNAVAILABLE', { managedTargetId, status: managedTarget.status });
    }

    const host = await this.assets.getHost(tenantId, managedTarget.deviceId);
    if (!host) throw targetError('受管目标关联的 Device Root 不存在', 'MANAGED_TARGET_RELATION_INVALID', { managedTargetId, deviceId: managedTarget.deviceId });
    const [siteAsset, serviceInstance, deviceAsset] = await Promise.all([
      managedTarget.siteId ? this.assets.getSiteAsset(tenantId, managedTarget.siteId) : undefined,
      managedTarget.frameworkInstanceId ? this.assets.getFrameworkInstance(tenantId, managedTarget.frameworkInstanceId) : undefined,
      this.devices.findByHostId(tenantId, managedTarget.deviceId),
    ]);
    if (managedTarget.siteId && !siteAsset) throw targetError('受管目标关联的 Site 不存在', 'MANAGED_TARGET_RELATION_INVALID', { managedTargetId, siteId: managedTarget.siteId });
    if (managedTarget.frameworkInstanceId && !serviceInstance) throw targetError('受管目标关联的 FrameworkInstance 不存在', 'MANAGED_TARGET_RELATION_INVALID', { managedTargetId, frameworkInstanceId: managedTarget.frameworkInstanceId });

    return {
      managedTarget,
      host,
      siteAsset,
      serviceInstance,
      deviceAsset,
      discoveryProviderKey: managedTarget.discoveryProviderKey,
      frameworkType: serviceInstance?.frameworkType,
    };
  }

  async resolve(tenantId: string, managedTargetId: string): Promise<ResolvedManagedTargetContext> {
    const topology = await this.resolveTopology(tenantId, managedTargetId);
    const connections = await this.resolveExecutionConnections(tenantId, topology.managedTarget, topology.host, topology.deviceAsset);
    return {
      ...topology,
      agent: connections.agent,
      availableExecutionLocations: connections.availableExecutionLocations,
    };
  }

  private async resolveExecutionConnections(tenantId: string, target: ManagedTargetDto, host: HostDto, deviceAsset?: DeviceAssetDto): Promise<ResolvedExecutionConnections> {
    let agent: AgentRegistration | undefined;
    if (target.executionLocations.includes('AGENT') && host.agentId) {
      const registration = await this.agents.getRegistration(tenantId, host.agentId);
      if (registration && !['disabled', 'revoked'].includes(registration.status.toLowerCase())) agent = registration;
    }
    const availableExecutionLocations = [
      ...(agent ? ['AGENT' as const] : []),
      ...collectDeviceExecutionLocations(target, deviceAsset),
    ];
    if (availableExecutionLocations.length > 0) return { agent, availableExecutionLocations };
    throw targetError('受管目标没有可用的管理连接和执行位置交集', 'MANAGED_TARGET_OWNER_UNAVAILABLE', {
      managedTargetId: target.id,
      deviceId: target.deviceId,
      executionLocations: target.executionLocations,
    });
  }
}

interface ResolvedExecutionConnections {
  agent?: AgentRegistration;
  availableExecutionLocations: ExecutionLocation[];
}

function collectDeviceExecutionLocations(target: ManagedTargetDto, deviceAsset?: DeviceAssetDto): ExecutionLocation[] {
  if (!deviceAsset) return [];
  const locations: ExecutionLocation[] = [];
  if (target.executionLocations.includes('GATEWAY') && deviceAsset.gatewayId) locations.push('GATEWAY');
  if (target.executionLocations.includes('CONTROL_PLANE')) locations.push('CONTROL_PLANE');
  return locations;
}

function targetError(message: string, code: string, detail: Record<string, unknown>): AppError {
  return new AppError('VALIDATION_FAILED', message, { code, ...detail });
}
