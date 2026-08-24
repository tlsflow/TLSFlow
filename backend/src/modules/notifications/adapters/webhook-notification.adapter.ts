import { createHmac } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { NotificationChannelAdapter, NotificationSendInput, NotificationSendResult } from '../application/channel-adapter-registry.js';
import type { NotificationChannel } from '../schema/notifications.schema.js';
import { HttpNotificationClient, type HttpNotificationClientPort } from './http-notification-client.js';

const forbiddenHeaders = new Set(['host', 'content-length', 'authorization', 'cookie', 'connection', 'transfer-encoding']);

export class WebhookNotificationAdapter implements NotificationChannelAdapter {
  readonly type = 'webhook' as const;
  constructor(private readonly client: HttpNotificationClientPort = new HttpNotificationClient()) {}
  async validateConfig(channel: NotificationChannel): Promise<void> {
    if (!channel.secretRefs.url) throw new AppError('NOTIFICATION_CHANNEL_INVALID', 'Webhook 渠道缺少 URL SecretRef');
    sanitizeHeaders(channel.config.headers);
  }
  async send(input: NotificationSendInput): Promise<NotificationSendResult> {
    const body = JSON.stringify({
      requestId: input.request.id,
      eventKey: input.request.eventKey,
      title: input.delivery.renderedTitle,
      body: input.delivery.renderedBody,
      context: input.request.context,
    });
    const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8', ...sanitizeHeaders(input.channel.config.headers) };
    const signingSecret = input.secrets.signingSecret;
    if (signingSecret) {
      const timestamp = String(Math.floor(Date.now() / 1000));
      headers['x-gcac-timestamp'] = timestamp;
      headers['x-gcac-signature'] = `sha256=${createHmac('sha256', signingSecret).update(`${timestamp}.${body}`).digest('hex')}`;
    }
    const response = await this.client.request({
      url: requiredSecret(input, 'url'),
      method: String(input.channel.config.method ?? 'POST').toUpperCase(),
      headers,
      body,
      maxResponseBytes: 64 * 1024,
      maxRedirects: 2,
    });
    const success = response.statusCode >= 200 && response.statusCode < 300;
    return {
      success,
      retryable: response.statusCode === 408 || response.statusCode === 429 || response.statusCode >= 500,
      statusCode: response.statusCode,
      failureCategory: success ? undefined : response.statusCode === 429 ? 'rate_limit' : 'rejected',
      failureMessage: success ? undefined : `Webhook HTTP ${response.statusCode}`,
      responseSummary: { statusCode: response.statusCode, contentType: response.headers['content-type'] },
    };
  }
}

function sanitizeHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [name, rawValue] of Object.entries(value)) {
    const normalized = name.toLowerCase();
    if (!/^[a-z0-9-]+$/.test(normalized) || forbiddenHeaders.has(normalized) || typeof rawValue !== 'string' || /[\r\n]/.test(rawValue)) {
      throw new AppError('NOTIFICATION_CHANNEL_INVALID', 'Webhook Header 不在允许范围', { name });
    }
    result[normalized] = rawValue;
  }
  return result;
}
function requiredSecret(input: NotificationSendInput, key: string): string {
  const value = input.secrets[key];
  if (!value) throw new AppError('NOTIFICATION_CHANNEL_INVALID', '通知渠道 Secret 未配置', { key });
  return value;
}
