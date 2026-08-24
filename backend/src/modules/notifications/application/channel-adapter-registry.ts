import { AppError } from '../../../common/errors/app-error.js';
import type {
  NotificationChannel,
  NotificationChannelType,
  NotificationDelivery,
  NotificationFailureCategory,
  NotificationRequest,
} from '../schema/notifications.schema.js';

export interface NotificationSendInput {
  channel: NotificationChannel;
  request: NotificationRequest;
  delivery: NotificationDelivery;
  secrets: Record<string, string>;
  privateOrigins: string[];
}

export interface NotificationSendResult {
  success: boolean;
  retryable: boolean;
  externalId?: string;
  statusCode?: number;
  failureCategory?: NotificationFailureCategory;
  failureMessage?: string;
  responseSummary?: Record<string, unknown>;
}

export interface NotificationChannelAdapter {
  readonly type: NotificationChannelType;
  validateConfig(channel: NotificationChannel): Promise<void>;
  send(input: NotificationSendInput): Promise<NotificationSendResult>;
}

export class ChannelAdapterRegistry {
  private readonly adapters = new Map<NotificationChannelType, NotificationChannelAdapter>();

  register(adapter: NotificationChannelAdapter): this {
    if (this.adapters.has(adapter.type)) {
      throw new AppError('SYSTEM_INTERNAL_ERROR', '通知渠道 Adapter 重复注册', { type: adapter.type });
    }
    this.adapters.set(adapter.type, adapter);
    return this;
  }

  get(type: NotificationChannelType): NotificationChannelAdapter {
    const adapter = this.adapters.get(type);
    if (!adapter) throw new AppError('NOTIFICATION_CHANNEL_UNAVAILABLE', '通知渠道 Adapter 未注册', { type });
    return adapter;
  }
}
