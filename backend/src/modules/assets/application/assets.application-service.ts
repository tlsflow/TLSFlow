import type { PageQuery } from '../../../common/pagination/pagination.js';
import { AssetsDomainService } from '../domain/assets.domain-service.js';
import type {
  CreateDiscoverySnapshotDto,
  CreateHostDto,
  DiscoveryMergePreviewDto,
  PreviewDiscoveryMergeDto,
  CreateServiceEndpointDto,
  CreateServiceInstanceDto,
  UpdateHostDto,
  UpdateServiceEndpointDto,
  UpdateServiceInstanceDto,
} from '../dto/assets.dto.js';
import { InMemoryAssetsRepository, type AssetsRepository } from '../repository/assets.repository.js';

export class AssetsApplicationService {
  constructor(
    private readonly repository: AssetsRepository = new InMemoryAssetsRepository(),
    private readonly domain = new AssetsDomainService(),
  ) {}

  createHost(tenantId: string, input: CreateHostDto) {
    return this.repository.createHost(tenantId, this.domain.normalizeHost(input));
  }

  updateHost(tenantId: string, hostId: string, input: UpdateHostDto) {
    return this.repository.updateHost(tenantId, hostId, this.domain.normalizeHostPatch(input));
  }

  deleteHost(tenantId: string, hostId: string) {
    return this.repository.deleteHost(tenantId, hostId);
  }

  listHosts(tenantId: string, query: PageQuery) {
    return this.repository.listHosts(tenantId, query);
  }

  createServiceInstance(tenantId: string, input: CreateServiceInstanceDto) {
    return this.repository.createServiceInstance(tenantId, this.domain.normalizeServiceInstance(input));
  }

  updateServiceInstance(tenantId: string, serviceInstanceId: string, input: UpdateServiceInstanceDto) {
    return this.repository.updateServiceInstance(tenantId, serviceInstanceId, this.domain.normalizeServiceInstancePatch(input));
  }

  deleteServiceInstance(tenantId: string, serviceInstanceId: string) {
    return this.repository.deleteServiceInstance(tenantId, serviceInstanceId);
  }

  listServiceInstances(tenantId: string, query: PageQuery) {
    return this.repository.listServiceInstances(tenantId, query);
  }

  createServiceEndpoint(tenantId: string, input: CreateServiceEndpointDto) {
    return this.repository.createServiceEndpoint(tenantId, this.domain.normalizeServiceEndpoint(input));
  }

  updateServiceEndpoint(tenantId: string, serviceEndpointId: string, input: UpdateServiceEndpointDto) {
    return this.repository.updateServiceEndpoint(tenantId, serviceEndpointId, this.domain.normalizeServiceEndpointPatch(input));
  }

  deleteServiceEndpoint(tenantId: string, serviceEndpointId: string) {
    return this.repository.deleteServiceEndpoint(tenantId, serviceEndpointId);
  }

  listServiceEndpoints(tenantId: string, query: PageQuery) {
    return this.repository.listServiceEndpoints(tenantId, query);
  }

  upsertDiscoverySnapshot(tenantId: string, input: CreateDiscoverySnapshotDto) {
    return this.repository.upsertDiscoverySnapshot(tenantId, this.domain.normalizeDiscoverySnapshot(input));
  }

  previewDiscoveryMerge(tenantId: string, input: PreviewDiscoveryMergeDto): DiscoveryMergePreviewDto {
    const snapshot = this.upsertDiscoverySnapshot(tenantId, input);
    const payload = snapshot.normalizedPayload;
    const hosts = Array.isArray(payload.hosts) ? payload.hosts : [];
    const actions: DiscoveryMergePreviewDto['actions'] = [];
    const conflicts: DiscoveryMergePreviewDto['conflicts'] = [];
    const existingHosts = this.listHosts(tenantId, { page: 1, pageSize: 500, filter: {}, sort: undefined }).items;
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
        actions.push({ kind: 'host', action: 'create', identityKey, reason: '未找到现有 Host，可创建新资产' });
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

  listDiscoverySnapshots(tenantId: string, query: PageQuery) {
    return this.repository.listDiscoverySnapshots(tenantId, query);
  }

  getRepository(): AssetsRepository {
    return this.repository;
  }
}
