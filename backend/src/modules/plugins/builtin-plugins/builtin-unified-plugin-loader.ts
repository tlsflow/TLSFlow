import { access, readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { structuredLogger, type StructuredLogger } from '../../../common/logging/structured-logger.js';
import type { UnifiedPluginVersionRecord } from '../dto/unified-plugins.dto.js';
import type { UnifiedPluginsApplicationService } from '../application/unified-plugins.application-service.js';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

export class BuiltinUnifiedPluginLoader {
  constructor(
    private readonly configuredRootDirectory?: string,
    private readonly logger: Pick<StructuredLogger, 'warn'> = structuredLogger,
  ) {}

  async loadPackages(): Promise<Array<{ manifest: unknown; resources: Record<string, string>; packageContent: string }>> {
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
    const storageTenantId = 'SYSTEM';
    const packages = await this.loadPackages();
    const installed: UnifiedPluginVersionRecord[] = [];
    for (const pluginPackage of packages) {
      const identity = pluginIdentity(pluginPackage.manifest);
      let imported: UnifiedPluginVersionRecord;
      try {
        imported = await service.importVersion(storageTenantId, pluginPackage, 'BUILTIN');
      } catch (error) {
        this.warnFailure('import', identity, error);
        continue;
      }

      let approved: UnifiedPluginVersionRecord;
      try {
        approved = imported.permissionApprovalStatus === 'APPROVED'
          ? imported
          : await service.approvePermissions(imported.id, imported.manifest.permissions);
      } catch (error) {
        this.warnFailure('approvePermissions', identityOf(imported), error, imported.id);
        continue;
      }

      try {
        installed.push(approved.status === 'ENABLED' ? approved : await service.enableVersion(approved.id));
      } catch (error) {
        this.warnFailure('enable', identityOf(approved), error, approved.id);
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

  private async loadPackage(directory: string): Promise<{ manifest: unknown; resources: Record<string, string>; packageContent: string }> {
    const manifestPath = join(directory, 'manifest.json');
    const manifestContent = await readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestContent) as { resources?: Record<string, Record<string, string> | string> };
    const resourcePaths = collectManifestResourcePaths(manifest).sort();
    const resources = Object.fromEntries(await Promise.all(resourcePaths.map(async (resourcePath) => [
      resourcePath,
      await readFile(resolve(directory, resourcePath), 'utf8'),
    ])));
    return {
      manifest,
      resources,
      packageContent: JSON.stringify({ directory: basename(directory), manifest, resources }),
    };
  }
}

function collectManifestResourcePaths(manifest: { resources?: Record<string, Record<string, string> | string> }): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(manifest.resources ?? {})) {
    if (!value) continue;
    if (key === 'runtimeEntrypoint' && typeof value === 'string') {
      paths.push(value);
      continue;
    }
    if (typeof value === 'object') paths.push(...Object.values(value));
  }
  return [...new Set(paths)];
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
