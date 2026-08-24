import type { NotificationPort } from '../../notifications/application/notification.port.js';
import type { RiskEvent } from '../schema/monitors.schema.js';

export interface AlertDispatch {
  ruleId: string;
  riskId: string;
  status: 'persisted' | 'failed';
  requestId?: string;
  reason: string;
}

export class AlertDispatcher {
  constructor(private readonly notifications?: NotificationPort) {}

  async dispatch(ruleIds: string[], risks: RiskEvent[]): Promise<AlertDispatch[]> {
    const dispatches: AlertDispatch[] = [];
    for (const ruleId of ruleIds) {
      for (const risk of risks) {
        dispatches.push(await this.dispatchRisk(ruleId, risk));
      }
    }
    return dispatches;
  }

  private async dispatchRisk(ruleId: string, risk: RiskEvent): Promise<AlertDispatch> {
    if (!this.notifications) {
      return { ruleId, riskId: risk.id, status: 'failed', reason: 'notification_port_unavailable' };
    }
    const notificationKind = risk.status === 'RESOLVED' ? 'recovered' : 'active';
    const idempotencyKey = `monitor:${risk.id}:${ruleId}:${notificationKind}:${risk.severity}`;
    if (!risk.scope.tenantId) {
      return { ruleId, riskId: risk.id, status: 'failed', reason: 'tenant_context_missing' };
    }
    try {
      const result = await this.notifications.enqueue({
        tenantId: risk.scope.tenantId,
        templateKey: 'monitor.risk',
        eventKey: idempotencyKey,
        idempotencyKey,
        source: 'monitor',
        sourceRefs: { riskId: risk.id, ruleId },
        context: {
          eventType: risk.type,
          severity: risk.severity,
          environment: risk.metadata.environment,
          tags: risk.metadata.tags,
          title: risk.title,
          summary: risk.summary,
          riskId: risk.id,
          ruleId,
          notificationKind,
        },
      });
      return { ruleId, riskId: risk.id, status: 'persisted', requestId: result.requestId, reason: 'notification_request_persisted' };
    } catch (error) {
      const errorCode = error && typeof error === 'object' && 'errorCode' in error ? String(error.errorCode) : 'unknown';
      return { ruleId, riskId: risk.id, status: 'failed', reason: `notification_request_failed:${errorCode}` };
    }
  }
}
