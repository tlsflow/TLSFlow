import type { NotificationRequest, NotificationSilence } from '../schema/notifications.schema.js';
import { NotificationsDomainService } from '../domain/notifications.domain-service.js';

export class NotificationDedupeService {
  constructor(private readonly domain = new NotificationsDomainService()) {}

  findSilence(silences: NotificationSilence[], event: Record<string, unknown>, now = new Date()): NotificationSilence | undefined {
    const timestamp = now.getTime();
    return silences.find((silence) => silence.status === 'active'
      && new Date(silence.startsAt).getTime() <= timestamp
      && new Date(silence.endsAt).getTime() > timestamp
      && this.domain.matches(silence.matcher, event));
  }

  findDuplicate(requests: NotificationRequest[], eventKey: string, windowSeconds: number, now = new Date()): NotificationRequest | undefined {
    if (windowSeconds <= 0) return undefined;
    const threshold = now.getTime() - windowSeconds * 1000;
    return requests.find((request) => request.eventKey === eventKey && new Date(request.createdAt).getTime() >= threshold);
  }
}
