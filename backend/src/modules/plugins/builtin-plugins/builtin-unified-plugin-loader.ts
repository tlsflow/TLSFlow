import { access, readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { structuredLogger, type StructuredLogger } from '../../../common/logging/structured-logger.js';
import type { UnifiedPluginManifestV1, UnifiedPluginVersionRecord } from '../dto/unified-plugins.dto.js';
import { assertUnifiedPluginResources, validateUnifiedPluginManifest } from '../schema/unified-plugins.schema.js';
import type { UnifiedPluginsApplicationService } from '../application/unified-plugins.application-service.js';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

export interface BuiltinPluginPackage {
  packageDirectory: string;
  manifest: unknown;
  resources: Record<string, string>;
  packageContent: string;
  runtimeEntrypoint?: string;
  runtimeEntrypointPath?: string;
}

export class BuiltinUnifiedPluginLoader {
  constructor(
    private readonly configuredRootDirectory?: string,
    private readonly logger: Pick<StructuredLogger, 'warn'> = structuredLogger,
  ) {}

  async loadPackages(): Promise<BuiltinPluginPackage[]> {
    const rootDirectory = this.configuredRootDirectory ?? await resolveBuiltinRootDirectory();
    const entries = await readdir(rootDirectory, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    const packageDirectories = [];
    for (const directory of directories) {
      try {
        await access(join(rootDirectory, directory, 'manifest.json'));
        packageDirectories.push(directory);
      } catch {
        // 非插件资源目录不参与包扫描。
      }
    }
    const nativePackages = await Promise.all(packageDirectories.map((directory) => this.loadPackage(join(rootDirectory, directory))));
    if (this.configuredRootDirectory) return nativePackages;
    return nativePackages;
  }

  async installAll(service: UnifiedPluginsApplicationService): Promise<UnifiedPluginVersionRecord[]> {
    return this.installPackages(service, await this.loadPackages());
  }

  /** 由统一 Registry 扫描并校验后的包从这里进入数据库派生注册表。 */
  async installPackages(
    service: UnifiedPluginsApplicationService,
    packages: readonly BuiltinPluginPackage[],
    options: { failFast?: boolean } = {},
  ): Promise<UnifiedPluginVersionRecord[]> {
    const storageTenantId = 'SYSTEM';
    const installed: UnifiedPluginVersionRecord[] = [];
    for (const pluginPackage of packages) {
      const identity = pluginIdentity(pluginPackage.manifest);
      let imported: UnifiedPluginVersionRecord;
      try {
        imported = await service.importVersion(storageTenantId, pluginPackage, 'BUILTIN');
      } catch (error) {
        this.warnFailure('import', identity, error);
        if (options.failFast) throw error;
        continue;
      }

      let approved: UnifiedPluginVersionRecord;
      try {
        approved = imported.permissionApprovalStatus === 'APPROVED'
          ? imported
          : await service.approvePermissions(imported.id, imported.manifest.permissions);
      } catch (error) {
        this.warnFailure('approvePermissions', identityOf(imported), error, imported.id);
        if (options.failFast) throw error;
        continue;
      }

      try {
        installed.push(approved.status === 'ENABLED' ? approved : await service.enableVersion(approved.id));
      } catch (error) {
        this.warnFailure('enable', identityOf(approved), error, approved.id);
        if (options.failFast) throw error;
      }
    }
    return installed;
  }

  private warnFailure(
    phase: 'import' | 'approvePermissions' | 'enable',
    identity: { pluginId?: string; version?: string },
    error: unknown,
    resourceId?: string,
  ): void {
    this.logger.warn('内置插件启动阶段失败，已跳过该插件', {
      phase,
      pluginId: identity.pluginId,
      version: identity.version,
      errorCode: errorCodeOf(error),
      error: errorMessageOf(error),
    }, {
      module: 'builtin-plugin-startup',
      resourceType: 'pluginVersion',
      ...(resourceId ? { resourceId } : {}),
    });
  }

  private async loadPackage(directory: string): Promise<BuiltinPluginPackage> {
    const manifestPath = join(directory, 'manifest.json');
    const manifestContent = await readFile(manifestPath, 'utf8');
    const parsedManifest = JSON.parse(manifestContent) as { resources?: UnifiedPluginManifestV1['resources'] };
    const manifest = validateUnifiedPluginManifest(parsedManifest);
    const resourcePaths = collectManifestResourcePaths(manifest).sort();
    const resources = Object.fromEntries(await Promise.all(resourcePaths.map(async (resourcePath) => {
      const absolutePath = resolvePackageResource(directory, resourcePath);
      const content = await readFile(absolutePath, 'utf8');
      return [resourcePath, normalizePackageText(content)] as const;
    })));
    const runtimeEntrypoint = typeof manifest.resources?.runtimeEntrypoint === 'string'
      ? manifest.resources.runtimeEntrypoint.replaceAll('\\', '/')
      : undefined;
    const runtimeEntrypointPath = runtimeEntrypoint === undefined
      ? undefined
      : resolvePackageResource(directory, runtimeEntrypoint);
    assertUnifiedPluginResources(manifest, resources);
    return {
      packageDirectory: directory,
      manifest,
      resources,
      // 包指纹沿用原始 Manifest 结构，避免运行时 Schema 规范化改变历史版本摘要。
      packageContent: JSON.stringify({ directory: basename(directory), manifest: parsedManifest, resources }),
      ...(runtimeEntrypoint ? { runtimeEntrypoint } : {}),
      ...(runtimeEntrypointPath ? { runtimeEntrypointPath } : {}),
    };
  }
}

function collectManifestResourcePaths(manifest: { resources?: UnifiedPluginManifestV1['resources'] }): string[] {
  const paths: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === 'string') {
      paths.push(value);
      return;
    }
    if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  Object.values(manifest.resources ?? {}).forEach(collect);
  return [...new Set(paths)];
}

// 统一不同平台检出的换行，保证包摘要、资源摘要和运行时输入一致。
function normalizePackageText(content: string): string {
  return content.replace(/\r\n?/g, '\n');
}

function resolvePackageResource(packageDirectory: string, resourcePath: string): string {
  const normalized = resourcePath.replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0') || normalized.split('/').includes('..')) {
    throw new Error(`插件资源路径不安全：${resourcePath}`);
  }
  const root = resolve(packageDirectory);
  const absolute = resolve(root, normalized);
  const relative = absolute.slice(root.length).replaceAll('\\', '/');
  if (relative.startsWith('/../') || relative === '/..' || absolute === resolve(root, '..')) {
    throw new Error(`插件资源路径越出包目录：${resourcePath}`);
  }
  return absolute;
}

function pluginIdentity(manifest: unknown): { pluginId?: string; version?: string } {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return {};
  const value = manifest as Record<string, unknown>;
  return {
    ...(typeof value.pluginId === 'string' ? { pluginId: value.pluginId } : {}),
    ...(typeof value.version === 'string' ? { version: value.version } : {}),
  };
}

function identityOf(record: UnifiedPluginVersionRecord): { pluginId: string; version: string } {
  return { pluginId: record.pluginId, version: record.version };
}

function errorCodeOf(error: unknown): string {
  if (error && typeof error === 'object' && 'errorCode' in error && typeof error.errorCode === 'string') {
    return error.errorCode;
  }
  return 'UNKNOWN_ERROR';
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function resolveBuiltinRootDirectory(): Promise<string> {
  const candidates = [
    moduleDirectory,
    resolve(process.cwd(), 'src/modules/plugins/builtin-plugins'),
    resolve(process.cwd(), 'backend/src/modules/plugins/builtin-plugins'),
  ];
  for (const candidate of candidates) {
    if (await containsPluginPackage(candidate)) return candidate;
  }
  return moduleDirectory;
}

async function containsPluginPackage(directory: string): Promise<boolean> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        await access(join(directory, entry.name, 'manifest.json'));
        return true;
      } catch {
        // 继续检查其他目录。
      }
    }
  } catch {
    return false;
  }
  return false;
}
