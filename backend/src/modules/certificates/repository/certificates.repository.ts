import { createHash } from 'node:crypto';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import type { PageQuery } from '../../../common/pagination/pagination.js';
import { createPageResponse, type PageResponse } from '../../../shared/dto/page-response.js';
import { canonicalize } from '../../../shared/canonical-json.js';
import type {
  CertificateAssetEntity,
  CertificateVersionEntity,
  CertificateVersionFormatEntity,
} from '../schema/certificates.schema.js';

export interface CertificatesRepository {
  readonly moduleName: 'certificates';
  createAsset(entity: CertificateAssetEntity): Promise<CertificateAssetEntity>;
  updateAsset(id: string, patch: Partial<CertificateAssetEntity>): Promise<CertificateAssetEntity>;
  getAsset(id: string): Promise<CertificateAssetEntity | undefined>;
  deleteOrUpdateAsset(id: string, patch: Partial<CertificateAssetEntity>): Promise<CertificateAssetEntity>;
  listVersionsByAsset(certificateAssetId: string): Promise<CertificateVersionEntity[]>;
  updateVersion(id: string, patch: Partial<CertificateVersionEntity>): Promise<CertificateVersionEntity>;
  deleteOrUpdateVersion(id: string, patch: Partial<CertificateVersionEntity>): Promise<CertificateVersionEntity>;
  listFormatsByVersion(certificateVersionId: string): Promise<CertificateVersionFormatEntity[]>;
  listAssets(query: PageQuery): Promise<PageResponse<CertificateAssetEntity>>;
  createVersion(entity: CertificateVersionEntity): Promise<CertificateVersionEntity>;
  getVersion(id: string): Promise<CertificateVersionEntity | undefined>;
  getVersionByFingerprint(fingerprintSha256: string): Promise<CertificateVersionEntity | undefined>;
  countVersionsByAsset(certificateAssetId: string): Promise<number>;
  listVersions(query: PageQuery): Promise<PageResponse<CertificateVersionEntity>>;
  createFormat(entity: CertificateVersionFormatEntity): Promise<CertificateVersionFormatEntity>;
  listFormats(query: PageQuery): Promise<PageResponse<CertificateVersionFormatEntity>>;
  getFormatByNaturalKey(certificateVersionId: string, format: string, parameterHash: string): Promise<CertificateVersionFormatEntity | undefined>;
}

export class PgCertificatesRepository implements CertificatesRepository {
  readonly moduleName = 'certificates' as const;

  constructor(
    private readonly db: DatabasePort,
  ) {}

  async createAsset(entity: CertificateAssetEntity): Promise<CertificateAssetEntity> {
    await this.db.query(
      `insert into pg_certificate_assets (
         id, name, primary_domain, sans, source_type, current_version_id,
         status, tags, created_by, created_at, updated_at
       ) values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb, $9, $10::timestamptz, $11::timestamptz)`,
      [
        entity.id,
        entity.name,
        entity.primaryDomain,
        JSON.stringify(entity.sans ?? []),
        entity.sourceType,
        entity.currentVersionId ?? null,
        entity.status,
        JSON.stringify(entity.tags ?? []),
        entity.createdBy,
        entity.createdAt,
        entity.updatedAt,
      ],
    );
    return structuredClone(entity);
  }

  async updateAsset(id: string, patch: Partial<CertificateAssetEntity>): Promise<CertificateAssetEntity> {
    const current = await this.getAssetOrThrow(id);
    const next = { ...current, ...patch, id };
    await this.db.query(
      `update pg_certificate_assets
          set name = $2,
              primary_domain = $3,
              sans = $4::jsonb,
              source_type = $5,
              current_version_id = $6,
              status = $7,
              tags = $8::jsonb,
              updated_at = $9::timestamptz
        where id = $1`,
      [
        id,
        next.name,
        next.primaryDomain,
        JSON.stringify(next.sans ?? []),
        next.sourceType,
        next.currentVersionId ?? null,
        next.status,
        JSON.stringify(next.tags ?? []),
        next.updatedAt,
      ],
    );
    return next;
  }

  async getAsset(id: string): Promise<CertificateAssetEntity | undefined> {
    const result = await this.db.query<CertificateAssetRow>(
      `select * from pg_certificate_assets where id = $1`,
      [id],
    );
    return result.rows[0] ? toAssetEntity(result.rows[0]) : undefined;
  }

  async deleteOrUpdateAsset(id: string, patch: Partial<CertificateAssetEntity>): Promise<CertificateAssetEntity> {
    return this.updateAsset(id, patch);
  }

  async listVersionsByAsset(certificateAssetId: string): Promise<CertificateVersionEntity[]> {
    const result = await this.db.query<CertificateVersionRow>(
      `select * from pg_certificate_versions where certificate_asset_id = $1 order by version_no asc, created_at asc`,
      [certificateAssetId],
    );
    return result.rows.map(toVersionEntity);
  }

  async updateVersion(id: string, patch: Partial<CertificateVersionEntity>): Promise<CertificateVersionEntity> {
    const current = await this.getVersionOrThrow(id);
    const next = { ...current, ...patch, id };
    await this.db.query(
      `update pg_certificate_versions
          set certificate_asset_id = $2,
              version_no = $3,
              common_name = $4,
              sans = $5::jsonb,
              issuer = $6::jsonb,
              subject = $7::jsonb,
              serial_number = $8,
              not_before = $9::timestamptz,
              not_after = $10::timestamptz,
              fingerprint_sha256 = $11,
              public_key_algorithm = $12,
              signature_algorithm = $13,
              leaf_storage_ref = $14,
              private_key_secret_ref = $15,
              chain_certificate_refs = $16::jsonb,
              chain_order = $17::jsonb,
              chain_diagnostics = $18::jsonb,
              chain_status = $19,
              deployable = $20,
              source_type = $21,
              status = $22,
              created_by = $23,
              created_at = $24::timestamptz
        where id = $1`,
      [
        id,
        next.certificateAssetId,
        next.versionNo,
        next.commonName ?? null,
        JSON.stringify(next.sans ?? []),
        JSON.stringify(next.issuer),
        JSON.stringify(next.subject),
        next.serialNumber,
        next.notBefore,
        next.notAfter,
        next.fingerprintSha256,
        next.publicKeyAlgorithm,
        next.signatureAlgorithm,
        next.leafStorageRef,
        next.privateKeySecretRef ?? null,
        JSON.stringify(next.chainCertificateRefs ?? []),
        JSON.stringify(next.chainOrder ?? []),
        JSON.stringify(next.chainDiagnostics ?? []),
        next.chainStatus,
        next.deployable,
        next.sourceType,
        next.status,
        next.createdBy,
        next.createdAt,
      ],
    );
    return next;
  }

  async deleteOrUpdateVersion(id: string, patch: Partial<CertificateVersionEntity>): Promise<CertificateVersionEntity> {
    return this.updateVersion(id, patch);
  }

  async listFormatsByVersion(certificateVersionId: string): Promise<CertificateVersionFormatEntity[]> {
    const result = await this.db.query<CertificateVersionFormatRow>(
      `select * from pg_certificate_version_formats where certificate_version_id = $1 order by created_at asc`,
      [certificateVersionId],
    );
    return result.rows.map(toFormatEntity);
  }

  async listAssets(query: PageQuery): Promise<PageResponse<CertificateAssetEntity>> {
    const rows = (await this.db.query<CertificateAssetRow>(`select * from pg_certificate_assets order by created_at desc`)).rows.map(toAssetEntity);
    return page(filterRows(rows, query.filter), query);
  }

  async createVersion(entity: CertificateVersionEntity): Promise<CertificateVersionEntity> {
    await this.db.query(
      `insert into pg_certificate_versions (
         id, certificate_asset_id, version_no, common_name, sans, issuer, subject, serial_number,
         not_before, not_after, fingerprint_sha256, public_key_algorithm, signature_algorithm,
         leaf_storage_ref, private_key_secret_ref, chain_certificate_refs, chain_order, chain_diagnostics,
         chain_status, deployable, source_type, status, created_by, created_at
       ) values (
         $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9::timestamptz, $10::timestamptz,
         $11, $12, $13, $14, $15, $16::jsonb, $17::jsonb, $18::jsonb, $19, $20, $21, $22, $23, $24::timestamptz
       )`,
      [
        entity.id,
        entity.certificateAssetId,
        entity.versionNo,
        entity.commonName ?? null,
        JSON.stringify(entity.sans ?? []),
        JSON.stringify(entity.issuer),
        JSON.stringify(entity.subject),
        entity.serialNumber,
        entity.notBefore,
        entity.notAfter,
        entity.fingerprintSha256,
        entity.publicKeyAlgorithm,
        entity.signatureAlgorithm,
        entity.leafStorageRef,
        entity.privateKeySecretRef ?? null,
        JSON.stringify(entity.chainCertificateRefs ?? []),
        JSON.stringify(entity.chainOrder ?? []),
        JSON.stringify(entity.chainDiagnostics ?? []),
        entity.chainStatus,
        entity.deployable,
        entity.sourceType,
        entity.status,
        entity.createdBy,
        entity.createdAt,
      ],
    );
    return structuredClone(entity);
  }

  async getVersion(id: string): Promise<CertificateVersionEntity | undefined> {
    const result = await this.db.query<CertificateVersionRow>(`select * from pg_certificate_versions where id = $1`, [id]);
    return result.rows[0] ? toVersionEntity(result.rows[0]) : undefined;
  }

  async getVersionByFingerprint(fingerprintSha256: string): Promise<CertificateVersionEntity | undefined> {
    const result = await this.db.query<CertificateVersionRow>(
      `select * from pg_certificate_versions where lower(fingerprint_sha256) = lower($1) limit 1`,
      [fingerprintSha256],
    );
    return result.rows[0] ? toVersionEntity(result.rows[0]) : undefined;
  }

  async countVersionsByAsset(certificateAssetId: string): Promise<number> {
    const result = await this.db.query<{ count: string }>(
      `select count(*)::text as count from pg_certificate_versions where certificate_asset_id = $1`,
      [certificateAssetId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async listVersions(query: PageQuery): Promise<PageResponse<CertificateVersionEntity>> {
    const versions = (await this.db.query<CertificateVersionRow>(`select * from pg_certificate_versions order by created_at desc`)).rows.map(toVersionEntity);
    const assets = new Map((await this.db.query<CertificateAssetRow>(`select * from pg_certificate_assets`)).rows.map((row) => [row.id, toAssetEntity(row)] as const));
    return page(filterVersionRows(versions, assets, query.filter), query);
  }

  async createFormat(entity: CertificateVersionFormatEntity): Promise<CertificateVersionFormatEntity> {
    await this.db.query(
      `insert into pg_certificate_version_formats (
         id, certificate_version_id, format, artifact_ref, parameter_hash,
         contains_private_key, password_secret_ref, created_by, created_at, expires_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz)`,
      [
        entity.id,
        entity.certificateVersionId,
        entity.format,
        entity.artifactRef,
        entity.parameterHash,
        entity.containsPrivateKey,
        entity.passwordSecretRef ?? null,
        entity.createdBy,
        entity.createdAt,
        entity.expiresAt ?? null,
      ],
    );
    return structuredClone(entity);
  }

  async listFormats(query: PageQuery): Promise<PageResponse<CertificateVersionFormatEntity>> {
    const rows = (await this.db.query<CertificateVersionFormatRow>(`select * from pg_certificate_version_formats order by created_at desc`)).rows.map(toFormatEntity);
    return page(filterRows(rows, query.filter), query);
  }

  async getFormatByNaturalKey(certificateVersionId: string, format: string, parameterHash: string): Promise<CertificateVersionFormatEntity | undefined> {
    const result = await this.db.query<CertificateVersionFormatRow>(
      `select * from pg_certificate_version_formats
        where certificate_version_id = $1 and format = $2 and parameter_hash = $3
        limit 1`,
      [certificateVersionId, format, parameterHash],
    );
    return result.rows[0] ? toFormatEntity(result.rows[0]) : undefined;
  }

  private async getAssetOrThrow(id: string): Promise<CertificateAssetEntity> {
    const asset = await this.getAsset(id);
    if (!asset) throw new Error(`certificate asset not found: ${id}`);
    return asset;
  }

  private async getVersionOrThrow(id: string): Promise<CertificateVersionEntity> {
    const version = await this.getVersion(id);
    if (!version) throw new Error(`certificate version not found: ${id}`);
    return version;
  }
}

type CertificateAssetRow = {
  id: string;
  name: string;
  primary_domain: string;
  sans: unknown;
  source_type: CertificateAssetEntity['sourceType'];
  current_version_id?: string | null;
  status: CertificateAssetEntity['status'];
  tags: unknown;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type CertificateVersionRow = {
  id: string;
  certificate_asset_id: string;
  version_no: number;
  common_name?: string | null;
  sans: unknown;
  issuer: unknown;
  subject: unknown;
  serial_number: string;
  not_before: string;
  not_after: string;
  fingerprint_sha256: string;
  public_key_algorithm: string;
  signature_algorithm: string;
  leaf_storage_ref: string;
  private_key_secret_ref?: string | null;
  chain_certificate_refs: unknown;
  chain_order: unknown;
  chain_diagnostics: unknown;
  chain_status: CertificateVersionEntity['chainStatus'];
  deployable: boolean;
  source_type: CertificateVersionEntity['sourceType'];
  status: CertificateVersionEntity['status'];
  created_by: string;
  created_at: string;
};

type CertificateVersionFormatRow = {
  id: string;
  certificate_version_id: string;
  format: CertificateVersionFormatEntity['format'];
  artifact_ref: string;
  parameter_hash: string;
  contains_private_key: boolean;
  password_secret_ref?: string | null;
  created_by: string;
  created_at: string;
  expires_at?: string | null;
};

function toAssetEntity(row: CertificateAssetRow): CertificateAssetEntity {
  return {
    id: row.id,
    name: row.name,
    primaryDomain: row.primary_domain,
    sans: asStringArray(row.sans),
    sourceType: row.source_type,
    currentVersionId: row.current_version_id ?? undefined,
    status: row.status,
    tags: asStringArray(row.tags),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toVersionEntity(row: CertificateVersionRow): CertificateVersionEntity {
  return {
    id: row.id,
    certificateAssetId: row.certificate_asset_id,
    versionNo: row.version_no,
    commonName: row.common_name ?? undefined,
    sans: asStringArray(row.sans),
    issuer: row.issuer as CertificateVersionEntity['issuer'],
    subject: row.subject as CertificateVersionEntity['subject'],
    serialNumber: row.serial_number,
    notBefore: row.not_before,
    notAfter: row.not_after,
    fingerprintSha256: row.fingerprint_sha256,
    publicKeyAlgorithm: row.public_key_algorithm,
    signatureAlgorithm: row.signature_algorithm,
    leafStorageRef: row.leaf_storage_ref,
    privateKeySecretRef: row.private_key_secret_ref ?? undefined,
    chainCertificateRefs: asStringArray(row.chain_certificate_refs),
    chainOrder: asStringArray(row.chain_order),
    chainDiagnostics: asStringArray(row.chain_diagnostics),
    chainStatus: row.chain_status,
    deployable: row.deployable,
    sourceType: row.source_type,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function toFormatEntity(row: CertificateVersionFormatRow): CertificateVersionFormatEntity {
  return {
    id: row.id,
    certificateVersionId: row.certificate_version_id,
    format: row.format,
    artifactRef: row.artifact_ref,
    parameterHash: row.parameter_hash,
    containsPrivateKey: row.contains_private_key,
    passwordSecretRef: row.password_secret_ref ?? undefined,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? undefined,
  };
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return [];
}

function filterRows<T extends object>(rows: T[], filter: Record<string, string>): T[] {
  return rows.filter((row) => Object.entries(filter).every(([field, expected]) => includesValue((row as Record<string, unknown>)[field], expected)));
}

function filterVersionRows(
  versions: CertificateVersionEntity[],
  assets: Map<string, CertificateAssetEntity>,
  filter: Record<string, string>,
): CertificateVersionEntity[] {
  return versions.filter((version) => Object.entries(filter).every(([field, expected]) => {
    const needle = expected.toLowerCase();
    const asset = assets.get(version.certificateAssetId);
    switch (field) {
      case 'primaryDomain':
        return includesValue(asset?.primaryDomain, needle);
      case 'sans':
      case 'san':
        return includesValue(version.sans, needle) || includesValue(asset?.sans, needle);
      case 'fingerprint':
        return includesValue(version.fingerprintSha256, needle);
      default:
        return includesValue((version as unknown as Record<string, unknown>)[field], needle);
    }
  }));
}

function includesValue(actual: unknown, expected: string): boolean {
  const needle = expected.toLowerCase();
  if (Array.isArray(actual)) return actual.some((item) => String(item).toLowerCase().includes(needle));
  if (actual === undefined || actual === null) return false;
  return String(actual).toLowerCase().includes(needle);
}

function page<T>(rows: T[], query: PageQuery): PageResponse<T> {
  const start = (query.page - 1) * query.pageSize;
  const sorted = query.sort ? [...rows].sort((left, right) => compareRows(left, right, query.sort!.field, query.sort!.direction)) : rows;
  return createPageResponse(sorted.slice(start, start + query.pageSize), query.page, query.pageSize, sorted.length);
}

function compareRows<T>(left: T, right: T, field: string, direction: 'asc' | 'desc'): number {
  const a = comparable((left as Record<string, unknown>)[field]);
  const b = comparable((right as Record<string, unknown>)[field]);
  const result = a.localeCompare(b);
  return direction === 'asc' ? result : -result;
}

function comparable(value: unknown): string {
  if (value === undefined || value === null) return '';
  return Array.isArray(value) ? value.join(',') : String(value);
}

export function buildParameterHash(parameters: unknown): string {
  return createHash('sha256').update(canonicalize(parameters ?? {})).digest('hex');
}
