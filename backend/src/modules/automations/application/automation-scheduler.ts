import { newId } from '../../../shared/id.js';
import type { AutomationTriggerDto } from '../dto/automations.dto.js';
import { AutomationsApplicationService } from './automations.application-service.js';
import { AutomationsRepository } from '../repository/automations.repository.js';

export interface AutomationClock {
  now(): Date;
}

const defaultClock: AutomationClock = { now: () => new Date() };

export function cronMatches(cron: string, date: Date, timeZone: string): boolean {
  const fields = cron.trim().split(/\s+/).map((field) => field.split(','));
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', minute: '2-digit', hour: '2-digit', day: '2-digit', month: '2-digit', weekday: 'short' }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const local = [Number(values.minute), Number(values.hour), Number(values.day), Number(values.month), ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday)];
  return fields.every((field, index) => field.some((value) => cronFieldMatches(value, local[index]!, index)));
}

function cronFieldMatches(field: string, value: number, index: number): boolean {
  if (field === '*') return true;
  if (field.startsWith('*/')) return value % Number(field.slice(2)) === 0;
  if (field.includes('-')) { const [start, end] = field.split('-').map(Number); return value >= start && value <= end; }
  return Number(field) === value || (index === 3 && Number(field) === value);
}

export function nextCronOccurrence(trigger: Extract<AutomationTriggerDto, { type: 'schedule' }>, from: Date): Date | undefined {
  const candidate = new Date(from.getTime() + 60_000 - (from.getTime() % 60_000));
  for (let index = 0; index < 366 * 24 * 60; index += 1) {
    const current = new Date(candidate.getTime() + index * 60_000);
    if (cronMatches(trigger.cron, current, trigger.timeZone)) return current;
  }
  return undefined;
}

export class AutomationScheduler {
  constructor(
    private readonly repository: AutomationsRepository,
    private readonly service: AutomationsApplicationService,
    private readonly ownerId = newId('scheduler'),
    private readonly clock: AutomationClock = defaultClock,
  ) {}

  async scan(tenantId: string): Promise<string[]> {
    const now = this.clock.now();
    const leaseKey = `automation-scan:${tenantId}:${now.toISOString().slice(0, 16)}`;
    if (!await this.repository.acquireSchedulerLease(leaseKey, this.ownerId, new Date(now.getTime() + 30_000))) return [];
    const created: string[] = [];
    for (const automation of await this.repository.listAutomations(tenantId)) {
      if (automation.status !== 'active' || !automation.nextRunAt || new Date(automation.nextRunAt) > now) continue;
      const version = await this.repository.getVersion(automation.id, automation.currentVersion, tenantId);
      if (!version || version.trigger.type !== 'schedule') continue;
      const scheduledAt = automation.nextRunAt;
      const idempotencyKey = `schedule:${automation.id}:${scheduledAt}`;
      const run = await this.service.createOnDemandRun(tenantId, 'system_scheduler', automation.id, idempotencyKey, automation.version, { triggerType: 'schedule', scheduledAt });
      created.push(run.id);
      const nextRunAt = nextCronOccurrence(version.trigger, now)?.toISOString();
      await this.repository.updateAutomation(automation.id, tenantId, { nextRunAt, lastRunAt: scheduledAt, updatedAt: now.toISOString() });
    }
    return created;
  }
}
