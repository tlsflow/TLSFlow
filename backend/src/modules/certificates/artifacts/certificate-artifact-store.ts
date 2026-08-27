import { sha256Fingerprint } from '../../../common/crypto/fingerprint.js';
import { getRequestContext } from '../../../common/tracing/request-context.js';
import type { DatabasePort } from '../../../database/database-port.js';

export interface CertificateArtifactRecord {
  tenantId: string;
  artifactRef: string;
  content: Buffer;
  contentType: string;
  sha256: string;
  createdBy: string;
  createdAt: string;
  expiresAt?: string;
}

export interface PutCertificateArtifactInput {
  tenantId?: string;
  artifactRef: string;
  content: Buffer | string;
  contentType: string;
  createdBy: string;
  expiresAt?: string;
}

export interface CertificateArtifactStore {
  put(input: PutCertificateArtifactInput): Promise<CertificateArtifactRecord>;
  get(artifactRef: string, tenantId?: string): Promise<CertificateArtifactRecord | undefined>;
  has(artifactRef: string, tenantId?: string): Promise<boolean>;
  deleteExpired(tenantId?: string): Promise<number>;
  cleanupExpired(tenantId?: string): Promise<number>;
}

export class PgCertificateArtifactStore implements CertificateArtifactStore {
  constructor(private readonly db: DatabasePort) {}

  async put(input: PutCertificateArtifactInput): Promise<CertificateArtifactRecord> {
    const tenantId = await this.resolveWriteTenantId(input.tenantId);
    const content = Buffer.isBuffer(input.content) ? Buffer.from(input.content) : Buffer.from(input.content, 'utf8');
    const record: CertificateArtifactRecord = {
      tenantId,
      artifactRef: input.artifactRef,
      content,
      contentType: input.contentType,
      sha256: sha256Fingerprint(content),
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt,
    };
    await this.db.query(
      `insert into pg_certificate_artifacts (
         tenant_id, artifact_ref, content, content_type, sha256, created_by, created_at, expires_at
      ) values ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz)
       on conflict (tenant_id, artifact_ref) do update set
         content = excluded.content,
         content_type = excluded.content_type,
         sha256 = excluded.sha256,
         created_by = excluded.created_by,
         created_at = excluded.created_at,
         expires_at = excluded.expires_at`,
      [
        record.tenantId,
        record.artifactRef,
        record.content,
        record.contentType,
        record.sha256,
        record.createdBy,
        record.createdAt,
        record.expiresAt ?? null,
      ],
    );
    return { ...record, content: Buffer.from(record.content) };
  }

  async get(artifactRef: string, tenantId?: string): Promise<CertificateArtifactRecord | undefined> {
    const result = await this.db.query<CertificateArtifactRow>(
      `select tenant_id, artifact_ref, content, content_type, sha256, created_by, created_at, expires_at
         from pg_certificate_artifacts
        where artifact_ref = $1
          and ($2::text is null or tenant_id = $2)`,
      [artifactRef, effectiveTenantId(tenantId) ?? null],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    if (row.expires_at !== null && row.expires_at !== undefined) {
      const expiresAt = Date.parse(String(row.expires_at));
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        await this.db.query(
          `delete from pg_certificate_artifacts where tenant_id = $1 and artifact_ref = $2`,
          [row.tenant_id, row.artifact_ref],
        );
        return undefined;
      }
    }
    return {
      tenantId: row.tenant_id,
      artifactRef: row.artifact_ref,
      content: Buffer.from(row.content as Buffer),
      contentType: row.content_type,
      sha256: row.sha256,
      createdBy: row.created_by,
      createdAt: row.created_at,
      expiresAt: row.expires_at ?? undefined,
    };
  }

  async has(artifactRef: string, tenantId?: string): Promise<boolean> {
    return Boolean(await this.get(artifactRef, tenantId));
  }

  async deleteExpired(tenantId?: string): Promise<number> {
    const result = await this.db.query(
      `delete from pg_certificate_artifacts
        where expires_at is not null
          and expires_at <= now()
          and ($1::text is null or tenant_id = $1)
        returning artifact_ref`,
      [effectiveTenantId(tenantId) ?? null],
    );
    return result.rows.length;
  }

  async cleanupExpired(tenantId?: string): Promise<number> {
    return this.deleteExpired(tenantId);
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
    if (!result.rows[0]?.id) throw new Error('默认租户不存在，无法保存证书产物');
    return result.rows[0].id;
  }
}

type CertificateArtifactRow = {
  tenant_id: string;
  artifact_ref: string;
  content: Buffer | Uint8Array | string;
  content_type: string;
  sha256: string;
  created_by: string;
  created_at: string;
  expires_at?: string | null;
};

function effectiveTenantId(tenantId?: string): string | undefined {
  const explicit = tenantId?.trim();
  if (explicit) return explicit;
  const requestTenantId = getRequestContext()?.tenantId?.trim();
  return requestTenantId || undefined;
}
