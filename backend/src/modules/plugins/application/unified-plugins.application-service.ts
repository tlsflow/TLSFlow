import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import { newId } from '../../../shared/id.js';
import type {
  ImportUnifiedPluginVersionInput,
  UnifiedPluginCatalogItem,
  UnifiedPluginManifestV1,
  UnifiedPluginSource,
  UnifiedPluginUpgradeDiff,
  UnifiedPluginValidationReport,
  UnifiedPluginVersionGroup,
  UnifiedPluginVersionManagementDetail,
  UnifiedPluginVersionSummary,
  UnifiedPluginWorkflowVersionSummary,
  UnifiedPluginVersionRecord,
} from '../dto/unified-plugins.dto.js';
import { PgUnifiedPluginsRepository, type UnifiedPluginsRepository } from '../repository/unified-plugins.repository.js';
import type { PluginWorkflowBindingsRepositoryPort } from '../repository/plugin-workflow-bindings.repository.js';
import { assertUnifiedPluginResources, validateUnifiedPluginManifest } from '../schema/unified-plugins.schema.js';
import { PluginPackageResourcesService } from './plugin-package-resources.service.js';
import { PluginLocaleService } from '../locales/plugin-locale.service.js';
import { PluginCapabilityRegistry } from '../capabilities/plugin-capability.registry.js';
import { ApplicationOnboardingRecipeLoader } from '../../application-onboarding/recipe/application-onboarding-recipe.loader.js';
import { structuredLogger } from '../../../common/logging/structured-logger.js';

export class UnifiedPluginsApplicationService {
  constructor(
    private readonly repository: UnifiedPluginsRepository = new PgUnifiedPluginsRepository(),
    private readonly packageResources = new PluginPackageResourcesService(),
    private readonly capabilityRegistry = new PluginCapabilityRegistry(),
    private readonly workflowBindings?: PluginWorkflowBindingsRepositoryPort,
  ) {}

  async importVersion(
    tenantId: string,
    input: ImportUnifiedPluginVersionInput,
    sourceChannel: UnifiedPluginSource = 'USER',
  ): Promise<UnifiedPluginVersionRecord> {
    const manifest = validateUnifiedPluginManifest(input.manifest);
    assertSupportedPluginManifest(manifest);
    manifest.capabilities.forEach((capability) => this.capabilityRegistry.validate(capability));
    if (manifest.source !== sourceChannel) {
      throw new AppError('VALIDATION_FAILED', '插件来源由安装通道决定，不能由 Manifest 伪造', {
        declaredSource: manifest.source,
        sourceChannel,
      });
    }
    const resources = input.resources ?? {};
    assertUnifiedPluginResources(manifest, resources);
    const validatedResources = this.packageResources.validate(manifest, resources);
    // 接入配方不能等到用户打开目录时才失败；导入即冻结所有资源、能力和 Locale 引用。
    new ApplicationOnboardingRecipeLoader().loadOptional({
      id: 'plugin-import-validation',
      pluginId: manifest.pluginId,
      version: manifest.version,
      manifest,
      resources,
    });
    const manifestJson = stableJson(manifest);
    const manifestSha256 = sha256(manifestJson);
    const resourceSha256 = Object.fromEntries(Object.entries(resources).sort(([left], [right]) => left.localeCompare(right)).map(
      ([path, content]) => [path, sha256(content)],
    ));
    const packageSha256 = sha256(input.packageContent ?? stableJson({ manifest, resources: resourceSha256 }));
    const existing = await this.repository.findByIdentity(tenantId, manifest.pluginId, manifest.version);
    if (existing) {
      if (existing.packageSha256 !== packageSha256 || existing.manifestSha256 !== manifestSha256) {
        throw new AppError('RESOURCE_VERSION_CONFLICT', '同一插件版本不可覆盖', { pluginId: manifest.pluginId, version: manifest.version });
      }
      // 用户插件发现后只保留手动启用边界；兼容刷新前已经落库的待审批记录。
      if (sourceChannel === 'USER') {
        const normalized = normalizeUserPluginLifecycle(existing);
        if (normalized !== existing) return this.repository.saveVersion(normalized);
      }
      return existing;
    }
    if (sourceChannel === 'USER') {
      const previous = (await this.repository.listVersions(tenantId))
        .filter((version) => version.source === 'USER' && version.pluginId === manifest.pluginId)
        .sort((left, right) => compareSemanticVersions(right.version, left.version))[0];
      if (previous && compareSemanticVersions(manifest.version, previous.version) <= 0) {
        throw new AppError('VALIDATION_FAILED', '用户插件新版本必须高于已导入版本', {
          pluginId: manifest.pluginId,
          previousVersion: previous.version,
          nextVersion: manifest.version,
        });
      }
    }
    const requiredPermissions = sourceChannel === 'USER' ? [] : requiredApprovalPermissions(manifest);
    const permissionApprovalStatus = requiredPermissions.length === 0 ? 'NOT_REQUIRED' : 'PENDING';
    const validationReport: UnifiedPluginValidationReport = {
      valid: true,
      errors: [],
      warnings: validatedResources.locales
        ? Object.entries(validatedResources.locales.coverage)
          .filter(([, coverage]) => coverage < 100)
          .map(([locale, coverage]) => ({ code: 'PLUGIN_LOCALE_COVERAGE_INCOMPLETE', path: `resources.locales.${locale}`, message: `翻译覆盖率 ${coverage}%` }))
        : [],
      manifestSha256,
      resourceSha256,
    };
    const now = new Date().toISOString();
    return this.repository.saveVersion({
      id: newId('uplgv'),
      tenantId,
      ownerType: sourceChannel === 'BUILTIN' ? 'SYSTEM' : 'TENANT',
      ...(sourceChannel === 'BUILTIN' ? {} : { ownerId: tenantId }),
      pluginId: manifest.pluginId,
      version: manifest.version,
      source: manifest.source,
      runtime: manifest.runtime,
      scope: manifest.scope,
      trust: manifest.trust,
      support: manifest.support,
      manifest,
      packageSha256,
      manifestSha256,
      resourceSha256,
      resources,
      status: permissionApprovalStatus === 'PENDING' ? 'PENDING_APPROVAL' : 'DISABLED',
      permissionApprovalStatus,
      approvedPermissions: sourceChannel === 'USER' ? uniquePermissions(manifest.permissions) : [],
      validationReport,
      createdAt: now,
      updatedAt: now,
    });
  }

  async listVersions(tenantId: string): Promise<UnifiedPluginVersionRecord[]> {
    return (await this.repository.listVersions(tenantId)).filter((version) => isSupportedPluginRuntime(version.runtime));
  }

  async listBuiltinVersions(): Promise<UnifiedPluginVersionRecord[]> {
    const versions = await this.repository.listVersionsBySource('BUILTIN');
    return versions.filter((version) => isSupportedPluginRuntime(version.runtime));
  }

  async listVersionGroups(tenantId: string): Promise<UnifiedPluginVersionGroup[]> {
    const versions = await this.listAccessibleVersions(tenantId);
    const summaries = await Promise.all(versions.map((version) => this.toVersionSummary(tenantId, version)));
    const grouped = new Map<string, UnifiedPluginVersionSummary[]>();
    for (const summary of summaries) grouped.set(summary.pluginId, [...(grouped.get(summary.pluginId) ?? []), summary]);
    return [...grouped.entries()].map(([pluginId, items]) => {
      const ordered = items.sort((left, right) => compareSemanticVersions(right.version, left.version) || right.id.localeCompare(left.id));
      const sources = new Set(ordered.map((item) => item.source));
      const source: UnifiedPluginVersionGroup['source'] = sources.size === 1
        ? (sources.has('BUILTIN') ? 'BUILTIN' : 'USER')
        : 'MIXED';
      const active = ordered
        .filter((item) => item.status === 'ENABLED' && item.references.total > 0)
        .sort((left, right) => right.references.total - left.references.total || compareSemanticVersions(right.version, left.version))[0];
      return {
        pluginId,
        source,
        ...(active ? { activeVersionId: active.id } : {}),
        versions: ordered,
      };
    }).sort((left, right) => left.pluginId.localeCompare(right.pluginId));
  }

  async getVersionManagementDetail(tenantId: string, pluginVersionId: string): Promise<UnifiedPluginVersionManagementDetail> {
    const version = await this.getAccessibleVersion(tenantId, pluginVersionId);
    const summary = await this.toVersionSummary(tenantId, version);
    return {
      ...summary,
      tenantId: version.tenantId,
      trust: version.trust,
      support: version.support,
      manifest: version.manifest,
      validationReport: version.validationReport,
      visibleToTenant: true,
    };
  }

  async getVersion(id: string): Promise<UnifiedPluginVersionRecord> {
    const record = await this.repository.findVersion(id);
    if (!record) throw new AppError('RESOURCE_NOT_FOUND', '统一插件版本不存在', { id });
    assertSupportedPluginManifest(record.manifest);
    return record;
  }

  async getVersionForTenant(tenantId: string, pluginVersionId: string): Promise<UnifiedPluginVersionRecord> {
    return this.getAccessibleVersion(tenantId, pluginVersionId);
  }

  async getUiResources(id: string, locale: string): Promise<{
    pluginVersionId: string;
    forms: ReturnType<PluginPackageResourcesService['validate']>['forms'];
    presentations: ReturnType<PluginPackageResourcesService['validate']>['presentations'];
    locale: { requested: string; resolved: string; defaultLocale: string; coverage: Record<string, number>; messages: Record<string, string> } | undefined;
  }> {
    const record = await this.getVersion(id);
    return this.buildUiResources(record, locale);
  }

  async getVersionWithUiResourcesForTenant(tenantId: string, pluginVersionId: string, locale: string): Promise<{
    version: UnifiedPluginVersionRecord;
    ui: {
      pluginVersionId: string;
      forms: ReturnType<PluginPackageResourcesService['validate']>['forms'];
      presentations: ReturnType<PluginPackageResourcesService['validate']>['presentations'];
      locale: { requested: string; resolved: string; defaultLocale: string; coverage: Record<string, number>; messages: Record<string, string> } | undefined;
    };
  }> {
    const version = await this.getAccessibleVersion(tenantId, pluginVersionId);
    return { version, ui: this.buildUiResources(version, locale) };
  }

  private buildUiResources(record: UnifiedPluginVersionRecord, locale: string): {
    pluginVersionId: string;
    forms: ReturnType<PluginPackageResourcesService['validate']>['forms'];
    presentations: ReturnType<PluginPackageResourcesService['validate']>['presentations'];
    locale: { requested: string; resolved: string; defaultLocale: string; coverage: Record<string, number>; messages: Record<string, string> } | undefined;
  } {
    const validated = this.packageResources.validate(record.manifest, record.resources);
    const bundle = validated.locales;
    const resolvedLocale = bundle?.messages[locale] ? locale : bundle?.defaultLocale;
    return {
      pluginVersionId: record.id,
      forms: validated.forms,
      presentations: validated.presentations,
      locale: bundle && resolvedLocale ? {
        requested: locale,
        resolved: resolvedLocale,
        defaultLocale: bundle.defaultLocale,
        coverage: bundle.coverage,
        messages: Object.fromEntries(Object.keys(bundle.messages[bundle.defaultLocale] ?? {}).map((key) => [
          key,
          new PluginLocaleService().resolve(bundle, locale, key) ?? key,
        ])),
      } : undefined,
    };
  }

  async approvePermissions(id: string, permissions: string[]): Promise<UnifiedPluginVersionRecord> {
    const record = await this.getVersion(id);
    if (record.source === 'USER') {
      // 兼容旧客户端调用；用户插件没有权限审批状态，仍由管理员单独点击启用。
      return this.repository.saveVersion({
        ...normalizeUserPluginLifecycle(record),
        updatedAt: new Date().toISOString(),
      });
    }
    const declared = new Set(requiredApprovalPermissions(record.manifest));
    const unknown = permissions.filter((permission) => !declared.has(permission));
    if (unknown.length > 0) throw new AppError('PLUGIN_PERMISSION_DENIED', '审批权限超过插件声明范围', { unknown });
    return this.repository.saveVersion({
      ...record,
      approvedPermissions: [...new Set(permissions)],
      permissionApprovalStatus: 'APPROVED',
      status: 'DISABLED',
      updatedAt: new Date().toISOString(),
    });
  }

  async enableVersion(id: string): Promise<UnifiedPluginVersionRecord> {
    const record = await this.getVersion(id);
    const approved = new Set(record.approvedPermissions);
    const missing = record.source === 'USER'
      ? []
      : requiredApprovalPermissions(record.manifest).filter((permission) => !approved.has(permission));
    if (missing.length > 0) throw new AppError('PLUGIN_PERMISSION_DENIED', '插件权限尚未完成审批', { missing });
    // 启用前按目标状态预检；目录运行时仍只允许读取已启用版本。
    // 不能直接传入 DISABLED 记录，否则带配方的插件永远无法完成 DISABLED -> ENABLED 转换。
    new ApplicationOnboardingRecipeLoader().loadOptional({ ...record, status: 'ENABLED' });
    return this.repository.saveVersion({
      ...(record.source === 'USER' ? normalizeUserPluginLifecycle(record) : record),
      status: 'ENABLED',
      updatedAt: new Date().toISOString(),
    });
  }

  async disableVersion(id: string): Promise<UnifiedPluginVersionRecord> {
    const record = await this.getVersion(id);
    return this.repository.saveVersion({ ...record, status: 'DISABLED', updatedAt: new Date().toISOString() });
  }

  async retireVersion(id: string): Promise<UnifiedPluginVersionRecord> {
    const record = await this.getVersion(id);
    if (record.status === 'ENABLED') throw new AppError('RESOURCE_VERSION_CONFLICT', '启用中的插件版本不能直接退休', { id });
    return this.repository.saveVersion({ ...record, status: 'RETIRED', updatedAt: new Date().toISOString() });
  }

  async getUpgradeDiff(fromVersionId: string, toVersionId: string): Promise<UnifiedPluginUpgradeDiff> {
    const [from, to] = await Promise.all([this.getVersion(fromVersionId), this.getVersion(toVersionId)]);
    if (from.pluginId !== to.pluginId) throw new AppError('VALIDATION_FAILED', '只能比较同一插件的版本');
    const capabilityDiff = diffKeys(from.manifest.capabilities.map((item) => item.key), to.manifest.capabilities.map((item) => item.key));
    const permissionDiff = diffKeys(from.manifest.permissions, to.manifest.permissions);
    return {
      pluginId: from.pluginId,
      fromVersionId,
      toVersionId,
      addedCapabilities: capabilityDiff.added,
      removedCapabilities: capabilityDiff.removed,
      addedPermissions: permissionDiff.added,
      removedPermissions: permissionDiff.removed,
      runtimeChanged: from.runtime !== to.runtime,
      scopeChanged: from.scope !== to.scope,
      compatibilityChanged: stableJson(from.manifest.compatibility) !== stableJson(to.manifest.compatibility),
      requiresApproval: permissionDiff.added.length > 0 || from.runtime !== to.runtime || from.scope !== to.scope,
    };
  }

  async listCatalog(
    tenantId: string,
    locale = 'zh-CN',
    filters: { runtime?: UnifiedPluginManifestV1['runtime'] } = {},
  ): Promise<UnifiedPluginCatalogItem[]> {
    const versions = (await this.listAccessibleVersions(tenantId))
      .filter((record) => record.status !== 'RETIRED' && record.status !== 'QUARANTINED')
      .filter((record) => !filters.runtime || record.runtime === filters.runtime);
    const versionsByPlugin = new Map<string, UnifiedPluginVersionRecord[]>();
    for (const record of versions) {
      versionsByPlugin.set(record.pluginId, [...(versionsByPlugin.get(record.pluginId) ?? []), record]);
    }
    const items: UnifiedPluginCatalogItem[] = [];
    for (const [pluginId, pluginVersions] of [...versionsByPlugin.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const ordered = pluginVersions.sort((left, right) => compareSemanticVersions(right.version, left.version) || right.updatedAt.localeCompare(left.updatedAt));
      const item = ordered.map((record) => this.toCatalogItem(record, locale)).find((candidate) => candidate !== undefined);
      if (item) items.push(item);
      else if (ordered.length > 0) {
        structuredLogger.warn('插件目录跳过了全部不可用版本', {
          module: 'plugin-catalog',
          resourceType: 'pluginId',
          resourceId: pluginId,
          details: {
            pluginId,
            candidateVersionIds: ordered.map((record) => record.id),
          },
        });
      }
    }
    return items;
  }

  async listAccessibleVersions(tenantId: string): Promise<UnifiedPluginVersionRecord[]> {
    const versions = await this.repository.listAccessibleVersions(tenantId);
    const byIdentity = new Map<string, UnifiedPluginVersionRecord>();
    for (const version of versions) {
      const key = `${version.pluginId}@${version.version}`;
      const current = byIdentity.get(key);
      if (!current || (version.source === 'BUILTIN' && current.source !== 'BUILTIN') || version.updatedAt > current.updatedAt) {
        byIdentity.set(key, version);
      }
    }
    return [...byIdentity.values()].filter((version) => isSupportedPluginRuntime(version.runtime));
  }

  private async getAccessibleVersion(tenantId: string, pluginVersionId: string): Promise<UnifiedPluginVersionRecord> {
    const version = await this.getVersion(pluginVersionId);
    if (!isUnifiedPluginVersionAccessibleToTenant(version, tenantId)) {
      throw new AppError('RESOURCE_NOT_FOUND', '统一插件版本不存在或当前租户不可见', { pluginVersionId });
    }
    return version;
  }

  private async toVersionSummary(tenantId: string, version: UnifiedPluginVersionRecord): Promise<UnifiedPluginVersionSummary> {
    const workflowVersions = this.workflowBindings
      ? (await this.workflowBindings.list(version.id)).map(toWorkflowVersionSummary)
      : [];
    const references = await this.repository.countReferences(tenantId, version.id);
    return {
      id: version.id,
      pluginId: version.pluginId,
      version: version.version,
      source: version.source,
      runtime: version.runtime,
      scope: version.scope,
      status: version.status,
      packageSha256: version.packageSha256,
      manifestSha256: version.manifestSha256,
      resourceSha256: version.resourceSha256,
      workflowVersions,
      references,
      switchable: version.status === 'ENABLED',
    };
  }

  private toCatalogItem(record: UnifiedPluginVersionRecord, locale: string): UnifiedPluginCatalogItem | undefined {
    try {
      const validatedResources = this.packageResources.validate(record.manifest, record.resources);
      const messages = validatedResources.locales;
      const displayName = messages ? new PluginLocaleService().resolve(messages, locale, record.manifest.displayNameKey) : undefined;
      const description = messages && record.manifest.descriptionKey
        ? new PluginLocaleService().resolve(messages, locale, record.manifest.descriptionKey)
        : undefined;
      const executionSummary = summarizeExecutionResources(record);
      return {
        id: record.id,
        catalogType: 'UNIFIED_PLUGIN' as const,
        pluginId: record.pluginId,
        pluginVersionId: record.id,
        version: record.version,
        name: record.pluginId,
        displayNameKey: record.manifest.displayNameKey,
        descriptionKey: record.manifest.descriptionKey,
        displayName,
        description,
        logoUrl: record.manifest.logoUrl,
        logoSquareUrl: record.manifest.logoSquareUrl,
        tags: [
          ...(record.manifest.compatibility?.productFamilies ?? []),
          ...(record.manifest.compatibility?.frameworkTypes ?? []),
          ...(record.manifest.compatibility?.targetTypes ?? []),
        ],
        platforms: record.manifest.compatibility?.managementMethods ?? [],
        stepCount: executionSummary.stepCount,
        rollbackCount: executionSummary.rollbackCount,
        configuration: executionSummary.configuration,
        source: record.source,
        runtime: record.runtime,
        scope: record.scope,
        trust: record.trust,
        support: record.support,
        packageSha256: record.packageSha256,
        manifestSha256: record.manifestSha256,
        resourceSha256: record.resourceSha256,
        status: record.status,
        capabilities: record.manifest.capabilities,
        compatibility: record.manifest.compatibility,
        detailRef: { pluginVersionId: record.id },
      };
    } catch (error) {
      structuredLogger.warn('插件目录跳过不可用版本', {
        module: 'plugin-catalog',
        resourceType: 'pluginVersion',
        resourceId: record.id,
        details: {
          pluginId: record.pluginId,
          version: record.version,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return undefined;
    }
  }
}

function toWorkflowVersionSummary(binding: {
  capabilityKey: string;
  workflowKey: string;
  workflowResourcePath: string;
  workflowTemplateId: string;
  workflowVersionId: string;
  workflowContentSha256: string;
}): UnifiedPluginWorkflowVersionSummary {
  return {
    capabilityKey: binding.capabilityKey,
    workflowKey: binding.workflowKey,
    workflowResourcePath: binding.workflowResourcePath,
    workflowTemplateId: binding.workflowTemplateId,
    workflowVersionId: binding.workflowVersionId,
    workflowContentSha256: binding.workflowContentSha256,
  };
}

export function unifiedPluginVersionOwnerType(record: UnifiedPluginVersionRecord): 'SYSTEM' | 'TENANT' {
  return record.ownerType ?? (record.source === 'BUILTIN' ? 'SYSTEM' : 'TENANT');
}

export function isUnifiedPluginVersionAccessibleToTenant(record: UnifiedPluginVersionRecord, tenantId: string): boolean {
  return unifiedPluginVersionOwnerType(record) === 'SYSTEM' || record.tenantId === tenantId;
}

function summarizeExecutionResources(record: UnifiedPluginVersionRecord): {
  stepCount: number;
  rollbackCount: number;
  configuration?: UnifiedPluginCatalogItem['configuration'];
} {
  const resourcePaths = record.runtime === 'WORKFLOW_DSL'
    ? Object.values(record.manifest.resources.workflows ?? {})
    : [];
  let stepCount = 0;
  let rollbackCount = 0;
  let configuration: UnifiedPluginCatalogItem['configuration'];
  for (const path of [...new Set(resourcePaths)]) {
    const content = record.resources[path];
    if (!content) continue;
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
      stepCount += steps.length;
      rollbackCount += steps.filter((step) => readStringField(step, 'stage') === 'rollback').length;
    } catch {
      continue;
    }
  }
  return { stepCount, rollbackCount, configuration };
}

const supportedPluginRuntimeValues = ['AGENT_PLAN', 'WORKFLOW_DSL'] as const;
const supportedExecutionResourceKeys = new Set([
  'runtimeEntrypoint',
  'agentPlans',
  'workflows',
  'inputContracts',
  'actionContracts',
  'forms',
  'presentations',
  'locales',
  'onboarding',
  'discoveryMappings',
  'agentDiscoveryMappings',
]);

function isSupportedPluginRuntime(value: UnifiedPluginManifestV1['runtime']): value is typeof supportedPluginRuntimeValues[number] {
  return supportedPluginRuntimeValues.includes(value as typeof supportedPluginRuntimeValues[number]);
}

function assertSupportedPluginManifest(manifest: UnifiedPluginManifestV1): void {
  if (!isSupportedPluginRuntime(manifest.runtime)) {
    throw new AppError('VALIDATION_FAILED', '当前宿主只接受 Agent Plan 或 Workflow DSL 插件');
  }
  const removedResourceKeys = Object.entries(manifest.resources)
    .filter(([key, value]) => !supportedExecutionResourceKeys.has(key) && hasDeclaredResource(value))
    .map(([key]) => key)
    .sort();
  if (removedResourceKeys.length > 0) {
    throw new AppError('VALIDATION_FAILED', '插件包含已删除的宿主执行资源', { resourceKeys: removedResourceKeys });
  }
}

function hasDeclaredResource(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0);
}

function requiredApprovalPermissions(manifest: UnifiedPluginManifestV1): string[] {
  return [...new Set(manifest.permissions)];
}

function uniquePermissions(permissions: string[]): string[] {
  return [...new Set(permissions)];
}

function normalizeUserPluginLifecycle(record: UnifiedPluginVersionRecord): UnifiedPluginVersionRecord {
  const status = record.status === 'PENDING_APPROVAL' ? 'DISABLED' : record.status;
  const approvedPermissions = uniquePermissions(record.manifest.permissions);
  if (
    status === record.status
    && record.permissionApprovalStatus === 'NOT_REQUIRED'
    && stableJson(record.approvedPermissions) === stableJson(approvedPermissions)
  ) return record;
  return {
    ...record,
    status,
    permissionApprovalStatus: 'NOT_REQUIRED',
    approvedPermissions,
    updatedAt: new Date().toISOString(),
  };
}

function readStringField(value: unknown, key: string): string | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>)[key] === 'string'
    ? String((value as Record<string, unknown>)[key])
    : undefined;
}

export function compareSemanticVersions(left: string, right: string): number {
  const [leftCoreText, leftPreRelease = ''] = left.split('+', 1)[0]!.split('-', 2);
  const [rightCoreText, rightPreRelease = ''] = right.split('+', 1)[0]!.split('-', 2);
  const leftCore = leftCoreText!.split('.').map(Number);
  const rightCore = rightCoreText!.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (Number.isFinite(leftCore[index]) ? leftCore[index]! : 0)
      - (Number.isFinite(rightCore[index]) ? rightCore[index]! : 0);
    if (difference !== 0) return difference;
  }
  if (!leftPreRelease && !rightPreRelease) return 0;
  if (!leftPreRelease) return 1;
  if (!rightPreRelease) return -1;
  const leftParts = leftPreRelease.split('.');
  const rightParts = rightPreRelease.split('.');
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : undefined;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : undefined;
    if (leftNumber !== undefined && rightNumber !== undefined) return leftNumber - rightNumber;
    if (leftNumber !== undefined) return -1;
    if (rightNumber !== undefined) return 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

function diffKeys(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const previous = new Set(before);
  const next = new Set(after);
  return {
    added: [...next].filter((item) => !previous.has(item)).sort(),
    removed: [...previous].filter((item) => !next.has(item)).sort(),
  };
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
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
