import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { parsePageQuery } from '../../../common/pagination/pagination.js';
import type { SecuritySubject } from '../../../shared/security-types.js';
import type { SecurityServices } from '../../security/security.controller.js';
import type { DevicesApplicationService } from '../application/devices.application-service.js';

const tags = ['Devices'];
const tenantFallback = '00000000-0000-0000-0000-000000000000';

export class DevicesController {
  constructor(private readonly service: DevicesApplicationService, private readonly security?: SecurityServices) {}

  register(router: Router): void {
    router.get('/api/v1/devices', '查询统一设备列表', tags, (request) => this.list(request));
    router.get('/api/v1/devices/:deviceId', '查询统一设备详情', tags, (request) => this.get(request));
  }

  private async list(request: HttpRequest) {
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['displayName', 'category', 'productFamily', 'managementMethod', 'health', 'softwareVersion', 'lastContactAt', 'applicationAssetCount'],
      allowedFilterFields: ['category', 'productFamily', 'managementMethod', 'health'],
    });
    const subject = this.subjectFromRequest(request);
    await this.security?.rbac.assertCan(subject, 'host.read', {
      type: 'host',
      scope: { tenantId: request.context.tenantId, ownerId: subject.id },
    }, { requestId: request.context.requestId, sourceIp: request.context.ip, actor: subject });
    const authorization = await this.security?.objectPermissions.buildAuthorizedQuery(subject, 'host', 'read');
    const authorizedHostIds = authorization && !authorization.unrestricted ? authorization.objectIds ?? [] : undefined;
    return this.service.list(tenantId(request), { ...query, authorizedHostIds });
  }

  private async get(request: HttpRequest) {
    const deviceId = request.path.match(/^\/api\/v1\/devices\/([^/]+)$/)?.[1];
    if (!deviceId) throw new AppError('VALIDATION_FAILED', 'deviceId 不能为空', { field: 'deviceId' });
    const subject = this.subjectFromRequest(request);
    await this.security?.rbac.assertCan(subject, 'host.read', {
      type: 'host', id: deviceId, scope: { tenantId: request.context.tenantId, ownerId: subject.id },
    }, { requestId: request.context.requestId, sourceIp: request.context.ip, actor: subject });
    return this.service.get(tenantId(request), deviceId);
  }

  private subjectFromRequest(request: HttpRequest): SecuritySubject {
    if (!this.security) return { id: request.context.actorId ?? 'system_devices', type: 'system', scope: { tenantId: request.context.tenantId } };
    if (!request.context.actorId) throw new AppError('AUTH_UNAUTHENTICATED', '缺少 actor 上下文');
    return { id: request.context.actorId, type: 'user', scope: { tenantId: request.context.tenantId } };
  }
}

export function getDeviceRouteContracts(): RouteContract[] {
  return [{
    method: 'GET',
    path: '/api/v1/devices',
    operationId: 'listManagedDevices',
    summary: '查询统一设备列表',
    tags,
    responseSchema: { type: 'object' },
  }, {
    method: 'GET',
    path: '/api/v1/devices/:deviceId',
    operationId: 'getManagedDevice',
    summary: '查询统一设备详情',
    tags,
    responseSchema: { type: 'object' },
  }];
}

function tenantId(request: HttpRequest): string {
  return request.context.tenantId ?? tenantFallback;
}
