import { AppError } from '../../../common/errors/app-error.js';
import { newId } from '../../../shared/id.js';
import type { UnifiedPluginVersionRecord } from '../../plugins/dto/unified-plugins.dto.js';
import type { PluginFormSchemaV1 } from '../../plugins/forms/plugin-form.dto.js';
import type { PluginPackageResourcesService } from '../../plugins/application/plugin-package-resources.service.js';
import type { PluginBindingsApplicationService } from '../../plugins/application/plugin-bindings.application-service.js';
import { emptyInputBindingsV1 } from '../../deployment-inputs/dto/input-bindings.dto.js';
import type { AssetsApplicationService } from './assets.application-service.js';
import type { CloudAccountDiscoveryApplicationService, CloudAccountDiscoveryResult } from '../../providers/application/cloud-account-discovery.application-service.js';

/**
 * 插件资源接入的标准宿主端口。
 * 设备和云服务都从同一个入口提交插件表单；只有资源所有者类型不同，不能在向导里复制一套云账号 CRUD。
 */
export interface PluginResourceOnboardingPort {
  supports(plugin: UnifiedPluginVersionRecord): boolean;
  onboard(
    tenantId: string,
    plugin: UnifiedPluginVersionRecord,
    values: Record<string, unknown>,
    actorId: string,
  ): Promise<Record<string, unknown>>;
}

export class PluginResourceOnboardingApplicationService implements PluginResourceOnboardingPort {
  constructor(
    private readonly assets: AssetsApplicationService,
    private readonly bindings: PluginBindingsApplicationService,
    private readonly discovery: CloudAccountDiscoveryApplicationService,
    private readonly packageResources: PluginPackageResourcesService,
  ) {}

  supports(plugin: UnifiedPluginVersionRecord): boolean {
    const capabilities = new Set(plugin.manifest.capabilities.map((item) => item.key));
    return capabilities.has('cloud.service.connection-test') && capabilities.has('cloud.service.discover');
  }

  async onboard(
    tenantId: string,
    plugin: UnifiedPluginVersionRecord,
    values: Record<string, unknown>,
    actorId: string,
  ): Promise<Record<string, unknown>> {
    if (!this.supports(plugin)) throw new AppError('CAPABILITY_MISSING', '插件未声明标准资源接入能力', { pluginId: plugin.pluginId });
    const resources = this.packageResources.validate(plugin.manifest, plugin.resources);
    const form = resources.forms.cloud ?? resources.forms.device;
    if (!isManagedPluginForm(form)) throw new AppError('VALIDATION_FAILED', '插件缺少标准 Managed 资源表单', { pluginVersionId: plugin.id });
    const displayName = requiredText(values.displayName, 'displayName');
    const credentialId = requiredText(values.credentialId, 'credentialId');
    const endpoints = plugin.manifest.compatibility?.serviceEndpoints ?? [];
    const request = readPluginRequest(plugin);
    const asset = await this.assets.createServiceAsset(tenantId, {
      // ServiceAsset 要求网络身份；资源实例本身不伪装成设备，地址只作为标准资产唯一键。
      address: `resource.${plugin.pluginId}.${newId('onboard')}`,
      addressType: 'DNS',
      port: 443,
      protocol: 'HTTPS',
      displayName,
      discoverySource: 'PROVIDER',
      metadata: {
        resourceKind: 'PLUGIN_RESOURCE',
        pluginId: plugin.pluginId,
        pluginVersionId: plugin.id,
        credentialRef: `credential://${credentialId}`,
        ...(endpoints.length > 0 ? { serviceEndpoints: endpoints } : {}),
        ...(request ? { request } : {}),
        onboardingState: 'PENDING',
        createdBy: actorId,
      },
    });
    try {
      const binding = await this.bindings.createBinding(tenantId, {
        pluginVersionId: plugin.id,
        mode: 'MANAGED',
        inputBindings: {
          ...emptyInputBindingsV1(),
          credentials: { cloud: { credentialId } },
          variables: { displayName },
        },
        managedContext: { assetId: asset.id },
      });
      for (const capability of plugin.manifest.capabilities) {
        if (!capability.key.startsWith('cloud.service.')) continue;
        await this.bindings.assignCapability(tenantId, {
          ownerType: 'APPLICATION_ASSET',
          ownerId: asset.id,
          capabilityKey: capability.key,
          pluginVersionId: plugin.id,
          pluginBindingId: binding.id,
          precedence: 'ASSET_OVERRIDE',
        });
      }
      const configured = await this.assets.updateServiceAsset(tenantId, asset.id, {
        metadata: { ...asset.metadata, pluginBindingId: binding.id, onboardingState: 'CONNECTION_TESTING' },
      });
      const connection = await this.discovery.executeServiceAsset(tenantId, configured.id, 'connection-test');
      const discovered = await this.discovery.executeServiceAsset(tenantId, configured.id, 'discover');
      await this.assets.updateServiceAsset(tenantId, configured.id, {
        metadata: { ...configured.metadata, onboardingState: 'ACTIVE', discoveryStatus: 'ACTIVE' },
        status: 'ACTIVE',
      });
      return {
        onboardingKind: 'PLUGIN_MANAGED',
        resourceType: 'ASSET',
        resourceId: configured.id,
        assetId: configured.id,
        pluginId: plugin.pluginId,
        pluginVersionId: plugin.id,
        connection,
        discovery: discovered,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      try {
        await this.assets.updateServiceAsset(tenantId, asset.id, {
          status: 'UNKNOWN',
          metadata: { ...asset.metadata, onboardingState: 'FAILED', onboardingError: detail },
        });
      } catch {
        // 原始接入异常优先返回；资产状态更新失败由后续诊断任务处理。
      }
      throw error;
    }
  }
}

function isManagedPluginForm(value: unknown): value is PluginFormSchemaV1 {
  return Boolean(value && typeof value === 'object' && (value as PluginFormSchemaV1).schemaVersion === 'gcac.plugin-form/v1'
    && ['MANAGED', 'BOTH'].includes((value as PluginFormSchemaV1).mode)
    && Array.isArray((value as PluginFormSchemaV1).sections));
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new AppError('VALIDATION_FAILED', `${field} 不能为空`, { field });
  return value.trim();
}

function readPluginRequest(plugin: UnifiedPluginVersionRecord): Record<string, unknown> | undefined {
  const path = plugin.manifest.resources.onboarding?.cloudAccount;
  if (!path) return undefined;
  try {
    const resource = JSON.parse(plugin.resources[path] ?? '') as { defaults?: { request?: unknown } };
    const request = resource.defaults?.request;
    return request && typeof request === 'object' && !Array.isArray(request) ? structuredClone(request as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export function readPluginAssetDiscoveryResult(value: Record<string, unknown>): CloudAccountDiscoveryResult | undefined {
  const discovery = value.discovery;
  return discovery && typeof discovery === 'object' ? discovery as CloudAccountDiscoveryResult : undefined;
}
