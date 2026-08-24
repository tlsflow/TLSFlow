import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import { canonicalPluginIds, type CanonicalPluginId } from '../canonical-plugin-id/canonical-plugin-id.registry.js';
import type { UnifiedPluginCapabilityDescriptor, UnifiedPluginManifestV1 } from '../dto/unified-plugins.dto.js';
import { validateUnifiedPluginManifest } from '../schema/unified-plugins.schema.js';
import { validateBuiltinPluginPolicy } from './builtin-plugin-policy.js';
import { BuiltinUnifiedPluginLoader, type BuiltinPluginPackage } from './builtin-unified-plugin-loader.js';
import type { PluginWorkflowDeclaration } from '../application/plugin-workflow-declaration-resolver.js';
import type { UnifiedPluginsApplicationService } from '../application/unified-plugins.application-service.js';

export interface BuiltinPluginRegistryEntry {
  pluginId: CanonicalPluginId;
  version: string;
  packageDirectory: string;
  runtimeEntrypoint: 'runtime/index.js';
  runtimeEntrypointPath: string;
  executionMode: 'PLUGIN_RUNNER';
  ipcProtocol: 'gcac.plugin-runner/v1';
  manifest: UnifiedPluginManifestV1;
  capabilities: UnifiedPluginCapabilityDescriptor[];
  workflows: PluginWorkflowDeclaration[];
  packageSha256: string;
  manifestSha256: string;
  resourceSha256: Record<string, string>;
  resourceHash: string;
}

/**
 * 内置插件注册表只登记可验证的 Manifest、资源摘要和 Runner 入口路径。
 * 宿主不会 import、require 或实例化 runtime/index.js；真正的模块加载由 Runner 子进程完成。
 */
export class BuiltinPluginRegistry {
  private readonly entries = new Map<string, BuiltinPluginRegistryEntry>();
  private readonly packages = new Map<string, BuiltinPluginPackage>();

  constructor(
    private readonly loader: BuiltinUnifiedPluginLoader = new BuiltinUnifiedPluginLoader(),
  ) {}

  async refresh(): Promise<BuiltinPluginRegistryEntry[]> {
    // 只有整批扫描校验成功后才替换内存 Registry，热刷新失败不能破坏当前可执行快照。
    const nextEntries = new Map<string, BuiltinPluginRegistryEntry>();
    const nextPackages = new Map<string, BuiltinPluginPackage>();
    const packages = await this.loader.loadPackages();
    for (const pluginPackage of packages) {
      const entry = buildRegistryEntry(pluginPackage);
      const key = identityKey(entry.pluginId, entry.version);
      const existing = nextEntries.get(key);
      if (existing) {
        if (existing.packageSha256 !== entry.packageSha256) {
          throw new AppError('RESOURCE_VERSION_CONFLICT', '同一插件版本存在不同包内容', {
            pluginId: entry.pluginId,
            version: entry.version,
            expectedPackageSha256: existing.packageSha256,
            actualPackageSha256: entry.packageSha256,
          });
        }
        // 同一摘要是重复扫描，不创建第二个 Registry 或数据库版本记录。
        continue;
      }
      nextEntries.set(key, entry);
      nextPackages.set(key, pluginPackage);
    }
    this.entries.clear();
    this.packages.clear();
    nextEntries.forEach((entry, key) => this.entries.set(key, entry));
    nextPackages.forEach((pluginPackage, key) => this.packages.set(key, pluginPackage));
    return this.list();
  }

  list(): BuiltinPluginRegistryEntry[] {
    return [...this.entries.values()]
      .sort((left, right) => left.pluginId.localeCompare(right.pluginId) || left.version.localeCompare(right.version))
      .map(cloneRegistryEntry);
  }

  get(pluginId: string, version: string): BuiltinPluginRegistryEntry {
    if (!canonicalPluginIds.includes(pluginId as CanonicalPluginId)) {
      throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', '插件身份不是当前 Canonical Plugin ID', { pluginId });
    }
    const entry = this.entries.get(identityKey(pluginId, version));
    if (!entry) throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', '未找到固定的 Manifest PluginVersion', { pluginId, version });
    return cloneRegistryEntry(entry);
  }

  getWorkflowDeclarations(pluginId: string, version: string): PluginWorkflowDeclaration[] {
    return this.get(pluginId, version).workflows;
  }

  /** Workflow 声明由已扫描包的 Manifest 派生，不再维护外部清单镜像。 */
  getDeclaredWorkflowDeclarations(pluginId: string, version: string): PluginWorkflowDeclaration[] | undefined {
    const entry = this.entries.get(identityKey(pluginId, version));
    return entry?.workflows.map((workflow) => ({ ...workflow }));
  }

  /** 启动与热刷新共用同一条“扫描、校验、注册”链路。 */
  async registerAll(service: UnifiedPluginsApplicationService): Promise<Awaited<ReturnType<BuiltinUnifiedPluginLoader['installAll']>>> {
    await this.refresh();
    return this.loader.installPackages(service, [...this.packages.values()], { failFast: true });
  }
}

function buildRegistryEntry(
  pluginPackage: BuiltinPluginPackage,
): BuiltinPluginRegistryEntry {
  assertPackageDirectory(pluginPackage.packageDirectory);
  const manifest = validateUnifiedPluginManifest(pluginPackage.manifest);
  const policy = validateBuiltinPluginPolicy(manifest);
  if (pluginPackage.runtimeEntrypoint !== policy.runtimeEntrypoint
    || pluginPackage.runtimeEntrypointPath === undefined) {
    throw new AppError('PLUGIN_RUNNER_START_FAILED', '内置插件缺少固定 Runner 入口 runtime/index.js', { pluginId: manifest.pluginId });
  }
  const packageSha256 = sha256(pluginPackage.packageContent);
  const resourceSha256 = hashResources(pluginPackage.resources);
  return {
    pluginId: policy.pluginId,
    version: manifest.version,
    packageDirectory: pluginPackage.packageDirectory,
    runtimeEntrypoint: 'runtime/index.js',
    runtimeEntrypointPath: pluginPackage.runtimeEntrypointPath,
    executionMode: policy.executionMode,
    ipcProtocol: policy.ipcProtocol,
    manifest,
    capabilities: structuredClone(manifest.capabilities),
    workflows: Object.entries(manifest.resources.workflows ?? {}).map(([key, path]) => ({
      key,
      capabilityKey: key,
      path,
    })),
    packageSha256,
    manifestSha256: sha256(stableJson(pluginPackage.manifest)),
    resourceSha256,
    resourceHash: sha256(JSON.stringify(resourceSha256)),
  };
}

function hashResources(resources: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(resources).sort(([left], [right]) => left.localeCompare(right)).map(
    ([path, content]) => [path, sha256(content)],
  ));
}

function sha256(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(
      ([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`,
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

function identityKey(pluginId: string, version: string): string {
  return `${pluginId}@${version}`;
}

function assertPackageDirectory(packageDirectory: unknown): void {
  if (typeof packageDirectory !== 'string' || packageDirectory.trim() === '') {
    throw new AppError('VALIDATION_FAILED', '内置插件包路径不能为空');
  }
  const normalized = packageDirectory.replaceAll('\\', '/');
  const segments = normalized.split('/');
  const name = segments.at(-1);
  if (normalized.includes('\0') || segments.some((segment) => segment === '..') || !name || !/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new AppError('VALIDATION_FAILED', '内置插件包路径不安全', { packageDirectory });
  }
}

function cloneRegistryEntry(entry: BuiltinPluginRegistryEntry): BuiltinPluginRegistryEntry {
  return {
    ...entry,
    manifest: structuredClone(entry.manifest),
    capabilities: structuredClone(entry.capabilities),
    workflows: structuredClone(entry.workflows),
    resourceSha256: { ...entry.resourceSha256 },
  };
}
