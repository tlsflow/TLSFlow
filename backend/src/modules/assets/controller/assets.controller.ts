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
import { AssetsApplicationService } from '../application/assets.application-service.js';
import { assetsEnumValues } from '../domain/assets.domain-service.js';
import type {
  CreateDiscoverySnapshotDto,
  CreateHostDto,
  PreviewDiscoveryMergeDto,
  CreateServiceEndpointDto,
  CreateServiceInstanceDto,
  UpdateHostDto,
  UpdateServiceEndpointDto,
  UpdateServiceInstanceDto,
} from '../dto/assets.dto.js';

const tags = ['Assets'];
const tenantFallback = '00000000-0000-0000-0000-000000000000';

export class AssetsController {
  constructor(private readonly service = new AssetsApplicationService()) {}

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
    router.post('/api/v1/discovery-snapshots/merge-preview', '预览发现结果合并', tags, (request) => this.previewDiscoveryMerge(request));
  }

  getApplicationService(): AssetsApplicationService {
    return this.service;
  }

  private createHost(request: HttpRequest) {
    const body = validateObject(request.body, {
      hostname: { type: 'string', required: true },
      displayName: { type: 'string' },
      primaryIp: { type: 'string' },
      ipAddresses: { type: 'array' },
      osType: { type: 'string', enum: OsTypes },
      osName: { type: 'string' },
      osVersion: { type: 'string' },
      arch: { type: 'string' },
      environment: { type: 'string' },
      zoneId: { type: 'string' },
      compatibilityLevel: { type: 'string', enum: CompatibilityLevels },
      managementMode: { type: 'string', enum: ManagementModes },
      status: { type: 'string', enum: assetsEnumValues.hostStatuses },
      tags: { type: 'array' },
    });
    return { statusCode: 201, body: this.service.createHost(tenantId(request), body as unknown as CreateHostDto) };
  }

  private listHosts(request: HttpRequest) {
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['hostname', 'createdAt', 'updatedAt', 'status', 'environment', 'osType'],
      allowedFilterFields: ['hostname', 'primaryIp', 'osType', 'environment', 'zoneId', 'status', 'tag'],
    });
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
      compatibilityLevel: { type: 'string', enum: CompatibilityLevels },
      managementMode: { type: 'string', enum: ManagementModes },
      status: { type: 'string', enum: assetsEnumValues.hostStatuses },
      tags: { type: 'array' },
    });
    const { id, ...patch } = body as unknown as UpdateHostDto & { id: string };
    return this.service.updateHost(tenantId(request), id, patch);
  }

  private deleteHost(request: HttpRequest) {
    const body = validateObject(request.body, { id: { type: 'string', required: true } });
    return this.service.deleteHost(tenantId(request), String(body.id));
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
      discoverySource: { type: 'string', enum: assetsEnumValues.discoverySources },
      lastDiscoveredAt: { type: 'string' },
      status: { type: 'string', enum: assetsEnumValues.serviceInstanceStatuses },
      rawFacts: { type: 'object' },
    });
    return { statusCode: 201, body: this.service.createServiceInstance(tenantId(request), body as unknown as CreateServiceInstanceDto) };
  }

  private listServiceInstances(request: HttpRequest) {
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['displayName', 'providerType', 'createdAt', 'updatedAt', 'status', 'hostId'],
      allowedFilterFields: ['hostId', 'providerType', 'serviceName', 'displayName', 'status', 'discoverySource'],
    });
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
      discoverySource: { type: 'string', enum: assetsEnumValues.discoverySources },
      lastDiscoveredAt: { type: 'string' },
      status: { type: 'string', enum: assetsEnumValues.serviceInstanceStatuses },
      rawFacts: { type: 'object' },
    });
    const { id, ...patch } = body as unknown as UpdateServiceInstanceDto & { id: string };
    return this.service.updateServiceInstance(tenantId(request), id, patch);
  }

  private deleteServiceInstance(request: HttpRequest) {
    const body = validateObject(request.body, { id: { type: 'string', required: true } });
    return this.service.deleteServiceInstance(tenantId(request), String(body.id));
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
    return { statusCode: 201, body: this.service.createServiceEndpoint(tenantId(request), body as unknown as CreateServiceEndpointDto) };
  }

  private listServiceEndpoints(request: HttpRequest) {
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['port', 'protocol', 'createdAt', 'updatedAt', 'status', 'serviceInstanceId', 'hostName'],
      allowedFilterFields: ['serviceInstanceId', 'hostId', 'protocol', 'hostName', 'listenIp', 'port', 'status'],
    });
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
    return this.service.updateServiceEndpoint(tenantId(request), id, patch);
  }

  private deleteServiceEndpoint(request: HttpRequest) {
    const body = validateObject(request.body, { id: { type: 'string', required: true } });
    return this.service.deleteServiceEndpoint(tenantId(request), String(body.id));
  }

  private upsertDiscoverySnapshot(request: HttpRequest) {
    const body = validateObject(request.body, {
      normalizedHash: { type: 'string', required: true },
      source: { type: 'string', enum: assetsEnumValues.discoverySources },
      normalizedPayload: { type: 'object' },
      rawPayload: { type: 'object' },
    });
    return { statusCode: 201, body: this.service.upsertDiscoverySnapshot(tenantId(request), body as unknown as CreateDiscoverySnapshotDto) };
  }

  private listDiscoverySnapshots(request: HttpRequest) {
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['normalizedHash', 'source', 'createdAt', 'updatedAt'],
      allowedFilterFields: ['normalizedHash', 'source'],
    });
    return this.service.listDiscoverySnapshots(tenantId(request), query);
  }

  private previewDiscoveryMerge(request: HttpRequest) {
    const body = validateObject(request.body, {
      normalizedHash: { type: 'string', required: true },
      source: { type: 'string', enum: assetsEnumValues.discoverySources },
      normalizedPayload: { type: 'object' },
      rawPayload: { type: 'object' },
    });
    return { statusCode: 201, body: this.service.previewDiscoveryMerge(tenantId(request), body as unknown as PreviewDiscoveryMergeDto) };
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
    { method: 'POST', path: '/api/v1/discovery-snapshots/merge-preview', operationId: 'previewDiscoveryMerge', summary: '预览发现结果合并', tags, responseSchema: objectSchema() },
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
