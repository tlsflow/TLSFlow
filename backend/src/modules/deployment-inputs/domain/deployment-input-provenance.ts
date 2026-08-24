import type { InputBindingsV1 } from '../dto/input-bindings.dto.js';

export type DeploymentBindingLayerV1 = 'DEVICE' | 'MANAGED_TARGET' | 'APPLICATION_ASSET' | 'EXECUTION';
export type DeploymentInputValueSourceV1 = 'asset' | 'binding' | 'default' | 'derived' | 'system' | 'step_output' | 'credential_snapshot' | 'artifact_snapshot';

export interface InputValueProvenanceV1 {
  source: DeploymentInputValueSourceV1;
  sourcePath?: string;
  bindingLayer?: DeploymentBindingLayerV1;
  deferred?: boolean;
}

export interface EffectiveInputBindingV1 {
  inputBindings: InputBindingsV1;
  provenance: Record<string, DeploymentBindingLayerV1>;
}
