import { AppError } from '../../../common/errors/app-error.js';
import type { ManagedDeviceDetailDto, ManagedDeviceListQuery, ManagedDevicePageDto } from '../dto/devices.dto.js';
import type { DeviceOnboardingPlatformDescriptor } from '../dto/devices.dto.js';
import { DevicePlatformRegistry } from '../domain/device-platform.registry.js';
import type { AgentsApplicationService } from '../../agents/application/agents.application-service.js';
import type { AgentDetailProjection } from '../../agents/dto/agents.dto.js';
import type { DeviceAssetsApplicationService } from '../../device-assets/application/device-assets.application-service.js';
import type { SecretService } from '../../secrets/secret.service.js';
import type { CreateManagedDeviceOnboardingDto } from '../dto/devices.dto.js';
import { PgDevicesRepository, type DevicesRepository } from '../repository/devices.repository.js';

export class DevicesApplicationService {
  constructor(
    private readonly repository: DevicesRepository = new PgDevicesRepository(),
    private readonly platformRegistry = new DevicePlatformRegistry(),
    private readonly agents?: AgentsApplicationService,
    private readonly deviceAssets?: DeviceAssetsApplicationService,
    private readonly secrets?: SecretService,
  ) {}

  list(tenantId: string, query: ManagedDeviceListQuery): Promise<ManagedDevicePageDto> {
    return this.repository.list(tenantId, query);
  }

  async get(tenantId: string, deviceId: string): Promise<ManagedDeviceDetailDto> {
    const device = await this.repository.get(tenantId, deviceId);
    if (!device) throw new AppError('RESOURCE_NOT_FOUND', '设备不存在', { deviceId });
    if (device.extension.type === 'AGENT' && device.extension.agentId && this.agents) {
      return enrichAgentDetail(device, await this.agents.getAgentDetail(tenantId, device.extension.agentId));
    }
    return device;
  }

  listOnboardingPlatforms(): DeviceOnboardingPlatformDescriptor[] {
    return this.platformRegistry.list();
  }

  async onboard(tenantId: string, input: CreateManagedDeviceOnboardingDto, actorId: string, requestId: string) {
    const platform = this.platformRegistry.requireSupported(input.platformKey);
    if (platform.onboardingKind === 'AGENT_INSTALL') {
      if (!this.agents) throw new AppError('CAPABILITY_MISSING', 'Agent 安装服务未注册');
      const baseUrl = input.baseUrl?.trim();
      if (!baseUrl) throw new AppError('VALIDATION_FAILED', 'Agent 安装需要 baseUrl', { field: 'baseUrl' });
      const options = {};
      const installSession = platform.handlerKey === 'WINDOWS_GO'
        ? await this.agents.createWindowsPowerShellInstallSession(tenantId, options, requestId, baseUrl)
        : platform.handlerKey === 'WINDOWS_COMPATIBILITY'
          ? await this.agents.createWindowsCompatibilityInstallSession(tenantId, options, requestId, baseUrl)
          : await this.agents.createLinuxGoInstallSession(tenantId, options, requestId, baseUrl);
      return { ...installSession, onboardingKind: 'AGENT_INSTALL' as const, installSession };
    }
    if (!this.deviceAssets || !this.secrets) throw new AppError('CAPABILITY_MISSING', '设备添加服务未注册');
    if (input.tlsVerify === false && input.insecureTlsAcknowledged !== true) {
      throw new AppError('VALIDATION_FAILED', '关闭 TLS 验证必须显式确认高风险', { field: 'insecureTlsAcknowledged' });
    }
    const credentialId = input.credentialId ?? await this.createCredential(tenantId, input, actorId);
    const device = await this.deviceAssets.create(tenantId, {
      displayName: required(input.displayName, 'displayName'),
      managementAddress: required(input.managementAddress, 'managementAddress'),
      managementPort: input.managementPort,
      deviceFamily: 'NETSCALER_ADC',
      credentialId,
      authMode: input.authMode,
      tlsVerify: input.tlsVerify,
    });
    try {
      const connection = await this.deviceAssets.testConnection(tenantId, device.id, actorId);
      return { onboardingKind: 'API_CONNECTION' as const, device, connection };
    } catch (cause) {
      return {
        onboardingKind: 'API_CONNECTION' as const,
        device,
        connection: {
          reachable: false,
          authenticated: false,
          productMatched: false,
          capabilities: {},
          warnings: [],
          errorCode: connectionErrorCode(cause),
        },
      };
    }
  }

  private async createCredential(tenantId: string, input: CreateManagedDeviceOnboardingDto, actorId: string): Promise<string> {
    const username = required(input.username, 'username');
    const password = required(input.password, 'password');
    const secret = await this.secrets!.create({
      name: `Citrix ADC ${input.displayName ?? input.managementAddress ?? ''}`.trim(),
      type: 'password',
      scopeType: 'team',
      scopeId: tenantId,
      plainText: JSON.stringify({ username, password }),
      createdBy: actorId,
      metadata: { purpose: 'netscaler.nitro.credentials' },
    });
    return secret.secretRef;
  }
}

function connectionErrorCode(cause: unknown): string {
  if (cause instanceof AppError) return cause.errorCode;
  if (cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string') return cause.code;
  return 'CONNECTION_TEST_FAILED';
}

function enrichAgentDetail(device: ManagedDeviceDetailDto, projection: AgentDetailProjection): ManagedDeviceDetailDto {
  const { agent, latestHeartbeat, health, taskQueue, upgradeSuggestion } = projection;
  const descriptor = agent.descriptor;
  const capabilitySites = buildAgentCapabilitySites(projection);
  const agentSection = {
    key: 'agent',
    fields: [
      { key: 'agentId', value: agent.id, valueType: 'TEXT' as const, copyable: true },
      { key: 'agentKey', value: agent.agentKey, valueType: 'TEXT' as const, copyable: true },
      { key: 'hostname', value: descriptor.hostname, valueType: 'TEXT' as const, copyable: true },
      { key: 'agentVersion', value: descriptor.version, valueType: 'TEXT' as const },
      { key: 'osType', value: descriptor.osType, valueType: 'TEXT' as const },
      { key: 'osVersion', value: descriptor.osVersion ?? null, valueType: 'TEXT' as const },
      { key: 'architecture', value: descriptor.arch ?? null, valueType: 'TEXT' as const },
      { key: 'ipAddress', value: descriptor.ipAddress ?? null, valueType: 'TEXT' as const, copyable: true },
      { key: 'agentRole', value: agent.role ?? null, valueType: 'TEXT' as const },
      { key: 'agentStatus', value: agent.status, valueType: 'STATUS' as const },
      { key: 'registeredAt', value: agent.registeredAt, valueType: 'DATETIME' as const },
      { key: 'lastHeartbeatAt', value: latestHeartbeat?.receivedAt ?? health.lastHeartbeatAt ?? null, valueType: 'DATETIME' as const },
    ],
  };
  const runtimeSection = {
    key: 'runtime',
    fields: [
      { key: 'healthStatus', value: health.status, valueType: 'STATUS' as const },
      { key: 'offline', value: health.offline, valueType: 'BOOLEAN' as const },
      { key: 'pendingTaskCount', value: taskQueue.counts.queued, valueType: 'NUMBER' as const },
      { key: 'runningTaskCount', value: taskQueue.counts.leased + taskQueue.counts.acked, valueType: 'NUMBER' as const },
      { key: 'upgradeStatus', value: upgradeSuggestion.suggestion.status, valueType: 'STATUS' as const },
      { key: 'targetVersion', value: upgradeSuggestion.suggestion.targetVersion ?? null, valueType: 'TEXT' as const },
    ],
  };
  const runtimeLogs = projection.runtimeLogs.map((log) => ({
    id: log.id,
    eventType: `agent.${log.category}`,
    result: log.level,
    summary: log.summary,
    occurredAt: log.emittedAt,
    actorId: agent.id,
    metadata: { category: log.category, level: log.level, requestId: log.requestId, redacted: log.redacted },
  }));
  const errorLogs = projection.recentErrors.map((log) => ({
    id: log.id,
    eventType: 'agent.task.error',
    result: log.level,
    summary: log.message,
    occurredAt: log.emittedAt,
    actorId: agent.id,
    metadata: { taskId: log.taskId, requestId: log.requestId, redacted: log.redacted },
  }));
  return {
    ...device,
    overview: {
      ...device.overview,
      deviceType: 'AGENT',
      managementMode: 'AGENT',
      status: device.health,
      updatedAt: agent.updatedAt,
    },
    informationSections: [device.informationSections[0] ?? { key: 'common', fields: [] }, agentSection, runtimeSection],
    sites: mergeAgentSites(device.sites, capabilitySites),
    logs: [...runtimeLogs, ...errorLogs].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)),
    extension: { type: 'AGENT', agentId: agent.id, agentType: agent.role },
    extensionSummary: {
      ...device.extensionSummary,
      agentId: agent.id,
      descriptor,
    },
  };
}

function buildAgentCapabilitySites(projection: AgentDetailProjection): ManagedDeviceDetailDto['sites'] {
  const capabilities = projection.capabilitySnapshot?.capabilities ?? projection.capabilities.declarations;
  const values = new Map(capabilities.map((item) => [item.capabilityKey, item.value]));
  const sites: ManagedDeviceDetailDto['sites'] = [];
  appendIisSites(sites, values.get('windows.iis.sites') ?? recordValue(values.get('windows.iis.detail'), 'Sites'));
  appendLinuxSites(sites, 'NGINX', values.get('linux.nginx.detail'));
  appendLinuxSites(sites, 'APACHE', values.get('linux.apache.detail'));
  appendTomcatSites(sites, values.get('linux.tomcat.detail'));
  return sites;
}

function appendIisSites(sites: ManagedDeviceDetailDto['sites'], raw: unknown): void {
  for (const site of objectList(raw)) {
    const name = textValue(site, 'Name') || textValue(site, 'name');
    if (!name) continue;
    const bindings = objectList(site.Bindings ?? site.bindings).map((binding, index) => ({
      id: `agent-site-binding:iis:${name}:${index}`,
      bindingKey: textValue(binding, 'BindingInformation') || textValue(binding, 'bindingInformation') || `iis:${name}:${index}`,
      bindingType: 'IIS_BINDING',
      hostName: textValue(binding, 'HostHeader') || textValue(binding, 'hostHeader') || undefined,
      status: textValue(site, 'State') || textValue(site, 'state') || 'UNKNOWN',
      certificate: capabilityCertificate(binding),
      replacement: { allowed: false, reasonCode: 'AGENT_DISCOVERY_ONLY' },
    }));
    const firstBinding = objectList(site.Bindings ?? site.bindings)[0];
    sites.push({
      id: `agent-site:iis:${name}`,
      siteAssetId: `agent-site:iis:${name}`,
      kind: 'IIS',
      name,
      status: textValue(site, 'State') || textValue(site, 'state') || undefined,
      endpoint: firstBinding ? {
        address: textValue(firstBinding, 'IPAddress') || textValue(firstBinding, 'ipAddress') || undefined,
        hostName: textValue(firstBinding, 'HostHeader') || textValue(firstBinding, 'hostHeader') || undefined,
        port: numberValue(firstBinding, 'Port') ?? numberValue(firstBinding, 'port'),
        protocol: textValue(firstBinding, 'Protocol') || textValue(firstBinding, 'protocol') || undefined,
      } : undefined,
      configPath: textValue(site, 'PhysicalPath') || textValue(site, 'physicalPath') || undefined,
      bindings,
      metadata: { source: 'agent_capability_snapshot', appPool: textValue(site, 'AppPool') || textValue(site, 'appPool') },
    });
  }
}

function appendLinuxSites(sites: ManagedDeviceDetailDto['sites'], kind: 'NGINX' | 'APACHE', raw: unknown): void {
  const detail = asRecord(raw);
  const capabilitySites = objectList(detail.Sites ?? detail.sites);
  for (const [siteIndex, site] of capabilitySites.entries()) {
    const name = textValue(site, 'Name') || textValue(site, 'name') || textValue(site, 'ServerNames') || textValue(site, 'serverNames') || `${kind} site ${sites.length + 1}`;
    const rawBindings = site.Bindings ?? site.bindings ?? site.Listen ?? site.listen;
    const bindings = objectList(rawBindings).map((binding, index) => ({
      id: `agent-site-binding:${kind.toLowerCase()}:${name}:${index}`,
      bindingKey: textValue(binding, 'BindingInformation') || textValue(binding, 'bindingInformation') || `${kind.toLowerCase()}:${name}:${index}`,
      bindingType: 'LISTEN',
      hostName: textValue(binding, 'Address') || textValue(binding, 'address') || undefined,
      status: 'UNKNOWN',
      certificate: capabilityCertificate(binding),
      replacement: { allowed: false, reasonCode: 'AGENT_DISCOVERY_ONLY' },
    }));
    const firstBinding = objectList(rawBindings)[0];
    sites.push({
      id: `agent-site:${kind.toLowerCase()}:${siteIndex}:${name}`,
      siteAssetId: `agent-site:${kind.toLowerCase()}:${siteIndex}:${name}`,
      kind,
      name,
      endpoint: firstBinding ? {
        address: textValue(firstBinding, 'Address') || textValue(firstBinding, 'address') || undefined,
        port: numberValue(firstBinding, 'Port') ?? numberValue(firstBinding, 'port'),
        protocol: textValue(firstBinding, 'Protocol') || textValue(firstBinding, 'protocol') || undefined,
      } : undefined,
      configPath: textValue(site, 'SitePath') || textValue(site, 'sitePath') || undefined,
      bindings,
      metadata: { source: 'agent_capability_snapshot' },
    });
  }
}

function appendTomcatSites(sites: ManagedDeviceDetailDto['sites'], raw: unknown): void {
  const detail = asRecord(raw);
  for (const connector of objectList(detail.Connectors ?? detail.connectors)) {
    const port = numberValue(connector, 'Port') ?? numberValue(connector, 'port');
    const protocol = textValue(connector, 'Protocol') || textValue(connector, 'protocol') || 'HTTP';
    const name = textValue(connector, 'Name') || textValue(connector, 'name') || `Tomcat ${protocol}:${port ?? sites.length + 1}`;
    const address = textValue(connector, 'Address') || textValue(connector, 'address') || undefined;
    const bindingKey = `${address ?? '*'}:${port ?? 0}:${protocol}`;
    sites.push({
      id: `agent-site:tomcat:${name}`,
      siteAssetId: `agent-site:tomcat:${name}`,
      kind: 'TOMCAT',
      name,
      endpoint: { address, port, protocol },
      configPath: textValue(detail, 'ConfigPath') || textValue(detail, 'configPath') || undefined,
      bindings: [{
        id: `agent-site-binding:tomcat:${bindingKey}`,
        bindingKey,
        bindingType: 'CONNECTOR',
        hostName: address,
        status: 'UNKNOWN',
        certificate: capabilityCertificate(connector),
        replacement: { allowed: false, reasonCode: 'AGENT_DISCOVERY_ONLY' },
      }],
      metadata: { source: 'agent_capability_snapshot' },
    });
  }
}

function capabilityCertificate(binding: Record<string, unknown>): ManagedDeviceDetailDto['sites'][number]['bindings'][number]['certificate'] {
  const certificate = asRecord(binding.Certificate ?? binding.certificate);
  const fingerprint = textValue(certificate, 'FingerprintSHA256')
    || textValue(certificate, 'fingerprintSha256')
    || textValue(certificate, 'Thumbprint')
    || textValue(certificate, 'thumbprint')
    || textValue(binding, 'CertificateThumbprint')
    || textValue(binding, 'certificateThumbprint');
  const subject = textValue(certificate, 'Subject') || textValue(certificate, 'subject');
  const name = textValue(binding, 'CertificateName') || textValue(binding, 'certificateName');
  if (!fingerprint && !subject && !name) return undefined;
  return {
    name: name || undefined,
    subject: subject || undefined,
    issuer: textValue(certificate, 'Issuer') || textValue(certificate, 'issuer') || undefined,
    notBefore: textValue(certificate, 'NotBefore') || textValue(certificate, 'notBefore') || undefined,
    notAfter: textValue(certificate, 'NotAfter') || textValue(certificate, 'notAfter') || undefined,
    fingerprintSha256: fingerprint || undefined,
  };
}

function mergeAgentSites(existing: ManagedDeviceDetailDto['sites'], discovered: ManagedDeviceDetailDto['sites']): ManagedDeviceDetailDto['sites'] {
  const result = [...existing];
  for (const site of discovered) {
    if (!result.some((item) => siteIdentity(item) === siteIdentity(site))) result.push(site);
  }
  return result;
}

function siteIdentity(site: ManagedDeviceDetailDto['sites'][number]): string {
  return [site.kind, site.name, site.configPath, site.endpoint?.address, site.endpoint?.hostName, site.endpoint?.port, site.endpoint?.protocol]
    .map((value) => String(value ?? '').toLowerCase())
    .join('|');
}

function recordValue(value: unknown, key: string): unknown {
  return asRecord(value)[key];
}

function objectList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function textValue(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return value === undefined || value === null ? '' : String(value).trim();
}

function numberValue(record: Record<string, unknown>, key: string): number | undefined {
  const value = Number(record[key]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function required(value: string | undefined, field: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new AppError('VALIDATION_FAILED', `${field} 不能为空`, { field });
  return normalized;
}
