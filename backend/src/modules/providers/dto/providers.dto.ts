export type ProviderSignerType = 'SDK' | 'HMAC' | 'V4' | 'CUSTOM';
export type ProviderExecutionLocation = 'CONTROL_PLANE' | 'GATEWAY';
export type ProviderRollbackMode = 'AUTOMATIC' | 'MANUAL_REQUIRED' | 'UNSUPPORTED';
export type ProviderAssetStatus = 'ACTIVE' | 'DISABLED' | 'ERROR' | 'DELETED';

export interface ProviderScope {
  regions?: string[];
  projectId?: string;
  resourceGroupId?: string;
  enterpriseProjectId?: string;
  availabilityZone?: string;
  endpoint?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderDefinition {
  providerKey: string;
  displayNameKey: string;
  capabilityPluginId: string;
  providerExtensionKey: string;
  providerExtensionVersion: string;
  supportedProducts: string[];
  supportedOperations: string[];
  credentialSchemaId: string;
  scopeSchemaId: string;
  executionLocations: ProviderExecutionLocation[];
  signerType: ProviderSignerType;
  contractVersion: string;
}

export interface ProviderCapabilityPlugin {
  capabilityPluginId: string;
  version: string;
  providerKey: string;
  frameworkType: string;
  operationKey: string;
  displayNameKey: string;
  inputSchemaId: string;
  outputSchemaId: string;
  executionLocations: ProviderExecutionLocation[];
  rollbackMode: ProviderRollbackMode;
  requiredPermissions: string[];
  enabled: boolean;
}

export interface ProviderTargetRef {
  frameworkType: string;
  resourceId: string;
  domain?: string;
  listenerId?: string;
  certificateId?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderExtensionDescriptor {
  extensionKey: string;
  providerKey: string;
  version: string;
  signerType: ProviderSignerType;
  supportedFrameworkTypes: string[];
  supportedOperations: string[];
  trusted: true;
}

export interface CloudAccountAsset {
  id: string;
  tenantId: string;
  assetKind: 'cloud.account';
  providerKey: string;
  displayName: string;
  accountId?: string;
  credentialRef: string;
  scope: ProviderScope;
  status: ProviderAssetStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version: number;
}

export interface CreateCloudAccountAssetInput {
  displayName: string;
  providerKey: string;
  accountId?: string;
  credentialRef: string;
  scope?: ProviderScope;
  metadata?: Record<string, unknown>;
}

export interface UpdateCloudAccountAssetInput {
  displayName?: string;
  accountId?: string;
  credentialRef?: string;
  scope?: ProviderScope;
  status?: Exclude<ProviderAssetStatus, 'DELETED'>;
  metadata?: Record<string, unknown>;
}

export interface ProviderOperationResult {
  operationId: string;
  providerKey: string;
  operationKey: string;
  status: 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'MANUAL_REQUIRED';
  resourceRef?: Record<string, string>;
  asyncOperation?: {
    taskId: string;
    status: string;
  };
  resultSummary?: Record<string, unknown>;
}
