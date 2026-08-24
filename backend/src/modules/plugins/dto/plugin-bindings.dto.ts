import type { InputBindingsV1 } from '../../deployment-inputs/dto/input-bindings.dto.js';

export interface PluginBindingV1 {
  id: string;
  tenantId: string;
  pluginVersionId: string;
  mode: 'MANAGED' | 'STANDALONE';
  inputBindings: InputBindingsV1;
  managedContext?: {
    hostId: string;
    managedTargetId?: string;
  };
  status: 'ACTIVE' | 'DISABLED' | 'MIGRATING' | 'ERROR';
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CapabilityAssignmentV1 {
  id: string;
  tenantId: string;
  ownerType: 'DEVICE' | 'MANAGED_TARGET' | 'APPLICATION_ASSET';
  ownerId: string;
  capabilityKey: string;
  pluginVersionId: string;
  pluginBindingId: string;
  precedence: 'DEVICE_DEFAULT' | 'TARGET_OVERRIDE' | 'ASSET_OVERRIDE';
  status: 'ACTIVE' | 'DISABLED' | 'MIGRATING';
  createdAt: string;
  updatedAt: string;
}

export interface NormalizedPluginRuntimeInput {
  pluginVersionId: string;
  mode: PluginBindingV1['mode'];
  capabilityKey: string;
  executionLocation: 'AGENT' | 'CONTROL_PLANE' | 'GATEWAY';
  connections: Record<string, unknown>;
  variables: Record<string, unknown>;
  credentials: Record<string, { credentialId: string }>;
  certificateMaterials: Record<string, CertificateMaterialDescriptor>;
  target: Record<string, unknown>;
  normalizedSha256: string;
}

export interface CertificateMaterialDescriptor {
  certificateVersionId: string;
  certificateFormatId: string;
  format: string;
  outputs: Record<string, { artifactRef: string; sha256: string; size: number; sensitive: boolean }>;
}
