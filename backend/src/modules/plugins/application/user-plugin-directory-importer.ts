import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { structuredLogger, type StructuredLogger } from '../../../common/logging/structured-logger.js';
import { BuiltinUnifiedPluginLoader, type BuiltinPluginPackage } from '../builtin-plugins/builtin-unified-plugin-loader.js';
import type { UnifiedPluginVersionRecord } from '../dto/unified-plugins.dto.js';
import { compareSemanticVersions, type UnifiedPluginsApplicationService } from './unified-plugins.application-service.js';
import type { PluginWorkflowPublisherService } from './plugin-workflow-publisher.service.js';

export interface UserPluginDirectoryImportResult {
  versions: UnifiedPluginVersionRecord[];
  attempted: number;
  imported: number;
  skipped: number;
  failed: number;
}

/**
 * 从持久化用户插件目录导入当前租户的插件版本。
 *
 * 目录只是包文件来源，真正的所有权、版本不可变和资源持久化仍由
 * UnifiedPluginsApplicationService 负责。用户包导入默认保持 DISABLED；刷新时如果该插件的
 * 上一版本已启用，则通过统一启用服务继承启用状态，不进入内置 Registry，也不经过内置插件的权限审批流程。
 */
export class UserPluginDirectoryImporter {
  constructor(
    private readonly plugins: Pick<UnifiedPluginsApplicationService, 'importVersion' | 'listVersions' | 'enableVersion'>,
    private readonly workflowPublisher: Pick<PluginWorkflowPublisherService, 'publishPlugin'>,
    private readonly configuredRootDirectory?: string,
    private readonly logger: Pick<StructuredLogger, 'warn'> = structuredLogger,
  ) {}

  async importForTenant(tenantId: string): Promise<UserPluginDirectoryImportResult> {
    const rootDirectory = this.configuredRootDirectory ?? await resolveUserPluginRootDirectory();
    if (!rootDirectory) return { versions: [], attempted: 0, imported: 0, skipped: 0, failed: 0 };

    let packages: BuiltinPluginPackage[];
    try {
      packages = await new BuiltinUnifiedPluginLoader(rootDirectory, this.logger).loadPackages();
    } catch (error) {
      this.warn('scan', { rootDirectory }, error);
      return { versions: [], attempted: 0, imported: 0, skipped: 0, failed: 1 };
    }

    const versions: UnifiedPluginVersionRecord[] = [];
    const previousVersions = await this.plugins.listVersions(tenantId);
    let imported = 0;
    let skipped = 0;
    let failed = 0;
    for (const pluginPackage of packages) {
      if (pluginSource(pluginPackage) !== 'USER') {
        skipped += 1;
        this.warn('source', { packageDirectory: pluginPackage.packageDirectory }, new Error('用户插件目录中的 Manifest.source 必须是 USER'));
        continue;
      }
      const identity = pluginIdentity(pluginPackage);
      try {
        const version = await this.plugins.importVersion(tenantId, pluginPackage, 'USER');
        const previous = latestVersionForPlugin(previousVersions, version.pluginId);
        const refreshed = previous?.status === 'ENABLED' && version.status !== 'ENABLED'
          ? await this.plugins.enableVersion(version.id)
          : version;
        // Workflow DSL 的发布是导入后的派生步骤；新插件默认禁用，只有刷新时才继承上一版本的启用状态。
        if (refreshed.runtime === 'WORKFLOW_DSL') await this.workflowPublisher.publishPlugin(refreshed);
        versions.push(refreshed);
        imported += 1;
      } catch (error) {
        failed += 1;
        this.warn('import', { ...identity, packageDirectory: pluginPackage.packageDirectory }, error);
      }
    }
    return { versions, attempted: packages.length, imported, skipped, failed };
  }

  private warn(phase: 'scan' | 'source' | 'import', details: Record<string, string>, error: unknown): void {
    this.logger.warn('用户插件目录刷新失败，已隔离该包', {
      phase,
      ...details,
      error: error instanceof Error ? error.message : String(error),
    }, {
      module: 'user-plugin-directory',
      resourceType: 'pluginPackage',
      ...(details.pluginId ? { resourceId: details.pluginId } : {}),
    });
  }
}

function latestVersionForPlugin(
  versions: readonly UnifiedPluginVersionRecord[],
  pluginId: string,
): UnifiedPluginVersionRecord | undefined {
  return versions
    .filter((version) => version.source === 'USER' && version.pluginId === pluginId)
    .sort((left, right) => compareSemanticVersions(right.version, left.version) || right.updatedAt.localeCompare(left.updatedAt))[0];
}

export async function resolveUserPluginRootDirectory(environment: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const configured = environment.GCAC_USER_PLUGIN_DATA_DIR?.trim();
  const candidates = configured
    ? [resolve(configured)]
    : [
      resolve(process.cwd(), 'data/plugins'),
      resolve(process.cwd(), '../data/plugins'),
      '/app/data/plugins',
    ];
  for (const candidate of [...new Set(candidates)]) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // 目录不存在时继续检查其他部署布局；没有目录不应阻塞内置插件刷新。
    }
  }
  return undefined;
}

function pluginSource(pluginPackage: BuiltinPluginPackage): unknown {
  return isRecord(pluginPackage.manifest) ? pluginPackage.manifest.source : undefined;
}

function pluginIdentity(pluginPackage: BuiltinPluginPackage): { pluginId?: string; version?: string } {
  if (!isRecord(pluginPackage.manifest)) return {};
  return {
    ...(typeof pluginPackage.manifest.pluginId === 'string' ? { pluginId: pluginPackage.manifest.pluginId } : {}),
    ...(typeof pluginPackage.manifest.version === 'string' ? { version: pluginPackage.manifest.version } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
