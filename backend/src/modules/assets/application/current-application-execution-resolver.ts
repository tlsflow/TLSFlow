import { compareSemVer } from '../../../common/version.js';
import type { UnifiedPluginVersionRecord } from '../../plugins/dto/unified-plugins.dto.js';

/** 应用执行当前版本的唯一选择规则；配置身份永远不包含版本 ID。 */
export class CurrentApplicationExecutionResolver {
  resolvePluginVersion(tenantId: string, pluginId: string, versions: UnifiedPluginVersionRecord[]): UnifiedPluginVersionRecord | undefined {
    return [...versions.filter((version) => version.pluginId === pluginId && version.status === 'ENABLED')].sort((left, right) =>
      Number(left.tenantId !== tenantId) - Number(right.tenantId !== tenantId)
      || compareSemVer(right.version, left.version)
      || right.updatedAt.localeCompare(left.updatedAt)
      || right.id.localeCompare(left.id)
    )[0];
  }

  select<T extends { tenant_id: string; plugin_version: string; updated_at: string | Date; id: string; plugin_status?: string }>(tenantId: string, candidates: T[]): T | undefined {
    return [...candidates].sort((left, right) =>
      Number((left.plugin_status ?? 'ENABLED') !== 'ENABLED') - Number((right.plugin_status ?? 'ENABLED') !== 'ENABLED')
      || Number(left.tenant_id !== tenantId) - Number(right.tenant_id !== tenantId)
      || compareSemVer(String(right.plugin_version), String(left.plugin_version))
      || new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
      || String(right.id).localeCompare(String(left.id))
    )[0];
  }
}

export const currentApplicationExecutionResolver = new CurrentApplicationExecutionResolver();
