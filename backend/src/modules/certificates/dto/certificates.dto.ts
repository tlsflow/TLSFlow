import type {
  CertificateAssetEntity,
  CertificateFormat,
  CertificateSourceType,
  CertificateVersionEntity,
  CertificateVersionFormatEntity,
} from '../schema/certificates.schema.js';

export interface CertificateAssetDto {
  id: string;
  name: string;
  primaryDomain: string;
  sans: string[];
  sourceType: CertificateSourceType;
  currentVersionId?: string;
  status: string;
  tags: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CertificateVersionDto {
  id: string;
  certificateAssetId: string;
  versionNo: number;
  commonName?: string;
  sans: string[];
  issuer: CertificateVersionEntity['issuer'];
  subject: CertificateVersionEntity['subject'];
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  fingerprintSha256: string;
  publicKeyFingerprintSha256?: string;
  publicKeyAlgorithm: string;
  signatureAlgorithm: string;
  leafStorageRef: string;
  hasPrivateKey: boolean;
  chainCertificateRefs: string[];
  chainOrder: string[];
  chainDiagnostics: string[];
  chainStatus: string;
  deployable: boolean;
  activationState: CertificateVersionEntity['activationState'];
  sourceType: CertificateSourceType;
  status: string;
  createdBy: string;
  createdAt: string;
}

export interface CertificateVersionFormatDto {
  id: string;
  certificateVersionId?: string;
  format: CertificateFormat;
  parameterHash: string;
  parameters: Record<string, unknown>;
  containsPrivateKey: boolean;
  passwordSecretRef?: string;
  createdBy: string;
  createdAt: string;
  expiresAt?: string;
}

export interface CertificateArtifactFileDto {
  key: string;
  role: 'public_certificate' | 'private_key' | 'certificate_chain' | 'bundle' | string;
  format: string;
  content?: string;
  contentBase64?: string;
  contentEncoding: 'utf8' | 'base64' | string;
}

export interface CreateCertificateAssetInput {
  name: string;
  primaryDomain: string;
  sans?: string[];
  sourceType?: CertificateSourceType;
  tags?: string[];
  createdBy: string;
}


export interface CertificateAssetDetailDto extends CertificateAssetDto {
  versions: CertificateVersionDto[];
  currentVersion?: CertificateVersionDto;
}

export interface CertificateVersionDetailDto extends CertificateVersionDto {
  asset: CertificateAssetDto;
  formats: CertificateVersionFormatDto[];
  chainCertificates: Array<{
    fingerprintSha256: string;
    displayName: string;
    commonName?: string;
    subject: CertificateVersionEntity['subject'];
    issuer: CertificateVersionEntity['issuer'];
    role: 'leaf' | 'intermediate' | 'root';
  }>;
}

export interface CertificateUsageDto {
  certificateAssetId?: string;
  certificateVersionId?: string;
  fingerprintSha256?: string;
  usages: unknown[];
  blockedDeletion: boolean;
  source: 'repository' | 'placeholder';
}

export interface CertificateFormatCapabilityDto {
  format: CertificateFormat;
  importSupported: boolean;
  exportSupported: boolean;
  containsPrivateKey: 'never' | 'optional' | 'required';
  implementation: 'node_crypto' | 'openssl' | 'keytool' | 'controlled_error';
  limitations: string[];
}

export interface CertificateFormatCapabilitiesDto {
  formats: CertificateFormatCapabilityDto[];
}

export interface ChangeCertificateAssetStatusInput {
  id: string;
  status: 'active' | 'archived' | 'deleted';
  actorId: string;
}

export interface ChangeCertificateVersionStatusInput {
  id: string;
  status: 'active' | 'archived' | 'revoked' | 'deleted';
  actorId: string;
}

export interface ImportCertificateVersionInput {
  certificateAssetId?: string;
  certificatePem?: string;
  certificateDerBase64?: string;
  pfxBase64?: string;
  pfxPassword?: string;
  jksBase64?: string;
  jksPassword?: string;
  jksKeyPassword?: string;
  jksAlias?: string;
  p7bBase64?: string;
  declaredFormat?: CertificateFormat;
  privateKeyPem?: string;
  existingPrivateKeySecretRef?: string;
  allowCertificateOnly?: boolean;
  activationState?: CertificateVersionEntity['activationState'];
  issuingCaId?: string;
  certificateRequestId?: string;
  certificateProfileVersionId?: string;
  keyReferenceId?: string;
  keyCustodyMode?: 'local_agent' | 'managed_secret' | 'external_key' | 'device_local';
  sourceType?: CertificateSourceType;
  name?: string;
  tags?: string[];
  createdBy: string;
}

export interface CreateCertificateVersionFormatInput {
  certificateVersionId?: string;
  format: CertificateFormat;
  containsPrivateKey?: boolean;
  passwordSecretRef?: string;
  parameters?: Record<string, unknown>;
  createdBy: string;
  expiresAt?: string;
}

export interface UpdateCertificateVersionFormatInput {
  id: string;
  certificateVersionId?: string;
  format?: CertificateFormat;
  containsPrivateKey?: boolean;
  passwordSecretRef?: string;
  parameters?: Record<string, unknown>;
  createdBy: string;
  expiresAt?: string;
}

export interface DeleteCertificateVersionFormatInput {
  id: string;
  deletedBy: string;
}

export interface CertificateSourceSyncInput {
  sourceType: CertificateSourceType;
  externalId: string;
  certificatePem?: string;
  pfxBase64?: string;
  pfxPassword?: string;
  declaredFormat?: CertificateFormat;
  privateKeyPem?: string;
  name?: string;
  tags?: string[];
  createdBy: string;
}

export interface CertificateSourceSyncResult {
  sourceType: CertificateSourceType;
  externalId: string;
  imported: boolean;
  asset: CertificateAssetDto;
  version: CertificateVersionDto;
}

export interface ImportCertificateVersionResult {
  asset: CertificateAssetDto;
  version: CertificateVersionDto;
  diagnostics: {
    sourceFormat: CertificateFormat;
    privateKeySaved: boolean;
    privateKeyMatched: boolean;
    chainStatus: string;
    chainOrder: string[];
    chainDiagnostics: string[];
  };
}

export interface ValidateCertificateImportResult {
  sourceFormat: CertificateFormat;
  importable: boolean;
  blockers: string[];
  warnings: string[];
  certificate: {
    commonName?: string;
    sans: string[];
    issuer: CertificateVersionEntity['issuer'];
    subject: CertificateVersionEntity['subject'];
    serialNumber: string;
    publicKeyFingerprintSha256?: string;
    notBefore: string;
    notAfter: string;
    fingerprintSha256: string;
    publicKeyAlgorithm: string;
    signatureAlgorithm: string;
  };
  privateKey: {
    provided: boolean;
    matched: boolean;
    source: 'input' | 'container' | 'none';
  };
  chain: {
    status: string;
    order: string[];
    diagnostics: string[];
    certificateCount: number;
    certificates: Array<{
      fingerprintSha256: string;
      displayName: string;
      commonName?: string;
      subject: CertificateVersionEntity['subject'];
      issuer: CertificateVersionEntity['issuer'];
      role: 'leaf' | 'intermediate' | 'root';
    }>;
  };
}

export function toCertificateAssetDto(entity: CertificateAssetEntity): CertificateAssetDto {
  return { ...entity };
}

export function toCertificateVersionDto(entity: CertificateVersionEntity): CertificateVersionDto {
  // API 不返回私钥材料，也不暴露私钥 SecretRef。
  const { privateKeySecretRef, ...safeEntity } = entity;
  void privateKeySecretRef;
  return { ...safeEntity, activationState: entity.activationState ?? 'promoted', hasPrivateKey: Boolean(entity.privateKeySecretRef) };
}

export function toCertificateVersionFormatDto(entity: CertificateVersionFormatEntity): CertificateVersionFormatDto {
  const { artifactRef, ...rest } = entity;
  void artifactRef;
  return { ...rest };
}
