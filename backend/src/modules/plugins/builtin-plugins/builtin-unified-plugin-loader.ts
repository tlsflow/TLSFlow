import { access, readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../../../common/errors/app-error.js';
import { structuredLogger, type StructuredLogger } from '../../../common/logging/structured-logger.js';
import type { UnifiedPluginManifestV1, UnifiedPluginVersionRecord } from '../dto/unified-plugins.dto.js';
import { assertUnifiedPluginResources, validateUnifiedPluginManifest } from '../schema/unified-plugins.schema.js';
import type { UnifiedPluginsApplicationService } from '../application/unified-plugins.application-service.js';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const pluginScopedErrorCodes = new Set([
  'VALIDATION_FAILED',
  'RESOURCE_VERSION_CONFLICT',
  'PLUGIN_RUNNER_START_FAILED',
  'PLUGIN_RUNNER_VERSION_MISMATCH',
]);

export interface BuiltinPluginPackage {
  packageDirectory: string;
  manifest: unknown;
  resources: Record<string, string>;
  packageContent: string;
  runtimeEntrypoint?: string;
  runtimeEntrypointPath?: string;
}

export interface BuiltinPluginScanReport {
  /** 本次扫描中包含 manifest.json 的插件目录。 */
  packageDirectories: string[];
  /** 发现但未能完整读取或校验的插件目录。 */
  failedPackageDirectories: string[];
  packages: BuiltinPluginPackage[];
}

export class BuiltinUnifiedPluginLoader {
  private lastScanReport: BuiltinPluginScanReport | undefined;

  constructor(
    private readonly configuredRootDirectory?: string,
    private readonly logger: Pick<StructuredLogger, 'warn'> = structuredLogger,
  ) {}

  async loadPackages(): Promise<BuiltinPluginPackage[]> {
    const rootDirectory = this.configuredRootDirectory ?? await resolveBuiltinRootDirectory();
    const entries = await readdir(rootDirectory, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    const packageDirectories: string[] = [];
    for (const directory of directories) {
      try {
        await access(join(rootDirectory, directory, 'manifest.json'));
        packageDirectories.push(directory);
      } catch {
        // 非插件资源目录不参与包扫描。
      }
    }
    const scanResults = await Promise.all(packageDirectories.map(async (directory) => {
      try {
        return { directory, package: await this.loadPackage(join(rootDirectory, directory)) };
      } catch (error) {
        // 单个插件包损坏时只跳过该包，不能让其他插件或宿主启动失败。
        this.warnFailure('scan', { pluginId: directory }, error);
        return { directory, package: undefined };
      }
    }));
    const packages = scanResults
      .map((result) => result.package)
      .filter((pluginPackage): pluginPackage is BuiltinPluginPackage => pluginPackage !== undefined);
    this.lastScanReport = {
      packageDirectories,
      failedPackageDirectories: scanResults.filter((result) => result.package === undefined).map((result) => result.directory),
      packages,
    };
    return packages;
  }

  getLastScanReport(): BuiltinPluginScanReport | undefined {
    return this.lastScanReport && {
      packageDirectories: [...this.lastScanReport.packageDirectories],
      failedPackageDirectories: [...this.lastScanReport.failedPackageDirectories],
      packages: [...this.lastScanReport.packages],
    };
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
    // 同一插件版本的包摘要不可覆盖。开发环境中源码可能已经演进到更高版本，
    // 但数据库仍保留一个合法的旧包；这种情况下仍需让派生发布器重试该已登记版本。
    const existingBuiltinVersions = new Map(
      (await service.listBuiltinVersions()).map((record) => [identityKey(record.pluginId, record.version), record]),
    );
    const installed: UnifiedPluginVersionRecord[] = [];
    for (const pluginPackage of packages) {
      const identity = pluginIdentity(pluginPackage.manifest);
      let imported: UnifiedPluginVersionRecord;
      try {
        imported = await service.importVersion(storageTenantId, pluginPackage, 'BUILTIN');
      } catch (error) {
        const recovered = await this.recoverExistingBuiltinVersion(service, pluginPackage, existingBuiltinVersions, error);
        if (recovered) {
          installed.push(recovered);
          continue;
        }
        if (!isPluginScopedFailure(error)) throw error;
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
        if (!isPluginScopedFailure(error)) throw error;
        this.warnFailure('approvePermissions', identityOf(imported), error, imported.id);
        if (options.failFast) throw error;
        continue;
      }

      try {
        installed.push(approved.status === 'ENABLED' ? approved : await service.enableVersion(approved.id));
      } catch (error) {
        if (!isPluginScopedFailure(error)) throw error;
        this.warnFailure('enable', identityOf(approved), error, approved.id);
        if (options.failFast) throw error;
      }
    }
    return installed;
  }

  /**
   * 版本摘要冲突只表示“当前源码不能覆盖数据库历史包”，不表示历史版本不可用。
   * 复用历史记录可以让启动/刷新继续执行 Workflow 派生修复，同时保持插件资源不可变。
   */
  private async recoverExistingBuiltinVersion(
    service: UnifiedPluginsApplicationService,
    pluginPackage: BuiltinPluginPackage,
    existingVersions: ReadonlyMap<string, UnifiedPluginVersionRecord>,
    error: unknown,
  ): Promise<UnifiedPluginVersionRecord | undefined> {
    if (!(error instanceof AppError) || error.errorCode !== 'RESOURCE_VERSION_CONFLICT') return undefined;
    const identity = pluginIdentity(pluginPackage.manifest);
    if (!identity.pluginId || !identity.version) return undefined;
    const existing = existingVersions.get(identityKey(identity.pluginId, identity.version));
    if (!existing || existing.source !== 'BUILTIN' || ['RETIRED', 'QUARANTINED'].includes(existing.status)) return undefined;
    try {
      const approved = existing.permissionApprovalStatus === 'APPROVED'
        ? existing
        : await service.approvePermissions(existing.id, existing.manifest.permissions);
      const enabled = approved.status === 'ENABLED' ? approved : await service.enableVersion(approved.id);
      return overlayCurrentWorkflowResources(enabled, pluginPackage);
    } catch (recoveryError) {
      this.warnFailure('recover', identity, recoveryError, existing.id);
      return undefined;
    }
  }

  private warnFailure(
    phase: 'scan' | 'import' | 'approvePermissions' | 'enable' | 'recover',
    identity: { pluginId?: string; version?: string },
    error: unknown,
    resourceId?: string,
  ): void {
    this.logger.warn('插件包扫描阶段失败，已跳过该插件包', {
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

function identityKey(pluginId: string, version: string): string {
  return `${pluginId}@${version}`;
}

/**
 * 冲突恢复不更新插件包历史，只把当前源码中同路径的 Workflow 作为派生发布输入。
 * 这样可以修复历史包内 Workflow 元数据落后于 PluginVersion 的记录，同时继续拒绝
 * 覆盖数据库中的 Manifest、Runner 和其他资源。
 */
function overlayCurrentWorkflowResources(
  record: UnifiedPluginVersionRecord,
  pluginPackage: BuiltinPluginPackage,
): UnifiedPluginVersionRecord {
  const workflowPaths = Object.values(record.manifest.resources.workflows ?? {});
  if (workflowPaths.length === 0) return record;
  const resources = { ...record.resources };
  for (const path of workflowPaths) {
    const current = pluginPackage.resources[path];
    if (current !== undefined) resources[path] = current;
  }
  return { ...record, resources };
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

function isPluginScopedFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('errorCode' in error)) return false;
  return pluginScopedErrorCodes.has(String(error.errorCode));
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
