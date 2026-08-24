import type {
  AcmeChallengeAdapter,
  AcmeChallengeCleanupResult,
  AcmeChallengeMaterial,
  AcmeChallengePresentationResult,
  AcmeChallengeValidationResult,
  TlsAlpnResponder,
} from './acme-challenge-adapter.js';

export class TlsAlpn01ChallengeAdapter implements AcmeChallengeAdapter {
  readonly type = 'tls-alpn-01' as const;

  constructor(private readonly responder: TlsAlpnResponder) {}

  async validate(material: AcmeChallengeMaterial): Promise<AcmeChallengeValidationResult> {
    return {
      supported: Boolean(material.identifier && material.keyAuthorization),
      detail: 'TLS-ALPN-01 使用固定 Gateway/Agent responder，不直接占用控制面 443',
    };
  }

  async present(material: AcmeChallengeMaterial): Promise<AcmeChallengePresentationResult> {
    const detail = await this.responder.present({
      tenantId: material.tenantId,
      identifier: material.identifier,
      keyAuthorization: material.keyAuthorization,
      presentationId: material.presentationId,
      actorId: material.actorId,
    });
    return { presentationId: material.presentationId, detail };
  }

  async cleanup(material: AcmeChallengeMaterial): Promise<AcmeChallengeCleanupResult> {
    const detail = await this.responder.cleanup({
      tenantId: material.tenantId,
      identifier: material.identifier,
      presentationId: material.presentationId,
      actorId: material.actorId,
    });
    return { cleaned: true, detail };
  }
}
