import type { DatabasePort } from '../../../database/database-port.js';
import type {
  CaOperationNormalizedStatus,
  CaOperationObjectType,
} from '../schema/internal-ca.schema.js';
import type { CaOperationRecordSource } from '../dto/ca-operations.dto.js';

export interface CaOperationProjectionCursor {
  observedAt: string;
  recordKey: string;
}

export interface CaOperationProjectionQuery {
  tenantId: string;
  caId: string;
  objectType: CaOperationObjectType;
  statuses?: CaOperationNormalizedStatus[];
  sources?: CaOperationRecordSource[];
  query?: string;
  from?: string;
  to?: string;
  cursor?: CaOperationProjectionCursor;
  limit: number;
}

export interface CaOperationProjectionRow {
  recordKey: string;
  objectType: CaOperationObjectType;
  source: CaOperationRecordSource;
  gcacResourceType?: string;
  gcacResourceId?: string;
  providerId?: string;
  externalObjectId?: string;
  caId: string;
  normalizedStatus: CaOperationNormalizedStatus;
  sourceStatus?: string;
  subjectCommonName?: string;
  serialNumber?: string;
  templateExternalId?: string;
  requestedByDisplay?: string;
  observedAt: string;
  total: number;
}

export class CaOperationsQueryRepository {
  constructor(private readonly db: DatabasePort) {}

  async queryRecords(input: CaOperationProjectionQuery): Promise<CaOperationProjectionRow[]> {
    const params: unknown[] = [input.tenantId, input.caId];
    const filters: string[] = [];
    if (input.statuses?.length) filters.push(`normalized_status = any($${push(params, input.statuses)}::text[])`);
    if (input.sources?.length) filters.push(`source = any($${push(params, input.sources)}::text[])`);
    if (input.query) {
      filters.push(`lower(concat_ws(' ', subject_common_name, serial_number, template_external_id, requested_by_display, source_status)) like $${push(params, `%${escapeLike(input.query.toLowerCase())}%`)} escape '\\'`);
    }
    if (input.from) filters.push(`observed_at >= $${push(params, input.from)}`);
    if (input.to) filters.push(`observed_at <= $${push(params, input.to)}`);
    const cursorFilter = input.cursor
      ? `(observed_at, record_key) < ($${push(params, input.cursor.observedAt)}, $${push(params, input.cursor.recordKey)})`
      : undefined;
    const limitParameter = push(params, input.limit + 1);
    const sourceSql = sourceProjectionSql(input.objectType);
    const result = await this.db.query<Record<string, unknown>>(
      `with records as (
        ${sourceSql}
      ), filtered as (
        select *, count(*) over()::int as total
        from records
        ${filters.length ? `where ${filters.join(' and ')}` : ''}
      )
      select * from filtered
      ${cursorFilter ? `where ${cursorFilter}` : ''}
      order by observed_at desc, record_key desc
      limit $${limitParameter}`,
      params,
    );
    return result.rows.map(projectionFromRow);
  }

  async getRecord(tenantId: string, recordKey: string): Promise<CaOperationProjectionRow | undefined> {
    const parsed = parseRecordKey(recordKey);
    if (parsed.source === 'external') {
      const result = await this.db.query<Record<string, unknown>>(
        `select
          'external:' || id as record_key, object_type, 'external_sync' as source,
          null::text as gcac_resource_type, null::text as gcac_resource_id, provider_id, external_object_id,
          ca_id, normalized_status, source_status, subject_common_name, serial_number,
          template_external_id, requested_by_display, observed_at, 1::int as total
         from pg_ca_external_observations where tenant_id = $1 and id = $2`,
        [tenantId, parsed.id],
      );
      return result.rows[0] ? projectionFromRow(result.rows[0]) : undefined;
    }
    if (!parsed.objectType) throw new Error('invalid native record key');
    const table = parsed.objectType === 'request' ? 'pg_certificate_requests'
      : parsed.objectType === 'issuance' ? 'pg_ca_issuance_records' : 'pg_certificate_revocations';
    const caResult = await this.db.query<{ ca_id: string }>(
      `select ca_id from ${table} where tenant_id = $1 and id = $2`,
      [tenantId, parsed.id],
    );
    const caId = caResult.rows[0]?.ca_id;
    if (!caId) return undefined;
    const result = await this.db.query<Record<string, unknown>>(
      `select *, 1::int as total from (${nativeProjectionSql(parsed.objectType)}) records where record_key = $3`,
      [tenantId, caId, recordKey],
    );
    return result.rows[0] ? projectionFromRow(result.rows[0]) : undefined;
  }

  async countByObjectType(tenantId: string, caId: string): Promise<Record<CaOperationObjectType, number>> {
    const projections = (['request', 'issuance', 'revocation'] as const)
      .map((objectType) => `select object_type from (${sourceProjectionSql(objectType)}) projected`)
      .join(' union all ');
    const result = await this.db.query<{ object_type: CaOperationObjectType; count: number }>(
      `select object_type, count(*)::int as count
       from (${projections}) records
       group by object_type`,
      [tenantId, caId],
    );
    const counts: Record<CaOperationObjectType, number> = { request: 0, issuance: 0, revocation: 0, template: 0 };
    for (const row of result.rows) counts[row.object_type] = Number(row.count);
    return counts;
  }

}

function sourceProjectionSql(objectType: CaOperationObjectType): string {
  return `${nativeProjectionSql(objectType)}
    union all
    select
      'external:' || observation.id as record_key,
      observation.object_type,
      'external_sync' as source,
      null::text as gcac_resource_type,
      null::text as gcac_resource_id,
      observation.provider_id,
      observation.external_object_id,
      observation.ca_id,
      observation.normalized_status,
      observation.source_status,
      observation.subject_common_name,
      observation.serial_number,
      observation.template_external_id,
      observation.requested_by_display,
      observation.observed_at
    from pg_ca_external_observations observation
    where observation.tenant_id = $1 and observation.ca_id = $2 and observation.object_type = '${objectType}'
      ${externalDeduplicationSql(objectType)}`;
}

function nativeProjectionSql(objectType: CaOperationObjectType): string {
  if (objectType === 'request') {
    return `select
      'gcac:request:' || request.id as record_key,
      'request' as object_type,
      case when observation.id is null then 'gcac_native' else 'external_sync' end as source,
      'certificateRequest' as gcac_resource_type,
      request.id as gcac_resource_id,
      authority.provider_id,
      coalesce(observation.external_object_id, request.provider_request_id) as external_object_id,
      request.ca_id,
      coalesce(observation.normalized_status, case
        when request.status in ('pending_approval', 'approved', 'issuing', 'pending_key', 'pending_csr') then 'pending'
        when request.status in ('issued', 'deploying', 'active') then 'issued'
        when request.status = 'rejected' then 'rejected'
        when request.status in ('issue_failed', 'deploy_failed') then 'failed'
        when request.status = 'revoked' then 'revoked'
        else 'unknown'
      end) as normalized_status,
      coalesce(observation.source_status, request.status) as source_status,
      coalesce(observation.subject_common_name, request.payload->>'subjectCommonName') as subject_common_name,
      observation.serial_number as serial_number,
      coalesce(observation.template_external_id, request.profile_version_id) as template_external_id,
      coalesce(observation.requested_by_display, request.requested_by) as requested_by_display,
      coalesce(observation.observed_at, request.created_at) as observed_at
    from pg_certificate_requests request
    join pg_certificate_authorities authority on authority.id = request.ca_id
    left join lateral (
      select external.*
      from pg_ca_external_observations external
      where external.tenant_id = request.tenant_id
        and external.ca_id = request.ca_id
        and external.object_type = 'request'
        and (
          external.external_object_id = request.provider_request_id
          or external.external_object_id = 'request:' || request.provider_request_id
        )
      order by external.observed_at desc, external.id desc
      limit 1
    ) observation on true
    where request.tenant_id = $1 and request.ca_id = $2`;
  }
  if (objectType === 'issuance') {
    return `select
      'gcac:issuance:' || issuance.id as record_key,
      'issuance' as object_type,
      case when issuance.record_origin = 'historical_backfill' then 'historical_backfill'
           when issuance.record_origin = 'external' then 'external_sync' else 'gcac_native' end as source,
      'caIssuanceRecord' as gcac_resource_type,
      issuance.id as gcac_resource_id,
      authority.provider_id,
      request.provider_request_id as external_object_id,
      issuance.ca_id,
      case when issuance.status = 'issued' then 'issued' when issuance.status = 'revoked' then 'revoked'
           when issuance.status = 'failed' then 'failed' else 'unknown' end as normalized_status,
      issuance.status as source_status,
      issuance.subject_common_name,
      issuance.serial_number,
      null::text as template_external_id,
      null::text as requested_by_display,
      issuance.observed_at
    from pg_ca_issuance_records issuance
    join pg_certificate_authorities authority on authority.id = issuance.ca_id
    left join pg_certificate_requests request on request.id = issuance.certificate_request_id
    where issuance.tenant_id = $1 and issuance.ca_id = $2`;
  }
  if (objectType === 'revocation') {
    return `select
      'gcac:revocation:' || revocation.id as record_key,
      'revocation' as object_type,
      'gcac_native' as source,
      'certificateRevocation' as gcac_resource_type,
      revocation.id as gcac_resource_id,
      authority.provider_id,
      null::text as external_object_id,
      revocation.ca_id,
      case when revocation.status = 'revoked' then 'revoked' when revocation.status = 'failed' then 'failed'
           when revocation.status in ('pending_approval', 'approved', 'revoking') then 'pending' else 'unknown' end as normalized_status,
      revocation.status as source_status,
      null::text as subject_common_name,
      issuance.serial_number,
      null::text as template_external_id,
      revocation.requested_by as requested_by_display,
      coalesce(revocation.revoked_at, revocation.updated_at) as observed_at
    from pg_certificate_revocations revocation
    join pg_certificate_authorities authority on authority.id = revocation.ca_id
    left join pg_ca_issuance_records issuance on issuance.certificate_version_id = revocation.certificate_version_id
    where revocation.tenant_id = $1 and revocation.ca_id = $2`;
  }
  return `select
    null::text as record_key, null::text as object_type, null::text as source,
    null::text as gcac_resource_type, null::text as gcac_resource_id, null::text as provider_id,
    null::text as external_object_id, null::text as ca_id, null::text as normalized_status,
    null::text as source_status, null::text as subject_common_name, null::text as serial_number,
    null::text as template_external_id, null::text as requested_by_display, null::timestamptz as observed_at
    where false`;
}

function externalDeduplicationSql(objectType: CaOperationObjectType): string {
  if (objectType === 'request') {
    return `and not exists (
      select 1 from pg_certificate_requests request
      where request.tenant_id = observation.tenant_id and request.ca_id = observation.ca_id
        and (
          request.provider_request_id = observation.external_object_id
          or observation.external_object_id = 'request:' || request.provider_request_id
        )
    )`;
  }
  if (objectType === 'issuance') {
    return `and not exists (
      select 1 from pg_certificate_requests request
      where request.tenant_id = observation.tenant_id and request.ca_id = observation.ca_id
        and request.provider_request_id = observation.external_parent_id
    )`;
  }
  return '';
}

function projectionFromRow(row: Record<string, unknown>): CaOperationProjectionRow {
  return {
    recordKey: String(row.record_key), objectType: row.object_type as CaOperationObjectType,
    source: row.source as CaOperationRecordSource, gcacResourceType: optionalString(row.gcac_resource_type),
    gcacResourceId: optionalString(row.gcac_resource_id), providerId: optionalString(row.provider_id),
    externalObjectId: optionalString(row.external_object_id), caId: String(row.ca_id),
    normalizedStatus: row.normalized_status as CaOperationNormalizedStatus, sourceStatus: optionalString(row.source_status),
    subjectCommonName: optionalString(row.subject_common_name), serialNumber: optionalString(row.serial_number),
    templateExternalId: optionalString(row.template_external_id), requestedByDisplay: optionalString(row.requested_by_display),
    observedAt: toIso(row.observed_at), total: Number(row.total),
  };
}

function push(params: unknown[], value: unknown): number {
  params.push(value);
  return params.length;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function optionalString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function parseRecordKey(recordKey: string): { source: 'external' | 'gcac'; objectType?: Exclude<CaOperationObjectType, 'template'>; id: string } {
  if (recordKey.startsWith('external:')) return { source: 'external', id: recordKey.slice('external:'.length) };
  const match = /^gcac:(request|issuance|revocation):(.+)$/.exec(recordKey);
  if (!match?.[2]) throw new Error('invalid record key');
  return { source: 'gcac', objectType: match[1] as Exclude<CaOperationObjectType, 'template'>, id: match[2] };
}
