import type { AcmeChallengeType } from '../schema/acme.schema.js';

export interface AcmeChallengeMaterial {
  tenantId: string;
  challengeId: string;
  identifier: string;
  token: string;
  keyAuthorization: string;
  presentationId: string;
  actorId: string;
}

export interface AcmeChallengeValidationResult {
  supported: boolean;
  detail?: string;
}

export interface AcmeChallengePresentationResult {
  presentationId: string;
  detail?: Record<string, unknown>;
}

export interface AcmeChallengeCleanupResult {
  cleaned: boolean;
  detail?: Record<string, unknown>;
}

export interface AcmeChallengeAdapter {
  readonly type: AcmeChallengeType;
  validate(material: AcmeChallengeMaterial): Promise<AcmeChallengeValidationResult>;
  present(material: AcmeChallengeMaterial): Promise<AcmeChallengePresentationResult>;
  cleanup(material: AcmeChallengeMaterial): Promise<AcmeChallengeCleanupResult>;
}

export interface HttpChallengeResponder {
  present(input: {
    tenantId: string;
    identifier: string;
    token: string;
    keyAuthorization: string;
    presentationId: string;
    actorId: string;
  }): Promise<Record<string, unknown>>;
  cleanup(input: {
    tenantId: string;
    identifier: string;
    token: string;
    presentationId: string;
    actorId: string;
  }): Promise<Record<string, unknown>>;
}

export interface DnsProvider {
  present(input: {
    tenantId: string;
    recordName: string;
    value: string;
    presentationId: string;
    actorId: string;
  }): Promise<Record<string, unknown>>;
  cleanup(input: {
    tenantId: string;
    recordName: string;
    value: string;
    presentationId: string;
    actorId: string;
  }): Promise<Record<string, unknown>>;
}

export interface TlsAlpnResponder {
  present(input: {
    tenantId: string;
    identifier: string;
    keyAuthorization: string;
    presentationId: string;
    actorId: string;
  }): Promise<Record<string, unknown>>;
  cleanup(input: {
    tenantId: string;
    identifier: string;
    presentationId: string;
    actorId: string;
  }): Promise<Record<string, unknown>>;
}

export class UnsupportedHttpChallengeResponder implements HttpChallengeResponder {
  async present(): Promise<Record<string, unknown>> {
    throw new Error('HTTP-01 responder is not configured');
  }

  async cleanup(): Promise<Record<string, unknown>> {
    throw new Error('HTTP-01 responder is not configured');
  }
}

export class UnsupportedDnsProvider implements DnsProvider {
  async present(): Promise<Record<string, unknown>> {
    throw new Error('DNS provider is not configured');
  }

  async cleanup(): Promise<Record<string, unknown>> {
    throw new Error('DNS provider is not configured');
  }
}

export class UnsupportedTlsAlpnResponder implements TlsAlpnResponder {
  async present(): Promise<Record<string, unknown>> {
    throw new Error('TLS-ALPN-01 responder is not configured');
  }

  async cleanup(): Promise<Record<string, unknown>> {
    throw new Error('TLS-ALPN-01 responder is not configured');
  }
}
