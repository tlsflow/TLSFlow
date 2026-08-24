import type { DatabasePort } from '../../../database/database-port.js';
import { AppError } from '../../../common/errors/app-error.js';
import { compareSemanticVersions } from './unified-plugins.application-service.js';

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
          where tenant_id=$1 and plugin_id=$2 and id<>$3 and source='BUILTIN'`,
        [tenantId, pluginId, targetPluginVersionId],
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
            where tenant_id=$4 and exists (
              select 1 from jsonb_array_elements(management_channels) channel
              where channel->>'type'='PLUGIN' and channel->'metadata'->>'pluginVersionId'=$1
            )`,
          [source.id, target.id, new Date().toISOString(), tenantId],
        );
        await tx.query(
          `update pg_service_assets set metadata=jsonb_set(metadata, '{pluginVersionId}', to_jsonb($1::text), true),
             updated_at=$2, version=version+1
            where tenant_id=$3 and metadata->>'pluginVersionId'=$4`,
          [target.id, new Date().toISOString(), tenantId, source.id],
        );
        await tx.query(
          `update unified_plugin_bindings set plugin_version_id=$1, updated_at=$2
            where tenant_id=$3 and plugin_version_id=$4`,
          [target.id, new Date().toISOString(), tenantId, source.id],
        );
        await tx.query(
          `update plugin_capability_assignments set plugin_version_id=$1, updated_at=$2
            where tenant_id=$3 and plugin_version_id=$4`,
          [target.id, new Date().toISOString(), tenantId, source.id],
        );
        await tx.query(
          `update pg_device_assets set plugin_version_id=$1, updated_at=$2, version=version+1
            where tenant_id=$3 and plugin_version_id=$4`,
          [target.id, new Date().toISOString(), tenantId, source.id],
        );
      }
    });
  }
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
