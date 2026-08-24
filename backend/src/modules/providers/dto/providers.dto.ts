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
  /** 中文说明：由投影表统计当前可用区设备、Framework 和 Site 数量，便于云服务列表直接展示拓扑规模。 */
  deviceCount?: number;
  frameworkCount?: number;
  siteCount?: number;
}

export interface CreateCloudAccountAssetInput {
  displayName: string;
  providerKey: string;
  /** 中文说明：历史兼容字段；云账号创建和运行均忽略它，动作始终使用最新已启用插件版本。 */
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
