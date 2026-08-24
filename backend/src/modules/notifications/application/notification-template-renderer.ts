import { NotificationsDomainService } from '../domain/notifications.domain-service.js';
import type { NotificationTemplate } from '../schema/notifications.schema.js';

export interface RenderedNotification {
  title: string;
  body: string;
  context: Record<string, unknown>;
}

export class NotificationTemplateRenderer {
  constructor(private readonly domain = new NotificationsDomainService()) {}

  render(template: NotificationTemplate, input: Record<string, unknown>): RenderedNotification {
    const context = this.domain.sanitizeContext(input);
    return {
      title: this.domain.render(template.titleTemplate, context, template.requiredVariables),
      body: this.domain.render(template.bodyTemplate, context, template.requiredVariables),
      context,
    };
  }
}
