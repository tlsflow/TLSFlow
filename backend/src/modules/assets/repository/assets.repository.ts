import { AppError } from '../../../common/errors/app-error.js';
import type { PageQuery } from '../../../common/pagination/pagination.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { newId } from '../../../shared/id.js';
import { readStoredDeploymentStrategy, writeDeploymentStrategyMetadata } from '../application/deployment-strategy.service.js';
import type {
  CreateHostDto,
  CreateManagedTargetDto,
  CreateApplicationAssetTargetDto,
  CreateManagedTargetSnapshotDto,
  AssetConflictDto,
  CreateAssetConflictDto,
  CreateDiscoverySnapshotDto,
  CreateServiceAssetDto,
  CreateServiceEndpointDto,
  CreateServiceInstanceDto,
  CreateSiteAssetDto,
  ApplicationAssetTargetDetailDto,
  ApplicationAssetTargetSummaryDto,
  DiscoverySnapshotDto,
  HostDto,
  ManagedTargetSnapshotDto,
  ManagedTargetDto,
  ServiceAssetDetailDto,
  ServiceAssetDto,
  ServiceEndpointDto,
  ServiceInstanceDto,
  SiteAssetDto,
  ResolveAssetConflictDto,
  UpdateHostDto,
  UpdateManagedTargetDto,
  UpdateApplicationAssetTargetDto,
  UpdateServiceAssetDto,
  UpdateServiceEndpointDto,
  UpdateServiceInstanceDto,
  UpdateSiteAssetDto,
} from '../dto/assets.dto.js';

export interface PageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AssetsRepository {
  readonly moduleName: 'assets';
  createHost(tenantId: string, input: CreateHostDto): Promise<HostDto>;
  updateHost(tenantId: string, hostId: string, input: UpdateHostDto): Promise<HostDto>;
  deleteHost(tenantId: string, hostId: string): Promise<HostDto>;
  listHosts(tenantId: string, query: PageQuery): Promise<PageResult<HostDto>>;
  getHost(tenantId: string, hostId: string): Promise<HostDto | undefined>;
  getHostIncludingDeleted(tenantId: string, hostId: string): Promise<HostDto | undefined>;
  findHostByHostname(tenantId: string, hostname: string): Promise<HostDto | undefined>;
  createServiceInstance(tenantId: string, input: CreateServiceInstanceDto): Promise<ServiceInstanceDto>;
  updateServiceInstance(tenantId: string, serviceInstanceId: string, input: UpdateServiceInstanceDto): Promise<ServiceInstanceDto>;
  deleteServiceInstance(tenantId: string, serviceInstanceId: string): Promise<ServiceInstanceDto>;
  listServiceInstances(tenantId: string, query: PageQuery): Promise<PageResult<ServiceInstanceDto>>;
  getServiceInstance(tenantId: string, serviceInstanceId: string): Promise<ServiceInstanceDto | undefined>;
  getServiceInstanceIncludingDeleted(tenantId: string, serviceInstanceId: string): Promise<ServiceInstanceDto | undefined>;
  findServiceInstanceByIdentity(tenantId: string, input: { hostId?: string; providerType: string; serviceName?: string; configPath?: string; providerKey?: string }): Promise<ServiceInstanceDto | undefined>;
  createServiceAsset(tenantId: string, input: CreateServiceAssetDto): Promise<ServiceAssetDto>;
  updateServiceAsset(tenantId: string, serviceAssetId: string, input: UpdateServiceAssetDto): Promise<ServiceAssetDto>;
  deleteServiceAsset(tenantId: string, serviceAssetId: string): Promise<ServiceAssetDto>;
  listServiceAssets(tenantId: string, query: PageQuery): Promise<PageResult<ServiceAssetDto>>;
  getServiceAsset(tenantId: string, serviceAssetId: string): Promise<ServiceAssetDto | undefined>;
  getServiceAssetDetail(tenantId: string, serviceAssetId: string): Promise<ServiceAssetDetailDto | undefined>;
  getServiceAssetIncludingDeleted(tenantId: string, serviceAssetId: string): Promise<ServiceAssetDto | undefined>;
  findServiceAssetByIdentity(tenantId: string, input: { address: string; port: number; protocol: string }): Promise<ServiceAssetDto | undefined>;
  createServiceEndpoint(tenantId: string, input: CreateServiceEndpointDto): Promise<ServiceEndpointDto>;
  updateServiceEndpoint(tenantId: string, serviceEndpointId: string, input: UpdateServiceEndpointDto): Promise<ServiceEndpointDto>;
  deleteServiceEndpoint(tenantId: string, serviceEndpointId: string): Promise<ServiceEndpointDto>;
  listServiceEndpoints(tenantId: string, query: PageQuery): Promise<PageResult<ServiceEndpointDto>>;
  getServiceEndpoint(tenantId: string, serviceEndpointId: string): Promise<ServiceEndpointDto | undefined>;
  getServiceEndpointIncludingDeleted(tenantId: string, serviceEndpointId: string): Promise<ServiceEndpointDto | undefined>;
  createSiteAsset(tenantId: string, input: CreateSiteAssetDto): Promise<SiteAssetDto>;
  updateSiteAsset(tenantId: string, siteAssetId: string, input: UpdateSiteAssetDto): Promise<SiteAssetDto>;
  deleteSiteAsset(tenantId: string, siteAssetId: string): Promise<SiteAssetDto>;
  listSiteAssets(tenantId: string, query: PageQuery): Promise<PageResult<SiteAssetDto>>;
  getSiteAsset(tenantId: string, siteAssetId: string): Promise<SiteAssetDto | undefined>;
  getSiteAssetIncludingDeleted(tenantId: string, siteAssetId: string): Promise<SiteAssetDto | undefined>;
  findSiteAssetByIdentity(tenantId: string, input: { agentId?: string; providerType: string; siteKey: string }): Promise<SiteAssetDto | undefined>;
  createManagedTarget(tenantId: string, input: CreateManagedTargetDto): Promise<ManagedTargetDto>;
  updateManagedTarget(tenantId: string, managedTargetId: string, input: UpdateManagedTargetDto): Promise<ManagedTargetDto>;
  deleteManagedTarget(tenantId: string, managedTargetId: string): Promise<ManagedTargetDto>;
  listManagedTargets(tenantId: string, query: PageQuery): Promise<PageResult<ManagedTargetDto>>;
  getManagedTarget(tenantId: string, managedTargetId: string): Promise<ManagedTargetDto | undefined>;
  getManagedTargetIncludingDeleted(tenantId: string, managedTargetId: string): Promise<ManagedTargetDto | undefined>;
  findManagedTargetByIdentity(tenantId: string, input: { agentId: string; providerType: string; targetType: string; targetKey: string }): Promise<ManagedTargetDto | undefined>;
  createApplicationAssetTarget(tenantId: string, input: CreateApplicationAssetTargetDto): Promise<ApplicationAssetTargetSummaryDto>;
  updateApplicationAssetTarget(tenantId: string, targetId: string, input: UpdateApplicationAssetTargetDto): Promise<ApplicationAssetTargetSummaryDto>;
  deleteApplicationAssetTarget(tenantId: string, targetId: string): Promise<ApplicationAssetTargetSummaryDto>;
  getApplicationAssetTarget(tenantId: string, targetId: string): Promise<ApplicationAssetTargetSummaryDto | undefined>;
  getApplicationAssetTargetByApplicationAssetId(tenantId: string, applicationAssetId: string): Promise<ApplicationAssetTargetSummaryDto | undefined>;
  getApplicationAssetTargetDetailByApplicationAssetId(tenantId: string, applicationAssetId: string): Promise<ApplicationAssetTargetDetailDto | undefined>;
  listApplicationAssetTargets(tenantId: string, query: PageQuery): Promise<PageResult<ApplicationAssetTargetSummaryDto>>;
  createManagedTargetSnapshot(tenantId: string, input: CreateManagedTargetSnapshotDto): Promise<ManagedTargetSnapshotDto>;
  listManagedTargetSnapshots(tenantId: string, query: PageQuery): Promise<PageResult<ManagedTargetSnapshotDto>>;
  upsertDiscoverySnapshot(tenantId: string, input: CreateDiscoverySnapshotDto): Promise<DiscoverySnapshotDto>;
  listDiscoverySnapshots(tenantId: string, query: PageQuery): Promise<PageResult<DiscoverySnapshotDto>>;
  createAssetConflict(tenantId: string, input: CreateAssetConflictDto): Promise<AssetConflictDto>;
  listAssetConflicts(tenantId: string, query: PageQuery): Promise<PageResult<AssetConflictDto>>;
  getAssetConflict(tenantId: string, conflictId: string): Promise<AssetConflictDto | undefined>;
  resolveAssetConflict(tenantId: string, input: ResolveAssetConflictDto): Promise<AssetConflictDto>;
}

export class PgAssetsRepository implements AssetsRepository {
  readonly moduleName = 'assets' as const;

  constructor(private readonly db: DatabasePort = new PgliteDatabase()) {}

  async createHost(tenantId: string, input: CreateHostDto): Promise<HostDto> {
    await this.assertNoDuplicateHostCandidate(tenantId, input);
    const now = nowIso();
    const host: HostDto = {
      id: newId('hst'),
      tenantId,
      hostname: input.hostname,
      displayName: input.displayName,
      primaryIp: input.primaryIp,
      ipAddresses: input.ipAddresses ?? [],
      osType: input.osType ?? 'UNKNOWN',
      osName: input.osName,
      osVersion: input.osVersion,
      arch: input.arch,
      environment: input.environment,
      zoneId: input.zoneId,
      ownerId: input.ownerId,
      managementChannels: input.managementChannels ?? [],
      discoverySource: input.discoverySource ?? 'MANUAL',
      lastDiscoveredAt: input.lastDiscoveredAt,
      agentId: input.agentId,
      assetFingerprint: input.assetFingerprint,
      compatibilityLevel: input.compatibilityLevel ?? 'L1',
      managementMode: input.managementMode ?? 'MONITOR_ONLY',
      status: input.status ?? 'ACTIVE',
      tags: input.tags ?? [],
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.db.query(
      `insert into pg_hosts (
         id, tenant_id, hostname, display_name, primary_ip, ip_addresses, os_type, os_name, os_version, arch, environment,
         zone_id, owner_id, management_channels, discovery_source, last_discovered_at, agent_id, asset_fingerprint,
         compatibility_level, management_mode, status, tags, created_at, updated_at, version
       ) values (
         $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16::timestamptz, $17, $18, $19, $20, $21, $22::jsonb, $23::timestamptz, $24::timestamptz, $25
       )`,
      [
        host.id, tenantId, host.hostname ?? null, host.displayName ?? null, host.primaryIp ?? null, JSON.stringify(host.ipAddresses),
        host.osType, host.osName ?? null, host.osVersion ?? null, host.arch ?? null, host.environment ?? null,
        host.zoneId ?? null, host.ownerId ?? null, JSON.stringify(host.managementChannels), host.discoverySource, host.lastDiscoveredAt ?? null,
        host.agentId ?? null, host.assetFingerprint ?? null, host.compatibilityLevel, host.managementMode, host.status, JSON.stringify(host.tags), host.createdAt, host.updatedAt, host.version,
      ],
    );
    return host;
  }

  async updateHost(tenantId: string, hostId: string, input: UpdateHostDto): Promise<HostDto> {
    const current = await this.getHost(tenantId, hostId);
    if (!current) {
      throw new AppError('RESOURCE_NOT_FOUND', 'Host 不存在', { hostId });
    }
    await this.assertNoDuplicateHostCandidate(tenantId, input, hostId);
    const merged = { ...current, ...input };
    if (!merged.hostname && !merged.primaryIp && merged.ipAddresses.length === 0) {
      throw new AppError('VALIDATION_FAILED', 'hostname、primaryIp 或 ipAddresses 至少保留一个', { fields: ['hostname', 'primaryIp', 'ipAddresses'] });
    }
    const updated = touch(merged);
    await this.db.query(`update pg_hosts set hostname = $2, display_name = $3, primary_ip = $4, ip_addresses = $5::jsonb, os_type = $6, os_name = $7, os_version = $8, arch = $9, environment = $10, zone_id = $11, owner_id = $12, management_channels = $13::jsonb, discovery_source = $14, last_discovered_at = $15::timestamptz, agent_id = $16, asset_fingerprint = $17, compatibility_level = $18, management_mode = $19, status = $20, tags = $21::jsonb, updated_at = $22::timestamptz, version = $23 where id = $1`, [
      updated.id, updated.hostname ?? null, updated.displayName ?? null, updated.primaryIp ?? null, JSON.stringify(updated.ipAddresses), updated.osType, updated.osName ?? null, updated.osVersion ?? null, updated.arch ?? null, updated.environment ?? null, updated.zoneId ?? null, updated.ownerId ?? null, JSON.stringify(updated.managementChannels), updated.discoverySource, updated.lastDiscoveredAt ?? null, updated.agentId ?? null, updated.assetFingerprint ?? null, updated.compatibilityLevel, updated.managementMode, updated.status, JSON.stringify(updated.tags), updated.updatedAt, updated.version,
    ]);
    return updated;
  }

  async deleteHost(tenantId: string, hostId: string): Promise<HostDto> {
    const current = await this.getHost(tenantId, hostId);
    if (!current) {
      throw new AppError('RESOURCE_NOT_FOUND', 'Host 不存在', { hostId });
    }
    const deleted = softDelete({ ...current, status: 'DELETED' as const });
    await this.db.query(`update pg_hosts set status = $2, deleted_at = $3::timestamptz, updated_at = $4::timestamptz, version = $5 where id = $1`, [deleted.id, deleted.status, deleted.deletedAt ?? null, deleted.updatedAt, deleted.version]);
    return deleted;
  }

  async listHosts(tenantId: string, query: PageQuery): Promise<PageResult<HostDto>> {
    const rows = (await this.db.query<HostRow>(`select * from pg_hosts where tenant_id = $1 and deleted_at is null`, [tenantId])).rows.map(toHost);
    return page(rows, query, hostFilter);
  }

  async getHost(tenantId: string, hostId: string): Promise<HostDto | undefined> {
    const host = await this.getHostIncludingDeleted(tenantId, hostId);
    return host?.deletedAt ? undefined : host;
  }

  async getHostIncludingDeleted(tenantId: string, hostId: string): Promise<HostDto | undefined> {
    const result = await this.db.query<HostRow>(`select * from pg_hosts where id = $1 and tenant_id = $2`, [hostId, tenantId]);
    return result.rows[0] ? toHost(result.rows[0]) : undefined;
  }

  async findHostByHostname(tenantId: string, hostname: string): Promise<HostDto | undefined> {
    const normalized = hostname.trim().toLowerCase();
    const result = await this.db.query<HostRow>(`select * from pg_hosts where tenant_id = $1 and deleted_at is null and lower(hostname) = $2 limit 1`, [tenantId, normalized]);
    return result.rows[0] ? toHost(result.rows[0]) : undefined;
  }

  async createServiceInstance(tenantId: string, input: CreateServiceInstanceDto): Promise<ServiceInstanceDto> {
    if (input.hostId && !await this.getHost(tenantId, input.hostId)) {
      throw new AppError('RESOURCE_NOT_FOUND', 'Host 不存在', { hostId: input.hostId });
    }
    const now = nowIso();
    const serviceInstance: ServiceInstanceDto = {
      id: newId('svc'),
      tenantId,
      hostId: input.hostId,
      providerType: input.providerType,
      serviceName: input.serviceName,
      displayName: input.displayName,
      versionText: input.versionText,
      installPath: input.installPath,
      configPath: input.configPath,
      runtimeUser: input.runtimeUser,
      ports: input.ports ?? [],
      providerKey: input.providerKey,
      manualOverrides: input.manualOverrides ?? {},
      discoverySource: input.discoverySource ?? 'MANUAL',
      lastDiscoveredAt: input.lastDiscoveredAt,
      status: input.status ?? 'ACTIVE',
      rawFacts: input.rawFacts ?? {},
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.db.query(`insert into pg_service_instances (id, tenant_id, host_id, provider_type, service_name, display_name, version_text, install_path, config_path, runtime_user, ports, provider_key, manual_overrides, discovery_source, last_discovered_at, status, raw_facts, created_at, updated_at, version) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13::jsonb,$14,$15::timestamptz,$16,$17::jsonb,$18::timestamptz,$19::timestamptz,$20)`, [
      serviceInstance.id, tenantId, serviceInstance.hostId ?? null, serviceInstance.providerType, serviceInstance.serviceName ?? null, serviceInstance.displayName, serviceInstance.versionText ?? null, serviceInstance.installPath ?? null, serviceInstance.configPath ?? null, serviceInstance.runtimeUser ?? null, JSON.stringify(serviceInstance.ports), serviceInstance.providerKey ?? null, JSON.stringify(serviceInstance.manualOverrides), serviceInstance.discoverySource, serviceInstance.lastDiscoveredAt ?? null, serviceInstance.status, JSON.stringify(serviceInstance.rawFacts), serviceInstance.createdAt, serviceInstance.updatedAt, serviceInstance.version,
    ]);
    return serviceInstance;
  }

  async updateServiceInstance(tenantId: string, serviceInstanceId: string, input: UpdateServiceInstanceDto): Promise<ServiceInstanceDto> {
    const current = await this.getServiceInstance(tenantId, serviceInstanceId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceInstance 不存在', { serviceInstanceId });
    if (input.hostId && !await this.getHost(tenantId, input.hostId)) throw new AppError('RESOURCE_NOT_FOUND', 'Host 不存在', { hostId: input.hostId });
    const updated = touch({ ...current, ...input, hostId: input.hostId ?? current.hostId });
    await this.db.query(`update pg_service_instances set host_id=$2, provider_type=$3, service_name=$4, display_name=$5, version_text=$6, install_path=$7, config_path=$8, runtime_user=$9, ports=$10::jsonb, provider_key=$11, manual_overrides=$12::jsonb, discovery_source=$13, last_discovered_at=$14::timestamptz, status=$15, raw_facts=$16::jsonb, updated_at=$17::timestamptz, version=$18 where id=$1`, [
      updated.id, updated.hostId ?? null, updated.providerType, updated.serviceName ?? null, updated.displayName, updated.versionText ?? null, updated.installPath ?? null, updated.configPath ?? null, updated.runtimeUser ?? null, JSON.stringify(updated.ports), updated.providerKey ?? null, JSON.stringify(updated.manualOverrides), updated.discoverySource, updated.lastDiscoveredAt ?? null, updated.status, JSON.stringify(updated.rawFacts), updated.updatedAt, updated.version,
    ]);
    return updated;
  }

  async deleteServiceInstance(tenantId: string, serviceInstanceId: string): Promise<ServiceInstanceDto> {
    const current = await this.getServiceInstance(tenantId, serviceInstanceId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceInstance 不存在', { serviceInstanceId });
    const deleted = softDelete({ ...current, status: 'DELETED' as const });
    await this.db.query(`update pg_service_instances set status=$2, deleted_at=$3::timestamptz, updated_at=$4::timestamptz, version=$5 where id=$1`, [deleted.id, deleted.status, deleted.deletedAt ?? null, deleted.updatedAt, deleted.version]);
    return deleted;
  }

  async listServiceInstances(tenantId: string, query: PageQuery): Promise<PageResult<ServiceInstanceDto>> {
    const rows = (await this.db.query<ServiceInstanceRow>(`select * from pg_service_instances where tenant_id = $1 and deleted_at is null`, [tenantId])).rows.map(toServiceInstance);
    return page(rows, query, serviceInstanceFilter);
  }

  async getServiceInstance(tenantId: string, serviceInstanceId: string): Promise<ServiceInstanceDto | undefined> {
    const row = (await this.db.query<ServiceInstanceRow>(`select * from pg_service_instances where id = $1 and tenant_id = $2 and deleted_at is null`, [serviceInstanceId, tenantId])).rows[0];
    return row ? toServiceInstance(row) : undefined;
  }

  async getServiceInstanceIncludingDeleted(tenantId: string, serviceInstanceId: string): Promise<ServiceInstanceDto | undefined> {
    const row = (await this.db.query<ServiceInstanceRow>(`select * from pg_service_instances where id = $1 and tenant_id = $2`, [serviceInstanceId, tenantId])).rows[0];
    return row ? toServiceInstance(row) : undefined;
  }

  async findServiceInstanceByIdentity(tenantId: string, input: { hostId?: string; providerType: string; serviceName?: string; configPath?: string; providerKey?: string }): Promise<ServiceInstanceDto | undefined> {
    const serviceName = input.serviceName?.trim().toLowerCase();
    const configPath = input.configPath?.trim();
    const providerKey = input.providerKey?.trim();
    const rows = (await this.db.query<ServiceInstanceRow>(`select * from pg_service_instances where tenant_id = $1 and deleted_at is null and provider_type = $2 and coalesce(host_id, '') = coalesce($3, '')`, [tenantId, input.providerType, input.hostId ?? null])).rows.map(toServiceInstance);
    return rows.find((service) => {
      if (providerKey) return (service.providerKey ?? '') === providerKey;
      if (serviceName) return (service.serviceName ?? '').toLowerCase() === serviceName;
      if (configPath) return service.configPath === configPath;
      return service.serviceName === undefined && service.configPath === undefined;
    });
  }

  async createServiceAsset(tenantId: string, input: CreateServiceAssetDto): Promise<ServiceAssetDto> {
    if (input.serviceInstanceId && !await this.getServiceInstance(tenantId, input.serviceInstanceId)) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceInstance 不存在', { serviceInstanceId: input.serviceInstanceId });
    if (input.serviceEndpointId && !await this.getServiceEndpoint(tenantId, input.serviceEndpointId)) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceEndpoint 不存在', { serviceEndpointId: input.serviceEndpointId });
    if (input.hostId && !await this.getHost(tenantId, input.hostId)) throw new AppError('RESOURCE_NOT_FOUND', 'Host 不存在', { hostId: input.hostId });
    const duplicate = await this.findServiceAssetByIdentity(tenantId, input);
    if (duplicate) throw new AppError('RESOURCE_ALREADY_EXISTS', 'ServiceAsset 已存在', { serviceAssetId: duplicate.id, address: input.address, port: input.port, protocol: input.protocol });
    const now = nowIso();
    const metadata = withServiceAssetVerifyUrl(
      input.deploymentStrategy
        ? writeDeploymentStrategyMetadata(input.metadata ?? {}, input.deploymentStrategy)
        : input.metadata ?? {},
      input.verifyUrl,
    );
    const asset: ServiceAssetDto = {
      id: newId('sat'),
      tenantId,
      address: input.address,
      addressType: input.addressType ?? 'UNKNOWN',
      port: input.port,
      protocol: input.protocol,
      platform: input.platform,
      agentId: input.agentId,
      sniName: input.sniName,
      verifyUrl: readServiceAssetVerifyUrl(metadata),
      displayName: input.displayName,
      serviceInstanceId: input.serviceInstanceId,
      serviceEndpointId: input.serviceEndpointId,
      hostId: input.hostId,
      environment: input.environment,
      discoverySource: input.discoverySource ?? 'MANUAL',
      lastDiscoveredAt: input.lastDiscoveredAt,
      status: input.status ?? 'ACTIVE',
      tags: input.tags ?? [],
      metadata,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.db.query(`insert into pg_service_assets (id, tenant_id, address, address_type, port, protocol, platform, agent_id, sni_name, display_name, service_instance_id, service_endpoint_id, host_id, environment, discovery_source, last_discovered_at, status, tags, metadata, created_at, updated_at, version) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::timestamptz,$17,$18::jsonb,$19::jsonb,$20::timestamptz,$21::timestamptz,$22)`, [
      asset.id, tenantId, asset.address, asset.addressType, asset.port, asset.protocol, asset.platform ?? null, asset.agentId ?? null, asset.sniName ?? null, asset.displayName ?? null, asset.serviceInstanceId ?? null, asset.serviceEndpointId ?? null, asset.hostId ?? null, asset.environment ?? null, asset.discoverySource, asset.lastDiscoveredAt ?? null, asset.status, JSON.stringify(asset.tags), JSON.stringify(asset.metadata), asset.createdAt, asset.updatedAt, asset.version,
    ]);
    if (input.targetBinding) {
      await this.createApplicationAssetTarget(tenantId, {
        ...input.targetBinding,
        applicationAssetId: asset.id,
      });
    }
    return (await this.getServiceAsset(tenantId, asset.id)) ?? asset;
  }

  async updateServiceAsset(tenantId: string, serviceAssetId: string, input: UpdateServiceAssetDto): Promise<ServiceAssetDto> {
    const current = await this.getServiceAsset(tenantId, serviceAssetId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceAsset 不存在', { serviceAssetId });
    if (input.serviceInstanceId && !await this.getServiceInstance(tenantId, input.serviceInstanceId)) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceInstance 不存在', { serviceInstanceId: input.serviceInstanceId });
    if (input.serviceEndpointId && !await this.getServiceEndpoint(tenantId, input.serviceEndpointId)) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceEndpoint 不存在', { serviceEndpointId: input.serviceEndpointId });
    if (input.hostId && !await this.getHost(tenantId, input.hostId)) throw new AppError('RESOURCE_NOT_FOUND', 'Host 不存在', { hostId: input.hostId });
    const { targetBinding: _ignoredTargetBinding, ...assetPatch } = input;
    const merged = { ...current, ...assetPatch };
    const duplicate = await this.findServiceAssetByIdentity(tenantId, merged);
    if (duplicate && duplicate.id !== current.id) throw new AppError('RESOURCE_ALREADY_EXISTS', 'ServiceAsset 已存在', { serviceAssetId: duplicate.id, address: merged.address, port: merged.port, protocol: merged.protocol });
    const metadata = withServiceAssetVerifyUrl(
      input.deploymentStrategy
        ? writeDeploymentStrategyMetadata(assetPatch.metadata ?? current.metadata, input.deploymentStrategy)
        : assetPatch.metadata ?? current.metadata,
      assetPatch.verifyUrl,
    );
    const updated = touch({ ...merged, metadata, verifyUrl: readServiceAssetVerifyUrl(metadata) });
    await this.db.query(`update pg_service_assets set address=$2, address_type=$3, port=$4, protocol=$5, platform=$6, agent_id=$7, sni_name=$8, display_name=$9, service_instance_id=$10, service_endpoint_id=$11, host_id=$12, environment=$13, discovery_source=$14, last_discovered_at=$15::timestamptz, status=$16, tags=$17::jsonb, metadata=$18::jsonb, updated_at=$19::timestamptz, version=$20 where id=$1`, [
      updated.id, updated.address, updated.addressType, updated.port, updated.protocol, updated.platform ?? null, updated.agentId ?? null, updated.sniName ?? null, updated.displayName ?? null, updated.serviceInstanceId ?? null, updated.serviceEndpointId ?? null, updated.hostId ?? null, updated.environment ?? null, updated.discoverySource, updated.lastDiscoveredAt ?? null, updated.status, JSON.stringify(updated.tags), JSON.stringify(updated.metadata), updated.updatedAt, updated.version,
    ]);
    if (input.targetBinding) {
      const currentBinding = await this.getApplicationAssetTargetByApplicationAssetId(tenantId, serviceAssetId);
      if (currentBinding) {
        await this.updateApplicationAssetTarget(tenantId, currentBinding.id, {
          ...input.targetBinding,
          applicationAssetId: serviceAssetId,
        });
      } else {
        await this.createApplicationAssetTarget(tenantId, {
          ...input.targetBinding,
          applicationAssetId: serviceAssetId,
        });
      }
    }
    return (await this.getServiceAsset(tenantId, serviceAssetId)) ?? updated;
  }

  async deleteServiceAsset(tenantId: string, serviceAssetId: string): Promise<ServiceAssetDto> {
    const current = await this.getServiceAsset(tenantId, serviceAssetId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceAsset 不存在', { serviceAssetId });
    const targetBinding = await this.getApplicationAssetTargetByApplicationAssetId(tenantId, serviceAssetId);
    if (targetBinding) await this.deleteApplicationAssetTarget(tenantId, targetBinding.id);
    const deleted = softDelete({ ...current, status: 'DELETED' as const });
    await this.db.query(`update pg_service_assets set status=$2, deleted_at=$3::timestamptz, updated_at=$4::timestamptz, version=$5 where id=$1`, [deleted.id, deleted.status, deleted.deletedAt ?? null, deleted.updatedAt, deleted.version]);
    return deleted;
  }

  async listServiceAssets(tenantId: string, query: PageQuery): Promise<PageResult<ServiceAssetDto>> {
    const rows = (await this.db.query<ServiceAssetRow>(`select * from pg_service_assets where tenant_id = $1 and deleted_at is null`, [tenantId])).rows.map(toServiceAsset);
    const enriched = await Promise.all(rows.map((row) => this.attachTargetBindingSummary(tenantId, row)));
    return page(enriched, query, serviceAssetFilter);
  }

  async getServiceAsset(tenantId: string, serviceAssetId: string): Promise<ServiceAssetDto | undefined> {
    const asset = await this.getServiceAssetIncludingDeleted(tenantId, serviceAssetId);
    return asset?.deletedAt ? undefined : asset;
  }

  async getServiceAssetDetail(tenantId: string, serviceAssetId: string): Promise<ServiceAssetDetailDto | undefined> {
    const asset = await this.getServiceAsset(tenantId, serviceAssetId);
    if (!asset) return undefined;
    const targetBindingDetail = await this.getApplicationAssetTargetDetailByApplicationAssetId(tenantId, serviceAssetId);
    const targetSnapshots = (await this.listManagedTargetSnapshots(tenantId, {
      page: 1,
      pageSize: 50,
      filter: { applicationAssetId: serviceAssetId },
      sort: { field: 'capturedAt', direction: 'desc' },
    })).items;
    return { ...asset, targetBindingDetail, targetSnapshots };
  }

  async getServiceAssetIncludingDeleted(tenantId: string, serviceAssetId: string): Promise<ServiceAssetDto | undefined> {
    const row = (await this.db.query<ServiceAssetRow>(`select * from pg_service_assets where id = $1 and tenant_id = $2`, [serviceAssetId, tenantId])).rows[0];
    return row ? this.attachTargetBindingSummary(tenantId, toServiceAsset(row)) : undefined;
  }

  async findServiceAssetByIdentity(tenantId: string, input: { address: string; port: number; protocol: string }): Promise<ServiceAssetDto | undefined> {
    const row = (await this.db.query<ServiceAssetRow>(`select * from pg_service_assets where tenant_id = $1 and deleted_at is null and address = $2 and port = $3 and protocol = $4 limit 1`, [tenantId, input.address.toLowerCase(), input.port, input.protocol])).rows[0];
    return row ? toServiceAsset(row) : undefined;
  }

  async createServiceEndpoint(tenantId: string, input: CreateServiceEndpointDto): Promise<ServiceEndpointDto> {
    const serviceInstance = await this.getServiceInstance(tenantId, input.serviceInstanceId);
    if (!serviceInstance) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceInstance 不存在', { serviceInstanceId: input.serviceInstanceId });
    const now = nowIso();
    const endpoint: ServiceEndpointDto = {
      id: newId('sep'),
      tenantId,
      serviceInstanceId: input.serviceInstanceId,
      hostId: serviceInstance.hostId,
      protocol: input.protocol,
      hostName: input.hostName,
      listenIp: input.listenIp,
      port: input.port,
      pathHint: input.pathHint,
      status: input.status ?? 'ACTIVE',
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.db.query(`insert into pg_service_endpoints (id, tenant_id, service_instance_id, host_id, protocol, host_name, listen_ip, port, path_hint, status, created_at, updated_at, version) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz,$12::timestamptz,$13)`, [
      endpoint.id, tenantId, endpoint.serviceInstanceId, endpoint.hostId ?? null, endpoint.protocol, endpoint.hostName ?? null, endpoint.listenIp ?? null, endpoint.port, endpoint.pathHint ?? null, endpoint.status, endpoint.createdAt, endpoint.updatedAt, endpoint.version,
    ]);
    return endpoint;
  }

  async updateServiceEndpoint(tenantId: string, serviceEndpointId: string, input: UpdateServiceEndpointDto): Promise<ServiceEndpointDto> {
    const current = await this.getServiceEndpoint(tenantId, serviceEndpointId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceEndpoint 不存在', { serviceEndpointId });
    let nextHostId = current.hostId;
    if (input.serviceInstanceId && input.serviceInstanceId !== current.serviceInstanceId) {
      const serviceInstance = await this.getServiceInstance(tenantId, input.serviceInstanceId);
      if (!serviceInstance) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceInstance 不存在', { serviceInstanceId: input.serviceInstanceId });
      nextHostId = serviceInstance.hostId;
    }
    const updated = touch({ ...current, ...input, hostId: nextHostId });
    await this.db.query(`update pg_service_endpoints set service_instance_id=$2, host_id=$3, protocol=$4, host_name=$5, listen_ip=$6, port=$7, path_hint=$8, status=$9, updated_at=$10::timestamptz, version=$11 where id=$1`, [
      updated.id, updated.serviceInstanceId, updated.hostId ?? null, updated.protocol, updated.hostName ?? null, updated.listenIp ?? null, updated.port, updated.pathHint ?? null, updated.status, updated.updatedAt, updated.version,
    ]);
    return updated;
  }

  async deleteServiceEndpoint(tenantId: string, serviceEndpointId: string): Promise<ServiceEndpointDto> {
    const current = await this.getServiceEndpoint(tenantId, serviceEndpointId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceEndpoint 不存在', { serviceEndpointId });
    const deleted = softDelete(current);
    await this.db.query(`update pg_service_endpoints set deleted_at=$2::timestamptz, updated_at=$3::timestamptz, version=$4 where id=$1`, [deleted.id, deleted.deletedAt ?? null, deleted.updatedAt, deleted.version]);
    return deleted;
  }

  async listServiceEndpoints(tenantId: string, query: PageQuery): Promise<PageResult<ServiceEndpointDto>> {
    const rows = (await this.db.query<ServiceEndpointRow>(`select * from pg_service_endpoints where tenant_id = $1 and deleted_at is null`, [tenantId])).rows.map(toServiceEndpoint);
    return page(rows, query, serviceEndpointFilter);
  }

  async getServiceEndpoint(tenantId: string, serviceEndpointId: string): Promise<ServiceEndpointDto | undefined> {
    const row = (await this.db.query<ServiceEndpointRow>(`select * from pg_service_endpoints where id = $1 and tenant_id = $2 and deleted_at is null`, [serviceEndpointId, tenantId])).rows[0];
    return row ? toServiceEndpoint(row) : undefined;
  }

  async getServiceEndpointIncludingDeleted(tenantId: string, serviceEndpointId: string): Promise<ServiceEndpointDto | undefined> {
    const row = (await this.db.query<ServiceEndpointRow>(`select * from pg_service_endpoints where id = $1 and tenant_id = $2`, [serviceEndpointId, tenantId])).rows[0];
    return row ? toServiceEndpoint(row) : undefined;
  }

  async createSiteAsset(tenantId: string, input: CreateSiteAssetDto): Promise<SiteAssetDto> {
    if (!await this.getServiceInstance(tenantId, input.serviceInstanceId)) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceInstance 不存在', { serviceInstanceId: input.serviceInstanceId });
    if (input.serviceAssetId && !await this.getServiceAsset(tenantId, input.serviceAssetId)) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceAsset 不存在', { serviceAssetId: input.serviceAssetId });
    const duplicate = await this.findSiteAssetByIdentity(tenantId, { agentId: input.agentId, providerType: input.providerType, siteKey: input.siteKey });
    if (duplicate) throw new AppError('RESOURCE_ALREADY_EXISTS', 'SiteAsset 已存在', { siteAssetId: duplicate.id, siteKey: input.siteKey });
    const now = nowIso();
    const siteAsset: SiteAssetDto = {
      id: newId('sit'),
      tenantId,
      serviceInstanceId: input.serviceInstanceId,
      serviceAssetId: input.serviceAssetId,
      hostId: input.hostId,
      agentId: input.agentId,
      providerType: input.providerType,
      siteType: input.siteType,
      siteName: input.siteName,
      siteKey: input.siteKey,
      bindingInformation: input.bindingInformation,
      hostHeader: input.hostHeader,
      listenIp: input.listenIp,
      port: input.port,
      protocol: input.protocol,
      configPath: input.configPath,
      runtimeStatus: input.runtimeStatus,
      discoverySource: input.discoverySource ?? 'MANUAL',
      lastDiscoveredAt: input.lastDiscoveredAt,
      status: input.status ?? 'ACTIVE',
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.db.query(`insert into pg_site_assets (
      id, tenant_id, service_instance_id, service_asset_id, host_id, agent_id, provider_type, site_type, site_name, site_key,
      binding_information, host_header, listen_ip, port, protocol, config_path, runtime_status, discovery_source, last_discovered_at,
      status, metadata, created_at, updated_at, version
    ) values (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
      $11,$12,$13,$14,$15,$16,$17,$18,$19::timestamptz,
      $20,$21::jsonb,$22::timestamptz,$23::timestamptz,$24
    )`, [
      siteAsset.id, tenantId, siteAsset.serviceInstanceId, siteAsset.serviceAssetId ?? null, siteAsset.hostId ?? null, siteAsset.agentId ?? null, siteAsset.providerType, siteAsset.siteType, siteAsset.siteName, siteAsset.siteKey,
      siteAsset.bindingInformation ?? null, siteAsset.hostHeader ?? null, siteAsset.listenIp ?? null, siteAsset.port ?? null, siteAsset.protocol ?? null, siteAsset.configPath ?? null, siteAsset.runtimeStatus ?? null, siteAsset.discoverySource, siteAsset.lastDiscoveredAt ?? null,
      siteAsset.status, JSON.stringify(siteAsset.metadata), siteAsset.createdAt, siteAsset.updatedAt, siteAsset.version,
    ]);
    return siteAsset;
  }

  async updateSiteAsset(tenantId: string, siteAssetId: string, input: UpdateSiteAssetDto): Promise<SiteAssetDto> {
    const current = await this.getSiteAsset(tenantId, siteAssetId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'SiteAsset 不存在', { siteAssetId });
    if (input.serviceInstanceId && !await this.getServiceInstance(tenantId, input.serviceInstanceId)) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceInstance 不存在', { serviceInstanceId: input.serviceInstanceId });
    if (input.serviceAssetId && !await this.getServiceAsset(tenantId, input.serviceAssetId)) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceAsset 不存在', { serviceAssetId: input.serviceAssetId });
    if (input.hostId && !await this.getHost(tenantId, input.hostId)) throw new AppError('RESOURCE_NOT_FOUND', 'Host 不存在', { hostId: input.hostId });
    const nextAgentId = input.agentId ?? current.agentId;
    const nextProviderType = input.providerType ?? current.providerType;
    const nextSiteKey = input.siteKey ?? current.siteKey;
    const duplicate = await this.findSiteAssetByIdentity(tenantId, { agentId: nextAgentId, providerType: nextProviderType, siteKey: nextSiteKey });
    if (duplicate && duplicate.id !== current.id) throw new AppError('RESOURCE_ALREADY_EXISTS', 'SiteAsset 已存在', { siteAssetId: duplicate.id, siteKey: nextSiteKey });
    const updated = touch({ ...current, ...input, metadata: input.metadata ?? current.metadata });
    await this.db.query(`update pg_site_assets set service_instance_id=$2, service_asset_id=$3, host_id=$4, agent_id=$5, provider_type=$6, site_type=$7, site_name=$8, site_key=$9, binding_information=$10, host_header=$11, listen_ip=$12, port=$13, protocol=$14, config_path=$15, runtime_status=$16, discovery_source=$17, last_discovered_at=$18::timestamptz, status=$19, metadata=$20::jsonb, updated_at=$21::timestamptz, version=$22 where id=$1`, [
      updated.id, updated.serviceInstanceId, updated.serviceAssetId ?? null, updated.hostId, updated.agentId ?? null, updated.providerType, updated.siteType, updated.siteName, updated.siteKey, updated.bindingInformation ?? null, updated.hostHeader ?? null, updated.listenIp ?? null, updated.port ?? null, updated.protocol ?? null, updated.configPath ?? null, updated.runtimeStatus ?? null, updated.discoverySource, updated.lastDiscoveredAt ?? null, updated.status, JSON.stringify(updated.metadata), updated.updatedAt, updated.version,
    ]);
    return updated;
  }

  async deleteSiteAsset(tenantId: string, siteAssetId: string): Promise<SiteAssetDto> {
    const current = await this.getSiteAsset(tenantId, siteAssetId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'SiteAsset 不存在', { siteAssetId });
    const deleted = softDelete({ ...current, status: 'DELETED' as const });
    await this.db.query(`update pg_site_assets set status=$2, deleted_at=$3::timestamptz, updated_at=$4::timestamptz, version=$5 where id=$1`, [deleted.id, deleted.status, deleted.deletedAt ?? null, deleted.updatedAt, deleted.version]);
    return deleted;
  }

  async listSiteAssets(tenantId: string, query: PageQuery): Promise<PageResult<SiteAssetDto>> {
    const rows = (await this.db.query<SiteAssetRow>(`select * from pg_site_assets where tenant_id = $1 and deleted_at is null`, [tenantId])).rows.map(toSiteAsset);
    return page(rows, query, siteAssetFilter);
  }

  async getSiteAsset(tenantId: string, siteAssetId: string): Promise<SiteAssetDto | undefined> {
    const asset = await this.getSiteAssetIncludingDeleted(tenantId, siteAssetId);
    return asset?.deletedAt ? undefined : asset;
  }

  async getSiteAssetIncludingDeleted(tenantId: string, siteAssetId: string): Promise<SiteAssetDto | undefined> {
    const row = (await this.db.query<SiteAssetRow>(`select * from pg_site_assets where id = $1 and tenant_id = $2`, [siteAssetId, tenantId])).rows[0];
    return row ? toSiteAsset(row) : undefined;
  }

  async findSiteAssetByIdentity(tenantId: string, input: { agentId?: string; providerType: string; siteKey: string }): Promise<SiteAssetDto | undefined> {
    const row = (await this.db.query<SiteAssetRow>(`select * from pg_site_assets where tenant_id = $1 and deleted_at is null and provider_type = $2 and site_key = $3 and coalesce(agent_id, '') = coalesce($4, '') limit 1`, [tenantId, input.providerType, input.siteKey, input.agentId ?? null])).rows[0];
    return row ? toSiteAsset(row) : undefined;
  }

  async createManagedTarget(tenantId: string, input: CreateManagedTargetDto): Promise<ManagedTargetDto> {
    if (input.serviceInstanceId && !await this.getServiceInstance(tenantId, input.serviceInstanceId)) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceInstance 不存在', { serviceInstanceId: input.serviceInstanceId });
    if (input.serviceAssetId && !await this.getServiceAsset(tenantId, input.serviceAssetId)) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceAsset 不存在', { serviceAssetId: input.serviceAssetId });
    if (input.siteAssetId && !await this.getSiteAsset(tenantId, input.siteAssetId)) throw new AppError('RESOURCE_NOT_FOUND', 'SiteAsset 不存在', { siteAssetId: input.siteAssetId });
    const duplicate = await this.findManagedTargetByIdentity(tenantId, { agentId: input.agentId, providerType: input.providerType, targetType: input.targetType, targetKey: input.targetKey });
    if (duplicate) throw new AppError('RESOURCE_ALREADY_EXISTS', 'ManagedTarget 已存在', { managedTargetId: duplicate.id, targetKey: input.targetKey });
    const now = nowIso();
    const target: ManagedTargetDto = {
      id: newId('mtg'),
      tenantId,
      agentId: input.agentId,
      hostId: input.hostId,
      serviceInstanceId: input.serviceInstanceId,
      serviceAssetId: input.serviceAssetId,
      siteAssetId: input.siteAssetId,
      providerType: input.providerType,
      frameworkType: input.frameworkType,
      targetType: input.targetType,
      targetKey: input.targetKey,
      bindingKey: input.bindingKey,
      capabilityProfile: input.capabilityProfile ?? {},
      deploymentMode: input.deploymentMode,
      lastSeenAt: input.lastSeenAt,
      status: input.status ?? 'ACTIVE',
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.db.query(`insert into pg_managed_targets (
      id, tenant_id, agent_id, host_id, service_instance_id, service_asset_id, site_asset_id, provider_type, framework_type,
      target_type, target_key, binding_key, capability_profile, deployment_mode, last_seen_at, status, metadata, created_at, updated_at, version
    ) values (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,
      $10,$11,$12,$13::jsonb,$14,$15::timestamptz,$16,$17::jsonb,$18::timestamptz,$19::timestamptz,$20
    )`, [
      target.id, tenantId, target.agentId, target.hostId ?? null, target.serviceInstanceId ?? null, target.serviceAssetId ?? null, target.siteAssetId ?? null, target.providerType, target.frameworkType,
      target.targetType, target.targetKey, target.bindingKey ?? null, JSON.stringify(target.capabilityProfile), target.deploymentMode ?? null, target.lastSeenAt ?? null, target.status, JSON.stringify(target.metadata), target.createdAt, target.updatedAt, target.version,
    ]);
    return target;
  }

  async updateManagedTarget(tenantId: string, managedTargetId: string, input: UpdateManagedTargetDto): Promise<ManagedTargetDto> {
    const current = await this.getManagedTarget(tenantId, managedTargetId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'ManagedTarget 不存在', { managedTargetId });
    if (input.hostId && !await this.getHost(tenantId, input.hostId)) throw new AppError('RESOURCE_NOT_FOUND', 'Host 不存在', { hostId: input.hostId });
    if (input.serviceInstanceId && !await this.getServiceInstance(tenantId, input.serviceInstanceId)) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceInstance 不存在', { serviceInstanceId: input.serviceInstanceId });
    if (input.serviceAssetId && !await this.getServiceAsset(tenantId, input.serviceAssetId)) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceAsset 不存在', { serviceAssetId: input.serviceAssetId });
    if (input.siteAssetId && !await this.getSiteAsset(tenantId, input.siteAssetId)) throw new AppError('RESOURCE_NOT_FOUND', 'SiteAsset 不存在', { siteAssetId: input.siteAssetId });
    const nextAgentId = input.agentId ?? current.agentId;
    const nextProviderType = input.providerType ?? current.providerType;
    const nextTargetType = input.targetType ?? current.targetType;
    const nextTargetKey = input.targetKey ?? current.targetKey;
    const duplicate = await this.findManagedTargetByIdentity(tenantId, { agentId: nextAgentId, providerType: nextProviderType, targetType: nextTargetType, targetKey: nextTargetKey });
    if (duplicate && duplicate.id !== current.id) throw new AppError('RESOURCE_ALREADY_EXISTS', 'ManagedTarget 已存在', { managedTargetId: duplicate.id, targetKey: nextTargetKey });
    const updated = touch({ ...current, ...input, capabilityProfile: input.capabilityProfile ?? current.capabilityProfile, metadata: input.metadata ?? current.metadata });
    await this.db.query(`update pg_managed_targets set agent_id=$2, host_id=$3, service_instance_id=$4, service_asset_id=$5, site_asset_id=$6, provider_type=$7, framework_type=$8, target_type=$9, target_key=$10, binding_key=$11, capability_profile=$12::jsonb, deployment_mode=$13, last_seen_at=$14::timestamptz, status=$15, metadata=$16::jsonb, updated_at=$17::timestamptz, version=$18 where id=$1`, [
      updated.id, updated.agentId, updated.hostId, updated.serviceInstanceId ?? null, updated.serviceAssetId ?? null, updated.siteAssetId ?? null, updated.providerType, updated.frameworkType, updated.targetType, updated.targetKey, updated.bindingKey ?? null, JSON.stringify(updated.capabilityProfile), updated.deploymentMode ?? null, updated.lastSeenAt ?? null, updated.status, JSON.stringify(updated.metadata), updated.updatedAt, updated.version,
    ]);
    return updated;
  }

  async deleteManagedTarget(tenantId: string, managedTargetId: string): Promise<ManagedTargetDto> {
    const current = await this.getManagedTarget(tenantId, managedTargetId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'ManagedTarget 不存在', { managedTargetId });
    const deleted = softDelete({ ...current, status: 'DELETED' as const });
    await this.db.query(`update pg_managed_targets set status=$2, deleted_at=$3::timestamptz, updated_at=$4::timestamptz, version=$5 where id=$1`, [deleted.id, deleted.status, deleted.deletedAt ?? null, deleted.updatedAt, deleted.version]);
    return deleted;
  }

  async listManagedTargets(tenantId: string, query: PageQuery): Promise<PageResult<ManagedTargetDto>> {
    const rows = (await this.db.query<ManagedTargetRow>(`select * from pg_managed_targets where tenant_id = $1 and deleted_at is null`, [tenantId])).rows.map(toManagedTarget);
    return page(rows, query, managedTargetFilter);
  }

  async getManagedTarget(tenantId: string, managedTargetId: string): Promise<ManagedTargetDto | undefined> {
    const target = await this.getManagedTargetIncludingDeleted(tenantId, managedTargetId);
    return target?.deletedAt ? undefined : target;
  }

  async getManagedTargetIncludingDeleted(tenantId: string, managedTargetId: string): Promise<ManagedTargetDto | undefined> {
    const row = (await this.db.query<ManagedTargetRow>(`select * from pg_managed_targets where id = $1 and tenant_id = $2`, [managedTargetId, tenantId])).rows[0];
    return row ? toManagedTarget(row) : undefined;
  }

  async findManagedTargetByIdentity(tenantId: string, input: { agentId: string; providerType: string; targetType: string; targetKey: string }): Promise<ManagedTargetDto | undefined> {
    const row = (await this.db.query<ManagedTargetRow>(`select * from pg_managed_targets where tenant_id = $1 and deleted_at is null and agent_id = $2 and provider_type = $3 and target_type = $4 and target_key = $5 limit 1`, [tenantId, input.agentId, input.providerType, input.targetType, input.targetKey])).rows[0];
    return row ? toManagedTarget(row) : undefined;
  }

  async createApplicationAssetTarget(tenantId: string, input: CreateApplicationAssetTargetDto): Promise<ApplicationAssetTargetSummaryDto> {
    if (!await this.getServiceAsset(tenantId, input.applicationAssetId)) throw new AppError('RESOURCE_NOT_FOUND', 'ApplicationAsset 不存在', { applicationAssetId: input.applicationAssetId });
    if (!await this.getSiteAsset(tenantId, input.siteAssetId)) throw new AppError('RESOURCE_NOT_FOUND', 'SiteAsset 不存在', { siteAssetId: input.siteAssetId });
    if (!await this.getManagedTarget(tenantId, input.managedTargetId)) throw new AppError('RESOURCE_NOT_FOUND', 'ManagedTarget 不存在', { managedTargetId: input.managedTargetId });
    const duplicate = await this.getApplicationAssetTargetByApplicationAssetId(tenantId, input.applicationAssetId);
    if (duplicate) throw new AppError('RESOURCE_ALREADY_EXISTS', 'ApplicationAssetTarget 已存在', { applicationAssetTargetId: duplicate.id, applicationAssetId: input.applicationAssetId });
    const now = nowIso();
    const target: ApplicationAssetTargetSummaryDto = {
      id: newId('aat'),
      applicationAssetId: input.applicationAssetId,
      agentId: input.agentId,
      siteAssetId: input.siteAssetId,
      managedTargetId: input.managedTargetId,
      providerType: input.providerType,
      frameworkType: input.frameworkType,
      targetType: input.targetType,
      targetKey: input.targetKey,
      bindingKey: input.bindingKey,
      status: input.status ?? 'ACTIVE',
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.db.query(`insert into pg_application_asset_targets (
      id, tenant_id, application_asset_id, agent_id, site_asset_id, managed_target_id, provider_type, framework_type,
      target_type, target_key, binding_key, status, metadata, created_at, updated_at, version
    ) values (
      $1,$2,$3,$4,$5,$6,$7,$8,
      $9,$10,$11,$12,$13::jsonb,$14::timestamptz,$15::timestamptz,$16
    )`, [
      target.id, tenantId, target.applicationAssetId, target.agentId, target.siteAssetId, target.managedTargetId, target.providerType, target.frameworkType,
      target.targetType, target.targetKey, target.bindingKey ?? null, target.status, JSON.stringify(target.metadata), target.createdAt, target.updatedAt, target.version,
    ]);
    return target;
  }

  async updateApplicationAssetTarget(tenantId: string, targetId: string, input: UpdateApplicationAssetTargetDto): Promise<ApplicationAssetTargetSummaryDto> {
    const current = await this.getApplicationAssetTarget(tenantId, targetId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'ApplicationAssetTarget 不存在', { targetId });
    const next = {
      ...current,
      ...input,
      applicationAssetId: input.applicationAssetId ?? current.applicationAssetId,
      siteAssetId: input.siteAssetId ?? current.siteAssetId,
      managedTargetId: input.managedTargetId ?? current.managedTargetId,
      metadata: input.metadata ?? current.metadata,
    };
    if (!await this.getServiceAsset(tenantId, next.applicationAssetId)) throw new AppError('RESOURCE_NOT_FOUND', 'ApplicationAsset 不存在', { applicationAssetId: next.applicationAssetId });
    if (!await this.getSiteAsset(tenantId, next.siteAssetId)) throw new AppError('RESOURCE_NOT_FOUND', 'SiteAsset 不存在', { siteAssetId: next.siteAssetId });
    if (!await this.getManagedTarget(tenantId, next.managedTargetId)) throw new AppError('RESOURCE_NOT_FOUND', 'ManagedTarget 不存在', { managedTargetId: next.managedTargetId });
    const duplicate = await this.getApplicationAssetTargetByApplicationAssetId(tenantId, next.applicationAssetId);
    if (duplicate && duplicate.id !== current.id) throw new AppError('RESOURCE_ALREADY_EXISTS', 'ApplicationAssetTarget 已存在', { applicationAssetTargetId: duplicate.id, applicationAssetId: next.applicationAssetId });
    const updated = touch(next);
    await this.db.query(`update pg_application_asset_targets set application_asset_id=$2, agent_id=$3, site_asset_id=$4, managed_target_id=$5, provider_type=$6, framework_type=$7, target_type=$8, target_key=$9, binding_key=$10, status=$11, metadata=$12::jsonb, updated_at=$13::timestamptz, version=$14 where id=$1 and tenant_id = $15`, [
      updated.id, updated.applicationAssetId, updated.agentId, updated.siteAssetId, updated.managedTargetId, updated.providerType, updated.frameworkType, updated.targetType, updated.targetKey, updated.bindingKey ?? null, updated.status, JSON.stringify(updated.metadata), updated.updatedAt, updated.version, tenantId,
    ]);
    return updated;
  }

  async deleteApplicationAssetTarget(tenantId: string, targetId: string): Promise<ApplicationAssetTargetSummaryDto> {
    const current = await this.getApplicationAssetTarget(tenantId, targetId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'ApplicationAssetTarget 不存在', { targetId });
    const deleted = softDelete({ ...current, status: 'DELETED' as const });
    await this.db.query(`update pg_application_asset_targets set status=$2, deleted_at=$3::timestamptz, updated_at=$4::timestamptz, version=$5 where id=$1 and tenant_id = $6`, [
      deleted.id, deleted.status, deleted.deletedAt ?? null, deleted.updatedAt, deleted.version, tenantId,
    ]);
    return deleted;
  }

  async getApplicationAssetTarget(tenantId: string, targetId: string): Promise<ApplicationAssetTargetSummaryDto | undefined> {
    const row = (await this.db.query<ApplicationAssetTargetRow>(`select * from pg_application_asset_targets where tenant_id = $1 and id = $2 and deleted_at is null`, [tenantId, targetId])).rows[0];
    return row ? toApplicationAssetTarget(row) : undefined;
  }

  async getApplicationAssetTargetByApplicationAssetId(tenantId: string, applicationAssetId: string): Promise<ApplicationAssetTargetSummaryDto | undefined> {
    const row = (await this.db.query<ApplicationAssetTargetRow>(`select * from pg_application_asset_targets where tenant_id = $1 and application_asset_id = $2 and deleted_at is null limit 1`, [tenantId, applicationAssetId])).rows[0];
    return row ? toApplicationAssetTarget(row) : undefined;
  }

  async getApplicationAssetTargetDetailByApplicationAssetId(tenantId: string, applicationAssetId: string): Promise<ApplicationAssetTargetDetailDto | undefined> {
    const target = await this.getApplicationAssetTargetByApplicationAssetId(tenantId, applicationAssetId);
    if (!target) return undefined;
    const siteAsset = await this.getSiteAssetIncludingDeleted(tenantId, target.siteAssetId);
    const managedTarget = await this.getManagedTargetIncludingDeleted(tenantId, target.managedTargetId);
    const certificateBindings = (await this.db.query<any>(`select * from pg_certificate_bindings where tenant_id = $1 and deleted_at is null and (site_asset_id = $2 or managed_target_id = $3)`, [tenantId, target.siteAssetId, target.managedTargetId])).rows.map((row) => ({
      id: row.id,
      serviceAssetId: row.service_asset_id ?? undefined,
      siteAssetId: row.site_asset_id ?? undefined,
      managedTargetId: row.managed_target_id ?? undefined,
      domain: row.domain ?? undefined,
      domainName: row.domain_name ?? undefined,
      bindingKey: row.binding_key,
      bindingType: row.binding_type,
      status: row.status,
      certificateVersionId: row.certificate_version_id ?? undefined,
      targetCertificateVersionId: row.target_certificate_version_id ?? undefined,
      observedFingerprintSha256: row.observed_fingerprint_sha256 ?? undefined,
      desiredFingerprintSha256: row.desired_fingerprint_sha256 ?? undefined,
      targetFingerprintSha256: row.target_fingerprint_sha256 ?? undefined,
      storeThumbprint: row.store_thumbprint ?? undefined,
      lastVerifiedAt: row.last_verified_at ?? undefined,
      lastDeployedAt: row.last_deployed_at ?? undefined,
    }));
    return {
      ...target,
      siteAsset: siteAsset ?? undefined,
      managedTarget: managedTarget ?? undefined,
      certificateBindings,
    };
  }

  async listApplicationAssetTargets(tenantId: string, query: PageQuery): Promise<PageResult<ApplicationAssetTargetSummaryDto>> {
    const rows = (await this.db.query<ApplicationAssetTargetRow>(`select * from pg_application_asset_targets where tenant_id = $1 and deleted_at is null`, [tenantId])).rows.map(toApplicationAssetTarget);
    return page(rows, query, applicationAssetTargetFilter);
  }

  async createManagedTargetSnapshot(tenantId: string, input: CreateManagedTargetSnapshotDto): Promise<ManagedTargetSnapshotDto> {
    const now = nowIso();
    const snapshot: ManagedTargetSnapshotDto = {
      id: newId('mts'),
      tenantId,
      applicationAssetId: input.applicationAssetId,
      siteAssetId: input.siteAssetId,
      managedTargetId: input.managedTargetId,
      certificateBindingId: input.certificateBindingId,
      executionRunId: input.executionRunId,
      executionStepId: input.executionStepId,
      bindingInformation: input.bindingInformation,
      hostHeader: input.hostHeader,
      port: input.port,
      storeLocation: input.storeLocation,
      storeName: input.storeName,
      storeThumbprint: input.storeThumbprint,
      certificateVersionId: input.certificateVersionId,
      fingerprintSha256: input.fingerprintSha256,
      snapshotType: input.snapshotType,
      status: input.status ?? 'UNKNOWN',
      metadata: input.metadata ?? {},
      capturedAt: input.capturedAt ?? now,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.db.query(`insert into pg_managed_target_snapshots (
      id, tenant_id, application_asset_id, site_asset_id, managed_target_id, certificate_binding_id, execution_run_id, execution_step_id,
      binding_information, host_header, port, store_location, store_name, store_thumbprint, certificate_version_id, fingerprint_sha256,
      snapshot_type, status, metadata, captured_at, created_at, updated_at, version
    ) values (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20::timestamptz,$21::timestamptz,$22::timestamptz,$23
    )`, [
      snapshot.id, tenantId, snapshot.applicationAssetId ?? null, snapshot.siteAssetId ?? null, snapshot.managedTargetId ?? null, snapshot.certificateBindingId ?? null,
      snapshot.executionRunId ?? null, snapshot.executionStepId ?? null, snapshot.bindingInformation ?? null, snapshot.hostHeader ?? null, snapshot.port ?? null,
      snapshot.storeLocation ?? null, snapshot.storeName ?? null, snapshot.storeThumbprint ?? null, snapshot.certificateVersionId ?? null, snapshot.fingerprintSha256 ?? null,
      snapshot.snapshotType, snapshot.status, JSON.stringify(snapshot.metadata), snapshot.capturedAt, snapshot.createdAt, snapshot.updatedAt, snapshot.version,
    ]);
    return snapshot;
  }

  async listManagedTargetSnapshots(tenantId: string, query: PageQuery): Promise<PageResult<ManagedTargetSnapshotDto>> {
    const rows = (await this.db.query<ManagedTargetSnapshotRow>(`select * from pg_managed_target_snapshots where tenant_id = $1`, [tenantId])).rows.map(toManagedTargetSnapshot);
    return page(rows, query, managedTargetSnapshotFilter);
  }

  async upsertDiscoverySnapshot(tenantId: string, input: CreateDiscoverySnapshotDto): Promise<DiscoverySnapshotDto> {
    const duplicate = (await this.listDiscoverySnapshots(tenantId, { page: 1, pageSize: 1, filter: { normalizedHash: input.normalizedHash }, sort: undefined })).items[0];
    if (duplicate) return duplicate;
    const now = nowIso();
    const snapshot: DiscoverySnapshotDto = {
      id: newId('dsc'),
      tenantId,
      normalizedHash: input.normalizedHash,
      source: input.source ?? 'MANUAL',
      normalizedPayload: input.normalizedPayload ?? {},
      rawPayload: input.rawPayload,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.db.query(`insert into pg_discovery_snapshots (id, tenant_id, normalized_hash, source, normalized_payload, raw_payload, created_at, updated_at, version) values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::timestamptz,$8::timestamptz,$9)`, [
      snapshot.id, tenantId, snapshot.normalizedHash, snapshot.source, JSON.stringify(snapshot.normalizedPayload), JSON.stringify(snapshot.rawPayload ?? null), snapshot.createdAt, snapshot.updatedAt, snapshot.version,
    ]);
    return snapshot;
  }

  async listDiscoverySnapshots(tenantId: string, query: PageQuery): Promise<PageResult<DiscoverySnapshotDto>> {
    const rows = (await this.db.query<DiscoverySnapshotRow>(`select * from pg_discovery_snapshots where tenant_id = $1`, [tenantId])).rows.map(toDiscoverySnapshot);
    return page(rows, query, discoverySnapshotFilter);
  }

  async createAssetConflict(tenantId: string, input: CreateAssetConflictDto): Promise<AssetConflictDto> {
    const duplicate = (await this.db.query<AssetConflictRow>(`select * from pg_asset_conflicts where tenant_id = $1 and status = 'open' and resource_type = $2 and resource_id = $3 and field = $4 and source_snapshot_id = $5 limit 1`, [tenantId, input.resourceType, input.resourceId, input.field, input.sourceSnapshotId])).rows[0];
    if (duplicate) return toAssetConflict(duplicate);
    const now = nowIso();
    const conflict: AssetConflictDto = {
      id: newId('acf'),
      tenantId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      field: input.field,
      currentValue: input.currentValue,
      discoveredValue: input.discoveredValue,
      sourceSnapshotId: input.sourceSnapshotId,
      status: 'open',
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.db.query(`insert into pg_asset_conflicts (id, tenant_id, resource_type, resource_id, field, current_value, discovered_value, source_snapshot_id, status, created_at, updated_at, version) values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10::timestamptz,$11::timestamptz,$12)`, [
      conflict.id, tenantId, conflict.resourceType, conflict.resourceId, conflict.field, JSON.stringify(conflict.currentValue ?? null), JSON.stringify(conflict.discoveredValue ?? null), conflict.sourceSnapshotId, conflict.status, conflict.createdAt, conflict.updatedAt, conflict.version,
    ]);
    return conflict;
  }

  async listAssetConflicts(tenantId: string, query: PageQuery): Promise<PageResult<AssetConflictDto>> {
    const rows = (await this.db.query<AssetConflictRow>(`select * from pg_asset_conflicts where tenant_id = $1`, [tenantId])).rows.map(toAssetConflict);
    return page(rows, query, assetConflictFilter);
  }

  async getAssetConflict(tenantId: string, conflictId: string): Promise<AssetConflictDto | undefined> {
    const row = (await this.db.query<AssetConflictRow>(`select * from pg_asset_conflicts where tenant_id = $1 and id = $2`, [tenantId, conflictId])).rows[0];
    return row ? toAssetConflict(row) : undefined;
  }

  async resolveAssetConflict(tenantId: string, input: ResolveAssetConflictDto): Promise<AssetConflictDto> {
    const current = await this.getAssetConflict(tenantId, input.id);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'AssetConflict 不存在', { conflictId: input.id });
    if (current.status !== 'open') throw new AppError('VALIDATION_FAILED', 'AssetConflict 已处理，不能重复解决', { conflictId: input.id, status: current.status });
    const now = nowIso();
    const resolved: AssetConflictDto = {
      ...current,
      status: 'resolved',
      resolvedBy: input.resolvedBy,
      resolvedAt: now,
      comment: input.comment,
      updatedAt: now,
      version: current.version + 1,
    };
    await this.db.query(`update pg_asset_conflicts set status=$2, resolved_by=$3, resolved_at=$4::timestamptz, comment=$5, updated_at=$6::timestamptz, version=$7 where id=$1`, [resolved.id, resolved.status, resolved.resolvedBy ?? null, resolved.resolvedAt ?? null, resolved.comment ?? null, resolved.updatedAt, resolved.version]);
    return resolved;
  }

  private async assertNoDuplicateHostCandidate(tenantId: string, input: Partial<CreateHostDto>, excludedId?: string): Promise<void> {
    const normalizedHostname = input.hostname?.trim().toLowerCase();
    const normalizedAgentId = input.agentId?.trim();
    if (!normalizedHostname && !normalizedAgentId) return;

    const rows = (await this.db.query<Pick<HostRow, 'id' | 'hostname' | 'agent_id'>>(
      `select id, hostname, agent_id
       from pg_hosts
       where tenant_id = $1
         and deleted_at is null
         and ($2::text is not null and lower(coalesce(hostname, '')) = $2
           or $3::text is not null and agent_id = $3)`,
      [tenantId, normalizedHostname ?? null, normalizedAgentId ?? null],
    )).rows;

    const duplicate = rows.find((row) => row.id !== excludedId);
    if (!duplicate) return;

    if (normalizedAgentId && duplicate.agent_id === normalizedAgentId) {
      throw new AppError('RESOURCE_ALREADY_EXISTS', 'Host ????? Agent ??', {
        hostId: duplicate.id,
        agentId: normalizedAgentId,
      });
    }

    throw new AppError('RESOURCE_ALREADY_EXISTS', 'Host ????? hostname', {
      hostId: duplicate.id,
      hostname: normalizedHostname,
    });
  }

  private async attachTargetBindingSummary(tenantId: string, asset: ServiceAssetDto): Promise<ServiceAssetDto> {
    const targetBinding = await this.getApplicationAssetTargetByApplicationAssetId(tenantId, asset.id);
    return targetBinding ? { ...asset, targetBinding } : asset;
  }
}

type HostRow = {
  id: string;
  tenant_id: string;
  hostname?: string | null;
  display_name?: string | null;
  primary_ip?: string | null;
  ip_addresses: unknown;
  os_type: HostDto['osType'];
  os_name?: string | null;
  os_version?: string | null;
  arch?: string | null;
  environment?: string | null;
  zone_id?: string | null;
  owner_id?: string | null;
  management_channels: unknown;
  discovery_source: HostDto['discoverySource'];
  last_discovered_at?: string | null;
  agent_id?: string | null;
  asset_fingerprint?: string | null;
  compatibility_level: HostDto['compatibilityLevel'];
  management_mode: HostDto['managementMode'];
  status: HostDto['status'];
  tags: unknown;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  version: number;
};

type ServiceInstanceRow = {
  id: string;
  tenant_id: string;
  host_id: string;
  provider_type: ServiceInstanceDto['providerType'];
  service_name?: string | null;
  display_name: string;
  version_text?: string | null;
  install_path?: string | null;
  config_path?: string | null;
  runtime_user?: string | null;
  ports: unknown;
  provider_key?: string | null;
  manual_overrides: unknown;
  discovery_source: ServiceInstanceDto['discoverySource'];
  last_discovered_at?: string | null;
  status: ServiceInstanceDto['status'];
  raw_facts: unknown;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  version: number;
};

type ServiceAssetRow = {
  id: string;
  tenant_id: string;
  address: string;
  address_type: ServiceAssetDto['addressType'];
  port: number;
  protocol: ServiceAssetDto['protocol'];
  platform?: ServiceAssetDto['platform'] | null;
  agent_id?: string | null;
  sni_name?: string | null;
  display_name?: string | null;
  service_instance_id?: string | null;
  service_endpoint_id?: string | null;
  host_id?: string | null;
  environment?: string | null;
  discovery_source: ServiceAssetDto['discoverySource'];
  last_discovered_at?: string | null;
  status: ServiceAssetDto['status'];
  tags: unknown;
  metadata: unknown;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  version: number;
};

type ServiceEndpointRow = {
  id: string;
  tenant_id: string;
  service_instance_id: string;
  host_id: string;
  protocol: ServiceEndpointDto['protocol'];
  host_name?: string | null;
  listen_ip?: string | null;
  port: number;
  path_hint?: string | null;
  status: ServiceEndpointDto['status'];
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  version: number;
};

type SiteAssetRow = {
  id: string;
  tenant_id: string;
  service_instance_id: string;
  service_asset_id?: string | null;
  host_id: string;
  agent_id?: string | null;
  provider_type: SiteAssetDto['providerType'];
  site_type: SiteAssetDto['siteType'];
  site_name: string;
  site_key: string;
  binding_information?: string | null;
  host_header?: string | null;
  listen_ip?: string | null;
  port?: number | null;
  protocol?: SiteAssetDto['protocol'] | null;
  config_path?: string | null;
  runtime_status?: string | null;
  discovery_source: SiteAssetDto['discoverySource'];
  last_discovered_at?: string | null;
  status: SiteAssetDto['status'];
  metadata: unknown;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  version: number;
};

type ManagedTargetRow = {
  id: string;
  tenant_id: string;
  agent_id: string;
  host_id: string;
  service_instance_id?: string | null;
  service_asset_id?: string | null;
  site_asset_id?: string | null;
  provider_type: ManagedTargetDto['providerType'];
  framework_type: ManagedTargetDto['frameworkType'];
  target_type: ManagedTargetDto['targetType'];
  target_key: string;
  binding_key?: string | null;
  capability_profile: unknown;
  deployment_mode?: string | null;
  last_seen_at?: string | null;
  status: ManagedTargetDto['status'];
  metadata: unknown;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  version: number;
};

type ApplicationAssetTargetRow = {
  id: string;
  tenant_id: string;
  application_asset_id: string;
  agent_id: string;
  site_asset_id: string;
  managed_target_id: string;
  provider_type: ApplicationAssetTargetSummaryDto['providerType'];
  framework_type: ApplicationAssetTargetSummaryDto['frameworkType'];
  target_type: ApplicationAssetTargetSummaryDto['targetType'];
  target_key: string;
  binding_key?: string | null;
  status: ApplicationAssetTargetSummaryDto['status'];
  metadata: unknown;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  version: number;
};

type ManagedTargetSnapshotRow = {
  id: string;
  tenant_id: string;
  application_asset_id?: string | null;
  site_asset_id?: string | null;
  managed_target_id?: string | null;
  certificate_binding_id?: string | null;
  execution_run_id?: string | null;
  execution_step_id?: string | null;
  binding_information?: string | null;
  host_header?: string | null;
  port?: number | null;
  store_location?: string | null;
  store_name?: string | null;
  store_thumbprint?: string | null;
  certificate_version_id?: string | null;
  fingerprint_sha256?: string | null;
  snapshot_type: ManagedTargetSnapshotDto['snapshotType'];
  status: ManagedTargetSnapshotDto['status'];
  metadata: unknown;
  captured_at: string;
  created_at: string;
  updated_at: string;
  version: number;
};

type DiscoverySnapshotRow = {
  id: string;
  tenant_id: string;
  normalized_hash: string;
  source: DiscoverySnapshotDto['source'];
  normalized_payload: unknown;
  raw_payload?: unknown;
  created_at: string;
  updated_at: string;
  version: number;
};

type AssetConflictRow = {
  id: string;
  tenant_id: string;
  resource_type: AssetConflictDto['resourceType'];
  resource_id: string;
  field: string;
  current_value: unknown;
  discovered_value: unknown;
  source_snapshot_id: string;
  status: AssetConflictDto['status'];
  resolved_by?: string | null;
  resolved_at?: string | null;
  comment?: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

function toHost(row: HostRow): HostDto {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    hostname: row.hostname ?? undefined,
    displayName: row.display_name ?? undefined,
    primaryIp: row.primary_ip ?? undefined,
    ipAddresses: asArray(row.ip_addresses),
    osType: row.os_type,
    osName: row.os_name ?? undefined,
    osVersion: row.os_version ?? undefined,
    arch: row.arch ?? undefined,
    environment: row.environment ?? undefined,
    zoneId: row.zone_id ?? undefined,
    ownerId: row.owner_id ?? undefined,
    managementChannels: asArray(row.management_channels),
    discoverySource: row.discovery_source,
    lastDiscoveredAt: row.last_discovered_at ?? undefined,
    agentId: row.agent_id ?? undefined,
    assetFingerprint: row.asset_fingerprint ?? undefined,
    compatibilityLevel: row.compatibility_level,
    managementMode: row.management_mode,
    status: row.status,
    tags: asArray(row.tags),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? undefined,
    version: row.version,
  };
}

function toServiceInstance(row: ServiceInstanceRow): ServiceInstanceDto {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    hostId: row.host_id ?? undefined,
    providerType: row.provider_type,
    serviceName: row.service_name ?? undefined,
    displayName: row.display_name,
    versionText: row.version_text ?? undefined,
    installPath: row.install_path ?? undefined,
    configPath: row.config_path ?? undefined,
    runtimeUser: row.runtime_user ?? undefined,
    ports: asArray(row.ports),
    providerKey: row.provider_key ?? undefined,
    manualOverrides: asObject(row.manual_overrides),
    discoverySource: row.discovery_source,
    lastDiscoveredAt: row.last_discovered_at ?? undefined,
    status: row.status,
    rawFacts: asObject(row.raw_facts),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? undefined,
    version: row.version,
  };
}

function toServiceAsset(row: ServiceAssetRow): ServiceAssetDto {
  const metadata = asObject(row.metadata);
  return {
    id: row.id,
    tenantId: row.tenant_id,
    address: row.address,
    addressType: row.address_type,
    port: row.port,
    protocol: row.protocol,
    platform: row.platform ?? undefined,
    agentId: row.agent_id ?? undefined,
    sniName: row.sni_name ?? undefined,
    verifyUrl: readServiceAssetVerifyUrl(metadata),
    displayName: row.display_name ?? undefined,
    serviceInstanceId: row.service_instance_id ?? undefined,
    serviceEndpointId: row.service_endpoint_id ?? undefined,
    hostId: row.host_id ?? undefined,
    environment: row.environment ?? undefined,
    discoverySource: row.discovery_source,
    lastDiscoveredAt: row.last_discovered_at ?? undefined,
    status: row.status,
    tags: asArray(row.tags),
    metadata,
    deploymentStrategy: readStoredDeploymentStrategy(metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? undefined,
    version: row.version,
  };
}

function toServiceEndpoint(row: ServiceEndpointRow): ServiceEndpointDto {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    serviceInstanceId: row.service_instance_id,
    hostId: row.host_id ?? undefined,
    protocol: row.protocol,
    hostName: row.host_name ?? undefined,
    listenIp: row.listen_ip ?? undefined,
    port: row.port,
    pathHint: row.path_hint ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? undefined,
    version: row.version,
  };
}

function toSiteAsset(row: SiteAssetRow): SiteAssetDto {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    serviceInstanceId: row.service_instance_id,
    serviceAssetId: row.service_asset_id ?? undefined,
    hostId: row.host_id ?? undefined,
    agentId: row.agent_id ?? undefined,
    providerType: row.provider_type,
    siteType: row.site_type,
    siteName: row.site_name,
    siteKey: row.site_key,
    bindingInformation: row.binding_information ?? undefined,
    hostHeader: row.host_header ?? undefined,
    listenIp: row.listen_ip ?? undefined,
    port: row.port ?? undefined,
    protocol: row.protocol ?? undefined,
    configPath: row.config_path ?? undefined,
    runtimeStatus: row.runtime_status ?? undefined,
    discoverySource: row.discovery_source,
    lastDiscoveredAt: row.last_discovered_at ?? undefined,
    status: row.status,
    metadata: asObject(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? undefined,
    version: row.version,
  };
}

function toManagedTarget(row: ManagedTargetRow): ManagedTargetDto {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    hostId: row.host_id ?? undefined,
    serviceInstanceId: row.service_instance_id ?? undefined,
    serviceAssetId: row.service_asset_id ?? undefined,
    siteAssetId: row.site_asset_id ?? undefined,
    providerType: row.provider_type,
    frameworkType: row.framework_type,
    targetType: row.target_type,
    targetKey: row.target_key,
    bindingKey: row.binding_key ?? undefined,
    capabilityProfile: asObject(row.capability_profile),
    deploymentMode: row.deployment_mode ?? undefined,
    lastSeenAt: row.last_seen_at ?? undefined,
    status: row.status,
    metadata: asObject(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? undefined,
    version: row.version,
  };
}

function toApplicationAssetTarget(row: ApplicationAssetTargetRow): ApplicationAssetTargetSummaryDto {
  return {
    id: row.id,
    applicationAssetId: row.application_asset_id,
    agentId: row.agent_id,
    siteAssetId: row.site_asset_id,
    managedTargetId: row.managed_target_id,
    providerType: row.provider_type,
    frameworkType: row.framework_type,
    targetType: row.target_type,
    targetKey: row.target_key,
    bindingKey: row.binding_key ?? undefined,
    status: row.status,
    metadata: asObject(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? undefined,
    version: row.version,
  };
}

function toManagedTargetSnapshot(row: ManagedTargetSnapshotRow): ManagedTargetSnapshotDto {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    applicationAssetId: row.application_asset_id ?? undefined,
    siteAssetId: row.site_asset_id ?? undefined,
    managedTargetId: row.managed_target_id ?? undefined,
    certificateBindingId: row.certificate_binding_id ?? undefined,
    executionRunId: row.execution_run_id ?? undefined,
    executionStepId: row.execution_step_id ?? undefined,
    bindingInformation: row.binding_information ?? undefined,
    hostHeader: row.host_header ?? undefined,
    port: row.port ?? undefined,
    storeLocation: row.store_location ?? undefined,
    storeName: row.store_name ?? undefined,
    storeThumbprint: row.store_thumbprint ?? undefined,
    certificateVersionId: row.certificate_version_id ?? undefined,
    fingerprintSha256: row.fingerprint_sha256 ?? undefined,
    snapshotType: row.snapshot_type,
    status: row.status,
    metadata: asObject(row.metadata),
    capturedAt: row.captured_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

function toDiscoverySnapshot(row: DiscoverySnapshotRow): DiscoverySnapshotDto {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    normalizedHash: row.normalized_hash,
    source: row.source,
    normalizedPayload: asObject(row.normalized_payload),
    rawPayload: row.raw_payload === undefined ? undefined : asObject(row.raw_payload),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

function toAssetConflict(row: AssetConflictRow): AssetConflictDto {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    field: row.field,
    currentValue: row.current_value,
    discoveredValue: row.discovered_value,
    sourceSnapshotId: row.source_snapshot_id,
    status: row.status,
    resolvedBy: row.resolved_by ?? undefined,
    resolvedAt: row.resolved_at ?? undefined,
    comment: row.comment ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function nowIso(): string {
  return new Date().toISOString();
}

function touch<T extends { updatedAt: string; version: number }>(item: T): T {
  return { ...item, updatedAt: nowIso(), version: item.version + 1 };
}

function softDelete<T extends { deletedAt?: string; updatedAt: string; version: number }>(item: T): T {
  const now = nowIso();
  return { ...item, deletedAt: now, updatedAt: now, version: item.version + 1 };
}

function page<T extends object>(items: T[], query: PageQuery, filterFn: (item: T, field: string, expected: string) => boolean): PageResult<T> {
  let filtered = items;
  for (const [field, expected] of Object.entries(query.filter)) {
    filtered = filtered.filter((item) => filterFn(item, field, expected));
  }
  if (query.sort) {
    const { field, direction } = query.sort;
    filtered = [...filtered].sort((left, right) => compareValues(readField(left, field), readField(right, field), direction));
  }
  const start = (query.page - 1) * query.pageSize;
  return {
    items: filtered.slice(start, start + query.pageSize),
    page: query.page,
    pageSize: query.pageSize,
    total: filtered.length,
  };
}

function readField(item: object, field: string): unknown {
  return (item as Record<string, unknown>)[field];
}

function compareValues(left: unknown, right: unknown, direction: 'asc' | 'desc'): number {
  const normalizedLeft = left === undefined || left === null ? '' : String(left);
  const normalizedRight = right === undefined || right === null ? '' : String(right);
  const result = normalizedLeft.localeCompare(normalizedRight);
  return direction === 'asc' ? result : -result;
}

function hostFilter(host: HostDto, field: string, expected: string): boolean {
  if (field === 'tag') return host.tags.includes(expected);
  return stringField(host, field).includes(expected.toLowerCase());
}

function serviceInstanceFilter(serviceInstance: ServiceInstanceDto, field: string, expected: string): boolean {
  return stringField(serviceInstance, field).includes(expected.toLowerCase());
}

function serviceAssetFilter(asset: ServiceAssetDto, field: string, expected: string): boolean {
  if (field === 'tag') return asset.tags.includes(expected);
  return stringField(asset, field).includes(expected.toLowerCase());
}

function serviceEndpointFilter(endpoint: ServiceEndpointDto, field: string, expected: string): boolean {
  return stringField(endpoint, field).includes(expected.toLowerCase());
}

function siteAssetFilter(siteAsset: SiteAssetDto, field: string, expected: string): boolean {
  return stringField(siteAsset, field).includes(expected.toLowerCase());
}

function managedTargetFilter(target: ManagedTargetDto, field: string, expected: string): boolean {
  return stringField(target, field).includes(expected.toLowerCase());
}

function discoverySnapshotFilter(snapshot: DiscoverySnapshotDto, field: string, expected: string): boolean {
  return stringField(snapshot, field).includes(expected.toLowerCase());
}

function assetConflictFilter(conflict: AssetConflictDto, field: string, expected: string): boolean {
  return stringField(conflict, field).includes(expected.toLowerCase());
}

function applicationAssetTargetFilter(target: ApplicationAssetTargetSummaryDto, field: string, expected: string): boolean {
  return stringField(target, field).includes(expected.toLowerCase());
}

function managedTargetSnapshotFilter(snapshot: ManagedTargetSnapshotDto, field: string, expected: string): boolean {
  return stringField(snapshot, field).includes(expected.toLowerCase());
}

function stringField(item: object, field: string): string {
  const value = readField(item, field);
  return value === undefined || value === null ? '' : String(value).toLowerCase();
}

function withServiceAssetVerifyUrl(metadata: Record<string, unknown>, verifyUrl: string | undefined): Record<string, unknown> {
  const next = { ...metadata };
  const normalized = normalizeOptionalStringValue(verifyUrl);
  if (normalized) {
    next.verifyUrl = normalized;
  } else {
    delete next.verifyUrl;
  }
  return next;
}

function readServiceAssetVerifyUrl(metadata: Record<string, unknown>): string | undefined {
  return normalizeOptionalStringValue(metadata.verifyUrl);
}

function normalizeOptionalStringValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
