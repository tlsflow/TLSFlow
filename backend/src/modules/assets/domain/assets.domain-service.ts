import { AppError } from '../../../common/errors/app-error.js';
import {
  CompatibilityLevels,
  ManagementModes,
  OsTypes,
  type CompatibilityLevel,
  type ManagementMode,
  type OsType,
} from '../../../shared/enums/core.enums.js';
import type {
  CreateHostDto,
  CreateDiscoverySnapshotDto,
  CreateServiceAssetDto,
  CreateServiceEndpointDto,
  CreateFrameworkInstanceDto,
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
  ServiceAssetDto,
  FrameworkInstanceStatus,
  SiteAssetStatus,
  SiteAssetType,
  UpdateHostDto,
  UpdateManagedTargetDto,
  UpdateApplicationAssetTargetDto,
  UpdateServiceAssetDto,
  UpdateServiceEndpointDto,
  UpdateFrameworkInstanceDto,
  UpdateSiteAssetDto,
} from '../dto/assets.dto.js';

const hostStatuses = ['ACTIVE', 'INACTIVE', 'UNKNOWN', 'STALE', 'DISABLED', 'RETIRED', 'DELETED'] as const;
const serviceInstanceStatuses = ['ACTIVE', 'STALE', 'UNREACHABLE', 'DISABLED', 'RETIRED', 'DELETED'] as const;
const serviceAssetStatuses = ['ACTIVE', 'INACTIVE', 'UNKNOWN', 'STALE', 'DISABLED', 'RETIRED', 'DELETED'] as const;
const discoverySources = ['AGENT', 'SSH', 'MANUAL', 'GATEWAY', 'WINRM', 'IMPORT', 'PROVIDER'] as const;
const endpointProtocols = ['HTTPS', 'TLS', 'STARTTLS', 'HTTP'] as const;
const endpointStatuses = ['ACTIVE', 'INACTIVE', 'UNKNOWN'] as const;
const serviceAssetPlatforms = ['WINDOWS', 'LINUX', 'APPLIANCE'] as const;
const siteAssetStatuses = ['ACTIVE', 'INACTIVE', 'UNKNOWN', 'STALE', 'DISABLED', 'RETIRED', 'DELETED'] as const;
const managedTargetExecutionLocations = ['AGENT', 'CONTROL_PLANE', 'GATEWAY'] as const;
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

  normalizeServiceInstance(input: CreateFrameworkInstanceDto): CreateFrameworkInstanceDto {
    const deviceId = normalizeOptionalString(input.deviceId);
    const assetId = normalizeOptionalString(input.assetId);
    const serviceAssetId = normalizeOptionalString(input.serviceAssetId);
    if ((deviceId ? 1 : 0) + (assetId ? 1 : 0) + (serviceAssetId ? 1 : 0) !== 1) {
      throw new AppError('VALIDATION_FAILED', 'FrameworkInstance 必须且只能绑定一个资产所有者', { code: 'FRAMEWORK_OWNER_CONFLICT' });
    }
    const frameworkType = normalizeNamespaceValue(input.frameworkType, 'frameworkType');
    const frameworkKey = normalizeRequiredString(input.frameworkKey, 'frameworkKey');
    const discoveryProviderKey = normalizeRequiredString(input.discoveryProviderKey, 'discoveryProviderKey');
    const displayName = normalizeRequiredString(input.displayName, 'displayName');
    const discoverySource = readEnum(input.discoverySource ?? 'MANUAL', discoverySources, 'discoverySource');
    const status = readEnum(input.status ?? 'ACTIVE', serviceInstanceStatuses, 'status');

    return {
      ...input,
      ...(deviceId ? { deviceId } : { deviceId: undefined }),
      ...(assetId ? { assetId } : { assetId: undefined }),
      ...(serviceAssetId ? { serviceAssetId } : { serviceAssetId: undefined }),
      frameworkType,
      frameworkKey,
      discoveryProviderKey,
      displayName,
      frameworkVersion: normalizeOptionalString(input.frameworkVersion),
      discoverySource,
      status,
      rawFacts: input.rawFacts ?? {},
    };
  }

  normalizeServiceInstancePatch(input: UpdateFrameworkInstanceDto): UpdateFrameworkInstanceDto {
    const normalized: UpdateFrameworkInstanceDto = { ...input };
    if (input.deviceId !== undefined) normalized.deviceId = normalizeOptionalString(input.deviceId);
    if (input.assetId !== undefined) normalized.assetId = normalizeOptionalString(input.assetId);
    if (input.serviceAssetId !== undefined) normalized.serviceAssetId = normalizeOptionalString(input.serviceAssetId);
    const ownerValues = [normalized.deviceId, normalized.assetId, normalized.serviceAssetId].filter(Boolean);
    if (ownerValues.length > 1) {
      throw new AppError('VALIDATION_FAILED', 'FrameworkInstance 不能同时绑定多个资产所有者', { code: 'FRAMEWORK_OWNER_CONFLICT' });
    }
    if (input.frameworkType !== undefined) normalized.frameworkType = normalizeNamespaceValue(input.frameworkType, 'frameworkType');
    if (input.frameworkKey !== undefined) normalized.frameworkKey = normalizeRequiredString(input.frameworkKey, 'frameworkKey');
    if (input.discoveryProviderKey !== undefined) normalized.discoveryProviderKey = normalizeRequiredString(input.discoveryProviderKey, 'discoveryProviderKey');
    if (input.displayName !== undefined) normalized.displayName = normalizeRequiredString(input.displayName, 'displayName');
    if (input.frameworkVersion !== undefined) normalized.frameworkVersion = normalizeOptionalString(input.frameworkVersion);
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

  /**
   * 地址是应用资产的主身份。只有在 SNI 由访问域名派生时才同步 SNI，
   * 但 verifyUrl/accessDomain 作为访问地址派生字段始终跟随地址变更。
   */
  synchronizeAddressDerivedFields(
    current: Pick<ServiceAssetDto, 'address' | 'sniName' | 'verifyUrl' | 'metadata'>,
    patch: UpdateServiceAssetDto,
  ): UpdateServiceAssetDto {
    if (patch.address === undefined) return patch;

    const nextAddress = normalizeOptionalString(patch.address)?.toLowerCase();
    const currentAddress = normalizeOptionalString(current.address)?.toLowerCase();
    if (!nextAddress || !currentAddress) return patch;

    const metadata = isRecord(current.metadata) ? current.metadata : {};
    const accessDomain = readOptionalString(metadata.accessDomain)?.toLowerCase();
    const currentSni = normalizeOptionalString(current.sniName)?.toLowerCase();
    const explicitWorkflowSni = isRecord(metadata.workflowTarget)
      ? readOptionalString(metadata.workflowTarget.sniName)?.toLowerCase()
      : undefined;
    const sniDerived = !explicitWorkflowSni && (!currentSni
      || currentSni === currentAddress
      || (accessDomain === currentSni && accessDomain !== currentAddress));

    const synchronized: UpdateServiceAssetDto = { ...patch };
    if (patch.sniName === undefined && sniDerived) synchronized.sniName = nextAddress;

    if (accessDomain && (accessDomain === currentAddress || accessDomain === currentSni)) {
      const patchMetadata = isRecord(patch.metadata) ? patch.metadata : metadata;
      synchronized.metadata = { ...patchMetadata, accessDomain: nextAddress };
    }

    if (current.verifyUrl && patch.verifyUrl === undefined) {
      const updatedVerifyUrl = replaceUrlHostname(current.verifyUrl, new Set([currentAddress, accessDomain].filter(Boolean) as string[]), nextAddress);
      if (updatedVerifyUrl) synchronized.verifyUrl = updatedVerifyUrl;
    }

    return synchronized;
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

  normalizeSiteAsset(input: CreateSiteAssetDto): CreateSiteAssetDto {
    const deviceId = normalizeOptionalString(input.deviceId);
    const assetId = normalizeOptionalString(input.assetId);
    const serviceAssetId = normalizeOptionalString(input.serviceAssetId);
    if ((deviceId ? 1 : 0) + (assetId ? 1 : 0) + (serviceAssetId ? 1 : 0) > 1) {
      throw new AppError('VALIDATION_FAILED', 'SiteAsset 不能同时绑定多个资产所有者', { code: 'SITE_OWNER_CONFLICT' });
    }
    return {
      ...input,
      frameworkInstanceId: normalizeRequiredString(input.frameworkInstanceId, 'frameworkInstanceId'),
      ...(deviceId ? { deviceId } : { deviceId: undefined }),
      ...(assetId ? { assetId } : { assetId: undefined }),
      ...(serviceAssetId ? { serviceAssetId } : { serviceAssetId: undefined }),
      discoveryProviderKey: normalizeRequiredString(input.discoveryProviderKey, 'discoveryProviderKey'),
      siteType: normalizeNamespaceValue(input.siteType, 'siteType'),
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
    if (input.frameworkInstanceId !== undefined) normalized.frameworkInstanceId = normalizeRequiredString(input.frameworkInstanceId, 'frameworkInstanceId');
    if (input.deviceId !== undefined) normalized.deviceId = normalizeOptionalString(input.deviceId);
    if (input.assetId !== undefined) normalized.assetId = normalizeOptionalString(input.assetId);
    if (input.serviceAssetId !== undefined) normalized.serviceAssetId = normalizeOptionalString(input.serviceAssetId);
    if ([normalized.deviceId, normalized.assetId, normalized.serviceAssetId].filter(Boolean).length > 1) {
      throw new AppError('VALIDATION_FAILED', 'SiteAsset 不能同时绑定多个资产所有者', { code: 'SITE_OWNER_CONFLICT' });
    }
    if (input.discoveryProviderKey !== undefined) normalized.discoveryProviderKey = normalizeRequiredString(input.discoveryProviderKey, 'discoveryProviderKey');
    if (input.siteType !== undefined) normalized.siteType = normalizeNamespaceValue(input.siteType, 'siteType');
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

  normalizeManagedTarget(input: CreateManagedTargetDto): CreateManagedTargetDto {
    const deviceId = normalizeOptionalString(input.deviceId);
    const assetId = normalizeOptionalString(input.assetId);
    const serviceAssetId = normalizeOptionalString(input.serviceAssetId);
    if (!deviceId && !assetId && !serviceAssetId) throw new AppError('VALIDATION_FAILED', 'ManagedTarget 必须绑定一个资产所有者', { code: 'MANAGED_TARGET_OWNER_REQUIRED' });
    if ([deviceId, assetId, serviceAssetId].filter(Boolean).length > 1) throw new AppError('VALIDATION_FAILED', 'ManagedTarget 不能同时绑定多个资产所有者', { code: 'MANAGED_TARGET_OWNER_CONFLICT' });
    return {
      ...input,
      ...(deviceId ? { deviceId } : { deviceId: undefined }),
      ...(assetId ? { assetId } : { assetId: undefined }),
      ...(serviceAssetId ? { serviceAssetId } : { serviceAssetId: undefined }),
      frameworkInstanceId: normalizeOptionalString(input.frameworkInstanceId),
      siteId: normalizeOptionalString(input.siteId),
      discoveryProviderKey: normalizeRequiredString(input.discoveryProviderKey, 'discoveryProviderKey'),
      targetType: normalizeNamespaceValue(input.targetType, 'targetType'),
      targetKey: normalizeRequiredString(input.targetKey, 'targetKey'),
      bindingKey: normalizeOptionalString(input.bindingKey),
      supportedCapabilities: normalizeStringArray(input.supportedCapabilities),
      executionLocations: normalizeExecutionLocations(input.executionLocations),
      lastSeenAt: normalizeOptionalString(input.lastSeenAt),
      status: readEnum(input.status ?? 'ACTIVE', managedTargetStatuses, 'status'),
      metadata: input.metadata ?? {},
    };
  }

  normalizeManagedTargetPatch(input: UpdateManagedTargetDto): UpdateManagedTargetDto {
    const normalized: UpdateManagedTargetDto = { ...input };
    if (input.deviceId !== undefined) normalized.deviceId = normalizeOptionalString(input.deviceId);
    if (input.assetId !== undefined) normalized.assetId = normalizeOptionalString(input.assetId);
    if (input.serviceAssetId !== undefined) normalized.serviceAssetId = normalizeOptionalString(input.serviceAssetId);
    if ([normalized.deviceId, normalized.assetId, normalized.serviceAssetId].filter(Boolean).length > 1) {
      throw new AppError('VALIDATION_FAILED', 'ManagedTarget 不能同时绑定多个资产所有者', { code: 'MANAGED_TARGET_OWNER_CONFLICT' });
    }
    if (input.frameworkInstanceId !== undefined) normalized.frameworkInstanceId = normalizeOptionalString(input.frameworkInstanceId);
    if (input.siteId !== undefined) normalized.siteId = normalizeOptionalString(input.siteId);
    if (input.discoveryProviderKey !== undefined) normalized.discoveryProviderKey = normalizeRequiredString(input.discoveryProviderKey, 'discoveryProviderKey');
    if (input.targetType !== undefined) normalized.targetType = normalizeNamespaceValue(input.targetType, 'targetType');
    if (input.targetKey !== undefined) normalized.targetKey = normalizeRequiredString(input.targetKey, 'targetKey');
    if (input.bindingKey !== undefined) normalized.bindingKey = normalizeOptionalString(input.bindingKey);
    if (input.supportedCapabilities !== undefined) normalized.supportedCapabilities = normalizeStringArray(input.supportedCapabilities);
    if (input.executionLocations !== undefined) normalized.executionLocations = normalizeExecutionLocations(input.executionLocations);
    if (input.lastSeenAt !== undefined) normalized.lastSeenAt = normalizeOptionalString(input.lastSeenAt);
    if (input.status !== undefined) normalized.status = readEnum(input.status, managedTargetStatuses, 'status');
    if (input.metadata !== undefined) normalized.metadata = input.metadata;
    return normalized;
  }

  normalizeApplicationAssetTarget(input: CreateApplicationAssetTargetDto): Required<Pick<CreateApplicationAssetTargetDto, 'applicationAssetId' | 'managedTargetId' | 'status' | 'metadata'>> & CreateApplicationAssetTargetDto {
    return {
      ...input,
      applicationAssetId: normalizeRequiredString(input.applicationAssetId, 'applicationAssetId'),
      managedTargetId: normalizeRequiredString(input.managedTargetId, 'managedTargetId'),
      status: readEnum(input.status ?? 'ACTIVE', applicationAssetTargetStatuses, 'status'),
      metadata: input.metadata ?? {},
    };
  }

  normalizeApplicationAssetTargetPatch(input: UpdateApplicationAssetTargetDto): UpdateApplicationAssetTargetDto {
    const normalized: UpdateApplicationAssetTargetDto = { ...input };
    if (input.applicationAssetId !== undefined) normalized.applicationAssetId = normalizeRequiredString(input.applicationAssetId, 'applicationAssetId');
    if (input.managedTargetId !== undefined) normalized.managedTargetId = normalizeRequiredString(input.managedTargetId, 'managedTargetId');
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

function normalizeNamespaceValue(value: unknown, field: string): string {
  const normalized = normalizeRequiredString(value, field).toLowerCase();
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(normalized)) {
    throw new AppError('VALIDATION_FAILED', '命名空间字符串不合法', { field, value });
  }
  return normalized;
}

function normalizeExecutionLocations(values: readonly string[]): CreateManagedTargetDto['executionLocations'] {
  const normalized = [...new Set(values.map((value) => normalizeRequiredString(value, 'executionLocations')))].sort();
  for (const value of normalized) {
    if (!managedTargetExecutionLocations.includes(value as typeof managedTargetExecutionLocations[number])) {
      throw new AppError('VALIDATION_FAILED', '执行位置不合法', { value, allowedValues: managedTargetExecutionLocations });
    }
  }
  if (normalized.length === 0) throw new AppError('VALIDATION_FAILED', 'executionLocations 不能为空');
  return normalized as CreateManagedTargetDto['executionLocations'];
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
  siteAssetStatuses,
  managedTargetStatuses,
  applicationAssetTargetStatuses,
  conflictResolutions,
  osTypes: OsTypes,
  compatibilityLevels: CompatibilityLevels,
  managementModes: ManagementModes,
} as const;

export type AssetsDomainEnums = {
  hostStatus: HostStatus;
  serviceInstanceStatus: FrameworkInstanceStatus;
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
};

function inferAddressType(address: string): 'DNS' | 'IPV4' | 'IPV6' | 'UNKNOWN' {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) return 'IPV4';
  if (address.includes(':')) return 'IPV6';
  if (address.includes('.')) return 'DNS';
  return 'UNKNOWN';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function replaceUrlHostname(value: string, sourceHosts: Set<string>, nextHost: string): string | undefined {
  try {
    const url = new URL(value);
    if (!sourceHosts.has(url.hostname.toLowerCase())) return undefined;
    if (url.hostname.toLowerCase() === nextHost.toLowerCase()) return value;
    url.hostname = nextHost;
    return url.toString();
  } catch {
    return undefined;
  }
}
