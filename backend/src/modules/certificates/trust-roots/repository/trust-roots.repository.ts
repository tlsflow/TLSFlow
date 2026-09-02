import type { DatabasePort } from '../../../../database/database-port.js';
import { PgliteDatabase } from '../../../../database/pglite-database.js';
import { getRequestContext } from '../../../../common/tracing/request-context.js';
import { applyAuthorizationFilter, type PageQuery } from '../../../../common/pagination/pagination.js';
import { createPageResponse, type PageResponse } from '../../../../shared/dto/page-response.js';
import type {
  CertificateVersionTrustRootEntity,
  RootCertificateRecordEntity,
  RootCertificateSourceObservationEntity,
} from '../schema/trust-roots.schema.js';

export interface TrustRootsRepository {
  createOrUpdateRoot(entity: RootCertificateRecordEntity): Promise<RootCertificateRecordEntity>;
  getRoot(id: string): Promise<RootCertificateRecordEntity | undefined>;
  getRootByFingerprint(fingerprintSha256: string): Promise<RootCertificateRecordEntity | undefined>;
  listRootsBySubject(subjectRaw: string): Promise<RootCertificateRecordEntity[]>;
  listRoots(query: PageQuery): Promise<PageResponse<RootCertificateRecordEntity>>;
  createObservation(entity: RootCertificateSourceObservationEntity): Promise<RootCertificateSourceObservationEntity>;
  listObservationsByRoot(rootCertificateId: string): Promise<RootCertificateSourceObservationEntity[]>;
  upsertVersionTrustRoot(entity: CertificateVersionTrustRootEntity): Promise<CertificateVersionTrustRootEntity>;
  listVersionTrustRoots(certificateVersionId: string, tenantId?: string): Promise<CertificateVersionTrustRootEntity[]>;
  listRelationsByRoot(rootCertificateId: string, tenantId?: string): Promise<CertificateVersionTrustRootEntity[]>;
}

export class PgTrustRootsRepository implements TrustRootsRepository {
  constructor(private readonly db: DatabasePort = new PgliteDatabase()) {}

  async createOrUpdateRoot(entity: RootCertificateRecordEntity): Promise<RootCertificateRecordEntity> {
    await this.db.query(
      `insert into pg_root_certificate_records (
         id, fingerprint_sha256, certificate_artifact_ref, subject, issuer, serial_number,
         not_before, not_after, basic_constraints, validation_status, created_at, updated_at
       ) values (
         $1, $2, $3, $4::jsonb, $5::jsonb, $6, $7::timestamptz, $8::timestamptz, $9::jsonb, $10, $11::timestamptz, $12::timestamptz
       )
       on conflict (fingerprint_sha256) do update
          set certificate_artifact_ref = excluded.certificate_artifact_ref,
              subject = excluded.subject,
              issuer = excluded.issuer,
              serial_number = excluded.serial_number,
              not_before = excluded.not_before,
              not_after = excluded.not_after,
              basic_constraints = excluded.basic_constraints,
              validation_status = excluded.validation_status,
              updated_at = excluded.updated_at`,
      [
        entity.id,
        entity.fingerprintSha256,
        entity.certificateArtifactRef,
        JSON.stringify(entity.subject),
        JSON.stringify(entity.issuer),
        entity.serialNumber,
        entity.notBefore,
        entity.notAfter,
        JSON.stringify(entity.basicConstraints),
        entity.validationStatus,
        entity.createdAt,
        entity.updatedAt,
      ],
    );
    return (await this.getRootByFingerprint(entity.fingerprintSha256)) ?? entity;
  }

  async getRoot(id: string): Promise<RootCertificateRecordEntity | undefined> {
    const result = await this.db.query<RootCertificateRecordRow>(
      `select * from pg_root_certificate_records where id = $1 limit 1`,
      [id],
    );
    return result.rows[0] ? toRootEntity(result.rows[0]) : undefined;
  }

  async getRootByFingerprint(fingerprintSha256: string): Promise<RootCertificateRecordEntity | undefined> {
    const result = await this.db.query<RootCertificateRecordRow>(
      `select * from pg_root_certificate_records where lower(fingerprint_sha256) = lower($1) limit 1`,
      [fingerprintSha256],
    );
    return result.rows[0] ? toRootEntity(result.rows[0]) : undefined;
  }

  async listRootsBySubject(subjectRaw: string): Promise<RootCertificateRecordEntity[]> {
    const result = await this.db.query<RootCertificateRecordRow>(
      `select * from pg_root_certificate_records
        where subject->>'raw' = $1
        order by updated_at desc, created_at desc`,
      [subjectRaw],
    );
    return result.rows.map(toRootEntity);
  }

  async listRoots(query: PageQuery): Promise<PageResponse<RootCertificateRecordEntity>> {
    const rows = (await this.db.query<RootCertificateRecordRow>(
      `select * from pg_root_certificate_records order by updated_at desc, created_at desc`,
    )).rows.map(toRootEntity);
    const filtered = applyAuthorizationFilter(rows, query).filter((row) => Object.entries(query.filter).every(([field, expected]) => includesValue((row as unknown as Record<string, unknown>)[field], expected)));
    return page(filtered, query);
  }

  async createObservation(entity: RootCertificateSourceObservationEntity): Promise<RootCertificateSourceObservationEntity> {
    await this.db.query(
      `insert into pg_root_certificate_source_observations (
         id, root_certificate_id, source_type, source_ref, observed_fingerprint, observed_at, status, failure_code
       ) values ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8)`,
      [
        entity.id,
        entity.rootCertificateId,
        entity.sourceType,
        entity.sourceRef ?? null,
        entity.observedFingerprint,
        entity.observedAt,
        entity.status,
        entity.failureCode ?? null,
      ],
    );
    return entity;
  }

  async listObservationsByRoot(rootCertificateId: string): Promise<RootCertificateSourceObservationEntity[]> {
    const result = await this.db.query<RootCertificateObservationRow>(
      `select * from pg_root_certificate_source_observations
        where root_certificate_id = $1
        order by observed_at desc, id desc`,
      [rootCertificateId],
    );
    return result.rows.map(toObservationEntity);
  }

  async upsertVersionTrustRoot(entity: CertificateVersionTrustRootEntity): Promise<CertificateVersionTrustRootEntity> {
    const scopedTenantId = effectiveTenantId(entity.tenantId);
    await this.db.query(
      `insert into pg_certificate_version_trust_roots (
         id, tenant_id, certificate_version_id, root_certificate_id, relation, chain_path, selection_reason, resolution_status, created_at, updated_at
       ) values (
         $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::timestamptz, $10::timestamptz
       )
       on conflict (tenant_id, certificate_version_id, relation) do update
          set root_certificate_id = excluded.root_certificate_id,
              chain_path = excluded.chain_path,
              selection_reason = excluded.selection_reason,
              resolution_status = excluded.resolution_status,
              updated_at = excluded.updated_at`,
      [
        entity.id,
        scopedTenantId ?? null,
        entity.certificateVersionId,
        entity.rootCertificateId,
        entity.relation,
        JSON.stringify(entity.chainPath),
        entity.selectionReason ?? null,
        entity.resolutionStatus,
        entity.createdAt,
        entity.updatedAt,
      ],
    );
    const list = await this.listVersionTrustRoots(entity.certificateVersionId, scopedTenantId);
    return list.find((item) => item.relation === entity.relation) ?? { ...entity, tenantId: scopedTenantId };
  }

  async listVersionTrustRoots(certificateVersionId: string, tenantId?: string): Promise<CertificateVersionTrustRootEntity[]> {
    const scopedTenantId = effectiveTenantId(tenantId);
    const result = await this.db.query<CertificateVersionTrustRootRow>(
      `select * from pg_certificate_version_trust_roots
        where certificate_version_id = $1
          and ($2::text is null or tenant_id = $2)
        order by created_at asc`,
      [certificateVersionId, scopedTenantId ?? null],
    );
    return result.rows.map(toVersionTrustRootEntity);
  }

  async listRelationsByRoot(rootCertificateId: string, tenantId?: string): Promise<CertificateVersionTrustRootEntity[]> {
    const scopedTenantId = effectiveTenantId(tenantId);
    const result = await this.db.query<CertificateVersionTrustRootRow>(
      `select * from pg_certificate_version_trust_roots
        where root_certificate_id = $1
          and ($2::text is null or tenant_id = $2)
        order by created_at asc`,
      [rootCertificateId, scopedTenantId ?? null],
    );
    return result.rows.map(toVersionTrustRootEntity);
  }
}

type DbTime = string | Date;

type RootCertificateRecordRow = {
  id: string;
  fingerprint_sha256: string;
  certificate_artifact_ref: string;
  subject: unknown;
  issuer: unknown;
  serial_number: string;
  not_before: DbTime;
  not_after: DbTime;
  basic_constraints: unknown;
  validation_status: RootCertificateRecordEntity['validationStatus'];
  created_at: DbTime;
  updated_at: DbTime;
};

type RootCertificateObservationRow = {
  id: string;
  root_certificate_id: string;
  source_type: RootCertificateSourceObservationEntity['sourceType'];
  source_ref?: string | null;
  observed_fingerprint: string;
  observed_at: DbTime;
  status: RootCertificateSourceObservationEntity['status'];
  failure_code?: string | null;
};

type CertificateVersionTrustRootRow = {
  id: string;
  tenant_id?: string | null;
  certificate_version_id: string;
  root_certificate_id: string;
  relation: CertificateVersionTrustRootEntity['relation'];
  chain_path: unknown;
  selection_reason?: string | null;
  resolution_status: CertificateVersionTrustRootEntity['resolutionStatus'];
  created_at: DbTime;
  updated_at: DbTime;
};

function toRootEntity(row: RootCertificateRecordRow): RootCertificateRecordEntity {
  return {
    id: row.id,
    fingerprintSha256: row.fingerprint_sha256,
    certificateArtifactRef: row.certificate_artifact_ref,
    subject: asRecord(row.subject) as unknown as RootCertificateRecordEntity['subject'],
    issuer: asRecord(row.issuer) as unknown as RootCertificateRecordEntity['issuer'],
    serialNumber: row.serial_number,
    notBefore: toIsoText(row.not_before),
    notAfter: toIsoText(row.not_after),
    basicConstraints: asRecord(row.basic_constraints) as RootCertificateRecordEntity['basicConstraints'],
    validationStatus: row.validation_status,
    createdAt: toIsoText(row.created_at),
    updatedAt: toIsoText(row.updated_at),
  };
}

function toObservationEntity(row: RootCertificateObservationRow): RootCertificateSourceObservationEntity {
  return {
    id: row.id,
    rootCertificateId: row.root_certificate_id,
    sourceType: row.source_type,
    sourceRef: row.source_ref ?? undefined,
    observedFingerprint: row.observed_fingerprint,
    observedAt: toIsoText(row.observed_at),
    status: row.status,
    failureCode: row.failure_code ?? undefined,
  };
}

function toVersionTrustRootEntity(row: CertificateVersionTrustRootRow): CertificateVersionTrustRootEntity {
  return {
    id: row.id,
    tenantId: row.tenant_id ?? undefined,
    certificateVersionId: row.certificate_version_id,
    rootCertificateId: row.root_certificate_id,
    relation: row.relation,
    chainPath: asStringArray(row.chain_path),
    selectionReason: row.selection_reason ?? undefined,
    resolutionStatus: row.resolution_status,
    createdAt: toIsoText(row.created_at),
    updatedAt: toIsoText(row.updated_at),
  };
}

function toIsoText(value: DbTime): string {
  return value instanceof Date ? value.toISOString() : value;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return { ...(value as Record<string, unknown>) };
  return {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function includesValue(actual: unknown, expected: string): boolean {
  const needle = expected.toLowerCase();
  if (Array.isArray(actual)) return actual.some((item) => String(item).toLowerCase().includes(needle));
  if (actual === undefined || actual === null) return false;
  return String(actual).toLowerCase().includes(needle);
}

function page<T>(rows: T[], query: PageQuery): PageResponse<T> {
  const start = (query.page - 1) * query.pageSize;
  return createPageResponse(rows.slice(start, start + query.pageSize), query.page, query.pageSize, rows.length);
}

function effectiveTenantId(tenantId?: string): string | undefined {
  const explicit = tenantId?.trim();
  if (explicit) return explicit;
  const requestTenantId = getRequestContext()?.tenantId?.trim();
  return requestTenantId || undefined;
}
