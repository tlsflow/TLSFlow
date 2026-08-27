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
  /** 中文说明：账号级云产品可按通用拓扑策略选择区域设备或账号级 Framework。 */
  topology?: 'REGION_DEVICE' | 'ACCOUNT_FRAMEWORK';
  providerDisplayName?: string;
  discoveryProviderKey?: string;
  discoveredAt?: string;
}

export interface CloudResourceProjection {
  device?: {
    id: string;
    hostId: string;
    tenantId: string;
    cloudAccountAssetId: string;
    provider: string;
    region: string;
    displayName: string;
    deviceFamily: string;
    managementAddress: string;
    metadata: Record<string, unknown>;
  };
  framework: {
    id: string;
    tenantId: string;
    assetId: string;
    deviceId?: string;
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
    deviceId?: string;
    frameworkId: string;
    siteType: 'cloud.resource';
    siteKey: string;
    siteName: string;
    discoveryProviderKey: string;
    discoverySource: 'PROVIDER';
    metadata: Record<string, unknown>;
  };
}

export interface CloudResourceProjectionSummary {
  devices: number;
  frameworks: number;
  sites: number;
}

export interface CloudResourceProjectionBatch {
  devices: NonNullable<CloudResourceProjection['device']>[];
  frameworks: CloudResourceProjection['framework'][];
  sites: CloudResourceProjection['site'][];
}

export interface PersistedCloudResourceProjectionBatch {
  devices: Array<Record<string, unknown>>;
  frameworks: Array<Record<string, unknown>>;
  sites: Array<Record<string, unknown>>;
}

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
    const projections = this.projectBatch(context, resources);
    return {
      devices: projections.devices.length,
      frameworks: projections.frameworks.length,
      sites: projections.sites.length,
    };
  }

  project(context: CloudResourceProjectionContext, input: unknown): CloudResourceProjection {
    const batch = this.projectBatch(context, [input]);
    const device = batch.devices[0];
    const framework = batch.frameworks[0];
    const site = batch.sites[0];
    if (!framework || !site) throw invalid('Cloud Resource 不能为空');
    return { ...(device ? { device } : {}), framework, site };
  }

  projectBatch(context: CloudResourceProjectionContext, inputs: readonly unknown[]): CloudResourceProjectionBatch {
    assertContext(context);
    const resources = inputs.map((input) => this.validate(input));
    resources.forEach((resource) => assertResourceProvenance(resource, context));
    // 中文说明：发现来源键代表稳定 Provider 来源，不绑定某个版本，否则插件升级会制造第二套拓扑。
    const providerKey = context.discoveryProviderKey ?? `plugin:${context.pluginId}`;
    if (context.topology === 'ACCOUNT_FRAMEWORK') {
      return projectAccountFrameworkTopology(context, resources, providerKey);
    }
    const byRegion = new Map<string, CloudServiceResourceV1[]>();
    const regionDisplayNames = new Map<string, string>();
    resources.forEach((resource) => {
      if (resource.resourceType === 'cloud.region' && resource.displayName) regionDisplayNames.set(resource.region, resource.displayName);
      byRegion.set(resource.region, [...(byRegion.get(resource.region) ?? []), resource]);
    });
    const regions = [...byRegion.keys()].sort();
    const devices: NonNullable<CloudResourceProjection['device']>[] = regions.map((region) => {
      const root = stableId(context.cloudAccountAssetId, `cloud.region:${region}`);
      const accountSuffix = stableId(context.cloudAccountAssetId, 'management-address').slice(0, 10);
      const displayName = regionDisplayNames.get(region) ?? (region === 'global' ? '全局控制面' : region);
      return {
        id: `dev_${root}`,
        hostId: `hst_${root}`,
        tenantId: context.tenantId,
        cloudAccountAssetId: context.cloudAccountAssetId,
        region,
        displayName,
        provider: context.provider,
        deviceFamily: `${context.provider}.region`,
        managementAddress: `${region}.${context.provider}-${accountSuffix}`,
        metadata: {
          cloudAccountAssetId: context.cloudAccountAssetId,
          provider: context.provider,
          region,
          regionDisplayName: displayName,
          scope: region === 'global' ? 'GLOBAL' : 'REGION',
          deviceCategory: 'CLOUD',
          livenessMode: 'DISCOVERY',
          pluginId: context.pluginId,
          pluginVersionId: context.pluginVersionId,
        },
      };
    });
    const frameworks: CloudResourceProjection['framework'][] = [];
    const sites: CloudResourceProjection['site'][] = [];
    for (const device of devices) {
      const typedByFramework = new Map<string, CloudServiceResourceV1[]>();
      (byRegion.get(device.region) ?? [])
        .filter((resource) => resource.resourceType !== 'cloud.region')
        .forEach((resource) => typedByFramework.set(resource.resourceType, [...(typedByFramework.get(resource.resourceType) ?? []), resource]));
      for (const [resourceType, typedResources] of typedByFramework) {
        const frameworkKey = resourceType === 'cdn.domain' ? 'cdn' : resourceType;
        const frameworkId = `fw_${stableId(context.cloudAccountAssetId, `cloud.region:${device.region}:framework:${frameworkKey}`)}`;
        const frameworkMetadata = {
          cloudAccountAssetId: context.cloudAccountAssetId,
          pluginId: context.pluginId,
          pluginVersionId: context.pluginVersionId,
          provider: context.provider,
          region: device.region,
          resourceType,
          resourceCount: typedResources.length,
        };
        frameworks.push({
          id: frameworkId,
          tenantId: context.tenantId,
          assetId: context.cloudAccountAssetId,
          deviceId: device.hostId,
          frameworkType: 'cloud.resource',
          frameworkKey,
          discoveryProviderKey: providerKey,
          displayName: resourceType === 'cdn.domain' ? `${context.provider} CDN` : `${context.provider} ${resourceType}`,
          versionText: `${typedResources.length} resources`,
          discoverySource: 'PROVIDER',
          rawFacts: frameworkMetadata,
        });
        typedResources.forEach((resource) => {
          const root = stableId(context.cloudAccountAssetId, resource.stableKey);
          const displayName = resource.displayName ?? `${resource.resourceType}/${resource.resourceId}`;
          const metadata = {
            ...frameworkMetadata,
            region: resource.region,
            ...(resource.metadata ?? {}),
            resourceId: resource.resourceId,
            stableKey: resource.stableKey,
          };
          sites.push({
            id: `site_${root}`,
            tenantId: context.tenantId,
            assetId: context.cloudAccountAssetId,
            deviceId: device.hostId,
            frameworkId,
            siteType: 'cloud.resource',
            siteKey: resource.stableKey,
            siteName: displayName,
            discoveryProviderKey: providerKey,
            discoverySource: 'PROVIDER',
            metadata,
          });
        });
      }
    }
    return { devices, frameworks, sites };
  }

  /** 中文说明：云资源发现维护 CloudAccountAsset 下的 Framework/Site，不创建可部署 ManagedTarget。 */
  async persist(context: CloudResourceProjectionContext, input: unknown): Promise<CloudResourceProjection> {
    const batch = await this.persistBatch(context, [input]);
    const device = batch.devices[0];
    const framework = batch.frameworks[0];
    const site = batch.sites[0];
    if (!framework || !site) throw invalid('Cloud Resource 不能为空');
    return { ...(device ? { device } : {}), framework, site };
  }

  async persistBatch(context: CloudResourceProjectionContext, inputs: readonly unknown[]): Promise<CloudResourceProjectionBatch> {
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
    const projection = this.projectBatch(context, inputs);
    const now = context.discoveredAt ?? new Date().toISOString();
    await this.db.transaction(async (tx) => {
      await retirePreviousProjection(tx, context, now);
      for (const device of projection.devices) {
        await tx.query(`insert into pg_hosts
          (id, tenant_id, hostname, display_name, primary_ip, ip_addresses, os_type, os_name, os_version,
           management_channels, discovery_source, agent_id, asset_fingerprint, compatibility_level,
           management_mode, status, last_discovered_at, tags, created_at, updated_at, version)
          values ($1,$2,$3,$4,null,'[]'::jsonb,'NETWORK_DEVICE',$5,null,$6::jsonb,'PROVIDER',null,$7,'L1','AGENTLESS','ACTIVE',$8,'[]'::jsonb,$8,$8,1)
          on conflict (id) do update set hostname=excluded.hostname, display_name=excluded.display_name,
            management_channels=excluded.management_channels, asset_fingerprint=excluded.asset_fingerprint,
            status='ACTIVE', last_discovered_at=excluded.last_discovered_at, deleted_at=null, updated_at=excluded.updated_at, version=pg_hosts.version+1`, [
          device.hostId, device.tenantId, device.managementAddress, device.displayName, device.provider,
          JSON.stringify([{ type: 'CONTROL_PLANE', enabled: true, refId: device.cloudAccountAssetId }]),
          `cloud:${device.cloudAccountAssetId}:${device.region}`, now,
        ]);
        await tx.query(`insert into pg_service_assets
          (id, tenant_id, address, address_type, port, protocol, display_name, host_id, status, tags, metadata, asset_kind, discovery_source, created_at, updated_at, version)
          values ($1,$2,$3,'DNS',443,'HTTPS',$4,$5,'ACTIVE','[]'::jsonb,$6::jsonb,'DEVICE','PROVIDER',$7,$7,1)
          on conflict (id) do update set address=excluded.address, display_name=excluded.display_name,
            host_id=excluded.host_id, status='ACTIVE', metadata=excluded.metadata, deleted_at=null,
            updated_at=excluded.updated_at, version=pg_service_assets.version+1`, [
          device.id, device.tenantId, device.managementAddress, device.displayName, device.hostId,
          JSON.stringify(device.metadata), now,
        ]);
        await tx.query(`insert into pg_device_assets
          (service_asset_id, tenant_id, host_id, device_family, management_port, auth_mode, tls_verify,
           support_tier, capability_profile, product_name, product_family, last_discovered_at, metadata, created_at, updated_at, version)
          values ($1,$2,$3,$4,443,'AUTO',true,'READ_ONLY','{}'::jsonb,$5,$6,$7,$8::jsonb,$9,$9,1)
          on conflict (service_asset_id) do update set host_id=excluded.host_id, device_family=excluded.device_family,
            product_name=excluded.product_name, product_family=excluded.product_family, last_discovered_at=excluded.last_discovered_at, metadata=excluded.metadata,
            updated_at=excluded.updated_at, version=pg_device_assets.version+1`, [
          device.id, device.tenantId, device.hostId, device.deviceFamily, device.provider, device.provider, now, JSON.stringify(device.metadata), now,
        ]);
      }
      for (const framework of projection.frameworks) {
        await tx.query(`insert into pg_framework_instances
        (id, tenant_id, device_id, asset_id, discovery_provider_key, service_name, display_name, version_text, ports, framework_key, framework_type,
         manual_overrides, discovery_source, last_discovered_at, status, raw_facts, created_at, updated_at, version)
        values ($1,$2,$3,$4,$5,$6,$7,$8,'[]'::jsonb,$9,$10,'{}'::jsonb,$11,$12,'ACTIVE',$13::jsonb,$12,$12,1)
        on conflict (id) do update set display_name=excluded.display_name, version_text=excluded.version_text,
          last_discovered_at=excluded.last_discovered_at, status='ACTIVE', raw_facts=excluded.raw_facts,
          device_id=excluded.device_id, asset_id=excluded.asset_id, deleted_at=null, updated_at=excluded.updated_at, version=pg_framework_instances.version+1`, [
        framework.id, framework.tenantId, framework.deviceId ?? null, framework.assetId, framework.discoveryProviderKey,
        framework.frameworkKey, framework.displayName, framework.versionText, framework.frameworkKey,
        framework.frameworkType, framework.discoverySource, now, JSON.stringify(framework.rawFacts),
      ]);
      }
      for (const site of projection.sites) {
        await tx.query(`insert into pg_site_assets
        (id, tenant_id, framework_instance_id, device_id, asset_id, discovery_provider_key, site_type, site_name, site_key,
         discovery_source, last_discovered_at, status, metadata, created_at, updated_at, version)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ACTIVE',$12::jsonb,$11,$11,1)
        on conflict (id) do update set framework_instance_id=excluded.framework_instance_id, device_id=excluded.device_id, asset_id=excluded.asset_id,
          site_name=excluded.site_name, last_discovered_at=excluded.last_discovered_at, status='ACTIVE', metadata=excluded.metadata,
          deleted_at=null,
          updated_at=excluded.updated_at, version=pg_site_assets.version+1`, [
        site.id, site.tenantId, site.frameworkId, site.deviceId ?? null, site.assetId, site.discoveryProviderKey,
        site.siteType, site.siteName, site.siteKey, site.discoverySource, now,
        JSON.stringify(site.metadata),
      ]);
      }
    });
    return projection;
  }

  async listForAsset(tenantId: string, cloudAccountAssetId: string): Promise<PersistedCloudResourceProjectionBatch> {
    if (!this.db) throw new AppError('SYSTEM_INTERNAL_ERROR', 'Cloud Resource 投影数据库未接入');
    const owner = await this.db.query<{ id: string }>(
      `select id from pg_cloud_account_assets where tenant_id=$1 and id=$2 and deleted_at is null`,
      [tenantId, cloudAccountAssetId],
    );
    if (!owner.rows[0]) throw new AppError('RESOURCE_NOT_FOUND', 'Cloud Resource 投影资产不存在', { cloudAccountAssetId });
    const [frameworkRows, siteRows] = await Promise.all([
      this.db.query<Record<string, unknown>>(
        `select id, tenant_id, asset_id, device_id, discovery_provider_key, framework_key, framework_type,
                display_name, version_text, discovery_source, last_discovered_at, status, raw_facts,
                raw_facts->>'scopeName' as region
           from pg_framework_instances
          where tenant_id=$1 and asset_id=$2 and deleted_at is null
          order by display_name, id`,
        [tenantId, cloudAccountAssetId],
      ),
      this.db.query<Record<string, unknown>>(
        `select id, tenant_id, asset_id, device_id, framework_instance_id, discovery_provider_key, site_type,
                site_name, site_key, discovery_source, last_discovered_at, status, metadata
           from pg_site_assets
          where tenant_id=$1 and asset_id=$2 and deleted_at is null
          order by site_name, id`,
        [tenantId, cloudAccountAssetId],
      ),
    ]);
    return {
      devices: [],
      frameworks: frameworkRows.rows.map((row) => ({
        id: row.id,
        tenantId: row.tenant_id,
        assetId: row.asset_id,
        deviceId: row.device_id,
        discoveryProviderKey: row.discovery_provider_key,
        frameworkKey: row.framework_key,
        frameworkType: row.framework_type,
        displayName: row.display_name,
        frameworkVersion: row.version_text,
        region: row.region ?? row.framework_key,
        discoverySource: row.discovery_source,
        lastDiscoveredAt: row.last_discovered_at,
        status: row.status,
        rawFacts: row.raw_facts ?? {},
      })),
      sites: siteRows.rows.map((row) => ({
        id: row.id,
        tenantId: row.tenant_id,
        assetId: row.asset_id,
        deviceId: row.device_id,
        frameworkInstanceId: row.framework_instance_id,
        discoveryProviderKey: row.discovery_provider_key,
        siteType: row.site_type,
        siteName: row.site_name,
        siteKey: row.site_key,
        discoverySource: row.discovery_source,
        lastDiscoveredAt: row.last_discovered_at,
        status: row.status,
        metadata: row.metadata ?? {},
      })),
    };
  }
}

/** 中文说明：账号级 CDN 只有一个控制面设备，CDN 覆盖范围是 Framework，域名实例是 Site。 */
function projectAccountFrameworkTopology(
  context: CloudResourceProjectionContext,
  resources: CloudServiceResourceV1[],
  providerKey: string,
): CloudResourceProjectionBatch {
  const root = stableId(context.cloudAccountAssetId, 'cloud.account');
  const providerDisplayName = context.providerDisplayName ?? `${context.provider} CDN`;
  const byScope = new Map<string, CloudServiceResourceV1[]>([
    ['mainland', []],
    ['global', []],
  ]);
  resources
    .filter((resource) => resource.resourceType !== 'cloud.region')
    .forEach((resource) => {
      const scope = normalizeCdnScopeKey(textValue(resource.metadata?.cdnRegion) || resource.region);
      byScope.set(scope, [...(byScope.get(scope) ?? []), resource]);
    });
  const frameworks: CloudResourceProjection['framework'][] = [];
  const sites: CloudResourceProjection['site'][] = [];
  for (const [scope, scopedResources] of [...byScope.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    // 中文说明：展示名称由稳定范围键决定，避免历史投影中的“全球”文案继续泄漏到当前界面。
    const scopeName = scope === 'mainland' ? '中国大陆' : '国际站';
    const frameworkId = `fw_${stableId(context.cloudAccountAssetId, `cloud.account:framework:cdn:${scope}`)}`;
    const frameworkMetadata = {
      cloudAccountAssetId: context.cloudAccountAssetId,
      pluginId: context.pluginId,
      pluginVersionId: context.pluginVersionId,
      provider: context.provider,
      scope,
      scopeName,
      resourceType: 'cdn.domain',
      resourceCount: scopedResources.length,
    };
    frameworks.push({
      id: frameworkId,
      tenantId: context.tenantId,
      assetId: context.cloudAccountAssetId,
      deviceId: undefined,
      frameworkType: 'cloud.resource',
      frameworkKey: `cdn.${scope}`,
      discoveryProviderKey: providerKey,
      displayName: `${providerDisplayName} · ${scopeName}`,
      versionText: `${scopedResources.length} resources`,
      discoverySource: 'PROVIDER',
      rawFacts: frameworkMetadata,
    });
    scopedResources.forEach((resource) => {
      const siteRoot = stableId(context.cloudAccountAssetId, resource.stableKey);
      const siteName = resource.displayName ?? `${resource.resourceType}/${resource.resourceId}`;
      sites.push({
        id: `site_${siteRoot}`,
        tenantId: context.tenantId,
        assetId: context.cloudAccountAssetId,
        deviceId: undefined,
        frameworkId,
        siteType: 'cloud.resource',
        siteKey: resource.stableKey,
        siteName,
        discoveryProviderKey: providerKey,
        discoverySource: 'PROVIDER',
        metadata: {
          ...frameworkMetadata,
          ...(resource.metadata ?? {}),
          resourceId: resource.resourceId,
          stableKey: resource.stableKey,
        },
      });
    });
  }
  return { devices: [], frameworks, sites };
}

function textValue(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

/** 中文说明：账号级 CDN 只允许两个管理范围，旧资源的 cn-* 区域统一归入中国大陆。 */
function normalizeCdnScopeKey(value: string): 'mainland' | 'global' {
  const normalized = value.toLocaleLowerCase().replaceAll('_', '-').replaceAll(' ', '');
  return normalized === 'mainland' || normalized === 'china' || normalized === 'domestic' || normalized.startsWith('cn-')
    ? 'mainland'
    : 'global';
}

/** 中文说明：同一云账号的下一次发现先退役上一版投影，随后用稳定 ID 恢复仍存在的设备、框架和站点。 */
async function retirePreviousProjection(tx: DatabasePort, context: CloudResourceProjectionContext, now: string): Promise<void> {
  await tx.query(
    `update pg_site_assets set status='RETIRED', deleted_at=$3, updated_at=$3, version=version+1
       where tenant_id=$1 and asset_id=$2 and site_type='cloud.resource' and deleted_at is null`,
    [context.tenantId, context.cloudAccountAssetId, now],
  );
  await tx.query(
    `update pg_framework_instances set status='RETIRED', deleted_at=$3, updated_at=$3, version=version+1
       where tenant_id=$1 and asset_id=$2 and framework_type='cloud.resource' and deleted_at is null`,
    [context.tenantId, context.cloudAccountAssetId, now],
  );
}

function assertResourceProvenance(resource: CloudServiceResourceV1, context: CloudResourceProjectionContext): void {
  if (resource.pluginId !== context.pluginId || resource.pluginVersionId !== context.pluginVersionId || resource.provider !== context.provider) {
    throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', 'Cloud Resource provenance 与固定 PluginVersion 不一致', {
      resourcePluginId: resource.pluginId,
      resourcePluginVersionId: resource.pluginVersionId,
    });
  }
}

function assertContext(context: CloudResourceProjectionContext): void {
  for (const [key, value] of Object.entries(context)) {
    if (['tenantId', 'cloudAccountAssetId', 'pluginId', 'pluginVersionId', 'provider'].includes(key)
      && (typeof value !== 'string' || value.trim() === '')) throw invalid(`${key} 不能为空`);
  }
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
