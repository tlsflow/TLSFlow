import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../../../common/errors/app-error.js';
import { canonicalPluginIds, type CanonicalPluginId } from '../canonical-plugin-id/canonical-plugin-id.registry.js';
import type { UnifiedPluginCapabilityDescriptor, UnifiedPluginManifestV1 } from '../dto/unified-plugins.dto.js';
import { validateUnifiedPluginManifest } from '../schema/unified-plugins.schema.js';
import { BuiltinUnifiedPluginLoader, type BuiltinPluginPackage } from './builtin-unified-plugin-loader.js';
import type { PluginWorkflowDeclaration } from '../application/plugin-workflow-declaration-resolver.js';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultReleaseManifestPath = resolve(moduleDirectory, '../../../../../scripts/architecture/p2-plugin-release-manifest.json');

export interface P2PluginReleaseEntry {
  canonicalPluginId: string;
  packageDirectory: string;
  pluginVersion: string;
  implementationStatus: string;
  executionMode: 'PLUGIN_RUNNER';
  agentSidePlugin: boolean;
  packageDigest?: { status: string; sha256: string | null; catalogEntryRequired?: boolean };
  capabilities: Array<{ key: string; contractVersion: string; riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'; executionLocations: string[] }>;
  hostApiGrants: Array<{ method: string; grantKind: string; required: boolean }>;
  workflows: PluginWorkflowDeclaration[];
}

export interface P2PluginReleaseManifest {
  packageContract: {
    rootDirectory: string;
    runtimeEntrypoint: string;
    executionMode: 'PLUGIN_RUNNER';
    ipcProtocol: 'gcac.plugin-runner/v1';
  };
  plugins: P2PluginReleaseEntry[];
}

export interface BuiltinPluginRegistryEntry {
  pluginId: CanonicalPluginId;
  version: string;
  packageDirectory: string;
  runtimeEntrypoint: 'runtime/index.js';
  runtimeEntrypointPath: string;
  executionMode: 'PLUGIN_RUNNER';
  ipcProtocol: 'gcac.plugin-runner/v1';
  agentSidePlugin: boolean;
  manifest: UnifiedPluginManifestV1;
  capabilities: UnifiedPluginCapabilityDescriptor[];
  hostApiGrants: P2PluginReleaseEntry['hostApiGrants'];
  workflows: PluginWorkflowDeclaration[];
  packageSha256: string;
  manifestSha256: string;
  resourceSha256: Record<string, string>;
  resourceHash: string;
}

export interface BuiltinPluginRegistryOptions {
  allowUnreleased?: boolean;
}

/**
 * P2 内置插件注册表只登记可验证的包元数据和 Runner 入口路径。
 * 宿主不会 import、require 或实例化 runtime/index.js；真正的模块加载由 Runner 子进程完成。
 */
export class BuiltinPluginRegistry {
  private readonly entries = new Map<string, BuiltinPluginRegistryEntry>();

  constructor(
    private readonly loader: BuiltinUnifiedPluginLoader = new BuiltinUnifiedPluginLoader(),
    private readonly releaseManifest: P2PluginReleaseManifest = readReleaseManifest(),
  ) {}

  async refresh(options: BuiltinPluginRegistryOptions = {}): Promise<BuiltinPluginRegistryEntry[]> {
    this.entries.clear();
    const releaseByDirectory = new Map(this.releaseManifest.plugins.map((entry) => [entry.packageDirectory, entry]));
    const packages = await this.loader.loadPackages();
    for (const pluginPackage of packages) {
      const release = releaseByDirectory.get(basename(pluginPackage.packageDirectory));
      if (!release) throw new AppError('VALIDATION_FAILED', '内置插件包未进入 P2 发布清单', { packageDirectory: pluginPackage.packageDirectory });
      if (!options.allowUnreleased && release.packageDigest?.status !== 'P2_RELEASED') continue;
      if (options.allowUnreleased && release.pluginVersion !== pluginIdentity(pluginPackage.manifest).version) continue;
      const entry = buildRegistryEntry(pluginPackage, release, this.releaseManifest);
      const key = identityKey(entry.pluginId, entry.version);
      if (this.entries.has(key)) throw new AppError('VALIDATION_FAILED', '内置插件 Registry 存在重复身份', { key });
      this.entries.set(key, entry);
    }
    return this.list();
  }

  list(): BuiltinPluginRegistryEntry[] {
    return [...this.entries.values()].sort((left, right) => left.pluginId.localeCompare(right.pluginId) || left.version.localeCompare(right.version));
  }

  get(pluginId: string, version: string): BuiltinPluginRegistryEntry {
    if (!canonicalPluginIds.includes(pluginId as CanonicalPluginId)) {
      throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', '插件身份不是当前 Canonical Plugin ID', { pluginId });
    }
    const entry = this.entries.get(identityKey(pluginId, version));
    if (!entry) throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', '未找到固定的 P2 PluginVersion', { pluginId, version });
    return cloneRegistryEntry(entry);
  }

  getWorkflowDeclarations(pluginId: string, version: string): PluginWorkflowDeclaration[] {
    return this.get(pluginId, version).workflows;
  }

  /** 返回发布清单中的声明，不依赖包是否已经刷新到运行时 Registry。 */
  getDeclaredWorkflowDeclarations(pluginId: string, version: string): PluginWorkflowDeclaration[] | undefined {
    const release = this.releaseManifest.plugins.find((entry) => entry.canonicalPluginId === pluginId && entry.pluginVersion === version);
    return release?.workflows.map((workflow) => ({ ...workflow }));
  }
}

function buildRegistryEntry(
  pluginPackage: BuiltinPluginPackage,
  release: P2PluginReleaseEntry,
  releaseManifest: P2PluginReleaseManifest,
): BuiltinPluginRegistryEntry {
  const identity = pluginIdentity(pluginPackage.manifest);
  if (identity.pluginId !== release.canonicalPluginId || identity.version !== release.pluginVersion) {
    throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', 'Manifest 身份或版本与 P2 发布清单不一致', {
      expectedPluginId: release.canonicalPluginId,
      expectedVersion: release.pluginVersion,
      actualPluginId: identity.pluginId,
      actualVersion: identity.version,
    });
  }
  if (basename(pluginPackage.packageDirectory) !== release.packageDirectory) {
    throw new AppError('VALIDATION_FAILED', '插件包目录与发布清单不一致', { packageDirectory: pluginPackage.packageDirectory });
  }
  if (pluginPackage.runtimeEntrypoint !== releaseManifest.packageContract.runtimeEntrypoint
    || pluginPackage.runtimeEntrypointPath === undefined) {
    throw new AppError('PLUGIN_RUNNER_START_FAILED', 'P2 插件缺少固定 Runner 入口 runtime/index.js', { pluginId: identity.pluginId });
  }
  const manifest = validateUnifiedPluginManifest(pluginPackage.manifest);
  const packageSha256 = sha256(pluginPackage.packageContent);
  if (release.packageDigest?.status === 'P2_RELEASED' && release.packageDigest.sha256 !== packageSha256) {
    throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', 'P2 插件包摘要与发布清单不一致', { pluginId: identity.pluginId, version: identity.version });
  }
  const resourceSha256 = hashResources(pluginPackage.resources);
  return {
    pluginId: identity.pluginId as CanonicalPluginId,
    version: identity.version!,
    packageDirectory: pluginPackage.packageDirectory,
    runtimeEntrypoint: 'runtime/index.js',
    runtimeEntrypointPath: pluginPackage.runtimeEntrypointPath,
    executionMode: release.executionMode,
    ipcProtocol: releaseManifest.packageContract.ipcProtocol,
    agentSidePlugin: release.agentSidePlugin,
    manifest,
    capabilities: structuredClone(manifest.capabilities),
    hostApiGrants: structuredClone(release.hostApiGrants),
    workflows: structuredClone(release.workflows),
    packageSha256,
    manifestSha256: sha256(stableJson(pluginPackage.manifest)),
    resourceSha256,
    resourceHash: sha256(JSON.stringify(resourceSha256)),
  };
}

function readReleaseManifest(path = defaultReleaseManifestPath): P2PluginReleaseManifest {
  const candidates = [path, resolve(process.cwd(), 'scripts/architecture/p2-plugin-release-manifest.json'), resolve(process.cwd(), '../scripts/architecture/p2-plugin-release-manifest.json')];
  const actual = candidates.find((candidate) => existsSync(candidate));
  if (!actual) throw new AppError('PLUGIN_RUNNER_START_FAILED', '找不到 P2 插件发布清单');
  const parsed = JSON.parse(readFileSync(actual, 'utf8')) as P2PluginReleaseManifest & { packageContract?: Record<string, unknown> };
  if (parsed.packageContract?.executionMode !== 'PLUGIN_RUNNER' || parsed.packageContract?.ipcProtocol !== 'gcac.plugin-runner/v1') {
    throw new AppError('VALIDATION_FAILED', 'P2 插件发布清单的 Runner 合同无效');
  }
  return parsed;
}

function pluginIdentity(manifest: unknown): { pluginId?: string; version?: string } {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return {};
  const value = manifest as Record<string, unknown>;
  return {
    pluginId: typeof value.pluginId === 'string' ? value.pluginId : undefined,
    version: typeof value.version === 'string' ? value.version : undefined,
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

function cloneRegistryEntry(entry: BuiltinPluginRegistryEntry): BuiltinPluginRegistryEntry {
  return {
    ...entry,
    manifest: structuredClone(entry.manifest),
    capabilities: structuredClone(entry.capabilities),
    hostApiGrants: structuredClone(entry.hostApiGrants),
    workflows: structuredClone(entry.workflows),
    resourceSha256: { ...entry.resourceSha256 },
  };
}
