import { AppError } from '../../../common/errors/app-error.js';
import type { PluginActionAliasDescriptorV1, UnifiedPluginVersionRecord } from '../dto/unified-plugins.dto.js';
import { validatePluginActionAliases } from '../schema/plugin-action-aliases.schema.js';
import type { DeploymentCapabilityResolver, ResolvedDeploymentCapability } from './deployment-capability.resolver.js';
import type { ResolvedDeploymentInputV1 } from '../../deployment-inputs/dto/resolved-deployment-input.dto.js';

export interface HistoricalAgentActionResolution {
  originalActionType: string;
  alias: PluginActionAliasDescriptorV1;
  capability: ResolvedDeploymentCapability;
}

export interface EnabledPluginVersionReader {
  listVersions(tenantId: string): Promise<UnifiedPluginVersionRecord[]>;
}

export class HistoricalAgentActionResolver {
  constructor(
    private readonly plugins: EnabledPluginVersionReader,
    private readonly capabilities: DeploymentCapabilityResolver,
  ) {}

  async resolve(input: {
    tenantId: string;
    actionType: string;
    resolvedInput: ResolvedDeploymentInputV1;
    frameworkType?: string;
    productFamily?: string;
  }): Promise<HistoricalAgentActionResolution> {
    const actionType = input.actionType.trim().toLowerCase();
    const candidates = (await this.plugins.listVersions(input.tenantId))
      .filter((plugin) => plugin.status === 'ENABLED')
      .flatMap((plugin) => aliasesForPlugin(plugin)
        .filter((alias) => alias.actionType === actionType)
        .map((alias) => ({ plugin, alias })));
    if (candidates.length === 0) migrationRequired(actionType, '没有 Enabled PluginVersion 声明该历史 Action');

    const asset = input.resolvedInput.assetContext;
    const hostId = asset.host?.id;
    const managedTargetId = asset.target?.id;
    if (!hostId || !managedTargetId || !asset.application.id) migrationRequired(actionType, '缺少 Host、ManagedTarget 或 ApplicationAsset 标准上下文');
    const resolutions: HistoricalAgentActionResolution[] = [];
    for (const capabilityKey of [...new Set(candidates.map((candidate) => candidate.alias.capabilityKey))]) {
      let resolved: ResolvedDeploymentCapability;
      try {
        const alias = candidates.find((candidate) => candidate.alias.capabilityKey === capabilityKey)!.alias;
        resolved = await this.capabilities.resolve({
          tenantId: input.tenantId,
          capabilityKey,
          hostId,
          managedTargetId,
          applicationAssetId: asset.application.id,
          executionLocations: ['AGENT'],
          compatibility: {
            productFamily: input.productFamily ?? productFamilyFromOs(asset.host?.osType),
            frameworkType: input.frameworkType ?? stringField(asset.target?.metadata, 'frameworkType'),
            targetType: asset.target?.type,
            managementMethod: 'AGENT',
            artifactContract: alias.inputContract,
          },
        });
      } catch {
        continue;
      }
      const matched = candidates.find((candidate) => candidate.plugin.id === resolved.pluginVersionId
        && candidate.alias.capabilityKey === capabilityKey);
      if (matched) resolutions.push({ originalActionType: input.actionType, alias: matched.alias, capability: resolved });
    }
    if (resolutions.length === 0) migrationRequired(actionType, '当前 Assignment、Binding 与别名插件版本不一致');
    if (resolutions.length > 1) {
      throw new AppError('HISTORICAL_AGENT_ACTION_AMBIGUOUS', '历史 Agent Action 在当前目标上下文中解析到多个插件能力', {
        actionType,
        pluginVersionIds: resolutions.map((item) => item.capability.pluginVersionId).sort(),
      });
    }
    return resolutions[0]!;
  }
}

function aliasesForPlugin(plugin: UnifiedPluginVersionRecord): PluginActionAliasDescriptorV1[] {
  return Object.values(plugin.manifest.resources.actionAliases ?? {}).flatMap((path) => {
    const content = plugin.resources[path];
    if (!content) return [];
    try {
      return validatePluginActionAliases(JSON.parse(content), plugin.manifest).aliases;
    } catch {
      return [];
    }
  });
}

function productFamilyFromOs(osType: string | undefined): string | undefined {
  return osType?.trim() ? `${osType.trim().toUpperCase()}_SERVER` : undefined;
}

function stringField(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const item = value?.[key];
  return typeof item === 'string' && item.trim() ? item.trim() : undefined;
}

function migrationRequired(actionType: string, reason: string): never {
  throw new AppError('HISTORICAL_AGENT_ACTION_MIGRATION_REQUIRED', '历史 Agent Action 无法通过当前标准插件上下文转换，请重新生成部署计划', { actionType, reason });
}
