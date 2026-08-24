export const notificationChannelTypes = ['email', 'wecom', 'slack', 'feishu', 'dingtalk', 'telegram', 'webhook'] as const;
export type NotificationChannelType = typeof notificationChannelTypes[number];

export const notificationChannelStatuses = ['active', 'disabled', 'deleted'] as const;
export type NotificationChannelStatus = typeof notificationChannelStatuses[number];

export const notificationHealthStatuses = ['unknown', 'healthy', 'degraded', 'unavailable'] as const;
export type NotificationHealthStatus = typeof notificationHealthStatuses[number];

export const notificationRequestStatuses = ['queued', 'partially_delivered', 'delivered', 'failed', 'suppressed'] as const;
export type NotificationRequestStatus = typeof notificationRequestStatuses[number];

export const notificationDeliveryStatuses = ['queued', 'sending', 'retrying', 'delivered', 'failed', 'suppressed'] as const;
export type NotificationDeliveryStatus = typeof notificationDeliveryStatuses[number];

export const notificationFailureCategories = [
  'configuration',
  'authentication',
  'rate_limit',
  'network',
  'timeout',
  'rejected',
  'template',
  'security',
  'unknown',
] as const;
export type NotificationFailureCategory = typeof notificationFailureCategories[number];

export interface NotificationChannel {
  id: string;
  tenantId: string;
  name: string;
  type: NotificationChannelType;
  status: NotificationChannelStatus;
  config: Record<string, unknown>;
  secretRefs: Record<string, string>;
  healthStatus: NotificationHealthStatus;
  consecutiveFailures: number;
  lastSucceededAt?: string;
  lastFailedAt?: string;
  lastLatencyMs?: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version: number;
}

export interface NotificationMatcher {
  sources?: string[];
  eventTypes?: string[];
  severities?: string[];
  environments?: string[];
  tags?: string[];
  channelIds?: string[];
}

export interface NotificationChannelTarget {
  channelId: string;
  target?: Record<string, unknown>;
}

export interface NotificationRoute {
  id: string;
  tenantId: string;
  name: string;
  status: NotificationChannelStatus;
  priority: number;
  matcher: NotificationMatcher;
  channelTargets: NotificationChannelTarget[];
  stopOnMatch: boolean;
  dedupeWindowSeconds: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version: number;
}

export interface NotificationTemplate {
  id: string;
  tenantId: string;
  templateKey: string;
  locale: string;
  titleTemplate: string;
  bodyTemplate: string;
  requiredVariables: string[];
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface NotificationSilence {
  id: string;
  tenantId: string;
  name: string;
  status: NotificationChannelStatus;
  matcher: NotificationMatcher;
  reason: string;
  startsAt: string;
  endsAt: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version: number;
}

export interface NotificationRequest {
  id: string;
  tenantId: string;
  source: string;
  eventKey: string;
  idempotencyKey: string;
  templateKey: string;
  routeId?: string;
  channelId?: string;
  context: Record<string, unknown>;
  sourceRefs: Record<string, string>;
  status: NotificationRequestStatus;
  statusReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationDelivery {
  id: string;
  tenantId: string;
  requestId: string;
  channelId: string;
  channelNameSnapshot: string;
  channelType: NotificationChannelType;
  targetSnapshot: Record<string, unknown>;
  renderedTitle?: string;
  renderedBody?: string;
  status: NotificationDeliveryStatus;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt?: string;
  leaseOwner?: string;
  leaseUntil?: string;
  failureCategory?: NotificationFailureCategory;
  failureMessage?: string;
  responseSummary: Record<string, unknown>;
  externalId?: string;
  latencyMs?: number;
  deliveredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationDeliveryAttempt {
  id: string;
  tenantId: string;
  deliveryId: string;
  attemptNo: number;
  startedAt: string;
  finishedAt?: string;
  success?: boolean;
  retryable?: boolean;
  failureCategory?: NotificationFailureCategory;
  failureMessage?: string;
  statusCode?: number;
  latencyMs?: number;
  responseSummary: Record<string, unknown>;
}
