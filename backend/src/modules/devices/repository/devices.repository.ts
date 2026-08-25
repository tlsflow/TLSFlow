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
    const parameters: unknown[] = [tenantId];
    const sql = buildDeviceListSql(query, parameters);
    const rows = (await this.db.query<ManagedDeviceRow>(sql, parameters)).rows;
    const total = Number(rows[0]?.total_count ?? 0);
    return {
      items: rows
        .filter((row) => Boolean(row.id))
        .map((row) => this.projectionRegistry.project(toProjectionSource(row))),
      page: query.page,
      pageSize: query.pageSize,
      total,
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
        deviceType: summary.extensionType === 'AGENT'
          ? 'AGENT'
          : summary.category === 'CLOUD' ? 'CLOUD' : row.device_family ?? 'NETWORK_APPLIANCE',
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

/**
 * 列表读模型只投影当前页需要的标量字段。
 * 历史快照、完整注册 payload 和全量 liveness JSON 留给详情查询，避免记录数增长时首屏成本线性放大。
 */
function buildDeviceListSql(query: ManagedDeviceListQuery, parameters: unknown[]): string {
  const filterConditions: string[] = [];
  if (query.filter.category) filterConditions.push(`category = $${parameters.push(query.filter.category)}`);
  if (query.filter.productFamily) filterConditions.push(`product_family = $${parameters.push(query.filter.productFamily)}`);
  if (query.filter.managementMethod) filterConditions.push(`management_method = $${parameters.push(query.filter.managementMethod)}`);
  if (query.filter.health) filterConditions.push(`health = $${parameters.push(query.filter.health)}`);
  if (query.authorizedHostIds) filterConditions.push(`id = any($${parameters.push(query.authorizedHostIds)}::text[])`);

  const sortExpressions: Record<string, string> = {
    displayName: 'lower(display_name)',
    category: 'lower(category)',
    productFamily: 'lower(product_family)',
    managementMethod: 'lower(management_method)',
    health: 'lower(health)',
    softwareVersion: 'lower(software_version)',
    controlVersion: 'lower(control_version)',
    lastContactAt: 'lower(last_contact_at)',
    applicationAssetCount: 'application_asset_count',
  };
  const sortExpression = sortExpressions[query.sort?.field ?? 'displayName'] ?? 'display_name';
  const sortDirection = query.sort?.direction === 'desc' ? 'desc' : 'asc';
  const limitPlaceholder = parameters.push(query.pageSize);
  const offsetPlaceholder = parameters.push(Math.max(0, (query.page - 1) * query.pageSize));
  const whereClause = filterConditions.length ? `where ${filterConditions.join(' and ')}` : '';
  const agentOfflineTimeout = Number.parseInt(process.env.AGENT_OFFLINE_TIMEOUT_SECONDS ?? '180', 10) || 180;
  const deviceStaleTimeout = Number.parseInt(process.env.DEVICE_HEALTH_STALE_SECONDS ?? '300', 10) || 300;

  return `
    with tenant_hosts as (
      select host.id, host.tenant_id, host.display_name, host.hostname, host.primary_ip,
             host.os_type, host.os_name, host.os_version, host.arch, host.management_mode,
             host.status, host.last_discovered_at, host.updated_at, host.agent_id
        from pg_hosts host
       where host.tenant_id = $1 and host.deleted_at is null
    ), agent_facts as (
      select document.document_id as agent_id,
             document.payload->>'status' as agent_status,
             document.payload->>'role' as agent_role,
             document.payload->'descriptor'->>'osType' as agent_os_type,
             document.payload->'descriptor'->>'version' as agent_version,
             coalesce(document.payload->'descriptor'->>'arch', host.arch) as agent_arch,
             document.payload->'descriptor'->>'osVersion' as agent_os_version,
             document.payload->'descriptor'->>'linuxDistribution' as agent_linux_distribution,
             document.payload->'descriptor'->'capabilities' as agent_capabilities,
             document.payload->'gateway'->>'lastHeartbeatAt' as agent_gateway_last_contact
        from pg_documents document
        join tenant_hosts host on host.agent_id = document.document_id
       where document.namespace = 'agents:registrations'
         and document.payload->>'tenantId' = $1
    ), current_snapshot_facts as (
      select current_snapshot.agent_id,
             (select coalesce(
                       capability->'value'->>'ProductName',
                       capability->'value'->>'productName',
                       capability->'value'->>'Caption',
                       capability->'value'->>'caption'
                     )
                from jsonb_array_elements(document.payload->'capabilities') capability
               where capability->>'capabilityKey' in ('windows.os.detail', 'windows.os.inspect')
               limit 1) as capability_product_name,
             (select coalesce(capability->'value'->>'DisplayVersion', capability->'value'->>'displayVersion')
                from jsonb_array_elements(document.payload->'capabilities') capability
               where capability->>'capabilityKey' in ('windows.os.detail', 'windows.os.inspect')
               limit 1) as capability_display_version,
             (select coalesce(
                       capability->'value'->>'BuildRevision',
                       capability->'value'->>'buildRevision',
                       capability->'value'->>'CurrentBuild',
                       capability->'value'->>'currentBuild',
                       capability->'value'->>'BuildNumber',
                       capability->'value'->>'buildNumber'
                     )
                from jsonb_array_elements(document.payload->'capabilities') capability
               where capability->>'capabilityKey' in ('windows.os.detail', 'windows.os.inspect')
               limit 1) as capability_build,
             (select coalesce(
                       capability->'value'->>'osVersion',
                       capability->'value'->>'Version',
                       capability->'value'->>'version'
                     )
                from jsonb_array_elements(document.payload->'capabilities') capability
               where capability->>'capabilityKey' in ('windows.os.detail', 'windows.os.inspect')
               limit 1) as capability_version
        from pg_agent_capability_snapshot_current current_snapshot
        join pg_documents document
          on document.namespace = 'agents:snapshots'
         and document.document_id = current_snapshot.latest_snapshot_id
        join tenant_hosts host on host.agent_id = current_snapshot.agent_id
       where current_snapshot.tenant_id = $1
    ), fallback_snapshot_facts as (
      select distinct on (document.payload->>'agentId')
             document.payload->>'agentId' as agent_id,
             (select coalesce(
                       capability->'value'->>'ProductName',
                       capability->'value'->>'productName',
                       capability->'value'->>'Caption',
                       capability->'value'->>'caption'
                     )
                from jsonb_array_elements(document.payload->'capabilities') capability
               where capability->>'capabilityKey' in ('windows.os.detail', 'windows.os.inspect')
               limit 1) as capability_product_name,
             (select coalesce(capability->'value'->>'DisplayVersion', capability->'value'->>'displayVersion')
                from jsonb_array_elements(document.payload->'capabilities') capability
               where capability->>'capabilityKey' in ('windows.os.detail', 'windows.os.inspect')
               limit 1) as capability_display_version,
             (select coalesce(
                       capability->'value'->>'BuildRevision',
                       capability->'value'->>'buildRevision',
                       capability->'value'->>'CurrentBuild',
                       capability->'value'->>'currentBuild',
                       capability->'value'->>'BuildNumber',
                       capability->'value'->>'buildNumber'
                     )
                from jsonb_array_elements(document.payload->'capabilities') capability
               where capability->>'capabilityKey' in ('windows.os.detail', 'windows.os.inspect')
               limit 1) as capability_build,
             (select coalesce(
                       capability->'value'->>'osVersion',
                       capability->'value'->>'Version',
                       capability->'value'->>'version'
                     )
                from jsonb_array_elements(document.payload->'capabilities') capability
               where capability->>'capabilityKey' in ('windows.os.detail', 'windows.os.inspect')
               limit 1) as capability_version
        from pg_documents document
        join tenant_hosts host on host.agent_id = document.payload->>'agentId'
       where document.namespace = 'agents:snapshots'
         and document.payload->>'tenantId' = $1
         and not exists (
           select 1 from pg_agent_capability_snapshot_current current_snapshot
            where current_snapshot.tenant_id = $1
              and current_snapshot.agent_id = document.payload->>'agentId'
         )
       order by document.payload->>'agentId', document.payload->>'reportedAt' desc
    ), snapshot_facts as (
      select * from current_snapshot_facts
      union all
      select * from fallback_snapshot_facts
    ), active_releases as (
      select distinct on (document.document_id)
             document.document_id as release_id,
             document.payload->>'version' as release_version,
             document.payload->>'platform' as release_platform,
             document.payload->>'arch' as release_arch,
             document.payload->>'productLine' as release_product_line,
             document.payload->>'createdAt' as release_created_at
        from pg_documents document
       where document.namespace in ('agents:versions', 'agents:releases')
         and document.payload->>'tenantId' = $1
         and document.payload->>'status' = 'active'
       order by document.document_id,
                case when document.namespace = 'agents:versions' then 1 else 0 end desc
    ), agent_latest_releases as (
      select distinct on (agent.agent_id)
             agent.agent_id,
             agent.agent_version,
             release.release_version as target_version
        from agent_facts agent
        join active_releases release on (
          (upper(coalesce(agent.agent_os_type, '')) = 'WINDOWS'
            and (release.release_product_line = 'windows-go-full'
              or (release.release_product_line is null and upper(release.release_platform) = 'WINDOWS')))
          or (upper(coalesce(agent.agent_os_type, '')) = 'LINUX'
            and (release.release_product_line = 'linux-go-full'
              or (release.release_product_line is null and upper(release.release_platform) = 'LINUX')))
        )
        and (
          release.release_arch is null
          or (
            case lower(trim(release.release_arch))
              when 'x86_64' then 'amd64'
              when 'x64' then 'amd64'
              when 'aarch64' then 'arm64'
              else lower(trim(release.release_arch))
            end
            = case lower(trim(agent.agent_arch))
              when 'x86_64' then 'amd64'
              when 'x64' then 'amd64'
              when 'aarch64' then 'arm64'
              else lower(trim(agent.agent_arch))
            end
          )
        )
       where lower(coalesce(agent.agent_role, '')) <> 'gateway'
       order by agent.agent_id,
                string_to_array(trim(both '.' from regexp_replace(coalesce(release.release_version, '0'), '[^0-9.]', '', 'g')), '.')::int[] desc,
                release.release_created_at desc nulls last,
                release.release_id desc
    ), agent_upgrade_releases as (
      select agent_id, target_version
        from agent_latest_releases
       where target_version is not null
         and target_version <> agent_version
    ), application_counts as (
      select host_id, count(distinct asset_id)::int as asset_count
        from (
          select service_asset.host_id, service_asset.id as asset_id
            from pg_service_assets service_asset
           where service_asset.tenant_id = $1
             and service_asset.deleted_at is null
             and coalesce(service_asset.asset_kind, 'APPLICATION') <> 'DEVICE'
          union
          select site.device_id as host_id, site.id as asset_id
            from pg_site_assets site
            join pg_framework_instances framework
              on framework.id = site.framework_instance_id
             and framework.tenant_id = site.tenant_id
           where site.tenant_id = $1
             and site.status = 'ACTIVE'
             and site.deleted_at is null
             and framework.deleted_at is null
        ) related_assets
       where host_id is not null
       group by host_id
    ), base as (
      select host.id,
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
             agent.agent_status,
             agent.agent_role,
             agent.agent_os_type,
             agent.agent_version,
             agent.agent_arch,
             agent.agent_os_version,
             agent.agent_linux_distribution,
             agent.agent_gateway_last_contact,
             coalesce(heartbeat.received_at, agent.agent_gateway_last_contact) as agent_last_heartbeat_at,
             snapshot.capability_product_name,
             snapshot.capability_display_version,
             snapshot.capability_build,
             snapshot.capability_version,
             liveness.id as liveness_signal_id,
             liveness.tenant_id as liveness_signal_tenant_id,
             liveness.resource_type as liveness_signal_resource_type,
             liveness.resource_id as liveness_signal_resource_id,
             liveness.signal_type as liveness_signal_type,
             liveness.required as liveness_signal_required,
             liveness.status as liveness_signal_status,
             liveness.consecutive_failures as liveness_signal_consecutive_failures,
             liveness.last_observed_at as liveness_signal_last_observed_at,
             liveness.last_success_at as liveness_signal_last_success_at,
             liveness.last_failure_at as liveness_signal_last_failure_at,
             liveness.endpoint_host as liveness_signal_endpoint_host,
             liveness.endpoint_port as liveness_signal_endpoint_port,
             liveness.source as liveness_signal_source,
             liveness.reason_code as liveness_signal_reason_code,
             liveness.reason_detail as liveness_signal_reason_detail,
             liveness.observation_id as liveness_signal_observation_id,
             liveness.created_at as liveness_signal_created_at,
             liveness.updated_at as liveness_signal_updated_at,
             device.service_asset_id,
             device.device_family,
             device.management_port,
             device.auth_mode,
             device.tls_verify,
             device.product_name,
             device.product_family as device_product_family,
             device.software_version as device_software_version,
             device.software_build as device_software_build,
             device.support_tier,
             device.metadata as device_metadata,
             (select coalesce(array_agg(capability.key order by capability.key), '{}'::text[])
                from jsonb_each_text(coalesce(device.capability_profile, '{}'::jsonb)) capability
               where capability.value = 'true') as device_capabilities,
             device.plugin_version_id,
             coalesce(current_plugin_version.plugin_version, plugin_version.plugin_version) as device_control_version,
             device.plugin_binding_id,
             device.last_discovered_at as device_last_discovered_at,
             device.last_error_code,
             service.address as device_address,
             coalesce(counts.asset_count, 0)::int as application_asset_count,
             upgrade.target_version,
             (upgrade.target_version is not null) as upgrade_available
        from tenant_hosts host
        left join agent_facts agent on agent.agent_id = host.agent_id
        left join snapshot_facts snapshot on snapshot.agent_id = host.agent_id
        left join lateral (
          select document.payload->>'receivedAt' as received_at
            from pg_documents document
           where document.namespace = 'agents:heartbeats'
             and document.payload->>'tenantId' = $1
             and document.payload->>'agentId' = host.agent_id
           order by document.payload->>'receivedAt' desc
           limit 1
        ) heartbeat on true
        left join lateral (
          select signal.*
            from pg_device_liveness_signals signal
           where signal.tenant_id = $1
             and signal.resource_type = case when host.agent_id is not null then 'AGENT' else 'DEVICE' end
             and signal.resource_id = coalesce(host.agent_id, host.id)
             and signal.signal_type = case when host.agent_id is not null then 'HEARTBEAT' else 'MANAGEMENT_TCP' end
             and (host.agent_id is not null or not exists (
               select 1
                 from pg_device_assets target_device
                where target_device.tenant_id = host.tenant_id
                  and target_device.host_id = host.id
                  and (upper(coalesce(target_device.metadata->>'deviceCategory', '')) = 'CLOUD'
                    or upper(coalesce(target_device.metadata->>'livenessMode', '')) = 'DISCOVERY'
                    or lower(coalesce(target_device.device_family, '')) like 'cloud.%')
             ))
           order by signal.last_observed_at desc nulls last, signal.updated_at desc, signal.id desc
           limit 1
        ) liveness on true
        left join pg_device_assets device
          on device.tenant_id = host.tenant_id and device.host_id = host.id
        left join unified_plugin_versions plugin_version on plugin_version.id = device.plugin_version_id
        left join lateral (
          select candidate.plugin_version
            from unified_plugin_versions candidate
           where candidate.plugin_id = plugin_version.plugin_id
             and candidate.status = 'ENABLED'
             and (candidate.source = 'BUILTIN' or candidate.tenant_id = device.tenant_id)
           order by (candidate.source = 'BUILTIN') desc,
                    string_to_array(
                      trim(both '.' from regexp_replace(candidate.plugin_version, '[^0-9.]', '', 'g')),
                      '.'
                    )::int[] desc,
                    candidate.updated_at desc,
                    candidate.id desc
           limit 1
        ) current_plugin_version on true
        left join pg_service_assets service
          on service.tenant_id = device.tenant_id
         and service.id = device.service_asset_id
         and service.deleted_at is null
        left join application_counts counts on counts.host_id = host.id
        left join agent_upgrade_releases upgrade on upgrade.agent_id = host.agent_id
       where host.agent_id is not null or service.id is not null
    ), projected as (
      select base.*,
             case when agent_id is not null then 'SERVER'
                  when upper(coalesce(device_metadata->>'deviceCategory', '')) = 'CLOUD'
                    or upper(coalesce(device_metadata->>'livenessMode', '')) = 'DISCOVERY'
                    or lower(coalesce(device_family, '')) like 'cloud.%' then 'CLOUD'
                  else 'NETWORK_APPLIANCE' end as category,
             case when agent_id is not null then
               case upper(coalesce(agent_os_type, os_type))
                 when 'WINDOWS' then 'Windows Server'
                 when 'LINUX' then 'Linux Server'
                 else coalesce(os_name, upper(coalesce(agent_os_type, os_type)))
               end
               else coalesce(device_product_family, product_name, device_family) end as product_family,
             case when agent_id is not null then management_mode else 'PLUGIN' end as management_method,
             case when agent_id is not null then coalesce(primary_ip, hostname) else coalesce(device_address, primary_ip, hostname) end as management_address,
             case when agent_id is not null then coalesce(agent_status, host_status)
               when last_error_code is not null then 'ERROR'
               when device_last_discovered_at is not null then 'DISCOVERED'
               else host_status end as source_status,
             case when agent_id is not null then coalesce(agent_last_heartbeat_at, agent_gateway_last_contact)::text else coalesce(device_last_discovered_at, last_discovered_at)::text end as last_contact_at,
             case when upper(coalesce(device_metadata->>'deviceCategory', '')) = 'CLOUD'
                    or upper(coalesce(device_metadata->>'livenessMode', '')) = 'DISCOVERY'
                    or lower(coalesce(device_family, '')) like 'cloud.%' then null
                  else case
               when liveness_signal_status = 'FAILED' then 'OFFLINE'
               when liveness_signal_status is null or liveness_signal_status = 'UNKNOWN' then 'UNKNOWN'
               else 'ONLINE'
             end end as liveness_status,
             case when agent_id is not null then
               case
                 when liveness_signal_status = 'FAILED' then 'UNREACHABLE'
                 when upper(coalesce(agent_status, host_status)) in ('DISABLED', 'REVOKED', 'DELETED') then 'DISABLED'
                 when upper(coalesce(agent_status, host_status)) in ('OFFLINE', 'UNREACHABLE', 'ERROR') then 'UNREACHABLE'
                 when coalesce(agent_last_heartbeat_at, agent_gateway_last_contact)::timestamptz < now() - interval '${agentOfflineTimeout} seconds' then 'UNREACHABLE'
                 when upper(coalesce(agent_status, host_status)) in ('UPGRADING', 'DEGRADED', 'STALE') then 'DEGRADED'
                 when coalesce(agent_last_heartbeat_at, agent_gateway_last_contact) is not null
                  and upper(coalesce(agent_status, host_status)) in ('ONLINE', 'ACTIVE', 'HEALTHY', 'DISCOVERED') then 'HEALTHY'
                 else 'UNKNOWN'
               end
             else
               case
                 when liveness_signal_status = 'FAILED' then 'UNREACHABLE'
                 when last_error_code is not null or upper(host_status) in ('OFFLINE', 'UNREACHABLE', 'ERROR') then 'UNREACHABLE'
                 when coalesce(device_last_discovered_at, last_discovered_at)::timestamptz < now() - interval '${deviceStaleTimeout} seconds' then 'UNKNOWN'
                 when upper(host_status) in ('UPGRADING', 'DEGRADED', 'STALE') or upper(coalesce(support_tier, '')) = 'UNSUPPORTED' then 'DEGRADED'
                 when coalesce(device_last_discovered_at, last_discovered_at) is not null
                  and upper(host_status) in ('ONLINE', 'ACTIVE', 'HEALTHY', 'DISCOVERED') then 'HEALTHY'
                 when liveness_signal_status = 'HEALTHY' and upper(host_status) = 'UNKNOWN' then 'HEALTHY'
                 else 'UNKNOWN'
               end
             end as health,
             case when agent_id is not null then
               case upper(coalesce(agent_os_type, os_type))
                 when 'WINDOWS' then
                   coalesce(
                     nullif(agent_os_version, 'WINDOWS_NT'),
                     capability_product_name || case when capability_display_version is not null then ' ' || capability_display_version else '' end,
                     capability_product_name || case when capability_build is not null then ' (Build ' || capability_build || ')' else '' end,
                     capability_product_name,
                     capability_version,
                     os_name
                   )
                 when 'LINUX' then
                   case
                     when agent_linux_distribution is null then coalesce(nullif(agent_os_version, 'WINDOWS_NT'), os_name)
                     when agent_linux_distribution ~ '[0-9]'
                       or agent_os_version is null
                       or agent_linux_distribution like '%' || agent_os_version || '%' then agent_linux_distribution
                     else agent_linux_distribution || ' ' || agent_os_version
                   end
                 else coalesce(nullif(agent_os_version, 'WINDOWS_NT'), os_name)
               end
               else concat_ws(' ', device_software_version, device_software_build) end as software_version,
             case when agent_id is not null then agent_version else device_control_version end as control_version
        from base
    ), filtered as (
      select * from projected
      ${whereClause}
    ), page_rows as (
      select filtered.*
        from filtered
       order by ${sortExpression} ${sortDirection}, id asc
       limit $${limitPlaceholder} offset $${offsetPlaceholder}
    ), totals as (
      select count(*)::int as total_count from filtered
    )
    select page_rows.*, totals.total_count
      from totals
      left join page_rows on true
  `;
}

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
  total_count?: number;
  agent_status?: string | null;
  agent_role?: string | null;
  agent_os_type?: string | null;
  agent_version?: string | null;
  agent_arch?: string | null;
  agent_os_version?: string | null;
  agent_linux_distribution?: string | null;
  agent_capabilities?: string[] | null;
  agent_gateway_last_contact?: string | null;
  device_product_family?: string | null;
  device_software_version?: string | null;
  device_software_build?: string | null;
  device_control_version?: string | null;
  device_capabilities?: string[] | null;
  capability_product_name?: string | null;
  capability_display_version?: string | null;
  capability_build?: string | null;
  capability_version?: string | null;
  target_version?: string | null;
  upgrade_available?: boolean | null;
  liveness_signal_id?: string | null;
  liveness_signal_tenant_id?: string | null;
  liveness_signal_resource_type?: string | null;
  liveness_signal_resource_id?: string | null;
  liveness_signal_type?: string | null;
  liveness_signal_required?: boolean | null;
  liveness_signal_status?: string | null;
  liveness_signal_consecutive_failures?: number | null;
  liveness_signal_last_observed_at?: string | null;
  liveness_signal_last_success_at?: string | null;
  liveness_signal_last_failure_at?: string | null;
  liveness_signal_endpoint_host?: string | null;
  liveness_signal_endpoint_port?: number | null;
  liveness_signal_source?: string | null;
  liveness_signal_reason_code?: string | null;
  liveness_signal_reason_detail?: string | null;
  liveness_signal_observation_id?: string | null;
  liveness_signal_created_at?: string | null;
  liveness_signal_updated_at?: string | null;
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
  const lightweightLiveness = row.liveness_signal_id
    ? [mapLivenessSignal({
      id: row.liveness_signal_id,
      tenant_id: row.liveness_signal_tenant_id,
      resource_type: row.liveness_signal_resource_type,
      resource_id: row.liveness_signal_resource_id,
      signal_type: row.liveness_signal_type,
      required: row.liveness_signal_required,
      status: row.liveness_signal_status,
      consecutive_failures: row.liveness_signal_consecutive_failures,
      last_observed_at: row.liveness_signal_last_observed_at,
      last_success_at: row.liveness_signal_last_success_at,
      last_failure_at: row.liveness_signal_last_failure_at,
      endpoint_host: row.liveness_signal_endpoint_host,
      endpoint_port: row.liveness_signal_endpoint_port,
      source: row.liveness_signal_source,
      reason_code: row.liveness_signal_reason_code,
      reason_detail: row.liveness_signal_reason_detail,
      observation_id: row.liveness_signal_observation_id,
      created_at: row.liveness_signal_created_at,
      updated_at: row.liveness_signal_updated_at,
    })]
    : (row.liveness_signals ?? []).map(mapLivenessSignal);
  const agentPayload = row.agent_payload ?? {
    status: row.agent_status ?? row.host_status,
    descriptor: {
      osType: row.agent_os_type ?? row.os_type,
      version: row.agent_version,
      arch: row.agent_arch,
      osVersion: row.agent_os_version ?? row.os_version,
      linuxDistribution: row.agent_linux_distribution,
      capabilities: row.agent_capabilities ?? [],
    },
  };
  const hasWindowsCapability = Boolean(
    row.capability_product_name
      || row.capability_display_version
      || row.capability_build
      || row.capability_version,
  );
  const capabilitySnapshot = row.agent_capability_payload ?? {
    capabilities: hasWindowsCapability ? [{
      capabilityKey: 'windows.os.detail',
      value: {
        ProductName: row.capability_product_name,
        DisplayVersion: row.capability_display_version,
        BuildRevision: row.capability_build,
        Version: row.capability_version,
      },
    }] : [],
  };
  const capabilityProfile = row.device_capabilities
    ? Object.fromEntries(row.device_capabilities.map((key) => [key, true]))
    : asRecord(row.capability_profile);
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
    livenessSignals: lightweightLiveness,
  };
  if (row.device_family) {
    source.networkAppliance = {
      deviceFamily: row.device_family,
      productName: row.product_family ?? row.product_name ?? undefined,
      softwareVersion: row.software_version ?? undefined,
      softwareBuild: row.software_build ?? undefined,
      pluginVersion: row.control_version ?? undefined,
      supportTier: row.support_tier ?? undefined,
      capabilityProfile,
      lastDiscoveredAt: row.device_last_discovered_at ?? undefined,
      lastErrorCode: row.last_error_code ?? undefined,
      managementAddress: row.device_address ?? undefined,
      metadata: asRecord(row.device_metadata),
    };
  } else {
    source.agent = {
      payload: asRecord(agentPayload),
      capabilitySnapshot: asRecord(capabilitySnapshot),
      lastHeartbeatAt: row.agent_last_heartbeat_at ?? undefined,
      agentId: row.agent_id ?? undefined,
      role: row.agent_role ?? undefined,
      upgradeAvailable: row.upgrade_available ?? undefined,
      targetVersion: row.target_version ?? undefined,
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
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

function optionalString(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' && value ? value : undefined;
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
  const certificates: Array<NonNullable<ManagedDeviceSiteDto['bindings'][number]['certificate']> & { id: string }> = [];
  for (const site of sites) {
    for (const binding of site.bindings) {
      const certificate = binding.certificate;
      if (!certificate) continue;
      // 没有版本 ID 或指纹时，绑定 ID 只作为临时资源 ID；真正的身份由 mergeCertificates 决定。
      const id = certificate.certificateVersionId ?? normalizeCertificateFingerprint(certificate.fingerprintSha256) ?? binding.id;
      certificates.push({ id, ...certificate });
    }
  }
  return certificates;
}

function mergeCertificates(
  primary: ManagedDeviceCertificateDto[],
  secondary: ManagedDeviceCertificateDto[],
): ManagedDeviceCertificateDto[] {
  const certificates: ManagedDeviceCertificateDto[] = [];
  for (const certificate of [...primary, ...secondary]) {
    const index = certificates.findIndex((existing) => certificatesMatch(existing, certificate));
    if (index < 0) {
      certificates.push(certificate);
      continue;
    }
    // 发现资源是主记录，站点绑定只负责补齐主记录没有的属性。
    certificates[index] = mergeCertificateFields(certificates[index], certificate);
  }
  return certificates;
}

function certificatesMatch(left: ManagedDeviceCertificateDto, right: ManagedDeviceCertificateDto): boolean {
  const leftFingerprint = normalizeCertificateFingerprint(left.fingerprintSha256);
  const rightFingerprint = normalizeCertificateFingerprint(right.fingerprintSha256);
  if (leftFingerprint && rightFingerprint) return leftFingerprint === rightFingerprint;

  // 只有双方都没有可比较指纹时，先尝试稳定的版本 ID；不同版本仍继续走属性回退。
  if (!leftFingerprint && !rightFingerprint && left.certificateVersionId && right.certificateVersionId
    && left.certificateVersionId === right.certificateVersionId) {
    return true;
  }

  return certificateAttributesMatch(left, right);
}

function certificateAttributesMatch(left: ManagedDeviceCertificateDto, right: ManagedDeviceCertificateDto): boolean {
  const attributes = (['subject', 'issuer', 'notBefore', 'notAfter'] as const)
    .map((key) => [normalizeCertificateAttribute(left[key], key), normalizeCertificateAttribute(right[key], key)] as const);
  const leftOnly = attributes.some(([leftValue, rightValue]) => leftValue !== undefined && rightValue === undefined);
  const rightOnly = attributes.some(([leftValue, rightValue]) => leftValue === undefined && rightValue !== undefined);
  if (leftOnly || rightOnly) return false;
  const comparable = attributes.filter(([leftValue, rightValue]) => leftValue !== undefined && rightValue !== undefined);

  // 至少需要两个共同属性，避免仅凭一个通用名称把不同证书合并；NPM 的 subject + notAfter 可走此回退。
  return comparable.length >= 2 && comparable.every(([leftValue, rightValue]) => leftValue === rightValue);
}

function normalizeCertificateAttribute(value: string | undefined, key: 'subject' | 'issuer' | 'notBefore' | 'notAfter'): string | undefined {
  if (!value?.trim()) return undefined;
  const trimmed = value.trim();
  if (key === 'notBefore' || key === 'notAfter') {
    const timestamp = Date.parse(trimmed);
    if (!Number.isNaN(timestamp)) return new Date(timestamp).toISOString();
  }
  return trimmed.replace(/\s+/g, ' ').toLowerCase();
}

function normalizeCertificateFingerprint(value: string | undefined): string | undefined {
  const normalized = value?.replace(/[^a-f0-9]/giu, '').toUpperCase();
  return normalized || undefined;
}

function mergeCertificateFields(
  primary: ManagedDeviceCertificateDto,
  secondary: ManagedDeviceCertificateDto,
): ManagedDeviceCertificateDto {
  return {
    ...primary,
    certificateAssetId: primary.certificateAssetId ?? secondary.certificateAssetId,
    certificateVersionId: primary.certificateVersionId ?? secondary.certificateVersionId,
    name: primary.name ?? secondary.name,
    subject: primary.subject ?? secondary.subject,
    issuer: primary.issuer ?? secondary.issuer,
    notBefore: primary.notBefore ?? secondary.notBefore,
    notAfter: primary.notAfter ?? secondary.notAfter,
    fingerprintSha256: primary.fingerprintSha256 ?? secondary.fingerprintSha256,
    status: primary.status ?? secondary.status,
  };
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
