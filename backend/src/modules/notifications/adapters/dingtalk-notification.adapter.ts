import { createHmac } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { NotificationChannelAdapter, NotificationSendInput, NotificationSendResult } from '../application/channel-adapter-registry.js';
import type { NotificationChannel } from '../schema/notifications.schema.js';
import { validatePlatformWebhookEndpoint } from '../security/platform-webhook-endpoint-policy.js';
import { HttpNotificationClient, type HttpNotificationClientPort } from './http-notification-client.js';

export class DingTalkNotificationAdapter implements NotificationChannelAdapter {
  readonly type = 'dingtalk' as const;

  constructor(private readonly client: HttpNotificationClientPort = new HttpNotificationClient()) {}

  async validateConfig(channel: NotificationChannel): Promise<void> {
    if (!channel.secretRefs.webhookUrl) {
      throw new AppError('NOTIFICATION_CHANNEL_INVALID', '钉钉渠道缺少 webhookUrl SecretRef');
    }
  }

  async send(input: NotificationSendInput): Promise<NotificationSendResult> {
    const webhookUrl = requiredSecret(input, 'webhookUrl');
    const endpoint = validatePlatformWebhookEndpoint('dingtalk', webhookUrl);
    const url = signedUrl(webhookUrl, input.secrets.signingSecret);
    const response = await this.client.request({
      url,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ msgtype: 'text', text: { content: notificationText(input, 20_000) } }),
      trustedPrivateOrigins: endpoint.trustedPrivateOrigins,
    });
    const payload = parseJson(response.body);
    const code = Number(payload.errcode ?? -1);
    const success = response.statusCode >= 200 && response.statusCode < 300 && code === 0;
    const rateLimited = response.statusCode === 429 || code === 130101;
    return {
      success,
      retryable: rateLimited || response.statusCode >= 500,
      statusCode: response.statusCode,
      failureCategory: success ? undefined : rateLimited ? 'rate_limit' : response.statusCode === 401 || response.statusCode === 403 ? 'authentication' : 'rejected',
      failureMessage: success ? undefined : String(payload.errmsg ?? '钉钉拒绝消息').slice(0, 300),
      responseSummary: { errcode: payload.errcode, errmsg: typeof payload.errmsg === 'string' ? payload.errmsg.slice(0, 100) : undefined },
    };
  }
}

function signedUrl(webhookUrl: string, signingSecret?: string): string {
  if (!signingSecret) return webhookUrl;
  const timestamp = Date.now().toString();
  const sign = createHmac('sha256', signingSecret).update(`${timestamp}\n${signingSecret}`).digest('base64');
  const url = new URL(webhookUrl);
  url.searchParams.set('timestamp', timestamp);
  url.searchParams.set('sign', sign);
  return url.toString();
}

function requiredSecret(input: NotificationSendInput, key: string): string {
  const value = input.secrets[key];
  if (!value) throw new AppError('NOTIFICATION_CHANNEL_INVALID', '通知渠道 Secret 未配置', { key });
  return value;
}

function notificationText(input: NotificationSendInput, limit: number): string {
  return `${input.delivery.renderedTitle ?? ''}\n${input.delivery.renderedBody ?? ''}`.trim().slice(0, limit);
}

function parseJson(value: string): Record<string, unknown> {
  try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
}
