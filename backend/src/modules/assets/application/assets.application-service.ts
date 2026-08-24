import type { PageQuery } from '../../../common/pagination/pagination.js';
import { AppError } from '../../../common/errors/app-error.js';
import type { BindingsRepository } from '../../bindings/repository/bindings.repository.js';
import type { CertificateBindingDto, CreateCertificateBindingDto, UpdateCertificateBindingDto } from '../../bindings/dto/bindings.dto.js';
import { AssetsDomainService } from '../domain/assets.domain-service.js';
import type {
  AssetConflictDto,
  BindingDriftPersistenceDto,
  BindingDriftPersistenceResultDto,
  CreateDiscoverySnapshotDto,
  CreateHostDto,
  DiscoveryIngestResultDto,
  DiscoveryMergePreviewDto,
  IngestDiscoveryDto,
  NormalizedDiscoveredBindingDto,
  NormalizedDiscoveredHostDto,
  NormalizedDiscoveredServiceDto,
  PreviewDiscoveryMergeDto,
  ResolveAssetConflictDto,
  ResolvedAssetConflictDto,
  CreateServiceEndpointDto,
  CreateServiceInstanceDto,
  UpdateHostDto,
  UpdateServiceEndpointDto,
  UpdateServiceInstanceDto,
} from '../dto/assets.dto.js';
import { PgAssetsRepository, type AssetsRepository } from '../repository/assets.repository.js';

export class AssetsApplicationService {
  constructor(
    private readonly repository: AssetsRepository = new PgAssetsRepository(),
    private readonly domain = new AssetsDomainService(),
    private bindingsRepository?: BindingsRepository,
  ) {}

  setBindingsRepository(bindingsRepository: BindingsRepository): void {
    this.bindingsRepository = bindingsRepository;
  }

  async createHost(tenantId: string, input: CreateHostDto) {
    return this.repository.createHost(tenantId, this.domain.normalizeHost(input));
  }

  async updateHost(tenantId: string, hostId: string, input: UpdateHostDto) {
    return this.repository.updateHost(tenantId, hostId, this.domain.normalizeHostPatch(input));
  }

  async deleteHost(tenantId: string, hostId: string) {
    return this.repository.deleteHost(tenantId, hostId);
  }

  async listHosts(tenantId: string, query: PageQuery) {
    return this.repository.listHosts(tenantId, query);
  }

  async createServiceInstance(tenantId: string, input: CreateServiceInstanceDto) {
    return this.repository.createServiceInstance(tenantId, this.domain.normalizeServiceInstance(input));
  }

  async updateServiceInstance(tenantId: string, serviceInstanceId: string, input: UpdateServiceInstanceDto) {
    return this.repository.updateServiceInstance(tenantId, serviceInstanceId, this.domain.normalizeServiceInstancePatch(input));
  }

  async deleteServiceInstance(tenantId: string, serviceInstanceId: string) {
    return this.repository.deleteServiceInstance(tenantId, serviceInstanceId);
  }

  async listServiceInstances(tenantId: string, query: PageQuery) {
    return this.repository.listServiceInstances(tenantId, query);
  }

  async createServiceEndpoint(tenantId: string, input: CreateServiceEndpointDto) {
    return this.repository.createServiceEndpoint(tenantId, this.domain.normalizeServiceEndpoint(input));
  }

  async updateServiceEndpoint(tenantId: string, serviceEndpointId: string, input: UpdateServiceEndpointDto) {
    return this.repository.updateServiceEndpoint(tenantId, serviceEndpointId, this.domain.normalizeServiceEndpointPatch(input));
  }

  async deleteServiceEndpoint(tenantId: string, serviceEndpointId: string) {
    return this.repository.deleteServiceEndpoint(tenantId, serviceEndpointId);
  }

  async listServiceEndpoints(tenantId: string, query: PageQuery) {
    return this.repository.listServiceEndpoints(tenantId, query);
  }

  async upsertDiscoverySnapshot(tenantId: string, input: CreateDiscoverySnapshotDto) {
    return this.repository.upsertDiscoverySnapshot(tenantId, this.domain.normalizeDiscoverySnapshot(input));
  }

  async previewDiscoveryMerge(tenantId: string, input: PreviewDiscoveryMergeDto): Promise<DiscoveryMergePreviewDto> {
    const snapshot = await this.upsertDiscoverySnapshot(tenantId, input);
    const payload = snapshot.normalizedPayload;
    const hosts = Array.isArray(payload.hosts) ? payload.hosts : [];
    const actions: DiscoveryMergePreviewDto['actions'] = [];
    const conflicts: DiscoveryMergePreviewDto['conflicts'] = [];
    const existingHosts = (await this.listHosts(tenantId, { page: 1, pageSize: 500, filter: {}, sort: undefined })).items;
    for (const raw of hosts) {
      if (!raw || typeof raw !== 'object') continue;
      const discovered = raw as Record<string, unknown>;
      const hostname = String(discovered.hostname ?? '').trim().toLowerCase();
      if (!hostname) {
        actions.push({ kind: 'host', action: 'conflict', identityKey: 'host:missing-hostname', reason: '发现 Host 缺少 hostname，拒绝合并' });
        conflicts.push({ kind: 'host', identityKey: 'host:missing-hostname', field: 'hostname', currentValue: undefined, discoveredValue: discovered.hostname, reason: 'hostname 是 Host 身份键，不能缺失' });
        continue;
      }
      const identityKey = `host:${hostname}`;
      const current = existingHosts.find((host) => host.hostname === hostname);
      if (!current) {
        actions.push({ kind: 'host', action: 'create', identityKey, reason: '未找到现有 Host，可创建新资源' });
        continue;
      }
      if (current.displayName && discovered.displayName && current.displayName !== discovered.displayName) {
        actions.push({ kind: 'host', action: 'conflict', identityKey, existingId: current.id, reason: '人工展示名与发现值冲突，不能自动覆盖' });
        conflicts.push({ kind: 'host', identityKey, field: 'displayName', currentValue: current.displayName, discoveredValue: discovered.displayName, reason: 'displayName 可能是人工维护字段' });
        continue;
      }
      actions.push({ kind: 'host', action: 'update', identityKey, existingId: current.id, reason: '身份键匹配，可更新自动发现字段' });
    }
    return { snapshot, actions, conflicts, businessTableMutated: false };
  }

  async ingestDiscovery(tenantId: string, input: IngestDiscoveryDto): Promise<DiscoveryIngestResultDto> {
    const snapshot = await this.upsertDiscoverySnapshot(tenantId, input);
    const apply = input.apply === true;
    const payload = normalizeDiscoveryPayload(snapshot.normalizedPayload);
    const result: DiscoveryIngestResultDto = {
      snapshot,
      actions: [],
      conflicts: [],
      businessTableMutated: false,
    };
    const hostIds = new Map<string, string>();
    const serviceIds = new Map<string, string>();

    for (const host of payload.hosts) {
      const identityKey = hostIdentityKey(host);
      if (!identityKey) {
        result.actions.push({ kind: 'host', action: 'conflict', identityKey: 'host:missing-hostname', reason: '发现 Host 缺少 hostname，拒绝合并' });
        continue;
      }
      const hostname = normalizeOptionalString(host.hostname)?.toLowerCase();
      if (!hostname) {
        result.actions.push({ kind: 'host', action: 'conflict', identityKey: 'host:missing-hostname', reason: '发现 Host 缺少 hostname，拒绝合并' });
        continue;
      }
      const current = await this.repository.findHostByHostname(tenantId, hostname);
      if (!current) {
        if (!apply) {
          result.actions.push({ kind: 'host', action: 'create', identityKey, reason: '未找到现有 Host，可创建新资源' });
          continue;
        }
        const created = await this.createHost(tenantId, hostToCreateDto(host, snapshot.source));
        hostIds.set(identityKey, created.id);
        result.businessTableMutated = true;
        result.actions.push({ kind: 'host', action: 'create', identityKey, resourceId: created.id, reason: '未找到现有 Host，已创建新资源' });
        continue;
      }
      hostIds.set(identityKey, current.id);
      const conflicts = collectManualConflicts('host', current.id, snapshot.id, toRecord(current), toRecord(host), ['displayName']);
      result.conflicts.push(...await this.persistConflicts(tenantId, apply, conflicts));
      const patch = pickChangedAutoFields(toRecord(current), toRecord(host), ['primaryIp', 'ipAddresses', 'osType', 'osName', 'osVersion', 'arch', 'environment', 'zoneId', 'compatibilityLevel', 'managementMode', 'status', 'tags']);
      if (Object.keys(patch).length === 0) {
        result.actions.push({ kind: 'host', action: conflicts.length > 0 ? 'conflict' : 'skip', identityKey, existingId: current.id, resourceId: current.id, reason: conflicts.length > 0 ? '人工字段冲突，保留当前值' : '发现值与当前资源一致' });
        continue;
      }
      if (apply) {
        await this.updateHost(tenantId, current.id, patch as UpdateHostDto);
        result.businessTableMutated = true;
      }
      result.actions.push({ kind: 'host', action: conflicts.length > 0 ? 'conflict' : 'update', identityKey, existingId: current.id, resourceId: current.id, reason: '身份键匹配，自动字段可更新' });
    }

    for (const service of payload.services) {
      const hostId = await resolveHostId(service.hostname ?? service.hostRef, hostIds, tenantId, this.repository);
      if (!hostId) {
        result.actions.push({ kind: 'service', action: 'conflict', identityKey: serviceIdentityKey(service, 'missing-host'), reason: '发现 Service 缺少可匹配 Host，拒绝合并' });
        continue;
      }
      const identityKey = serviceIdentityKey(service, hostId);
      const current = await this.repository.findServiceInstanceByIdentity(tenantId, { hostId, providerType: service.providerType, serviceName: service.serviceName, configPath: service.configPath });
      if (!current) {
        if (!apply) {
          result.actions.push({ kind: 'service', action: 'create', identityKey, reason: '未找到现有 ServiceInstance，可创建新资源' });
          continue;
        }
        const created = await this.createServiceInstance(tenantId, serviceToCreateDto(service, hostId, snapshot.source));
        serviceIds.set(identityKey, created.id);
        result.businessTableMutated = true;
        result.actions.push({ kind: 'service', action: 'create', identityKey, resourceId: created.id, reason: '未找到现有 ServiceInstance，已创建新资源' });
        continue;
      }
      serviceIds.set(identityKey, current.id);
      const conflicts = collectManualConflicts('service', current.id, snapshot.id, toRecord(current), toRecord(service), ['displayName']);
      result.conflicts.push(...await this.persistConflicts(tenantId, apply, conflicts));
      const patch = pickChangedAutoFields(toRecord(current), { ...toRecord(service), lastDiscoveredAt: service.lastDiscoveredAt ?? snapshot.createdAt, discoverySource: service.discoverySource ?? snapshot.source }, ['versionText', 'installPath', 'configPath', 'runtimeUser', 'discoverySource', 'lastDiscoveredAt', 'status', 'rawFacts']);
      if (Object.keys(patch).length > 0 && apply) {
        await this.updateServiceInstance(tenantId, current.id, patch as UpdateServiceInstanceDto);
        result.businessTableMutated = true;
      }
      result.actions.push({ kind: 'service', action: conflicts.length > 0 ? 'conflict' : (Object.keys(patch).length > 0 ? 'update' : 'skip'), identityKey, existingId: current.id, resourceId: current.id, reason: conflicts.length > 0 ? '人工字段冲突，保留当前值' : '身份键匹配，可按自动字段合并' });
    }

    for (const binding of payload.bindings) {
      const resolvedServiceId = await resolveServiceId(binding, serviceIds, tenantId, this.repository);
      if (!resolvedServiceId) {
        result.actions.push({ kind: 'binding', action: 'conflict', identityKey: bindingIdentityKey(binding, 'missing-service'), reason: '发现 Binding 缺少可匹配 ServiceInstance，拒绝合并' });
        continue;
      }
      const createInput = bindingToCreateDto(binding, resolvedServiceId);
      const identityKey = bindingIdentityKey(binding, resolvedServiceId);
      const current = await this.requireBindingsRepository().findCertificateBindingByIdentity(tenantId, createInput);
      if (!current) {
        if (!apply) {
          result.actions.push({ kind: 'binding', action: 'create', identityKey, reason: '未找到现有 CertificateBinding，可创建新资源' });
          continue;
        }
        const created = await this.requireBindingsRepository().createCertificateBinding(tenantId, createInput);
        result.businessTableMutated = true;
        result.actions.push({ kind: 'binding', action: 'create', identityKey, resourceId: created.id, reason: '未找到现有 CertificateBinding，已创建新资源' });
        continue;
      }
      const conflicts = collectManualConflicts('binding', current.id, snapshot.id, toRecord(current), toRecord(createInput), ['reloadCommand']);
      const currentReloadHint = readNested(current.metadata, ['reloadHint']);
      const discoveredReloadHint = readNested(createInput.metadata, ['reloadHint']);
      if (currentReloadHint !== undefined && discoveredReloadHint !== undefined && !sameValue(currentReloadHint, discoveredReloadHint)) {
        conflicts.push({ resourceType: 'binding', resourceId: current.id, field: 'metadata.reloadHint', currentValue: currentReloadHint, discoveredValue: discoveredReloadHint, sourceSnapshotId: snapshot.id });
      }
      result.conflicts.push(...await this.persistConflicts(tenantId, apply, conflicts));
      const patch = pickChangedAutoFields(toRecord(current), toRecord(createInput), ['certificateVersionId', 'observedFingerprintSha256', 'desiredFingerprintSha256', 'certPath', 'keyPath', 'chainPath', 'keystorePath', 'keystoreType', 'storeLocation', 'storeName', 'storeThumbprint', 'verifyMethod', 'lastVerifiedAt', 'lastDeployedAt', 'status', 'metadata']);
      if (Object.keys(patch).length > 0 && apply) {
        await this.requireBindingsRepository().updateCertificateBinding(tenantId, current.id, patch as UpdateCertificateBindingDto);
        result.businessTableMutated = true;
      }
      result.actions.push({ kind: 'binding', action: conflicts.length > 0 ? 'conflict' : (Object.keys(patch).length > 0 ? 'update' : 'skip'), identityKey, existingId: current.id, resourceId: current.id, reason: conflicts.length > 0 ? '人工字段冲突，保留当前值' : '身份键匹配，可按自动字段合并' });
    }

    return result;
  }

  async listAssetConflicts(tenantId: string, query: PageQuery) {
    return this.repository.listAssetConflicts(tenantId, query);
  }

  async resolveAssetConflict(tenantId: string, input: ResolveAssetConflictDto): Promise<ResolvedAssetConflictDto> {
    const current = await this.repository.getAssetConflict(tenantId, input.id);
    if (!current) {
      throw new AppError('RESOURCE_NOT_FOUND', 'AssetConflict 不存在', { conflictId: input.id });
    }
    if (current.status !== 'open') {
      throw new AppError('VALIDATION_FAILED', 'AssetConflict 已处理，不能重复解决', { conflictId: input.id, status: current.status });
    }
    let resource: ResolvedAssetConflictDto['resource'];
    if (input.resolution === 'use_discovered' || input.resolution === 'custom') {
      const value = input.resolution === 'custom' ? input.customValue : current.discoveredValue;
      resource = await this.applyConflictValue(tenantId, current, value);
    } else if (input.resolution !== 'keep_current') {
      throw new AppError('VALIDATION_FAILED', 'resolution 不合法', { resolution: input.resolution });
    }
    const conflict = await this.repository.resolveAssetConflict(tenantId, input);
    return { conflict, resource };
  }

  async persistBindingDrift(tenantId: string, input: BindingDriftPersistenceDto): Promise<BindingDriftPersistenceResultDto> {
    const repository = this.requireBindingsRepository();
    const current = await repository.getCertificateBinding(tenantId, input.bindingId);
    if (!current) {
      throw new AppError('RESOURCE_NOT_FOUND', 'CertificateBinding 不存在', { bindingId: input.bindingId });
    }
    const checkedAt = input.checkedAt ?? new Date().toISOString();
    const patch: UpdateCertificateBindingDto = {
      localConfigFingerprint: normalizeFingerprintOrUndefined(input.localConfigFingerprint, 'localConfigFingerprint'),
      localConfigPath: normalizeOptionalString(input.localConfigPath),
      remoteEndpointFingerprint: normalizeFingerprintOrUndefined(input.remoteEndpointFingerprint, 'remoteEndpointFingerprint'),
      remoteStatus: input.remoteStatus ?? 'unknown',
      tlsVersion: normalizeOptionalString(input.tlsVersion),
      chainSummary: input.chainSummary,
      checkedAt,
      lastVerifiedAt: checkedAt,
    };
    if (patch.remoteStatus === 'unreachable') {
      delete patch.localConfigFingerprint;
      delete patch.localConfigPath;
    }
    const local = patch.localConfigFingerprint ?? current.localConfigFingerprint ?? readStringMetadata(current, 'localConfigFingerprint');
    const remote = patch.remoteEndpointFingerprint ?? current.remoteEndpointFingerprint ?? readStringMetadata(current, 'remoteEndpointFingerprint');
    const desired = current.desiredFingerprintSha256;
    const drift = this.bindingsDriftState(local, remote, desired, patch.remoteStatus);
    patch.driftStatus = drift;
    patch.status = drift === 'mismatch' ? 'DRIFTED' : current.status;
    const binding = await repository.updateCertificateBinding(tenantId, input.bindingId, patch);
    return { binding, driftStatus: drift };
  }

  async listDiscoverySnapshots(tenantId: string, query: PageQuery) {
    return this.repository.listDiscoverySnapshots(tenantId, query);
  }

  getRepository(): AssetsRepository {
    return this.repository;
  }

  private async persistConflicts(tenantId: string, apply: boolean, conflicts: Array<Omit<AssetConflictDto, 'id' | 'tenantId' | 'status' | 'createdAt' | 'updatedAt' | 'version'>>): Promise<AssetConflictDto[]> {
    if (!apply) return [];
    return Promise.all(conflicts.map((conflict) => this.repository.createAssetConflict(tenantId, conflict)));
  }

  private requireBindingsRepository(): BindingsRepository {
    if (!this.bindingsRepository) {
      throw new AppError('SYSTEM_INTERNAL_ERROR', 'BindingsRepository 未注入，无法处理发现绑定');
    }
    return this.bindingsRepository;
  }

  private async applyConflictValue(tenantId: string, conflict: AssetConflictDto, value: unknown): Promise<ResolvedAssetConflictDto['resource']> {
    if (conflict.resourceType === 'host') {
      return this.updateHost(tenantId, conflict.resourceId, { [conflict.field]: value } as UpdateHostDto);
    }
    if (conflict.resourceType === 'service') {
      return this.updateServiceInstance(tenantId, conflict.resourceId, { [conflict.field]: value } as UpdateServiceInstanceDto);
    }
    if (conflict.resourceType === 'binding') {
      const patch = conflict.field === 'metadata.reloadHint' ? { metadata: { reloadHint: value } } : { [conflict.field]: value };
      return this.requireBindingsRepository().updateCertificateBinding(tenantId, conflict.resourceId, patch as UpdateCertificateBindingDto);
    }
    throw new AppError('VALIDATION_FAILED', 'resourceType 不合法', { resourceType: conflict.resourceType });
  }

  private bindingsDriftState(local: string | undefined, remote: string | undefined, desired: string | undefined, remoteStatus: string | undefined) {
    if (remoteStatus === 'unreachable') return 'unreachable' as const;
    if (!desired) return 'unknown' as const;
    if (!local && !remote) return 'incomplete' as const;
    const observed = remote ?? local;
    return observed === desired ? 'synced' as const : 'mismatch' as const;
  }
}

function normalizeDiscoveryPayload(payload: Record<string, unknown>): { hosts: NormalizedDiscoveredHostDto[]; services: NormalizedDiscoveredServiceDto[]; bindings: NormalizedDiscoveredBindingDto[] } {
  return {
    hosts: arrayOfObjects(payload.hosts) as unknown as NormalizedDiscoveredHostDto[],
    services: arrayOfObjects(payload.services ?? payload.serviceInstances) as unknown as NormalizedDiscoveredServiceDto[],
    bindings: arrayOfObjects(payload.bindings ?? payload.certificateBindings) as unknown as NormalizedDiscoveredBindingDto[],
  };
}

function arrayOfObjects(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item))) : [];
}

function hostIdentityKey(host: NormalizedDiscoveredHostDto): string | undefined {
  const hostname = normalizeOptionalString(host.hostname)?.toLowerCase();
  return hostname ? `host:${hostname}` : undefined;
}

function serviceIdentityKey(service: NormalizedDiscoveredServiceDto, hostId: string): string {
  return `service:${hostId}:${service.providerType}:${normalizeOptionalString(service.serviceName) ?? normalizeOptionalString(service.configPath) ?? 'default'}`.toLowerCase();
}

function bindingIdentityKey(binding: NormalizedDiscoveredBindingDto, serviceId: string): string {
  return `binding:${serviceId}:${normalizeOptionalString(binding.domainName) ?? ''}:${binding.bindingType ?? 'FILE_PATH'}:${normalizeOptionalString(binding.certPath) ?? normalizeOptionalString(binding.keystorePath) ?? normalizeOptionalString(binding.storeThumbprint) ?? 'endpoint'}`.toLowerCase();
}

function hostToCreateDto(host: NormalizedDiscoveredHostDto, source: CreateDiscoverySnapshotDto['source']): CreateHostDto {
  return {
    ...host,
    hostname: host.hostname,
    status: host.status ?? 'ACTIVE',
    managementMode: host.managementMode ?? (source === 'AGENT' ? 'AGENT' : source === 'GATEWAY' ? 'GATEWAY' : source === 'SSH' ? 'AGENTLESS' : 'MONITOR_ONLY'),
  };
}

function serviceToCreateDto(service: NormalizedDiscoveredServiceDto, hostId: string, source: CreateDiscoverySnapshotDto['source']): CreateServiceInstanceDto {
  return {
    hostId,
    providerType: service.providerType,
    serviceName: service.serviceName,
    displayName: service.displayName ?? service.serviceName ?? service.providerType.toLowerCase(),
    versionText: service.versionText,
    installPath: service.installPath,
    configPath: service.configPath,
    runtimeUser: service.runtimeUser,
    discoverySource: service.discoverySource ?? source,
    lastDiscoveredAt: service.lastDiscoveredAt,
    status: service.status ?? 'ACTIVE',
    rawFacts: service.rawFacts ?? {},
  };
}

function bindingToCreateDto(binding: NormalizedDiscoveredBindingDto, serviceInstanceId: string): CreateCertificateBindingDto {
  return {
    serviceInstanceId,
    domainName: binding.domainName ?? binding.domain,
    domain: binding.domain ?? binding.domainName,
    port: binding.port,
    protocol: binding.protocol,
    bindingKey: binding.bindingKey,
    bindingType: binding.bindingType ?? 'FILE_PATH',
    certificateVersionId: binding.certificateVersionId ?? binding.targetCertificateVersionId,
    targetCertificateVersionId: binding.targetCertificateVersionId ?? binding.certificateVersionId,
    localCertificateVersionId: binding.localCertificateVersionId,
    observedFingerprintSha256: binding.observedFingerprintSha256,
    desiredFingerprintSha256: binding.desiredFingerprintSha256 ?? binding.targetFingerprintSha256,
    targetFingerprintSha256: binding.targetFingerprintSha256 ?? binding.desiredFingerprintSha256,
    unmanagedCertificateFingerprint: binding.unmanagedCertificateFingerprint,
    certPath: binding.certPath,
    keyPath: binding.keyPath,
    chainPath: binding.chainPath,
    keystorePath: binding.keystorePath,
    keystoreType: binding.keystoreType,
    storeLocation: binding.storeLocation,
    storeName: binding.storeName,
    storeThumbprint: binding.storeThumbprint,
    reloadCommand: binding.reloadCommand,
    reloadHint: binding.reloadHint,
    discoverySource: binding.discoverySource,
    verifyMethod: binding.verifyMethod ?? 'TLS_CONNECT',
    lastVerifiedAt: binding.lastVerifiedAt,
    lastDeployedAt: binding.lastDeployedAt,
    status: binding.status,
    metadata: binding.metadata ?? {},
  };
}

async function resolveHostId(hostRef: string | undefined, hostIds: Map<string, string>, tenantId: string, repository: AssetsRepository): Promise<string | undefined> {
  const normalized = normalizeOptionalString(hostRef)?.toLowerCase();
  if (!normalized) return undefined;
  if (await repository.getHost(tenantId, normalized)) return normalized;
  return hostIds.get(`host:${normalized}`) ?? (await repository.findHostByHostname(tenantId, normalized))?.id;
}

async function resolveServiceId(binding: NormalizedDiscoveredBindingDto, serviceIds: Map<string, string>, tenantId: string, repository: AssetsRepository): Promise<string | undefined> {
  const direct = normalizeOptionalString(binding.serviceRef);
  if (direct && await repository.getServiceInstance(tenantId, direct)) return direct;
  const hostId = await resolveHostId(binding.hostname, new Map(), tenantId, repository);
  if (!hostId || !binding.providerType) return undefined;
  const key = serviceIdentityKey({ providerType: binding.providerType, serviceName: binding.serviceName }, hostId);
  return serviceIds.get(key) ?? (await repository.findServiceInstanceByIdentity(tenantId, { hostId, providerType: binding.providerType, serviceName: binding.serviceName }))?.id;
}

function collectManualConflicts(resourceType: 'host' | 'service' | 'binding', resourceId: string, sourceSnapshotId: string, current: Record<string, unknown>, discovered: Record<string, unknown>, fields: string[]) {
  return fields.flatMap((field) => {
    if (current[field] === undefined || discovered[field] === undefined || sameValue(current[field], discovered[field])) return [];
    return [{ resourceType, resourceId, field, currentValue: current[field], discoveredValue: discovered[field], sourceSnapshotId }];
  });
}

function pickChangedAutoFields(current: Record<string, unknown>, discovered: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const field of fields) {
    if (discovered[field] === undefined) continue;
    if (!sameValue(current[field], discovered[field])) patch[field] = discovered[field];
  }
  return patch;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readNested(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeFingerprintOrUndefined(value: string | undefined, field: string): string | undefined {
  const normalized = normalizeOptionalString(value)?.toLowerCase();
  if (normalized !== undefined && !/^[0-9a-f]{64}$/.test(normalized)) {
    throw new AppError('VALIDATION_FAILED', `${field} 必须是 64 位 sha256 hex`, { field });
  }
  return normalized;
}

function readStringMetadata(binding: CertificateBindingDto, field: string): string | undefined {
  const value = binding.metadata[field];
  return typeof value === 'string' ? value : undefined;
}

function toRecord(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}
