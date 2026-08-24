import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { emptyInputBindingsV1 } from '../../deployment-inputs/dto/input-bindings.dto.js';
import { PluginBindingsApplicationService } from '../../plugins/application/plugin-bindings.application-service.js';
import type { UnifiedPluginsApplicationService } from '../../plugins/application/unified-plugins.application-service.js';
import { PluginBindingsRepository } from '../../plugins/repository/plugin-bindings.repository.js';
import type { CloudAccountAsset } from '../dto/providers.dto.js';
import type {
  CloudAccountAssetBindingProvisionInput,
  CloudAccountAssetBindingProvisionerContract,
} from './cloud-account-assets.application-service.js';

const cloudCapabilityKeys = [
  'cloud.service.connection-test',
  'cloud.service.discover',
] as const;

/**
 * 中文说明：资产创建时生成历史兼容用的输入绑定和 CapabilityAssignment。
 * 云账号运行时不会读取这些固定版本记录，而是按 Provider 解析最新已启用插件。
 */
export class CloudAccountAssetBindingProvisioner implements CloudAccountAssetBindingProvisionerContract {
  constructor(
    private readonly plugins: Pick<UnifiedPluginsApplicationService, 'listCatalog' | 'getVersionForTenant'>,
  ) {}

  async prepare(
    input: Pick<CloudAccountAssetBindingProvisionInput, 'tenantId' | 'asset'>,
  ): Promise<PreparedCloudAccountAssetBinding> {
    const version = await this.resolveVersion(input.tenantId, input.asset.providerKey);
    if (version.status !== 'ENABLED') {
      throw new AppError('PLUGIN_CAPABILITY_EXECUTION_FAILED', 'Cloud Provider 插件版本未启用', {
        pluginVersionId: version.id,
        status: version.status,
      });
    }
    if (version.pluginId !== input.asset.providerKey) {
      throw new AppError('VALIDATION_FAILED', 'CloudAccountAsset providerKey 与插件 Manifest 不一致', {
        providerKey: input.asset.providerKey,
        pluginId: version.pluginId,
        pluginVersionId: version.id,
      });
    }
    const capabilityKeys = cloudCapabilityKeys.filter((key) => version.manifest.capabilities.some((item) => item.key === key));
    if (!capabilityKeys.includes('cloud.service.connection-test')) {
      throw new AppError('VALIDATION_FAILED', 'Cloud Provider 插件必须声明连接测试 Capability', {
        pluginVersionId: version.id,
      });
    }
    return { pluginVersionId: version.id, capabilityKeys: [...capabilityKeys] };
  }

  async provision(
    tx: DatabasePort,
    input: CloudAccountAssetBindingProvisionInput,
  ): Promise<{ pluginVersionId: string; pluginBindingId: string; capabilityKeys: string[] }> {
    const prepared = readPrepared(input.prepared);
    const capabilityKeys = prepared.capabilityKeys;

    const credentialId = parseCredentialId(input.asset.credentialRef);
    const credentials = await this.resolveCredentialBindings(tx, input.tenantId, credentialId, input.asset.providerKey);
    const bindings = new PluginBindingsApplicationService(new PluginBindingsRepository(tx));
    const binding = await bindings.createBinding(input.tenantId, {
      pluginVersionId: prepared.pluginVersionId,
      mode: 'MANAGED',
      inputBindings: {
        ...emptyInputBindingsV1(),
        credentials,
      },
      managedContext: { cloudAccountAssetId: input.asset.id },
    });

    for (const capabilityKey of capabilityKeys) {
      await bindings.assignCapability(input.tenantId, {
        ownerType: 'CLOUD_ACCOUNT_ASSET',
        ownerId: input.asset.id,
        capabilityKey,
        pluginVersionId: prepared.pluginVersionId,
        pluginBindingId: binding.id,
        precedence: 'ASSET_OVERRIDE',
      });
    }
    return { pluginVersionId: prepared.pluginVersionId, pluginBindingId: binding.id, capabilityKeys: [...capabilityKeys] };
  }

  private async resolveVersion(tenantId: string, providerKey: string) {
    const catalog = await this.plugins.listCatalog(tenantId, 'zh-CN');
    const candidate = catalog.find((item) => item.pluginId === providerKey
      && item.status === 'ENABLED'
      && item.capabilities.some((capability) => capability.key === 'cloud.service.connection-test'));
    if (!candidate) {
      throw new AppError('PLUGIN_CAPABILITY_EXECUTION_FAILED', '没有找到已启用且声明 Cloud Provider 连接能力的插件版本', { providerKey });
    }
    return this.plugins.getVersionForTenant(tenantId, candidate.pluginVersionId);
  }

  private async resolveCredentialBindings(
    tx: DatabasePort,
    tenantId: string,
    credentialId: string,
    providerKey: string,
  ): Promise<Record<string, { credentialId: string }>> {
    const result = await tx.query<{
      kind: string;
      status: string;
      metadata: Record<string, unknown>;
      secret_slots: Record<string, unknown>;
    }>(
      'select kind, status, metadata, secret_slots from credential_profiles where tenant_id=$1 and id=$2',
      [tenantId, credentialId],
    );
    const profile = result.rows[0];
    if (!profile) {
      throw new AppError('RESOURCE_NOT_FOUND', '云账号引用的 CredentialProfile 不存在', { credentialId });
    }
    if (profile.kind !== 'CLOUD_PROVIDER' || profile.status !== 'active') {
      throw new AppError('VALIDATION_FAILED', '云账号必须引用启用中的 CLOUD_PROVIDER 凭据', {
        credentialId,
        kind: profile.kind,
        status: profile.status,
      });
    }
    const metadata = profile.metadata ?? {};
    if (metadata.providerKey !== providerKey) {
      throw new AppError('VALIDATION_FAILED', '云账号凭据 providerKey 与资产不一致', {
        credentialId,
        providerKey,
        credentialProviderKey: metadata.providerKey,
      });
    }
    const slots = Object.keys(profile.secret_slots ?? {}).filter((slot) => slot.trim());
    if (slots.length === 0) throw new AppError('VALIDATION_FAILED', '云账号凭据没有可绑定的 Secret Slot', { credentialId });
    return Object.fromEntries(slots.map((slot) => [slot, { credentialId }]));
  }
}

interface PreparedCloudAccountAssetBinding {
  pluginVersionId: string;
  capabilityKeys: string[];
}

function readPrepared(value: unknown): PreparedCloudAccountAssetBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('SYSTEM_INTERNAL_ERROR', 'CloudAccountAsset 绑定准备结果缺失');
  }
  const record = value as Record<string, unknown>;
  const pluginVersionId = typeof record.pluginVersionId === 'string' ? record.pluginVersionId : '';
  const capabilityKeys = Array.isArray(record.capabilityKeys)
    ? record.capabilityKeys.filter((item): item is string => typeof item === 'string')
    : [];
  if (!pluginVersionId || capabilityKeys.length === 0) {
    throw new AppError('SYSTEM_INTERNAL_ERROR', 'CloudAccountAsset 绑定准备结果无效');
  }
  return { pluginVersionId, capabilityKeys };
}

function parseCredentialId(value: string): string {
  const match = /^credential:\/\/([^#]+)(?:#.*)?$/.exec(value.trim());
  if (!match?.[1]?.trim()) throw new AppError('VALIDATION_FAILED', '云账号 CredentialRef 格式无效', { field: 'credentialRef' });
  return match[1].trim();
}
