import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import type { UnifiedPluginReferenceCounts, UnifiedPluginVersionRecord } from '../dto/unified-plugins.dto.js';

export interface UnifiedPluginsRepository {
  saveVersion(record: UnifiedPluginVersionRecord): Promise<UnifiedPluginVersionRecord>;
  findVersion(id: string): Promise<UnifiedPluginVersionRecord | undefined>;
  findByIdentity(tenantId: string, pluginId: string, version: string): Promise<UnifiedPluginVersionRecord | undefined>;
  listVersions(tenantId: string): Promise<UnifiedPluginVersionRecord[]>;
  listVersionsBySource?(source: UnifiedPluginVersionRecord['source']): Promise<UnifiedPluginVersionRecord[]>;
  listAccessibleVersions?(tenantId: string): Promise<UnifiedPluginVersionRecord[]>;
  countReferences?(tenantId: string, pluginVersionId: string): Promise<UnifiedPluginReferenceCounts>;
}

export class PgUnifiedPluginsRepository implements UnifiedPluginsRepository {
  constructor(private readonly db: DatabasePort = new PgliteDatabase()) {}

  async saveVersion(record: UnifiedPluginVersionRecord): Promise<UnifiedPluginVersionRecord> {
    await this.db.transaction(async (tx) => {
      await tx.query(`
        insert into unified_plugin_versions (
          id, tenant_id, owner_type, owner_id, plugin_id, plugin_version, source, runtime, scope, trust, support,
          manifest, package_sha256, manifest_sha256, resource_sha256, status,
          permission_approval_status, approved_permissions, validation_report, created_at, updated_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15::jsonb,$16,$17,$18::jsonb,$19::jsonb,$20,$21)
        on conflict (id) do update set
          owner_type = excluded.owner_type,
          owner_id = excluded.owner_id,
          status = excluded.status,
          permission_approval_status = excluded.permission_approval_status,
          approved_permissions = excluded.approved_permissions,
          validation_report = excluded.validation_report,
          updated_at = excluded.updated_at
      `, [
        record.id, record.tenantId, record.ownerType, record.ownerId ?? null, record.pluginId, record.version,
        record.source, record.runtime, record.scope, record.trust, record.support, JSON.stringify(record.manifest),
        record.packageSha256, record.manifestSha256, JSON.stringify(record.resourceSha256), record.status,
        record.permissionApprovalStatus, JSON.stringify(record.approvedPermissions), JSON.stringify(record.validationReport),
        record.createdAt, record.updatedAt,
      ]);
      for (const [path, content] of Object.entries(record.resources)) {
        await tx.query(`
          insert into unified_plugin_resources (plugin_version_id, resource_path, resource_content, resource_sha256, created_at)
          values ($1,$2,$3,$4,$5)
          on conflict (plugin_version_id, resource_path) do nothing
        `, [record.id, path, content, record.resourceSha256[path], record.createdAt]);
      }
    });
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

  async listVersionsBySource(source: UnifiedPluginVersionRecord['source']): Promise<UnifiedPluginVersionRecord[]> {
    const result = await this.db.query<UnifiedPluginVersionRow>(
      'select * from unified_plugin_versions where source = $1 order by plugin_id, created_at desc',
      [source],
    );
    return Promise.all(result.rows.map(toRecord).filter((record): record is UnifiedPluginVersionRecord => Boolean(record)).map((record) => this.withResources(record)));
  }

  async listAccessibleVersions(tenantId: string): Promise<UnifiedPluginVersionRecord[]> {
    const result = await this.db.query<UnifiedPluginVersionRow>(
      `select * from unified_plugin_versions
        where tenant_id = $1 or source = 'BUILTIN'
        order by plugin_id, created_at desc`,
      [tenantId],
    );
    return Promise.all(result.rows.map(toRecord).filter((record): record is UnifiedPluginVersionRecord => Boolean(record)).map((record) => this.withResources(record)));
  }

  async countReferences(tenantId: string, pluginVersionId: string): Promise<UnifiedPluginReferenceCounts> {
    const row = (await this.db.query<{
      bindings: number | string;
      assignments: number | string;
      hosts: number | string;
      service_assets: number | string;
      device_assets: number | string;
    }>(`
      select
        (select count(*) from unified_plugin_bindings
          where tenant_id=$1 and plugin_version_id=$2 and status='ACTIVE') as bindings,
        (select count(*) from plugin_capability_assignments
          where tenant_id=$1 and plugin_version_id=$2 and status='ACTIVE') as assignments,
        (select count(*) from pg_hosts host
          where host.tenant_id=$1
            and exists (
              select 1 from jsonb_array_elements(host.management_channels) channel
              where channel->>'type'='PLUGIN'
                and channel->'metadata'->>'pluginVersionId'=$2
            )) as hosts,
        (select count(*) from pg_service_assets asset
          where asset.tenant_id=$1 and asset.deleted_at is null
            and asset.metadata->>'pluginVersionId'=$2) as service_assets,
        (select count(*) from pg_device_assets asset
          where asset.tenant_id=$1 and asset.plugin_version_id=$2) as device_assets
    `, [tenantId, pluginVersionId])).rows[0];
    const counts = {
      bindings: toCount(row?.bindings),
      assignments: toCount(row?.assignments),
      hosts: toCount(row?.hosts),
      serviceAssets: toCount(row?.service_assets),
      deviceAssets: toCount(row?.device_assets),
    };
    return { ...counts, total: Object.values(counts).reduce((sum, value) => sum + value, 0) };
  }

  private async withResources(record: UnifiedPluginVersionRecord): Promise<UnifiedPluginVersionRecord> {
    const rows = (await this.db.query<{ resource_path: string; resource_content: string }>(
      'select resource_path, resource_content from unified_plugin_resources where plugin_version_id = $1 order by resource_path',
      [record.id],
    )).rows;
    return { ...record, resources: Object.fromEntries(rows.map((row) => [row.resource_path, row.resource_content])) };
  }
}

function toCount(value: number | string | undefined): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

interface UnifiedPluginVersionRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  owner_type: UnifiedPluginVersionRecord['ownerType'];
  owner_id?: string;
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
    ownerType: row.owner_type ?? (row.source === 'BUILTIN' ? 'SYSTEM' : 'TENANT'),
    ...(row.owner_id ? { ownerId: row.owner_id } : {}),
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
