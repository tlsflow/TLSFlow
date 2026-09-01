import { AppError } from '../../../common/errors/app-error.js';
import type { NotificationsApplicationService } from './notifications.application-service.js';

export const certificateNotificationEventTypes = [
  'certificate.renewal.result',
  'certificate.status',
  'certificate.report',
] as const;

export type CertificateNotificationEventType = typeof certificateNotificationEventTypes[number];

export interface CertificateNotificationEvent {
  tenantId: string;
  eventId: string;
  eventType: CertificateNotificationEventType;
  occurredAt: string;
  payloadVersion: number;
  templateKey?: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  sourceRefs?: Record<string, string>;
  locale?: string;
}

export interface CertificateNotificationPort {
  publish(event: CertificateNotificationEvent): Promise<{ requestId: string; status: string }>;
}

/** 中文说明：证书服务先持有窄接口，待通知服务完成装配后再绑定真实实现。 */
export class DeferredCertificateNotificationPort implements CertificateNotificationPort {
  private delegate?: CertificateNotificationPort;

  bind(delegate: CertificateNotificationPort): void {
    if (this.delegate) throw new Error('证书通知端口只能绑定一次');
    this.delegate = delegate;
  }

  async publish(event: CertificateNotificationEvent): Promise<{ requestId: string; status: string }> {
    if (!this.delegate) throw new AppError('NOTIFICATION_CHANNEL_UNAVAILABLE', '通知服务尚未完成生产装配');
    return this.delegate.publish(event);
  }
}

export class CertificateNotificationEventRegistry {
  isRegistered(eventType: string): eventType is CertificateNotificationEventType {
    return (certificateNotificationEventTypes as readonly string[]).includes(eventType);
  }
}

export class CertificateNotificationPublisher implements CertificateNotificationPort {
  constructor(
    private readonly notifications: Pick<NotificationsApplicationService, 'enqueue' | 'getRequest'>,
    private readonly registry = new CertificateNotificationEventRegistry(),
  ) {}

  async publish(event: CertificateNotificationEvent): Promise<{ requestId: string; status: string }> {
    if (!event.tenantId || !event.eventId || !event.idempotencyKey || !event.occurredAt || !this.registry.isRegistered(event.eventType)) {
      throw new AppError(this.registry.isRegistered(event.eventType) ? 'VALIDATION_FAILED' : 'NOTIFICATION_EVENT_TYPE_INVALID', '证书通知事件字段或类型无效', { eventType: event.eventType });
    }
    const templateKey = event.templateKey ?? event.eventType;
    const result = await this.notifications.enqueue({
      tenantId: event.tenantId,
      eventId: event.eventId,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      payloadVersion: event.payloadVersion,
      templateKey,
      eventKey: `${event.eventType}:${event.eventId}`,
      idempotencyKey: event.idempotencyKey,
      source: 'certificate',
      sourceRefs: event.sourceRefs,
      locale: event.locale,
      context: event.payload,
    });
    const request = await this.notifications.getRequest(event.tenantId, result.requestId);
    return { requestId: result.requestId, status: request?.status ?? 'queued' };
  }
}
