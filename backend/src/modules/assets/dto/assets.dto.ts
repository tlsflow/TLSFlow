import type {
  BindingType,
  CompatibilityLevel,
  ManagementMode,
  OsType,
  ProviderType,
} from '../../../shared/enums/core.enums.js';
import type { BindingVerifyMethod, CertificateBindingDto, CreateCertificateBindingDto, DriftState } from '../../bindings/dto/bindings.dto.js';

export type HostStatus = 'ACTIVE' | 'INACTIVE' | 'UNKNOWN' | 'STALE' | 'DISABLED' | 'RETIRED' | 'DELETED';
export type ServiceInstanceStatus = 'ACTIVE' | 'STALE' | 'UNREACHABLE' | 'DISABLED' | 'RETIRED' | 'DELETED';
export type ServiceAssetStatus = 'ACTIVE' | 'INACTIVE' | 'UNKNOWN' | 'STALE' | 'DISABLED' | 'RETIRED' | 'DELETED';
export type ServiceEndpointStatus = 'ACTIVE' | 'INACTIVE' | 'UNKNOWN';
export type DiscoverySource = 'AGENT' | 'SSH' | 'MANUAL' | 'GATEWAY' | 'WINRM' | 'IMPORT' | 'PROVIDER';
export type ServiceEndpointProtocol = 'HTTPS' | 'TLS' | 'STARTTLS' | 'HTTP';
export type ServiceAssetAddressType = 'DNS' | 'IPV4' | 'IPV6' | 'UNKNOWN';
export type ServiceAssetPlatform = 'WINDOWS' | 'LINUX' | 'APPLIANCE';

export interface ManagementChannelDto {
  type: 'AGENT' | 'GATEWAY' | 'SSH' | 'WINRM' | 'MANUAL' | 'AGENTLESS' | 'SCRIPT_PACKAGE' | string;
  enabled?: boolean;
  refId?: string;
  metadata?: Record<string, unknown>;
}
export type AssetConflictResourceType = 'host' | 'service' | 'service_asset' | 'binding';
export type AssetConflictStatus = 'open' | 'resolved' | 'ignored';
export type AssetConflictResolution = 'keep_current' | 'use_discovered' | 'custom';

export interface HostDto {
  id: string;
  tenantId: string;
  hostname?: string;
  displayName?: string;
  primaryIp?: string;
  ipAddresses: string[];
  osType: OsType;
  osName?: string;
  osVersion?: string;
  arch?: string;
  environment?: string;
  zoneId?: string;
  ownerId?: string;
  managementChannels: ManagementChannelDto[];
  discoverySource: DiscoverySource;
  lastDiscoveredAt?: string;
  agentId?: string;
  assetFingerprint?: string;
  compatibilityLevel: CompatibilityLevel;
  managementMode: ManagementMode;
  status: HostStatus;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version: number;
}

export interface CreateHostDto {
  hostname?: string;
  displayName?: string;
  primaryIp?: string;
  ipAddresses?: string[];
  osType?: OsType;
  osName?: string;
  osVersion?: string;
  arch?: string;
  environment?: string;
  zoneId?: string;
  ownerId?: string;
  managementChannels?: ManagementChannelDto[];
  discoverySource?: DiscoverySource;
  lastDiscoveredAt?: string;
  agentId?: string;
  assetFingerprint?: string;
  compatibilityLevel?: CompatibilityLevel;
  managementMode?: ManagementMode;
  status?: HostStatus;
  tags?: string[];
}

export type UpdateHostDto = Partial<CreateHostDto>;

export interface ServiceInstanceDto {
  id: string;
  tenantId: string;
  hostId: string;
  providerType: ProviderType;
  serviceName?: string;
  displayName: string;
  versionText?: string;
  installPath?: string;
  configPath?: string;
  runtimeUser?: string;
  ports: Array<number | Record<string, unknown>>;
  providerKey?: string;
  manualOverrides: Record<string, unknown>;
  discoverySource: DiscoverySource;
  lastDiscoveredAt?: string;
  status: ServiceInstanceStatus;
  rawFacts: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version: number;
}

export interface CreateServiceInstanceDto {
  hostId: string;
  providerType: ProviderType;
  serviceName?: string;
  displayName: string;
  versionText?: string;
  installPath?: string;
  configPath?: string;
  runtimeUser?: string;
  ports?: Array<number | Record<string, unknown>>;
  providerKey?: string;
  manualOverrides?: Record<string, unknown>;
  discoverySource?: DiscoverySource;
  lastDiscoveredAt?: string;
  status?: ServiceInstanceStatus;
  rawFacts?: Record<string, unknown>;
}

export type UpdateServiceInstanceDto = Partial<Omit<CreateServiceInstanceDto, 'hostId'>> & {
  hostId?: string;
};

export interface ServiceAssetDto {
  id: string;
  tenantId: string;
  address: string;
  addressType: ServiceAssetAddressType;
  port: number;
  protocol: ServiceEndpointProtocol;
  platform?: ServiceAssetPlatform;
  agentId?: string;
  sniName?: string;
  displayName?: string;
  serviceInstanceId?: string;
  serviceEndpointId?: string;
  hostId?: string;
  environment?: string;
  discoverySource: DiscoverySource;
  lastDiscoveredAt?: string;
  status: ServiceAssetStatus;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version: number;
}

export interface CreateServiceAssetDto {
  address: string;
  addressType?: ServiceAssetAddressType;
  port: number;
  protocol: ServiceEndpointProtocol;
  platform?: ServiceAssetPlatform;
  agentId?: string;
  sniName?: string;
  displayName?: string;
  serviceInstanceId?: string;
  serviceEndpointId?: string;
  hostId?: string;
  environment?: string;
  discoverySource?: DiscoverySource;
  lastDiscoveredAt?: string;
  status?: ServiceAssetStatus;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export type UpdateServiceAssetDto = Partial<CreateServiceAssetDto>;

export interface ServiceEndpointDto {
  id: string;
  tenantId: string;
  serviceInstanceId: string;
  hostId: string;
  protocol: ServiceEndpointProtocol;
  hostName?: string;
  listenIp?: string;
  port: number;
  pathHint?: string;
  status: ServiceEndpointStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version: number;
}

export interface CreateServiceEndpointDto {
  serviceInstanceId: string;
  protocol: ServiceEndpointProtocol;
  hostName?: string;
  listenIp?: string;
  port: number;
  pathHint?: string;
  status?: ServiceEndpointStatus;
}

export type UpdateServiceEndpointDto = Partial<CreateServiceEndpointDto>;

export interface DiscoverySnapshotDto {
  id: string;
  tenantId: string;
  normalizedHash: string;
  source: DiscoverySource;
  normalizedPayload: Record<string, unknown>;
  rawPayload?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CreateDiscoverySnapshotDto {
  normalizedHash: string;
  source?: DiscoverySource;
  normalizedPayload?: Record<string, unknown>;
  rawPayload?: Record<string, unknown>;
}

export interface DiscoveryMergePreviewDto {
  snapshot: DiscoverySnapshotDto;
  actions: Array<{
    kind: 'host' | 'service' | 'endpoint' | 'service_asset' | 'binding';
    action: 'create' | 'update' | 'skip' | 'conflict';
    identityKey: string;
    existingId?: string;
    reason: string;
  }>;
  conflicts: Array<{
    kind: 'host' | 'service' | 'endpoint' | 'service_asset' | 'binding';
    identityKey: string;
    field: string;
    currentValue: unknown;
    discoveredValue: unknown;
    reason: string;
  }>;
  businessTableMutated: false;
}

export interface PreviewDiscoveryMergeDto extends CreateDiscoverySnapshotDto {}

export interface AssetConflictDto {
  id: string;
  tenantId: string;
  resourceType: AssetConflictResourceType;
  resourceId: string;
  field: string;
  currentValue: unknown;
  discoveredValue: unknown;
  sourceSnapshotId: string;
  status: AssetConflictStatus;
  resolvedBy?: string;
  resolvedAt?: string;
  comment?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CreateAssetConflictDto {
  resourceType: AssetConflictResourceType;
  resourceId: string;
  field: string;
  currentValue: unknown;
  discoveredValue: unknown;
  sourceSnapshotId: string;
}

export interface ResolveAssetConflictDto {
  id: string;
  resolution: AssetConflictResolution;
  comment?: string;
  customValue?: unknown;
  resolvedBy?: string;
}

export interface NormalizedDiscoveredHostDto {
  hostname?: string;
  displayName?: string;
  primaryIp?: string;
  ipAddresses?: string[];
  osType?: OsType;
  osName?: string;
  osVersion?: string;
  arch?: string;
  environment?: string;
  zoneId?: string;
  ownerId?: string;
  managementChannels?: ManagementChannelDto[];
  discoverySource?: DiscoverySource;
  lastDiscoveredAt?: string;
  agentId?: string;
  assetFingerprint?: string;
  compatibilityLevel?: CompatibilityLevel;
  managementMode?: ManagementMode;
  status?: HostStatus;
  tags?: string[];
}

export interface NormalizedDiscoveredServiceDto {
  hostRef?: string;
  hostname?: string;
  providerType: ProviderType;
  serviceName?: string;
  displayName?: string;
  versionText?: string;
  installPath?: string;
  configPath?: string;
  runtimeUser?: string;
  ports?: Array<number | Record<string, unknown>>;
  providerKey?: string;
  manualOverrides?: Record<string, unknown>;
  discoverySource?: DiscoverySource;
  lastDiscoveredAt?: string;
  status?: ServiceInstanceStatus;
  rawFacts?: Record<string, unknown>;
}

export interface NormalizedDiscoveredServiceAssetDto {
  serviceRef?: string;
  endpointRef?: string;
  hostname?: string;
  providerType?: ProviderType;
  serviceName?: string;
  address: string;
  addressType?: ServiceAssetAddressType;
  port: number;
  protocol: ServiceEndpointProtocol;
  sniName?: string;
  displayName?: string;
  hostId?: string;
  environment?: string;
  discoverySource?: DiscoverySource;
  lastDiscoveredAt?: string;
  status?: ServiceAssetStatus;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface NormalizedDiscoveredBindingDto {
  serviceAssetRef?: string;
  serviceRef?: string;
  hostname?: string;
  providerType?: ProviderType;
  serviceName?: string;
  domain?: string;
  domainName?: string;
  port?: number;
  protocol?: string;
  bindingKey?: string;
  bindingType?: BindingType;
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
  keystoreType?: 'JKS' | 'PKCS12';
  storeLocation?: string;
  storeName?: string;
  storeThumbprint?: string;
  reloadCommand?: string;
  reloadHint?: Record<string, unknown>;
  discoverySource?: string;
  verifyMethod?: BindingVerifyMethod;
  lastVerifiedAt?: string;
  lastDeployedAt?: string;
  status?: CertificateBindingDto['status'];
  metadata?: Record<string, unknown>;
}

export interface NormalizedDiscoveryPayloadDto {
  hosts: NormalizedDiscoveredHostDto[];
  services: NormalizedDiscoveredServiceDto[];
  serviceAssets: NormalizedDiscoveredServiceAssetDto[];
  bindings: NormalizedDiscoveredBindingDto[];
}

export interface IngestDiscoveryDto extends CreateDiscoverySnapshotDto {
  apply?: boolean;
}

export interface DiscoveryIngestResultDto {
  snapshot: DiscoverySnapshotDto;
  actions: Array<{
    kind: 'host' | 'service' | 'service_asset' | 'binding';
    action: 'create' | 'update' | 'skip' | 'conflict';
    identityKey: string;
    existingId?: string;
    resourceId?: string;
    reason: string;
  }>;
  conflicts: AssetConflictDto[];
  businessTableMutated: boolean;
}

export interface ResolvedAssetConflictDto {
  conflict: AssetConflictDto;
  resource?: HostDto | ServiceInstanceDto | ServiceAssetDto | CertificateBindingDto;
}

export interface BindingDriftPersistenceDto {
  bindingId: string;
  localConfigFingerprint?: string;
  localConfigPath?: string;
  remoteEndpointFingerprint?: string;
  remoteStatus?: 'reachable' | 'unreachable' | 'unknown';
  tlsVersion?: string;
  chainSummary?: Record<string, unknown>;
  checkedAt?: string;
}

export interface BindingDriftPersistenceResultDto {
  binding: CertificateBindingDto;
  driftStatus: DriftState;
}

export type DiscoveryBindingCreateDto = CreateCertificateBindingDto;
