import type {
  AcmeChallengeAdapter,
  AcmeChallengeCleanupResult,
  AcmeChallengeMaterial,
  AcmeChallengePresentationResult,
  AcmeChallengeValidationResult,
  HttpChallengeResponder,
} from './acme-challenge-adapter.js';

export class Http01ChallengeAdapter implements AcmeChallengeAdapter {
  readonly type = 'http-01' as const;

  constructor(private readonly responder: HttpChallengeResponder) {}

  async validate(material: AcmeChallengeMaterial): Promise<AcmeChallengeValidationResult> {
    return {
      supported: Boolean(material.identifier && material.token && material.keyAuthorization),
      detail: 'HTTP-01 需要受管 HTTP Challenge responder',
    };
  }

  async present(material: AcmeChallengeMaterial): Promise<AcmeChallengePresentationResult> {
    const detail = await this.responder.present({
      tenantId: material.tenantId,
      identifier: material.identifier,
      token: material.token,
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
      token: material.token,
      presentationId: material.presentationId,
      actorId: material.actorId,
    });
    return { cleaned: true, detail };
  }
}
