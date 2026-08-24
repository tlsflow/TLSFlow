import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import type { StandardDeviceDiscoveryV2 } from '../../plugins/discovery/device-discovery.dto.js';
import { StandardDeviceDiscoveryProjector, type StandardDiscoveryProjectionSummary } from '../../plugins/discovery/standard-device-discovery.projector.js';
import type { AgentCapabilitySnapshot, AgentRegistration } from '../schema/agents.schema.js';

interface AgentHostAnchor extends Record<string, unknown> {
  id: string;
  hostname: string | null;
  display_name: string | null;
  primary_ip: string | null;
}

interface AgentProductProjectionContext {
  agent: AgentRegistration;
  snapshot: AgentCapabilitySnapshot;
  capabilityKey: string;
  detail: Record<string, unknown>;
  discovery: StandardDeviceDiscoveryV2;
}

interface AgentProductDiscoveryProjector {
  capabilityKey: string;
  project(context: AgentProductProjectionContext): void;
}

interface WebProductDescriptor {
  capabilityKey: string;
  frameworkType: string;
  frameworkName: string;
  targetType: string;
  deployCapability: string;
  fallbackHostHeaderToSiteName?: boolean;
}

const webProductProjectors: AgentProductDiscoveryProjector[] = [
  createWebProductProjector({
    capabilityKey: 'linux.nginx.detail',
    frameworkType: 'web.nginx',
    frameworkName: 'NGINX',
    targetType: 'tls.file',
    deployCapability: 'nginx.cert.install',
  }),
  createWebProductProjector({
    capabilityKey: 'linux.apache.detail',
    frameworkType: 'web.apache',
    frameworkName: 'Apache HTTP Server',
    targetType: 'tls.file',
    deployCapability: 'apache.cert.install',
  }),
  createIisProductProjector(),
  createTomcatProductProjector(),
];

export class AgentCapabilityDiscoveryProjector {
  constructor(
    private readonly db: DatabasePort,
    private readonly projector: StandardDeviceDiscoveryProjector,
    private readonly productProjectors: AgentProductDiscoveryProjector[] = webProductProjectors,
  ) {}

  async project(agent: AgentRegistration, snapshot: AgentCapabilitySnapshot): Promise<StandardDiscoveryProjectionSummary> {
    const host = await this.resolveHost(snapshot.tenantId, agent.id);
    const discovery = this.buildDiscovery(agent, snapshot, host);
    return this.projector.project({
      tenantId: snapshot.tenantId,
      hostId: host.id,
      discoveryProviderKey: `agent:${agent.id}`,
      discoverySource: 'AGENT',
    }, discovery);
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
      throw new AppError('RESOURCE_NOT_FOUND', 'Agent 尚未建立统一 Host 资产锚点，无法投影发现结果', { tenantId, agentId });
    }
    return host;
  }

  private buildDiscovery(agent: AgentRegistration, snapshot: AgentCapabilitySnapshot, host: AgentHostAnchor): StandardDeviceDiscoveryV2 {
    const discovery: StandardDeviceDiscoveryV2 = {
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
      frameworks: [],
      sites: [],
      managedTargets: [],
      certificates: [],
      certificateBindings: [],
      warnings: [],
      rawFacts: { agentId: agent.id, snapshotId: snapshot.id, reportedAt: snapshot.reportedAt },
    };

    const capabilities = new Map(snapshot.capabilities.map((capability) => [capability.capabilityKey, capability.value]));
    for (const productProjector of this.productProjectors) {
      const detail = asRecord(capabilities.get(productProjector.capabilityKey));
      if (!detail || !isInstalledProduct(detail)) continue;
      productProjector.project({
        agent,
        snapshot,
        capabilityKey: productProjector.capabilityKey,
        detail,
        discovery,
      });
    }
    return discovery;
  }
}

function createWebProductProjector(descriptor: WebProductDescriptor): AgentProductDiscoveryProjector {
  return {
    capabilityKey: descriptor.capabilityKey,
    project({ detail, discovery }) {
      const frameworkStableKey = `framework:${descriptor.frameworkType}`;
      discovery.frameworks.push({
        stableKey: frameworkStableKey,
        frameworkType: descriptor.frameworkType,
        displayName: descriptor.frameworkName,
        version: readString(detail, 'version', 'VersionString'),
        metadata: compactRecord({
          binaryPath: readString(detail, 'binaryPath'),
          configPath: readString(detail, 'configPath'),
          installPath: readString(detail, 'prefix', 'serverRoot'),
          serviceName: readString(detail, 'serviceName'),
          running: readBoolean(detail, 'running', 'Running'),
          capabilityKey: descriptor.capabilityKey,
        }),
      });

      for (const [siteIndex, site] of readRecords(detail, 'sites', 'Sites').entries()) {
        const siteName = readString(site, 'name', 'Name') ?? `${descriptor.frameworkName}-${siteIndex + 1}`;
        const listeners = readRecords(site, 'listen', 'bindings', 'Bindings').filter(hasValidPort);
        const primaryListener = listeners.find(isTlsListener) ?? listeners[0];
        const projectedSite = createSite(
          frameworkStableKey,
          descriptor.frameworkType,
          siteName,
          siteIndex,
          site,
          primaryListener,
          listeners,
          descriptor.fallbackHostHeaderToSiteName !== false,
        );
        discovery.sites.push(projectedSite);
        for (const [listenerIndex, listener] of listeners.entries()) {
          if (!isTlsListener(listener)) continue;
          const listenerKey = listenerStableKey(listener, listenerIndex);
          discovery.managedTargets.push(createManagedTarget({
            frameworkStableKey,
            siteStableKey: projectedSite.stableKey,
            targetType: descriptor.targetType,
            deployCapability: descriptor.deployCapability,
            targetKey: `${projectedSite.stableKey}:listener:${listenerKey}`,
            metadata: {
              ...targetMetadata(siteName, site, listener),
              listenerKey,
              bindingInformation: listenerBindingInformation(siteName, site, listener),
            },
          }));
        }
      }
    },
  };
}

function createIisProductProjector(): AgentProductDiscoveryProjector {
  return createWebProductProjector({
    capabilityKey: 'windows.iis.detail',
    frameworkType: 'web.iis',
    frameworkName: 'Microsoft IIS',
    targetType: 'tls.binding',
    deployCapability: 'windows.iis.binding.update_certificate',
    fallbackHostHeaderToSiteName: false,
  });
}

function createTomcatProductProjector(): AgentProductDiscoveryProjector {
  return {
    capabilityKey: 'linux.tomcat.detail',
    project({ detail, discovery }) {
      const frameworkType = 'app.tomcat';
      const frameworkStableKey = `framework:${frameworkType}`;
      discovery.frameworks.push({
        stableKey: frameworkStableKey,
        frameworkType,
        displayName: 'Apache Tomcat',
        version: readString(detail, 'version'),
        metadata: compactRecord({
          configPath: readString(detail, 'configPath'),
          installPath: readString(detail, 'catalinaBase', 'catalinaHome'),
          serviceName: readString(detail, 'serviceName'),
          running: readBoolean(detail, 'running'),
          capabilityKey: 'linux.tomcat.detail',
        }),
      });

      for (const [connectorIndex, connector] of readRecords(detail, 'connectors').entries()) {
        if (!hasValidPort(connector)) continue;
        const port = readNumber(connector, 'port', 'Port');
        const siteName = readString(connector, 'certificateName') ?? `Tomcat ${port ?? connectorIndex + 1}`;
        const projectedSite = createSite(frameworkStableKey, frameworkType, siteName, connectorIndex, connector, connector, [connector]);
        discovery.sites.push(projectedSite);
        if (!isTlsListener(connector)) continue;
        discovery.managedTargets.push(createManagedTarget({
          frameworkStableKey,
          siteStableKey: projectedSite.stableKey,
          targetType: readString(connector, 'keystorePath') ? 'tls.keystore' : 'tls.file',
          deployCapability: 'tomcat.keystore.replace',
          targetKey: projectedSite.stableKey,
          metadata: {
            ...targetMetadata(siteName, {}, connector),
            bindingInformation: readString(projectedSite.metadata, 'bindingInformation'),
          },
        }));
      }
    },
  };
}

function createSite(
  frameworkStableKey: string,
  frameworkType: string,
  siteName: string,
  siteIndex: number,
  site: Record<string, unknown>,
  listener?: Record<string, unknown>,
  listeners: Record<string, unknown>[] = listener ? [listener] : [],
  fallbackHostHeaderToSiteName = true,
): StandardDeviceDiscoveryV2['sites'][number] {
  const address = readString(listener, 'address', 'IPAddress', 'Address') ?? '*';
  const port = readNumber(listener, 'port', 'Port');
  const protocol = normalizeProtocol(listener);
  const hostHeader = readString(listener, 'hostHeader', 'HostHeader')
    ?? readStrings(site, 'serverNames')[0]
    ?? (fallbackHostHeaderToSiteName ? siteName : undefined);
  const siteIdentity = readString(site, 'id', 'Id', 'siteId', 'SiteId', 'siteKey', 'SiteKey', 'key', 'Key')
    ?? readStrings(site, 'configFiles').join('|')
    ?? String(siteIndex);
  const stableKey = `site:${frameworkType}:${stableToken(siteName, siteIdentity, String(siteIndex))}`;
  return {
    stableKey,
    frameworkStableKey,
    siteType: 'web.site',
    displayName: siteName,
    addresses: uniqueStrings([hostHeader, address]),
    port,
    protocol,
    metadata: compactRecord({
      siteName,
      hostHeader,
      bindingInformation: listener ? listenerBindingInformation(siteName, site, listener, fallbackHostHeaderToSiteName) : undefined,
      listeners: listeners.map((item, index) => normalizeListener(siteName, site, item, index, fallbackHostHeaderToSiteName)),
      configPath: readStrings(site, 'configFiles')[0],
      sitePath: readString(site, 'sitePath', 'PhysicalPath'),
      siteMode: readString(site, 'siteMode'),
      runtimeStatus: readString(site, 'state', 'State'),
    }),
  };
}

function createManagedTarget(input: {
  frameworkStableKey: string;
  siteStableKey: string;
  targetType: string;
  deployCapability: string;
  targetKey: string;
  metadata: Record<string, unknown>;
}): StandardDeviceDiscoveryV2['managedTargets'][number] {
  return {
    stableKey: `target:${stableToken(input.frameworkStableKey, input.siteStableKey, input.targetType, input.targetKey)}`,
    frameworkStableKey: input.frameworkStableKey,
    siteStableKey: input.siteStableKey,
    targetType: input.targetType,
    targetKey: input.targetKey,
    bindingKey: readString(input.metadata, 'bindingInformation'),
    supportedCapabilities: uniqueStrings([
      'certificate.deploy',
      'certificate.verify',
      'certificate.rollback',
      input.deployCapability,
    ]),
    executionLocations: ['AGENT'],
    metadata: input.metadata,
  };
}

function normalizeListener(siteName: string, site: Record<string, unknown>, listener: Record<string, unknown>, listenerIndex: number, fallbackHostHeaderToSiteName = true): Record<string, unknown> {
  const address = readString(listener, 'address', 'IPAddress', 'Address') ?? '*';
  const port = readNumber(listener, 'port', 'Port');
  const protocol = normalizeProtocol(listener);
  const hostHeader = readString(listener, 'hostHeader', 'HostHeader')
    ?? readStrings(site, 'serverNames')[0]
    ?? (fallbackHostHeaderToSiteName ? siteName : undefined);
  return compactRecord({
    listenerKey: listenerStableKey(listener, listenerIndex),
    address,
    port,
    protocol,
    hostHeader,
    bindingInformation: listenerBindingInformation(siteName, site, listener, fallbackHostHeaderToSiteName),
    tls: isTlsListener(listener),
  });
}

function listenerStableKey(listener: Record<string, unknown>, listenerIndex: number): string {
  return stableToken(
    readString(listener, 'address', 'IPAddress', 'Address') ?? '*',
    String(readNumber(listener, 'port', 'Port') ?? ''),
    normalizeProtocol(listener) ?? '',
    readString(listener, 'hostHeader', 'HostHeader') ?? '',
    readString(listener, 'bindingInformation', 'BindingInformation') ?? '',
    String(listenerIndex),
  );
}

function listenerBindingInformation(siteName: string, site: Record<string, unknown>, listener: Record<string, unknown>, fallbackHostHeaderToSiteName = true): string {
  const explicit = readString(listener, 'bindingInformation', 'BindingInformation');
  if (explicit) return explicit;
  const address = readString(listener, 'address', 'IPAddress', 'Address') ?? '*';
  const port = readNumber(listener, 'port', 'Port') ?? '';
  const hostHeader = readString(listener, 'hostHeader', 'HostHeader')
    ?? readStrings(site, 'serverNames')[0]
    ?? (fallbackHostHeaderToSiteName ? siteName : '');
  return [address, port, hostHeader].join(':');
}

function targetMetadata(siteName: string, site: Record<string, unknown>, listener: Record<string, unknown>): Record<string, unknown> {
  return compactRecord({
    siteName,
    bindingInformation: readString(listener, 'bindingInformation', 'BindingInformation'),
    certPath: readString(listener, 'certificatePath', 'CertificatePath'),
    keyPath: readString(listener, 'certificateKeyPath', 'CertificateKeyPath'),
    keystorePath: readString(listener, 'keystorePath', 'KeystorePath'),
    storeName: readString(listener, 'certificateStoreName', 'CertificateStoreName'),
    storeThumbprint: readString(listener, 'certificateThumbprint', 'CertificateThumbprint'),
    configPath: readStrings(site, 'configFiles')[0],
    testCommand: readString(listener, 'testCommand'),
    reloadCommand: readString(listener, 'reloadCommand'),
  });
}

function isInstalledProduct(detail: Record<string, unknown>): boolean {
  const installed = readBoolean(detail, 'installed', 'Installed');
  return installed !== false;
}

function isTlsListener(listener: Record<string, unknown>): boolean {
  if (readBoolean(listener, 'tls', 'Tls') === true) return true;
  const protocol = normalizeProtocol(listener);
  return protocol === 'HTTPS' || protocol === 'TLS' || protocol === 'STARTTLS'
    || Boolean(readString(listener, 'certificatePath', 'CertificatePath', 'keystorePath', 'KeystorePath', 'certificateThumbprint', 'CertificateThumbprint'));
}

function hasValidPort(listener: Record<string, unknown>): boolean {
  const port = readNumber(listener, 'port', 'Port');
  return Number.isInteger(port) && port! >= 1 && port! <= 65535;
}

function normalizeProtocol(listener: Record<string, unknown> | undefined): string | undefined {
  const raw = readString(listener, 'protocol', 'Protocol')?.toUpperCase();
  if (readBoolean(listener, 'tls', 'Tls') === true) return 'HTTPS';
  if (raw === 'HTTPS' || raw === 'TLS' || raw === 'STARTTLS' || raw === 'HTTP') return raw;
  if (raw?.startsWith('HTTP/')) return 'HTTP';
  return raw;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readRecords(value: Record<string, unknown>, ...keys: string[]): Record<string, unknown>[] {
  for (const key of keys) {
    const current = value[key];
    if (Array.isArray(current)) return current.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item));
  }
  return [];
}

function readString(value: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  if (!value) return undefined;
  for (const key of keys) {
    const current = value[key];
    if (typeof current === 'string' && current.trim()) return current.trim();
  }
  return undefined;
}

function readStrings(value: Record<string, unknown>, ...keys: string[]): string[] {
  for (const key of keys) {
    const current = value[key];
    if (Array.isArray(current)) return current.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
  }
  return [];
}

function readNumber(value: Record<string, unknown> | undefined, ...keys: string[]): number | undefined {
  if (!value) return undefined;
  for (const key of keys) {
    const current = value[key];
    if (typeof current === 'number' && Number.isFinite(current)) return current;
    if (typeof current === 'string' && current.trim() && Number.isFinite(Number(current))) return Number(current);
  }
  return undefined;
}

function readBoolean(value: Record<string, unknown> | undefined, ...keys: string[]): boolean | undefined {
  if (!value) return undefined;
  for (const key of keys) {
    const current = value[key];
    if (typeof current === 'boolean') return current;
  }
  return undefined;
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined && child !== null && child !== ''));
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())).map((value) => value.trim()))];
}

function stableToken(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 20);
}
