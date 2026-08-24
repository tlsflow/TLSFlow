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
  CreateServiceEndpointDto,
  CreateServiceInstanceDto,
  DiscoverySource,
  HostStatus,
  ServiceEndpointProtocol,
  ServiceEndpointStatus,
  ServiceInstanceStatus,
  UpdateHostDto,
  UpdateServiceEndpointDto,
  UpdateServiceInstanceDto,
} from '../dto/assets.dto.js';

const hostStatuses = ['ACTIVE', 'INACTIVE', 'UNKNOWN', 'RETIRED'] as const;
const serviceInstanceStatuses = ['ACTIVE', 'STALE', 'UNREACHABLE', 'RETIRED'] as const;
const discoverySources = ['AGENT', 'SSH', 'MANUAL', 'GATEWAY'] as const;
const endpointProtocols = ['HTTPS', 'TLS', 'STARTTLS', 'HTTP'] as const;
const endpointStatuses = ['ACTIVE', 'INACTIVE', 'UNKNOWN'] as const;

export class AssetsDomainService {
  normalizeHost(input: CreateHostDto): Required<Pick<CreateHostDto, 'hostname' | 'osType' | 'compatibilityLevel' | 'managementMode' | 'status' | 'ipAddresses' | 'tags'>> & CreateHostDto {
    const hostname = input.hostname.trim().toLowerCase();
    if (!hostname) throw new AppError('VALIDATION_FAILED', 'hostname 不能为空', { field: 'hostname' });
    const ipAddresses = normalizeStringArray(input.ipAddresses ?? []);
    const tags = normalizeStringArray(input.tags ?? []);
    const osType = readEnum(input.osType ?? 'UNKNOWN', OsTypes, 'osType');
    const compatibilityLevel = readEnum(input.compatibilityLevel ?? 'L1', CompatibilityLevels, 'compatibilityLevel');
    const managementMode = readEnum(input.managementMode ?? 'MONITOR_ONLY', ManagementModes, 'managementMode');
    const status = readEnum(input.status ?? 'ACTIVE', hostStatuses, 'status');

    return {
      ...input,
      hostname,
      displayName: normalizeOptionalString(input.displayName),
      primaryIp: normalizeOptionalString(input.primaryIp),
      osType,
      osName: normalizeOptionalString(input.osName),
      osVersion: normalizeOptionalString(input.osVersion),
      arch: normalizeOptionalString(input.arch),
      environment: normalizeOptionalString(input.environment),
      zoneId: normalizeOptionalString(input.zoneId),
      compatibilityLevel,
      managementMode,
      status,
      ipAddresses,
      tags,
    };
  }

  normalizeHostPatch(input: UpdateHostDto): UpdateHostDto {
    const normalized: UpdateHostDto = { ...input };
    if (input.hostname !== undefined) normalized.hostname = normalizeRequiredString(input.hostname, 'hostname').toLowerCase();
    if (input.displayName !== undefined) normalized.displayName = normalizeOptionalString(input.displayName);
    if (input.primaryIp !== undefined) normalized.primaryIp = normalizeOptionalString(input.primaryIp);
    if (input.ipAddresses !== undefined) normalized.ipAddresses = normalizeStringArray(input.ipAddresses);
    if (input.osType !== undefined) normalized.osType = readEnum(input.osType, OsTypes, 'osType');
    if (input.osName !== undefined) normalized.osName = normalizeOptionalString(input.osName);
    if (input.osVersion !== undefined) normalized.osVersion = normalizeOptionalString(input.osVersion);
    if (input.arch !== undefined) normalized.arch = normalizeOptionalString(input.arch);
    if (input.environment !== undefined) normalized.environment = normalizeOptionalString(input.environment);
    if (input.zoneId !== undefined) normalized.zoneId = normalizeOptionalString(input.zoneId);
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
    if (input.discoverySource !== undefined) normalized.discoverySource = readEnum(input.discoverySource, discoverySources, 'discoverySource');
    if (input.status !== undefined) normalized.status = readEnum(input.status, serviceInstanceStatuses, 'status');
    if (input.rawFacts !== undefined) normalized.rawFacts = input.rawFacts;
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

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeRequiredString(value: string | undefined, field: string): string {
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

function normalizeStringArray(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
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
  discoverySources,
  endpointProtocols,
  endpointStatuses,
  osTypes: OsTypes,
  compatibilityLevels: CompatibilityLevels,
  managementModes: ManagementModes,
  providerTypes: ProviderTypes,
} as const;

export type AssetsDomainEnums = {
  hostStatus: HostStatus;
  serviceInstanceStatus: ServiceInstanceStatus;
  discoverySource: DiscoverySource;
  endpointProtocol: ServiceEndpointProtocol;
  endpointStatus: ServiceEndpointStatus;
  osType: OsType;
  compatibilityLevel: CompatibilityLevel;
  managementMode: ManagementMode;
  providerType: ProviderType;
};
