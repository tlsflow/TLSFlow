import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { AppError } from '../../../common/errors/app-error.js';
import { structuredLogger, type StructuredLogger } from '../../../common/logging/structured-logger.js';
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

export interface BuiltinPluginRegistryOptions {
  logger?: Pick<StructuredLogger, 'warn'>;
  blockedPackageDirectories?: readonly string[];
}

/**
 * 内置插件注册表只登记可验证的 Manifest、资源摘要和 Runner 入口路径。
 * 宿主不会 import、require 或实例化 runtime/index.js；真正的模块加载由 Runner 子进程完成。
 */
export class BuiltinPluginRegistry {
  private readonly entries = new Map<string, BuiltinPluginRegistryEntry>();
  private readonly packages = new Map<string, BuiltinPluginPackage>();
  private readonly logger: Pick<StructuredLogger, 'warn'>;
  private readonly blockedPackageDirectories: ReadonlySet<string>;

  constructor(
    private readonly loader: BuiltinUnifiedPluginLoader = new BuiltinUnifiedPluginLoader(),
    options: BuiltinPluginRegistryOptions = {},
  ) {
    this.logger = options.logger ?? structuredLogger;
    this.blockedPackageDirectories = new Set(options.blockedPackageDirectories ?? []);
  }

  async refresh(): Promise<BuiltinPluginRegistryEntry[]> {
    // 逐包扫描并替换内存快照；单个包失败只会从本次快照中剔除，不影响其他插件。
    const nextEntries = new Map<string, BuiltinPluginRegistryEntry>();
    const nextPackages = new Map<string, BuiltinPluginPackage>();
    const packages = await this.loader.loadPackages();
    const conflictedKeys = new Set<string>();
    for (const pluginPackage of packages) {
      const packageDirectory = basename(pluginPackage.packageDirectory);
      if (this.blockedPackageDirectories.has(packageDirectory)) {
        this.warnFailure('versionGate', pluginPackage, new AppError('RESOURCE_VERSION_CONFLICT', '插件版本不可变检查未通过', {
          packageDirectory,
        }));
        continue;
      }

      let entry: BuiltinPluginRegistryEntry;
      try {
        entry = buildRegistryEntry(pluginPackage);
      } catch (error) {
        this.warnFailure('registry', pluginPackage, error);
        continue;
      }
      const key = identityKey(entry.pluginId, entry.version);
      if (conflictedKeys.has(key)) continue;
      const existing = nextEntries.get(key);
      if (existing) {
        if (existing.packageSha256 !== entry.packageSha256) {
          conflictedKeys.add(key);
          nextEntries.delete(key);
          nextPackages.delete(key);
          this.warnFailure('registry', pluginPackage, new AppError('RESOURCE_VERSION_CONFLICT', '同一插件版本存在不同包内容', {
            pluginId: entry.pluginId,
            version: entry.version,
            expectedPackageSha256: existing.packageSha256,
            actualPackageSha256: entry.packageSha256,
          }));
          continue;
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
    return this.loader.installPackages(service, [...this.packages.values()], { failFast: false });
  }

  private warnFailure(
    phase: 'versionGate' | 'registry',
    pluginPackage: BuiltinPluginPackage,
    error: unknown,
  ): void {
    const manifest = pluginPackage.manifest;
    const identity = manifest && typeof manifest === 'object' && !Array.isArray(manifest)
      ? manifest as Record<string, unknown>
      : {};
    this.logger.warn('内置插件注册阶段失败，已跳过该插件', {
      phase,
      pluginId: typeof identity.pluginId === 'string' ? identity.pluginId : basename(pluginPackage.packageDirectory),
      version: typeof identity.version === 'string' ? identity.version : undefined,
      errorCode: errorCodeOf(error),
      error: errorMessageOf(error),
    }, {
      module: 'builtin-plugin-startup',
      resourceType: 'pluginVersion',
    });
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

function errorCodeOf(error: unknown): string {
  if (error && typeof error === 'object' && 'errorCode' in error && typeof error.errorCode === 'string') {
    return error.errorCode;
  }
  return 'UNKNOWN_ERROR';
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
