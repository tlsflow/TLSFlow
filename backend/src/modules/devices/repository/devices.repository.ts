import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import type {
  ManagedDeviceHealth,
  ManagedDeviceDetailDto,
  ManagedDeviceListQuery,
  ManagedDevicePageDto,
  ManagedDeviceSummaryDto,
} from '../dto/devices.dto.js';

const SERVER_PRODUCT_FAMILY_BY_OS: Readonly<Record<string, string>> = {
  WINDOWS: 'Windows Server',
  LINUX: 'Linux Server',
};

const DEVICE_PRODUCT_FAMILY_BY_TYPE: Readonly<Record<string, string>> = {
  NETSCALER_ADC: 'Citrix ADC',
};

const DEVICE_MANAGEMENT_METHOD_BY_TYPE: Readonly<Record<string, string>> = {
  NETSCALER_ADC: 'NITRO_API',
};

export interface DevicesRepository {
  list(tenantId: string, query: ManagedDeviceListQuery): Promise<ManagedDevicePageDto>;
  get(tenantId: string, deviceId: string): Promise<ManagedDeviceDetailDto | undefined>;
}

export class PgDevicesRepository implements DevicesRepository {
  constructor(private readonly db: DatabasePort = new PgliteDatabase()) {}

  async list(tenantId: string, query: ManagedDeviceListQuery): Promise<ManagedDevicePageDto> {
    const rows = (await this.db.query<ManagedDeviceRow>(DEVICE_LIST_SQL, [tenantId])).rows;
    const items = rows.map(toSummary).filter((item) => matches(item, query));
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
    const summary = toSummary(row);
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
            deviceFamily: row.device_family,
            supportTier: row.support_tier,
            softwareBuild: row.software_build,
            capabilityProfile: asRecord(row.capability_profile),
          },
    };
  }
}

const DEVICE_LIST_SQL = `
  with agent_extensions as (
    select document_id as agent_id, payload
    from pg_documents
    where namespace = 'agents:registrations'
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
    device.device_family,
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
  left join pg_device_assets device on device.tenant_id = host.tenant_id and device.host_id = host.id
  left join pg_service_assets service on service.tenant_id = device.tenant_id and service.id = device.service_asset_id and service.deleted_at is null
  left join application_counts counts on counts.host_id = host.id
  where host.tenant_id = $1 and host.deleted_at is null
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
  device_family: string | null;
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

function toSummary(row: ManagedDeviceRow): ManagedDeviceSummaryDto {
  return row.device_family ? toNetworkDevice(row) : toAgentDevice(row);
}

function toNetworkDevice(row: ManagedDeviceRow): ManagedDeviceSummaryDto {
  const capabilities = Object.entries(asRecord(row.capability_profile))
    .filter(([, enabled]) => enabled === true)
    .map(([name]) => name);
  const sourceStatus = row.last_error_code ? 'ERROR' : row.device_last_discovered_at ? 'DISCOVERED' : row.host_status;
  return {
    id: row.id,
    displayName: row.display_name ?? row.device_address ?? row.id,
    category: 'NETWORK_APPLIANCE',
    productFamily: row.product_name ?? DEVICE_PRODUCT_FAMILY_BY_TYPE[row.device_family!] ?? row.device_family!,
    managementMethod: DEVICE_MANAGEMENT_METHOD_BY_TYPE[row.device_family!] ?? 'API',
    managementAddress: row.device_address ?? row.primary_ip ?? row.hostname ?? undefined,
    health: mapNetworkDeviceHealth(row.host_status, row.last_error_code, row.support_tier, row.device_last_discovered_at),
    sourceStatus,
    softwareVersion: [row.software_version, row.software_build].filter(Boolean).join(' ') || undefined,
    lastContactAt: row.device_last_discovered_at ?? row.last_discovered_at ?? undefined,
    applicationAssetCount: Number(row.application_asset_count),
    capabilities,
    extensionType: 'NETWORK_APPLIANCE',
  };
}

function toAgentDevice(row: ManagedDeviceRow): ManagedDeviceSummaryDto {
  const payload = asRecord(row.agent_payload);
  const descriptor = asRecord(payload.descriptor);
  const sourceStatus = stringValue(payload.status) ?? row.host_status;
  const osType = stringValue(descriptor.osType) ?? row.os_type;
  return {
    id: row.id,
    displayName: row.display_name ?? row.hostname ?? row.primary_ip ?? row.id,
    category: 'SERVER',
    productFamily: SERVER_PRODUCT_FAMILY_BY_OS[osType] ?? row.os_name ?? osType,
    managementMethod: row.management_mode,
    managementAddress: row.primary_ip ?? row.hostname ?? undefined,
    health: mapAgentHealth(sourceStatus),
    sourceStatus,
    softwareVersion: stringValue(descriptor.agentVersion) ?? row.os_version ?? undefined,
    lastContactAt: stringValue(payload.updatedAt) ?? row.last_discovered_at ?? undefined,
    applicationAssetCount: Number(row.application_asset_count),
    capabilities: stringArray(descriptor.capabilities),
    extensionType: 'AGENT',
  };
}

export function mapNetworkDeviceHealth(hostStatus: string, lastErrorCode?: string | null, supportTier?: string | null, lastDiscoveredAt?: string | null): ManagedDeviceHealth {
  if (hostStatus === 'DISABLED') return 'DISABLED';
  if (lastErrorCode) return 'UNREACHABLE';
  if (supportTier === 'UNSUPPORTED') return 'DEGRADED';
  if (lastDiscoveredAt) return 'HEALTHY';
  return 'UNKNOWN';
}

export function mapAgentHealth(status: string): ManagedDeviceHealth {
  if (status === 'online' || status === 'active' || status === 'ACTIVE') return 'HEALTHY';
  if (status === 'disabled' || status === 'revoked' || status === 'DISABLED') return 'DISABLED';
  if (status === 'offline' || status === 'UNREACHABLE') return 'UNREACHABLE';
  if (status === 'upgrading' || status === 'degraded') return 'DEGRADED';
  return 'UNKNOWN';
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

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
