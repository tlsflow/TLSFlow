export type ProviderAssetStatus = 'ACTIVE' | 'DISABLED' | 'ERROR' | 'DELETED';

export interface ProviderScope {
  endpoint?: string;
  metadata?: Record<string, unknown>;
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
