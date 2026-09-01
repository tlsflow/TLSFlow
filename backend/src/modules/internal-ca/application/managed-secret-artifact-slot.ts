import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { CertificateArtifactRecord, CertificateArtifactStore } from '../../certificates/artifacts/certificate-artifact-store.js';

/** 托管密钥部署期间的短期制品槽位，过期后不可读取且可主动清理。 */
export interface ManagedSecretArtifactSlot {
  artifactRef: string;
  certificateVersionId: string;
  secretRef: string;
  containsPrivateKey: true;
  expiresAt: string;
}

export class ManagedSecretArtifactSlotService {
  constructor(private readonly artifacts: CertificateArtifactStore) {}

  async put(input: { tenantId: string; certificateVersionId: string; secretRef: string; content: Buffer; createdBy: string; ttlSeconds?: number }): Promise<ManagedSecretArtifactSlot> {
    if (!/^secret:\/\//i.test(input.secretRef)) throw new AppError('SECRET_REF_INVALID', '托管制品槽位必须绑定 SecretRef');
    const ttlSeconds = Math.min(15 * 60, Math.max(1, Math.floor(input.ttlSeconds ?? 300)));
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const digest = createHash('sha256').update(input.content).digest('hex');
    const artifactRef = 'artifact://managed-secret/' + input.certificateVersionId + '/' + digest;
    await this.artifacts.put({ tenantId: input.tenantId, artifactRef, content: input.content, contentType: 'application/octet-stream', createdBy: input.createdBy, expiresAt });
    return { artifactRef, certificateVersionId: input.certificateVersionId, secretRef: input.secretRef, containsPrivateKey: true, expiresAt };
  }

  async get(tenantId: string, slot: ManagedSecretArtifactSlot): Promise<CertificateArtifactRecord> {
    const artifact = await this.artifacts.get(slot.artifactRef, tenantId);
    if (!artifact) throw new AppError('RESOURCE_NOT_FOUND', '托管密钥制品槽位不存在或已过期');
    return artifact;
  }

  cleanupExpired(tenantId?: string): Promise<number> {
    return this.artifacts.cleanupExpired(tenantId);
  }
}
