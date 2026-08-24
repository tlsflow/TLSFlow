import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import { requireTenantId } from '../../../common/http/tenant-context.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { pageResponseSchema } from '../../../common/openapi/schemas.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import type { NotificationsApplicationService } from '../application/notifications.application-service.js';
import { notificationChannelStatuses, notificationChannelTypes } from '../schema/notifications.schema.js';
import type { SecuritySubject } from '../../../shared/security-types.js';
import type { SecurityServices } from '../../security/security.controller.js';

const tags = ['Notifications'];

export class NotificationsController {
  constructor(private readonly service: NotificationsApplicationService, private readonly security?: SecurityServices) {}

  register(router: Router): void {
    router.get('/api/v1/notification-settings', '查询通知设置', tags, (request) => this.getSettings(request));
    router.patch('/api/v1/notification-settings', '更新通知设置', tags, (request) => this.updateSettings(request));
    router.get('/api/v1/notification-channels', '查询通知渠道', tags, (request) => this.service.listChannels(tenantId(request)));
    router.post('/api/v1/notification-channels', '创建通知渠道', tags, (request) => this.createChannel(request));
    router.patch('/api/v1/notification-channels/:id', '更新通知渠道', tags, (request) => this.updateChannel(request));
    router.delete('/api/v1/notification-channels/:id', '删除通知渠道', tags, (request) => this.deleteChannel(request));
    router.post('/api/v1/notification-channels/:id/actions/test', '测试通知渠道', tags, (request) => this.testChannel(request));
    router.post('/api/v1/notification-channels/:id/actions/enable', '启用通知渠道', tags, (request) => this.setChannelStatus(request, 'active'));
    router.post('/api/v1/notification-channels/:id/actions/disable', '停用通知渠道', tags, (request) => this.setChannelStatus(request, 'disabled'));
    router.get('/api/v1/notification-routes', '查询通知路由', tags, (request) => this.service.listRoutes(tenantId(request)));
    router.post('/api/v1/notification-routes', '创建通知路由', tags, (request) => this.createRoute(request));
    router.patch('/api/v1/notification-routes/:id', '更新通知路由', tags, (request) => this.updateRoute(request));
    router.delete('/api/v1/notification-routes/:id', '删除通知路由', tags, (request) => this.deleteRoute(request));
    router.get('/api/v1/notification-templates', '查询通知模板', tags, (request) => this.service.listTemplates(tenantId(request)));
    router.post('/api/v1/notification-templates', '保存通知模板', tags, (request) => this.upsertTemplate(request));
    router.patch('/api/v1/notification-templates/:id', '更新通知模板', tags, (request) => this.upsertTemplate(request));
    router.get('/api/v1/notification-silences', '查询通知静默', tags, (request) => this.service.listSilences(tenantId(request)));
    router.post('/api/v1/notification-silences', '创建通知静默', tags, (request) => this.createSilence(request));
    router.patch('/api/v1/notification-silences/:id', '更新通知静默', tags, (request) => this.updateSilence(request));
    router.delete('/api/v1/notification-silences/:id', '删除通知静默', tags, (request) => this.deleteSilence(request));
    router.get('/api/v1/notification-requests', '查询通知请求', tags, (request) => this.service.listRequests(pageQuery(request)));
    router.get('/api/v1/notification-requests/:id', '查询通知请求详情', tags, (request) => this.requireRequest(request));
    router.get('/api/v1/notification-deliveries', '查询通知投递', tags, (request) => this.service.listDeliveries(pageQuery(request)));
    router.get('/api/v1/notification-deliveries/:id', '查询通知投递详情', tags, (request) => this.requireDelivery(request));
    router.post('/api/v1/notification-deliveries/:id/actions/retry', '重发失败通知', tags, (request) => this.service.retryDelivery(tenantId(request), pathId(request, 'notification-deliveries')));
  }

  private async getSettings(request: HttpRequest) {
    await this.assertCan(request, 'notification.channel.read', 'notificationChannel');
    return this.service.getSettings(tenantId(request));
  }

  private async updateSettings(request: HttpRequest) {
    await this.assertCan(request, 'settings.write', 'settings');
    const body = validateObject(request.body, {
      version: { type: 'number', required: true },
      wecomPrivateOrigins: { type: 'array', required: true },
      feishuPrivateOrigins: { type: 'array', required: true },
      dingtalkPrivateOrigins: { type: 'array', required: true },
    });
    const before = await this.service.getSettings(tenantId(request));
    const updated = await this.service.updateSettings({
      tenantId: tenantId(request),
      version: Number(body.version),
      updatedBy: request.context.actorId ?? 'system',
      privateOrigins: {
        wecom: asStrings(body.wecomPrivateOrigins),
        feishu: asStrings(body.feishuPrivateOrigins),
        dingtalk: asStrings(body.dingtalkPrivateOrigins),
      },
    });
    void this.security?.audit.write({
      eventType: 'notification.settings.updated',
      actorType: 'user',
      actorId: request.context.actorId ?? 'system',
      action: 'settings.write',
      resourceType: 'settings',
      resourceId: tenantId(request),
      result: 'success',
      riskLevel: 'medium',
      context: { requestId: request.context.requestId, sourceIp: request.context.ip, actor: this.subjectFromRequest(request) },
      detail: { before, after: updated },
    }).catch(() => undefined);
    return updated;
  }

  private async assertCan(request: HttpRequest, action: string, resourceType: string): Promise<void> {
    if (!this.security) return;
    const subject = this.subjectFromRequest(request);
    await this.security.rbac.assertCan(subject, action, {
      type: resourceType,
      scope: { tenantId: request.context.tenantId, ownerId: subject.id },
    }, { requestId: request.context.requestId, sourceIp: request.context.ip, actor: subject });
  }

  private subjectFromRequest(request: HttpRequest): SecuritySubject {
    if (!request.context.actorId) throw new AppError('AUTH_UNAUTHENTICATED', '缺少 actor 上下文');
    return { id: request.context.actorId, type: 'user', scope: { tenantId: request.context.tenantId } };
  }

  private createChannel(request: HttpRequest) {
    const body = validateObject(request.body, { name: { type: 'string', required: true }, type: { type: 'string', enum: notificationChannelTypes, required: true }, status: { type: 'string', enum: notificationChannelStatuses }, config: { type: 'object' }, secretRefs: { type: 'object' } });
    return this.service.createChannel({ tenantId: tenantId(request), name: String(body.name), type: body.type as never, status: body.status as never, config: asObject(body.config), secretRefs: asStringMap(body.secretRefs) });
  }

  private updateChannel(request: HttpRequest) {
    const body = validateObject(request.body, { version: { type: 'number', required: true }, name: { type: 'string' }, status: { type: 'string', enum: notificationChannelStatuses }, config: { type: 'object' }, secretRefs: { type: 'object' } });
    return this.service.updateChannel({ tenantId: tenantId(request), id: pathId(request, 'notification-channels'), version: Number(body.version), name: optionalString(body.name), status: body.status as never, config: body.config ? asObject(body.config) : undefined, secretRefs: body.secretRefs ? asStringMap(body.secretRefs) : undefined });
  }

  private deleteChannel(request: HttpRequest) { return this.service.deleteChannel(tenantId(request), pathId(request, 'notification-channels'), requiredVersion(request)); }
  private setChannelStatus(request: HttpRequest, status: 'active' | 'disabled') { return this.service.updateChannel({ tenantId: tenantId(request), id: pathId(request, 'notification-channels'), version: requiredVersion(request), status }); }
  private testChannel(request: HttpRequest) { const body = validateObject(request.body ?? {}, { target: { type: 'object' } }); return this.service.testChannel({ tenantId: tenantId(request), channelId: pathId(request, 'notification-channels'), target: asObject(body.target), actorId: request.context.actorId ?? 'system' }); }

  private createRoute(request: HttpRequest) { const body = routeBody(request, true); return this.service.createRoute({ tenantId: tenantId(request), name: String(body.name), priority: Number(body.priority), status: body.status as never, matcher: asObject(body.matcher), channelTargets: asTargets(body.channelTargets), stopOnMatch: Boolean(body.stopOnMatch), dedupeWindowSeconds: Number(body.dedupeWindowSeconds ?? 0) }); }
  private updateRoute(request: HttpRequest) { const body = routeBody(request, false); return this.service.updateRoute({ tenantId: tenantId(request), id: pathId(request, 'notification-routes'), version: Number(body.version), name: optionalString(body.name), priority: optionalNumber(body.priority), status: body.status as never, matcher: body.matcher ? asObject(body.matcher) : undefined, channelTargets: body.channelTargets ? asTargets(body.channelTargets) : undefined, stopOnMatch: body.stopOnMatch === undefined ? undefined : Boolean(body.stopOnMatch), dedupeWindowSeconds: optionalNumber(body.dedupeWindowSeconds) }); }
  private deleteRoute(request: HttpRequest) { return this.service.deleteRoute(tenantId(request), pathId(request, 'notification-routes'), requiredVersion(request)); }

  private upsertTemplate(request: HttpRequest) { const body = validateObject(request.body, { templateKey: { type: 'string', required: true }, locale: { type: 'string', required: true }, titleTemplate: { type: 'string', required: true }, bodyTemplate: { type: 'string', required: true }, requiredVariables: { type: 'array' }, status: { type: 'string' }, version: { type: 'number' } }); return this.service.upsertTemplate({ tenantId: tenantId(request), templateKey: String(body.templateKey), locale: String(body.locale), titleTemplate: String(body.titleTemplate), bodyTemplate: String(body.bodyTemplate), requiredVariables: asStrings(body.requiredVariables), status: body.status as never, version: optionalNumber(body.version) }); }
  private createSilence(request: HttpRequest) { const body = silenceBody(request, true); return this.service.createSilence({ tenantId: tenantId(request), name: String(body.name), matcher: asObject(body.matcher), reason: String(body.reason), startsAt: String(body.startsAt), endsAt: String(body.endsAt), createdBy: request.context.actorId ?? 'system' }); }
  private updateSilence(request: HttpRequest) { const body = silenceBody(request, false); return this.service.updateSilence({ tenantId: tenantId(request), id: pathId(request, 'notification-silences'), version: Number(body.version), name: optionalString(body.name), matcher: body.matcher ? asObject(body.matcher) : undefined, reason: optionalString(body.reason), startsAt: optionalString(body.startsAt), endsAt: optionalString(body.endsAt), status: body.status as never }); }
  private deleteSilence(request: HttpRequest) { return this.service.deleteSilence(tenantId(request), pathId(request, 'notification-silences'), requiredVersion(request)); }
  private async requireRequest(request: HttpRequest) { const value = await this.service.getRequest(tenantId(request), pathId(request, 'notification-requests')); if (!value) throw new AppError('RESOURCE_NOT_FOUND', '通知请求不存在'); return value; }
  private async requireDelivery(request: HttpRequest) { const value = await this.service.getDelivery(tenantId(request), pathId(request, 'notification-deliveries')); if (!value) throw new AppError('RESOURCE_NOT_FOUND', '通知投递不存在'); return value; }
}

function tenantId(request: HttpRequest): string { return requireTenantId(request); }
function pathId(request: HttpRequest, segment: string): string { const parts = request.path.split('/').filter(Boolean); const index = parts.indexOf(segment); const id = index >= 0 ? parts[index + 1] : undefined; if (!id) throw new AppError('VALIDATION_FAILED', '路径缺少资源 ID'); return id; }
function requiredVersion(request: HttpRequest): number { const body = validateObject(request.body, { version: { type: 'number', required: true } }); return Number(body.version); }
function pageQuery(request: HttpRequest) { return { tenantId: tenantId(request), page: queryNumber(request, 'page'), pageSize: queryNumber(request, 'pageSize'), status: queryString(request, 'status'), source: queryString(request, 'source'), channelId: queryString(request, 'channelId') }; }
function queryString(request: HttpRequest, key: string): string | undefined { return typeof request.query[key] === 'string' ? request.query[key] : undefined; }
function queryNumber(request: HttpRequest, key: string): number | undefined { const value = queryString(request, key); return value ? Number(value) : undefined; }
function routeBody(request: HttpRequest, create: boolean) { return validateObject(request.body, { version: { type: 'number', required: !create }, name: { type: 'string', required: create }, status: { type: 'string' }, priority: { type: 'number', required: create }, matcher: { type: 'object' }, channelTargets: { type: 'array', required: create }, stopOnMatch: { type: 'boolean' }, dedupeWindowSeconds: { type: 'number' } }); }
function silenceBody(request: HttpRequest, create: boolean) { return validateObject(request.body, { version: { type: 'number', required: !create }, name: { type: 'string', required: create }, status: { type: 'string' }, matcher: { type: 'object' }, reason: { type: 'string', required: create }, startsAt: { type: 'string', required: create }, endsAt: { type: 'string', required: create } }); }
function asObject(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function asStringMap(value: unknown): Record<string, string> { return Object.fromEntries(Object.entries(asObject(value)).filter((entry): entry is [string, string] => typeof entry[1] === 'string')); }
function asStrings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
function asTargets(value: unknown): Array<{ channelId: string; target?: Record<string, unknown> }> { return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object' && typeof (item as Record<string, unknown>).channelId === 'string').map((item) => ({ channelId: String((item as Record<string, unknown>).channelId), target: asObject((item as Record<string, unknown>).target) })) : []; }
function optionalString(value: unknown): string | undefined { return value === undefined ? undefined : String(value); }
function optionalNumber(value: unknown): number | undefined { return value === undefined ? undefined : Number(value); }

export function getNotificationRouteContracts(): RouteContract[] {
  const objectSchema = { type: 'object', additionalProperties: true } as const;
  return [
    { method: 'GET', path: '/api/v1/notification-channels', operationId: 'listNotificationChannels', summary: '查询通知渠道', tags, responseSchema: { type: 'array', items: objectSchema } },
    { method: 'POST', path: '/api/v1/notification-channels', operationId: 'createNotificationChannel', summary: '创建通知渠道', tags, responseSchema: objectSchema },
    { method: 'GET', path: '/api/v1/notification-routes', operationId: 'listNotificationRoutes', summary: '查询通知路由', tags, responseSchema: { type: 'array', items: objectSchema } },
    { method: 'GET', path: '/api/v1/notification-templates', operationId: 'listNotificationTemplates', summary: '查询通知模板', tags, responseSchema: { type: 'array', items: objectSchema } },
    { method: 'GET', path: '/api/v1/notification-silences', operationId: 'listNotificationSilences', summary: '查询通知静默', tags, responseSchema: { type: 'array', items: objectSchema } },
    { method: 'GET', path: '/api/v1/notification-requests', operationId: 'listNotificationRequests', summary: '查询通知请求', tags, responseSchema: pageResponseSchema },
    { method: 'GET', path: '/api/v1/notification-deliveries', operationId: 'listNotificationDeliveries', summary: '查询通知投递', tags, responseSchema: pageResponseSchema },
  ];
}
