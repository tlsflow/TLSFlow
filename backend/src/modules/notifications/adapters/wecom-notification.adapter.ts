import { AppError } from '../../../common/errors/app-error.js';
import type { NotificationChannelAdapter, NotificationSendInput, NotificationSendResult } from '../application/channel-adapter-registry.js';
import type { NotificationChannel } from '../schema/notifications.schema.js';
import { validatePlatformWebhookEndpoint } from '../security/platform-webhook-endpoint-policy.js';
import { HttpNotificationClient, type HttpNotificationClientPort } from './http-notification-client.js';

export class WeComNotificationAdapter implements NotificationChannelAdapter {
  readonly type = 'wecom' as const;
  constructor(private readonly client: HttpNotificationClientPort = new HttpNotificationClient()) {}

  async validateConfig(channel: NotificationChannel): Promise<void> {
    if (!channel.secretRefs.webhookUrl) throw new AppError('NOTIFICATION_CHANNEL_INVALID', '企业微信渠道缺少 webhookUrl SecretRef');
  }

  async send(input: NotificationSendInput): Promise<NotificationSendResult> {
    const content = `${input.delivery.renderedTitle ?? ''}\n${input.delivery.renderedBody ?? ''}`.trim().slice(0, 4096);
    const webhookUrl = requiredSecret(input, 'webhookUrl');
    const endpoint = validatePlatformWebhookEndpoint('wecom', webhookUrl);
    const response = await this.client.request({
      url: webhookUrl,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ msgtype: 'text', text: { content } }),
      trustedPrivateOrigins: endpoint.trustedPrivateOrigins,
    });
    const payload = parseJson(response.body);
    const success = response.statusCode >= 200 && response.statusCode < 300 && Number(payload.errcode ?? -1) === 0;
    return {
      success,
      retryable: response.statusCode === 429 || response.statusCode >= 500,
      statusCode: response.statusCode,
      failureCategory: success ? undefined : response.statusCode === 429 ? 'rate_limit' : 'rejected',
      failureMessage: success ? undefined : String(payload.errmsg ?? '企业微信拒绝消息').slice(0, 300),
      responseSummary: { errcode: payload.errcode, errmsg: payload.errmsg },
    };
  }
}

function requiredSecret(input: NotificationSendInput, key: string): string {
  const value = input.secrets[key];
  if (!value) throw new AppError('NOTIFICATION_CHANNEL_INVALID', '通知渠道 Secret 未配置', { key });
  return value;
}
function parseJson(value: string): Record<string, unknown> { try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; } }
