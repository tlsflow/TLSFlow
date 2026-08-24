import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
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
  /** Web 事实本次为空时保留上一次投影，避免瞬时空上报造成资产消失。 */
  preserveEmptyWeb?: boolean;
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
    return this.previewValidated(this.db, context, discovery);
  }

  private async previewValidated(db: DatabasePort, context: StandardDiscoveryProjectionContext, discovery: StandardDeviceDiscoveryV2): Promise<StandardDiscoveryProjectionSummary> {
    const discoveryProviderKey = resolveProviderKey(context);
    const existingSites = await db.query<{ site_key: string }>(
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
      stale: context.preserveEmptyWeb ? 0 : existingSites.rows.filter((row) => !discoveredKeys.has(row.site_key)).length,
      conflicts: 0,
    };
  }

  async project(context: StandardDiscoveryProjectionContext, rawDiscovery: unknown): Promise<StandardDiscoveryProjectionSummary> {
    const discoveredAt = new Date().toISOString();
    const snapshotId = newId('pds');
    const discoveryProviderKey = resolveProviderKey(context);
    let discovery: StandardDeviceDiscoveryV2;
    try {
      discovery = this.schema.validate(rawDiscovery);
    } catch (cause) {
      await this.recordFailureDiagnostic(context, snapshotId, rawDiscovery, cause, discoveredAt);
      throw cause;
    }
    const normalizedPayload = stableJson(discovery);
    const normalizedSha256 = sha256(normalizedPayload);
    const projectionRootId = context.deviceAssetId ?? context.hostId;
    let summary = emptySummary();
    try {
      return await this.db.transaction(async (tx) => {
        await lockProjectionRoot(tx, context);
        const latestSucceeded = await findLatestSucceededSnapshot(tx, context, discoveryProviderKey);
        if (latestSucceeded?.normalized_sha256 === normalizedSha256) return latestSucceeded.summary;
        summary = await this.previewValidated(tx, context, discovery);
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
        if (!context.preserveEmptyWeb) await markStale(tx, context, discoveryProviderKey, discoveredAt);

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

        // 空 Web 快照表示本轮没有拿到可解析事实，不是设备上只剩一个通用框架。
        // 保留历史资产时绝不能重新激活 device.generic，否则设备名会变成伪框架标签。
        const fallbackServiceId = discovery.frameworks.length === 0 && !context.preserveEmptyWeb
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
               binding_information, host_header, listen_ip, port, protocol, config_path, discovery_source, last_discovered_at, status, metadata,
               created_at, updated_at, version
             ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'ACTIVE',$17::jsonb,$16,$16,1)
             on conflict (id) do update set framework_instance_id=excluded.framework_instance_id, site_name=excluded.site_name,
               binding_information=excluded.binding_information, host_header=excluded.host_header, listen_ip=excluded.listen_ip, port=excluded.port,
               protocol=excluded.protocol, config_path=excluded.config_path, last_discovered_at=excluded.last_discovered_at, status='ACTIVE',
               metadata=excluded.metadata, deleted_at=null, updated_at=excluded.updated_at, version=pg_site_assets.version+1`,
             [siteId, context.tenantId, serviceInstanceId, context.hostId, discoveryProviderKey, site.siteType, site.displayName, site.stableKey,
               bindingInformation(site), siteHostHeader(site), siteListenIp(site), site.port ?? null, normalizeProtocol(site.protocol), siteConfigPath(site),
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
        for (const certificate of discovery.certificates) {
          const certificateId = stableId('pdc', projectionRootId, certificate.stableKey);
          certificateIds.set(certificate.stableKey, certificateId);
          certificateFingerprints.set(certificate.stableKey, normalizeFingerprint(certificate.sha256Fingerprint));
          if (!context.deviceAssetId) continue;
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
        for (const binding of discovery.certificateBindings) {
          const target = discovery.managedTargets.find((item) => item.stableKey === binding.managedTargetStableKey)!;
          const configuredCertificateKey = binding.configuredCertificateStableKey ?? binding.certificateStableKey;
          const observedCertificateKey = binding.observedCertificateStableKey;
          const certificate = discovery.certificates.find((item) => item.stableKey === configuredCertificateKey)!;
          const observedCertificate = observedCertificateKey
            ? discovery.certificates.find((item) => item.stableKey === observedCertificateKey)
            : undefined;
          const site = target.siteStableKey ? discovery.sites.find((item) => item.stableKey === target.siteStableKey) : undefined;
          const siteId = target.siteStableKey ? siteIds.get(target.siteStableKey) : undefined;
          const serviceInstanceId = target.frameworkStableKey
            ? frameworkIds.get(target.frameworkStableKey)
            : target.siteStableKey ? siteServiceInstanceIds.get(target.siteStableKey) : undefined;
          const managedTargetId = targetIds.get(binding.managedTargetStableKey);
          const certificateId = certificateIds.get(configuredCertificateKey);
          if (!serviceInstanceId || !managedTargetId || !certificateId) throw new Error(`certificate binding relation missing: ${binding.stableKey}`);
          const bindingId = stableId('pcb', projectionRootId, binding.stableKey);
          const formalBindingId = stableId('bnd', projectionRootId, binding.stableKey);
          const configuredFingerprint = certificateFingerprints.get(configuredCertificateKey) ?? null;
          const observedFingerprint = observedCertificate
            ? certificateFingerprints.get(observedCertificate.stableKey) ?? normalizeFingerprint(observedCertificate.sha256Fingerprint)
            : null;
          const deploymentTarget = binding.deploymentTarget;
          // 设备插件没有文件/证书库位置时仍是设备 API 绑定；只有无设备资产的通用来源才是 CUSTOM。
          const bindingType = deploymentTarget
            ? deploymentBindingType(deploymentTarget.storageKind)
            : context.deviceAssetId ? 'DEVICE_API' : 'CUSTOM';
          const driftStatus = configuredFingerprint && observedFingerprint
            ? configuredFingerprint.toUpperCase() === observedFingerprint.toUpperCase() ? 'SYNCED' : 'DRIFTED'
            : 'UNKNOWN';
          const deploymentMetadata = deploymentTarget ? {
            certificateLocation: deploymentTarget,
            deploymentTarget,
          } : {};
          const bindingMetadata = {
            ...(binding.metadata ?? {}),
            ...deploymentMetadata,
            configuredCertificateStableKey: configuredCertificateKey,
            ...(observedCertificateKey ? { observedCertificateStableKey: observedCertificateKey } : {}),
            configuredCertificate: certificateMetadataForProjection(certificate),
            ...(observedCertificate ? { observedCertificate: certificateMetadataForProjection(observedCertificate) } : {}),
            driftStatus,
            formalBindingId,
            pluginDiscoveryStableKey: binding.stableKey,
            pluginCertificateStableKey: configuredCertificateKey,
            pluginDeviceAssetId: context.deviceAssetId,
            pluginVersionId: context.pluginVersionId,
            pluginBindingId: context.pluginBindingId,
            projectionDeviceId: context.hostId,
            discoveryProviderKey,
            discoverySource: context.discoverySource ?? 'PROVIDER',
            discoveryStatus: 'ACTIVE',
          };
          if (context.deviceAssetId) await tx.query(
             `insert into plugin_discovered_certificate_bindings (
                id, tenant_id, device_asset_id, stable_key, site_asset_id, managed_target_id, discovered_certificate_id,
               binding_name, metadata, current_certificate_version_id, observed_fingerprint_sha256,
               drift_state, status, last_discovered_at, created_at, updated_at
             ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,
               (select id from pg_certificate_versions where upper(fingerprint_sha256)=upper($10::text) limit 1),
               $11::text, case
                 when $10 is null or $11 is null then 'UNKNOWN'
                 when upper($10::text)=upper($11::text) then 'SYNCED'
                 else 'DRIFTED'
               end,'ACTIVE',$12,$12,$12)
              on conflict (tenant_id, device_asset_id, stable_key) do update set site_asset_id=excluded.site_asset_id,
                managed_target_id=excluded.managed_target_id, discovered_certificate_id=excluded.discovered_certificate_id, binding_name=excluded.binding_name,
               metadata=excluded.metadata, current_certificate_version_id=excluded.current_certificate_version_id,
               observed_fingerprint_sha256=excluded.observed_fingerprint_sha256, drift_state=excluded.drift_state,
               status='ACTIVE', last_discovered_at=excluded.last_discovered_at,
                updated_at=excluded.updated_at`,
            [bindingId, context.tenantId, context.deviceAssetId, binding.stableKey, siteId ?? null, managedTargetId, certificateId,
               binding.bindingName ?? null, JSON.stringify(bindingMetadata), configuredFingerprint, observedFingerprint, discoveredAt],
          );
          const domain = bindingDomain(site, target, binding);
          await tx.query(
            `insert into pg_certificate_bindings (
               id, tenant_id, service_instance_id, site_asset_id, managed_target_id, host_id,
               domain_name, domain, port, protocol, binding_key, binding_type,
               certificate_version_id, target_certificate_version_id, local_certificate_version_id,
               observed_fingerprint_sha256, desired_fingerprint_sha256, target_fingerprint_sha256,
               cert_path, key_path, chain_path, keystore_path, keystore_type,
               store_location, store_name, store_thumbprint, local_config_path, remote_endpoint_fingerprint,
               discovery_source, verify_method, remote_status, checked_at, drift_status, status, metadata,
               created_at, updated_at, version
             ) values (
               $1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11,
               (select id from pg_certificate_versions where upper(fingerprint_sha256)=upper($12::text) limit 1),
               null,
               (select id from pg_certificate_versions where upper(fingerprint_sha256)=upper($12::text) limit 1),
               $13,null,null,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
               $24,$25,$26,$27,$28,$29,$30::jsonb,$27,$27,1
             )
             on conflict (id) do update set service_instance_id=excluded.service_instance_id,
               site_asset_id=excluded.site_asset_id, managed_target_id=excluded.managed_target_id,
               domain_name=excluded.domain_name, domain=excluded.domain, port=excluded.port, protocol=excluded.protocol,
               binding_key=excluded.binding_key, binding_type=excluded.binding_type,
               certificate_version_id=excluded.certificate_version_id,
               local_certificate_version_id=excluded.local_certificate_version_id,
               observed_fingerprint_sha256=excluded.observed_fingerprint_sha256,
               cert_path=excluded.cert_path, key_path=excluded.key_path, chain_path=excluded.chain_path,
               keystore_path=excluded.keystore_path, keystore_type=excluded.keystore_type,
               store_location=excluded.store_location, store_name=excluded.store_name, store_thumbprint=excluded.store_thumbprint,
               local_config_path=excluded.local_config_path,
               remote_endpoint_fingerprint=excluded.remote_endpoint_fingerprint, remote_status=excluded.remote_status,
               checked_at=excluded.checked_at, drift_status=excluded.drift_status,
               status=case when pg_certificate_bindings.status='MANAGED' then 'MANAGED' else 'DISCOVERED' end,
               metadata=pg_certificate_bindings.metadata || excluded.metadata,
               deleted_at=null, updated_at=excluded.updated_at, version=pg_certificate_bindings.version+1`,
            [formalBindingId, context.tenantId, serviceInstanceId, siteId ?? null, managedTargetId, context.hostId,
              domain, bindingPort(binding, site), bindingProtocol(binding, site), binding.stableKey,
              bindingType, configuredFingerprint, observedFingerprint,
              deploymentTarget?.certificatePath ?? null, deploymentTarget?.privateKeyPath ?? null,
              deploymentTarget?.chainPath ?? null, deploymentTarget?.keystorePath ?? null,
              deploymentTarget?.keystoreType ?? null, deploymentTarget?.storeLocation ?? null,
              deploymentTarget?.storeName ?? null, deploymentTarget?.storeThumbprint ?? null,
              deploymentTarget?.sourceConfigPath ?? null, observedFingerprint,
              context.discoverySource ?? 'AGENT', 'AGENT_CONFIG', observedCertificate ? 'reachable' : 'unknown', discoveredAt,
              driftStatus, 'DISCOVERED', JSON.stringify(bindingMetadata)],
          );
        }
        await insertSnapshot(tx, snapshotId, context, discoveryProviderKey, normalizedSha256, normalizedPayload, summary, 'SUCCEEDED', undefined, discoveredAt);
        return summary;
      });
    } catch (cause) {
      await this.recordFailureDiagnostic(context, snapshotId, discovery, cause, discoveredAt, summary);
      throw cause;
    }
  }

  private async recordFailureDiagnostic(
    context: StandardDiscoveryProjectionContext,
    snapshotId: string,
    rawDiscovery: unknown,
    cause: unknown,
    discoveredAt: string,
    summary: StandardDiscoveryProjectionSummary = emptySummary(),
  ): Promise<void> {
    try {
      const discoveryProviderKey = resolveProviderKey(context);
      const normalizedSha256 = sha256(stableJson(rawDiscovery));
      await insertSnapshot(
        this.db,
        snapshotId,
        context,
        discoveryProviderKey,
        normalizedSha256,
        null,
        summary,
        'FAILED',
        discoveryErrorCode(cause),
        discoveredAt,
      );
    } catch {
      // 诊断写入不能掩盖原始 Schema 或投影错误。
    }
  }
}

async function lockProjectionRoot(db: DatabasePort, context: StandardDiscoveryProjectionContext): Promise<void> {
  await db.query(
    'select id from pg_hosts where tenant_id=$1 and id=$2 for update',
    [context.tenantId, context.hostId],
  );
}

async function markStale(db: DatabasePort, context: StandardDiscoveryProjectionContext, discoveryProviderKey: string, discoveredAt: string) {
  await db.query("update pg_framework_instances set status='STALE', updated_at=$1, version=version+1 where tenant_id=$2 and device_id=$3 and discovery_provider_key=$4 and deleted_at is null", [discoveredAt, context.tenantId, context.hostId, discoveryProviderKey]);
  await db.query("update pg_site_assets set status='STALE', updated_at=$1, version=version+1 where tenant_id=$2 and device_id=$3 and discovery_provider_key=$4 and deleted_at is null", [discoveredAt, context.tenantId, context.hostId, discoveryProviderKey]);
  await db.query("update pg_managed_targets set status='STALE', updated_at=$1, version=version+1 where tenant_id=$2 and device_id=$3 and discovery_provider_key=$4 and deleted_at is null", [discoveredAt, context.tenantId, context.hostId, discoveryProviderKey]);
  await db.query(
    `update pg_certificate_bindings
     set metadata=jsonb_set(metadata, '{discoveryStatus}', '"STALE"'::jsonb, true),
         deleted_at=case when status='MANAGED' then deleted_at else $1::timestamptz end,
         updated_at=$1, version=version+1
     where tenant_id=$2 and host_id=$3 and metadata->>'discoveryProviderKey'=$4 and deleted_at is null`,
    [discoveredAt, context.tenantId, context.hostId, discoveryProviderKey],
  );
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

async function upsertFallbackFramework(
  db: DatabasePort,
  context: StandardDiscoveryProjectionContext,
  discoveryProviderKey: string,
  discovery: StandardDeviceDiscoveryV2,
  now: string,
): Promise<string> {
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
  discoveryProviderKey: string,
  normalizedSha256: string,
  payload: string | null,
  summary: StandardDiscoveryProjectionSummary,
  status: 'SUCCEEDED' | 'FAILED',
  errorCode: string | undefined,
  now: string,
) {
  await db.query(
    `insert into plugin_discovery_snapshots (
       id, tenant_id, device_id, device_asset_id, plugin_version_id, plugin_binding_id,
       discovery_provider_key, discovery_source, normalized_sha256, status, summary, payload, error_code, created_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14)`,
    [id, context.tenantId, context.hostId, context.deviceAssetId ?? null, context.pluginVersionId ?? null,
      context.pluginBindingId ?? null, discoveryProviderKey, context.discoverySource ?? 'PROVIDER', normalizedSha256,
      status, JSON.stringify(summary), payload, errorCode ?? null, now],
  );
}

async function findLatestSucceededSnapshot(
  db: DatabasePort,
  context: StandardDiscoveryProjectionContext,
  discoveryProviderKey: string,
): Promise<{ normalized_sha256: string; summary: StandardDiscoveryProjectionSummary } | undefined> {
  const result = await db.query<{ normalized_sha256: string; summary: StandardDiscoveryProjectionSummary }>(
    `select normalized_sha256, summary
     from plugin_discovery_snapshots
     where tenant_id=$1 and device_id=$2 and discovery_provider_key=$3
       and status='SUCCEEDED'
     order by created_at desc
     limit 1`,
    [context.tenantId, context.hostId, discoveryProviderKey],
  );
  return result.rows[0];
}

function emptySummary(): StandardDiscoveryProjectionSummary {
  return { serviceInstances: 0, sites: 0, managedTargets: 0, certificates: 0, certificateBindings: 0, stale: 0, conflicts: 0 };
}

function discoveryErrorCode(cause: unknown): string {
  if (cause instanceof AppError) {
    const detailCode = isRecord(cause.details) ? cause.details.code : undefined;
    return typeof detailCode === 'string' ? detailCode : cause.errorCode;
  }
  return 'DISCOVERY_PROJECTION_FAILED';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
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

function siteConfigPath(site: StandardDeviceDiscoveryV2['sites'][number]): string | null {
  const listeners = site.metadata?.listeners;
  if (!Array.isArray(listeners)) return null;
  const path = listeners
    .map((listener) => listener && typeof listener === 'object' && !Array.isArray(listener) ? (listener as Record<string, unknown>).sourceConfigPath : undefined)
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return path?.trim() ?? null;
}

function normalizeProtocol(value: string | undefined): 'HTTPS' | 'TLS' | 'STARTTLS' | 'HTTP' | null {
  const normalized = value?.toUpperCase();
  return normalized === 'HTTPS' || normalized === 'TLS' || normalized === 'STARTTLS' || normalized === 'HTTP' ? normalized : null;
}

function bindingDomain(
  site: StandardDeviceDiscoveryV2['sites'][number] | undefined,
  target: StandardDeviceDiscoveryV2['managedTargets'][number],
  binding?: StandardDeviceDiscoveryV2['certificateBindings'][number],
): string {
  const listenerHost = typeof binding?.metadata?.listenerHost === 'string' ? binding.metadata.listenerHost.trim() : '';
  const hostHeader = site ? siteHostHeader(site) : null;
  return (listenerHost || hostHeader || site?.displayName || target.targetKey).trim().toLowerCase();
}

function bindingPort(binding: StandardDeviceDiscoveryV2['certificateBindings'][number], site: StandardDeviceDiscoveryV2['sites'][number] | undefined): number | null {
  const value = binding.metadata?.listenerPort;
  return typeof value === 'number' && Number.isInteger(value) ? value : site?.port ?? null;
}

function bindingProtocol(binding: StandardDeviceDiscoveryV2['certificateBindings'][number], site: StandardDeviceDiscoveryV2['sites'][number] | undefined): 'HTTPS' | 'TLS' | 'STARTTLS' | 'HTTP' | null {
  const value = binding.metadata?.listenerProtocol;
  return normalizeProtocol(typeof value === 'string' ? value : site?.protocol);
}

function deploymentBindingType(storageKind: NonNullable<StandardDeviceDiscoveryV2['certificateBindings'][number]['deploymentTarget']>['storageKind']): 'FILE_PATH' | 'KEYSTORE' | 'WINDOWS_CERT_STORE' {
  if (storageKind === 'KEYSTORE') return 'KEYSTORE';
  if (storageKind === 'WINDOWS_CERTIFICATE_STORE') return 'WINDOWS_CERT_STORE';
  return 'FILE_PATH';
}

function certificateMetadataForProjection(certificate: StandardDeviceDiscoveryV2['certificates'][number]): Record<string, unknown> {
  return {
    ...(certificate.metadata ?? {}),
    ...(certificate.sha256Fingerprint ? { fingerprintSha256: certificate.sha256Fingerprint } : {}),
    ...(certificate.subject ? { subject: certificate.subject } : {}),
    ...(certificate.issuer ? { issuer: certificate.issuer } : {}),
    ...(certificate.notBefore ? { notBefore: certificate.notBefore } : {}),
    ...(certificate.notAfter ? { notAfter: certificate.notAfter } : {}),
  };
}

function normalizeFingerprint(value: string | undefined) {
  return value?.replace(/[^A-Fa-f0-9]/g, '').toUpperCase() || null;
}

function pluginDiscoveryKey(pluginVersionId: string) {
  return `plugin-version:${pluginVersionId}`.slice(0, 192);
}

function resolveProviderKey(context: StandardDiscoveryProjectionContext): string {
  const discoveryProviderKey = context.discoveryProviderKey
    ?? (context.pluginVersionId ? pluginDiscoveryKey(context.pluginVersionId) : undefined);
  if (!discoveryProviderKey) {
    throw new AppError('VALIDATION_FAILED', '标准发现投影缺少插件版本或显式来源标识', {
      hostId: context.hostId,
    });
  }
  return discoveryProviderKey;
}

function stableId(prefix: string, ...parts: string[]) {
  return `${prefix}_${createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 24)}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => item === undefined ? 'null' : stableJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined && typeof child !== 'function' && typeof child !== 'symbol')
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
