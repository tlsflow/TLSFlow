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
  UpdateNotificationSettingsInput,
  UpsertNotificationTemplateInput,
} from '../dto/notifications.dto.js';
import type { NotificationPort } from './notification.port.js';
import type { CertificateNotificationEvent, CertificateNotificationPort } from './certificate-notification-event.js';
import { CertificateNotificationEventRegistry } from './certificate-notification-event.js';
import { NotificationRouteMatcher } from './notification-route-matcher.js';
import { NotificationTemplateRenderer } from './notification-template-renderer.js';
import type { NotificationsRepository } from '../repository/notifications.repository.js';
import type { NotificationChannel, NotificationChannelTarget } from '../schema/notifications.schema.js';
import type { NotificationWorker } from './notification-worker.js';
import type { ChannelAdapterRegistry } from './channel-adapter-registry.js';
import { NotificationsDomainService } from '../domain/notifications.domain-service.js';
import { validatePrivateOrigins } from '../security/platform-webhook-endpoint-policy.js';
import { enqueueTaskBestEffort, type TaskEnqueuer } from '../../tasks/task-enqueue.js';

export class NotificationsApplicationService implements NotificationPort, CertificateNotificationPort {
  constructor(
    private readonly repository: NotificationsRepository,
    private readonly routeMatcher = new NotificationRouteMatcher(),
    private readonly renderer = new NotificationTemplateRenderer(),
    private readonly dedupe = undefined,
    private readonly worker?: NotificationWorker,
    private readonly domain = new NotificationsDomainService(),
    private readonly adapters?: ChannelAdapterRegistry,
    private readonly tasks?: TaskEnqueuer,
  ) {}

  async publish(event: CertificateNotificationEvent): Promise<{ requestId: string; status: string }> {
    const registry = new CertificateNotificationEventRegistry();
    if (!event.tenantId || !event.eventId || !event.idempotencyKey || !event.occurredAt || !registry.isRegistered(event.eventType)) {
      throw new AppError(registry.isRegistered(event.eventType) ? 'VALIDATION_FAILED' : 'NOTIFICATION_EVENT_TYPE_INVALID', '证书通知事件字段或类型无效', { eventType: event.eventType });
    }
    const result = await this.enqueue({
      tenantId: event.tenantId,
      eventId: event.eventId,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      payloadVersion: event.payloadVersion,
      templateKey: event.templateKey ?? event.eventType,
      eventKey: `${event.eventType}:${event.eventId}`,
      idempotencyKey: event.idempotencyKey,
      source: 'certificate',
      sourceRefs: event.sourceRefs,
      locale: event.locale,
      context: event.payload,
    });
    const request = await this.getRequest(event.tenantId, result.requestId);
    return { requestId: result.requestId, status: request?.status ?? 'queued' };
  }

  async enqueue(input: EnqueueNotificationInput): Promise<{ requestId: string }> {
    const existing = await this.repository.getRequestByIdempotencyKey(input.tenantId, input.idempotencyKey);
    if (existing) return { requestId: existing.id };

    const event = { ...input.context, source: input.source ?? 'system', eventKey: input.eventKey, eventType: input.eventType ?? input.eventKey };
    const selected = await this.selectTargets(input, event);
    const templateKey = input.templateKey ?? selected[0]?.templateKey ?? input.eventType ?? input.eventKey;
    const requestInput = { ...input, templateKey };
    const locale = input.locale ?? 'zh-CN';
    const template = await this.getTemplate(input.tenantId, templateKey, locale);
    if (!template) {
      const request = await this.repository.createRequest({
        ...normalizeRequest(requestInput),
        context: this.domain.sanitizeContext(input.context),
        status: 'failed',
        statusReason: 'template_not_found',
        deliveries: [],
      });
      return { requestId: request.id };
    }

    let rendered: ReturnType<NotificationTemplateRenderer['render']>;
    try {
      rendered = this.renderer.render(template, input.context);
    } catch (error) {
      const request = await this.repository.createRequest({
        ...normalizeRequest(requestInput),
        context: this.domain.sanitizeContext(input.context),
        status: 'failed',
        statusReason: error instanceof AppError ? error.errorCode : 'template_render_failed',
        deliveries: [],
      });
      return { requestId: request.id };
    }
    if (!selected.length) {
      const request = await this.repository.createRequest({
        ...normalizeRequest(requestInput),
        context: rendered.context,
        status: 'failed',
        statusReason: 'route_or_channel_not_found',
        deliveries: [],
      });
      return { requestId: request.id };
    }

    const request = await this.repository.createRequest({
      ...normalizeRequest(requestInput),
      context: rendered.context,
      status: 'queued',
      deliveries: selected.map(({ channel, target }) => ({
        channel,
        target,
        renderedTitle: rendered.title,
        renderedBody: rendered.body,
        templateVersion: template.version,
      })),
    });
    return { requestId: request.id };
  }

  async createChannel(input: CreateNotificationChannelInput) {
    const config = normalizeChannelConfig(input.type, input.config ?? {});
    const normalized = { ...input, config };
    this.domain.assertChannelSecrets(config, input.secretRefs ?? {});
    await this.adapters?.get(input.type).validateConfig(channelForValidation(normalized));
    return this.repository.createChannel(normalized);
  }
  getSettings(tenantId: string) { return this.repository.getSettings(tenantId); }
  updateSettings(input: UpdateNotificationSettingsInput) {
    return this.repository.updateSettings({
      ...input,
      privateOrigins: {
        wecom: validatePrivateOrigins(input.privateOrigins.wecom),
        feishu: validatePrivateOrigins(input.privateOrigins.feishu),
        dingtalk: validatePrivateOrigins(input.privateOrigins.dingtalk),
      },
    });
  }
  async updateChannel(input: UpdateNotificationChannelInput) {
    const current = await this.repository.getChannel(input.tenantId, input.id);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', '通知渠道不存在', { id: input.id });
    const config = normalizeChannelConfig(current.type, input.config ?? current.config);
    const secretRefs = input.secretRefs ?? current.secretRefs;
    this.domain.assertChannelSecrets(config, secretRefs);
    await this.adapters?.get(current.type).validateConfig({ ...current, ...input, config, secretRefs });
    return this.repository.updateChannel({ ...input, config });
  }
  deleteChannel(tenantId: string, id: string, version: number) { return this.repository.deleteChannel(tenantId, id, version); }
  listChannels(tenantId: string) { return this.repository.listChannels(tenantId); }
  async createRoute(input: CreateNotificationRouteInput) {
    await this.validateRoute(input.tenantId, input.templateKey, input.channelTargets);
    return this.repository.createRoute(input);
  }
  async updateRoute(input: UpdateNotificationRouteInput) {
    const current = await this.repository.getRoute(input.tenantId, input.id);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', '通知路由不存在', { id: input.id });
    await this.validateRoute(input.tenantId, input.templateKey ?? current.templateKey, input.channelTargets ?? current.channelTargets);
    return this.repository.updateRoute(input);
  }
  deleteRoute(tenantId: string, id: string, version: number) { return this.repository.deleteRoute(tenantId, id, version); }
  listRoutes(tenantId: string) { return this.repository.listRoutes(tenantId); }
  async upsertTemplate(input: UpsertNotificationTemplateInput) {
    const template = {
      id: 'pending', tenantId: input.tenantId, templateKey: input.templateKey, locale: input.locale,
      titleTemplate: input.titleTemplate, bodyTemplate: input.bodyTemplate, requiredVariables: input.requiredVariables ?? [],
      status: input.status ?? 'active', createdAt: '', updatedAt: '', version: input.version ?? 1,
    } as const;
    const validation = this.renderer.validate(template);
    if (validation.undeclaredVariables.length || validation.missingDeclarations.length) {
      throw new AppError('NOTIFICATION_TEMPLATE_INVALID', '通知模板变量声明与正文不一致', {
        undeclaredVariables: validation.undeclaredVariables,
        missingDeclarations: validation.missingDeclarations,
      });
    }
    return this.repository.upsertTemplate(input);
  }
  listTemplates(tenantId: string) { return this.repository.listTemplates(tenantId); }
  createSilence(input: CreateNotificationSilenceInput) { return this.repository.createSilence(input); }
  updateSilence(input: UpdateNotificationSilenceInput) { return this.repository.updateSilence(input); }
  deleteSilence(tenantId: string, id: string, version: number) { return this.repository.deleteSilence(tenantId, id, version); }
  listSilences(tenantId: string) { return this.repository.listSilences(tenantId); }
  listRequests(query: NotificationPageQuery) { return this.repository.listRequests(query); }
  listDeliveries(query: NotificationPageQuery) { return this.repository.listDeliveries(query); }
  getRequest(tenantId: string, id: string) { return this.repository.getRequest(tenantId, id); }
  getDelivery(tenantId: string, id: string) { return this.repository.getDelivery(tenantId, id); }
  async getDeliveryDetail(tenantId: string, id: string) {
    const delivery = await this.repository.getDelivery(tenantId, id);
    if (!delivery) return undefined;
    const [attempts, outbox] = await Promise.all([
      this.repository.listDeliveryAttempts(tenantId, id),
      this.repository.listDeliveryOutbox(tenantId, id),
    ]);
    return { delivery, attempts, outbox };
  }
  async previewTemplate(input: {
    tenantId: string;
    templateKey: string;
    locale: string;
    titleTemplate?: string;
    bodyTemplate?: string;
    requiredVariables?: string[];
    status?: 'active' | 'disabled';
    context: Record<string, unknown>;
  }) {
    const stored = !input.titleTemplate || !input.bodyTemplate
      ? await this.repository.getTemplate(input.tenantId, input.templateKey, input.locale)
      : undefined;
    const configured = stored ?? (!input.titleTemplate || !input.bodyTemplate
      ? (await this.repository.listTemplates(input.tenantId)).find((item) =>
        item.templateKey === input.templateKey && (item.locale === input.locale || item.locale === 'zh-CN'))
      : undefined);
    const template = configured ?? {
      id: 'preview', tenantId: input.tenantId, templateKey: input.templateKey, locale: input.locale,
      titleTemplate: input.titleTemplate ?? '', bodyTemplate: input.bodyTemplate ?? '', requiredVariables: input.requiredVariables ?? [],
      status: input.status ?? 'active', createdAt: '', updatedAt: '', version: 1,
    };
    if (template.status !== 'active') throw new AppError('NOTIFICATION_TEMPLATE_INVALID', '通知模板已禁用');
    const validation = this.renderer.validate(template, this.domain.sanitizeContext(input.context));
    if (validation.undeclaredVariables.length || validation.missingDeclarations.length) {
      throw new AppError('NOTIFICATION_TEMPLATE_INVALID', '通知模板变量声明与正文不一致', validation);
    }
    if (validation.missingVariables.length) {
      return { title: '', body: '', missingVariables: validation.missingVariables, templateVersion: template.version };
    }
    const rendered = this.renderer.render(template, input.context);
    return { title: rendered.title, body: rendered.body, missingVariables: [], templateVersion: template.version };
  }
  async retryDelivery(tenantId: string, id: string, requestedBy = 'notification-retry') {
    const result = await this.repository.retryDelivery(tenantId, id);
    const dispatchGeneration = result.delivery.dispatchGeneration ?? result.outbox.dispatchGeneration;
    const taskKey = 'notification-delivery:' + result.delivery.id + ':' + dispatchGeneration;
    // 先尝试让手工操作立即可见；若任务系统暂时不可用，Outbox 扫描会继续补偿。
    await enqueueTaskBestEffort(this.tasks, {
      tenantId,
      taskType: 'NOTIFICATION_DELIVERY',
      requestedBy,
      triggerSource: 'notifications.manual-retry',
      idempotencyKey: taskKey,
      payload: { deliveryId: result.delivery.id, dispatchGeneration },
      resourceRefs: [
        { resourceType: 'notificationDelivery', resourceId: result.delivery.id },
        { resourceType: 'notificationRequest', resourceId: result.delivery.requestId },
      ],
    });
    return {
      deliveryId: result.delivery.id,
      dispatchGeneration,
      attemptNo: result.delivery.attemptCount + 1,
      taskKey,
    };
  }
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
    return {
      request: await this.repository.getRequest(input.tenantId, result.requestId),
      deliveries: (await this.repository.listDeliveries({ tenantId: input.tenantId, pageSize: 200 })).items.filter((item) => item.requestId === result.requestId),
    };
  }

  private async selectTargets(input: EnqueueNotificationInput, event: Record<string, unknown>): Promise<Array<{
    channel: NotificationChannel;
    target: Record<string, unknown>;
    dedupeWindowSeconds: number;
    templateKey?: string;
  }>> {
    if (input.channelId) {
      const channel = await this.repository.getChannel(input.tenantId, input.channelId);
      const available = channel && (channel.status === 'active' || input.source === 'test' && channel.status === 'disabled');
      return available ? [{ channel, target: targetFromContext(input.context), dedupeWindowSeconds: 0, templateKey: input.templateKey }] : [];
    }

    const routes = input.routeId
      ? [await this.repository.getRoute(input.tenantId, input.routeId)].filter((route) => route !== undefined)
      : this.routeMatcher.match(await this.repository.listRoutes(input.tenantId), event);
    const selected: Array<{ channel: NotificationChannel; target: Record<string, unknown>; dedupeWindowSeconds: number; templateKey?: string }> = [];
    const seen = new Set<string>();
    for (const route of routes) {
      if (route.status !== 'active') continue;
      for (const routeTarget of route.channelTargets) {
        const channel = await this.repository.getChannel(input.tenantId, routeTarget.channelId);
        if (!channel || channel.status !== 'active') continue;
        const key = `${channel.id}:${JSON.stringify(routeTarget.target ?? {})}`;
        if (seen.has(key)) continue;
        seen.add(key);
        selected.push({ channel, target: routeTarget.target ?? {}, dedupeWindowSeconds: route.dedupeWindowSeconds, templateKey: route.templateKey });
      }
    }
    return selected;
  }

  private async validateRoute(tenantId: string, templateKey: string | undefined, channelTargets: NotificationChannelTarget[]): Promise<void> {
    if (templateKey) {
      const template = await this.repository.getTemplate(tenantId, templateKey, 'zh-CN');
      if (!template) {
        const configured = (await this.repository.listTemplates(tenantId)).find((item) => item.templateKey === templateKey);
        if (configured?.status === 'disabled' || !builtinTemplate(templateKey)) {
          throw new AppError('RESOURCE_NOT_FOUND', '通知路由模板不存在或已禁用', { templateKey });
        }
      }
    }
    if (!channelTargets.length) throw new AppError('VALIDATION_FAILED', '通知路由至少需要一个渠道目标');
    for (const target of channelTargets) {
      const channel = await this.repository.getChannel(tenantId, target.channelId);
      if (!channel || channel.status === 'deleted') throw new AppError('RESOURCE_NOT_FOUND', '通知路由渠道不存在', { channelId: target.channelId });
      validateRouteTarget(channel.type, target.target ?? {});
    }
  }

  private async getTemplate(tenantId: string, templateKey: string, locale: string) {
    const existing = await this.repository.getTemplate(tenantId, templateKey, locale);
    if (existing) return existing;
    const configured = (await this.repository.listTemplates(tenantId)).find((item) =>
      item.templateKey === templateKey && (item.locale === locale || item.locale === 'zh-CN'));
    if (configured?.status === 'disabled') return undefined;
    const builtin = builtinTemplate(templateKey);
    if (!builtin) return undefined;
    return this.repository.upsertTemplate({ tenantId, templateKey, locale: 'zh-CN', ...builtin });
  }
}

function channelForValidation(input: CreateNotificationChannelInput): NotificationChannel {
  const now = new Date().toISOString();
  return {
    id: 'pending',
    tenantId: input.tenantId,
    name: input.name,
    type: input.type,
    status: input.status ?? 'disabled',
    config: input.config ?? {},
    secretRefs: input.secretRefs ?? {},
    healthStatus: 'unknown',
    consecutiveFailures: 0,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

function normalizeChannelConfig(type: NotificationChannel['type'], config: Record<string, unknown>): Record<string, unknown> {
  if (type !== 'wecom' && type !== 'feishu' && type !== 'dingtalk') return config;
  const rawOrigin = config.privateOrigin;
  if (rawOrigin === undefined || rawOrigin === null || rawOrigin === '') {
    const { privateOrigin: _privateOrigin, ...remaining } = config;
    return remaining;
  }
  if (typeof rawOrigin !== 'string') {
    throw new AppError('NOTIFICATION_CHANNEL_INVALID', '通知渠道私有化 Origin 必须是字符串');
  }
  const [privateOrigin] = validatePrivateOrigins([rawOrigin]);
  return { ...config, privateOrigin };
}

function normalizeRequest(input: EnqueueNotificationInput) {
  return {
    tenantId: input.tenantId,
    source: input.source ?? 'system',
    eventKey: input.eventKey,
    eventId: input.eventId ?? input.eventKey,
    eventType: input.eventType ?? input.eventKey,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    payloadVersion: input.payloadVersion ?? 1,
    idempotencyKey: input.idempotencyKey,
    templateKey: input.templateKey ?? input.eventType ?? input.eventKey,
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

function validateRouteTarget(type: NotificationChannel['type'], target: Record<string, unknown>): void {
  if (type === 'email') {
    const value = target.to ?? target.recipients;
    const recipients = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : typeof value === 'string' && value.trim() ? [value] : [];
    if (!recipients.length) throw new AppError('VALIDATION_FAILED', 'Email 路由目标至少需要一个收件人');
    return;
  }
  if (type === 'telegram' && target.chatId !== undefined
    && (typeof target.chatId !== 'string' || !target.chatId.trim())) {
    throw new AppError('VALIDATION_FAILED', 'Telegram 路由目标 chatId 必须是非空字符串');
  }
  if (type === 'telegram' && target.messageThreadId !== undefined
    && (!Number.isInteger(target.messageThreadId) || Number(target.messageThreadId) <= 0)) {
    throw new AppError('VALIDATION_FAILED', 'Telegram 路由目标 messageThreadId 必须是正整数');
  }
}


function builtinTemplate(templateKey: string): { titleTemplate: string; bodyTemplate: string; requiredVariables: string[] } | undefined {
  if (templateKey === 'certificate.renewal.result') {
    return {
      titleTemplate: '证书更新结果：{{status}}',
      bodyTemplate: '域名 {{domain}} 的证书版本 {{certificateVersionId}} 已完成处理。',
      requiredVariables: ['status', 'domain', 'certificateVersionId'],
    };
  }
  if (templateKey === 'certificate.status') {
    return {
      titleTemplate: '证书状态变更：{{status}}',
      bodyTemplate: '证书资源 {{resourceId}} 当前状态为 {{status}}。',
      requiredVariables: ['resourceId', 'status'],
    };
  }
  if (templateKey === 'certificate.report') {
    return {
      titleTemplate: '证书报表已生成',
      bodyTemplate: '报表 {{reportId}}（{{reportType}}）已生成完成。',
      requiredVariables: ['reportId', 'reportType'],
    };
  }
  if (templateKey === 'certificate.expiry.warning') {
    return {
      titleTemplate: '证书即将过期：{{domain}}',
      bodyTemplate: '证书 {{domain}} 将在 {{daysRemaining}} 天后过期，请及时续期。',
      requiredVariables: ['domain', 'daysRemaining'],
    };
  }
  if (templateKey === 'certificate.expired') {
    return {
      titleTemplate: '证书已过期：{{domain}}',
      bodyTemplate: '证书 {{domain}} 已过期，请立即处理。',
      requiredVariables: ['domain'],
    };
  }
  if (templateKey === 'certificate.revoked') {
    return {
      titleTemplate: '证书已吊销：{{resourceId}}',
      bodyTemplate: '证书资源 {{resourceId}} 已被吊销，相关服务可能无法继续使用。',
      requiredVariables: ['resourceId'],
    };
  }
  if (templateKey === 'certificate.binding.drift') {
    return {
      titleTemplate: '证书绑定漂移：{{resourceId}}',
      bodyTemplate: '绑定 {{resourceId}} 当前使用的证书与期望版本不一致。',
      requiredVariables: ['resourceId'],
    };
  }
  if (templateKey === 'certificate.report.failed') {
    return {
      titleTemplate: '证书报表生成失败：{{reportId}}',
      bodyTemplate: '报表 {{reportId}}（{{reportType}}）生成失败：{{errorMessage}}',
      requiredVariables: ['reportId', 'reportType', 'errorMessage'],
    };
  }
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
