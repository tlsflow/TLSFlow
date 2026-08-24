import type { DeploymentInputContractV1 } from '../../deployment-inputs/dto/deployment-input-contract.dto.js';

export type AgentPluginPlatform = 'WINDOWS' | 'LINUX';
export type AgentPluginStage = 'prepare' | 'backup' | 'install' | 'refresh' | 'verify' | 'rollback';

export interface AgentPluginCompatibility {
  platforms: AgentPluginPlatform[];
  frameworks?: string[];
  architectures?: string[];
  requiredCapabilities?: string[];
  operationSchemaVersions?: Record<string, string[]>;
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
  minGcacVersion?: string;
  metadata?: {
    displayName?: string;
    description?: string;
    logoUrl?: string;
    category?: string;
    tags?: string[];
    maintainer?: string;
    homepage?: string;
  };
  compatibility: AgentPluginCompatibility;
  inputContract: DeploymentInputContractV1;
  permissions: AgentPluginPermissionDeclaration[];
  operations: AgentPluginOperation[];
  rollback?: AgentPluginOperation[];
}

export type PluginCatalogActivationType = 'WORKFLOW_TEMPLATE';

export interface PluginCatalogActivationRecord {
  id: string;
  tenantId: string;
  catalogType: PluginCatalogActivationType;
  pluginId: string;
  status: 'enabled' | 'disabled';
  enabledAt?: string;
  updatedAt: string;
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
  executionMode: 'APPLY' | 'PREFLIGHT' | 'ROLLBACK';
  operations: ResolvedAgentAtomicOperation[];
  rollback: ResolvedAgentAtomicOperation[];
  authorization: {
    keyId: string;
    signature: string;
  };
}
