import { createHmac } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { NotificationChannelAdapter, NotificationSendInput, NotificationSendResult } from '../application/channel-adapter-registry.js';
import type { NotificationChannel } from '../schema/notifications.schema.js';
import { validatePlatformWebhookEndpoint } from '../security/platform-webhook-endpoint-policy.js';
import { HttpNotificationClient, type HttpNotificationClientPort } from './http-notification-client.js';

export class FeishuNotificationAdapter implements NotificationChannelAdapter {
  readonly type = 'feishu' as const;

  constructor(private readonly client: HttpNotificationClientPort = new HttpNotificationClient()) {}

  async validateConfig(channel: NotificationChannel): Promise<void> {
    if (!channel.secretRefs.webhookUrl) {
      throw new AppError('NOTIFICATION_CHANNEL_INVALID', '飞书渠道缺少 webhookUrl SecretRef');
    }
  }

  async send(input: NotificationSendInput): Promise<NotificationSendResult> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signingSecret = input.secrets.signingSecret;
    const body: Record<string, unknown> = {
      msg_type: 'text',
      content: { text: notificationText(input, 20_000) },
    };
    if (signingSecret) {
      body.timestamp = timestamp;
      body.sign = createHmac('sha256', `${timestamp}\n${signingSecret}`).digest('base64');
    }
    const webhookUrl = requiredSecret(input, 'webhookUrl');
    const endpoint = validatePlatformWebhookEndpoint('feishu', webhookUrl, input.privateOrigins);
    const response = await this.client.request({
      url: webhookUrl,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
      trustedPrivateOrigins: endpoint.trustedPrivateOrigins,
    });
    const payload = parseJson(response.body);
    const code = Number(payload.code ?? payload.StatusCode ?? -1);
    const success = response.statusCode >= 200 && response.statusCode < 300 && code === 0;
    return platformResult(success, response.statusCode, code, payload.msg ?? payload.StatusMessage, '飞书拒绝消息');
  }
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

function platformResult(success: boolean, statusCode: number, code: number, message: unknown, fallback: string): NotificationSendResult {
  const rateLimited = statusCode === 429 || code === 9499;
  return {
    success,
    retryable: rateLimited || statusCode >= 500,
    statusCode,
    failureCategory: success ? undefined : rateLimited ? 'rate_limit' : statusCode === 401 || statusCode === 403 ? 'authentication' : 'rejected',
    failureMessage: success ? undefined : String(message ?? fallback).slice(0, 300),
    responseSummary: { code, message: typeof message === 'string' ? message.slice(0, 100) : undefined },
  };
}
