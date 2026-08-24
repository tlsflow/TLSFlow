export const caProviderTypes = ['gcac_builtin', 'gcac_managed_node', 'microsoft_adcs', 'acme', 'est', 'scep', 'product_adapter'] as const;
export const caDeploymentModes = ['builtin', 'managed_node', 'external'] as const;
export const caRuntimePlatforms = ['embedded', 'windows', 'linux', 'external'] as const;
export const caAvailabilityModes = ['offline', 'single', 'active_standby', 'active_active'] as const;
export const caTopologyModes = ['root_only', 'root_with_intermediate', 'external_managed'] as const;
export const caRoles = ['root', 'intermediate'] as const;
export const caStatuses = ['draft', 'pending_activation', 'active', 'suspended', 'retiring', 'retired', 'compromised'] as const;
export const caTrustDomainStatuses = ['draft', 'active', 'rotating', 'retiring', 'retired', 'compromised'] as const;
export const caTrustDomainIsolationLevels = ['standard', 'strict', 'regulated'] as const;
export const keyCustodyModes = ['local_agent', 'managed_secret', 'external_key', 'device_local'] as const;
export const keyBackendTypes = ['file', 'secret', 'cng', 'tpm', 'hsm', 'kms', 'pkcs11', 'device'] as const;
export const keyExportabilities = ['non_exportable', 'exportable', 'unknown'] as const;
export const certificateRequestStatuses = ['draft', 'pending_key', 'pending_csr', 'pending_approval', 'approved', 'issuing', 'issued', 'deploying', 'active', 'rejected', 'issue_failed', 'deploy_failed', 'cancelled', 'revoked', 'expired'] as const;

export type CaProviderType = typeof caProviderTypes[number];
export type CaDeploymentMode = typeof caDeploymentModes[number];
export type CaRuntimePlatform = typeof caRuntimePlatforms[number];
export type CaAvailabilityMode = typeof caAvailabilityModes[number];
export type CaTopologyMode = typeof caTopologyModes[number];
export type CaRole = typeof caRoles[number];
export type CaStatus = typeof caStatuses[number];
export type CaTrustDomainStatus = typeof caTrustDomainStatuses[number];
export type CaTrustDomainIsolationLevel = typeof caTrustDomainIsolationLevels[number];
export type KeyCustodyMode = typeof keyCustodyModes[number];
export type KeyBackendType = typeof keyBackendTypes[number];
export type KeyExportability = typeof keyExportabilities[number];
export type CertificateRequestStatus = typeof certificateRequestStatuses[number];

export interface CaProviderCapabilities {
  discoverHierarchy: boolean;
  createRoot: boolean;
  createIntermediate: boolean;
  signCsr: boolean;
  queryIssuance: boolean;
  revokeCertificate: boolean;
  publishCrl: boolean;
  ocsp: boolean;
  listProfiles: boolean;
  deviceLocalCsr: boolean;
  hardwareBackedKey: boolean;
  highAvailability: boolean;
}

export interface CaTrustDomainEntity {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  purpose: string;
  status: CaTrustDomainStatus;
  isDefault: boolean;
  isolationLevel: CaTrustDomainIsolationLevel;
  rootPolicy: Record<string, unknown>;
  trustPolicy: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CaProviderEntity {
  id: string;
  tenantId: string;
  name: string;
  type: CaProviderType;
  deploymentMode: CaDeploymentMode;
  runtimePlatform: CaRuntimePlatform;
  availabilityMode: CaAvailabilityMode;
  endpoint?: string;
  credentialSecretRef?: string;
  capabilities: CaProviderCapabilities;
  status: 'active' | 'disabled' | 'degraded';
  configuration: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CertificateAuthorityEntity {
  id: string;
  tenantId: string;
  name: string;
  role: CaRole;
  parentCaId?: string;
  topologyMode: CaTopologyMode;
  providerId: string;
  trustDomainId?: string;
  keyReferenceId?: string;
  privateKeySecretRef?: string;
  certificateVersionId?: string;
  certificatePem?: string;
  certificateChainPem?: string;
  securityDomain: string;
  status: CaStatus;
  pathLengthConstraint?: number;
  subjectCommonName: string;
  notBefore?: string;
  notAfter?: string;
  fingerprintSha256?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CaNodeEntity {
  id: string;
  tenantId: string;
  providerId: string;
  name: string;
  platform: 'windows' | 'linux';
  role: 'active' | 'standby' | 'member';
  identityFingerprint: string;
  keyBackend: KeyBackendType;
  exportability: KeyExportability;
  capabilities: CaProviderCapabilities;
  healthStatus: 'pending' | 'online' | 'degraded' | 'offline' | 'disabled' | 'revoked';
  lastHeartbeatAt?: string;
  leaseExpiresAt?: string;
  endpoint?: string;
  version?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CaNodeEnrollmentTokenEntity {
  id: string;
  tenantId: string;
  providerId: string;
  tokenHash: string;
  status: 'active' | 'used' | 'expired' | 'revoked';
  expiresAt: string;
  createdBy: string;
  createdAt: string;
  usedAt?: string;
}

export interface CaNodeTaskEntity {
  id: string;
  tenantId: string;
  providerId: string;
  nodeId?: string;
  taskType: 'sign_csr' | 'revoke_certificate' | 'publish_crl' | 'health_check';
  idempotencyKey: string;
  payload: Record<string, unknown>;
  status: 'queued' | 'leased' | 'succeeded' | 'failed';
  leaseExpiresAt?: string;
  result?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface KeyReferenceEntity {
  id: string;
  tenantId: string;
  ownerType: 'ca' | 'application_certificate';
  ownerId: string;
  custodyMode: KeyCustodyMode;
  backendType: KeyBackendType;
  opaqueReference?: string;
  secretRef?: string;
  publicKeyFingerprintSha256: string;
  exportability: KeyExportability;
  protectionLevel: 'software_controlled' | 'os_protected' | 'hardware_backed';
  status: 'active' | 'retiring' | 'retired' | 'compromised' | 'deleted';
  rotatedFromKeyId?: string;
  evidence: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CertificateProfileRules {
  commonNamePattern?: string;
  allowedDnsSuffixes: string[];
  allowedIpCidrs: string[];
  allowedSanTypes: Array<'dns' | 'ip' | 'uri' | 'email'>;
  keyAlgorithms: Array<'rsa' | 'ec'>;
  minimumRsaBits: number;
  maximumValidityDays: number;
  renewalWindowDays: number;
  rotateKeyOnRenewal: boolean;
  allowWildcard: boolean;
  requireApproval: boolean;
  extendedKeyUsages: string[];
}

export interface CertificateProfileEntity {
  id: string;
  tenantId: string;
  name: string;
  securityDomain: string;
  trustDomainId?: string;
  status: 'active' | 'disabled';
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface CertificateProfileVersionEntity {
  id: string;
  profileId: string;
  versionNo: number;
  rules: CertificateProfileRules;
  createdBy: string;
  createdAt: string;
}

export interface CertificateRequestEntity {
  id: string;
  tenantId: string;
  applicationAssetId: string;
  caId: string;
  trustDomainId?: string;
  profileVersionId: string;
  keyReferenceId: string;
  csrPem: string;
  csrSha256: string;
  publicKeyFingerprintSha256: string;
  idempotencyKey: string;
  status: CertificateRequestStatus;
  requestedBy: string;
  approvedBy?: string;
  approvalId?: string;
  providerRequestId?: string;
  certificateVersionId?: string;
  failureCode?: string;
  failureMessage?: string;
  subjectCommonName: string;
  sans: string[];
  requestedValidityDays: number;
  createdAt: string;
  updatedAt: string;
}

export interface CertificateRenewalJobEntity {
  id: string;
  tenantId: string;
  certificateVersionId: string;
  renewalWindowKey: string;
  status: 'scheduled' | 'key_pending' | 'csr_pending' | 'issuing' | 'deploying' | 'verifying' | 'completed' | 'failed' | 'rollback_required';
  certificateRequestId?: string;
  scheduledAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CertificateRevocationEntity {
  id: string;
  tenantId: string;
  certificateVersionId: string;
  caId: string;
  trustDomainId?: string;
  reason: string;
  status: 'pending_approval' | 'approved' | 'revoking' | 'revoked' | 'failed';
  requestedBy: string;
  approvalId?: string;
  warnings?: string[];
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrustDistributionEntity {
  id: string;
  tenantId: string;
  caId: string;
  trustDomainId?: string;
  targetScope: Record<string, unknown>;
  status: 'draft' | 'pending_approval' | 'approved' | 'deploying' | 'verified' | 'rollback_required' | 'failed';
  requestedBy: string;
  approvalId?: string;
  verification?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CaRiskPreview {
  topologyMode: CaTopologyMode;
  deploymentMode: CaDeploymentMode;
  runtimePlatform: CaRuntimePlatform;
  availabilityMode: CaAvailabilityMode;
  keyBackend: KeyBackendType;
  overallRecommendation: 'recommended' | 'acceptable_with_risk' | 'not_recommended';
  warnings: string[];
  blockers: string[];
  requiresApproval: boolean;
  confirmationToken: string;
}

export interface CertificateReuseRisk {
  id: string;
  riskType: 'certificate_fingerprint_reuse' | 'public_key_reuse';
  severity: 'warning' | 'high' | 'critical';
  fingerprintSha256: string;
  certificateVersionIds: string[];
  applicationAssets: Array<{
    id: string;
    displayName: string;
    environment?: string;
    securityDomain: string;
    logicalApplicationId?: string;
  }>;
  bindingCount: number;
  redundantInstanceOnly: boolean;
  wildcard: boolean;
  crossSecurityDomain: boolean;
  trustDomainIds: string[];
  trustDomainNames: string[];
  crossTrustDomain: boolean;
  explanation: string;
  remediation: string;
}
