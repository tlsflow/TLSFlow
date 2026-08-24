import { createHash } from 'node:crypto';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { getRequestContext } from '../../../common/tracing/request-context.js';
import { applyAuthorizationFilter, type PageQuery } from '../../../common/pagination/pagination.js';
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
  updateAsset(id: string, patch: Partial<CertificateAssetEntity>, tenantId?: string): Promise<CertificateAssetEntity>;
  getAsset(id: string, tenantId?: string): Promise<CertificateAssetEntity | undefined>;
  findAssetByPrimaryDomain(primaryDomain: string, tenantId?: string): Promise<CertificateAssetEntity | undefined>;
  deleteOrUpdateAsset(id: string, patch: Partial<CertificateAssetEntity>, tenantId?: string): Promise<CertificateAssetEntity>;
  listVersionsByAsset(certificateAssetId: string, tenantId?: string): Promise<CertificateVersionEntity[]>;
  updateVersion(id: string, patch: Partial<CertificateVersionEntity>, tenantId?: string): Promise<CertificateVersionEntity>;
  promoteVersionAtomic(certificateVersionId: string, tenantId?: string): Promise<CertificateVersionEntity>;
  deleteOrUpdateVersion(id: string, patch: Partial<CertificateVersionEntity>, tenantId?: string): Promise<CertificateVersionEntity>;
  listFormatsByVersion(certificateVersionId: string, tenantId?: string): Promise<CertificateVersionFormatEntity[]>;
  listAssets(query: PageQuery, tenantId?: string): Promise<PageResponse<CertificateAssetEntity>>;
  createVersion(entity: CertificateVersionEntity): Promise<CertificateVersionEntity>;
  getVersion(id: string, tenantId?: string): Promise<CertificateVersionEntity | undefined>;
  getVersionByFingerprint(fingerprintSha256: string, tenantId?: string): Promise<CertificateVersionEntity | undefined>;
  countVersionsByAsset(certificateAssetId: string, tenantId?: string): Promise<number>;
  listVersions(query: PageQuery, tenantId?: string): Promise<PageResponse<CertificateVersionEntity>>;
  createFormat(entity: CertificateVersionFormatEntity): Promise<CertificateVersionFormatEntity>;
  updateFormat(id: string, patch: Partial<CertificateVersionFormatEntity>, tenantId?: string): Promise<CertificateVersionFormatEntity>;
  deleteFormat(id: string, tenantId?: string): Promise<CertificateVersionFormatEntity>;
  listFormats(query: PageQuery, tenantId?: string): Promise<PageResponse<CertificateVersionFormatEntity>>;
  getFormat(id: string, tenantId?: string): Promise<CertificateVersionFormatEntity | undefined>;
  getFormatByNaturalKey(certificateVersionId: string | undefined, format: string, parameterHash: string, tenantId?: string): Promise<CertificateVersionFormatEntity | undefined>;
}

export class PgCertificatesRepository implements CertificatesRepository {
  readonly moduleName = 'certificates' as const;

  constructor(
    private readonly db: DatabasePort,
  ) {}

  async createAsset(entity: CertificateAssetEntity): Promise<CertificateAssetEntity> {
    const tenantId = await this.resolveWriteTenantId(entity.tenantId);
    await this.db.query(
      `insert into pg_certificate_assets (
         id, tenant_id, name, primary_domain, sans, source_type, current_version_id,
         status, tags, created_by, created_at, updated_at
       ) values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb, $10, $11::timestamptz, $12::timestamptz)`,
      [
        entity.id,
        tenantId,
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
    return { ...structuredClone(entity), tenantId };
  }

  async updateAsset(id: string, patch: Partial<CertificateAssetEntity>, tenantId?: string): Promise<CertificateAssetEntity> {
    const scopedTenantId = effectiveTenantId(tenantId);
    const current = await this.getAssetOrThrow(id, scopedTenantId);
    const next = { ...current, ...patch, id };
    if (next.currentVersionId) {
      const currentVersion = await this.getVersion(next.currentVersionId, current.tenantId ?? scopedTenantId);
      if (!currentVersion || currentVersion.certificateAssetId !== id) {
        throw new Error(`certificate version not found for asset: ${next.currentVersionId}`);
      }
    }
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
        where id = $1
          and ($10::text is null or tenant_id = $10)`,
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
        scopedTenantId ?? null,
      ],
    );
    return { ...next, tenantId: current.tenantId ?? scopedTenantId };
  }

  async getAsset(id: string, tenantId?: string): Promise<CertificateAssetEntity | undefined> {
    const result = await this.db.query<CertificateAssetRow>(
      `select * from pg_certificate_assets
        where id = $1
          and ($2::text is null or tenant_id = $2)`,
      [id, effectiveTenantId(tenantId) ?? null],
    );
    return result.rows[0] ? toAssetEntity(result.rows[0]) : undefined;
  }

  async findAssetByPrimaryDomain(primaryDomain: string, tenantId?: string): Promise<CertificateAssetEntity | undefined> {
    const result = await this.db.query<CertificateAssetRow>(
      `select * from pg_certificate_assets
        where lower(primary_domain) = lower($1)
          and status <> 'deleted'
          and ($2::text is null or tenant_id = $2)
        order by created_at asc
        limit 1`,
      [primaryDomain, effectiveTenantId(tenantId) ?? null],
    );
    return result.rows[0] ? toAssetEntity(result.rows[0]) : undefined;
  }

  async deleteOrUpdateAsset(id: string, patch: Partial<CertificateAssetEntity>, tenantId?: string): Promise<CertificateAssetEntity> {
    return this.updateAsset(id, patch, tenantId);
  }

  async listVersionsByAsset(certificateAssetId: string, tenantId?: string): Promise<CertificateVersionEntity[]> {
    const result = await this.db.query<CertificateVersionRow>(
      `select * from pg_certificate_versions
        where certificate_asset_id = $1
          and status <> 'deleted'
          and ($2::text is null or tenant_id = $2)
        order by version_no asc, created_at asc`,
      [certificateAssetId, effectiveTenantId(tenantId) ?? null],
    );
    return result.rows.map(toVersionEntity);
  }

  async updateVersion(id: string, patch: Partial<CertificateVersionEntity>, tenantId?: string): Promise<CertificateVersionEntity> {
    const scopedTenantId = effectiveTenantId(tenantId);
    const current = await this.getVersionOrThrow(id, scopedTenantId);
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
              public_key_fingerprint_sha256 = $12,
              public_key_algorithm = $13,
              signature_algorithm = $14,
              leaf_storage_ref = $15,
              private_key_secret_ref = $16,
              chain_certificate_refs = $17::jsonb,
              chain_order = $18::jsonb,
              chain_diagnostics = $19::jsonb,
              chain_status = $20,
              deployable = $21,
              activation_state = $22,
              source_type = $23,
              status = $24,
              created_by = $25,
              created_at = $26::timestamptz,
              issuing_ca_id = $27,
              certificate_request_id = $28,
              certificate_profile_version_id = $29,
              key_reference_id = $30,
              key_custody_mode = $31
        where id = $1
          and ($32::text is null or tenant_id = $32)`,
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
        next.publicKeyFingerprintSha256 ?? null,
        next.publicKeyAlgorithm,
        next.signatureAlgorithm,
        next.leafStorageRef,
        next.privateKeySecretRef ?? null,
        JSON.stringify(next.chainCertificateRefs ?? []),
        JSON.stringify(next.chainOrder ?? []),
        JSON.stringify(next.chainDiagnostics ?? []),
        next.chainStatus,
        next.deployable,
        next.activationState ?? 'promoted',
        next.sourceType,
        next.status,
        next.createdBy,
        next.createdAt,
        next.issuingCaId ?? null,
        next.certificateRequestId ?? null,
        next.certificateProfileVersionId ?? null,
        next.keyReferenceId ?? null,
        next.keyCustodyMode ?? null,
        scopedTenantId ?? null,
      ],
    );
    return { ...next, tenantId: current.tenantId ?? scopedTenantId };
  }

  async promoteVersionAtomic(certificateVersionId: string, tenantId?: string): Promise<CertificateVersionEntity> {
    const scopedTenantId = effectiveTenantId(tenantId);
    return this.db.transaction(async (tx) => {
      const repository = new PgCertificatesRepository(tx);
      const version = await repository.getVersion(certificateVersionId, scopedTenantId);
      if (!version) throw new Error(`certificate version not found: ${certificateVersionId}`);
      const asset = await repository.getAsset(version.certificateAssetId, scopedTenantId);
      if (!asset) throw new Error(`certificate asset not found: ${version.certificateAssetId}`);
      const currentVersion = asset.currentVersionId && asset.currentVersionId !== version.id
        ? await repository.getVersion(asset.currentVersionId, scopedTenantId)
        : undefined;
      const now = new Date().toISOString();
      if (currentVersion) {
        await repository.updateVersion(currentVersion.id, {
          activationState: 'superseded',
          updatedAt: now,
        } as Partial<CertificateVersionEntity>, scopedTenantId);
      }
      const promoted = await repository.updateVersion(version.id, {
        activationState: 'promoted',
        updatedAt: now,
      } as Partial<CertificateVersionEntity>, scopedTenantId);
      await repository.updateAsset(asset.id, {
        currentVersionId: promoted.id,
        updatedAt: now,
      }, scopedTenantId);
      return promoted;
    });
  }

  async deleteOrUpdateVersion(id: string, patch: Partial<CertificateVersionEntity>, tenantId?: string): Promise<CertificateVersionEntity> {
    return this.updateVersion(id, patch, tenantId);
  }

  async listFormatsByVersion(certificateVersionId: string, tenantId?: string): Promise<CertificateVersionFormatEntity[]> {
    const result = await this.db.query<CertificateVersionFormatRow>(
      `select * from pg_certificate_version_formats
        where certificate_version_id = $1
          and ($2::text is null or tenant_id = $2)
        order by created_at asc`,
      [certificateVersionId, effectiveTenantId(tenantId) ?? null],
    );
    return result.rows.map(toFormatEntity);
  }

  async listAssets(query: PageQuery, tenantId?: string): Promise<PageResponse<CertificateAssetEntity>> {
    const rows = (await this.db.query<CertificateAssetRow>(
      `select * from pg_certificate_assets
        where status <> 'deleted'
          and ($1::text is null or tenant_id = $1)
        order by created_at desc`,
      [effectiveTenantId(tenantId) ?? null],
    )).rows.map(toAssetEntity);
    return page(filterRows(applyAuthorizationFilter(rows, query), query.filter), query);
  }

  async createVersion(entity: CertificateVersionEntity): Promise<CertificateVersionEntity> {
    const tenantId = await this.resolveWriteTenantId(entity.tenantId);
    await this.db.query(
      `insert into pg_certificate_versions (
         id, tenant_id, certificate_asset_id, version_no, common_name, sans, issuer, subject, serial_number,
         not_before, not_after, fingerprint_sha256, public_key_fingerprint_sha256, public_key_algorithm, signature_algorithm,
         leaf_storage_ref, private_key_secret_ref, chain_certificate_refs, chain_order, chain_diagnostics,
         chain_status, deployable, activation_state, source_type, status, created_by, created_at,
         issuing_ca_id, certificate_request_id, certificate_profile_version_id, key_reference_id, key_custody_mode
       ) values (
         $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10::timestamptz, $11::timestamptz,
         $12, $13, $14, $15, $16, $17, $18::jsonb, $19::jsonb, $20::jsonb, $21, $22, $23, $24, $25, $26, $27::timestamptz,
         $28, $29, $30, $31, $32
       )`,
      [
        entity.id,
        tenantId,
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
        entity.publicKeyFingerprintSha256 ?? null,
        entity.publicKeyAlgorithm,
        entity.signatureAlgorithm,
        entity.leafStorageRef,
        entity.privateKeySecretRef ?? null,
        JSON.stringify(entity.chainCertificateRefs ?? []),
        JSON.stringify(entity.chainOrder ?? []),
        JSON.stringify(entity.chainDiagnostics ?? []),
        entity.chainStatus,
        entity.deployable,
        entity.activationState ?? 'promoted',
        entity.sourceType,
        entity.status,
        entity.createdBy,
        entity.createdAt,
        entity.issuingCaId ?? null,
        entity.certificateRequestId ?? null,
        entity.certificateProfileVersionId ?? null,
        entity.keyReferenceId ?? null,
        entity.keyCustodyMode ?? null,
      ],
    );
    return { ...structuredClone(entity), tenantId };
  }

  async getVersion(id: string, tenantId?: string): Promise<CertificateVersionEntity | undefined> {
    const result = await this.db.query<CertificateVersionRow>(
      `select * from pg_certificate_versions
        where id = $1
          and ($2::text is null or tenant_id = $2)`,
      [id, effectiveTenantId(tenantId) ?? null],
    );
    return result.rows[0] ? toVersionEntity(result.rows[0]) : undefined;
  }

  async getVersionByFingerprint(fingerprintSha256: string, tenantId?: string): Promise<CertificateVersionEntity | undefined> {
    const result = await this.db.query<CertificateVersionRow>(
      `select * from pg_certificate_versions
        where lower(fingerprint_sha256) = lower($1)
          and status <> 'deleted'
          and ($2::text is null or tenant_id = $2)
        limit 1`,
      [fingerprintSha256, effectiveTenantId(tenantId) ?? null],
    );
    return result.rows[0] ? toVersionEntity(result.rows[0]) : undefined;
  }

  async countVersionsByAsset(certificateAssetId: string, tenantId?: string): Promise<number> {
    const result = await this.db.query<{ count: string }>(
      `select count(*)::text as count
         from pg_certificate_versions
        where certificate_asset_id = $1
          and ($2::text is null or tenant_id = $2)`,
      [certificateAssetId, effectiveTenantId(tenantId) ?? null],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async listVersions(query: PageQuery, tenantId?: string): Promise<PageResponse<CertificateVersionEntity>> {
    const scopedTenantId = effectiveTenantId(tenantId);
    const versions = (await this.db.query<CertificateVersionRow>(
      `select * from pg_certificate_versions
        where status <> 'deleted'
          and ($1::text is null or tenant_id = $1)
        order by created_at desc`,
      [scopedTenantId ?? null],
    )).rows.map(toVersionEntity);
    const assets = new Map((await this.db.query<CertificateAssetRow>(
      `select * from pg_certificate_assets
        where status <> 'deleted'
          and ($1::text is null or tenant_id = $1)`,
      [scopedTenantId ?? null],
    )).rows.map((row) => [row.id, toAssetEntity(row)] as const));
    const visibleVersions = applyAuthorizationFilter(versions.filter((version) => assets.has(version.certificateAssetId)), query);
    return page(filterVersionRows(visibleVersions, assets, query.filter), query);
  }

  async createFormat(entity: CertificateVersionFormatEntity): Promise<CertificateVersionFormatEntity> {
    const tenantId = await this.resolveWriteTenantId(entity.tenantId);
    await this.db.query(
      `insert into pg_certificate_version_formats (
         id, tenant_id, certificate_version_id, format, artifact_ref, parameter_hash, parameters,
         contains_private_key, password_secret_ref, created_by, created_at, expires_at
       ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11::timestamptz, $12::timestamptz)`,
      [
        entity.id,
        tenantId,
        entity.certificateVersionId ?? null,
        entity.format,
        entity.artifactRef,
        entity.parameterHash,
        JSON.stringify(entity.parameters ?? {}),
        entity.containsPrivateKey,
        entity.passwordSecretRef ?? null,
        entity.createdBy,
        entity.createdAt,
        entity.expiresAt ?? null,
      ],
    );
    return { ...structuredClone(entity), tenantId };
  }

  async updateFormat(id: string, patch: Partial<CertificateVersionFormatEntity>, tenantId?: string): Promise<CertificateVersionFormatEntity> {
    const scopedTenantId = effectiveTenantId(tenantId);
    const current = await this.getFormatOrThrow(id, scopedTenantId);
    const next = { ...current, ...patch, id };
    await this.db.query(
      `update pg_certificate_version_formats
          set certificate_version_id = $2,
              format = $3,
              artifact_ref = $4,
              parameter_hash = $5,
              parameters = $6::jsonb,
              contains_private_key = $7,
              password_secret_ref = $8,
              created_by = $9,
              created_at = $10::timestamptz,
              expires_at = $11::timestamptz
        where id = $1
          and ($12::text is null or tenant_id = $12)`,
      [
        id,
        next.certificateVersionId ?? null,
        next.format,
        next.artifactRef,
        next.parameterHash,
        JSON.stringify(next.parameters ?? {}),
        next.containsPrivateKey,
        next.passwordSecretRef ?? null,
        next.createdBy,
        next.createdAt,
        next.expiresAt ?? null,
        scopedTenantId ?? null,
      ],
    );
    return { ...next, tenantId: current.tenantId ?? scopedTenantId };
  }

  async deleteFormat(id: string, tenantId?: string): Promise<CertificateVersionFormatEntity> {
    const scopedTenantId = effectiveTenantId(tenantId);
    const current = await this.getFormatOrThrow(id, scopedTenantId);
    await this.db.query(
      `delete from pg_certificate_version_formats
        where id = $1
          and ($2::text is null or tenant_id = $2)`,
      [id, scopedTenantId ?? null],
    );
    return current;
  }

  async listFormats(query: PageQuery, tenantId?: string): Promise<PageResponse<CertificateVersionFormatEntity>> {
    const rows = (await this.db.query<CertificateVersionFormatRow>(
      `select * from pg_certificate_version_formats
        where ($1::text is null or tenant_id = $1)
        order by created_at desc`,
      [effectiveTenantId(tenantId) ?? null],
    )).rows.map(toFormatEntity);
    return page(filterRows(applyAuthorizationFilter(rows, query), query.filter), query);
  }

  async getFormat(id: string, tenantId?: string): Promise<CertificateVersionFormatEntity | undefined> {
    const result = await this.db.query<CertificateVersionFormatRow>(
      `select * from pg_certificate_version_formats
        where id = $1
          and ($2::text is null or tenant_id = $2)
        limit 1`,
      [id, effectiveTenantId(tenantId) ?? null],
    );
    return result.rows[0] ? toFormatEntity(result.rows[0]) : undefined;
  }

  async getFormatByNaturalKey(certificateVersionId: string | undefined, format: string, parameterHash: string, tenantId?: string): Promise<CertificateVersionFormatEntity | undefined> {
    const scopedTenantId = effectiveTenantId(tenantId);
    const result = certificateVersionId
      ? await this.db.query<CertificateVersionFormatRow>(
        `select * from pg_certificate_version_formats
          where certificate_version_id = $1 and format = $2 and parameter_hash = $3
            and ($4::text is null or tenant_id = $4)
          limit 1`,
        [certificateVersionId, format, parameterHash, scopedTenantId ?? null],
      )
      : await this.db.query<CertificateVersionFormatRow>(
        `select * from pg_certificate_version_formats
          where certificate_version_id is null and format = $1 and parameter_hash = $2
            and ($3::text is null or tenant_id = $3)
          limit 1`,
        [format, parameterHash, scopedTenantId ?? null],
      );
    return result.rows[0] ? toFormatEntity(result.rows[0]) : undefined;
  }

  private async getAssetOrThrow(id: string, tenantId?: string): Promise<CertificateAssetEntity> {
    const asset = await this.getAsset(id, tenantId);
    if (!asset) throw new Error(`certificate asset not found: ${id}`);
    return asset;
  }

  private async getVersionOrThrow(id: string, tenantId?: string): Promise<CertificateVersionEntity> {
    const version = await this.getVersion(id, tenantId);
    if (!version) throw new Error(`certificate version not found: ${id}`);
    return version;
  }

  private async getFormatOrThrow(id: string, tenantId?: string): Promise<CertificateVersionFormatEntity> {
    const format = await this.getFormat(id, tenantId);
    if (!format) throw new Error(`certificate version format not found: ${id}`);
    return format;
  }

  private async resolveWriteTenantId(tenantId?: string): Promise<string> {
    const scopedTenantId = effectiveTenantId(tenantId);
    if (scopedTenantId) return scopedTenantId;
    const result = await this.db.query<{ id: string }>(
      `select id::text as id
         from tenants
        where code = 'default'
          and deleted_at is null
        limit 1`,
    );
    if (!result.rows[0]?.id) throw new Error('默认租户不存在，无法保存证书对象');
    return result.rows[0].id;
  }
}

type CertificateAssetRow = {
  id: string;
  tenant_id: string;
  name: string;
  primary_domain: string;
  sans: unknown;
  source_type: CertificateAssetEntity['sourceType'];
  current_version_id?: string | null;
  status: CertificateAssetEntity['status'];
  tags: unknown;
  created_by: string;
  created_at: DbTime;
  updated_at: DbTime;
};

type CertificateVersionRow = {
  id: string;
  tenant_id: string;
  certificate_asset_id: string;
  version_no: number;
  common_name?: string | null;
  sans: unknown;
  issuer: unknown;
  subject: unknown;
  serial_number: string;
  not_before: DbTime;
  not_after: DbTime;
  fingerprint_sha256: string;
  public_key_fingerprint_sha256?: string | null;
  public_key_algorithm: string;
  signature_algorithm: string;
  leaf_storage_ref: string;
  private_key_secret_ref?: string | null;
  issuing_ca_id?: string | null;
  certificate_request_id?: string | null;
  certificate_profile_version_id?: string | null;
  key_reference_id?: string | null;
  key_custody_mode?: CertificateVersionEntity['keyCustodyMode'] | null;
  chain_certificate_refs: unknown;
  chain_order: unknown;
  chain_diagnostics: unknown;
  chain_status: CertificateVersionEntity['chainStatus'];
  deployable: boolean;
  activation_state?: CertificateVersionEntity['activationState'] | null;
  source_type: CertificateVersionEntity['sourceType'];
  status: CertificateVersionEntity['status'];
  created_by: string;
  created_at: DbTime;
};

type CertificateVersionFormatRow = {
  id: string;
  tenant_id: string;
  certificate_version_id?: string | null;
  format: CertificateVersionFormatEntity['format'];
  artifact_ref: string;
  parameter_hash: string;
  parameters: unknown;
  contains_private_key: boolean;
  password_secret_ref?: string | null;
  created_by: string;
  created_at: DbTime;
  expires_at?: DbTime | null;
};

type DbTime = string | Date;

function toAssetEntity(row: CertificateAssetRow): CertificateAssetEntity {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    primaryDomain: row.primary_domain,
    sans: asStringArray(row.sans),
    sourceType: row.source_type,
    currentVersionId: row.current_version_id ?? undefined,
    status: row.status,
    tags: asStringArray(row.tags),
    createdBy: row.created_by,
    createdAt: toIsoText(row.created_at),
    updatedAt: toIsoText(row.updated_at),
  };
}

function toVersionEntity(row: CertificateVersionRow): CertificateVersionEntity {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    certificateAssetId: row.certificate_asset_id,
    versionNo: row.version_no,
    commonName: row.common_name ?? undefined,
    sans: asStringArray(row.sans),
    issuer: row.issuer as CertificateVersionEntity['issuer'],
    subject: row.subject as CertificateVersionEntity['subject'],
    serialNumber: row.serial_number,
    notBefore: toIsoText(row.not_before),
    notAfter: toIsoText(row.not_after),
    fingerprintSha256: row.fingerprint_sha256,
    publicKeyFingerprintSha256: row.public_key_fingerprint_sha256 ?? undefined,
    publicKeyAlgorithm: row.public_key_algorithm,
    signatureAlgorithm: row.signature_algorithm,
    leafStorageRef: row.leaf_storage_ref,
    privateKeySecretRef: row.private_key_secret_ref ?? undefined,
    issuingCaId: row.issuing_ca_id ?? undefined,
    certificateRequestId: row.certificate_request_id ?? undefined,
    certificateProfileVersionId: row.certificate_profile_version_id ?? undefined,
    keyReferenceId: row.key_reference_id ?? undefined,
    keyCustodyMode: row.key_custody_mode ?? undefined,
    chainCertificateRefs: asStringArray(row.chain_certificate_refs),
    chainOrder: asStringArray(row.chain_order),
    chainDiagnostics: asStringArray(row.chain_diagnostics),
    chainStatus: row.chain_status,
    deployable: row.deployable,
    activationState: row.activation_state ?? 'promoted',
    sourceType: row.source_type,
    status: row.status,
    createdBy: row.created_by,
    createdAt: toIsoText(row.created_at),
  };
}

function toFormatEntity(row: CertificateVersionFormatRow): CertificateVersionFormatEntity {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    certificateVersionId: row.certificate_version_id ?? undefined,
    format: row.format,
    artifactRef: row.artifact_ref,
    parameterHash: row.parameter_hash,
    parameters: asRecord(row.parameters),
    containsPrivateKey: row.contains_private_key,
    passwordSecretRef: row.password_secret_ref ?? undefined,
    createdBy: row.created_by,
    createdAt: toIsoText(row.created_at),
    expiresAt: row.expires_at ? toIsoText(row.expires_at) : undefined,
  };
}

function toIsoText(value: DbTime): string {
  return value instanceof Date ? value.toISOString() : value;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return [];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
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

function effectiveTenantId(tenantId?: string): string | undefined {
  const explicit = tenantId?.trim();
  if (explicit) return explicit;
  const requestTenantId = getRequestContext()?.tenantId?.trim();
  return requestTenantId || undefined;
}
