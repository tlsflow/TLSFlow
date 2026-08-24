import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import type { SecuritySubject } from '../../../shared/security-types.js';
import type { SecurityServices } from '../../security/security.controller.js';
import { ReportsApplicationService } from '../application/reports.application-service.js';
import { ReportExportService } from '../application/report-export.service.js';
import { reportTypes, type AutomationFailureStage, type ReportQuery, type ReportType } from '../schema/reports.schema.js';

const tags = ['Reports'];

export class ReportsController {
  constructor(private readonly service: ReportsApplicationService, private readonly security?: SecurityServices, private readonly exports?: ReportExportService) {}

  register(router: Router): void {
    for (const [path, type] of reportPaths) {
      router.get(`/api/v1/reports/${path}/overview`, `查询${path}报表摘要`, tags, (request) => this.overview(request, type));
      router.get(`/api/v1/reports/${path}/trends`, `查询${path}报表趋势`, tags, (request) => this.trends(request, type));
      router.get(`/api/v1/reports/${path}/items`, `查询${path}报表明细`, tags, (request) => this.items(request, type));
    }
    router.post('/api/v1/report-runs', '创建报表导出运行', tags, (request) => this.createReportRun(request));
    router.get('/api/v1/report-runs', '查询报表导出运行', tags, (request) => this.listReportRuns(request));
    router.get('/api/v1/report-runs/:id', '查询报表导出运行详情', tags, (request) => this.getReportRun(request));
    router.get('/api/v1/report-runs/:id/download', '下载报表 CSV', tags, (request) => this.downloadReportRun(request));
  }

  private async overview(request: HttpRequest, type: ReportType) {
    const subject = await this.authorize(request);
    return this.service.overview(type, parseReportQuery(request), subject);
  }

  private async trends(request: HttpRequest, type: ReportType) {
    await this.authorize(request);
    return this.service.trends(type, parseReportQuery(request));
  }

  private async items(request: HttpRequest, type: ReportType) {
    const subject = await this.authorize(request);
    return this.service.items(type, parseReportQuery(request), subject, readQuery(request, 'metricKey'));
  }

  private async authorize(request: HttpRequest): Promise<SecuritySubject> {
    const actorId = request.context.actorId;
    if (!actorId) throw new AppError('AUTH_UNAUTHENTICATED', '缺少 actor 上下文');
    const subject: SecuritySubject = { id: actorId, type: 'user', scope: { tenantId: request.context.tenantId } };
    await this.security?.rbac.assertCan(subject, 'report.read', { type: 'report', scope: subject.scope }, { requestId: request.context.requestId });
    return subject;
  }

  private async authorizeExport(request: HttpRequest): Promise<SecuritySubject> {
    const subject = await this.authorize(request);
    await this.security?.rbac.assertCan(subject, 'report.export', { type: 'report', scope: subject.scope }, { requestId: request.context.requestId });
    return subject;
  }

  private async createReportRun(request: HttpRequest) {
    if (!this.exports) throw new AppError('SYSTEM_INTERNAL_ERROR', '报表导出服务未配置');
    const subject = await this.authorizeExport(request);
    const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body as Record<string, unknown> : {};
    const reportType = String(body.reportType ?? '') as ReportType;
    if (!reportTypes.includes(reportType)) throw new AppError('VALIDATION_FAILED', 'reportType 不合法', { reportType });
    const timeZone = String(body.timeZone ?? '').trim();
    if (!timeZone) throw new AppError('VALIDATION_FAILED', 'timeZone 不能为空');
    const query = parseReportQuery({ ...request, query: toQuery(body.filters) });
    const run = await this.exports.create({ reportType, query, subject, timeZone, columns: Array.isArray(body.columns) ? body.columns.map(String) : undefined });
    await this.security?.audit.write({ eventType: 'report.export.created', actorType: 'user', actorId: subject.id, action: 'report.export', resourceType: 'reportRun', resourceId: run.id, result: 'success', riskLevel: 'medium', detail: { reportType, timeZone, dataAsOf: run.dataAsOf }, context: { requestId: request.context.requestId } });
    return { statusCode: run.status === 'queued' ? 202 : 201, body: run };
  }

  private async listReportRuns(request: HttpRequest) {
    if (!this.exports) throw new AppError('SYSTEM_INTERNAL_ERROR', '报表导出服务未配置');
    await this.authorizeExport(request);
    return { items: await this.exports.list(requiredTenantId(request)) };
  }

  private async getReportRun(request: HttpRequest) {
    if (!this.exports) throw new AppError('SYSTEM_INTERNAL_ERROR', '报表导出服务未配置');
    await this.authorizeExport(request);
    return this.exports.get(requiredTenantId(request), readReportRunId(request));
  }

  private async downloadReportRun(request: HttpRequest) {
    if (!this.exports) throw new AppError('SYSTEM_INTERNAL_ERROR', '报表导出服务未配置');
    const subject = await this.authorizeExport(request);
    const result = await this.exports.download(requiredTenantId(request), readReportRunId(request));
    await this.security?.audit.write({ eventType: 'report.export.downloaded', actorType: 'user', actorId: subject.id, action: 'report.download', resourceType: 'reportRun', resourceId: result.run.id, result: 'success', riskLevel: 'medium', detail: { artifactId: result.artifact.id, checksumSha256: result.artifact.checksumSha256 }, context: { requestId: request.context.requestId } });
    return { statusCode: 200, headers: { 'content-type': result.artifact.contentType, 'content-disposition': `attachment; filename="${result.artifact.fileName.replaceAll('"', '')}"` }, body: result.content };
  }
}

const reportPaths = [
  ['incident-window', 'incident_window'],
  ['risk-response', 'risk_response'],
  ['automation-effectiveness', 'automation_effectiveness'],
] as const satisfies ReadonlyArray<readonly [string, ReportType]>;

function parseReportQuery(request: HttpRequest): ReportQuery {
  const tenantId = request.context.tenantId;
  if (!tenantId) throw new AppError('VALIDATION_FAILED', 'tenantId 不能为空');
  const now = new Date();
  const dateTo = readQuery(request, 'dateTo') ?? now.toISOString();
  const dateFrom = readQuery(request, 'dateFrom') ?? new Date(Date.parse(dateTo) - 30 * 86_400_000).toISOString();
  const asOf = readQuery(request, 'asOf') ?? dateTo;
  const rangeMs = Date.parse(dateTo) - Date.parse(dateFrom);
  if (![dateFrom, dateTo, asOf].every((value) => Number.isFinite(Date.parse(value)))) throw new AppError('VALIDATION_FAILED', '报表时间格式不合法');
  if (rangeMs < 0 || rangeMs > 90 * 86_400_000) throw new AppError('VALIDATION_FAILED', '报表时间范围必须在 0 到 90 天内');
  const page = positiveInt(readQuery(request, 'page'), 1, 10_000);
  const pageSize = positiveInt(readQuery(request, 'pageSize'), 100, 500);
  const failureStage = readQuery(request, 'failureStage') as AutomationFailureStage | undefined;
  const allowedStages = ['selection', 'plan_creation', 'dry_run', 'approval', 'execution', 'verification', 'rollback', 'notification'];
  if (failureStage && !allowedStages.includes(failureStage)) throw new AppError('VALIDATION_FAILED', 'failureStage 不合法', { failureStage });
  return {
    tenantId, dateFrom, dateTo, asOf, page, pageSize, failureStage, metricKey: readQuery(request, 'metricKey'),
    environment: readQuery(request, 'environment'), ownerId: readQuery(request, 'ownerId'), assetId: readQuery(request, 'assetId'),
    tag: readQuery(request, 'tag'), severity: readQuery(request, 'severity'), riskType: readQuery(request, 'riskType'), automationId: readQuery(request, 'automationId'),
  };
}

function readQuery(request: HttpRequest, key: string): string | undefined { const value = request.query[key]; return Array.isArray(value) ? value[0] : value; }
function positiveInt(value: string | undefined, fallback: number, max: number): number { const parsed = Number(value ?? fallback); if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) throw new AppError('VALIDATION_FAILED', '分页参数不合法', { value, max }); return parsed; }
function toQuery(value: unknown): HttpRequest['query'] { const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; return Object.fromEntries(Object.entries(record).filter(([, item]) => item !== undefined && item !== null).map(([key, item]) => [key, Array.isArray(item) ? item.map(String) : String(item)])); }
function requiredTenantId(request: HttpRequest): string { if (!request.context.tenantId) throw new AppError('VALIDATION_FAILED', 'tenantId 不能为空'); return request.context.tenantId; }
function readReportRunId(request: HttpRequest): string { const id = request.path.match(/^\/api\/v1\/report-runs\/([^/]+)(?:\/download)?$/)?.[1]; if (!id) throw new AppError('VALIDATION_FAILED', 'reportRunId 不能为空'); return id; }

export function getReportRouteContracts(): RouteContract[] {
  return [...reportPaths.flatMap(([path, type]) => [
    contract('GET', `/api/v1/reports/${path}/overview`, `get${pascal(type)}Overview`),
    contract('GET', `/api/v1/reports/${path}/trends`, `get${pascal(type)}Trends`),
    contract('GET', `/api/v1/reports/${path}/items`, `get${pascal(type)}Items`),
  ]),
  contract('POST', '/api/v1/report-runs', 'createReportRun'),
  contract('GET', '/api/v1/report-runs', 'listReportRuns'),
  contract('GET', '/api/v1/report-runs/:id', 'getReportRun'),
  contract('GET', '/api/v1/report-runs/:id/download', 'downloadReportRun')];
}

function contract(method: 'GET' | 'POST', path: string, operationId: string): RouteContract { return { method, path, operationId, summary: '运营报表接口', tags, responseSchema: { type: 'object', additionalProperties: true } }; }
function pascal(value: ReportType): string { return value.split('_').map((part) => part[0]!.toUpperCase() + part.slice(1)).join(''); }
