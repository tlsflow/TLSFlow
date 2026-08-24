import { AppError } from '../../../common/errors/app-error.js';
import { parsePageQuery, withAuthorization, type PageQuery } from '../../../common/pagination/pagination.js';
import type { Router } from '../../../common/http/router.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import {
  CompatibilityLevels,
  ManagementModes,
  OsTypes,
  ProviderTypes,
} from '../../../shared/enums/core.enums.js';
import type { SecuritySubject } from '../../../shared/security-types.js';
import type { SecurityServices } from '../../security/security.controller.js';
import { AssetsApplicationService } from '../application/assets.application-service.js';
import { assetsEnumValues } from '../domain/assets.domain-service.js';
import type {
  CreateDiscoverySnapshotDto,
  CreateHostDto,
  CreateManagedTargetDto,
  CreateServiceAssetDto,
  CreateSiteAssetDto,
  IngestDiscoveryDto,
  PreviewDiscoveryMergeDto,
  RefreshAssetsFromAgentDto,
  ResolveAssetConflictDto,
  UpdateManagedTargetDto,
  UpdateServiceAssetDto,
  UpdateSiteAssetDto,
  CreateServiceEndpointDto,
  CreateServiceInstanceDto,
  UpdateHostDto,
  UpdateServiceEndpointDto,
  UpdateServiceInstanceDto,
  DeploymentStrategyDto,
} from '../dto/assets.dto.js';

const tags = ['Assets'];
const tenantFallback = '00000000-0000-0000-0000-000000000000';

export class AssetsController {
  constructor(private readonly security?: SecurityServices, private readonly service = new AssetsApplicationService()) {}

  register(router: Router): void {
    router.get('/api/v1/hosts', '查询 Host 列表', tags, (request) => this.listHosts(request));
    router.post('/api/v1/hosts', '创建 Host', tags, (request) => this.createHost(request));
    router.patch('/api/v1/hosts', '更新 Host', tags, (request) => this.updateHost(request));
    router.post('/api/v1/hosts/delete', '软删除 Host', tags, (request) => this.deleteHost(request));
    router.get('/api/v1/service-instances', '查询 ServiceInstance 列表', tags, (request) => this.listServiceInstances(request));
    router.post('/api/v1/service-instances', '创建 ServiceInstance', tags, (request) => this.createServiceInstance(request));
    router.patch('/api/v1/service-instances', '更新 ServiceInstance', tags, (request) => this.updateServiceInstance(request));
    router.post('/api/v1/service-instances/delete', '软删除 ServiceInstance', tags, (request) => this.deleteServiceInstance(request));
    router.get('/api/v1/service-assets', '查询 ServiceAsset 列表', tags, (request) => this.listServiceAssets(request));
    router.get('/api/v1/service-assets/detail', '查询 ServiceAsset 详情', tags, (request) => this.getServiceAssetDetail(request));
    router.post('/api/v1/service-assets', '创建 ServiceAsset', tags, (request) => this.createServiceAsset(request));
    router.patch('/api/v1/service-assets', '更新 ServiceAsset', tags, (request) => this.updateServiceAsset(request));
    router.patch('/api/v1/service-assets/:id/deployment-strategy', '按 ID 更新 ServiceAsset 证书部署策略', tags, (request) => this.updateServiceAssetDeploymentStrategy(request));
    router.patch('/api/v1/service-assets/deployment-strategy', '更新 ServiceAsset 证书部署策略', tags, (request) => this.updateServiceAssetDeploymentStrategy(request));
    router.post('/api/v1/service-assets/delete', '软删除 ServiceAsset', tags, (request) => this.deleteServiceAsset(request));
    router.get('/api/v1/application-asset-targets', '查询 ApplicationAssetTarget 列表', tags, (request) => this.listApplicationAssetTargets(request));
    router.post('/api/v1/application-asset-targets', '创建 ApplicationAssetTarget', tags, (request) => this.createApplicationAssetTarget(request));
    router.patch('/api/v1/application-asset-targets', '更新 ApplicationAssetTarget', tags, (request) => this.updateApplicationAssetTarget(request));
    router.post('/api/v1/application-asset-targets/delete', '软删除 ApplicationAssetTarget', tags, (request) => this.deleteApplicationAssetTarget(request));
    router.get('/api/v1/site-assets', '查询 SiteAsset 列表', tags, (request) => this.listSiteAssets(request));
    router.post('/api/v1/site-assets', '创建 SiteAsset', tags, (request) => this.createSiteAsset(request));
    router.patch('/api/v1/site-assets', '更新 SiteAsset', tags, (request) => this.updateSiteAsset(request));
    router.post('/api/v1/site-assets/delete', '软删除 SiteAsset', tags, (request) => this.deleteSiteAsset(request));
    router.get('/api/v1/service-endpoints', '查询 ServiceEndpoint 列表', tags, (request) => this.listServiceEndpoints(request));
    router.post('/api/v1/service-endpoints', '创建 ServiceEndpoint', tags, (request) => this.createServiceEndpoint(request));
    router.patch('/api/v1/service-endpoints', '更新 ServiceEndpoint', tags, (request) => this.updateServiceEndpoint(request));
    router.post('/api/v1/service-endpoints/delete', '软删除 ServiceEndpoint', tags, (request) => this.deleteServiceEndpoint(request));
    router.get('/api/v1/managed-targets', '查询 ManagedTarget 列表', tags, (request) => this.listManagedTargets(request));
    router.get('/api/v1/managed-target-snapshots', '查询 ManagedTarget 快照列表', tags, (request) => this.listManagedTargetSnapshots(request));
    router.post('/api/v1/managed-targets', '创建 ManagedTarget', tags, (request) => this.createManagedTarget(request));
    router.patch('/api/v1/managed-targets', '更新 ManagedTarget', tags, (request) => this.updateManagedTarget(request));
    router.post('/api/v1/managed-targets/delete', '软删除 ManagedTarget', tags, (request) => this.deleteManagedTarget(request));
    router.get('/api/v1/discovery-snapshots', '查询发现快照', tags, (request) => this.listDiscoverySnapshots(request));
    router.post('/api/v1/discovery-snapshots', '写入发现快照', tags, (request) => this.upsertDiscoverySnapshot(request));
    router.post('/api/v1/discovery-snapshots/ingest', '入库发现结果', tags, (request) => this.ingestDiscovery(request));
    router.post('/api/v1/discovery-snapshots/merge-preview', '预览发现结果合并', tags, (request) => this.previewDiscoveryMerge(request));
    router.post('/api/v1/assets/refresh-from-agent', '通过 Agent 主动刷新资产', tags, (request) => this.refreshFromAgent(request));
    router.get('/api/v1/asset-conflicts', '查询资产冲突', tags, (request) => this.listAssetConflicts(request));
    router.post('/api/v1/asset-conflicts/resolve', '解决资产冲突', tags, (request) => this.resolveAssetConflict(request));
  }

  getApplicationService(): AssetsApplicationService {
    return this.service;
  }

  private async createHost(request: HttpRequest) {
    const body = validateObject(request.body, {
      hostname: { type: 'string' },
      displayName: { type: 'string' },
      primaryIp: { type: 'string' },
      ipAddresses: { type: 'array' },
      osType: { type: 'string', enum: OsTypes },
      osName: { type: 'string' },
      osVersion: { type: 'string' },
      arch: { type: 'string' },
      environment: { type: 'string' },
      zoneId: { type: 'string' },
      ownerId: { type: 'string' },
      managementChannels: { type: 'array' },
      discoverySource: { type: 'string', enum: assetsEnumValues.discoverySources },
      lastDiscoveredAt: { type: 'string' },
      agentId: { type: 'string' },
      assetFingerprint: { type: 'string' },
      compatibilityLevel: { type: 'string', enum: CompatibilityLevels },
      managementMode: { type: 'string', enum: ManagementModes },
      status: { type: 'string', enum: assetsEnumValues.hostStatuses },
      tags: { type: 'array' },
    });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'host.create', 'host', request);
    return this.service.createHost(tenantId(request), body as unknown as CreateHostDto).then((created) => {
      this.audit(request, subject, 'host.created', 'host.create', 'host', created.id, undefined, created);
      return { statusCode: 201, body: created };
    });
  }

  private async listHosts(request: HttpRequest) {
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['hostname', 'createdAt', 'updatedAt', 'status', 'environment', 'osType'],
      allowedFilterFields: ['hostname', 'primaryIp', 'osType', 'environment', 'zoneId', 'ownerId', 'discoverySource', 'agentId', 'assetFingerprint', 'status', 'tag'],
    });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'host.read', 'host', request);
    return this.service.listHosts(tenantId(request), await this.authorizedQuery(subject, 'host', 'read', query));
  }

  private async updateHost(request: HttpRequest) {
    const body = validateObject(request.body, {
      id: { type: 'string', required: true },
      hostname: { type: 'string' },
      displayName: { type: 'string' },
      primaryIp: { type: 'string' },
      ipAddresses: { type: 'array' },
      osType: { type: 'string', enum: OsTypes },
      osName: { type: 'string' },
      osVersion: { type: 'string' },
      arch: { type: 'string' },
      environment: { type: 'string' },
      zoneId: { type: 'string' },
      ownerId: { type: 'string' },
      managementChannels: { type: 'array' },
      discoverySource: { type: 'string', enum: assetsEnumValues.discoverySources },
      lastDiscoveredAt: { type: 'string' },
      agentId: { type: 'string' },
      assetFingerprint: { type: 'string' },
      compatibilityLevel: { type: 'string', enum: CompatibilityLevels },
      managementMode: { type: 'string', enum: ManagementModes },
      status: { type: 'string', enum: assetsEnumValues.hostStatuses },
      tags: { type: 'array' },
    });
    const { id, ...patch } = body as unknown as UpdateHostDto & { id: string };
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'host.update', 'host', request, id);
    return this.service.getRepository().getHost(tenantId(request), id).then((before) =>
      this.service.updateHost(tenantId(request), id, patch).then((updated) => {
        this.audit(request, subject, 'host.updated', 'host.update', 'host', id, before, updated);
        return updated;
      }),
    );
  }

  private async deleteHost(request: HttpRequest) {
    const body = validateObject(request.body, { id: { type: 'string', required: true } });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'host.delete', 'host', request, String(body.id));
    return this.service.getRepository().getHost(tenantId(request), String(body.id)).then((before) =>
      this.service.deleteHost(tenantId(request), String(body.id)).then((deleted) => {
        this.audit(request, subject, 'host.deleted', 'host.delete', 'host', String(body.id), before, deleted);
        return deleted;
      }),
    );
  }

  private async createServiceInstance(request: HttpRequest) {
    const body = validateObject(request.body, {
      hostId: { type: 'string' },
      providerType: { type: 'string', required: true, enum: ProviderTypes },
      serviceName: { type: 'string' },
      displayName: { type: 'string', required: true },
      versionText: { type: 'string' },
      installPath: { type: 'string' },
      configPath: { type: 'string' },
      runtimeUser: { type: 'string' },
      ports: { type: 'array' },
      providerKey: { type: 'string' },
      manualOverrides: { type: 'object' },
      discoverySource: { type: 'string', enum: assetsEnumValues.discoverySources },
      lastDiscoveredAt: { type: 'string' },
      status: { type: 'string', enum: assetsEnumValues.serviceInstanceStatuses },
      rawFacts: { type: 'object' },
    });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'service_instance.manage', 'service_instance', request);
    return this.service.createServiceInstance(tenantId(request), body as unknown as CreateServiceInstanceDto).then((created) => {
      this.audit(request, subject, 'service_instance.created', 'service_instance.manage', 'service_instance', created.id, undefined, created);
      return { statusCode: 201, body: created };
    });
  }

  private async listServiceInstances(request: HttpRequest) {
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['displayName', 'providerType', 'createdAt', 'updatedAt', 'status', 'hostId'],
      allowedFilterFields: ['hostId', 'providerType', 'serviceName', 'displayName', 'providerKey', 'status', 'discoverySource'],
    });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'service_instance.read', 'service_instance', request);
    return this.service.listServiceInstances(tenantId(request), await this.authorizedQuery(subject, 'service_instance', 'read', query));
  }

  private async updateServiceInstance(request: HttpRequest) {
    const body = validateObject(request.body, {
      id: { type: 'string', required: true },
      hostId: { type: 'string' },
      providerType: { type: 'string', enum: ProviderTypes },
      serviceName: { type: 'string' },
      displayName: { type: 'string' },
      versionText: { type: 'string' },
      installPath: { type: 'string' },
      configPath: { type: 'string' },
      runtimeUser: { type: 'string' },
      ports: { type: 'array' },
      providerKey: { type: 'string' },
      manualOverrides: { type: 'object' },
      discoverySource: { type: 'string', enum: assetsEnumValues.discoverySources },
      lastDiscoveredAt: { type: 'string' },
      status: { type: 'string', enum: assetsEnumValues.serviceInstanceStatuses },
      rawFacts: { type: 'object' },
    });
    const { id, ...patch } = body as unknown as UpdateServiceInstanceDto & { id: string };
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'service_instance.manage', 'service_instance', request, id);
    return this.service.getRepository().getServiceInstance(tenantId(request), id).then((before) =>
      this.service.updateServiceInstance(tenantId(request), id, patch).then((updated) => {
        this.audit(request, subject, 'service_instance.updated', 'service_instance.manage', 'service_instance', id, before, updated);
        return updated;
      }),
    );
  }

  private async deleteServiceInstance(request: HttpRequest) {
    const body = validateObject(request.body, { id: { type: 'string', required: true } });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'service_instance.manage', 'service_instance', request, String(body.id));
    return this.service.getRepository().getServiceInstance(tenantId(request), String(body.id)).then((before) =>
      this.service.deleteServiceInstance(tenantId(request), String(body.id)).then((deleted) => {
        this.audit(request, subject, 'service_instance.deleted', 'service_instance.manage', 'service_instance', String(body.id), before, deleted);
        return deleted;
      }),
    );
  }

  private async createServiceAsset(request: HttpRequest) {
    const body = validateObject(request.body, {
      address: { type: 'string', required: true },
      addressType: { type: 'string' },
      port: { type: 'number', required: true },
      protocol: { type: 'string', required: true, enum: assetsEnumValues.endpointProtocols },
      platform: { type: 'string', enum: assetsEnumValues.serviceAssetPlatforms },
      agentId: { type: 'string' },
      sniName: { type: 'string' },
      verifyUrl: { type: 'string' },
      displayName: { type: 'string' },
      serviceInstanceId: { type: 'string' },
      serviceEndpointId: { type: 'string' },
      hostId: { type: 'string' },
      environment: { type: 'string' },
      discoverySource: { type: 'string', enum: assetsEnumValues.discoverySources },
      lastDiscoveredAt: { type: 'string' },
      status: { type: 'string', enum: assetsEnumValues.serviceAssetStatuses },
      tags: { type: 'array' },
      metadata: { type: 'object' },
      targetBinding: { type: 'object' },
    });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'service_asset.manage', 'service_asset', request);
    return this.service.createServiceAsset(tenantId(request), body as unknown as CreateServiceAssetDto).then((created) => {
      this.audit(request, subject, 'service_asset.created', 'service_asset.manage', 'service_asset', created.id, undefined, created);
      return { statusCode: 201, body: created };
    });
  }

  private async listServiceAssets(request: HttpRequest) {
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['address', 'port', 'protocol', 'createdAt', 'updatedAt', 'status', 'serviceInstanceId', 'hostId'],
      allowedFilterFields: ['id', 'address', 'addressType', 'port', 'protocol', 'sniName', 'serviceInstanceId', 'serviceEndpointId', 'hostId', 'environment', 'discoverySource', 'status', 'tag'],
    });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'service_asset.read', 'service_asset', request);
    return this.service.listServiceAssets(tenantId(request), await this.authorizedQuery(subject, 'service_asset', 'read', query));
  }

  private async getServiceAssetDetail(request: HttpRequest) {
    const serviceAssetId = String(request.query.serviceAssetId ?? request.query.id ?? '').trim();
    if (!serviceAssetId) throw new AppError('VALIDATION_FAILED', 'serviceAssetId 不能为空', { field: 'serviceAssetId' });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'service_asset.read', 'service_asset', request, serviceAssetId);
    return this.service.getServiceAssetDetail(tenantId(request), serviceAssetId).then((detail) => {
      if (!detail) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceAsset 不存在', { serviceAssetId });
      return detail;
    });
  }

  private async updateServiceAsset(request: HttpRequest) {
    const body = validateObject(request.body, {
      id: { type: 'string', required: true },
      address: { type: 'string' },
      addressType: { type: 'string' },
      port: { type: 'number' },
      protocol: { type: 'string', enum: assetsEnumValues.endpointProtocols },
      platform: { type: 'string', enum: assetsEnumValues.serviceAssetPlatforms },
      agentId: { type: 'string' },
      sniName: { type: 'string' },
      verifyUrl: { type: 'string' },
      displayName: { type: 'string' },
      serviceInstanceId: { type: 'string' },
      serviceEndpointId: { type: 'string' },
      hostId: { type: 'string' },
      environment: { type: 'string' },
      discoverySource: { type: 'string', enum: assetsEnumValues.discoverySources },
      lastDiscoveredAt: { type: 'string' },
      status: { type: 'string', enum: assetsEnumValues.serviceAssetStatuses },
      tags: { type: 'array' },
      metadata: { type: 'object' },
      targetBinding: { type: 'object' },
    });
    const { id, ...patch } = body as unknown as UpdateServiceAssetDto & { id: string };
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'service_asset.manage', 'service_asset', request, id);
    return this.service.getRepository().getServiceAsset(tenantId(request), id).then((before) =>
      this.service.updateServiceAsset(tenantId(request), id, patch).then((updated) => {
        this.audit(request, subject, 'service_asset.updated', 'service_asset.manage', 'service_asset', id, before, updated);
        return updated;
      }),
    );
  }

  private async updateServiceAssetDeploymentStrategy(request: HttpRequest) {
    const body = validateObject(request.body, {
      id: { type: 'string' },
      deploymentStrategy: { type: 'object', required: true },
    });
    const subject = this.subjectFromRequest(request);
    const serviceAssetId = readServiceAssetId(request, body.id);
    await this.assertCan(subject, 'service_asset.manage', 'service_asset', request, serviceAssetId);
    return this.service.getRepository().getServiceAsset(tenantId(request), serviceAssetId).then((before) =>
      this.service.updateServiceAssetDeploymentStrategy(tenantId(request), serviceAssetId, body.deploymentStrategy as DeploymentStrategyDto, subject?.id).then((updated) => {
        this.audit(request, subject, 'service_asset.deployment_strategy.updated', 'service_asset.manage', 'service_asset', serviceAssetId, before, updated);
        return updated;
      }),
    );
  }

  private async deleteServiceAsset(request: HttpRequest) {
    const body = validateObject(request.body, { id: { type: 'string', required: true } });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'service_asset.manage', 'service_asset', request, String(body.id));
    return this.service.getRepository().getServiceAsset(tenantId(request), String(body.id)).then((before) =>
      this.service.deleteServiceAsset(tenantId(request), String(body.id)).then((deleted) => {
        this.audit(request, subject, 'service_asset.deleted', 'service_asset.manage', 'service_asset', String(body.id), before, deleted);
        return deleted;
      }),
    );
  }

  private async listApplicationAssetTargets(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    await this.assertCanAsync(subject, 'service_asset.read', 'service_asset', request);
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['createdAt', 'updatedAt', 'status', 'applicationAssetId', 'managedTargetId', 'siteAssetId'],
      allowedFilterFields: ['id', 'applicationAssetId', 'managedTargetId', 'siteAssetId', 'agentId', 'providerType', 'targetType', 'status', 'bindingKey'],
    });
    const authorized = await this.authorizedQuery(subject, 'service_asset', 'read', query);
    return this.service.getRepository().listApplicationAssetTargets(tenantId(request), {
      ...authorized,
      authorization: authorized.authorization ? { ...authorized.authorization, objectIdField: 'applicationAssetId' } : undefined,
    });
  }

  private async createApplicationAssetTarget(request: HttpRequest) {
    const body = this.readApplicationAssetTargetBody(request, true);
    const subject = this.subjectFromRequest(request);
    await this.assertCanAsync(subject, 'service_asset.manage', 'service_asset', request, String(body.applicationAssetId));
    const enriched = await this.enrichApplicationAssetTargetInput(tenantId(request), body);
    return { statusCode: 201, body: await this.service.getRepository().createApplicationAssetTarget(tenantId(request), enriched as any) };
  }

  private async updateApplicationAssetTarget(request: HttpRequest) {
    const body = this.readApplicationAssetTargetBody(request, false);
    const id = String(body.id);
    const subject = this.subjectFromRequest(request);
    await this.assertCanAsync(subject, 'service_asset.manage', 'service_asset', request, id);
    const { id: _id, ...patch } = body;
    void _id;
    return { statusCode: 200, body: await this.service.getRepository().updateApplicationAssetTarget(tenantId(request), id, patch as any) };
  }

  private async deleteApplicationAssetTarget(request: HttpRequest) {
    const body = validateObject(request.body, { id: { type: 'string', required: true } });
    const subject = this.subjectFromRequest(request);
    await this.assertCanAsync(subject, 'service_asset.manage', 'service_asset', request, String(body.id));
    return { statusCode: 200, body: await this.service.getRepository().deleteApplicationAssetTarget(tenantId(request), String(body.id)) };
  }

  private readApplicationAssetTargetBody(request: HttpRequest, creating: boolean): Record<string, unknown> {
    return validateObject(request.body, {
      id: { type: 'string', required: !creating },
      applicationAssetId: { type: 'string', required: creating },
      agentId: { type: 'string' },
      siteAssetId: { type: 'string' },
      managedTargetId: { type: 'string', required: creating },
      providerType: { type: 'string', enum: ProviderTypes },
      frameworkType: { type: 'string', enum: ProviderTypes },
      targetType: { type: 'string', enum: assetsEnumValues.managedTargetTypes },
      targetKey: { type: 'string' },
      bindingKey: { type: 'string' },
      status: { type: 'string', enum: assetsEnumValues.applicationAssetTargetStatuses },
      metadata: { type: 'object' },
    });
  }

  private async enrichApplicationAssetTargetInput(tenantIdValue: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const managedTargetId = String(body.managedTargetId);
    const managedTarget = await this.service.getRepository().getManagedTarget(tenantIdValue, managedTargetId);
    if (!managedTarget) throw new AppError('RESOURCE_NOT_FOUND', 'ManagedTarget 不存在', { managedTargetId });
    const siteAssetId = typeof body.siteAssetId === 'string' && body.siteAssetId.trim()
      ? body.siteAssetId
      : managedTarget.siteAssetId;
    const siteAsset = siteAssetId ? await this.service.getRepository().getSiteAsset(tenantIdValue, siteAssetId) : undefined;
    return {
      ...body,
      agentId: body.agentId ?? managedTarget.agentId ?? siteAsset?.agentId,
      siteAssetId,
      providerType: body.providerType ?? managedTarget.providerType ?? siteAsset?.providerType,
      frameworkType: body.frameworkType ?? managedTarget.frameworkType ?? managedTarget.providerType ?? siteAsset?.providerType,
      targetType: body.targetType ?? managedTarget.targetType,
      targetKey: body.targetKey ?? managedTarget.targetKey,
      bindingKey: body.bindingKey ?? managedTarget.bindingKey ?? siteAsset?.bindingInformation,
    };
  }

  private async createSiteAsset(request: HttpRequest) {
    const body = validateObject(request.body, {
      serviceInstanceId: { type: 'string', required: true },
      serviceAssetId: { type: 'string' },
      hostId: { type: 'string' },
      agentId: { type: 'string' },
      providerType: { type: 'string', required: true, enum: ProviderTypes },
      siteType: { type: 'string', required: true, enum: assetsEnumValues.siteAssetTypes },
      siteName: { type: 'string', required: true },
      siteKey: { type: 'string', required: true },
      bindingInformation: { type: 'string' },
      hostHeader: { type: 'string' },
      listenIp: { type: 'string' },
      port: { type: 'number' },
      protocol: { type: 'string', enum: assetsEnumValues.endpointProtocols },
      configPath: { type: 'string' },
      runtimeStatus: { type: 'string' },
      discoverySource: { type: 'string', enum: assetsEnumValues.discoverySources },
      lastDiscoveredAt: { type: 'string' },
      status: { type: 'string', enum: assetsEnumValues.siteAssetStatuses },
      metadata: { type: 'object' },
    });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'site_asset.manage', 'site_asset', request);
    return this.service.createSiteAsset(tenantId(request), body as unknown as CreateSiteAssetDto).then((created) => {
      this.audit(request, subject, 'site_asset.created', 'site_asset.manage', 'site_asset', created.id, undefined, created);
      return { statusCode: 201, body: created };
    });
  }

  private async listSiteAssets(request: HttpRequest) {
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['siteName', 'siteKey', 'providerType', 'port', 'createdAt', 'updatedAt', 'status', 'serviceInstanceId', 'serviceAssetId', 'hostId', 'agentId'],
      allowedFilterFields: ['id', 'serviceInstanceId', 'serviceAssetId', 'hostId', 'agentId', 'providerType', 'siteType', 'siteName', 'siteKey', 'hostHeader', 'port', 'protocol', 'status', 'discoverySource'],
    });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'site_asset.read', 'site_asset', request);
    return this.service.listSiteAssets(tenantId(request), await this.authorizedQuery(subject, 'site_asset', 'read', query));
  }

  private async updateSiteAsset(request: HttpRequest) {
    const body = validateObject(request.body, {
      id: { type: 'string', required: true },
      serviceInstanceId: { type: 'string' },
      serviceAssetId: { type: 'string' },
      hostId: { type: 'string' },
      agentId: { type: 'string' },
      providerType: { type: 'string', enum: ProviderTypes },
      siteType: { type: 'string', enum: assetsEnumValues.siteAssetTypes },
      siteName: { type: 'string' },
      siteKey: { type: 'string' },
      bindingInformation: { type: 'string' },
      hostHeader: { type: 'string' },
      listenIp: { type: 'string' },
      port: { type: 'number' },
      protocol: { type: 'string', enum: assetsEnumValues.endpointProtocols },
      configPath: { type: 'string' },
      runtimeStatus: { type: 'string' },
      discoverySource: { type: 'string', enum: assetsEnumValues.discoverySources },
      lastDiscoveredAt: { type: 'string' },
      status: { type: 'string', enum: assetsEnumValues.siteAssetStatuses },
      metadata: { type: 'object' },
    });
    const { id, ...patch } = body as unknown as UpdateSiteAssetDto & { id: string };
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'site_asset.manage', 'site_asset', request, id);
    return this.service.getRepository().getSiteAsset(tenantId(request), id).then((before) =>
      this.service.updateSiteAsset(tenantId(request), id, patch).then((updated) => {
        this.audit(request, subject, 'site_asset.updated', 'site_asset.manage', 'site_asset', id, before, updated);
        return updated;
      }),
    );
  }

  private async deleteSiteAsset(request: HttpRequest) {
    const body = validateObject(request.body, { id: { type: 'string', required: true } });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'site_asset.manage', 'site_asset', request, String(body.id));
    return this.service.getRepository().getSiteAsset(tenantId(request), String(body.id)).then((before) =>
      this.service.deleteSiteAsset(tenantId(request), String(body.id)).then((deleted) => {
        this.audit(request, subject, 'site_asset.deleted', 'site_asset.manage', 'site_asset', String(body.id), before, deleted);
        return deleted;
      }),
    );
  }

  private async createServiceEndpoint(request: HttpRequest) {
    const body = validateObject(request.body, {
      serviceInstanceId: { type: 'string', required: true },
      protocol: { type: 'string', required: true, enum: assetsEnumValues.endpointProtocols },
      hostName: { type: 'string' },
      listenIp: { type: 'string' },
      port: { type: 'number', required: true },
      pathHint: { type: 'string' },
      status: { type: 'string', enum: assetsEnumValues.endpointStatuses },
    });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'service_instance.manage', 'service_endpoint', request);
    return this.service.createServiceEndpoint(tenantId(request), body as unknown as CreateServiceEndpointDto).then((created) => {
      this.audit(request, subject, 'service_endpoint.created', 'service_instance.manage', 'service_endpoint', created.id, undefined, created);
      return { statusCode: 201, body: created };
    });
  }

  private async listServiceEndpoints(request: HttpRequest) {
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['port', 'protocol', 'createdAt', 'updatedAt', 'status', 'serviceInstanceId', 'hostName'],
      allowedFilterFields: ['serviceInstanceId', 'hostId', 'protocol', 'hostName', 'listenIp', 'port', 'status'],
    });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'service_instance.read', 'service_endpoint', request);
    return this.service.listServiceEndpoints(tenantId(request), await this.authorizedQuery(subject, 'service_endpoint', 'read', query));
  }

  private async updateServiceEndpoint(request: HttpRequest) {
    const body = validateObject(request.body, {
      id: { type: 'string', required: true },
      serviceInstanceId: { type: 'string' },
      protocol: { type: 'string', enum: assetsEnumValues.endpointProtocols },
      hostName: { type: 'string' },
      listenIp: { type: 'string' },
      port: { type: 'number' },
      pathHint: { type: 'string' },
      status: { type: 'string', enum: assetsEnumValues.endpointStatuses },
    });
    const { id, ...patch } = body as unknown as UpdateServiceEndpointDto & { id: string };
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'service_instance.manage', 'service_endpoint', request, id);
    return this.service.getRepository().getServiceEndpoint(tenantId(request), id).then((before) =>
      this.service.updateServiceEndpoint(tenantId(request), id, patch).then((updated) => {
        this.audit(request, subject, 'service_endpoint.updated', 'service_instance.manage', 'service_endpoint', id, before, updated);
        return updated;
      }),
    );
  }

  private async deleteServiceEndpoint(request: HttpRequest) {
    const body = validateObject(request.body, { id: { type: 'string', required: true } });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'service_instance.manage', 'service_endpoint', request, String(body.id));
    return this.service.getRepository().getServiceEndpoint(tenantId(request), String(body.id)).then((before) =>
      this.service.deleteServiceEndpoint(tenantId(request), String(body.id)).then((deleted) => {
        this.audit(request, subject, 'service_endpoint.deleted', 'service_instance.manage', 'service_endpoint', String(body.id), before, deleted);
        return deleted;
      }),
    );
  }

  private async createManagedTarget(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentId: { type: 'string', required: true },
      hostId: { type: 'string' },
      serviceInstanceId: { type: 'string' },
      serviceAssetId: { type: 'string' },
      siteAssetId: { type: 'string' },
      providerType: { type: 'string', required: true, enum: ProviderTypes },
      frameworkType: { type: 'string', required: true, enum: ProviderTypes },
      targetType: { type: 'string', required: true, enum: assetsEnumValues.managedTargetTypes },
      targetKey: { type: 'string', required: true },
      bindingKey: { type: 'string' },
      capabilityProfile: { type: 'object' },
      deploymentMode: { type: 'string' },
      lastSeenAt: { type: 'string' },
      status: { type: 'string', enum: assetsEnumValues.managedTargetStatuses },
      metadata: { type: 'object' },
    });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'managed_target.manage', 'managed_target', request);
    return this.service.createManagedTarget(tenantId(request), body as unknown as CreateManagedTargetDto).then((created) => {
      this.audit(request, subject, 'managed_target.created', 'managed_target.manage', 'managed_target', created.id, undefined, created);
      return { statusCode: 201, body: created };
    });
  }

  private async listManagedTargets(request: HttpRequest) {
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['agentId', 'providerType', 'frameworkType', 'targetType', 'targetKey', 'createdAt', 'updatedAt', 'status', 'hostId', 'serviceInstanceId', 'serviceAssetId', 'siteAssetId'],
      allowedFilterFields: ['id', 'agentId', 'hostId', 'serviceInstanceId', 'serviceAssetId', 'siteAssetId', 'providerType', 'frameworkType', 'targetType', 'targetKey', 'bindingKey', 'deploymentMode', 'status'],
    });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'managed_target.read', 'managed_target', request);
    return this.service.listManagedTargets(tenantId(request), await this.authorizedQuery(subject, 'managed_target', 'read', query));
  }

  private async listManagedTargetSnapshots(request: HttpRequest) {
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['capturedAt', 'createdAt', 'updatedAt', 'snapshotType', 'status', 'applicationAssetId', 'managedTargetId', 'executionRunId'],
      allowedFilterFields: ['id', 'applicationAssetId', 'siteAssetId', 'managedTargetId', 'certificateBindingId', 'executionRunId', 'executionStepId', 'snapshotType', 'status', 'storeThumbprint'],
    });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'managed_target.read', 'managed_target_snapshot', request);
    return this.service.listManagedTargetSnapshots(tenantId(request), await this.authorizedQuery(subject, 'managed_target_snapshot', 'read', query));
  }

  private async updateManagedTarget(request: HttpRequest) {
    const body = validateObject(request.body, {
      id: { type: 'string', required: true },
      agentId: { type: 'string' },
      hostId: { type: 'string' },
      serviceInstanceId: { type: 'string' },
      serviceAssetId: { type: 'string' },
      siteAssetId: { type: 'string' },
      providerType: { type: 'string', enum: ProviderTypes },
      frameworkType: { type: 'string', enum: ProviderTypes },
      targetType: { type: 'string', enum: assetsEnumValues.managedTargetTypes },
      targetKey: { type: 'string' },
      bindingKey: { type: 'string' },
      capabilityProfile: { type: 'object' },
      deploymentMode: { type: 'string' },
      lastSeenAt: { type: 'string' },
      status: { type: 'string', enum: assetsEnumValues.managedTargetStatuses },
      metadata: { type: 'object' },
    });
    const { id, ...patch } = body as unknown as UpdateManagedTargetDto & { id: string };
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'managed_target.manage', 'managed_target', request, id);
    return this.service.getRepository().getManagedTarget(tenantId(request), id).then((before) =>
      this.service.updateManagedTarget(tenantId(request), id, patch).then((updated) => {
        this.audit(request, subject, 'managed_target.updated', 'managed_target.manage', 'managed_target', id, before, updated);
        return updated;
      }),
    );
  }

  private async deleteManagedTarget(request: HttpRequest) {
    const body = validateObject(request.body, { id: { type: 'string', required: true } });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'managed_target.manage', 'managed_target', request, String(body.id));
    return this.service.getRepository().getManagedTarget(tenantId(request), String(body.id)).then((before) =>
      this.service.deleteManagedTarget(tenantId(request), String(body.id)).then((deleted) => {
        this.audit(request, subject, 'managed_target.deleted', 'managed_target.manage', 'managed_target', String(body.id), before, deleted);
        return deleted;
      }),
    );
  }

  private async upsertDiscoverySnapshot(request: HttpRequest) {
    const body = validateObject(request.body, {
      normalizedHash: { type: 'string', required: true },
      source: { type: 'string', enum: assetsEnumValues.discoverySources },
      normalizedPayload: { type: 'object' },
      rawPayload: { type: 'object' },
    });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'discovery.manage', 'discovery_snapshot', request);
    return this.service.upsertDiscoverySnapshot(tenantId(request), body as unknown as CreateDiscoverySnapshotDto).then((created) => {
      this.audit(request, subject, 'discovery_snapshot.upserted', 'discovery.manage', 'discovery_snapshot', created.id, undefined, created);
      return { statusCode: 201, body: created };
    });
  }

  private async listDiscoverySnapshots(request: HttpRequest) {
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['normalizedHash', 'source', 'createdAt', 'updatedAt'],
      allowedFilterFields: ['normalizedHash', 'source'],
    });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'discovery.read', 'discovery_snapshot', request);
    return this.service.listDiscoverySnapshots(tenantId(request), await this.authorizedQuery(subject, 'discovery_snapshot', 'read', query));
  }

  private async previewDiscoveryMerge(request: HttpRequest) {
    const body = validateObject(request.body, {
      normalizedHash: { type: 'string', required: true },
      source: { type: 'string', enum: assetsEnumValues.discoverySources },
      normalizedPayload: { type: 'object' },
      rawPayload: { type: 'object' },
    });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'discovery.read', 'discovery_snapshot', request);
    return this.service.previewDiscoveryMerge(tenantId(request), body as unknown as PreviewDiscoveryMergeDto).then((result) => ({ statusCode: 201, body: result }));
  }

  private async ingestDiscovery(request: HttpRequest) {
    const body = validateObject(request.body, {
      normalizedHash: { type: 'string', required: true },
      source: { type: 'string', enum: assetsEnumValues.discoverySources },
      normalizedPayload: { type: 'object' },
      rawPayload: { type: 'object' },
      apply: { type: 'boolean' },
    });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'discovery.manage', 'discovery_snapshot', request);
    return this.service.ingestDiscovery(tenantId(request), body as unknown as IngestDiscoveryDto).then((result) => {
      this.audit(request, subject, 'discovery_snapshot.ingested', 'discovery.manage', 'discovery_snapshot', result.snapshot.id, undefined, result);
      return { statusCode: 201, body: result };
    });
  }

  private async refreshFromAgent(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentId: { type: 'string', required: true },
      providerTypes: { type: 'array' },
      includeBindings: { type: 'boolean' },
      requestId: { type: 'string' },
    });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'discovery.manage', 'discovery_snapshot', request);
    return this.service.refreshAssetsFromAgent(tenantId(request), body as unknown as RefreshAssetsFromAgentDto).then((result) => {
      this.audit(request, subject, 'discovery_snapshot.agent_refreshed', 'discovery.manage', 'discovery_snapshot', result.snapshot.id, undefined, result);
      return { statusCode: 201, body: result };
    });
  }

  private async listAssetConflicts(request: HttpRequest) {
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['resourceType', 'resourceId', 'field', 'status', 'createdAt', 'updatedAt', 'resolvedAt'],
      allowedFilterFields: ['id', 'resourceType', 'resourceId', 'field', 'status', 'sourceSnapshotId', 'resolvedBy'],
    });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'asset_conflict.read', 'asset_conflict', request);
    return this.service.listAssetConflicts(tenantId(request), await this.authorizedQuery(subject, 'asset_conflict', 'read', query));
  }

  private async resolveAssetConflict(request: HttpRequest) {
    const body = validateObject(request.body, {
      id: { type: 'string', required: true },
      resolution: { type: 'string', required: true, enum: assetsEnumValues.conflictResolutions },
      comment: { type: 'string' },
    });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'asset_conflict.resolve', 'asset_conflict', request, String(body.id));
    return this.service.resolveAssetConflict(tenantId(request), {
      ...(body as unknown as ResolveAssetConflictDto),
      resolvedBy: subject.id,
    }).then((result) => {
      this.audit(request, subject, 'asset_conflict.resolved', 'asset_conflict.resolve', 'asset_conflict', result.conflict.id, undefined, result);
      return result;
    });
  }

  private subjectFromRequest(request: HttpRequest): SecuritySubject {
    if (!this.security) return { id: request.context.actorId ?? 'system_assets', type: 'system', scope: { tenantId: request.context.tenantId } };
    if (!request.context.actorId) throw new AppError('AUTH_UNAUTHENTICATED', '缺少 actor 上下文');
    return { id: request.context.actorId, type: 'user', scope: { tenantId: request.context.tenantId } };
  }

  private async assertCan(subject: SecuritySubject, action: string, resourceType: string, request: HttpRequest, resourceId?: string): Promise<void> {
    if (!this.security) return;
    await this.security.rbac.assertCan(subject, action, {
      type: resourceType,
      id: resourceId,
      scope: { tenantId: request.context.tenantId, ownerId: subject.id },
    }, this.securityContext(request, subject));
  }

  private async assertCanAsync(subject: SecuritySubject, action: string, resourceType: string, request: HttpRequest, resourceId?: string): Promise<void> {
    if (!this.security) return;
    await this.security.rbac.assertCan(subject, action, {
      type: resourceType,
      id: resourceId,
      scope: { tenantId: request.context.tenantId, ownerId: subject.id },
    }, this.securityContext(request, subject));
  }

  private async authorizedQuery(subject: SecuritySubject, objectType: string, accessLevel: 'read' | 'edit' | 'control', query: PageQuery): Promise<PageQuery> {
    if (!this.security) return query;
    return withAuthorization(query, await this.security.objectPermissions.buildAuthorizedQuery(subject, objectType, accessLevel));
  }

  private audit(request: HttpRequest, subject: SecuritySubject, eventType: string, action: string, resourceType: string, resourceId: string | undefined, before: unknown, after: unknown): void {
    void this.security?.audit.write({
      eventType,
      actorType: subject.type === 'system' ? 'system' : 'user',
      actorId: subject.id,
      action,
      resourceType,
      resourceId,
      result: 'success',
      riskLevel: 'low',
      context: this.securityContext(request, subject),
      detail: { before, after },
    }).catch(() => undefined);
  }

  private securityContext(request: HttpRequest, actor: SecuritySubject) {
    return { requestId: request.context.requestId, sourceIp: request.context.ip, actor };
  }

}

function tenantId(request: HttpRequest): string {
  return request.context.tenantId ?? tenantFallback;
}

function readServiceAssetId(request: HttpRequest, bodyId?: unknown): string {
  const pathId = request.path.match(/^\/api\/v1\/service-assets\/([^/]+)\/deployment-strategy$/)?.[1];
  const id = bodyId ?? request.query.id ?? request.query.serviceAssetId ?? pathId;
  if (Array.isArray(id) || typeof id !== 'string' || id.trim() === '') {
    throw new AppError('VALIDATION_FAILED', 'serviceAssetId 不能为空', { field: 'serviceAssetId' });
  }
  return id.trim();
}

export function getAssetsRouteContracts(): RouteContract[] {
  return [
    { method: 'GET', path: '/api/v1/hosts', operationId: 'listHosts', summary: '查询 Host 列表', tags, responseSchema: pageSchema() },
    { method: 'POST', path: '/api/v1/hosts', operationId: 'createHost', summary: '创建 Host', tags, responseSchema: objectSchema() },
    { method: 'PATCH', path: '/api/v1/hosts', operationId: 'updateHost', summary: '更新 Host', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/hosts/delete', operationId: 'deleteHost', summary: '软删除 Host', tags, responseSchema: objectSchema() },
    { method: 'GET', path: '/api/v1/service-instances', operationId: 'listServiceInstances', summary: '查询 ServiceInstance 列表', tags, responseSchema: pageSchema() },
    { method: 'POST', path: '/api/v1/service-instances', operationId: 'createServiceInstance', summary: '创建 ServiceInstance', tags, responseSchema: objectSchema() },
    { method: 'PATCH', path: '/api/v1/service-instances', operationId: 'updateServiceInstance', summary: '更新 ServiceInstance', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/service-instances/delete', operationId: 'deleteServiceInstance', summary: '软删除 ServiceInstance', tags, responseSchema: objectSchema() },
    { method: 'GET', path: '/api/v1/service-assets', operationId: 'listServiceAssets', summary: '查询 ServiceAsset 列表', tags, responseSchema: pageSchema() },
    { method: 'GET', path: '/api/v1/service-assets/detail', operationId: 'getServiceAssetDetail', summary: '查询 ServiceAsset 详情', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/service-assets', operationId: 'createServiceAsset', summary: '创建 ServiceAsset', tags, responseSchema: objectSchema() },
    { method: 'PATCH', path: '/api/v1/service-assets', operationId: 'updateServiceAsset', summary: '更新 ServiceAsset', tags, responseSchema: objectSchema() },
    { method: 'PATCH', path: '/api/v1/service-assets/:id/deployment-strategy', operationId: 'updateServiceAssetDeploymentStrategyById', summary: '按 ID 更新 ServiceAsset 证书部署策略', tags, responseSchema: objectSchema() },
    { method: 'PATCH', path: '/api/v1/service-assets/deployment-strategy', operationId: 'updateServiceAssetDeploymentStrategy', summary: '更新 ServiceAsset 证书部署策略', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/service-assets/delete', operationId: 'deleteServiceAsset', summary: '软删除 ServiceAsset', tags, responseSchema: objectSchema() },
    { method: 'GET', path: '/api/v1/application-asset-targets', operationId: 'listApplicationAssetTargets', summary: '查询 ApplicationAssetTarget 列表', tags, responseSchema: pageSchema() },
    { method: 'POST', path: '/api/v1/application-asset-targets', operationId: 'createApplicationAssetTarget', summary: '创建 ApplicationAssetTarget', tags, responseSchema: objectSchema() },
    { method: 'PATCH', path: '/api/v1/application-asset-targets', operationId: 'updateApplicationAssetTarget', summary: '更新 ApplicationAssetTarget', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/application-asset-targets/delete', operationId: 'deleteApplicationAssetTarget', summary: '软删除 ApplicationAssetTarget', tags, responseSchema: objectSchema() },
    { method: 'GET', path: '/api/v1/site-assets', operationId: 'listSiteAssets', summary: '查询 SiteAsset 列表', tags, responseSchema: pageSchema() },
    { method: 'POST', path: '/api/v1/site-assets', operationId: 'createSiteAsset', summary: '创建 SiteAsset', tags, responseSchema: objectSchema() },
    { method: 'PATCH', path: '/api/v1/site-assets', operationId: 'updateSiteAsset', summary: '更新 SiteAsset', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/site-assets/delete', operationId: 'deleteSiteAsset', summary: '软删除 SiteAsset', tags, responseSchema: objectSchema() },
    { method: 'GET', path: '/api/v1/service-endpoints', operationId: 'listServiceEndpoints', summary: '查询 ServiceEndpoint 列表', tags, responseSchema: pageSchema() },
    { method: 'POST', path: '/api/v1/service-endpoints', operationId: 'createServiceEndpoint', summary: '创建 ServiceEndpoint', tags, responseSchema: objectSchema() },
    { method: 'PATCH', path: '/api/v1/service-endpoints', operationId: 'updateServiceEndpoint', summary: '更新 ServiceEndpoint', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/service-endpoints/delete', operationId: 'deleteServiceEndpoint', summary: '软删除 ServiceEndpoint', tags, responseSchema: objectSchema() },
    { method: 'GET', path: '/api/v1/managed-targets', operationId: 'listManagedTargets', summary: '查询 ManagedTarget 列表', tags, responseSchema: pageSchema() },
    { method: 'GET', path: '/api/v1/managed-target-snapshots', operationId: 'listManagedTargetSnapshots', summary: '查询 ManagedTarget 快照列表', tags, responseSchema: pageSchema() },
    { method: 'POST', path: '/api/v1/managed-targets', operationId: 'createManagedTarget', summary: '创建 ManagedTarget', tags, responseSchema: objectSchema() },
    { method: 'PATCH', path: '/api/v1/managed-targets', operationId: 'updateManagedTarget', summary: '更新 ManagedTarget', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/managed-targets/delete', operationId: 'deleteManagedTarget', summary: '软删除 ManagedTarget', tags, responseSchema: objectSchema() },
    { method: 'GET', path: '/api/v1/discovery-snapshots', operationId: 'listDiscoverySnapshots', summary: '查询发现快照', tags, responseSchema: pageSchema() },
    { method: 'POST', path: '/api/v1/discovery-snapshots', operationId: 'upsertDiscoverySnapshot', summary: '写入发现快照', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/discovery-snapshots/ingest', operationId: 'ingestDiscovery', summary: '入库发现结果', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/discovery-snapshots/merge-preview', operationId: 'previewDiscoveryMerge', summary: '预览发现结果合并', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/assets/refresh-from-agent', operationId: 'refreshAssetsFromAgent', summary: '通过 Agent 主动刷新资产', tags, responseSchema: objectSchema() },
    { method: 'GET', path: '/api/v1/asset-conflicts', operationId: 'listAssetConflicts', summary: '查询资产冲突', tags, responseSchema: pageSchema() },
    { method: 'POST', path: '/api/v1/asset-conflicts/resolve', operationId: 'resolveAssetConflict', summary: '解决资产冲突', tags, responseSchema: objectSchema() },
  ];
}

function objectSchema() {
  return { type: 'object', additionalProperties: true };
}

function pageSchema() {
  return {
    type: 'object',
    required: ['items', 'page', 'pageSize', 'total'],
    properties: {
      items: { type: 'array', items: { type: 'object', additionalProperties: true } },
      page: { type: 'number' },
      pageSize: { type: 'number' },
      total: { type: 'number' },
    },
  };
}
