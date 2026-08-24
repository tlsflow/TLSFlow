import { AppError } from '../../../common/errors/app-error.js';
import {
  CompatibilityLevels,
  ManagementModes,
  OsTypes,
  ProviderTypes,
  type CompatibilityLevel,
  type ManagementMode,
  type OsType,
  type ProviderType,
} from '../../../shared/enums/core.enums.js';
import type {
  CreateHostDto,
  CreateDiscoverySnapshotDto,
  CreateServiceAssetDto,
  CreateServiceEndpointDto,
  CreateServiceInstanceDto,
  CreateManagedTargetDto,
  CreateApplicationAssetTargetDto,
  CreateSiteAssetDto,
  DiscoverySource,
  HostStatus,
  ManagedTargetStatus,
  ManagedTargetType,
  ApplicationAssetTargetStatus,
  ServiceEndpointProtocol,
  ServiceEndpointStatus,
  ServiceAssetPlatform,
  ServiceAssetStatus,
  ServiceInstanceStatus,
  SiteAssetStatus,
  SiteAssetType,
  UpdateHostDto,
  UpdateManagedTargetDto,
  UpdateApplicationAssetTargetDto,
  UpdateServiceAssetDto,
  UpdateServiceEndpointDto,
  UpdateServiceInstanceDto,
  UpdateSiteAssetDto,
} from '../dto/assets.dto.js';

const hostStatuses = ['ACTIVE', 'INACTIVE', 'UNKNOWN', 'STALE', 'DISABLED', 'RETIRED', 'DELETED'] as const;
const serviceInstanceStatuses = ['ACTIVE', 'STALE', 'UNREACHABLE', 'DISABLED', 'RETIRED', 'DELETED'] as const;
const serviceAssetStatuses = ['ACTIVE', 'INACTIVE', 'UNKNOWN', 'STALE', 'DISABLED', 'RETIRED', 'DELETED'] as const;
const discoverySources = ['AGENT', 'SSH', 'MANUAL', 'GATEWAY', 'WINRM', 'IMPORT', 'PROVIDER'] as const;
const endpointProtocols = ['HTTPS', 'TLS', 'STARTTLS', 'HTTP'] as const;
const endpointStatuses = ['ACTIVE', 'INACTIVE', 'UNKNOWN'] as const;
const serviceAssetPlatforms = ['WINDOWS', 'LINUX', 'APPLIANCE'] as const;
const siteAssetTypes = ['WEB_SITE', 'VHOST', 'CONNECTOR', 'CUSTOM'] as const;
const siteAssetStatuses = ['ACTIVE', 'INACTIVE', 'UNKNOWN', 'STALE', 'DISABLED', 'RETIRED', 'DELETED'] as const;
const managedTargetTypes = ['SITE_BINDING', 'FILE_DEPLOY', 'KEYSTORE_ENTRY', 'CUSTOM'] as const;
const managedTargetStatuses = ['ACTIVE', 'INACTIVE', 'UNKNOWN', 'STALE', 'UNREACHABLE', 'DISABLED', 'DELETED'] as const;
const applicationAssetTargetStatuses = ['ACTIVE', 'INACTIVE', 'PENDING', 'ERROR', 'DELETED'] as const;
const conflictResolutions = ['keep_current', 'use_discovered', 'custom'] as const;

export class AssetsDomainService {
  normalizeHost(input: CreateHostDto): Required<Pick<CreateHostDto, 'osType' | 'compatibilityLevel' | 'managementMode' | 'status' | 'ipAddresses' | 'tags'>> & CreateHostDto {
    const hostname = normalizeOptionalString(input.hostname)?.toLowerCase();
    const primaryIp = normalizeOptionalString(input.primaryIp);
    const ipAddresses = normalizeStringArray(input.ipAddresses ?? []);
    if (!hostname && !primaryIp && ipAddresses.length === 0) {
      throw new AppError('VALIDATION_FAILED', 'hostname、primaryIp 或 ipAddresses 至少提供一个', { fields: ['hostname', 'primaryIp', 'ipAddresses'] });
    }
    const tags = normalizeStringArray(input.tags ?? []);
    const osType = readEnum(input.osType ?? 'UNKNOWN', OsTypes, 'osType');
    const compatibilityLevel = readEnum(input.compatibilityLevel ?? 'L1', CompatibilityLevels, 'compatibilityLevel');
    const managementMode = readEnum(input.managementMode ?? 'MONITOR_ONLY', ManagementModes, 'managementMode');
    const status = readEnum(input.status ?? 'ACTIVE', hostStatuses, 'status');

    return {
      ...input,
      hostname,
      displayName: normalizeOptionalString(input.displayName),
      primaryIp,
      osType,
      osName: normalizeOptionalString(input.osName),
      osVersion: normalizeOptionalString(input.osVersion),
      arch: normalizeOptionalString(input.arch),
      environment: normalizeOptionalString(input.environment),
      zoneId: normalizeOptionalString(input.zoneId),
      ownerId: normalizeOptionalString(input.ownerId),
      managementChannels: normalizeManagementChannels(input.managementChannels ?? []),
      discoverySource: readEnum(input.discoverySource ?? 'MANUAL', discoverySources, 'discoverySource'),
      lastDiscoveredAt: normalizeOptionalString(input.lastDiscoveredAt),
      agentId: normalizeOptionalString(input.agentId),
      assetFingerprint: normalizeOptionalString(input.assetFingerprint)?.toLowerCase(),
      compatibilityLevel,
      managementMode,
      status,
      ipAddresses,
      tags,
    };
  }

  normalizeHostPatch(input: UpdateHostDto): UpdateHostDto {
    const normalized: UpdateHostDto = { ...input };
    if (input.hostname !== undefined) normalized.hostname = normalizeOptionalString(input.hostname)?.toLowerCase();
    if (input.displayName !== undefined) normalized.displayName = normalizeOptionalString(input.displayName);
    if (input.primaryIp !== undefined) normalized.primaryIp = normalizeOptionalString(input.primaryIp);
    if (input.ipAddresses !== undefined) normalized.ipAddresses = normalizeStringArray(input.ipAddresses);
    if (input.osType !== undefined) normalized.osType = readEnum(input.osType, OsTypes, 'osType');
    if (input.osName !== undefined) normalized.osName = normalizeOptionalString(input.osName);
    if (input.osVersion !== undefined) normalized.osVersion = normalizeOptionalString(input.osVersion);
    if (input.arch !== undefined) normalized.arch = normalizeOptionalString(input.arch);
    if (input.environment !== undefined) normalized.environment = normalizeOptionalString(input.environment);
    if (input.zoneId !== undefined) normalized.zoneId = normalizeOptionalString(input.zoneId);
    if (input.ownerId !== undefined) normalized.ownerId = normalizeOptionalString(input.ownerId);
    if (input.managementChannels !== undefined) normalized.managementChannels = normalizeManagementChannels(input.managementChannels);
    if (input.discoverySource !== undefined) normalized.discoverySource = readEnum(input.discoverySource, discoverySources, 'discoverySource');
    if (input.lastDiscoveredAt !== undefined) normalized.lastDiscoveredAt = normalizeOptionalString(input.lastDiscoveredAt);
    if (input.agentId !== undefined) normalized.agentId = normalizeOptionalString(input.agentId);
    if (input.assetFingerprint !== undefined) normalized.assetFingerprint = normalizeOptionalString(input.assetFingerprint)?.toLowerCase();
    if (input.compatibilityLevel !== undefined) normalized.compatibilityLevel = readEnum(input.compatibilityLevel, CompatibilityLevels, 'compatibilityLevel');
    if (input.managementMode !== undefined) normalized.managementMode = readEnum(input.managementMode, ManagementModes, 'managementMode');
    if (input.status !== undefined) normalized.status = readEnum(input.status, hostStatuses, 'status');
    if (input.tags !== undefined) normalized.tags = normalizeStringArray(input.tags);
    return normalized;
  }

  normalizeServiceInstance(input: CreateServiceInstanceDto): Required<Pick<CreateServiceInstanceDto, 'providerType' | 'displayName' | 'discoverySource' | 'status' | 'rawFacts'>> & CreateServiceInstanceDto {
    const providerType = readEnum(input.providerType, ProviderTypes, 'providerType');
    const displayName = normalizeRequiredString(input.displayName, 'displayName');
    const discoverySource = readEnum(input.discoverySource ?? 'MANUAL', discoverySources, 'discoverySource');
    const status = readEnum(input.status ?? 'ACTIVE', serviceInstanceStatuses, 'status');

    return {
      ...input,
      hostId: normalizeOptionalString(input.hostId),
      providerType,
      serviceName: normalizeOptionalString(input.serviceName),
      displayName,
      versionText: normalizeOptionalString(input.versionText),
      installPath: normalizeOptionalString(input.installPath),
      configPath: normalizeOptionalString(input.configPath),
      runtimeUser: normalizeOptionalString(input.runtimeUser),
      ports: normalizePorts(input.ports ?? []),
      providerKey: normalizeOptionalString(input.providerKey),
      manualOverrides: input.manualOverrides ?? {},
      discoverySource,
      status,
      rawFacts: input.rawFacts ?? {},
    };
  }

  normalizeServiceInstancePatch(input: UpdateServiceInstanceDto): UpdateServiceInstanceDto {
    const normalized: UpdateServiceInstanceDto = { ...input };
    if (input.hostId !== undefined) normalized.hostId = normalizeRequiredString(input.hostId, 'hostId');
    if (input.providerType !== undefined) normalized.providerType = readEnum(input.providerType, ProviderTypes, 'providerType');
    if (input.serviceName !== undefined) normalized.serviceName = normalizeOptionalString(input.serviceName);
    if (input.displayName !== undefined) normalized.displayName = normalizeRequiredString(input.displayName, 'displayName');
    if (input.versionText !== undefined) normalized.versionText = normalizeOptionalString(input.versionText);
    if (input.installPath !== undefined) normalized.installPath = normalizeOptionalString(input.installPath);
    if (input.configPath !== undefined) normalized.configPath = normalizeOptionalString(input.configPath);
    if (input.runtimeUser !== undefined) normalized.runtimeUser = normalizeOptionalString(input.runtimeUser);
    if (input.ports !== undefined) normalized.ports = normalizePorts(input.ports);
    if (input.providerKey !== undefined) normalized.providerKey = normalizeOptionalString(input.providerKey);
    if (input.manualOverrides !== undefined) normalized.manualOverrides = input.manualOverrides;
    if (input.discoverySource !== undefined) normalized.discoverySource = readEnum(input.discoverySource, discoverySources, 'discoverySource');
    if (input.status !== undefined) normalized.status = readEnum(input.status, serviceInstanceStatuses, 'status');
    if (input.rawFacts !== undefined) normalized.rawFacts = input.rawFacts;
    return normalized;
  }

  normalizeServiceAsset(input: CreateServiceAssetDto): Required<Pick<CreateServiceAssetDto, 'address' | 'addressType' | 'port' | 'protocol' | 'discoverySource' | 'status' | 'tags' | 'metadata'>> & CreateServiceAssetDto {
    const address = normalizeRequiredString(input.address, 'address').toLowerCase();
    const port = normalizePort(input.port);
    const protocol = readEnum(input.protocol, endpointProtocols, 'protocol');
    return {
      ...input,
      address,
      addressType: input.addressType ?? inferAddressType(address),
      port,
      protocol,
      platform: input.platform === undefined ? undefined : readEnum(input.platform, serviceAssetPlatforms, 'platform'),
      agentId: normalizeOptionalString(input.agentId),
      sniName: normalizeOptionalString(input.sniName)?.toLowerCase(),
      verifyUrl: normalizeOptionalString(input.verifyUrl),
      displayName: normalizeOptionalString(input.displayName),
      serviceInstanceId: normalizeOptionalString(input.serviceInstanceId),
      serviceEndpointId: normalizeOptionalString(input.serviceEndpointId),
      hostId: normalizeOptionalString(input.hostId),
      environment: normalizeOptionalString(input.environment),
      discoverySource: readEnum(input.discoverySource ?? 'MANUAL', discoverySources, 'discoverySource'),
      lastDiscoveredAt: normalizeOptionalString(input.lastDiscoveredAt),
      status: readEnum(input.status ?? 'ACTIVE', serviceAssetStatuses, 'status'),
      tags: normalizeStringArray(input.tags ?? []),
      metadata: input.metadata ?? {},
    };
  }

  normalizeServiceAssetPatch(input: UpdateServiceAssetDto): UpdateServiceAssetDto {
    const normalized: UpdateServiceAssetDto = { ...input };
    if (input.address !== undefined) normalized.address = normalizeRequiredString(input.address, 'address').toLowerCase();
    if (input.addressType !== undefined) normalized.addressType = input.addressType;
    if (input.port !== undefined) normalized.port = normalizePort(input.port);
    if (input.protocol !== undefined) normalized.protocol = readEnum(input.protocol, endpointProtocols, 'protocol');
    if (input.platform !== undefined) normalized.platform = readEnum(input.platform, serviceAssetPlatforms, 'platform');
    if (input.agentId !== undefined) normalized.agentId = normalizeOptionalString(input.agentId);
    if (input.sniName !== undefined) normalized.sniName = normalizeOptionalString(input.sniName)?.toLowerCase();
    if (input.verifyUrl !== undefined) normalized.verifyUrl = normalizeOptionalString(input.verifyUrl);
    if (input.displayName !== undefined) normalized.displayName = normalizeOptionalString(input.displayName);
    if (input.serviceInstanceId !== undefined) normalized.serviceInstanceId = normalizeOptionalString(input.serviceInstanceId);
    if (input.serviceEndpointId !== undefined) normalized.serviceEndpointId = normalizeOptionalString(input.serviceEndpointId);
    if (input.hostId !== undefined) normalized.hostId = normalizeOptionalString(input.hostId);
    if (input.environment !== undefined) normalized.environment = normalizeOptionalString(input.environment);
    if (input.discoverySource !== undefined) normalized.discoverySource = readEnum(input.discoverySource, discoverySources, 'discoverySource');
    if (input.lastDiscoveredAt !== undefined) normalized.lastDiscoveredAt = normalizeOptionalString(input.lastDiscoveredAt);
    if (input.status !== undefined) normalized.status = readEnum(input.status, serviceAssetStatuses, 'status');
    if (input.tags !== undefined) normalized.tags = normalizeStringArray(input.tags);
    return normalized;
  }

  normalizeServiceEndpoint(input: CreateServiceEndpointDto): Required<Pick<CreateServiceEndpointDto, 'serviceInstanceId' | 'protocol' | 'port' | 'status'>> & CreateServiceEndpointDto {
    const serviceInstanceId = normalizeRequiredString(input.serviceInstanceId, 'serviceInstanceId');
    const protocol = readEnum(input.protocol, endpointProtocols, 'protocol');
    const port = input.port;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new AppError('VALIDATION_FAILED', 'port 必须在 1 到 65535 之间', { field: 'port' });
    }
    const status = readEnum(input.status ?? 'ACTIVE', endpointStatuses, 'status');

    return {
      ...input,
      serviceInstanceId,
      protocol,
      hostName: normalizeOptionalString(input.hostName)?.toLowerCase(),
      listenIp: normalizeOptionalString(input.listenIp),
      pathHint: normalizeOptionalString(input.pathHint),
      port,
      status,
    };
  }

  normalizeServiceEndpointPatch(input: UpdateServiceEndpointDto): UpdateServiceEndpointDto {
    const normalized: UpdateServiceEndpointDto = { ...input };
    if (input.serviceInstanceId !== undefined) normalized.serviceInstanceId = normalizeRequiredString(input.serviceInstanceId, 'serviceInstanceId');
    if (input.protocol !== undefined) normalized.protocol = readEnum(input.protocol, endpointProtocols, 'protocol');
    if (input.port !== undefined) normalized.port = normalizePort(input.port);
    if (input.hostName !== undefined) normalized.hostName = normalizeOptionalString(input.hostName)?.toLowerCase();
    if (input.listenIp !== undefined) normalized.listenIp = normalizeOptionalString(input.listenIp);
    if (input.pathHint !== undefined) normalized.pathHint = normalizeOptionalString(input.pathHint);
    if (input.status !== undefined) normalized.status = readEnum(input.status, endpointStatuses, 'status');
    return normalized;
  }

  normalizeSiteAsset(input: CreateSiteAssetDto): Required<Pick<CreateSiteAssetDto, 'serviceInstanceId' | 'providerType' | 'siteType' | 'siteName' | 'siteKey' | 'discoverySource' | 'status' | 'metadata'>> & CreateSiteAssetDto {
    return {
      ...input,
      serviceInstanceId: normalizeRequiredString(input.serviceInstanceId, 'serviceInstanceId'),
      serviceAssetId: normalizeOptionalString(input.serviceAssetId),
      hostId: normalizeOptionalString(input.hostId),
      agentId: normalizeOptionalString(input.agentId),
      providerType: readEnum(input.providerType, ProviderTypes, 'providerType'),
      siteType: readEnum(input.siteType, siteAssetTypes, 'siteType'),
      siteName: normalizeRequiredString(input.siteName, 'siteName'),
      siteKey: normalizeRequiredString(input.siteKey, 'siteKey').toLowerCase(),
      bindingInformation: normalizeOptionalString(input.bindingInformation),
      hostHeader: normalizeOptionalString(input.hostHeader)?.toLowerCase(),
      listenIp: normalizeOptionalString(input.listenIp),
      port: input.port === undefined ? undefined : normalizePort(input.port),
      protocol: input.protocol === undefined ? undefined : readEnum(input.protocol, endpointProtocols, 'protocol'),
      configPath: normalizeOptionalString(input.configPath),
      runtimeStatus: normalizeOptionalString(input.runtimeStatus),
      discoverySource: readEnum(input.discoverySource ?? 'MANUAL', discoverySources, 'discoverySource'),
      lastDiscoveredAt: normalizeOptionalString(input.lastDiscoveredAt),
      status: readEnum(input.status ?? 'ACTIVE', siteAssetStatuses, 'status'),
      metadata: input.metadata ?? {},
    };
  }

  normalizeSiteAssetPatch(input: UpdateSiteAssetDto): UpdateSiteAssetDto {
    const normalized: UpdateSiteAssetDto = { ...input };
    if (input.serviceInstanceId !== undefined) normalized.serviceInstanceId = normalizeRequiredString(input.serviceInstanceId, 'serviceInstanceId');
    if (input.serviceAssetId !== undefined) normalized.serviceAssetId = normalizeOptionalString(input.serviceAssetId);
    if (input.hostId !== undefined) normalized.hostId = normalizeRequiredString(input.hostId, 'hostId');
    if (input.agentId !== undefined) normalized.agentId = normalizeOptionalString(input.agentId);
    if (input.providerType !== undefined) normalized.providerType = readEnum(input.providerType, ProviderTypes, 'providerType');
    if (input.siteType !== undefined) normalized.siteType = readEnum(input.siteType, siteAssetTypes, 'siteType');
    if (input.siteName !== undefined) normalized.siteName = normalizeRequiredString(input.siteName, 'siteName');
    if (input.siteKey !== undefined) normalized.siteKey = normalizeRequiredString(input.siteKey, 'siteKey').toLowerCase();
    if (input.bindingInformation !== undefined) normalized.bindingInformation = normalizeOptionalString(input.bindingInformation);
    if (input.hostHeader !== undefined) normalized.hostHeader = normalizeOptionalString(input.hostHeader)?.toLowerCase();
    if (input.listenIp !== undefined) normalized.listenIp = normalizeOptionalString(input.listenIp);
    if (input.port !== undefined) normalized.port = normalizePort(input.port);
    if (input.protocol !== undefined) normalized.protocol = readEnum(input.protocol, endpointProtocols, 'protocol');
    if (input.configPath !== undefined) normalized.configPath = normalizeOptionalString(input.configPath);
    if (input.runtimeStatus !== undefined) normalized.runtimeStatus = normalizeOptionalString(input.runtimeStatus);
    if (input.discoverySource !== undefined) normalized.discoverySource = readEnum(input.discoverySource, discoverySources, 'discoverySource');
    if (input.lastDiscoveredAt !== undefined) normalized.lastDiscoveredAt = normalizeOptionalString(input.lastDiscoveredAt);
    if (input.status !== undefined) normalized.status = readEnum(input.status, siteAssetStatuses, 'status');
    if (input.metadata !== undefined) normalized.metadata = input.metadata;
    return normalized;
  }

  normalizeManagedTarget(input: CreateManagedTargetDto): Required<Pick<CreateManagedTargetDto, 'providerType' | 'frameworkType' | 'targetType' | 'targetKey' | 'capabilityProfile' | 'status' | 'metadata'>> & CreateManagedTargetDto {
    const owner = normalizeManagementOwner(input.agentId, input.deviceAssetId);
    return {
      ...input,
      ...owner,
      hostId: normalizeOptionalString(input.hostId),
      serviceInstanceId: normalizeOptionalString(input.serviceInstanceId),
      serviceAssetId: normalizeOptionalString(input.serviceAssetId),
      siteAssetId: normalizeOptionalString(input.siteAssetId),
      providerType: readEnum(input.providerType, ProviderTypes, 'providerType'),
      frameworkType: readEnum(input.frameworkType, ProviderTypes, 'frameworkType'),
      targetType: readEnum(input.targetType, managedTargetTypes, 'targetType'),
      targetKey: normalizeRequiredString(input.targetKey, 'targetKey').toLowerCase(),
      bindingKey: normalizeOptionalString(input.bindingKey),
      capabilityProfile: input.capabilityProfile ?? {},
      deploymentMode: normalizeOptionalString(input.deploymentMode),
      lastSeenAt: normalizeOptionalString(input.lastSeenAt),
      status: readEnum(input.status ?? 'ACTIVE', managedTargetStatuses, 'status'),
      metadata: input.metadata ?? {},
    };
  }

  normalizeManagedTargetPatch(input: UpdateManagedTargetDto): UpdateManagedTargetDto {
    const normalized: UpdateManagedTargetDto = { ...input };
    if (input.agentId !== undefined) normalized.agentId = normalizeOptionalString(input.agentId);
    if (input.deviceAssetId !== undefined) normalized.deviceAssetId = normalizeOptionalString(input.deviceAssetId);
    if (input.hostId !== undefined) normalized.hostId = normalizeRequiredString(input.hostId, 'hostId');
    if (input.serviceInstanceId !== undefined) normalized.serviceInstanceId = normalizeOptionalString(input.serviceInstanceId);
    if (input.serviceAssetId !== undefined) normalized.serviceAssetId = normalizeOptionalString(input.serviceAssetId);
    if (input.siteAssetId !== undefined) normalized.siteAssetId = normalizeOptionalString(input.siteAssetId);
    if (input.providerType !== undefined) normalized.providerType = readEnum(input.providerType, ProviderTypes, 'providerType');
    if (input.frameworkType !== undefined) normalized.frameworkType = readEnum(input.frameworkType, ProviderTypes, 'frameworkType');
    if (input.targetType !== undefined) normalized.targetType = readEnum(input.targetType, managedTargetTypes, 'targetType');
    if (input.targetKey !== undefined) normalized.targetKey = normalizeRequiredString(input.targetKey, 'targetKey').toLowerCase();
    if (input.bindingKey !== undefined) normalized.bindingKey = normalizeOptionalString(input.bindingKey);
    if (input.capabilityProfile !== undefined) normalized.capabilityProfile = input.capabilityProfile;
    if (input.deploymentMode !== undefined) normalized.deploymentMode = normalizeOptionalString(input.deploymentMode);
    if (input.lastSeenAt !== undefined) normalized.lastSeenAt = normalizeOptionalString(input.lastSeenAt);
    if (input.status !== undefined) normalized.status = readEnum(input.status, managedTargetStatuses, 'status');
    if (input.metadata !== undefined) normalized.metadata = input.metadata;
    return normalized;
  }

  normalizeApplicationAssetTarget(input: CreateApplicationAssetTargetDto): Required<Pick<CreateApplicationAssetTargetDto, 'applicationAssetId' | 'siteAssetId' | 'managedTargetId' | 'providerType' | 'frameworkType' | 'targetType' | 'targetKey' | 'status' | 'metadata'>> & CreateApplicationAssetTargetDto {
    const owner = normalizeManagementOwner(input.agentId, input.deviceAssetId);
    return {
      ...input,
      ...owner,
      applicationAssetId: normalizeRequiredString(input.applicationAssetId, 'applicationAssetId'),
      siteAssetId: normalizeRequiredString(input.siteAssetId, 'siteAssetId'),
      managedTargetId: normalizeRequiredString(input.managedTargetId, 'managedTargetId'),
      providerType: readEnum(input.providerType, ProviderTypes, 'providerType'),
      frameworkType: readEnum(input.frameworkType, ProviderTypes, 'frameworkType'),
      targetType: readEnum(input.targetType, managedTargetTypes, 'targetType'),
      targetKey: normalizeRequiredString(input.targetKey, 'targetKey').toLowerCase(),
      bindingKey: normalizeOptionalString(input.bindingKey),
      status: readEnum(input.status ?? 'ACTIVE', applicationAssetTargetStatuses, 'status'),
      metadata: input.metadata ?? {},
    };
  }

  normalizeApplicationAssetTargetPatch(input: UpdateApplicationAssetTargetDto): UpdateApplicationAssetTargetDto {
    const normalized: UpdateApplicationAssetTargetDto = { ...input };
    if (input.applicationAssetId !== undefined) normalized.applicationAssetId = normalizeRequiredString(input.applicationAssetId, 'applicationAssetId');
    if (input.agentId !== undefined) normalized.agentId = normalizeOptionalString(input.agentId);
    if (input.deviceAssetId !== undefined) normalized.deviceAssetId = normalizeOptionalString(input.deviceAssetId);
    if (input.siteAssetId !== undefined) normalized.siteAssetId = normalizeRequiredString(input.siteAssetId, 'siteAssetId');
    if (input.managedTargetId !== undefined) normalized.managedTargetId = normalizeRequiredString(input.managedTargetId, 'managedTargetId');
    if (input.providerType !== undefined) normalized.providerType = readEnum(input.providerType, ProviderTypes, 'providerType');
    if (input.frameworkType !== undefined) normalized.frameworkType = readEnum(input.frameworkType, ProviderTypes, 'frameworkType');
    if (input.targetType !== undefined) normalized.targetType = readEnum(input.targetType, managedTargetTypes, 'targetType');
    if (input.targetKey !== undefined) normalized.targetKey = normalizeRequiredString(input.targetKey, 'targetKey').toLowerCase();
    if (input.bindingKey !== undefined) normalized.bindingKey = normalizeOptionalString(input.bindingKey);
    if (input.status !== undefined) normalized.status = readEnum(input.status, applicationAssetTargetStatuses, 'status');
    if (input.metadata !== undefined) normalized.metadata = input.metadata;
    return normalized;
  }

  normalizeDiscoverySnapshot(input: CreateDiscoverySnapshotDto): Required<Pick<CreateDiscoverySnapshotDto, 'normalizedHash' | 'source' | 'normalizedPayload'>> & CreateDiscoverySnapshotDto {
    const normalizedHash = normalizeRequiredString(input.normalizedHash, 'normalizedHash').toLowerCase();
    const source = readEnum(input.source ?? 'MANUAL', discoverySources, 'source');
    return {
      ...input,
      normalizedHash,
      source,
      normalizedPayload: input.normalizedPayload ?? {},
    };
  }
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeManagementOwner(agentIdValue: unknown, deviceAssetIdValue: unknown): Pick<CreateManagedTargetDto, 'agentId' | 'deviceAssetId'> {
  const agentId = normalizeOptionalString(agentIdValue);
  const deviceAssetId = normalizeOptionalString(deviceAssetIdValue);
  if (Boolean(agentId) === Boolean(deviceAssetId)) {
    throw new AppError('VALIDATION_FAILED', '受管目标必须且只能指定一个 Agent 或设备所有者', {
      fields: ['agentId', 'deviceAssetId'],
    });
  }
  return { agentId, deviceAssetId };
}

function normalizeRequiredString(value: unknown, field: string): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) throw new AppError('VALIDATION_FAILED', `${field} 不能为空`, { field });
  return normalized;
}

function normalizePort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new AppError('VALIDATION_FAILED', 'port 必须在 1 到 65535 之间', { field: 'port' });
  }
  return port;
}

function normalizeStringArray(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean))];
}

function normalizeManagementChannels(values: Array<{ type?: string; enabled?: boolean; refId?: string; metadata?: Record<string, unknown> }>): Array<{ type: string; enabled?: boolean; refId?: string; metadata?: Record<string, unknown> }> {
  return values
    .map((value) => ({
      ...value,
      type: normalizeRequiredString(value.type, 'managementChannels.type').toUpperCase(),
      refId: normalizeOptionalString(value.refId),
    }))
    .filter((value, index, array) => array.findIndex((item) => item.type === value.type && item.refId === value.refId) === index);
}

function normalizePorts(values: Array<number | Record<string, unknown>>): Array<number | Record<string, unknown>> {
  return values.map((value) => {
    if (typeof value === 'number') return normalizePort(value);
    const port = value.port;
    if (typeof port === 'number') normalizePort(port);
    return value;
  });
}

function readEnum<T extends string>(value: string, allowed: readonly T[], field: string): T {
  if (field === 'providerType' || field === 'frameworkType') {
    const normalized = value.trim();
    if (normalized) return normalized as T;
  }
  if (!allowed.includes(value as T)) {
    throw new AppError('VALIDATION_FAILED', '枚举值不合法', { field, allowedValues: allowed });
  }
  return value as T;
}

export const assetsEnumValues = {
  hostStatuses,
  serviceInstanceStatuses,
  serviceAssetStatuses,
  discoverySources,
  endpointProtocols,
  endpointStatuses,
  serviceAssetPlatforms,
  siteAssetTypes,
  siteAssetStatuses,
  managedTargetTypes,
  managedTargetStatuses,
  applicationAssetTargetStatuses,
  conflictResolutions,
  osTypes: OsTypes,
  compatibilityLevels: CompatibilityLevels,
  managementModes: ManagementModes,
  providerTypes: ProviderTypes,
} as const;

export type AssetsDomainEnums = {
  hostStatus: HostStatus;
  serviceInstanceStatus: ServiceInstanceStatus;
  serviceAssetStatus: ServiceAssetStatus;
  serviceAssetPlatform: ServiceAssetPlatform;
  siteAssetType: SiteAssetType;
  siteAssetStatus: SiteAssetStatus;
  managedTargetType: ManagedTargetType;
  managedTargetStatus: ManagedTargetStatus;
  applicationAssetTargetStatus: ApplicationAssetTargetStatus;
  discoverySource: DiscoverySource;
  endpointProtocol: ServiceEndpointProtocol;
  endpointStatus: ServiceEndpointStatus;
  osType: OsType;
  compatibilityLevel: CompatibilityLevel;
  managementMode: ManagementMode;
  providerType: ProviderType;
};

function inferAddressType(address: string): 'DNS' | 'IPV4' | 'IPV6' | 'UNKNOWN' {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) return 'IPV4';
  if (address.includes(':')) return 'IPV6';
  if (address.includes('.')) return 'DNS';
  return 'UNKNOWN';
}
