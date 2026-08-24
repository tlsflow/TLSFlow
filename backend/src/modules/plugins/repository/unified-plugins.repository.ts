import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import type { UnifiedPluginVersionRecord } from '../dto/unified-plugins.dto.js';

export interface UnifiedPluginsRepository {
  saveVersion(record: UnifiedPluginVersionRecord): Promise<UnifiedPluginVersionRecord>;
  findVersion(id: string): Promise<UnifiedPluginVersionRecord | undefined>;
  findByIdentity(tenantId: string, pluginId: string, version: string): Promise<UnifiedPluginVersionRecord | undefined>;
  listVersions(tenantId: string): Promise<UnifiedPluginVersionRecord[]>;
}

export class PgUnifiedPluginsRepository implements UnifiedPluginsRepository {
  constructor(private readonly db: DatabasePort = new PgliteDatabase()) {}

  async saveVersion(record: UnifiedPluginVersionRecord): Promise<UnifiedPluginVersionRecord> {
    await this.db.query(`
      insert into unified_plugin_versions (
        id, tenant_id, plugin_id, plugin_version, source, runtime, scope, trust, support,
        manifest, package_sha256, manifest_sha256, resource_sha256, status,
        permission_approval_status, approved_permissions, validation_report, created_at, updated_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13::jsonb,$14,$15,$16::jsonb,$17::jsonb,$18,$19)
      on conflict (id) do update set
        status = excluded.status,
        permission_approval_status = excluded.permission_approval_status,
        approved_permissions = excluded.approved_permissions,
        validation_report = excluded.validation_report,
        updated_at = excluded.updated_at
    `, [
      record.id, record.tenantId, record.pluginId, record.version, record.source, record.runtime, record.scope,
      record.trust, record.support, JSON.stringify(record.manifest), record.packageSha256, record.manifestSha256,
      JSON.stringify(record.resourceSha256), record.status, record.permissionApprovalStatus,
      JSON.stringify(record.approvedPermissions), JSON.stringify(record.validationReport), record.createdAt, record.updatedAt,
    ]);
    for (const [path, content] of Object.entries(record.resources)) {
      await this.db.query(`
        insert into unified_plugin_resources (plugin_version_id, resource_path, resource_content, resource_sha256, created_at)
        values ($1,$2,$3,$4,$5)
        on conflict (plugin_version_id, resource_path) do nothing
      `, [record.id, path, content, record.resourceSha256[path], record.createdAt]);
    }
    return record;
  }

  async findVersion(id: string): Promise<UnifiedPluginVersionRecord | undefined> {
    const record = toRecord((await this.db.query<UnifiedPluginVersionRow>('select * from unified_plugin_versions where id = $1', [id])).rows[0]);
    return record ? this.withResources(record) : undefined;
  }

  async findByIdentity(tenantId: string, pluginId: string, version: string): Promise<UnifiedPluginVersionRecord | undefined> {
    const record = toRecord((await this.db.query<UnifiedPluginVersionRow>(
      'select * from unified_plugin_versions where tenant_id = $1 and plugin_id = $2 and plugin_version = $3',
      [tenantId, pluginId, version],
    )).rows[0]);
    return record ? this.withResources(record) : undefined;
  }

  async listVersions(tenantId: string): Promise<UnifiedPluginVersionRecord[]> {
    const result = await this.db.query<UnifiedPluginVersionRow>(
      'select * from unified_plugin_versions where tenant_id = $1 order by plugin_id, created_at desc',
      [tenantId],
    );
    return Promise.all(result.rows.map(toRecord).filter((record): record is UnifiedPluginVersionRecord => Boolean(record)).map((record) => this.withResources(record)));
  }

  private async withResources(record: UnifiedPluginVersionRecord): Promise<UnifiedPluginVersionRecord> {
    const rows = (await this.db.query<{ resource_path: string; resource_content: string }>(
      'select resource_path, resource_content from unified_plugin_resources where plugin_version_id = $1 order by resource_path',
      [record.id],
    )).rows;
    return { ...record, resources: Object.fromEntries(rows.map((row) => [row.resource_path, row.resource_content])) };
  }
}

interface UnifiedPluginVersionRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  plugin_id: string;
  plugin_version: string;
  source: UnifiedPluginVersionRecord['source'];
  runtime: UnifiedPluginVersionRecord['runtime'];
  scope: UnifiedPluginVersionRecord['scope'];
  trust: UnifiedPluginVersionRecord['trust'];
  support: UnifiedPluginVersionRecord['support'];
  manifest: UnifiedPluginVersionRecord['manifest'];
  package_sha256: string;
  manifest_sha256: string;
  resource_sha256: Record<string, string>;
  status: UnifiedPluginVersionRecord['status'];
  permission_approval_status: UnifiedPluginVersionRecord['permissionApprovalStatus'];
  approved_permissions: string[];
  validation_report: UnifiedPluginVersionRecord['validationReport'];
  created_at: string;
  updated_at: string;
}

function toRecord(row: UnifiedPluginVersionRow | undefined): UnifiedPluginVersionRecord | undefined {
  if (!row) return undefined;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    pluginId: row.plugin_id,
    version: row.plugin_version,
    source: row.source,
    runtime: row.runtime,
    scope: row.scope,
    trust: row.trust,
    support: row.support,
    manifest: row.manifest,
    packageSha256: row.package_sha256,
    manifestSha256: row.manifest_sha256,
    resourceSha256: row.resource_sha256 ?? {},
    resources: {},
    status: row.status,
    permissionApprovalStatus: row.permission_approval_status,
    approvedPermissions: row.approved_permissions ?? [],
    validationReport: row.validation_report,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
