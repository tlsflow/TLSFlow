import { AppError } from '../../../common/errors/app-error.js';
import type { NotificationsApplicationService } from './notifications.application-service.js';

/**
 * 证书通知事件是系统能力，不允许由租户自行创造。
 * 每项只描述稳定事件合同和默认模板键；租户只配置投递渠道、模板覆盖和启停状态。
 */
export const certificateNotificationEventDefinitions = [
  { eventType: 'certificate.renewal.result', templateKey: 'certificate.renewal.result' },
  { eventType: 'certificate.status', templateKey: 'certificate.status' },
  { eventType: 'certificate.report', templateKey: 'certificate.report' },
  { eventType: 'certificate.expiry.warning', templateKey: 'certificate.expiry.warning' },
  { eventType: 'certificate.expired', templateKey: 'certificate.expired' },
  { eventType: 'certificate.revoked', templateKey: 'certificate.revoked' },
  { eventType: 'certificate.binding.drift', templateKey: 'certificate.binding.drift' },
  { eventType: 'certificate.report.failed', templateKey: 'certificate.report.failed' },
] as const;

export const certificateNotificationEventTypes = certificateNotificationEventDefinitions.map((item) => item.eventType);

export type CertificateNotificationEventType = typeof certificateNotificationEventDefinitions[number]['eventType'];
export type CertificateNotificationEventDefinition = typeof certificateNotificationEventDefinitions[number];

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
  list(): readonly CertificateNotificationEventDefinition[] {
    return certificateNotificationEventDefinitions;
  }

  find(eventType: string): CertificateNotificationEventDefinition | undefined {
    return certificateNotificationEventDefinitions.find((item) => item.eventType === eventType);
  }

  isRegistered(eventType: string): eventType is CertificateNotificationEventType {
    return Boolean(this.find(eventType));
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
