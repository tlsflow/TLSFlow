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
  /** 中文说明：可选的固定插件版本；未提供时由宿主从已启用目录按 providerKey 解析。 */
  pluginVersionId?: string;
  accountId?: string;
  credentialRef: string;
  scope?: ProviderScope;
  metadata?: Record<string, unknown>;
  /** 中文说明：同一写入请求重试时重放原始结果，不重复创建资产。 */
  idempotencyKey?: string;
}

export interface UpdateCloudAccountAssetInput {
  /** 中文说明：并发更新必须基于调用方读取到的版本，避免覆盖其他操作者的修改。 */
  expectedVersion: number;
  displayName?: string;
  accountId?: string;
  credentialRef?: string;
  scope?: ProviderScope;
  status?: Exclude<ProviderAssetStatus, 'DELETED'>;
  metadata?: Record<string, unknown>;
  /** 中文说明：同一更新请求重试时重放原始结果，不重复推进版本。 */
  idempotencyKey?: string;
}
