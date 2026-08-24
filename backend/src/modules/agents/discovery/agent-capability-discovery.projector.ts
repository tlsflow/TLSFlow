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
    const hasWebInventory = snapshot.capabilities.some((capability) => capability.capabilityKey === 'web.inventory');
    const preserveEmptyWeb = hasWebInventory && discovery.frameworks.length === 0 && discovery.sites.length === 0;
    const summary = await this.projector.project({
      tenantId: snapshot.tenantId,
      hostId: host.id,
      discoveryProviderKey: `agent:${agent.id}`,
      discoverySource: 'AGENT',
      preserveEmptyWeb,
    }, discovery);
    if (hasWebInventory && !preserveEmptyWeb) {
      await this.markLegacyPluginDiscoveryStale(snapshot.tenantId, host.id, discovery.frameworks.map((framework) => framework.frameworkType));
    }
    return summary;
  }

  /**
   * 新 Web 事实成功解析后，只淘汰同一框架的旧 Plugin Runner 投影。
   * 框架类型来自本次插件解析结果，宿主不维护厂商产品清单；空结果不会进入这里。
   */
  private async markLegacyPluginDiscoveryStale(tenantId: string, hostId: string, frameworkTypes: string[]): Promise<void> {
    const types = [...new Set(frameworkTypes.filter((item) => typeof item === 'string' && item.trim()))];
    if (types.length === 0) return;
    const now = new Date().toISOString();
    await this.db.query(
      `update pg_framework_instances
       set status='STALE', updated_at=$1, version=version+1
       where tenant_id=$2 and device_id=$3 and discovery_source='AGENT'
         and discovery_provider_key like 'plugin:%' and framework_type = any($4::text[]) and deleted_at is null`,
      [now, tenantId, hostId, types],
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
      [now, tenantId, hostId, types],
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
      [now, tenantId, hostId, types],
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
      [now, tenantId, hostId, types],
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
  const certificateByReference = buildCertificateIndex(capabilities);
  for (const capability of capabilities) {
    const value = asRecord(capability.value);
    if (!value) continue;
    if (capability.capabilityKey === 'web.inventory') {
      projectGenericWebInventory(value, primaryAddress, frameworks, sites, managedTargets, frameworkSeen, siteByKey, targetBySite, certificates, certificateBindings, certificateByReference);
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
  certificateByReference: Map<string, StandardDeviceDiscoveryV2['certificates'][number]>,
): void {
  const configFiles = arrayValue(value.configFiles)
    ?.map((item) => asRecord(item))
    .filter((item): item is Record<string, any> => Boolean(item));
  if (configFiles?.length) {
    const parsed = enrichWebConfigCertificates(
      discoverWebConfigs(configFiles, primaryAddress ?? undefined),
      value,
    );
    for (const framework of parsed.frameworks) {
      const frameworkType = stringValue(framework.frameworkType);
      if (!frameworkType || frameworkSeen.has(`framework:${frameworkType}`)) continue;
      const frameworkStableKey = `framework:${frameworkType}`;
      frameworkSeen.add(frameworkStableKey);
      frameworks.push({ stableKey: frameworkStableKey, frameworkType, displayName: stringValue(framework.displayName) ?? frameworkType, metadata: { source: 'plugin.web-config' } });
    }
    for (const site of parsed.sites) {
      const frameworkType = stringValue(site.frameworkType);
      if (!frameworkType) continue;
      const frameworkStableKey = `framework:${frameworkType}`;
      const normalized = normalizeWebSite(site, frameworkStableKey, primaryAddress, frameworkType);
      if (!normalized) continue;
      addWebSite(normalized, sites, managedTargets, siteByKey, targetBySite, certificates, certificateBindings, certificateByReference);
    }
  }
  for (const rawFramework of arrayValue(value.frameworks) ?? []) {
    const framework = asRecord(rawFramework);
    const frameworkType = stringValue(framework?.frameworkType);
    if (!frameworkType) continue;
    const frameworkStableKey = `framework:${frameworkType}`;
    if (!frameworkSeen.has(frameworkStableKey)) {
      frameworkSeen.add(frameworkStableKey);
      frameworks.push({ stableKey: frameworkStableKey, frameworkType, displayName: stringValue(framework?.displayName) ?? frameworkType, metadata: { source: 'web.inventory' } });
    }
  }
  for (const rawSite of arrayValue(value.sites) ?? []) {
    const siteValue = asRecord(rawSite);
    const frameworkType = stringValue(siteValue?.frameworkType);
    if (!frameworkType) continue;
    const frameworkStableKey = `framework:${frameworkType}`;
    if (!frameworkSeen.has(frameworkStableKey)) {
      frameworkSeen.add(frameworkStableKey);
      frameworks.push({ stableKey: frameworkStableKey, frameworkType, displayName: stringValue(siteValue?.displayName) ?? frameworkType, metadata: { source: 'web.inventory' } });
    }
    const site = normalizeWebSite(siteValue, frameworkStableKey, primaryAddress, frameworkType);
    if (!site) continue;
    addWebSite(site, sites, managedTargets, siteByKey, targetBySite, certificates, certificateBindings, certificateByReference);
  }
}

/**
 * IIS 的证书指纹通常来自 HTTP.sys，而不是 applicationHost.config。
 * Agent 将该数据作为通用 SSL 绑定事实上报，宿主在保留插件解析结果的
 * 前提下按监听地址和端口补回证书引用。
 */
function enrichWebConfigCertificates(
  parsed: ReturnType<typeof discoverWebConfigs>,
  inventory: Record<string, any>,
): ReturnType<typeof discoverWebConfigs> {
  const bindings = arrayValue(inventory.sslCertificateBindings)
    ?.map((item) => asRecord(item))
    .filter((item): item is Record<string, any> => Boolean(item)) ?? [];
  if (bindings.length === 0) return parsed;
  return {
    ...parsed,
    sites: parsed.sites.map((site) => {
      const metadata = asRecord(site.metadata) ?? {};
      const listeners = Array.isArray(metadata.listeners)
        ? metadata.listeners.map((item) => {
          const listener = asRecord(item);
          if (!listener || stringValue(listener.certificateThumbprint)) return item;
          const port = numberValue(listener.port);
          if (!port) return item;
          const host = stringValue(listener.host) ?? listenerHostFromBindingInformation(stringValue(listener.bindingInformation));
          const selected = selectSslBinding(bindings, port, host, site.addresses);
          if (!selected) return item;
          return {
            ...listener,
            certificateThumbprint: normalizeInventoryThumbprint(selected.thumbprint),
            ...(stringValue(selected.store) ? { certificateStoreName: stringValue(selected.store) } : {}),
            certificateStoreLocation: 'LocalMachine',
          };
        })
        : metadata.listeners;
      return listeners === metadata.listeners
        ? site
        : { ...site, metadata: { ...metadata, listeners } };
    }),
  };
}

function selectSslBinding(
  bindings: Array<Record<string, any>>,
  port: number,
  host: string | undefined,
  siteAddresses: unknown,
): Record<string, any> | undefined {
  const names = new Set([
    ...(host ? [host.toLowerCase()] : []),
    ...(Array.isArray(siteAddresses) ? siteAddresses.filter((item): item is string => typeof item === 'string').map((item) => item.toLowerCase()) : []),
  ]);
  const candidates = bindings.filter((binding) => numberValue(binding.port) === port && normalizeInventoryThumbprint(binding.thumbprint));
  return candidates.find((binding) => {
    const address = stringValue(binding.address)?.toLowerCase();
    return Boolean(address && names.has(address));
  }) ?? candidates.find((binding) => {
    const address = stringValue(binding.address)?.toLowerCase();
    return !address || address === '*' || address === '0.0.0.0' || address === '::' || address === '[::]';
  });
}

function listenerHostFromBindingInformation(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parts = value.split(':');
  return parts.length >= 3 && parts.slice(2).join(':').trim() ? parts.slice(2).join(':').trim() : undefined;
}

function normalizeInventoryThumbprint(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const compact = value.replace(/\s+/g, '').toUpperCase();
  return /^[A-F0-9]{8,}$/.test(compact) ? compact : undefined;
}

function addWebSite(
  site: StandardDeviceDiscoveryV2['sites'][number],
  sites: WebProjection['sites'],
  managedTargets: WebProjection['managedTargets'],
  siteByKey: Map<string, StandardDeviceDiscoveryV2['sites'][number]>,
  targetBySite: Map<string, StandardDeviceDiscoveryV2['managedTargets'][number]>,
  certificates: WebProjection['certificates'],
  certificateBindings: WebProjection['certificateBindings'],
  certificateByReference: Map<string, StandardDeviceDiscoveryV2['certificates'][number]>,
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
  const certificatePath = listenersOf(site).map((item) => stringValue(item.certificatePath)).find((path) => Boolean(path && certificateReference(certificateByReference, path)))
    ?? listenersOf(site).map((item) => stringValue(item.certificatePath)).find(Boolean)
    ?? stringValue(site.metadata?.certificatePath);
  const certificateThumbprint = listenersOf(site).map((item) => stringValue(item.certificateThumbprint)).find(Boolean);
  const certificateStoreName = listenersOf(site).map((item) => stringValue(item.certificateStoreName)).find(Boolean)
    ?? stringValue(site.metadata?.certificateStoreName);
  const certificate = certificateThumbprint
    ? certificateReference(certificateByReference, `thumbprint:${certificateThumbprint}`) ?? certificateFromThumbprint(certificateThumbprint, certificateStoreName)
    : certificatePath ? certificateReference(certificateByReference, certificatePath) ?? certificateFromConfiguredPath(certificatePath) : undefined;
  if (certificate && !certificates.some((item) => item.stableKey === certificate.stableKey)) certificates.push(certificate);
  if (certificate && !certificateBindings.some((item) => item.managedTargetStableKey === target!.stableKey && item.certificateStableKey === certificate.stableKey)) {
    certificateBindings.push({
      stableKey: `BINDING:${current.stableKey}:${certificate.stableKey}`,
      managedTargetStableKey: target.stableKey,
      certificateStableKey: certificate.stableKey,
      bindingName: current.displayName,
      metadata: {
        ...(certificatePath ? { certificatePath } : {}),
        ...(certificateThumbprint ? { certificateThumbprint } : {}),
        observedCertificate: observedCertificateMetadata(certificate),
      },
    });
  }
}

function observedCertificateMetadata(certificate: StandardDeviceDiscoveryV2['certificates'][number]): Record<string, unknown> {
  const metadata = certificate.metadata ?? {};
  return {
    ...(certificate.sha256Fingerprint ? { fingerprintSha256: certificate.sha256Fingerprint } : {}),
    ...(certificate.subject ? { subject: certificate.subject } : {}),
    ...(certificate.issuer ? { issuer: certificate.issuer } : {}),
    ...(certificate.notBefore ? { notBefore: certificate.notBefore } : {}),
    ...(certificate.notAfter ? { notAfter: certificate.notAfter } : {}),
    ...(typeof metadata.name === 'string' && metadata.name ? { name: metadata.name } : {}),
    ...(typeof metadata.thumbprint === 'string' && metadata.thumbprint ? { thumbprint: metadata.thumbprint } : {}),
  };
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
    index.set(`basename:${pathBasename(path).toLowerCase()}`, reported);
    const thumbprint = certificateThumbprint(value);
    if (thumbprint) index.set(`thumbprint:${thumbprint}`, reported);
    for (const configuredPath of arrayValue(value.configuredPaths) ?? []) {
      const alias = stringValue(configuredPath);
      if (alias) {
        index.set(normalizePath(alias), reported);
        index.set(`basename:${pathBasename(alias).toLowerCase()}`, reported);
      }
    }
  }
  return index;
}

function certificateFromReportedMetadata(value: Record<string, any>, path: string): StandardDeviceDiscoveryV2['certificates'][number] | undefined {
  const fingerprint = stringValue(value.sha256Fingerprint ?? value.fingerprintSha256)?.replace(/[^A-Fa-f0-9]/g, '').toUpperCase();
  const thumbprint = certificateThumbprint(value);
  if ((!fingerprint || !/^[A-F0-9]{64}$/.test(fingerprint)) && !thumbprint) return undefined;
  const notBefore = validTimestamp(value.notBefore); const notAfter = validTimestamp(value.notAfter);
  return {
    stableKey: fingerprint && /^[A-F0-9]{64}$/.test(fingerprint) ? `CERT:${fingerprint}` : `CERT:SHA1:${thumbprint}`,
    ...(fingerprint && /^[A-F0-9]{64}$/.test(fingerprint) ? { sha256Fingerprint: fingerprint } : {}),
    ...(stringValue(value.subject) ? { subject: stringValue(value.subject) } : {}),
    ...(stringValue(value.issuer) ? { issuer: stringValue(value.issuer) } : {}),
    ...(notBefore ? { notBefore } : {}),
    ...(notAfter ? { notAfter } : {}),
    metadata: { path, ...(thumbprint ? { thumbprint } : {}), ...(stringValue(value.store) ? { store: stringValue(value.store) } : {}), ...(stringValue(value.storeLocation) ? { storeLocation: stringValue(value.storeLocation) } : {}), ...(stringValue(value.name) ? { name: stringValue(value.name) } : {}) },
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

function pathBasename(value: string): string { return normalizePath(value).split('/').at(-1) ?? value; }

function certificateThumbprint(value: Record<string, any>): string | undefined {
  const raw = stringValue(value.thumbprint ?? value.sha1Fingerprint ?? value.certificateThumbprint ?? value.certificateHash ?? value.certHash);
  if (!raw) return undefined;
  const compact = raw.replace(/\s+/g, '');
  if (/^[A-Fa-f0-9]+$/.test(compact) && compact.length >= 8 && compact.length % 2 === 0) return compact.toUpperCase();
  // IIS applicationHost.config 在部分 Windows 版本中回传 Base64 SHA-1 Hash。
  try {
    const decoded = Buffer.from(raw, 'base64');
    return decoded.length === 20 ? decoded.toString('hex').toUpperCase() : undefined;
  } catch {
    return undefined;
  }
}

function certificateReference(index: Map<string, StandardDeviceDiscoveryV2['certificates'][number]>, value: string): StandardDeviceDiscoveryV2['certificates'][number] | undefined {
  const normalized = normalizePath(value);
  return index.get(normalized) ?? index.get(`basename:${pathBasename(normalized).toLowerCase()}`) ?? index.get(value.toLowerCase());
}

function certificateFromThumbprint(thumbprint: string, storeName?: string): StandardDeviceDiscoveryV2['certificates'][number] {
  return {
    stableKey: `CERT:SHA1:${thumbprint}`,
    metadata: {
      name: thumbprint,
      thumbprint,
      source: 'iis-binding',
      ...(storeName ? { store: storeName } : {}),
    },
  };
}

function certificateFromConfiguredPath(path: string): StandardDeviceDiscoveryV2['certificates'][number] {
  const normalized = normalizePath(path);
  return {
    stableKey: `CERT:PATH:${createHash('sha256').update(normalized.toLowerCase()).digest('hex').slice(0, 32)}`,
    metadata: { path: normalized, name: pathBasename(normalized), source: 'configured-certificate-path' },
  };
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
    ;
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
