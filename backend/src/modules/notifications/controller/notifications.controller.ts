import { AppError } from '../../../common/errors/app-error.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import { requireTenantId } from '../../../common/http/tenant-context.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { pageResponseSchema } from '../../../common/openapi/schemas.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import type { NotificationsApplicationService } from '../application/notifications.application-service.js';
import { notificationChannelStatuses, notificationChannelTypes } from '../schema/notifications.schema.js';
import type { SecurityServices } from '../../security/security.controller.js';
import {
  assertRouteAction,
  assertRouteObjectAccess,
  filterAuthorizedItems,
  requestSecurityContext,
  requireRouteSecurity,
} from '../../security/security-route-helpers.js';

const tags = ['Notifications'];

export class NotificationsController {
  constructor(private readonly service: NotificationsApplicationService, private readonly security?: SecurityServices) {}

  register(router: Router): void {
    router.get('/api/v1/notification-settings', '查询通知设置', tags, (request) => this.getSettings(request));
    router.patch('/api/v1/notification-settings', '更新通知设置', tags, (request) => this.updateSettings(request));
    router.get('/api/v1/notification-channels', '查询通知渠道', tags, (request) => this.listChannels(request));
    router.post('/api/v1/notification-channels', '创建通知渠道', tags, (request) => this.createChannel(request));
    router.patch('/api/v1/notification-channels/:id', '更新通知渠道', tags, (request) => this.updateChannel(request));
    router.delete('/api/v1/notification-channels/:id', '删除通知渠道', tags, (request) => this.deleteChannel(request));
    router.post('/api/v1/notification-channels/:id/actions/test', '测试通知渠道', tags, (request) => this.testChannel(request));
    router.post('/api/v1/notification-channels/:id/actions/enable', '启用通知渠道', tags, (request) => this.setChannelStatus(request, 'active'));
    router.post('/api/v1/notification-channels/:id/actions/disable', '停用通知渠道', tags, (request) => this.setChannelStatus(request, 'disabled'));
    router.get('/api/v1/notification-routes', '查询通知路由', tags, (request) => this.listRoutes(request));
    router.post('/api/v1/notification-routes', '创建通知路由', tags, (request) => this.createRoute(request));
    router.patch('/api/v1/notification-routes/:id', '更新通知路由', tags, (request) => this.updateRoute(request));
    router.delete('/api/v1/notification-routes/:id', '删除通知路由', tags, (request) => this.deleteRoute(request));
    router.get('/api/v1/notification-templates', '查询通知模板', tags, (request) => this.listTemplates(request));
    router.post('/api/v1/notification-templates', '保存通知模板', tags, (request) => this.upsertTemplate(request));
    router.patch('/api/v1/notification-templates/:id', '更新通知模板', tags, (request) => this.upsertTemplate(request));
    router.get('/api/v1/notification-silences', '查询通知静默', tags, (request) => this.listSilences(request));
    router.post('/api/v1/notification-silences', '创建通知静默', tags, (request) => this.createSilence(request));
    router.patch('/api/v1/notification-silences/:id', '更新通知静默', tags, (request) => this.updateSilence(request));
    router.delete('/api/v1/notification-silences/:id', '删除通知静默', tags, (request) => this.deleteSilence(request));
    router.get('/api/v1/notification-requests', '查询通知请求', tags, (request) => this.listRequests(request));
    router.get('/api/v1/notification-requests/:id', '查询通知请求详情', tags, (request) => this.requireRequest(request));
    router.get('/api/v1/notification-deliveries', '查询通知投递', tags, (request) => this.listDeliveries(request));
    router.get('/api/v1/notification-deliveries/:id', '查询通知投递详情', tags, (request) => this.requireDelivery(request));
    router.post('/api/v1/notification-deliveries/:id/actions/retry', '重发失败通知', tags, (request) => this.retryDelivery(request));
  }

  private async getSettings(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'notification.channel.read', 'settings');
    return this.service.getSettings(security.tenantId);
  }

  private async updateSettings(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'settings.write', 'settings');
    const body = validateObject(request.body, {
      version: { type: 'number', required: true },
      wecomPrivateOrigins: { type: 'array', required: true },
      feishuPrivateOrigins: { type: 'array', required: true },
      dingtalkPrivateOrigins: { type: 'array', required: true },
    });
    const before = await this.service.getSettings(security.tenantId);
    const updated = await this.service.updateSettings({
      tenantId: security.tenantId,
      version: Number(body.version),
      updatedBy: security.subject.id,
      privateOrigins: {
        wecom: asStrings(body.wecomPrivateOrigins),
        feishu: asStrings(body.feishuPrivateOrigins),
        dingtalk: asStrings(body.dingtalkPrivateOrigins),
      },
    });
    void security.services.audit.write({
      eventType: 'notification.settings.updated',
      actorType: 'user',
      actorId: security.subject.id,
      action: 'settings.write',
      resourceType: 'settings',
      resourceId: security.tenantId,
      result: 'success',
      riskLevel: 'medium',
      context: requestSecurityContext(security),
      detail: { before, after: updated },
    }).catch(() => undefined);
    return updated;
  }

  private async listChannels(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'notification.channel.read', 'notification_channel');
    return filterAuthorizedItems(security, await this.service.listChannels(security.tenantId), 'notification_channel', 'read');
  }

  private async createChannel(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'notification.channel.create', 'notification_channel');
    const body = validateObject(request.body, { name: { type: 'string', required: true }, type: { type: 'string', enum: notificationChannelTypes, required: true }, status: { type: 'string', enum: notificationChannelStatuses }, config: { type: 'object' }, secretRefs: { type: 'object' } });
    return this.service.createChannel({ tenantId: security.tenantId, name: String(body.name), type: body.type as never, status: body.status as never, config: asObject(body.config), secretRefs: asStringMap(body.secretRefs) });
  }

  private async updateChannel(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const body = validateObject(request.body, { version: { type: 'number', required: true }, name: { type: 'string' }, status: { type: 'string', enum: notificationChannelStatuses }, config: { type: 'object' }, secretRefs: { type: 'object' } });
    const id = pathId(request, 'notification-channels');
    const current = await this.service.getRepository().getChannel(security.tenantId, id);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', '通知渠道不存在');
    await assertRouteAction(security, 'notification.channel.update', 'notification_channel', { resourceId: id });
    await assertRouteObjectAccess(security, 'edit', { objectType: 'notification_channel', objectId: id, tenantId: security.tenantId });
    return this.service.updateChannel({ tenantId: security.tenantId, id, version: Number(body.version), name: optionalString(body.name), status: body.status as never, config: body.config ? asObject(body.config) : undefined, secretRefs: body.secretRefs ? asStringMap(body.secretRefs) : undefined });
  }

  private async deleteChannel(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const id = pathId(request, 'notification-channels');
    const current = await this.service.getRepository().getChannel(security.tenantId, id);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', '通知渠道不存在');
    await assertRouteAction(security, 'notification.channel.delete', 'notification_channel', { resourceId: id });
    await assertRouteObjectAccess(security, 'control', { objectType: 'notification_channel', objectId: id, tenantId: security.tenantId });
    return this.service.deleteChannel(security.tenantId, id, requiredVersion(request));
  }

  private async setChannelStatus(request: HttpRequest, status: 'active' | 'disabled') {
    const security = requireRouteSecurity(request, this.security);
    const id = pathId(request, 'notification-channels');
    const current = await this.service.getRepository().getChannel(security.tenantId, id);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', '通知渠道不存在');
    await assertRouteAction(security, 'notification.channel.control', 'notification_channel', { resourceId: id });
    await assertRouteObjectAccess(security, 'control', { objectType: 'notification_channel', objectId: id, tenantId: security.tenantId });
    return this.service.updateChannel({ tenantId: security.tenantId, id, version: requiredVersion(request), status });
  }

  private async testChannel(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const id = pathId(request, 'notification-channels');
    const current = await this.service.getRepository().getChannel(security.tenantId, id);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', '通知渠道不存在');
    await assertRouteAction(security, 'notification.channel.control', 'notification_channel', { resourceId: id });
    await assertRouteObjectAccess(security, 'control', { objectType: 'notification_channel', objectId: id, tenantId: security.tenantId });
    const body = validateObject(request.body ?? {}, { target: { type: 'object' } });
    return this.service.testChannel({ tenantId: security.tenantId, channelId: id, target: asObject(body.target), actorId: security.subject.id });
  }

  private async listRoutes(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'notification.route.read', 'notification_route');
    return filterAuthorizedItems(security, await this.service.listRoutes(security.tenantId), 'notification_route', 'read');
  }

  private async createRoute(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'notification.route.create', 'notification_route');
    const body = routeBody(request, true);
    return this.service.createRoute({ tenantId: security.tenantId, name: String(body.name), priority: Number(body.priority), status: body.status as never, matcher: asObject(body.matcher), channelTargets: asTargets(body.channelTargets), stopOnMatch: Boolean(body.stopOnMatch), dedupeWindowSeconds: Number(body.dedupeWindowSeconds ?? 0) });
  }

  private async updateRoute(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const id = pathId(request, 'notification-routes');
    const current = await this.service.getRepository().getRoute(security.tenantId, id);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', '通知路由不存在');
    await assertRouteAction(security, 'notification.route.update', 'notification_route', { resourceId: id });
    await assertRouteObjectAccess(security, 'edit', { objectType: 'notification_route', objectId: id, tenantId: security.tenantId });
    const body = routeBody(request, false);
    return this.service.updateRoute({ tenantId: security.tenantId, id, version: Number(body.version), name: optionalString(body.name), priority: optionalNumber(body.priority), status: body.status as never, matcher: body.matcher ? asObject(body.matcher) : undefined, channelTargets: body.channelTargets ? asTargets(body.channelTargets) : undefined, stopOnMatch: body.stopOnMatch === undefined ? undefined : Boolean(body.stopOnMatch), dedupeWindowSeconds: optionalNumber(body.dedupeWindowSeconds) });
  }

  private async deleteRoute(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const id = pathId(request, 'notification-routes');
    const current = await this.service.getRepository().getRoute(security.tenantId, id);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', '通知路由不存在');
    await assertRouteAction(security, 'notification.route.delete', 'notification_route', { resourceId: id });
    await assertRouteObjectAccess(security, 'control', { objectType: 'notification_route', objectId: id, tenantId: security.tenantId });
    return this.service.deleteRoute(security.tenantId, id, requiredVersion(request));
  }

  private async listTemplates(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'notification.template.read', 'notification_template');
    return filterAuthorizedItems(security, await this.service.listTemplates(security.tenantId), 'notification_template', 'read');
  }

  private async upsertTemplate(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const id = request.path.includes('/notification-templates/') ? pathId(request, 'notification-templates') : undefined;
    if (id) {
      const current = (await this.service.listTemplates(security.tenantId)).find((item) => item.id === id);
      if (!current) throw new AppError('RESOURCE_NOT_FOUND', '通知模板不存在');
      await assertRouteAction(security, 'notification.template.update', 'notification_template', { resourceId: id });
      await assertRouteObjectAccess(security, 'edit', { objectType: 'notification_template', objectId: id, tenantId: security.tenantId });
    } else {
      await assertRouteAction(security, 'notification.template.create', 'notification_template');
    }
    const body = validateObject(request.body, { templateKey: { type: 'string', required: true }, locale: { type: 'string', required: true }, titleTemplate: { type: 'string', required: true }, bodyTemplate: { type: 'string', required: true }, requiredVariables: { type: 'array' }, status: { type: 'string' }, version: { type: 'number' } });
    return this.service.upsertTemplate({ tenantId: security.tenantId, templateKey: String(body.templateKey), locale: String(body.locale), titleTemplate: String(body.titleTemplate), bodyTemplate: String(body.bodyTemplate), requiredVariables: asStrings(body.requiredVariables), status: body.status as never, version: optionalNumber(body.version) });
  }

  private async listSilences(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'notification.silence.read', 'notification_silence');
    return filterAuthorizedItems(security, await this.service.listSilences(security.tenantId), 'notification_silence', 'read');
  }

  private async createSilence(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'notification.silence.create', 'notification_silence');
    const body = silenceBody(request, true);
    return this.service.createSilence({ tenantId: security.tenantId, name: String(body.name), matcher: asObject(body.matcher), reason: String(body.reason), startsAt: String(body.startsAt), endsAt: String(body.endsAt), createdBy: security.subject.id });
  }

  private async updateSilence(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const id = pathId(request, 'notification-silences');
    const current = (await this.service.listSilences(security.tenantId)).find((item) => item.id === id);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', '通知静默不存在');
    await assertRouteAction(security, 'notification.silence.update', 'notification_silence', { resourceId: id });
    await assertRouteObjectAccess(security, 'edit', { objectType: 'notification_silence', objectId: id, tenantId: security.tenantId });
    const body = silenceBody(request, false);
    return this.service.updateSilence({ tenantId: security.tenantId, id, version: Number(body.version), name: optionalString(body.name), matcher: body.matcher ? asObject(body.matcher) : undefined, reason: optionalString(body.reason), startsAt: optionalString(body.startsAt), endsAt: optionalString(body.endsAt), status: body.status as never });
  }

  private async deleteSilence(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const id = pathId(request, 'notification-silences');
    const current = (await this.service.listSilences(security.tenantId)).find((item) => item.id === id);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', '通知静默不存在');
    await assertRouteAction(security, 'notification.silence.delete', 'notification_silence', { resourceId: id });
    await assertRouteObjectAccess(security, 'control', { objectType: 'notification_silence', objectId: id, tenantId: security.tenantId });
    return this.service.deleteSilence(security.tenantId, id, requiredVersion(request));
  }

  private async listRequests(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'notification.request.read', 'notification_request');
    const page = await this.service.listRequests(pageQuery(request));
    return {
      ...page,
      items: await filterAuthorizedItems(security, page.items, 'notification_request', 'read'),
    };
  }

  private async requireRequest(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const value = await this.service.getRequest(security.tenantId, pathId(request, 'notification-requests'));
    if (!value) throw new AppError('RESOURCE_NOT_FOUND', '通知请求不存在');
    await assertRouteAction(security, 'notification.request.read', 'notification_request', { resourceId: value.id });
    await assertRouteObjectAccess(security, 'read', { objectType: 'notification_request', objectId: value.id, tenantId: security.tenantId });
    return value;
  }

  private async listDeliveries(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'notification.delivery.read', 'notification_delivery');
    const page = await this.service.listDeliveries(pageQuery(request));
    return {
      ...page,
      items: await filterAuthorizedItems(security, page.items, 'notification_delivery', 'read'),
    };
  }

  private async requireDelivery(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const value = await this.service.getDelivery(security.tenantId, pathId(request, 'notification-deliveries'));
    if (!value) throw new AppError('RESOURCE_NOT_FOUND', '通知投递不存在');
    await assertRouteAction(security, 'notification.delivery.read', 'notification_delivery', { resourceId: value.id });
    await assertRouteObjectAccess(security, 'read', { objectType: 'notification_delivery', objectId: value.id, tenantId: security.tenantId });
    return value;
  }

  private async retryDelivery(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const id = pathId(request, 'notification-deliveries');
    const value = await this.service.getDelivery(security.tenantId, id);
    if (!value) throw new AppError('RESOURCE_NOT_FOUND', '通知投递不存在');
    await assertRouteAction(security, 'notification.delivery.control', 'notification_delivery', { resourceId: value.id });
    await assertRouteObjectAccess(security, 'control', { objectType: 'notification_delivery', objectId: value.id, tenantId: security.tenantId });
    return this.service.retryDelivery(security.tenantId, id);
  }
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
