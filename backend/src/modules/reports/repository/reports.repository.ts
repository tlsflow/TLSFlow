import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { newId } from '../../../shared/id.js';
import type { MetricSnapshot } from '../schema/reports.schema.js';

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
