import { sha256Fingerprint } from '../../../common/crypto/fingerprint.js';

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
  put(input: PutCertificateArtifactInput): CertificateArtifactRecord;
  get(artifactRef: string): CertificateArtifactRecord | undefined;
  has(artifactRef: string): boolean;
}

export class InMemoryCertificateArtifactStore implements CertificateArtifactStore {
  private readonly records = new Map<string, CertificateArtifactRecord>();

  put(input: PutCertificateArtifactInput): CertificateArtifactRecord {
    const content = Buffer.isBuffer(input.content) ? Buffer.from(input.content) : Buffer.from(input.content, 'utf8');
    const existing = this.records.get(input.artifactRef);
    if (existing) return { ...existing, content: Buffer.from(existing.content) };

    const record: CertificateArtifactRecord = {
      artifactRef: input.artifactRef,
      content,
      contentType: input.contentType,
      sha256: sha256Fingerprint(content),
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt,
    };
    this.records.set(input.artifactRef, record);
    return { ...record, content: Buffer.from(record.content) };
  }

  get(artifactRef: string): CertificateArtifactRecord | undefined {
    const record = this.records.get(artifactRef);
    return record ? { ...record, content: Buffer.from(record.content) } : undefined;
  }

  has(artifactRef: string): boolean {
    return this.records.has(artifactRef);
  }
}
