import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import type { SecuritySubject } from '../../../shared/security-types.js';
import { AUDIT_EVENT_TYPES } from '../../audits/audit-event-types.js';
import type { SecurityServices } from '../../security/security.controller.js';
import { AutomationsApplicationService } from '../application/automations.application-service.js';
import type { CreateAutomationInput, UpdateAutomationInput } from '../dto/automations.dto.js';
import { automationPublicSchema } from '../schema/automations.schema.js';

const tags = ['Automations'];

export class AutomationsController {
  constructor(private readonly service = new AutomationsApplicationService(), private readonly security?: SecurityServices) {}

  register(router: Router): void {
    router.get('/api/v1/automations', '列出自动化', tags, (request) => this.list(request));
    router.post('/api/v1/automations', '创建自动化', tags, (request) => this.create(request));
    router.get('/api/v1/automations/:id', '获取自动化', tags, (request) => this.get(request));
    router.patch('/api/v1/automations/:id', '更新自动化', tags, (request) => this.update(request));
    router.post('/api/v1/automations/:id/actions/copy', '复制自动化', tags, (request) => this.copy(request));
    router.post('/api/v1/automations/:id/actions/enable', '启用自动化', tags, (request) => this.changeStatus(request, 'enable'));
    router.post('/api/v1/automations/:id/actions/disable', '停用自动化', tags, (request) => this.changeStatus(request, 'disable'));
    router.delete('/api/v1/automations/:id', '删除自动化', tags, (request) => this.remove(request));
  }

  private async list(request: HttpRequest) {
    const subject = this.subject(request);
    await this.assertCan(subject, 'automation.read', request);
    return { items: await this.service.list(this.tenantId(request)) };
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
    if (!this.security) return { id: request.context.actorId ?? 'system_automations', type: 'system', scope: { tenantId: request.context.tenantId } };
    if (!request.context.actorId) throw new AppError('AUTH_UNAUTHENTICATED', '缺少 actor 上下文');
    return { id: request.context.actorId, type: 'user', scope: { tenantId: request.context.tenantId } };
  }

  private tenantId(request: HttpRequest): string {
    return request.context.tenantId ?? 'tenant_default';
  }

  private assertCan(subject: SecuritySubject, action: string, request: HttpRequest, id?: string): Promise<void> {
    if (!this.security) return Promise.resolve();
    return this.security.rbac.assertCan(subject, action, { type: 'automation', id, scope: { tenantId: this.tenantId(request), ownerId: subject.id } }, {
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
  ].map(([method, path, operationId, summary]) => ({ method: method as RouteContract['method'], path, operationId, summary, tags, responseSchema: automationPublicSchema }));
}
