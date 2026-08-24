import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import { newId } from '../../../shared/id.js';
import type {
  ImportUnifiedPluginVersionInput,
  UnifiedPluginCatalogItem,
  UnifiedPluginSource,
  UnifiedPluginUpgradeDiff,
  UnifiedPluginValidationReport,
  UnifiedPluginVersionRecord,
} from '../dto/unified-plugins.dto.js';
import { PgUnifiedPluginsRepository, type UnifiedPluginsRepository } from '../repository/unified-plugins.repository.js';
import { assertUnifiedPluginResources, validateUnifiedPluginManifest } from '../schema/unified-plugins.schema.js';

export class UnifiedPluginsApplicationService {
  constructor(private readonly repository: UnifiedPluginsRepository = new PgUnifiedPluginsRepository()) {}

  async importVersion(
    tenantId: string,
    input: ImportUnifiedPluginVersionInput,
    sourceChannel: UnifiedPluginSource = 'USER',
  ): Promise<UnifiedPluginVersionRecord> {
    const manifest = validateUnifiedPluginManifest(input.manifest);
    if (manifest.source !== sourceChannel) {
      throw new AppError('VALIDATION_FAILED', '插件来源由安装通道决定，不能由 Manifest 伪造', {
        declaredSource: manifest.source,
        sourceChannel,
      });
    }
    const resources = input.resources ?? {};
    assertUnifiedPluginResources(manifest, resources);
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
      return existing;
    }
    const permissionApprovalStatus = manifest.permissions.length === 0 ? 'NOT_REQUIRED' : 'PENDING';
    const validationReport: UnifiedPluginValidationReport = {
      valid: true,
      errors: [],
      warnings: [],
      manifestSha256,
      resourceSha256,
    };
    const now = new Date().toISOString();
    return this.repository.saveVersion({
      id: newId('uplgv'),
      tenantId,
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
      status: permissionApprovalStatus === 'PENDING' ? 'PENDING_APPROVAL' : 'DISABLED',
      permissionApprovalStatus,
      approvedPermissions: [],
      validationReport,
      createdAt: now,
      updatedAt: now,
    });
  }

  listVersions(tenantId: string): Promise<UnifiedPluginVersionRecord[]> {
    return this.repository.listVersions(tenantId);
  }

  async getVersion(id: string): Promise<UnifiedPluginVersionRecord> {
    const record = await this.repository.findVersion(id);
    if (!record) throw new AppError('RESOURCE_NOT_FOUND', '统一插件版本不存在', { id });
    return record;
  }

  async approvePermissions(id: string, permissions: string[]): Promise<UnifiedPluginVersionRecord> {
    const record = await this.getVersion(id);
    const declared = new Set(record.manifest.permissions);
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
    const missing = record.manifest.permissions.filter((permission) => !approved.has(permission));
    if (missing.length > 0) throw new AppError('PLUGIN_PERMISSION_DENIED', '插件权限尚未完成审批', { missing });
    return this.repository.saveVersion({ ...record, status: 'ENABLED', updatedAt: new Date().toISOString() });
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

  async listCatalog(tenantId: string): Promise<UnifiedPluginCatalogItem[]> {
    return (await this.repository.listVersions(tenantId)).map((record) => ({
      id: record.id,
      catalogType: 'UNIFIED_PLUGIN' as const,
      pluginId: record.pluginId,
      pluginVersionId: record.id,
      version: record.version,
      name: record.pluginId,
      displayNameKey: record.manifest.displayNameKey,
      source: record.source,
      runtime: record.runtime,
      scope: record.scope,
      trust: record.trust,
      support: record.support,
      status: record.status,
      capabilities: record.manifest.capabilities,
      compatibility: record.manifest.compatibility,
      detailRef: { pluginVersionId: record.id },
    }));
  }
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
