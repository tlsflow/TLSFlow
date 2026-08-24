export type UnifiedPluginRuntime = 'AGENT_ATOMIC' | 'WORKFLOW_DSL';
export type UnifiedPluginSource = 'BUILTIN' | 'USER';
export type UnifiedPluginScope = 'MANAGED' | 'STANDALONE' | 'BOTH';
export type UnifiedPluginTrust = 'OFFICIAL_SIGNED' | 'USER_SIGNED' | 'UNSIGNED';
export type UnifiedPluginSupport = 'OFFICIAL' | 'COMMUNITY' | 'SELF_MANAGED';
export type UnifiedPluginVersionStatus = 'IMPORTED' | 'PENDING_APPROVAL' | 'DISABLED' | 'ENABLED' | 'RETIRED' | 'QUARANTINED';

export interface UnifiedPluginCapabilityDescriptor {
  key: string;
  contractVersion: string;
  actionContractId: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  executionLocations: Array<'AGENT' | 'CONTROL_PLANE' | 'GATEWAY'>;
}

export interface UnifiedPluginManifestV1 {
  apiVersion: 'gcac.plugin-manifest/v1';
  kind: 'GcacPlugin';
  pluginId: string;
  version: string;
  displayNameKey: string;
  descriptionKey?: string;
  logoUrl?: string;
  defaultLocale?: string;
  publisher: string;
  runtime: UnifiedPluginRuntime;
  source: UnifiedPluginSource;
  scope: UnifiedPluginScope;
  trust: UnifiedPluginTrust;
  support: UnifiedPluginSupport;
  minGcacVersion?: string;
  capabilities: UnifiedPluginCapabilityDescriptor[];
  permissions: string[];
  compatibility?: {
    productFamilies?: string[];
    frameworkTypes?: string[];
    targetTypes?: string[];
    managementMethods?: Array<'AGENT' | 'PLUGIN' | 'MANUAL'>;
    executionLocations?: Array<'AGENT' | 'CONTROL_PLANE' | 'GATEWAY'>;
    artifactContracts?: string[];
  };
  resources: {
    workflows?: Record<string, string>;
    agentRecipes?: Record<string, string>;
    forms?: Record<string, string>;
    presentations?: Record<string, string>;
    locales?: Record<string, string>;
    discoveryMappings?: Record<string, string>;
  };
}

export interface UnifiedPluginVersionRecord {
  id: string;
  tenantId: string;
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
  tags: string[];
  platforms: string[];
  stepCount: number;
  rollbackCount: number;
  configuration?: {
    variables: Record<string, unknown>;
    artifactInputs: Record<string, unknown>;
    compatibility: Record<string, unknown>;
  };
  source: UnifiedPluginSource;
  runtime: UnifiedPluginRuntime;
  scope: UnifiedPluginScope;
  trust: UnifiedPluginTrust;
  support: UnifiedPluginSupport;
  status: UnifiedPluginVersionStatus;
  capabilities: UnifiedPluginCapabilityDescriptor[];
  compatibility: UnifiedPluginManifestV1['compatibility'];
  detailRef: { pluginVersionId: string };
}
