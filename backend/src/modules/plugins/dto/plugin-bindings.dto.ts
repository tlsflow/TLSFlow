import type { InputBindingsV1 } from '../../deployment-inputs/dto/input-bindings.dto.js';

export interface PluginBindingV1 {
  id: string;
  tenantId: string;
  /** 应用配置的稳定插件身份。 */
  pluginId?: string;
  /** 历史兼容字段；计划创建时不再用它决定运行版本。 */
  pluginVersionId: string;
  mode: 'MANAGED' | 'STANDALONE';
  inputBindings: InputBindingsV1;
  managedContext?: {
    hostId?: string;
    managedTargetId?: string;
    /** 标准 ServiceAsset 所有者；设备仍使用 hostId。 */
    serviceAssetId?: string;
    /** @deprecated 历史标准资产 Binding 字段，读取兼容；新流程必须写 serviceAssetId。 */
    assetId?: string;
    /** @deprecated 仅供历史云账号 Binding 读取，新的插件资产不得使用。 */
    cloudAccountAssetId?: string;
  };
  status: 'ACTIVE' | 'DISABLED' | 'MIGRATING' | 'ERROR';
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CapabilityAssignmentV1 {
  id: string;
  tenantId: string;
  ownerType: 'DEVICE' | 'MANAGED_TARGET' | 'APPLICATION_ASSET' | 'SERVICE_ASSET' | 'CLOUD_ACCOUNT_ASSET';
  ownerId: string;
  capabilityKey: string;
  /** 应用配置的稳定插件身份。 */
  pluginId?: string;
  /** 历史兼容字段；仅为旧记录读取保留。 */
  pluginVersionId: string;
  pluginBindingId: string;
  precedence: 'DEVICE_DEFAULT' | 'TARGET_OVERRIDE' | 'ASSET_OVERRIDE';
  status: 'ACTIVE' | 'DISABLED' | 'MIGRATING';
  createdAt: string;
  updatedAt: string;
}
