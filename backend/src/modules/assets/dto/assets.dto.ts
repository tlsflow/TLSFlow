import type {
  BindingType,
  CompatibilityLevel,
  ManagementMode,
  OsType,
  ProviderType,
} from '../../../shared/enums/core.enums.js';
import type { BindingVerifyMethod, CertificateBindingDto, CreateCertificateBindingDto, DriftState } from '../../bindings/dto/bindings.dto.js';
import type { RuntimeCredentialV1 } from '../../deployment-inputs/dto/resolved-deployment-input.dto.js';
import type { InputBindingsV1 } from '../../deployment-inputs/dto/input-bindings.dto.js';

export type HostStatus = 'ACTIVE' | 'INACTIVE' | 'UNKNOWN' | 'STALE' | 'DISABLED' | 'RETIRED' | 'DELETED';
export type FrameworkInstanceStatus = 'ACTIVE' | 'STALE' | 'UNREACHABLE' | 'DISABLED' | 'RETIRED' | 'DELETED';
export type ServiceAssetStatus = 'ACTIVE' | 'INACTIVE' | 'UNKNOWN' | 'STALE' | 'DISABLED' | 'RETIRED' | 'DELETED';
export type ServiceEndpointStatus = 'ACTIVE' | 'INACTIVE' | 'UNKNOWN';
export type DiscoverySource = 'AGENT' | 'SSH' | 'MANUAL' | 'GATEWAY' | 'WINRM' | 'IMPORT' | 'PROVIDER';
export type ServiceEndpointProtocol = 'HTTPS' | 'TLS' | 'STARTTLS' | 'HTTP';
export type ServiceAssetAddressType = 'DNS' | 'IPV4' | 'IPV6' | 'UNKNOWN';
export type ServiceAssetPlatform = 'WINDOWS' | 'LINUX' | 'APPLIANCE';
export type SiteAssetType = string;
export type SiteAssetStatus = 'ACTIVE' | 'INACTIVE' | 'UNKNOWN' | 'STALE' | 'DISABLED' | 'RETIRED' | 'DELETED';
export type ManagedTargetType = string;
export type ManagedTargetStatus = 'ACTIVE' | 'INACTIVE' | 'UNKNOWN' | 'STALE' | 'UNREACHABLE' | 'DISABLED' | 'DELETED';
export type ManagedTargetExecutionLocation = 'AGENT' | 'CONTROL_PLANE' | 'GATEWAY';
export type ApplicationAssetTargetStatus = 'ACTIVE' | 'INACTIVE' | 'PENDING' | 'ERROR' | 'DELETED';
export type ManagedTargetSnapshotType = 'PRE_DEPLOY' | 'POST_DEPLOY' | 'ROLLBACK_POINT' | 'POST_ROLLBACK' | 'ERROR_STATE';
export type DeploymentStrategyType = 'MANAGED_TARGET' | 'WORKFLOW';
export type WorkflowRunnerType = 'CONTROL_PLANE' | 'GATEWAY';
export type WorkflowVersionSelection = 'PINNED' | 'LATEST_PUBLISHED';
export type DeploymentStrategyCompatibilityMode = 'UNIFIED';
export type ManagedTargetExecutionMode = 'PLUGIN' | 'WORKFLOW_OVERRIDE';

export interface ManagementChannelDto {
  type: 'AGENT' | 'GATEWAY' | 'SSH' | 'WINRM' | 'MANUAL' | 'AGENTLESS' | 'SCRIPT_PACKAGE' | string;
  enabled?: boolean;
  refId?: string;
  metadata?: Record<string, unknown>;
}

export interface ManagedTargetDeploymentStrategyDto {
  managedTargetId: string;
  certificateFormatId?: string;
  executionMode?: ManagedTargetExecutionMode;
  workflowExecutionBindingId?: string;
}

export interface WorkflowDeploymentStrategyDto {
  workflowExecutionBindingId?: string;
  pluginBindingId?: string;
  workflowId?: string;
  workflowVersionSelection?: WorkflowVersionSelection;
  workflowVersionId?: string;
  runner?: WorkflowRunnerType;
  gatewayId?: string;
  target?: {
    frameworkType?: 'NGINX' | 'APACHE' | 'TOMCAT' | 'IIS' | 'CUSTOM' | string;
    siteName?: string;
    bindingInformation?: string;
    hostHeader?: string;
    port?: number;
    protocol?: ServiceEndpointProtocol | string;
    verifyUrl?: string;
    sniName?: string;
  };
  credentials?: Record<string, RuntimeCredentialV1 & { credentialVersionId: string; snapshotSha256: string }>;
  inputBindings?: InputBindingsV1;
  executionBranch?: 'deploy' | 'rollback';
  /** @deprecated 回滚应复用同一 WorkflowVersion 的 rollback 分支。 */
  rollbackWorkflowVersionId?: string;
}

export interface DeploymentStrategyDto {
  type: DeploymentStrategyType;
  managedTarget?: ManagedTargetDeploymentStrategyDto;
  workflow?: WorkflowDeploymentStrategyDto;
  compatibilityMode?: DeploymentStrategyCompatibilityMode;
  updatedAt?: string;
  updatedBy?: string;
}

export interface ManagedDeploymentIntentDto {
  type: 'MANAGED_TARGET';
  managedTargetId: string;
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

export interface FrameworkInstanceDto {
  id: string;
  tenantId: string;
  deviceId: string;
  frameworkType: string;
  frameworkKey: string;
  discoveryProviderKey: string;
  displayName: string;
  frameworkVersion?: string;
  discoverySource: DiscoverySource;
  lastDiscoveredAt?: string;
  status: FrameworkInstanceStatus;
  rawFacts: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version: number;
}

export interface CreateFrameworkInstanceDto {
  deviceId: string;
  frameworkType: string;
  frameworkKey: string;
  discoveryProviderKey: string;
  displayName: string;
  frameworkVersion?: string;
  discoverySource?: DiscoverySource;
  lastDiscoveredAt?: string;
  status?: FrameworkInstanceStatus;
  rawFacts?: Record<string, unknown>;
}

export type UpdateFrameworkInstanceDto = Partial<Omit<CreateFrameworkInstanceDto, 'deviceId'>> & {
  deviceId?: string;
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
  verifyUrl?: string;
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
  deploymentStrategy?: DeploymentStrategyDto;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version: number;
  targetBinding?: ApplicationAssetTargetSummaryDto;
}

export interface ServiceAssetDetailDto extends ServiceAssetDto {
  targetBindingDetail?: ApplicationAssetTargetDetailDto;
  targetSnapshots?: ManagedTargetSnapshotDto[];
}

export interface CreateServiceAssetDto {
  address: string;
  addressType?: ServiceAssetAddressType;
  port: number;
  protocol: ServiceEndpointProtocol;
  platform?: ServiceAssetPlatform;
  agentId?: string;
  sniName?: string;
  verifyUrl?: string;
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
  deploymentStrategy?: DeploymentStrategyDto;
  targetBinding?: CreateApplicationAssetTargetDto;
  siteAssetId?: string;
}

export type UpdateServiceAssetDto = Partial<CreateServiceAssetDto>;

export interface ServiceEndpointDto {
  id: string;
  tenantId: string;
  serviceInstanceId: string;
  hostId?: string;
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

export interface SiteAssetDto {
  id: string;
  tenantId: string;
  frameworkInstanceId: string;
  deviceId: string;
  discoveryProviderKey: string;
  siteType: SiteAssetType;
  siteName: string;
  siteKey: string;
  bindingInformation?: string;
  hostHeader?: string;
  listenIp?: string;
  port?: number;
  protocol?: ServiceEndpointProtocol;
  configPath?: string;
  runtimeStatus?: string;
  discoverySource: DiscoverySource;
  lastDiscoveredAt?: string;
  status: SiteAssetStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version: number;
}

export interface CreateSiteAssetDto {
  frameworkInstanceId: string;
  deviceId: string;
  discoveryProviderKey: string;
  siteType: SiteAssetType;
  siteName: string;
  siteKey: string;
  bindingInformation?: string;
  hostHeader?: string;
  listenIp?: string;
  port?: number;
  protocol?: ServiceEndpointProtocol;
  configPath?: string;
  runtimeStatus?: string;
  discoverySource?: DiscoverySource;
  lastDiscoveredAt?: string;
  status?: SiteAssetStatus;
  metadata?: Record<string, unknown>;
}

export type UpdateSiteAssetDto = Partial<CreateSiteAssetDto>;

export interface ManagedTargetDto {
  id: string;
  tenantId: string;
  deviceId: string;
  frameworkInstanceId?: string;
  siteId?: string;
  discoveryProviderKey: string;
  targetType: ManagedTargetType;
  targetKey: string;
  bindingKey?: string;
  supportedCapabilities: string[];
  executionLocations: ManagedTargetExecutionLocation[];
  lastSeenAt?: string;
  status: ManagedTargetStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version: number;
}

export interface ApplicationAssetTargetSummaryDto {
  id: string;
  applicationAssetId: string;
  managedTargetId: string;
  deviceId?: string;
  deviceDisplayName?: string;
  frameworkInstanceId?: string;
  frameworkType?: string;
  frameworkDisplayName?: string;
  siteAssetId?: string;
  siteName?: string;
  status: ApplicationAssetTargetStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version: number;
}

export interface ApplicationAssetTargetDetailDto extends ApplicationAssetTargetSummaryDto {
  host?: HostDto;
  frameworkInstance?: FrameworkInstanceDto;
  siteAsset?: SiteAssetDto;
  managedTarget?: ManagedTargetDto;
  availableExecutionLocations?: ManagedTargetExecutionLocation[];
  certificateBindings: Array<Pick<
    CertificateBindingDto,
    | 'id'
    | 'serviceAssetId'
    | 'siteAssetId'
    | 'managedTargetId'
    | 'domain'
    | 'domainName'
    | 'bindingKey'
    | 'bindingType'
    | 'status'
    | 'certificateVersionId'
    | 'targetCertificateVersionId'
    | 'observedFingerprintSha256'
    | 'desiredFingerprintSha256'
    | 'targetFingerprintSha256'
    | 'storeThumbprint'
    | 'lastVerifiedAt'
    | 'lastDeployedAt'
  >>;
}

export interface CreateApplicationAssetTargetDto {
  applicationAssetId: string;
  managedTargetId: string;
  status?: ApplicationAssetTargetStatus;
  metadata?: Record<string, unknown>;
}

export type UpdateApplicationAssetTargetDto = Partial<CreateApplicationAssetTargetDto>;

export interface ManagedTargetSnapshotDto {
  id: string;
  tenantId: string;
  applicationAssetId?: string;
  siteAssetId?: string;
  managedTargetId?: string;
  certificateBindingId?: string;
  executionRunId?: string;
  executionStepId?: string;
  bindingInformation?: string;
  hostHeader?: string;
  port?: number;
  storeLocation?: string;
  storeName?: string;
  storeThumbprint?: string;
  certificateVersionId?: string;
  fingerprintSha256?: string;
  snapshotType: ManagedTargetSnapshotType;
  status: 'SUCCESS' | 'FAILED' | 'ROLLED_BACK' | 'MANUAL_REQUIRED' | 'UNKNOWN';
  metadata: Record<string, unknown>;
  capturedAt: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CreateManagedTargetSnapshotDto {
  applicationAssetId?: string;
  siteAssetId?: string;
  managedTargetId?: string;
  certificateBindingId?: string;
  executionRunId?: string;
  executionStepId?: string;
  bindingInformation?: string;
  hostHeader?: string;
  port?: number;
  storeLocation?: string;
  storeName?: string;
  storeThumbprint?: string;
  certificateVersionId?: string;
  fingerprintSha256?: string;
  snapshotType: ManagedTargetSnapshotType;
  status?: ManagedTargetSnapshotDto['status'];
  metadata?: Record<string, unknown>;
  capturedAt?: string;
}

export interface CreateManagedTargetDto {
  deviceId: string;
  frameworkInstanceId?: string;
  siteId?: string;
  discoveryProviderKey: string;
  targetType: ManagedTargetType;
  targetKey: string;
  bindingKey?: string;
  supportedCapabilities: string[];
  executionLocations: ManagedTargetExecutionLocation[];
  lastSeenAt?: string;
  status?: ManagedTargetStatus;
  metadata?: Record<string, unknown>;
}

export type UpdateManagedTargetDto = Partial<CreateManagedTargetDto>;

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
    kind: 'host' | 'service' | 'endpoint' | 'service_asset' | 'site_asset' | 'managed_target' | 'binding';
    action: 'create' | 'update' | 'skip' | 'conflict';
    identityKey: string;
    existingId?: string;
    reason: string;
  }>;
  conflicts: Array<{
    kind: 'host' | 'service' | 'endpoint' | 'service_asset' | 'site_asset' | 'managed_target' | 'binding';
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
  frameworkType: ProviderType;
  frameworkKey?: string;
  displayName?: string;
  versionText?: string;
  installPath?: string;
  configPath?: string;
  runtimeUser?: string;
  ports?: Array<number | Record<string, unknown>>;
  discoveryProviderKey: string;
  manualOverrides?: Record<string, unknown>;
  discoverySource?: DiscoverySource;
  lastDiscoveredAt?: string;
  status?: FrameworkInstanceStatus;
  rawFacts?: Record<string, unknown>;
}

export interface NormalizedDiscoveredServiceAssetDto {
  serviceRef?: string;
  endpointRef?: string;
  hostname?: string;
  frameworkType?: ProviderType;
  frameworkKey?: string;
  discoveryProviderKey?: string;
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

export interface NormalizedDiscoveredSiteAssetDto {
  siteAssetRef?: string;
  serviceAssetRef?: string;
  serviceRef?: string;
  hostname?: string;
  frameworkType?: ProviderType;
  frameworkKey?: string;
  discoveryProviderKey?: string;
  agentId?: string;
  siteType?: SiteAssetType;
  siteName: string;
  siteKey?: string;
  bindingInformation?: string;
  hostHeader?: string;
  listenIp?: string;
  port?: number;
  protocol?: ServiceEndpointProtocol;
  configPath?: string;
  runtimeStatus?: string;
  discoverySource?: DiscoverySource;
  lastDiscoveredAt?: string;
  status?: SiteAssetStatus;
  metadata?: Record<string, unknown>;
}

export interface NormalizedDiscoveredBindingDto {
  serviceAssetRef?: string;
  siteAssetRef?: string;
  serviceRef?: string;
  hostname?: string;
  frameworkType?: ProviderType;
  frameworkKey?: string;
  discoveryProviderKey?: string;
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
  siteAssets: NormalizedDiscoveredSiteAssetDto[];
  bindings: NormalizedDiscoveredBindingDto[];
}

export interface IngestDiscoveryDto extends CreateDiscoverySnapshotDto {
  apply?: boolean;
}

export interface RefreshAssetsFromAgentDto {
  agentId: string;
  providerTypes?: string[];
  includeBindings?: boolean;
  requestId?: string;
}

export interface RefreshAssetsFromAgentResultDto {
  mode: 'standard-capability' | 'queued';
  taskId: string;
  taskStatus: 'queued' | 'leased' | 'acked' | 'succeeded' | 'failed' | 'rejected';
  capabilitySnapshotId?: string;
  projection?: {
    serviceInstances: number;
    sites: number;
    managedTargets: number;
    certificates: number;
    certificateBindings: number;
    stale: number;
    conflicts: number;
  };
}

export interface DiscoveryIngestResultDto {
  snapshot: DiscoverySnapshotDto;
  actions: Array<{
    kind: 'host' | 'service' | 'service_asset' | 'site_asset' | 'managed_target' | 'binding';
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
  resource?: HostDto | FrameworkInstanceDto | ServiceAssetDto | SiteAssetDto | ManagedTargetDto | CertificateBindingDto;
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
