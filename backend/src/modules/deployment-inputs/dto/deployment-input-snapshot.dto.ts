import type { DeploymentAssetContextV1 } from './deployment-asset-context.dto.js';
import type { DeploymentInputIssueV1 } from './resolved-deployment-input.dto.js';
import type { InputValueProvenanceV1 } from '../domain/deployment-input-provenance.js';

export interface DeploymentInputSnapshotIdentityV1 {
  assignmentId?: string;
  pluginVersionId?: string;
  pluginBindingId?: string;
  workflowVersionId?: string;
  workflowExecutionBindingId?: string;
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
