import type { DatabasePort } from '../../../database/database-port.js';
import { AppError } from '../../../common/errors/app-error.js';
import { newId } from '../../../shared/id.js';
import type { CreateDeviceAssetDto, DeviceAssetDto, UpdateDeviceAssetDto } from '../dto/device-assets.dto.js';

export interface DeviceAssetsRepository {
  list(tenantId: string): Promise<DeviceAssetDto[]>;
  get(tenantId: string, deviceAssetId: string): Promise<DeviceAssetDto | undefined>;
  create(tenantId: string, input: Required<Pick<CreateDeviceAssetDto, 'managementPort' | 'authMode' | 'tlsVerify'>> & CreateDeviceAssetDto): Promise<DeviceAssetDto>;
  update(tenantId: string, deviceAssetId: string, input: UpdateDeviceAssetDto): Promise<DeviceAssetDto>;
  softDelete(tenantId: string, deviceAssetId: string): Promise<DeviceAssetDto>;
}

export class PgDeviceAssetsRepository implements DeviceAssetsRepository {
  constructor(private readonly db: DatabasePort) {}

  async list(tenantId: string): Promise<DeviceAssetDto[]> {
    const result = await this.db.query<DeviceAssetRow>(selectDeviceSql('where sa.tenant_id = $1 and sa.deleted_at is null') + ' order by sa.created_at desc', [tenantId]);
    return result.rows.map(toDto);
  }

  async get(tenantId: string, deviceAssetId: string): Promise<DeviceAssetDto | undefined> {
    const result = await this.db.query<DeviceAssetRow>(selectDeviceSql('where sa.tenant_id = $1 and sa.id = $2 and sa.deleted_at is null'), [tenantId, deviceAssetId]);
    return result.rows[0] ? toDto(result.rows[0]) : undefined;
  }

  async create(tenantId: string, input: Required<Pick<CreateDeviceAssetDto, 'managementPort' | 'authMode' | 'tlsVerify'>> & CreateDeviceAssetDto): Promise<DeviceAssetDto> {
    const existing = await this.db.query<{ id: string }>(
      `select id from pg_service_assets where tenant_id = $1 and address = $2 and port = $3 and protocol = 'HTTPS' and deleted_at is null limit 1`,
      [tenantId, input.managementAddress, input.managementPort],
    );
    if (existing.rows[0]) throw new AppError('RESOURCE_ALREADY_EXISTS', '相同管理地址的设备资产已存在', { deviceAssetId: existing.rows[0].id });
    const id = newId('dev');
    const hostId = newId('hst');
    const now = new Date().toISOString();
    const addressType = inferAddressType(input.managementAddress);
    await this.db.transaction(async (tx) => {
      await tx.query(
        `insert into pg_hosts (
          id, tenant_id, hostname, display_name, primary_ip, ip_addresses, os_type, os_name, os_version,
          management_channels, discovery_source, agent_id, asset_fingerprint, compatibility_level,
          management_mode, status, tags, created_at, updated_at, version
        ) values (
          $1, $2, $3, $4, $5, $6::jsonb, 'NETWORK_DEVICE', $7, null,
          $8::jsonb, 'MANUAL', null, $9, 'L1', 'AGENTLESS', 'UNKNOWN', '[]'::jsonb, $10, $10, 1
        )`,
        [
          hostId,
          tenantId,
          addressType === 'DNS' ? input.managementAddress.toLowerCase() : null,
          input.displayName,
          addressType === 'DNS' ? null : input.managementAddress,
          JSON.stringify(addressType === 'DNS' ? [] : [input.managementAddress]),
          deviceProductName(input.deviceFamily),
          JSON.stringify([{ type: 'NITRO', enabled: true, refId: id, metadata: { port: input.managementPort, tlsVerify: input.tlsVerify } }]),
          `device:${input.deviceFamily}:${input.managementAddress.toLowerCase()}:${input.managementPort}`,
          now,
        ],
      );
      await tx.query(
        `insert into pg_service_assets (
          id, tenant_id, address, address_type, port, protocol, display_name, discovery_source,
          host_id, status, tags, metadata, asset_kind, created_at, updated_at, version
        ) values ($1, $2, $3, $4, $5, 'HTTPS', $6, 'MANUAL', $7, 'UNKNOWN', '[]'::jsonb, $8::jsonb, 'DEVICE', $9, $9, 1)`,
        [id, tenantId, input.managementAddress, addressType, input.managementPort, input.displayName, hostId, JSON.stringify({ deviceFamily: input.deviceFamily }), now],
      );
      await tx.query(
        `insert into pg_device_assets (
          service_asset_id, tenant_id, host_id, device_family, management_port, credential_id, auth_mode,
          tls_verify, ca_secret_id, gateway_id, support_tier, capability_profile, created_at, updated_at, version
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'READ_ONLY', '{}'::jsonb, $11, $11, 1)`,
        [id, tenantId, hostId, input.deviceFamily, input.managementPort, input.credentialId, input.authMode, input.tlsVerify, input.caSecretId ?? null, input.gatewayId ?? null, now],
      );
    });
    return this.require(tenantId, id);
  }

  async update(tenantId: string, deviceAssetId: string, input: UpdateDeviceAssetDto): Promise<DeviceAssetDto> {
    const current = await this.require(tenantId, deviceAssetId);
    const next = { ...current, ...input };
    const now = new Date().toISOString();
    await this.db.transaction(async (tx) => {
      await tx.query(
        `update pg_service_assets set address = $1, address_type = $2, port = $3, display_name = $4, updated_at = $5, version = version + 1
         where id = $6 and tenant_id = $7 and deleted_at is null`,
        [next.managementAddress, inferAddressType(next.managementAddress), next.managementPort, next.displayName, now, deviceAssetId, tenantId],
      );
      await tx.query(
        `update pg_device_assets set management_port = $1, credential_id = $2, auth_mode = $3, tls_verify = $4,
         ca_secret_id = $5, gateway_id = $6, updated_at = $7, version = version + 1
         where service_asset_id = $8 and tenant_id = $9`,
        [next.managementPort, next.credentialId, next.authMode, next.tlsVerify, next.caSecretId ?? null, next.gatewayId ?? null, now, deviceAssetId, tenantId],
      );
      const addressType = inferAddressType(next.managementAddress);
      await tx.query(
        `update pg_hosts set hostname = $1, display_name = $2, primary_ip = $3, ip_addresses = $4::jsonb,
          management_channels = $5::jsonb, asset_fingerprint = $6, updated_at = $7, version = version + 1
         where id = $8 and tenant_id = $9 and deleted_at is null`,
        [
          addressType === 'DNS' ? next.managementAddress.toLowerCase() : null,
          next.displayName,
          addressType === 'DNS' ? null : next.managementAddress,
          JSON.stringify(addressType === 'DNS' ? [] : [next.managementAddress]),
          JSON.stringify([{ type: 'NITRO', enabled: true, refId: deviceAssetId, metadata: { port: next.managementPort, tlsVerify: next.tlsVerify } }]),
          `device:${next.deviceFamily}:${next.managementAddress.toLowerCase()}:${next.managementPort}`,
          now,
          current.hostId,
          tenantId,
        ],
      );
    });
    return this.require(tenantId, deviceAssetId);
  }

  async softDelete(tenantId: string, deviceAssetId: string): Promise<DeviceAssetDto> {
    const current = await this.require(tenantId, deviceAssetId);
    const now = new Date().toISOString();
    await this.db.query(`update pg_service_assets set status = 'DELETED', deleted_at = $1, updated_at = $1, version = version + 1 where id = $2 and tenant_id = $3`, [now, deviceAssetId, tenantId]);
    return { ...current, updatedAt: now, version: current.version + 1 };
  }

  private async require(tenantId: string, deviceAssetId: string): Promise<DeviceAssetDto> {
    const item = await this.get(tenantId, deviceAssetId);
    if (!item) throw new AppError('RESOURCE_NOT_FOUND', '设备资产不存在', { deviceAssetId });
    return item;
  }
}

interface DeviceAssetRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  host_id: string;
  display_name: string | null;
  address: string;
  management_port: number;
  device_family: 'NETSCALER_ADC';
  credential_id: string;
  auth_mode: DeviceAssetDto['authMode'];
  tls_verify: boolean;
  ca_secret_id: string | null;
  gateway_id: string | null;
  product_name: string | null;
  software_version: string | null;
  software_build: string | null;
  runtime_mode: string | null;
  ha_mode: string | null;
  support_tier: DeviceAssetDto['supportTier'];
  capability_profile: DeviceAssetDto['capabilityProfile'];
  last_discovered_at: string | null;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

function selectDeviceSql(whereClause: string): string {
  return `select sa.id, sa.tenant_id, sa.display_name, sa.address, da.*
    from pg_service_assets sa
    join pg_device_assets da on da.service_asset_id = sa.id and da.tenant_id = sa.tenant_id
    ${whereClause}`;
}

function toDto(row: DeviceAssetRow): DeviceAssetDto {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    hostId: row.host_id,
    displayName: row.display_name ?? row.address,
    managementAddress: row.address,
    managementPort: Number(row.management_port),
    deviceFamily: row.device_family,
    credentialId: row.credential_id,
    authMode: row.auth_mode,
    tlsVerify: Boolean(row.tls_verify),
    caSecretId: row.ca_secret_id ?? undefined,
    gatewayId: row.gateway_id ?? undefined,
    productName: row.product_name ?? undefined,
    softwareVersion: row.software_version ?? undefined,
    softwareBuild: row.software_build ?? undefined,
    runtimeMode: row.runtime_mode ?? undefined,
    haMode: row.ha_mode ?? undefined,
    supportTier: row.support_tier,
    capabilityProfile: asRecord(row.capability_profile),
    lastDiscoveredAt: row.last_discovered_at ?? undefined,
    lastErrorCode: row.last_error_code ?? undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    version: Number(row.version),
  };
}

function inferAddressType(address: string): 'IPV4' | 'IPV6' | 'DNS' {
  if (address.includes(':')) return 'IPV6';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) return 'IPV4';
  return 'DNS';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function deviceProductName(deviceFamily: DeviceAssetDto['deviceFamily']): string {
  if (deviceFamily === 'NETSCALER_ADC') return 'Citrix ADC';
  return deviceFamily;
}
