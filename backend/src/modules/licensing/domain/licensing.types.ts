export type LicenseState =
  | 'none'
  | 'active'
  | 'upgrade_grace'
  | 'grace'
  | 'expired'
  | 'revoked'
  | 'clock_rollback_detected';

export type LicenseIntegrityStatus = 'not_configured' | 'verified' | 'tampered' | 'invalid';

export interface LicenseQuotas {
  applicationAssets: number | null;
  managedTargets: number | null;
  concurrentExecutions: number | null;
  plugins: number | null;
}

export interface LicenseVersionRange {
  min?: string;
  max?: string;
}

export interface LicenseGrantV1 {
  schemaVersion: 1;
  grantId: string;
  keyId: string;
  productCode: 'gcac';
  installationId: string;
  installationPublicKey: string;
  planCode: string;
  features: string[];
  quotas: Partial<LicenseQuotas> & Pick<LicenseQuotas, 'managedTargets' | 'concurrentExecutions' | 'plugins'>;
  issuedAt: string;
  startsAt: string;
  expiresAt: string;
  gracePeriodDays: number;
  signature: string;
}

export interface LicenseGrantV2 {
  schemaVersion: 2;
  grantId: string;
  keyId: string;
  productCode: 'gcac';
  installationId: string;
  installationPublicKey?: string;
  deviceId: string;
  planCode: string;
  features: string[];
  quotas: LicenseQuotas;
  issuedAt: string;
  startsAt: string;
  expiresAt?: string;
  gracePeriodDays: number;
  versionRange?: LicenseVersionRange;
  upgradeGraceDays: number;
  trialDays?: number;
  signature: string;
}

export type LicenseGrant = LicenseGrantV1 | LicenseGrantV2;

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
  schemaVersion: 1 | 2;
  requestId: string;
  nonce: string;
  kind: 'online' | 'offline';
  productCode: 'gcac';
  installationId: string;
  installationPublicKey: string;
  deviceId?: string;
  productVersion: string;
  requestedAt: string;
}

export interface ActivationResponse {
  schemaVersion: 1 | 2;
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
  deviceId: string;
  versionMismatchDetectedAt?: string;
  licenseIntegrityAlertGrantId?: string;
  licenseIntegrityAlertReason?: string;
  licenseIntegrityAlertedAt?: string;
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
  integrityStatus: LicenseIntegrityStatus;
  installationId: string;
  installationPublicKey: string;
  deviceId: string;
  productCode: 'gcac';
  currentVersion: string;
  planCode?: string;
  licenseSchemaVersion?: 1 | 2;
  grantId?: string;
  features: string[];
  quotas: LicenseQuotas;
  issuedAt?: string;
  startsAt?: string;
  expiresAt?: string;
  graceEndsAt?: string;
  versionRange?: LicenseVersionRange;
  versionCompatible: boolean;
  versionMismatchDetectedAt?: string;
  upgradeGraceEndsAt?: string;
  lastClockAt: string;
  clockRollbackDetected: boolean;
  reason?: string;
}
