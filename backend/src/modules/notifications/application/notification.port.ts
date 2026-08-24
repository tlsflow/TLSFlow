import type { EnqueueNotificationInput } from '../dto/notifications.dto.js';

export interface NotificationPort {
  enqueue(input: EnqueueNotificationInput): Promise<{ requestId: string }>;
}

export interface AutomationNotificationInput {
  tenantId: string;
  automationRunId: string;
  automationRunTargetId?: string;
  eventType: 'started' | 'completed' | 'failed';
  templateKey: string;
  context: Record<string, unknown>;
  routeId?: string;
}

export class AutomationNotificationPort {
  constructor(private readonly notifications: NotificationPort) {}

  async enqueue(input: AutomationNotificationInput): Promise<{ requestId: string }> {
    const targetPart = input.automationRunTargetId ?? 'run';
    return this.notifications.enqueue({
      tenantId: input.tenantId,
      routeId: input.routeId,
      templateKey: input.templateKey,
      eventKey: `automation:${input.automationRunId}:${targetPart}:${input.eventType}`,
      idempotencyKey: `automation:${input.automationRunId}:${targetPart}:${input.eventType}`,
      source: 'automation',
      sourceRefs: {
        automationRunId: input.automationRunId,
        ...(input.automationRunTargetId ? { automationRunTargetId: input.automationRunTargetId } : {}),
      },
      context: input.context,
    });
  }
}
