import { AppError } from '../../../common/errors/app-error.js';
import type { NotificationChannelAdapter, NotificationSendInput, NotificationSendResult } from '../application/channel-adapter-registry.js';
import type { NotificationChannel } from '../schema/notifications.schema.js';
import { HttpNotificationClient, type HttpNotificationClientPort } from './http-notification-client.js';

const telegramApiBaseUrl = 'https://api.telegram.org';
const telegramBotTokenPattern = /^\d+:[A-Za-z0-9_-]+$/;

export class TelegramNotificationAdapter implements NotificationChannelAdapter {
  readonly type = 'telegram' as const;

  constructor(private readonly client: HttpNotificationClientPort = new HttpNotificationClient()) {}

  async validateConfig(channel: NotificationChannel): Promise<void> {
    if (!channel.secretRefs.botToken) {
      throw new AppError('NOTIFICATION_CHANNEL_INVALID', 'Telegram 渠道缺少 botToken SecretRef');
    }
    if (!stringConfig(channel, 'chatId')) {
      throw new AppError('NOTIFICATION_CHANNEL_INVALID', 'Telegram 渠道缺少 chatId');
    }
    if (channel.config.messageThreadId !== undefined && numberConfig(channel, 'messageThreadId') === undefined) {
      throw new AppError('NOTIFICATION_CHANNEL_INVALID', 'Telegram messageThreadId 必须是正整数');
    }
  }

  async send(input: NotificationSendInput): Promise<NotificationSendResult> {
    const botToken = requiredSecret(input, 'botToken');
    if (!telegramBotTokenPattern.test(botToken)) {
      throw new AppError('NOTIFICATION_CHANNEL_INVALID', 'Telegram Bot Token 格式无效');
    }
    const chatId = targetString(input, 'chatId') ?? stringConfig(input.channel, 'chatId');
    if (!chatId) throw new AppError('NOTIFICATION_CHANNEL_INVALID', 'Telegram 渠道缺少 chatId');
    const messageThreadId = targetNumber(input, 'messageThreadId') ?? numberConfig(input.channel, 'messageThreadId');
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: notificationText(input, 4096),
      disable_web_page_preview: true,
    };
    if (messageThreadId !== undefined) body.message_thread_id = messageThreadId;
    const response = await this.client.request({
      url: `${telegramApiBaseUrl}/bot${botToken}/sendMessage`,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
      maxRedirects: 0,
    });
    const payload = parseJson(response.body);
    const success = response.statusCode >= 200 && response.statusCode < 300 && payload.ok === true;
    const errorCode = Number(payload.error_code ?? response.statusCode);
    const rateLimited = response.statusCode === 429 || errorCode === 429;
    const externalId = readMessageId(payload);
    return {
      success,
      retryable: rateLimited || response.statusCode >= 500,
      externalId,
      statusCode: response.statusCode,
      failureCategory: success ? undefined : rateLimited ? 'rate_limit' : errorCode === 401 || errorCode === 403 ? 'authentication' : 'rejected',
      failureMessage: success ? undefined : String(payload.description ?? 'Telegram 拒绝消息').slice(0, 300),
      responseSummary: { ok: payload.ok, errorCode: payload.error_code, messageId: externalId },
    };
  }
}

function requiredSecret(input: NotificationSendInput, key: string): string {
  const value = input.secrets[key];
  if (!value) throw new AppError('NOTIFICATION_CHANNEL_INVALID', '通知渠道 Secret 未配置', { key });
  return value;
}

function stringConfig(channel: NotificationChannel, key: string): string | undefined {
  const value = channel.config[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberConfig(channel: NotificationChannel, key: string): number | undefined {
  const value = channel.config[key];
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function targetString(input: NotificationSendInput, key: string): string | undefined {
  const value = input.delivery.targetSnapshot[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function targetNumber(input: NotificationSendInput, key: string): number | undefined {
  const value = input.delivery.targetSnapshot[key];
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function notificationText(input: NotificationSendInput, limit: number): string {
  return `${input.delivery.renderedTitle ?? ''}\n${input.delivery.renderedBody ?? ''}`.trim().slice(0, limit);
}

function parseJson(value: string): Record<string, unknown> {
  try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
}

function readMessageId(payload: Record<string, unknown>): string | undefined {
  const result = payload.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return undefined;
  const messageId = (result as Record<string, unknown>).message_id;
  return typeof messageId === 'number' || typeof messageId === 'string' ? String(messageId) : undefined;
}
