import { AppError } from '../../../common/errors/app-error.js';
import { parsePageQuery } from '../../../common/pagination/pagination.js';
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
  IngestDiscoveryDto,
  PreviewDiscoveryMergeDto,
  ResolveAssetConflictDto,
  CreateServiceEndpointDto,
  CreateServiceInstanceDto,
  UpdateHostDto,
  UpdateServiceEndpointDto,
  UpdateServiceInstanceDto,
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
    router.get('/api/v1/service-endpoints', '查询 ServiceEndpoint 列表', tags, (request) => this.listServiceEndpoints(request));
    router.post('/api/v1/service-endpoints', '创建 ServiceEndpoint', tags, (request) => this.createServiceEndpoint(request));
    router.patch('/api/v1/service-endpoints', '更新 ServiceEndpoint', tags, (request) => this.updateServiceEndpoint(request));
    router.post('/api/v1/service-endpoints/delete', '软删除 ServiceEndpoint', tags, (request) => this.deleteServiceEndpoint(request));
    router.get('/api/v1/discovery-snapshots', '查询发现快照', tags, (request) => this.listDiscoverySnapshots(request));
    router.post('/api/v1/discovery-snapshots', '写入发现快照', tags, (request) => this.upsertDiscoverySnapshot(request));
    router.post('/api/v1/discovery-snapshots/ingest', '入库发现结果', tags, (request) => this.ingestDiscovery(request));
    router.post('/api/v1/discovery-snapshots/merge-preview', '预览发现结果合并', tags, (request) => this.previewDiscoveryMerge(request));
    router.get('/api/v1/asset-conflicts', '查询资产冲突', tags, (request) => this.listAssetConflicts(request));
    router.post('/api/v1/asset-conflicts/resolve', '解决资产冲突', tags, (request) => this.resolveAssetConflict(request));
  }

  getApplicationService(): AssetsApplicationService {
    return this.service;
  }

  private createHost(request: HttpRequest) {
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
    this.assertCan(subject, 'host.create', 'host', request);
    const created = this.service.createHost(tenantId(request), body as unknown as CreateHostDto);
    this.audit(request, subject, 'host.created', 'host.create', 'host', created.id, undefined, created);
    return { statusCode: 201, body: created };
  }

  private listHosts(request: HttpRequest) {
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['hostname', 'createdAt', 'updatedAt', 'status', 'environment', 'osType'],
      allowedFilterFields: ['hostname', 'primaryIp', 'osType', 'environment', 'zoneId', 'ownerId', 'discoverySource', 'agentId', 'assetFingerprint', 'status', 'tag'],
    });
    const subject = this.subjectFromRequest(request);
    this.assertCan(subject, 'host.read', 'host', request);
    return this.service.listHosts(tenantId(request), query);
  }

  private updateHost(request: HttpRequest) {
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
    this.assertCan(subject, 'host.update', 'host', request, id);
    const before = this.service.getRepository().getHost(tenantId(request), id);
    const updated = this.service.updateHost(tenantId(request), id, patch);
    this.audit(request, subject, 'host.updated', 'host.update', 'host', id, before, updated);
    return updated;
  }

  private deleteHost(request: HttpRequest) {
    const body = validateObject(request.body, { id: { type: 'string', required: true } });
    const subject = this.subjectFromRequest(request);
    this.assertCan(subject, 'host.delete', 'host', request, String(body.id));
    const before = this.service.getRepository().getHost(tenantId(request), String(body.id));
    const deleted = this.service.deleteHost(tenantId(request), String(body.id));
    this.audit(request, subject, 'host.deleted', 'host.delete', 'host', String(body.id), before, deleted);
    return deleted;
  }

  private createServiceInstance(request: HttpRequest) {
    const body = validateObject(request.body, {
      hostId: { type: 'string', required: true },
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
    this.assertCan(subject, 'service_instance.manage', 'service_instance', request);
    const created = this.service.createServiceInstance(tenantId(request), body as unknown as CreateServiceInstanceDto);
    this.audit(request, subject, 'service_instance.created', 'service_instance.manage', 'service_instance', created.id, undefined, created);
    return { statusCode: 201, body: created };
  }

  private listServiceInstances(request: HttpRequest) {
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['displayName', 'providerType', 'createdAt', 'updatedAt', 'status', 'hostId'],
      allowedFilterFields: ['hostId', 'providerType', 'serviceName', 'displayName', 'providerKey', 'status', 'discoverySource'],
    });
    const subject = this.subjectFromRequest(request);
    this.assertCan(subject, 'service_instance.read', 'service_instance', request);
    return this.service.listServiceInstances(tenantId(request), query);
  }

  private updateServiceInstance(request: HttpRequest) {
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
    this.assertCan(subject, 'service_instance.manage', 'service_instance', request, id);
    const before = this.service.getRepository().getServiceInstance(tenantId(request), id);
    const updated = this.service.updateServiceInstance(tenantId(request), id, patch);
    this.audit(request, subject, 'service_instance.updated', 'service_instance.manage', 'service_instance', id, before, updated);
    return updated;
  }

  private deleteServiceInstance(request: HttpRequest) {
    const body = validateObject(request.body, { id: { type: 'string', required: true } });
    const subject = this.subjectFromRequest(request);
    this.assertCan(subject, 'service_instance.manage', 'service_instance', request, String(body.id));
    const before = this.service.getRepository().getServiceInstance(tenantId(request), String(body.id));
    const deleted = this.service.deleteServiceInstance(tenantId(request), String(body.id));
    this.audit(request, subject, 'service_instance.deleted', 'service_instance.manage', 'service_instance', String(body.id), before, deleted);
    return deleted;
  }

  private createServiceEndpoint(request: HttpRequest) {
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
    this.assertCan(subject, 'service_instance.manage', 'service_endpoint', request);
    const created = this.service.createServiceEndpoint(tenantId(request), body as unknown as CreateServiceEndpointDto);
    this.audit(request, subject, 'service_endpoint.created', 'service_instance.manage', 'service_endpoint', created.id, undefined, created);
    return { statusCode: 201, body: created };
  }

  private listServiceEndpoints(request: HttpRequest) {
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['port', 'protocol', 'createdAt', 'updatedAt', 'status', 'serviceInstanceId', 'hostName'],
      allowedFilterFields: ['serviceInstanceId', 'hostId', 'protocol', 'hostName', 'listenIp', 'port', 'status'],
    });
    const subject = this.subjectFromRequest(request);
    this.assertCan(subject, 'service_instance.read', 'service_endpoint', request);
    return this.service.listServiceEndpoints(tenantId(request), query);
  }

  private updateServiceEndpoint(request: HttpRequest) {
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
    this.assertCan(subject, 'service_instance.manage', 'service_endpoint', request, id);
    const before = this.service.getRepository().getServiceEndpoint(tenantId(request), id);
    const updated = this.service.updateServiceEndpoint(tenantId(request), id, patch);
    this.audit(request, subject, 'service_endpoint.updated', 'service_instance.manage', 'service_endpoint', id, before, updated);
    return updated;
  }

  private deleteServiceEndpoint(request: HttpRequest) {
    const body = validateObject(request.body, { id: { type: 'string', required: true } });
    const subject = this.subjectFromRequest(request);
    this.assertCan(subject, 'service_instance.manage', 'service_endpoint', request, String(body.id));
    const before = this.service.getRepository().getServiceEndpoint(tenantId(request), String(body.id));
    const deleted = this.service.deleteServiceEndpoint(tenantId(request), String(body.id));
    this.audit(request, subject, 'service_endpoint.deleted', 'service_instance.manage', 'service_endpoint', String(body.id), before, deleted);
    return deleted;
  }

  private upsertDiscoverySnapshot(request: HttpRequest) {
    const body = validateObject(request.body, {
      normalizedHash: { type: 'string', required: true },
      source: { type: 'string', enum: assetsEnumValues.discoverySources },
      normalizedPayload: { type: 'object' },
      rawPayload: { type: 'object' },
    });
    const subject = this.subjectFromRequest(request);
    this.assertCan(subject, 'discovery.manage', 'discovery_snapshot', request);
    const created = this.service.upsertDiscoverySnapshot(tenantId(request), body as unknown as CreateDiscoverySnapshotDto);
    this.audit(request, subject, 'discovery_snapshot.upserted', 'discovery.manage', 'discovery_snapshot', created.id, undefined, created);
    return { statusCode: 201, body: created };
  }

  private listDiscoverySnapshots(request: HttpRequest) {
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['normalizedHash', 'source', 'createdAt', 'updatedAt'],
      allowedFilterFields: ['normalizedHash', 'source'],
    });
    const subject = this.subjectFromRequest(request);
    this.assertCan(subject, 'discovery.read', 'discovery_snapshot', request);
    return this.service.listDiscoverySnapshots(tenantId(request), query);
  }

  private previewDiscoveryMerge(request: HttpRequest) {
    const body = validateObject(request.body, {
      normalizedHash: { type: 'string', required: true },
      source: { type: 'string', enum: assetsEnumValues.discoverySources },
      normalizedPayload: { type: 'object' },
      rawPayload: { type: 'object' },
    });
    const subject = this.subjectFromRequest(request);
    this.assertCan(subject, 'discovery.read', 'discovery_snapshot', request);
    return { statusCode: 201, body: this.service.previewDiscoveryMerge(tenantId(request), body as unknown as PreviewDiscoveryMergeDto) };
  }

  private ingestDiscovery(request: HttpRequest) {
    const body = validateObject(request.body, {
      normalizedHash: { type: 'string', required: true },
      source: { type: 'string', enum: assetsEnumValues.discoverySources },
      normalizedPayload: { type: 'object' },
      rawPayload: { type: 'object' },
      apply: { type: 'boolean' },
    });
    const subject = this.subjectFromRequest(request);
    this.assertCan(subject, 'discovery.manage', 'discovery_snapshot', request);
    const result = this.service.ingestDiscovery(tenantId(request), body as unknown as IngestDiscoveryDto);
    this.audit(request, subject, 'discovery_snapshot.ingested', 'discovery.manage', 'discovery_snapshot', result.snapshot.id, undefined, result);
    return { statusCode: 201, body: result };
  }

  private listAssetConflicts(request: HttpRequest) {
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['resourceType', 'resourceId', 'field', 'status', 'createdAt', 'updatedAt', 'resolvedAt'],
      allowedFilterFields: ['id', 'resourceType', 'resourceId', 'field', 'status', 'sourceSnapshotId', 'resolvedBy'],
    });
    const subject = this.subjectFromRequest(request);
    this.assertCan(subject, 'asset_conflict.read', 'asset_conflict', request);
    return this.service.listAssetConflicts(tenantId(request), query);
  }

  private resolveAssetConflict(request: HttpRequest) {
    const body = validateObject(request.body, {
      id: { type: 'string', required: true },
      resolution: { type: 'string', required: true, enum: assetsEnumValues.conflictResolutions },
      comment: { type: 'string' },
    });
    const subject = this.subjectFromRequest(request);
    this.assertCan(subject, 'asset_conflict.resolve', 'asset_conflict', request, String(body.id));
    const result = this.service.resolveAssetConflict(tenantId(request), {
      ...(body as unknown as ResolveAssetConflictDto),
      resolvedBy: subject.id,
    });
    this.audit(request, subject, 'asset_conflict.resolved', 'asset_conflict.resolve', 'asset_conflict', result.conflict.id, undefined, result);
    return result;
  }

  private subjectFromRequest(request: HttpRequest): SecuritySubject {
    if (!this.security) return { id: request.context.actorId ?? 'system_assets', type: 'system', scope: { tenantId: request.context.tenantId } };
    if (!request.context.actorId) throw new AppError('AUTH_UNAUTHENTICATED', '缺少 actor 上下文');
    return { id: request.context.actorId, type: 'user', scope: { tenantId: request.context.tenantId } };
  }

  private assertCan(subject: SecuritySubject, action: string, resourceType: string, request: HttpRequest, resourceId?: string): void {
    if (!this.security) return;
    this.security.rbac.assertCan(subject, action, {
      type: resourceType,
      id: resourceId,
      scope: { tenantId: request.context.tenantId, ownerId: subject.id },
    }, this.securityContext(request, subject));
  }

  private audit(request: HttpRequest, subject: SecuritySubject, eventType: string, action: string, resourceType: string, resourceId: string | undefined, before: unknown, after: unknown): void {
    this.security?.audit.write({
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
    });
  }

  private securityContext(request: HttpRequest, actor: SecuritySubject) {
    return { requestId: request.context.requestId, sourceIp: request.context.ip, actor };
  }

}

function tenantId(request: HttpRequest): string {
  return request.context.tenantId ?? tenantFallback;
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
    { method: 'GET', path: '/api/v1/service-endpoints', operationId: 'listServiceEndpoints', summary: '查询 ServiceEndpoint 列表', tags, responseSchema: pageSchema() },
    { method: 'POST', path: '/api/v1/service-endpoints', operationId: 'createServiceEndpoint', summary: '创建 ServiceEndpoint', tags, responseSchema: objectSchema() },
    { method: 'PATCH', path: '/api/v1/service-endpoints', operationId: 'updateServiceEndpoint', summary: '更新 ServiceEndpoint', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/service-endpoints/delete', operationId: 'deleteServiceEndpoint', summary: '软删除 ServiceEndpoint', tags, responseSchema: objectSchema() },
    { method: 'GET', path: '/api/v1/discovery-snapshots', operationId: 'listDiscoverySnapshots', summary: '查询发现快照', tags, responseSchema: pageSchema() },
    { method: 'POST', path: '/api/v1/discovery-snapshots', operationId: 'upsertDiscoverySnapshot', summary: '写入发现快照', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/discovery-snapshots/ingest', operationId: 'ingestDiscovery', summary: '入库发现结果', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/discovery-snapshots/merge-preview', operationId: 'previewDiscoveryMerge', summary: '预览发现结果合并', tags, responseSchema: objectSchema() },
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
