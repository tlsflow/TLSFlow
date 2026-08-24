import type {
  ManagedDeviceHealth,
  ManagedDeviceSummaryDto,
} from '../dto/devices.dto.js';
import { isObservationStale, readPositiveSeconds } from '../../../shared/observation-freshness.js';

export interface ManagedDeviceProjectionSource {
  id: string;
  displayName?: string;
  hostname?: string;
  primaryIp?: string;
  osType: string;
  osName?: string;
  osVersion?: string;
  managementMode: string;
  hostStatus: string;
  lastDiscoveredAt?: string;
  applicationAssetCount: number;
  agent?: {
    payload: Record<string, unknown>;
    capabilitySnapshot: Record<string, unknown>;
    lastHeartbeatAt?: string;
  };
  networkAppliance?: {
    deviceFamily: string;
    productName?: string;
    softwareVersion?: string;
    softwareBuild?: string;
    supportTier?: string;
    capabilityProfile: Record<string, unknown>;
    lastDiscoveredAt?: string;
    lastErrorCode?: string;
    managementAddress?: string;
  };
}

export interface ManagedDeviceProjectionAdapter {
  readonly key: string;
  supports(source: ManagedDeviceProjectionSource): boolean;
  project(source: ManagedDeviceProjectionSource): ManagedDeviceSummaryDto;
}

const SERVER_PRODUCT_FAMILY_BY_OS: Readonly<Record<string, string>> = {
  WINDOWS: 'Windows Server',
  LINUX: 'Linux Server',
};

export class AgentManagedDeviceProjectionAdapter implements ManagedDeviceProjectionAdapter {
  readonly key = 'AGENT';

  supports(source: ManagedDeviceProjectionSource): boolean {
    return source.agent !== undefined;
  }

  project(source: ManagedDeviceProjectionSource): ManagedDeviceSummaryDto {
    const payload = source.agent?.payload ?? {};
    const descriptor = asRecord(payload.descriptor);
    const sourceStatus = stringValue(payload.status) ?? source.hostStatus;
    const lastContactAt = source.agent?.lastHeartbeatAt
      ?? stringValue(asRecord(payload.gateway).lastHeartbeatAt)
      ?? stringValue(payload.updatedAt)
      ?? source.lastDiscoveredAt;
    const osType = (stringValue(descriptor.osType) ?? source.osType).toUpperCase();
    return {
      id: source.id,
      displayName: source.displayName ?? source.hostname ?? source.primaryIp ?? source.id,
      category: 'SERVER',
      productFamily: SERVER_PRODUCT_FAMILY_BY_OS[osType] ?? source.osName ?? osType,
      managementMethod: source.managementMode,
      managementAddress: source.primaryIp ?? source.hostname,
      health: mapAgentHealth(sourceStatus, lastContactAt),
      sourceStatus,
      softwareVersion: projectAgentSystemVersion(osType, descriptor, source),
      lastContactAt,
      applicationAssetCount: source.applicationAssetCount,
      capabilities: stringArray(descriptor.capabilities),
      extensionType: 'AGENT',
    };
  }
}

export class PluginManagedDeviceProjectionAdapter implements ManagedDeviceProjectionAdapter {
  readonly key = 'PLUGIN';

  supports(source: ManagedDeviceProjectionSource): boolean {
    return source.networkAppliance !== undefined;
  }

  project(source: ManagedDeviceProjectionSource): ManagedDeviceSummaryDto {
    const appliance = requireNetworkAppliance(source);
    const capabilities = Object.entries(appliance.capabilityProfile)
      .filter(([, enabled]) => enabled === true)
      .map(([name]) => name);
    const sourceStatus = appliance.lastErrorCode
      ? 'ERROR'
      : appliance.lastDiscoveredAt
        ? 'DISCOVERED'
        : source.hostStatus;
    return {
      id: source.id,
      displayName: source.displayName ?? appliance.managementAddress ?? source.id,
      category: 'NETWORK_APPLIANCE',
      productFamily: appliance.productName ?? appliance.deviceFamily,
      managementMethod: 'PLUGIN',
      managementAddress: appliance.managementAddress ?? source.primaryIp ?? source.hostname,
      health: mapNetworkDeviceHealth(
        source.hostStatus,
        appliance.lastErrorCode,
        appliance.supportTier,
        appliance.lastDiscoveredAt,
      ),
      sourceStatus,
      softwareVersion: joinVersion(appliance.softwareVersion, appliance.softwareBuild),
      lastContactAt: appliance.lastDiscoveredAt ?? source.lastDiscoveredAt,
      applicationAssetCount: source.applicationAssetCount,
      capabilities,
      extensionType: 'NETWORK_APPLIANCE',
    };
  }
}

export class ManagedDeviceProjectionRegistry {
  constructor(
    private readonly adapters: readonly ManagedDeviceProjectionAdapter[] = [
      new AgentManagedDeviceProjectionAdapter(),
      new PluginManagedDeviceProjectionAdapter(),
    ],
  ) {}

  project(source: ManagedDeviceProjectionSource): ManagedDeviceSummaryDto {
    const adapter = this.adapters.find((candidate) => candidate.supports(source));
    if (!adapter) {
      const deviceType = source.networkAppliance?.deviceFamily ?? source.managementMode;
      throw new Error(`Unsupported managed device projection: ${deviceType}`);
    }
    return adapter.project(source);
  }
}

export function mapNetworkDeviceHealth(
  hostStatus: string,
  lastErrorCode?: string,
  supportTier?: string,
  lastDiscoveredAt?: string,
  now: Date = new Date(),
): ManagedDeviceHealth {
  return resolveManagedDeviceHealth({
    sourceStatus: hostStatus,
    lastContactAt: lastDiscoveredAt,
    lastErrorCode,
    degraded: supportTier?.trim().toUpperCase() === 'UNSUPPORTED',
    staleAfterSeconds: readPositiveSeconds('DEVICE_HEALTH_STALE_SECONDS', 300),
    staleHealth: 'UNKNOWN',
    now,
  });
}

export function mapAgentHealth(status: string, lastHeartbeatAt?: string, now: Date = new Date()): ManagedDeviceHealth {
  return resolveManagedDeviceHealth({
    sourceStatus: status,
    lastContactAt: lastHeartbeatAt,
    staleAfterSeconds: readPositiveSeconds('AGENT_OFFLINE_TIMEOUT_SECONDS', 180),
    staleHealth: 'UNREACHABLE',
    now,
  });
}

interface ManagedDeviceHealthObservation {
  sourceStatus: string;
  lastContactAt?: string;
  lastErrorCode?: string;
  degraded?: boolean;
  staleAfterSeconds: number;
  staleHealth: Extract<ManagedDeviceHealth, 'UNKNOWN' | 'UNREACHABLE'>;
  now: Date;
}

export function resolveManagedDeviceHealth(observation: ManagedDeviceHealthObservation): ManagedDeviceHealth {
  const normalized = observation.sourceStatus.trim().toUpperCase();
  if (normalized === 'DISABLED' || normalized === 'REVOKED' || normalized === 'DELETED') return 'DISABLED';
  if (observation.lastErrorCode || normalized === 'OFFLINE' || normalized === 'UNREACHABLE' || normalized === 'ERROR') {
    return 'UNREACHABLE';
  }
  if (isObservationStale(observation.lastContactAt, observation.staleAfterSeconds, observation.now)) return observation.staleHealth;
  if (observation.degraded || normalized === 'UPGRADING' || normalized === 'DEGRADED' || normalized === 'STALE') {
    return 'DEGRADED';
  }
  if (observation.lastContactAt && ['ONLINE', 'ACTIVE', 'HEALTHY', 'DISCOVERED'].includes(normalized)) return 'HEALTHY';
  return 'UNKNOWN';
}

function projectAgentSystemVersion(
  osType: string,
  descriptor: Record<string, unknown>,
  source: ManagedDeviceProjectionSource,
): string | undefined {
  const rawVersion = stringValue(descriptor.osVersion) ?? source.osVersion;
  const osVersion = rawVersion && rawVersion.toUpperCase() !== 'WINDOWS_NT' ? rawVersion : undefined;
  if (osType === 'WINDOWS') return osVersion ?? projectWindowsCapabilityVersion(source) ?? source.osName;
  if (osType !== 'LINUX') return osVersion ?? source.osName;
  const distribution = stringValue(descriptor.linuxDistribution) ?? source.osName;
  if (!distribution) return osVersion;
  if (/\d/.test(distribution)) return distribution;
  if (!osVersion || distribution.includes(osVersion)) return distribution;
  return `${distribution} ${osVersion}`;
}

function projectWindowsCapabilityVersion(source: ManagedDeviceProjectionSource): string | undefined {
  const capabilities = source.agent?.capabilitySnapshot.capabilities;
  if (!Array.isArray(capabilities)) return undefined;
  const osCapability = capabilities
    .map(asRecord)
    .find((item) => {
      const key = stringValue(item.capabilityKey);
      return key === 'windows.os.detail' || key === 'windows.os.inspect';
    });
  if (!osCapability) return undefined;
  const detail = asRecord(osCapability.value);
  const productName = firstString(detail, ['ProductName', 'productName', 'Caption', 'caption']);
  const displayVersion = firstString(detail, ['DisplayVersion', 'displayVersion']);
  const build = firstString(detail, ['BuildRevision', 'buildRevision', 'CurrentBuild', 'currentBuild', 'BuildNumber', 'buildNumber']);
  if (productName && displayVersion) return `${productName} ${displayVersion}`;
  if (productName && build) return `${productName} (Build ${build})`;
  return productName ?? firstString(detail, ['osVersion', 'Version', 'version']);
}

function requireNetworkAppliance(source: ManagedDeviceProjectionSource) {
  if (!source.networkAppliance) throw new Error('Network appliance projection source is required');
  return source.networkAppliance;
}

function joinVersion(version?: string, build?: string): string | undefined {
  return [version, build].filter(Boolean).join(' ') || undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return undefined;
}
