import { AppError } from '../../../common/errors/app-error.js';
import { parsePageQuery, withAuthorization, type PageQuery } from '../../../common/pagination/pagination.js';
import type { Router } from '../../../common/http/router.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import { requireTenantId } from '../../../common/http/tenant-context.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import {
  CompatibilityLevels,
  ManagementModes,
  OsTypes,
} from '../../../shared/enums/core.enums.js';
import type { SecuritySubject } from '../../../shared/security-types.js';
import type { SecurityServices } from '../../security/security.controller.js';
import type { DevicesApplicationService } from '../../devices/application/devices.application-service.js';
import type { ManagedDeviceSummaryDto } from '../../devices/dto/devices.dto.js';
import { AssetsApplicationService } from '../application/assets.application-service.js';
import { ApplicationAssetExecutionService, type SaveStandaloneWorkflowExecutionInput } from '../application/application-asset-execution.service.js';
import type { ApplicationExecutionCompatibilityService } from '../application/application-execution-compatibility.service.js';
import { assetsEnumValues } from '../domain/assets.domain-service.js';
import type {
  CreateDiscoverySnapshotDto,
  CreateHostDto,
  CreateManagedTargetDto,
  CreateServiceAssetDto,
  CreateSiteAssetDto,
  PreviewDiscoveryMergeDto,
  RefreshAssetsFromAgentDto,
  ResolveAssetConflictDto,
  UpdateManagedTargetDto,
  UpdateServiceAssetDto,
  UpdateSiteAssetDto,
  CreateServiceEndpointDto,
  CreateFrameworkInstanceDto,
  UpdateHostDto,
  UpdateServiceEndpointDto,
  UpdateFrameworkInstanceDto,
  DeploymentStrategyDto,
} from '../dto/assets.dto.js';

const tags = ['Assets'];

export class AssetsController {
  constructor(
    private readonly security?: SecurityServices,
    private readonly service = new AssetsApplicationService(),
    private readonly executionService?: ApplicationAssetExecutionService,
    private readonly executionCompatibility?: ApplicationExecutionCompatibilityService,
    private readonly devices?: DevicesApplicationService,
  ) {}

  register(router: Router): void {
    // 统一资产入口由服务端完成设备与云服务投影；应用入口严格只返回 APPLICATION。
    router.get('/api/v1/assets', '查询统一资产列表', tags, (request) => this.listUnifiedAssets(request));
    router.get('/api/v1/applications', '查询应用列表', tags, (request) => this.listServiceAssets(request, 'APPLICATION'));
    router.get('/api/v1/applications/edit-detail', '查询 Application 编辑详情', tags, (request) => this.getApplicationEditDetail(request));
    router.get('/api/v1/applications/detail', '查询 Application 详情', tags, (request) => this.getApplicationDetail(request));
    router.get('/api/v1/applications/:applicationAssetId/linkage-status', '查询插件 Agent 联动状态', tags, (request) => this.getLinkageStatus(request));
    router.post('/api/v1/applications/:applicationAssetId/rescan', '重扫应用关联资产', tags, (request) => this.rescanApplicationAsset(request));
    router.post('/api/v1/applications/:applicationAssetId/linkage-repair', '修复插件 Agent 联动状态', tags, (request) => this.repairLinkage(request));
    router.post('/api/v1/applications', '创建 Application', tags, (request) => this.createServiceAsset(request));
    router.patch('/api/v1/applications', '更新 Application', tags, (request) => this.updateServiceAsset(request));
    router.post('/api/v1/applications/delete', '删除 Application', tags, (request) => this.deleteServiceAsset(request));
    router.get('/api/v1/hosts', '查询 Host 列表', tags, (request) => this.listHosts(request));
    router.post('/api/v1/hosts', '创建 Host', tags, (request) => this.createHost(request));
    router.patch('/api/v1/hosts', '更新 Host', tags, (request) => this.updateHost(request));
    router.post('/api/v1/hosts/delete', '软删除 Host', tags, (request) => this.deleteHost(request));
    router.get('/api/v1/framework-instances', '查询 FrameworkInstance 列表', tags, (request) => this.listFrameworkInstances(request));
    router.post('/api/v1/framework-instances', '创建 FrameworkInstance', tags, (request) => this.createFrameworkInstance(request));
    router.patch('/api/v1/framework-instances', '更新 FrameworkInstance', tags, (request) => this.updateFrameworkInstance(request));
    router.post('/api/v1/framework-instances/delete', '软删除 FrameworkInstance', tags, (request) => this.deleteFrameworkInstance(request));
    router.get('/api/v1/service-assets', '查询 ServiceAsset 列表', tags, (request) => this.listServiceAssets(request));
    router.get('/api/v1/service-assets/detail', '查询 ServiceAsset 详情', tags, (request) => this.getServiceAssetDetail(request));
    router.post('/api/v1/service-assets', '创建 ServiceAsset', tags, (request) => this.createServiceAsset(request));
    router.patch('/api/v1/service-assets', '更新 ServiceAsset', tags, (request) => this.updateServiceAsset(request));
    router.patch('/api/v1/service-assets/:id/deployment-strategy', '按 ID 更新 ServiceAsset 证书部署策略', tags, (request) => this.updateServiceAssetDeploymentStrategy(request));
    router.patch('/api/v1/service-assets/deployment-strategy', '更新 ServiceAsset 证书部署策略', tags, (request) => this.updateServiceAssetDeploymentStrategy(request));
    router.put('/api/v1/application-assets/:applicationAssetId/standalone-workflow', '保存非受管工作流执行配置', tags, (request) => this.saveStandaloneWorkflowExecution(request));
    router.get('/api/v1/application-assets/:applicationAssetId/execution-compatibility', '读取应用执行兼容性', tags, (request) => this.getExecutionCompatibility(request));
    router.post('/api/v1/application-assets/:applicationAssetId/execution-compatibility/recheck', '重新检查应用执行兼容性', tags, (request) => this.recheckExecutionCompatibility(request));
    router.post('/api/v1/service-assets/delete', '软删除 ServiceAsset', tags, (request) => this.deleteServiceAsset(request));
    router.get('/api/v1/application-asset-targets', '查询 ApplicationAssetTarget 列表', tags, (request) => this.listApplicationAssetTargets(request));
    router.get('/api/v1/application-targets', '查询 ApplicationTarget 列表', tags, (request) => this.listApplicationAssetTargets(request));
    router.post('/api/v1/application-asset-targets', '创建 ApplicationAssetTarget', tags, (request) => this.createApplicationAssetTarget(request));
    router.post('/api/v1/application-targets', '创建 ApplicationTarget', tags, (request) => this.createApplicationAssetTarget(request));
    router.patch('/api/v1/application-asset-targets', '更新 ApplicationAssetTarget', tags, (request) => this.updateApplicationAssetTarget(request));
    router.patch('/api/v1/application-targets', '更新 ApplicationTarget', tags, (request) => this.updateApplicationAssetTarget(request));
    router.post('/api/v1/application-asset-targets/delete', '软删除 ApplicationAssetTarget', tags, (request) => this.deleteApplicationAssetTarget(request));
    router.post('/api/v1/application-targets/delete', '删除 ApplicationTarget', tags, (request) => this.deleteApplicationAssetTarget(request));
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
    router.post('/api/v1/discovery-snapshots/ingest', '旧发现写入入口已退役', tags, () => {
      throw new AppError('LEGACY_API_REMOVED', '旧发现写入入口已退役，请使用标准设备发现 V2');
    });
    router.post('/api/v1/discovery-snapshots/merge-preview', '预览发现结果合并', tags, (request) => this.previewDiscoveryMerge(request));
    router.post('/api/v1/assets/refresh-from-agent', '通过 Agent 主动刷新资产', tags, (request) => this.refreshFromAgent(request));
    router.get('/api/v1/asset-conflicts', '查询资产冲突', tags, (request) => this.listAssetConflicts(request));
    router.post('/api/v1/asset-conflicts/resolve', '解决资产冲突', tags, (request) => this.resolveAssetConflict(request));
  }

  /**
   * 统一资产列表是资产中心唯一读入口。底层设备和 ServiceAsset 仍保留各自领域服务，
   * 这里只负责权限收窄、投影、全局排序和分页，避免浏览器拼接两套列表导致结果失真。
   */
  private async listUnifiedAssets(request: HttpRequest) {
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['displayName', 'category', 'productFamily', 'managementMethod', 'health', 'status', 'updatedAt', 'createdAt'],
      allowedFilterFields: ['assetKind', 'category', 'productFamily', 'managementMethod', 'health', 'status', 'tag'],
      maxPageSize: 200,
    });
    const subject = this.subjectFromRequest(request);
    const hostAllowed = await this.canPermission(subject, 'host.read', 'host', request);
    const serviceAllowed = await this.canPermission(subject, 'service_asset.read', 'service_asset', request)
      || await this.canPermission(subject, 'application.read', 'service_asset', request);
    const hostManageAllowed = await this.canPermission(subject, 'host.update', 'host', request);
    const serviceManageAllowed = await this.canPermission(subject, 'service_asset.manage', 'service_asset', request)
      || await this.canPermission(subject, 'application.update', 'service_asset', request);
    if (!hostAllowed && !serviceAllowed) {
      await this.assertCan(subject, 'host.read', 'host', request);
    }

    const items: Array<Record<string, unknown>> = [];
    if (hostAllowed && this.devices) {
      const deviceQuery = {
        page: 1,
        pageSize: 5000,
        filter: pickDeviceFilters(query.filter),
        ...(query.sort ? { sort: query.sort } : {}),
        authorizedHostIds: (await this.authorizedQuery(subject, 'host', 'read', query)).authorization?.objectIds,
      } as Parameters<DevicesApplicationService['list']>[1];
      const devicePage = await this.devices.list(tenantId(request), deviceQuery);
      for (const device of devicePage.items) items.push(projectDeviceAsset(device, hostManageAllowed));
    }
    if (serviceAllowed) {
      const serviceQuery = await this.authorizedQuery(subject, 'service_asset', 'read', {
        ...query,
        page: 1,
        pageSize: 5000,
        filter: { ...query.filter, assetKind: 'CLOUD_SERVICE' },
      });
      const servicePage = await this.service.listServiceAssets(tenantId(request), serviceQuery);
      for (const asset of servicePage.items) {
        const projected = projectServiceAsset(asset, serviceManageAllowed);
        if (matchesUnifiedAssetFilter(projected, query.filter)) items.push(projected);
      }
    }
    items.sort((left, right) => compareUnifiedAssets(left, right, query.sort));
    const start = (query.page - 1) * query.pageSize;
    return {
      items: items.slice(start, start + query.pageSize),
      page: query.page,
      pageSize: query.pageSize,
      total: items.length,
    };
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

  private async createFrameworkInstance(request: HttpRequest) {
    const body = validateObject(request.body, {
      deviceId: { type: 'string' },
      assetId: { type: 'string' },
      frameworkType: { type: 'string', required: true },
      frameworkKey: { type: 'string', required: true },
      discoveryProviderKey: { type: 'string', required: true },
      displayName: { type: 'string', required: true },
      frameworkVersion: { type: 'string' },
      discoverySource: { type: 'string', enum: assetsEnumValues.discoverySources },
      lastDiscoveredAt: { type: 'string' },
      status: { type: 'string', enum: assetsEnumValues.serviceInstanceStatuses },
      rawFacts: { type: 'object' },
    });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'service_instance.manage', 'service_instance', request);
    return this.service.createFrameworkInstance(tenantId(request), body as unknown as CreateFrameworkInstanceDto).then((created) => {
      this.audit(request, subject, 'service_instance.created', 'service_instance.manage', 'service_instance', created.id, undefined, created);
      return { statusCode: 201, body: created };
    });
  }

  private async listFrameworkInstances(request: HttpRequest) {
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['displayName', 'frameworkType', 'createdAt', 'updatedAt', 'status', 'deviceId'],
      allowedFilterFields: ['deviceId', 'frameworkType', 'frameworkKey', 'discoveryProviderKey', 'displayName', 'status', 'discoverySource'],
    });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'service_instance.read', 'service_instance', request);
    return this.service.listFrameworkInstances(tenantId(request), await this.authorizedQuery(subject, 'service_instance', 'read', query));
  }

  private async updateFrameworkInstance(request: HttpRequest) {
    const body = validateObject(request.body, {
      id: { type: 'string', required: true },
      deviceId: { type: 'string' },
      assetId: { type: 'string' },
      frameworkType: { type: 'string' },
      frameworkKey: { type: 'string' },
      discoveryProviderKey: { type: 'string' },
      displayName: { type: 'string' },
      frameworkVersion: { type: 'string' },
      discoverySource: { type: 'string', enum: assetsEnumValues.discoverySources },
      lastDiscoveredAt: { type: 'string' },
      status: { type: 'string', enum: assetsEnumValues.serviceInstanceStatuses },
      rawFacts: { type: 'object' },
    });
    const { id, ...patch } = body as unknown as UpdateFrameworkInstanceDto & { id: string };
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'service_instance.manage', 'service_instance', request, id);
    return this.service.getRepository().getFrameworkInstance(tenantId(request), id).then((before) =>
      this.service.updateFrameworkInstance(tenantId(request), id, patch).then((updated) => {
        this.audit(request, subject, 'service_instance.updated', 'service_instance.manage', 'service_instance', id, before, updated);
        return updated;
      }),
    );
  }

  private async deleteFrameworkInstance(request: HttpRequest) {
    const body = validateObject(request.body, { id: { type: 'string', required: true } });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'service_instance.manage', 'service_instance', request, String(body.id));
    return this.service.getRepository().getFrameworkInstance(tenantId(request), String(body.id)).then((before) =>
      this.service.deleteFrameworkInstance(tenantId(request), String(body.id)).then((deleted) => {
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
      deploymentStrategy: { type: 'object' },
      targetBinding: { type: 'object' },
      siteAssetId: { type: 'string' },
    });
    const subject = this.subjectFromRequest(request);
    // 创建是租户级能力，不应因拥有某个已有应用的编辑权而放大到新增应用。
    await this.assertApplicationCreate(subject, request);
    return this.service.createServiceAsset(tenantId(request), body as unknown as CreateServiceAssetDto).then((created) => {
      this.audit(request, subject, 'service_asset.created', 'application.create', 'service_asset', created.id, undefined, created);
      return { statusCode: 201, body: created };
    });
  }

  private async listServiceAssets(request: HttpRequest, forcedAssetKind?: 'APPLICATION' | 'CLOUD_SERVICE') {
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['address', 'port', 'protocol', 'createdAt', 'updatedAt', 'status', 'serviceInstanceId', 'hostId'],
      allowedFilterFields: ['id', 'address', 'addressType', 'port', 'protocol', 'sniName', 'serviceInstanceId', 'serviceEndpointId', 'hostId', 'environment', 'discoverySource', 'status', 'assetKind', 'tag'],
    });
    const scopedQuery = forcedAssetKind
      ? { ...query, filter: { ...query.filter, assetKind: forcedAssetKind } }
      : query;
    const subject = this.subjectFromRequest(request);
    const authorized = await this.authorizedQuery(subject, 'service_asset', 'read', scopedQuery);
    if (!hasAuthorizedReadScope(authorized.authorization) && !await this.canReadObject(subject, 'application.read', 'service_asset', request)) {
      await this.assertCan(subject, 'application.read', 'service_asset', request);
    }
    return this.service.listServiceAssets(tenantId(request), authorized);
  }

  private async getServiceAssetDetail(request: HttpRequest) {
    const serviceAssetId = String(request.query.serviceAssetId ?? request.query.id ?? '').trim();
    if (!serviceAssetId) throw new AppError('VALIDATION_FAILED', 'serviceAssetId 不能为空', { field: 'serviceAssetId' });
    const subject = this.subjectFromRequest(request);
    if (!await this.canReadObject(subject, 'application.read', 'service_asset', request, serviceAssetId, true)) {
      await this.assertCan(subject, 'application.read', 'service_asset', request, serviceAssetId);
    }
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
      deploymentStrategy: { type: 'object' },
      targetBinding: { type: 'object' },
    });
    const { id, ...patch } = body as unknown as UpdateServiceAssetDto & { id: string };
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'service_asset.manage', 'service_asset', request, id);
    return this.service.getRepository().getServiceAsset(tenantId(request), id).then((before) =>
      this.service.updateServiceAsset(tenantId(request), id, patch, subject.id).then((updated) => {
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
    await this.assertCan(subject, 'application.update', 'service_asset', request, serviceAssetId);
    return this.service.getRepository().getServiceAsset(tenantId(request), serviceAssetId).then((before) =>
      this.service.updateServiceAssetDeploymentStrategy(tenantId(request), serviceAssetId, body.deploymentStrategy as DeploymentStrategyDto, subject?.id).then((updated) => {
        this.audit(request, subject, 'service_asset.deployment_strategy.updated', 'application.update', 'service_asset', serviceAssetId, before, updated);
        return updated;
      }),
    );
  }

  private async getApplicationDetail(request: HttpRequest) {
    const applicationId = String(request.query.applicationId ?? request.query.id ?? '').trim();
    if (!applicationId) throw new AppError('VALIDATION_FAILED', 'applicationId 不能为空', { field: 'applicationId' });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'application.read', 'service_asset', request, applicationId);
    return this.service.getServiceAssetDetail(tenantId(request), applicationId).then((detail) => {
      if (!detail) throw new AppError('RESOURCE_NOT_FOUND', 'Application 不存在', { applicationId });
      return this.executionCompatibility
        ? this.executionCompatibility.getForApplication(tenantId(request), applicationId).then((executionCompatibility) => ({ ...detail, executionCompatibility }))
        : detail;
    });
  }

  private async getApplicationEditDetail(request: HttpRequest) {
    const applicationId = String(request.query.applicationId ?? request.query.id ?? '').trim();
    if (!applicationId) throw new AppError('VALIDATION_FAILED', 'applicationId 不能为空', { field: 'applicationId' });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'application.read', 'service_asset', request, applicationId);
    return this.service.getServiceAssetEditDetail(tenantId(request), applicationId).then((detail) => {
      if (!detail) throw new AppError('RESOURCE_NOT_FOUND', 'Application 不存在', { applicationId });
      return detail;
    });
  }

  private async getLinkageStatus(request: HttpRequest) {
    const applicationAssetId = readPathId(request, 'applicationAssetId');
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'application.read', 'service_asset', request, applicationAssetId);
    return this.service.getApplicationAssetLinkageStatus(tenantId(request), applicationAssetId);
  }

  private async rescanApplicationAsset(request: HttpRequest) {
    const applicationAssetId = readPathId(request, 'applicationAssetId');
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'application.asset.rescan', 'service_asset', request, applicationAssetId);
    return {
      statusCode: 202,
      body: await this.service.rescanApplicationAsset(tenantId(request), applicationAssetId, subject.id),
    };
  }

  private async repairLinkage(request: HttpRequest) {
    const applicationAssetId = readPathId(request, 'applicationAssetId');
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'application.update', 'service_asset', request, applicationAssetId);
    return this.service.repairApplicationAssetLinkage(tenantId(request), applicationAssetId);
  }

  private saveStandaloneWorkflowExecution(request: HttpRequest) {
    if (!this.executionService) throw new AppError('SYSTEM_INTERNAL_ERROR', 'ApplicationAssetExecutionService 未接入');
    const applicationAssetId = request.path.match(/^\/api\/v1\/application-assets\/([^/]+)\/standalone-workflow$/)?.[1];
    if (!applicationAssetId) throw new AppError('VALIDATION_FAILED', '非受管工作流路径无效');
    const body = validateObject(request.body, { workflowExecution: { type: 'object', required: true }, expectedAssetVersion: { type: 'number' } }) as unknown as SaveStandaloneWorkflowExecutionInput;
    return this.executionService.saveStandaloneWorkflowExecution(tenantId(request), decodeURIComponent(applicationAssetId), body);
  }

  private async getExecutionCompatibility(request: HttpRequest) {
    if (!this.executionCompatibility) throw new AppError('SYSTEM_INTERNAL_ERROR', '应用执行兼容性服务未接入');
    const applicationAssetId = readPathId(request, 'applicationAssetId');
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'application.read', 'service_asset', request, applicationAssetId);
    return { items: await this.executionCompatibility.getForApplication(tenantId(request), applicationAssetId) };
  }

  private async recheckExecutionCompatibility(request: HttpRequest) {
    if (!this.executionCompatibility) throw new AppError('SYSTEM_INTERNAL_ERROR', '应用执行兼容性服务未接入');
    const applicationAssetId = readPathId(request, 'applicationAssetId');
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'application.update', 'service_asset', request, applicationAssetId);
    return { items: await this.executionCompatibility.recheckApplication(tenantId(request), applicationAssetId) };
  }

  private async deleteServiceAsset(request: HttpRequest) {
    const body = validateObject(request.body, { id: { type: 'string', required: true } });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'application.update', 'service_asset', request, String(body.id));
    return this.service.getRepository().getServiceAsset(tenantId(request), String(body.id)).then((before) =>
      this.service.deleteServiceAsset(tenantId(request), String(body.id)).then((deleted) => {
        this.audit(request, subject, 'service_asset.deleted', 'application.update', 'service_asset', String(body.id), before, deleted);
        return deleted;
      }),
    );
  }

  private async listApplicationAssetTargets(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    await this.assertCanAsync(subject, 'application.read', 'service_asset', request);
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['createdAt', 'updatedAt', 'status', 'applicationAssetId', 'managedTargetId', 'siteAssetId'],
      allowedFilterFields: ['id', 'applicationAssetId', 'managedTargetId', 'status'],
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
    await this.assertCanAsync(subject, 'application.update', 'service_asset', request, String(body.applicationAssetId));
    const enriched = await this.enrichApplicationAssetTargetInput(tenantId(request), body);
    return { statusCode: 201, body: await this.service.getRepository().createApplicationAssetTarget(tenantId(request), enriched as any) };
  }

  private async updateApplicationAssetTarget(request: HttpRequest) {
    const body = this.readApplicationAssetTargetBody(request, false);
    const id = String(body.id);
    const subject = this.subjectFromRequest(request);
    await this.assertCanAsync(subject, 'application.update', 'service_asset', request, id);
    const { id: _id, ...patch } = body;
    void _id;
    return { statusCode: 200, body: await this.service.getRepository().updateApplicationAssetTarget(tenantId(request), id, patch as any) };
  }

  private async deleteApplicationAssetTarget(request: HttpRequest) {
    const body = validateObject(request.body, { id: { type: 'string', required: true } });
    const subject = this.subjectFromRequest(request);
    await this.assertCanAsync(subject, 'application.update', 'service_asset', request, String(body.id));
    return { statusCode: 200, body: await this.service.getRepository().deleteApplicationAssetTarget(tenantId(request), String(body.id)) };
  }

  private readApplicationAssetTargetBody(request: HttpRequest, creating: boolean): Record<string, unknown> {
    const body = validateObject(request.body, {
      id: { type: 'string', required: !creating },
      applicationAssetId: { type: 'string' },
      applicationId: { type: 'string' },
      managedTargetId: { type: 'string', required: creating },
      status: { type: 'string', enum: assetsEnumValues.applicationAssetTargetStatuses },
      metadata: { type: 'object' },
    });
    const applicationAssetId = body.applicationAssetId ?? body.applicationId;
    if (creating && (typeof applicationAssetId !== 'string' || applicationAssetId.trim() === '')) {
      throw new AppError('VALIDATION_FAILED', 'applicationId 不能为空', { field: 'applicationId' });
    }
    return { ...body, applicationAssetId };
  }

  private async enrichApplicationAssetTargetInput(tenantIdValue: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const managedTargetId = String(body.managedTargetId);
    const managedTarget = await this.service.getRepository().getManagedTarget(tenantIdValue, managedTargetId);
    if (!managedTarget) throw new AppError('RESOURCE_NOT_FOUND', 'ManagedTarget 不存在', { managedTargetId });
    return body;
  }

  private async createSiteAsset(request: HttpRequest) {
    const body = validateObject(request.body, {
      frameworkInstanceId: { type: 'string', required: true },
      deviceId: { type: 'string' },
      assetId: { type: 'string' },
      serviceAssetId: { type: 'string' },
      discoveryProviderKey: { type: 'string', required: true },
      siteType: { type: 'string', required: true },
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
      allowedSortFields: ['siteName', 'siteKey', 'discoveryProviderKey', 'port', 'createdAt', 'updatedAt', 'status', 'frameworkInstanceId', 'deviceId'],
      allowedFilterFields: ['id', 'frameworkInstanceId', 'deviceId', 'discoveryProviderKey', 'siteType', 'siteName', 'siteKey', 'hostHeader', 'port', 'protocol', 'status', 'discoverySource'],
    });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'site_asset.read', 'site_asset', request);
    return this.service.listSiteAssets(tenantId(request), await this.authorizedQuery(subject, 'site_asset', 'read', query));
  }

  private async updateSiteAsset(request: HttpRequest) {
    const body = validateObject(request.body, {
      id: { type: 'string', required: true },
      frameworkInstanceId: { type: 'string' },
      deviceId: { type: 'string' },
      serviceAssetId: { type: 'string' },
      discoveryProviderKey: { type: 'string' },
      siteType: { type: 'string' },
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
      deviceId: { type: 'string' },
      assetId: { type: 'string' },
      serviceAssetId: { type: 'string' },
      frameworkInstanceId: { type: 'string' },
      siteId: { type: 'string' },
      discoveryProviderKey: { type: 'string', required: true },
      targetType: { type: 'string', required: true },
      targetKey: { type: 'string', required: true },
      bindingKey: { type: 'string' },
      supportedCapabilities: { type: 'array', required: true },
      executionLocations: { type: 'array', required: true },
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
      allowedSortFields: ['deviceId', 'frameworkInstanceId', 'siteId', 'discoveryProviderKey', 'targetType', 'targetKey', 'createdAt', 'updatedAt', 'status'],
      allowedFilterFields: ['id', 'deviceId', 'frameworkInstanceId', 'siteId', 'discoveryProviderKey', 'targetType', 'targetKey', 'bindingKey', 'status'],
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
      deviceId: { type: 'string' },
      assetId: { type: 'string' },
      serviceAssetId: { type: 'string' },
      frameworkInstanceId: { type: 'string' },
      siteId: { type: 'string' },
      discoveryProviderKey: { type: 'string' },
      targetType: { type: 'string' },
      targetKey: { type: 'string' },
      bindingKey: { type: 'string' },
      supportedCapabilities: { type: 'array' },
      executionLocations: { type: 'array' },
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

  private async refreshFromAgent(request: HttpRequest) {
    const body = validateObject(request.body, {
      agentId: { type: 'string', required: true },
      providerTypes: { type: 'array' },
      includeBindings: { type: 'boolean' },
      requestId: { type: 'string' },
    });
    const subject = this.subjectFromRequest(request);
    await this.assertCan(subject, 'discovery.manage', 'discovery_snapshot', request);
    return this.service.refreshAssetsFromAgent(tenantId(request), body as unknown as RefreshAssetsFromAgentDto, subject.id).then((result) => {
      this.audit(request, subject, 'discovery_snapshot.agent_refreshed', 'discovery.manage', 'discovery_snapshot', result.capabilitySnapshotId ?? result.requestId, undefined, result);
      return { statusCode: 200, body: result };
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
    if (!this.security) return { id: request.context.actorId ?? 'system_assets', type: 'system', scope: { tenantId: request.context.tenantId, tenantScope: request.context.tenantScope } };
    if (!request.context.actorId) throw new AppError('AUTH_UNAUTHENTICATED', '缺少 actor 上下文');
    return { id: request.context.actorId, type: 'user', scope: { tenantId: request.context.tenantId, tenantScope: request.context.tenantScope } };
  }

  private async assertCan(subject: SecuritySubject, action: string, resourceType: string, request: HttpRequest, resourceId?: string): Promise<void> {
    if (!this.security) return;
    await this.security.rbac.assertCan(subject, action, {
      type: resourceType,
      id: resourceId,
      scope: { tenantId: request.context.tenantId, tenantScope: request.context.tenantScope, ownerId: subject.id },
    }, this.securityContext(request, subject));
  }

  private async assertApplicationCreate(subject: SecuritySubject, request: HttpRequest): Promise<void> {
    if (!this.security) return;
    const resource = {
      type: 'service_asset',
      scope: { tenantId: request.context.tenantId, tenantScope: request.context.tenantScope, ownerId: subject.id },
    };
    const context = this.securityContext(request, subject);
    const current = await this.security.rbac.can(subject, 'application.create', resource, context);
    if (current.allowed) return;
    // 仅为历史显式技术策略保留兼容回退；业务应用管理授权的 resolver 结果不构成创建权限。
    if (current.reason === 'no allow policy') {
      const legacy = await this.security.rbac.can(subject, 'service_asset.manage', resource, context);
      if (legacy.allowed && legacy.reason === 'allow' && legacy.matchedPolicyIds.length > 0) return;
    }
    await this.security.rbac.assertCan(subject, 'application.create', resource, context);
  }

  private async assertCanAsync(subject: SecuritySubject, action: string, resourceType: string, request: HttpRequest, resourceId?: string): Promise<void> {
    if (!this.security) return;
    await this.security.rbac.assertCan(subject, action, {
      type: resourceType,
      id: resourceId,
      scope: { tenantId: request.context.tenantId, tenantScope: request.context.tenantScope, ownerId: subject.id },
    }, this.securityContext(request, subject));
  }

  private async authorizedQuery(subject: SecuritySubject, objectType: string, accessLevel: 'read' | 'edit' | 'control', query: PageQuery): Promise<PageQuery> {
    if (!this.security) return query;
    return withAuthorization(query, await this.security.objectPermissions.buildAuthorizedQuery(subject, objectType, accessLevel));
  }

  private async canPermission(subject: SecuritySubject, action: string, resourceType: string, request: HttpRequest): Promise<boolean> {
    if (!this.security) return true;
    return (await this.security.rbac.can(subject, action, {
      type: resourceType,
      scope: { tenantId: request.context.tenantId, tenantScope: request.context.tenantScope, ownerId: subject.id },
    }, this.securityContext(request, subject))).allowed;
  }

  private async canReadObject(
    subject: SecuritySubject,
    action: string,
    objectType: string,
    request: HttpRequest,
    objectId?: string,
    requireObjectMatch = false,
  ): Promise<boolean> {
    if (!this.security) return true;
    if (objectId) {
      const objectAllowed = await this.security.objectPermissions.isAllowed(subject, 'read', {
        objectType,
        objectId,
        tenantId: request.context.tenantId,
      });
      if (objectAllowed) return true;
      if (requireObjectMatch) return false;
    }
    const decision = await this.security.rbac.can(subject, action, {
      type: objectType,
      id: objectId,
      scope: { tenantId: request.context.tenantId, tenantScope: request.context.tenantScope, ownerId: subject.id },
    }, this.securityContext(request, subject));
    return decision.allowed;
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

function pickDeviceFilters(filter: Record<string, string>): Record<string, string> {
  const allowed = ['category', 'productFamily', 'managementMethod', 'health'] as const;
  return Object.fromEntries(allowed.flatMap((key) => filter[key] ? [[key, filter[key]]] : []));
}

function projectDeviceAsset(device: ManagedDeviceSummaryDto, canManage: boolean): Record<string, unknown> {
  return {
    ...device,
    assetKind: 'DEVICE',
    assetRef: { rootType: 'DEVICE', id: device.id },
    availableActions: canManage ? ['VIEW', 'EDIT', 'DELETE'] : ['VIEW'],
  };
}

function projectServiceAsset(asset: Record<string, unknown>, canManage: boolean): Record<string, unknown> {
  return {
    ...asset,
    assetKind: 'CLOUD_SERVICE',
    category: 'CLOUD',
    managementMethod: 'PLUGIN',
    managementAddress: asset.address,
    livenessStatus: String(asset.status ?? '').toUpperCase() === 'ACTIVE' ? 'ONLINE' : 'UNKNOWN',
    health: String(asset.status ?? '').toUpperCase() === 'ACTIVE' ? 'HEALTHY' : 'UNKNOWN',
    assetRef: { rootType: 'SERVICE_ASSET', id: String(asset.id) },
    availableActions: canManage ? ['VIEW', 'EDIT', 'DELETE'] : ['VIEW'],
  };
}

function matchesUnifiedAssetFilter(asset: Record<string, unknown>, filter: Record<string, string>): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === 'assetKind') return String(asset.assetKind).toUpperCase() === expected.toUpperCase() || expected.toUpperCase() === 'ALL';
    if (key === 'category' || key === 'productFamily' || key === 'managementMethod' || key === 'health' || key === 'status') {
      return String(asset[key] ?? '').toUpperCase() === expected.toUpperCase();
    }
    if (key === 'tag') return Array.isArray(asset.tags) && asset.tags.map(String).includes(expected);
    return true;
  });
}

function compareUnifiedAssets(left: Record<string, unknown>, right: Record<string, unknown>, sort?: { field: string; direction: 'asc' | 'desc' }): number {
  const field = sort?.field ?? 'displayName';
  const direction = sort?.direction === 'desc' ? -1 : 1;
  const leftValue = String(left[field] ?? left.displayName ?? left.id).toLocaleLowerCase();
  const rightValue = String(right[field] ?? right.displayName ?? right.id).toLocaleLowerCase();
  return leftValue.localeCompare(rightValue) * direction;
}

function tenantId(request: HttpRequest): string {
  return requireTenantId(request);
}

function hasAuthorizedReadScope(authorization: PageQuery['authorization']): boolean {
  if (!authorization) return false;
  if (authorization.unrestricted) return true;
  if ((authorization.objectIds?.length ?? 0) > 0) return true;
  return (authorization.dynamicConditions?.length ?? 0) > 0;
}

function readServiceAssetId(request: HttpRequest, bodyId?: unknown): string {
  const pathId = request.path.match(/^\/api\/v1\/service-assets\/([^/]+)\/deployment-strategy$/)?.[1];
  const id = bodyId ?? request.query.id ?? request.query.serviceAssetId ?? pathId;
  if (Array.isArray(id) || typeof id !== 'string' || id.trim() === '') {
    throw new AppError('VALIDATION_FAILED', 'serviceAssetId 不能为空', { field: 'serviceAssetId' });
  }
  return id.trim();
}

function readPathId(request: HttpRequest, name: string): string {
  const match = request.path.match(new RegExp(`/api/v1/applications/([^/]+)/${name === 'applicationAssetId' ? '(?:linkage-status|rescan|linkage-repair)' : name}$`));
  const value = match?.[1]?.trim();
  if (!value) throw new AppError('VALIDATION_FAILED', '应用资产 ID 无效', { field: name });
  return decodeURIComponent(value);
}

export function getAssetsRouteContracts(): RouteContract[] {
  return [
    { method: 'GET', path: '/api/v1/assets', operationId: 'listAssets', summary: '查询统一资产入口', tags, responseSchema: pageSchema() },
    { method: 'GET', path: '/api/v1/applications', operationId: 'listApplications', summary: '查询 Application 列表', tags, responseSchema: pageSchema() },
    { method: 'GET', path: '/api/v1/applications/edit-detail', operationId: 'getApplicationEditDetail', summary: '查询 Application 编辑详情', tags, responseSchema: objectSchema() },
    { method: 'GET', path: '/api/v1/applications/detail', operationId: 'getApplicationDetail', summary: '查询 Application 详情', tags, responseSchema: objectSchema() },
    { method: 'GET', path: '/api/v1/applications/:applicationAssetId/linkage-status', operationId: 'getApplicationAssetLinkageStatus', summary: '查询插件 Agent 联动状态', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/applications/:applicationAssetId/rescan', operationId: 'rescanApplicationAsset', summary: '重扫应用关联资产', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/applications/:applicationAssetId/linkage-repair', operationId: 'repairApplicationAssetLinkage', summary: '修复插件 Agent 联动状态', tags, requestSchema: objectSchema(), responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/applications', operationId: 'createApplication', summary: '创建 Application', tags, responseSchema: objectSchema() },
    { method: 'PATCH', path: '/api/v1/applications', operationId: 'updateApplication', summary: '更新 Application', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/applications/delete', operationId: 'deleteApplication', summary: '删除 Application', tags, responseSchema: objectSchema() },
    { method: 'GET', path: '/api/v1/hosts', operationId: 'listHosts', summary: '查询 Host 列表', tags, responseSchema: pageSchema() },
    { method: 'POST', path: '/api/v1/hosts', operationId: 'createHost', summary: '创建 Host', tags, responseSchema: objectSchema() },
    { method: 'PATCH', path: '/api/v1/hosts', operationId: 'updateHost', summary: '更新 Host', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/hosts/delete', operationId: 'deleteHost', summary: '软删除 Host', tags, responseSchema: objectSchema() },
    { method: 'GET', path: '/api/v1/framework-instances', operationId: 'listFrameworkInstances', summary: '查询 ServiceInstance 列表', tags, responseSchema: pageSchema() },
    { method: 'POST', path: '/api/v1/framework-instances', operationId: 'createFrameworkInstance', summary: '创建 ServiceInstance', tags, responseSchema: objectSchema() },
    { method: 'PATCH', path: '/api/v1/framework-instances', operationId: 'updateFrameworkInstance', summary: '更新 ServiceInstance', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/framework-instances/delete', operationId: 'deleteFrameworkInstance', summary: '软删除 ServiceInstance', tags, responseSchema: objectSchema() },
    { method: 'GET', path: '/api/v1/service-assets', operationId: 'listServiceAssets', summary: '查询 ServiceAsset 列表', tags, responseSchema: pageSchema() },
    { method: 'GET', path: '/api/v1/service-assets/detail', operationId: 'getServiceAssetDetail', summary: '查询 ServiceAsset 详情', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/service-assets', operationId: 'createServiceAsset', summary: '创建 ServiceAsset', tags, responseSchema: objectSchema() },
    { method: 'PATCH', path: '/api/v1/service-assets', operationId: 'updateServiceAsset', summary: '更新 ServiceAsset', tags, responseSchema: objectSchema() },
    { method: 'PATCH', path: '/api/v1/service-assets/:id/deployment-strategy', operationId: 'updateServiceAssetDeploymentStrategyById', summary: '按 ID 更新 ServiceAsset 证书部署策略', tags, responseSchema: objectSchema() },
    { method: 'PATCH', path: '/api/v1/service-assets/deployment-strategy', operationId: 'updateServiceAssetDeploymentStrategy', summary: '更新 ServiceAsset 证书部署策略', tags, responseSchema: objectSchema() },
    { method: 'PUT', path: '/api/v1/application-assets/:applicationAssetId/standalone-workflow', operationId: 'saveStandaloneWorkflowExecution', summary: '保存非受管工作流执行配置', tags, responseSchema: objectSchema() },
    { method: 'GET', path: '/api/v1/application-assets/:applicationAssetId/execution-compatibility', operationId: 'getApplicationExecutionCompatibility', summary: '读取应用执行兼容性', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/application-assets/:applicationAssetId/execution-compatibility/recheck', operationId: 'recheckApplicationExecutionCompatibility', summary: '重新检查应用执行兼容性', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/service-assets/delete', operationId: 'deleteServiceAsset', summary: '软删除 ServiceAsset', tags, responseSchema: objectSchema() },
    { method: 'GET', path: '/api/v1/application-asset-targets', operationId: 'listApplicationAssetTargets', summary: '查询 ApplicationAssetTarget 列表', tags, responseSchema: pageSchema() },
    { method: 'GET', path: '/api/v1/application-targets', operationId: 'listApplicationTargets', summary: '查询 ApplicationTarget 列表', tags, responseSchema: pageSchema() },
    { method: 'POST', path: '/api/v1/application-asset-targets', operationId: 'createApplicationAssetTarget', summary: '创建 ApplicationAssetTarget', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/application-targets', operationId: 'createApplicationTarget', summary: '创建 ApplicationTarget', tags, responseSchema: objectSchema() },
    { method: 'PATCH', path: '/api/v1/application-asset-targets', operationId: 'updateApplicationAssetTarget', summary: '更新 ApplicationAssetTarget', tags, responseSchema: objectSchema() },
    { method: 'PATCH', path: '/api/v1/application-targets', operationId: 'updateApplicationTarget', summary: '更新 ApplicationTarget', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/application-asset-targets/delete', operationId: 'deleteApplicationAssetTarget', summary: '软删除 ApplicationAssetTarget', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/application-targets/delete', operationId: 'deleteApplicationTarget', summary: '删除 ApplicationTarget', tags, responseSchema: objectSchema() },
    { method: 'GET', path: '/api/v1/site-assets', operationId: 'listSiteAssets', summary: '查询 SiteAsset 列表', tags, responseSchema: pageSchema() },
    {
      method: 'POST',
      path: '/api/v1/site-assets',
      operationId: 'createSiteAsset',
      summary: '创建 SiteAsset',
      tags,
      requestSchema: siteAssetCreateRequestSchema(),
      responseSchema: siteAssetSchema(),
    },
    {
      method: 'PATCH',
      path: '/api/v1/site-assets',
      operationId: 'updateSiteAsset',
      summary: '更新 SiteAsset',
      tags,
      requestSchema: siteAssetUpdateRequestSchema(),
      responseSchema: siteAssetSchema(),
    },
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

function siteAssetSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'tenantId', 'frameworkInstanceId', 'discoveryProviderKey', 'siteType', 'siteName', 'siteKey', 'discoverySource', 'status', 'metadata', 'createdAt', 'updatedAt', 'version'],
    properties: {
      id: { type: 'string' },
      tenantId: { type: 'string' },
      assetId: { type: 'string' },
      serviceAssetId: { type: 'string' },
      frameworkInstanceId: { type: 'string' },
      deviceId: { type: 'string' },
      discoveryProviderKey: { type: 'string' },
      siteType: { type: 'string' },
      siteName: { type: 'string' },
      siteKey: { type: 'string' },
      bindingInformation: { type: 'string' },
      hostHeader: { type: 'string' },
      listenIp: { type: 'string' },
      port: { type: 'number' },
      protocol: { type: 'string' },
      // Tomcat 等 KeyStore 部署需要读取目标服务的本机配置密码；这里只返回路径，绝不返回密码。
      configPath: { type: 'string', description: '目标服务配置文件路径；仅用于 Agent 在目标机读取本机密码，不承载密码本身。' },
      runtimeStatus: { type: 'string' },
      discoverySource: { type: 'string' },
      lastDiscoveredAt: { type: 'string' },
      status: { type: 'string' },
      metadata: { type: 'object', additionalProperties: true },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
      deletedAt: { type: 'string' },
      version: { type: 'number' },
    },
  };
}

function siteAssetCreateRequestSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['frameworkInstanceId', 'discoveryProviderKey', 'siteType', 'siteName', 'siteKey'],
    properties: {
      frameworkInstanceId: { type: 'string' },
      deviceId: { type: 'string' },
      assetId: { type: 'string' },
      serviceAssetId: { type: 'string' },
      discoveryProviderKey: { type: 'string' },
      siteType: { type: 'string' },
      siteName: { type: 'string' },
      siteKey: { type: 'string' },
      bindingInformation: { type: 'string' },
      hostHeader: { type: 'string' },
      listenIp: { type: 'string' },
      port: { type: 'number' },
      protocol: { type: 'string' },
      configPath: { type: 'string', description: '目标服务配置文件路径；仅用于 Agent 在目标机读取本机密码，不承载密码本身。' },
      runtimeStatus: { type: 'string' },
      discoverySource: { type: 'string' },
      lastDiscoveredAt: { type: 'string', format: 'date-time' },
      status: { type: 'string' },
      metadata: { type: 'object', additionalProperties: true },
    },
  };
}

function siteAssetUpdateRequestSchema() {
  const schema = siteAssetCreateRequestSchema();
  return {
    ...schema,
    required: ['id'],
    properties: { id: { type: 'string' }, ...schema.properties },
  };
}
