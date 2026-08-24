import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import type {
  ManagedDeviceDetailDto,
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
  get(tenantId: string, deviceId: string): Promise<ManagedDeviceDetailDto | undefined>;
}

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

  async get(tenantId: string, deviceId: string): Promise<ManagedDeviceDetailDto | undefined> {
    const row = (await this.db.query<ManagedDeviceRow>(`${DEVICE_LIST_SQL} and (host.id = $2 or host.agent_id = $2)`, [tenantId, deviceId])).rows[0];
    if (!row) return undefined;
    const summary = this.projectionRegistry.project(toProjectionSource(row));
    const [managedSites, resources] = await Promise.all([
      this.getManagedSites(tenantId, row.id),
      row.device_asset_id ? this.getNetworkDeviceResources(tenantId, row.device_asset_id) : Promise.resolve(undefined),
    ]);
    const sites = resources ? mergeNetworkSites(managedSites, resources.sites) : managedSites;
    const certificates = resources?.certificates ?? collectSiteCertificates(sites);
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
      frameworks: resources?.frameworks ?? [],
      sites,
      certificates,
      logs: resources?.logs ?? [],
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
            virtualServers: resources?.virtualServers ?? [],
            certificateResources: resources?.certificateResources ?? [],
            certificateBindings: resources?.certificateBindings ?? [],
            deviceLogs: resources?.deviceLogs ?? [],
          },
    };
  }

  private async getNetworkDeviceResources(tenantId: string, deviceAssetId: string) {
    const [virtualServers, certificateResources, certificateBindings, deviceLogs, frameworks, discoveredCertificates] = await Promise.all([
      this.db.query<DeviceVirtualServerRow>(
        `select id, virtual_server_type, virtual_server_name, address, port, protocol, runtime_state, sni_names
         from pg_device_virtual_servers
         where tenant_id=$1 and device_asset_id=$2 and deleted_at is null and status<>'DELETED'
         order by virtual_server_type, virtual_server_name`,
        [tenantId, deviceAssetId],
      ),
      this.db.query<DeviceCertificateResourceRow>(
        `select resource.id, resource.certkey_name, resource.subject, resource.issuer,
                resource.not_before, resource.not_after, resource.remote_status, resource.fingerprint_sha256,
                version.id as certificate_version_id, version.certificate_asset_id
         from pg_device_certificate_resources resource
         left join pg_certificate_versions version
           on version.fingerprint_sha256=resource.fingerprint_sha256
         where resource.tenant_id=$1 and resource.device_asset_id=$2 and resource.deleted_at is null
         order by resource.certkey_name`,
        [tenantId, deviceAssetId],
      ),
      this.db.query<DeviceCertificateBindingRow>(
         `select binding.id, virtual_server.virtual_server_type, virtual_server.virtual_server_name,
                 certificate.certkey_name, certificate.subject, certificate.issuer,
                 certificate.not_before, certificate.not_after, certificate.remote_status,
                 certificate.fingerprint_sha256, version.id as certificate_version_id,
                 version.certificate_asset_id, binding.sni_certificate
          from pg_device_certificate_bindings binding
          join pg_device_virtual_servers virtual_server on virtual_server.id=binding.virtual_server_id
          join pg_device_certificate_resources certificate on certificate.id=binding.certificate_resource_id
          left join pg_certificate_versions version
            on version.fingerprint_sha256=certificate.fingerprint_sha256
         where binding.tenant_id=$1 and binding.device_asset_id=$2 and binding.deleted_at is null
         order by virtual_server.virtual_server_name, certificate.certkey_name`,
        [tenantId, deviceAssetId],
      ),
      this.db.query<DeviceLogRow>(
        `select document_id, payload
         from pg_documents
         where namespace='security.audit_logs'
           and payload->>'resourceType'='device_asset'
           and payload->>'resourceId'=$1
         order by payload->>'createdAt' desc, updated_at desc
         limit 100`,
        [deviceAssetId],
      ),
      this.db.query<DiscoverySnapshotRow>(
        `select payload
         from plugin_discovery_snapshots
         where tenant_id=$1 and device_asset_id=$2 and status='SUCCEEDED'
         order by created_at desc
         limit 1`,
        [tenantId, deviceAssetId],
      ),
      this.db.query<DiscoveredCertificateRow>(
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
      ),
    ]);
    const standardCertificates = discoveredCertificates.rows.map((item) => ({
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
    }));
    return {
      frameworks: Array.isArray(frameworks.rows[0]?.payload.frameworks)
        ? frameworks.rows[0]!.payload.frameworks as Array<Record<string, unknown>>
        : [],
      virtualServers: virtualServers.rows.map((item) => ({
        id: item.id,
        type: item.virtual_server_type,
        name: item.virtual_server_name,
        address: item.address,
        port: item.port,
        protocol: item.protocol,
        runtimeState: item.runtime_state,
        sniNames: item.sni_names,
      })),
      certificateResources: certificateResources.rows.map((item) => ({
        id: item.id,
        certkeyName: item.certkey_name,
        subject: item.subject,
        issuer: item.issuer,
        notBefore: optionalTimestamp(item.not_before),
        notAfter: optionalTimestamp(item.not_after),
        remoteStatus: item.remote_status,
      })),
      certificateBindings: certificateBindings.rows.map((item) => ({
        id: item.id,
        virtualServerType: item.virtual_server_type,
        virtualServerName: item.virtual_server_name,
        certkeyName: item.certkey_name,
        certificateSubject: item.subject,
        certificateIssuer: item.issuer,
        certificateNotBefore: optionalTimestamp(item.not_before),
        certificateNotAfter: optionalTimestamp(item.not_after),
        certificateStatus: item.remote_status,
        sniCertificate: item.sni_certificate,
      })),
      deviceLogs: deviceLogs.rows.map((item) => ({
        id: item.document_id,
        eventType: item.payload.eventType,
        action: item.payload.action,
        result: item.payload.result,
        riskLevel: item.payload.riskLevel,
        actorId: item.payload.actorId,
        requestId: item.payload.requestId,
        detail: item.payload.detail,
        createdAt: item.payload.createdAt,
      })),
      certificates: standardCertificates.length > 0 ? standardCertificates : certificateResources.rows.map((item) => ({
        id: item.id,
        certificateAssetId: item.certificate_asset_id ?? undefined,
        certificateVersionId: item.certificate_version_id ?? undefined,
        name: item.certkey_name,
        subject: item.subject ?? undefined,
        issuer: item.issuer ?? undefined,
        notBefore: optionalTimestamp(item.not_before),
        notAfter: optionalTimestamp(item.not_after),
        fingerprintSha256: item.fingerprint_sha256 ?? undefined,
        status: item.remote_status ?? undefined,
      })),
      sites: virtualServers.rows
        .filter((item) => item.virtual_server_type === 'LB' || item.virtual_server_type === 'VPN')
        .map((item) => ({
          id: item.id,
          siteAssetId: item.id,
          kind: item.virtual_server_type as 'LB' | 'VPN',
          name: item.virtual_server_name,
          status: item.runtime_state ?? undefined,
          endpoint: {
            address: item.address ?? undefined,
            hostName: Array.isArray(item.sni_names) ? String(item.sni_names[0] ?? '') || undefined : undefined,
            port: item.port ?? undefined,
            protocol: item.protocol ?? undefined,
          },
          bindings: certificateBindings.rows
            .filter((binding) => binding.virtual_server_type === item.virtual_server_type && binding.virtual_server_name === item.virtual_server_name)
            .map((binding) => ({
              id: binding.id,
              bindingKey: `${binding.virtual_server_type}:${binding.virtual_server_name}:${binding.certkey_name}`,
              bindingType: binding.sni_certificate ? 'SNI' : 'DEFAULT',
              status: binding.remote_status ?? 'ACTIVE',
              certificate: {
                certificateAssetId: binding.certificate_asset_id ?? undefined,
                certificateVersionId: binding.certificate_version_id ?? undefined,
                name: binding.certkey_name,
                subject: binding.subject ?? undefined,
                issuer: binding.issuer ?? undefined,
                notBefore: optionalTimestamp(binding.not_before),
                notAfter: optionalTimestamp(binding.not_after),
                fingerprintSha256: binding.fingerprint_sha256 ?? undefined,
                status: binding.remote_status ?? undefined,
              },
              replacement: { allowed: false, reasonCode: 'MANAGED_TARGET_UNAVAILABLE' },
            })),
          metadata: { virtualServerType: item.virtual_server_type, sniNames: item.sni_names },
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

  private async getManagedSites(tenantId: string, deviceId: string): Promise<ManagedDeviceSiteDto[]> {
    const rows = (await this.db.query<ManagedSiteRow>(
      `select site.id, site.discovery_provider_key as provider_type, site.site_name, site.binding_information, site.host_header,
              site.listen_ip, site.port, site.protocol, site.config_path, site.runtime_status, site.status, site.metadata,
              target.id as managed_target_id, target.binding_key as target_binding_key, target.status as target_status,
              binding.id as binding_id, binding.binding_key, binding.binding_type, binding.domain_name,
              binding.status as binding_status, binding.certificate_version_id,
               version.common_name, version.subject as certificate_subject, version.issuer as certificate_issuer,
               version.not_before, version.not_after, version.fingerprint_sha256, version.status as certificate_status,
               version.certificate_asset_id, asset.name as certificate_name
       from pg_site_assets site
       left join pg_managed_targets target
         on target.tenant_id=site.tenant_id and target.site_id=site.id and target.deleted_at is null
       left join pg_certificate_bindings binding
         on binding.tenant_id=site.tenant_id and binding.deleted_at is null
        and (binding.site_asset_id=site.id or (target.id is not null and binding.managed_target_id=target.id))
       left join pg_certificate_versions version on version.id=binding.certificate_version_id
       left join pg_certificate_assets asset on asset.id=version.certificate_asset_id
       where site.tenant_id=$1 and site.device_id=$2 and site.deleted_at is null
       order by site.site_name, binding.binding_key`,
      [tenantId, deviceId],
    )).rows;
    const sites = new Map<string, ManagedDeviceSiteDto>();
    for (const row of rows) {
      const kind = siteKind(row.provider_type, row.metadata);
      if (!kind) continue;
      const existing = sites.get(row.id) ?? {
        id: row.id,
        siteAssetId: row.id,
        managedTargetId: row.managed_target_id ?? undefined,
        kind,
        name: row.site_name,
        status: row.runtime_status ?? row.status,
        endpoint: {
          address: row.listen_ip ?? undefined,
          hostName: row.host_header ?? undefined,
          port: row.port ?? undefined,
          protocol: row.protocol ?? undefined,
        },
        configPath: row.config_path ?? undefined,
        bindings: [],
        metadata: asRecord(row.metadata),
      } satisfies ManagedDeviceSiteDto;
      if (row.binding_id && !existing.bindings.some((binding) => binding.id === row.binding_id)) {
        existing.bindings.push({
          id: row.binding_id,
          bindingKey: row.binding_key ?? row.target_binding_key ?? row.binding_id,
          bindingType: row.binding_type ?? 'UNKNOWN',
          hostName: row.domain_name ?? undefined,
          status: row.binding_status ?? 'UNKNOWN',
          certificate: row.certificate_version_id ? {
            certificateAssetId: row.certificate_asset_id ?? undefined,
            certificateVersionId: row.certificate_version_id,
            name: row.certificate_name ?? row.common_name ?? undefined,
            subject: distinguishedName(row.certificate_subject),
            issuer: distinguishedName(row.certificate_issuer),
            notBefore: optionalTimestamp(row.not_before),
            notAfter: optionalTimestamp(row.not_after),
            fingerprintSha256: row.fingerprint_sha256 ?? undefined,
            status: row.certificate_status ?? undefined,
          } : undefined,
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
  with agent_extensions as (
    select document_id as agent_id, payload
    from pg_documents
    where namespace = 'agents:registrations'
  ), agent_snapshots as (
    select distinct on (payload->>'agentId') payload->>'agentId' as agent_id, payload
    from pg_documents
    where namespace = 'agents:snapshots'
    order by payload->>'agentId', payload->>'reportedAt' desc
  ), agent_heartbeats as (
    select distinct on (payload->>'agentId') payload->>'agentId' as agent_id, payload->>'receivedAt' as received_at
    from pg_documents
    where namespace = 'agents:heartbeats'
    order by payload->>'agentId', payload->>'receivedAt' desc
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
      where site.tenant_id = $1 and site.deleted_at is null and si.deleted_at is null
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
  from pg_hosts host
  left join agent_extensions agent on agent.agent_id = host.agent_id
  left join agent_snapshots snapshot on snapshot.agent_id = host.agent_id
  left join agent_heartbeats heartbeat on heartbeat.agent_id = host.agent_id
  left join liveness_signals liveness on liveness.tenant_id=host.tenant_id
    and liveness.resource_type=case when host.agent_id is not null then 'AGENT' else 'DEVICE' end
    and liveness.resource_id=coalesce(host.agent_id, host.id)
  left join pg_device_assets device on device.tenant_id = host.tenant_id and device.host_id = host.id
  left join unified_plugin_versions plugin_version on plugin_version.tenant_id = device.tenant_id and plugin_version.id = device.plugin_version_id
  left join pg_service_assets service on service.tenant_id = device.tenant_id and service.id = device.service_asset_id and service.deleted_at is null
  left join application_counts counts on counts.host_id = host.id
  where host.tenant_id = $1
    and host.deleted_at is null
    and (host.agent_id is not null or service.id is not null)
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
}

interface DeviceVirtualServerRow extends Record<string, unknown> {
  id: string;
  virtual_server_type: string;
  virtual_server_name: string;
  address: string | null;
  port: number | null;
  protocol: string | null;
  runtime_state: string | null;
  sni_names: unknown;
}

interface DeviceCertificateResourceRow extends Record<string, unknown> {
  id: string;
  certkey_name: string;
  subject: string | null;
  issuer: string | null;
  not_before: string | null;
  not_after: string | null;
  remote_status: string | null;
  fingerprint_sha256: string | null;
  certificate_version_id: string | null;
  certificate_asset_id: string | null;
}

interface DeviceCertificateBindingRow extends Record<string, unknown> {
  id: string;
  virtual_server_type: string;
  virtual_server_name: string;
  certkey_name: string;
  subject: string | null;
  issuer: string | null;
  not_before: string | null;
  not_after: string | null;
  remote_status: string | null;
  fingerprint_sha256: string | null;
  certificate_version_id: string | null;
  certificate_asset_id: string | null;
  sni_certificate: boolean;
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

interface DiscoverySnapshotRow extends Record<string, unknown> {
  payload: Record<string, unknown>;
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
  provider_type: string;
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
  managed_target_id: string | null;
  target_binding_key: string | null;
  target_status: string | null;
  binding_id: string | null;
  binding_key: string | null;
  binding_type: string | null;
  domain_name: string | null;
  binding_status: string | null;
  certificate_version_id: string | null;
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

function siteKind(providerType: string, metadata: unknown): ManagedDeviceSiteDto['kind'] | undefined {
  const provider = providerType.toUpperCase();
  if (provider === 'IIS') return 'IIS';
  if (provider === 'NGINX') return 'NGINX';
  if (provider === 'APACHE') return 'APACHE';
  if (provider === 'TOMCAT') return 'TOMCAT';
  const virtualServerType = String(asRecord(metadata).virtualServerType ?? '').toUpperCase();
  return virtualServerType === 'LB' || virtualServerType === 'VPN' ? virtualServerType : 'CUSTOM';
}

function distinguishedName(value: unknown): string | undefined {
  if (typeof value === 'string') return value || undefined;
  const record = asRecord(value);
  const commonName = record.commonName ?? record.CN ?? record.cn;
  if (commonName) return `CN=${String(commonName)}`;
  const entries = Object.entries(record).filter(([, entry]) => entry !== undefined && entry !== null && entry !== '');
  return entries.length ? entries.map(([key, entry]) => `${key}=${String(entry)}`).join(', ') : undefined;
}

function mergeNetworkSites(managedSites: ManagedDeviceSiteDto[], discoveredSites: ManagedDeviceSiteDto[]): ManagedDeviceSiteDto[] {
  if (!managedSites.length) return discoveredSites;
  return managedSites.map((site) => {
    const virtualServerType = String(site.metadata.virtualServerType ?? site.kind).toUpperCase();
    const virtualServerName = String(site.metadata.virtualServerName ?? site.name);
    const discovered = discoveredSites.find((item) => item.kind === virtualServerType && item.name === virtualServerName);
    return discovered ? {
      ...site,
      status: discovered.status ?? site.status,
      endpoint: discovered.endpoint ?? site.endpoint,
      bindings: discovered.bindings.map((binding) => ({
        ...binding,
        replacement: site.managedTargetId
          ? { allowed: true, managedTargetId: site.managedTargetId }
          : binding.replacement,
      })),
    } : site;
  });
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

function buildInformationSections(
  row: ManagedDeviceRow,
  summary: ManagedDeviceSummaryDto,
  updatedAt: string,
  resources: Awaited<ReturnType<PgDevicesRepository['getNetworkDeviceResources']>> | undefined,
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
      { key: 'virtualServerCount', value: resources?.virtualServers.length ?? 0, valueType: 'NUMBER' as const },
      { key: 'certificateCount', value: resources?.certificateResources.length ?? 0, valueType: 'NUMBER' as const },
    ],
  }];
}
