export interface CertificateArtifactBindingV1 {
  certificateFormatId: string;
  outputBindings: Record<string, string>;
}

export interface PluginBindingV1 {
  id: string;
  tenantId: string;
  pluginVersionId: string;
  mode: 'MANAGED' | 'STANDALONE';
  variableBindings: Record<string, unknown>;
  credentialBindings: Record<string, { credentialId: string }>;
  secretBindings: Record<string, string>;
  certificateArtifactBindings: Record<string, CertificateArtifactBindingV1>;
  connectionBindings: Record<string, unknown>;
  managedContext?: {
    hostId: string;
    deviceAssetId?: string;
    agentId?: string;
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
  secrets: Record<string, { secretRef: string; purpose: string }>;
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
