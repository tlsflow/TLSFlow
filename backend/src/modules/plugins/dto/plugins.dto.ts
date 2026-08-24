export type PluginRuntimeType = 'process' | 'container' | 'wasm' | 'http';

export type PluginInstallStatus =
  | 'uploaded'
  | 'metadata_validated'
  | 'pending_approval'
  | 'installed_disabled'
  | 'enabled'
  | 'disabled'
  | 'quarantined';

export type PluginSignatureStatus = 'trusted' | 'untrusted' | 'missing' | 'invalid';

export type PluginPermissionRisk = 'low' | 'medium' | 'high';

export type PluginPermissionApprovalStatus = 'not_required' | 'pending' | 'approved' | 'rejected';

export interface PluginRuntimeDescriptor {
  type: PluginRuntimeType;
  entry: string;
  timeoutSeconds: number;
  allowedCommands?: string[];
  container?: {
    image: string;
    readonlyRootFs?: boolean;
  };
  wasm?: {
    module: string;
  };
  http?: {
    endpoint: string;
    method?: 'GET' | 'POST';
  };
}

export interface PluginCapabilityDeclaration {
  key: string;
  type?: string;
  level: string;
  riskLevel?: PluginPermissionRisk;
  requires?: string[];
  os?: string[];
}

export interface PluginActionDeclaration {
  name: string;
  command?: string;
  requiredPermissions?: string[];
  requiredSecretScopes?: string[];
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface PluginPermissionDeclaration {
  name: string;
  description?: string;
  risk: PluginPermissionRisk;
  scope: 'network' | 'filesystem' | 'secret' | 'platform_api' | 'process';
  values: string[];
}

export interface PluginPackageManifest {
  apiVersion: 'gcac.plugin/v1';
  kind: 'Plugin';
  pluginId: string;
  name: string;
  publisher: string;
  version: string;
  minGcacVersion?: string;
  runtime: PluginRuntimeDescriptor;
  actions: PluginActionDeclaration[];
  permissions: PluginPermissionDeclaration[];
  capabilities: PluginCapabilityDeclaration[];
  metadata?: Record<string, unknown>;
}

export interface PluginPackageRecord {
  id: string;
  tenantId: string;
  manifest: PluginPackageManifest;
  packageHash: string;
  expectedHash?: string;
  signature?: string;
  signatureStatus: PluginSignatureStatus;
  installStatus: PluginInstallStatus;
  permissionApprovalStatus: PluginPermissionApprovalStatus;
  approvedPermissions: string[];
  storageKey: string;
  uploadedAt: string;
  updatedAt: string;
}

export interface PluginPackageUploadInput {
  manifest: PluginPackageManifest;
  packageContent: string;
  expectedHash?: string;
  signature?: string;
}

export interface PluginPermissionApprovalInput {
  pluginPackageId: string;
  approvedBy: string;
  approvedPermissions: string[];
}

export interface PluginEnableInput {
  pluginPackageId: string;
}

export interface PluginExecutionRequest {
  pluginPackageId: string;
  action: string;
  command: string;
  input?: Record<string, unknown>;
  timeoutSeconds?: number;
  secretRefs?: string[];
  allowedSecretRefs?: string[];
  mockStdout?: string;
  mockStderr?: string;
}

export interface PluginExecutionResult {
  executionId: string;
  pluginPackageId: string;
  action: string;
  runtimeType: PluginRuntimeType;
  status: 'success' | 'failed' | 'timeout';
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string;
  redactionMatches: number;
  errorCode?: string;
  runtimeDescriptor?: PluginRuntimeDescriptor;
}

export interface PluginStepDraft {
  stepType: 'plugin';
  pluginPackageId: string;
  action: string;
  requiredPermissions: string[];
  requiredSecretScopes: string[];
  runtimeType: PluginRuntimeType;
  timeoutSeconds: number;
}

export interface PluginPermissionSummary {
  pluginPackageId: string;
  approvalStatus: PluginPermissionApprovalStatus;
  highRiskPermissions: string[];
  declaredPermissions: PluginPermissionDeclaration[];
  canEnable: boolean;
}
