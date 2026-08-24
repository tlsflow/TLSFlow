import type { BindingType, CertificateBindingStatus } from '../../../shared/enums/core.enums.js';

export type BindingVerifyMethod = 'TLS_CONNECT' | 'LOCAL_FILE' | 'STORE_QUERY' | 'CUSTOM';
export type KeystoreType = 'JKS' | 'PKCS12';

export interface CertificateBindingDto {
  id: string;
  tenantId: string;
  serviceInstanceId: string;
  serviceEndpointId?: string;
  hostId: string;
  domainName?: string;
  bindingType: BindingType;
  certificateVersionId?: string;
  observedFingerprintSha256?: string;
  desiredFingerprintSha256?: string;
  certPath?: string;
  keyPath?: string;
  chainPath?: string;
  keystorePath?: string;
  keystoreType?: KeystoreType;
  storeLocation?: string;
  storeName?: string;
  storeThumbprint?: string;
  reloadCommand?: string;
  verifyMethod: BindingVerifyMethod;
  lastVerifiedAt?: string;
  lastDeployedAt?: string;
  status: CertificateBindingStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version: number;
}

export interface CreateCertificateBindingDto {
  serviceInstanceId: string;
  serviceEndpointId?: string;
  domainName?: string;
  bindingType: BindingType;
  certificateVersionId?: string;
  observedFingerprintSha256?: string;
  desiredFingerprintSha256?: string;
  certPath?: string;
  keyPath?: string;
  chainPath?: string;
  keystorePath?: string;
  keystoreType?: KeystoreType;
  storeLocation?: string;
  storeName?: string;
  storeThumbprint?: string;
  reloadCommand?: string;
  verifyMethod: BindingVerifyMethod;
  lastVerifiedAt?: string;
  lastDeployedAt?: string;
  status?: CertificateBindingStatus;
  metadata?: Record<string, unknown>;
}

export interface PatchCertificateBindingStatusDto {
  bindingId: string;
  status: CertificateBindingStatus;
}

export type DriftState = 'synced' | 'mismatch' | 'unreachable' | 'unknown' | 'incomplete';

export interface DetectBindingDriftDto {
  localFingerprintSha256?: string;
  remoteFingerprintSha256?: string;
  desiredFingerprintSha256?: string;
  reachable?: boolean;
}

export interface BindingDriftDto {
  state: DriftState;
  localFingerprintSha256?: string;
  remoteFingerprintSha256?: string;
  desiredFingerprintSha256?: string;
}

export interface CertificateBindingUsageDto {
  binding: CertificateBindingDto;
  service?: {
    id: string;
    displayName: string;
    providerType: string;
    status: string;
    deletedAt?: string;
  };
  host?: {
    id: string;
    hostname: string;
    primaryIp?: string;
    status: string;
    deletedAt?: string;
  };
}
