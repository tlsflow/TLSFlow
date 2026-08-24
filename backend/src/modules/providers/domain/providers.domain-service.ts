import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import { newId } from '../../../shared/id.js';
import type {
  DeploymentDraftBundle,
  DeploymentStepDraft,
  DiscoveryBindingResult,
  DiscoveryCapabilityGapResult,
  DiscoveryCertificateBindingResult,
  DiscoveryEndpointResult,
  DiscoveryExecutionContext,
  DiscoveryHostResult,
  DiscoveryResult,
  DiscoveryResultRecordDto,
  DiscoveryRiskEventResult,
  DiscoverySiteAssetResult,
  DiscoveryServiceAssetResult,
  DiscoveryServiceInstanceResult,
  DiscoveryServiceResult,
  ProviderDescriptor,
  ProviderListItemDto,
  RunDiscoveryInput,
} from '../dto/providers.dto.js';

const hostStatuses = ['ACTIVE', 'INACTIVE', 'UNKNOWN', 'RETIRED'] as const;
const serviceStatuses = ['ACTIVE', 'STALE', 'UNREACHABLE', 'RETIRED'] as const;
const endpointStatuses = ['ACTIVE', 'INACTIVE', 'UNKNOWN'] as const;
const endpointProtocols = ['HTTPS', 'TLS', 'STARTTLS', 'HTTP'] as const;
const sensitiveKeyTokens = new Set([
  'password',
  'passwd',
  'secret',
  'token',
  'privatekey',
  'clientsecret',
  'accesskey',
  'apikey',
  'credential',
]);
const sensitiveValuePattern = /-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}/i;

export class ProvidersDomainService {
  toProviderListItem(descriptor: ProviderDescriptor): ProviderListItemDto {
    return {
      id: descriptor.metadata.id,
      type: descriptor.metadata.type,
      displayName: descriptor.metadata.displayName,
      description: descriptor.metadata.description,
      version: descriptor.metadata.version,
      capabilities: [...descriptor.metadata.capabilities],
      supportedDiscoverySources: [...descriptor.metadata.supportedDiscoverySources],
      supportedStages: [...descriptor.metadata.supportedStages],
      tags: [...descriptor.metadata.tags],
    };
  }

  normalizeRunInput(input: RunDiscoveryInput): Required<Pick<RunDiscoveryInput, 'providerId' | 'source' | 'scope' | 'payload'>> {
    const providerId = normalizeRequiredString(input.providerId, 'providerId');
    return {
      providerId,
      source: input.source ?? 'MANUAL',
      scope: normalizeStringRecord(input.scope ?? {}),
      payload: cloneRecord(input.payload ?? {}),
    };
  }

  normalizeDiscoveryResult(input: DiscoveryResult): DiscoveryResult {
    const discoveredAt = normalizeOptionalString(input.discoveredAt) ?? new Date().toISOString();
    const hosts = dedupeByKey(input.hosts.map((host) => this.normalizeHost(host)), 'host');
    const services = dedupeByKey((input.serviceInstances ?? input.services).map((service) => this.normalizeService(service, hosts)), 'service');
    const endpoints = dedupeByKey(input.endpoints.map((endpoint) => this.normalizeEndpoint(endpoint, services)), 'endpoint');
    const bindings = dedupeByKey((input.certificateBindings ?? input.bindings).map((binding) => this.normalizeBinding(binding, endpoints)), 'binding');
    const serviceAssets = dedupeByKey(this.normalizeServiceAssets(input.serviceAssets, endpoints, bindings), 'serviceAsset');
    const siteAssets = dedupeByKey((input.siteAssets ?? []).map((siteAsset) => this.normalizeSiteAsset(siteAsset, services, serviceAssets)), 'siteAsset');
    const riskEvents = dedupeByKey((input.riskEvents ?? []).map((event) => this.normalizeRiskEvent(event, services, endpoints, serviceAssets, bindings)), 'riskEvent');
    const capabilityGaps = dedupeByKey((input.capabilityGaps ?? []).map((gap) => this.normalizeCapabilityGap(gap, services, endpoints, serviceAssets, bindings)), 'capabilityGap');

    return {
      providerId: normalizeRequiredString(input.providerId, 'providerId'),
      providerType: input.providerType,
      source: input.source,
      discoveredAt,
      scope: normalizeStringRecord(input.scope ?? {}),
      hosts,
      services,
      serviceInstances: services,
      endpoints,
      bindings,
      certificateBindings: bindings,
      serviceAssets,
      siteAssets,
      riskEvents,
      capabilityGaps,
      rawPayload: cloneRecord(input.rawPayload ?? {}),
    };
  }

  assertNoSensitiveFields(result: DiscoveryResult): void {
    scanSensitive(result, []);
  }

  buildDraftBundle(result: DiscoveryResult): DeploymentDraftBundle {
    const steps: DeploymentStepDraft[] = [];

    for (const binding of result.bindings) {
      const endpoint = result.endpoints.find((item) => item.key === binding.endpointKey);
      const service = endpoint ? result.services.find((item) => item.key === endpoint.serviceKey) : undefined;
      const connectId = newId('step');
      const backupId = newId('step');
      const installId = newId('step');
      const verifyId = newId('step');

      steps.push({
        id: connectId,
        title: `连接 ${service?.displayName ?? binding.key}`,
        action: 'CONNECT',
        providerType: result.providerType,
        serviceKey: service?.key,
        endpointKey: endpoint?.key,
        bindingKey: binding.key,
        target: { hostKey: service?.hostKey, serviceKey: service?.key, endpointKey: endpoint?.key, bindingKey: binding.key },
        inputs: { providerId: result.providerId, protocol: endpoint?.protocol, port: endpoint?.port },
        dependsOn: [],
        requiredCapabilities: ['network.connect'],
        riskLevel: 'low',
        idempotencyKey: stableIdempotencyKey(result.providerId, binding.key, 'connect'),
      });
      steps.push({
        id: backupId,
        title: `备份 ${binding.domainName ?? binding.key} 现有绑定`,
        action: 'BACKUP',
        providerType: result.providerType,
        serviceKey: service?.key,
        endpointKey: endpoint?.key,
        bindingKey: binding.key,
        target: { hostKey: service?.hostKey, serviceKey: service?.key, endpointKey: endpoint?.key, bindingKey: binding.key },
        inputs: { configPath: binding.configPath, certificateRef: binding.certificateRef },
        dependsOn: [connectId],
        requiredCapabilities: ['file.read'],
        riskLevel: 'medium',
        idempotencyKey: stableIdempotencyKey(result.providerId, binding.key, 'backup'),
        rollbackHint: '备份产物必须保留到部署验证完成后。',
      });
      steps.push({
        id: installId,
        title: `安装 ${binding.domainName ?? binding.key} 证书`,
        action: 'INSTALL_CERTIFICATE',
        providerType: result.providerType,
        serviceKey: service?.key,
        endpointKey: endpoint?.key,
        bindingKey: binding.key,
        target: { hostKey: service?.hostKey, serviceKey: service?.key, endpointKey: endpoint?.key, bindingKey: binding.key },
        inputs: { bindingType: binding.bindingType, certificateRef: binding.certificateRef, privateKeyRef: binding.privateKeyRef },
        dependsOn: [backupId],
        requiredCapabilities: ['file.write'],
        riskLevel: 'high',
        idempotencyKey: stableIdempotencyKey(result.providerId, binding.key, 'install'),
        rollbackHint: '安装失败后应恢复备份证书和原配置。',
      });
      steps.push({
        id: verifyId,
        title: `校验 ${binding.domainName ?? binding.key} 绑定`,
        action: 'VERIFY_BINDING',
        providerType: result.providerType,
        serviceKey: service?.key,
        endpointKey: endpoint?.key,
        bindingKey: binding.key,
        target: { hostKey: service?.hostKey, serviceKey: service?.key, endpointKey: endpoint?.key, bindingKey: binding.key },
        inputs: { domainName: binding.domainName, endpointHost: endpoint?.hostName, endpointPort: endpoint?.port },
        dependsOn: [installId],
        requiredCapabilities: ['tls.remote_probe'],
        riskLevel: 'medium',
        idempotencyKey: stableIdempotencyKey(result.providerId, binding.key, 'verify'),
      });
    }

    return {
      providerId: result.providerId,
      providerType: result.providerType,
      steps,
      summary: {
        hostCount: result.hosts.length,
        serviceCount: result.services.length,
        endpointCount: result.endpoints.length,
        bindingCount: result.bindings.length,
        stepCount: steps.length,
      },
    };
  }

  buildSnapshotPayload(result: DiscoveryResult, draftBundle: DeploymentDraftBundle): Record<string, unknown> {
    return {
      providerId: result.providerId,
      providerType: result.providerType,
      discoveredAt: result.discoveredAt,
      source: result.source,
      scope: result.scope ?? {},
      topology: {
        hosts: result.hosts,
        services: result.services,
        serviceInstances: result.serviceInstances ?? result.services,
        endpoints: result.endpoints,
        serviceAssets: result.serviceAssets ?? [],
        siteAssets: result.siteAssets ?? [],
        bindings: result.bindings,
        certificateBindings: result.certificateBindings ?? result.bindings,
        riskEvents: result.riskEvents ?? [],
        capabilityGaps: result.capabilityGaps ?? [],
      },
      draftBundle,
    };
  }

  buildNormalizedHash(result: DiscoveryResult): string {
    return createHash('sha256').update(stableStringify({
      providerId: result.providerId,
      providerType: result.providerType,
      source: result.source,
      scope: result.scope ?? {},
      hosts: result.hosts,
      services: result.services,
      serviceInstances: result.serviceInstances ?? result.services,
      endpoints: result.endpoints,
      serviceAssets: result.serviceAssets ?? [],
      siteAssets: result.siteAssets ?? [],
      bindings: result.bindings,
      certificateBindings: result.certificateBindings ?? result.bindings,
      riskEvents: result.riskEvents ?? [],
      capabilityGaps: result.capabilityGaps ?? [],
    })).digest('hex');
  }

  createResultRecord(
    context: DiscoveryExecutionContext,
    normalizedHash: string,
    snapshotId: string,
    result: DiscoveryResult,
    draftBundle: DeploymentDraftBundle,
  ): DiscoveryResultRecordDto {
    const now = new Date().toISOString();
    return {
      id: newId('pdr'),
      tenantId: context.tenantId,
      providerId: result.providerId,
      providerType: result.providerType,
      snapshotId,
      normalizedHash,
      source: result.source,
      status: 'ACCEPTED',
      scope: result.scope ?? {},
      draftBundle,
      result,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
  }

  private normalizeHost(host: DiscoveryHostResult): DiscoveryHostResult {
    const hostname = normalizeRequiredString(host.hostname, 'hostname').toLowerCase();
    return {
      key: normalizeRequiredString(host.key, 'host.key'),
      hostname,
      displayName: normalizeOptionalString(host.displayName),
      primaryIp: normalizeOptionalString(host.primaryIp),
      ipAddresses: normalizeStringArray(host.ipAddresses ?? []),
      osType: normalizeOptionalString(host.osType),
      osName: normalizeOptionalString(host.osName),
      osVersion: normalizeOptionalString(host.osVersion),
      environment: normalizeOptionalString(host.environment),
      zoneId: normalizeOptionalString(host.zoneId),
      tags: normalizeStringArray(host.tags ?? []),
      rawFacts: cloneRecord(host.rawFacts ?? {}),
    };
  }

  private normalizeService(service: DiscoveryServiceResult, hosts: DiscoveryHostResult[]): DiscoveryServiceResult {
    if (!hosts.some((host) => host.key === service.hostKey)) {
      throw new AppError('VALIDATION_FAILED', 'service.hostKey 未找到对应 host', { hostKey: service.hostKey, serviceKey: service.key });
    }
    return {
      key: normalizeRequiredString(service.key, 'service.key'),
      hostKey: normalizeRequiredString(service.hostKey, 'service.hostKey'),
      providerType: service.providerType,
      serviceName: normalizeOptionalString(service.serviceName)?.toLowerCase(),
      displayName: normalizeRequiredString(service.displayName, 'service.displayName'),
      versionText: normalizeOptionalString(service.versionText),
      installPath: normalizeOptionalString(service.installPath),
      configPath: normalizeOptionalString(service.configPath),
      runtimeUser: normalizeOptionalString(service.runtimeUser),
      status: normalizeStatus(service.status, serviceStatuses, 'ACTIVE'),
      rawFacts: cloneRecord(service.rawFacts ?? {}),
    };
  }

  private normalizeEndpoint(endpoint: DiscoveryEndpointResult, services: DiscoveryServiceResult[]): DiscoveryEndpointResult {
    if (!services.some((service) => service.key === endpoint.serviceKey)) {
      throw new AppError('VALIDATION_FAILED', 'endpoint.serviceKey 未找到对应 service', { serviceKey: endpoint.serviceKey, endpointKey: endpoint.key });
    }
    const port = endpoint.port;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new AppError('VALIDATION_FAILED', 'endpoint.port 必须在 1 到 65535 之间', { endpointKey: endpoint.key, port });
    }
    return {
      key: normalizeRequiredString(endpoint.key, 'endpoint.key'),
      serviceKey: normalizeRequiredString(endpoint.serviceKey, 'endpoint.serviceKey'),
      protocol: normalizeEnum(endpoint.protocol, endpointProtocols, 'endpoint.protocol'),
      hostName: normalizeOptionalString(endpoint.hostName)?.toLowerCase(),
      listenIp: normalizeOptionalString(endpoint.listenIp),
      port,
      pathHint: normalizeOptionalString(endpoint.pathHint),
      status: normalizeStatus(endpoint.status, endpointStatuses, 'ACTIVE'),
      rawFacts: cloneRecord(endpoint.rawFacts ?? {}),
    };
  }

  private normalizeBinding(binding: DiscoveryCertificateBindingResult, endpoints: DiscoveryEndpointResult[]): DiscoveryBindingResult {
    if (!endpoints.some((endpoint) => endpoint.key === binding.endpointKey)) {
      throw new AppError('VALIDATION_FAILED', 'binding.endpointKey 未找到对应 endpoint', { endpointKey: binding.endpointKey, bindingKey: binding.key });
    }
    return {
      key: normalizeRequiredString(binding.key, 'binding.key'),
      endpointKey: normalizeRequiredString(binding.endpointKey, 'binding.endpointKey'),
      bindingType: normalizeRequiredString(binding.bindingType, 'binding.bindingType'),
      domainName: normalizeOptionalString(binding.domainName)?.toLowerCase(),
      certificateRef: normalizeOptionalString(binding.certificateRef),
      privateKeyRef: normalizeOptionalString(binding.privateKeyRef),
      configPath: normalizeOptionalString(binding.configPath),
      rawFacts: cloneRecord(binding.rawFacts ?? {}),
    };
  }

  private normalizeServiceAssets(
    explicitAssets: DiscoveryServiceAssetResult[] | undefined,
    endpoints: DiscoveryEndpointResult[],
    bindings: DiscoveryBindingResult[],
  ): DiscoveryServiceAssetResult[] {
    const assets = explicitAssets && explicitAssets.length > 0 ? explicitAssets : projectServiceAssetsFromEndpoints(endpoints, bindings);
    return assets.map((asset) => this.normalizeServiceAsset(asset, endpoints));
  }

  private normalizeServiceAsset(asset: DiscoveryServiceAssetResult, endpoints: DiscoveryEndpointResult[]): DiscoveryServiceAssetResult {
    if (!endpoints.some((endpoint) => endpoint.serviceKey === asset.serviceKey)) {
      throw new AppError('VALIDATION_FAILED', 'serviceAsset.serviceKey ????? service', { serviceAssetKey: asset.key, serviceKey: asset.serviceKey });
    }
    if (asset.endpointKey && !endpoints.some((endpoint) => endpoint.key === asset.endpointKey)) {
      throw new AppError('VALIDATION_FAILED', 'serviceAsset.endpointKey ????? endpoint', { serviceAssetKey: asset.key, endpointKey: asset.endpointKey });
    }
    const port = asset.port;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new AppError('VALIDATION_FAILED', 'serviceAsset.port ??? 1 ? 65535 ??', { serviceAssetKey: asset.key, port });
    }
    const address = normalizeRequiredString(asset.address, 'serviceAsset.address').toLowerCase();
    return {
      key: normalizeRequiredString(asset.key, 'serviceAsset.key'),
      serviceKey: normalizeRequiredString(asset.serviceKey, 'serviceAsset.serviceKey'),
      endpointKey: normalizeOptionalString(asset.endpointKey),
      address,
      addressType: normalizeAddressType(asset.addressType, address),
      port,
      protocol: normalizeEnum(asset.protocol, endpointProtocols, 'serviceAsset.protocol'),
      sniName: normalizeOptionalString(asset.sniName)?.toLowerCase(),
      displayName: normalizeOptionalString(asset.displayName),
      status: normalizeStatus(asset.status, ['ACTIVE', 'INACTIVE', 'UNKNOWN', 'STALE', 'DISABLED', 'RETIRED'] as const, 'ACTIVE'),
      rawFacts: cloneRecord(asset.rawFacts ?? {}),
    };
  }

  private normalizeSiteAsset(
    asset: DiscoverySiteAssetResult,
    services: DiscoveryServiceResult[],
    serviceAssets: DiscoveryServiceAssetResult[],
  ): DiscoverySiteAssetResult {
    if (!services.some((service) => service.key === asset.serviceKey)) {
      throw new AppError('VALIDATION_FAILED', 'siteAsset.serviceKey 未找到对应 service', { siteAssetKey: asset.key, serviceKey: asset.serviceKey });
    }
    if (asset.serviceAssetKey && !serviceAssets.some((serviceAsset) => serviceAsset.key === asset.serviceAssetKey)) {
      throw new AppError('VALIDATION_FAILED', 'siteAsset.serviceAssetKey 未找到对应 serviceAsset', { siteAssetKey: asset.key, serviceAssetKey: asset.serviceAssetKey });
    }
    const port = asset.port;
    if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      throw new AppError('VALIDATION_FAILED', 'siteAsset.port 必须在 1 到 65535 之间', { siteAssetKey: asset.key, port });
    }
    return {
      key: normalizeRequiredString(asset.key, 'siteAsset.key'),
      serviceKey: normalizeRequiredString(asset.serviceKey, 'siteAsset.serviceKey'),
      serviceAssetKey: normalizeOptionalString(asset.serviceAssetKey),
      agentKey: normalizeOptionalString(asset.agentKey),
      siteType: normalizeEnum(asset.siteType, ['WEB_SITE', 'VHOST', 'CONNECTOR', 'CUSTOM'] as const, 'siteAsset.siteType'),
      siteName: normalizeRequiredString(asset.siteName, 'siteAsset.siteName'),
      siteKey: normalizeOptionalString(asset.siteKey),
      bindingInformation: normalizeOptionalString(asset.bindingInformation),
      hostHeader: normalizeOptionalString(asset.hostHeader)?.toLowerCase(),
      listenIp: normalizeOptionalString(asset.listenIp),
      port,
      protocol: asset.protocol === undefined ? undefined : normalizeEnum(asset.protocol, endpointProtocols, 'siteAsset.protocol'),
      configPath: normalizeOptionalString(asset.configPath),
      runtimeStatus: normalizeOptionalString(asset.runtimeStatus),
      status: normalizeStatus(asset.status, ['ACTIVE', 'INACTIVE', 'UNKNOWN', 'STALE', 'DISABLED', 'RETIRED'] as const, 'ACTIVE'),
      rawFacts: cloneRecord(asset.rawFacts ?? {}),
    };
  }

  private normalizeRiskEvent(
    event: DiscoveryRiskEventResult,
    services: DiscoveryServiceResult[],
    endpoints: DiscoveryEndpointResult[],
    serviceAssets: DiscoveryServiceAssetResult[],
    bindings: DiscoveryBindingResult[],
  ): DiscoveryRiskEventResult {
    assertKeyRef(event.serviceKey, services, 'riskEvent.serviceKey', event.key);
    assertKeyRef(event.endpointKey, endpoints, 'riskEvent.endpointKey', event.key);
    assertKeyRef(event.serviceAssetKey, serviceAssets, 'riskEvent.serviceAssetKey', event.key);
    assertKeyRef(event.bindingKey, bindings, 'riskEvent.bindingKey', event.key);
    return {
      key: normalizeRequiredString(event.key, 'riskEvent.key'),
      severity: normalizeEnum(event.severity, ['low', 'medium', 'high', 'critical'] as const, 'riskEvent.severity'),
      category: normalizeRequiredString(event.category, 'riskEvent.category'),
      message: normalizeRequiredString(event.message, 'riskEvent.message'),
      serviceKey: normalizeOptionalString(event.serviceKey),
      endpointKey: normalizeOptionalString(event.endpointKey),
      serviceAssetKey: normalizeOptionalString(event.serviceAssetKey),
      bindingKey: normalizeOptionalString(event.bindingKey),
      rawFacts: cloneRecord(event.rawFacts ?? {}),
    };
  }

  private normalizeCapabilityGap(
    gap: DiscoveryCapabilityGapResult,
    services: DiscoveryServiceResult[],
    endpoints: DiscoveryEndpointResult[],
    serviceAssets: DiscoveryServiceAssetResult[],
    bindings: DiscoveryBindingResult[],
  ): DiscoveryCapabilityGapResult {
    assertKeyRef(gap.serviceKey, services, 'capabilityGap.serviceKey', gap.key);
    assertKeyRef(gap.endpointKey, endpoints, 'capabilityGap.endpointKey', gap.key);
    assertKeyRef(gap.serviceAssetKey, serviceAssets, 'capabilityGap.serviceAssetKey', gap.key);
    assertKeyRef(gap.bindingKey, bindings, 'capabilityGap.bindingKey', gap.key);
    return {
      key: normalizeRequiredString(gap.key, 'capabilityGap.key'),
      capability: normalizeRequiredString(gap.capability, 'capabilityGap.capability'),
      reason: normalizeRequiredString(gap.reason, 'capabilityGap.reason'),
      providerStrategy: normalizeOptionalString(gap.providerStrategy) as DiscoveryCapabilityGapResult['providerStrategy'],
      serviceKey: normalizeOptionalString(gap.serviceKey),
      endpointKey: normalizeOptionalString(gap.endpointKey),
      serviceAssetKey: normalizeOptionalString(gap.serviceAssetKey),
      bindingKey: normalizeOptionalString(gap.bindingKey),
      rawFacts: cloneRecord(gap.rawFacts ?? {}),
    };
  }
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeRequiredString(value: string | undefined, field: string): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new AppError('VALIDATION_FAILED', `${field} 不能为空`, { field });
  }
  return normalized;
}

function normalizeStringArray(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function normalizeStringRecord(input: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input)
      .map(([key, value]) => [key.trim(), value.trim()] as const)
      .filter(([key, value]) => key && value),
  );
}

function normalizeStatus<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  if (value === undefined) return fallback;
  return normalizeEnum(value, allowed, 'status');
}

function normalizeEnum<T extends string>(value: string, allowed: readonly T[], field: string): T {
  if (!allowed.includes(value as T)) {
    throw new AppError('VALIDATION_FAILED', `${field} 枚举值不合法`, { field, allowedValues: allowed });
  }
  return value as T;
}

function dedupeByKey<T extends { key: string }>(items: T[], label: string): T[] {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const item of items) {
    if (seen.has(item.key)) {
      throw new AppError('VALIDATION_FAILED', `${label}.key 重复`, { key: item.key });
    }
    seen.add(item.key);
    output.push(item);
  }
  return output;
}

function cloneRecord(input: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(input));
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function stableIdempotencyKey(providerId: string, bindingKey: string, action: string): string {
  return createHash('sha256').update(`${providerId}:${bindingKey}:${action}`).digest('hex').slice(0, 24);
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortValue(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortValue(child)]),
  );
}

function normalizeAddressType(value: DiscoveryServiceAssetResult['addressType'], address: string): NonNullable<DiscoveryServiceAssetResult['addressType']> {
  if (value !== undefined) return normalizeEnum(value, ['DNS', 'IPV4', 'IPV6', 'UNKNOWN'] as const, 'serviceAsset.addressType');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) return 'IPV4';
  if (address.includes(':')) return 'IPV6';
  return 'DNS';
}

function projectServiceAssetsFromEndpoints(endpoints: DiscoveryEndpointResult[], bindings: DiscoveryBindingResult[]): DiscoveryServiceAssetResult[] {
  const assets: DiscoveryServiceAssetResult[] = [];
  for (const endpoint of endpoints) {
    const endpointBindings = bindings.filter((binding) => binding.endpointKey === endpoint.key);
    if (endpointBindings.length === 0) {
      const address = endpoint.hostName ?? endpoint.listenIp;
      if (!address) continue;
      assets.push(buildProjectedServiceAsset(endpoint, address));
      continue;
    }
    for (const binding of endpointBindings) {
      const address = binding.domainName ?? endpoint.hostName ?? endpoint.listenIp;
      if (!address) continue;
      assets.push(buildProjectedServiceAsset(endpoint, address, binding));
    }
  }
  return assets;
}

function buildProjectedServiceAsset(
  endpoint: DiscoveryEndpointResult,
  address: string,
  binding?: DiscoveryBindingResult,
): DiscoveryServiceAssetResult {
  const normalizedAddress = address.trim().toLowerCase();
  return {
    key: 'service-asset:' + endpoint.key + ':' + normalizedAddress + ':' + String(endpoint.port),
    serviceKey: endpoint.serviceKey,
    endpointKey: endpoint.key,
    address: normalizedAddress,
    addressType: normalizeAddressType(undefined, normalizedAddress),
    port: endpoint.port,
    protocol: normalizeEnum(endpoint.protocol, endpointProtocols, 'serviceAsset.protocol'),
    sniName: binding?.domainName?.trim().toLowerCase(),
    displayName: normalizedAddress,
    status: normalizeStatus(endpoint.status, ['ACTIVE', 'INACTIVE', 'UNKNOWN', 'STALE', 'DISABLED', 'RETIRED'] as const, 'ACTIVE'),
    rawFacts: cloneRecord({
      projectedFrom: 'endpoint',
      endpointHostName: endpoint.hostName,
      endpointListenIp: endpoint.listenIp,
      bindingKey: binding?.key,
    }),
  };
}

function assertKeyRef<T extends { key: string }>(value: string | undefined, items: T[], field: string, key: string): void {
  if (!value) return;
  if (!items.some((item) => item.key === value)) {
    throw new AppError('VALIDATION_FAILED', field + ' ???????', { field, key, ref: value });
  }
}

function scanSensitive(value: unknown, path: string[]): void {
  if (typeof value === 'string') {
    if (sensitiveValuePattern.test(value)) {
      throw new AppError('VALIDATION_FAILED', '发现结果包含敏感值', { fieldPath: path.join('.') });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanSensitive(item, [...path, String(index)]));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key) && child !== undefined && child !== null && child !== '') {
      throw new AppError('VALIDATION_FAILED', '发现结果包含敏感字段', { fieldPath: [...path, key].join('.') });
    }
    scanSensitive(child, [...path, key]);
  }
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (!normalized) return false;
  if (normalized.endsWith('ref')) return false;
  return sensitiveKeyTokens.has(normalized);
}
