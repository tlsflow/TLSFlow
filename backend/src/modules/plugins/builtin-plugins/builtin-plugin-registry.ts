import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { AppError } from '../../../common/errors/app-error.js';
import { structuredLogger, type StructuredLogger } from '../../../common/logging/structured-logger.js';
import { canonicalPluginIds, type CanonicalPluginId } from '../canonical-plugin-id/canonical-plugin-id.registry.js';
import type { UnifiedPluginCapabilityDescriptor, UnifiedPluginManifestV1 } from '../dto/unified-plugins.dto.js';
import { validateUnifiedPluginManifest } from '../schema/unified-plugins.schema.js';
import { validateBuiltinPluginPolicy } from './builtin-plugin-policy.js';
import { BuiltinUnifiedPluginLoader, type BuiltinPluginPackage, type BuiltinPluginScanReport } from './builtin-unified-plugin-loader.js';
import type { PluginWorkflowDeclaration } from '../application/plugin-workflow-declaration-resolver.js';
import type { UnifiedPluginsApplicationService } from '../application/unified-plugins.application-service.js';
import { canonicalResourceHash } from '../../../shared/plugin-resource-hash.js';
import { certificateUpdatePluginIds } from '../canonical-plugin-id/canonical-plugin-id.registry.js';
import { validateCertificateUpdateInputContract } from '../../deployment-inputs/certificate-update/certificate-update.contract.js';

export interface BuiltinPluginRegistryEntry {
  pluginId: CanonicalPluginId;
  version: string;
  packageDirectory: string;
  runtimeEntrypoint?: 'runtime/index.js';
  /** 声明式包没有 Runner 路径，使用空值保持旧 Runner 测试和类型合同可判定。 */
  runtimeEntrypointPath: string;
  executionMode: 'DSL_STEP_ACTION' | 'AGENT_PLAN';
  ipcProtocol?: 'gcac.plugin-runner/v2';
  manifest: UnifiedPluginManifestV1;
  capabilities: UnifiedPluginCapabilityDescriptor[];
  workflows: PluginWorkflowDeclaration[];
  inputContracts?: Record<string, string>;
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
  private lastScanReport: BuiltinPluginScanReport | undefined;

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
    this.lastScanReport = this.loader.getLastScanReport?.();
    const conflictedKeys = new Set<string>();
    for (const pluginPackage of packages) {
      const packageDirectory = basename(pluginPackage.packageDirectory);
      if (this.blockedPackageDirectories.has(packageDirectory)) {
        this.warnFailure('versionGate', '内置插件注册阶段失败，已跳过该插件', identityOfManifest(pluginPackage.manifest), new AppError('RESOURCE_VERSION_CONFLICT', '插件版本不可变检查未通过', {
          packageDirectory,
        }));
        continue;
      }

      let entry: BuiltinPluginRegistryEntry;
      try {
        entry = buildRegistryEntry(pluginPackage);
      } catch (error) {
        this.warnFailure('registry', '内置插件注册阶段失败，已跳过该插件', identityOfManifest(pluginPackage.manifest), error);
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
          this.warnFailure('registry', '内置插件注册阶段失败，已跳过该插件', {
            pluginId: entry.pluginId,
            version: entry.version,
          }, new AppError('RESOURCE_VERSION_CONFLICT', '同一插件版本存在不同包内容', {
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
    await this.retireRemovedBuiltinVersions(service);
    return this.loader.installPackages(service, [...this.packages.values()], { failFast: false });
  }

  /**
   * 数据库已登记但当前源码包已不存在的 BUILTIN 版本记录自动退休，
   * 避免插件目录继续展示已从源码移除的插件（如已退役的内置 CA 插件）。
   * 只处理 source=BUILTIN 的孤儿记录；用户导入版本、仍在源码中的包均不受影响。
   */
  private async retireRemovedBuiltinVersions(service: UnifiedPluginsApplicationService): Promise<void> {
    const scanReport = this.lastScanReport;
    if (!scanReport || scanReport.packageDirectories.length === 0 || scanReport.failedPackageDirectories.length > 0) {
      this.logger.warn('内置插件源码扫描未形成可安全回收的快照，跳过孤儿版本退休', {
        packageDirectories: scanReport?.packageDirectories ?? [],
        failedPackageDirectories: scanReport?.failedPackageDirectories ?? [],
      }, {
        module: 'builtin-plugin-startup',
        resourceType: 'pluginVersion',
      });
      return;
    }
    // 使用所有成功读取的包身份，而不是 Registry 最终快照。
    // 被版本门禁或 Policy 隔离的源码包仍然存在，不能被当作孤儿退休。
    const currentPluginIds = new Set<string>(scanReport.packages.flatMap((pluginPackage) => {
      const pluginId = identityOfManifest(pluginPackage.manifest).pluginId;
      return pluginId ? [pluginId] : [];
    }));
    const builtinVersions = await service.listBuiltinVersions();
    for (const version of builtinVersions) {
      if (currentPluginIds.has(version.pluginId)) continue;
      if (version.status === 'RETIRED' || version.status === 'QUARANTINED') continue;
      try {
        // 启用中的版本不能直接退休，先降级再退休。
        if (version.status === 'ENABLED') await service.disableVersion(version.id);
        await service.retireVersion(version.id);
        this.logger.warn('内置插件源码包已移除，自动退休数据库孤儿版本记录', {
          pluginId: version.pluginId,
          version: version.version,
          pluginVersionId: version.id,
          previousStatus: version.status,
        }, {
          module: 'builtin-plugin-startup',
          resourceType: 'pluginVersion',
          resourceId: version.id,
        });
      } catch (error) {
        this.warnFailure('retireOrphan', '内置插件孤儿版本退休失败，已跳过该记录', {
          pluginId: version.pluginId,
          version: version.version,
        }, error, version.id);
      }
    }
  }

  private warnFailure(
    phase: 'versionGate' | 'registry' | 'retireOrphan',
    message: string,
    identity: { pluginId?: string; version?: string },
    error: unknown,
    resourceId?: string,
  ): void {
    this.logger.warn(message, {
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
}

function buildRegistryEntry(
  pluginPackage: BuiltinPluginPackage,
): BuiltinPluginRegistryEntry {
  assertPackageDirectory(pluginPackage.packageDirectory);
  const manifest = validateUnifiedPluginManifest(pluginPackage.manifest);
  const policy = validateBuiltinPluginPolicy(manifest);
  if (certificateUpdatePluginIds.includes(manifest.pluginId as never)) {
    validateCertificateInputResources(manifest, pluginPackage.resources);
  }
  if (policy.runtimeEntrypoint !== undefined
    && (pluginPackage.runtimeEntrypoint !== policy.runtimeEntrypoint
      || pluginPackage.runtimeEntrypointPath === undefined)) {
    throw new AppError('PLUGIN_RUNNER_START_FAILED', '内置插件缺少固定 Runner 入口 runtime/index.js', { pluginId: manifest.pluginId });
  }
  const packageSha256 = sha256(pluginPackage.packageContent);
  const resourceSha256 = hashResources(pluginPackage.resources);
  return {
    pluginId: policy.pluginId,
    version: manifest.version,
    packageDirectory: pluginPackage.packageDirectory,
    executionMode: policy.executionMode,
    ...(policy.runtimeEntrypoint ? {
      runtimeEntrypoint: policy.runtimeEntrypoint,
      runtimeEntrypointPath: pluginPackage.runtimeEntrypointPath!,
      ipcProtocol: policy.ipcProtocol,
    } : { runtimeEntrypointPath: '' }),
    manifest,
    capabilities: structuredClone(manifest.capabilities),
    workflows: Object.entries(manifest.resources.workflows ?? {}).map(([key, path]) => ({
      key,
      capabilityKey: key,
      path,
    })),
    ...(manifest.resources.inputContracts === undefined
      ? {}
      : { inputContracts: { ...manifest.resources.inputContracts } }),
    packageSha256,
    manifestSha256: sha256(stableJson(pluginPackage.manifest)),
    resourceSha256,
    resourceHash: canonicalResourceHash(resourceSha256),
  };
}

function validateCertificateInputResources(manifest: UnifiedPluginManifestV1, resources: Record<string, string>): void {
  for (const capability of ['certificate.deploy', 'certificate.verify', 'certificate.rollback']) {
    const path = manifest.resources.inputContracts?.[capability];
    const content = path ? resources[path] : undefined;
    if (!path || !content) throw new AppError('VALIDATION_FAILED', '证书更新输入合同资源缺失', { pluginId: manifest.pluginId, capability });
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new AppError('VALIDATION_FAILED', '证书更新输入合同资源不是有效 JSON', { pluginId: manifest.pluginId, capability, cause: error instanceof Error ? error.message : String(error) });
    }
    const contract = validateCertificateUpdateInputContract(parsed);
    if (contract.pluginId !== manifest.pluginId) throw new AppError('VALIDATION_FAILED', '证书输入合同 Plugin ID 与 Manifest 不一致', { pluginId: manifest.pluginId, capability });
  }
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

function identityOfManifest(manifest: unknown): { pluginId?: string; version?: string } {
  const record = manifest && typeof manifest === 'object' && !Array.isArray(manifest)
    ? manifest as Record<string, unknown>
    : {};
  return {
    pluginId: typeof record.pluginId === 'string' ? record.pluginId : undefined,
    version: typeof record.version === 'string' ? record.version : undefined,
  };
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
    ...(entry.inputContracts ? { inputContracts: { ...entry.inputContracts } } : {}),
    resourceSha256: { ...entry.resourceSha256 },
  };
}
