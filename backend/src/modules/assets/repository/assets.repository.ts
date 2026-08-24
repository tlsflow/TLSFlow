import { AppError } from '../../../common/errors/app-error.js';
import type { PageQuery } from '../../../common/pagination/pagination.js';
import { newId } from '../../../shared/id.js';
import type {
  CreateHostDto,
  CreateDiscoverySnapshotDto,
  CreateServiceEndpointDto,
  CreateServiceInstanceDto,
  DiscoverySnapshotDto,
  HostDto,
  ServiceEndpointDto,
  ServiceInstanceDto,
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
  createHost(tenantId: string, input: CreateHostDto): HostDto;
  updateHost(tenantId: string, hostId: string, input: UpdateHostDto): HostDto;
  deleteHost(tenantId: string, hostId: string): HostDto;
  listHosts(tenantId: string, query: PageQuery): PageResult<HostDto>;
  getHost(tenantId: string, hostId: string): HostDto | undefined;
  getHostIncludingDeleted(tenantId: string, hostId: string): HostDto | undefined;
  createServiceInstance(tenantId: string, input: CreateServiceInstanceDto): ServiceInstanceDto;
  updateServiceInstance(tenantId: string, serviceInstanceId: string, input: UpdateServiceInstanceDto): ServiceInstanceDto;
  deleteServiceInstance(tenantId: string, serviceInstanceId: string): ServiceInstanceDto;
  listServiceInstances(tenantId: string, query: PageQuery): PageResult<ServiceInstanceDto>;
  getServiceInstance(tenantId: string, serviceInstanceId: string): ServiceInstanceDto | undefined;
  getServiceInstanceIncludingDeleted(tenantId: string, serviceInstanceId: string): ServiceInstanceDto | undefined;
  createServiceEndpoint(tenantId: string, input: CreateServiceEndpointDto): ServiceEndpointDto;
  updateServiceEndpoint(tenantId: string, serviceEndpointId: string, input: UpdateServiceEndpointDto): ServiceEndpointDto;
  deleteServiceEndpoint(tenantId: string, serviceEndpointId: string): ServiceEndpointDto;
  listServiceEndpoints(tenantId: string, query: PageQuery): PageResult<ServiceEndpointDto>;
  getServiceEndpoint(tenantId: string, serviceEndpointId: string): ServiceEndpointDto | undefined;
  getServiceEndpointIncludingDeleted(tenantId: string, serviceEndpointId: string): ServiceEndpointDto | undefined;
  upsertDiscoverySnapshot(tenantId: string, input: CreateDiscoverySnapshotDto): DiscoverySnapshotDto;
  listDiscoverySnapshots(tenantId: string, query: PageQuery): PageResult<DiscoverySnapshotDto>;
}

export class InMemoryAssetsRepository implements AssetsRepository {
  readonly moduleName = 'assets' as const;
  private readonly hosts = new Map<string, HostDto>();
  private readonly serviceInstances = new Map<string, ServiceInstanceDto>();
  private readonly serviceEndpoints = new Map<string, ServiceEndpointDto>();
  private readonly discoverySnapshots = new Map<string, DiscoverySnapshotDto>();

  createHost(tenantId: string, input: CreateHostDto): HostDto {
    const duplicate = [...this.hosts.values()].find((host) => host.tenantId === tenantId && host.deletedAt === undefined && host.hostname === input.hostname);
    if (duplicate) {
      throw new AppError('RESOURCE_ALREADY_EXISTS', 'Host hostname 已存在', { hostname: input.hostname, existingId: duplicate.id });
    }
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
      compatibilityLevel: input.compatibilityLevel ?? 'L1',
      managementMode: input.managementMode ?? 'MONITOR_ONLY',
      status: input.status ?? 'ACTIVE',
      tags: input.tags ?? [],
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    this.hosts.set(host.id, host);
    return host;
  }

  updateHost(tenantId: string, hostId: string, input: UpdateHostDto): HostDto {
    const current = this.getHost(tenantId, hostId);
    if (!current) {
      throw new AppError('RESOURCE_NOT_FOUND', 'Host 不存在', { hostId });
    }
    if (input.hostname && input.hostname !== current.hostname) {
      const duplicate = [...this.hosts.values()].find((host) => host.tenantId === tenantId && host.deletedAt === undefined && host.hostname === input.hostname && host.id !== hostId);
      if (duplicate) {
        throw new AppError('RESOURCE_ALREADY_EXISTS', 'Host hostname 已存在', { hostname: input.hostname, existingId: duplicate.id });
      }
    }
    const updated = touch({ ...current, ...input });
    this.hosts.set(updated.id, updated);
    return updated;
  }

  deleteHost(tenantId: string, hostId: string): HostDto {
    const current = this.getHost(tenantId, hostId);
    if (!current) {
      throw new AppError('RESOURCE_NOT_FOUND', 'Host 不存在', { hostId });
    }
    const deleted = softDelete(current);
    this.hosts.set(deleted.id, deleted);
    return deleted;
  }

  listHosts(tenantId: string, query: PageQuery): PageResult<HostDto> {
    return page([...this.hosts.values()].filter((host) => host.tenantId === tenantId && host.deletedAt === undefined), query, hostFilter);
  }

  getHost(tenantId: string, hostId: string): HostDto | undefined {
    const host = this.hosts.get(hostId);
    return host?.tenantId === tenantId && host.deletedAt === undefined ? host : undefined;
  }

  getHostIncludingDeleted(tenantId: string, hostId: string): HostDto | undefined {
    const host = this.hosts.get(hostId);
    return host?.tenantId === tenantId ? host : undefined;
  }

  createServiceInstance(tenantId: string, input: CreateServiceInstanceDto): ServiceInstanceDto {
    if (!this.getHost(tenantId, input.hostId)) {
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
      discoverySource: input.discoverySource ?? 'MANUAL',
      lastDiscoveredAt: input.lastDiscoveredAt,
      status: input.status ?? 'ACTIVE',
      rawFacts: input.rawFacts ?? {},
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    this.serviceInstances.set(serviceInstance.id, serviceInstance);
    return serviceInstance;
  }

  updateServiceInstance(tenantId: string, serviceInstanceId: string, input: UpdateServiceInstanceDto): ServiceInstanceDto {
    const current = this.getServiceInstance(tenantId, serviceInstanceId);
    if (!current) {
      throw new AppError('RESOURCE_NOT_FOUND', 'ServiceInstance 不存在', { serviceInstanceId });
    }
    if (input.hostId && !this.getHost(tenantId, input.hostId)) {
      throw new AppError('RESOURCE_NOT_FOUND', 'Host 不存在', { hostId: input.hostId });
    }
    const updated = touch({ ...current, ...input });
    this.serviceInstances.set(updated.id, updated);
    return updated;
  }

  deleteServiceInstance(tenantId: string, serviceInstanceId: string): ServiceInstanceDto {
    const current = this.getServiceInstance(tenantId, serviceInstanceId);
    if (!current) {
      throw new AppError('RESOURCE_NOT_FOUND', 'ServiceInstance 不存在', { serviceInstanceId });
    }
    const deleted = softDelete(current);
    this.serviceInstances.set(deleted.id, deleted);
    return deleted;
  }

  listServiceInstances(tenantId: string, query: PageQuery): PageResult<ServiceInstanceDto> {
    return page([...this.serviceInstances.values()].filter((service) => service.tenantId === tenantId && service.deletedAt === undefined), query, serviceInstanceFilter);
  }

  getServiceInstance(tenantId: string, serviceInstanceId: string): ServiceInstanceDto | undefined {
    const serviceInstance = this.serviceInstances.get(serviceInstanceId);
    return serviceInstance?.tenantId === tenantId && serviceInstance.deletedAt === undefined ? serviceInstance : undefined;
  }

  getServiceInstanceIncludingDeleted(tenantId: string, serviceInstanceId: string): ServiceInstanceDto | undefined {
    const serviceInstance = this.serviceInstances.get(serviceInstanceId);
    return serviceInstance?.tenantId === tenantId ? serviceInstance : undefined;
  }

  createServiceEndpoint(tenantId: string, input: CreateServiceEndpointDto): ServiceEndpointDto {
    const serviceInstance = this.getServiceInstance(tenantId, input.serviceInstanceId);
    if (!serviceInstance) {
      throw new AppError('RESOURCE_NOT_FOUND', 'ServiceInstance 不存在', { serviceInstanceId: input.serviceInstanceId });
    }
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
    this.serviceEndpoints.set(endpoint.id, endpoint);
    return endpoint;
  }

  updateServiceEndpoint(tenantId: string, serviceEndpointId: string, input: UpdateServiceEndpointDto): ServiceEndpointDto {
    const current = this.getServiceEndpoint(tenantId, serviceEndpointId);
    if (!current) {
      throw new AppError('RESOURCE_NOT_FOUND', 'ServiceEndpoint 不存在', { serviceEndpointId });
    }
    let nextHostId = current.hostId;
    if (input.serviceInstanceId && input.serviceInstanceId !== current.serviceInstanceId) {
      const serviceInstance = this.getServiceInstance(tenantId, input.serviceInstanceId);
      if (!serviceInstance) {
        throw new AppError('RESOURCE_NOT_FOUND', 'ServiceInstance 不存在', { serviceInstanceId: input.serviceInstanceId });
      }
      nextHostId = serviceInstance.hostId;
    }
    const updated = touch({ ...current, ...input, hostId: nextHostId });
    this.serviceEndpoints.set(updated.id, updated);
    return updated;
  }

  deleteServiceEndpoint(tenantId: string, serviceEndpointId: string): ServiceEndpointDto {
    const current = this.getServiceEndpoint(tenantId, serviceEndpointId);
    if (!current) {
      throw new AppError('RESOURCE_NOT_FOUND', 'ServiceEndpoint 不存在', { serviceEndpointId });
    }
    const deleted = softDelete(current);
    this.serviceEndpoints.set(deleted.id, deleted);
    return deleted;
  }

  listServiceEndpoints(tenantId: string, query: PageQuery): PageResult<ServiceEndpointDto> {
    return page([...this.serviceEndpoints.values()].filter((endpoint) => endpoint.tenantId === tenantId && endpoint.deletedAt === undefined), query, serviceEndpointFilter);
  }

  getServiceEndpoint(tenantId: string, serviceEndpointId: string): ServiceEndpointDto | undefined {
    const endpoint = this.serviceEndpoints.get(serviceEndpointId);
    return endpoint?.tenantId === tenantId && endpoint.deletedAt === undefined ? endpoint : undefined;
  }

  getServiceEndpointIncludingDeleted(tenantId: string, serviceEndpointId: string): ServiceEndpointDto | undefined {
    const endpoint = this.serviceEndpoints.get(serviceEndpointId);
    return endpoint?.tenantId === tenantId ? endpoint : undefined;
  }

  upsertDiscoverySnapshot(tenantId: string, input: CreateDiscoverySnapshotDto): DiscoverySnapshotDto {
    const duplicate = [...this.discoverySnapshots.values()].find((snapshot) => snapshot.tenantId === tenantId && snapshot.normalizedHash === input.normalizedHash);
    if (duplicate) {
      return duplicate;
    }
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
    this.discoverySnapshots.set(snapshot.id, snapshot);
    return snapshot;
  }

  listDiscoverySnapshots(tenantId: string, query: PageQuery): PageResult<DiscoverySnapshotDto> {
    return page([...this.discoverySnapshots.values()].filter((snapshot) => snapshot.tenantId === tenantId), query, discoverySnapshotFilter);
  }
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

function stringField(item: object, field: string): string {
  const value = readField(item, field);
  return value === undefined || value === null ? '' : String(value).toLowerCase();
}
