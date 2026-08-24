import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import { requireTenantId } from '../../../common/http/tenant-context.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import type { SecuritySubject } from '../../../shared/security-types.js';
import { AUDIT_EVENT_TYPES } from '../../audits/audit-event-types.js';
import type { SecurityServices } from '../../security/security.controller.js';
import { AutomationsApplicationService } from '../application/automations.application-service.js';
import type { AutomationRunCoordinator } from '../application/automation-run-coordinator.js';
import type { CreateAutomationInput, UpdateAutomationInput } from '../dto/automations.dto.js';
import { automationPublicSchema } from '../schema/automations.schema.js';

const tags = ['Automations'];

export class AutomationsController {
  constructor(private readonly service = new AutomationsApplicationService(), private readonly security?: SecurityServices, private readonly coordinator?: AutomationRunCoordinator) {}

  register(router: Router): void {
    router.get('/api/v1/automations', '列出自动化', tags, (request) => this.list(request));
    router.post('/api/v1/automations', '创建自动化', tags, (request) => this.create(request));
    router.get('/api/v1/automations/:id', '获取自动化', tags, (request) => this.get(request));
    router.patch('/api/v1/automations/:id', '更新自动化', tags, (request) => this.update(request));
    router.post('/api/v1/automations/:id/actions/copy', '复制自动化', tags, (request) => this.copy(request));
    router.post('/api/v1/automations/:id/actions/enable', '启用自动化', tags, (request) => this.changeStatus(request, 'enable'));
    router.post('/api/v1/automations/:id/actions/disable', '停用自动化', tags, (request) => this.changeStatus(request, 'disable'));
    router.delete('/api/v1/automations/:id', '删除自动化', tags, (request) => this.remove(request));
    router.post('/api/v1/automations/:id/preview', '预览自动化目标', tags, (request) => this.preview(request));
    router.post('/api/v1/automations/:id/runs', '按需执行自动化', tags, (request) => this.createRun(request));
    router.get('/api/v1/automation-runs', '列出自动化运行', tags, (request) => this.listRuns(request));
    router.get('/api/v1/automation-runs/:id', '获取自动化运行', tags, (request) => this.getRun(request));
    router.get('/api/v1/automation-runs/:id/targets', '列出自动化运行目标', tags, (request) => this.listRunTargets(request));
    router.post('/api/v1/automation-runs/:id/actions/stop', '停止自动化运行', tags, (request) => this.stopRun(request));
    router.post('/api/v1/automation-runs/:id/actions/retry-failed', '重试自动化失败目标', tags, (request) => this.retryRun(request));
  }

  private async preview(request: HttpRequest) {
    const id = pathId(request);
    const subject = this.subject(request);
    await this.assertCan(subject, 'automation.execute', request, id);
    const body = request.body as { page?: number; pageSize?: number } | undefined;
    return this.service.preview(this.tenantId(request), subject.id, id, body?.page, body?.pageSize);
  }

  private async createRun(request: HttpRequest) {
    const id = pathId(request);
    const subject = this.subject(request);
    await this.assertCan(subject, 'automation.execute', request, id);
    const body = request.body as { idempotencyKey?: string; expectedVersion?: number };
    if (!body?.idempotencyKey || !Number.isInteger(body.expectedVersion)) throw new AppError('VALIDATION_FAILED', '按需运行必须提供幂等键和期望版本');
    const idempotencyKey = body.idempotencyKey;
    const expectedVersion = Number(body.expectedVersion);
    const run = await this.service.createOnDemandRun(this.tenantId(request), subject.id, id, idempotencyKey, expectedVersion);
    await this.audit(request, subject, AUDIT_EVENT_TYPES.AUTOMATION_EXECUTED, 'automation.execute', run.id, undefined, run);
    return { statusCode: 201, body: run };
  }

  private async list(request: HttpRequest) {
    const subject = this.subject(request);
    await this.assertCan(subject, 'automation.read', request);
    return { items: await this.service.list(this.tenantId(request)) };
  }

  private async listRuns(request: HttpRequest) {
    const subject = this.subject(request); await this.assertCan(subject, 'automation.read', request);
    return { items: await this.service.listRuns(this.tenantId(request), singleQuery(request.query.automationId)) };
  }

  private async getRun(request: HttpRequest) {
    const id = runPathId(request); const subject = this.subject(request); await this.assertCan(subject, 'automation.read', request, id);
    const run = await this.service.getRun(this.tenantId(request), id);
    if (!run) throw new AppError('RESOURCE_NOT_FOUND', '自动化运行不存在', { id });
    return { ...run, actionResults: await this.service.listRunActionResults(this.tenantId(request), id) };
  }

  private async listRunTargets(request: HttpRequest) {
    const id = runPathId(request); const subject = this.subject(request); await this.assertCan(subject, 'automation.read', request, id);
    return { items: await this.service.listRunTargets(this.tenantId(request), id) };
  }

  private async stopRun(request: HttpRequest) {
    if (!this.coordinator) throw new Error('automation coordinator is not configured');
    const id = runPathId(request); const subject = this.subject(request); await this.assertCan(subject, 'automation.stop', request, id);
    const run = await this.coordinator.stop(id, this.tenantId(request));
    await this.audit(request, subject, AUDIT_EVENT_TYPES.AUTOMATION_STOPPED, 'automation.stop', id, undefined, run);
    return run;
  }

  private async retryRun(request: HttpRequest) {
    if (!this.coordinator) throw new Error('automation coordinator is not configured');
    const id = runPathId(request); const subject = this.subject(request); await this.assertCan(subject, 'automation.retry', request, id);
    const key = String((request.body as { idempotencyKey?: string })?.idempotencyKey ?? '');
    if (!key) throw new AppError('VALIDATION_FAILED', '重试必须提供幂等键');
    const run = await this.coordinator.retryFailed(id, this.tenantId(request), subject.id, key);
    await this.audit(request, subject, AUDIT_EVENT_TYPES.AUTOMATION_RETRIED, 'automation.retry', run.id, { parentRunId: id }, run);
    return { statusCode: 201, body: run };
  }

  private async get(request: HttpRequest) {
    const id = pathId(request);
    const subject = this.subject(request);
    await this.assertCan(subject, 'automation.read', request, id);
    return this.service.get(this.tenantId(request), id);
  }

  private async create(request: HttpRequest) {
    const subject = this.subject(request);
    await this.assertCan(subject, 'automation.create', request);
    const created = await this.service.create(this.tenantId(request), subject.id, request.body as CreateAutomationInput);
    await this.audit(request, subject, AUDIT_EVENT_TYPES.AUTOMATION_CREATED, 'automation.create', created.id, undefined, created);
    return { statusCode: 201, body: created };
  }

  private async update(request: HttpRequest) {
    const id = pathId(request);
    const subject = this.subject(request);
    await this.assertCan(subject, 'automation.update', request, id);
    const before = await this.service.get(this.tenantId(request), id);
    const updated = await this.service.update(this.tenantId(request), subject.id, id, request.body as UpdateAutomationInput);
    await this.audit(request, subject, AUDIT_EVENT_TYPES.AUTOMATION_UPDATED, 'automation.update', id, before, updated);
    return updated;
  }

  private async copy(request: HttpRequest) {
    const id = pathId(request);
    const subject = this.subject(request);
    await this.assertCan(subject, 'automation.create', request, id);
    const copied = await this.service.copy(this.tenantId(request), subject.id, id);
    await this.audit(request, subject, AUDIT_EVENT_TYPES.AUTOMATION_COPIED, 'automation.create', copied.id, { sourceId: id }, copied);
    return { statusCode: 201, body: copied };
  }

  private async changeStatus(request: HttpRequest, action: 'enable' | 'disable') {
    const id = pathId(request);
    const subject = this.subject(request);
    await this.assertCan(subject, 'automation.update', request, id);
    const before = await this.service.get(this.tenantId(request), id);
    const expectedVersion = Number((request.body as { expectedVersion?: number })?.expectedVersion);
    const updated = action === 'enable'
      ? await this.service.enable(this.tenantId(request), id, expectedVersion)
      : await this.service.disable(this.tenantId(request), id, expectedVersion);
    await this.audit(request, subject, action === 'enable' ? AUDIT_EVENT_TYPES.AUTOMATION_ENABLED : AUDIT_EVENT_TYPES.AUTOMATION_DISABLED, 'automation.update', id, before, updated);
    return updated;
  }

  private async remove(request: HttpRequest) {
    const id = pathId(request);
    const subject = this.subject(request);
    await this.assertCan(subject, 'automation.delete', request, id);
    const before = await this.service.get(this.tenantId(request), id);
    const expectedVersion = Number((request.body as { expectedVersion?: number })?.expectedVersion ?? request.query.expectedVersion);
    const deleted = await this.service.delete(this.tenantId(request), id, expectedVersion);
    await this.audit(request, subject, AUDIT_EVENT_TYPES.AUTOMATION_DELETED, 'automation.delete', id, before, deleted);
    return deleted;
  }

  private subject(request: HttpRequest): SecuritySubject {
    if (!this.security) return { id: request.context.actorId ?? 'system_automations', type: 'system', scope: { tenantId: request.context.tenantId, tenantScope: request.context.tenantScope } };
    if (!request.context.actorId) throw new AppError('AUTH_UNAUTHENTICATED', '缺少 actor 上下文');
    return { id: request.context.actorId, type: 'user', scope: { tenantId: request.context.tenantId, tenantScope: request.context.tenantScope } };
  }

  private tenantId(request: HttpRequest): string {
    return requireTenantId(request);
  }

  private assertCan(subject: SecuritySubject, action: string, request: HttpRequest, id?: string): Promise<void> {
    if (!this.security) return Promise.resolve();
    return this.security.rbac.assertCan(subject, action, { type: 'automation', id, scope: { tenantId: this.tenantId(request), tenantScope: request.context.tenantScope, ownerId: subject.id } }, {
      requestId: request.context.requestId, sourceIp: request.context.ip, actor: subject,
    });
  }

  private async audit(request: HttpRequest, subject: SecuritySubject, eventType: string, action: string, id: string, before: unknown, after: unknown): Promise<void> {
    await this.security?.audit.write({
      eventType, actorType: subject.type === 'system' ? 'system' : 'user', actorId: subject.id, action,
      resourceType: 'automation', resourceId: id, result: 'success', riskLevel: action === 'automation.delete' ? 'high' : 'medium',
      context: { requestId: request.context.requestId, sourceIp: request.context.ip, actor: subject }, detail: { before, after },
      failClosed: true,
    });
  }
}

function pathId(request: HttpRequest): string {
  const id = request.path.match(/^\/api\/v1\/automations\/([^/]+)/)?.[1];
  if (!id) throw new AppError('VALIDATION_FAILED', '缺少自动化 ID');
  return decodeURIComponent(id);
}

export function getAutomationRouteContracts(): RouteContract[] {
  return [
    ['GET', '/api/v1/automations', 'listAutomations', '列出自动化'],
    ['POST', '/api/v1/automations', 'createAutomation', '创建自动化'],
    ['GET', '/api/v1/automations/:id', 'getAutomation', '获取自动化'],
    ['PATCH', '/api/v1/automations/:id', 'updateAutomation', '更新自动化'],
    ['POST', '/api/v1/automations/:id/actions/copy', 'copyAutomation', '复制自动化'],
    ['POST', '/api/v1/automations/:id/actions/enable', 'enableAutomation', '启用自动化'],
    ['POST', '/api/v1/automations/:id/actions/disable', 'disableAutomation', '停用自动化'],
    ['DELETE', '/api/v1/automations/:id', 'deleteAutomation', '删除自动化'],
    ['POST', '/api/v1/automations/:id/preview', 'previewAutomation', '预览自动化目标'],
    ['POST', '/api/v1/automations/:id/runs', 'createAutomationRun', '按需执行自动化'],
    ['GET', '/api/v1/automation-runs', 'listAutomationRuns', '列出自动化运行'],
    ['GET', '/api/v1/automation-runs/:id', 'getAutomationRun', '获取自动化运行'],
    ['GET', '/api/v1/automation-runs/:id/targets', 'listAutomationRunTargets', '列出自动化运行目标'],
    ['POST', '/api/v1/automation-runs/:id/actions/stop', 'stopAutomationRun', '停止自动化运行'],
    ['POST', '/api/v1/automation-runs/:id/actions/retry-failed', 'retryAutomationRun', '重试自动化失败目标'],
  ].map(([method, path, operationId, summary]) => ({ method: method as RouteContract['method'], path, operationId, summary, tags, responseSchema: automationPublicSchema }));
}

function runPathId(request: HttpRequest): string {
  const id = request.path.match(/^\/api\/v1\/automation-runs\/([^/]+)/)?.[1];
  if (!id) throw new AppError('VALIDATION_FAILED', '缺少自动化运行 ID');
  return decodeURIComponent(id);
}

function singleQuery(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value; }
