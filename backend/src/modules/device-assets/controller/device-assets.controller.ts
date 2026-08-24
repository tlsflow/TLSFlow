import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import type { DeviceAssetsApplicationService } from '../application/device-assets.application-service.js';
import { deviceAuditSummary, type DeviceAssetSecurityPort } from '../application/device-assets.security.js';
import type { CreateDeviceAssetDto, UpdateDeviceAssetDto } from '../dto/device-assets.dto.js';
import { deviceAssetSchema } from '../schema/device-assets.schema.js';

const tags = ['Device Assets'];
const tenantFallback = '00000000-0000-0000-0000-000000000000';

export class DeviceAssetsController {
  constructor(private readonly service: DeviceAssetsApplicationService, private readonly security?: DeviceAssetSecurityPort) {}

  register(router: Router): void {
    router.get('/api/v1/device-assets', '查询设备资产列表', tags, (request) => this.list(request));
    router.get('/api/v1/device-assets/detail', '查询设备资产详情', tags, (request) => this.get(request));
    router.post('/api/v1/device-assets', '创建设备资产', tags, (request) => this.create(request));
    router.patch('/api/v1/device-assets', '更新设备资产', tags, (request) => this.update(request));
    router.post('/api/v1/device-assets/delete', '删除设备资产', tags, (request) => this.delete(request));
    router.post('/api/v1/device-assets/test-connection', '测试设备连接', tags, (request) => this.testConnection(request));
  }

  private async list(request: HttpRequest) {
    await this.security?.assertAccess(request, 'read');
    return this.service.list(tenantId(request));
  }

  private async get(request: HttpRequest) {
    const deviceAssetId = requiredQuery(request, 'deviceAssetId');
    await this.security?.assertAccess(request, 'read', deviceAssetId);
    return this.service.get(tenantId(request), deviceAssetId);
  }

  private async create(request: HttpRequest) {
    await this.security?.assertAccess(request, 'edit');
    const body = validateObject(request.body, createRules());
    const created = await this.service.create(tenantId(request), body as unknown as CreateDeviceAssetDto);
    await this.security?.audit(request, 'device_asset.created', 'device_asset.create', created.id, deviceAuditSummary(created));
    return { statusCode: 201, body: created };
  }

  private async update(request: HttpRequest) {
    const body = validateObject(request.body, { deviceAssetId: { type: 'string', required: true }, ...createRules(false) });
    const { deviceAssetId, ...patch } = body;
    await this.security?.assertAccess(request, 'edit', String(deviceAssetId));
    const updated = await this.service.update(tenantId(request), String(deviceAssetId), patch as UpdateDeviceAssetDto);
    await this.security?.audit(request, 'device_asset.updated', 'device_asset.update', updated.id, deviceAuditSummary(updated));
    return updated;
  }

  private async delete(request: HttpRequest) {
    const body = validateObject(request.body, { deviceAssetId: { type: 'string', required: true } });
    await this.security?.assertAccess(request, 'control', String(body.deviceAssetId));
    const deleted = await this.service.delete(tenantId(request), String(body.deviceAssetId));
    await this.security?.audit(request, 'device_asset.deleted', 'device_asset.delete', deleted.id, deviceAuditSummary(deleted));
    return deleted;
  }

  private async testConnection(request: HttpRequest) {
    const body = validateObject(request.body, { deviceAssetId: { type: 'string', required: true } });
    await this.security?.assertAccess(request, 'control', String(body.deviceAssetId));
    const result = await this.service.testConnection(tenantId(request), String(body.deviceAssetId), request.context.actorId ?? 'system');
    await this.security?.audit(request, 'device_asset.connection_tested', 'device_asset.test_connection', String(body.deviceAssetId), {
      reachable: result.reachable,
      authenticated: result.authenticated,
      productMatched: result.productMatched,
      softwareVersion: result.softwareVersion,
      errorCode: result.errorCode,
    });
    return result;
  }
}

export function getDeviceAssetRouteContracts(): RouteContract[] {
  return [
    { method: 'GET', path: '/api/v1/device-assets', operationId: 'listDeviceAssets', summary: '查询设备资产列表', tags, responseSchema: { type: 'array', items: deviceAssetSchema } },
    { method: 'GET', path: '/api/v1/device-assets/detail', operationId: 'getDeviceAsset', summary: '查询设备资产详情', tags, responseSchema: deviceAssetSchema },
    { method: 'POST', path: '/api/v1/device-assets', operationId: 'createDeviceAsset', summary: '创建设备资产', tags, responseSchema: deviceAssetSchema },
    { method: 'PATCH', path: '/api/v1/device-assets', operationId: 'updateDeviceAsset', summary: '更新设备资产', tags, responseSchema: deviceAssetSchema },
    { method: 'POST', path: '/api/v1/device-assets/delete', operationId: 'deleteDeviceAsset', summary: '删除设备资产', tags, responseSchema: deviceAssetSchema },
    { method: 'POST', path: '/api/v1/device-assets/test-connection', operationId: 'testDeviceAssetConnection', summary: '测试设备连接', tags, responseSchema: { type: 'object' } },
  ];
}

function tenantId(request: HttpRequest): string {
  return request.context.tenantId ?? tenantFallback;
}

function requiredQuery(request: HttpRequest, name: string): string {
  const value = request.query[name];
  const item = Array.isArray(value) ? value[0] : value;
  if (!item) throw new AppError('VALIDATION_FAILED', `${name} 不能为空`, { field: name });
  return item;
}

function createRules(required = true) {
  return {
    displayName: { type: 'string', required },
    managementAddress: { type: 'string', required },
    managementPort: { type: 'number' },
    deviceFamily: { type: 'string', required, enum: ['NETSCALER_ADC'] },
    credentialId: { type: 'string', required },
    authMode: { type: 'string', enum: ['AUTO', 'SESSION', 'PER_REQUEST'] },
    tlsVerify: { type: 'boolean' },
    caSecretId: { type: 'string' },
    gatewayId: { type: 'string' },
  } as const;
}
