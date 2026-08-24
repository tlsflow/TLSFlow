import { newId } from '../../../shared/id.js';
import type { AutomationTriggerDto } from '../dto/automations.dto.js';
import { cronMatches, nextCronOccurrence } from '../domain/automation-schedule.js';
import { AutomationsApplicationService } from './automations.application-service.js';
import { AutomationsRepository } from '../repository/automations.repository.js';

export interface AutomationClock {
  now(): Date;
}

export interface AutomationRunExecutionPort {
  execute(runId: string, tenantId: string): Promise<unknown>;
}

export interface AutomationSchedulerResult {
  createdRunIds: string[];
  executedRunIds: string[];
}

const defaultClock: AutomationClock = { now: () => new Date() };

export { cronMatches, nextCronOccurrence } from '../domain/automation-schedule.js';

export class AutomationScheduler {
  constructor(
    private readonly repository: AutomationsRepository,
    private readonly service: AutomationsApplicationService,
    private readonly executor: AutomationRunExecutionPort,
    private readonly ownerId = newId('scheduler'),
    private readonly clock: AutomationClock = defaultClock,
  ) {}

  async runOnce(maxRuns = 10): Promise<AutomationSchedulerResult> {
    const createdRunIds: string[] = [];
    for (const tenantId of await this.repository.listAutomationTenantIds()) {
      createdRunIds.push(...await this.scan(tenantId));
    }
    const executedRunIds: string[] = [];
    for (const run of await this.repository.listRunnableRuns(maxRuns)) {
      const leasedUntil = new Date(this.clock.now().getTime() + 300_000);
      if (!await this.repository.acquireSchedulerLease(`automation-run:${run.id}`, this.ownerId, leasedUntil)) continue;
      await this.executor.execute(run.id, run.tenantId);
      executedRunIds.push(run.id);
    }
    return { createdRunIds, executedRunIds };
  }

  async scan(tenantId: string): Promise<string[]> {
    const now = this.clock.now();
    const leaseKey = `automation-scan:${tenantId}:${now.toISOString().slice(0, 16)}`;
    if (!await this.repository.acquireSchedulerLease(leaseKey, this.ownerId, new Date(now.getTime() + 30_000))) return [];
    const created: string[] = [];
    for (const automation of await this.repository.listAutomations(tenantId)) {
      if (automation.status !== 'active' || !automation.nextRunAt || new Date(automation.nextRunAt) > now) continue;
      const version = await this.repository.getVersion(automation.id, automation.currentVersion, tenantId);
      if (!version || (version.trigger.type !== 'once' && version.trigger.type !== 'schedule')) continue;
      const scheduledAt = automation.nextRunAt;
      const idempotencyKey = `${version.trigger.type === 'once' ? 'once' : 'schedule'}:${automation.id}:${scheduledAt}`;
      const run = await this.service.createOnDemandRun(tenantId, 'system_scheduler', automation.id, idempotencyKey, automation.version, { triggerType: 'schedule', scheduledAt });
      created.push(run.id);
      const nextRunAt = version.trigger.type === 'once' ? undefined : nextCronOccurrence(version.trigger, now)?.toISOString();
      await this.repository.updateAutomation(automation.id, tenantId, { nextRunAt, lastRunAt: scheduledAt, updatedAt: now.toISOString() });
    }
    return created;
  }
}
