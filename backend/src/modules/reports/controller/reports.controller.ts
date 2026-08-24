import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import type { SecuritySubject } from '../../../shared/security-types.js';
import type { SecurityServices } from '../../security/security.controller.js';
import { ReportsApplicationService } from '../application/reports.application-service.js';
import { reportTypes, type AutomationFailureStage, type ReportQuery, type ReportType } from '../schema/reports.schema.js';

const tags = ['Reports'];

export class ReportsController {
  constructor(private readonly service: ReportsApplicationService, private readonly security?: SecurityServices) {}

  register(router: Router): void {
    for (const [path, type] of reportPaths) {
      router.get(`/api/v1/reports/${path}/overview`, `查询${path}报表摘要`, tags, (request) => this.overview(request, type));
      router.get(`/api/v1/reports/${path}/trends`, `查询${path}报表趋势`, tags, (request) => this.trends(request, type));
      router.get(`/api/v1/reports/${path}/items`, `查询${path}报表明细`, tags, (request) => this.items(request, type));
    }
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
    tenantId, dateFrom, dateTo, asOf, page, pageSize, failureStage,
    environment: readQuery(request, 'environment'), ownerId: readQuery(request, 'ownerId'), assetId: readQuery(request, 'assetId'),
    severity: readQuery(request, 'severity'), riskType: readQuery(request, 'riskType'), automationId: readQuery(request, 'automationId'),
  };
}

function readQuery(request: HttpRequest, key: string): string | undefined { const value = request.query[key]; return Array.isArray(value) ? value[0] : value; }
function positiveInt(value: string | undefined, fallback: number, max: number): number { const parsed = Number(value ?? fallback); if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) throw new AppError('VALIDATION_FAILED', '分页参数不合法', { value, max }); return parsed; }

export function getReportRouteContracts(): RouteContract[] {
  return reportPaths.flatMap(([path, type]) => [
    contract('GET', `/api/v1/reports/${path}/overview`, `get${pascal(type)}Overview`),
    contract('GET', `/api/v1/reports/${path}/trends`, `get${pascal(type)}Trends`),
    contract('GET', `/api/v1/reports/${path}/items`, `get${pascal(type)}Items`),
  ]);
}

function contract(method: 'GET', path: string, operationId: string): RouteContract { return { method, path, operationId, summary: '查询运营报表', tags, responseSchema: { type: 'object', additionalProperties: true } }; }
function pascal(value: ReportType): string { return value.split('_').map((part) => part[0]!.toUpperCase() + part.slice(1)).join(''); }
