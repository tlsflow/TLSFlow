import { AppError } from '../../../common/errors/app-error.js';
import { applyAuthorizationFilter, type PageQuery } from '../../../common/pagination/pagination.js';
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
  CreateFrameworkInstanceDto,
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
  FrameworkInstanceDto,
  SiteAssetDto,
  ResolveAssetConflictDto,
  UpdateHostDto,
  UpdateManagedTargetDto,
  UpdateApplicationAssetTargetDto,
  UpdateServiceAssetDto,
  UpdateServiceEndpointDto,
  UpdateFrameworkInstanceDto,
  UpdateSiteAssetDto,
} from '../dto/assets.dto.js';
import type { CloudAccountAsset } from '../../providers/dto/providers.dto.js';

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
  getCloudAccountAsset?(tenantId: string, assetId: string): Promise<CloudAccountAsset | undefined>;
  findHostByHostname(tenantId: string, hostname: string): Promise<HostDto | undefined>;
  createFrameworkInstance(tenantId: string, input: CreateFrameworkInstanceDto): Promise<FrameworkInstanceDto>;
  updateFrameworkInstance(tenantId: string, serviceInstanceId: string, input: UpdateFrameworkInstanceDto): Promise<FrameworkInstanceDto>;
  deleteFrameworkInstance(tenantId: string, serviceInstanceId: string): Promise<FrameworkInstanceDto>;
  listFrameworkInstances(tenantId: string, query: PageQuery): Promise<PageResult<FrameworkInstanceDto>>;
  getFrameworkInstance(tenantId: string, serviceInstanceId: string): Promise<FrameworkInstanceDto | undefined>;
  getFrameworkInstanceIncludingDeleted(tenantId: string, serviceInstanceId: string): Promise<FrameworkInstanceDto | undefined>;
  findFrameworkInstanceByIdentity(tenantId: string, input: { deviceId: string; discoveryProviderKey: string; frameworkKey: string }): Promise<FrameworkInstanceDto | undefined>;
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
  findSiteAssetByIdentity(tenantId: string, input: { frameworkInstanceId: string; siteKey: string }): Promise<SiteAssetDto | undefined>;
  createManagedTarget(tenantId: string, input: CreateManagedTargetDto): Promise<ManagedTargetDto>;
  updateManagedTarget(tenantId: string, managedTargetId: string, input: UpdateManagedTargetDto): Promise<ManagedTargetDto>;
  deleteManagedTarget(tenantId: string, managedTargetId: string): Promise<ManagedTargetDto>;
  listManagedTargets(tenantId: string, query: PageQuery): Promise<PageResult<ManagedTargetDto>>;
  getManagedTarget(tenantId: string, managedTargetId: string): Promise<ManagedTargetDto | undefined>;
  getManagedTargetIncludingDeleted(tenantId: string, managedTargetId: string): Promise<ManagedTargetDto | undefined>;
  listActiveManagedTargetsBySiteAssetId(tenantId: string, siteAssetId: string): Promise<ManagedTargetDto[]>;
  findManagedTargetByIdentity(tenantId: string, input: { deviceId: string; discoveryProviderKey: string; targetType: string; targetKey: string }): Promise<ManagedTargetDto | undefined>;
  createApplicationAssetTarget(tenantId: string, input: CreateApplicationAssetTargetDto): Promise<ApplicationAssetTargetSummaryDto>;
  updateApplicationAssetTarget(tenantId: string, targetId: string, input: UpdateApplicationAssetTargetDto): Promise<ApplicationAssetTargetSummaryDto>;
  deleteApplicationAssetTarget(tenantId: string, targetId: string): Promise<ApplicationAssetTargetSummaryDto>;
  getApplicationAssetTarget(tenantId: string, targetId: string): Promise<ApplicationAssetTargetSummaryDto | undefined>;
  getApplicationAssetTargetByApplicationAssetId(tenantId: string, applicationAssetId: string): Promise<ApplicationAssetTargetSummaryDto | undefined>;
  /** 查询一个受管目标当前绑定的全部应用，避免把扫描事实误当成应用。 */
  listApplicationAssetTargetsByManagedTargetId?(tenantId: string, managedTargetId: string): Promise<ApplicationAssetTargetSummaryDto[]>;
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

  async getCloudAccountAsset(tenantId: string, assetId: string): Promise<CloudAccountAsset | undefined> {
    const row = (await this.db.query<Record<string, unknown>>(
      `select id, tenant_id, asset_kind, provider_key, display_name, account_id, credential_ref,
              scope, status, metadata, created_at, updated_at, deleted_at, version
         from pg_cloud_account_assets
        where tenant_id=$1 and id=$2 and deleted_at is null`,
      [tenantId, assetId],
    )).rows[0];
    if (!row) return undefined;
    return {
      id: String(row.id),
      tenantId: String(row.tenant_id),
      assetKind: 'cloud.account',
      providerKey: String(row.provider_key),
      displayName: String(row.display_name),
      accountId: typeof row.account_id === 'string' ? row.account_id : undefined,
      credentialRef: String(row.credential_ref),
      scope: (row.scope && typeof row.scope === 'object' && !Array.isArray(row.scope) ? row.scope : {}) as CloudAccountAsset['scope'],
      status: row.status as CloudAccountAsset['status'],
      metadata: (row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata : {}) as Record<string, unknown>,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      ...(row.deleted_at ? { deletedAt: String(row.deleted_at) } : {}),
      version: Number(row.version),
    };
  }

  async findHostByHostname(tenantId: string, hostname: string): Promise<HostDto | undefined> {
    const normalized = hostname.trim().toLowerCase();
    const result = await this.db.query<HostRow>(`select * from pg_hosts where tenant_id = $1 and deleted_at is null and lower(hostname) = $2 limit 1`, [tenantId, normalized]);
    return result.rows[0] ? toHost(result.rows[0]) : undefined;
  }

  async createFrameworkInstance(tenantId: string, input: CreateFrameworkInstanceDto): Promise<FrameworkInstanceDto> {
    if (!await this.getHost(tenantId, input.deviceId)) {
      throw new AppError('RESOURCE_NOT_FOUND', 'Device Root 不存在', { deviceId: input.deviceId });
    }
    const now = nowIso();
    const serviceInstance: FrameworkInstanceDto = {
      id: newId('svc'),
      tenantId,
      deviceId: input.deviceId,
      frameworkType: input.frameworkType,
      frameworkKey: input.frameworkKey,
      discoveryProviderKey: input.discoveryProviderKey,
      displayName: input.displayName,
      frameworkVersion: input.frameworkVersion,
      discoverySource: input.discoverySource ?? 'MANUAL',
      lastDiscoveredAt: input.lastDiscoveredAt,
      status: input.status ?? 'ACTIVE',
      rawFacts: input.rawFacts ?? {},
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.db.query(`insert into pg_framework_instances (id, tenant_id, device_id, framework_type, framework_key, discovery_provider_key, display_name, version_text, discovery_source, last_discovered_at, status, raw_facts, created_at, updated_at, version) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,$11,$12::jsonb,$13::timestamptz,$14::timestamptz,$15)`, [
      serviceInstance.id, tenantId, serviceInstance.deviceId, serviceInstance.frameworkType, serviceInstance.frameworkKey, serviceInstance.discoveryProviderKey, serviceInstance.displayName, serviceInstance.frameworkVersion ?? null, serviceInstance.discoverySource, serviceInstance.lastDiscoveredAt ?? null, serviceInstance.status, JSON.stringify(serviceInstance.rawFacts), serviceInstance.createdAt, serviceInstance.updatedAt, serviceInstance.version,
    ]);
    return serviceInstance;
  }

  async updateFrameworkInstance(tenantId: string, serviceInstanceId: string, input: UpdateFrameworkInstanceDto): Promise<FrameworkInstanceDto> {
    const current = await this.getFrameworkInstance(tenantId, serviceInstanceId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'FrameworkInstance 不存在', { frameworkInstanceId: serviceInstanceId });
    if (input.deviceId && !await this.getHost(tenantId, input.deviceId)) throw new AppError('RESOURCE_NOT_FOUND', 'Device Root 不存在', { deviceId: input.deviceId });
    const updated = touch({ ...current, ...input, deviceId: input.deviceId ?? current.deviceId });
    await this.db.query(`update pg_framework_instances set device_id=$2, framework_type=$3, framework_key=$4, discovery_provider_key=$5, display_name=$6, version_text=$7, discovery_source=$8, last_discovered_at=$9::timestamptz, status=$10, raw_facts=$11::jsonb, updated_at=$12::timestamptz, version=$13 where id=$1`, [
      updated.id, updated.deviceId, updated.frameworkType, updated.frameworkKey, updated.discoveryProviderKey, updated.displayName, updated.frameworkVersion ?? null, updated.discoverySource, updated.lastDiscoveredAt ?? null, updated.status, JSON.stringify(updated.rawFacts), updated.updatedAt, updated.version,
    ]);
    return updated;
  }

  async deleteFrameworkInstance(tenantId: string, serviceInstanceId: string): Promise<FrameworkInstanceDto> {
    const current = await this.getFrameworkInstance(tenantId, serviceInstanceId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'FrameworkInstance 不存在', { frameworkInstanceId: serviceInstanceId });
    const deleted = softDelete({ ...current, status: 'DELETED' as const });
    await this.db.query(`update pg_framework_instances set status=$2, deleted_at=$3::timestamptz, updated_at=$4::timestamptz, version=$5 where id=$1`, [deleted.id, deleted.status, deleted.deletedAt ?? null, deleted.updatedAt, deleted.version]);
    return deleted;
  }

  async listFrameworkInstances(tenantId: string, query: PageQuery): Promise<PageResult<FrameworkInstanceDto>> {
    const rows = (await this.db.query<ServiceInstanceRow>(`select * from pg_framework_instances where tenant_id = $1 and deleted_at is null`, [tenantId])).rows.map(toServiceInstance);
    return page(rows, query, serviceInstanceFilter);
  }

  async getFrameworkInstance(tenantId: string, serviceInstanceId: string): Promise<FrameworkInstanceDto | undefined> {
    const row = (await this.db.query<ServiceInstanceRow>(`select * from pg_framework_instances where id = $1 and tenant_id = $2 and deleted_at is null`, [serviceInstanceId, tenantId])).rows[0];
    return row ? toServiceInstance(row) : undefined;
  }

  async getFrameworkInstanceIncludingDeleted(tenantId: string, serviceInstanceId: string): Promise<FrameworkInstanceDto | undefined> {
    const row = (await this.db.query<ServiceInstanceRow>(`select * from pg_framework_instances where id = $1 and tenant_id = $2`, [serviceInstanceId, tenantId])).rows[0];
    return row ? toServiceInstance(row) : undefined;
  }

  async findFrameworkInstanceByIdentity(tenantId: string, input: { deviceId: string; discoveryProviderKey: string; frameworkKey: string }): Promise<FrameworkInstanceDto | undefined> {
    const row = (await this.db.query<ServiceInstanceRow>(`select * from pg_framework_instances where tenant_id=$1 and device_id=$2 and discovery_provider_key=$3 and framework_key=$4 and deleted_at is null limit 1`, [tenantId, input.deviceId, input.discoveryProviderKey, input.frameworkKey])).rows[0];
    return row ? toServiceInstance(row) : undefined;
  }

  async createServiceAsset(tenantId: string, input: CreateServiceAssetDto): Promise<ServiceAssetDto> {
    if (input.serviceInstanceId && !await this.getFrameworkInstance(tenantId, input.serviceInstanceId)) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceInstance 不存在', { serviceInstanceId: input.serviceInstanceId });
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
    if (input.serviceInstanceId && !await this.getFrameworkInstance(tenantId, input.serviceInstanceId)) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceInstance 不存在', { serviceInstanceId: input.serviceInstanceId });
    if (input.serviceEndpointId && !await this.getServiceEndpoint(tenantId, input.serviceEndpointId)) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceEndpoint 不存在', { serviceEndpointId: input.serviceEndpointId });
    if (input.hostId && !await this.getHost(tenantId, input.hostId)) throw new AppError('RESOURCE_NOT_FOUND', 'Host 不存在', { hostId: input.hostId });
    const { targetBinding: _ignoredTargetBinding, ...assetPatch } = input;
    const merged = { ...current, ...assetPatch };
    const duplicate = await this.findServiceAssetByIdentity(tenantId, merged);
    if (duplicate && duplicate.id !== current.id) throw new AppError('RESOURCE_ALREADY_EXISTS', 'ServiceAsset 已存在', { serviceAssetId: duplicate.id, address: merged.address, port: merged.port, protocol: merged.protocol });
    const strategyMetadata = input.deploymentStrategy
      ? writeDeploymentStrategyMetadata(assetPatch.metadata ?? current.metadata, input.deploymentStrategy)
      : assetPatch.metadata ?? current.metadata;
    const metadata = Object.prototype.hasOwnProperty.call(assetPatch, 'verifyUrl')
      ? withServiceAssetVerifyUrl(strategyMetadata, assetPatch.verifyUrl)
      : strategyMetadata;
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
    await this.db.query(`update pg_site_assets set service_asset_id = null, updated_at = now(), version = version + 1 where tenant_id = $1 and service_asset_id = $2`, [tenantId, serviceAssetId]);
    await this.db.query(`update pg_managed_targets set service_asset_id = null, updated_at = now(), version = version + 1 where tenant_id = $1 and service_asset_id = $2`, [tenantId, serviceAssetId]);
    await this.db.query(`update pg_certificate_bindings set service_asset_id = null, updated_at = now(), version = version + 1 where tenant_id = $1 and service_asset_id = $2`, [tenantId, serviceAssetId]);
    const deleted = softDelete({ ...current, status: 'DELETED' as const });
    await this.db.query(`update pg_service_assets set status=$2, deleted_at=$3::timestamptz, updated_at=$4::timestamptz, version=$5 where id=$1`, [deleted.id, deleted.status, deleted.deletedAt ?? null, deleted.updatedAt, deleted.version]);
    return deleted;
  }

  async listServiceAssets(tenantId: string, query: PageQuery): Promise<PageResult<ServiceAssetDto>> {
    const rows = (await this.db.query<ServiceAssetRow>(`select * from pg_service_assets where tenant_id = $1 and deleted_at is null and asset_kind <> 'DEVICE'`, [tenantId])).rows.map(toServiceAsset);
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
    const serviceInstance = await this.getFrameworkInstance(tenantId, input.serviceInstanceId);
    if (!serviceInstance) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceInstance 不存在', { serviceInstanceId: input.serviceInstanceId });
    const now = nowIso();
    const endpoint: ServiceEndpointDto = {
      id: newId('sep'),
      tenantId,
      serviceInstanceId: input.serviceInstanceId,
      hostId: serviceInstance.deviceId,
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
      const serviceInstance = await this.getFrameworkInstance(tenantId, input.serviceInstanceId);
      if (!serviceInstance) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceInstance 不存在', { serviceInstanceId: input.serviceInstanceId });
      nextHostId = serviceInstance.deviceId;
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
    const framework = await this.getFrameworkInstance(tenantId, input.frameworkInstanceId);
    if (!framework) throw new AppError('RESOURCE_NOT_FOUND', 'FrameworkInstance 不存在', { frameworkInstanceId: input.frameworkInstanceId });
    if (framework.deviceId !== input.deviceId) throw new AppError('VALIDATION_FAILED', 'Site 与 FrameworkInstance 必须属于同一 Device Root', { deviceId: input.deviceId, frameworkDeviceId: framework.deviceId });
    if (!await this.getHost(tenantId, input.deviceId)) throw new AppError('RESOURCE_NOT_FOUND', 'Device Root 不存在', { deviceId: input.deviceId });
    const duplicate = await this.findSiteAssetByIdentity(tenantId, input);
    if (duplicate) throw new AppError('RESOURCE_ALREADY_EXISTS', 'SiteAsset 已存在', { siteAssetId: duplicate.id, siteKey: input.siteKey });
    const serviceAsset = input.serviceAssetId ? await this.getServiceAsset(tenantId, input.serviceAssetId) : undefined;
    if (input.serviceAssetId && !serviceAsset) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceAsset 不存在', { serviceAssetId: input.serviceAssetId });
    if (serviceAsset?.serviceInstanceId && serviceAsset.serviceInstanceId !== input.frameworkInstanceId) {
      throw new AppError('VALIDATION_FAILED', 'SiteAsset 关联的 ServiceAsset 必须属于同一 FrameworkInstance', {
        serviceAssetId: serviceAsset.id,
        serviceInstanceId: input.frameworkInstanceId,
      });
    }
    const now = nowIso();
    const siteAsset: SiteAssetDto = {
      id: newId('sit'),
      tenantId,
      serviceAssetId: serviceAsset?.id,
      frameworkInstanceId: input.frameworkInstanceId,
      deviceId: input.deviceId,
      discoveryProviderKey: input.discoveryProviderKey,
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
      id, tenant_id, framework_instance_id, service_asset_id, device_id, discovery_provider_key, site_type, site_name, site_key,
      binding_information, host_header, listen_ip, port, protocol, config_path, runtime_status, discovery_source, last_discovered_at,
      status, metadata, created_at, updated_at, version
    ) values (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,
      $10,$11,$12,$13,$14,$15,$16,$17,$18::timestamptz,
      $19,$20::jsonb,$21::timestamptz,$22::timestamptz,$23
    )`, [
      siteAsset.id, tenantId, siteAsset.frameworkInstanceId, siteAsset.serviceAssetId ?? null, siteAsset.deviceId, siteAsset.discoveryProviderKey, siteAsset.siteType, siteAsset.siteName, siteAsset.siteKey,
      siteAsset.bindingInformation ?? null, siteAsset.hostHeader ?? null, siteAsset.listenIp ?? null, siteAsset.port ?? null, siteAsset.protocol ?? null, siteAsset.configPath ?? null, siteAsset.runtimeStatus ?? null, siteAsset.discoverySource, siteAsset.lastDiscoveredAt ?? null,
      siteAsset.status, JSON.stringify(siteAsset.metadata), siteAsset.createdAt, siteAsset.updatedAt, siteAsset.version,
    ]);
    return siteAsset;
  }

  async updateSiteAsset(tenantId: string, siteAssetId: string, input: UpdateSiteAssetDto): Promise<SiteAssetDto> {
    const current = await this.getSiteAsset(tenantId, siteAssetId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'SiteAsset 不存在', { siteAssetId });
    const nextFrameworkInstanceId = input.frameworkInstanceId ?? current.frameworkInstanceId;
    const nextDeviceId = input.deviceId ?? current.deviceId;
    const framework = await this.getFrameworkInstance(tenantId, nextFrameworkInstanceId);
    if (!framework) throw new AppError('RESOURCE_NOT_FOUND', 'FrameworkInstance 不存在', { frameworkInstanceId: nextFrameworkInstanceId });
    if (framework.deviceId !== nextDeviceId) throw new AppError('VALIDATION_FAILED', 'Site 与 FrameworkInstance 必须属于同一 Device Root', { deviceId: nextDeviceId, frameworkDeviceId: framework.deviceId });
    if (!await this.getHost(tenantId, nextDeviceId)) throw new AppError('RESOURCE_NOT_FOUND', 'Device Root 不存在', { deviceId: nextDeviceId });
    const nextSiteKey = input.siteKey ?? current.siteKey;
    const duplicate = await this.findSiteAssetByIdentity(tenantId, { frameworkInstanceId: nextFrameworkInstanceId, siteKey: nextSiteKey });
    if (duplicate && duplicate.id !== current.id) throw new AppError('RESOURCE_ALREADY_EXISTS', 'SiteAsset 已存在', { siteAssetId: duplicate.id, siteKey: nextSiteKey });
    const nextServiceAssetId = input.serviceAssetId ?? current.serviceAssetId;
    const serviceAsset = nextServiceAssetId ? await this.getServiceAsset(tenantId, nextServiceAssetId) : undefined;
    if (input.serviceAssetId && !serviceAsset) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceAsset 不存在', { serviceAssetId: input.serviceAssetId });
    if (serviceAsset?.serviceInstanceId && serviceAsset.serviceInstanceId !== nextFrameworkInstanceId) {
      throw new AppError('VALIDATION_FAILED', 'SiteAsset 关联的 ServiceAsset 必须属于同一 FrameworkInstance', {
        serviceAssetId: serviceAsset.id,
        serviceInstanceId: nextFrameworkInstanceId,
      });
    }
    const updated = touch({ ...current, ...input, metadata: input.metadata ?? current.metadata });
    await this.db.query(`update pg_site_assets set framework_instance_id=$2, service_asset_id=$3, device_id=$4, discovery_provider_key=$5, site_type=$6, site_name=$7, site_key=$8, binding_information=$9, host_header=$10, listen_ip=$11, port=$12, protocol=$13, config_path=$14, runtime_status=$15, discovery_source=$16, last_discovered_at=$17::timestamptz, status=$18, metadata=$19::jsonb, updated_at=$20::timestamptz, version=$21 where id=$1`, [
      updated.id, updated.frameworkInstanceId, updated.serviceAssetId ?? null, updated.deviceId, updated.discoveryProviderKey, updated.siteType, updated.siteName, updated.siteKey, updated.bindingInformation ?? null, updated.hostHeader ?? null, updated.listenIp ?? null, updated.port ?? null, updated.protocol ?? null, updated.configPath ?? null, updated.runtimeStatus ?? null, updated.discoverySource, updated.lastDiscoveredAt ?? null, updated.status, JSON.stringify(updated.metadata), updated.updatedAt, updated.version,
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

  async findSiteAssetByIdentity(tenantId: string, input: { frameworkInstanceId: string; siteKey: string }): Promise<SiteAssetDto | undefined> {
    const row = (await this.db.query<SiteAssetRow>(`select * from pg_site_assets where tenant_id = $1 and deleted_at is null and framework_instance_id = $2 and site_key = $3 limit 1`, [tenantId, input.frameworkInstanceId, input.siteKey])).rows[0];
    return row ? toSiteAsset(row) : undefined;
  }

  async createManagedTarget(tenantId: string, input: CreateManagedTargetDto): Promise<ManagedTargetDto> {
    if ((input.deviceId ? 1 : 0) + (input.assetId ? 1 : 0) !== 1) throw new AppError('VALIDATION_FAILED', 'ManagedTarget 必须且只能绑定一个所有者', { code: 'MANAGED_TARGET_OWNER_CONFLICT' });
    if (input.deviceId && !await this.getHost(tenantId, input.deviceId)) throw new AppError('RESOURCE_NOT_FOUND', 'Device Root 不存在', { deviceId: input.deviceId });
    if (input.assetId && !(await this.db.query<{ id: string }>('select id from pg_cloud_account_assets where tenant_id=$1 and id=$2 and deleted_at is null', [tenantId, input.assetId])).rows[0]) {
      throw new AppError('RESOURCE_NOT_FOUND', 'CloudAccountAsset 不存在', { assetId: input.assetId });
    }
    if (input.frameworkInstanceId && !await this.getFrameworkInstance(tenantId, input.frameworkInstanceId)) throw new AppError('RESOURCE_NOT_FOUND', 'FrameworkInstance 不存在', { frameworkInstanceId: input.frameworkInstanceId });
    if (input.siteId && !await this.getSiteAsset(tenantId, input.siteId)) throw new AppError('RESOURCE_NOT_FOUND', 'Site 不存在', { siteId: input.siteId });
    const serviceAsset = input.serviceAssetId ? await this.getServiceAsset(tenantId, input.serviceAssetId) : undefined;
    if (input.serviceAssetId && !serviceAsset) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceAsset 不存在', { serviceAssetId: input.serviceAssetId });
    if (serviceAsset?.serviceInstanceId && input.frameworkInstanceId && serviceAsset.serviceInstanceId !== input.frameworkInstanceId) {
      throw new AppError('VALIDATION_FAILED', 'ManagedTarget 关联的 ServiceAsset 必须属于同一 FrameworkInstance', {
        serviceAssetId: serviceAsset.id,
        serviceInstanceId: input.frameworkInstanceId,
      });
    }
    const duplicate = await this.findManagedTargetByIdentity(tenantId, input);
    if (duplicate) throw new AppError('RESOURCE_ALREADY_EXISTS', 'ManagedTarget 已存在', { managedTargetId: duplicate.id, targetKey: input.targetKey });
    const now = nowIso();
    const target: ManagedTargetDto = {
      id: newId('mtg'),
      tenantId,
      serviceAssetId: serviceAsset?.id,
      deviceId: input.deviceId,
      assetId: input.assetId,
      frameworkInstanceId: input.frameworkInstanceId,
      siteId: input.siteId,
      discoveryProviderKey: input.discoveryProviderKey,
      targetType: input.targetType,
      targetKey: input.targetKey,
      bindingKey: input.bindingKey,
      supportedCapabilities: input.supportedCapabilities,
      executionLocations: input.executionLocations,
      lastSeenAt: input.lastSeenAt,
      status: input.status ?? 'ACTIVE',
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.db.query(`insert into pg_managed_targets (
      id, tenant_id, service_asset_id, device_id, asset_id, framework_instance_id, site_id, discovery_provider_key,
      target_type, target_key, binding_key, supported_capabilities, execution_locations, last_seen_at, status, metadata, created_at, updated_at, version
    ) values (
      $1,$2,$3,$4,$5,$6,$7,$8,
      $9,$10,$11,$12::jsonb,$13::jsonb,$14::timestamptz,$15,$16::jsonb,$17::timestamptz,$18::timestamptz,$19
    )`, [
      target.id, tenantId, target.serviceAssetId ?? null, target.deviceId ?? null, target.assetId ?? null, target.frameworkInstanceId ?? null, target.siteId ?? null, target.discoveryProviderKey,
      target.targetType, target.targetKey, target.bindingKey ?? null, JSON.stringify(target.supportedCapabilities), JSON.stringify(target.executionLocations), target.lastSeenAt ?? null, target.status, JSON.stringify(target.metadata), target.createdAt, target.updatedAt, target.version,
    ]);
    return target;
  }

  async updateManagedTarget(tenantId: string, managedTargetId: string, input: UpdateManagedTargetDto): Promise<ManagedTargetDto> {
    const current = await this.getManagedTarget(tenantId, managedTargetId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'ManagedTarget 不存在', { managedTargetId });
    if (input.deviceId && !await this.getHost(tenantId, input.deviceId)) throw new AppError('RESOURCE_NOT_FOUND', 'Device Root 不存在', { deviceId: input.deviceId });
    if (input.assetId && !(await this.db.query<{ id: string }>('select id from pg_cloud_account_assets where tenant_id=$1 and id=$2 and deleted_at is null', [tenantId, input.assetId])).rows[0]) {
      throw new AppError('RESOURCE_NOT_FOUND', 'CloudAccountAsset 不存在', { assetId: input.assetId });
    }
    if (input.frameworkInstanceId && !await this.getFrameworkInstance(tenantId, input.frameworkInstanceId)) throw new AppError('RESOURCE_NOT_FOUND', 'FrameworkInstance 不存在', { frameworkInstanceId: input.frameworkInstanceId });
    if (input.siteId && !await this.getSiteAsset(tenantId, input.siteId)) throw new AppError('RESOURCE_NOT_FOUND', 'Site 不存在', { siteId: input.siteId });
    const nextDeviceId = input.deviceId !== undefined ? input.deviceId : current.deviceId;
    const nextAssetId = input.assetId !== undefined ? input.assetId : current.assetId;
    if ((nextDeviceId ? 1 : 0) + (nextAssetId ? 1 : 0) !== 1) throw new AppError('VALIDATION_FAILED', 'ManagedTarget 必须且只能绑定一个所有者', { code: 'MANAGED_TARGET_OWNER_CONFLICT' });
    const nextDiscoveryProviderKey = input.discoveryProviderKey ?? current.discoveryProviderKey;
    const nextTargetType = input.targetType ?? current.targetType;
    const nextTargetKey = input.targetKey ?? current.targetKey;
    const duplicate = await this.findManagedTargetByIdentity(tenantId, { deviceId: nextDeviceId, assetId: nextAssetId, discoveryProviderKey: nextDiscoveryProviderKey, targetType: nextTargetType, targetKey: nextTargetKey });
    if (duplicate && duplicate.id !== current.id) throw new AppError('RESOURCE_ALREADY_EXISTS', 'ManagedTarget 已存在', { managedTargetId: duplicate.id, targetKey: nextTargetKey });
    const nextServiceAssetId = input.serviceAssetId ?? current.serviceAssetId;
    const serviceAsset = nextServiceAssetId ? await this.getServiceAsset(tenantId, nextServiceAssetId) : undefined;
    if (input.serviceAssetId && !serviceAsset) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceAsset 不存在', { serviceAssetId: input.serviceAssetId });
    const nextFrameworkInstanceId = input.frameworkInstanceId ?? current.frameworkInstanceId;
    if (serviceAsset?.serviceInstanceId && nextFrameworkInstanceId && serviceAsset.serviceInstanceId !== nextFrameworkInstanceId) {
      throw new AppError('VALIDATION_FAILED', 'ManagedTarget 关联的 ServiceAsset 必须属于同一 FrameworkInstance', {
        serviceAssetId: serviceAsset.id,
        serviceInstanceId: nextFrameworkInstanceId,
      });
    }
    const updated = touch({ ...current, ...input, supportedCapabilities: input.supportedCapabilities ?? current.supportedCapabilities, executionLocations: input.executionLocations ?? current.executionLocations, metadata: input.metadata ?? current.metadata });
    await this.db.query(`update pg_managed_targets set service_asset_id=$2, device_id=$3, asset_id=$4, framework_instance_id=$5, site_id=$6, discovery_provider_key=$7, target_type=$8, target_key=$9, binding_key=$10, supported_capabilities=$11::jsonb, execution_locations=$12::jsonb, last_seen_at=$13::timestamptz, status=$14, metadata=$15::jsonb, updated_at=$16::timestamptz, version=$17 where id=$1`, [
      updated.id, updated.serviceAssetId ?? null, updated.deviceId ?? null, updated.assetId ?? null, updated.frameworkInstanceId ?? null, updated.siteId ?? null, updated.discoveryProviderKey, updated.targetType, updated.targetKey, updated.bindingKey ?? null, JSON.stringify(updated.supportedCapabilities), JSON.stringify(updated.executionLocations), updated.lastSeenAt ?? null, updated.status, JSON.stringify(updated.metadata), updated.updatedAt, updated.version,
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

  async listActiveManagedTargetsBySiteAssetId(tenantId: string, siteAssetId: string): Promise<ManagedTargetDto[]> {
    return (await this.db.query<ManagedTargetRow>(
      `select * from pg_managed_targets
       where tenant_id = $1 and site_id = $2 and status = 'ACTIVE' and deleted_at is null
       order by created_at, id`,
      [tenantId, siteAssetId],
    )).rows.map(toManagedTarget);
  }

  async findManagedTargetByIdentity(tenantId: string, input: { deviceId?: string; assetId?: string; discoveryProviderKey: string; targetType: string; targetKey: string }): Promise<ManagedTargetDto | undefined> {
    const ownerColumn = input.assetId ? 'asset_id' : 'device_id';
    const ownerId = input.assetId ?? input.deviceId;
    const row = (await this.db.query<ManagedTargetRow>(`select * from pg_managed_targets where tenant_id = $1 and deleted_at is null and ${ownerColumn} = $2 and discovery_provider_key = $3 and target_type = $4 and target_key = $5 limit 1`, [tenantId, ownerId, input.discoveryProviderKey, input.targetType, input.targetKey])).rows[0];
    return row ? toManagedTarget(row) : undefined;
  }

  async createApplicationAssetTarget(tenantId: string, input: CreateApplicationAssetTargetDto): Promise<ApplicationAssetTargetSummaryDto> {
    if (!await this.getServiceAsset(tenantId, input.applicationAssetId)) throw new AppError('RESOURCE_NOT_FOUND', 'ApplicationAsset 不存在', { applicationAssetId: input.applicationAssetId });
    if (!await this.getManagedTarget(tenantId, input.managedTargetId)) throw new AppError('RESOURCE_NOT_FOUND', 'ManagedTarget 不存在', { managedTargetId: input.managedTargetId });
    const duplicate = await this.getApplicationAssetTargetByApplicationAssetId(tenantId, input.applicationAssetId);
    if (duplicate) throw new AppError('RESOURCE_ALREADY_EXISTS', 'ApplicationAssetTarget 已存在', { applicationAssetTargetId: duplicate.id, applicationAssetId: input.applicationAssetId });
    const now = nowIso();
    const target: ApplicationAssetTargetSummaryDto = {
      id: newId('aat'),
      applicationAssetId: input.applicationAssetId,
      managedTargetId: input.managedTargetId,
      status: input.status ?? 'ACTIVE',
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.db.query(`insert into pg_application_asset_targets (
      id, tenant_id, application_asset_id, managed_target_id, status, metadata, created_at, updated_at, version
    ) values ($1,$2,$3,$4,$5,$6::jsonb,$7::timestamptz,$8::timestamptz,$9)`, [
      target.id, tenantId, target.applicationAssetId, target.managedTargetId, target.status,
      JSON.stringify(target.metadata), target.createdAt, target.updatedAt, target.version,
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
      managedTargetId: input.managedTargetId ?? current.managedTargetId,
      metadata: input.metadata ?? current.metadata,
    };
    if (!await this.getServiceAsset(tenantId, next.applicationAssetId)) throw new AppError('RESOURCE_NOT_FOUND', 'ApplicationAsset 不存在', { applicationAssetId: next.applicationAssetId });
    if (!await this.getManagedTarget(tenantId, next.managedTargetId)) throw new AppError('RESOURCE_NOT_FOUND', 'ManagedTarget 不存在', { managedTargetId: next.managedTargetId });
    const duplicate = await this.getApplicationAssetTargetByApplicationAssetId(tenantId, next.applicationAssetId);
    if (duplicate && duplicate.id !== current.id) throw new AppError('RESOURCE_ALREADY_EXISTS', 'ApplicationAssetTarget 已存在', { applicationAssetTargetId: duplicate.id, applicationAssetId: next.applicationAssetId });
    const updated = touch(next);
    await this.db.query(`update pg_application_asset_targets set application_asset_id=$2, managed_target_id=$3, status=$4, metadata=$5::jsonb, updated_at=$6::timestamptz, version=$7 where id=$1 and tenant_id=$8`, [
      updated.id, updated.applicationAssetId, updated.managedTargetId, updated.status, JSON.stringify(updated.metadata), updated.updatedAt, updated.version, tenantId,
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

  async listApplicationAssetTargetsByManagedTargetId(tenantId: string, managedTargetId: string): Promise<ApplicationAssetTargetSummaryDto[]> {
    const rows = (await this.db.query<ApplicationAssetTargetRow>(
      `select * from pg_application_asset_targets
       where tenant_id = $1 and managed_target_id = $2 and status = 'ACTIVE' and deleted_at is null
       order by created_at, id`,
      [tenantId, managedTargetId],
    )).rows;
    return rows.map(toApplicationAssetTarget);
  }

  async getApplicationAssetTargetDetailByApplicationAssetId(tenantId: string, applicationAssetId: string): Promise<ApplicationAssetTargetDetailDto | undefined> {
    const target = await this.getApplicationAssetTargetByApplicationAssetId(tenantId, applicationAssetId);
    if (!target) return undefined;
    const managedTarget = await this.getManagedTargetIncludingDeleted(tenantId, target.managedTargetId);
    const siteAsset = managedTarget?.siteId ? await this.getSiteAssetIncludingDeleted(tenantId, managedTarget.siteId) : undefined;
    const certificateBindings = (await this.db.query<any>(`select * from pg_certificate_bindings where tenant_id=$1 and deleted_at is null and managed_target_id=$2`, [tenantId, target.managedTargetId])).rows.map((row) => ({
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
      configuredCertificate: configuredCertificateEvidence(row.metadata),
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
      throw new AppError('RESOURCE_ALREADY_EXISTS', 'Host 已绑定其他 Agent', {
        hostId: duplicate.id,
        agentId: normalizedAgentId,
      });
    }

    throw new AppError('RESOURCE_ALREADY_EXISTS', '已存在相同 hostname 的 Host', {
      hostId: duplicate.id,
      hostname: normalizedHostname,
    });
  }

  private async attachTargetBindingSummary(tenantId: string, asset: ServiceAssetDto): Promise<ServiceAssetDto> {
    const targetBinding = await this.getApplicationAssetTargetByApplicationAssetId(tenantId, asset.id);
    if (!targetBinding) return asset;
    const managedTarget = await this.getManagedTargetIncludingDeleted(tenantId, targetBinding.managedTargetId);
    if (!managedTarget) return { ...asset, targetBinding };
    // Repository 可能绑定到事务专用 client；事务 client 不允许并发 query。
    // 顺序读取避免 pg 触发“client already executing a query”并发警告。
    // 应用资产卡片必须使用当前生效的证书部署插件，而不是从 DeviceAsset 猜测插件。
    // 能力指派的优先级与执行解析保持一致：应用资产覆盖 > 受管目标覆盖 > 设备默认。
    const effectivePluginRow = (await this.db.query<{ plugin_version_id: string | null }>(
      `select assignment.plugin_version_id
       from plugin_capability_assignments assignment
       join unified_plugin_bindings binding
         on binding.tenant_id = assignment.tenant_id
        and binding.id = assignment.plugin_binding_id
        and binding.plugin_version_id = assignment.plugin_version_id
        and binding.status = 'ACTIVE'
       where assignment.tenant_id = $1
         and assignment.capability_key = 'certificate.deploy'
         and assignment.status = 'ACTIVE'
         and (
           (assignment.owner_type = 'APPLICATION_ASSET'
             and assignment.owner_id = $2
             and binding.managed_context->>'hostId' = $4
             and (binding.managed_context->>'managedTargetId' is null
               or binding.managed_context->>'managedTargetId' = $3))
           or (assignment.owner_type = 'MANAGED_TARGET'
             and assignment.owner_id = $3
             and binding.managed_context->>'hostId' = $4
             and (binding.managed_context->>'managedTargetId' is null
               or binding.managed_context->>'managedTargetId' = $3))
           or (assignment.owner_type = 'DEVICE'
             and assignment.owner_id = $4
             and binding.managed_context->>'hostId' = $4)
         )
       order by case assignment.owner_type
         when 'APPLICATION_ASSET' then 1
         when 'MANAGED_TARGET' then 2
         when 'DEVICE' then 3
         else 4
       end
       limit 1`,
      [tenantId, asset.id, targetBinding.managedTargetId, managedTarget.deviceId],
    )).rows[0];
    // 控制面和网关设备的插件能力可能只登记 device.discover/device.connection.test，
    // 也可能只留下设备绑定字段；这些来源都比应用资产的证书部署插件更能代表所属设备。
    const devicePluginRow = managedTarget.deviceId ? (await this.db.query<{ plugin_version_id: string | null }>(
      `with raw_candidates as (
         select assignment.plugin_version_id,
                case assignment.capability_key
                  when 'device.discover' then 1
                  when 'device.connection.test' then 2
                  when 'device.identity.detect' then 3
                  else 4
                end as priority
         from plugin_capability_assignments assignment
         join unified_plugin_bindings binding
           on binding.tenant_id = assignment.tenant_id
          and binding.id = assignment.plugin_binding_id
          and binding.plugin_version_id = assignment.plugin_version_id
          and binding.status = 'ACTIVE'
          and binding.managed_context->>'hostId' = $2
         where assignment.tenant_id = $1
           and assignment.owner_type = 'DEVICE'
           and assignment.owner_id = $2
           and assignment.status = 'ACTIVE'
           and assignment.capability_key in ('device.discover', 'device.connection.test', 'device.identity.detect')
         union all
         select binding.plugin_version_id, 5
         from pg_device_assets device
         join unified_plugin_bindings binding
           on binding.tenant_id = device.tenant_id
          and binding.id = device.plugin_binding_id
          and binding.status = 'ACTIVE'
         where device.tenant_id = $1 and device.host_id = $2
         union all
         select device.plugin_version_id, 6
         from pg_device_assets device
         where device.tenant_id = $1 and device.host_id = $2
         union all
         select version.id, 7
         from pg_device_assets device
         join unified_plugin_versions version
           on version.plugin_id = coalesce(nullif(device.product_family, ''), device.device_family)
          and (version.tenant_id = $1 or version.tenant_id = 'SYSTEM')
          and version.status = 'ENABLED'
          and version.manifest->'resources'->'logos'->>'square' is not null
         where device.tenant_id = $1 and device.host_id = $2
       ), candidate_plugins as (
         select candidate.plugin_version_id,
                candidate.priority,
                source.plugin_id,
                source.manifest->'resources'->'logos'->>'square' is not null as has_logo
         from raw_candidates candidate
         join unified_plugin_versions source
           on source.id = candidate.plugin_version_id
          and (source.tenant_id = $1 or source.tenant_id = 'SYSTEM')
       ), selected_plugin as (
         select plugin_id
         from candidate_plugins
         where plugin_id is not null
         order by priority, plugin_id
         limit 1
       ), current_logo_version as (
         select version.id
         from unified_plugin_versions version
         join selected_plugin selected on selected.plugin_id = version.plugin_id
         where (version.tenant_id = $1 or version.tenant_id = 'SYSTEM')
           and version.status = 'ENABLED'
           and version.manifest->'resources'->'logos'->>'square' is not null
         order by string_to_array(
                    trim(both '.' from regexp_replace(version.plugin_version, '[^0-9.]', '', 'g')),
                    '.'
                  )::int[] desc,
                  version.updated_at desc,
                  version.id desc
         limit 1
       )
       select coalesce(
         (select plugin_version_id
          from candidate_plugins
          where has_logo
          order by priority, plugin_version_id
          limit 1),
         (select id from current_logo_version),
         (select plugin_version_id
          from candidate_plugins
          order by priority, plugin_version_id
          limit 1)
       ) as plugin_version_id`,
      [tenantId, managedTarget.deviceId],
    )).rows[0] : undefined;
    const pluginVersionId = devicePluginRow?.plugin_version_id
      ?? effectivePluginRow?.plugin_version_id;
    const host = managedTarget.deviceId ? await this.getHostIncludingDeleted(tenantId, managedTarget.deviceId) : undefined;
    const frameworkInstance = managedTarget.frameworkInstanceId
      ? await this.getFrameworkInstanceIncludingDeleted(tenantId, managedTarget.frameworkInstanceId)
      : undefined;
    const siteAsset = managedTarget.siteId
      ? await this.getSiteAssetIncludingDeleted(tenantId, managedTarget.siteId)
      : undefined;
    return {
      ...asset,
      targetBinding: {
        ...targetBinding,
        deviceId: managedTarget.deviceId,
        deviceDisplayName: host?.displayName ?? host?.hostname ?? host?.primaryIp ?? host?.id,
        ...(pluginVersionId ? { pluginVersionId } : {}),
        frameworkInstanceId: managedTarget.frameworkInstanceId,
        frameworkType: frameworkInstance?.frameworkType,
        frameworkDisplayName: frameworkInstance?.displayName,
        siteAssetId: managedTarget.siteId,
        siteName: siteAsset?.siteName,
      },
    };
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
  asset_id?: string | null;
  device_id?: string | null;
  framework_type: string;
  framework_key: string;
  discovery_provider_key: string;
  display_name: string;
  version_text?: string | null;
  discovery_source: FrameworkInstanceDto['discoverySource'];
  last_discovered_at?: string | null;
  status: FrameworkInstanceDto['status'];
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
  asset_id?: string | null;
  service_asset_id?: string | null;
  framework_instance_id: string;
  device_id?: string | null;
  discovery_provider_key: string;
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
  asset_id?: string | null;
  service_asset_id?: string | null;
  device_id?: string | null;
  framework_instance_id?: string | null;
  site_id?: string | null;
  discovery_provider_key: string;
  target_type: ManagedTargetDto['targetType'];
  target_key: string;
  binding_key?: string | null;
  supported_capabilities: unknown;
  execution_locations: unknown;
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
  managed_target_id: string;
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

function toServiceInstance(row: ServiceInstanceRow): FrameworkInstanceDto {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    ...(row.asset_id ? { assetId: row.asset_id } : {}),
    ...(row.asset_id ? { assetOwner: { kind: 'CLOUD_ACCOUNT', id: row.asset_id } } : row.device_id ? { assetOwner: { kind: 'HOST', id: row.device_id } } : {}),
    deviceId: row.device_id ?? row.asset_id ?? '',
    frameworkType: row.framework_type,
    frameworkKey: row.framework_key,
    discoveryProviderKey: row.discovery_provider_key,
    displayName: row.display_name,
    frameworkVersion: row.version_text ?? undefined,
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
    ...(row.asset_id ? { assetId: row.asset_id } : {}),
    ...(row.service_asset_id ? { serviceAssetId: row.service_asset_id } : {}),
    ...(row.asset_id ? { assetOwner: { kind: 'CLOUD_ACCOUNT', id: row.asset_id } } : row.device_id ? { assetOwner: { kind: 'HOST', id: row.device_id } } : {}),
    frameworkInstanceId: row.framework_instance_id,
    deviceId: row.device_id ?? row.asset_id ?? '',
    discoveryProviderKey: row.discovery_provider_key,
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
    ...(row.asset_id ? { assetId: row.asset_id } : {}),
    ...(row.service_asset_id ? { serviceAssetId: row.service_asset_id } : {}),
    ...(row.asset_id ? { assetOwner: { kind: 'CLOUD_ACCOUNT', id: row.asset_id } } : row.device_id ? { assetOwner: { kind: 'HOST', id: row.device_id } } : {}),
    ...(row.device_id ? { deviceId: row.device_id } : {}),
    frameworkInstanceId: row.framework_instance_id ?? undefined,
    siteId: row.site_id ?? undefined,
    discoveryProviderKey: row.discovery_provider_key,
    targetType: row.target_type,
    targetKey: row.target_key,
    bindingKey: row.binding_key ?? undefined,
    supportedCapabilities: asStringArray(row.supported_capabilities),
    executionLocations: asExecutionLocations(row.execution_locations),
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
    managedTargetId: row.managed_target_id,
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

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asExecutionLocations(value: unknown): ManagedTargetDto['executionLocations'] {
  const supported = new Set(['AGENT', 'CONTROL_PLANE', 'GATEWAY']);
  return asStringArray(value).filter((item): item is ManagedTargetDto['executionLocations'][number] => supported.has(item));
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
  let filtered = applyAuthorizationFilter(items, query);
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

function serviceInstanceFilter(serviceInstance: FrameworkInstanceDto, field: string, expected: string): boolean {
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

function configuredCertificateEvidence(value: unknown): {
  path?: string;
  source?: string;
  subject?: string;
  issuer?: string;
  fingerprintSha256?: string;
  notBefore?: string;
  notAfter?: string;
} | undefined {
  const certificate = asObject(asObject(value).configuredCertificate);
  const projected = {
    path: normalizeOptionalStringValue(certificate.path),
    source: normalizeOptionalStringValue(certificate.source),
    subject: normalizeOptionalStringValue(certificate.subject),
    issuer: normalizeOptionalStringValue(certificate.issuer),
    fingerprintSha256: normalizeOptionalStringValue(certificate.fingerprintSha256),
    notBefore: normalizeOptionalStringValue(certificate.notBefore),
    notAfter: normalizeOptionalStringValue(certificate.notAfter),
  };
  return Object.values(projected).some(Boolean) ? projected : undefined;
}
