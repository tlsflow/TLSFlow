import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';

export interface CloudServiceResourceV1 {
  apiVersion: 'gcac.cloud-service/v1';
  kind: 'CloudServiceResource';
  stableKey: string;
  pluginId: string;
  pluginVersionId: string;
  provider: string;
  resourceId: string;
  resourceType: string;
  region: string;
  displayName?: string;
  metadata?: Record<string, unknown>;
}

export interface CloudResourceProjectionContext {
  tenantId: string;
  cloudAccountAssetId: string;
  pluginId: string;
  pluginVersionId: string;
  provider: string;
  /** 中文说明：只有 Manifest 明确声明的能力才可以进入 ManagedTarget。 */
  declaredCapabilities: readonly string[];
  discoveryProviderKey?: string;
  discoveredAt?: string;
}

export interface CloudResourceProjection {
  framework: {
    id: string;
    tenantId: string;
    assetId: string;
    frameworkType: 'cloud.resource';
    frameworkKey: string;
    discoveryProviderKey: string;
    displayName: string;
    versionText: string;
    discoverySource: 'PROVIDER';
    rawFacts: Record<string, unknown>;
  };
  site: {
    id: string;
    tenantId: string;
    assetId: string;
    frameworkId: string;
    siteType: 'cloud.resource';
    siteKey: string;
    siteName: string;
    discoveryProviderKey: string;
    discoverySource: 'PROVIDER';
    metadata: Record<string, unknown>;
  };
  managedTarget?: {
    id: string;
    tenantId: string;
    assetId: string;
    frameworkId: string;
    siteId: string;
    targetType: 'cloud.resource';
    targetKey: string;
    bindingKey: string;
    discoveryProviderKey: string;
    supportedCapabilities: string[];
    executionLocations: ['CONTROL_PLANE'];
    metadata: Record<string, unknown>;
  };
}

export interface CloudResourceProjectionSummary {
  frameworks: number;
  sites: number;
  managedTargets: number;
  skippedTargets: number;
}

const deployCapabilities = ['certificate.deploy', 'certificate.verify', 'certificate.rollback'] as const;

export class CloudResourceProjectionService {
  constructor(private readonly db?: DatabasePort) {}

  validate(input: unknown): CloudServiceResourceV1 {
    if (!isRecord(input)) throw invalid('Cloud Resource 必须是对象');
    const result: CloudServiceResourceV1 = {
      apiVersion: literal(input.apiVersion, 'gcac.cloud-service/v1'),
      kind: literal(input.kind, 'CloudServiceResource'),
      stableKey: identifier(input.stableKey, 'stableKey'),
      pluginId: identifier(input.pluginId, 'pluginId'),
      pluginVersionId: identifier(input.pluginVersionId, 'pluginVersionId'),
      provider: identifier(input.provider, 'provider'),
      resourceId: identifier(input.resourceId, 'resourceId'),
      resourceType: identifier(input.resourceType, 'resourceType'),
      region: identifier(input.region, 'region'),
      ...(input.displayName === undefined ? {} : { displayName: text(input.displayName, 'displayName') }),
      ...(input.metadata === undefined ? {} : { metadata: record(input.metadata, 'metadata') }),
    };
    if (result.stableKey !== `${result.pluginId}:${result.resourceType}:${result.resourceId}`) {
      throw invalid('stableKey 必须由 pluginId、resourceType、resourceId 组成');
    }
    return result;
  }

  preview(context: CloudResourceProjectionContext, resources: readonly unknown[]): CloudResourceProjectionSummary {
    const projections = resources.map((resource) => this.project(context, resource));
    return {
      frameworks: projections.length,
      sites: projections.length,
      managedTargets: projections.filter((item) => item.managedTarget).length,
      skippedTargets: projections.filter((item) => !item.managedTarget).length,
    };
  }

  project(context: CloudResourceProjectionContext, input: unknown): CloudResourceProjection {
    assertContext(context);
    const resource = this.validate(input);
    if (resource.pluginId !== context.pluginId || resource.pluginVersionId !== context.pluginVersionId || resource.provider !== context.provider) {
      throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', 'Cloud Resource provenance 与固定 PluginVersion 不一致', {
        resourcePluginId: resource.pluginId,
        resourcePluginVersionId: resource.pluginVersionId,
      });
    }
    const discoveredAt = context.discoveredAt ?? new Date().toISOString();
    // 中文说明：发现来源键代表稳定 Provider 来源，不绑定某个版本，否则插件升级会制造第二套拓扑。
    const providerKey = context.discoveryProviderKey ?? `plugin:${context.pluginId}`;
    const root = stableId(context.cloudAccountAssetId, resource.stableKey);
    const displayName = resource.displayName ?? `${resource.resourceType}/${resource.resourceId}`;
    const metadata = {
      cloudAccountAssetId: context.cloudAccountAssetId,
      pluginId: context.pluginId,
      pluginVersionId: context.pluginVersionId,
      provider: context.provider,
      region: resource.region,
      ...(resource.metadata ?? {}),
    };
    const framework = {
      id: `fw_${root}`,
      tenantId: context.tenantId,
      assetId: context.cloudAccountAssetId,
      frameworkType: 'cloud.resource' as const,
      frameworkKey: resource.resourceType,
      discoveryProviderKey: providerKey,
      displayName,
      versionText: resource.region,
      discoverySource: 'PROVIDER' as const,
      rawFacts: { ...metadata, resourceId: resource.resourceId, stableKey: resource.stableKey },
    };
    const site = {
      id: `site_${root}`,
      tenantId: context.tenantId,
      assetId: context.cloudAccountAssetId,
      frameworkId: framework.id,
      siteType: 'cloud.resource' as const,
      siteKey: resource.stableKey,
      siteName: displayName,
      discoveryProviderKey: providerKey,
      discoverySource: 'PROVIDER' as const,
      metadata: { ...metadata, resourceId: resource.resourceId },
    };
    const supportedCapabilities = deployCapabilities.filter((capability) => context.declaredCapabilities.includes(capability));
    const managedTarget = supportedCapabilities.length === 0 ? undefined : {
      id: `target_${root}`,
      tenantId: context.tenantId,
      assetId: context.cloudAccountAssetId,
      frameworkId: framework.id,
      siteId: site.id,
      targetType: 'cloud.resource' as const,
      targetKey: resource.stableKey,
      bindingKey: `${resource.resourceType}:${resource.resourceId}`,
      discoveryProviderKey: providerKey,
      supportedCapabilities: [...supportedCapabilities],
      executionLocations: ['CONTROL_PLANE'] as ['CONTROL_PLANE'],
      metadata: { ...metadata, deployable: true },
    };
    return { framework, site, ...(managedTarget ? { managedTarget } : {}) };
  }

  /** 中文说明：将同一稳定键幂等写入三类标准拓扑对象；未声明部署能力的资源只写 Framework/Site。 */
  async persist(context: CloudResourceProjectionContext, input: unknown): Promise<CloudResourceProjection> {
    if (!this.db) throw new AppError('SYSTEM_INTERNAL_ERROR', 'Cloud Resource 投影数据库未接入');
    const owner = await this.db.query<{ id: string }>(
      `select id from pg_cloud_account_assets
       where tenant_id=$1 and id=$2 and deleted_at is null`,
      [context.tenantId, context.cloudAccountAssetId],
    );
    if (!owner.rows[0]) {
      throw new AppError('RESOURCE_NOT_FOUND', 'Cloud Resource 投影资产不属于当前租户', {
        tenantId: context.tenantId,
        cloudAccountAssetId: context.cloudAccountAssetId,
      });
    }
    const projection = this.project(context, input);
    const now = context.discoveredAt ?? new Date().toISOString();
    await this.db.transaction(async (tx) => {
      await tx.query(`insert into pg_framework_instances
        (id, tenant_id, device_id, asset_id, discovery_provider_key, service_name, display_name, version_text, ports, framework_key, framework_type,
         manual_overrides, discovery_source, last_discovered_at, status, raw_facts, created_at, updated_at, version)
        values ($1,$2,null,$3,$4,$5,$6,$7,'[]'::jsonb,$8,$9,'{}'::jsonb,$10,$11,'ACTIVE',$12::jsonb,$11,$11,1)
        on conflict (id) do update set display_name=excluded.display_name, version_text=excluded.version_text,
          last_discovered_at=excluded.last_discovered_at, status='ACTIVE', raw_facts=excluded.raw_facts,
          asset_id=excluded.asset_id, deleted_at=null, updated_at=excluded.updated_at, version=pg_framework_instances.version+1`, [
        projection.framework.id, projection.framework.tenantId, projection.framework.assetId, projection.framework.discoveryProviderKey,
        projection.framework.frameworkKey, projection.framework.displayName, projection.framework.versionText, projection.framework.frameworkKey,
        projection.framework.frameworkType, projection.framework.discoverySource, now, JSON.stringify(projection.framework.rawFacts),
      ]);
      await tx.query(`insert into pg_site_assets
        (id, tenant_id, framework_instance_id, device_id, asset_id, discovery_provider_key, site_type, site_name, site_key,
         discovery_source, last_discovered_at, status, metadata, created_at, updated_at, version)
        values ($1,$2,$3,null,$4,$5,$6,$7,$8,$9,$10,'ACTIVE',$11::jsonb,$10,$10,1)
        on conflict (id) do update set framework_instance_id=excluded.framework_instance_id, asset_id=excluded.asset_id,
          site_name=excluded.site_name, last_discovered_at=excluded.last_discovered_at, status='ACTIVE', metadata=excluded.metadata,
          deleted_at=null,
          updated_at=excluded.updated_at, version=pg_site_assets.version+1`, [
        projection.site.id, projection.site.tenantId, projection.site.frameworkId, projection.site.assetId, projection.site.discoveryProviderKey,
        projection.site.siteType, projection.site.siteName, projection.site.siteKey, projection.site.discoverySource, now,
        JSON.stringify(projection.site.metadata),
      ]);
      if (projection.managedTarget) {
        const target = projection.managedTarget;
        await tx.query(`insert into pg_managed_targets
          (id, tenant_id, device_id, asset_id, framework_instance_id, site_id, discovery_provider_key, target_type, target_key, binding_key,
           supported_capabilities, execution_locations, last_seen_at, status, metadata, created_at, updated_at, version)
          values ($1,$2,null,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,'ACTIVE',$13::jsonb,$12,$12,1)
          on conflict (id) do update set framework_instance_id=excluded.framework_instance_id, site_id=excluded.site_id,
            asset_id=excluded.asset_id, supported_capabilities=excluded.supported_capabilities,
            execution_locations=excluded.execution_locations, last_seen_at=excluded.last_seen_at, status='ACTIVE', metadata=excluded.metadata,
            deleted_at=null,
            updated_at=excluded.updated_at, version=pg_managed_targets.version+1`, [
          target.id, target.tenantId, target.assetId, target.frameworkId, target.siteId, target.discoveryProviderKey, target.targetType,
          target.targetKey, target.bindingKey, JSON.stringify(target.supportedCapabilities), JSON.stringify(target.executionLocations), now,
          JSON.stringify(target.metadata),
        ]);
      } else {
        // 中文说明：能力收回时保留历史目标，但立即撤销可部署状态，避免旧发现结果继续被选中。
        await tx.query(`update pg_managed_targets
          set status='DISABLED', metadata=coalesce(metadata, '{}'::jsonb) || $2::jsonb,
              updated_at=$3, version=version+1
          where tenant_id=$1 and asset_id=$4 and id=$5 and deleted_at is null`, [
          context.tenantId,
          JSON.stringify({ deployable: false, disabledReason: 'CAPABILITY_NOT_DECLARED' }),
          now,
          context.cloudAccountAssetId,
          `target_${stableId(context.cloudAccountAssetId, projection.site.siteKey)}`,
        ]);
      }
    });
    return projection;
  }
}

function assertContext(context: CloudResourceProjectionContext): void {
  for (const [key, value] of Object.entries(context)) {
    if (['tenantId', 'cloudAccountAssetId', 'pluginId', 'pluginVersionId', 'provider'].includes(key)
      && (typeof value !== 'string' || value.trim() === '')) throw invalid(`${key} 不能为空`);
  }
  if (!Array.isArray(context.declaredCapabilities)) throw invalid('declaredCapabilities 必须是数组');
}

function stableId(assetId: string, stableKey: string): string {
  return createHash('sha256').update(`${assetId}:${stableKey}`, 'utf8').digest('hex').slice(0, 48);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw invalid(`${path} 必须是对象`);
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw invalid(`${path} 必须是非空字符串`);
  return value.trim();
}

function identifier(value: unknown, path: string): string {
  const result = text(value, path);
  if (!/^[A-Za-z0-9._:/-]{1,512}$/.test(result)) throw invalid(`${path} 标识符格式无效`);
  return result;
}

function literal<T extends string>(value: unknown, expected: T): T {
  if (value !== expected) throw invalid(`只支持 ${expected}`);
  return expected;
}

function invalid(message: string): AppError {
  return new AppError('VALIDATION_FAILED', `Cloud Resource 投影合同无效：${message}`);
}
