import { newId } from '../../../shared/id.js';
import type { AlertRuleScope, MonitorJob } from '../schema/monitors.schema.js';

export class MonitoringScheduler {
  createJobs(input: { tenantId?: string; scope?: AlertRuleScope; now?: string }): MonitorJob[] {
    const now = input.now ?? new Date().toISOString();
    const scope = { ...(input.scope ?? {}), tenantId: input.tenantId ?? input.scope?.tenantId };
    return ['certificate', 'binding', 'execution', 'agent', 'capability'].map((kind) => ({
      id: newId('monjob'),
      tenantId: input.tenantId,
      kind: kind as MonitorJob['kind'],
      status: 'queued',
      scope,
      createdAt: now,
      updatedAt: now,
    }));
  }

  markRunning(job: MonitorJob, now = new Date().toISOString()): MonitorJob {
    return { ...job, status: 'running', updatedAt: now };
  }

  markSucceeded(job: MonitorJob, now = new Date().toISOString()): MonitorJob {
    return { ...job, status: 'succeeded', updatedAt: now };
  }

  markFailed(job: MonitorJob, errorMessage: string, now = new Date().toISOString()): MonitorJob {
    return { ...job, status: 'failed', errorMessage, updatedAt: now };
  }
}
