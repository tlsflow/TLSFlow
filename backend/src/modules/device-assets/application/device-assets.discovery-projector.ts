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
      await projectUnifiedAssets(tx, tenantId, deviceAssetId, discovery, certificateIds, discoveredAt);
    });
    return { virtualServers: discovery.virtualServers.length, certificates: discovery.certificates.length, bindings: discovery.bindings.length, discoveredAt };
  }
}

async function projectUnifiedAssets(
  db: DatabasePort,
  tenantId: string,
  deviceAssetId: string,
  discovery: NetscalerDiscoveryResult,
  certificateIds: Map<string, string>,
  discoveredAt: string,
): Promise<void> {
  const device = (await db.query<{ host_id: string; display_name: string; address: string }>(`
    select da.host_id, coalesce(sa.display_name, sa.address) as display_name, sa.address
    from pg_device_assets da
    join pg_service_assets sa on sa.id = da.service_asset_id and sa.tenant_id = da.tenant_id
    where da.tenant_id = $1 and da.service_asset_id = $2
  `, [tenantId, deviceAssetId])).rows[0];
  if (!device?.host_id) return;
  const serviceInstanceId = stableId('svi', deviceAssetId, 'NETSCALER_ADC');
  await db.query(`
    insert into pg_service_instances (
      id, tenant_id, host_id, provider_type, service_name, display_name, version_text, ports,
      discovery_source, last_discovered_at, status, raw_facts, created_at, updated_at, version
    ) values ($1,$2,$3,'DEVICE_TEMPLATE','netscaler-adc',$4,$5,'[]'::jsonb,'PROVIDER',$6,'ACTIVE',$7::jsonb,$6,$6,1)
    on conflict (id) do update set display_name=excluded.display_name, version_text=excluded.version_text,
      last_discovered_at=excluded.last_discovered_at, status='ACTIVE', raw_facts=excluded.raw_facts,
      deleted_at=null, updated_at=excluded.updated_at, version=pg_service_instances.version+1
  `, [serviceInstanceId, tenantId, device.host_id, device.display_name, discovery.device.softwareVersion, discoveredAt, JSON.stringify(discovery.device.rawSummary)]);

  await db.query(`update pg_managed_targets set status='STALE', updated_at=$1, version=version+1 where tenant_id=$2 and device_asset_id=$3 and deleted_at is null`, [discoveredAt, tenantId, deviceAssetId]);
  await db.query(`update pg_site_assets set status='STALE', updated_at=$1, version=version+1 where tenant_id=$2 and metadata->>'deviceAssetId'=$3 and deleted_at is null`, [discoveredAt, tenantId, deviceAssetId]);
  await db.query(`update pg_service_assets set status='STALE', updated_at=$1, version=version+1 where tenant_id=$2 and metadata->>'deviceAssetId'=$3 and asset_kind='APPLICATION' and deleted_at is null`, [discoveredAt, tenantId, deviceAssetId]);

  for (const virtualServer of discovery.virtualServers) {
    const identity = `${virtualServer.type}:${virtualServer.name}`;
    const serviceAssetId = stableId('sat', deviceAssetId, identity);
    const siteAssetId = stableId('sia', deviceAssetId, identity);
    const managedTargetId = stableId('mgt', deviceAssetId, identity);
    const applicationTargetId = stableId('aat', deviceAssetId, identity);
    const address = virtualServer.sniNames[0] ?? `${virtualServer.type.toLowerCase()}-${virtualServer.name.toLowerCase()}.${deviceAssetId}.managed`;
    const port = virtualServer.port ?? 443;
    const protocol = normalizeProtocol(virtualServer.protocol);
    const metadata = JSON.stringify({ deviceAssetId, virtualServerType: virtualServer.type, virtualServerName: virtualServer.name });
    await db.query(`
      insert into pg_service_assets (
        id, tenant_id, address, address_type, port, protocol, sni_name, display_name, service_instance_id,
        host_id, discovery_source, last_discovered_at, status, tags, metadata, asset_kind, created_at, updated_at, version
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PROVIDER',$11,'ACTIVE','[]'::jsonb,$12::jsonb,'APPLICATION',$11,$11,1)
      on conflict (id) do update set address=excluded.address, port=excluded.port, protocol=excluded.protocol,
        sni_name=excluded.sni_name, display_name=excluded.display_name, last_discovered_at=excluded.last_discovered_at,
        status='ACTIVE', metadata=excluded.metadata, deleted_at=null, updated_at=excluded.updated_at,
        version=pg_service_assets.version+1
    `, [serviceAssetId, tenantId, address.toLowerCase(), inferAddressType(address), port, protocol, virtualServer.sniNames[0] ?? null,
      `${virtualServer.type} ${virtualServer.name}`, serviceInstanceId, device.host_id, discoveredAt, metadata]);
    await db.query(`
      insert into pg_site_assets (
        id, tenant_id, service_instance_id, service_asset_id, host_id, agent_id, provider_type, site_type,
        site_name, site_key, binding_information, host_header, listen_ip, port, protocol, runtime_status,
        discovery_source, last_discovered_at, status, metadata, created_at, updated_at, version
      ) values ($1,$2,$3,$4,$5,null,'DEVICE_TEMPLATE','CUSTOM',$6,$7,$8,$9,$10,$11,$12,$13,'PROVIDER',$14,'ACTIVE',$15::jsonb,$14,$14,1)
      on conflict (id) do update set service_asset_id=excluded.service_asset_id, binding_information=excluded.binding_information,
        host_header=excluded.host_header, listen_ip=excluded.listen_ip, port=excluded.port, protocol=excluded.protocol,
        runtime_status=excluded.runtime_status, last_discovered_at=excluded.last_discovered_at, status='ACTIVE',
        metadata=excluded.metadata, deleted_at=null, updated_at=excluded.updated_at, version=pg_site_assets.version+1
    `, [siteAssetId, tenantId, serviceInstanceId, serviceAssetId, device.host_id, virtualServer.name, identity,
      `${virtualServer.address ?? '*'}:${port}`, virtualServer.sniNames[0] ?? null, virtualServer.address ?? null, port, protocol,
      virtualServer.state ?? null, discoveredAt, metadata]);
    await db.query(`
      insert into pg_managed_targets (
        id, tenant_id, agent_id, device_asset_id, host_id, service_instance_id, service_asset_id, site_asset_id,
        provider_type, framework_type, target_type, target_key, binding_key, capability_profile, deployment_mode,
        last_seen_at, status, metadata, created_at, updated_at, version
      ) values ($1,$2,null,$3,$4,$5,$6,$7,'DEVICE_TEMPLATE','DEVICE_TEMPLATE','SITE_BINDING',$8,$9,$10::jsonb,'NITRO',$11,'ACTIVE',$12::jsonb,$11,$11,1)
      on conflict (id) do update set service_asset_id=excluded.service_asset_id, site_asset_id=excluded.site_asset_id,
        capability_profile=excluded.capability_profile, last_seen_at=excluded.last_seen_at, status='ACTIVE',
        metadata=excluded.metadata, deleted_at=null, updated_at=excluded.updated_at, version=pg_managed_targets.version+1
    `, [managedTargetId, tenantId, deviceAssetId, device.host_id, serviceInstanceId, serviceAssetId, siteAssetId, identity, identity,
      JSON.stringify(discovery.capabilityProfile), discoveredAt, metadata]);
    await db.query(`
      insert into pg_application_asset_targets (
        id, tenant_id, application_asset_id, agent_id, device_asset_id, site_asset_id, managed_target_id,
        provider_type, framework_type, target_type, target_key, binding_key, status, metadata, created_at, updated_at, version
      ) values ($1,$2,$3,null,$4,$5,$6,'DEVICE_TEMPLATE','DEVICE_TEMPLATE','SITE_BINDING',$7,$7,'ACTIVE',$8::jsonb,$9,$9,1)
      on conflict (id) do update set site_asset_id=excluded.site_asset_id, managed_target_id=excluded.managed_target_id,
        status='ACTIVE', metadata=excluded.metadata, deleted_at=null, updated_at=excluded.updated_at,
        version=pg_application_asset_targets.version+1
    `, [applicationTargetId, tenantId, serviceAssetId, deviceAssetId, siteAssetId, managedTargetId, identity, metadata, discoveredAt]);

    for (const binding of discovery.bindings.filter((item) => item.virtualServerType === virtualServer.type && item.virtualServerName === virtualServer.name)) {
      const certificateResourceId = certificateIds.get(binding.certKeyName);
      const certificateBindingId = stableId('cbd', deviceAssetId, identity, binding.certKeyName, binding.sniCertificate ? 'SNI' : 'DEFAULT');
      await db.query(`
        insert into pg_certificate_bindings (
          id, tenant_id, service_instance_id, host_id, service_asset_id, site_asset_id, managed_target_id,
          domain_name, port, protocol, binding_key, binding_type, discovery_source, verify_method,
          drift_status, status, metadata, created_at, updated_at, version
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'CUSTOM','PROVIDER','CUSTOM','UNKNOWN','ACTIVE',$12::jsonb,$13,$13,1)
        on conflict (id) do update set domain_name=excluded.domain_name, port=excluded.port, protocol=excluded.protocol,
          binding_key=excluded.binding_key, status='ACTIVE', metadata=excluded.metadata, deleted_at=null,
          updated_at=excluded.updated_at, version=pg_certificate_bindings.version+1
      `, [certificateBindingId, tenantId, serviceInstanceId, device.host_id, serviceAssetId, siteAssetId, managedTargetId,
        virtualServer.sniNames[0] ?? virtualServer.address ?? null, port, protocol,
        `${identity}:${binding.certKeyName}`, JSON.stringify({ ...binding.rawSummary, deviceAssetId, certificateResourceId }), discoveredAt]);
    }
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

function normalizeProtocol(value: string | undefined): 'HTTPS' | 'TLS' | 'STARTTLS' | 'HTTP' {
  const protocol = value?.toUpperCase();
  if (protocol === 'HTTP') return 'HTTP';
  if (protocol === 'SSL' || protocol === 'HTTPS') return 'HTTPS';
  return 'TLS';
}

function inferAddressType(address: string): 'IPV4' | 'IPV6' | 'DNS' {
  if (address.includes(':')) return 'IPV6';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) return 'IPV4';
  return 'DNS';
}
