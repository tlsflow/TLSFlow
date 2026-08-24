import { sha256Fingerprint } from '../../../common/crypto/fingerprint.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';

export interface CertificateArtifactRecord {
  artifactRef: string;
  content: Buffer;
  contentType: string;
  sha256: string;
  createdBy: string;
  createdAt: string;
  expiresAt?: string;
}

export interface PutCertificateArtifactInput {
  artifactRef: string;
  content: Buffer | string;
  contentType: string;
  createdBy: string;
  expiresAt?: string;
}

export interface CertificateArtifactStore {
  put(input: PutCertificateArtifactInput): Promise<CertificateArtifactRecord>;
  get(artifactRef: string): Promise<CertificateArtifactRecord | undefined>;
  has(artifactRef: string): Promise<boolean>;
}

export class PgCertificateArtifactStore implements CertificateArtifactStore {
  constructor(private readonly db: DatabasePort) {}

  async put(input: PutCertificateArtifactInput): Promise<CertificateArtifactRecord> {
    const content = Buffer.isBuffer(input.content) ? Buffer.from(input.content) : Buffer.from(input.content, 'utf8');
    const record: CertificateArtifactRecord = {
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
         artifact_ref, content, content_type, sha256, created_by, created_at, expires_at
      ) values ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz)
       on conflict (artifact_ref) do update set
         content = excluded.content,
         content_type = excluded.content_type,
         sha256 = excluded.sha256,
         created_by = excluded.created_by,
         created_at = excluded.created_at,
         expires_at = excluded.expires_at`,
      [
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

  async get(artifactRef: string): Promise<CertificateArtifactRecord | undefined> {
    const result = await this.db.query<CertificateArtifactRow>(
      `select artifact_ref, content, content_type, sha256, created_by, created_at, expires_at
         from pg_certificate_artifacts
        where artifact_ref = $1`,
      [artifactRef],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      artifactRef: row.artifact_ref,
      content: Buffer.from(row.content as Buffer),
      contentType: row.content_type,
      sha256: row.sha256,
      createdBy: row.created_by,
      createdAt: row.created_at,
      expiresAt: row.expires_at ?? undefined,
    };
  }

  async has(artifactRef: string): Promise<boolean> {
    return Boolean(await this.get(artifactRef));
  }
}

type CertificateArtifactRow = {
  artifact_ref: string;
  content: Buffer | Uint8Array | string;
  content_type: string;
  sha256: string;
  created_by: string;
  created_at: string;
  expires_at?: string | null;
};
