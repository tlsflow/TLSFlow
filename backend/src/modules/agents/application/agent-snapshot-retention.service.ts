import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { structuredLogger } from '../../../common/logging/structured-logger.js';
import { newId } from '../../../shared/id.js';

const DEFAULT_POLICY = Object.freeze({
  version: 'agent-snapshot-retention-v1',
  regularDays: 30,
  fullWebDays: 90,
});

export interface AgentSnapshotRetentionPolicy {
  version?: string;
  regularDays?: number;
  fullWebDays?: number;
}

export interface AgentSnapshotRetentionDryRunInput {
  now?: string;
  policy?: AgentSnapshotRetentionPolicy;
}

export interface AgentSnapshotRetentionDryRunReport {
  runId: string;
  policyVersion: string;
  regularCutoffAt: string;
  fullWebCutoffAt: string;
  candidateCount: number;
  candidateBytes: number;
  protectedCurrentCount: number;
  protectedAuditCount: number;
  invalidCount: number;
  skippedCount: number;
}

export interface AgentSnapshotRetentionBatchResult {
  runId: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  deletedCount: number;
  remainingCount: number;
}

interface RetentionRunRow extends Record<string, unknown> {
  run_id: string;
  policy_version: string;
  status: 'DRY_RUN' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  regular_retention_days: number;
  full_web_retention_days: number;
  regular_cutoff_at: Date;
  full_web_cutoff_at: Date;
  deleted_count: number;
}

interface RetentionCountRow extends Record<string, unknown> {
  candidate_count: number | string;
  candidate_bytes: number | string;
  protected_current_count: number | string;
  protected_audit_count: number | string;
  invalid_count: number | string;
  skipped_count: number | string;
}

export class AgentSnapshotRetentionService {
  constructor(private readonly db: DatabasePort = new PgliteDatabase()) {}

  async dryRun(input: AgentSnapshotRetentionDryRunInput = {}): Promise<AgentSnapshotRetentionDryRunReport> {
    const policy = normalizePolicy(input.policy);
    const now = normalizeNow(input.now);
    const regularCutoffAt = new Date(now.getTime() - policy.regularDays * 24 * 60 * 60 * 1000);
    const fullWebCutoffAt = new Date(now.getTime() - policy.fullWebDays * 24 * 60 * 60 * 1000);
    const counts = (await this.db.query<RetentionCountRow>(RETENTION_COUNT_SQL, [
      regularCutoffAt.toISOString(),
      fullWebCutoffAt.toISOString(),
    ])).rows[0];
    if (!counts) throw new Error('快照保留 dry-run 未返回统计结果');

    const runId = newId('snapret');
    const report = {
      runId,
      policyVersion: policy.version,
      regularCutoffAt: regularCutoffAt.toISOString(),
      fullWebCutoffAt: fullWebCutoffAt.toISOString(),
      candidateCount: toNumber(counts.candidate_count),
      candidateBytes: toNumber(counts.candidate_bytes),
      protectedCurrentCount: toNumber(counts.protected_current_count),
      protectedAuditCount: toNumber(counts.protected_audit_count),
      invalidCount: toNumber(counts.invalid_count),
      skippedCount: toNumber(counts.skipped_count),
    } satisfies AgentSnapshotRetentionDryRunReport;
    await this.db.query(
      `insert into pg_agent_snapshot_retention_runs (
         run_id, policy_version, mode, status,
         regular_retention_days, full_web_retention_days,
         regular_cutoff_at, full_web_cutoff_at,
         candidate_count, candidate_bytes,
         protected_current_count, protected_audit_count,
         invalid_count, skipped_count, detail
       ) values ($1, $2, 'DRY_RUN', 'DRY_RUN', $3, $4, $5::timestamptz, $6::timestamptz,
                 $7, $8, $9, $10, $11, $12, $13::jsonb)`,
      [
        report.runId,
        report.policyVersion,
        policy.regularDays,
        policy.fullWebDays,
        report.regularCutoffAt,
        report.fullWebCutoffAt,
        report.candidateCount,
        report.candidateBytes,
        report.protectedCurrentCount,
        report.protectedAuditCount,
        report.invalidCount,
        report.skippedCount,
        JSON.stringify({ source: 'agent:snapshots', policyVersion: report.policyVersion }),
      ],
    );
    structuredLogger.info('Agent 快照保留 dry-run 完成', {
      runId: report.runId,
      policyVersion: report.policyVersion,
      candidateCount: report.candidateCount,
      candidateBytes: report.candidateBytes,
      protectedCurrentCount: report.protectedCurrentCount,
      protectedAuditCount: report.protectedAuditCount,
      invalidCount: report.invalidCount,
      skippedCount: report.skippedCount,
    }, { module: 'agent-snapshot-retention', resourceType: 'snapshotRetentionRun', resourceId: report.runId });
    return report;
  }

  async executeBatch(runId: string, batchSize = 100): Promise<AgentSnapshotRetentionBatchResult> {
    const limit = Math.min(500, Math.max(1, Math.trunc(batchSize)));
    const run = (await this.db.query<RetentionRunRow>(
      `select run_id, policy_version, status, regular_retention_days, full_web_retention_days,
              regular_cutoff_at, full_web_cutoff_at, deleted_count
         from pg_agent_snapshot_retention_runs
        where run_id = $1
        limit 1`,
      [runId],
    )).rows[0];
    if (!run) throw new Error(`快照保留运行不存在：${runId}`);
    if (!['DRY_RUN', 'RUNNING', 'FAILED'].includes(run.status)) {
      throw new Error(`快照保留运行状态不允许执行：${run.status}`);
    }

    try {
      const deletedCount = await this.db.transaction(async (tx) => {
        await tx.query(
          `update pg_agent_snapshot_retention_runs
              set status = 'RUNNING', mode = 'EXECUTE', updated_at = now()
            where run_id = $1`,
          [runId],
        );
        const deleted = await tx.query<{ document_id: string }>(
          RETENTION_DELETE_SQL,
          [run.regular_cutoff_at.toISOString(), run.full_web_cutoff_at.toISOString(), limit],
        );
        await tx.query(
          `update pg_agent_snapshot_retention_runs
              set deleted_count = deleted_count + $2,
                  updated_at = now()
            where run_id = $1`,
          [runId, deleted.rows.length],
        );
        return deleted.rows.length;
      });

      const remainingCount = toNumber((await this.db.query<{ count: number | string }>(
        RETENTION_REMAINING_SQL,
        [run.regular_cutoff_at.toISOString(), run.full_web_cutoff_at.toISOString()],
      )).rows[0]?.count ?? 0);
      const status: AgentSnapshotRetentionBatchResult['status'] = remainingCount === 0 ? 'COMPLETED' : 'RUNNING';
      await this.db.query(
        `update pg_agent_snapshot_retention_runs
            set status = $2, updated_at = now()
          where run_id = $1`,
        [runId, status],
      );
      const result = { runId, status, deletedCount, remainingCount };
      structuredLogger.info('Agent 快照保留批次完成', {
        runId,
        status,
        deletedCount,
        remainingCount,
        batchSize: limit,
      }, { module: 'agent-snapshot-retention', resourceType: 'snapshotRetentionRun', resourceId: runId });
      return result;
    } catch (error) {
      await this.db.query(
        `update pg_agent_snapshot_retention_runs
            set status = 'FAILED',
                detail = detail || $2::jsonb,
                updated_at = now()
          where run_id = $1`,
        [runId, JSON.stringify({ lastError: error instanceof Error ? error.message : String(error) })],
      );
      structuredLogger.error('Agent 快照保留批次失败', {
        runId,
        error: error instanceof Error ? error.message : String(error),
        batchSize: limit,
      }, { module: 'agent-snapshot-retention', resourceType: 'snapshotRetentionRun', resourceId: runId });
      throw error;
    }
  }
}

const RETENTION_SOURCE_CTE = `
  with source as (
    select document.document_id,
           document.payload->>'tenantId' as tenant_id,
           document.payload->>'agentId' as agent_id,
           document.payload,
           case
             when document.payload->>'reportedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
             then (document.payload->>'reportedAt')::timestamptz
           end as reported_at,
           exists (
             select 1
               from jsonb_array_elements(coalesce(document.payload->'capabilities', '[]'::jsonb)) as capability
              where capability->>'capabilityKey' = 'web.inventory'
                and capability->'value'->>'scope' = 'FULL_WEB_DISCOVERY'
           ) as is_full_web,
           current.latest_snapshot_id,
           current.latest_full_web_snapshot_id,
           exists (
             select 1
               from pg_documents audit
              where audit.namespace = 'security.audit_logs'
                and (
                  audit.payload->>'resourceId' = document.document_id
                  or audit.payload->>'snapshotId' = document.document_id
                  or audit.payload #>> '{detail,snapshotId}' = document.document_id
                  or audit.payload #>> '{detail,capabilitySnapshotId}' = document.document_id
                )
           ) as has_audit_reference
      from pg_documents document
      left join pg_agent_capability_snapshot_current current
        on current.tenant_id = document.payload->>'tenantId'
       and current.agent_id = document.payload->>'agentId'
     where document.namespace = 'agents:snapshots'
  ), classified as (
    select source.*,
           case
             when reported_at is null then 'INVALID'
             when document_id = latest_snapshot_id or document_id = latest_full_web_snapshot_id then 'CURRENT'
             when has_audit_reference then 'AUDIT'
             when (is_full_web and reported_at < $2::timestamptz)
               or (not is_full_web and reported_at < $1::timestamptz) then 'EXPIRED'
             else 'RETAIN'
           end as retention_reason
      from source
  )
`;

const RETENTION_COUNT_SQL = `${RETENTION_SOURCE_CTE}
  select count(*) filter (where retention_reason = 'EXPIRED')::int as candidate_count,
         coalesce(sum(octet_length(payload::text)) filter (where retention_reason = 'EXPIRED'), 0)::bigint as candidate_bytes,
         count(*) filter (where retention_reason = 'CURRENT')::int as protected_current_count,
         count(*) filter (where retention_reason = 'AUDIT')::int as protected_audit_count,
         count(*) filter (where retention_reason = 'INVALID')::int as invalid_count,
         count(*) filter (where retention_reason <> 'EXPIRED')::int as skipped_count
    from classified`;

const RETENTION_DELETE_SQL = `${RETENTION_SOURCE_CTE}
  , candidates as (
    select document_id, tenant_id, agent_id
      from classified
     where retention_reason = 'EXPIRED'
     order by reported_at asc, document_id asc
     for update skip locked
     limit $3
  )
  delete from pg_documents document
   using candidates
   where document.namespace = 'agents:snapshots'
     and document.document_id = candidates.document_id
     and document.payload->>'tenantId' = candidates.tenant_id
     and document.payload->>'agentId' = candidates.agent_id
  returning document.document_id`;

const RETENTION_REMAINING_SQL = `${RETENTION_SOURCE_CTE}
  select count(*)::int as count
    from classified
   where retention_reason = 'EXPIRED'`;

function normalizePolicy(input: AgentSnapshotRetentionPolicy | undefined) {
  const regularDays = normalizeDays(input?.regularDays ?? DEFAULT_POLICY.regularDays);
  const fullWebDays = normalizeDays(input?.fullWebDays ?? DEFAULT_POLICY.fullWebDays);
  return {
    version: input?.version?.trim() || DEFAULT_POLICY.version,
    regularDays,
    fullWebDays,
  };
}

function normalizeDays(value: number): number {
  const normalized = Math.trunc(value);
  if (!Number.isFinite(normalized) || normalized <= 0 || normalized > 3650) {
    throw new Error('快照保留天数必须在 1 到 3650 天之间');
  }
  return normalized;
}

function normalizeNow(value: string | undefined): Date {
  const now = value ? new Date(value) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error('快照保留时间无效');
  return now;
}

function toNumber(value: number | string): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) throw new Error(`快照保留统计不是有效数字：${String(value)}`);
  return normalized;
}
