import { AppError } from '../../../common/errors/app-error.js';
import type { AgentRegistration } from '../../agents/schema/agents.schema.js';
import type { DeviceAssetDto } from '../../device-assets/dto/device-assets.dto.js';
import type { CloudAccountAsset } from '../../providers/dto/providers.dto.js';
import type { FrameworkInstanceDto, HostDto, ManagedTargetDto, SiteAssetDto } from '../dto/assets.dto.js';

export type ExecutionLocation = 'AGENT' | 'CONTROL_PLANE' | 'GATEWAY';

export interface ResolvedManagedTargetTopology {
  managedTarget: ManagedTargetDto;
  /** 设备目标有 Host；云目标不创建或伪造 Host。 */
  host?: HostDto;
  cloudAccountAsset?: CloudAccountAsset;
  /** 标准插件 ServiceAsset 所有者；云目标不创建或伪造 Host。 */
  serviceAsset?: import('../dto/assets.dto.js').ServiceAssetDto;
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
  getCloudAccountAsset?(tenantId: string, assetId: string): Promise<CloudAccountAsset | undefined>;
  getServiceAsset?(tenantId: string, serviceAssetId: string): Promise<import('../dto/assets.dto.js').ServiceAssetDto | undefined>;
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

    const host = managedTarget.deviceId ? await this.assets.getHost(tenantId, managedTarget.deviceId) : undefined;
    if (managedTarget.deviceId && !host) throw targetError('受管目标关联的 Device Root 不存在', 'MANAGED_TARGET_RELATION_INVALID', { managedTargetId, deviceId: managedTarget.deviceId });
    const cloudAccountAsset = managedTarget.assetId && this.assets.getCloudAccountAsset
      ? await this.assets.getCloudAccountAsset(tenantId, managedTarget.assetId)
      : undefined;
    if (managedTarget.assetId && !cloudAccountAsset) throw targetError('受管目标关联的 CloudAccountAsset 不存在', 'MANAGED_TARGET_RELATION_INVALID', { managedTargetId, assetId: managedTarget.assetId });
    const serviceAsset = managedTarget.serviceAssetId && this.assets.getServiceAsset
      ? await this.assets.getServiceAsset(tenantId, managedTarget.serviceAssetId)
      : undefined;
    if (managedTarget.serviceAssetId && !serviceAsset) throw targetError('受管目标关联的 ServiceAsset 不存在', 'MANAGED_TARGET_RELATION_INVALID', { managedTargetId, serviceAssetId: managedTarget.serviceAssetId });
    if (!host && !cloudAccountAsset && !serviceAsset) throw targetError('受管目标没有合法所有者', 'MANAGED_TARGET_OWNER_UNAVAILABLE', { managedTargetId });
    const [siteAsset, deviceAsset] = await Promise.all([
      managedTarget.siteId ? this.assets.getSiteAsset(tenantId, managedTarget.siteId) : undefined,
      managedTarget.deviceId ? this.devices.findByHostId(tenantId, managedTarget.deviceId) : undefined,
    ]);
    if (managedTarget.siteId && !siteAsset) throw targetError('受管目标关联的 Site 不存在', 'MANAGED_TARGET_RELATION_INVALID', { managedTargetId, siteId: managedTarget.siteId });
    // 历史 ManagedTarget 可能没有保存 frameworkInstanceId，但 Site 仍保留发现时的
    // Framework 关系。沿用该已持久化关系，避免应用向导丢失 Agent 上报的运行事实。
    const frameworkInstanceId = managedTarget.frameworkInstanceId ?? siteAsset?.frameworkInstanceId;
    const serviceInstance = frameworkInstanceId
      ? await this.assets.getFrameworkInstance(tenantId, frameworkInstanceId)
      : undefined;
    if (managedTarget.frameworkInstanceId && !serviceInstance) throw targetError('受管目标关联的 FrameworkInstance 不存在', 'MANAGED_TARGET_RELATION_INVALID', { managedTargetId, frameworkInstanceId: managedTarget.frameworkInstanceId });
    if (siteAsset?.frameworkInstanceId && !serviceInstance) throw targetError('受管目标关联的 Site FrameworkInstance 不存在', 'MANAGED_TARGET_RELATION_INVALID', { managedTargetId, siteId: siteAsset.id, frameworkInstanceId: siteAsset.frameworkInstanceId });

    return {
      managedTarget,
      host,
      cloudAccountAsset,
      serviceAsset,
      siteAsset,
      serviceInstance,
      deviceAsset,
      discoveryProviderKey: managedTarget.discoveryProviderKey,
      frameworkType: serviceInstance?.frameworkType,
    };
  }

  async resolve(tenantId: string, managedTargetId: string): Promise<ResolvedManagedTargetContext> {
    const topology = await this.resolveTopology(tenantId, managedTargetId);
    const connections = await this.resolveExecutionConnections(tenantId, topology.managedTarget, topology.host, topology.deviceAsset, topology.cloudAccountAsset, topology.serviceAsset);
    return {
      ...topology,
      agent: connections.agent,
      availableExecutionLocations: connections.availableExecutionLocations,
    };
  }

  private async resolveExecutionConnections(tenantId: string, target: ManagedTargetDto, host?: HostDto, deviceAsset?: DeviceAssetDto, cloudAccountAsset?: CloudAccountAsset, serviceAsset?: import('../dto/assets.dto.js').ServiceAssetDto): Promise<ResolvedExecutionConnections> {
    let agent: AgentRegistration | undefined;
    if (target.executionLocations.includes('AGENT') && host?.agentId) {
      const registration = await this.agents.getRegistration(tenantId, host.agentId);
      if (registration && !['disabled', 'revoked'].includes(registration.status.toLowerCase())) agent = registration;
    }
    const availableExecutionLocations = [
      ...(agent ? ['AGENT' as const] : []),
      ...collectDeviceExecutionLocations(target, deviceAsset, cloudAccountAsset, serviceAsset),
    ];
    if (availableExecutionLocations.length > 0) return { agent, availableExecutionLocations };
    throw targetError('受管目标没有可用的管理连接和执行位置交集', 'MANAGED_TARGET_OWNER_UNAVAILABLE', {
      managedTargetId: target.id,
      deviceId: target.deviceId,
      assetId: target.assetId,
      executionLocations: target.executionLocations,
    });
  }
}

interface ResolvedExecutionConnections {
  agent?: AgentRegistration;
  availableExecutionLocations: ExecutionLocation[];
}

function collectDeviceExecutionLocations(target: ManagedTargetDto, deviceAsset?: DeviceAssetDto, cloudAccountAsset?: CloudAccountAsset, serviceAsset?: import('../dto/assets.dto.js').ServiceAssetDto): ExecutionLocation[] {
  if ((cloudAccountAsset || serviceAsset) && target.executionLocations.includes('CONTROL_PLANE')) return ['CONTROL_PLANE'];
  if (!deviceAsset) return [];
  const locations: ExecutionLocation[] = [];
  if (target.executionLocations.includes('GATEWAY') && deviceAsset.gatewayId) locations.push('GATEWAY');
  if (target.executionLocations.includes('CONTROL_PLANE')) locations.push('CONTROL_PLANE');
  return locations;
}

function targetError(message: string, code: string, detail: Record<string, unknown>): AppError {
  return new AppError('VALIDATION_FAILED', message, { code, ...detail });
}
