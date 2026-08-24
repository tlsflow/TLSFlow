import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import type {
  ManagedDeviceDetailDto,
  ManagedDeviceListQuery,
  ManagedDevicePageDto,
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
    const row = (await this.db.query<ManagedDeviceRow>(`${DEVICE_LIST_SQL} and host.id = $2`, [tenantId, deviceId])).rows[0];
    if (!row) return undefined;
    const summary = this.projectionRegistry.project(toProjectionSource(row));
    const resources = row.device_asset_id ? await this.getNetworkDeviceResources(tenantId, row.device_asset_id) : undefined;
    return {
      ...summary,
      statusReason: row.last_error_code ?? undefined,
      allowedActions: summary.extensionType === 'AGENT'
        ? ['VIEW_APPLICATIONS', 'VIEW_RUNTIME', 'UPGRADE_AGENT', 'DISABLE_DEVICE']
        : ['VIEW_APPLICATIONS', 'TEST_CONNECTION', 'REFRESH_DISCOVERY', 'EDIT_CONNECTION', 'DISABLE_DEVICE'],
      publicSummary: {
        hostname: row.hostname ?? undefined,
        osType: row.os_type,
        managementMode: row.management_mode,
        updatedAt: String(row.updated_at),
      },
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
            capabilityProfile: asRecord(row.capability_profile),
            virtualServers: resources?.virtualServers ?? [],
            certificateResources: resources?.certificateResources ?? [],
            certificateBindings: resources?.certificateBindings ?? [],
            deviceLogs: resources?.deviceLogs ?? [],
          },
    };
  }

  private async getNetworkDeviceResources(tenantId: string, deviceAssetId: string) {
    const [virtualServers, certificateResources, certificateBindings, deviceLogs] = await Promise.all([
      this.db.query<DeviceVirtualServerRow>(
        `select id, virtual_server_type, virtual_server_name, address, port, protocol, runtime_state, sni_names
         from pg_device_virtual_servers
         where tenant_id=$1 and device_asset_id=$2 and deleted_at is null and status<>'DELETED'
         order by virtual_server_type, virtual_server_name`,
        [tenantId, deviceAssetId],
      ),
      this.db.query<DeviceCertificateResourceRow>(
        `select id, certkey_name, subject, issuer, not_before, not_after, remote_status
         from pg_device_certificate_resources
         where tenant_id=$1 and device_asset_id=$2 and deleted_at is null
         order by certkey_name`,
        [tenantId, deviceAssetId],
      ),
      this.db.query<DeviceCertificateBindingRow>(
        `select binding.id, virtual_server.virtual_server_type, virtual_server.virtual_server_name,
                certificate.certkey_name, certificate.subject, certificate.issuer,
                certificate.not_before, certificate.not_after, certificate.remote_status,
                binding.sni_certificate
         from pg_device_certificate_bindings binding
         join pg_device_virtual_servers virtual_server on virtual_server.id=binding.virtual_server_id
         join pg_device_certificate_resources certificate on certificate.id=binding.certificate_resource_id
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
    ]);
    return {
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
    };
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
  ), application_counts as (
    select host_id, count(distinct asset_id)::int as asset_count
    from (
      select sa.host_id, sa.id as asset_id
      from pg_service_assets sa
      where sa.tenant_id = $1 and sa.deleted_at is null and coalesce(sa.asset_kind, 'APPLICATION') <> 'DEVICE'
      union
      select si.host_id, site.id as asset_id
      from pg_site_assets site
      join pg_service_instances si on si.id = site.service_instance_id and si.tenant_id = site.tenant_id
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
    device.service_asset_id as device_asset_id,
    device.device_family,
    device.management_port,
    device.auth_mode,
    device.tls_verify,
    device.product_name,
    device.software_version,
    device.software_build,
    device.support_tier,
    device.capability_profile,
    device.last_discovered_at as device_last_discovered_at,
    device.last_error_code,
    service.address as device_address,
    coalesce(counts.asset_count, 0)::int as application_asset_count
  from pg_hosts host
  left join agent_extensions agent on agent.agent_id = host.agent_id
  left join agent_snapshots snapshot on snapshot.agent_id = host.agent_id
  left join pg_device_assets device on device.tenant_id = host.tenant_id and device.host_id = host.id
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
  device_asset_id: string | null;
  device_family: string | null;
  management_port: number | null;
  auth_mode: string | null;
  tls_verify: boolean | null;
  product_name: string | null;
  software_version: string | null;
  software_build: string | null;
  support_tier: string | null;
  capability_profile: Record<string, unknown> | null;
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
  };
  if (row.device_family) {
    source.networkAppliance = {
      deviceFamily: row.device_family,
      productName: row.product_name ?? undefined,
      softwareVersion: row.software_version ?? undefined,
      softwareBuild: row.software_build ?? undefined,
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
    };
  }
  return source;
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
