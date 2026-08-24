import { createHash } from 'node:crypto';
import type { DatabasePort } from '../../../database/database-port.js';
import { newId } from '../../../shared/id.js';
import type { StandardDeviceDiscoveryV1 } from './device-discovery.dto.js';
import { DeviceDiscoverySchemaService } from './device-discovery-schema.service.js';

export interface StandardDiscoveryProjectionContext {
  tenantId: string;
  deviceAssetId: string;
  hostId: string;
  pluginVersionId: string;
  pluginBindingId?: string;
}

export interface StandardDiscoveryProjectionSummary {
  serviceInstances: number;
  sites: number;
  managedTargets: number;
  certificates: number;
  certificateBindings: number;
  stale: number;
  conflicts: number;
}

export class StandardDeviceDiscoveryProjector {
  constructor(private readonly db: DatabasePort, private readonly schema = new DeviceDiscoverySchemaService()) {}

  async preview(context: StandardDiscoveryProjectionContext, rawDiscovery: unknown): Promise<StandardDiscoveryProjectionSummary> {
    const discovery = this.schema.validate(rawDiscovery);
    const providerType = providerKey(context.pluginVersionId);
    const existingSites = await this.db.query<{ site_key: string }>(
      'select site_key from pg_site_assets where tenant_id=$1 and host_id=$2 and provider_type=$3 and deleted_at is null',
      [context.tenantId, context.hostId, providerType],
    );
    const discoveredKeys = new Set(discovery.sites.map((item) => item.stableKey));
    return {
      serviceInstances: discovery.frameworks.length,
      sites: discovery.sites.length,
      managedTargets: discovery.sites.length,
      certificates: discovery.certificates.length,
      certificateBindings: discovery.certificateBindings.length,
      stale: existingSites.rows.filter((row) => !discoveredKeys.has(row.site_key)).length,
      conflicts: 0,
    };
  }

  async project(context: StandardDiscoveryProjectionContext, rawDiscovery: unknown): Promise<StandardDiscoveryProjectionSummary> {
    const discovery = this.schema.validate(rawDiscovery);
    const summary = await this.preview(context, discovery);
    const discoveredAt = new Date().toISOString();
    const snapshotId = newId('pds');
    try {
      await this.db.transaction(async (tx) => {
        const providerType = providerKey(context.pluginVersionId);
        await tx.query(
          `update pg_device_assets set product_family=$1, product_name=$2, software_version=$3,
             plugin_version_id=$4, plugin_binding_id=$5, capability_profile=$6::jsonb, metadata=$7::jsonb,
             last_discovered_at=$8, last_error_code=null, updated_at=$8, version=version+1
           where tenant_id=$9 and service_asset_id=$10`,
          [discovery.device.productFamily, discovery.device.displayName, discovery.device.softwareVersion ?? null,
            context.pluginVersionId, context.pluginBindingId ?? null, JSON.stringify(capabilityProfile(discovery)),
            JSON.stringify(discovery.device.metadata ?? {}), discoveredAt, context.tenantId, context.deviceAssetId],
        );
        await tx.query(
          `update pg_service_assets
           set status='ACTIVE', metadata=metadata || $1::jsonb, updated_at=$2, version=version+1
           where tenant_id=$3 and id=$4 and deleted_at is null`,
          [JSON.stringify({ onboardingState: 'ACTIVE', discoveryStatus: 'ACTIVE' }), discoveredAt, context.tenantId, context.deviceAssetId],
        );
        await markStale(tx, context, providerType, discoveredAt);

        const frameworkIds = new Map<string, string>();
        for (const framework of discovery.frameworks) {
          const id = stableId('psi', context.deviceAssetId, framework.stableKey);
          frameworkIds.set(framework.stableKey, id);
          await tx.query(
            `insert into pg_service_instances (
               id, tenant_id, host_id, provider_type, service_name, display_name, version_text, ports, provider_key,
               manual_overrides, discovery_source, last_discovered_at, status, raw_facts, created_at, updated_at, version
             ) values ($1,$2,$3,$4,$5::text,$6,$7,'[]'::jsonb,$5::text,'{}'::jsonb,'PROVIDER',$8,'ACTIVE',$9::jsonb,$8,$8,1)
             on conflict (id) do update set display_name=excluded.display_name, version_text=excluded.version_text,
               last_discovered_at=excluded.last_discovered_at, status='ACTIVE', raw_facts=excluded.raw_facts,
               deleted_at=null, updated_at=excluded.updated_at, version=pg_service_instances.version+1`,
            [id, context.tenantId, context.hostId, providerType, framework.stableKey, framework.displayName,
              framework.version ?? null, discoveredAt, JSON.stringify(framework.metadata ?? {})],
          );
        }

        const fallbackServiceId = discovery.frameworks.length === 0
          ? await upsertFallbackService(tx, context, providerType, discovery, discoveredAt)
          : undefined;
        const siteIds = new Map<string, string>();
        const siteServiceInstanceIds = new Map<string, string>();
        const targetIds = new Map<string, string>();
        for (const site of discovery.sites) {
          const serviceInstanceId = (site.frameworkStableKey && frameworkIds.get(site.frameworkStableKey)) ?? fallbackServiceId;
          if (!serviceInstanceId) throw new Error(`site framework missing: ${site.stableKey}`);
          const siteId = stableId('psa', context.deviceAssetId, site.stableKey);
          siteIds.set(site.stableKey, siteId);
          siteServiceInstanceIds.set(site.stableKey, serviceInstanceId);
          await tx.query(
            `insert into pg_site_assets (
               id, tenant_id, service_instance_id, host_id, agent_id, provider_type, site_type, site_name, site_key,
               binding_information, listen_ip, port, protocol, discovery_source, last_discovered_at, status, metadata,
               created_at, updated_at, version
             ) values ($1,$2,$3,$4,null,$5,'CUSTOM',$6,$7,$8,$9,$10,$11,'PROVIDER',$12,'ACTIVE',$13::jsonb,$12,$12,1)
             on conflict (id) do update set service_instance_id=excluded.service_instance_id, site_name=excluded.site_name,
               binding_information=excluded.binding_information, listen_ip=excluded.listen_ip, port=excluded.port,
               protocol=excluded.protocol, last_discovered_at=excluded.last_discovered_at, status='ACTIVE',
               metadata=excluded.metadata, deleted_at=null, updated_at=excluded.updated_at, version=pg_site_assets.version+1`,
            [siteId, context.tenantId, serviceInstanceId, context.hostId, providerType, site.displayName, site.stableKey,
              bindingInformation(site), site.addresses[0] ?? null, site.port ?? null, normalizeProtocol(site.protocol),
              discoveredAt, JSON.stringify({ ...(site.metadata ?? {}), addresses: site.addresses })],
          );
          const targetId = stableId('pmt', context.deviceAssetId, site.stableKey);
          targetIds.set(site.stableKey, targetId);
          await tx.query(
            `insert into pg_managed_targets (
               id, tenant_id, agent_id, device_asset_id, host_id, service_instance_id, site_asset_id, provider_type,
               framework_type, target_type, target_key, binding_key, capability_profile, deployment_mode,
               last_seen_at, status, metadata, created_at, updated_at, version
             ) values ($1,$2,null,$3,$4,$5,$6,$7,$8,'SITE_BINDING',$9,$10,$11::jsonb,'PLUGIN',$12,'ACTIVE',$13::jsonb,$12,$12,1)
             on conflict (id) do update set service_instance_id=excluded.service_instance_id, site_asset_id=excluded.site_asset_id,
               framework_type=excluded.framework_type, binding_key=excluded.binding_key,
               capability_profile=excluded.capability_profile, last_seen_at=excluded.last_seen_at, status='ACTIVE',
               metadata=excluded.metadata, deleted_at=null, updated_at=excluded.updated_at, version=pg_managed_targets.version+1`,
            [targetId, context.tenantId, context.deviceAssetId, context.hostId, serviceInstanceId, siteId, providerType,
              site.frameworkStableKey ?? 'DEVICE', site.stableKey, bindingInformation(site), JSON.stringify(capabilityProfile(discovery)),
              discoveredAt, JSON.stringify(site.metadata ?? {})],
          );
        }

        const certificateIds = new Map<string, string>();
        const certificateFingerprints = new Map<string, string | null>();
        for (const certificate of discovery.certificates) {
          const certificateId = stableId('pdc', context.deviceAssetId, certificate.stableKey);
          certificateIds.set(certificate.stableKey, certificateId);
          certificateFingerprints.set(certificate.stableKey, normalizeFingerprint(certificate.sha256Fingerprint));
          await tx.query(
            `insert into plugin_discovered_certificates (
               id, tenant_id, device_asset_id, stable_key, fingerprint_sha256, subject, issuer, not_after,
               metadata, status, last_discovered_at, created_at, updated_at
             ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'ACTIVE',$10,$10,$10)
             on conflict (tenant_id, device_asset_id, stable_key) do update set fingerprint_sha256=excluded.fingerprint_sha256,
               subject=excluded.subject, issuer=excluded.issuer, not_after=excluded.not_after, metadata=excluded.metadata,
               status='ACTIVE', last_discovered_at=excluded.last_discovered_at, updated_at=excluded.updated_at`,
            [certificateId, context.tenantId, context.deviceAssetId, certificate.stableKey,
              normalizeFingerprint(certificate.sha256Fingerprint), certificate.subject ?? null, certificate.issuer ?? null,
              certificate.notAfter ?? null, JSON.stringify(certificate.metadata ?? {}), discoveredAt],
          );
        }
        for (const binding of discovery.certificateBindings) {
          const siteId = siteIds.get(binding.siteStableKey);
          const serviceInstanceId = siteServiceInstanceIds.get(binding.siteStableKey);
          const managedTargetId = targetIds.get(binding.siteStableKey);
          const certificateId = certificateIds.get(binding.certificateStableKey);
          if (!siteId || !serviceInstanceId || !managedTargetId || !certificateId) throw new Error(`certificate binding relation missing: ${binding.stableKey}`);
          const bindingId = stableId('pcb', context.deviceAssetId, binding.stableKey);
          const formalBindingId = stableId('bnd', context.deviceAssetId, binding.stableKey);
          const fingerprint = certificateFingerprints.get(binding.certificateStableKey) ?? null;
          const site = discovery.sites.find((item) => item.stableKey === binding.siteStableKey)!;
          await tx.query(
            `insert into plugin_discovered_certificate_bindings (
               id, tenant_id, device_asset_id, stable_key, site_asset_id, discovered_certificate_id,
               binding_name, metadata, status, last_discovered_at, created_at, updated_at
             ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'ACTIVE',$9,$9,$9)
             on conflict (tenant_id, device_asset_id, stable_key) do update set site_asset_id=excluded.site_asset_id,
               discovered_certificate_id=excluded.discovered_certificate_id, binding_name=excluded.binding_name,
               metadata=excluded.metadata, status='ACTIVE', last_discovered_at=excluded.last_discovered_at,
               updated_at=excluded.updated_at`,
            [bindingId, context.tenantId, context.deviceAssetId, binding.stableKey, siteId, certificateId,
              binding.bindingName ?? null, JSON.stringify({ ...(binding.metadata ?? {}), formalBindingId }), discoveredAt],
          );
          await tx.query(
            `insert into pg_certificate_bindings (
               id, tenant_id, service_instance_id, site_asset_id, managed_target_id, host_id,
               domain_name, domain, port, protocol, binding_key, binding_type,
               certificate_version_id, observed_fingerprint_sha256, remote_endpoint_fingerprint,
               discovery_source, verify_method, remote_status, checked_at, drift_status, status, metadata,
               created_at, updated_at, version
             ) values (
               $1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,'DEVICE_API',
               (select id from pg_certificate_versions where upper(fingerprint_sha256)=upper($11) limit 1),$11,$11,
               'PLUGIN','TLS_CONNECT','reachable',$12,'UNKNOWN','DISCOVERED',$13::jsonb,$12,$12,1
             )
             on conflict (id) do update set service_instance_id=excluded.service_instance_id,
               site_asset_id=excluded.site_asset_id, managed_target_id=excluded.managed_target_id,
               domain_name=excluded.domain_name, domain=excluded.domain, port=excluded.port, protocol=excluded.protocol,
               binding_key=excluded.binding_key, certificate_version_id=excluded.certificate_version_id,
               observed_fingerprint_sha256=excluded.observed_fingerprint_sha256,
               remote_endpoint_fingerprint=excluded.remote_endpoint_fingerprint, remote_status='reachable',
               checked_at=excluded.checked_at, drift_status=case
                 when pg_certificate_bindings.target_fingerprint_sha256 is null then 'UNKNOWN'
                 when upper(pg_certificate_bindings.target_fingerprint_sha256)=upper(excluded.observed_fingerprint_sha256) then 'SYNCED'
                 else 'DRIFTED'
               end,
               status=case when pg_certificate_bindings.status='MANAGED' then 'MANAGED' else 'DISCOVERED' end,
               metadata=pg_certificate_bindings.metadata || excluded.metadata,
               deleted_at=null, updated_at=excluded.updated_at, version=pg_certificate_bindings.version+1`,
            [formalBindingId, context.tenantId, serviceInstanceId, siteId, managedTargetId, context.hostId,
              site.addresses[0] ?? site.displayName, site.port ?? null, normalizeProtocol(site.protocol), binding.stableKey,
              fingerprint, discoveredAt, JSON.stringify({
                ...(binding.metadata ?? {}),
                pluginDiscoveryStableKey: binding.stableKey,
                pluginCertificateStableKey: binding.certificateStableKey,
                pluginDeviceAssetId: context.deviceAssetId,
                pluginVersionId: context.pluginVersionId,
                pluginBindingId: context.pluginBindingId,
                discoveryStatus: 'ACTIVE',
              })],
          );
        }
        await insertSnapshot(tx, snapshotId, context, discovery, summary, 'SUCCEEDED', undefined, discoveredAt);
      });
      return summary;
    } catch (cause) {
      await insertSnapshot(this.db, snapshotId, context, discovery, summary, 'FAILED', cause instanceof Error ? cause.message : 'DISCOVERY_PROJECTION_FAILED', discoveredAt);
      throw cause;
    }
  }
}

async function markStale(db: DatabasePort, context: StandardDiscoveryProjectionContext, providerType: string, discoveredAt: string) {
  await db.query("update pg_service_instances set status='STALE', updated_at=$1, version=version+1 where tenant_id=$2 and host_id=$3 and provider_type=$4 and deleted_at is null", [discoveredAt, context.tenantId, context.hostId, providerType]);
  await db.query("update pg_site_assets set status='STALE', updated_at=$1, version=version+1 where tenant_id=$2 and host_id=$3 and provider_type=$4 and deleted_at is null", [discoveredAt, context.tenantId, context.hostId, providerType]);
  await db.query("update pg_managed_targets set status='STALE', updated_at=$1, version=version+1 where tenant_id=$2 and device_asset_id=$3 and provider_type=$4 and deleted_at is null", [discoveredAt, context.tenantId, context.deviceAssetId, providerType]);
  await db.query("update plugin_discovered_certificates set status='STALE', updated_at=$1 where tenant_id=$2 and device_asset_id=$3", [discoveredAt, context.tenantId, context.deviceAssetId]);
  await db.query("update plugin_discovered_certificate_bindings set status='STALE', updated_at=$1 where tenant_id=$2 and device_asset_id=$3", [discoveredAt, context.tenantId, context.deviceAssetId]);
  await db.query(
    `update pg_certificate_bindings
     set metadata=jsonb_set(metadata, '{discoveryStatus}', '"STALE"'::jsonb, true), updated_at=$1, version=version+1
     where tenant_id=$2 and metadata->>'pluginDeviceAssetId'=$3 and deleted_at is null`,
    [discoveredAt, context.tenantId, context.deviceAssetId],
  );
}

async function upsertFallbackService(db: DatabasePort, context: StandardDiscoveryProjectionContext, providerType: string, discovery: StandardDeviceDiscoveryV1, now: string) {
  const id = stableId('psi', context.deviceAssetId, 'device');
  await db.query(
    `insert into pg_service_instances (id, tenant_id, host_id, provider_type, service_name, display_name, ports, provider_key,
       manual_overrides, discovery_source, last_discovered_at, status, raw_facts, created_at, updated_at, version)
     values ($1,$2,$3,$4,'device',$5,'[]'::jsonb,'device','{}'::jsonb,'PROVIDER',$6,'ACTIVE','{}'::jsonb,$6,$6,1)
     on conflict (id) do update set display_name=excluded.display_name, last_discovered_at=excluded.last_discovered_at,
       status='ACTIVE', deleted_at=null, updated_at=excluded.updated_at, version=pg_service_instances.version+1`,
    [id, context.tenantId, context.hostId, providerType, discovery.device.displayName, now],
  );
  return id;
}

async function insertSnapshot(
  db: DatabasePort,
  id: string,
  context: StandardDiscoveryProjectionContext,
  discovery: StandardDeviceDiscoveryV1,
  summary: StandardDiscoveryProjectionSummary,
  status: 'SUCCEEDED' | 'FAILED',
  errorCode: string | undefined,
  now: string,
) {
  const payload = stableJson(discovery);
  await db.query(
    `insert into plugin_discovery_snapshots (
       id, tenant_id, device_asset_id, plugin_version_id, plugin_binding_id, normalized_sha256,
       status, summary, payload, error_code, created_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)`,
    [id, context.tenantId, context.deviceAssetId, context.pluginVersionId, context.pluginBindingId ?? null,
      createHash('sha256').update(payload).digest('hex'), status, JSON.stringify(summary), payload, errorCode ?? null, now],
  );
}

function capabilityProfile(discovery: StandardDeviceDiscoveryV1) {
  return Object.fromEntries(discovery.capabilities.map((item) => [item.key, { available: item.available, ...(item.metadata ?? {}) }]));
}

function bindingInformation(site: StandardDeviceDiscoveryV1['sites'][number]) {
  return [site.addresses[0] ?? '*', site.port ?? '', site.protocol ?? ''].join(':');
}

function normalizeProtocol(value: string | undefined): 'HTTPS' | 'TLS' | 'STARTTLS' | 'HTTP' | null {
  const normalized = value?.toUpperCase();
  return normalized === 'HTTPS' || normalized === 'TLS' || normalized === 'STARTTLS' || normalized === 'HTTP' ? normalized : null;
}

function normalizeFingerprint(value: string | undefined) {
  return value?.replace(/[^A-Fa-f0-9]/g, '').toUpperCase() || null;
}

function providerKey(pluginVersionId: string) {
  return `PLUGIN:${pluginVersionId}`.slice(0, 64);
}

function stableId(prefix: string, ...parts: string[]) {
  return `${prefix}_${createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 24)}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`;
  return JSON.stringify(value);
}
