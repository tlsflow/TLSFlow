import type { DeploymentInputContractV1, DeploymentInputUiDefinitionV1, DeploymentVariableSourceV1 } from './deployment-input-contract.dto.js';
import type { DeploymentInputIssueV1, ResolvedDeploymentInputV1 } from './resolved-deployment-input.dto.js';
import type { EffectiveInputBindingV1 } from '../domain/deployment-input-provenance.js';

export interface DeploymentInputFieldProjectionV1 {
  slot: string;
  type: string;
  required: boolean;
  configurationMode: 'required' | 'advanced' | 'runtime';
  bindingPolicy: 'fixed' | 'default_overridable' | 'required_binding';
  source: DeploymentVariableSourceV1;
  default?: unknown;
  enum?: unknown[];
  sensitive?: boolean;
  descriptionKey?: string;
  ui?: DeploymentInputUiDefinitionV1;
  value?: unknown;
}

export interface DeploymentConnectionProjectionV1 {
  slot: string;
  transport: 'http' | 'ssh';
  credentialSlot?: string;
  fields: Record<string, DeploymentInputFieldProjectionV1>;
  descriptionKey?: string;
  ui?: DeploymentInputUiDefinitionV1;
}

export interface DeploymentCredentialProjectionV1 {
  slot: string;
  allowedKinds: string[];
  required: boolean;
  configurationMode: 'required' | 'advanced';
  selectedCredentialId?: string;
  descriptionKey?: string;
  ui?: DeploymentInputUiDefinitionV1;
}

export interface DeploymentArtifactProjectionV1 {
  slot: string;
  kind: 'certificate' | 'file';
  required: boolean;
  configurationMode: 'required' | 'advanced';
  outputs: Record<string, { role: string; required: boolean; format?: string; encoding?: string; sensitive?: boolean; descriptionKey?: string }>;
  binding?: { certificateFormatId?: string; outputBindings: Record<string, string> };
  descriptionKey?: string;
  ui?: DeploymentInputUiDefinitionV1;
}

export interface DeploymentFixedValueProjectionV1 {
  slot: string;
  value: unknown;
  source: DeploymentInputContractV1['variables'][string]['source'];
}

export interface DeploymentRuntimeValueProjectionV1 {
  slot: string;
  source: DeploymentInputContractV1['variables'][string]['source'];
  lifecycle: 'runtime_injected' | 'step_output';
}

export interface DeploymentInputProjectionV1 {
  contractVersion: string;
  requiredVariables: DeploymentInputFieldProjectionV1[];
  advancedVariables: DeploymentInputFieldProjectionV1[];
  connections: DeploymentConnectionProjectionV1[];
  credentials: DeploymentCredentialProjectionV1[];
  artifacts: DeploymentArtifactProjectionV1[];
  fixedValues: DeploymentFixedValueProjectionV1[];
  runtimeValues: DeploymentRuntimeValueProjectionV1[];
  issues: DeploymentInputIssueV1[];
  saveable: boolean;
}

export interface BuildDeploymentInputProjectionRequest {
  contract: DeploymentInputContractV1;
  resolvedInput: ResolvedDeploymentInputV1;
  effectiveBinding?: EffectiveInputBindingV1;
}
