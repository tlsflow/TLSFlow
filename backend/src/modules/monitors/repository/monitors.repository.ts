import type { PageQuery } from '../../../common/pagination/pagination.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { newId } from '../../../shared/id.js';
import type { AlertRule, RiskEvent } from '../schema/monitors.schema.js';
import type { CreateAlertRuleInput, ListRiskEventsQuery, UpsertRiskEventInput } from '../dto/monitors.dto.js';

export interface MonitorsRepository {
  readonly moduleName: 'monitors';
  upsertRiskEvent(input: UpsertRiskEventInput): Promise<RiskEvent>;
  listRiskEvents(query?: ListRiskEventsQuery): Promise<RiskEvent[]>;
  getRiskEventByDedupKey(dedupKey: string): Promise<RiskEvent | undefined>;
  createAlertRule(input: CreateAlertRuleInput): Promise<AlertRule>;
  listAlertRules(tenantId?: string): Promise<AlertRule[]>;
}

export class PgMonitorsRepository implements MonitorsRepository {
  readonly moduleName = 'monitors' as const;

  constructor(private readonly db: DatabasePort = new PgliteDatabase()) {}

  async upsertRiskEvent(input: UpsertRiskEventInput): Promise<RiskEvent> {
    const existing = await this.getRiskEventByDedupKey(input.dedupKey);
    if (existing) {
      const now = new Date().toISOString();
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
      await this.db.query(`update pg_monitor_risk_events
        set risk_type = $2,
            source = $3,
            severity = $4,
            status = $5,
            title = $6,
            summary = $7,
            scope = $8::jsonb,
            metadata = $9::jsonb,
            last_detected_at = $10::timestamptz,
            resolved_at = null,
            occurrence_count = $11,
            updated_at = $12::timestamptz
        where id = $1`, [
        updated.id,
        updated.type,
        updated.source,
        updated.severity,
        updated.status,
        updated.title,
        updated.summary,
        JSON.stringify(updated.scope),
        JSON.stringify(updated.metadata),
        updated.lastDetectedAt,
        updated.occurrenceCount,
        now,
      ]);
      return updated;
    }

    const now = new Date().toISOString();
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
    await this.db.query(`insert into pg_monitor_risk_events (
      id, tenant_id, dedup_key, risk_type, source, severity, status, title, summary,
      scope, metadata, first_detected_at, last_detected_at, resolved_at, occurrence_count, created_at, updated_at
    ) values (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::timestamptz,$13::timestamptz,$14::timestamptz,$15,$16::timestamptz,$17::timestamptz
    )`, [
      created.id,
      created.scope.tenantId ?? null,
      created.dedupKey,
      created.type,
      created.source,
      created.severity,
      created.status,
      created.title,
      created.summary,
      JSON.stringify(created.scope),
      JSON.stringify(created.metadata),
      created.firstDetectedAt,
      created.lastDetectedAt,
      created.resolvedAt ?? null,
      created.occurrenceCount,
      now,
      now,
    ]);
    return created;
  }

  async listRiskEvents(query?: ListRiskEventsQuery): Promise<RiskEvent[]> {
    const rows = (await this.db.query<RiskEventRow>(`select * from pg_monitor_risk_events order by last_detected_at desc, created_at desc`)).rows.map(toRiskEvent);
    return rows.filter((item) => {
      if (query?.tenantId !== undefined && item.scope.tenantId !== query.tenantId) return false;
      if (query?.status !== undefined && item.status !== query.status) return false;
      if (query?.severity !== undefined && item.severity !== query.severity) return false;
      if (query?.type !== undefined && item.type !== query.type) return false;
      return true;
    });
  }

  async getRiskEventByDedupKey(dedupKey: string): Promise<RiskEvent | undefined> {
    const row = (await this.db.query<RiskEventRow>(`select * from pg_monitor_risk_events where dedup_key = $1 limit 1`, [dedupKey])).rows[0];
    return row ? toRiskEvent(row) : undefined;
  }

  async createAlertRule(input: CreateAlertRuleInput): Promise<AlertRule> {
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
    await this.db.query(`insert into pg_monitor_alert_rules (
      id, tenant_id, name, threshold, scope, status, silence, created_by, created_at, updated_at
    ) values (
      $1,$2,$3,$4::jsonb,$5::jsonb,$6,$7::jsonb,$8,$9::timestamptz,$10::timestamptz
    )`, [
      rule.id,
      rule.scope.tenantId ?? null,
      rule.name,
      JSON.stringify(rule.threshold),
      JSON.stringify(rule.scope),
      rule.status,
      JSON.stringify(rule.silence ?? null),
      rule.createdBy,
      rule.createdAt,
      rule.updatedAt,
    ]);
    return rule;
  }

  async listAlertRules(tenantId?: string): Promise<AlertRule[]> {
    const rows = (await this.db.query<AlertRuleRow>(`select * from pg_monitor_alert_rules order by created_at desc`)).rows.map(toAlertRule);
    return tenantId === undefined ? rows : rows.filter((item) => item.scope.tenantId === tenantId);
  }
}

type RiskEventRow = {
  id: string;
  tenant_id?: string | null;
  dedup_key: string;
  risk_type: string;
  source: string;
  severity: string;
  status: string;
  title: string;
  summary: string;
  scope: unknown;
  metadata: unknown;
  first_detected_at: string;
  last_detected_at: string;
  resolved_at?: string | null;
  created_at: string;
  updated_at: string;
  occurrence_count: number;
};

function toRiskEvent(row: RiskEventRow): RiskEvent {
  const scope = asObject(row.scope);
  return {
    id: row.id,
    dedupKey: row.dedup_key,
    type: row.risk_type as RiskEvent['type'],
    source: row.source as RiskEvent['source'],
    status: row.status as RiskEvent['status'],
    severity: row.severity as RiskEvent['severity'],
    title: row.title,
    summary: row.summary,
    scope: {
      tenantId: row.tenant_id ?? undefined,
      certificateAssetId: scope.certificateAssetId as string | undefined,
      certificateVersionId: scope.certificateVersionId as string | undefined,
      bindingId: scope.bindingId as string | undefined,
      executionRunId: scope.executionRunId as string | undefined,
      serviceInstanceId: scope.serviceInstanceId as string | undefined,
      hostId: scope.hostId as string | undefined,
    },
    metadata: asObject(row.metadata),
    firstDetectedAt: row.first_detected_at,
    lastDetectedAt: row.last_detected_at,
    resolvedAt: row.resolved_at ?? undefined,
    occurrenceCount: Number(row.occurrence_count ?? 1),
  };
}

type AlertRuleRow = {
  id: string;
  tenant_id?: string | null;
  name: string;
  threshold: unknown;
  scope: unknown;
  status: string;
  silence?: unknown;
  created_by: string;
  created_at: string;
  updated_at: string;
};

function toAlertRule(row: AlertRuleRow): AlertRule {
  const scope = asObject(row.scope);
  return {
    id: row.id,
    name: row.name,
    threshold: asObject(row.threshold) as unknown as AlertRule['threshold'],
    scope: {
      tenantId: (scope.tenantId as string | undefined) ?? row.tenant_id ?? undefined,
      riskTypes: Array.isArray(scope.riskTypes) ? scope.riskTypes as AlertRule['scope']['riskTypes'] : undefined,
      severities: Array.isArray(scope.severities) ? scope.severities as AlertRule['scope']['severities'] : undefined,
      certificateAssetId: scope.certificateAssetId as string | undefined,
      certificateVersionId: scope.certificateVersionId as string | undefined,
      bindingId: scope.bindingId as string | undefined,
      serviceInstanceId: scope.serviceInstanceId as string | undefined,
      hostId: scope.hostId as string | undefined,
    },
    status: row.status as AlertRule['status'],
    silence: Object.keys(asObject(row.silence)).length === 0 ? undefined : asObject(row.silence) as AlertRule['silence'],
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
