import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import type { StandardDeviceDiscoveryV2 } from '../../plugins/discovery/device-discovery.dto.js';
import { CERTIFICATE_LOCATION_API_VERSION, type CertificateLocationV1 } from '../../deployment-inputs/dto/certificate-location.dto.js';
import { StandardDeviceDiscoveryProjector, type StandardDiscoveryProjectionSummary } from '../../plugins/discovery/standard-device-discovery.projector.js';
import type { UnifiedPluginsApplicationService } from '../../plugins/application/unified-plugins.application-service.js';
import { compareSemanticVersions } from '../../plugins/application/unified-plugins.application-service.js';
import type { UnifiedPluginVersionRecord } from '../../plugins/dto/unified-plugins.dto.js';
import { validateAgentCapabilityDiscoveryMapping, type AgentCapabilityDiscoveryMappingV1 } from '../../plugins/discovery/agent-capability-discovery-mapping.js';
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

type ProductDescriptor = AgentCapabilityDiscoveryMappingV1['projection'] & { capabilityKey: string };

export class AgentCapabilityDiscoveryProjector {
  constructor(
    private readonly db: DatabasePort,
    private readonly projector: StandardDeviceDiscoveryProjector,
    private readonly plugins: Pick<UnifiedPluginsApplicationService, 'listVersions'> & {
      listAccessibleVersions?: UnifiedPluginsApplicationService['listAccessibleVersions'];
    },
  ) {}

  async project(agent: AgentRegistration, snapshot: AgentCapabilitySnapshot): Promise<StandardDiscoveryProjectionSummary> {
    const host = await this.resolveHost(snapshot.tenantId, agent.id);
    const discovery = await this.buildDiscovery(agent, snapshot, host);
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

  private async buildDiscovery(agent: AgentRegistration, snapshot: AgentCapabilitySnapshot, host: AgentHostAnchor): Promise<StandardDeviceDiscoveryV2> {
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
    for (const productProjector of await this.loadProductProjectors(snapshot.tenantId)) {
      const detail = asRecord(capabilities.get(productProjector.capabilityKey));
      if (!detail) continue;
      appendAgentDiscoveryWarnings(discovery, detail, productProjector.capabilityKey);
      if (!isInstalledProduct(detail)) continue;
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

  private async loadProductProjectors(tenantId: string): Promise<AgentProductDiscoveryProjector[]> {
    const byCapability = new Map<string, AgentProductDiscoveryProjector>();
    const versions = this.plugins.listAccessibleVersions
      ? await this.plugins.listAccessibleVersions(tenantId)
      : await this.plugins.listVersions(tenantId);
    const enabled = selectLatestEnabledVersions(versions, tenantId);
    for (const record of enabled) {
      for (const path of Object.values(record.manifest.resources.agentDiscoveryMappings ?? {})) {
        const content = record.resources[path];
        if (!content) throw new AppError('VALIDATION_FAILED', '插件发现映射资源缺失', { pluginVersionId: record.id, path });
        const mapping = validateAgentCapabilityDiscoveryMapping(JSON.parse(content));
        if (mapping.pluginId !== record.pluginId) {
          throw new AppError('VALIDATION_FAILED', '插件发现映射归属与插件不一致', { pluginVersionId: record.id, mappingPluginId: mapping.pluginId });
        }
        if (byCapability.has(mapping.capabilityKey)) {
          throw new AppError('RESOURCE_VERSION_CONFLICT', '多个启用插件声明同一 Agent 发现能力', { capabilityKey: mapping.capabilityKey });
        }
        byCapability.set(mapping.capabilityKey, createProductProjector({ capabilityKey: mapping.capabilityKey, ...mapping.projection }));
      }
    }
    return [...byCapability.values()];
  }
}

function selectLatestEnabledVersions(
  versions: UnifiedPluginVersionRecord[],
  tenantId: string,
): UnifiedPluginVersionRecord[] {
  const latestByPlugin = new Map<string, UnifiedPluginVersionRecord>();
  for (const record of versions) {
    if (record.status !== 'ENABLED') continue;
    const current = latestByPlugin.get(record.pluginId);
    if (!current || isPreferredPluginVersion(record, current, tenantId)) {
      latestByPlugin.set(record.pluginId, record);
    }
  }
  return [...latestByPlugin.values()];
}

function isPreferredPluginVersion(
  candidate: UnifiedPluginVersionRecord,
  current: UnifiedPluginVersionRecord,
  tenantId: string,
): boolean {
  const versionOrder = compareSemanticVersions(candidate.version, current.version);
  if (versionOrder !== 0) return versionOrder > 0;
  if (candidate.tenantId === tenantId && current.tenantId !== tenantId) return true;
  if (candidate.tenantId !== tenantId && current.tenantId === tenantId) return false;
  return candidate.updatedAt > current.updatedAt
    || (candidate.updatedAt === current.updatedAt && candidate.id > current.id);
}

function createProductProjector(descriptor: ProductDescriptor): AgentProductDiscoveryProjector {
  return descriptor.shape === 'connectors' ? createConnectorProductProjector(descriptor) : createWebProductProjector(descriptor);
}

function createWebProductProjector(descriptor: ProductDescriptor): AgentProductDiscoveryProjector {
  return {
    capabilityKey: descriptor.capabilityKey,
    project({ detail, discovery, snapshot }) {
      const frameworkStableKey = `framework:${descriptor.frameworkType}`;
      discovery.frameworks.push({
        stableKey: frameworkStableKey,
        frameworkType: descriptor.frameworkType,
        displayName: descriptor.displayName,
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
        const siteName = readString(site, 'name', 'Name') ?? `${descriptor.displayName}-${siteIndex + 1}`;
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
          const managedTarget = createManagedTarget({
            frameworkStableKey,
            siteStableKey: projectedSite.stableKey,
            targetType: descriptor.targetType,
            deployCapability: descriptor.deployCapability,
            targetKey: `${projectedSite.stableKey}:listener:${listenerKey}`,
            metadata: {
              ...targetMetadata(siteName, site, listener, detail, snapshot.reportedAt),
              listenerKey,
              bindingInformation: listenerBindingInformation(siteName, site, listener),
            },
          });
          discovery.managedTargets.push(managedTarget);
          projectObservedCertificate(discovery, managedTarget, listener, siteName);
        }
      }
    },
  };
}

function createConnectorProductProjector(descriptor: ProductDescriptor): AgentProductDiscoveryProjector {
  return {
    capabilityKey: descriptor.capabilityKey,
    project({ detail, discovery, snapshot }) {
      const frameworkType = descriptor.frameworkType;
      const frameworkStableKey = `framework:${frameworkType}`;
      discovery.frameworks.push({
        stableKey: frameworkStableKey,
        frameworkType,
        displayName: descriptor.displayName,
        version: readString(detail, 'version'),
        metadata: compactRecord({
          configPath: readString(detail, 'configPath'),
          installPath: readString(detail, 'catalinaBase', 'catalinaHome'),
          serviceName: readString(detail, 'serviceName'),
          running: readBoolean(detail, 'running'),
          capabilityKey: descriptor.capabilityKey,
        }),
      });

      const discoveredHosts = readStrings(detail, 'hosts', 'Hosts');
      for (const [connectorIndex, connector] of readRecords(detail, 'connectors').entries()) {
        if (!hasValidPort(connector)) continue;
        const port = readNumber(connector, 'port', 'Port');
        const siteName = readString(connector, 'certificateName', 'hostHeader', 'HostHeader')
          ?? discoveredHosts[connectorIndex]
          ?? `${descriptor.displayName} ${port ?? connectorIndex + 1}`;
        const projectedSite = createSite(frameworkStableKey, frameworkType, siteName, connectorIndex, connector, connector, [connector]);
        discovery.sites.push(projectedSite);
        if (!isTlsListener(connector)) continue;
        const managedTarget = createManagedTarget({
          frameworkStableKey,
          siteStableKey: projectedSite.stableKey,
          targetType: descriptor.targetTypeWhenFieldPresent && readString(connector, descriptor.targetTypeWhenFieldPresent.field)
            ? descriptor.targetTypeWhenFieldPresent.value
            : descriptor.targetType,
          deployCapability: descriptor.deployCapability,
          targetKey: projectedSite.stableKey,
          metadata: {
            ...targetMetadata(siteName, {}, connector, detail, snapshot.reportedAt),
            bindingInformation: readString(projectedSite.metadata, 'bindingInformation'),
          },
        });
        discovery.managedTargets.push(managedTarget);
        projectObservedCertificate(discovery, managedTarget, connector, siteName);
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

function projectObservedCertificate(
  discovery: StandardDeviceDiscoveryV2,
  managedTarget: StandardDeviceDiscoveryV2['managedTargets'][number],
  listener: Record<string, unknown>,
  bindingName: string,
): void {
  const certificate = asRecord(listener.certificate) ?? asRecord(listener.Certificate);
  const fingerprint = normalizeFingerprint(readString(
    certificate,
    'fingerprintSha256',
    'FingerprintSha256',
    'FingerprintSHA256',
    'sha256Fingerprint',
    'SHA256Fingerprint',
  ));
  const thumbprint = readString(certificate, 'thumbprint', 'Thumbprint')
    ?? readString(listener, 'certificateThumbprint', 'CertificateThumbprint');
  const certificatePath = readString(listener, 'certificatePath', 'CertificatePath');
  const keystorePath = readString(listener, 'keystorePath', 'KeystorePath');
  const certificateName = readString(listener, 'certificateName', 'CertificateName')
    ?? readString(certificate, 'subject', 'Subject');
  const identity = fingerprint ?? thumbprint ?? certificatePath ?? keystorePath ?? certificateName;
  if (!identity) return;

  // 证书身份只来自通用观测字段，与产品、框架和运行平台无关。
  const certificateStableKey = `certificate:${stableToken(identity)}`;
  if (!discovery.certificates.some((item) => item.stableKey === certificateStableKey)) {
    discovery.certificates.push({
      stableKey: certificateStableKey,
      sha256Fingerprint: fingerprint,
      subject: readString(certificate, 'subject', 'Subject'),
      issuer: readString(certificate, 'issuer', 'Issuer'),
      notBefore: readString(certificate, 'notBefore', 'NotBefore'),
      notAfter: readString(certificate, 'notAfter', 'NotAfter'),
      metadata: compactRecord({
        name: certificateName ?? (keystorePath ? 'KeyStore 公开证书待解析' : undefined),
        certificatePath,
        storeName: readString(certificate, 'storeName', 'StoreName')
          ?? readString(listener, 'certificateStoreName', 'CertificateStoreName'),
        thumbprint,
        observationStatus: fingerprint || thumbprint || certificateName ? undefined : 'PENDING_PUBLIC_CERTIFICATE',
      }),
    });
  }

  const bindingStableKey = `binding:${stableToken(managedTarget.stableKey, certificateStableKey)}`;
  if (discovery.certificateBindings.some((item) => item.stableKey === bindingStableKey)) return;
  discovery.certificateBindings.push({
    stableKey: bindingStableKey,
    managedTargetStableKey: managedTarget.stableKey,
    certificateStableKey,
    bindingName,
    metadata: compactRecord({
      certificatePath,
      keystorePath,
      storeName: readString(certificate, 'storeName', 'StoreName')
        ?? readString(listener, 'certificateStoreName', 'CertificateStoreName'),
      storeThumbprint: thumbprint,
      observationStatus: fingerprint || thumbprint || certificateName ? undefined : 'PENDING_PUBLIC_CERTIFICATE',
    }),
  });
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

function targetMetadata(
  siteName: string,
  site: Record<string, unknown>,
  listener: Record<string, unknown>,
  framework: Record<string, unknown>,
  observedAt: string,
): Record<string, unknown> {
  const certificateLocation = buildCertificateLocation(site, listener, framework, observedAt);
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
    certificateLocation,
  });
}

function buildCertificateLocation(
  site: Record<string, unknown>,
  listener: Record<string, unknown>,
  framework: Record<string, unknown>,
  observedAt: string,
): CertificateLocationV1 | undefined {
  const certificate = asRecord(listener.certificate) ?? asRecord(listener.Certificate);
  const certificatePath = readString(listener, 'certificatePath', 'CertificatePath');
  const privateKeyPath = readString(listener, 'certificateKeyPath', 'CertificateKeyPath');
  const keystorePath = readString(listener, 'keystorePath', 'KeystorePath');
  const storeThumbprint = readString(listener, 'certificateThumbprint', 'CertificateThumbprint')
    ?? readString(certificate, 'thumbprint', 'Thumbprint');
  if (!certificatePath && !privateKeyPath && !keystorePath && !storeThumbprint) return undefined;

  const keystoreType = normalizeKeystoreType(readString(listener, 'keystoreType', 'KeystoreType'));
  return compactRecord({
    apiVersion: CERTIFICATE_LOCATION_API_VERSION,
    storageKind: keystorePath ? 'KEYSTORE' : storeThumbprint && !certificatePath ? 'WINDOWS_CERTIFICATE_STORE' : 'PEM_FILES',
    certificatePath,
    privateKeyPath,
    chainPath: readString(listener, 'certificateChainPath', 'CertificateChainPath', 'chainPath', 'ChainPath'),
    keystorePath,
    keystoreType,
    keyAlias: readString(listener, 'keyAlias', 'KeyAlias', 'certificateKeyAlias', 'CertificateKeyAlias'),
    storeName: readString(listener, 'certificateStoreName', 'CertificateStoreName')
      ?? readString(certificate, 'storeName', 'StoreName'),
    storeLocation: readString(listener, 'certificateStoreLocation', 'CertificateStoreLocation'),
    storeThumbprint,
    sourceConfigPath: readString(listener, 'configPath', 'ConfigPath') ?? readStrings(site, 'configFiles')[0] ?? readString(framework, 'configPath'),
    serviceName: readString(framework, 'serviceName'),
    programPath: readString(framework, 'binaryPath', 'javaPath', 'programPath'),
    testCommand: readString(listener, 'testCommand'),
    reloadCommand: readString(listener, 'reloadCommand'),
    configFingerprint: readString(listener, 'configFingerprint'),
    confidence: 'EXACT',
    observedAt,
  }) as unknown as CertificateLocationV1;
}

function normalizeKeystoreType(value: string | undefined): CertificateLocationV1['keystoreType'] {
  const normalized = value?.toUpperCase();
  return normalized === 'JKS' || normalized === 'PKCS12' || normalized === 'PEM' ? normalized : value ? 'UNKNOWN' : undefined;
}

function isInstalledProduct(detail: Record<string, unknown>): boolean {
  const installed = readBoolean(detail, 'installed', 'Installed');
  return installed !== false;
}

function appendAgentDiscoveryWarnings(
  discovery: StandardDeviceDiscoveryV2,
  detail: Record<string, unknown>,
  capabilityKey: string,
): void {
  for (const warning of readRecords(detail, 'warnings', 'Warnings')) {
    const code = readString(warning, 'code', 'Code');
    if (!code) continue;
    const metadata = compactRecord({
      capabilityKey,
      message: readString(warning, 'message', 'Message'),
      path: readString(warning, 'path', 'Path'),
    });
    const duplicate = discovery.warnings.some((item) =>
      item.code === code
      && item.metadata?.capabilityKey === capabilityKey
      && item.metadata?.path === metadata.path,
    );
    if (duplicate) continue;
    discovery.warnings.push({
      code,
      messageKey: `agents.discovery.warning.${code}`,
      metadata,
    });
  }
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

function normalizeFingerprint(value: string | undefined): string | undefined {
  const normalized = value?.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
  return normalized && /^[a-f0-9]{64}$/.test(normalized) ? normalized : undefined;
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
