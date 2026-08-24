import { createHash } from 'node:crypto';
import type { DatabasePort } from '../../../database/database-port.js';
import type { CloudAccountAsset, ProviderOperationResult } from '../dto/providers.dto.js';
import { ProviderCatalogApplicationService } from './provider-catalog.application-service.js';

export class CloudProviderDiscoveryApplicationService {
  constructor(
    private readonly db: DatabasePort,
    private readonly catalog: ProviderCatalogApplicationService,
  ) {}

  async discoverAndProject(
    tenantId: string,
    asset: CloudAccountAsset,
    frameworkTypes?: string[],
    requestId?: string,
  ): Promise<ProviderOperationResult> {
    const frameworkType = frameworkTypes?.[0] ?? `${asset.providerKey}.cdn`;
    const result = await this.catalog.execute({
      tenantId,
      asset,
      frameworkType,
      operationKey: 'certificate.discover',
      target: { frameworkType, resourceId: asset.id },
      requestId,
      input: { frameworkTypes },
    });
    const discovery = result.resultSummary;
    if (!discovery || typeof discovery !== 'object' || Array.isArray(discovery)) return { ...result };
    const summary = await this.project(tenantId, asset, discovery as Record<string, unknown>);
    return { ...result, resultSummary: { ...discovery, projection: summary } };
  }

  private async project(tenantId: string, asset: CloudAccountAsset, discovery: Record<string, unknown>) {
    const now = new Date().toISOString();
    const frameworks = arrayOfRecords(discovery.frameworks);
    const sites = arrayOfRecords(discovery.sites);
    const targets = arrayOfRecords(discovery.managedTargets);
    const frameworkIds = new Map<string, string>();
    const siteIds = new Map<string, string>();
    const targetIds = new Map<string, string>();
    await this.db.transaction(async (tx) => {
      for (const framework of frameworks) {
        const stableKey = stringValue(framework.stableKey) ?? 'cdn';
        const id = stableId('frm', asset.id, stableKey);
        frameworkIds.set(stableKey, id);
        await tx.query(
          `insert into pg_framework_instances
           (id, tenant_id, device_id, asset_id, framework_type, framework_key, discovery_provider_key,
            display_name, version_text, discovery_source, last_discovered_at, status, raw_facts, created_at, updated_at, version)
           values ($1,$2,null,$3,$4,$5,$6,$7,$8,'PROVIDER',$9,'ACTIVE',$10::jsonb,$9,$9,1)
           on conflict (id) do update set asset_id=excluded.asset_id, framework_type=excluded.framework_type,
             framework_key=excluded.framework_key, display_name=excluded.display_name, raw_facts=excluded.raw_facts,
             last_discovered_at=excluded.last_discovered_at, status='ACTIVE', deleted_at=null,
             updated_at=excluded.updated_at, version=pg_framework_instances.version+1`,
          [id, tenantId, asset.id, stringValue(framework.frameworkType) ?? `${asset.providerKey}.cdn`, stableKey,
            asset.providerKey, stringValue(framework.displayName) ?? stableKey, stringValue(framework.version),
            now, JSON.stringify(recordValue(framework.metadata))],
        );
      }
      for (const site of sites) {
        const stableKey = stringValue(site.stableKey) ?? stringValue(site.siteKey) ?? 'site';
        const frameworkId = frameworkIds.get(stringValue(site.frameworkStableKey) ?? '') ?? [...frameworkIds.values()][0];
        if (!frameworkId) continue;
        const id = stableId('sit', asset.id, stableKey);
        siteIds.set(stableKey, id);
        const addresses = Array.isArray(site.addresses) ? site.addresses.filter((item): item is string => typeof item === 'string') : [];
        await tx.query(
          `insert into pg_site_assets
           (id, tenant_id, framework_instance_id, device_id, asset_id, discovery_provider_key, site_type, site_name, site_key,
            binding_information, host_header, listen_ip, port, protocol, discovery_source, last_discovered_at, status, metadata,
            created_at, updated_at, version)
           values ($1,$2,$3,null,$4,$5,$6,$7,$8,$9,$10,null,$11,$12,'PROVIDER',$13,'ACTIVE',$14::jsonb,$13,$13,1)
           on conflict (id) do update set asset_id=excluded.asset_id, framework_instance_id=excluded.framework_instance_id,
             site_name=excluded.site_name, binding_information=excluded.binding_information, host_header=excluded.host_header,
             port=excluded.port, protocol=excluded.protocol, metadata=excluded.metadata, status='ACTIVE',
             deleted_at=null, updated_at=excluded.updated_at, version=pg_site_assets.version+1`,
          [id, tenantId, frameworkId, asset.id, asset.providerKey, stringValue(site.siteType) ?? 'cloud.cdn.domain',
            stringValue(site.displayName) ?? stableKey, stableKey, addresses.join(','), addresses[0] ?? null,
            numberValue(site.port), stringValue(site.protocol)?.toUpperCase() ?? 'HTTPS', now, JSON.stringify(recordValue(site.metadata))],
        );
      }
      for (const target of targets) {
        const stableKey = stringValue(target.stableKey) ?? stringValue(target.targetKey) ?? 'target';
        const id = stableId('mtg', asset.id, stableKey);
        targetIds.set(stableKey, id);
        const frameworkId = frameworkIds.get(stringValue(target.frameworkStableKey) ?? '') ?? null;
        const siteId = siteIds.get(stringValue(target.siteStableKey) ?? '') ?? null;
        await tx.query(
          `insert into pg_managed_targets
           (id, tenant_id, device_id, asset_id, framework_instance_id, site_id, discovery_provider_key,
            target_type, target_key, binding_key, supported_capabilities, execution_locations, last_seen_at, status,
            metadata, created_at, updated_at, version)
           values ($1,$2,null,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,'ACTIVE',$13::jsonb,$12,$12,1)
           on conflict (id) do update set asset_id=excluded.asset_id, framework_instance_id=excluded.framework_instance_id,
             site_id=excluded.site_id, target_type=excluded.target_type, target_key=excluded.target_key,
             supported_capabilities=excluded.supported_capabilities, execution_locations=excluded.execution_locations,
             last_seen_at=excluded.last_seen_at, status='ACTIVE', metadata=excluded.metadata,
             deleted_at=null, updated_at=excluded.updated_at, version=pg_managed_targets.version+1`,
          [id, tenantId, asset.id, frameworkId, siteId, asset.providerKey,
            stringValue(target.targetType) ?? 'cloud.cdn.domain', stringValue(target.targetKey) ?? stableKey,
            stringValue(target.bindingKey) ?? null, JSON.stringify(stringArray(target.supportedCapabilities)),
            JSON.stringify(stringArray(target.executionLocations)), now, JSON.stringify(recordValue(target.metadata))],
        );
      }
    });
    return {
      assetId: asset.id,
      frameworks: frameworkIds.size,
      sites: siteIds.size,
      managedTargets: targetIds.size,
    };
  }
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : [];
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 24)}`;
}
