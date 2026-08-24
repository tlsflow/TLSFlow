export type ServiceAssetKind = 'APPLICATION' | 'DEVICE';
export type DeviceFamily = string;
export type DeviceAuthMode = string;
export type DeviceSupportTier = 'SUPPORTED' | 'COMPATIBLE' | 'READ_ONLY' | 'UNSUPPORTED' | string;
export type DeviceDiscoveryStatus = 'ACTIVE' | 'INACTIVE' | 'UNKNOWN' | 'STALE' | 'DELETED';

export interface DeviceAssetDto {
  id: string;
  tenantId: string;
  hostId: string;
  displayName: string;
  managementAddress: string;
  managementPort: number;
  deviceFamily: DeviceFamily;
  credentialId?: string;
  authMode: DeviceAuthMode;
  tlsVerify: boolean;
  caSecretId?: string;
  gatewayId?: string;
  productName?: string;
  softwareVersion?: string;
  softwareBuild?: string;
  runtimeMode?: string;
  haMode?: string;
  supportTier: DeviceSupportTier;
  capabilityProfile: Record<string, unknown>;
  lastDiscoveredAt?: string;
  lastErrorCode?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CreateDeviceAssetDto {
  displayName: string;
  managementAddress: string;
  managementPort?: number;
  deviceFamily: DeviceFamily;
  credentialId?: string;
  authMode?: DeviceAuthMode;
  tlsVerify?: boolean;
  caSecretId?: string;
  gatewayId?: string;
}

export type UpdateDeviceAssetDto = Partial<Omit<CreateDeviceAssetDto, 'deviceFamily'>>;

export interface DeviceVirtualServerDto {
  id: string;
  tenantId: string;
  deviceAssetId: string;
  type: string;
  name: string;
  targetKey: string;
  address?: string;
  port?: number;
  protocol?: string;
  runtimeState?: string;
  sniNames: string[];
  metadata: Record<string, unknown>;
  lastDiscoveredAt?: string;
  status: DeviceDiscoveryStatus;
}

export interface DeviceCertificateResourceDto {
  id: string;
  tenantId: string;
  deviceAssetId: string;
  certKeyName: string;
  certificatePath?: string;
  privateKeyPath?: string;
  subject?: string;
  issuer?: string;
  serialNumber?: string;
  notBefore?: string;
  notAfter?: string;
  remoteStatus?: string;
  signatureAlgorithm?: string;
  publicKeyAlgorithm?: string;
  publicKeySize?: number;
  linkedCertKeyName?: string;
  fingerprintSha256?: string;
  sourceVersion: string;
  metadata: Record<string, unknown>;
}

export interface DeviceCertificateBindingDto {
  id: string;
  tenantId: string;
  deviceAssetId: string;
  virtualServerId: string;
  certificateResourceId: string;
  bindingKey: string;
  sniCertificate: boolean;
  priority?: number;
  desiredCertificateVersionId?: string;
  observedFingerprintSha256?: string;
  desiredFingerprintSha256?: string;
  driftState: string;
  metadata: Record<string, unknown>;
  lastVerifiedAt?: string;
  lastDeployedAt?: string;
}
