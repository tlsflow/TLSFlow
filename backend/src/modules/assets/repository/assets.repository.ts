import { AppError } from '../../../common/errors/app-error.js';
import type { PageQuery } from '../../../common/pagination/pagination.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { newId } from '../../../shared/id.js';
import type {
  CreateHostDto,
  AssetConflictDto,
  CreateAssetConflictDto,
  CreateDiscoverySnapshotDto,
  CreateServiceEndpointDto,
  CreateServiceInstanceDto,
  DiscoverySnapshotDto,
  HostDto,
  ServiceEndpointDto,
  ServiceInstanceDto,
  ResolveAssetConflictDto,
  UpdateHostDto,
  UpdateServiceEndpointDto,
  UpdateServiceInstanceDto,
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
  findServiceInstanceByIdentity(tenantId: string, input: { hostId: string; providerType: string; serviceName?: string; configPath?: string }): Promise<ServiceInstanceDto | undefined>;
  createServiceEndpoint(tenantId: string, input: CreateServiceEndpointDto): Promise<ServiceEndpointDto>;
  updateServiceEndpoint(tenantId: string, serviceEndpointId: string, input: UpdateServiceEndpointDto): Promise<ServiceEndpointDto>;
  deleteServiceEndpoint(tenantId: string, serviceEndpointId: string): Promise<ServiceEndpointDto>;
  listServiceEndpoints(tenantId: string, query: PageQuery): Promise<PageResult<ServiceEndpointDto>>;
  getServiceEndpoint(tenantId: string, serviceEndpointId: string): Promise<ServiceEndpointDto | undefined>;
  getServiceEndpointIncludingDeleted(tenantId: string, serviceEndpointId: string): Promise<ServiceEndpointDto | undefined>;
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
    this.assertNoDuplicateHostCandidate(tenantId, input);
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
    this.assertNoDuplicateHostCandidate(tenantId, input, hostId);
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
    if (!await this.getHost(tenantId, input.hostId)) {
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
      serviceInstance.id, tenantId, serviceInstance.hostId, serviceInstance.providerType, serviceInstance.serviceName ?? null, serviceInstance.displayName, serviceInstance.versionText ?? null, serviceInstance.installPath ?? null, serviceInstance.configPath ?? null, serviceInstance.runtimeUser ?? null, JSON.stringify(serviceInstance.ports), serviceInstance.providerKey ?? null, JSON.stringify(serviceInstance.manualOverrides), serviceInstance.discoverySource, serviceInstance.lastDiscoveredAt ?? null, serviceInstance.status, JSON.stringify(serviceInstance.rawFacts), serviceInstance.createdAt, serviceInstance.updatedAt, serviceInstance.version,
    ]);
    return serviceInstance;
  }

  async updateServiceInstance(tenantId: string, serviceInstanceId: string, input: UpdateServiceInstanceDto): Promise<ServiceInstanceDto> {
    const current = await this.getServiceInstance(tenantId, serviceInstanceId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceInstance 不存在', { serviceInstanceId });
    if (input.hostId && !await this.getHost(tenantId, input.hostId)) throw new AppError('RESOURCE_NOT_FOUND', 'Host 不存在', { hostId: input.hostId });
    const updated = touch({ ...current, ...input, hostId: input.hostId ?? current.hostId });
    await this.db.query(`update pg_service_instances set host_id=$2, provider_type=$3, service_name=$4, display_name=$5, version_text=$6, install_path=$7, config_path=$8, runtime_user=$9, ports=$10::jsonb, provider_key=$11, manual_overrides=$12::jsonb, discovery_source=$13, last_discovered_at=$14::timestamptz, status=$15, raw_facts=$16::jsonb, updated_at=$17::timestamptz, version=$18 where id=$1`, [
      updated.id, updated.hostId, updated.providerType, updated.serviceName ?? null, updated.displayName, updated.versionText ?? null, updated.installPath ?? null, updated.configPath ?? null, updated.runtimeUser ?? null, JSON.stringify(updated.ports), updated.providerKey ?? null, JSON.stringify(updated.manualOverrides), updated.discoverySource, updated.lastDiscoveredAt ?? null, updated.status, JSON.stringify(updated.rawFacts), updated.updatedAt, updated.version,
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

  async findServiceInstanceByIdentity(tenantId: string, input: { hostId: string; providerType: string; serviceName?: string; configPath?: string }): Promise<ServiceInstanceDto | undefined> {
    const serviceName = input.serviceName?.trim().toLowerCase();
    const configPath = input.configPath?.trim();
    const rows = (await this.db.query<ServiceInstanceRow>(`select * from pg_service_instances where tenant_id = $1 and deleted_at is null and host_id = $2 and provider_type = $3`, [tenantId, input.hostId, input.providerType])).rows.map(toServiceInstance);
    return rows.find((service) => {
      if (serviceName) return (service.serviceName ?? '').toLowerCase() === serviceName;
      if (configPath) return service.configPath === configPath;
      return service.serviceName === undefined && service.configPath === undefined;
    });
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
      endpoint.id, tenantId, endpoint.serviceInstanceId, endpoint.hostId, endpoint.protocol, endpoint.hostName ?? null, endpoint.listenIp ?? null, endpoint.port, endpoint.pathHint ?? null, endpoint.status, endpoint.createdAt, endpoint.updatedAt, endpoint.version,
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
      updated.id, updated.serviceInstanceId, updated.hostId, updated.protocol, updated.hostName ?? null, updated.listenIp ?? null, updated.port, updated.pathHint ?? null, updated.status, updated.updatedAt, updated.version,
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

  private assertNoDuplicateHostCandidate(tenantId: string, input: Partial<CreateHostDto>, excludedId?: string): void {
    void tenantId;
    void input;
    void excludedId;
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
    hostId: row.host_id,
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

function toServiceEndpoint(row: ServiceEndpointRow): ServiceEndpointDto {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    serviceInstanceId: row.service_instance_id,
    hostId: row.host_id,
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

function serviceEndpointFilter(endpoint: ServiceEndpointDto, field: string, expected: string): boolean {
  return stringField(endpoint, field).includes(expected.toLowerCase());
}

function discoverySnapshotFilter(snapshot: DiscoverySnapshotDto, field: string, expected: string): boolean {
  return stringField(snapshot, field).includes(expected.toLowerCase());
}

function assetConflictFilter(conflict: AssetConflictDto, field: string, expected: string): boolean {
  return stringField(conflict, field).includes(expected.toLowerCase());
}

function stringField(item: object, field: string): string {
  const value = readField(item, field);
  return value === undefined || value === null ? '' : String(value).toLowerCase();
}
