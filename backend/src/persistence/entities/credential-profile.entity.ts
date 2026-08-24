import type { SecretScopeType } from '../../shared/security-types.js';

export const CREDENTIAL_KINDS = [
  'USERNAME_PASSWORD',
  'SSH_KEY',
  'BEARER_TOKEN',
  'API_KEY',
  'CLIENT_CERTIFICATE',
  'DNS_PROVIDER',
  'BROWSER_SESSION',
] as const;

export type CredentialKind = typeof CREDENTIAL_KINDS[number];
export type CredentialStatus = 'active' | 'disabled' | 'error';
export type CredentialDeliveryLocation = 'header' | 'query' | 'cookie' | 'local_storage' | 'session_storage';

export interface CredentialDelivery {
  location?: CredentialDeliveryLocation;
  name?: string;
}

export interface CredentialProfileEntity {
  id: string;
  tenantId: string;
  name: string;
  kind: CredentialKind;
  scopeType: SecretScopeType;
  scopeId?: string;
  username?: string;
  delivery?: CredentialDelivery;
  secretSlots: Record<string, string>;
  metadata: Record<string, unknown>;
  status: CredentialStatus;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
