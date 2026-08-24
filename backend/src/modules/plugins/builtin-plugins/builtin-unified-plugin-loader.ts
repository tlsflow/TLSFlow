import { access, readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { UnifiedPluginVersionRecord } from '../dto/unified-plugins.dto.js';
import type { UnifiedPluginsApplicationService } from '../application/unified-plugins.application-service.js';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

export class BuiltinUnifiedPluginLoader {
  constructor(private readonly configuredRootDirectory?: string) {}

  async loadPackages(): Promise<Array<{ manifest: unknown; resources: Record<string, string>; packageContent: string }>> {
    const rootDirectory = this.configuredRootDirectory ?? await resolveBuiltinRootDirectory();
    const entries = await readdir(rootDirectory, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    return Promise.all(directories.map((directory) => this.loadPackage(join(rootDirectory, directory))));
  }

  async installAll(tenantId: string, service: UnifiedPluginsApplicationService): Promise<UnifiedPluginVersionRecord[]> {
    const packages = await this.loadPackages();
    const installed: UnifiedPluginVersionRecord[] = [];
    for (const pluginPackage of packages) {
      const imported = await service.importVersion(tenantId, pluginPackage, 'BUILTIN');
      const approved = imported.permissionApprovalStatus === 'APPROVED'
        ? imported
        : await service.approvePermissions(imported.id, imported.manifest.permissions);
      installed.push(approved.status === 'ENABLED' ? approved : await service.enableVersion(approved.id));
    }
    return installed;
  }

  private async loadPackage(directory: string): Promise<{ manifest: unknown; resources: Record<string, string>; packageContent: string }> {
    const manifestPath = join(directory, 'manifest.json');
    const manifestContent = await readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestContent) as { resources?: Record<string, Record<string, string>> };
    const resourcePaths = [...new Set(Object.values(manifest.resources ?? {}).flatMap((mapping) => Object.values(mapping ?? {})))].sort();
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

async function resolveBuiltinRootDirectory(): Promise<string> {
  const candidates = [
    moduleDirectory,
    resolve(process.cwd(), 'src/modules/plugins/builtin-plugins'),
    resolve(process.cwd(), 'backend/src/modules/plugins/builtin-plugins'),
  ];
  for (const candidate of candidates) {
    try {
      await access(join(candidate, 'citrix-adc', 'manifest.json'));
      return candidate;
    } catch {
      // 继续检查源码目录或部署目录。
    }
  }
  return moduleDirectory;
}
