import type { DatabasePort } from '../../../database/database-port.js';
import { AppError } from '../../../common/errors/app-error.js';
import { compareSemanticVersions } from './unified-plugins.application-service.js';
import type { SwitchUnifiedPluginVersionInput, SwitchUnifiedPluginVersionResult } from '../dto/unified-plugins.dto.js';

export class BuiltinPluginCompatibilityUpgradeService {
  constructor(private readonly db: DatabasePort) {}

  async upgradePatchLine(
    tenantId: string,
    targetPluginVersionId: string,
    pluginId: string,
    targetVersion: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const target = await requireBuiltinVersion(tx, tenantId, targetPluginVersionId, pluginId, targetVersion);
      const targetLine = semanticVersionLine(targetVersion);
      const sources = (await tx.query<{ id: string; plugin_version: string }>(
        `select id, plugin_version from unified_plugin_versions
          where plugin_id=$1 and id<>$2 and source='BUILTIN'`,
        [pluginId, targetPluginVersionId],
      )).rows.filter((source) => (
        semanticVersionLine(source.plugin_version) === targetLine
        && compareSemanticVersions(source.plugin_version, targetVersion) < 0
      ));

      for (const source of sources) {
        await tx.query(
          `update pg_hosts
            set management_channels=(
              select coalesce(jsonb_agg(
                case when channel->>'type'='PLUGIN' and channel->'metadata'->>'pluginVersionId'=$1
                  then jsonb_set(channel, '{metadata,pluginVersionId}', to_jsonb($2::text), true)
                  else channel end
              ), '[]'::jsonb)
              from jsonb_array_elements(management_channels) channel
            ), updated_at=$3, version=version+1
            where exists (
              select 1 from jsonb_array_elements(management_channels) channel
              where channel->>'type'='PLUGIN' and channel->'metadata'->>'pluginVersionId'=$1
            )`,
          [source.id, target.id, new Date().toISOString()],
        );
        await tx.query(
          `update pg_service_assets set metadata=jsonb_set(metadata, '{pluginVersionId}', to_jsonb($1::text), true),
             updated_at=$2, version=version+1
            where metadata->>'pluginVersionId'=$3`,
          [target.id, new Date().toISOString(), source.id],
        );
        await tx.query(
          `update unified_plugin_bindings set plugin_version_id=$1, updated_at=$2
            where plugin_version_id=$3`,
          [target.id, new Date().toISOString(), source.id],
        );
        await tx.query(
          `update plugin_capability_assignments set plugin_version_id=$1, updated_at=$2
            where plugin_version_id=$3`,
          [target.id, new Date().toISOString(), source.id],
        );
        await tx.query(
          `update pg_device_assets set plugin_version_id=$1, updated_at=$2, version=version+1
            where plugin_version_id=$3`,
          [target.id, new Date().toISOString(), source.id],
        );
      }
    });
  }

  async switchVersion(
    tenantId: string,
    input: SwitchUnifiedPluginVersionInput,
  ): Promise<SwitchUnifiedPluginVersionResult> {
    return this.db.transaction(async (tx) => {
      const target = await requireAccessibleEnabledVersion(tx, tenantId, input);
      const sourceIds = await listReferencedPluginVersionIds(tx, tenantId, input.pluginId, target.id);
      if (input.expectedCurrentPluginVersionId) {
        if (!sourceIds.includes(input.expectedCurrentPluginVersionId) || sourceIds.some((id) => id !== input.expectedCurrentPluginVersionId)) {
          throw new AppError('RESOURCE_VERSION_CONFLICT', '插件当前版本已变化，请重新读取后再切换', {
            pluginId: input.pluginId,
            expectedCurrentPluginVersionId: input.expectedCurrentPluginVersionId,
            actualPluginVersionIds: sourceIds,
          });
        }
      }
      const sourceVersionId = input.expectedCurrentPluginVersionId ?? sourceIds.find((id) => id !== target.id) ?? target.id;
      const changed = {
        bindings: await updateReferences(tx, `
          update unified_plugin_bindings
             set plugin_version_id=$1, updated_at=$2, version=version+1
           where tenant_id=$3 and plugin_version_id = any($4::text[]) and status='ACTIVE'
           returning id
        `, target.id, tenantId, sourceIds),
        assignments: await updateReferences(tx, `
          update plugin_capability_assignments
             set plugin_version_id=$1, updated_at=$2
           where tenant_id=$3 and plugin_version_id = any($4::text[]) and status='ACTIVE'
           returning id
        `, target.id, tenantId, sourceIds),
        hosts: await updateReferences(tx, `
          update pg_hosts host
             set management_channels=(
               select coalesce(jsonb_agg(
                 case when channel->>'type'='PLUGIN'
                   and channel->'metadata'->>'pluginVersionId' = any($4::text[])
                   then jsonb_set(channel, '{metadata,pluginVersionId}', to_jsonb($1::text), true)
                   else channel end
               ), '[]'::jsonb)
               from jsonb_array_elements(host.management_channels) channel
             ), updated_at=$2, version=version+1
           where host.tenant_id=$3
             and exists (
               select 1 from jsonb_array_elements(host.management_channels) channel
               where channel->>'type'='PLUGIN'
                 and channel->'metadata'->>'pluginVersionId' = any($4::text[])
             )
           returning host.id
        `, target.id, tenantId, sourceIds),
        serviceAssets: await updateReferences(tx, `
          update pg_service_assets
             set metadata=jsonb_set(metadata, '{pluginVersionId}', to_jsonb($1::text), true),
                 updated_at=$2, version=version+1
           where tenant_id=$3 and deleted_at is null
             and metadata->>'pluginVersionId' = any($4::text[])
           returning id
        `, target.id, tenantId, sourceIds),
        deviceAssets: await updateReferences(tx, `
          update pg_device_assets
             set plugin_version_id=$1, updated_at=$2, version=version+1
           where tenant_id=$3 and plugin_version_id = any($4::text[])
           returning service_asset_id
        `, target.id, tenantId, sourceIds),
      };
      return {
        pluginId: input.pluginId,
        fromPluginVersionId: sourceVersionId,
        toPluginVersionId: target.id,
        changed,
        switchedAt: new Date().toISOString(),
      };
    });
  }
}

async function requireAccessibleEnabledVersion(
  db: DatabasePort,
  tenantId: string,
  input: SwitchUnifiedPluginVersionInput,
): Promise<{ id: string }> {
  const target = (await db.query<{ id: string; tenant_id: string; plugin_id: string; source: string; status: string }>(
    `select id, tenant_id, plugin_id, source, status
       from unified_plugin_versions
      where id=$1`,
    [input.targetPluginVersionId],
  )).rows[0];
  if (!target || (target.tenant_id !== tenantId && target.source !== 'BUILTIN')) {
    throw new AppError('RESOURCE_NOT_FOUND', '目标插件版本不存在或当前租户不可见', { pluginVersionId: input.targetPluginVersionId });
  }
  if (target.plugin_id !== input.pluginId) {
    throw new AppError('VALIDATION_FAILED', '目标插件版本与 pluginId 不一致', { pluginId: input.pluginId, pluginVersionId: target.id });
  }
  if (target.status !== 'ENABLED') {
    throw new AppError('VALIDATION_FAILED', '只有已启用插件版本可以切换', { pluginVersionId: target.id, status: target.status });
  }
  return target;
}

async function listReferencedPluginVersionIds(
  db: DatabasePort,
  tenantId: string,
  pluginId: string,
  targetPluginVersionId: string,
): Promise<string[]> {
  const rows = (await db.query<{ id: string }>(`
    select distinct reference.plugin_version_id as id
      from (
        select binding.plugin_version_id
          from unified_plugin_bindings binding
          join unified_plugin_versions plugin on plugin.id=binding.plugin_version_id
         where binding.tenant_id=$1 and binding.status='ACTIVE' and plugin.plugin_id=$2
        union
        select assignment.plugin_version_id
          from plugin_capability_assignments assignment
          join unified_plugin_versions plugin on plugin.id=assignment.plugin_version_id
         where assignment.tenant_id=$1 and assignment.status='ACTIVE' and plugin.plugin_id=$2
        union
        select plugin.id
          from pg_hosts host
          join unified_plugin_versions plugin on plugin.plugin_id=$2
         where host.tenant_id=$1
           and exists (
             select 1 from jsonb_array_elements(host.management_channels) channel
             where channel->>'type'='PLUGIN'
               and channel->'metadata'->>'pluginVersionId'=plugin.id
           )
        union
        select plugin.id
          from pg_service_assets asset
          join unified_plugin_versions plugin on plugin.plugin_id=$2
         where asset.tenant_id=$1 and asset.deleted_at is null
           and asset.metadata->>'pluginVersionId'=plugin.id
        union
        select device.plugin_version_id
          from pg_device_assets device
          join unified_plugin_versions plugin on plugin.id=device.plugin_version_id
         where device.tenant_id=$1 and plugin.plugin_id=$2
      ) reference
     where reference.plugin_version_id <> $3
  `, [tenantId, pluginId, targetPluginVersionId])).rows;
  return rows.map((row) => row.id);
}

async function updateReferences(
  db: DatabasePort,
  sql: string,
  targetPluginVersionId: string,
  tenantId: string,
  sourceIds: string[],
): Promise<number> {
  if (sourceIds.length === 0) return 0;
  const result = await db.query<{ id?: string; service_asset_id?: string }>(
    sql,
    [targetPluginVersionId, new Date().toISOString(), tenantId, sourceIds],
  );
  return result.rows.length;
}

async function requireBuiltinVersion(
  db: DatabasePort,
  tenantId: string,
  pluginVersionId: string,
  pluginId: string,
  expectedVersion: string,
): Promise<{ id: string }> {
  const version = (await db.query<{ id: string }>(
    `select id from unified_plugin_versions
      where id=$1 and tenant_id=$2 and plugin_id=$3 and plugin_version=$4 and source='BUILTIN'`,
    [pluginVersionId, tenantId, pluginId, expectedVersion],
  )).rows[0];
  if (!version) {
    throw new AppError('RESOURCE_NOT_FOUND', '内置插件目标版本不存在', {
      pluginVersionId,
      pluginId,
      expectedVersion,
    });
  }
  return version;
}

function semanticVersionLine(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new AppError('VALIDATION_FAILED', '内置插件版本不是标准 SemVer', { version });
  return `${match[1]}.${match[2]}`;
}
