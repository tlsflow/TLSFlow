import { NotificationsDomainService } from '../domain/notifications.domain-service.js';
import type { NotificationRoute } from '../schema/notifications.schema.js';

export class NotificationRouteMatcher {
  constructor(private readonly domain = new NotificationsDomainService()) {}

  match(routes: NotificationRoute[], event: Record<string, unknown>): NotificationRoute[] {
    const matched: NotificationRoute[] = [];
    for (const route of [...routes].sort((left, right) => left.priority - right.priority || left.createdAt.localeCompare(right.createdAt))) {
      if (route.status !== 'active' || !this.domain.matches(route.matcher, event)) continue;
      matched.push(route);
      if (route.stopOnMatch) break;
    }
    return matched;
  }
}
