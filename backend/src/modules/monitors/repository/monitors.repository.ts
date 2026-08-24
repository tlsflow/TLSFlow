import { newId } from '../../../shared/id.js';
import type { AlertRule, RiskEvent } from '../schema/monitors.schema.js';
import type { CreateAlertRuleInput, ListRiskEventsQuery, UpsertRiskEventInput } from '../dto/monitors.dto.js';

export interface MonitorsRepository {
  readonly moduleName: 'monitors';
  upsertRiskEvent(input: UpsertRiskEventInput): RiskEvent;
  listRiskEvents(query?: ListRiskEventsQuery): RiskEvent[];
  getRiskEventByDedupKey(dedupKey: string): RiskEvent | undefined;
  createAlertRule(input: CreateAlertRuleInput): AlertRule;
  listAlertRules(tenantId?: string): AlertRule[];
}

export class InMemoryMonitorsRepository implements MonitorsRepository {
  readonly moduleName = 'monitors' as const;
  private readonly riskEvents = new Map<string, RiskEvent>();
  private readonly alertRules = new Map<string, AlertRule>();

  upsertRiskEvent(input: UpsertRiskEventInput): RiskEvent {
    const existing = this.getRiskEventByDedupKey(input.dedupKey);
    if (existing) {
      const updated: RiskEvent = {
        ...existing,
        type: input.type,
        source: input.source,
        severity: input.severity,
        title: input.title,
        summary: input.summary,
        scope: { ...existing.scope, ...input.scope },
        metadata: { ...existing.metadata, ...(input.metadata ?? {}) },
        lastDetectedAt: input.detectedAt,
        occurrenceCount: existing.occurrenceCount + 1,
        resolvedAt: undefined,
        status: 'OPEN',
      };
      this.riskEvents.set(updated.id, updated);
      return updated;
    }

    const created: RiskEvent = {
      id: newId('risk'),
      dedupKey: input.dedupKey,
      type: input.type,
      source: input.source,
      status: 'OPEN',
      severity: input.severity,
      title: input.title,
      summary: input.summary,
      scope: { ...input.scope },
      metadata: { ...(input.metadata ?? {}) },
      firstDetectedAt: input.detectedAt,
      lastDetectedAt: input.detectedAt,
      occurrenceCount: 1,
    };
    this.riskEvents.set(created.id, created);
    return created;
  }

  listRiskEvents(query?: ListRiskEventsQuery): RiskEvent[] {
    return [...this.riskEvents.values()].filter((item) => {
      if (query?.tenantId !== undefined && item.scope.tenantId !== undefined && item.scope.tenantId !== query.tenantId) return false;
      if (query?.status !== undefined && item.status !== query.status) return false;
      if (query?.severity !== undefined && item.severity !== query.severity) return false;
      if (query?.type !== undefined && item.type !== query.type) return false;
      return true;
    });
  }

  getRiskEventByDedupKey(dedupKey: string): RiskEvent | undefined {
    return [...this.riskEvents.values()].find((item) => item.dedupKey === dedupKey);
  }

  createAlertRule(input: CreateAlertRuleInput): AlertRule {
    const now = new Date().toISOString();
    const rule: AlertRule = {
      id: newId('rule'),
      name: input.name,
      threshold: { ...input.threshold },
      scope: { ...(input.scope ?? {}) },
      status: input.status ?? 'active',
      silence: input.silence === undefined ? undefined : { ...input.silence },
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    this.alertRules.set(rule.id, rule);
    return rule;
  }

  listAlertRules(tenantId?: string): AlertRule[] {
    return [...this.alertRules.values()].filter((item) => tenantId === undefined || item.scope.tenantId === undefined || item.scope.tenantId === tenantId);
  }
}
