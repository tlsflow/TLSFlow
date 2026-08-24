import { createHash } from 'node:crypto';
import type { DatabasePort } from '../../../database/database-port.js';
import type { NetscalerDiscoveryResult } from '../../providers/netscaler/netscaler-nitro.discovery.js';

export interface DeviceDiscoveryProjectionSummary {
  virtualServers: number;
  certificates: number;
  bindings: number;
  discoveredAt: string;
}

export class DeviceAssetsDiscoveryProjector {
  constructor(private readonly db: DatabasePort) {}

  async project(tenantId: string, deviceAssetId: string, discovery: NetscalerDiscoveryResult): Promise<DeviceDiscoveryProjectionSummary> {
    const discoveredAt = new Date().toISOString();
    await this.db.transaction(async (tx) => {
      await updateDevice(tx, tenantId, deviceAssetId, discovery, discoveredAt);
      await markExistingStale(tx, tenantId, deviceAssetId, discoveredAt);

      const virtualServerIds = new Map<string, string>();
      for (const item of discovery.virtualServers) {
        const id = stableId('dvs', deviceAssetId, item.type, item.name);
        virtualServerIds.set(`${item.type}:${item.name}`, id);
        await tx.query(
          `insert into pg_device_virtual_servers (
            id, tenant_id, device_asset_id, virtual_server_type, virtual_server_name, target_key,
            address, port, protocol, runtime_state, sni_names, metadata, last_discovered_at, status
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,'ACTIVE')
          on conflict (id) do update set address = excluded.address, port = excluded.port,
            protocol = excluded.protocol, runtime_state = excluded.runtime_state, sni_names = excluded.sni_names,
            metadata = excluded.metadata, last_discovered_at = excluded.last_discovered_at, status = 'ACTIVE',
            deleted_at = null, updated_at = excluded.last_discovered_at, version = pg_device_virtual_servers.version + 1`,
          [id, tenantId, deviceAssetId, item.type, item.name, `${item.type}:${item.name}`, item.address ?? null, item.port ?? null,
            item.protocol ?? null, item.state ?? null, JSON.stringify(item.sniNames), JSON.stringify(item.rawSummary), discoveredAt],
        );
      }

      const certificateIds = new Map<string, string>();
      for (const item of discovery.certificates) {
        const id = stableId('dcr', deviceAssetId, item.certKeyName);
        certificateIds.set(item.certKeyName, id);
        await tx.query(
          `insert into pg_device_certificate_resources (
            id, tenant_id, device_asset_id, certkey_name, certificate_path, private_key_path, subject, issuer,
            serial_number, not_before, not_after, remote_status, signature_algorithm, public_key_algorithm,
            public_key_size, linked_certkey_name, source_version, metadata, last_discovered_at
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19)
          on conflict (id) do update set certificate_path = excluded.certificate_path, private_key_path = excluded.private_key_path,
            subject = excluded.subject, issuer = excluded.issuer, serial_number = excluded.serial_number,
            not_before = excluded.not_before, not_after = excluded.not_after, remote_status = excluded.remote_status,
            signature_algorithm = excluded.signature_algorithm, public_key_algorithm = excluded.public_key_algorithm,
            public_key_size = excluded.public_key_size, linked_certkey_name = excluded.linked_certkey_name,
            source_version = excluded.source_version, metadata = excluded.metadata, last_discovered_at = excluded.last_discovered_at,
            deleted_at = null, updated_at = excluded.last_discovered_at, version = pg_device_certificate_resources.version + 1`,
          [id, tenantId, deviceAssetId, item.certKeyName, item.certificatePath ?? null, item.privateKeyPath ?? null,
            item.subject ?? null, item.issuer ?? null, item.serialNumber ?? null, timestamp(item.notBefore), timestamp(item.notAfter),
            item.status ?? null, item.signatureAlgorithm ?? null, item.publicKeyAlgorithm ?? null, item.publicKeySize ?? null,
            item.linkedCertKeyName ?? null, item.sourceVersion, JSON.stringify(item.rawFieldSummary), discoveredAt],
        );
      }

      for (const item of discovery.bindings) {
        const virtualServerId = virtualServerIds.get(`${item.virtualServerType}:${item.virtualServerName}`);
        const certificateResourceId = certificateIds.get(item.certKeyName);
        if (!virtualServerId || !certificateResourceId) continue;
        const bindingKey = `${item.virtualServerType}:${item.virtualServerName}:${item.certKeyName}:${item.sniCertificate ? 'SNI' : 'DEFAULT'}`;
        const id = stableId('dcb', deviceAssetId, bindingKey);
        await tx.query(
          `insert into pg_device_certificate_bindings (
            id, tenant_id, device_asset_id, virtual_server_id, certificate_resource_id, binding_key,
            sni_certificate, priority, drift_state, metadata
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,'UNKNOWN',$9::jsonb)
          on conflict (id) do update set virtual_server_id = excluded.virtual_server_id,
            certificate_resource_id = excluded.certificate_resource_id, sni_certificate = excluded.sni_certificate,
            priority = excluded.priority, metadata = excluded.metadata, deleted_at = null,
            updated_at = $10, version = pg_device_certificate_bindings.version + 1`,
          [id, tenantId, deviceAssetId, virtualServerId, certificateResourceId, bindingKey, item.sniCertificate,
            item.priority ?? null, JSON.stringify(item.rawSummary), discoveredAt],
        );
      }
    });
    return { virtualServers: discovery.virtualServers.length, certificates: discovery.certificates.length, bindings: discovery.bindings.length, discoveredAt };
  }
}

async function updateDevice(db: DatabasePort, tenantId: string, deviceAssetId: string, discovery: NetscalerDiscoveryResult, discoveredAt: string): Promise<void> {
  await db.query(
    `update pg_device_assets set product_name=$1, software_version=$2, software_build=$3, runtime_mode=$4,
      ha_mode=$5, support_tier=$6, capability_profile=$7::jsonb, last_discovered_at=$8, last_error_code=null,
      updated_at=$8, version=version+1 where tenant_id=$9 and service_asset_id=$10`,
    [discovery.device.productName, discovery.device.softwareVersion, discovery.device.softwareBuild ?? null,
      discovery.device.runtimeMode ?? null, discovery.device.haMode ?? null, discovery.capabilityProfile.supportTier,
      JSON.stringify(discovery.capabilityProfile), discoveredAt, tenantId, deviceAssetId],
  );
}

async function markExistingStale(db: DatabasePort, tenantId: string, deviceAssetId: string, now: string): Promise<void> {
  await db.query(`update pg_device_virtual_servers set status='STALE', updated_at=$1, version=version+1 where tenant_id=$2 and device_asset_id=$3 and deleted_at is null`, [now, tenantId, deviceAssetId]);
  await db.query(`update pg_device_certificate_resources set deleted_at=$1, updated_at=$1, version=version+1 where tenant_id=$2 and device_asset_id=$3 and deleted_at is null`, [now, tenantId, deviceAssetId]);
  await db.query(`update pg_device_certificate_bindings set deleted_at=$1, updated_at=$1, version=version+1 where tenant_id=$2 and device_asset_id=$3 and deleted_at is null`, [now, tenantId, deviceAssetId]);
}

function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 24)}`;
}

function timestamp(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
