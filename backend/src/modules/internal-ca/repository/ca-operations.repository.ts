import type { DatabasePort } from '../../../database/database-port.js';
import type {
  CaTemplateMappingEntity,
  ExternalCaObservationEntity,
} from '../schema/internal-ca.schema.js';

export class CaOperationsRepository {
  constructor(private readonly db: DatabasePort) {}

  async upsertExternalObservation(entity: ExternalCaObservationEntity): Promise<ExternalCaObservationEntity> {
    await this.db.query(
      `insert into pg_ca_external_observations (
        id, tenant_id, provider_id, ca_id, object_type, external_object_id, external_parent_id,
        normalized_status, source_status, source_revision, subject_common_name, serial_number,
        template_external_id, requested_by_display, submitted_at, issued_at, revoked_at,
        not_before, not_after, raw_summary, observed_at, first_observed_at, created_at, updated_at
      ) values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
        $18, $19, $20::jsonb, $21, $22, $23, $24
      ) on conflict (tenant_id, provider_id, ca_id, object_type, external_object_id) do update set
        external_parent_id = excluded.external_parent_id,
        normalized_status = excluded.normalized_status,
        source_status = excluded.source_status,
        source_revision = excluded.source_revision,
        subject_common_name = excluded.subject_common_name,
        serial_number = excluded.serial_number,
        template_external_id = excluded.template_external_id,
        requested_by_display = excluded.requested_by_display,
        submitted_at = excluded.submitted_at,
        issued_at = excluded.issued_at,
        revoked_at = excluded.revoked_at,
        not_before = excluded.not_before,
        not_after = excluded.not_after,
        raw_summary = excluded.raw_summary,
        observed_at = excluded.observed_at,
        updated_at = excluded.updated_at
      where excluded.observed_at >= pg_ca_external_observations.observed_at`,
      observationValues(entity),
    );
    const stored = await this.getExternalObservation(
      entity.tenantId,
      entity.providerId,
      entity.caId,
      entity.objectType,
      entity.externalObjectId,
    );
    if (!stored) throw new Error('外部 CA 观测记录写入后不存在');
    return stored;
  }

  async getExternalObservation(
    tenantId: string,
    providerId: string,
    caId: string,
    objectType: ExternalCaObservationEntity['objectType'],
    externalObjectId: string,
  ): Promise<ExternalCaObservationEntity | undefined> {
    const result = await this.db.query<Record<string, unknown>>(
      `select * from pg_ca_external_observations
       where tenant_id = $1 and provider_id = $2 and ca_id = $3 and object_type = $4 and external_object_id = $5`,
      [tenantId, providerId, caId, objectType, externalObjectId],
    );
    return result.rows[0] ? externalObservationFromRow(result.rows[0]) : undefined;
  }

  /**
   * 删除同一外部 CA 对象的旧派生观测。
   *
   * Agent 会同时上报 request/issuance/revocation 三种投影；状态发生
   * 变化时必须清理互斥投影，否则历史错误分类会永久显示在 CA 运维页。
   */
  async deleteExternalObservations(
    tenantId: string,
    providerId: string,
    caId: string,
    externalObjectId: string,
    observedAt: string,
    objectTypes: ExternalCaObservationEntity['objectType'][],
  ): Promise<number> {
    const types = [...new Set(objectTypes)];
    if (types.length === 0) return 0;
    const result = await this.db.query<{ id: string }>(
      `delete from pg_ca_external_observations
       where tenant_id = $1 and provider_id = $2 and ca_id = $3
         and external_object_id = $4 and observed_at <= $5
         and object_type = any($6::text[])
       returning id`,
      [tenantId, providerId, caId, externalObjectId, observedAt, types],
    );
    return result.rows.length;
  }

  /** 返回指定 Authority 已接收的外部观测数量，用于重复登记的确定性归并。 */
  async countExternalObservations(tenantId: string, caId: string): Promise<number> {
    const result = await this.db.query<{ count: number }>(
      `select count(*)::int as count
         from pg_ca_external_observations
        where tenant_id = $1 and ca_id = $2`,
      [tenantId, caId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async getExternalObservationSummary(tenantId: string, providerId: string, caId?: string): Promise<{ storedRecords: number; lastObservedAt?: string }> {
    const result = await this.db.query<{ stored_records: number; last_observed_at?: string }>(
      `select count(*)::int as stored_records, max(observed_at) as last_observed_at
         from pg_ca_external_observations
        where tenant_id = $1 and provider_id = $2
          and ($3::text is null or ca_id = $3)`,
      [tenantId, providerId, caId ?? null],
    );
    return {
      storedRecords: Number(result.rows[0]?.stored_records ?? 0),
      ...(result.rows[0]?.last_observed_at ? { lastObservedAt: result.rows[0].last_observed_at } : {}),
    };
  }

  async saveTemplateMapping(entity: CaTemplateMappingEntity, expectedVersion?: number): Promise<boolean> {
    if (expectedVersion === undefined) {
      const result = await this.db.query<{ id: string }>(
        `insert into pg_ca_template_mappings (
          id, tenant_id, provider_id, ca_id, profile_version_id, external_template_id, status,
          validation_summary, version, created_by, updated_by, created_at, updated_at
        ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13)
        on conflict (tenant_id, ca_id, profile_version_id, external_template_id) do nothing
        returning id`,
        templateMappingValues(entity),
      );
      return result.rows.length === 1;
    }
    const result = await this.db.query<{ id: string }>(
      `update pg_ca_template_mappings set
        provider_id = $3, status = $4, validation_summary = $5::jsonb, version = $6,
        updated_by = $7, updated_at = $8
       where tenant_id = $1 and id = $2 and version = $9
       returning id`,
      [
        entity.tenantId, entity.id, entity.providerId, entity.status, JSON.stringify(entity.validationSummary),
        entity.version, entity.updatedBy, entity.updatedAt, expectedVersion,
      ],
    );
    return result.rows.length === 1;
  }

}

function observationValues(entity: ExternalCaObservationEntity): unknown[] {
  return [
    entity.id, entity.tenantId, entity.providerId, entity.caId, entity.objectType, entity.externalObjectId,
    entity.externalParentId ?? null, entity.normalizedStatus, entity.sourceStatus ?? null, entity.sourceRevision ?? null,
    entity.subjectCommonName ?? null, entity.serialNumber ?? null, entity.templateExternalId ?? null,
    entity.requestedByDisplay ?? null, entity.submittedAt ?? null, entity.issuedAt ?? null, entity.revokedAt ?? null,
    entity.notBefore ?? null, entity.notAfter ?? null, JSON.stringify(entity.rawSummary), entity.observedAt,
    entity.firstObservedAt, entity.createdAt, entity.updatedAt,
  ];
}

function templateMappingValues(entity: CaTemplateMappingEntity): unknown[] {
  return [
    entity.id, entity.tenantId, entity.providerId, entity.caId, entity.profileVersionId, entity.externalTemplateId,
    entity.status, JSON.stringify(entity.validationSummary), entity.version, entity.createdBy, entity.updatedBy,
    entity.createdAt, entity.updatedAt,
  ];
}

function externalObservationFromRow(row: Record<string, unknown>): ExternalCaObservationEntity {
  return {
    id: String(row.id), tenantId: String(row.tenant_id), providerId: String(row.provider_id), caId: String(row.ca_id),
    objectType: row.object_type as ExternalCaObservationEntity['objectType'], externalObjectId: String(row.external_object_id),
    externalParentId: optionalString(row.external_parent_id), normalizedStatus: row.normalized_status as ExternalCaObservationEntity['normalizedStatus'],
    sourceStatus: optionalString(row.source_status), sourceRevision: optionalString(row.source_revision),
    subjectCommonName: optionalString(row.subject_common_name), serialNumber: optionalString(row.serial_number),
    templateExternalId: optionalString(row.template_external_id), requestedByDisplay: optionalString(row.requested_by_display),
    submittedAt: optionalIso(row.submitted_at), issuedAt: optionalIso(row.issued_at), revokedAt: optionalIso(row.revoked_at),
    notBefore: optionalIso(row.not_before), notAfter: optionalIso(row.not_after),
    rawSummary: (row.raw_summary ?? {}) as ExternalCaObservationEntity['rawSummary'], observedAt: toIso(row.observed_at),
    firstObservedAt: toIso(row.first_observed_at), createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at),
  };
}

function optionalString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function optionalIso(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : toIso(value);
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
