export const certificateSourceTypes = ['manual', 'internal_ca', 'enterprise_ca', 'external_api', 'acme'] as const;
export const certificateAssetStatuses = ['active', 'archived', 'deleted'] as const;
export const certificateVersionStatuses = ['active', 'archived', 'revoked', 'deleted'] as const;
export const certificateActivationStates = ['staged', 'promoted'] as const;
export const certificateChainStatuses = ['valid', 'incomplete', 'invalid', 'unknown'] as const;
export const certificateFormats = ['pem', 'pfx', 'jks', 'p7b', 'der'] as const;

export type CertificateSourceType = (typeof certificateSourceTypes)[number];
export type CertificateAssetStatus = (typeof certificateAssetStatuses)[number];
export type CertificateVersionStatus = (typeof certificateVersionStatuses)[number];
export type CertificateActivationState = (typeof certificateActivationStates)[number];
export type CertificateChainStatus = (typeof certificateChainStatuses)[number];
export type CertificateFormat = (typeof certificateFormats)[number];

export interface CertificateDistinguishedName {
  commonName?: string;
  organization?: string;
  organizationalUnit?: string;
  country?: string;
  state?: string;
  locality?: string;
  raw: string;
}

export interface CertificateAssetEntity {
  id: string;
  tenantId?: string;
  name: string;
  primaryDomain: string;
  sans: string[];
  sourceType: CertificateSourceType;
  currentVersionId?: string;
  status: CertificateAssetStatus;
  tags: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CertificateVersionEntity {
  id: string;
  tenantId?: string;
  certificateAssetId: string;
  versionNo: number;
  commonName?: string;
  sans: string[];
  issuer: CertificateDistinguishedName;
  subject: CertificateDistinguishedName;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  fingerprintSha256: string;
  publicKeyFingerprintSha256?: string;
  publicKeyAlgorithm: string;
  signatureAlgorithm: string;
  leafStorageRef: string;
  privateKeySecretRef?: string;
  issuingCaId?: string;
  certificateRequestId?: string;
  certificateProfileVersionId?: string;
  keyReferenceId?: string;
  keyCustodyMode?: 'local_agent' | 'managed_secret' | 'external_key' | 'device_local';
  chainCertificateRefs: string[];
  chainOrder: string[];
  chainDiagnostics: string[];
  chainStatus: CertificateChainStatus;
  deployable: boolean;
  sourceType: CertificateSourceType;
  activationState?: CertificateActivationState;
  status: CertificateVersionStatus;
  createdBy: string;
  createdAt: string;
}

export interface CertificateVersionFormatEntity {
  id: string;
  tenantId?: string;
  certificateVersionId?: string;
  format: CertificateFormat;
  artifactRef: string;
  parameterHash: string;
  parameters: Record<string, unknown>;
  containsPrivateKey: boolean;
  passwordSecretRef?: string;
  createdBy: string;
  createdAt: string;
  expiresAt?: string;
}
