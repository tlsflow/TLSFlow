import type {
  NotificationChannelStatus,
  NotificationChannelTarget,
  NotificationChannelType,
  NotificationFailureCategory,
  NotificationMatcher,
} from '../schema/notifications.schema.js';

export interface CreateNotificationChannelInput {
  tenantId: string;
  name: string;
  type: NotificationChannelType;
  status?: Exclude<NotificationChannelStatus, 'deleted'>;
  config?: Record<string, unknown>;
  secretRefs?: Record<string, string>;
}

export interface UpdateNotificationChannelInput {
  tenantId: string;
  id: string;
  version: number;
  name?: string;
  status?: Exclude<NotificationChannelStatus, 'deleted'>;
  config?: Record<string, unknown>;
  secretRefs?: Record<string, string>;
}

export interface UpdateNotificationSettingsInput {
  tenantId: string;
  privateOrigins: {
    wecom: string[];
    feishu: string[];
    dingtalk: string[];
  };
  updatedBy: string;
  version: number;
}

export interface CreateNotificationRouteInput {
  tenantId: string;
  name: string;
  status?: 'active' | 'disabled';
  priority: number;
  matcher?: NotificationMatcher;
  templateKey?: string;
  channelTargets: NotificationChannelTarget[];
  stopOnMatch?: boolean;
  dedupeWindowSeconds?: number;
}

export interface UpdateNotificationRouteInput extends Partial<Omit<CreateNotificationRouteInput, 'tenantId'>> {
  tenantId: string;
  id: string;
  version: number;
}

export interface UpsertNotificationTemplateInput {
  tenantId: string;
  templateKey: string;
  locale: string;
  titleTemplate: string;
  bodyTemplate: string;
  requiredVariables?: string[];
  status?: 'active' | 'disabled';
  version?: number;
}

export interface CreateNotificationSilenceInput {
  tenantId: string;
  name: string;
  matcher?: NotificationMatcher;
  reason: string;
  startsAt: string;
  endsAt: string;
  createdBy: string;
}

export interface UpdateNotificationSilenceInput extends Partial<Omit<CreateNotificationSilenceInput, 'tenantId' | 'createdBy'>> {
  tenantId: string;
  id: string;
  version: number;
  status?: 'active' | 'disabled';
}

export interface EnqueueNotificationInput {
  tenantId: string;
  routeId?: string;
  channelId?: string;
  templateKey?: string;
  eventKey: string;
  eventId?: string;
  eventType?: string;
  occurredAt?: string;
  payloadVersion?: number;
  idempotencyKey: string;
  context: Record<string, unknown>;
  source?: string;
  sourceRefs?: Record<string, string>;
  locale?: string;
}

export interface NotificationPageQuery {
  tenantId: string;
  page?: number;
  pageSize?: number;
  status?: string;
  source?: string;
  eventType?: string;
  channelId?: string;
  requestId?: string;
}

export interface NotificationPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CompleteDeliveryAttemptInput {
  deliveryId: string;
  leaseOwner: string;
  success: boolean;
  retryable: boolean;
  failureCategory?: NotificationFailureCategory;
  failureMessage?: string;
  statusCode?: number;
  latencyMs?: number;
  externalId?: string;
  responseSummary?: Record<string, unknown>;
  nextAttemptAt?: string;
}
