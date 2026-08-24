import { createHash } from 'node:crypto';
import type {
  AcmeChallengeAdapter,
  AcmeChallengeCleanupResult,
  AcmeChallengeMaterial,
  AcmeChallengePresentationResult,
  AcmeChallengeValidationResult,
  DnsProvider,
} from './acme-challenge-adapter.js';

export class Dns01ChallengeAdapter implements AcmeChallengeAdapter {
  readonly type = 'dns-01' as const;

  constructor(private readonly provider: DnsProvider) {}

  async validate(material: AcmeChallengeMaterial): Promise<AcmeChallengeValidationResult> {
    return {
      supported: Boolean(material.identifier && material.keyAuthorization),
      detail: 'DNS-01 使用固定 DNS Provider Port 写入 TXT',
    };
  }

  async present(material: AcmeChallengeMaterial): Promise<AcmeChallengePresentationResult> {
    const recordName = `_acme-challenge.${material.identifier.replace(/^\*\./, '')}`;
    const value = createHash('sha256').update(material.keyAuthorization).digest('base64url');
    const detail = await this.provider.present({
      tenantId: material.tenantId,
      recordName,
      value,
      presentationId: material.presentationId,
      actorId: material.actorId,
    });
    return { presentationId: material.presentationId, detail: { recordName, ...detail } };
  }

  async cleanup(material: AcmeChallengeMaterial): Promise<AcmeChallengeCleanupResult> {
    const recordName = `_acme-challenge.${material.identifier.replace(/^\*\./, '')}`;
    const value = createHash('sha256').update(material.keyAuthorization).digest('base64url');
    const detail = await this.provider.cleanup({
      tenantId: material.tenantId,
      recordName,
      value,
      presentationId: material.presentationId,
      actorId: material.actorId,
    });
    return { cleaned: true, detail: { recordName, ...detail } };
  }
}
