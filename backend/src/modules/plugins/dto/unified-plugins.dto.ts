export type UnifiedPluginRuntime = 'AGENT_PLAN' | 'WORKFLOW_DSL';
export type UnifiedPluginSource = 'BUILTIN' | 'USER';
export type UnifiedPluginScope = 'MANAGED' | 'STANDALONE' | 'BOTH';
export type UnifiedPluginTrust = 'OFFICIAL_SIGNED' | 'USER_SIGNED' | 'UNSIGNED';
export type UnifiedPluginSupport = 'OFFICIAL' | 'COMMUNITY' | 'SELF_MANAGED';
export type UnifiedPluginVersionStatus = 'IMPORTED' | 'PENDING_APPROVAL' | 'DISABLED' | 'ENABLED' | 'RETIRED' | 'QUARANTINED';

export type UnifiedPluginExecutionLocation = 'AGENT' | 'CONTROL_PLANE' | 'GATEWAY';

export interface UnifiedPluginCapabilityHostCompatibility {
  minVersion?: string;
  requiredFeatures?: string[];
}

export interface UnifiedPluginCapabilityTargetCompatibility {
  productFamily: string;
  versionRange: string;
}

export interface UnifiedPluginCapabilityExecutionCompatibility {
  location: UnifiedPluginExecutionLocation;
  minRuntimeVersion?: string;
}

export interface UnifiedPluginCapabilityCompatibility {
  host?: UnifiedPluginCapabilityHostCompatibility;
  targets?: UnifiedPluginCapabilityTargetCompatibility[];
  execution?: UnifiedPluginCapabilityExecutionCompatibility[];
  /** 仅用于记录验证证据，不能作为兼容范围。 */
  testedVersions?: Record<string, string[]>;
}

export interface UnifiedPluginCapabilityDescriptor {
  key: string;
  contractVersion: string;
  actionContractId: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  executionLocations: UnifiedPluginExecutionLocation[];
  compatibility?: UnifiedPluginCapabilityCompatibility;
}

export interface CredentialOutputParameterContract {
  secretType: 'password' | 'api_token' | 'session_id' | 'ssh_key' | 'private_key' | 'certificate_private_key';
  required: boolean;
  delivery: {
    location: 'header' | 'query' | 'cookie' | 'local_storage' | 'session_storage';
    name: string;
  };
}

export interface CredentialOutputContract {
  version: string;
  parameters: Record<string, CredentialOutputParameterContract>;
}

export interface CredentialAcquireContract {
  inputContractVersion: string;
  loginUrl: string;
  allowedOrigins: string[];
  output: CredentialOutputContract;
}

/**
 * 插件接入配方的 Manifest 资源索引。
 * 配方正文仍存放在插件包资源中，Manifest 只声明稳定的资源路径。
 */
export interface UnifiedPluginOnboardingResources {
  /** 主接入配方。保留该字段以兼容已发布插件。 */
  applicationAsset?: string;
  /** 同一插件版本可声明多个相互独立的接入配方。 */
  applicationAssets?: Record<string, string>;
  /** 云账号统一接入配方，供资产中心和统一服务向导共用。 */
  cloudAccount?: string;
}

export interface UnifiedPluginLogoResources {
  /** 横向 Logo，固定为 72 x 48 SVG 资源。 */
  horizontal: string;
  /** 方形 Logo，固定为 72 x 72 SVG 资源。 */
  square: string;
}

export interface UnifiedPluginManifestV1 {
  apiVersion: 'gcac.plugin-manifest/v1';
  kind: 'GcacPlugin';
  pluginId: string;
  version: string;
  displayNameKey: string;
  descriptionKey?: string;
  /** 旧版本数据库 Manifest 的兼容读取字段，新插件包不得继续声明。 */
  logoUrl?: string;
  /** 旧版本数据库 Manifest 的兼容读取字段，新插件包不得继续声明。 */
  logoSquareUrl?: string;
  defaultLocale?: string;
  publisher: string;
  runtime: UnifiedPluginRuntime;
  source: UnifiedPluginSource;
  scope: UnifiedPluginScope;
  trust: UnifiedPluginTrust;
  support: UnifiedPluginSupport;
  minGcacVersion?: string;
  capabilities: UnifiedPluginCapabilityDescriptor[];
  credentialAcquire?: CredentialAcquireContract;
  permissions: string[];
  compatibility?: {
    productFamilies?: string[];
    frameworkTypes?: string[];
    targetTypes?: string[];
    managementMethods?: Array<'AGENT' | 'PLUGIN' | 'MANUAL'>;
    executionLocations?: UnifiedPluginExecutionLocation[];
    artifactContracts?: string[];
    /** Provider 通过插件声明的控制面地址，宿主不按厂商写死 endpoint。 */
    serviceEndpoints?: string[];
  };
  resources: {
    /** 插件包自有 Logo 资源，不允许指向宿主静态目录或外部 URL。 */
    logos?: UnifiedPluginLogoResources;
    /** Manifest 固定的 Runner 执行入口；宿主只保存路径和摘要，不在宿主进程加载。 */
    runtimeEntrypoint?: string;
    agentPlans?: Record<string, string>;
    workflows?: Record<string, string>;
    /** 普通 Workflow 与 Agent Plan 共用的不可变输入合同资源。 */
    inputContracts?: Record<string, string>;
    actionContracts?: Record<string, string>;
    credentialContracts?: Record<string, string>;
    forms?: Record<string, string>;
    presentations?: Record<string, string>;
    locales?: Record<string, string>;
    discoveryMappings?: Record<string, string>;
    agentDiscoveryMappings?: Record<string, string>;
    onboarding?: UnifiedPluginOnboardingResources;
  };
}

export interface UnifiedPluginVersionRecord {
  id: string;
  tenantId: string;
  /** 历史测试和旧缓存可能没有该字段，仓储读取时会按 source 归一化。 */
  ownerType?: 'SYSTEM' | 'TENANT';
  ownerId?: string;
  pluginId: string;
  version: string;
  source: UnifiedPluginSource;
  runtime: UnifiedPluginRuntime;
  scope: UnifiedPluginScope;
  trust: UnifiedPluginTrust;
  support: UnifiedPluginSupport;
  manifest: UnifiedPluginManifestV1;
  packageSha256: string;
  manifestSha256: string;
  resourceSha256: Record<string, string>;
  resources: Record<string, string>;
  status: UnifiedPluginVersionStatus;
  permissionApprovalStatus: 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED';
  approvedPermissions: string[];
  validationReport: UnifiedPluginValidationReport;
  createdAt: string;
  updatedAt: string;
}

export interface UnifiedPluginValidationReport {
  valid: boolean;
  errors: Array<{ code: string; path: string; message: string }>;
  warnings: Array<{ code: string; path: string; message: string }>;
  manifestSha256: string;
  resourceSha256: Record<string, string>;
}

export interface ImportUnifiedPluginVersionInput {
  manifest: unknown;
  resources?: Record<string, string>;
  packageContent?: string;
}

export interface UnifiedPluginUpgradeDiff {
  pluginId: string;
  fromVersionId: string;
  toVersionId: string;
  addedCapabilities: string[];
  removedCapabilities: string[];
  addedPermissions: string[];
  removedPermissions: string[];
  runtimeChanged: boolean;
  scopeChanged: boolean;
  compatibilityChanged: boolean;
  capabilityCompatibilityChanges?: Array<{
    capabilityKey: string;
    changed: boolean;
    breaking: boolean;
    reason?: string;
  }>;
  bindingRecheckRequired?: boolean;
  requiresApproval: boolean;
}

export interface UnifiedPluginCatalogItem {
  id: string;
  catalogType: 'UNIFIED_PLUGIN';
  pluginId: string;
  pluginVersionId: string;
  version: string;
  name: string;
  displayNameKey: string;
  descriptionKey?: string;
  displayName?: string;
  description?: string;
  logoUrl?: string;
  logoSquareUrl?: string;
  tags: string[];
  platforms: string[];
  stepCount: number;
  rollbackCount: number;
  configuration?: {
    variables: Record<string, unknown>;
    artifacts: Record<string, unknown>;
    compatibility: Record<string, unknown>;
  };
  source: UnifiedPluginSource;
  runtime: UnifiedPluginRuntime;
  scope: UnifiedPluginScope;
  trust: UnifiedPluginTrust;
  support: UnifiedPluginSupport;
  packageSha256: string;
  manifestSha256: string;
  resourceSha256: Record<string, string>;
  status: UnifiedPluginVersionStatus;
  capabilities: UnifiedPluginCapabilityDescriptor[];
  compatibility: UnifiedPluginManifestV1['compatibility'];
  detailRef: { pluginVersionId: string };
}

export interface UnifiedPluginReferenceCounts {
  bindings: number;
  assignments: number;
  hosts: number;
  serviceAssets: number;
  deviceAssets: number;
  total: number;
}

export interface UnifiedPluginWorkflowVersionSummary {
  capabilityKey: string;
  workflowKey: string;
  workflowResourcePath: string;
  workflowTemplateId: string;
  workflowVersionId: string;
  workflowContentSha256: string;
}

export interface UnifiedPluginVersionSummary {
  id: string;
  pluginId: string;
  version: string;
  source: UnifiedPluginSource;
  runtime: UnifiedPluginRuntime;
  scope: UnifiedPluginScope;
  status: UnifiedPluginVersionStatus;
  packageSha256: string;
  manifestSha256: string;
  resourceSha256: Record<string, string>;
  workflowVersions: UnifiedPluginWorkflowVersionSummary[];
  references: UnifiedPluginReferenceCounts;
  switchable: boolean;
}

export interface UnifiedPluginVersionGroup {
  pluginId: string;
  source: 'BUILTIN' | 'USER' | 'MIXED';
  activeVersionId?: string;
  versions: UnifiedPluginVersionSummary[];
}

export interface UnifiedPluginVersionManagementDetail extends UnifiedPluginVersionSummary {
  tenantId: string;
  ownerType?: 'SYSTEM' | 'TENANT';
  ownerId?: string;
  trust: UnifiedPluginTrust;
  support: UnifiedPluginSupport;
  manifest: UnifiedPluginManifestV1;
  validationReport: UnifiedPluginValidationReport;
  visibleToTenant: boolean;
}

export interface SwitchUnifiedPluginVersionInput {
  pluginId: string;
  targetPluginVersionId: string;
  expectedCurrentPluginVersionId?: string;
}

export interface SwitchUnifiedPluginVersionResult {
  pluginId: string;
  fromPluginVersionId: string;
  toPluginVersionId: string;
  changed: Pick<UnifiedPluginReferenceCounts, 'bindings' | 'assignments' | 'hosts' | 'serviceAssets' | 'deviceAssets'>;
  switchedAt: string;
}
