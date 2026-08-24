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
 * Windows Full Agent 的成熟运行态扫描器会直接给出框架、站点和精确配置绑定；
 * 宿主必须原样投影，不能再让插件配置解析、端口或 TLS 观察改写该事实。没有
 * 权威站点事实的旧 Agent 才保留插件配置解析的兼容入口。
 */
export class AgentCapabilityDiscoveryProjector {
  constructor(
    private readonly db: DatabasePort,
    private readonly projector: StandardDeviceDiscoveryProjector,
    // 保留装配位，避免在生产 Runner 接线完成前把插件服务重新注入 Agent Core。
    _plugins?: unknown,
  ) {}

  async project(agent: AgentRegistration, snapshot: AgentCapabilitySnapshot): Promise<StandardDiscoveryProjectionSummary> {
    const inventory = fullWebInventoryValue(snapshot.capabilities);
    // 周期快照只承载运行态，不能触碰框架、站点、证书或绑定。否则一个正常的
    // 轻量上报就会把最后一次完整发现的资产投影覆盖掉。
    if (!inventory) return emptyProjectionSummary();
    const host = await this.resolveHost(snapshot.tenantId, agent.id);
    const discovery = this.buildDiscovery(agent, snapshot, host, inventory);
    const preserveEmptyWeb = discovery.frameworks.length === 0 && discovery.sites.length === 0;
    const summary = await this.projector.project({
      tenantId: snapshot.tenantId,
      hostId: host.id,
      discoveryProviderKey: `agent:${agent.id}`,
      discoverySource: 'AGENT',
      preserveEmptyWeb,
    }, discovery);
    if (!preserveEmptyWeb) {
      await this.markAgentFallbackStale(snapshot.tenantId, host.id, agent.id);
      await this.markLegacyPluginDiscoveryStale(snapshot.tenantId, host.id, discovery.frameworks.map((framework) => framework.frameworkType));
    }
    return summary;
  }

  /** 已解析到真实 Web 框架后，淘汰历史空快照生成的通用设备占位框架。 */
  private async markAgentFallbackStale(tenantId: string, hostId: string, agentId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.query(
      `update pg_framework_instances
       set status='STALE', updated_at=$1, version=version+1
       where tenant_id=$2 and device_id=$3 and discovery_source='AGENT'
         and discovery_provider_key=$4 and framework_type='device.generic' and deleted_at is null`,
      [now, tenantId, hostId, `agent:${agentId}`],
    );
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
    inventory: Record<string, any>,
  ): StandardDeviceDiscoveryV2 {
    const web = projectWebFacts(inventory, host.primary_ip ?? agent.descriptor.ipAddress);
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

const FULL_WEB_DISCOVERY_SCOPE = 'FULL_WEB_DISCOVERY';

function fullWebInventoryValue(capabilities: AgentCapabilitySnapshot['capabilities']): Record<string, any> | undefined {
  for (const capability of capabilities) {
    if (capability.capabilityKey !== 'web.inventory') continue;
    const value = asRecord(capability.value);
    if (value?.scope === FULL_WEB_DISCOVERY_SCOPE) return value;
  }
  return undefined;
}

function emptyProjectionSummary(): StandardDiscoveryProjectionSummary {
  return { serviceInstances: 0, sites: 0, managedTargets: 0, certificates: 0, certificateBindings: 0, stale: 0, conflicts: 0 };
}

interface WebProjection {
  frameworks: StandardDeviceDiscoveryV2['frameworks'];
  sites: StandardDeviceDiscoveryV2['sites'];
  managedTargets: StandardDeviceDiscoveryV2['managedTargets'];
  certificates: StandardDeviceDiscoveryV2['certificates'];
  certificateBindings: StandardDeviceDiscoveryV2['certificateBindings'];
}

function projectWebFacts(
  inventory: Record<string, any>,
  primaryAddress?: string | null,
): WebProjection {
  const frameworks: WebProjection['frameworks'] = [];
  const sites: WebProjection['sites'] = [];
  const managedTargets: WebProjection['managedTargets'] = [];
  const certificates: WebProjection['certificates'] = [];
  const certificateBindings: WebProjection['certificateBindings'] = [];
  const frameworkSeen = new Set<string>();
  const frameworkWorkingDirectories = new Map<string, string>();
  const siteByKey = new Map<string, StandardDeviceDiscoveryV2['sites'][number]>();
  const targetByKey = new Map<string, StandardDeviceDiscoveryV2['managedTargets'][number]>();
  const certificateByReference = buildCertificateIndex(inventory);
  // Windows Full Agent 已经在本机按运行中的框架和实际配置完成解析。这里再次调用
  // 插件配置解析器会重新引入默认路径、候选文件和端口猜测，最终把错误证书投影回来。
  if (hasAuthoritativeAgentWebInventory(inventory)) {
    projectAuthoritativeAgentWebInventory(inventory, primaryAddress, frameworks, sites, managedTargets, frameworkSeen, frameworkWorkingDirectories, siteByKey, targetByKey, certificates, certificateBindings, certificateByReference);
  } else {
    // 兼容尚未升级的其他 Agent；它们没有权威站点事实时才保留旧解析入口。
    projectGenericWebInventory(inventory, primaryAddress, frameworks, sites, managedTargets, frameworkSeen, siteByKey, targetByKey, certificates, certificateBindings, certificateByReference);
  }
  return { frameworks, sites, managedTargets, certificates, certificateBindings };
}

function hasAuthoritativeAgentWebInventory(inventory: Record<string, any>): boolean {
  return (arrayValue(inventory.frameworks) ?? []).some((item) => Boolean(asRecord(item)))
    || (arrayValue(inventory.sites) ?? []).some((item) => Boolean(asRecord(item)));
}

function projectAuthoritativeAgentWebInventory(
  inventory: Record<string, any>,
  primaryAddress: string | null | undefined,
  frameworks: WebProjection['frameworks'],
  sites: WebProjection['sites'],
  managedTargets: WebProjection['managedTargets'],
  frameworkSeen: Set<string>,
  frameworkWorkingDirectories: Map<string, string>,
  siteByKey: Map<string, StandardDeviceDiscoveryV2['sites'][number]>,
  targetByKey: Map<string, StandardDeviceDiscoveryV2['managedTargets'][number]>,
  certificates: WebProjection['certificates'],
  certificateBindings: WebProjection['certificateBindings'],
  certificateByReference: Map<string, StandardDeviceDiscoveryV2['certificates'][number]>,
): void {
  const ensureFramework = (frameworkType: string, displayName?: string, version?: string, metadata?: Record<string, unknown>) => {
    const stableKey = `framework:${frameworkType}`;
    if (frameworkSeen.has(stableKey)) return stableKey;
    frameworkSeen.add(stableKey);
    frameworks.push({
      stableKey,
      frameworkType,
      displayName: displayName || frameworkType,
      ...(version ? { version } : {}),
      metadata: { source: 'runtime-effective-config', ...(metadata ?? {}) },
    });
    return stableKey;
  };

  for (const item of arrayValue(inventory.frameworks) ?? []) {
    const value = asRecord(item);
    const frameworkType = stringValue(value?.frameworkType);
    if (!value || !frameworkType) continue;
    const frameworkMetadata = asRecord(value.metadata);
    const workingDirectory = stringValue(frameworkMetadata?.workingDirectory);
    if (workingDirectory) frameworkWorkingDirectories.set(frameworkType, workingDirectory);
    ensureFramework(
      frameworkType,
      stringValue(value.displayName),
      stringValue(value.version),
      frameworkMetadata,
    );
  }

  for (const item of arrayValue(inventory.sites) ?? []) {
    const value = asRecord(item);
    const frameworkType = stringValue(value?.frameworkType);
    if (!value || !frameworkType) continue;
    const frameworkStableKey = ensureFramework(frameworkType);
    const site = normalizeAuthoritativeAgentSite(
      value,
      frameworkStableKey,
      primaryAddress,
      frameworkType,
      frameworkWorkingDirectories.get(frameworkType),
    );
    if (!site) continue;
    addWebSite(site, sites, managedTargets, siteByKey, targetByKey, certificates, certificateBindings, certificateByReference);
  }
}

function normalizeAuthoritativeAgentSite(
  value: Record<string, any>,
  frameworkStableKey: string,
  primaryAddress: string | null | undefined,
  frameworkType: string,
  frameworkWorkingDirectory?: string,
): StandardDeviceDiscoveryV2['sites'][number] | undefined {
  const displayName = stringValue(value.name);
  if (!displayName) return undefined;
  const metadata = asRecord(value.metadata) ?? {};
  const listeners = (arrayValue(metadata.listeners) ?? [])
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, any> => Boolean(item));
  const normalizedListeners = listeners.map((listener) => {
    if (stringValue(listener.workingDirectory) || !frameworkWorkingDirectory) return listener;
    return { ...listener, workingDirectory: frameworkWorkingDirectory };
  });
  const primaryListener = normalizedListeners.find((item) => stringValue(item.protocol)?.toUpperCase() === 'HTTPS') ?? normalizedListeners[0];
  const addresses = [
    ...stringValues(value.serverNames),
    ...stringValues(value.addresses),
    ...normalizedListeners.flatMap((listener) => [stringValue(listener.host), stringValue(listener.address)]),
    primaryAddress ?? undefined,
  ].filter((item): item is string => Boolean(item && item !== '*' && item !== '0.0.0.0' && item !== '::'));
  const siteId = stringValue(metadata.siteId);
  const configPath = stringValue(metadata.configPath);
  const listenerIdentity = normalizedListeners
    .map((listener) => [stringValue(listener.protocol), numberValue(listener.port), stringValue(listener.bindingInformation), stringValue(listener.host), stringValue(listener.address)].join('|'))
    .sort()
    .join('||');
  const identity = [frameworkType, siteId || displayName, configPath || listenerIdentity].join('|').toLowerCase();
  const port = numberValue(value.port) ?? numberValue(primaryListener?.port);
  const protocol = stringValue(value.protocol) ?? stringValue(primaryListener?.protocol);
  return {
    stableKey: `${frameworkType}:${createHash('sha256').update(identity).digest('hex').slice(0, 24)}`,
    frameworkStableKey,
    siteType: 'web.site',
    displayName,
    addresses: [...new Set(addresses)],
    ...(port ? { port } : {}),
    ...(protocol ? { protocol: protocol.toUpperCase() } : {}),
    metadata: { ...metadata, listeners: normalizedListeners, source: stringValue(metadata.source) ?? 'runtime-effective-config' },
  };
}

function projectGenericWebInventory(
  value: Record<string, any>,
  primaryAddress: string | null | undefined,
  frameworks: WebProjection['frameworks'],
  sites: WebProjection['sites'],
  managedTargets: WebProjection['managedTargets'],
  frameworkSeen: Set<string>,
  siteByKey: Map<string, StandardDeviceDiscoveryV2['sites'][number]>,
  targetByKey: Map<string, StandardDeviceDiscoveryV2['managedTargets'][number]>,
  certificates: WebProjection['certificates'],
  certificateBindings: WebProjection['certificateBindings'],
  certificateByReference: Map<string, StandardDeviceDiscoveryV2['certificates'][number]>,
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
      frameworks.push({ stableKey: frameworkStableKey, frameworkType, displayName: stringValue(framework.displayName) ?? frameworkType, metadata: { source: 'plugin.web-config' } });
    }
    for (const site of parsed.sites) {
      const frameworkType = stringValue(site.frameworkType);
      if (!frameworkType) continue;
      const frameworkStableKey = `framework:${frameworkType}`;
      const normalized = normalizeWebSite(site, frameworkStableKey, primaryAddress, frameworkType);
      if (!normalized) continue;
      addWebSite(normalized, sites, managedTargets, siteByKey, targetByKey, certificates, certificateBindings, certificateByReference);
    }
  }
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
  targetByKey: Map<string, StandardDeviceDiscoveryV2['managedTargets'][number]>,
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
  for (const listener of listenersOf(current)) {
    if (stringValue(listener.protocol)?.toUpperCase() !== 'HTTPS') continue;
    const listenerKey = webListenerKey(current, listener);
    const configuredCertificate = certificateForListener(certificateByReference, listener);
    const deploymentTarget = configuredCertificate ? buildDeploymentTarget(listener, configuredCertificate) : undefined;
    let target = targetByKey.get(listenerKey);
    if (!target) {
      target = {
        stableKey: `TARGET:${current.stableKey}:${listenerKey}`,
        frameworkStableKey: current.frameworkStableKey,
        siteStableKey: current.stableKey,
        targetType: 'tls.binding',
        targetKey: listenerKey,
        supportedCapabilities: ['certificate.deploy', 'certificate.verify', 'certificate.rollback'],
        executionLocations: ['AGENT'],
        metadata: {
          listener: structuredClone(listener),
          ...(deploymentTarget ? { certificateLocation: deploymentTarget } : {}),
        },
      };
      targetByKey.set(listenerKey, target);
      managedTargets.push(target);
    } else if (deploymentTarget) {
      target.metadata = { ...(target.metadata ?? {}), certificateLocation: deploymentTarget, listener: structuredClone(listener) };
    }
    // 只有成熟扫描器从配置路径或 IIS Binding 精确关联到的证书可以成为绑定。
    // TLS 握手、同端口系统绑定和默认站点证书都不能参与这里的关联。
    const certificate = configuredCertificate;
    if (!certificate) continue;
    if (!certificates.some((item) => item.stableKey === certificate.stableKey)) certificates.push(certificate);
    const listenerHost = stringValue(listener.host);
    const listenerPort = numberValue(listener.port);
    const listenerProtocol = stringValue(listener.protocol);
    const listenerCertificatePath = stringValue(listener.certificatePath);
    const listenerCertificateKeyPath = stringValue(listener.certificateKeyPath);
    const listenerCertificateChainPath = stringValue(listener.certificateChainPath);
    const listenerKeystorePath = stringValue(listener.keystorePath);
    const listenerCertificateThumbprint = stringValue(listener.certificateThumbprint);
    const bindingStableKey = `BINDING:${current.stableKey}:${listenerKey}`;
    if (!certificateBindings.some((item) => item.stableKey === bindingStableKey)) {
      certificateBindings.push({
        stableKey: bindingStableKey,
        managedTargetStableKey: target.stableKey,
        certificateStableKey: certificate.stableKey,
        configuredCertificateStableKey: certificate.stableKey,
        ...(deploymentTarget ? { deploymentTarget } : {}),
        bindingName: current.displayName,
        metadata: {
          listenerKey,
          ...(listenerHost ? { listenerHost } : {}),
          ...(listenerPort ? { listenerPort } : {}),
          ...(listenerProtocol ? { listenerProtocol: listenerProtocol.toUpperCase() } : {}),
          ...(listenerCertificatePath ? { certificatePath: listenerCertificatePath } : {}),
          ...(listenerCertificateKeyPath ? { certificateKeyPath: listenerCertificateKeyPath } : {}),
          ...(listenerCertificateChainPath ? { certificateChainPath: listenerCertificateChainPath } : {}),
          ...(listenerKeystorePath ? { keystorePath: listenerKeystorePath } : {}),
          ...(listenerCertificateThumbprint ? { certificateThumbprint: listenerCertificateThumbprint } : {}),
          ...(stringValue(listener.certificateStoreName) ? { certificateStoreName: stringValue(listener.certificateStoreName) } : {}),
          configuredCertificate: certificateMetadata(certificate),
          ...(deploymentTarget ? { certificateLocation: deploymentTarget } : {}),
        },
      });
    }
  }
}

function webListenerKey(site: StandardDeviceDiscoveryV2['sites'][number], listener: Record<string, unknown>): string {
  const identity = [
    site.stableKey,
    stringValue(listener.protocol)?.toUpperCase() ?? 'HTTPS',
    String(numberValue(listener.port) ?? ''),
    stringValue(listener.bindingInformation)?.toLowerCase() ?? '',
    stringValue(listener.host)?.toLowerCase() ?? '',
    stringValue(listener.address)?.toLowerCase() ?? '',
  ].join('|');
  return createHash('sha256').update(identity).digest('hex').slice(0, 24);
}

function certificateForListener(
  index: Map<string, StandardDeviceDiscoveryV2['certificates'][number]>,
  listener: Record<string, unknown>,
): StandardDeviceDiscoveryV2['certificates'][number] | undefined {
  const certificatePath = stringValue(listener.certificatePath);
  if (certificatePath) {
    const certificate = certificateReferenceFromConfig(index, certificatePath, stringValue(listener.sourceConfigPath));
    if (certificate) return certificate;
  }
  const keystorePath = stringValue(listener.keystorePath);
  if (keystorePath) {
    const certificate = certificateReferenceFromConfig(index, keystorePath, stringValue(listener.sourceConfigPath));
    if (certificate) return certificate;
  }
  const thumbprint = stringValue(listener.certificateThumbprint);
  return thumbprint ? certificateReference(index, `thumbprint:${thumbprint}`) : undefined;
}

function certificateMetadata(certificate: StandardDeviceDiscoveryV2['certificates'][number]): Record<string, unknown> {
  const metadata = certificate.metadata ?? {};
  return {
    ...(typeof metadata.path === 'string' && metadata.path ? { path: metadata.path } : {}),
    ...(typeof metadata.source === 'string' && metadata.source ? { source: metadata.source } : {}),
    ...(certificate.sha256Fingerprint ? { fingerprintSha256: certificate.sha256Fingerprint } : {}),
    ...(certificate.subject ? { subject: certificate.subject } : {}),
    ...(certificate.issuer ? { issuer: certificate.issuer } : {}),
    ...(certificate.notBefore ? { notBefore: certificate.notBefore } : {}),
    ...(certificate.notAfter ? { notAfter: certificate.notAfter } : {}),
    ...(typeof metadata.name === 'string' && metadata.name ? { name: metadata.name } : {}),
    ...(typeof metadata.thumbprint === 'string' && metadata.thumbprint ? { thumbprint: metadata.thumbprint } : {}),
  };
}

type DeploymentTarget = NonNullable<StandardDeviceDiscoveryV2['certificateBindings'][number]['deploymentTarget']>;

function buildDeploymentTarget(
  listener: Record<string, unknown>,
  certificate: StandardDeviceDiscoveryV2['certificates'][number],
): DeploymentTarget | undefined {
  const sourceConfigPath = stringValue(listener.sourceConfigPath);
  const rawCertificatePath = stringValue(listener.certificatePath);
  const rawKeystorePath = stringValue(listener.keystorePath);
  const actualPath = stringValue(certificate.metadata?.path);
  const thumbprint = normalizeInventoryThumbprint(stringValue(listener.certificateThumbprint) ?? stringValue(certificate.metadata?.thumbprint));
  const serviceName = stringValue(listener.serviceName);
  const programPath = stringValue(listener.programPath);
  const programSha256 = stringValue(listener.programSha256);
  const workingDirectory = stringValue(listener.workingDirectory);
  const configCheckArgs = stringArrayValue(listener.configCheckArgs);
  const configCheckArgsTemplate = stringArrayValue(listener.configCheckArgsTemplate) ?? configCheckArgs;
  const configFingerprint = stringValue(listener.configFingerprint);
  const runtimeFacts = {
    ...(serviceName ? { serviceName } : {}),
    ...(programPath ? { programPath } : {}),
    ...(programSha256 ? { programSha256 } : {}),
    ...(workingDirectory ? { workingDirectory } : {}),
    ...(configCheckArgs ? { configCheckArgs } : {}),
    ...(configCheckArgsTemplate ? { configCheckArgsTemplate } : {}),
    ...(configFingerprint ? { configFingerprint } : {}),
  };
  if (thumbprint && !rawCertificatePath && !rawKeystorePath) {
    return {
      storageKind: 'WINDOWS_CERTIFICATE_STORE',
      storeName: stringValue(listener.certificateStoreName) ?? stringValue(certificate.metadata?.store) ?? 'My',
      storeLocation: stringValue(listener.certificateStoreLocation) ?? stringValue(certificate.metadata?.storeLocation) ?? 'LocalMachine',
      storeThumbprint: thumbprint,
      ...(sourceConfigPath ? { sourceConfigPath } : {}),
      ...runtimeFacts,
    };
  }
  if (rawKeystorePath) {
    const keystorePath = deployablePath(actualPath, rawKeystorePath, sourceConfigPath);
    if (!keystorePath || /^windows-tls:\/\//i.test(keystorePath)) return undefined;
    return {
      storageKind: 'KEYSTORE',
      keystorePath,
      keystoreType: stringValue(listener.keystoreType) ?? keystoreTypeFromPath(keystorePath) ?? 'UNKNOWN',
      ...(stringValue(listener.keyAlias) ? { keyAlias: stringValue(listener.keyAlias) } : {}),
      ...(sourceConfigPath ? { sourceConfigPath } : {}),
      ...runtimeFacts,
    };
  }
  if (!rawCertificatePath) return undefined;
  const certificatePath = deployablePath(actualPath, rawCertificatePath, sourceConfigPath);
  if (!certificatePath || /^windows-tls:\/\//i.test(certificatePath)) return undefined;
  const target: DeploymentTarget = { storageKind: 'PEM_FILES', certificatePath, ...(sourceConfigPath ? { sourceConfigPath } : {}), ...runtimeFacts };
  const keyPath = stringValue(listener.certificateKeyPath);
  const chainPath = stringValue(listener.certificateChainPath);
  if (keyPath) target.privateKeyPath = deployableSiblingPath(certificatePath, rawCertificatePath, keyPath, sourceConfigPath);
  if (chainPath) target.chainPath = deployableSiblingPath(certificatePath, rawCertificatePath, chainPath, sourceConfigPath);
  return target;
}

function deployablePath(actualPath: string | undefined, configuredPath: string, sourceConfigPath?: string): string | undefined {
  if (actualPath && !/^[a-z][a-z0-9+.-]*:\/\//i.test(actualPath)) return normalizePath(actualPath);
  const normalized = unquoteConfigPath(configuredPath);
  if (isAbsoluteConfigPath(normalized)) return normalized;
  return sourceConfigPath ? joinConfigPath(pathDir(normalizePath(sourceConfigPath)), normalized) : normalized;
}

function deployableSiblingPath(certificatePath: string, configuredCertificatePath: string, siblingPath: string, sourceConfigPath?: string): string | undefined {
  const configured = normalizePath(unquoteConfigPath(configuredCertificatePath));
  const actual = normalizePath(certificatePath);
  const lowerActual = actual.toLowerCase();
  const lowerConfigured = configured.toLowerCase();
  let base = '';
  if (!isAbsoluteConfigPath(configured)) {
    const suffix = `/${lowerConfigured}`;
    const index = lowerActual.endsWith(suffix) ? actual.length - configured.length : -1;
    if (index >= 0) base = actual.slice(0, index).replace(/\/$/, '');
  }
  if (!base && sourceConfigPath) base = pathDir(normalizePath(sourceConfigPath));
  const normalizedSibling = unquoteConfigPath(siblingPath);
  return isAbsoluteConfigPath(normalizedSibling) ? normalizedSibling : joinConfigPath(base, normalizedSibling);
}

function keystoreTypeFromPath(path: string): string | undefined {
  const extension = path.toLowerCase().match(/\.([^.\/]+)$/)?.[1];
  if (extension === 'p12' || extension === 'pfx') return 'PKCS12';
  if (extension === 'jks' || extension === 'keystore') return 'JKS';
  return undefined;
}

function listenersOf(site: StandardDeviceDiscoveryV2['sites'][number]): Array<Record<string, unknown>> {
  const listeners = site.metadata?.listeners;
  return Array.isArray(listeners) ? listeners.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : [];
}

function buildCertificateIndex(inventory: Record<string, any>): Map<string, StandardDeviceDiscoveryV2['certificates'][number]> {
  const index = new Map<string, StandardDeviceDiscoveryV2['certificates'][number]>();
  const files = inventory.certificateFiles;
  if (!Array.isArray(files)) return index;
  for (const entry of files) {
    const value = asRecord(entry); const path = stringValue(value?.path);
    if (!value || !path) continue;
    if (stringValue(value.source) === 'local-tls-handshake' || /^windows-tls:\/\//i.test(path)) continue;
    const reported = certificateFromReportedMetadata(value, path) ?? certificateFromPem(value, path);
    if (!reported) continue;
    index.set(normalizePath(path), reported);
    const thumbprint = certificateThumbprint(value);
    if (thumbprint) index.set(`thumbprint:${thumbprint}`, reported);
    for (const configuredPath of arrayValue(value.configuredPaths) ?? []) {
      const alias = stringValue(configuredPath);
      if (alias) {
        index.set(normalizePath(alias), reported);
      }
    }
  }
  return index;
}

function certificateFromReportedMetadata(value: Record<string, any>, path: string): StandardDeviceDiscoveryV2['certificates'][number] | undefined {
  const fingerprint = stringValue(value.sha256Fingerprint ?? value.fingerprintSha256)?.replace(/[^A-Fa-f0-9]/g, '').toUpperCase();
  const thumbprint = certificateThumbprint(value);
  const subject = stringValue(value.subject);
  const issuer = stringValue(value.issuer);
  const notBefore = validTimestamp(value.notBefore);
  const notAfter = validTimestamp(value.notAfter);
  // 配置中的文件名和 IIS 绑定中的 Thumbprint 都只是引用，不是证书事实。
  // 只有 Agent 已真实读取并解析出完整公开元数据的证书才能进入投影，避免旧的
  // 路径型、裸 Hash 型记录覆盖详情页上的真实证书。
  if (!fingerprint || !/^[A-F0-9]{64}$/.test(fingerprint) || !subject || !issuer || !notBefore || !notAfter) return undefined;
  return {
    stableKey: `CERT:${fingerprint}`,
    sha256Fingerprint: fingerprint,
    subject,
    issuer,
    notBefore,
    notAfter,
    metadata: {
      path,
      ...(stringValue(value.source) ? { source: stringValue(value.source) } : {}),
      ...(thumbprint ? { thumbprint } : {}),
      ...(stringValue(value.store) ? { store: stringValue(value.store) } : {}),
      ...(stringValue(value.storeLocation) ? { storeLocation: stringValue(value.storeLocation) } : {}),
      ...(stringValue(value.name) ? { name: stringValue(value.name) } : {}),
    },
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
  return index.get(normalized);
}

function certificateReferenceFromConfig(
  index: Map<string, StandardDeviceDiscoveryV2['certificates'][number]>,
  certificatePath: string,
  sourceConfigPath?: string,
): StandardDeviceDiscoveryV2['certificates'][number] | undefined {
  for (const candidate of certificatePathCandidates(certificatePath, sourceConfigPath)) {
    const certificate = certificateReference(index, candidate);
    if (certificate) return certificate;
  }
  return undefined;
}

function certificatePathCandidates(certificatePath: string, sourceConfigPath?: string): string[] {
  const normalized = normalizePath(unquoteConfigPath(certificatePath));
  if (!normalized) return [];
  if (isAbsoluteConfigPath(normalized) || !sourceConfigPath) return [normalized];
  const candidates: string[] = [];
  let base = pathDir(normalizePath(sourceConfigPath));
  // 配置相对路径的基准可能是配置目录，也可能是产品的工作目录。Agent 已经只读取
  // 由真实配置引用定位到的证书；这里仅在这些已上报的事实索引里逐级匹配，不读取
  // 宿主文件系统，也不引入预设安装目录。
  for (let depth = 0; base && depth < 8; depth += 1) {
    candidates.push(joinConfigPath(base, normalized));
    const parent = pathDir(base);
    if (!parent || parent === base) break;
    base = parent;
  }
  return [...new Set(candidates.filter(Boolean))];
}

function unquoteConfigPath(value: string): string {
  return value.trim().replace(/^['"]+|['"]+$/g, '').replaceAll('\\', '/');
}

function isAbsoluteConfigPath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:\//.test(value);
}

function pathDir(value: string): string {
  const normalized = normalizePath(value).replace(/\/$/, '');
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : '';
}

function joinConfigPath(base: string, value: string): string {
  if (!base) return '';
  const absolute = base.startsWith('/');
  const segments = `${base}/${value}`.split('/');
  const result: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (result.length > 1 || (result.length === 1 && !/^[A-Za-z]:$/.test(result[0]!))) result.pop();
      continue;
    }
    result.push(segment);
  }
  return `${absolute ? '/' : ''}${result.join('/')}`;
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

function stringValues(value: unknown): string[] {
  return (arrayValue(value) ?? [])
    .map((item) => stringValue(item))
    .filter((item): item is string => Boolean(item));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArrayValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  if (value.some((item) => typeof item !== 'string' || item.trim() === '')) return undefined;
  return value.map((item) => (item as string).trim());
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}
