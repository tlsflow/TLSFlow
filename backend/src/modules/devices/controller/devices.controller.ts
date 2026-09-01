import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import { requireTenantId } from '../../../common/http/tenant-context.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { parsePageQuery } from '../../../common/pagination/pagination.js';
import type { SecuritySubject } from '../../../shared/security-types.js';
import type { SecurityServices } from '../../security/security.controller.js';
import type { DevicesApplicationService } from '../application/devices.application-service.js';
import type { CreateManagedDeviceOnboardingDto } from '../dto/devices.dto.js';
import type { DeviceDetailInclude } from '../repository/devices.repository.js';
import { managedDeviceDetailSchema } from '../schema/devices.schema.js';
import type { WorkflowExecutionAuthorization } from '../../workflow-templates/dto/workflow-templates.dto.js';

const tags = ['Devices'];

export class DevicesController {
  constructor(private readonly service: DevicesApplicationService, private readonly security?: SecurityServices) {}

  register(router: Router): void {
    router.get('/api/v1/devices', '查询统一设备列表', tags, (request) => this.list(request));
    router.get('/api/v1/devices/onboarding-platforms', '查询设备添加平台', tags, () => this.service.listOnboardingPlatforms());
    router.post('/api/v1/devices/onboarding', '添加受管设备', tags, (request) => this.onboard(request));
    router.post('/api/v1/devices/:deviceId/actions', '执行统一设备能力', tags, (request) => this.executeCapability(request));
    router.get('/api/v1/devices/:deviceId', '查询统一设备详情', tags, (request) => this.get(request));
  }

  private async onboard(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    await this.security?.rbac.assertCan(subject, 'host.create', {
      type: 'host', scope: { tenantId: request.context.tenantId, tenantScope: request.context.tenantScope, ownerId: subject.id },
    }, { requestId: request.context.requestId, sourceIp: request.context.ip, actor: subject });
    const result = await this.service.onboard(
      tenantId(request),
      (request.body ?? {}) as CreateManagedDeviceOnboardingDto,
      subject.id,
      request.context.requestId ?? 'device-onboarding',
      resolveInstallPublicBaseUrl(request),
    );
    return { statusCode: 201, body: result };
  }

  private async list(request: HttpRequest) {
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['displayName', 'category', 'productFamily', 'managementMethod', 'health', 'softwareVersion', 'controlVersion', 'lastContactAt', 'applicationAssetCount'],
      allowedFilterFields: ['category', 'productFamily', 'managementMethod', 'health'],
    });
    const subject = this.subjectFromRequest(request);
    await this.security?.rbac.assertCan(subject, 'host.read', {
      type: 'host',
      scope: { tenantId: request.context.tenantId, tenantScope: request.context.tenantScope, ownerId: subject.id },
    }, { requestId: request.context.requestId, sourceIp: request.context.ip, actor: subject });
    const authorization = await this.security?.objectPermissions.buildAuthorizedQuery(subject, 'host', 'read');
    // 全局 host.read 且没有对象授权记录时保持全量可读，不能把空授权误转为空 ID 数组。
    const authorizedHostIds = authorization && !authorization.unrestricted
      ? (authorization.empty
        ? (authorization.deniedObjectIds?.length || authorization.deniedDynamicConditions?.length ? [] : undefined)
        : authorization.objectIds ?? [])
      : undefined;
    return this.service.list(tenantId(request), { ...query, authorizedHostIds });
  }

  private async get(request: HttpRequest) {
    const deviceId = request.path.match(/^\/api\/v1\/devices\/([^/]+)$/)?.[1];
    if (!deviceId) throw new AppError('VALIDATION_FAILED', 'deviceId 不能为空', { field: 'deviceId' });
    const subject = this.subjectFromRequest(request);
    await this.security?.rbac.assertCan(subject, 'host.read', {
      type: 'host', id: deviceId, scope: { tenantId: request.context.tenantId, tenantScope: request.context.tenantScope, ownerId: subject.id },
    }, { requestId: request.context.requestId, sourceIp: request.context.ip, actor: subject });
    const locale = Array.isArray(request.query.locale) ? request.query.locale[0] : request.query.locale;
    return this.service.get(
      tenantId(request),
      deviceId,
      locale ?? 'zh-CN',
      parseDetailIncludes(request.query.include),
      queryString(request.query.frameworkId),
    );
  }

  private async executeCapability(request: HttpRequest) {
    const deviceId = request.path.match(/^\/api\/v1\/devices\/([^/]+)\/actions$/)?.[1];
    const body = (request.body ?? {}) as Record<string, unknown>;
    const capabilityKey = String(body.capabilityKey ?? '').trim();
    if (!deviceId || !capabilityKey) throw new AppError('VALIDATION_FAILED', 'deviceId 和 capabilityKey 不能为空');
    const authorization = parseWorkflowExecutionAuthorization(body.authorization);
    const subject = this.subjectFromRequest(request);
    await this.security?.rbac.assertCan(subject, 'host.update', {
      type: 'host', id: deviceId, scope: { tenantId: request.context.tenantId, tenantScope: request.context.tenantScope, ownerId: subject.id },
    }, { requestId: request.context.requestId, sourceIp: request.context.ip, actor: subject });
    return this.service.executeCapability(
      tenantId(request),
      deviceId,
      capabilityKey,
      subject.id,
      request.context.requestId ?? 'device-action',
      authorization,
    );
  }


  private subjectFromRequest(request: HttpRequest): SecuritySubject {
    if (!this.security) return { id: request.context.actorId ?? 'system_devices', type: 'system', scope: { tenantId: request.context.tenantId, tenantScope: request.context.tenantScope } };
    if (!request.context.actorId) throw new AppError('AUTH_UNAUTHENTICATED', '缺少 actor 上下文');
    return { id: request.context.actorId, type: 'user', scope: { tenantId: request.context.tenantId, tenantScope: request.context.tenantScope } };
  }
}

function parseDetailIncludes(value: string | string[] | undefined): ReadonlySet<DeviceDetailInclude> | undefined {
  if (value === undefined) return undefined;
  const supported = new Set<DeviceDetailInclude>(['frameworks', 'sites', 'certificates', 'logs']);
  const requested = (Array.isArray(value) ? value : [value])
    .flatMap((item) => item.split(','))
    .map((item) => item.trim())
    .filter((item): item is DeviceDetailInclude => supported.has(item as DeviceDetailInclude));
  return new Set(requested);
}

function queryString(value: string | string[] | undefined): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  const normalized = candidate?.trim();
  return normalized || undefined;
}

function parseWorkflowExecutionAuthorization(value: unknown): WorkflowExecutionAuthorization | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('VALIDATION_FAILED', 'authorization 必须是对象');
  }
  const body = value as Record<string, unknown>;
  const unknownKeys = Object.keys(body).filter((key) => key !== 'approved' && key !== 'approvalId');
  if (unknownKeys.length > 0) {
    throw new AppError('VALIDATION_FAILED', 'authorization 包含未知字段', { fields: unknownKeys });
  }
  if (body.approved !== undefined && typeof body.approved !== 'boolean') {
    throw new AppError('VALIDATION_FAILED', 'authorization.approved 必须是布尔值');
  }
  if (body.approvalId !== undefined && (typeof body.approvalId !== 'string' || body.approvalId.trim() === '')) {
    throw new AppError('VALIDATION_FAILED', 'authorization.approvalId 必须是非空字符串');
  }
  return {
    ...(body.approved !== undefined ? { approved: body.approved } : {}),
    ...(body.approvalId !== undefined ? { approvalId: String(body.approvalId).trim() } : {}),
  };
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
    method: 'POST',
    path: '/api/v1/devices/:deviceId/actions',
    operationId: 'executeManagedDeviceCapability',
    summary: '执行统一设备能力',
    tags,
    requestSchema: {
      type: 'object',
      required: ['capabilityKey'],
      properties: {
        capabilityKey: { type: 'string' },
        authorization: {
          type: 'object',
          properties: {
            approved: { type: 'boolean' },
            approvalId: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    responseSchema: { type: 'object' },
  }, {
    method: 'POST',
    path: '/api/v1/devices/onboarding',
    operationId: 'onboardManagedDevice',
    summary: '添加受管设备',
    tags,
    responseSchema: { type: 'object' },
  }, {
    method: 'GET',
    path: '/api/v1/devices/onboarding-platforms',
    operationId: 'listDeviceOnboardingPlatforms',
    summary: '查询设备添加平台',
    tags,
    responseSchema: { type: 'array', items: { type: 'object' } },
  }, {
    method: 'GET',
    path: '/api/v1/devices/:deviceId',
    operationId: 'getManagedDevice',
    summary: '查询统一设备详情',
    tags,
    responseSchema: managedDeviceDetailSchema,
  }];
}

function tenantId(request: HttpRequest): string {
  return requireTenantId(request);
}

function resolveInstallPublicBaseUrl(request: HttpRequest): string {
  const candidates = [
    process.env.GCAC_AGENT_INSTALL_PUBLIC_BASE_URL,
    process.env.GCAC_PUBLIC_BASE_URL,
    singleHeader(request, 'x-public-base-url'),
    singleHeader(request, 'origin'),
    originFromReferer(singleHeader(request, 'referer')),
    inferredRequestOrigin(request),
  ];
  for (const candidate of candidates) {
    const normalized = normalizeBaseUrl(candidate);
    if (normalized) return normalized;
  }
  return 'http://localhost';
}

function singleHeader(request: HttpRequest, key: string): string | undefined {
  const value = request.headers[key];
  return Array.isArray(value) ? value[0] : value;
}

function originFromReferer(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function inferredRequestOrigin(request: HttpRequest): string | undefined {
  const proto = singleHeader(request, 'x-forwarded-proto')?.split(',')[0]?.trim() || 'http';
  const host = singleHeader(request, 'x-forwarded-host')?.split(',')[0]?.trim() || singleHeader(request, 'host');
  return host ? `${proto}://${host}` : undefined;
}

function normalizeBaseUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return parsed.origin.replace(/\/+$/u, '');
  } catch {
    return undefined;
  }
}
