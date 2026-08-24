import { AppError } from '../../../common/errors/app-error.js';
import type { NotificationChannelAdapter, NotificationSendInput, NotificationSendResult } from '../application/channel-adapter-registry.js';
import type { NotificationChannel } from '../schema/notifications.schema.js';
import { HttpNotificationClient, type HttpNotificationClientPort } from './http-notification-client.js';

export class SlackNotificationAdapter implements NotificationChannelAdapter {
  readonly type = 'slack' as const;
  constructor(private readonly client: HttpNotificationClientPort = new HttpNotificationClient()) {}
  async validateConfig(channel: NotificationChannel): Promise<void> {
    if (!channel.secretRefs.webhookUrl) throw new AppError('NOTIFICATION_CHANNEL_INVALID', 'Slack 渠道缺少 webhookUrl SecretRef');
  }
  async send(input: NotificationSendInput): Promise<NotificationSendResult> {
    const response = await this.client.request({
      url: requiredSecret(input, 'webhookUrl'),
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ text: `${input.delivery.renderedTitle ?? ''}\n${input.delivery.renderedBody ?? ''}`.trim().slice(0, 4000) }),
    });
    const success = response.statusCode >= 200 && response.statusCode < 300 && response.body.trim() === 'ok';
    return {
      success,
      retryable: response.statusCode === 429 || response.statusCode >= 500,
      statusCode: response.statusCode,
      failureCategory: success ? undefined : response.statusCode === 429 ? 'rate_limit' : 'rejected',
      failureMessage: success ? undefined : response.body.slice(0, 300),
      responseSummary: { response: response.body.slice(0, 100) },
    };
  }
}
function requiredSecret(input: NotificationSendInput, key: string): string {
  const value = input.secrets[key];
  if (!value) throw new AppError('NOTIFICATION_CHANNEL_INVALID', '通知渠道 Secret 未配置', { key });
  return value;
}
