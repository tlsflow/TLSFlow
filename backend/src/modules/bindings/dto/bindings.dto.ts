import type { BindingType, CertificateBindingStatus } from '../../../shared/enums/core.enums.js';

export type BindingVerifyMethod = 'TLS_CONNECT' | 'LOCAL_FILE' | 'STORE_QUERY' | 'CUSTOM';
export type KeystoreType = 'JKS' | 'PKCS12';
export type BindingProtocol = 'HTTPS' | 'TLS' | 'SMTPS' | 'LDAPS' | 'CUSTOM' | string;

export interface CertificateBindingDto {
  id: string;
  tenantId: string;
  /** 业务资产主关联：address + port + protocol。 */
  serviceAssetId?: string;
  siteAssetId?: string;
  managedTargetId?: string;
  /** 执行和定位辅助关联，兼容旧调用。 */
  serviceInstanceId: string;
  /** 旧端点关联，保留兼容，不再作为业务资产主键。 */
  serviceEndpointId?: string;
  /** 执行宿主机事实，来自 ServiceInstance/ServiceAsset。 */
  hostId?: string;
  domainName?: string;
  /** Spec 007 规范字段，兼容旧 domainName。 */
  domain?: string;
  port?: number;
  protocol?: BindingProtocol;
  bindingKey: string;
  bindingType: BindingType;
  certificateVersionId?: string;
  targetCertificateVersionId?: string;
  localCertificateVersionId?: string;
  observedFingerprintSha256?: string;
  desiredFingerprintSha256?: string;
  targetFingerprintSha256?: string;
  unmanagedCertificateFingerprint?: string;
  certPath?: string;
  keyPath?: string;
  chainPath?: string;
  keystorePath?: string;
  keystoreType?: KeystoreType;
  storeLocation?: string;
  storeName?: string;
  storeThumbprint?: string;
  reloadCommand?: string;
  reloadHint?: Record<string, unknown>;
  discoverySource?: string;
  verifyMethod: BindingVerifyMethod;
  localConfigFingerprint?: string;
  localConfigPath?: string;
  remoteEndpointFingerprint?: string;
  remoteStatus?: 'reachable' | 'unreachable' | 'unknown';
  tlsVersion?: string;
  chainSummary?: Record<string, unknown>;
  checkedAt?: string;
  driftStatus?: DriftState;
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
  serviceAssetId?: string;
  siteAssetId?: string;
  managedTargetId?: string;
  serviceInstanceId: string;
  serviceEndpointId?: string;
  domainName?: string;
  /** Spec 007 规范字段，兼容旧 domainName。 */
  domain?: string;
  port?: number;
  protocol?: BindingProtocol;
  bindingKey?: string;
  bindingType: BindingType;
  certificateVersionId?: string;
  targetCertificateVersionId?: string;
  localCertificateVersionId?: string;
  observedFingerprintSha256?: string;
  desiredFingerprintSha256?: string;
  targetFingerprintSha256?: string;
  unmanagedCertificateFingerprint?: string;
  certPath?: string;
  keyPath?: string;
  chainPath?: string;
  keystorePath?: string;
  keystoreType?: KeystoreType;
  storeLocation?: string;
  storeName?: string;
  storeThumbprint?: string;
  reloadCommand?: string;
  reloadHint?: Record<string, unknown>;
  discoverySource?: string;
  verifyMethod: BindingVerifyMethod;
  lastVerifiedAt?: string;
  lastDeployedAt?: string;
  status?: CertificateBindingStatus;
  metadata?: Record<string, unknown>;
}

export type UpdateCertificateBindingDto = Partial<CreateCertificateBindingDto> & {
  localConfigFingerprint?: string;
  localConfigPath?: string;
  remoteEndpointFingerprint?: string;
  remoteStatus?: 'reachable' | 'unreachable' | 'unknown';
  tlsVersion?: string;
  chainSummary?: Record<string, unknown>;
  checkedAt?: string;
  driftStatus?: DriftState;
};

export interface DeleteCertificateBindingDto {
  bindingId: string;
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
  serviceAsset?: {
    id: string;
    address: string;
    port: number;
    protocol: string;
    status: string;
    deletedAt?: string;
  };
  service?: {
    id: string;
    displayName: string;
    providerType: string;
    status: string;
    deletedAt?: string;
  };
  host?: {
    id: string;
    hostname?: string;
    displayName?: string;
    agentId?: string;
    primaryIp?: string;
    status: string;
    deletedAt?: string;
  };
  siteAsset?: {
    id: string;
    siteName: string;
    bindingInformation?: string;
    hostHeader?: string;
    port?: number;
    protocol?: string;
    agentId?: string;
    status: string;
    deletedAt?: string;
  };
  managedTarget?: {
    id: string;
    agentId: string;
    targetKey: string;
    bindingKey?: string;
    status: string;
    deletedAt?: string;
  };
}
