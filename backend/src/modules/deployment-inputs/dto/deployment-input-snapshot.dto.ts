import type { DeploymentAssetContextV1 } from './deployment-asset-context.dto.js';
import type { DeploymentInputIssueV1 } from './resolved-deployment-input.dto.js';
import type { ResolvedDeploymentInputV1 } from './resolved-deployment-input.dto.js';
import type { InputValueProvenanceV1 } from '../domain/deployment-input-provenance.js';
import type { EffectiveInputBindingV1 } from '../domain/deployment-input-provenance.js';
import type { DeploymentInputContractV1 } from './deployment-input-contract.dto.js';

export interface DeploymentInputSnapshotIdentityV1 {
  assignmentId?: string;
  pluginVersionId?: string;
  pluginBindingId?: string;
  workflowVersionId?: string;
  workflowExecutionBindingId?: string;
}

/** 插件能力兼容性在计划编译时冻结的证据，不携带敏感运行材料。 */
export interface PluginCompatibilitySnapshotV1 {
  capabilityKey: string;
  status: 'COMPATIBLE' | 'INCOMPATIBLE' | 'UNKNOWN';
  compatible: boolean;
  evaluatedAt: string;
  inputs: Record<string, unknown>;
  reasons: Array<Record<string, unknown>>;
  compatibilitySha256?: string;
}

export interface RedactedDeploymentInputV1 {
  assetContext: DeploymentAssetContextV1;
  variables: Record<string, unknown>;
  connections: Record<string, unknown>;
  credentials: Record<string, unknown>;
  artifacts: Record<string, unknown>;
}

export interface DeploymentInputSnapshotV1 {
  apiVersion: 'gcac.deployment-input-snapshot/v1';
  snapshotVersion: 1;
  resolvedAt: string;
  contractVersion: string;
  identity: DeploymentInputSnapshotIdentityV1;
  compatibility?: PluginCompatibilitySnapshotV1;
  input: RedactedDeploymentInputV1;
  sources: Record<string, InputValueProvenanceV1>;
  sensitivePaths: string[];
  issues: DeploymentInputIssueV1[];
  executable: boolean;
  resolvedSha256: string;
  redaction: {
    sensitivePathCount: number;
    genericRuleMatchCount: number;
  };
}

export interface DeploymentInputSnapshotEntity {
  id: string;
  tenantId: string;
  deploymentPlanId: string;
  deploymentPlanTargetId: string;
  revision: number;
  snapshot: DeploymentInputSnapshotV1;
  createdAt: string;
  createdBy: string;
}

export interface DeploymentInputSnapshotRefV1 {
  apiVersion: DeploymentInputSnapshotV1['apiVersion'];
  snapshotId: string;
  revision: number;
  resolvedSha256: string;
}

export interface DeploymentInputRuntimeSnapshotV1 {
  apiVersion: 'gcac.deployment-input-runtime-snapshot/v1';
  contract: DeploymentInputContractV1;
  effectiveBinding: EffectiveInputBindingV1;
  resolvedDeploymentInput: ResolvedDeploymentInputV1;
  deploymentArtifact: Record<string, unknown>;
  compatibility?: PluginCompatibilitySnapshotV1;
}
