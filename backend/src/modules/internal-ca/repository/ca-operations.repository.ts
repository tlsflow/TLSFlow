import type { DatabasePort } from '../../../database/database-port.js';
import type {
  CaSyncRunEntity,
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
        updated_at = excluded.updated_at`,
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

  async createSyncRun(entity: CaSyncRunEntity): Promise<CaSyncRunEntity> {
    await this.db.query(
      `insert into pg_ca_sync_runs (
        id, tenant_id, provider_id, ca_id, object_type, mode, status, cursor_before, cursor_after,
        source_watermark, read_count, upserted_count, skipped_count, failed_count, attempt_count,
        next_attempt_at, error_code, error_message, lease_owner, lease_expires_at, requested_by,
        started_at, completed_at, created_at, updated_at
      ) values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
        $19, $20, $21, $22, $23, $24, $25
      )`,
      syncRunValues(entity),
    );
    return structuredClone(entity);
  }

  async updateSyncRun(entity: CaSyncRunEntity): Promise<boolean> {
    const result = await this.db.query<{ id: string }>(
      `update pg_ca_sync_runs set
        status = $3, cursor_after = $4, source_watermark = $5, read_count = $6, upserted_count = $7,
        skipped_count = $8, failed_count = $9, attempt_count = $10, next_attempt_at = $11,
        error_code = $12, error_message = $13, lease_owner = $14, lease_expires_at = $15,
        started_at = $16, completed_at = $17, updated_at = $18
       where tenant_id = $1 and id = $2
       returning id`,
      [
        entity.tenantId, entity.id, entity.status, entity.cursorAfter ?? null, entity.sourceWatermark ?? null,
        entity.readCount, entity.upsertedCount, entity.skippedCount, entity.failedCount, entity.attemptCount ?? 0,
        entity.nextAttemptAt ?? null, entity.errorCode ?? null, entity.errorMessage ?? null, entity.leaseOwner ?? null,
        entity.leaseExpiresAt ?? null, entity.startedAt ?? null, entity.completedAt ?? null, entity.updatedAt,
      ],
    );
    return result.rows.length === 1;
  }

  async persistSyncBatch(run: CaSyncRunEntity, observations: ExternalCaObservationEntity[]): Promise<void> {
    for (const observation of observations) {
      if (
        observation.tenantId !== run.tenantId
        || observation.providerId !== run.providerId
        || observation.caId !== run.caId
        || observation.objectType !== run.objectType
      ) {
        throw new Error('同步批次包含不属于当前运行范围的外部 CA 观测记录');
      }
    }
    await this.db.transaction(async (tx) => {
      const repository = new CaOperationsRepository(tx);
      for (const observation of observations) {
        await repository.upsertExternalObservation(observation);
      }
      if (!(await repository.updateSyncRun(run))) {
        throw new Error('同步运行不存在，拒绝推进游标');
      }
    });
  }

  async getSyncRun(tenantId: string, id: string): Promise<CaSyncRunEntity | undefined> {
    const result = await this.db.query<Record<string, unknown>>(
      'select * from pg_ca_sync_runs where tenant_id = $1 and id = $2',
      [tenantId, id],
    );
    return result.rows[0] ? syncRunFromRow(result.rows[0]) : undefined;
  }

  async acquireSyncLease(tenantId: string, id: string, leaseOwner: string, leaseExpiresAt: string, updatedAt: string): Promise<boolean> {
    const result = await this.db.query<{ id: string }>(
      `update pg_ca_sync_runs
       set status = 'running', lease_owner = $3, lease_expires_at = $4,
           started_at = coalesce(started_at, $5), updated_at = $5
       where tenant_id = $1 and id = $2 and status in ('queued', 'running')
         and (next_attempt_at is null or next_attempt_at <= $5)
         and (lease_expires_at is null or lease_expires_at <= $5 or lease_owner = $3)
       returning id`,
      [tenantId, id, leaseOwner, leaseExpiresAt, updatedAt],
    );
    return result.rows.length === 1;
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

  async getActiveSyncRun(
    tenantId: string,
    providerId: string,
    caId: string,
    objectType: CaSyncRunEntity['objectType'],
  ): Promise<CaSyncRunEntity | undefined> {
    const result = await this.db.query<Record<string, unknown>>(
      `select * from pg_ca_sync_runs
       where tenant_id = $1 and provider_id = $2 and ca_id = $3 and object_type = $4
         and status in ('queued', 'running')
       order by created_at desc limit 1`,
      [tenantId, providerId, caId, objectType],
    );
    return result.rows[0] ? syncRunFromRow(result.rows[0]) : undefined;
  }

  async listSyncRuns(tenantId: string, caId?: string): Promise<CaSyncRunEntity[]> {
    const result = await this.db.query<Record<string, unknown>>(
      `select * from pg_ca_sync_runs where tenant_id = $1 ${caId ? 'and ca_id = $2' : ''} order by created_at desc`,
      caId ? [tenantId, caId] : [tenantId],
    );
    return result.rows.map(syncRunFromRow);
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

function syncRunValues(entity: CaSyncRunEntity): unknown[] {
  return [
    entity.id, entity.tenantId, entity.providerId, entity.caId, entity.objectType, entity.mode, entity.status,
    entity.cursorBefore ?? null, entity.cursorAfter ?? null, entity.sourceWatermark ?? null, entity.readCount,
    entity.upsertedCount, entity.skippedCount, entity.failedCount, entity.attemptCount ?? 0,
    entity.nextAttemptAt ?? null, entity.errorCode ?? null, entity.errorMessage ?? null, entity.leaseOwner ?? null,
    entity.leaseExpiresAt ?? null, entity.requestedBy, entity.startedAt ?? null, entity.completedAt ?? null,
    entity.createdAt, entity.updatedAt,
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

function syncRunFromRow(row: Record<string, unknown>): CaSyncRunEntity {
  return {
    id: String(row.id), tenantId: String(row.tenant_id), providerId: String(row.provider_id), caId: String(row.ca_id),
    objectType: row.object_type as CaSyncRunEntity['objectType'], mode: row.mode as CaSyncRunEntity['mode'],
    status: row.status as CaSyncRunEntity['status'], cursorBefore: optionalString(row.cursor_before),
    cursorAfter: optionalString(row.cursor_after), sourceWatermark: optionalString(row.source_watermark),
    readCount: Number(row.read_count), upsertedCount: Number(row.upserted_count), skippedCount: Number(row.skipped_count),
    failedCount: Number(row.failed_count), attemptCount: Number(row.attempt_count ?? 0), nextAttemptAt: optionalIso(row.next_attempt_at),
    errorCode: optionalString(row.error_code), errorMessage: optionalString(row.error_message),
    leaseOwner: optionalString(row.lease_owner), leaseExpiresAt: optionalIso(row.lease_expires_at), requestedBy: String(row.requested_by),
    startedAt: optionalIso(row.started_at), completedAt: optionalIso(row.completed_at), createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
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
