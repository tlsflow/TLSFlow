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
  CreateManagedTargetDto,
  CreateServiceAssetDto,
  DiscoveryIngestResultDto,
  DiscoveryMergePreviewDto,
  IngestDiscoveryDto,
  NormalizedDiscoveredBindingDto,
  NormalizedDiscoveredHostDto,
  NormalizedDiscoveredServiceAssetDto,
  NormalizedDiscoveredSiteAssetDto,
  NormalizedDiscoveredServiceDto,
  PreviewDiscoveryMergeDto,
  RefreshAssetsFromAgentDto,
  RefreshAssetsFromAgentResultDto,
  ResolveAssetConflictDto,
  ResolvedAssetConflictDto,
  CreateManagedTargetSnapshotDto,
  UpdateManagedTargetDto,
  UpdateSiteAssetDto,
  UpdateServiceAssetDto,
  CreateSiteAssetDto,
  CreateServiceEndpointDto,
  CreateFrameworkInstanceDto,
  UpdateHostDto,
  UpdateServiceEndpointDto,
  UpdateFrameworkInstanceDto,
  ServiceAssetDto,
  ServiceAssetDetailDto,
  DeploymentStrategyDto,
  WorkflowBindingProjectionRequestDto,
} from '../dto/assets.dto.js';
import { PgAssetsRepository, type AssetsRepository } from '../repository/assets.repository.js';
import { AgentsApplicationService } from '../../agents/application/agents.application-service.js';
import { AgentDirectClient } from '../../agents/application/agent-direct-client.js';
import type { WorkflowTemplatesApplicationService } from '../../workflow-templates/application/workflow-templates.application-service.js';
import type { PluginBindingsApplicationService } from '../../plugins/application/plugin-bindings.application-service.js';
import { buildWorkflowAssetContext, buildWorkflowBindingProjection } from '../../workflow-templates/domain/workflow-variable-resolver.js';
import {
  getDeploymentStrategyPluginBindingId,
  normalizeDeploymentStrategy,
  resolveDeploymentStrategy,
  validateDeploymentStrategyPluginBinding,
} from './deployment-strategy.service.js';
import type { ManagedTargetContextResolver } from './managed-target-context.resolver.js';

export class AssetsApplicationService {
  constructor(
    private readonly repository: AssetsRepository = new PgAssetsRepository(),
    private readonly domain = new AssetsDomainService(),
    private bindingsRepository?: BindingsRepository,
    private agentsService?: AgentsApplicationService,
    private readonly directClient = new AgentDirectClient(),
    private workflowTemplates?: WorkflowTemplatesApplicationService,
    private pluginBindings?: PluginBindingsApplicationService,
    private managedTargetContextResolver?: ManagedTargetContextResolver,
  ) {}

  setBindingsRepository(bindingsRepository: BindingsRepository): void {
    this.bindingsRepository = bindingsRepository;
  }

  setAgentsService(agentsService: AgentsApplicationService): void {
    this.agentsService = agentsService;
  }

  setWorkflowTemplatesService(workflowTemplates: WorkflowTemplatesApplicationService): void {
    this.workflowTemplates = workflowTemplates;
  }

  setPluginBindingsService(pluginBindings: PluginBindingsApplicationService): void {
    this.pluginBindings = pluginBindings;
  }

  setManagedTargetContextResolver(resolver: ManagedTargetContextResolver): void {
    this.managedTargetContextResolver = resolver;
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

  async createFrameworkInstance(tenantId: string, input: CreateFrameworkInstanceDto) {
    return this.repository.createFrameworkInstance(tenantId, this.domain.normalizeServiceInstance(input));
  }

  async updateFrameworkInstance(tenantId: string, serviceInstanceId: string, input: UpdateFrameworkInstanceDto) {
    return this.repository.updateFrameworkInstance(tenantId, serviceInstanceId, this.domain.normalizeServiceInstancePatch(input));
  }

  async deleteFrameworkInstance(tenantId: string, serviceInstanceId: string) {
    return this.repository.deleteFrameworkInstance(tenantId, serviceInstanceId);
  }

  async listFrameworkInstances(tenantId: string, query: PageQuery) {
    return this.repository.listFrameworkInstances(tenantId, query);
  }

  async createServiceAsset(tenantId: string, input: CreateServiceAssetDto): Promise<import('../dto/assets.dto.js').ServiceAssetDto> {
    const resolvedInput = await this.resolveSiteAssetCreationInput(tenantId, input);
    const normalized = this.domain.normalizeServiceAsset(resolvedInput);
    if (normalized.deploymentStrategy) {
      const strategy = await this.applyPluginBindingCompatibility(tenantId, normalizeDeploymentStrategy(normalized.deploymentStrategy, {
        asset: { id: '', metadata: normalized.metadata },
        targetBinding: normalized.targetBinding,
      }));
      await this.validateDeploymentStrategyReferences(tenantId, strategy);
      normalized.deploymentStrategy = strategy;
    }
    const created = await this.repository.createServiceAsset(tenantId, normalized);
    if (!created) throw new AppError('SYSTEM_INTERNAL_ERROR', '创建 ServiceAsset 后未返回结果');
    const hydrated = await this.repository.getServiceAssetIncludingDeleted(tenantId, created.id);
    if (hydrated) return this.hydrateServiceAssetStrategy(tenantId, hydrated);
    return this.hydrateServiceAssetStrategy(tenantId, created);
  }

  private async resolveSiteAssetCreationInput(tenantId: string, input: CreateServiceAssetDto): Promise<CreateServiceAssetDto> {
    if (!input.siteAssetId || input.targetBinding) return input;
    throw new AppError('VALIDATION_FAILED', '应用资产必须显式选择 ManagedTarget，禁止从 Site 自动推导部署目标', {
      code: 'MANAGED_TARGET_REQUIRED',
      siteAssetId: input.siteAssetId,
    });
  }

  async updateServiceAsset(tenantId: string, serviceAssetId: string, input: UpdateServiceAssetDto): Promise<import('../dto/assets.dto.js').ServiceAssetDto> {
    const normalized = this.domain.normalizeServiceAssetPatch(input);
    const current = await this.repository.getServiceAsset(tenantId, serviceAssetId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceAsset 不存在', { serviceAssetId });
    if (normalized.deploymentStrategy) {
      const targetBinding = await this.repository.getApplicationAssetTargetByApplicationAssetId(tenantId, serviceAssetId);
      const strategy = await this.applyPluginBindingCompatibility(tenantId, normalizeDeploymentStrategy(normalized.deploymentStrategy, {
        asset: current,
        targetBinding,
      }));
      await this.validateDeploymentStrategyReferences(tenantId, strategy);
      normalized.deploymentStrategy = strategy;
    }
    const updated = await this.repository.updateServiceAsset(tenantId, serviceAssetId, normalized);
    if (!updated) throw new AppError('SYSTEM_INTERNAL_ERROR', '更新 ServiceAsset 后未返回结果');
    const hydrated = await this.repository.getServiceAssetIncludingDeleted(tenantId, updated.id);
    if (hydrated) return this.hydrateServiceAssetStrategy(tenantId, hydrated);
    return this.hydrateServiceAssetStrategy(tenantId, updated);
  }

  async deleteServiceAsset(tenantId: string, serviceAssetId: string) {
    return this.repository.deleteServiceAsset(tenantId, serviceAssetId);
  }

  async listServiceAssets(tenantId: string, query: PageQuery) {
    const result = await this.repository.listServiceAssets(tenantId, query);
    return { ...result, items: await Promise.all(result.items.map((item) => this.hydrateServiceAssetStrategy(tenantId, item))) };
  }

  async getServiceAssetDetail(tenantId: string, serviceAssetId: string) {
    const detail = await this.repository.getServiceAssetDetail(tenantId, serviceAssetId);
    if (!detail) return detail;
    const hydrated = await this.hydrateServiceAssetStrategy(tenantId, detail);
    return this.hydrateServiceAssetTargetContext(tenantId, hydrated);
  }

  async updateServiceAssetDeploymentStrategy(tenantId: string, serviceAssetId: string, strategy: DeploymentStrategyDto, actorId?: string): Promise<ServiceAssetDto> {
    const asset = await this.repository.getServiceAsset(tenantId, serviceAssetId);
    if (!asset) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceAsset 不存在', { serviceAssetId });
    const targetBinding = await this.repository.getApplicationAssetTargetByApplicationAssetId(tenantId, serviceAssetId);
    const normalized = await this.applyPluginBindingCompatibility(
      tenantId,
      normalizeDeploymentStrategy(strategy, { asset, targetBinding, actorId }),
    );
    await this.validateDeploymentStrategyReferences(tenantId, normalized);
    const updated = await this.repository.updateServiceAsset(tenantId, serviceAssetId, {
      metadata: { ...asset.metadata, deploymentStrategy: normalized },
      deploymentStrategy: normalized,
    });
    return this.hydrateServiceAssetStrategy(tenantId, updated);
  }

  async projectWorkflowBinding(tenantId: string, input: WorkflowBindingProjectionRequestDto) {
    if (!this.workflowTemplates) throw new AppError('SYSTEM_INTERNAL_ERROR', '工作流服务未初始化');
    const version = input.workflowVersionId ? await this.workflowTemplates.getVersion(input.workflowVersionId) : await this.workflowTemplates.getRuntimePublishedVersion(input.workflowId);
    if (!version || version.templateId !== input.workflowId) throw new AppError('RESOURCE_NOT_FOUND', '工作流版本不存在或不匹配');
    const asset = input.serviceAssetId ? await this.repository.getServiceAsset(tenantId, input.serviceAssetId) : undefined;
    if (input.serviceAssetId && !asset) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceAsset 不存在');
    const context = buildWorkflowAssetContext({ ...(asset ?? {}), ...(input.asset ?? {}), target: input.target });
    return { workflowVersionId: version.id, workflowVersion: version.version, projection: buildWorkflowBindingProjection({ content: version.content, assetContext: context, connectionBindings: input.connectionBindings, parameterBindings: input.parameterBindings, phase: 'configure' }) };
  }

  async createSiteAsset(tenantId: string, input: CreateSiteAssetDto) {
    return this.repository.createSiteAsset(tenantId, this.domain.normalizeSiteAsset(input));
  }

  async updateSiteAsset(tenantId: string, siteAssetId: string, input: UpdateSiteAssetDto) {
    return this.repository.updateSiteAsset(tenantId, siteAssetId, this.domain.normalizeSiteAssetPatch(input));
  }

  async deleteSiteAsset(tenantId: string, siteAssetId: string) {
    return this.repository.deleteSiteAsset(tenantId, siteAssetId);
  }

  async listSiteAssets(tenantId: string, query: PageQuery) {
    return this.repository.listSiteAssets(tenantId, query);
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

  async createManagedTarget(tenantId: string, input: CreateManagedTargetDto) {
    return this.repository.createManagedTarget(tenantId, this.domain.normalizeManagedTarget(input));
  }

  async updateManagedTarget(tenantId: string, managedTargetId: string, input: UpdateManagedTargetDto) {
    return this.repository.updateManagedTarget(tenantId, managedTargetId, this.domain.normalizeManagedTargetPatch(input));
  }

  async deleteManagedTarget(tenantId: string, managedTargetId: string) {
    return this.repository.deleteManagedTarget(tenantId, managedTargetId);
  }

  async listManagedTargets(tenantId: string, query: PageQuery) {
    return this.repository.listManagedTargets(tenantId, query);
  }

  async createManagedTargetSnapshot(tenantId: string, input: CreateManagedTargetSnapshotDto) {
    return this.repository.createManagedTargetSnapshot(tenantId, input);
  }

  async listManagedTargetSnapshots(tenantId: string, query: PageQuery) {
    return this.repository.listManagedTargetSnapshots(tenantId, query);
  }

  async upsertDiscoverySnapshot(tenantId: string, input: CreateDiscoverySnapshotDto) {
    return this.repository.upsertDiscoverySnapshot(tenantId, this.domain.normalizeDiscoverySnapshot(input));
  }

  async previewDiscoveryMerge(tenantId: string, input: PreviewDiscoveryMergeDto): Promise<DiscoveryMergePreviewDto> {
    const snapshot = await this.upsertDiscoverySnapshot(tenantId, input);
    const payload = snapshot.normalizedPayload;
    const hosts = Array.isArray(payload.hosts) ? payload.hosts : [];
    const serviceAssets = Array.isArray(payload.serviceAssets) ? payload.serviceAssets : [];
    const actions: DiscoveryMergePreviewDto['actions'] = [];
    const conflicts: DiscoveryMergePreviewDto['conflicts'] = [];
    const existingHosts = (await this.listHosts(tenantId, { page: 1, pageSize: 500, filter: {}, sort: undefined })).items;
    const existingServiceAssets = (await this.listServiceAssets(tenantId, { page: 1, pageSize: 500, filter: {}, sort: undefined })).items;
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
    for (const raw of serviceAssets) {
      if (!raw || typeof raw !== 'object') continue;
      const discovered = raw as Record<string, unknown>;
      const address = normalizeOptionalString(String(discovered.address ?? ''))?.toLowerCase();
      const protocol = normalizeOptionalString(String(discovered.protocol ?? ''))?.toUpperCase();
      const port = Number(discovered.port);
      if (!address || !protocol || !Number.isInteger(port) || port < 1 || port > 65535) {
        actions.push({ kind: 'service_asset', action: 'conflict', identityKey: 'service-asset:invalid', reason: 'invalid service asset identity' });
        continue;
      }
      const identityKey = serviceAssetIdentityKey({ address, port, protocol: protocol as NormalizedDiscoveredServiceAssetDto['protocol'] });
      const current = existingServiceAssets.find((asset) => asset.address === address && asset.port === port && asset.protocol === protocol);
      if (!current) {
        actions.push({ kind: 'service_asset', action: 'create', identityKey, reason: 'service asset can be created' });
        continue;
      }
      if (current.displayName && discovered.displayName && current.displayName !== discovered.displayName) {
        actions.push({ kind: 'service_asset', action: 'conflict', identityKey, existingId: current.id, reason: 'manual displayName conflicts with discovered value' });
        conflicts.push({ kind: 'service_asset', identityKey, field: 'displayName', currentValue: current.displayName, discoveredValue: discovered.displayName, reason: 'displayName is treated as a manual field' } as any);
        continue;
      }
      actions.push({ kind: 'service_asset', action: 'update', identityKey, existingId: current.id, reason: 'service asset can be updated from discovery' });
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
    const serviceAssetIds = new Map<string, string>();
    const siteAssetIds = new Map<string, string>();
    const managedTargetIds = new Map<string, string>();

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
      const current = await this.repository.findFrameworkInstanceByIdentity(tenantId, frameworkIdentity(service, hostId, snapshot.source));
      if (!current) {
        if (!apply) {
        result.actions.push({ kind: 'service_asset', action: 'conflict', identityKey, reason: 'service instance not found for service asset creation' });
          continue;
        }
        const created = await this.createFrameworkInstance(tenantId, serviceToCreateDto(service, hostId, snapshot.source));
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
        await this.updateFrameworkInstance(tenantId, current.id, patch as UpdateFrameworkInstanceDto);
        result.businessTableMutated = true;
      }
      result.actions.push({ kind: 'service', action: conflicts.length > 0 ? 'conflict' : (Object.keys(patch).length > 0 ? 'update' : 'skip'), identityKey, existingId: current.id, resourceId: current.id, reason: conflicts.length > 0 ? '人工字段冲突，保留当前值' : '身份键匹配，可按自动字段合并' });
    }

    for (const serviceAsset of payload.serviceAssets) {
      const resolvedServiceId = await resolveServiceId(serviceAsset, serviceIds, tenantId, this.repository);
      if (!resolvedServiceId) {
        result.actions.push({ kind: 'service_asset', action: 'conflict', identityKey: serviceAssetIdentityKey(serviceAsset, 'missing-service'), reason: 'service asset is missing a resolvable service instance' });
        continue;
      }
      const identityKey = serviceAssetIdentityKey(serviceAsset);
      const current = await this.repository.findServiceAssetByIdentity(tenantId, {
        address: serviceAsset.address.toLowerCase(),
        port: serviceAsset.port,
        protocol: serviceAsset.protocol,
      });
      const serviceInstance = await this.repository.getFrameworkInstance(tenantId, resolvedServiceId);
      if (!serviceInstance) {
        result.actions.push({ kind: 'service_asset', action: 'conflict', identityKey, reason: 'service instance not found for service asset creation' });
        continue;
      }
      if (!current) {
        if (!apply) {
          result.actions.push({ kind: 'service_asset', action: 'create', identityKey, reason: 'service asset can be created' });
          continue;
        }
        const created = await this.createServiceAsset(tenantId, serviceAssetToCreateDto(serviceAsset, resolvedServiceId, serviceInstance.deviceId, snapshot.source));
        serviceAssetIds.set(identityKey, created.id);
        result.businessTableMutated = true;
        result.actions.push({ kind: 'service_asset', action: 'create', identityKey, resourceId: created.id, reason: 'service asset created from discovery' });
        continue;
      }
      serviceAssetIds.set(identityKey, current.id);
      const conflicts = collectManualConflicts('service_asset', current.id, snapshot.id, toRecord(current), toRecord(serviceAsset), ['displayName']);
      result.conflicts.push(...await this.persistConflicts(tenantId, apply, conflicts));
      const patch = pickChangedAutoFields(toRecord(current), { ...toRecord(serviceAsset), serviceInstanceId: resolvedServiceId, hostId: serviceInstance.deviceId, discoverySource: serviceAsset.discoverySource ?? snapshot.source, lastDiscoveredAt: serviceAsset.lastDiscoveredAt ?? snapshot.createdAt }, ['addressType', 'sniName', 'serviceInstanceId', 'hostId', 'environment', 'discoverySource', 'lastDiscoveredAt', 'status', 'tags', 'metadata']);
      if (Object.keys(patch).length > 0 && apply) {
        await this.updateServiceAsset(tenantId, current.id, patch as UpdateServiceAssetDto);
        result.businessTableMutated = true;
      }
      result.actions.push({ kind: 'service_asset', action: conflicts.length > 0 ? 'conflict' : (Object.keys(patch).length > 0 ? 'update' : 'skip'), identityKey, existingId: current.id, resourceId: current.id, reason: conflicts.length > 0 ? 'manual fields conflict with discovered values' : 'service asset merged from discovery' });
    }

    for (const siteAsset of payload.siteAssets) {
      const resolvedServiceId = await resolveServiceId(siteAsset, serviceIds, tenantId, this.repository);
      if (!resolvedServiceId) {
        result.actions.push({ kind: 'site_asset', action: 'conflict', identityKey: siteAssetIdentityKey(siteAsset, 'missing-service'), reason: 'site asset is missing a resolvable service instance' });
        continue;
      }
      const serviceInstance = await this.repository.getFrameworkInstance(tenantId, resolvedServiceId);
      if (!serviceInstance) {
        result.actions.push({ kind: 'site_asset', action: 'conflict', identityKey: siteAssetIdentityKey(siteAsset), reason: 'service instance not found for site asset creation' });
        continue;
      }
      const resolvedServiceAssetId = await resolveDiscoveredSiteServiceAssetId(siteAsset, serviceAssetIds, tenantId, this.repository);
      const identityKey = siteAssetIdentityKey(siteAsset);
      const current = await this.repository.findSiteAssetByIdentity(tenantId, {
        frameworkInstanceId: resolvedServiceId,
        siteKey: siteAsset.siteKey ?? identityKey,
      });
      if (!current) {
        if (!apply) {
          result.actions.push({ kind: 'site_asset', action: 'create', identityKey, reason: 'site asset can be created' });
          continue;
        }
        const created = await this.createSiteAsset(tenantId, siteAssetToCreateDto(siteAsset, resolvedServiceId, serviceInstance.deviceId, serviceInstance.discoveryProviderKey, snapshot.source));
        siteAssetIds.set(identityKey, created.id);
        if (siteAsset.siteAssetRef) siteAssetIds.set(siteAsset.siteAssetRef, created.id);
        result.businessTableMutated = true;
        result.actions.push({ kind: 'site_asset', action: 'create', identityKey, resourceId: created.id, reason: 'site asset created from discovery' });
        continue;
      }
      siteAssetIds.set(identityKey, current.id);
      if (siteAsset.siteAssetRef) siteAssetIds.set(siteAsset.siteAssetRef, current.id);
      const conflicts = collectManualConflicts('binding', current.id, snapshot.id, toRecord(current), toRecord(siteAsset), []);
      result.conflicts.push(...await this.persistConflicts(tenantId, apply, conflicts));
      const patch = pickChangedAutoFields(
        toRecord(current),
        {
          ...toRecord(siteAsset),
          frameworkInstanceId: resolvedServiceId,
          deviceId: serviceInstance.deviceId,
          discoveryProviderKey: serviceInstance.discoveryProviderKey,
          siteKey: siteAsset.siteKey ?? identityKey,
          discoverySource: siteAsset.discoverySource ?? snapshot.source,
          lastDiscoveredAt: siteAsset.lastDiscoveredAt ?? snapshot.createdAt,
        },
        ['bindingInformation', 'hostHeader', 'listenIp', 'port', 'protocol', 'configPath', 'runtimeStatus', 'discoverySource', 'lastDiscoveredAt', 'status', 'metadata'],
      );
      if (Object.keys(patch).length > 0 && apply) {
        await this.updateSiteAsset(tenantId, current.id, patch as UpdateSiteAssetDto);
        result.businessTableMutated = true;
      }
      result.actions.push({ kind: 'site_asset', action: Object.keys(patch).length > 0 ? 'update' : 'skip', identityKey, existingId: current.id, resourceId: current.id, reason: 'site asset merged from discovery' });
    }

    for (const siteAsset of payload.siteAssets) {
      result.actions.push({
        kind: 'managed_target',
        action: 'conflict',
        identityKey: managedTargetIdentityKey(siteAsset, undefined, 'discovery-v2-required'),
        reason: 'Discovery V1 不包含显式 ManagedTarget，禁止从 Site 自动推导目标',
      });
    }
    for (const binding of payload.bindings) {
      const resolvedServiceId = await resolveServiceId(binding, serviceIds, tenantId, this.repository);
      if (!resolvedServiceId) {
        result.actions.push({ kind: 'binding', action: 'conflict', identityKey: bindingIdentityKey(binding, 'missing-service'), reason: '发现 Binding 缺少可匹配 ServiceInstance，拒绝合并' });
        continue;
      }
      const resolvedServiceAssetId = await resolveServiceAssetId(binding, serviceAssetIds, tenantId, this.repository);
      const resolvedSiteAssetId = await resolveBindingSiteAssetId(binding, siteAssetIds, tenantId, this.repository);
      const resolvedManagedTargetId = resolveBindingManagedTargetId(binding, resolvedSiteAssetId, managedTargetIds);
      const createInput = bindingToCreateDto(binding, resolvedServiceId, resolvedServiceAssetId, resolvedSiteAssetId, resolvedManagedTargetId);
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
      const patch = pickChangedAutoFields(toRecord(current), toRecord(createInput), ['siteAssetId', 'managedTargetId', 'certificateVersionId', 'observedFingerprintSha256', 'desiredFingerprintSha256', 'certPath', 'keyPath', 'chainPath', 'keystorePath', 'keystoreType', 'storeLocation', 'storeName', 'storeThumbprint', 'verifyMethod', 'lastVerifiedAt', 'lastDeployedAt', 'status', 'metadata']);
      if (Object.keys(patch).length > 0 && apply) {
        await this.requireBindingsRepository().updateCertificateBinding(tenantId, current.id, patch as UpdateCertificateBindingDto);
        result.businessTableMutated = true;
      }
      result.actions.push({ kind: 'binding', action: conflicts.length > 0 ? 'conflict' : (Object.keys(patch).length > 0 ? 'update' : 'skip'), identityKey, existingId: current.id, resourceId: current.id, reason: conflicts.length > 0 ? '人工字段冲突，保留当前值' : '身份键匹配，可按自动字段合并' });
    }

    return result;
  }

  async refreshAssetsFromAgent(tenantId: string, input: RefreshAssetsFromAgentDto): Promise<RefreshAssetsFromAgentResultDto> {
    if (!this.agentsService) {
      throw new AppError('SYSTEM_INTERNAL_ERROR', 'AssetsApplicationService 未注入 AgentsApplicationService');
    }
    const detail = await this.agentsService.getAgentDetail(tenantId, input.agentId);
    const direct = await this.directClient.runDiscovery(detail.agent, {
      providerTypes: input.providerTypes,
      includeBindings: input.includeBindings,
      requestId: input.requestId,
    });
    const result = await this.ingestDiscovery(tenantId, {
      normalizedHash: buildDiscoveryHash(`agent-direct:${input.agentId}:${new Date().toISOString()}`, 'direct'),
      source: 'AGENT',
      apply: true,
      normalizedPayload: direct.payload as unknown as Record<string, unknown>,
      rawPayload: {
        mode: 'direct',
        directControl: direct.directControl,
        request: input,
      },
    });
    return { ...result, mode: 'direct' };
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
      return this.updateFrameworkInstance(tenantId, conflict.resourceId, { [conflict.field]: value } as UpdateFrameworkInstanceDto);
    }
    if (conflict.resourceType === 'service_asset') {
      return this.updateServiceAsset(tenantId, conflict.resourceId, { [conflict.field]: value } as UpdateServiceAssetDto);
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

  private async ensureAgentHostAnchor(tenantId: string, agentId: string | undefined, serviceInstanceId?: string): Promise<string | undefined> {
    if (!agentId || !this.agentsService) return undefined;

    const detail = await this.agentsService.getAgentDetail(tenantId, agentId);
    const hostname = detail.agent.descriptor.hostname?.trim().toLowerCase();
    const primaryIp = detail.agent.descriptor.ipAddress?.trim();
    if (!hostname && !primaryIp) return undefined;

    let host = hostname ? await this.repository.findHostByHostname(tenantId, hostname) : undefined;
    if (!host) {
      host = await this.createHost(tenantId, {
        hostname,
        primaryIp,
        ipAddresses: primaryIp ? [primaryIp] : [],
        osType: String(detail.agent.descriptor.osType ?? 'UNKNOWN').toUpperCase() as CreateHostDto['osType'],
        osVersion: detail.agent.descriptor.osVersion,
        arch: detail.agent.descriptor.arch,
        agentId,
        discoverySource: 'AGENT',
        compatibilityLevel: 'L1',
        managementMode: 'AGENT',
        status: 'ACTIVE',
      });
    }

    if (serviceInstanceId) {
      const service = await this.repository.getFrameworkInstance(tenantId, serviceInstanceId);
      if (service && service.deviceId !== host.id) {
        await this.updateFrameworkInstance(tenantId, service.id, { deviceId: host.id });
      }
    }
    return host.id;
  }

  private async hydrateServiceAssetStrategy<T extends ServiceAssetDto>(tenantId: string, asset: T): Promise<T> {
    const targetBinding = await this.repository.getApplicationAssetTargetByApplicationAssetId(tenantId, asset.id);
    const strategy = resolveDeploymentStrategy({ asset, targetBinding });
    return {
      ...asset,
      deploymentStrategy: strategy ? await this.applyPluginBindingCompatibility(tenantId, strategy) : undefined,
    };
  }

  private async hydrateServiceAssetTargetContext(tenantId: string, asset: ServiceAssetDetailDto): Promise<ServiceAssetDetailDto> {
    const targetBinding = asset.targetBinding;
    if (!targetBinding) return asset;
    const managedTargetId = targetBinding.managedTargetId;
    if (!this.managedTargetContextResolver) {
      throw new AppError('SYSTEM_INTERNAL_ERROR', 'ManagedTargetContextResolver 未接入，无法返回应用资产部署上下文', {
        code: 'MANAGED_TARGET_CONTEXT_RESOLVER_MISSING',
        serviceAssetId: asset.id,
        managedTargetId,
      });
    }
    const context = await this.managedTargetContextResolver.resolveTopology(tenantId, managedTargetId);
    return {
      ...asset,
      targetBindingDetail: {
        ...(asset.targetBindingDetail ?? targetBinding),
        host: context.host,
        frameworkInstance: context.serviceInstance,
        siteAsset: context.siteAsset,
        managedTarget: context.managedTarget,
        certificateBindings: asset.targetBindingDetail?.certificateBindings ?? [],
      },
    };
  }

  private async applyPluginBindingCompatibility(tenantId: string, strategy: DeploymentStrategyDto): Promise<DeploymentStrategyDto> {
    const pluginBindingId = getDeploymentStrategyPluginBindingId(strategy);
    if (!pluginBindingId) return strategy;
    if (!this.pluginBindings) {
      throw new AppError('SYSTEM_INTERNAL_ERROR', 'PluginBinding 服务未接入，不能校验统一部署策略', {
        code: 'PLUGIN_BINDING_VALIDATOR_MISSING',
        pluginBindingId,
      });
    }
    const binding = await this.pluginBindings.getBinding(pluginBindingId);
    if (!binding || binding.tenantId !== tenantId) {
      throw new AppError('RESOURCE_NOT_FOUND', '部署策略引用的 PluginBinding 不存在', { pluginBindingId });
    }
    return validateDeploymentStrategyPluginBinding(strategy, binding);
  }

  private async validateDeploymentStrategyReferences(tenantId: string, strategy: DeploymentStrategyDto): Promise<void> {
    if (strategy.type === 'WORKFLOW') {
      const workflow = strategy.workflow;
      if (!workflow) throw new AppError('VALIDATION_FAILED', 'WORKFLOW 策略缺少 workflow 配置', { code: 'DEPLOYMENT_STRATEGY_INVALID' });
      if (workflow.workflowExecutionBindingId) return;
      if (workflow.pluginBindingId) return;
      if (!this.workflowTemplates) {
        throw new AppError('SYSTEM_INTERNAL_ERROR', '工作流版本服务未接入，不能保存 WORKFLOW 部署策略', { code: 'WORKFLOW_VERSION_VALIDATOR_MISSING' });
      }
      if (!workflow.workflowId) throw new AppError('VALIDATION_FAILED', 'WORKFLOW 策略缺少 workflowId', { code: 'WORKFLOW_ID_REQUIRED' });
      if ((workflow.workflowVersionSelection ?? 'PINNED') === 'LATEST_PUBLISHED') {
        const latest = await this.workflowTemplates.getRuntimePublishedVersion(workflow.workflowId);
        if (!latest) {
          throw new AppError('VALIDATION_FAILED', 'WORKFLOW 策略选择始终使用最新版本，但该工作流没有已发布版本', {
            code: 'WORKFLOW_VERSION_NOT_PUBLISHED',
            workflowId: workflow.workflowId,
          });
        }
      } else {
        if (!workflow.workflowVersionId) {
          throw new AppError('VALIDATION_FAILED', 'WORKFLOW 固定版本策略必须指定 workflowVersionId', {
            code: 'DEPLOYMENT_STRATEGY_INVALID',
            workflowId: workflow.workflowId,
          });
        }
        const version = await this.workflowTemplates.getVersion(workflow.workflowVersionId);
        if (version.templateId !== workflow.workflowId) {
          throw new AppError('VALIDATION_FAILED', 'WORKFLOW 策略引用的 workflowId 与 workflowVersionId 不匹配', {
            code: 'DEPLOYMENT_STRATEGY_INVALID',
            workflowId: workflow.workflowId,
            workflowVersionId: workflow.workflowVersionId,
            actualWorkflowId: version.templateId,
          });
        }
        if (version.status !== 'published') {
          throw new AppError('VALIDATION_FAILED', 'WORKFLOW 策略只能引用已发布的工作流版本', {
            code: 'WORKFLOW_VERSION_NOT_PUBLISHED',
            workflowId: workflow.workflowId,
            workflowVersionId: workflow.workflowVersionId,
            status: version.status,
          });
        }
      }
      if (workflow.rollbackWorkflowVersionId) {
        const rollbackVersion = await this.workflowTemplates.getVersion(workflow.rollbackWorkflowVersionId);
        if (rollbackVersion.status !== 'published') {
          throw new AppError('VALIDATION_FAILED', 'WORKFLOW 回滚策略只能引用已发布的工作流版本', {
            code: 'WORKFLOW_VERSION_NOT_PUBLISHED',
            workflowId: rollbackVersion.templateId,
            workflowVersionId: workflow.rollbackWorkflowVersionId,
            status: rollbackVersion.status,
          });
        }
      }
    }
  }
	}

function normalizeDiscoveryPayload(payload: Record<string, unknown>): { hosts: NormalizedDiscoveredHostDto[]; services: NormalizedDiscoveredServiceDto[]; serviceAssets: NormalizedDiscoveredServiceAssetDto[]; siteAssets: NormalizedDiscoveredSiteAssetDto[]; bindings: NormalizedDiscoveredBindingDto[] } {
  const bindings = arrayOfObjects(payload.bindings ?? payload.certificateBindings) as unknown as NormalizedDiscoveredBindingDto[];
  const explicitServiceAssets = arrayOfObjects(payload.serviceAssets) as unknown as NormalizedDiscoveredServiceAssetDto[];
  const explicitSiteAssets = arrayOfObjects(payload.siteAssets) as unknown as NormalizedDiscoveredSiteAssetDto[];
  return {
    hosts: arrayOfObjects(payload.hosts) as unknown as NormalizedDiscoveredHostDto[],
    services: arrayOfObjects(payload.services ?? payload.serviceInstances) as unknown as NormalizedDiscoveredServiceDto[],
    serviceAssets: explicitServiceAssets.length > 0 ? explicitServiceAssets : projectDiscoveredServiceAssetsFromBindings(bindings),
    siteAssets: explicitSiteAssets,
    bindings,
  };
}

function arrayOfObjects(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item))) : [];
}

function buildDiscoveryHash(prefix: string, mode: string): string {
  return `${prefix}:${mode}`.toLowerCase();
}

function hostIdentityKey(host: NormalizedDiscoveredHostDto): string | undefined {
  const hostname = normalizeOptionalString(host.hostname)?.toLowerCase();
  return hostname ? `host:${hostname}` : undefined;
}

function serviceIdentityKey(service: Pick<NormalizedDiscoveredServiceDto, 'frameworkType' | 'frameworkKey' | 'configPath'>, hostId: string): string {
  return `service:${hostId}:${service.frameworkType}:${normalizeOptionalString(service.frameworkKey) ?? normalizeOptionalString(service.configPath) ?? 'default'}`.toLowerCase();
}

function serviceAssetIdentityKey(
  serviceAsset: Pick<NormalizedDiscoveredServiceAssetDto, 'address' | 'port' | 'protocol'>,
  fallback = 'invalid',
): string {
  const address = normalizeOptionalString(serviceAsset.address)?.toLowerCase();
  const protocol = normalizeOptionalString(serviceAsset.protocol)?.toUpperCase();
  const port = serviceAsset.port;
  if (!address || !protocol || !Number.isInteger(port) || port < 1 || port > 65535) {
    return `service-asset:${fallback}`;
  }
  return `service-asset:${address}:${port}:${protocol}`.toLowerCase();
}

function siteAssetIdentityKey(siteAsset: Pick<NormalizedDiscoveredSiteAssetDto, 'siteName' | 'siteKey' | 'bindingInformation' | 'hostHeader' | 'port'>, fallback = 'invalid'): string {
  const siteKey = normalizeOptionalString(siteAsset.siteKey)?.toLowerCase();
  if (siteKey) return `site-asset:${siteKey}`;
  const siteName = normalizeOptionalString(siteAsset.siteName)?.toLowerCase();
  if (!siteName) return `site-asset:${fallback}`;
  const bindingInformation = normalizeOptionalString(siteAsset.bindingInformation)?.toLowerCase();
  const hostHeader = normalizeOptionalString(siteAsset.hostHeader)?.toLowerCase();
  return `site-asset:${siteName}:${bindingInformation ?? hostHeader ?? siteAsset.port ?? '_'}`.toLowerCase();
}

function managedTargetIdentityKey(siteAsset: Pick<NormalizedDiscoveredSiteAssetDto, 'siteName' | 'siteKey' | 'bindingInformation' | 'hostHeader' | 'port'>, agentId: string | undefined, fallback = 'invalid'): string {
  return `managed-target:${agentId ?? '_'}:${managedTargetTargetKey(siteAsset, agentId, fallback)}`.toLowerCase();
}

function managedTargetTargetKey(siteAsset: Pick<NormalizedDiscoveredSiteAssetDto, 'siteName' | 'siteKey' | 'bindingInformation' | 'hostHeader' | 'port'>, agentId: string | undefined, fallback = 'invalid'): string {
  const siteKey = normalizeOptionalString(siteAsset.siteKey)?.toLowerCase();
  if (siteKey) return [agentId ?? '_', 'site-binding', siteKey].join(':').toLowerCase();
  const siteName = normalizeOptionalString(siteAsset.siteName)?.toLowerCase();
  if (!siteName) return [agentId ?? '_', 'site-binding', fallback].join(':').toLowerCase();
  const bindingInformation = normalizeOptionalString(siteAsset.bindingInformation)?.toLowerCase();
  const hostHeader = normalizeOptionalString(siteAsset.hostHeader)?.toLowerCase();
  return [agentId ?? '_', 'site-binding', siteName, bindingInformation ?? hostHeader ?? String(siteAsset.port ?? '_')].join(':').toLowerCase();
}

function bindingIdentityKey(binding: NormalizedDiscoveredBindingDto, serviceId: string): string {
  const address = normalizeOptionalString(binding.domainName ?? binding.domain)?.toLowerCase();
  const port = binding.port;
  const protocol = normalizeOptionalString(binding.protocol)?.toUpperCase();
  const serviceAssetIdentity = address && port && protocol
    ? `${address}:${port}:${protocol}`
    : normalizeOptionalString(binding.serviceAssetRef) ?? serviceId;
  const bindingLocation = normalizeOptionalString(binding.bindingKey)
    ?? normalizeOptionalString(binding.certPath)
    ?? normalizeOptionalString(binding.keystorePath)
    ?? normalizeOptionalString(binding.storeThumbprint)
    ?? normalizeOptionalString(binding.domainName ?? binding.domain)
    ?? 'endpoint';
  return `binding:${serviceAssetIdentity}:${binding.bindingType ?? 'FILE_PATH'}:${bindingLocation}`.toLowerCase();
}

function hostToCreateDto(host: NormalizedDiscoveredHostDto, source: CreateDiscoverySnapshotDto['source']): CreateHostDto {
  return {
    ...host,
    hostname: host.hostname,
    status: host.status ?? 'ACTIVE',
    managementMode: host.managementMode ?? (source === 'AGENT' ? 'AGENT' : source === 'GATEWAY' ? 'GATEWAY' : source === 'SSH' ? 'AGENTLESS' : 'MONITOR_ONLY'),
  };
}

function serviceToCreateDto(service: NormalizedDiscoveredServiceDto, hostId: string, source: CreateDiscoverySnapshotDto['source']): CreateFrameworkInstanceDto {
  const identity = frameworkIdentity(service, hostId, source);
  return {
    ...identity,
    displayName: service.displayName ?? service.frameworkKey ?? service.frameworkType.toLowerCase(),
    frameworkVersion: service.versionText,
    discoverySource: service.discoverySource ?? source,
    lastDiscoveredAt: service.lastDiscoveredAt,
    status: service.status ?? 'ACTIVE',
    rawFacts: service.rawFacts ?? {},
  };
}

function serviceAssetToCreateDto(serviceAsset: NormalizedDiscoveredServiceAssetDto, serviceInstanceId: string, hostId: string | undefined, source: CreateDiscoverySnapshotDto['source']): CreateServiceAssetDto {
  return {
    address: serviceAsset.address,
    addressType: serviceAsset.addressType,
    port: serviceAsset.port,
    protocol: serviceAsset.protocol,
    sniName: serviceAsset.sniName,
    displayName: serviceAsset.displayName,
    serviceInstanceId,
    hostId,
    environment: serviceAsset.environment,
    discoverySource: serviceAsset.discoverySource ?? source,
    lastDiscoveredAt: serviceAsset.lastDiscoveredAt,
    status: serviceAsset.status ?? 'ACTIVE',
    tags: serviceAsset.tags ?? [],
    metadata: serviceAsset.metadata ?? {},
  };
}

function siteAssetToCreateDto(
  siteAsset: NormalizedDiscoveredSiteAssetDto,
  frameworkInstanceId: string,
  deviceId: string,
  discoveryProviderKey: string,
  source: CreateDiscoverySnapshotDto['source'],
): CreateSiteAssetDto {
  const identityKey = siteAssetIdentityKey(siteAsset);
  return {
    frameworkInstanceId,
    deviceId,
    discoveryProviderKey,
    siteType: siteAsset.siteType ?? 'CUSTOM',
    siteName: siteAsset.siteName,
    siteKey: siteAsset.siteKey ?? identityKey,
    bindingInformation: siteAsset.bindingInformation,
    hostHeader: siteAsset.hostHeader,
    listenIp: siteAsset.listenIp,
    port: siteAsset.port,
    protocol: siteAsset.protocol,
    configPath: siteAsset.configPath,
    runtimeStatus: siteAsset.runtimeStatus,
    discoverySource: siteAsset.discoverySource ?? source,
    lastDiscoveredAt: siteAsset.lastDiscoveredAt,
    status: siteAsset.status ?? 'ACTIVE',
    metadata: siteAsset.metadata ?? {},
  };
}

function projectDiscoveredServiceAssetsFromBindings(bindings: NormalizedDiscoveredBindingDto[]): NormalizedDiscoveredServiceAssetDto[] {
  const seen = new Set<string>();
  const projected: NormalizedDiscoveredServiceAssetDto[] = [];
  for (const binding of bindings) {
    const address = normalizeOptionalString(binding.domainName ?? binding.domain)?.toLowerCase();
    const protocol = normalizeOptionalString(binding.protocol)?.toUpperCase() as NormalizedDiscoveredServiceAssetDto['protocol'] | undefined;
    if (!address || !binding.port || !protocol) continue;
    const identityKey = serviceAssetIdentityKey({ address, port: binding.port, protocol });
    if (seen.has(identityKey)) continue;
    seen.add(identityKey);
    projected.push({
      serviceRef: binding.serviceRef,
      hostname: binding.hostname,
      frameworkType: binding.frameworkType,
      frameworkKey: binding.frameworkKey,
      address,
      addressType: undefined,
      port: binding.port,
      protocol,
      sniName: address,
      displayName: address,
      discoverySource: binding.discoverySource as NormalizedDiscoveredServiceAssetDto['discoverySource'],
      lastDiscoveredAt: binding.lastVerifiedAt,
      status: 'ACTIVE',
      tags: [],
      metadata: {
        projectedFrom: 'binding',
        serviceAssetRef: binding.serviceAssetRef,
        bindingKey: binding.bindingKey,
      },
    });
  }
  return projected;
}

function bindingToCreateDto(binding: NormalizedDiscoveredBindingDto, serviceInstanceId: string, serviceAssetId?: string, siteAssetId?: string, managedTargetId?: string): CreateCertificateBindingDto {
  return {
    serviceAssetId,
    siteAssetId,
    managedTargetId,
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

async function resolveServiceId(
  input: Pick<NormalizedDiscoveredBindingDto, 'serviceRef' | 'hostname' | 'frameworkType' | 'frameworkKey' | 'discoveryProviderKey'> | Pick<NormalizedDiscoveredServiceAssetDto, 'serviceRef' | 'hostname' | 'frameworkType' | 'frameworkKey' | 'discoveryProviderKey'> | Pick<NormalizedDiscoveredSiteAssetDto, 'serviceRef' | 'hostname' | 'frameworkType' | 'frameworkKey' | 'discoveryProviderKey'>,
  serviceIds: Map<string, string>,
  tenantId: string,
  repository: AssetsRepository,
): Promise<string | undefined> {
  const direct = normalizeOptionalString(input.serviceRef);
  if (direct && await repository.getFrameworkInstance(tenantId, direct)) return direct;
  const hostId = await resolveHostId(input.hostname, new Map(), tenantId, repository);
  if (!hostId || !input.frameworkType || !input.discoveryProviderKey) return undefined;
  const key = serviceIdentityKey({ frameworkType: input.frameworkType, frameworkKey: input.frameworkKey }, hostId);
  return serviceIds.get(key) ?? (await repository.findFrameworkInstanceByIdentity(tenantId, frameworkIdentity({ frameworkType: input.frameworkType, frameworkKey: input.frameworkKey, discoveryProviderKey: input.discoveryProviderKey }, hostId, 'MANUAL')))?.id;
}

function frameworkIdentity(service: Pick<NormalizedDiscoveredServiceDto, 'frameworkType' | 'frameworkKey' | 'configPath' | 'discoveryProviderKey'>, deviceId: string, _source: CreateDiscoverySnapshotDto['source']): Pick<CreateFrameworkInstanceDto, 'deviceId' | 'frameworkType' | 'frameworkKey' | 'discoveryProviderKey'> {
  const frameworkType = String(service.frameworkType).trim().toLowerCase();
  if (!/^[a-z0-9]+([.-][a-z0-9]+)+$/.test(frameworkType)) {
    throw new AppError('VALIDATION_FAILED', 'frameworkType 必须使用开放命名空间', { frameworkType });
  }
  return {
    deviceId,
    frameworkType,
    frameworkKey: normalizeOptionalString(service.frameworkKey) ?? normalizeOptionalString(service.configPath) ?? `${frameworkType}:default`,
    discoveryProviderKey: normalizeOptionalString(service.discoveryProviderKey)!,
  };
}

async function resolveServiceAssetId(
  binding: NormalizedDiscoveredBindingDto,
  serviceAssetIds: Map<string, string>,
  tenantId: string,
  repository: AssetsRepository,
): Promise<string | undefined> {
  const direct = normalizeOptionalString(binding.serviceAssetRef);
  if (direct && await repository.getServiceAsset(tenantId, direct)) return direct;
  const address = normalizeOptionalString(binding.domainName ?? binding.domain)?.toLowerCase();
  if (!address || !binding.port || !binding.protocol) return undefined;
  const identityKey = serviceAssetIdentityKey({ address, port: binding.port, protocol: binding.protocol as NormalizedDiscoveredServiceAssetDto['protocol'] });
  return serviceAssetIds.get(identityKey) ?? (await repository.findServiceAssetByIdentity(tenantId, { address, port: binding.port, protocol: binding.protocol }))?.id;
}

async function resolveDiscoveredSiteServiceAssetId(
  siteAsset: NormalizedDiscoveredSiteAssetDto,
  serviceAssetIds: Map<string, string>,
  tenantId: string,
  repository: AssetsRepository,
): Promise<string | undefined> {
  const direct = normalizeOptionalString(siteAsset.serviceAssetRef);
  if (direct && await repository.getServiceAsset(tenantId, direct)) return direct;
  return direct ? serviceAssetIds.get(direct) : undefined;
}

function resolveDiscoveredSiteAssetId(
  siteAsset: NormalizedDiscoveredSiteAssetDto,
  siteAssetIds: Map<string, string>,
): string | undefined {
  const direct = normalizeOptionalString(siteAsset.siteAssetRef);
  if (direct && siteAssetIds.has(direct)) return siteAssetIds.get(direct);
  return siteAssetIds.get(siteAssetIdentityKey(siteAsset));
}

async function resolveBindingSiteAssetId(
  binding: NormalizedDiscoveredBindingDto,
  siteAssetIds: Map<string, string>,
  tenantId: string,
  repository: AssetsRepository,
): Promise<string | undefined> {
  const direct = normalizeOptionalString(binding.siteAssetRef);
  if (direct && await repository.getSiteAsset(tenantId, direct)) return direct;
  if (direct && siteAssetIds.has(direct)) return siteAssetIds.get(direct);
  const domain = normalizeOptionalString(binding.domainName ?? binding.domain)?.toLowerCase();
  if (!domain) return undefined;
  const identityKey = siteAssetIdentityKey({
    siteName: domain,
    hostHeader: domain,
    port: binding.port,
    bindingInformation: binding.port && binding.protocol ? `*:${binding.port}:${domain}` : undefined,
  });
  return siteAssetIds.get(identityKey);
}

function resolveBindingManagedTargetId(
  binding: NormalizedDiscoveredBindingDto,
  siteAssetId: string | undefined,
  managedTargetIds: Map<string, string>,
): string | undefined {
  const siteAssetRef = normalizeOptionalString(binding.siteAssetRef);
  if (siteAssetRef && managedTargetIds.has(`site-asset-ref:${siteAssetRef}`)) return managedTargetIds.get(`site-asset-ref:${siteAssetRef}`);
  if (siteAssetId && managedTargetIds.has(`site-asset-id:${siteAssetId}`)) return managedTargetIds.get(`site-asset-id:${siteAssetId}`);
  return undefined;
}

function collectManualConflicts(resourceType: 'host' | 'service' | 'service_asset' | 'binding', resourceId: string, sourceSnapshotId: string, current: Record<string, unknown>, discovered: Record<string, unknown>, fields: string[]) {
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
