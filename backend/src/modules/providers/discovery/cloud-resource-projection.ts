import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { resolveCertificateVersionId, normalizeFingerprint } from '../../plugins/discovery/certificate-version-matcher.js';

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
  /** 中文说明：插件声明资源所属 Framework 的稳定键和展示名，宿主不推断厂商拓扑。 */
  frameworkKey?: string;
  frameworkDisplayName?: string;
  /** 中文说明：插件可为资源声明证书管理目标的类型、绑定键和执行能力。 */
  targetType?: string;
  targetKey?: string;
  bindingKey?: string;
  supportedCapabilities?: string[];
  executionLocations?: Array<'CONTROL_PLANE' | 'GATEWAY'>;
  metadata?: Record<string, unknown>;
}

/** 中文说明：只有插件明确声明真实证书更换端点时，云资源才进入 ManagedTarget。 */
export interface CloudCertificateEndpointV1 {
  endpointKey: string;
  targetType: string;
  targetKey: string;
  bindingKey?: string;
  supportedCapabilities: string[];
  executionLocations: Array<'CONTROL_PLANE' | 'GATEWAY'>;
  metadata?: Record<string, unknown>;
}

export interface CloudResourceProjectionContext {
  tenantId: string;
  /** 标准插件资产的 ServiceAsset ID。新链路必须使用该字段。 */
  serviceAssetId?: string;
  /** 旧 CloudAccountAsset API 的兼容上下文；新标准资产链路不得使用。 */
  cloudAccountAssetId?: string;
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
    assetId?: string;
    serviceAssetId?: string;
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
    assetId?: string;
    serviceAssetId?: string;
    deviceId?: string;
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
    assetId?: string;
    serviceAssetId?: string;
    frameworkInstanceId?: string;
    siteId?: string;
    discoveryProviderKey: string;
    targetType: string;
    targetKey: string;
    bindingKey?: string;
    supportedCapabilities: string[];
    executionLocations: Array<'CONTROL_PLANE' | 'GATEWAY'>;
    lastSeenAt?: string;
    status: 'ACTIVE';
    metadata: Record<string, unknown>;
  };
}

export interface CloudResourceProjectionSummary {
  devices: number;
  frameworks: number;
  sites: number;
  managedTargets: number;
}

export interface CloudResourceProjectionBatch {
  devices: NonNullable<CloudResourceProjection['device']>[];
  frameworks: CloudResourceProjection['framework'][];
  sites: CloudResourceProjection['site'][];
  managedTargets: NonNullable<CloudResourceProjection['managedTarget']>[];
}

export interface PersistedCloudResourceProjectionBatch {
  devices: Array<Record<string, unknown>>;
  frameworks: Array<Record<string, unknown>>;
  sites: Array<Record<string, unknown>>;
  managedTargets: Array<Record<string, unknown>>;
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
      ...(input.frameworkKey === undefined ? {} : { frameworkKey: identifier(input.frameworkKey, 'frameworkKey') }),
      ...(input.frameworkDisplayName === undefined ? {} : { frameworkDisplayName: text(input.frameworkDisplayName, 'frameworkDisplayName') }),
      ...(input.targetType === undefined ? {} : { targetType: identifier(input.targetType, 'targetType') }),
      ...(input.targetKey === undefined ? {} : { targetKey: identifier(input.targetKey, 'targetKey') }),
      ...(input.bindingKey === undefined ? {} : { bindingKey: identifier(input.bindingKey, 'bindingKey') }),
      ...(input.supportedCapabilities === undefined ? {} : { supportedCapabilities: stringArray(input.supportedCapabilities, 'supportedCapabilities') }),
      ...(input.executionLocations === undefined ? {} : { executionLocations: executionLocations(input.executionLocations, 'executionLocations') }),
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
      managedTargets: projections.managedTargets.length,
    };
  }

  project(context: CloudResourceProjectionContext, input: unknown): CloudResourceProjection {
    const batch = this.projectBatch(context, [input]);
    const device = batch.devices[0];
    const framework = batch.frameworks[0];
    const site = batch.sites[0];
    const managedTarget = batch.managedTargets[0];
    if (!framework || !site) throw invalid('Cloud Resource 不能为空');
    return { ...(device ? { device } : {}), framework, site, managedTarget };
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
    resources.forEach((resource) => {
      byRegion.set(resource.region, [...(byRegion.get(resource.region) ?? []), resource]);
    });
    const regions = [...byRegion.keys()].sort();
    // 中文说明：云账号不是设备。区域仅用于 Framework 分组，不生成合成 Host/Device。
    const devices: NonNullable<CloudResourceProjection['device']>[] = [];
    const frameworks: CloudResourceProjection['framework'][] = [];
    const sites: CloudResourceProjection['site'][] = [];
    const managedTargets: NonNullable<CloudResourceProjection['managedTarget']>[] = [];
    for (const region of regions) {
      const typedByFramework = new Map<string, CloudServiceResourceV1[]>();
      (byRegion.get(region) ?? [])
        .filter((resource) => resource.resourceType !== 'cloud.region')
        .forEach((resource) => {
          const key = resource.frameworkKey ?? resource.resourceType;
          typedByFramework.set(key, [...(typedByFramework.get(key) ?? []), resource]);
        });
      for (const [frameworkKey, typedResources] of typedByFramework) {
        const resourceType = typedResources[0]?.resourceType ?? frameworkKey;
        const ownerAssetId = projectionOwnerAssetId(context);
        const frameworkId = `fw_${stableId(ownerAssetId, `cloud.region:${region}:framework:${frameworkKey}`)}`;
        const frameworkMetadata = {
          ...projectionOwnerFields(context),
          ...(context.cloudAccountAssetId ? { cloudAccountAssetId: context.cloudAccountAssetId } : {}),
          pluginId: context.pluginId,
          pluginVersionId: context.pluginVersionId,
          provider: context.provider,
          region,
          resourceType,
          resourceCount: typedResources.length,
        };
        frameworks.push({
          id: frameworkId,
          tenantId: context.tenantId,
          ...projectionOwnerFields(context),
          deviceId: undefined,
          frameworkType: 'cloud.resource',
          frameworkKey,
          discoveryProviderKey: providerKey,
          displayName: typedResources[0]?.frameworkDisplayName ?? `${context.provider} ${resourceType}`,
          versionText: `${typedResources.length} resources`,
          discoverySource: 'PROVIDER',
          rawFacts: frameworkMetadata,
        });
        typedResources.forEach((resource) => {
          const root = stableId(ownerAssetId, resource.stableKey);
          const displayName = resource.displayName ?? `${resource.resourceType}/${resource.resourceId}`;
          const metadata = {
            ...frameworkMetadata,
            region: resource.region,
            ...(resource.metadata ?? {}),
            resourceId: resource.resourceId,
            stableKey: resource.stableKey,
          };
          const siteId = `site_${root}`;
          sites.push({
            id: siteId,
            tenantId: context.tenantId,
            ...projectionOwnerFields(context),
            deviceId: undefined,
            frameworkId,
            siteType: 'cloud.resource',
            siteKey: resource.stableKey,
            siteName: displayName,
            discoveryProviderKey: providerKey,
            discoverySource: 'PROVIDER',
            metadata,
          });
          managedTargets.push(...projectCertificateEndpoints(context, resource, metadata, frameworkId, siteId, providerKey));
        });
      }
    }
    return { devices, frameworks, sites, managedTargets };
  }

  /** 中文说明：云资源发现维护 ServiceAsset 下的 Framework/Site；只有真实证书端点才创建 ManagedTarget。 */
  async persist(context: CloudResourceProjectionContext, input: unknown): Promise<CloudResourceProjection> {
    const batch = await this.persistBatch(context, [input]);
    const device = batch.devices[0];
    const framework = batch.frameworks[0];
    const site = batch.sites[0];
    const managedTarget = batch.managedTargets[0];
    if (!framework || !site) throw invalid('Cloud Resource 不能为空');
    return { ...(device ? { device } : {}), framework, site, managedTarget };
  }

  async persistBatch(context: CloudResourceProjectionContext, inputs: readonly unknown[]): Promise<CloudResourceProjectionBatch> {
    if (!this.db) throw new AppError('SYSTEM_INTERNAL_ERROR', 'Cloud Resource 投影数据库未接入');
    const ownerAssetId = projectionOwnerAssetId(context);
    const ownerTable = context.serviceAssetId ? 'pg_service_assets' : 'pg_cloud_account_assets';
    const owner = await this.db.query<{ id: string }>(
      `select id from ${ownerTable}
       where tenant_id=$1 and id=$2 and deleted_at is null`,
      [context.tenantId, ownerAssetId],
    );
    if (!owner.rows[0]) {
      throw new AppError('RESOURCE_NOT_FOUND', 'Cloud Resource 投影资产不属于当前租户', {
        tenantId: context.tenantId,
        serviceAssetId: ownerAssetId,
      });
    }
    const projection = this.projectBatch(context, inputs);
    const now = context.discoveredAt ?? new Date().toISOString();
    await this.db.transaction(async (tx) => {
      await retirePreviousProjection(tx, context, now);
      // 云服务投影只维护统一资产的 Framework/Site/ManagedTarget 拓扑；Host、DeviceAsset 永远由设备接入流程创建。
      for (const framework of projection.frameworks) {
        await tx.query(`insert into pg_framework_instances
        (id, tenant_id, device_id, asset_id, service_asset_id, discovery_provider_key, service_name, display_name, version_text, ports, framework_key, framework_type,
         manual_overrides, discovery_source, last_discovered_at, status, raw_facts, created_at, updated_at, version)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'[]'::jsonb,$10,$11,'{}'::jsonb,$12,$13,'ACTIVE',$14::jsonb,$13,$13,1)
        on conflict (id) do update set display_name=excluded.display_name, version_text=excluded.version_text,
          last_discovered_at=excluded.last_discovered_at, status='ACTIVE', raw_facts=excluded.raw_facts,
          device_id=excluded.device_id, asset_id=excluded.asset_id, service_asset_id=excluded.service_asset_id,
          deleted_at=null, updated_at=excluded.updated_at, version=pg_framework_instances.version+1`, [
        framework.id, framework.tenantId, framework.deviceId ?? null,
        framework.assetId ?? null,
        framework.serviceAssetId ?? null,
        framework.discoveryProviderKey, framework.frameworkKey, framework.displayName, framework.versionText,
        framework.frameworkKey, framework.frameworkType, framework.discoverySource, now, JSON.stringify(framework.rawFacts),
      ]);
      }
      for (const site of projection.sites) {
        await tx.query(`insert into pg_site_assets
        (id, tenant_id, framework_instance_id, device_id, asset_id, service_asset_id, discovery_provider_key, site_type, site_name, site_key,
         discovery_source, last_discovered_at, status, metadata, created_at, updated_at, version)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'ACTIVE',$13::jsonb,$12,$12,1)
        on conflict (id) do update set framework_instance_id=excluded.framework_instance_id, device_id=excluded.device_id, asset_id=excluded.asset_id,
          service_asset_id=excluded.service_asset_id,
          site_name=excluded.site_name, last_discovered_at=excluded.last_discovered_at, status='ACTIVE', metadata=excluded.metadata,
          deleted_at=null,
          updated_at=excluded.updated_at, version=pg_site_assets.version+1`, [
        site.id, site.tenantId, site.frameworkId, site.deviceId ?? null,
        site.assetId ?? null,
        site.serviceAssetId ?? null,
        site.discoveryProviderKey,
        site.siteType, site.siteName, site.siteKey, site.discoverySource, now,
        JSON.stringify(site.metadata),
        ]);
      }
      for (const target of projection.managedTargets) {
        await tx.query(`insert into pg_managed_targets
          (id, tenant_id, asset_id, service_asset_id, device_id, framework_instance_id, site_id, discovery_provider_key,
           target_type, target_key, binding_key, supported_capabilities, execution_locations,
           last_seen_at, status, metadata, created_at, updated_at, version)
          values ($1,$2,$3,$4,null,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::timestamptz,'ACTIVE',$14::jsonb,$13::timestamptz,$13::timestamptz,1)
          on conflict (id) do update set asset_id=excluded.asset_id, service_asset_id=excluded.service_asset_id, device_id=null,
            framework_instance_id=excluded.framework_instance_id, site_id=excluded.site_id,
            discovery_provider_key=excluded.discovery_provider_key, target_type=excluded.target_type,
            target_key=excluded.target_key, binding_key=excluded.binding_key,
            supported_capabilities=excluded.supported_capabilities, execution_locations=excluded.execution_locations,
            last_seen_at=excluded.last_seen_at, status='ACTIVE', metadata=excluded.metadata,
            deleted_at=null, updated_at=excluded.updated_at, version=pg_managed_targets.version+1`, [
          target.id, target.tenantId,
          target.assetId ?? null,
          target.serviceAssetId ?? null,
          target.frameworkInstanceId ?? null, target.siteId ?? null,
          target.discoveryProviderKey, target.targetType, target.targetKey, target.bindingKey ?? null,
          JSON.stringify(target.supportedCapabilities), JSON.stringify(target.executionLocations), now,
          JSON.stringify(target.metadata),
        ]);
      }
      // 中文说明：云域名证书事实进入统一 CertificateBinding；证书库只保存项目内匹配到的版本，
      // 未匹配时保留指纹和厂商证书 ID，前端明确显示“未纳管”，绝不伪造 CertificateVersion。
      const targetBySiteId = new Map(projection.managedTargets.filter((target) => target.siteId).map((target) => [target.siteId!, target]));
      for (const site of projection.sites) {
        const target = targetBySiteId.get(site.id);
        const certificate = readCloudCertificateFacts(site.metadata);
        if (!target || !certificate) continue;
        const certificateVersionId = await resolveCertificateVersionId(tx, context.tenantId, certificate);
        const bindingId = `bnd_${stableId(projectionOwnerAssetId(context), `${site.siteKey}:certificate`)}`;
        const bindingMetadata = {
          ...(certificate.providerCertificateId ? { providerCertificateId: certificate.providerCertificateId } : {}),
          ...(certificate.providerCertificateName ? { providerCertificateName: certificate.providerCertificateName } : {}),
          ...(certificate.fingerprintSha256 ? { fingerprintSha256: certificate.fingerprintSha256 } : {}),
          ...(certificate.subject ? { subject: certificate.subject } : {}),
          ...(certificate.issuer ? { issuer: certificate.issuer } : {}),
          ...(certificate.notBefore ? { notBefore: certificate.notBefore } : {}),
          ...(certificate.notAfter ? { notAfter: certificate.notAfter } : {}),
          discoveryProviderKey: context.discoveryProviderKey ?? `plugin:${context.pluginId}`,
          discoveryStatus: 'ACTIVE',
          targetType: target.targetType,
          targetKey: target.targetKey,
        };
        const fingerprint = normalizeFingerprint(certificate.fingerprintSha256) ?? null;
        await tx.query(`insert into pg_certificate_bindings (
          id, tenant_id, service_asset_id, site_asset_id, managed_target_id, service_instance_id, host_id,
          domain_name, domain, port, protocol, binding_key, binding_type, certificate_version_id,
          observed_fingerprint_sha256, unmanaged_certificate_fingerprint, discovery_source, verify_method,
          remote_status, status, metadata, created_at, updated_at, version
        ) values ($1,$2,$3,$4,$5,$6,null,$7,$7,$8,$9,$10,'CUSTOM',$11,$12,$13,'PROVIDER','CUSTOM','unknown',$14,$15::jsonb,$16,$16,1)
        on conflict (id) do update set service_asset_id=excluded.service_asset_id, site_asset_id=excluded.site_asset_id,
          managed_target_id=excluded.managed_target_id, service_instance_id=excluded.service_instance_id, host_id=null,
          domain_name=excluded.domain_name, domain=excluded.domain, port=excluded.port, protocol=excluded.protocol,
          certificate_version_id=excluded.certificate_version_id, observed_fingerprint_sha256=excluded.observed_fingerprint_sha256,
          unmanaged_certificate_fingerprint=excluded.unmanaged_certificate_fingerprint, discovery_source=excluded.discovery_source,
          verify_method=excluded.verify_method, remote_status=excluded.remote_status,
          status=case when pg_certificate_bindings.status='MANAGED' then 'MANAGED' else excluded.status end,
          metadata=pg_certificate_bindings.metadata || excluded.metadata, deleted_at=null, updated_at=excluded.updated_at,
          version=pg_certificate_bindings.version+1`, [
          bindingId, context.tenantId, context.serviceAssetId ?? null, site.id, target.id, site.frameworkId,
          certificate.domainName ?? site.siteName, site.metadata.port ?? null, site.metadata.protocol ?? 'HTTPS',
          target.bindingKey ?? site.siteKey, certificateVersionId ?? null, fingerprint, certificateVersionId ? null : fingerprint,
          'DISCOVERED', JSON.stringify(bindingMetadata), now,
        ]);
      }
    });
    return projection;
  }

  async listForAsset(tenantId: string, serviceAssetId: string, ownerType?: 'SERVICE_ASSET' | 'CLOUD_ACCOUNT_ASSET'): Promise<PersistedCloudResourceProjectionBatch> {
    if (!this.db) throw new AppError('SYSTEM_INTERNAL_ERROR', 'Cloud Resource 投影数据库未接入');
    let resolvedOwnerType = ownerType;
    if (!resolvedOwnerType) {
      const standardOwner = await this.db.query<{ id: string }>(
        `select id from pg_service_assets where tenant_id=$1 and id=$2 and deleted_at is null`,
        [tenantId, serviceAssetId],
      );
      resolvedOwnerType = standardOwner.rows[0] ? 'SERVICE_ASSET' : 'CLOUD_ACCOUNT_ASSET';
    }
    const ownerTable = resolvedOwnerType === 'SERVICE_ASSET' ? 'pg_service_assets' : 'pg_cloud_account_assets';
    const ownerColumn = resolvedOwnerType === 'SERVICE_ASSET' ? 'service_asset_id' : 'asset_id';
    const owner = await this.db.query<{ id: string }>(
      `select id from ${ownerTable} where tenant_id=$1 and id=$2 and deleted_at is null`,
      [tenantId, serviceAssetId],
    );
    if (!owner.rows[0]) throw new AppError('RESOURCE_NOT_FOUND', 'Cloud Resource 投影资产不存在', { serviceAssetId });
    const [frameworkRows, managedTargetRows, siteRows] = await Promise.all([
      this.db.query<Record<string, unknown>>(
        `select id, tenant_id, asset_id, service_asset_id, device_id, discovery_provider_key, framework_key, framework_type,
                display_name, version_text, discovery_source, last_discovered_at, status, raw_facts,
                raw_facts->>'scopeName' as region
           from pg_framework_instances
          where tenant_id=$1 and ${resolvedOwnerType === 'SERVICE_ASSET' ? 'service_asset_id' : 'asset_id'}=$2 and deleted_at is null
          order by display_name, id`,
        [tenantId, serviceAssetId],
      ),
      this.db.query<Record<string, unknown>>(
        `select id, tenant_id, asset_id, service_asset_id, framework_instance_id, site_id, discovery_provider_key,
                target_type, target_key, binding_key, supported_capabilities, execution_locations,
                last_seen_at, status, metadata
           from pg_managed_targets
          where tenant_id=$1 and ${ownerColumn}=$2 and deleted_at is null
          order by target_key, id`,
        [tenantId, serviceAssetId],
      ),
      this.db.query<Record<string, unknown>>(
        `select id, tenant_id, asset_id, service_asset_id, device_id, framework_instance_id, discovery_provider_key, site_type,
                site_name, site_key, discovery_source, last_discovered_at, status, metadata
           from pg_site_assets
          where tenant_id=$1 and ${ownerColumn}=$2 and deleted_at is null
          order by site_name, id`,
        [tenantId, serviceAssetId],
      ),
    ]);
    return {
      devices: [],
      frameworks: frameworkRows.rows.map((row) => ({
        id: row.id,
        tenantId: row.tenant_id,
        ...(row.service_asset_id ? { serviceAssetId: row.service_asset_id } : row.asset_id ? { assetId: row.asset_id } : {}),
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
        ...(row.service_asset_id ? { serviceAssetId: row.service_asset_id } : row.asset_id ? { assetId: row.asset_id } : {}),
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
      managedTargets: managedTargetRows.rows.map((row) => ({
        id: row.id,
        tenantId: row.tenant_id,
        ...(row.service_asset_id ? { serviceAssetId: row.service_asset_id } : row.asset_id ? { assetId: row.asset_id } : {}),
        frameworkInstanceId: row.framework_instance_id ?? undefined,
        siteId: row.site_id ?? undefined,
        discoveryProviderKey: row.discovery_provider_key,
        targetType: row.target_type,
        targetKey: row.target_key,
        bindingKey: row.binding_key ?? undefined,
        supportedCapabilities: readStringArray(row.supported_capabilities),
        executionLocations: readExecutionLocations(row.execution_locations),
        lastSeenAt: row.last_seen_at ?? undefined,
        status: row.status,
        metadata: row.metadata ?? {},
      })),
    };
  }
}

/** 中文说明：账号级资源由插件声明的 Framework 键分组，资源实例投影为 Site。 */
function projectAccountFrameworkTopology(
  context: CloudResourceProjectionContext,
  resources: CloudServiceResourceV1[],
  providerKey: string,
): CloudResourceProjectionBatch {
  const ownerAssetId = projectionOwnerAssetId(context);
  const byFramework = new Map<string, CloudServiceResourceV1[]>();
  resources
    .filter((resource) => resource.resourceType !== 'cloud.region')
    .forEach((resource) => {
      const frameworkKey = resource.frameworkKey ?? resource.resourceType;
      byFramework.set(frameworkKey, [...(byFramework.get(frameworkKey) ?? []), resource]);
    });
  const frameworks: CloudResourceProjection['framework'][] = [];
  const sites: CloudResourceProjection['site'][] = [];
  const managedTargets: NonNullable<CloudResourceProjection['managedTarget']>[] = [];
  for (const [frameworkKey, scopedResources] of [...byFramework.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const frameworkId = `fw_${stableId(ownerAssetId, `cloud.account:framework:${frameworkKey}`)}`;
    const frameworkDisplayName = scopedResources[0]?.frameworkDisplayName
      ?? context.providerDisplayName
      ?? `${context.provider} ${frameworkKey}`;
    const frameworkMetadata = {
      ...projectionOwnerFields(context),
      ...(context.cloudAccountAssetId ? { cloudAccountAssetId: context.cloudAccountAssetId } : {}),
      pluginId: context.pluginId,
      pluginVersionId: context.pluginVersionId,
      provider: context.provider,
      frameworkKey,
      resourceType: scopedResources[0]?.resourceType,
      resourceCount: scopedResources.length,
    };
    frameworks.push({
      id: frameworkId,
      tenantId: context.tenantId,
      ...projectionOwnerFields(context),
      deviceId: undefined,
      frameworkType: 'cloud.resource',
      frameworkKey,
      discoveryProviderKey: providerKey,
      displayName: frameworkDisplayName,
      versionText: `${scopedResources.length} resources`,
      discoverySource: 'PROVIDER',
      rawFacts: frameworkMetadata,
    });
    scopedResources.forEach((resource) => {
      const siteRoot = stableId(ownerAssetId, resource.stableKey);
      const siteName = resource.displayName ?? `${resource.resourceType}/${resource.resourceId}`;
      const siteId = `site_${siteRoot}`;
      sites.push({
        id: siteId,
        tenantId: context.tenantId,
        ...projectionOwnerFields(context),
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
      managedTargets.push(...projectCertificateEndpoints(
        context,
        resource,
        {
          ...frameworkMetadata,
          ...(resource.metadata ?? {}),
          resourceId: resource.resourceId,
          resourceType: resource.resourceType,
          cloudResourceStableKey: resource.stableKey,
        },
        frameworkId,
        siteId,
        providerKey,
      ));
    });
  }
  return { devices: [], frameworks, sites, managedTargets };
}

function textValue(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function projectCertificateEndpoints(
  context: CloudResourceProjectionContext,
  resource: CloudServiceResourceV1,
  resourceMetadata: Record<string, unknown>,
  frameworkId: string,
  siteId: string,
  providerKey: string,
): NonNullable<CloudResourceProjection['managedTarget']>[] {
  const endpoints = readCertificateEndpoints(resource);
  return endpoints.map((endpoint) => ({
    id: `mtg_${stableId(projectionOwnerAssetId(context), `${resource.stableKey}:certificate-endpoint:${endpoint.endpointKey}`)}`,
    tenantId: context.tenantId,
    ...projectionOwnerFields(context),
    frameworkInstanceId: frameworkId,
    siteId,
    discoveryProviderKey: providerKey,
    targetType: endpoint.targetType,
    targetKey: endpoint.targetKey,
    ...(endpoint.bindingKey ? { bindingKey: endpoint.bindingKey } : {}),
    supportedCapabilities: endpoint.supportedCapabilities,
    executionLocations: endpoint.executionLocations,
    lastSeenAt: context.discoveredAt,
    status: 'ACTIVE',
    metadata: {
      ...resourceMetadata,
      ...(endpoint.metadata ?? {}),
      cloudResourceStableKey: resource.stableKey,
      cloudResourceId: resource.resourceId,
      cloudResourceType: resource.resourceType,
      certificateEndpointKey: endpoint.endpointKey,
      certificateEndpointDeclared: true,
    },
  }));
}

function readCertificateEndpoints(resource: CloudServiceResourceV1): CloudCertificateEndpointV1[] {
  const declared = resource.metadata?.certificateEndpoints;
  if (declared !== undefined) {
    if (!Array.isArray(declared)) throw invalid('metadata.certificateEndpoints 必须是数组');
    return declared.map((item, index) => parseCertificateEndpoint(item, `metadata.certificateEndpoints[${index}]`));
  }
  const hasTargetType = resource.targetType !== undefined;
  const hasTargetKey = resource.targetKey !== undefined;
  if (hasTargetType !== hasTargetKey) throw invalid('targetType 和 targetKey 必须同时声明');
  if (!hasTargetType) return [];
  return [{
    endpointKey: resource.bindingKey ?? resource.targetKey!,
    targetType: resource.targetType!,
    targetKey: resource.targetKey!,
    ...(resource.bindingKey ? { bindingKey: resource.bindingKey } : {}),
    supportedCapabilities: resource.supportedCapabilities ?? ['cloud.resource.discover'],
    executionLocations: resource.executionLocations ?? ['CONTROL_PLANE'],
  }];
}

interface CloudCertificateFacts {
  providerCertificateId?: string;
  providerCertificateName?: string;
  fingerprintSha256?: string;
  subject?: string;
  issuer?: string;
  notBefore?: string;
  notAfter?: string;
  domainName?: string;
}

function readCloudCertificateFacts(metadata: Record<string, unknown>): CloudCertificateFacts | undefined {
  const nested = isRecord(metadata.certificate)
    ? metadata.certificate
    : isRecord(metadata.remoteCertificate) ? metadata.remoteCertificate : metadata;
  const value = (...keys: string[]) => keys.map((key) => nested[key]).find((item): item is string => typeof item === 'string' && item.trim() !== '')?.trim();
  const domainName = value('domainName', 'DomainName') ?? value('certDomainName') ?? value('address') ?? textValue(metadata.domainName);
  const metadataDomainName = ['domainName', 'DomainName', 'address']
    .map((key) => metadata[key])
    .find((item): item is string => typeof item === 'string' && item.trim() !== '')?.trim();
  const facts: CloudCertificateFacts = {
    providerCertificateId: value('providerCertificateId', 'certId', 'CertId', 'certificateId', 'CertificateId'),
    providerCertificateName: value('providerCertificateName', 'certificateName', 'CertName', 'CertificateName', 'certName'),
    fingerprintSha256: value('fingerprintSha256', 'FingerprintSha256', 'sha256Fingerprint', 'Sha256Fingerprint', 'Fingerprint'),
    subject: value('subject', 'Subject') ?? (value('certDomainName') ? `CN=${value('certDomainName')}` : undefined),
    issuer: value('issuer', 'Issuer') ?? value('certOrg'),
    notBefore: value('notBefore', 'NotBefore', 'certStartTime'),
    notAfter: value('notAfter', 'NotAfter', 'certExpireTime'),
    domainName: domainName ?? metadataDomainName,
  };
  return Object.values(facts).some(Boolean) ? facts : undefined;
}

function parseCertificateEndpoint(value: unknown, path: string): CloudCertificateEndpointV1 {
  if (!isRecord(value)) throw invalid(`${path} 必须是对象`);
  const endpointKey = identifier(value.endpointKey, `${path}.endpointKey`);
  const targetType = identifier(value.targetType, `${path}.targetType`);
  const targetKey = identifier(value.targetKey, `${path}.targetKey`);
  const bindingKey = value.bindingKey === undefined ? undefined : identifier(value.bindingKey, `${path}.bindingKey`);
  const supportedCapabilities = value.supportedCapabilities === undefined
    ? ['cloud.resource.discover']
    : stringArray(value.supportedCapabilities, `${path}.supportedCapabilities`);
  const locations = value.executionLocations === undefined
    ? ['CONTROL_PLANE' as const]
    : executionLocations(value.executionLocations, `${path}.executionLocations`);
  const metadata = value.metadata === undefined ? undefined : record(value.metadata, `${path}.metadata`);
  return {
    endpointKey,
    targetType,
    targetKey,
    ...(bindingKey ? { bindingKey } : {}),
    supportedCapabilities,
    executionLocations: locations,
    ...(metadata ? { metadata } : {}),
  };
}

/** 中文说明：同一云账号的下一次发现先退役上一版投影，随后用稳定 ID 恢复仍存在的设备、框架和站点。 */
async function retirePreviousProjection(tx: DatabasePort, context: CloudResourceProjectionContext, now: string): Promise<void> {
  await tx.query(
    `update pg_site_assets set status='RETIRED', deleted_at=$3, updated_at=$3, version=version+1
       where tenant_id=$1 and (asset_id=$2 or service_asset_id=$2) and site_type='cloud.resource' and deleted_at is null`,
    [context.tenantId, projectionOwnerAssetId(context), now],
  );
  await tx.query(
    `update pg_framework_instances set status='RETIRED', deleted_at=$3, updated_at=$3, version=version+1
       where tenant_id=$1 and (asset_id=$2 or service_asset_id=$2) and framework_type='cloud.resource' and deleted_at is null`,
    [context.tenantId, projectionOwnerAssetId(context), now],
  );
  await tx.query(
    `update pg_managed_targets set status='DELETED', deleted_at=$3, updated_at=$3, version=version+1
       where tenant_id=$1 and (service_asset_id=$2 or asset_id=$2) and deleted_at is null`,
    [context.tenantId, projectionOwnerAssetId(context), now],
  );
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw invalid(`${path} 必须是非空字符串数组`);
  }
  return value.map((item) => String(item).trim());
}

function executionLocations(value: unknown, path: string): Array<'CONTROL_PLANE' | 'GATEWAY'> {
  const values = stringArray(value, path);
  if (values.some((item) => item !== 'CONTROL_PLANE' && item !== 'GATEWAY')) throw invalid(`${path} 包含不支持的执行位置`);
  return values as Array<'CONTROL_PLANE' | 'GATEWAY'>;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function readExecutionLocations(value: unknown): Array<'CONTROL_PLANE' | 'GATEWAY'> {
  return readStringArray(value).filter((item): item is 'CONTROL_PLANE' | 'GATEWAY' => item === 'CONTROL_PLANE' || item === 'GATEWAY');
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
  const hasServiceAsset = typeof context.serviceAssetId === 'string' && context.serviceAssetId.trim() !== '';
  const hasCloudAccountAsset = typeof context.cloudAccountAssetId === 'string' && context.cloudAccountAssetId.trim() !== '';
  if (hasServiceAsset === hasCloudAccountAsset) {
    throw invalid('serviceAssetId 与 cloudAccountAssetId 必须二选一');
  }
  for (const [key, value] of Object.entries(context)) {
    if (['tenantId', 'serviceAssetId', 'cloudAccountAssetId', 'pluginId', 'pluginVersionId', 'provider'].includes(key)
      && (typeof value !== 'string' || value.trim() === '')) throw invalid(`${key} 不能为空`);
  }
}

function projectionOwnerAssetId(context: CloudResourceProjectionContext): string {
  const assetId = context.serviceAssetId ?? context.cloudAccountAssetId;
  if (!assetId) throw invalid('serviceAssetId 或 cloudAccountAssetId 至少提供一个');
  return assetId;
}

/** 中文说明：将投影所有者映射到统一资产列；标准链路只产生 serviceAssetId，旧云账号仅保留兼容列。 */
function projectionOwnerFields(context: CloudResourceProjectionContext): { serviceAssetId?: string; assetId?: string } {
  return context.serviceAssetId
    ? { serviceAssetId: context.serviceAssetId }
    : { assetId: context.cloudAccountAssetId };
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
