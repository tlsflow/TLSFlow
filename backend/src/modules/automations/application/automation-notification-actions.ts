import type { AutomationRunDto, AutomationRunTargetDto, SendNotificationActionConfigDto } from '../dto/automations.dto.js';
import type { NotificationPort } from './notification-port.js';

export class AutomationNotificationActionService {
  constructor(private readonly notifications: NotificationPort) {}

  enqueue(input: {
    tenantId: string;
    run: AutomationRunDto;
    target?: AutomationRunTargetDto;
    config: SendNotificationActionConfigDto;
    eventKey: string;
  }): Promise<{ requestId: string }> {
    return this.notifications.enqueue({
      tenantId: input.tenantId,
      routeId: input.config.routeId,
      channelId: input.config.channelId,
      templateKey: input.config.templateKey,
      eventKey: input.eventKey,
      idempotencyKey: `automation:${input.run.id}:${input.target?.id ?? 'run'}:${input.eventKey}`,
      context: {
        automation: { id: input.run.automationId, version: input.run.automationVersion, name: input.run.automationNameSnapshot },
        run: { id: input.run.id, status: input.run.status, triggerType: input.run.triggerType, targetSummary: input.run.targetSummary, failureStage: input.run.failureStage },
        target: input.target ? { id: input.target.id, snapshot: input.target.targetSnapshot, status: input.target.status, failureStage: input.target.failureStage, errorCode: input.target.errorCode, errorMessage: input.target.errorMessage } : undefined,
      },
    });
  }
}
