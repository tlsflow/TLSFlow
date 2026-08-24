import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { parsePageQuery } from '../../../common/pagination/pagination.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import { GatewaysApplicationService } from '../application/gateways.application-service.js';
import type { ProbeGatewayInput, RegisterGatewayInput, RouteGatewayInput, UpdateGatewayStatusInput } from '../dto/gateways.dto.js';
import { gatewayDetailSchema, gatewayPageSchema, gatewayReachabilitySchema, gatewayRouteResultSchema, gatewaySchema, gatewayTargetHistorySchema } from '../schema/gateways.schema.js';

const tags = ['Gateways'];
const tenantFallback = '00000000-0000-0000-0000-000000000000';
const gatewayStatuses = ['online', 'offline', 'disabled', 'revoked', 'upgrading'];
const reachabilityStatuses = ['reachable', 'unreachable', 'unknown', 'expired'];
const statusActions = ['register', 'heartbeat', 'disable', 'revoke', 'status'];

export class GatewaysController {
  constructor(private readonly service = new GatewaysApplicationService()) {}

  register(router: Router): void {
    router.get('/api/v1/gateways', '查询 Gateway 列表', tags, (request) => this.list(request));
    router.get('/api/v1/gateways/detail', '查询 Gateway 详情', tags, (request) => this.detail(request));
    router.get('/api/v1/gateways/target-history', '查询 Gateway 代表目标历史', tags, (request) => this.targetHistory(request));
    router.post('/api/v1/gateways/route', '选择可用 Gateway 路由', tags, (request) => this.route(request));
    router.post('/api/v1/gateways/probe', '记录 Gateway 可达性探测', tags, (request) => this.probe(request));
    router.post('/api/v1/gateways/status', '注册或更新 Gateway 状态', tags, (request) => this.status(request));
  }

  getApplicationService(): GatewaysApplicationService {
    return this.service;
  }

  private list(request: HttpRequest) {
    return this.service.list(tenantId(request), parsePageQuery(request.query, {
      allowedSortFields: ['id', 'agentId', 'status', 'updatedAt', 'lastHeartbeatAt'],
      allowedFilterFields: ['zoneId', 'status'],
    }));
  }

  private detail(request: HttpRequest) {
    const id = readQuery(request, 'id');
    const detail = this.service.detail(tenantId(request), id);
    if (!detail) throw new AppError('RESOURCE_NOT_FOUND', 'Gateway 不存在', { id });
    return detail;
  }

  private targetHistory(request: HttpRequest) {
    const delegatedTargetId = readQuery(request, 'delegatedTargetId');
    return this.service.targetHistory(tenantId(request), delegatedTargetId);
  }

  private status(request: HttpRequest) {
    const body = validateObject(request.body, {
      action: { type: 'string', enum: statusActions },
      gatewayId: { type: 'string' },
      agentId: { type: 'string' },
      status: { type: 'string', enum: gatewayStatuses },
      version: { type: 'string' },
      zoneIds: { type: 'array' },
      adapters: { type: 'array' },
      capabilities: { type: 'array' },
      currentLoad: { type: 'number' },
      maxConcurrentTasks: { type: 'number' },
      successRate: { type: 'number' },
    });
    const input = normalizeStatusInput(body);
    const created = (input.action ?? 'status') === 'register';
    return { statusCode: created ? 201 : 200, body: this.service.status(tenantId(request), input) };
  }

  private route(request: HttpRequest) {
    const body = validateObject(request.body, {
      zoneId: { type: 'string', required: true },
      targetId: { type: 'string', required: true },
      protocols: { type: 'array', required: true },
      requiredCapabilities: { type: 'array' },
      destructive: { type: 'boolean' },
    });
    return this.service.route(tenantId(request), normalizeRouteInput(body));
  }

  private probe(request: HttpRequest) {
    const body = validateObject(request.body, {
      gatewayId: { type: 'string', required: true },
      targetId: { type: 'string', required: true },
      protocol: { type: 'string', required: true },
      port: { type: 'number' },
      status: { type: 'string', enum: reachabilityStatuses },
      latencyMs: { type: 'number' },
      ttlSeconds: { type: 'number' },
      zoneId: { type: 'string' },
    });
    return { statusCode: 201, body: this.service.probe(tenantId(request), body as unknown as ProbeGatewayInput) };
  }
}

export function getGatewayRouteContracts(): RouteContract[] {
  return [
    { method: 'GET', path: '/api/v1/gateways', operationId: 'listGateways', summary: '查询 Gateway 列表', tags, responseSchema: gatewayPageSchema },
    { method: 'GET', path: '/api/v1/gateways/detail', operationId: 'getGatewayDetail', summary: '查询 Gateway 详情', tags, responseSchema: gatewayDetailSchema },
    { method: 'GET', path: '/api/v1/gateways/target-history', operationId: 'listGatewayTargetHistory', summary: '查询 Gateway 代表目标历史', tags, responseSchema: gatewayTargetHistorySchema },
    { method: 'POST', path: '/api/v1/gateways/route', operationId: 'routeGateway', summary: '选择可用 Gateway 路由', tags, responseSchema: gatewayRouteResultSchema },
    { method: 'POST', path: '/api/v1/gateways/probe', operationId: 'probeGatewayReachability', summary: '记录 Gateway 可达性探测', tags, responseSchema: gatewayReachabilitySchema },
    { method: 'POST', path: '/api/v1/gateways/status', operationId: 'updateGatewayStatus', summary: '注册或更新 Gateway 状态', tags, responseSchema: gatewaySchema },
  ];
}

function tenantId(request: HttpRequest): string {
  return request.context.tenantId ?? tenantFallback;
}

function readQuery(request: HttpRequest, key: string, fallback?: string): string {
  const value = request.query[key];
  const normalized = Array.isArray(value) ? value[0] : value;
  if (!normalized && fallback !== undefined) return fallback;
  if (!normalized) throw new AppError('VALIDATION_FAILED', `${key} 不能为空`, { key });
  return normalized;
}

function normalizeStatusInput(body: Record<string, unknown>): UpdateGatewayStatusInput {
  return {
    action: body.action as UpdateGatewayStatusInput['action'],
    gatewayId: body.gatewayId as string | undefined,
    agentId: body.agentId as string | undefined,
    status: body.status as UpdateGatewayStatusInput['status'],
    version: body.version as string | undefined,
    zoneIds: stringArray(body.zoneIds, 'zoneIds'),
    adapters: stringArray(body.adapters, 'adapters'),
    capabilities: stringArray(body.capabilities, 'capabilities'),
    currentLoad: body.currentLoad as number | undefined,
    maxConcurrentTasks: body.maxConcurrentTasks as number | undefined,
    successRate: body.successRate as number | undefined,
  };
}

function normalizeRouteInput(body: Record<string, unknown>): RouteGatewayInput {
  return {
    zoneId: String(body.zoneId),
    targetId: String(body.targetId),
    protocols: requiredStringArray(body.protocols, 'protocols'),
    requiredCapabilities: stringArray(body.requiredCapabilities, 'requiredCapabilities'),
    destructive: body.destructive as boolean | undefined,
  };
}

function stringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  return requiredStringArray(value, field);
}

function requiredStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === '')) {
    throw new AppError('VALIDATION_FAILED', `${field} 必须是字符串数组`, { field });
  }
  return [...new Set(value)] as string[];
}
