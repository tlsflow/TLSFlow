import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import type {
  ManagedDeviceDetailDto,
  ManagedDeviceCertificateDto,
  ManagedDeviceListQuery,
  ManagedDevicePageDto,
  ManagedDeviceSiteDto,
  ManagedDeviceSummaryDto,
} from '../dto/devices.dto.js';
import {
  ManagedDeviceProjectionRegistry,
  mapAgentHealth,
  mapNetworkDeviceHealth,
  type ManagedDeviceProjectionSource,
} from '../domain/managed-device-projection.js';

export { mapAgentHealth, mapNetworkDeviceHealth } from '../domain/managed-device-projection.js';

export interface DevicesRepository {
  list(tenantId: string, query: ManagedDeviceListQuery): Promise<ManagedDevicePageDto>;
  get(tenantId: string, deviceId: string, options?: { includes?: ReadonlySet<DeviceDetailInclude>; siteFrameworkId?: string }): Promise<ManagedDeviceDetailDto | undefined>;
}

export type DeviceDetailInclude = 'frameworks' | 'sites' | 'certificates' | 'logs';

export class PgDevicesRepository implements DevicesRepository {
  constructor(
    private readonly db: DatabasePort = new PgliteDatabase(),
    private readonly projectionRegistry = new ManagedDeviceProjectionRegistry(),
  ) {}

  async list(tenantId: string, query: ManagedDeviceListQuery): Promise<ManagedDevicePageDto> {
    const rows = (await this.db.query<ManagedDeviceRow>(DEVICE_LIST_SQL, [tenantId])).rows;
    const items = rows.map((row) => this.projectionRegistry.project(toProjectionSource(row))).filter((item) => matches(item, query));
    const authorized = query.authorizedHostIds
      ? items.filter((item) => query.authorizedHostIds!.includes(item.id))
      : items;
    const sorted = sortItems(authorized, query);
    const offset = (query.page - 1) * query.pageSize;
    return {
      items: sorted.slice(offset, offset + query.pageSize),
      page: query.page,
      pageSize: query.pageSize,
      total: sorted.length,
    };
  }

  async get(tenantId: string, deviceId: string, options: { includes?: ReadonlySet<DeviceDetailInclude>; siteFrameworkId?: string } = {}): Promise<ManagedDeviceDetailDto | undefined> {
    const includes = options.includes ?? new Set<DeviceDetailInclude>(['frameworks', 'sites', 'certificates', 'logs']);
    const row = (await this.db.query<ManagedDeviceRow>(DEVICE_DETAIL_SQL, [tenantId, deviceId])).rows[0];
    if (!row) return undefined;
    const summary = this.projectionRegistry.project(toProjectionSource(row));
    const [managedSites, resources] = await Promise.all([
      includes.has('sites') ? this.getManagedSites(tenantId, row.id, options.siteFrameworkId) : Promise.resolve([]),
      this.getStandardDeviceResources(tenantId, row.id, row.device_asset_id ?? undefined, includes),
    ]);
    const sites = managedSites;
    const certificates = mergeCertificates(resources.certificates, collectSiteCertificates(sites));
    const updatedAt = String(row.updated_at);
    return {
      ...summary,
      statusReason: row.last_error_code ?? undefined,
      allowedActions: summary.extensionType === 'AGENT'
        ? ['VIEW_APPLICATIONS', 'VIEW_RUNTIME', 'UPGRADE_AGENT', 'DISABLE_DEVICE']
        : ['VIEW_APPLICATIONS', 'EDIT_CONNECTION', 'DISABLE_DEVICE'],
      publicSummary: {
        hostname: row.hostname ?? undefined,
        osType: row.os_type,
        managementMode: row.management_mode,
        updatedAt,
      },
      overview: {
        deviceId: summary.id,
        displayName: summary.displayName,
        deviceType: summary.extensionType === 'AGENT' ? 'AGENT' : row.device_family ?? 'NETWORK_APPLIANCE',
        productFamily: summary.productFamily,
        managementMode: row.management_mode,
        status: summary.livenessStatus ?? 'UNKNOWN',
        updatedAt,
      },
      informationSections: buildInformationSections(row, summary, updatedAt, resources),
      frameworks: resources.frameworks,
      sites,
      certificates,
      logs: resources.logs,
      resourceCounts: {
        frameworks: Number(row.framework_count ?? 0),
        sites: Number(row.site_count ?? 0),
        certificates: Number(row.certificate_count ?? 0),
        logs: Number(row.log_count ?? 0),
      },
      extension: summary.extensionType === 'AGENT'
        ? { type: 'AGENT', agentId: row.agent_id ?? '' }
        : row.plugin_version_id && row.plugin_binding_id
          ? { type: 'PLUGIN', deviceAssetId: row.device_asset_id ?? '', pluginVersionId: row.plugin_version_id, pluginBindingId: row.plugin_binding_id }
          : { type: 'GENERIC', rawType: row.device_family ?? undefined },
      extensionSummary: summary.extensionType === 'AGENT'
        ? { agentId: row.agent_id, descriptor: asRecord(asRecord(row.agent_payload).descriptor) }
        : {
            deviceAssetId: row.device_asset_id,
            deviceFamily: row.device_family,
            managementPort: row.management_port,
            authMode: row.auth_mode,
            tlsVerify: row.tls_verify,
            supportTier: row.support_tier,
            softwareBuild: row.software_build,
            pluginVersion: row.control_version,
            discoveryMetadata: asRecord(row.device_metadata),
            capabilityProfile: asRecord(row.capability_profile),
          },
    };
  }

  private async getStandardDeviceResources(tenantId: string, deviceId: string, deviceAssetId: string | undefined, includes: ReadonlySet<DeviceDetailInclude>) {
    const [deviceLogs, frameworks, discoveredCertificates] = await Promise.all([
      includes.has('logs') ? this.db.query<DeviceLogRow>(
        `select document_id, payload
         from pg_documents
         where namespace='security.audit_logs'
           and (payload->>'tenantId'=$1 or payload->>'tenantId' is null)
           and payload->>'resourceId' in ($2, $3)
         order by payload->>'createdAt' desc, updated_at desc
         limit 100`,
        [tenantId, deviceId, deviceAssetId ?? deviceId],
      ) : Promise.resolve({ rows: [] as DeviceLogRow[] }),
      includes.has('frameworks') ? this.db.query<FrameworkRow>(
        `select id, framework_key, framework_type, display_name, version_text, status, raw_facts
         from pg_framework_instances
         where tenant_id=$1 and device_id=$2 and status='ACTIVE' and deleted_at is null
           and framework_type <> 'device.generic'
         order by display_name, framework_key`,
        [tenantId, deviceId],
      ) : Promise.resolve({ rows: [] as FrameworkRow[] }),
      deviceAssetId && includes.has('certificates') ? this.db.query<DiscoveredCertificateRow>(
        `select certificate.id, certificate.stable_key, certificate.fingerprint_sha256,
                certificate.subject, certificate.issuer, certificate.not_before, certificate.not_after,
                certificate.metadata, certificate.status, certificate.certificate_version_id,
                version.certificate_asset_id, asset.name as certificate_name
          from plugin_discovered_certificates certificate
          left join pg_certificate_versions version on version.id=certificate.certificate_version_id
          left join pg_certificate_assets asset on asset.id=version.certificate_asset_id
          where certificate.tenant_id=$1 and certificate.device_asset_id=$2 and certificate.status='ACTIVE'
          order by certificate.stable_key`,
        [tenantId, deviceAssetId],
      ) : Promise.resolve({ rows: [] as DiscoveredCertificateRow[] }),
    ]);
    return {
      frameworks: frameworks.rows.map((framework) => ({
        id: framework.id,
        stableKey: framework.framework_key,
        frameworkType: framework.framework_type,
        displayName: framework.display_name,
        version: framework.version_text ?? undefined,
        status: framework.status,
        metadata: asRecord(framework.raw_facts),
      })),
      certificates: discoveredCertificates.rows.map((item) => ({
        id: item.id,
        certificateAssetId: item.certificate_asset_id ?? undefined,
        certificateVersionId: item.certificate_version_id ?? undefined,
        name: item.certificate_name ?? String(item.metadata?.certkey ?? item.stable_key),
        subject: item.subject ?? undefined,
        issuer: item.issuer ?? undefined,
        notBefore: optionalTimestamp(item.not_before),
        notAfter: optionalTimestamp(item.not_after),
        fingerprintSha256: item.fingerprint_sha256 ?? undefined,
        status: item.status,
      })),
      logs: deviceLogs.rows.map((item) => ({
        id: item.document_id,
        eventType: item.payload.eventType ?? item.payload.action ?? 'device.event',
        result: item.payload.result,
        summary: typeof item.payload.detail === 'string' ? item.payload.detail : item.payload.action,
        occurredAt: item.payload.createdAt ?? new Date(0).toISOString(),
        actorId: item.payload.actorId,
        metadata: {
          action: item.payload.action,
          riskLevel: item.payload.riskLevel,
          requestId: item.payload.requestId,
        },
      })),
    };
  }

  private async getManagedSites(tenantId: string, deviceId: string, frameworkInstanceId?: string): Promise<ManagedDeviceSiteDto[]> {
    const rows = (await this.db.query<ManagedSiteRow>(
      `with active_bindings as (
         select binding.*,
                row_number() over (
                  partition by binding.tenant_id,
                    coalesce(binding.site_asset_id, target.site_id, binding.managed_target_id, binding.id),
                    lower(coalesce(
                      nullif(binding.domain_name, ''),
                      nullif(binding.domain, ''),
                      nullif(binding.metadata->>'listenerHost', ''),
                      nullif(binding.metadata->>'certificateSni', ''),
                      ''
                    )),
                    coalesce(binding.port, 0),
                    upper(coalesce(binding.protocol, ''))
                  order by binding.checked_at desc nulls last, binding.updated_at desc, binding.id desc
                ) as discovery_rank
         from pg_certificate_bindings binding
         left join pg_managed_targets target
           on target.tenant_id=binding.tenant_id and target.id=binding.managed_target_id and target.deleted_at is null
         where binding.deleted_at is null
           and coalesce(binding.status, '') <> 'STALE'
           and binding.metadata->>'discoveryStatus' = 'ACTIVE'
       )
       select site.id, site.site_type, site.site_name, site.binding_information, site.host_header,
              site.listen_ip, site.port, site.protocol, site.config_path, site.runtime_status, site.status, site.metadata,
              framework.id as framework_instance_id, framework.framework_type,
              target.id as managed_target_id, target.binding_key as target_binding_key, target.status as target_status,
              binding.id as binding_id, binding.binding_key, binding.binding_type, binding.domain_name,
              binding.status as binding_status, binding.certificate_version_id, binding.observed_fingerprint_sha256,
              binding.drift_status, binding.cert_path, binding.key_path, binding.chain_path, binding.keystore_path,
              binding.keystore_type, binding.store_location, binding.store_name, binding.store_thumbprint, binding.local_config_path,
              binding.metadata as binding_metadata,
               version.common_name, version.subject as certificate_subject, version.issuer as certificate_issuer,
               version.not_before, version.not_after, version.fingerprint_sha256, version.status as certificate_status,
               version.certificate_asset_id, asset.name as certificate_name
       from pg_site_assets site
       join pg_framework_instances framework
         on framework.tenant_id=site.tenant_id and framework.id=site.framework_instance_id and framework.deleted_at is null
       left join pg_managed_targets target
         on target.tenant_id=site.tenant_id and target.site_id=site.id and target.deleted_at is null
       left join active_bindings binding
         on binding.tenant_id=site.tenant_id and binding.discovery_rank=1
        and (binding.site_asset_id=site.id or (target.id is not null and binding.managed_target_id=target.id))
       left join pg_certificate_versions version on version.id=binding.certificate_version_id
       left join pg_certificate_assets asset on asset.id=version.certificate_asset_id
       where site.tenant_id=$1 and site.device_id=$2 and site.status='ACTIVE' and site.deleted_at is null
         and ($3::text is null or framework.id=$3)
       order by site.site_name, binding.binding_key`,
      [tenantId, deviceId, frameworkInstanceId ?? null],
    )).rows;
    const sites = new Map<string, ManagedDeviceSiteDto>();
    for (const row of rows) {
      const existing: ManagedDeviceSiteDto = sites.get(row.id) ?? {
        id: row.id,
        siteAssetId: row.id,
        frameworkInstanceId: row.framework_instance_id,
        managedTargetId: row.managed_target_id ?? undefined,
        kind: row.site_type,
        frameworkType: row.framework_type,
        name: row.site_name,
        status: row.runtime_status ?? row.status,
        endpoint: {
          address: row.listen_ip ?? undefined,
          hostName: row.host_header ?? undefined,
          port: row.port ?? undefined,
          protocol: row.protocol ?? undefined,
        },
        configPath: row.config_path ?? undefined,
        bindings: [] as ManagedDeviceSiteDto['bindings'],
        metadata: asRecord(row.metadata),
      } satisfies ManagedDeviceSiteDto;
      if (row.binding_id && !existing.bindings.some((binding) => binding.id === row.binding_id)) {
        const observedCertificate = asRecord(asRecord(row.binding_metadata).observedCertificate);
        const observedFingerprint = row.observed_fingerprint_sha256 ?? optionalString(observedCertificate.fingerprintSha256);
        const configuredCertificate = asRecord(asRecord(row.binding_metadata).configuredCertificate);
        const configuredFingerprint = row.fingerprint_sha256 ?? optionalString(configuredCertificate.fingerprintSha256);
        const hasCertificate = Boolean(row.certificate_version_id || configuredFingerprint || Object.keys(configuredCertificate).length);
        const deploymentTarget = certificateLocationFromRow(row);
        existing.bindings.push({
          id: row.binding_id,
          bindingKey: row.binding_key ?? row.target_binding_key ?? row.binding_id,
          bindingType: row.binding_type ?? 'UNKNOWN',
          hostName: row.domain_name ?? undefined,
          status: row.binding_status ?? 'UNKNOWN',
          certificate: hasCertificate ? {
            certificateAssetId: row.certificate_asset_id ?? undefined,
            certificateVersionId: row.certificate_version_id ?? undefined,
            name: row.certificate_name ?? row.common_name ?? optionalString(configuredCertificate.name),
            subject: distinguishedName(row.certificate_subject) ?? optionalString(configuredCertificate.subject),
            issuer: distinguishedName(row.certificate_issuer) ?? optionalString(configuredCertificate.issuer),
            notBefore: optionalTimestamp(row.not_before ?? configuredCertificate.notBefore),
            notAfter: optionalTimestamp(row.not_after ?? configuredCertificate.notAfter),
            fingerprintSha256: configuredFingerprint ?? undefined,
            status: row.certificate_status ?? row.binding_status ?? undefined,
          } : undefined,
          observedCertificate: observedFingerprint || Object.keys(observedCertificate).length ? {
            name: optionalString(observedCertificate.name),
            subject: optionalString(observedCertificate.subject),
            issuer: optionalString(observedCertificate.issuer),
            notBefore: optionalTimestamp(observedCertificate.notBefore),
            notAfter: optionalTimestamp(observedCertificate.notAfter),
            fingerprintSha256: observedFingerprint ?? undefined,
            status: row.drift_status ?? row.binding_status ?? undefined,
          } : undefined,
          driftStatus: row.drift_status ?? optionalString(asRecord(row.binding_metadata).driftStatus) ?? 'UNKNOWN',
          deploymentTarget,
          replacement: row.managed_target_id && row.target_status === 'ACTIVE'
            ? { allowed: true, managedTargetId: row.managed_target_id }
            : { allowed: false, reasonCode: 'MANAGED_TARGET_UNAVAILABLE' },
        });
      }
      sites.set(row.id, existing);
    }
    return [...sites.values()];
  }
}

const DEVICE_LIST_SQL = `
  with tenant_hosts as (
    select *
      from pg_hosts
     where tenant_id = $1
       and deleted_at is null
  ), tenant_agents as (
    select distinct agent_id
      from tenant_hosts
     where agent_id is not null
  ), agent_extensions as (
    select document.document_id as agent_id, document.payload
      from pg_documents document
      join tenant_agents agent on agent.agent_id = document.document_id
     where document.namespace = 'agents:registrations'
       and document.payload->>'tenantId' = $1
  ), current_agent_snapshots as (
    select current_snapshot.agent_id, document.payload
      from pg_agent_capability_snapshot_current current_snapshot
      join tenant_agents agent on agent.agent_id = current_snapshot.agent_id
      join pg_documents document
        on document.namespace = 'agents:snapshots'
       and document.document_id = current_snapshot.latest_snapshot_id
     where current_snapshot.tenant_id = $1
  ), fallback_agent_snapshots as (
    select distinct on (document.payload->>'agentId') document.payload->>'agentId' as agent_id, document.payload
      from pg_documents document
      join tenant_agents agent on agent.agent_id = document.payload->>'agentId'
     where document.namespace = 'agents:snapshots'
       and document.payload->>'tenantId' = $1
       and not exists (
         select 1
           from pg_agent_capability_snapshot_current current_snapshot
          where current_snapshot.tenant_id = $1
            and current_snapshot.agent_id = document.payload->>'agentId'
       )
     order by document.payload->>'agentId', document.payload->>'reportedAt' desc
  ), agent_snapshots as (
    select agent_id, payload from current_agent_snapshots
    union all
    select agent_id, payload from fallback_agent_snapshots
  ), agent_heartbeats as (
    select distinct on (document.payload->>'agentId') document.payload->>'agentId' as agent_id,
           document.payload->>'receivedAt' as received_at
      from pg_documents document
      join tenant_agents agent on agent.agent_id = document.payload->>'agentId'
     where document.namespace = 'agents:heartbeats'
       and document.payload->>'tenantId' = $1
     order by document.payload->>'agentId', document.payload->>'receivedAt' desc
  ), liveness_signals as (
    select tenant_id, resource_type, resource_id,
           jsonb_agg(jsonb_build_object(
             'id', id,
             'tenant_id', tenant_id,
             'resource_type', resource_type,
             'resource_id', resource_id,
             'signal_type', signal_type,
             'required', required,
             'status', status,
             'consecutive_failures', consecutive_failures,
             'last_observed_at', last_observed_at,
             'last_success_at', last_success_at,
             'last_failure_at', last_failure_at,
             'endpoint_host', endpoint_host,
             'endpoint_port', endpoint_port,
             'source', source,
             'reason_code', reason_code,
             'reason_detail', reason_detail,
             'observation_id', observation_id,
             'created_at', created_at,
             'updated_at', updated_at
           ) order by signal_type) signals
      from pg_device_liveness_signals
     where tenant_id = $1
     group by tenant_id, resource_type, resource_id
  ), application_counts as (
    select host_id, count(distinct asset_id)::int as asset_count
    from (
      select sa.host_id, sa.id as asset_id
      from pg_service_assets sa
      where sa.tenant_id = $1 and sa.deleted_at is null and coalesce(sa.asset_kind, 'APPLICATION') <> 'DEVICE'
      union
      select si.device_id as host_id, site.id as asset_id
      from pg_site_assets site
      join pg_framework_instances si on si.id = site.framework_instance_id and si.tenant_id = site.tenant_id
      where site.tenant_id = $1 and site.status = 'ACTIVE' and site.deleted_at is null and si.deleted_at is null
    ) related_assets
    where host_id is not null
    group by host_id
  )
  select
    host.id,
    host.display_name,
    host.hostname,
    host.primary_ip,
    host.os_type,
    host.os_name,
    host.os_version,
    host.management_mode,
    host.status as host_status,
    host.last_discovered_at,
    host.updated_at,
    host.agent_id,
    agent.payload as agent_payload,
    snapshot.payload as agent_capability_payload,
    heartbeat.received_at as agent_last_heartbeat_at,
    coalesce(liveness.signals, '[]'::jsonb) as liveness_signals,
    device.service_asset_id as device_asset_id,
    device.device_family,
    device.management_port,
    device.auth_mode,
    device.tls_verify,
    device.product_name,
    device.product_family,
    device.software_version,
    device.software_build,
    device.support_tier,
    device.capability_profile,
    device.metadata as device_metadata,
    device.plugin_version_id,
    plugin_version.plugin_version as control_version,
    device.plugin_binding_id,
    device.last_discovered_at as device_last_discovered_at,
    device.last_error_code,
    service.address as device_address,
    coalesce(counts.asset_count, 0)::int as application_asset_count
  from tenant_hosts host
  left join agent_extensions agent on agent.agent_id = host.agent_id
  left join agent_snapshots snapshot on snapshot.agent_id = host.agent_id
  left join agent_heartbeats heartbeat on heartbeat.agent_id = host.agent_id
  left join liveness_signals liveness on liveness.tenant_id=host.tenant_id
    and liveness.resource_type=case when host.agent_id is not null then 'AGENT' else 'DEVICE' end
    and liveness.resource_id=coalesce(host.agent_id, host.id)
  left join pg_device_assets device on device.tenant_id = host.tenant_id and device.host_id = host.id
  left join unified_plugin_versions plugin_version on plugin_version.id = device.plugin_version_id
  left join pg_service_assets service on service.tenant_id = device.tenant_id and service.id = device.service_asset_id and service.deleted_at is null
  left join application_counts counts on counts.host_id = host.id
  where host.agent_id is not null or service.id is not null
`;

// 详情查询只围绕目标 Host 建立 CTE。列表中的全租户聚合不能复用于单设备详情，
// 否则打开一台设备也会扫描整个租户的历史快照、存活信号和资产计数。
const DEVICE_DETAIL_SQL = `
  with target_host as (
    select * from pg_hosts
     where tenant_id=$1 and deleted_at is null and (id=$2 or agent_id=$2)
     limit 1
  ), agent_extensions as (
    select document_id as agent_id, payload
      from pg_documents
     where namespace='agents:registrations'
       and payload->>'tenantId'=$1
       and document_id=(select agent_id from target_host)
  ), agent_snapshots as (
    select distinct on (payload->>'agentId') payload->>'agentId' as agent_id, payload
      from pg_documents
     where namespace='agents:snapshots'
       and payload->>'tenantId'=$1
       and payload->>'agentId'=(select agent_id from target_host)
     order by payload->>'agentId', payload->>'reportedAt' desc
  ), agent_heartbeats as (
    select distinct on (payload->>'agentId') payload->>'agentId' as agent_id, payload->>'receivedAt' as received_at
      from pg_documents
     where namespace='agents:heartbeats'
       and payload->>'tenantId'=$1
       and payload->>'agentId'=(select agent_id from target_host)
     order by payload->>'agentId', payload->>'receivedAt' desc
  ), liveness_signals as (
    select tenant_id, resource_type, resource_id,
           jsonb_agg(jsonb_build_object(
             'id', id, 'tenant_id', tenant_id, 'resource_type', resource_type, 'resource_id', resource_id,
             'signal_type', signal_type, 'required', required, 'status', status,
             'consecutive_failures', consecutive_failures, 'last_observed_at', last_observed_at,
             'last_success_at', last_success_at, 'last_failure_at', last_failure_at,
             'endpoint_host', endpoint_host, 'endpoint_port', endpoint_port, 'source', source,
             'reason_code', reason_code, 'reason_detail', reason_detail, 'observation_id', observation_id,
             'created_at', created_at, 'updated_at', updated_at
           ) order by signal_type) signals
      from pg_device_liveness_signals
     where tenant_id=$1
       and resource_type=case when (select agent_id from target_host) is not null then 'AGENT' else 'DEVICE' end
       and resource_id=coalesce((select agent_id from target_host), (select id from target_host))
     group by tenant_id, resource_type, resource_id
  ), application_counts as (
    select count(distinct asset_id)::int as asset_count
      from (
        select sa.id as asset_id from pg_service_assets sa
         where sa.tenant_id=$1 and sa.host_id=(select id from target_host)
           and sa.deleted_at is null and coalesce(sa.asset_kind, 'APPLICATION') <> 'DEVICE'
        union
        select site.id from pg_site_assets site
         join pg_framework_instances framework on framework.id=site.framework_instance_id and framework.tenant_id=site.tenant_id
         where site.tenant_id=$1 and site.device_id=(select id from target_host)
           and site.status='ACTIVE' and site.deleted_at is null and framework.deleted_at is null
      ) related_assets
  ), resource_counts as (
    select
      (select count(*) from pg_framework_instances where tenant_id=$1 and device_id=(select id from target_host) and status='ACTIVE' and deleted_at is null)::int as framework_count,
      (select count(*) from pg_site_assets where tenant_id=$1 and device_id=(select id from target_host) and status='ACTIVE' and deleted_at is null)::int as site_count,
      (select count(*) from plugin_discovered_certificates where tenant_id=$1 and device_asset_id=(select service_asset_id from pg_device_assets where tenant_id=$1 and host_id=(select id from target_host)) and status='ACTIVE')::int as certificate_count,
      (select count(*) from pg_documents
        where namespace='security.audit_logs'
          and (payload->>'tenantId'=$1 or payload->>'tenantId' is null)
          and payload->>'resourceId' in ((select id from target_host), (select service_asset_id from pg_device_assets where tenant_id=$1 and host_id=(select id from target_host))))::int as log_count
  )
  select host.id, host.display_name, host.hostname, host.primary_ip, host.os_type, host.os_name, host.os_version,
    host.management_mode, host.status as host_status, host.last_discovered_at, host.updated_at, host.agent_id,
    agent.payload as agent_payload, snapshot.payload as agent_capability_payload, heartbeat.received_at as agent_last_heartbeat_at,
    coalesce(liveness.signals, '[]'::jsonb) as liveness_signals, device.service_asset_id as device_asset_id,
    device.device_family, device.management_port, device.auth_mode, device.tls_verify, device.product_name,
    device.product_family, device.software_version, device.software_build, device.support_tier, device.capability_profile,
    device.metadata as device_metadata, device.plugin_version_id, plugin_version.plugin_version as control_version,
    device.plugin_binding_id, device.last_discovered_at as device_last_discovered_at, device.last_error_code,
    service.address as device_address, coalesce(counts.asset_count, 0)::int as application_asset_count,
    resource_counts.framework_count, resource_counts.site_count, resource_counts.certificate_count, resource_counts.log_count
  from target_host host
  left join agent_extensions agent on agent.agent_id=host.agent_id
  left join agent_snapshots snapshot on snapshot.agent_id=host.agent_id
  left join agent_heartbeats heartbeat on heartbeat.agent_id=host.agent_id
  left join liveness_signals liveness on true
  left join pg_device_assets device on device.tenant_id=host.tenant_id and device.host_id=host.id
  left join unified_plugin_versions plugin_version on plugin_version.id=device.plugin_version_id
  left join pg_service_assets service on service.tenant_id=device.tenant_id and service.id=device.service_asset_id and service.deleted_at is null
  cross join application_counts counts
  cross join resource_counts
`;

interface ManagedDeviceRow extends Record<string, unknown> {
  id: string;
  display_name: string | null;
  hostname: string | null;
  primary_ip: string | null;
  os_type: string;
  os_name: string | null;
  os_version: string | null;
  management_mode: string;
  host_status: string;
  last_discovered_at: string | null;
  updated_at: string;
  agent_id: string | null;
  agent_payload: Record<string, unknown> | null;
  agent_capability_payload: Record<string, unknown> | null;
  agent_last_heartbeat_at: string | null;
  liveness_signals: Array<Record<string, unknown>> | null;
  device_asset_id: string | null;
  device_family: string | null;
  management_port: number | null;
  auth_mode: string | null;
  tls_verify: boolean | null;
  product_name: string | null;
  product_family: string | null;
  software_version: string | null;
  software_build: string | null;
  support_tier: string | null;
  capability_profile: Record<string, unknown> | null;
  device_metadata: Record<string, unknown> | null;
  plugin_version_id: string | null;
  control_version: string | null;
  plugin_binding_id: string | null;
  device_last_discovered_at: string | null;
  last_error_code: string | null;
  device_address: string | null;
  application_asset_count: number;
  framework_count?: number;
  site_count?: number;
  certificate_count?: number;
  log_count?: number;
}

interface DeviceLogRow extends Record<string, unknown> {
  document_id: string;
  payload: {
    eventType?: string;
    action?: string;
    result?: string;
    riskLevel?: string;
    actorId?: string;
    requestId?: string;
    detail?: unknown;
    createdAt?: string;
  };
}

interface FrameworkRow extends Record<string, unknown> {
  id: string;
  framework_key: string;
  framework_type: string;
  display_name: string;
  version_text: string | null;
  status: string;
  raw_facts: Record<string, unknown> | null;
}

interface DiscoveredCertificateRow extends Record<string, unknown> {
  id: string;
  stable_key: string;
  fingerprint_sha256: string | null;
  subject: string | null;
  issuer: string | null;
  not_before: string | null;
  not_after: string | null;
  metadata: Record<string, unknown> | null;
  status: string;
  certificate_version_id: string | null;
  certificate_asset_id: string | null;
  certificate_name: string | null;
}

interface ManagedSiteRow extends Record<string, unknown> {
  id: string;
  site_type: ManagedDeviceSiteDto['kind'];
  site_name: string;
  binding_information: string | null;
  host_header: string | null;
  listen_ip: string | null;
  port: number | null;
  protocol: string | null;
  config_path: string | null;
  runtime_status: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
  framework_instance_id: string;
  framework_type: string;
  managed_target_id: string | null;
  target_binding_key: string | null;
  target_status: string | null;
  binding_id: string | null;
  binding_key: string | null;
  binding_type: string | null;
  domain_name: string | null;
  binding_status: string | null;
  certificate_version_id: string | null;
  observed_fingerprint_sha256: string | null;
  drift_status: string | null;
  cert_path: string | null;
  key_path: string | null;
  chain_path: string | null;
  keystore_path: string | null;
  keystore_type: string | null;
  store_location: string | null;
  store_name: string | null;
  store_thumbprint: string | null;
  local_config_path: string | null;
  binding_metadata: Record<string, unknown> | null;
  certificate_asset_id: string | null;
  common_name: string | null;
  certificate_subject: unknown;
  certificate_issuer: unknown;
  not_before: string | null;
  not_after: string | null;
  fingerprint_sha256: string | null;
  certificate_status: string | null;
  certificate_name: string | null;
}

function certificateLocationFromRow(row: ManagedSiteRow): Record<string, unknown> | undefined {
  const metadata = asRecord(row.binding_metadata);
  const nested = asRecord(metadata.certificateLocation) ?? asRecord(metadata.deploymentTarget);
  if (nested) return nested;
  if (row.keystore_path) return {
    storageKind: 'KEYSTORE',
    keystorePath: row.keystore_path,
    ...(row.keystore_type ? { keystoreType: row.keystore_type } : {}),
    ...(row.local_config_path ? { sourceConfigPath: row.local_config_path } : {}),
  };
  if (row.store_thumbprint) return {
    storageKind: 'WINDOWS_CERTIFICATE_STORE',
    storeThumbprint: row.store_thumbprint,
    ...(row.store_name ? { storeName: row.store_name } : {}),
    ...(row.store_location ? { storeLocation: row.store_location } : {}),
    ...(row.local_config_path ? { sourceConfigPath: row.local_config_path } : {}),
  };
  if (row.cert_path || row.key_path || row.chain_path) return {
    storageKind: 'PEM_FILES',
    ...(row.cert_path ? { certificatePath: row.cert_path } : {}),
    ...(row.key_path ? { privateKeyPath: row.key_path } : {}),
    ...(row.chain_path ? { chainPath: row.chain_path } : {}),
    ...(row.local_config_path ? { sourceConfigPath: row.local_config_path } : {}),
  };
  return undefined;
}

function toProjectionSource(row: ManagedDeviceRow): ManagedDeviceProjectionSource {
  const source: ManagedDeviceProjectionSource = {
    id: row.id,
    displayName: row.display_name ?? undefined,
    hostname: row.hostname ?? undefined,
    primaryIp: row.primary_ip ?? undefined,
    osType: row.os_type,
    osName: row.os_name ?? undefined,
    osVersion: row.os_version ?? undefined,
    managementMode: row.management_mode,
    hostStatus: row.host_status,
    lastDiscoveredAt: row.last_discovered_at ?? undefined,
    applicationAssetCount: Number(row.application_asset_count),
    livenessSignals: (row.liveness_signals ?? []).map(mapLivenessSignal),
  };
  if (row.device_family) {
    source.networkAppliance = {
      deviceFamily: row.device_family,
      productName: row.product_family ?? row.product_name ?? undefined,
      softwareVersion: row.software_version ?? undefined,
      softwareBuild: row.software_build ?? undefined,
      pluginVersion: row.control_version ?? undefined,
      supportTier: row.support_tier ?? undefined,
      capabilityProfile: asRecord(row.capability_profile),
      lastDiscoveredAt: row.device_last_discovered_at ?? undefined,
      lastErrorCode: row.last_error_code ?? undefined,
      managementAddress: row.device_address ?? undefined,
    };
  } else {
    source.agent = {
      payload: asRecord(row.agent_payload),
      capabilitySnapshot: asRecord(row.agent_capability_payload),
      lastHeartbeatAt: row.agent_last_heartbeat_at ?? undefined,
    };
  }
  return source;
}

function mapLivenessSignal(row: Record<string, unknown>): import('../../liveness/schema/liveness.schema.js').DeviceLivenessSignal {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    resourceType: String(row.resource_type) as 'AGENT' | 'DEVICE',
    resourceId: String(row.resource_id),
    signalType: String(row.signal_type) as 'HEARTBEAT' | 'MANAGEMENT_TCP',
    required: row.required !== false,
    status: String(row.status) as 'UNKNOWN' | 'HEALTHY' | 'SUSPECT' | 'FAILED',
    consecutiveFailures: Number(row.consecutive_failures ?? 0),
    lastObservedAt: optionalString(row.last_observed_at),
    lastSuccessAt: optionalString(row.last_success_at),
    lastFailureAt: optionalString(row.last_failure_at),
    endpointHost: optionalString(row.endpoint_host),
    endpointPort: row.endpoint_port === null || row.endpoint_port === undefined ? undefined : Number(row.endpoint_port),
    source: String(row.source) as 'AGENT' | 'CONTROL_PLANE' | 'GATEWAY',
    reasonCode: optionalString(row.reason_code),
    reasonDetail: optionalString(row.reason_detail),
    observationId: optionalString(row.observation_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function matches(item: ManagedDeviceSummaryDto, query: ManagedDeviceListQuery): boolean {
  return Object.entries(query.filter).every(([field, expected]) => !expected || String(item[field as keyof ManagedDeviceSummaryDto]) === expected);
}

function sortItems(items: ManagedDeviceSummaryDto[], query: ManagedDeviceListQuery): ManagedDeviceSummaryDto[] {
  const field = query.sort?.field ?? 'displayName';
  const direction = query.sort?.direction === 'desc' ? -1 : 1;
  return [...items].sort((left, right) => String(left[field as keyof ManagedDeviceSummaryDto] ?? '').localeCompare(String(right[field as keyof ManagedDeviceSummaryDto] ?? '')) * direction);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function optionalTimestamp(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return value instanceof Date ? value.toISOString() : String(value);
}

function distinguishedName(value: unknown): string | undefined {
  if (typeof value === 'string') return value || undefined;
  const record = asRecord(value);
  const commonName = record.commonName ?? record.CN ?? record.cn;
  if (commonName) return `CN=${String(commonName)}`;
  const entries = Object.entries(record).filter(([, entry]) => entry !== undefined && entry !== null && entry !== '');
  return entries.length ? entries.map(([key, entry]) => `${key}=${String(entry)}`).join(', ') : undefined;
}

function collectSiteCertificates(sites: ManagedDeviceSiteDto[]) {
  const certificates = new Map<string, NonNullable<ManagedDeviceSiteDto['bindings'][number]['certificate']> & { id: string }>();
  for (const site of sites) {
    for (const binding of site.bindings) {
      const certificate = binding.certificate;
      if (!certificate) continue;
      const id = certificate.certificateVersionId ?? certificate.fingerprintSha256 ?? certificate.name ?? binding.id;
      certificates.set(id, { id, ...certificate });
    }
  }
  return [...certificates.values()];
}

function mergeCertificates(
  primary: ManagedDeviceCertificateDto[],
  secondary: ManagedDeviceCertificateDto[],
): ManagedDeviceCertificateDto[] {
  const identity = (certificate: ManagedDeviceCertificateDto) => (
    certificate.certificateVersionId ?? certificate.fingerprintSha256 ?? certificate.id
  );
  const certificates = new Map(primary.map((certificate) => [identity(certificate), certificate]));
  for (const certificate of secondary) if (!certificates.has(identity(certificate))) certificates.set(identity(certificate), certificate);
  return [...certificates.values()];
}

function buildInformationSections(
  row: ManagedDeviceRow,
  summary: ManagedDeviceSummaryDto,
  updatedAt: string,
  resources: Awaited<ReturnType<PgDevicesRepository['getStandardDeviceResources']>>,
) {
  const common = {
    key: 'common',
    fields: [
      { key: 'hostname', value: row.hostname, valueType: 'TEXT' as const, copyable: true },
      { key: 'osType', value: row.os_type, valueType: 'TEXT' as const },
      { key: 'managementMode', value: optionalString(asRecord(row.device_metadata).managementProtocol) ?? row.management_mode, valueType: 'TEXT' as const },
      { key: 'updatedAt', value: updatedAt, valueType: 'DATETIME' as const },
    ],
  };
  if (summary.extensionType === 'AGENT') return [common];
  return [common, {
    key: 'networkAppliance',
    fields: [
      { key: 'deviceFamily', value: row.device_family, valueType: 'TEXT' as const },
      { key: 'managementAddress', value: row.device_address, valueType: 'TEXT' as const, copyable: true },
      { key: 'managementPort', value: row.management_port, valueType: 'NUMBER' as const },
      { key: 'authMode', value: row.auth_mode, valueType: 'TEXT' as const },
      { key: 'tlsVerify', value: row.tls_verify, valueType: 'BOOLEAN' as const },
      { key: 'softwareVersion', value: row.software_version, valueType: 'TEXT' as const },
      { key: 'softwareBuild', value: row.software_build, valueType: 'TEXT' as const },
      { key: 'pluginVersion', value: row.control_version, valueType: 'TEXT' as const },
      { key: 'supportTier', value: row.support_tier, valueType: 'STATUS' as const },
      { key: 'healthStatus', value: summary.health, valueType: 'STATUS' as const },
      { key: 'certificateCount', value: resources?.certificates.length ?? 0, valueType: 'NUMBER' as const },
    ],
  }];
}
