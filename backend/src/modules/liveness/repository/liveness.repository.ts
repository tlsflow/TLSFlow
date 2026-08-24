import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { newId } from '../../../shared/id.js';
import type {
  DeviceLivenessSignal,
  LivenessResourceType,
  LivenessSignalSource,
  LivenessSignalType,
} from '../schema/liveness.schema.js';

export interface RecordLivenessObservationInput {
  tenantId: string;
  resourceType: LivenessResourceType;
  resourceId: string;
  signalType: LivenessSignalType;
  source: LivenessSignalSource;
  success: boolean;
  required?: boolean;
  observedAt?: string;
  endpointHost?: string;
  endpointPort?: number;
  reasonCode?: string;
  reasonDetail?: string;
  observationId?: string;
  requiredConsecutiveFailures?: number;
}

export class LivenessRepository {
  constructor(private readonly db: DatabasePort = new PgliteDatabase()) {}

  async record(input: RecordLivenessObservationInput): Promise<DeviceLivenessSignal> {
    if (input.observationId) {
      const existing = await this.db.query<LivenessSignalRow>(
        `select * from pg_device_liveness_signals where tenant_id=$1 and observation_id=$2 limit 1`,
        [input.tenantId, input.observationId],
      );
      if (existing.rows[0]) return mapSignal(existing.rows[0]);
    }
    const observedAt = input.observedAt ?? new Date().toISOString();
    const requiredFailures = Math.max(1, Math.ceil(input.requiredConsecutiveFailures ?? 2));
    const rows = await this.db.query<LivenessSignalRow>(
      `insert into pg_device_liveness_signals (
         id, tenant_id, resource_type, resource_id, signal_type, required, status,
         consecutive_failures, last_observed_at, last_success_at, last_failure_at,
         endpoint_host, endpoint_port, source, reason_code, reason_detail, observation_id, created_at, updated_at
       ) values (
         $1, $2, $3, $4, $5, $6,
         case when $7::boolean then 'HEALTHY' else case when $8::integer <= 1 then 'FAILED' else 'SUSPECT' end end,
         case when $7::boolean then 0 else 1 end,
         $9, case when $7::boolean then $9::timestamptz else null end,
         case when $7::boolean then null else $9::timestamptz end,
         $10, $11, $12, $13, $14, $15, $9, $9
       )
       on conflict (tenant_id, resource_type, resource_id, signal_type) do update set
         required = excluded.required,
         status = case
           when excluded.last_observed_at < pg_device_liveness_signals.last_observed_at then pg_device_liveness_signals.status
           when $7::boolean then 'HEALTHY'
           when pg_device_liveness_signals.consecutive_failures + 1 >= $8::integer then 'FAILED'
           else 'SUSPECT'
         end,
         consecutive_failures = case
           when excluded.last_observed_at < pg_device_liveness_signals.last_observed_at then pg_device_liveness_signals.consecutive_failures
           when $7::boolean then 0
           else pg_device_liveness_signals.consecutive_failures + 1
         end,
         last_observed_at = greatest(pg_device_liveness_signals.last_observed_at, excluded.last_observed_at),
         last_success_at = case when $7::boolean and excluded.last_observed_at >= pg_device_liveness_signals.last_observed_at then excluded.last_observed_at else pg_device_liveness_signals.last_success_at end,
         last_failure_at = case when not $7::boolean and excluded.last_observed_at >= pg_device_liveness_signals.last_observed_at then excluded.last_observed_at else pg_device_liveness_signals.last_failure_at end,
         endpoint_host = coalesce(excluded.endpoint_host, pg_device_liveness_signals.endpoint_host),
         endpoint_port = coalesce(excluded.endpoint_port, pg_device_liveness_signals.endpoint_port),
         source = case when excluded.last_observed_at >= pg_device_liveness_signals.last_observed_at then excluded.source else pg_device_liveness_signals.source end,
         reason_code = case when excluded.last_observed_at >= pg_device_liveness_signals.last_observed_at then excluded.reason_code else pg_device_liveness_signals.reason_code end,
         reason_detail = case when excluded.last_observed_at >= pg_device_liveness_signals.last_observed_at then excluded.reason_detail else pg_device_liveness_signals.reason_detail end,
         observation_id = case when excluded.last_observed_at >= pg_device_liveness_signals.last_observed_at then excluded.observation_id else pg_device_liveness_signals.observation_id end,
         updated_at = greatest(pg_device_liveness_signals.updated_at, excluded.updated_at)
       returning *`,
      [
        newId('liveness'), input.tenantId, input.resourceType, input.resourceId, input.signalType,
        input.required !== false, input.success, requiredFailures, observedAt, input.endpointHost ?? null,
        input.endpointPort ?? null, input.source, input.reasonCode ?? null, input.reasonDetail ?? null,
        input.observationId ?? null,
      ],
    );
    return mapSignal(rows.rows[0]!);
  }

  async list(tenantId: string, resourceType: LivenessResourceType, resourceId: string): Promise<DeviceLivenessSignal[]> {
    const result = await this.db.query<LivenessSignalRow>(
      `select * from pg_device_liveness_signals
       where tenant_id=$1 and resource_type=$2 and resource_id=$3
       order by signal_type`,
      [tenantId, resourceType, resourceId],
    );
    return result.rows.map(mapSignal);
  }
}

interface LivenessSignalRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  resource_type: LivenessResourceType;
  resource_id: string;
  signal_type: LivenessSignalType;
  required: boolean;
  status: DeviceLivenessSignal['status'];
  consecutive_failures: number;
  last_observed_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  endpoint_host: string | null;
  endpoint_port: number | null;
  source: LivenessSignalSource;
  reason_code: string | null;
  reason_detail: string | null;
  observation_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapSignal(row: LivenessSignalRow): DeviceLivenessSignal {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    signalType: row.signal_type,
    required: row.required,
    status: row.status,
    consecutiveFailures: Number(row.consecutive_failures),
    lastObservedAt: row.last_observed_at ?? undefined,
    lastSuccessAt: row.last_success_at ?? undefined,
    lastFailureAt: row.last_failure_at ?? undefined,
    endpointHost: row.endpoint_host ?? undefined,
    endpointPort: row.endpoint_port === null ? undefined : Number(row.endpoint_port),
    source: row.source,
    reasonCode: row.reason_code ?? undefined,
    reasonDetail: row.reason_detail ?? undefined,
    observationId: row.observation_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
