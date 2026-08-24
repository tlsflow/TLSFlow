export type AgentPluginPlatform = 'WINDOWS' | 'LINUX';
export type AgentPluginStage = 'prepare' | 'backup' | 'install' | 'refresh' | 'verify' | 'rollback';
export type AgentPluginMountStatus = 'PENDING_SYNC' | 'MOUNTED' | 'INCOMPATIBLE' | 'PENDING_APPROVAL' | 'DISABLED';

export type ExecutionVariableType = 'string' | 'number' | 'boolean' | 'enum' | 'object' | 'file' | 'certificate' | 'credential';

export interface ExecutionVariableDefinition {
  type: ExecutionVariableType;
  required?: boolean;
  description?: string;
  default?: unknown;
  enum?: string[];
  pattern?: string;
  minimum?: number;
  maximum?: number;
  editableScope?: 'ASSET' | 'EXECUTION';
  sensitive?: boolean;
}

export interface AgentPluginCompatibility {
  platforms: AgentPluginPlatform[];
  frameworks?: string[];
  architectures?: string[];
  requiredCapabilities?: string[];
  operationSchemaVersions?: Record<string, string[]>;
}

export interface AgentPluginArtifactInput {
  type: 'certificate' | 'private_key' | 'certificate_chain' | 'bundle' | 'file';
  required?: boolean;
  description?: string;
}

export interface AgentPluginPermissionDeclaration {
  name: string;
  description?: string;
  risk: 'low' | 'medium' | 'high';
  scope: 'filesystem' | 'process' | 'service' | 'network' | 'secret' | 'shell' | 'certificate_store' | 'iis';
  values: string[];
}

export interface AgentPluginOperation {
  id: string;
  name: string;
  stage: AgentPluginStage;
  operationType:
    | 'preflight.assert'
    | 'file.backup'
    | 'file.atomic_replace'
    | 'file.restore'
    | 'file.set_permissions'
    | 'command.execute'
    | 'service.control'
    | 'tls.verify'
    | 'windows.certificate.inspect_pfx'
    | 'windows.certificate_store.import_pfx'
    | 'windows.certificate_private_key.grant'
    | 'windows.iis.binding.capture'
    | 'windows.iis.binding.update_certificate'
    | 'windows.iis.binding.restore_certificate';
  schemaVersion: '1.0';
  timeoutSeconds?: number;
  continueOnError?: boolean;
  dependsOn?: string[];
  input: Record<string, unknown>;
}

export interface AgentDeploymentPluginManifestV1 {
  apiVersion: 'gcac.agent-plugin/v1';
  kind: 'AgentDeploymentPlugin';
  pluginId: string;
  name: string;
  publisher: string;
  version: string;
  metadata?: {
    displayName?: string;
    description?: string;
    category?: string;
    tags?: string[];
    maintainer?: string;
    homepage?: string;
  };
  compatibility: AgentPluginCompatibility;
  variables: Record<string, ExecutionVariableDefinition>;
  artifactInputs: Record<string, AgentPluginArtifactInput>;
  permissions: AgentPluginPermissionDeclaration[];
  operations: AgentPluginOperation[];
  rollback?: AgentPluginOperation[];
}

export interface AgentPluginPackageRecord {
  id: string;
  tenantId: string;
  manifest: AgentDeploymentPluginManifestV1;
  packageHash: string;
  expectedHash?: string;
  signature?: string;
  signatureStatus: 'trusted' | 'untrusted' | 'missing' | 'invalid';
  installStatus: 'pending_approval' | 'installed_disabled' | 'enabled' | 'disabled' | 'quarantined';
  permissionApprovalStatus: 'not_required' | 'pending' | 'approved' | 'rejected';
  approvedPermissions: string[];
  storageKey: string;
  uploadedAt: string;
  updatedAt: string;
  catalogEnabled?: boolean;
}

export type PluginCatalogActivationType = 'WORKFLOW_TEMPLATE' | 'AGENT_DEPLOYMENT';

export interface PluginCatalogActivationRecord {
  id: string;
  tenantId: string;
  catalogType: PluginCatalogActivationType;
  pluginId: string;
  status: 'enabled' | 'disabled';
  enabledAt?: string;
  updatedAt: string;
}

export interface AgentPluginPackageUploadInput {
  manifest: AgentDeploymentPluginManifestV1;
  packageContent: string;
  expectedHash?: string;
  signature?: string;
}

export interface AgentPluginMount {
  id: string;
  tenantId: string;
  agentId: string;
  pluginPackageId: string;
  pluginVersionId: string;
  packageHash: string;
  status: AgentPluginMountStatus;
  compatibilitySnapshot: Record<string, unknown>;
  permissionSnapshot: Record<string, unknown>;
  mountedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentPluginMountInput {
  agentId: string;
  pluginPackageId: string;
}

export interface PluginCatalogItem {
  id: string;
  catalogType: 'WORKFLOW_TEMPLATE' | 'AGENT_DEPLOYMENT';
  source: 'BUILTIN' | 'USER' | 'PACKAGE';
  name: string;
  displayName?: string;
  description?: string;
  version?: string;
  status: string;
  platforms: AgentPluginPlatform[];
  tags: string[];
  updatedAt: string;
  detailRef: {
    workflowFileTemplateId?: string;
    pluginPackageId?: string;
    pluginVersionId?: string;
  };
}

export interface AgentPluginBindingInput {
  mountId?: string;
  pluginPackageId: string;
  pluginVersionId: string;
  variableBindings: Record<string, unknown>;
  secretBindings: Record<string, string>;
  certificateArtifactBindings: Record<string, {
    certificateFormatId: string;
    outputBindings: Record<string, string>;
  }>;
}

export interface ResolvedAgentAtomicOperation extends AgentPluginOperation {
  input: Record<string, unknown>;
}

export interface AgentAtomicExecutionPlanV1 {
  apiVersion: 'gcac.agent-plan/v1';
  planId: string;
  tenantId: string;
  agentId: string;
  executionRunId: string;
  executionStepId: string;
  plugin: {
    pluginPackageId: string;
    pluginVersionId: string;
    packageHash: string;
    manifestHash: string;
  };
  issuedAt: string;
  expiresAt: string;
  idempotencyKey: string;
  permissions: AgentPluginPermissionDeclaration[];
  variablesDigest: string;
  operations: ResolvedAgentAtomicOperation[];
  rollback: ResolvedAgentAtomicOperation[];
  authorization: {
    keyId: string;
    signature: string;
  };
}
