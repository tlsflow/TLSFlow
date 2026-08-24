export type LicenseState =
  | 'unlicensed'
  | 'active'
  | 'grace'
  | 'expired'
  | 'revoked'
  | 'clock_rollback_detected';

export interface LicenseQuotas {
  managedTargets: number | null;
  concurrentExecutions: number | null;
  plugins: number | null;
}

export interface LicenseGrant {
  schemaVersion: 1;
  grantId: string;
  keyId: string;
  productCode: 'gcac';
  installationId: string;
  installationPublicKey: string;
  planCode: string;
  features: string[];
  quotas: LicenseQuotas;
  issuedAt: string;
  startsAt: string;
  expiresAt: string;
  gracePeriodDays: number;
  signature: string;
}

export interface RevocationList {
  schemaVersion: 1;
  listId: string;
  keyId: string;
  generatedAt: string;
  expiresAt: string;
  revokedGrantIds: string[];
  signature: string;
}

export interface ActivationRequest {
  schemaVersion: 1;
  requestId: string;
  nonce: string;
  kind: 'online' | 'offline';
  productCode: 'gcac';
  installationId: string;
  installationPublicKey: string;
  productVersion: string;
  requestedAt: string;
}

export interface ActivationResponse {
  schemaVersion: 1;
  responseId: string;
  requestId: string;
  nonce: string;
  issuedAt: string;
  licenseGrant: LicenseGrant;
  revocationList?: RevocationList;
}

export interface InstallationEntity {
  id: 'singleton';
  installationId: string;
  productCode: 'gcac';
  publicKey: string;
  encryptedPrivateKey: string;
  createdAt: string;
  updatedAt: string;
  lastClockAt: string;
  clockRollbackDetected: boolean;
}

export interface StoredLicenseGrant {
  id: 'current';
  grant: LicenseGrant;
  importedAt: string;
}

export interface StoredRevocationList {
  id: 'current';
  list: RevocationList;
  importedAt: string;
}

export interface StoredActivationRequest {
  id: string;
  request: ActivationRequest;
  status: 'pending' | 'fulfilled' | 'expired';
  createdAt: string;
  expiresAt: string;
}

export interface LicenseStatus {
  state: LicenseState;
  installationId: string;
  installationPublicKey: string;
  productCode: 'gcac';
  planCode?: string;
  grantId?: string;
  features: string[];
  quotas: LicenseQuotas;
  issuedAt?: string;
  startsAt?: string;
  expiresAt?: string;
  graceEndsAt?: string;
  lastClockAt: string;
  clockRollbackDetected: boolean;
  reason?: string;
}
