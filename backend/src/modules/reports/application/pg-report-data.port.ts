import type { DatabasePort } from '../../../database/database-port.js';
import type { RiskEvent, RiskStatusHistory } from '../../monitors/schema/monitors.schema.js';
import type { DeploymentPlansRepository } from '../../deployment-plans/repository/deployment-plans.repository.js';
import type { AutomationRunFact, AutomationRunTargetFact, IncidentCertificateFact, RiskResponseFact } from '../domain/report-calculations.js';
import type { ReportQuery } from '../schema/reports.schema.js';
import type { ReportDataPort } from './report-data.port.js';

export class PgReportDataPort implements ReportDataPort {
  constructor(private readonly db: DatabasePort, private readonly deploymentPlans?: DeploymentPlansRepository) {}

  async listIncidentCertificates(query: ReportQuery): Promise<IncidentCertificateFact[]> {
    const rows = (await this.db.query<IncidentRow>(`select
      asset.id as certificate_asset_id, asset.name, asset.primary_domain, asset.tags,
      version.id as certificate_version_id, version.not_after,
      count(binding.id)::int as binding_count,
      count(binding.id) filter (where binding.status = 'IGNORED')::int as ignored_binding_count,
      count(observation.id)::int as observation_count
    from pg_certificate_assets asset
    join lateral (
      select candidate.* from pg_certificate_versions candidate
      where candidate.certificate_asset_id = asset.id and candidate.status = 'active'
      order by (candidate.id = asset.current_version_id) desc, candidate.deployable desc, candidate.version_no desc
      limit 1
    ) version on true
    left join pg_certificate_bindings binding
      on binding.tenant_id = $1 and binding.deleted_at is null
      and coalesce(binding.certificate_version_id, binding.target_certificate_version_id, binding.local_certificate_version_id) = version.id
    left join pg_monitor_certificate_observations observation
      on coalesce(observation.tenant_id, $1) = $1 and observation.fingerprint_sha256 = version.fingerprint_sha256
    where asset.status = 'active'
    group by asset.id, asset.name, asset.primary_domain, asset.tags, version.id, version.not_after
    order by version.not_after, asset.primary_domain`, [query.tenantId])).rows;
    const plans = await this.deploymentPlans?.listPlans(query.tenantId) ?? [];
    return Promise.all(rows.map(async (row) => {
      const replacement = (await this.db.query<{ id: string }>(`select id from pg_certificate_versions
        where certificate_asset_id = $1 and id <> $2 and status = 'active' and deployable = true and not_after > $3::timestamptz
        order by not_after desc, version_no desc limit 1`, [row.certificate_asset_id, row.certificate_version_id, iso(row.not_after)])).rows[0];
      const plan = replacement ? plans.find((item) => item.certificateVersionId === replacement.id) : undefined;
      return {
        certificateAssetId: row.certificate_asset_id,
        certificateVersionId: row.certificate_version_id,
        name: row.name,
        primaryDomain: row.primary_domain,
        notAfter: iso(row.not_after),
        usageStatus: row.observation_count > 0 || row.binding_count > row.ignored_binding_count ? 'in_use' as const : row.binding_count > 0 ? 'idle' as const : 'unknown' as const,
        readinessStage: resolveReadiness(Boolean(replacement), plan?.status),
        tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
        bindingIds: [],
      };
    }));
  }

  async listRiskResponseFacts(query: ReportQuery): Promise<RiskResponseFact[]> {
    const risks = (await this.db.query<RiskRow>(`select * from pg_monitor_risk_events
      where coalesce(tenant_id, $1) = $1
      and first_detected_at <= $2::timestamptz
      order by first_detected_at`, [query.tenantId, query.asOf])).rows;
    const policies = (await this.db.query<SlaRow>(`select distinct on (severity) * from risk_sla_policies
      where tenant_id in ($1, '00000000-0000-0000-0000-000000000000')
        and effective_from <= $2::timestamptz and (effective_to is null or effective_to > $2::timestamptz)
      order by severity, (tenant_id = $1) desc, version desc`, [query.tenantId, query.asOf])).rows;
    const policyBySeverity = new Map(policies.map((row) => [row.severity, row]));
    return Promise.all(risks.map(async (row) => {
      const history = (await this.db.query<HistoryRow>(`select * from risk_status_history
        where tenant_id = $1 and risk_event_id = $2 and occurred_at <= $3::timestamptz
        order by occurred_at, id`, [query.tenantId, row.id, query.asOf])).rows.map(toHistory);
      const policy = policyBySeverity.get(row.severity);
      if (!policy) throw new Error(`缺少风险 SLA：${row.severity}`);
      return {
        risk: toRisk(row), history,
        slaPolicy: { version: policy.version, severity: row.severity as RiskEvent['severity'], acknowledgementSeconds: policy.acknowledgement_seconds, resolutionSeconds: policy.resolution_seconds },
      };
    }));
  }

  async listAutomationRuns(): Promise<AutomationRunFact[]> { return []; }
  async listAutomationTargets(): Promise<AutomationRunTargetFact[]> { return []; }
}

type IncidentRow = { certificate_asset_id: string; certificate_version_id: string; name: string; primary_domain: string; tags: unknown; not_after: string | Date; binding_count: number; ignored_binding_count: number; observation_count: number };
type RiskRow = { id: string; tenant_id?: string; dedup_key: string; risk_type: string; source: string; status: string; severity: string; title: string; summary: string; scope: unknown; metadata: unknown; first_detected_at: string | Date; last_detected_at: string | Date; resolved_at?: string | Date | null; occurrence_count: number };
type HistoryRow = { id: string; tenant_id: string; risk_event_id: string; action: string; from_status?: string | null; to_status: string; reason?: string | null; actor_type: string; actor_id?: string | null; occurred_at: string | Date; metadata: unknown };
type SlaRow = { version: number; severity: string; acknowledgement_seconds: number; resolution_seconds: number };
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function iso(value: string | Date): string { return value instanceof Date ? value.toISOString() : String(value); }
function toRisk(row: RiskRow): RiskEvent { const scope = object(row.scope); return { id: row.id, dedupKey: row.dedup_key, type: row.risk_type as RiskEvent['type'], source: row.source as RiskEvent['source'], status: row.status as RiskEvent['status'], severity: row.severity as RiskEvent['severity'], title: row.title, summary: row.summary, scope: { tenantId: row.tenant_id, certificateAssetId: scope.certificateAssetId as string | undefined, certificateVersionId: scope.certificateVersionId as string | undefined, bindingId: scope.bindingId as string | undefined, executionRunId: scope.executionRunId as string | undefined, serviceInstanceId: scope.serviceInstanceId as string | undefined, hostId: scope.hostId as string | undefined }, metadata: object(row.metadata), firstDetectedAt: iso(row.first_detected_at), lastDetectedAt: iso(row.last_detected_at), resolvedAt: row.resolved_at ? iso(row.resolved_at) : undefined, occurrenceCount: Number(row.occurrence_count) }; }
function toHistory(row: HistoryRow): RiskStatusHistory { return { id: row.id, tenantId: row.tenant_id, riskEventId: row.risk_event_id, action: row.action as RiskStatusHistory['action'], fromStatus: row.from_status as RiskStatusHistory['fromStatus'], toStatus: row.to_status as RiskStatusHistory['toStatus'], reason: row.reason ?? undefined, actorType: row.actor_type as RiskStatusHistory['actorType'], actorId: row.actor_id ?? undefined, occurredAt: iso(row.occurred_at), metadata: object(row.metadata) }; }
function resolveReadiness(hasReplacement: boolean, status?: string): IncidentCertificateFact['readinessStage'] {
  if (!hasReplacement) return 'missing_replacement';
  if (!status) return 'plan_missing';
  if (status === 'DRAFT') return 'plan_draft';
  if (status === 'PENDING_APPROVAL') return 'waiting_approval';
  if (status === 'READY') return 'ready_to_execute';
  if (status === 'RUNNING') return 'running';
  if (status === 'SUCCESS' || status === 'PARTIAL_SUCCESS') return 'completed';
  if (status === 'FAILED' || status === 'ROLLED_BACK') return 'verification_failed';
  if (status === 'CANCELLED') return 'blocked';
  return 'replacement_ready';
}
