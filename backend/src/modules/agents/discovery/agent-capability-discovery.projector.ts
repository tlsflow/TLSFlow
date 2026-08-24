import { AppError } from '../../../common/errors/app-error.js';
import { createHash, X509Certificate } from 'node:crypto';
import type { DatabasePort } from '../../../database/database-port.js';
import type { StandardDeviceDiscoveryV2 } from '../../plugins/discovery/device-discovery.dto.js';
import { StandardDeviceDiscoveryProjector, type StandardDiscoveryProjectionSummary } from '../../plugins/discovery/standard-device-discovery.projector.js';
import type { AgentCapabilitySnapshot, AgentRegistration } from '../schema/agents.schema.js';
import { discoverWebConfigs } from '../../plugins/discovery/web-config-discovery.js';

interface AgentHostAnchor extends Record<string, unknown> {
  id: string;
  hostname: string | null;
  display_name: string | null;
  primary_ip: string | null;
}

/**
 * 将 Agent 的原始能力快照投影为通用 Host 事实。
 *
 * Agent Core 不拥有第三方产品知识。产品识别、配置解析、证书位置和部署语义
 * 必须由控制面插件生成标准发现结果后再交给宿主投影；这里不能读取插件映射，
 * 也不能根据 capabilityKey 推断产品类型。
 */
export class AgentCapabilityDiscoveryProjector {
  constructor(
    private readonly db: DatabasePort,
    private readonly projector: StandardDeviceDiscoveryProjector,
    // 保留装配位，避免在生产 Runner 接线完成前把插件服务重新注入 Agent Core。
    _plugins?: unknown,
  ) {}

  async project(agent: AgentRegistration, snapshot: AgentCapabilitySnapshot): Promise<StandardDiscoveryProjectionSummary> {
    const host = await this.resolveHost(snapshot.tenantId, agent.id);
    const discovery = this.buildDiscovery(agent, snapshot, host);
    const summary = await this.projector.project({
      tenantId: snapshot.tenantId,
      hostId: host.id,
      discoveryProviderKey: `agent:${agent.id}`,
      discoverySource: 'AGENT',
    }, discovery);
    if (snapshot.capabilities.some((capability) => capability.capabilityKey === 'web.inventory')) {
      await this.markLegacyWebPluginDiscoveryStale(snapshot.tenantId, host.id);
    }
    return summary;
  }

  /**
   * 旧 Plugin Runner 的 Web 发现与 Agent Core 的 web.inventory 不属于同一事实源。
   * 一旦后者投影成功，旧来源只能保留审计历史，不能继续作为活动资产参与展示或下发。
   */
  private async markLegacyWebPluginDiscoveryStale(tenantId: string, hostId: string): Promise<void> {
    const now = new Date().toISOString();
    const webFrameworkTypes = ['web.nginx', 'web.apache', 'app.tomcat', 'web.iis'];
    await this.db.query(
      `update pg_framework_instances
       set status='STALE', updated_at=$1, version=version+1
       where tenant_id=$2 and device_id=$3 and discovery_source='AGENT'
         and discovery_provider_key like 'plugin:%'
         and framework_type = any($4::text[]) and deleted_at is null`,
      [now, tenantId, hostId, webFrameworkTypes],
    );
    await this.db.query(
      `update pg_site_assets
       set status='STALE', updated_at=$1, version=version+1
       where tenant_id=$2 and device_id=$3 and discovery_source='AGENT'
         and discovery_provider_key like 'plugin:%' and deleted_at is null
         and framework_instance_id in (
           select id from pg_framework_instances
           where tenant_id=$2 and device_id=$3 and discovery_source='AGENT'
             and discovery_provider_key like 'plugin:%' and framework_type = any($4::text[]) and deleted_at is null
         )`,
      [now, tenantId, hostId, webFrameworkTypes],
    );
    await this.db.query(
      `update pg_managed_targets
       set status='STALE', updated_at=$1, version=version+1
       where tenant_id=$2 and device_id=$3 and discovery_provider_key like 'plugin:%' and deleted_at is null
         and (
           framework_instance_id in (
             select id from pg_framework_instances
             where tenant_id=$2 and device_id=$3 and discovery_source='AGENT'
               and discovery_provider_key like 'plugin:%' and framework_type = any($4::text[]) and deleted_at is null
           )
           or site_id in (
             select id from pg_site_assets
             where tenant_id=$2 and device_id=$3 and discovery_source='AGENT'
               and discovery_provider_key like 'plugin:%' and status='STALE' and deleted_at is null
           )
         )`,
      [now, tenantId, hostId, webFrameworkTypes],
    );
    await this.db.query(
      `update pg_certificate_bindings
       set metadata=jsonb_set(metadata, '{discoveryStatus}', '"STALE"'::jsonb, true), updated_at=$1, version=version+1
       where tenant_id=$2 and host_id=$3 and discovery_source='AGENT' and deleted_at is null
         and metadata->>'discoveryProviderKey' like 'plugin:%'
         and (
           service_instance_id in (
             select id from pg_framework_instances
             where tenant_id=$2 and device_id=$3 and discovery_source='AGENT'
               and discovery_provider_key like 'plugin:%' and framework_type = any($4::text[]) and deleted_at is null
           )
           or site_asset_id in (
             select id from pg_site_assets
             where tenant_id=$2 and device_id=$3 and discovery_source='AGENT'
               and discovery_provider_key like 'plugin:%' and status='STALE' and deleted_at is null
           )
         )`,
      [now, tenantId, hostId, webFrameworkTypes],
    );
  }

  private async resolveHost(tenantId: string, agentId: string): Promise<AgentHostAnchor> {
    const result = await this.db.query<AgentHostAnchor>(
      `select id, hostname, display_name, primary_ip
       from pg_hosts
       where tenant_id=$1 and agent_id=$2 and deleted_at is null
       order by updated_at desc
       limit 1`,
      [tenantId, agentId],
    );
    const host = result.rows[0];
    if (!host) {
      throw new AppError('RESOURCE_NOT_FOUND', 'Agent 尚未建立统一 Host 资产锚点，无法投影通用事实', { tenantId, agentId });
    }
    return host;
  }

  private buildDiscovery(
    agent: AgentRegistration,
    snapshot: AgentCapabilitySnapshot,
    host: AgentHostAnchor,
  ): StandardDeviceDiscoveryV2 {
    const web = projectWebFacts(snapshot.capabilities, host.primary_ip ?? agent.descriptor.ipAddress);
    return {
      apiVersion: 'gcac.device-discovery/v2',
      device: {
        stableKey: `agent-host:${agent.id}`,
        displayName: host.display_name ?? host.hostname ?? agent.descriptor.hostname ?? agent.id,
        productFamily: 'AGENT_HOST',
        softwareVersion: agent.descriptor.osVersion,
        managementAddress: host.primary_ip ?? agent.descriptor.ipAddress,
        metadata: { agentId: agent.id, snapshotId: snapshot.id },
      },
      capabilities: snapshot.capabilities.map((capability) => ({
        key: capability.capabilityKey,
        available: capability.value !== false && capability.value !== null && capability.value !== undefined,
        metadata: { confidence: capability.confidence },
      })),
      frameworks: web.frameworks,
      sites: web.sites,
      managedTargets: web.managedTargets,
      certificates: web.certificates,
      certificateBindings: web.certificateBindings,
      warnings: [],
      rawFacts: {
        agentId: agent.id,
        snapshotId: snapshot.id,
        reportedAt: snapshot.reportedAt,
        capabilityKeys: snapshot.capabilities.map((capability) => capability.capabilityKey),
      },
    };
  }
}

interface WebProjection {
  frameworks: StandardDeviceDiscoveryV2['frameworks'];
  sites: StandardDeviceDiscoveryV2['sites'];
  managedTargets: StandardDeviceDiscoveryV2['managedTargets'];
  certificates: StandardDeviceDiscoveryV2['certificates'];
  certificateBindings: StandardDeviceDiscoveryV2['certificateBindings'];
}

function projectWebFacts(
  capabilities: AgentCapabilitySnapshot['capabilities'],
  primaryAddress?: string | null,
): WebProjection {
  const frameworks: WebProjection['frameworks'] = [];
  const sites: WebProjection['sites'] = [];
  const managedTargets: WebProjection['managedTargets'] = [];
  const certificates: WebProjection['certificates'] = [];
  const certificateBindings: WebProjection['certificateBindings'] = [];
  const frameworkSeen = new Set<string>();
  const siteByKey = new Map<string, StandardDeviceDiscoveryV2['sites'][number]>();
  const targetBySite = new Map<string, StandardDeviceDiscoveryV2['managedTargets'][number]>();
  const certificateByPath = buildCertificateIndex(capabilities);
  for (const capability of capabilities) {
    const value = asRecord(capability.value);
    if (!value) continue;
    if (capability.capabilityKey === 'web.inventory') {
      projectGenericWebInventory(value, primaryAddress, frameworks, sites, managedTargets, frameworkSeen, siteByKey, targetBySite, certificates, certificateBindings, certificateByPath);
      continue;
    }
  }
  return { frameworks, sites, managedTargets, certificates, certificateBindings };
}

function projectGenericWebInventory(
  value: Record<string, any>,
  primaryAddress: string | null | undefined,
  frameworks: WebProjection['frameworks'],
  sites: WebProjection['sites'],
  managedTargets: WebProjection['managedTargets'],
  frameworkSeen: Set<string>,
  siteByKey: Map<string, StandardDeviceDiscoveryV2['sites'][number]>,
  targetBySite: Map<string, StandardDeviceDiscoveryV2['managedTargets'][number]>,
  certificates: WebProjection['certificates'],
  certificateBindings: WebProjection['certificateBindings'],
  certificateByPath: Map<string, StandardDeviceDiscoveryV2['certificates'][number]>,
): void {
  const configFiles = arrayValue(value.configFiles)
    ?.map((item) => asRecord(item))
    .filter((item): item is Record<string, any> => Boolean(item));
  if (configFiles?.length) {
    const parsed = discoverWebConfigs(configFiles, primaryAddress ?? undefined);
    for (const framework of parsed.frameworks) {
      const frameworkType = stringValue(framework.frameworkType);
      if (!frameworkType || frameworkSeen.has(`framework:${frameworkType}`)) continue;
      const frameworkStableKey = `framework:${frameworkType}`;
      frameworkSeen.add(frameworkStableKey);
      frameworks.push({ stableKey: frameworkStableKey, frameworkType, displayName: stringValue(framework.displayName) ?? frameworkDisplayName(frameworkType), metadata: { source: 'plugin.web-config' } });
    }
    for (const site of parsed.sites) {
      const frameworkType = stringValue(site.frameworkType);
      if (!frameworkType) continue;
      const frameworkStableKey = `framework:${frameworkType}`;
      const normalized = normalizeWebSite(site, frameworkStableKey, primaryAddress, frameworkType);
      if (!normalized) continue;
      addWebSite(normalized, sites, managedTargets, siteByKey, targetBySite, certificates, certificateBindings, certificateByPath);
    }
  }
  for (const rawFramework of arrayValue(value.frameworks) ?? []) {
    const framework = asRecord(rawFramework);
    const frameworkType = stringValue(framework?.frameworkType);
    if (!frameworkType) continue;
    const frameworkStableKey = `framework:${frameworkType}`;
    if (!frameworkSeen.has(frameworkStableKey)) {
      frameworkSeen.add(frameworkStableKey);
      frameworks.push({ stableKey: frameworkStableKey, frameworkType, displayName: frameworkDisplayName(frameworkType), metadata: { source: 'web.inventory' } });
    }
  }
  for (const rawSite of arrayValue(value.sites) ?? []) {
    const siteValue = asRecord(rawSite);
    const frameworkType = stringValue(siteValue?.frameworkType);
    if (!frameworkType) continue;
    const frameworkStableKey = `framework:${frameworkType}`;
    if (!frameworkSeen.has(frameworkStableKey)) {
      frameworkSeen.add(frameworkStableKey);
      frameworks.push({ stableKey: frameworkStableKey, frameworkType, displayName: frameworkDisplayName(frameworkType), metadata: { source: 'web.inventory' } });
    }
    const site = normalizeWebSite(siteValue, frameworkStableKey, primaryAddress, frameworkType);
    if (!site) continue;
    addWebSite(site, sites, managedTargets, siteByKey, targetBySite, certificates, certificateBindings, certificateByPath);
  }
}

function addWebSite(
  site: StandardDeviceDiscoveryV2['sites'][number],
  sites: WebProjection['sites'],
  managedTargets: WebProjection['managedTargets'],
  siteByKey: Map<string, StandardDeviceDiscoveryV2['sites'][number]>,
  targetBySite: Map<string, StandardDeviceDiscoveryV2['managedTargets'][number]>,
  certificates: WebProjection['certificates'],
  certificateBindings: WebProjection['certificateBindings'],
  certificateByPath: Map<string, StandardDeviceDiscoveryV2['certificates'][number]>,
): void {
  const existing = siteByKey.get(site.stableKey);
  if (existing) {
    existing.addresses = [...new Set([...existing.addresses, ...site.addresses])];
    existing.metadata = { ...(existing.metadata ?? {}), ...(site.metadata ?? {}), listeners: [...listenersOf(existing), ...listenersOf(site)] };
    if (site.protocol === 'HTTPS' && existing.protocol !== 'HTTPS') { existing.protocol = site.protocol; existing.port = site.port; }
  } else {
    siteByKey.set(site.stableKey, site);
    sites.push(site);
  }
  const current = siteByKey.get(site.stableKey)!;
  let target = targetBySite.get(site.stableKey);
  if (!target) {
    target = { stableKey: `TARGET:${site.stableKey}`, frameworkStableKey: site.frameworkStableKey, siteStableKey: site.stableKey, targetType: 'tls.binding', targetKey: site.stableKey, supportedCapabilities: ['certificate.deploy', 'certificate.verify', 'certificate.rollback'], executionLocations: ['AGENT'] };
    targetBySite.set(site.stableKey, target);
    managedTargets.push(target);
  }
  const certificatePath = listenersOf(site).map((item) => stringValue(item.certificatePath)).find((path) => Boolean(path && certificateByPath.has(normalizePath(path))))
    ?? listenersOf(site).map((item) => stringValue(item.certificatePath)).find(Boolean)
    ?? stringValue(site.metadata?.certificatePath);
  const certificate = certificatePath ? certificateByPath.get(normalizePath(certificatePath)) : undefined;
  if (certificate && !certificates.some((item) => item.stableKey === certificate.stableKey)) certificates.push(certificate);
  if (certificate && !certificateBindings.some((item) => item.managedTargetStableKey === target!.stableKey && item.certificateStableKey === certificate.stableKey)) {
    certificateBindings.push({ stableKey: `BINDING:${current.stableKey}:${certificate.stableKey}`, managedTargetStableKey: target.stableKey, certificateStableKey: certificate.stableKey, bindingName: current.displayName, metadata: { certificatePath } });
  }
}

function listenersOf(site: StandardDeviceDiscoveryV2['sites'][number]): Array<Record<string, unknown>> {
  const listeners = site.metadata?.listeners;
  return Array.isArray(listeners) ? listeners.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : [];
}

function buildCertificateIndex(capabilities: AgentCapabilitySnapshot['capabilities']): Map<string, StandardDeviceDiscoveryV2['certificates'][number]> {
  const index = new Map<string, StandardDeviceDiscoveryV2['certificates'][number]>();
  const inventory = capabilities.find((item) => item.capabilityKey === 'web.inventory');
  const files = asRecord(inventory?.value)?.certificateFiles;
  if (!Array.isArray(files)) return index;
  for (const entry of files) {
    const value = asRecord(entry); const path = stringValue(value?.path);
    if (!value || !path) continue;
    const reported = certificateFromReportedMetadata(value, path) ?? certificateFromPem(value, path);
    if (!reported) continue;
    index.set(normalizePath(path), reported);
    for (const configuredPath of arrayValue(value.configuredPaths) ?? []) {
      const alias = stringValue(configuredPath);
      if (alias) index.set(normalizePath(alias), reported);
    }
  }
  return index;
}

function certificateFromReportedMetadata(value: Record<string, any>, path: string): StandardDeviceDiscoveryV2['certificates'][number] | undefined {
  const fingerprint = stringValue(value.sha256Fingerprint)?.replace(/[^A-Fa-f0-9]/g, '').toUpperCase();
  if (!fingerprint || !/^[A-F0-9]{64}$/.test(fingerprint)) return undefined;
  const notBefore = validTimestamp(value.notBefore); const notAfter = validTimestamp(value.notAfter);
  return {
    stableKey: `CERT:${fingerprint}`,
    sha256Fingerprint: fingerprint,
    ...(stringValue(value.subject) ? { subject: stringValue(value.subject) } : {}),
    ...(stringValue(value.issuer) ? { issuer: stringValue(value.issuer) } : {}),
    ...(notBefore ? { notBefore } : {}),
    ...(notAfter ? { notAfter } : {}),
    metadata: { path, ...(stringValue(value.name) ? { name: stringValue(value.name) } : {}) },
  };
}

function certificateFromPem(value: Record<string, any>, path: string): StandardDeviceDiscoveryV2['certificates'][number] | undefined {
  const content = stringValue(value.content);
  if (!content || /PRIVATE KEY/i.test(content)) return undefined;
  try {
    const x509 = new X509Certificate(content);
    const fingerprint = x509.fingerprint256.replace(/:/g, '').toUpperCase();
    return { stableKey: `CERT:${fingerprint}`, sha256Fingerprint: fingerprint, subject: x509.subject, issuer: x509.issuer, notBefore: new Date(x509.validFrom).toISOString(), notAfter: new Date(x509.validTo).toISOString(), metadata: { path, name: certificateNameFromSubject(x509.subject) } };
  } catch { return undefined; }
}

function validTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim() || Number.isNaN(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function certificateNameFromSubject(subject: string): string | undefined {
  return subject.match(/(?:^|\n)CN=([^\n,]+)/)?.[1]?.trim();
}

function normalizePath(value: string): string { return value.replaceAll('\\', '/').replace(/\/+/g, '/').trim(); }

function frameworkDisplayName(frameworkType: string): string {
  return ({ 'web.nginx': 'Nginx', 'web.apache': 'Apache', 'app.tomcat': 'Tomcat', 'web.iis': 'IIS' } as Record<string, string>)[frameworkType] ?? frameworkType;
}

function normalizeWebSite(raw: unknown, frameworkStableKey: string, primaryAddress: string | null | undefined, frameworkType: string): StandardDeviceDiscoveryV2['sites'][number] | undefined {
  const value = asRecord(raw);
  if (!value) return undefined;
  const displayName = stringValue(value.name) ?? stringValue(value.Name) ?? stringValue(value.contextPath);
  if (!displayName) return undefined;
  const bindings = arrayValue(value.Bindings) ?? arrayValue(value.bindings);
  const listen = arrayValue(value.listen) ?? [];
  const firstBinding = asRecord(bindings?.[0]);
  const firstListen = asRecord(listen[0]);
  const port = numberValue(value.port)
    ?? numberValue(firstBinding?.Port)
    ?? numberValue(firstListen?.port);
  const protocol = stringValue(value.protocol)
    ?? stringValue(firstBinding?.Protocol)
    ?? stringValue(firstListen?.protocol)
    ?? (frameworkType === 'app.tomcat' ? 'HTTPS' : undefined);
  const addresses = [
    ...(arrayValue(value.serverNames) ?? []),
    ...(arrayValue(value.addresses) ?? []),
    stringValue(firstBinding?.HostHeader),
    stringValue(firstBinding?.IPAddress),
    stringValue(firstListen?.address),
    primaryAddress,
  ].filter((item): item is string => Boolean(item && item !== '*'));
  const aliases = addresses
    .filter((address) => address !== primaryAddress)
    .map((address) => address.toLowerCase())
    .sort();
  const identity = aliases.join('|') || displayName.toLowerCase();
  const stableKey = `${frameworkType}:${createHash('sha256').update(identity).digest('hex').slice(0, 24)}`;
  return {
    stableKey,
    frameworkStableKey,
    siteType: 'web.site',
    displayName,
    addresses: [...new Set(addresses)],
    ...(port ? { port } : {}),
    ...(protocol ? { protocol: protocol.toUpperCase() } : {}),
    metadata: value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata) ? value.metadata as Record<string, unknown> : {},
  };
}

function asRecord(value: unknown): Record<string, any> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : undefined;
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}
