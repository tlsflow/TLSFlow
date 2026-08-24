import type { DeploymentAssetContextV1 } from './deployment-asset-context.dto.js';
import type { DeploymentInputContractV1 } from './deployment-input-contract.dto.js';
import type { InputBindingsV1 } from './input-bindings.dto.js';
import type { CredentialDelivery, CredentialKind } from '../../../persistence/entities/credential-profile.entity.js';
import type { EffectiveInputBindingV1, InputValueProvenanceV1 } from '../domain/deployment-input-provenance.js';

export type ResolveDeploymentInputPhase = 'configure' | 'save' | 'preflight' | 'execute';

export interface RuntimeCredentialV1 {
  credentialId: string;
  credentialVersionId?: string;
  kind?: CredentialKind;
  username?: string;
  delivery?: CredentialDelivery;
  secretRefs?: Record<string, string>;
  [key: string]: unknown;
}

export interface ResolvedArtifactV1 {
  artifactId?: string;
  outputs: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ResolvedConnectionV1 {
  transport: 'http' | 'ssh';
  host?: string;
  port?: number;
  username?: string;
  credentialSlot?: string;
  tls?: {
    verifyPeer?: boolean;
    serverName?: string;
  };
  hostKey?: {
    policy: 'strict' | 'trust_on_first_use' | 'manual_approval_required';
    expectedFingerprint?: string;
  };
}

export interface DeploymentInputIssueV1 {
  category: 'CONTRACT' | 'ASSET' | 'VARIABLE' | 'CONNECTION' | 'CREDENTIAL' | 'ARTIFACT' | 'VERSION' | 'DOMAIN' | 'EXECUTION_LOCATION';
  code: string;
  severity: 'ERROR' | 'WARNING';
  slot?: string;
  path?: string;
  bindingLayer?: 'DEVICE' | 'MANAGED_TARGET' | 'APPLICATION_ASSET' | 'EXECUTION';
  messageKey: string;
  params?: Record<string, string | number>;
}

export interface ResolveDeploymentInputRequest {
  phase: ResolveDeploymentInputPhase;
  contract: DeploymentInputContractV1;
  assetContext: DeploymentAssetContextV1;
  effectiveBinding: EffectiveInputBindingV1;
  executionOverrides?: InputBindingsV1;
  credentialSnapshots?: Record<string, RuntimeCredentialV1>;
  artifactSnapshots?: Record<string, ResolvedArtifactV1>;
  systemValues?: Record<string, unknown>;
  stepOutputs?: Record<string, unknown>;
}

export interface ResolvedDeploymentInputV1 {
  apiVersion: 'gcac.resolved-deployment-input/v1';
  contractVersion: DeploymentInputContractV1['apiVersion'];
  assetContext: DeploymentAssetContextV1;
  variables: Record<string, unknown>;
  connections: Record<string, ResolvedConnectionV1>;
  credentials: Record<string, RuntimeCredentialV1>;
  artifacts: Record<string, ResolvedArtifactV1>;
  provenance: Record<string, InputValueProvenanceV1>;
  sensitivePaths: string[];
  issues: DeploymentInputIssueV1[];
  executable: boolean;
  resolvedSha256: string;
}
