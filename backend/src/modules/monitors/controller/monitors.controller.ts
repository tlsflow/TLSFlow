import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { parsePageQuery } from '../../../common/pagination/pagination.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import { RiskStatuses } from '../../../shared/enums/core.enums.js';
import { MonitorsApplicationService } from '../application/monitors.application-service.js';
import { alertRuleStatuses, monitorMetrics, monitorTargetStatuses, riskEventTypes, severity, type MonitorTargetStatus } from '../schema/monitors.schema.js';

const tags = ['Monitors'];
const tenantFallback = '00000000-0000-0000-0000-000000000000';

export class MonitorsController {
  constructor(private readonly service: MonitorsApplicationService) {}

  register(router: Router): void {
    router.get('/api/v1/monitors/targets', '查询监控目标', tags, (request) => this.listTargets(request));
    router.post('/api/v1/monitors/targets', '创建监控目标', tags, (request) => this.createTarget(request));
    router.patch('/api/v1/monitors/targets', '更新监控目标', tags, (request) => this.updateTarget(request));
    router.post('/api/v1/monitors/targets/delete', '删除监控目标', tags, (request) => this.deleteTarget(request));
    router.post('/api/v1/monitors/scan', '触发监控风险扫描', tags, (request) => this.scan(request));
    router.post('/api/v1/monitors/probe', '执行应用资产监控探测', tags, (request) => this.probe(request));
    router.get('/api/v1/monitors/risks', '查询监控风险事件', tags, (request) => this.listRisks(request));
    router.get('/api/v1/monitors/certificate-observations', '查询实测证书变更历史', tags, (request) => this.listCertificateObservations(request));
    router.get('/api/v1/monitors/dashboard', '查询监控仪表盘聚合', tags, (request) => this.getDashboard(request));
    router.post('/api/v1/monitors/alert-rules', '创建监控告警规则', tags, (request) => this.createAlertRule(request));
    router.get('/api/v1/monitors/alert-rules', '查询监控告警规则', tags, (request) => this.listAlertRules(request));
  }

  private async listTargets(request: HttpRequest) {
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['createdAt', 'updatedAt', 'intervalSeconds', 'status'],
      allowedFilterFields: ['serviceAssetId', 'assetId', 'status'],
      defaultPageSize: 200,
      maxPageSize: 500,
    });
    return this.service.listMonitorTargets({
      tenantId: requiredTenantId(request),
      ...query,
    });
  }

  private async createTarget(request: HttpRequest) {
    const body = validateObject(request.body ?? {}, {
      serviceAssetId: { type: 'string' },
      assetId: { type: 'string' },
      metrics: { type: 'array' },
      intervalSeconds: { type: 'number', required: true },
      status: { type: 'string', enum: monitorTargetStatuses },
    });
    const serviceAssetId = String(body.serviceAssetId ?? body.assetId ?? '').trim();
    if (!serviceAssetId) throw new AppError('VALIDATION_FAILED', '字段不能为空', { field: 'serviceAssetId' });
    return {
      statusCode: 201,
      body: await this.service.createMonitorTarget({
        tenantId: requiredTenantId(request),
        serviceAssetId,
        metrics: readMetrics(body.metrics),
        intervalSeconds: Number(body.intervalSeconds),
        status: readTargetStatus(body.status),
        createdBy: request.context.actorId,
      }),
    };
  }

  private async updateTarget(request: HttpRequest) {
    const body = validateObject(request.body ?? {}, {
      id: { type: 'string', required: true },
      metrics: { type: 'array' },
      intervalSeconds: { type: 'number' },
      status: { type: 'string', enum: monitorTargetStatuses },
    });
    return this.service.updateMonitorTarget({
      tenantId: requiredTenantId(request),
      id: String(body.id),
      metrics: readMetrics(body.metrics),
      intervalSeconds: body.intervalSeconds === undefined ? undefined : Number(body.intervalSeconds),
      status: readTargetStatus(body.status),
    });
  }

  private async deleteTarget(request: HttpRequest) {
    const body = validateObject(request.body ?? {}, {
      id: { type: 'string', required: true },
    });
    return this.service.deleteMonitorTarget(requiredTenantId(request), String(body.id));
  }

  private async scan(request: HttpRequest) {
    const body = validateObject(request.body ?? {}, {
      certificateExpiringThresholdDays: { type: 'number' },
      scanStartedAt: { type: 'string' },
    });
    return {
      statusCode: 201,
      body: await this.service.collectRisks({
        tenantId: tenantId(request),
        certificateExpiringThresholdDays: body.certificateExpiringThresholdDays === undefined ? undefined : Number(body.certificateExpiringThresholdDays),
        scanStartedAt: body.scanStartedAt === undefined ? undefined : String(body.scanStartedAt),
      }),
    };
  }

  private async probe(request: HttpRequest) {
    const body = validateObject(request.body ?? {}, {
      serviceAssetId: { type: 'string', required: true },
      timeoutMs: { type: 'number' },
    });
    return {
      statusCode: 200,
      body: await this.service.probeServiceAsset({
        tenantId: tenantId(request),
        serviceAssetId: String(body.serviceAssetId),
        timeoutMs: body.timeoutMs === undefined ? undefined : Number(body.timeoutMs),
      }),
    };
  }

  private async listRisks(request: HttpRequest) {
    const items = await this.service.listRiskEvents({
      tenantId: tenantId(request),
      status: readOptionalQueryString(request, 'status') as typeof RiskStatuses[number] | undefined,
      severity: readOptionalQueryString(request, 'severity') as typeof severity[number] | undefined,
      type: readOptionalQueryString(request, 'type') as typeof riskEventTypes[number] | undefined,
    });
    return {
      items,
      page: 1,
      pageSize: 200,
      total: items.length,
    };
  }

  private async listCertificateObservations(request: HttpRequest) {
    const items = await this.service.listCertificateObservations({
      tenantId: tenantId(request),
      serviceAssetId: readOptionalQueryString(request, 'serviceAssetId') ?? readOptionalQueryString(request, 'filter[serviceAssetId]'),
      pageSize: Number(readOptionalQueryString(request, 'pageSize') ?? 200),
    });
    return {
      items,
      page: 1,
      pageSize: 200,
      total: items.length,
    };
  }

  private async getDashboard(request: HttpRequest) {
    return this.service.getDashboard(tenantId(request));
  }

  private async createAlertRule(request: HttpRequest) {
    const body = validateObject(request.body, {
      name: { type: 'string', required: true },
      threshold: { type: 'object', required: true },
      scope: { type: 'object' },
      status: { type: 'string', enum: alertRuleStatuses },
      silence: { type: 'object' },
    });
    const actorId = request.context.actorId;
    if (!actorId) throw new AppError('AUTH_UNAUTHENTICATED', '缺少 actor 上下文');
    return {
      statusCode: 201,
      body: await this.service.createAlertRule({
        name: String(body.name),
        threshold: body.threshold as { metric: 'count'; operator: 'gte'; value: number },
        scope: body.scope as any,
        status: body.status as any,
        silence: body.silence as any,
        createdBy: actorId,
      }),
    };
  }

  private async listAlertRules(request: HttpRequest) {
    const items = await this.service.listAlertRules(tenantId(request));
    return {
      items,
      page: 1,
      pageSize: 200,
      total: items.length,
    };
  }
}

function readOptionalQueryString(request: HttpRequest, key: string): string | undefined {
  const value = request.query[key];
  return Array.isArray(value) ? value[0] : value;
}

function tenantId(request: HttpRequest): string | undefined {
  return request.context.tenantId;
}

function requiredTenantId(request: HttpRequest): string {
  return request.context.tenantId ?? tenantFallback;
}

function readMetrics(value: unknown): typeof monitorMetrics[number][] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is typeof monitorMetrics[number] =>
    typeof item === 'string' && monitorMetrics.includes(item as typeof monitorMetrics[number]),
  );
}

function readTargetStatus(value: unknown): MonitorTargetStatus | undefined {
  return typeof value === 'string' && monitorTargetStatuses.includes(value as MonitorTargetStatus)
    ? value as MonitorTargetStatus
    : undefined;
}

export function getMonitorRouteContracts(): RouteContract[] {
  return [
    { method: 'GET', path: '/api/v1/monitors/targets', operationId: 'listMonitorTargets', summary: '查询监控目标', tags, responseSchema: pageSchema() },
    { method: 'POST', path: '/api/v1/monitors/targets', operationId: 'createMonitorTarget', summary: '创建监控目标', tags, responseSchema: objectSchema() },
    { method: 'PATCH', path: '/api/v1/monitors/targets', operationId: 'updateMonitorTarget', summary: '更新监控目标', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/monitors/targets/delete', operationId: 'deleteMonitorTarget', summary: '删除监控目标', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/monitors/scan', operationId: 'scanMonitorRisks', summary: '触发监控风险扫描', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/monitors/probe', operationId: 'probeMonitorServiceAsset', summary: '执行应用资产监控探测', tags, responseSchema: objectSchema() },
    { method: 'GET', path: '/api/v1/monitors/risks', operationId: 'listMonitorRisks', summary: '查询监控风险事件', tags, responseSchema: pageSchema() },
    { method: 'GET', path: '/api/v1/monitors/certificate-observations', operationId: 'listMonitorCertificateObservations', summary: '查询实测证书变更历史', tags, responseSchema: pageSchema() },
    { method: 'GET', path: '/api/v1/monitors/dashboard', operationId: 'getMonitorDashboard', summary: '查询监控仪表盘聚合', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/monitors/alert-rules', operationId: 'createMonitorAlertRule', summary: '创建监控告警规则', tags, responseSchema: objectSchema() },
    { method: 'GET', path: '/api/v1/monitors/alert-rules', operationId: 'listMonitorAlertRules', summary: '查询监控告警规则', tags, responseSchema: pageSchema() },
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
