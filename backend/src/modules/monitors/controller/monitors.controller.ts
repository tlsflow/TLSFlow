import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import { requireTenantId } from '../../../common/http/tenant-context.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { parsePageQuery } from '../../../common/pagination/pagination.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import { RiskStatuses } from '../../../shared/enums/core.enums.js';
import type { SecurityServices } from '../../security/security.controller.js';
import {
  assertRouteAction,
  assertRouteObjectAccess,
  filterAuthorizedItems,
  requireRouteSecurity,
} from '../../security/security-route-helpers.js';
import { MonitorsApplicationService } from '../application/monitors.application-service.js';
import { alertRuleStatuses, monitorMetrics, monitorTargetStatuses, riskEventTypes, severity, type MonitorTargetStatus, type RiskStatusAction } from '../schema/monitors.schema.js';

const tags = ['Monitors'];

export class MonitorsController {
  constructor(private readonly service: MonitorsApplicationService, private readonly security?: SecurityServices) {}

  register(router: Router): void {
    router.get('/api/v1/monitors/targets', '查询监控目标', tags, (request) => this.listTargets(request));
    router.post('/api/v1/monitors/targets', '创建监控目标', tags, (request) => this.createTarget(request));
    router.patch('/api/v1/monitors/targets', '更新监控目标', tags, (request) => this.updateTarget(request));
    router.post('/api/v1/monitors/targets/delete', '删除监控目标', tags, (request) => this.deleteTarget(request));
    router.post('/api/v1/monitors/scan', '触发监控风险扫描', tags, (request) => this.scan(request));
    router.post('/api/v1/monitors/probe', '执行应用资产监控探测', tags, (request) => this.probe(request));
    router.get('/api/v1/monitors/risks', '查询监控风险事件', tags, (request) => this.listRisks(request));
    router.post('/api/v1/monitors/risks/:id/acknowledge', '确认监控风险事件', tags, (request) => this.changeRiskStatus(request, 'acknowledged'));
    router.post('/api/v1/monitors/risks/:id/suppress', '抑制监控风险事件', tags, (request) => this.changeRiskStatus(request, 'suppressed'));
    router.post('/api/v1/monitors/risks/:id/ignore', '忽略监控风险事件', tags, (request) => this.changeRiskStatus(request, 'ignored'));
    router.post('/api/v1/monitors/risks/:id/resolve', '解决监控风险事件', tags, (request) => this.changeRiskStatus(request, 'resolved'));
    router.post('/api/v1/monitors/risks/:id/reopen', '重新打开监控风险事件', tags, (request) => this.changeRiskStatus(request, 'reopened'));
    router.get('/api/v1/monitors/risks/:id/history', '查询监控风险状态历史', tags, (request) => this.listRiskStatusHistory(request));
    router.get('/api/v1/monitors/probe-results', '查询监控探测结果', tags, (request) => this.listProbeResults(request));
    router.get('/api/v1/monitors/certificate-observations', '查询实测证书变更历史', tags, (request) => this.listCertificateObservations(request));
    router.get('/api/v1/monitors/dashboard', '查询监控仪表盘聚合', tags, (request) => this.getDashboard(request));
    router.post('/api/v1/monitors/alert-rules', '创建监控告警规则', tags, (request) => this.createAlertRule(request));
    router.get('/api/v1/monitors/alert-rules', '查询监控告警规则', tags, (request) => this.listAlertRules(request));
  }

  private async listTargets(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'monitor.target.read', 'monitor_target');
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['createdAt', 'updatedAt', 'intervalSeconds', 'status'],
      allowedFilterFields: ['serviceAssetId', 'assetId', 'status'],
      defaultPageSize: 200,
      maxPageSize: 500,
    });
    const includeRemoved = ['1', 'true'].includes((readOptionalQueryString(request, 'includeRemoved') ?? '').toLowerCase());
    const page = await this.service.listMonitorTargets({
      tenantId: security.tenantId,
      ...query,
      includeRemoved,
    });
    const authorizedItems = await filterAuthorizedItems(security, page.items, 'monitor_target', 'read');
    if (!includeRemoved) return { ...page, items: authorizedItems };
    // 中文说明：对象权限的业务投影只覆盖活动对象；已删除目标没有活动资产成员可供投影。
    // includeRemoved 是显式的历史查询，目标已经按当前租户过滤，保留这些归档记录供审计查看。
    const authorizedIds = new Set(authorizedItems.map((item) => item.id));
    const removedItems = page.items.filter((item) => item.deletedAt && !authorizedIds.has(item.id));
    return { ...page, items: [...authorizedItems, ...removedItems] };
  }

  private async createTarget(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'monitor.target.create', 'monitor_target');
    const body = validateObject(request.body ?? {}, {
      serviceAssetId: { type: 'string' },
      assetId: { type: 'string' },
      metrics: { type: 'array' },
      intervalSeconds: { type: 'number', required: true },
      status: { type: 'string', enum: monitorTargetStatuses },
    });
    const serviceAssetId = String(body.serviceAssetId ?? body.assetId ?? '').trim();
    if (!serviceAssetId) throw new AppError('VALIDATION_FAILED', '字段不能为空', { field: 'serviceAssetId' });
    await assertRouteObjectAccess(security, 'read', { objectType: 'service_asset', objectId: serviceAssetId, tenantId: security.tenantId });
    return {
      statusCode: 201,
      body: await this.service.createMonitorTarget({
        tenantId: security.tenantId,
        serviceAssetId,
        metrics: readMetrics(body.metrics),
        intervalSeconds: Number(body.intervalSeconds),
        status: readTargetStatus(body.status),
        createdBy: security.subject.id,
      }),
    };
  }

  private async updateTarget(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const body = validateObject(request.body ?? {}, {
      id: { type: 'string', required: true },
      metrics: { type: 'array' },
      intervalSeconds: { type: 'number' },
      status: { type: 'string', enum: monitorTargetStatuses },
    });
    const current = await this.service.getMonitorTarget(security.tenantId, String(body.id));
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', '监控目标不存在', { monitorTargetId: body.id });
    await assertRouteAction(security, 'monitor.target.update', 'monitor_target', { resourceId: current.id });
    await assertRouteObjectAccess(security, 'edit', { objectType: 'monitor_target', objectId: current.id, tenantId: security.tenantId });
    return this.service.updateMonitorTarget({
      tenantId: security.tenantId,
      id: String(body.id),
      metrics: readMetrics(body.metrics),
      intervalSeconds: body.intervalSeconds === undefined ? undefined : Number(body.intervalSeconds),
      status: readTargetStatus(body.status),
    });
  }

  private async deleteTarget(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const body = validateObject(request.body ?? {}, {
      id: { type: 'string', required: true },
    });
    const current = await this.service.getMonitorTarget(security.tenantId, String(body.id));
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', '监控目标不存在', { monitorTargetId: body.id });
    await assertRouteAction(security, 'monitor.target.delete', 'monitor_target', { resourceId: current.id });
    await assertRouteObjectAccess(security, 'control', { objectType: 'monitor_target', objectId: current.id, tenantId: security.tenantId });
    return this.service.deleteMonitorTarget(security.tenantId, String(body.id));
  }

  private async scan(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'monitor.risk.scan', 'monitor_risk');
    const body = validateObject(request.body ?? {}, {
      certificateExpiringThresholdDays: { type: 'number' },
      scanStartedAt: { type: 'string' },
    });
    return {
      statusCode: 201,
      body: await this.service.collectRisks({
        tenantId: security.tenantId,
        certificateExpiringThresholdDays: body.certificateExpiringThresholdDays === undefined ? undefined : Number(body.certificateExpiringThresholdDays),
        scanStartedAt: body.scanStartedAt === undefined ? undefined : String(body.scanStartedAt),
      }),
    };
  }

  private async probe(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'monitor.target.control', 'monitor_target');
    const body = validateObject(request.body ?? {}, {
      monitorTargetId: { type: 'string' },
      serviceAssetId: { type: 'string', required: true },
      timeoutMs: { type: 'number' },
    });
    if (typeof body.monitorTargetId === 'string' && body.monitorTargetId.trim() !== '') {
      const target = await this.service.getMonitorTarget(security.tenantId, String(body.monitorTargetId));
      if (!target) throw new AppError('RESOURCE_NOT_FOUND', '监控目标不存在', { monitorTargetId: body.monitorTargetId });
      await assertRouteObjectAccess(security, 'control', { objectType: 'monitor_target', objectId: target.id, tenantId: security.tenantId });
    }
    await assertRouteObjectAccess(security, 'read', { objectType: 'service_asset', objectId: String(body.serviceAssetId), tenantId: security.tenantId });
    return {
      statusCode: 200,
      body: await this.service.probeServiceAsset({
        tenantId: security.tenantId,
        monitorTargetId: body.monitorTargetId === undefined ? undefined : String(body.monitorTargetId),
        serviceAssetId: String(body.serviceAssetId),
        timeoutMs: body.timeoutMs === undefined ? undefined : Number(body.timeoutMs),
      }),
    };
  }

  private async listRisks(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'monitor.risk.read', 'monitor_risk');
    const items = await this.service.listRiskEvents({
      tenantId: security.tenantId,
      status: readOptionalQueryString(request, 'status') as typeof RiskStatuses[number] | undefined,
      severity: readOptionalQueryString(request, 'severity') as typeof severity[number] | undefined,
      type: readOptionalQueryString(request, 'type') as typeof riskEventTypes[number] | undefined,
    });
    const authorizedItems = await filterAuthorizedItems(security, items, 'monitor_risk', 'read');
    return {
      items: authorizedItems,
      page: 1,
      pageSize: 200,
      total: authorizedItems.length,
    };
  }

  private async changeRiskStatus(request: HttpRequest, action: Exclude<RiskStatusAction, 'created'>) {
    const security = requireRouteSecurity(request, this.security);
    const body = validateObject(request.body ?? {}, {
      reason: { type: 'string' },
      metadata: { type: 'object' },
      occurredAt: { type: 'string' },
    });
    const risk = await this.service.getRiskEvent(security.tenantId, readRiskEventId(request));
    if (!risk) throw new AppError('RESOURCE_NOT_FOUND', '监控风险不存在', { riskEventId: readRiskEventId(request) });
    await assertRouteAction(security, 'monitor.risk.update', 'monitor_risk', { resourceId: risk.id });
    await assertRouteObjectAccess(security, 'control', { objectType: 'monitor_risk', objectId: risk.id, tenantId: security.tenantId });
    return this.service.changeRiskStatus({
      tenantId: security.tenantId,
      riskEventId: risk.id,
      action,
      reason: typeof body.reason === 'string' ? body.reason.trim() || undefined : undefined,
      metadata: body.metadata as Record<string, unknown> | undefined,
      actorType: 'user',
      actorId: security.subject.id,
      occurredAt: typeof body.occurredAt === 'string' ? body.occurredAt : undefined,
    });
  }

  private async listRiskStatusHistory(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const risk = await this.service.getRiskEvent(security.tenantId, readRiskEventId(request));
    if (!risk) throw new AppError('RESOURCE_NOT_FOUND', '监控风险不存在', { riskEventId: readRiskEventId(request) });
    await assertRouteAction(security, 'monitor.risk.read', 'monitor_risk', { resourceId: risk.id });
    await assertRouteObjectAccess(security, 'read', { objectType: 'monitor_risk', objectId: risk.id, tenantId: security.tenantId });
    return {
      items: await this.service.listRiskStatusHistory(security.tenantId, risk.id),
    };
  }

  private async listProbeResults(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'monitor.target.read', 'monitor_target');
    const monitorTargetId = readOptionalQueryString(request, 'monitorTargetId') ?? readOptionalQueryString(request, 'filter[monitorTargetId]');
    if (monitorTargetId) {
      const target = await this.service.getMonitorTarget(security.tenantId, monitorTargetId);
      if (!target) throw new AppError('RESOURCE_NOT_FOUND', '监控目标不存在', { monitorTargetId });
      await assertRouteObjectAccess(security, 'read', { objectType: 'monitor_target', objectId: target.id, tenantId: security.tenantId });
    }
    const items = await this.service.listMonitorProbeResults({
      tenantId: security.tenantId,
      monitorTargetId,
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

  private async listCertificateObservations(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'monitor.target.read', 'monitor_target');
    const serviceAssetId = readOptionalQueryString(request, 'serviceAssetId') ?? readOptionalQueryString(request, 'filter[serviceAssetId]');
    const includeRemoved = ['1', 'true'].includes((readOptionalQueryString(request, 'includeRemoved') ?? '').toLowerCase());
    if (serviceAssetId && !includeRemoved) {
      await assertRouteObjectAccess(security, 'read', { objectType: 'service_asset', objectId: serviceAssetId, tenantId: security.tenantId });
    }
    const items = await this.service.listCertificateObservations({
      tenantId: security.tenantId,
      serviceAssetId,
      pageSize: Number(readOptionalQueryString(request, 'pageSize') ?? 200),
      includeRemoved,
    });
    return {
      items,
      page: 1,
      pageSize: 200,
      total: items.length,
    };
  }

  private async getDashboard(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'monitor.dashboard.read', 'monitor_dashboard');
    return this.service.getDashboard(security.tenantId);
  }

  private async createAlertRule(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'monitor.alert_rule.create', 'monitor_alert_rule');
    const body = validateObject(request.body, {
      name: { type: 'string', required: true },
      threshold: { type: 'object', required: true },
      scope: { type: 'object' },
      status: { type: 'string', enum: alertRuleStatuses },
      silence: { type: 'object' },
    });
    return {
      statusCode: 201,
      body: await this.service.createAlertRule({
        name: String(body.name),
        threshold: body.threshold as { metric: 'count'; operator: 'gte'; value: number },
        scope: body.scope as any,
        status: body.status as any,
        silence: body.silence as any,
        createdBy: security.subject.id,
      }),
    };
  }

  private async listAlertRules(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'monitor.alert_rule.read', 'monitor_alert_rule');
    const items = await filterAuthorizedItems(security, await this.service.listAlertRules(security.tenantId), 'monitor_alert_rule', 'read');
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

function tenantId(request: HttpRequest): string {
  return requireTenantId(request);
}

function requiredTenantId(request: HttpRequest): string {
  return requireTenantId(request);
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
    { method: 'POST', path: '/api/v1/monitors/risks/:id/acknowledge', operationId: 'acknowledgeMonitorRisk', summary: '确认监控风险事件', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/monitors/risks/:id/suppress', operationId: 'suppressMonitorRisk', summary: '抑制监控风险事件', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/monitors/risks/:id/ignore', operationId: 'ignoreMonitorRisk', summary: '忽略监控风险事件', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/monitors/risks/:id/resolve', operationId: 'resolveMonitorRisk', summary: '解决监控风险事件', tags, responseSchema: objectSchema() },
    { method: 'POST', path: '/api/v1/monitors/risks/:id/reopen', operationId: 'reopenMonitorRisk', summary: '重新打开监控风险事件', tags, responseSchema: objectSchema() },
    { method: 'GET', path: '/api/v1/monitors/risks/:id/history', operationId: 'listMonitorRiskStatusHistory', summary: '查询监控风险状态历史', tags, responseSchema: objectSchema() },
    { method: 'GET', path: '/api/v1/monitors/probe-results', operationId: 'listMonitorProbeResults', summary: '查询监控探测结果', tags, responseSchema: pageSchema() },
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

function readRiskEventId(request: HttpRequest): string {
  const riskEventId = request.path.match(/^\/api\/v1\/monitors\/risks\/([^/]+)\/(?:acknowledge|suppress|ignore|resolve|reopen|history)$/)?.[1];
  if (!riskEventId) throw new AppError('VALIDATION_FAILED', 'riskEventId 不能为空', { field: 'riskEventId' });
  return riskEventId;
}
