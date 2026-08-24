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
  CreateServiceInstanceDto,
  UpdateHostDto,
  UpdateServiceEndpointDto,
  UpdateServiceInstanceDto,
  ServiceAssetDto,
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

export class AssetsApplicationService {
  constructor(
    private readonly repository: AssetsRepository = new PgAssetsRepository(),
    private readonly domain = new AssetsDomainService(),
    private bindingsRepository?: BindingsRepository,
    private agentsService?: AgentsApplicationService,
    private readonly directClient = new AgentDirectClient(),
    private workflowTemplates?: WorkflowTemplatesApplicationService,
    private pluginBindings?: PluginBindingsApplicationService,
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

  async createServiceAsset(tenantId: string, input: CreateServiceAssetDto): Promise<import('../dto/assets.dto.js').ServiceAssetDto> {
    const resolvedInput = await this.resolveSiteAssetCreationInput(tenantId, input);
    const normalized = this.domain.normalizeServiceAsset(resolvedInput);
    if (normalized.deploymentStrategy) {
      const strategy = await this.applyPluginBindingCompatibility(tenantId, normalizeDeploymentStrategy(normalized.deploymentStrategy, {
        asset: { id: '', agentId: normalized.agentId, metadata: normalized.metadata },
        targetBinding: normalized.targetBinding,
      }));
      await this.validateDeploymentStrategyReferences(tenantId, strategy);
      normalized.deploymentStrategy = strategy;
    }
    await this.assertServiceAssetAgentPlatform(tenantId, normalized.platform, normalized.agentId);
    const created = await this.repository.createServiceAsset(tenantId, normalized);
    if (!created) throw new AppError('SYSTEM_INTERNAL_ERROR', '创建 ServiceAsset 后未返回结果');
    await this.ensureApplicationAssetTargetBinding(tenantId, created.id);
    const hydrated = await this.repository.getServiceAssetIncludingDeleted(tenantId, created.id);
    if (hydrated) return this.hydrateServiceAssetStrategy(tenantId, hydrated);
    return this.hydrateServiceAssetStrategy(tenantId, created);
  }

  private async resolveSiteAssetCreationInput(tenantId: string, input: CreateServiceAssetDto): Promise<CreateServiceAssetDto> {
    if (!input.siteAssetId || input.targetBinding) return input;

    const siteAsset = await this.repository.getSiteAsset(tenantId, input.siteAssetId);
    if (!siteAsset || siteAsset.status !== 'ACTIVE') {
      throw new AppError('RESOURCE_NOT_FOUND', 'SiteAsset 不存在或不可用', { siteAssetId: input.siteAssetId });
    }

    const managedTargets = await this.repository.listActiveManagedTargetsBySiteAssetId(tenantId, siteAsset.id);
    if (managedTargets.length === 0) {
      throw new AppError('VALIDATION_FAILED', '站点没有可用的 ManagedTarget', {
        code: 'SITE_MANAGED_TARGET_UNAVAILABLE',
        siteAssetId: siteAsset.id,
      });
    }
    if (managedTargets.length > 1) {
      throw new AppError('RESOURCE_VERSION_CONFLICT', '站点存在多个可用的 ManagedTarget，无法自动选择', {
        code: 'SITE_MANAGED_TARGET_AMBIGUOUS',
        siteAssetId: siteAsset.id,
        managedTargetIds: managedTargets.map((item) => item.id),
      });
    }

    const managedTarget = managedTargets[0]!;
    return {
      ...input,
      serviceInstanceId: managedTarget.serviceInstanceId ?? siteAsset.serviceInstanceId,
      hostId: managedTarget.hostId ?? siteAsset.hostId,
      deploymentStrategy: input.deploymentStrategy ?? {
        type: 'MANAGED_TARGET',
        managedTarget: {
          managedTargetId: managedTarget.id,
          certificateFormatId: input.certificateFormatId,
          deploymentMode: managedTarget.deploymentMode,
        },
      },
      targetBinding: {
        applicationAssetId: '',
        agentId: managedTarget.agentId,
        deviceAssetId: managedTarget.deviceAssetId,
        siteAssetId: siteAsset.id,
        managedTargetId: managedTarget.id,
        providerType: managedTarget.providerType,
        frameworkType: managedTarget.frameworkType,
        targetType: managedTarget.targetType,
        targetKey: managedTarget.targetKey,
        bindingKey: managedTarget.bindingKey,
        status: 'ACTIVE',
        metadata: {
          source: 'manual_site_selection',
          siteName: siteAsset.siteName,
          bindingInformation: siteAsset.bindingInformation,
        },
      },
    };
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
    await this.assertServiceAssetAgentPlatform(tenantId, normalized.platform ?? current.platform, normalized.agentId ?? current.agentId);
    const updated = await this.repository.updateServiceAsset(tenantId, serviceAssetId, normalized);
    if (!updated) throw new AppError('SYSTEM_INTERNAL_ERROR', '更新 ServiceAsset 后未返回结果');
    await this.ensureApplicationAssetTargetBinding(tenantId, updated.id);
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
    return detail ? this.hydrateServiceAssetStrategy(tenantId, detail) : detail;
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
      const current = await this.repository.findServiceInstanceByIdentity(tenantId, { hostId, providerType: service.providerType, serviceName: service.serviceName, configPath: service.configPath });
      if (!current) {
        if (!apply) {
        result.actions.push({ kind: 'service_asset', action: 'conflict', identityKey, reason: 'service instance not found for service asset creation' });
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
      const serviceInstance = await this.repository.getServiceInstance(tenantId, resolvedServiceId);
      if (!serviceInstance) {
        result.actions.push({ kind: 'service_asset', action: 'conflict', identityKey, reason: 'service instance not found for service asset creation' });
        continue;
      }
      if (!current) {
        if (!apply) {
          result.actions.push({ kind: 'service_asset', action: 'create', identityKey, reason: 'service asset can be created' });
          continue;
        }
        const created = await this.createServiceAsset(tenantId, serviceAssetToCreateDto(serviceAsset, resolvedServiceId, serviceInstance.hostId, snapshot.source));
        serviceAssetIds.set(identityKey, created.id);
        result.businessTableMutated = true;
        result.actions.push({ kind: 'service_asset', action: 'create', identityKey, resourceId: created.id, reason: 'service asset created from discovery' });
        continue;
      }
      serviceAssetIds.set(identityKey, current.id);
      const conflicts = collectManualConflicts('service_asset', current.id, snapshot.id, toRecord(current), toRecord(serviceAsset), ['displayName']);
      result.conflicts.push(...await this.persistConflicts(tenantId, apply, conflicts));
      const patch = pickChangedAutoFields(toRecord(current), { ...toRecord(serviceAsset), serviceInstanceId: resolvedServiceId, hostId: serviceInstance.hostId, discoverySource: serviceAsset.discoverySource ?? snapshot.source, lastDiscoveredAt: serviceAsset.lastDiscoveredAt ?? snapshot.createdAt }, ['addressType', 'sniName', 'serviceInstanceId', 'hostId', 'environment', 'discoverySource', 'lastDiscoveredAt', 'status', 'tags', 'metadata']);
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
      const serviceInstance = await this.repository.getServiceInstance(tenantId, resolvedServiceId);
      if (!serviceInstance) {
        result.actions.push({ kind: 'site_asset', action: 'conflict', identityKey: siteAssetIdentityKey(siteAsset), reason: 'service instance not found for site asset creation' });
        continue;
      }
      const resolvedServiceAssetId = await resolveDiscoveredSiteServiceAssetId(siteAsset, serviceAssetIds, tenantId, this.repository);
      const identityKey = siteAssetIdentityKey(siteAsset);
      const current = await this.repository.findSiteAssetByIdentity(tenantId, {
        agentId: siteAsset.agentId,
        providerType: siteAsset.providerType ?? serviceInstance.providerType,
        siteKey: siteAsset.siteKey ?? identityKey,
      });
      if (!current) {
        if (!apply) {
          result.actions.push({ kind: 'site_asset', action: 'create', identityKey, reason: 'site asset can be created' });
          continue;
        }
        const created = await this.createSiteAsset(tenantId, siteAssetToCreateDto(siteAsset, resolvedServiceId, resolvedServiceAssetId, serviceInstance.hostId, serviceInstance.providerType, snapshot.source));
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
          serviceInstanceId: resolvedServiceId,
          serviceAssetId: resolvedServiceAssetId,
          hostId: serviceInstance.hostId,
          providerType: siteAsset.providerType ?? serviceInstance.providerType,
          siteKey: siteAsset.siteKey ?? identityKey,
          discoverySource: siteAsset.discoverySource ?? snapshot.source,
          lastDiscoveredAt: siteAsset.lastDiscoveredAt ?? snapshot.createdAt,
        },
        ['serviceAssetId', 'bindingInformation', 'hostHeader', 'listenIp', 'port', 'protocol', 'configPath', 'runtimeStatus', 'discoverySource', 'lastDiscoveredAt', 'status', 'metadata'],
      );
      if (Object.keys(patch).length > 0 && apply) {
        await this.updateSiteAsset(tenantId, current.id, patch as UpdateSiteAssetDto);
        result.businessTableMutated = true;
      }
      result.actions.push({ kind: 'site_asset', action: Object.keys(patch).length > 0 ? 'update' : 'skip', identityKey, existingId: current.id, resourceId: current.id, reason: 'site asset merged from discovery' });
    }

    for (const siteAsset of payload.siteAssets) {
      const resolvedSiteAssetId = resolveDiscoveredSiteAssetId(siteAsset, siteAssetIds);
      if (!resolvedSiteAssetId) {
        result.actions.push({ kind: 'managed_target', action: 'conflict', identityKey: managedTargetIdentityKey(siteAsset, undefined, 'missing-site-asset'), reason: 'managed target is missing a resolvable site asset' });
        continue;
      }
      const siteAssetRecord = await this.repository.getSiteAsset(tenantId, resolvedSiteAssetId);
      if (!siteAssetRecord) {
        result.actions.push({ kind: 'managed_target', action: 'conflict', identityKey: managedTargetIdentityKey(siteAsset, undefined, 'missing-site-record'), reason: 'site asset record not found for managed target creation' });
        continue;
      }
      const hostRecord = siteAssetRecord.hostId ? await this.repository.getHost(tenantId, siteAssetRecord.hostId) : undefined;
      const agentId = normalizeOptionalString(siteAsset.agentId)?.toLowerCase() ?? normalizeOptionalString(hostRecord?.agentId)?.toLowerCase();
      if (!agentId) {
        result.actions.push({ kind: 'managed_target', action: 'conflict', identityKey: managedTargetIdentityKey(siteAsset, undefined, 'missing-agent'), reason: 'managed target requires agentId on site asset or host' });
        continue;
      }
      const providerType = siteAsset.providerType ?? siteAssetRecord.providerType;
      const identityKey = managedTargetIdentityKey(siteAsset, agentId);
      const targetKey = managedTargetTargetKey(siteAsset, agentId);
      const current = await this.repository.findManagedTargetByIdentity(tenantId, {
        agentId,
        providerType,
        targetType: 'SITE_BINDING',
        targetKey,
      });
      if (!current) {
        if (!apply) {
          result.actions.push({ kind: 'managed_target', action: 'create', identityKey, reason: 'managed target can be created' });
          continue;
        }
        const created = await this.createManagedTarget(tenantId, managedTargetToCreateDto(siteAsset, siteAssetRecord, agentId, snapshot.source));
        managedTargetIds.set(identityKey, created.id);
        managedTargetIds.set(`site-asset-id:${resolvedSiteAssetId}`, created.id);
        if (siteAsset.siteAssetRef) managedTargetIds.set(`site-asset-ref:${siteAsset.siteAssetRef}`, created.id);
        result.businessTableMutated = true;
        result.actions.push({ kind: 'managed_target', action: 'create', identityKey, resourceId: created.id, reason: 'managed target created from site asset' });
        continue;
      }
      managedTargetIds.set(identityKey, current.id);
      managedTargetIds.set(`site-asset-id:${resolvedSiteAssetId}`, current.id);
      if (siteAsset.siteAssetRef) managedTargetIds.set(`site-asset-ref:${siteAsset.siteAssetRef}`, current.id);
      const patch = pickChangedAutoFields(
        toRecord(current),
        {
          ...toRecord(siteAsset),
          hostId: siteAssetRecord.hostId,
          serviceInstanceId: siteAssetRecord.serviceInstanceId,
          serviceAssetId: siteAssetRecord.serviceAssetId,
          siteAssetId: siteAssetRecord.id,
          providerType,
          frameworkType: providerType,
          targetKey,
          targetType: 'SITE_BINDING',
          bindingKey: siteAsset.bindingInformation ?? siteAsset.siteKey ?? siteAsset.siteName,
          capabilityProfile: managedTargetCapabilityProfile(siteAsset, siteAssetRecord),
          deploymentMode: 'AGENT',
          lastSeenAt: siteAsset.lastDiscoveredAt ?? snapshot.createdAt,
          status: 'ACTIVE',
          metadata: current.metadata,
        },
        ['hostId', 'serviceInstanceId', 'serviceAssetId', 'siteAssetId', 'bindingKey', 'capabilityProfile', 'deploymentMode', 'lastSeenAt', 'status'],
      );
      if (Object.keys(patch).length > 0 && apply) {
        await this.updateManagedTarget(tenantId, current.id, patch as UpdateManagedTargetDto);
        result.businessTableMutated = true;
      }
      result.actions.push({ kind: 'managed_target', action: Object.keys(patch).length > 0 ? 'update' : 'skip', identityKey, existingId: current.id, resourceId: current.id, reason: 'managed target merged from site asset' });
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
    const normalizedHashPrefix = `agent-direct:${input.agentId}:${new Date().toISOString()}`;
    try {
      const direct = await this.directClient.runDiscovery(detail.agent, {
        providerTypes: input.providerTypes,
        includeBindings: input.includeBindings,
        requestId: input.requestId,
      });
      const result = await this.ingestDiscovery(tenantId, {
        normalizedHash: buildDiscoveryHash(normalizedHashPrefix, 'direct'),
        source: 'AGENT',
        apply: true,
        normalizedPayload: direct.payload as unknown as Record<string, unknown>,
        rawPayload: {
          mode: 'direct',
          directControl: direct.directControl,
          request: input,
        },
      });
      return {
        ...result,
        mode: 'direct',
      };
    } catch (error) {
      const fallbackPayload = this.buildFallbackPayloadFromCapabilitySnapshot(detail.agent.id, detail.capabilitySnapshot?.capabilities ?? []);
      if (isEmptyDiscoveryPayload(fallbackPayload)) {
        throw error;
      }
      const result = await this.ingestDiscovery(tenantId, {
        normalizedHash: buildDiscoveryHash(normalizedHashPrefix, 'fallback'),
        source: 'AGENT',
        apply: true,
        normalizedPayload: fallbackPayload,
        rawPayload: {
          mode: 'fallback_capability_snapshot',
          reason: error instanceof Error ? error.message : 'unknown',
          request: input,
        },
      });
      return {
        ...result,
        mode: 'fallback_capability_snapshot',
        fallbackReason: error instanceof Error ? error.message : 'unknown',
      };
    }
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

  private async assertServiceAssetAgentPlatform(
    tenantId: string,
    platform: CreateServiceAssetDto['platform'] | UpdateServiceAssetDto['platform'],
    agentId: string | undefined,
  ): Promise<void> {
    if (!agentId) return;
    if (!this.agentsService) {
      throw new AppError('SYSTEM_INTERNAL_ERROR', 'AgentsService 未注入，无法校验 ServiceAsset Agent 绑定');
    }
    const detail = await this.agentsService.getAgentDetail(tenantId, agentId);
    const agentPlatform = String(detail.agent.descriptor.osType ?? '').toUpperCase();
    if (!platform) return;
    const expectedPlatforms = platform === 'APPLIANCE' ? ['NETWORK_DEVICE'] : [platform];
    if (!expectedPlatforms.includes(agentPlatform)) {
      throw new AppError('VALIDATION_FAILED', '应用资产平台与 Agent 平台不匹配', {
        platform,
        agentId,
        agentPlatform,
      });
    }
  }

  private async ensureApplicationAssetTargetBinding(tenantId: string, applicationAssetId: string): Promise<void> {
    const bindingTarget = await this.repository.getApplicationAssetTargetByApplicationAssetId(tenantId, applicationAssetId);
    if (!bindingTarget) return;

    const applicationAsset = await this.repository.getServiceAsset(tenantId, applicationAssetId);
    if (!applicationAsset) return;

    let managedTarget = await this.repository.getManagedTarget(tenantId, bindingTarget.managedTargetId);
    let siteAsset = await this.repository.getSiteAsset(tenantId, bindingTarget.siteAssetId);
    if (!managedTarget || !siteAsset) return;

    const providerType = String(
      siteAsset.providerType ?? managedTarget.providerType ?? '',
    ).toUpperCase();
    if (providerType === 'DEVICE_TEMPLATE' || String(managedTarget.deploymentMode ?? '').toUpperCase() === 'NITRO') {
      return;
    }
    if (providerType !== 'IIS' && providerType !== 'NGINX') {
      return;
    }

    if (!managedTarget.hostId || !siteAsset.hostId) {
      const hostId = await this.ensureAgentHostAnchor(tenantId, applicationAsset.agentId ?? bindingTarget.agentId, managedTarget.serviceInstanceId ?? siteAsset.serviceInstanceId);
      if (hostId) {
        if (!siteAsset.hostId) {
          siteAsset = await this.updateSiteAsset(tenantId, siteAsset.id, { hostId });
        }
        if (!managedTarget.hostId) {
          managedTarget = await this.updateManagedTarget(tenantId, managedTarget.id, { hostId });
        }
      }
    }

    const detail = await this.repository.getApplicationAssetTargetDetailByApplicationAssetId(tenantId, applicationAssetId);
    const normalizedAddress = applicationAsset.address.trim().toLowerCase();
    const existing = detail?.certificateBindings.find((item) => {
      if (bindingTarget.bindingKey && item.bindingKey === bindingTarget.bindingKey) return true;
      const itemDomain = String(item.domainName ?? item.domain ?? '').trim().toLowerCase();
      return itemDomain !== '' && itemDomain === normalizedAddress;
    });
    const normalizedProviderType = providerType as 'IIS' | 'NGINX';
    const siblingBinding = this.findApplicationAssetSiblingBinding(detail?.certificateBindings ?? [], bindingTarget, applicationAsset.address);
    if (existing) {
      if (normalizedProviderType === 'NGINX') {
        await this.patchApplicationAssetLinuxBindingIfNeeded(tenantId, existing, managedTarget, siteAsset, siblingBinding);
      }
      return;
    }

    const createInput = normalizedProviderType === 'NGINX'
      ? this.buildApplicationAssetLinuxBindingInput(applicationAsset, bindingTarget, managedTarget, siteAsset, siblingBinding)
      : this.buildApplicationAssetWindowsBindingInput(applicationAsset, bindingTarget, managedTarget, siteAsset);
    await this.requireBindingsRepository().createCertificateBinding(tenantId, createInput);
  }

  private buildApplicationAssetWindowsBindingInput(
    applicationAsset: NonNullable<Awaited<ReturnType<AssetsRepository['getServiceAsset']>>>,
    bindingTarget: NonNullable<Awaited<ReturnType<AssetsRepository['getApplicationAssetTargetByApplicationAssetId']>>>,
    managedTarget: NonNullable<Awaited<ReturnType<AssetsRepository['getManagedTarget']>>>,
    siteAsset: NonNullable<Awaited<ReturnType<AssetsRepository['getSiteAsset']>>>,
  ): CreateCertificateBindingDto {
    return {
      serviceAssetId: applicationAsset.id,
      siteAssetId: siteAsset.id,
      managedTargetId: managedTarget.id,
      serviceInstanceId: managedTarget.serviceInstanceId ?? siteAsset.serviceInstanceId,
      domainName: applicationAsset.address,
      domain: applicationAsset.address,
      port: applicationAsset.port ?? siteAsset.port,
      protocol: (applicationAsset.protocol ?? siteAsset.protocol ?? 'HTTPS') as CreateCertificateBindingDto['protocol'],
      bindingKey: bindingTarget.bindingKey ?? managedTarget.bindingKey ?? siteAsset.bindingInformation ?? applicationAsset.address,
      bindingType: 'WINDOWS_CERT_STORE',
      storeLocation: 'LocalMachine',
      storeName: 'My',
      verifyMethod: 'STORE_QUERY',
      status: 'MANAGED',
      metadata: {
        source: 'application_asset_target',
        targetKey: bindingTarget.targetKey,
        siteName: siteAsset.siteName,
        hostHeader: siteAsset.hostHeader ?? '',
        bindingInformation: siteAsset.bindingInformation ?? bindingTarget.bindingKey,
        appPool: typeof siteAsset.metadata?.appPool === 'string' ? siteAsset.metadata.appPool : undefined,
      },
    };
  }

  private buildApplicationAssetLinuxBindingInput(
    applicationAsset: NonNullable<Awaited<ReturnType<AssetsRepository['getServiceAsset']>>>,
    bindingTarget: NonNullable<Awaited<ReturnType<AssetsRepository['getApplicationAssetTargetByApplicationAssetId']>>>,
    managedTarget: NonNullable<Awaited<ReturnType<AssetsRepository['getManagedTarget']>>>,
    siteAsset: NonNullable<Awaited<ReturnType<AssetsRepository['getSiteAsset']>>>,
    siblingBinding?: { certPath?: string; keyPath?: string; reloadCommand?: string; metadata?: Record<string, unknown> },
  ): CreateCertificateBindingDto {
    const capabilityProfile = toRecord(managedTarget.capabilityProfile);
    const sourceFile = normalizeOptionalString(siteAsset.configPath)
      ?? readString(siteAsset.metadata, 'sourceFile')
      ?? readString(siblingBinding?.metadata, 'sourceFile');
    const serverNames = [...new Set([
      ...readStringArray(siteAsset.metadata, 'serverNames'),
      ...readStringArray(siblingBinding?.metadata, 'serverNames'),
      normalizeOptionalString(applicationAsset.address),
      normalizeOptionalString(siteAsset.hostHeader),
    ].filter(Boolean))];

    return {
      serviceAssetId: applicationAsset.id,
      siteAssetId: siteAsset.id,
      managedTargetId: managedTarget.id,
      serviceInstanceId: managedTarget.serviceInstanceId ?? siteAsset.serviceInstanceId,
      domainName: applicationAsset.address,
      domain: applicationAsset.address,
      port: applicationAsset.port ?? siteAsset.port,
      protocol: (applicationAsset.protocol ?? siteAsset.protocol ?? 'HTTPS') as CreateCertificateBindingDto['protocol'],
      bindingKey: bindingTarget.bindingKey ?? managedTarget.bindingKey ?? siteAsset.bindingInformation ?? applicationAsset.address,
      bindingType: 'FILE_PATH',
      certPath: normalizeOptionalString(siblingBinding?.certPath)
        ?? readString(capabilityProfile, 'certPath')
        ?? readString(siteAsset.metadata, 'certPath'),
      keyPath: normalizeOptionalString(siblingBinding?.keyPath)
        ?? readString(capabilityProfile, 'keyPath')
        ?? readString(siteAsset.metadata, 'keyPath'),
      reloadCommand: normalizeOptionalString(siblingBinding?.reloadCommand)
        ?? readString(capabilityProfile, 'reloadCommand')
        ?? readString(siteAsset.metadata, 'reloadCommand'),
      verifyMethod: 'TLS_CONNECT',
      status: 'MANAGED',
      metadata: {
        source: 'application_asset_target',
        targetKey: bindingTarget.targetKey,
        siteName: siteAsset.siteName,
        hostHeader: siteAsset.hostHeader ?? '',
        bindingInformation: siteAsset.bindingInformation ?? bindingTarget.bindingKey,
        sourceFile,
        serverNames,
        testCommand: readString(siblingBinding?.metadata, 'testCommand')
          ?? readString(capabilityProfile, 'testCommand')
          ?? readString(siteAsset.metadata, 'testCommand'),
        permission: readRecord(siblingBinding?.metadata, 'permission')
          ?? readRecord(siteAsset.metadata, 'permission')
          ?? {},
      },
    };
  }

  private findApplicationAssetSiblingBinding(
    bindings: Array<{
      id?: string;
      serviceInstanceId?: string;
      serviceAssetId?: string;
      siteAssetId?: string;
      managedTargetId?: string;
      bindingKey?: string;
      domainName?: string;
      domain?: string;
      certPath?: string;
      keyPath?: string;
      reloadCommand?: string;
      metadata?: Record<string, unknown>;
    }>,
    bindingTarget: { managedTargetId: string; siteAssetId: string; bindingKey?: string },
    applicationAddress: string,
  ): { certPath?: string; keyPath?: string; reloadCommand?: string; metadata?: Record<string, unknown> } | undefined {
    const normalizedAddress = applicationAddress.trim().toLowerCase();
    const normalizedBindingKey = String(bindingTarget.bindingKey ?? '').trim().toLowerCase();
    const itemsWithPaths = bindings.filter((item) => Boolean(normalizeOptionalString(item.certPath) && normalizeOptionalString(item.keyPath)));
    return itemsWithPaths.find((item) =>
      item.managedTargetId === bindingTarget.managedTargetId
      && item.siteAssetId === bindingTarget.siteAssetId
      && (
        (normalizedBindingKey && String(item.bindingKey ?? '').trim().toLowerCase() === normalizedBindingKey)
        || String(item.domainName ?? item.domain ?? '').trim().toLowerCase() === normalizedAddress
      ),
    ) ?? itemsWithPaths.find((item) => {
      const itemBindingKey = String(item.bindingKey ?? '').trim().toLowerCase();
      const itemDomain = String(item.domainName ?? item.domain ?? '').trim().toLowerCase();
      if (normalizedBindingKey && itemBindingKey === normalizedBindingKey) return true;
      return itemDomain !== '' && itemDomain === normalizedAddress;
    });
  }

  private async patchApplicationAssetLinuxBindingIfNeeded(
    tenantId: string,
    binding: { id: string; certPath?: string; keyPath?: string; reloadCommand?: string; bindingType?: string; verifyMethod?: string },
    managedTarget: NonNullable<Awaited<ReturnType<AssetsRepository['getManagedTarget']>>>,
    siteAsset: NonNullable<Awaited<ReturnType<AssetsRepository['getSiteAsset']>>>,
    siblingBinding?: { certPath?: string; keyPath?: string; reloadCommand?: string; metadata?: Record<string, unknown> },
  ): Promise<void> {
    const capabilityProfile = toRecord(managedTarget.capabilityProfile);
    const certPath = normalizeOptionalString(binding.certPath)
      ?? normalizeOptionalString(siblingBinding?.certPath)
      ?? readString(capabilityProfile, 'certPath')
      ?? readString(siteAsset.metadata, 'certPath');
    const keyPath = normalizeOptionalString(binding.keyPath)
      ?? normalizeOptionalString(siblingBinding?.keyPath)
      ?? readString(capabilityProfile, 'keyPath')
      ?? readString(siteAsset.metadata, 'keyPath');
    if (!certPath || !keyPath) return;

    const patch: UpdateCertificateBindingDto = {};
    if (!normalizeOptionalString(binding.certPath)) patch.certPath = certPath;
    if (!normalizeOptionalString(binding.keyPath)) patch.keyPath = keyPath;
    if (binding.bindingType !== 'FILE_PATH') patch.bindingType = 'FILE_PATH';
    if (binding.verifyMethod !== 'TLS_CONNECT') patch.verifyMethod = 'TLS_CONNECT';
    if (!normalizeOptionalString(binding.reloadCommand)) {
      const reloadCommand = normalizeOptionalString(siblingBinding?.reloadCommand)
        ?? readString(capabilityProfile, 'reloadCommand')
        ?? readString(siteAsset.metadata, 'reloadCommand');
      if (reloadCommand) patch.reloadCommand = reloadCommand;
    }
    if (Object.keys(patch).length === 0) return;
    await this.requireBindingsRepository().updateCertificateBinding(tenantId, binding.id, patch);
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
      const service = await this.repository.getServiceInstance(tenantId, serviceInstanceId);
      if (service && !service.hostId) {
        await this.updateServiceInstance(tenantId, service.id, { hostId: host.id });
      }
    }
    return host.id;
  }

  private buildFallbackPayloadFromCapabilitySnapshot(agentId: string, capabilities: Array<{ capabilityKey: string; value: unknown }>): Record<string, unknown> {
    const payload: {
      hosts: NormalizedDiscoveredHostDto[];
      services: NormalizedDiscoveredServiceDto[];
      serviceAssets: NormalizedDiscoveredServiceAssetDto[];
      siteAssets: NormalizedDiscoveredSiteAssetDto[];
      bindings: NormalizedDiscoveredBindingDto[];
    } = {
      hosts: [],
      services: [],
      serviceAssets: [],
      siteAssets: [],
      bindings: [],
    };

    const osDetail = readCapabilityRecord(capabilities, 'windows.os.detail');
    const adapters = readCapabilityArray(capabilities, 'windows.network.adapters');
    const iisDetail = readCapabilityRecord(capabilities, 'windows.iis.detail');
    const nginxDetail = readCapabilityRecord(capabilities, 'linux.nginx.detail');
    const apacheDetail = readCapabilityRecord(capabilities, 'linux.apache.detail');
    const tomcatDetail = readCapabilityRecord(capabilities, 'linux.tomcat.detail');

    if (osDetail || adapters.length > 0 || iisDetail) {
      payload.hosts.push(projectWindowsHost(agentId, osDetail, adapters, iisDetail));
    }
    if (iisDetail) {
      projectWindowsIISDiscovery(agentId, iisDetail, payload);
    }
    if (nginxDetail) {
      projectLinuxWebDiscovery(agentId, 'NGINX', nginxDetail, payload);
    }
    if (apacheDetail) {
      projectLinuxWebDiscovery(agentId, 'APACHE', apacheDetail, payload);
    }
    if (tomcatDetail) {
      projectLinuxTomcatDiscovery(agentId, tomcatDetail, payload);
	    }
	    return payload;
	  }

  private async hydrateServiceAssetStrategy<T extends ServiceAssetDto>(tenantId: string, asset: T): Promise<T> {
    const targetBinding = await this.repository.getApplicationAssetTargetByApplicationAssetId(tenantId, asset.id);
    const strategy = resolveDeploymentStrategy({ asset, targetBinding });
    return {
      ...asset,
      deploymentStrategy: strategy ? await this.applyPluginBindingCompatibility(tenantId, strategy) : undefined,
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
    if (strategy.type === 'AGENT') {
      const agent = strategy.agent;
      if (!agent) throw new AppError('VALIDATION_FAILED', 'AGENT 策略缺少 agent 配置', { code: 'DEPLOYMENT_STRATEGY_INVALID' });
      if ((agent.mode ?? 'NATIVE_HANDLER') === 'PLUGIN') {
        if (!agent.plugin && !agent.pluginBindingId) throw new AppError('VALIDATION_FAILED', 'PLUGIN 模式缺少插件绑定', { code: 'AGENT_PLUGIN_BINDING_INVALID' });
        return;
      }
      if (!agent.siteAssetId || !agent.managedTargetId) {
        throw new AppError('VALIDATION_FAILED', '原生 AGENT 策略缺少 SiteAsset 或 ManagedTarget', { code: 'DEPLOYMENT_STRATEGY_INVALID' });
      }
      if (!await this.repository.getSiteAsset(tenantId, agent.siteAssetId)) {
        throw new AppError('RESOURCE_NOT_FOUND', 'AGENT 策略引用的 SiteAsset 不存在', { siteAssetId: agent.siteAssetId });
      }
      if (!await this.repository.getManagedTarget(tenantId, agent.managedTargetId)) {
        throw new AppError('RESOURCE_NOT_FOUND', 'AGENT 策略引用的 ManagedTarget 不存在', { managedTargetId: agent.managedTargetId });
      }
      return;
    }
    if (strategy.type === 'WORKFLOW') {
      const workflow = strategy.workflow;
      if (!workflow) throw new AppError('VALIDATION_FAILED', 'WORKFLOW 策略缺少 workflow 配置', { code: 'DEPLOYMENT_STRATEGY_INVALID' });
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

function readCapabilityRecord(capabilities: Array<{ capabilityKey: string; value: unknown }>, key: string): Record<string, unknown> | undefined {
  const item = capabilities.find((capability) => capability.capabilityKey === key)?.value;
  return item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : undefined;
}

function readCapabilityArray(capabilities: Array<{ capabilityKey: string; value: unknown }>, key: string): Record<string, unknown>[] {
  const item = capabilities.find((capability) => capability.capabilityKey === key)?.value;
  return Array.isArray(item) ? item.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry))) : [];
}

function buildDiscoveryHash(prefix: string, mode: string): string {
  return `${prefix}:${mode}`.toLowerCase();
}

function isEmptyDiscoveryPayload(payload: Record<string, unknown>): boolean {
  const arrays = ['hosts', 'services', 'serviceAssets', 'siteAssets', 'bindings']
    .map((key) => payload[key])
    .filter(Array.isArray) as unknown[][];
  return arrays.every((items) => items.length === 0);
}

function projectWindowsHost(agentId: string, osDetail: Record<string, unknown> | undefined, adapters: Record<string, unknown>[], iisDetail: Record<string, unknown> | undefined): NormalizedDiscoveredHostDto {
  const hostname = normalizeOptionalString(
    readString(osDetail, 'hostname')
      ?? readString(iisDetail, 'hostName')
      ?? readString(osDetail, 'machineName')
      ?? readString(osDetail, 'ProductName'),
  ) ?? `${agentId}.local`;
  const ipv4 = adapters.flatMap((adapter) => readStringArray(adapter, 'IPv4'));
  return {
    hostname,
    primaryIp: ipv4[0],
    ipAddresses: ipv4,
    osType: 'WINDOWS',
    osName: readString(osDetail, 'ProductName'),
    osVersion: readString(osDetail, 'Version') ?? readString(osDetail, 'osVersion'),
    agentId,
    discoverySource: 'AGENT',
    managementMode: 'AGENT',
    status: 'ACTIVE',
  };
}

function projectWindowsIISDiscovery(
  agentId: string,
  iisDetail: Record<string, unknown>,
  payload: {
    hosts: NormalizedDiscoveredHostDto[];
    services: NormalizedDiscoveredServiceDto[];
    serviceAssets: NormalizedDiscoveredServiceAssetDto[];
    siteAssets: NormalizedDiscoveredSiteAssetDto[];
    bindings: NormalizedDiscoveredBindingDto[];
  },
): void {
  const hostRef = payload.hosts[0]?.hostname;
  if (!hostRef) return;
  payload.services.push({
    hostname: hostRef,
    providerType: 'IIS',
    serviceName: 'iis',
    displayName: 'iis',
    configPath: 'IIS:\\Sites',
    discoverySource: 'AGENT',
    status: 'ACTIVE',
    rawFacts: iisDetail,
  });
  const sites = readObjectArray(iisDetail, 'Sites').length > 0 ? readObjectArray(iisDetail, 'Sites') : readObjectArray(iisDetail, 'sites');
  for (const site of sites) {
    const siteName = normalizeOptionalString(readString(site, 'Name') ?? readString(site, 'name'));
    if (!siteName) continue;
    const bindings = readObjectArray(site, 'Bindings').length > 0 ? readObjectArray(site, 'Bindings') : readObjectArray(site, 'bindings');
    for (const binding of bindings) {
      const protocol = normalizeProtocol(readString(binding, 'Protocol') ?? readString(binding, 'protocol'));
      const port = readNumber(binding, 'Port') ?? readNumber(binding, 'port');
      const hostHeader = normalizeOptionalString(readString(binding, 'HostHeader') ?? readString(binding, 'hostHeader'));
      if (!protocol || !port || !hostHeader) continue;
      const certificate = readRecord(binding, 'Certificate') ?? readRecord(binding, 'certificate');
      const observedFingerprintSha256 = readString(certificate, 'FingerprintSHA256') ?? readString(certificate, 'fingerprintSha256');
      const storeThumbprint = readString(binding, 'CertificateThumbprint') ?? readString(binding, 'certificateThumbprint') ?? readString(certificate, 'Thumbprint') ?? readString(certificate, 'thumbprint');
      payload.serviceAssets.push({
        hostname: hostRef,
        providerType: 'IIS',
        serviceName: 'iis',
        address: hostHeader,
        port,
        protocol,
        sniName: hostHeader,
        displayName: hostHeader,
        discoverySource: 'AGENT',
        status: 'ACTIVE',
        metadata: { source: 'direct_control' },
      });
      const bindingInformation = readString(binding, 'BindingInformation') ?? readString(binding, 'bindingInformation');
      const siteKey = `${agentId}:iis:${siteName.toLowerCase()}:${bindingInformation ?? hostHeader}`;
      payload.siteAssets.push({
        hostname: hostRef,
        providerType: 'IIS',
        serviceName: 'iis',
        agentId,
        siteType: 'WEB_SITE',
        siteName,
        siteKey,
        bindingInformation,
        hostHeader,
        listenIp: readString(binding, 'IPAddress') ?? readString(binding, 'ipAddress'),
        port,
        protocol,
        configPath: 'IIS:\\Sites',
        discoverySource: 'AGENT',
        status: 'ACTIVE',
      });
      payload.bindings.push({
        hostname: hostRef,
        providerType: 'IIS',
        serviceName: 'iis',
        domainName: hostHeader,
        port,
        protocol,
        bindingType: 'WINDOWS_CERT_STORE',
        storeLocation: 'LocalMachine',
        storeName: readString(binding, 'CertificateStoreName') ?? readString(binding, 'certificateStoreName') ?? readString(certificate, 'StoreName') ?? readString(certificate, 'storeName') ?? 'My',
        storeThumbprint,
        observedFingerprintSha256,
        verifyMethod: 'TLS_CONNECT',
        serviceAssetRef: `${hostHeader}:${port}:${protocol}`.toLowerCase(),
        siteAssetRef: `site-asset:${siteKey}`.toLowerCase(),
        metadata: {
          certificateSubject: readString(certificate, 'Subject') ?? readString(certificate, 'subject'),
          certificateIssuer: readString(certificate, 'Issuer') ?? readString(certificate, 'issuer'),
        },
      });
    }
  }
}

function projectLinuxWebDiscovery(
  agentId: string,
  providerType: 'NGINX' | 'APACHE',
  detail: Record<string, unknown>,
  payload: {
    hosts: NormalizedDiscoveredHostDto[];
    services: NormalizedDiscoveredServiceDto[];
    serviceAssets: NormalizedDiscoveredServiceAssetDto[];
    siteAssets: NormalizedDiscoveredSiteAssetDto[];
    bindings: NormalizedDiscoveredBindingDto[];
  },
): void {
  const hostRef = payload.hosts[0]?.hostname ?? `${agentId}.local`;
  const serviceName = providerType === 'NGINX' ? 'nginx' : 'apache';
  const configPath = readString(detail, 'ConfigPath') ?? readString(detail, 'configPath');
  payload.services.push({
    hostname: hostRef,
    providerType,
    serviceName,
    displayName: serviceName,
    configPath,
    discoverySource: 'AGENT',
    status: 'ACTIVE',
    rawFacts: detail,
  });
  const sites = readObjectArray(detail, 'Sites').concat(readObjectArray(detail, 'sites'));
  for (const site of sites) {
    const siteName = normalizeOptionalString(readString(site, 'Name') ?? readString(site, 'name'));
    if (!siteName) continue;
    const serverNames = readStringArray(site, 'ServerNames').concat(readStringArray(site, 'serverNames'));
    const hostHeader = normalizeOptionalString(serverNames[0] ?? siteName);
    const sitePath = readString(site, 'SitePath') ?? readString(site, 'sitePath');
    const siteMode = readString(site, 'SiteMode') ?? readString(site, 'siteMode');
    const proxyTargets = readStringArray(site, 'ProxyTargets').concat(readStringArray(site, 'proxyTargets'));
    const configFiles = readStringArray(site, 'ConfigFiles').concat(readStringArray(site, 'configFiles'));
    const bindings = readObjectArray(site, 'Listen').concat(readObjectArray(site, 'listen'));
    for (const binding of bindings) {
      const port = readNumber(binding, 'Port') ?? readNumber(binding, 'port');
      const protocol = normalizeProtocol(readString(binding, 'Protocol') ?? readString(binding, 'protocol'));
      const address = normalizeOptionalString(hostHeader ?? siteName);
      if (!port || !protocol || !address) continue;
      const bindingAddress = normalizeOptionalString(readString(binding, 'Address') ?? readString(binding, 'address')) ?? '*';
      const bindingInformation = `${bindingAddress}:${port}:${hostHeader ?? ''}`;
      const siteKey = `${agentId}:${providerType.toLowerCase()}:${siteName}:${bindingInformation}`.toLowerCase();
      payload.siteAssets.push({
        serviceRef: `${hostRef}:${providerType}:${serviceName}`.toLowerCase(),
        serviceAssetRef: `${address}:${port}:${protocol}`.toLowerCase(),
        siteAssetRef: `site-asset:${siteKey}`,
        hostname: hostRef,
        providerType,
        serviceName,
        agentId,
        siteType: 'WEB_SITE',
        siteName,
        siteKey,
        bindingInformation,
        hostHeader: hostHeader ?? undefined,
        listenIp: bindingAddress,
        port,
        protocol,
        configPath: configFiles[0] || configPath,
        runtimeStatus: siteMode,
        discoverySource: 'AGENT',
        status: 'ACTIVE',
        metadata: {
          sitePath,
          siteMode,
          serverNames,
          proxyTargets,
          configFiles,
          certPath: readString(binding, 'CertificatePath') ?? readString(binding, 'certificatePath'),
          keyPath: readString(binding, 'CertificateKeyPath') ?? readString(binding, 'certificateKeyPath'),
          testCommand: readString(binding, 'TestCommand') ?? readString(binding, 'testCommand'),
          reloadCommand: readString(binding, 'ReloadCommand') ?? readString(binding, 'reloadCommand'),
          permission: readRecord(binding, 'Permission') ?? readRecord(binding, 'permission') ?? {},
        },
      });
      payload.serviceAssets.push({
        hostname: hostRef,
        providerType,
        serviceName,
        address,
        port,
        protocol,
        sniName: address,
        displayName: address,
        discoverySource: 'AGENT',
        status: 'ACTIVE',
        metadata: {
          testCommand: readString(binding, 'TestCommand') ?? readString(binding, 'testCommand'),
          reloadCommand: readString(binding, 'ReloadCommand') ?? readString(binding, 'reloadCommand'),
          permission: readRecord(binding, 'Permission') ?? readRecord(binding, 'permission') ?? {},
        },
      });
      payload.bindings.push({
        hostname: hostRef,
        providerType,
        serviceName,
        domainName: address,
        port,
        protocol,
        bindingType: 'FILE_PATH',
        certPath: readString(binding, 'CertificatePath') ?? readString(binding, 'certificatePath'),
        keyPath: readString(binding, 'CertificateKeyPath') ?? readString(binding, 'certificateKeyPath'),
        verifyMethod: 'TLS_CONNECT',
        bindingKey: bindingInformation,
        serviceAssetRef: `${address}:${port}:${protocol}`.toLowerCase(),
        siteAssetRef: `site-asset:${siteKey}`,
        metadata: {
          sourceFile: configFiles[0] || configPath,
          serverNames,
          testCommand: readString(binding, 'TestCommand') ?? readString(binding, 'testCommand'),
          reloadCommand: readString(binding, 'ReloadCommand') ?? readString(binding, 'reloadCommand'),
          permission: readRecord(binding, 'Permission') ?? readRecord(binding, 'permission') ?? {},
        },
      });
    }
  }
}

function projectLinuxTomcatDiscovery(
  agentId: string,
  detail: Record<string, unknown>,
  payload: {
    hosts: NormalizedDiscoveredHostDto[];
    services: NormalizedDiscoveredServiceDto[];
    serviceAssets: NormalizedDiscoveredServiceAssetDto[];
    siteAssets: NormalizedDiscoveredSiteAssetDto[];
    bindings: NormalizedDiscoveredBindingDto[];
  },
): void {
  const hostRef = payload.hosts[0]?.hostname ?? `${agentId}.local`;
  const configPath = readString(detail, 'ConfigPath') ?? readString(detail, 'configPath');
  payload.services.push({
    hostname: hostRef,
    providerType: 'TOMCAT',
    serviceName: 'tomcat',
    displayName: 'tomcat',
    configPath,
    discoverySource: 'AGENT',
    status: 'ACTIVE',
    rawFacts: detail,
  });
  const connectors = readObjectArray(detail, 'Connectors').concat(readObjectArray(detail, 'connectors'));
  for (const connector of connectors) {
    const port = readNumber(connector, 'Port') ?? readNumber(connector, 'port');
    const protocol = normalizeProtocol(readString(connector, 'Protocol') ?? readString(connector, 'protocol'));
    if (!port || !protocol) continue;
    const address = normalizeOptionalString(readString(connector, 'Address') ?? readString(connector, 'address')) ?? hostRef;
    const bindingAddress = normalizeOptionalString(readString(connector, 'Address') ?? readString(connector, 'address')) ?? '*';
    const bindingInformation = `${bindingAddress}:${port}:${address}`;
    const siteKey = `${agentId}:tomcat:${address}:${bindingInformation}`.toLowerCase();
    payload.siteAssets.push({
      serviceRef: `${hostRef}:TOMCAT:tomcat`.toLowerCase(),
      serviceAssetRef: `${address}:${port}:${protocol}`.toLowerCase(),
      siteAssetRef: `site-asset:${siteKey}`,
      hostname: hostRef,
      providerType: 'TOMCAT',
      serviceName: 'tomcat',
      agentId,
      siteType: 'WEB_SITE',
      siteName: address,
      siteKey,
      bindingInformation,
      hostHeader: address,
      listenIp: bindingAddress,
      port,
      protocol,
      configPath,
      discoverySource: 'AGENT',
      status: 'ACTIVE',
      metadata: {
        keystorePath: readString(connector, 'KeystorePath') ?? readString(connector, 'keystorePath'),
      },
    });
    payload.serviceAssets.push({
      hostname: hostRef,
      providerType: 'TOMCAT',
      serviceName: 'tomcat',
      address,
      port,
      protocol,
      sniName: address,
      displayName: address,
      discoverySource: 'AGENT',
      status: 'ACTIVE',
    });
    payload.bindings.push({
      hostname: hostRef,
      providerType: 'TOMCAT',
      serviceName: 'tomcat',
      domainName: address,
      port,
      protocol,
      bindingKey: bindingInformation,
      bindingType: 'FILE_PATH',
      certPath: readString(connector, 'CertificatePath') ?? readString(connector, 'certificatePath'),
      keyPath: readString(connector, 'CertificateKeyPath') ?? readString(connector, 'certificateKeyPath'),
      keystorePath: readString(connector, 'KeystorePath') ?? readString(connector, 'keystorePath'),
      verifyMethod: 'TLS_CONNECT',
      serviceAssetRef: `${address}:${port}:${protocol}`.toLowerCase(),
      siteAssetRef: `site-asset:${siteKey}`,
    });
  }
}

function readString(value: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!value) return undefined;
  const direct = value[key];
  return typeof direct === 'string' && direct.trim() ? direct.trim() : undefined;
}

function readRecord(value: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const direct = value[key];
  return direct && typeof direct === 'object' && !Array.isArray(direct) ? direct as Record<string, unknown> : undefined;
}

function readNumber(value: Record<string, unknown> | undefined, key: string): number | undefined {
  if (!value) return undefined;
  const direct = value[key];
  return typeof direct === 'number' && Number.isFinite(direct) ? direct : undefined;
}

function readObjectArray(value: Record<string, unknown> | undefined, key: string): Record<string, unknown>[] {
  if (!value) return [];
  const direct = value[key];
  return Array.isArray(direct) ? direct.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item))) : [];
}

function readStringArray(value: Record<string, unknown> | undefined, key: string): string[] {
  if (!value) return [];
  const direct = value[key];
  return Array.isArray(direct) ? direct.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()) : [];
}

function normalizeProtocol(value: string | undefined): 'HTTPS' | 'HTTP' | 'TLS' | 'STARTTLS' | undefined {
  const normalized = normalizeOptionalString(value)?.toUpperCase();
  if (!normalized) return undefined;
  if (normalized === 'HTTPS' || normalized === 'HTTP' || normalized === 'TLS' || normalized === 'STARTTLS') return normalized;
  if (normalized == 'HTTP/1.1') return 'HTTPS';
  return undefined;
}

function hostIdentityKey(host: NormalizedDiscoveredHostDto): string | undefined {
  const hostname = normalizeOptionalString(host.hostname)?.toLowerCase();
  return hostname ? `host:${hostname}` : undefined;
}

function serviceIdentityKey(service: NormalizedDiscoveredServiceDto, hostId: string): string {
  return `service:${hostId}:${service.providerType}:${normalizeOptionalString(service.serviceName) ?? normalizeOptionalString(service.configPath) ?? 'default'}`.toLowerCase();
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
  serviceInstanceId: string,
  serviceAssetId: string | undefined,
  hostId: string | undefined,
  providerType: CreateSiteAssetDto['providerType'],
  source: CreateDiscoverySnapshotDto['source'],
): CreateSiteAssetDto {
  const identityKey = siteAssetIdentityKey(siteAsset);
  return {
    serviceInstanceId,
    serviceAssetId,
    hostId,
    agentId: siteAsset.agentId,
    providerType,
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

function managedTargetToCreateDto(
  discovered: NormalizedDiscoveredSiteAssetDto,
  siteAsset: { id: string; hostId?: string; serviceInstanceId: string; serviceAssetId?: string; providerType: CreateManagedTargetDto['providerType'] },
  agentId: string,
  source: CreateDiscoverySnapshotDto['source'],
): CreateManagedTargetDto {
  return {
    agentId,
    hostId: siteAsset.hostId,
    serviceInstanceId: siteAsset.serviceInstanceId,
    serviceAssetId: siteAsset.serviceAssetId,
    siteAssetId: siteAsset.id,
    providerType: siteAsset.providerType,
    frameworkType: siteAsset.providerType,
    targetType: 'SITE_BINDING',
    targetKey: managedTargetTargetKey(discovered, agentId),
    bindingKey: discovered.bindingInformation ?? discovered.siteKey ?? discovered.siteName,
    capabilityProfile: managedTargetCapabilityProfile(discovered, siteAsset),
    deploymentMode: source === 'AGENT' ? 'AGENT' : 'DISCOVERY',
    lastSeenAt: discovered.lastDiscoveredAt,
    status: 'ACTIVE',
    metadata: {},
  };
}

function managedTargetCapabilityProfile(
  discovered: Pick<NormalizedDiscoveredSiteAssetDto, 'protocol' | 'bindingInformation' | 'hostHeader' | 'siteType' | 'metadata'>,
  siteAsset: { providerType: string; serviceAssetId?: string },
): Record<string, unknown> {
  const metadata = toRecord(discovered.metadata ?? {});
  return {
    providerType: siteAsset.providerType,
    siteType: discovered.siteType ?? 'CUSTOM',
    protocol: discovered.protocol,
    bindingInformation: discovered.bindingInformation,
    hostHeader: discovered.hostHeader,
    certPath: readString(metadata, 'certPath'),
    keyPath: readString(metadata, 'keyPath'),
    reloadCommand: readString(metadata, 'reloadCommand'),
    testCommand: readString(metadata, 'testCommand'),
    sourceFile: readString(metadata, 'sourceFile'),
    serverNames: readStringArray(metadata, 'serverNames'),
    permission: readRecord(metadata, 'permission') ?? {},
    serviceAssetLinked: Boolean(siteAsset.serviceAssetId),
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
      providerType: binding.providerType,
      serviceName: binding.serviceName,
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
  input: Pick<NormalizedDiscoveredBindingDto, 'serviceRef' | 'hostname' | 'providerType' | 'serviceName'> | Pick<NormalizedDiscoveredServiceAssetDto, 'serviceRef' | 'hostname' | 'providerType' | 'serviceName'> | Pick<NormalizedDiscoveredSiteAssetDto, 'serviceRef' | 'hostname' | 'providerType' | 'serviceName'>,
  serviceIds: Map<string, string>,
  tenantId: string,
  repository: AssetsRepository,
): Promise<string | undefined> {
  const direct = normalizeOptionalString(input.serviceRef);
  if (direct && await repository.getServiceInstance(tenantId, direct)) return direct;
  const hostId = await resolveHostId(input.hostname, new Map(), tenantId, repository);
  if (!hostId || !input.providerType) return undefined;
  const key = serviceIdentityKey({ providerType: input.providerType, serviceName: input.serviceName }, hostId);
  return serviceIds.get(key) ?? (await repository.findServiceInstanceByIdentity(tenantId, { hostId, providerType: input.providerType, serviceName: input.serviceName }))?.id;
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
