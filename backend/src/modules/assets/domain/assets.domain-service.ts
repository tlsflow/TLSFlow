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
  DiscoverySource,
  HostStatus,
  ServiceEndpointProtocol,
  ServiceEndpointStatus,
  ServiceAssetPlatform,
  ServiceAssetStatus,
  ServiceInstanceStatus,
  UpdateHostDto,
  UpdateServiceAssetDto,
  UpdateServiceEndpointDto,
  UpdateServiceInstanceDto,
} from '../dto/assets.dto.js';

const hostStatuses = ['ACTIVE', 'INACTIVE', 'UNKNOWN', 'STALE', 'DISABLED', 'RETIRED', 'DELETED'] as const;
const serviceInstanceStatuses = ['ACTIVE', 'STALE', 'UNREACHABLE', 'DISABLED', 'RETIRED', 'DELETED'] as const;
const serviceAssetStatuses = ['ACTIVE', 'INACTIVE', 'UNKNOWN', 'STALE', 'DISABLED', 'RETIRED', 'DELETED'] as const;
const discoverySources = ['AGENT', 'SSH', 'MANUAL', 'GATEWAY', 'WINRM', 'IMPORT', 'PROVIDER'] as const;
const endpointProtocols = ['HTTPS', 'TLS', 'STARTTLS', 'HTTP'] as const;
const endpointStatuses = ['ACTIVE', 'INACTIVE', 'UNKNOWN'] as const;
const serviceAssetPlatforms = ['WINDOWS', 'LINUX', 'APPLIANCE'] as const;
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

  normalizeServiceInstance(input: CreateServiceInstanceDto): Required<Pick<CreateServiceInstanceDto, 'hostId' | 'providerType' | 'displayName' | 'discoverySource' | 'status' | 'rawFacts'>> & CreateServiceInstanceDto {
    const hostId = normalizeRequiredString(input.hostId, 'hostId');
    const providerType = readEnum(input.providerType, ProviderTypes, 'providerType');
    const displayName = normalizeRequiredString(input.displayName, 'displayName');
    const discoverySource = readEnum(input.discoverySource ?? 'MANUAL', discoverySources, 'discoverySource');
    const status = readEnum(input.status ?? 'ACTIVE', serviceInstanceStatuses, 'status');

    return {
      ...input,
      hostId,
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
