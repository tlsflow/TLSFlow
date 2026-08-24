import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import type { DeviceAssetsApplicationService } from '../application/device-assets.application-service.js';
import type { CreateDeviceAssetDto, UpdateDeviceAssetDto } from '../dto/device-assets.dto.js';
import { deviceAssetSchema } from '../schema/device-assets.schema.js';

const tags = ['Device Assets'];
const tenantFallback = '00000000-0000-0000-0000-000000000000';

export class DeviceAssetsController {
  constructor(private readonly service: DeviceAssetsApplicationService) {}

  register(router: Router): void {
    router.get('/api/v1/device-assets', '查询设备资产列表', tags, (request) => this.list(request));
    router.get('/api/v1/device-assets/detail', '查询设备资产详情', tags, (request) => this.get(request));
    router.post('/api/v1/device-assets', '创建设备资产', tags, (request) => this.create(request));
    router.patch('/api/v1/device-assets', '更新设备资产', tags, (request) => this.update(request));
    router.post('/api/v1/device-assets/delete', '删除设备资产', tags, (request) => this.delete(request));
    router.post('/api/v1/device-assets/test-connection', '测试设备连接', tags, (request) => this.testConnection(request));
  }

  private list(request: HttpRequest) {
    return this.service.list(tenantId(request));
  }

  private get(request: HttpRequest) {
    return this.service.get(tenantId(request), requiredQuery(request, 'deviceAssetId'));
  }

  private async create(request: HttpRequest) {
    const body = validateObject(request.body, createRules());
    return { statusCode: 201, body: await this.service.create(tenantId(request), body as unknown as CreateDeviceAssetDto) };
  }

  private update(request: HttpRequest) {
    const body = validateObject(request.body, { deviceAssetId: { type: 'string', required: true }, ...createRules(false) });
    const { deviceAssetId, ...patch } = body;
    return this.service.update(tenantId(request), String(deviceAssetId), patch as UpdateDeviceAssetDto);
  }

  private delete(request: HttpRequest) {
    const body = validateObject(request.body, { deviceAssetId: { type: 'string', required: true } });
    return this.service.delete(tenantId(request), String(body.deviceAssetId));
  }

  private testConnection(request: HttpRequest) {
    const body = validateObject(request.body, { deviceAssetId: { type: 'string', required: true } });
    return this.service.testConnection(tenantId(request), String(body.deviceAssetId), request.context.actorId ?? 'system');
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
