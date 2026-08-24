import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { newId } from '../../../shared/id.js';
import type { MetricSnapshot, ReportArtifact, ReportRun, ReportRunStatus } from '../schema/reports.schema.js';

export interface MetricSnapshotRun {
  id: string;
  tenantId: string;
  snapshotDate: string;
  asOf: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  attemptCount: number;
  startedAt: string;
  finishedAt?: string;
  errorMessage?: string;
}

export class ReportsRepository {
  constructor(private readonly db: DatabasePort = new PgliteDatabase()) {}

  async saveSnapshots(snapshots: MetricSnapshot[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const snapshot of snapshots) {
        const dimensionKey = stableJson(snapshot.dimensions);
        await tx.query(`insert into metric_snapshots (
          id, tenant_id, snapshot_date, as_of, metric_key, metric_version, dimension_key,
          dimensions, value, sample_count, generated_at
        ) values (
          $1,$2,$3::date,$4::timestamptz,$5,$6,$7,$8::jsonb,$9,$10,$11::timestamptz
        ) on conflict (tenant_id, snapshot_date, metric_key, metric_version, dimension_key)
        do update set as_of = excluded.as_of,
                      dimensions = excluded.dimensions,
                      value = excluded.value,
                      sample_count = excluded.sample_count,
                      generated_at = excluded.generated_at`, [
          newId('snapshot'),
          snapshot.tenantId,
          snapshot.snapshotDate,
          snapshot.asOf,
          snapshot.metricKey,
          snapshot.metricVersion,
          dimensionKey,
          JSON.stringify(snapshot.dimensions),
          snapshot.value,
          snapshot.sampleCount,
          snapshot.generatedAt,
        ]);
      }
    });
  }

  async listSnapshots(tenantId: string, dateFrom: string, dateTo: string, metricKeys?: string[]): Promise<MetricSnapshot[]> {
    const result = await this.db.query<MetricSnapshotRow>(`select * from metric_snapshots
      where tenant_id = $1 and snapshot_date between $2::date and $3::date
      order by snapshot_date, metric_key, dimension_key`, [tenantId, dateFrom, dateTo]);
    return result.rows
      .filter((row) => !metricKeys || metricKeys.includes(row.metric_key))
      .map(toMetricSnapshot);
  }

  async startSnapshotRun(tenantId: string, snapshotDate: string, asOf: string): Promise<MetricSnapshotRun> {
    const existing = (await this.db.query<MetricSnapshotRunRow>(
      `select * from metric_snapshot_runs where tenant_id = $1 and snapshot_date = $2::date limit 1`,
      [tenantId, snapshotDate],
    )).rows[0];
    const now = new Date().toISOString();
    if (existing) {
      const attemptCount = Number(existing.attempt_count) + 1;
      await this.db.query(`update metric_snapshot_runs
        set status = 'running', attempt_count = $3, as_of = $4::timestamptz,
            started_at = $5::timestamptz, finished_at = null, error_message = null, updated_at = $5::timestamptz
        where tenant_id = $1 and snapshot_date = $2::date`, [tenantId, snapshotDate, attemptCount, asOf, now]);
      return { id: existing.id, tenantId, snapshotDate, asOf, status: 'running', attemptCount, startedAt: now };
    }
    const run: MetricSnapshotRun = {
      id: newId('snapshotrun'), tenantId, snapshotDate, asOf, status: 'running', attemptCount: 1, startedAt: now,
    };
    await this.db.query(`insert into metric_snapshot_runs (
      id, tenant_id, snapshot_date, as_of, status, attempt_count, started_at, created_at, updated_at
    ) values ($1,$2,$3::date,$4::timestamptz,$5,$6,$7::timestamptz,$7::timestamptz,$7::timestamptz)`, [
      run.id, run.tenantId, run.snapshotDate, run.asOf, run.status, run.attemptCount, run.startedAt,
    ]);
    return run;
  }

  async finishSnapshotRun(runId: string, status: 'succeeded' | 'failed', errorMessage?: string): Promise<void> {
    await this.db.query(`update metric_snapshot_runs
      set status = $2, finished_at = now(), error_message = $3, updated_at = now()
      where id = $1`, [runId, status, errorMessage ?? null]);
  }

  async createReportRun(run: ReportRun): Promise<ReportRun> {
    await this.db.query(`insert into report_runs (
      id, tenant_id, report_type, status, filters, columns, metric_versions, sla_policy_version,
      time_zone, data_as_of, artifact_id, error_message, created_by, created_at, started_at, finished_at
    ) values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10::timestamptz,$11,$12,$13,$14::timestamptz,$15::timestamptz,$16::timestamptz)`, [
      run.id, run.tenantId, run.reportType, run.status, JSON.stringify(run.filters), JSON.stringify(run.columns),
      JSON.stringify(run.metricVersions), run.slaPolicyVersion ?? null, run.timeZone, run.dataAsOf,
      run.artifactId ?? null, run.errorMessage ?? null, run.createdBy, run.createdAt, run.startedAt ?? null, run.finishedAt ?? null,
    ]);
    return run;
  }

  async updateReportRun(id: string, patch: { status: ReportRunStatus; artifactId?: string; errorMessage?: string; startedAt?: string; finishedAt?: string }): Promise<void> {
    await this.db.query(`update report_runs set status = $2, artifact_id = coalesce($3, artifact_id),
      error_message = $4, started_at = coalesce($5::timestamptz, started_at), finished_at = $6::timestamptz where id = $1`, [
      id, patch.status, patch.artifactId ?? null, patch.errorMessage ?? null, patch.startedAt ?? null, patch.finishedAt ?? null,
    ]);
  }

  async getReportRun(tenantId: string, id: string): Promise<ReportRun | undefined> {
    const row = (await this.db.query<ReportRunRow>('select * from report_runs where tenant_id = $1 and id = $2 limit 1', [tenantId, id])).rows[0];
    return row ? toReportRun(row) : undefined;
  }

  async listReportRuns(tenantId: string, limit = 100): Promise<ReportRun[]> {
    return (await this.db.query<ReportRunRow>('select * from report_runs where tenant_id = $1 order by created_at desc limit $2', [tenantId, limit])).rows.map(toReportRun);
  }

  async createReportArtifact(artifact: ReportArtifact): Promise<ReportArtifact> {
    await this.db.query(`insert into report_artifacts (
      id, tenant_id, storage_key, file_name, content_type, byte_size, checksum_sha256, expires_at, created_at
    ) values ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz)`, [
      artifact.id, artifact.tenantId, artifact.storageKey, artifact.fileName, artifact.contentType,
      artifact.byteSize, artifact.checksumSha256, artifact.expiresAt, artifact.createdAt,
    ]);
    return artifact;
  }

  async getReportArtifact(tenantId: string, id: string): Promise<ReportArtifact | undefined> {
    const row = (await this.db.query<ReportArtifactRow>('select * from report_artifacts where tenant_id = $1 and id = $2 limit 1', [tenantId, id])).rows[0];
    return row ? toReportArtifact(row) : undefined;
  }
}

type MetricSnapshotRow = {
  tenant_id: string;
  snapshot_date: string | Date;
  as_of: string | Date;
  metric_key: string;
  metric_version: number;
  dimensions: unknown;
  value: string | number;
  sample_count: number;
  generated_at: string | Date;
};

type MetricSnapshotRunRow = {
  id: string;
  attempt_count: number;
};

type ReportRunRow = { id: string; tenant_id: string; report_type: string; status: string; filters: unknown; columns: unknown; metric_versions: unknown; sla_policy_version?: number | null; time_zone: string; data_as_of: string | Date; artifact_id?: string | null; error_message?: string | null; created_by: string; created_at: string | Date; started_at?: string | Date | null; finished_at?: string | Date | null };
type ReportArtifactRow = { id: string; tenant_id: string; storage_key: string; file_name: string; content_type: string; byte_size: string | number; checksum_sha256: string; expires_at: string | Date; created_at: string | Date };

function toMetricSnapshot(row: MetricSnapshotRow): MetricSnapshot {
  return {
    tenantId: row.tenant_id,
    snapshotDate: toDateText(row.snapshot_date),
    asOf: toIsoText(row.as_of),
    metricKey: row.metric_key,
    metricVersion: Number(row.metric_version),
    dimensions: asDimensions(row.dimensions),
    value: Number(row.value),
    sampleCount: Number(row.sample_count),
    generatedAt: toIsoText(row.generated_at),
  };
}

function stableJson(value: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))));
}

function asDimensions(value: unknown): Record<string, string | boolean | null> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, string | boolean | null>
    : {};
}

function toIsoText(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function toDateText(value: string | Date): string {
  return toIsoText(value).slice(0, 10);
}

function toReportRun(row: ReportRunRow): ReportRun {
  return { id: row.id, tenantId: row.tenant_id, reportType: row.report_type as ReportRun['reportType'], status: row.status as ReportRun['status'], filters: asObject(row.filters), columns: Array.isArray(row.columns) ? row.columns.map(String) : [], metricVersions: asNumberRecord(row.metric_versions), slaPolicyVersion: row.sla_policy_version ?? undefined, timeZone: row.time_zone, dataAsOf: toIsoText(row.data_as_of), artifactId: row.artifact_id ?? undefined, errorMessage: row.error_message ?? undefined, createdBy: row.created_by, createdAt: toIsoText(row.created_at), startedAt: row.started_at ? toIsoText(row.started_at) : undefined, finishedAt: row.finished_at ? toIsoText(row.finished_at) : undefined };
}
function toReportArtifact(row: ReportArtifactRow): ReportArtifact { return { id: row.id, tenantId: row.tenant_id, storageKey: row.storage_key, fileName: row.file_name, contentType: row.content_type, byteSize: Number(row.byte_size), checksumSha256: row.checksum_sha256, expiresAt: toIsoText(row.expires_at), createdAt: toIsoText(row.created_at) }; }
function asObject(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function asNumberRecord(value: unknown): Record<string, number> { return Object.fromEntries(Object.entries(asObject(value)).map(([key, item]) => [key, Number(item)])); }
