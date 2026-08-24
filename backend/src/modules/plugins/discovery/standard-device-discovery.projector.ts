import { createHash } from 'node:crypto';
import type { DatabasePort } from '../../../database/database-port.js';
import { newId } from '../../../shared/id.js';
import type { StandardDeviceDiscoveryV2 } from './device-discovery.dto.js';
import { DeviceDiscoverySchemaService } from './device-discovery-schema.service.js';

export interface StandardDiscoveryProjectionContext {
  tenantId: string;
  hostId: string;
  deviceAssetId?: string;
  pluginVersionId?: string;
  pluginBindingId?: string;
  discoveryProviderKey?: string;
  discoverySource?: 'PROVIDER' | 'AGENT';
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
    const discoveryProviderKey = resolveProviderKey(context);
    const existingSites = await this.db.query<{ site_key: string }>(
      'select site_key from pg_site_assets where tenant_id=$1 and device_id=$2 and discovery_provider_key=$3 and deleted_at is null',
      [context.tenantId, context.hostId, discoveryProviderKey],
    );
    const discoveredKeys = new Set(discovery.sites.map((item) => item.stableKey));
    return {
      serviceInstances: discovery.frameworks.length,
      sites: discovery.sites.length,
      managedTargets: discovery.managedTargets.length,
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
    const projectionRootId = context.deviceAssetId ?? context.hostId;
    const discoveryProviderKey = resolveProviderKey(context);
    try {
      await this.db.transaction(async (tx) => {
        if (context.deviceAssetId) await tx.query(
          `update pg_device_assets set product_family=$1, product_name=$2, software_version=$3,
             plugin_version_id=$4, plugin_binding_id=$5, capability_profile=$6::jsonb, metadata=$7::jsonb,
             last_discovered_at=$8, last_error_code=null, updated_at=$8, version=version+1
           where tenant_id=$9 and service_asset_id=$10`,
          [discovery.device.productFamily, discovery.device.productFamily, discovery.device.softwareVersion ?? null,
            context.pluginVersionId ?? null, context.pluginBindingId ?? null, JSON.stringify(capabilityProfile(discovery)),
            JSON.stringify(discovery.device.metadata ?? {}), discoveredAt, context.tenantId, context.deviceAssetId],
        );
        if (context.deviceAssetId) await tx.query(
          `update pg_service_assets
           set status='ACTIVE', metadata=metadata || $1::jsonb, updated_at=$2, version=version+1
           where tenant_id=$3 and id=$4 and deleted_at is null`,
          [JSON.stringify({ onboardingState: 'ACTIVE', discoveryStatus: 'ACTIVE' }), discoveredAt, context.tenantId, context.deviceAssetId],
        );
        await markStale(tx, context, discoveryProviderKey, discoveredAt);

        const frameworkIds = new Map<string, string>();
        for (const framework of discovery.frameworks) {
          const id = stableId('psi', projectionRootId, framework.stableKey);
          frameworkIds.set(framework.stableKey, id);
          await tx.query(
            `insert into pg_framework_instances (
               id, tenant_id, device_id, discovery_provider_key, service_name, display_name, version_text, ports, framework_key, framework_type,
               manual_overrides, discovery_source, last_discovered_at, status, raw_facts, created_at, updated_at, version
             ) values ($1,$2,$3,$4,$5::text,$6,$7,'[]'::jsonb,$5::text,$10,'{}'::jsonb,$11,$8,'ACTIVE',$9::jsonb,$8,$8,1)
             on conflict (id) do update set display_name=excluded.display_name, version_text=excluded.version_text,
               last_discovered_at=excluded.last_discovered_at, status='ACTIVE', raw_facts=excluded.raw_facts,
               deleted_at=null, updated_at=excluded.updated_at, version=pg_framework_instances.version+1`,
            [id, context.tenantId, context.hostId, discoveryProviderKey, framework.stableKey, framework.displayName,
              framework.version ?? null, discoveredAt, JSON.stringify(framework.metadata ?? {}), framework.frameworkType, context.discoverySource ?? 'PROVIDER'],
          );
        }

        const fallbackServiceId = discovery.frameworks.length === 0
          ? await upsertFallbackFramework(tx, context, discoveryProviderKey, discovery, discoveredAt)
          : undefined;
        const siteIds = new Map<string, string>();
        const siteServiceInstanceIds = new Map<string, string>();
        const targetIds = new Map<string, string>();
        for (const site of discovery.sites) {
          const serviceInstanceId = (site.frameworkStableKey && frameworkIds.get(site.frameworkStableKey)) ?? fallbackServiceId;
          if (!serviceInstanceId) throw new Error(`site framework missing: ${site.stableKey}`);
          const siteId = stableId('psa', projectionRootId, site.stableKey);
          siteIds.set(site.stableKey, siteId);
          siteServiceInstanceIds.set(site.stableKey, serviceInstanceId);
          await tx.query(
             `insert into pg_site_assets (
               id, tenant_id, framework_instance_id, device_id, discovery_provider_key, site_type, site_name, site_key,
               binding_information, host_header, listen_ip, port, protocol, discovery_source, last_discovered_at, status, metadata,
               created_at, updated_at, version
             ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'ACTIVE',$16::jsonb,$15,$15,1)
             on conflict (id) do update set framework_instance_id=excluded.framework_instance_id, site_name=excluded.site_name,
               binding_information=excluded.binding_information, host_header=excluded.host_header, listen_ip=excluded.listen_ip, port=excluded.port,
               protocol=excluded.protocol, last_discovered_at=excluded.last_discovered_at, status='ACTIVE',
               metadata=excluded.metadata, deleted_at=null, updated_at=excluded.updated_at, version=pg_site_assets.version+1`,
             [siteId, context.tenantId, serviceInstanceId, context.hostId, discoveryProviderKey, site.siteType, site.displayName, site.stableKey,
               bindingInformation(site), siteHostHeader(site), siteListenIp(site), site.port ?? null, normalizeProtocol(site.protocol),
               context.discoverySource ?? 'PROVIDER', discoveredAt, JSON.stringify({ ...(site.metadata ?? {}), addresses: site.addresses })],
          );
        }

        for (const target of discovery.managedTargets) {
          const frameworkInstanceId = target.frameworkStableKey ? frameworkIds.get(target.frameworkStableKey) : undefined;
          const siteId = target.siteStableKey ? siteIds.get(target.siteStableKey) : undefined;
          const targetId = stableId('pmt', projectionRootId, target.stableKey);
          targetIds.set(target.stableKey, targetId);
          await tx.query(
            `insert into pg_managed_targets (
               id, tenant_id, device_id, framework_instance_id, site_id, discovery_provider_key,
               target_type, target_key, binding_key, supported_capabilities, execution_locations,
               last_seen_at, status, metadata, created_at, updated_at, version
             ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,'ACTIVE',$13::jsonb,$12,$12,1)
             on conflict (id) do update set framework_instance_id=excluded.framework_instance_id, site_id=excluded.site_id,
               target_type=excluded.target_type, target_key=excluded.target_key, binding_key=excluded.binding_key,
               supported_capabilities=excluded.supported_capabilities, execution_locations=excluded.execution_locations,
               last_seen_at=excluded.last_seen_at, status='ACTIVE', metadata=excluded.metadata, deleted_at=null,
               updated_at=excluded.updated_at, version=pg_managed_targets.version+1`,
            [targetId, context.tenantId, context.hostId, frameworkInstanceId ?? null, siteId ?? null, discoveryProviderKey,
              target.targetType, target.targetKey, target.bindingKey ?? null, JSON.stringify(target.supportedCapabilities),
              JSON.stringify(target.executionLocations), discoveredAt, JSON.stringify(target.metadata ?? {})],
          );
        }

        const certificateIds = new Map<string, string>();
        const certificateFingerprints = new Map<string, string | null>();
        for (const certificate of context.deviceAssetId ? discovery.certificates : []) {
          const certificateId = stableId('pdc', projectionRootId, certificate.stableKey);
          certificateIds.set(certificate.stableKey, certificateId);
          certificateFingerprints.set(certificate.stableKey, normalizeFingerprint(certificate.sha256Fingerprint));
           await tx.query(
             `insert into plugin_discovered_certificates (
               id, tenant_id, device_asset_id, stable_key, fingerprint_sha256, certificate_version_id,
               subject, issuer, not_before, not_after,
                metadata, status, last_discovered_at, created_at, updated_at
             ) values ($1,$2,$3,$4,$5::text,
               (select id from pg_certificate_versions where upper(fingerprint_sha256)=upper($5::text) limit 1),
               $6,$7,$8,$9,$10::jsonb,'ACTIVE',$11,$11,$11)
              on conflict (tenant_id, device_asset_id, stable_key) do update set fingerprint_sha256=excluded.fingerprint_sha256,
               certificate_version_id=excluded.certificate_version_id, subject=excluded.subject,
               issuer=excluded.issuer, not_before=excluded.not_before,
               not_after=excluded.not_after, metadata=excluded.metadata,
               status='ACTIVE', last_discovered_at=excluded.last_discovered_at, updated_at=excluded.updated_at`,
            [certificateId, context.tenantId, context.deviceAssetId, certificate.stableKey,
              normalizeFingerprint(certificate.sha256Fingerprint), certificate.subject ?? null, certificate.issuer ?? null,
              certificate.notBefore ?? null, certificate.notAfter ?? null,
              JSON.stringify(certificate.metadata ?? {}), discoveredAt],
          );
        }
        for (const binding of context.deviceAssetId ? discovery.certificateBindings : []) {
          const target = discovery.managedTargets.find((item) => item.stableKey === binding.managedTargetStableKey)!;
          const site = target.siteStableKey ? discovery.sites.find((item) => item.stableKey === target.siteStableKey) : undefined;
          const siteId = target.siteStableKey ? siteIds.get(target.siteStableKey) : undefined;
          const serviceInstanceId = target.frameworkStableKey
            ? frameworkIds.get(target.frameworkStableKey)
            : target.siteStableKey ? siteServiceInstanceIds.get(target.siteStableKey) : undefined;
          const managedTargetId = targetIds.get(binding.managedTargetStableKey);
          const certificateId = certificateIds.get(binding.certificateStableKey);
          if (!serviceInstanceId || !managedTargetId || !certificateId) throw new Error(`certificate binding relation missing: ${binding.stableKey}`);
          const bindingId = stableId('pcb', projectionRootId, binding.stableKey);
          const formalBindingId = stableId('bnd', projectionRootId, binding.stableKey);
          const fingerprint = certificateFingerprints.get(binding.certificateStableKey) ?? null;
           await tx.query(
             `insert into plugin_discovered_certificate_bindings (
                id, tenant_id, device_asset_id, stable_key, site_asset_id, managed_target_id, discovered_certificate_id,
               binding_name, metadata, current_certificate_version_id, observed_fingerprint_sha256,
               drift_state, status, last_discovered_at, created_at, updated_at
             ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,
               (select id from pg_certificate_versions where upper(fingerprint_sha256)=upper($10::text) limit 1),
               $10::text, case
                 when $10 is null then 'INCOMPLETE'
                 when exists (select 1 from pg_certificate_versions where upper(fingerprint_sha256)=upper($10::text)) then 'SYNCED'
                 else 'UNMANAGED'
               end,'ACTIVE',$11,$11,$11)
              on conflict (tenant_id, device_asset_id, stable_key) do update set site_asset_id=excluded.site_asset_id,
                managed_target_id=excluded.managed_target_id, discovered_certificate_id=excluded.discovered_certificate_id, binding_name=excluded.binding_name,
               metadata=excluded.metadata, current_certificate_version_id=excluded.current_certificate_version_id,
               observed_fingerprint_sha256=excluded.observed_fingerprint_sha256, drift_state=excluded.drift_state,
               status='ACTIVE', last_discovered_at=excluded.last_discovered_at,
                updated_at=excluded.updated_at`,
            [bindingId, context.tenantId, context.deviceAssetId, binding.stableKey, siteId ?? null, managedTargetId, certificateId,
               binding.bindingName ?? null, JSON.stringify({ ...(binding.metadata ?? {}), formalBindingId }), fingerprint, discoveredAt],
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
               (select id from pg_certificate_versions where upper(fingerprint_sha256)=upper($11::text) limit 1),$11::text,$11::text,
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
            [formalBindingId, context.tenantId, serviceInstanceId, siteId ?? null, managedTargetId, context.hostId,
              site?.addresses[0] ?? site?.displayName ?? target.targetKey, site?.port ?? null, normalizeProtocol(site?.protocol), binding.stableKey,
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
        if (context.deviceAssetId) await insertSnapshot(tx, snapshotId, context, discovery, summary, 'SUCCEEDED', undefined, discoveredAt);
      });
      return summary;
    } catch (cause) {
      if (context.deviceAssetId) await insertSnapshot(this.db, snapshotId, context, discovery, summary, 'FAILED', cause instanceof Error ? cause.message : 'DISCOVERY_PROJECTION_FAILED', discoveredAt);
      throw cause;
    }
  }
}

async function markStale(db: DatabasePort, context: StandardDiscoveryProjectionContext, discoveryProviderKey: string, discoveredAt: string) {
  await db.query("update pg_framework_instances set status='STALE', updated_at=$1, version=version+1 where tenant_id=$2 and device_id=$3 and discovery_provider_key=$4 and deleted_at is null", [discoveredAt, context.tenantId, context.hostId, discoveryProviderKey]);
  await db.query("update pg_site_assets set status='STALE', updated_at=$1, version=version+1 where tenant_id=$2 and device_id=$3 and discovery_provider_key=$4 and deleted_at is null", [discoveredAt, context.tenantId, context.hostId, discoveryProviderKey]);
  await db.query("update pg_managed_targets set status='STALE', updated_at=$1, version=version+1 where tenant_id=$2 and device_id=$3 and discovery_provider_key=$4 and deleted_at is null", [discoveredAt, context.tenantId, context.hostId, discoveryProviderKey]);
  if (context.deviceAssetId) {
    await db.query("update plugin_discovered_certificates set status='STALE', updated_at=$1 where tenant_id=$2 and device_asset_id=$3", [discoveredAt, context.tenantId, context.deviceAssetId]);
    await db.query("update plugin_discovered_certificate_bindings set status='STALE', updated_at=$1 where tenant_id=$2 and device_asset_id=$3", [discoveredAt, context.tenantId, context.deviceAssetId]);
    await db.query(
      `update pg_certificate_bindings
       set metadata=jsonb_set(metadata, '{discoveryStatus}', '"STALE"'::jsonb, true), updated_at=$1, version=version+1
       where tenant_id=$2 and metadata->>'pluginDeviceAssetId'=$3 and deleted_at is null`,
      [discoveredAt, context.tenantId, context.deviceAssetId],
    );
  }
}

async function upsertFallbackFramework(db: DatabasePort, context: StandardDiscoveryProjectionContext, discoveryProviderKey: string, discovery: StandardDeviceDiscoveryV2, now: string) {
  const id = stableId('psi', context.deviceAssetId ?? context.hostId, 'device');
  await db.query(
    `insert into pg_framework_instances (id, tenant_id, device_id, discovery_provider_key, service_name, display_name, ports, framework_key,
       framework_type, manual_overrides, discovery_source, last_discovered_at, status, raw_facts, created_at, updated_at, version)
     values ($1,$2,$3,$4,'device',$5,'[]'::jsonb,'device','device.generic','{}'::jsonb,$7,$6,'ACTIVE','{}'::jsonb,$6,$6,1)
     on conflict (id) do update set display_name=excluded.display_name, last_discovered_at=excluded.last_discovered_at,
       status='ACTIVE', deleted_at=null, updated_at=excluded.updated_at, version=pg_framework_instances.version+1`,
    [id, context.tenantId, context.hostId, discoveryProviderKey, discovery.device.displayName, now, context.discoverySource ?? 'PROVIDER'],
  );
  return id;
}

async function insertSnapshot(
  db: DatabasePort,
  id: string,
  context: StandardDiscoveryProjectionContext,
  discovery: StandardDeviceDiscoveryV2,
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
    [id, context.tenantId, context.deviceAssetId, context.pluginVersionId ?? null, context.pluginBindingId ?? null,
      createHash('sha256').update(payload).digest('hex'), status, JSON.stringify(summary), payload, errorCode ?? null, now],
  );
}

function capabilityProfile(discovery: StandardDeviceDiscoveryV2) {
  return Object.fromEntries(discovery.capabilities.map((item) => [item.key, { available: item.available, ...(item.metadata ?? {}) }]));
}

function bindingInformation(site: StandardDeviceDiscoveryV2['sites'][number]) {
  const metadataBindingInformation = site.metadata?.bindingInformation;
  if (typeof metadataBindingInformation === 'string' && metadataBindingInformation.trim()) return metadataBindingInformation.trim();
  return [site.addresses[0] ?? '*', site.port ?? '', site.protocol ?? ''].join(':');
}

function siteHostHeader(site: StandardDeviceDiscoveryV2['sites'][number]): string | null {
  const metadataHostHeader = site.metadata?.hostHeader;
  if (typeof metadataHostHeader === 'string' && metadataHostHeader.trim()) return metadataHostHeader.trim();
  const address = site.addresses[0]?.trim();
  return address && !['*', '0.0.0.0', '::'].includes(address) ? address : null;
}

function siteListenIp(site: StandardDeviceDiscoveryV2['sites'][number]): string | null {
  const listeners = site.metadata?.listeners;
  if (Array.isArray(listeners)) {
    const address = listeners
      .map((listener) => listener && typeof listener === 'object' && !Array.isArray(listener) ? (listener as Record<string, unknown>).address : undefined)
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
    if (address) return address.trim();
  }
  return site.addresses.find((address) => address === '*' || address === '::' || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) ?? null;
}

function normalizeProtocol(value: string | undefined): 'HTTPS' | 'TLS' | 'STARTTLS' | 'HTTP' | null {
  const normalized = value?.toUpperCase();
  return normalized === 'HTTPS' || normalized === 'TLS' || normalized === 'STARTTLS' || normalized === 'HTTP' ? normalized : null;
}

function normalizeFingerprint(value: string | undefined) {
  return value?.replace(/[^A-Fa-f0-9]/g, '').toUpperCase() || null;
}

function providerKey(pluginVersionId: string) {
  return `plugin-version:${pluginVersionId}`.slice(0, 192);
}

function resolveProviderKey(context: StandardDiscoveryProjectionContext): string {
  return context.discoveryProviderKey ?? (context.pluginVersionId ? providerKey(context.pluginVersionId) : `host:${context.hostId}`);
}

function stableId(prefix: string, ...parts: string[]) {
  return `${prefix}_${createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 24)}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`;
  return JSON.stringify(value);
}
