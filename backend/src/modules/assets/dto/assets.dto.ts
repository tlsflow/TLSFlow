import type {
  BindingType,
  CompatibilityLevel,
  ManagementMode,
  OsType,
  ProviderType,
} from '../../../shared/enums/core.enums.js';
import type { BindingVerifyMethod, CertificateBindingDto, CreateCertificateBindingDto, DriftState } from '../../bindings/dto/bindings.dto.js';
import type { CertificateDistinguishedName } from '../../certificates/schema/certificates.schema.js';
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
/** ServiceAsset 的业务类别。APPLICATION 供应用资产使用，DEVICE 供设备兼容层使用，CLOUD_SERVICE 供云服务插件使用。 */
export type ServiceAssetKind = 'APPLICATION' | 'DEVICE' | 'CLOUD_SERVICE';
export type SiteAssetType = string;
export type SiteAssetStatus = 'ACTIVE' | 'INACTIVE' | 'UNKNOWN' | 'STALE' | 'DISABLED' | 'RETIRED' | 'DELETED';
export type ManagedTargetType = string;
export type ManagedTargetStatus = 'ACTIVE' | 'INACTIVE' | 'UNKNOWN' | 'STALE' | 'UNREACHABLE' | 'DISABLED' | 'DELETED';
export type ManagedTargetExecutionLocation = 'AGENT' | 'CONTROL_PLANE' | 'GATEWAY';
export type ApplicationAssetTargetStatus = 'ACTIVE' | 'INACTIVE' | 'PENDING' | 'ERROR' | 'DELETED';
export type ManagedTargetSnapshotType = 'PRE_DEPLOY' | 'POST_DEPLOY' | 'ROLLBACK_POINT' | 'POST_ROLLBACK' | 'ERROR_STATE';
export type DeploymentStrategyType = 'MANAGED_TARGET' | 'WORKFLOW';
export type WorkflowRunnerType = 'CONTROL_PLANE' | 'GATEWAY';
/** 应用资产配置始终解析当前发布版本；FIXED 仅用于读取历史计划快照。 */
export type WorkflowVersionSelection = 'CURRENT' | 'FIXED';
export type DeploymentStrategyCompatibilityMode = 'UNIFIED';
export type ManagedTargetExecutionMode = 'PLUGIN' | 'WORKFLOW_OVERRIDE';

export interface ManagementChannelDto {
  type: 'AGENT' | 'GATEWAY' | 'SSH' | 'WINRM' | 'MANUAL' | 'AGENTLESS' | string;
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
  pluginId?: string;
  /** 历史配置读取兼容字段，新资产不再写入。 */
  pluginVersionId?: string;
  capabilityKey?: string;
  workflowId?: string;
  workflowVersionSelection?: WorkflowVersionSelection;
  /** 历史配置读取兼容字段，新资产不再写入。 */
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
  /** 应用资产级审批开关；true 表示该应用的证书部署必须审批。 */
  approvalRequired?: boolean;
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
  assetId?: string;
  /** 标准插件资源的 ServiceAsset 所有者。 */
  serviceAssetId?: string;
  assetOwner?: AssetOwnerDto;
  /** 设备宿主；云资产宿主不设置该字段。 */
  deviceId?: string;
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
  /** 设备宿主和云资产宿主必须且只能提供一个。 */
  deviceId?: string;
  assetId?: string;
  serviceAssetId?: string;
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

export type UpdateFrameworkInstanceDto = Partial<CreateFrameworkInstanceDto>;

export interface ServiceAssetDto {
  id: string;
  tenantId: string;
  assetKind: ServiceAssetKind;
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
  /** 云服务统一资产的展示投影字段；来源分别是插件 Manifest、插件版本和发现事实。 */
  productFamily?: string;
  controlVersion?: string;
  pluginId?: string;
  pluginVersionId?: string;
  pluginRuntime?: string;
  apiVersion?: string;
  softwareVersion?: string;
  siteCount?: number;
  /** 保留旧列表合同，值与 siteCount 一致。 */
  applicationAssetCount?: number;
  deploymentStrategy?: DeploymentStrategyDto;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version: number;
  targetBinding?: ApplicationAssetTargetSummaryDto;
  /** 当前实际服务证书的脱敏展示投影，不包含证书材料或私钥引用。 */
  currentCertificate?: CurrentCertificateDto;
}

export interface CurrentCertificateDto {
  versionId?: string;
  certificateAssetId?: string;
  /** 当前绑定版本不是证书资产最新激活版本时为 true。 */
  updateAvailable?: boolean;
  commonName?: string;
  subject?: CertificateDistinguishedName;
  fingerprintSha256?: string;
  notBefore?: string;
  notAfter?: string;
  status?: string;
  verified?: boolean;
  observedAt?: string;
  source?: string;
}

export interface ConfiguredCertificateEvidenceDto {
  path?: string;
  source?: string;
  subject?: string;
  issuer?: string;
  fingerprintSha256?: string;
  notBefore?: string;
  notAfter?: string;
}

export interface ServiceAssetDetailDto extends ServiceAssetDto {
  targetBindingDetail?: ApplicationAssetTargetDetailDto;
  targetSnapshots?: ManagedTargetSnapshotDto[];
  linkageStatus?: Record<string, unknown>;
}

export interface CreateServiceAssetDto {
  address: string;
  assetKind?: ServiceAssetKind;
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
  /**
   * 创建 ServiceAsset 时的目标绑定输入。applicationAssetId 由宿主根据新建资产 ID 自动补入，
   * 调用方不得提前伪造该字段。
   */
  targetBinding?: CreateServiceAssetTargetBindingDto;
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
  assetId?: string;
  /** 已添加到应用列表的 ServiceAsset；仅存在该字段时才属于应用。 */
  serviceAssetId?: string;
  assetOwner?: AssetOwnerDto;
  frameworkInstanceId: string;
  /** 设备宿主；云资产宿主不设置该字段。 */
  deviceId?: string;
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
  /** 默认继承 FrameworkInstance 所有者；显式提供时必须匹配。 */
  deviceId?: string;
  assetId?: string;
  /** 可选的应用 ServiceAsset 关联，扫描站点本身不能自动创建应用。 */
  serviceAssetId?: string;
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
  assetId?: string;
  /** 已添加到应用列表的 ServiceAsset；仅存在该字段时才属于应用。 */
  serviceAssetId?: string;
  assetOwner?: AssetOwnerDto;
  /** 设备目标的宿主；云目标不绑定 Device。 */
  deviceId?: string;
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
  /** 受管设备当前绑定的插件版本，用于应用资产卡片展示插件 Logo。 */
  pluginVersionId?: string;
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
  >> & {
    configuredCertificate?: ConfiguredCertificateEvidenceDto;
  };
}

export interface CreateApplicationAssetTargetDto {
  applicationAssetId: string;
  managedTargetId: string;
  status?: ApplicationAssetTargetStatus;
  metadata?: Record<string, unknown>;
}

export type CreateServiceAssetTargetBindingDto = Omit<CreateApplicationAssetTargetDto, 'applicationAssetId'>;

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
  /** 设备目标或云资产目标的所有者，必须且只能提供一个。 */
  deviceId?: string;
  assetId?: string;
  /** 可选的应用 ServiceAsset 关联。 */
  serviceAssetId?: string;
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
  mode: 'direct';
  requestId: string;
  capabilitySnapshotId?: string;
  detail?: Record<string, unknown>;
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

export interface AssetOwnerDto {
  kind: 'HOST' | 'CLOUD_ACCOUNT' | 'SERVICE_ASSET';
  id: string;
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
