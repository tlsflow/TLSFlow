import { AppError } from '../../../common/errors/app-error.js';
import type {
  CreateNotificationChannelInput,
  CreateNotificationRouteInput,
  CreateNotificationSilenceInput,
  EnqueueNotificationInput,
  NotificationPageQuery,
  UpdateNotificationChannelInput,
  UpdateNotificationRouteInput,
  UpdateNotificationSilenceInput,
  UpsertNotificationTemplateInput,
} from '../dto/notifications.dto.js';
import { NotificationDedupeService } from './notification-dedupe.service.js';
import type { NotificationPort } from './notification.port.js';
import { NotificationRouteMatcher } from './notification-route-matcher.js';
import { NotificationTemplateRenderer } from './notification-template-renderer.js';
import type { NotificationsRepository } from '../repository/notifications.repository.js';
import type { NotificationChannel, NotificationChannelTarget } from '../schema/notifications.schema.js';
import type { NotificationWorker } from './notification-worker.js';
import { NotificationsDomainService } from '../domain/notifications.domain-service.js';

export class NotificationsApplicationService implements NotificationPort {
  constructor(
    private readonly repository: NotificationsRepository,
    private readonly routeMatcher = new NotificationRouteMatcher(),
    private readonly renderer = new NotificationTemplateRenderer(),
    private readonly dedupe = new NotificationDedupeService(),
    private readonly worker?: NotificationWorker,
    private readonly domain = new NotificationsDomainService(),
  ) {}

  async enqueue(input: EnqueueNotificationInput): Promise<{ requestId: string }> {
    const existing = await this.repository.getRequestByIdempotencyKey(input.tenantId, input.idempotencyKey);
    if (existing) return { requestId: existing.id };

    const locale = input.locale ?? 'zh-CN';
    const template = await this.getTemplate(input.tenantId, input.templateKey, locale);
    if (!template) {
      const request = await this.repository.createRequest({
        ...normalizeRequest(input),
        context: this.renderer.render(emptyTemplate(input), input.context).context,
        status: 'failed',
        statusReason: 'template_not_found',
        deliveries: [],
      });
      return { requestId: request.id };
    }

    const rendered = this.renderer.render(template, input.context);
    const event = { ...rendered.context, source: input.source ?? 'system', eventKey: input.eventKey };
    const silences = await this.repository.listSilences(input.tenantId);
    const silence = this.dedupe.findSilence(silences, event);
    if (silence) {
      const request = await this.repository.createRequest({
        ...normalizeRequest(input),
        context: rendered.context,
        status: 'suppressed',
        statusReason: `silence:${silence.id}`,
        deliveries: [],
      });
      return { requestId: request.id };
    }

    const selected = await this.selectTargets(input, event);
    if (!selected.length) {
      const request = await this.repository.createRequest({
        ...normalizeRequest(input),
        context: rendered.context,
        status: 'failed',
        statusReason: 'route_or_channel_not_found',
        deliveries: [],
      });
      return { requestId: request.id };
    }

    const dedupeWindowSeconds = Math.max(...selected.map((item) => item.dedupeWindowSeconds), 0);
    if (dedupeWindowSeconds > 0) {
      const since = new Date(Date.now() - dedupeWindowSeconds * 1000).toISOString();
      const duplicate = this.dedupe.findDuplicate(
        await this.repository.listRecentRequests(input.tenantId, input.eventKey, since),
        input.eventKey,
        dedupeWindowSeconds,
      );
      if (duplicate) {
        const request = await this.repository.createRequest({
          ...normalizeRequest(input),
          context: rendered.context,
          status: 'suppressed',
          statusReason: `dedupe:${duplicate.id}`,
          deliveries: [],
        });
        return { requestId: request.id };
      }
    }

    const request = await this.repository.createRequest({
      ...normalizeRequest(input),
      context: rendered.context,
      status: 'queued',
      deliveries: selected.map(({ channel, target }) => ({
        channel,
        target,
        renderedTitle: rendered.title,
        renderedBody: rendered.body,
      })),
    });
    return { requestId: request.id };
  }

  createChannel(input: CreateNotificationChannelInput) {
    this.domain.assertChannelSecrets(input.config ?? {}, input.secretRefs ?? {});
    return this.repository.createChannel(input);
  }
  updateChannel(input: UpdateNotificationChannelInput) {
    this.domain.assertChannelSecrets(input.config ?? {}, input.secretRefs ?? {});
    return this.repository.updateChannel(input);
  }
  deleteChannel(tenantId: string, id: string, version: number) { return this.repository.deleteChannel(tenantId, id, version); }
  listChannels(tenantId: string) { return this.repository.listChannels(tenantId); }
  createRoute(input: CreateNotificationRouteInput) { return this.repository.createRoute(input); }
  updateRoute(input: UpdateNotificationRouteInput) { return this.repository.updateRoute(input); }
  deleteRoute(tenantId: string, id: string, version: number) { return this.repository.deleteRoute(tenantId, id, version); }
  listRoutes(tenantId: string) { return this.repository.listRoutes(tenantId); }
  upsertTemplate(input: UpsertNotificationTemplateInput) { return this.repository.upsertTemplate(input); }
  listTemplates(tenantId: string) { return this.repository.listTemplates(tenantId); }
  createSilence(input: CreateNotificationSilenceInput) { return this.repository.createSilence(input); }
  updateSilence(input: UpdateNotificationSilenceInput) { return this.repository.updateSilence(input); }
  deleteSilence(tenantId: string, id: string, version: number) { return this.repository.deleteSilence(tenantId, id, version); }
  listSilences(tenantId: string) { return this.repository.listSilences(tenantId); }
  listRequests(query: NotificationPageQuery) { return this.repository.listRequests(query); }
  listDeliveries(query: NotificationPageQuery) { return this.repository.listDeliveries(query); }
  getRequest(tenantId: string, id: string) { return this.repository.getRequest(tenantId, id); }
  getDelivery(tenantId: string, id: string) { return this.repository.getDelivery(tenantId, id); }
  retryDelivery(tenantId: string, id: string) { return this.repository.retryDelivery(tenantId, id); }
  getRepository(): NotificationsRepository { return this.repository; }

  async testChannel(input: { tenantId: string; channelId: string; target: Record<string, unknown>; actorId: string }) {
    await this.repository.upsertTemplate({
      tenantId: input.tenantId,
      templateKey: 'notification.channel.test',
      locale: 'zh-CN',
      titleTemplate: 'GCAC 通知渠道测试',
      bodyTemplate: '这是一条由 GCAC 通知中心发出的测试消息。',
    });
    const result = await this.enqueue({
      tenantId: input.tenantId,
      channelId: input.channelId,
      templateKey: 'notification.channel.test',
      eventKey: `test:${input.channelId}:${Date.now()}`,
      idempotencyKey: `test:${input.channelId}:${Date.now()}:${input.actorId}`,
      source: 'test',
      sourceRefs: { actorId: input.actorId },
      context: { target: input.target },
    });
    if (this.worker) await this.worker.runNext();
    return {
      request: await this.repository.getRequest(input.tenantId, result.requestId),
      deliveries: (await this.repository.listDeliveries({ tenantId: input.tenantId, pageSize: 200 })).items.filter((item) => item.requestId === result.requestId),
    };
  }

  private async selectTargets(input: EnqueueNotificationInput, event: Record<string, unknown>): Promise<Array<{
    channel: NotificationChannel;
    target: Record<string, unknown>;
    dedupeWindowSeconds: number;
  }>> {
    if (input.channelId) {
      const channel = await this.repository.getChannel(input.tenantId, input.channelId);
      const available = channel && (channel.status === 'active' || input.source === 'test' && channel.status === 'disabled');
      return available ? [{ channel, target: targetFromContext(input.context), dedupeWindowSeconds: 0 }] : [];
    }

    const routes = input.routeId
      ? [await this.repository.getRoute(input.tenantId, input.routeId)].filter((route) => route !== undefined)
      : this.routeMatcher.match(await this.repository.listRoutes(input.tenantId), event);
    const selected: Array<{ channel: NotificationChannel; target: Record<string, unknown>; dedupeWindowSeconds: number }> = [];
    const seen = new Set<string>();
    for (const route of routes) {
      if (route.status !== 'active') continue;
      for (const routeTarget of route.channelTargets) {
        const channel = await this.repository.getChannel(input.tenantId, routeTarget.channelId);
        if (!channel || channel.status !== 'active') continue;
        const key = `${channel.id}:${JSON.stringify(routeTarget.target ?? {})}`;
        if (seen.has(key)) continue;
        seen.add(key);
        selected.push({ channel, target: routeTarget.target ?? {}, dedupeWindowSeconds: route.dedupeWindowSeconds });
      }
    }
    return selected;
  }

  private async getTemplate(tenantId: string, templateKey: string, locale: string) {
    const existing = await this.repository.getTemplate(tenantId, templateKey, locale);
    if (existing) return existing;
    const builtin = builtinTemplate(templateKey);
    if (!builtin) return undefined;
    return this.repository.upsertTemplate({ tenantId, templateKey, locale: 'zh-CN', ...builtin });
  }
}

function normalizeRequest(input: EnqueueNotificationInput) {
  return {
    tenantId: input.tenantId,
    source: input.source ?? 'system',
    eventKey: input.eventKey,
    idempotencyKey: input.idempotencyKey,
    templateKey: input.templateKey,
    routeId: input.routeId,
    channelId: input.channelId,
    sourceRefs: input.sourceRefs ?? {},
  };
}

function targetFromContext(context: Record<string, unknown>): Record<string, unknown> {
  return context.target && typeof context.target === 'object' && !Array.isArray(context.target)
    ? context.target as Record<string, unknown>
    : {};
}

function emptyTemplate(input: EnqueueNotificationInput) {
  return {
    id: 'missing', tenantId: input.tenantId, templateKey: input.templateKey, locale: input.locale ?? 'zh-CN',
    titleTemplate: '', bodyTemplate: '', requiredVariables: [], status: 'active' as const,
    createdAt: '', updatedAt: '', version: 1,
  };
}

function builtinTemplate(templateKey: string): { titleTemplate: string; bodyTemplate: string; requiredVariables: string[] } | undefined {
  if (templateKey === 'monitor.risk') {
    return {
      titleTemplate: '[{{severity}}] {{title}}',
      bodyTemplate: '{{summary}}',
      requiredVariables: ['severity', 'title', 'summary'],
    };
  }
  if (templateKey === 'automation.run') {
    return {
      titleTemplate: '{{title}}',
      bodyTemplate: '{{summary}}',
      requiredVariables: ['title', 'summary'],
    };
  }
  return undefined;
}
