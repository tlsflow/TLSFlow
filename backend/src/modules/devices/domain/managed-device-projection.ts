import type {
  ManagedDeviceHealth,
  ManagedDeviceSummaryDto,
} from '../dto/devices.dto.js';
import { isObservationStale, readPositiveSeconds, readDiscoveryStaleSeconds } from '../../../shared/observation-freshness.js';
import { LivenessDomainService } from '../../liveness/domain/liveness.domain-service.js';
import type { DeviceLivenessSignal } from '../../liveness/schema/liveness.schema.js';

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
  livenessSignals?: DeviceLivenessSignal[];
  agent?: {
    payload: Record<string, unknown>;
    capabilitySnapshot: Record<string, unknown>;
    lastHeartbeatAt?: string;
    agentId?: string;
    role?: string;
    upgradeAvailable?: boolean;
    targetVersion?: string;
  };
  networkAppliance?: {
    deviceFamily: string;
    productName?: string;
    softwareVersion?: string;
    softwareBuild?: string;
    pluginVersion?: string;
    supportTier?: string;
    capabilityProfile: Record<string, unknown>;
    lastDiscoveredAt?: string;
    lastErrorCode?: string;
    managementAddress?: string;
    /** 中文说明：云控制面只依赖发现结果，不应被管理 TCP 探测覆盖。 */
    metadata?: Record<string, unknown>;
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
      ?? stringValue(asRecord(payload.gateway).lastHeartbeatAt);
    const osType = (stringValue(descriptor.osType) ?? source.osType).toUpperCase();
    const healthStatus = mapAgentHealth(sourceStatus, lastContactAt);
    // 管理 TCP 是反向探测能力，不是 Agent 心跳。TCP 不通时 Agent 仍可在线并主动拉取任务。
    const liveness = new LivenessDomainService().project(source.livenessSignals ?? [], ['HEARTBEAT']);
    return {
      id: source.id,
      displayName: source.displayName ?? source.hostname ?? source.primaryIp ?? source.id,
      category: 'SERVER',
      productFamily: SERVER_PRODUCT_FAMILY_BY_OS[osType] ?? source.osName ?? osType,
      managementMethod: source.managementMode,
      managementAddress: source.primaryIp ?? source.hostname,
      ...liveness,
      livenessSignals: liveness.signals,
      healthStatus,
      health: liveness.livenessStatus === 'OFFLINE' ? 'UNREACHABLE' : healthStatus,
      sourceStatus,
      softwareVersion: projectAgentSystemVersion(osType, descriptor, source),
      controlVersion: stringValue(descriptor.version),
      lastContactAt,
      applicationAssetCount: source.applicationAssetCount,
      capabilities: stringArray(descriptor.capabilities),
      extensionType: 'AGENT',
      agentId: source.agent?.agentId,
      agentRole: source.agent?.role,
      upgradeAvailable: source.agent?.upgradeAvailable,
      targetVersion: source.agent?.targetVersion,
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
    const isCloudService = stringValue(appliance.metadata?.deviceCategory)?.toUpperCase() === 'CLOUD'
      || stringValue(appliance.metadata?.livenessMode)?.toUpperCase() === 'DISCOVERY'
      || appliance.deviceFamily.trim().toLowerCase().startsWith('cloud.');
    const capabilities = Object.entries(appliance.capabilityProfile)
      .filter(([, enabled]) => enabled === true)
      .map(([name]) => name);
    const sourceStatus = appliance.lastErrorCode
      ? 'ERROR'
      : appliance.lastDiscoveredAt
        ? 'DISCOVERED'
        : source.hostStatus;
    const healthStatus = mapNetworkDeviceHealth(
      sourceStatus,
      appliance.lastErrorCode,
      appliance.supportTier,
      appliance.lastDiscoveredAt,
    );
    const liveness = isCloudService
      ? undefined
      : new LivenessDomainService().project(source.livenessSignals ?? [], ['MANAGEMENT_TCP']);
    const projectedHealth = liveness
      ? mergeNetworkHealthWithLiveness(healthStatus, liveness.livenessStatus, liveness.signals.length > 0)
      : healthStatus;
    return {
      id: source.id,
      displayName: source.displayName ?? appliance.managementAddress ?? source.id,
      category: isCloudService ? 'CLOUD' : 'NETWORK_APPLIANCE',
      productFamily: appliance.productName ?? appliance.deviceFamily,
      managementMethod: 'PLUGIN',
      managementAddress: appliance.managementAddress ?? source.primaryIp ?? source.hostname,
      ...(liveness ?? {}),
      livenessSignals: liveness?.signals ?? [],
      healthStatus: projectedHealth,
      health: projectedHealth,
      sourceStatus,
      ...(isCloudService ? {} : { softwareVersion: joinVersion(appliance.softwareVersion, appliance.softwareBuild) }),
      controlVersion: appliance.pluginVersion,
      lastContactAt: appliance.lastDiscoveredAt ?? source.lastDiscoveredAt,
      applicationAssetCount: source.applicationAssetCount,
      capabilities,
      extensionType: 'NETWORK_APPLIANCE',
    };
  }
}

/**
 * 中文说明：管理 TCP 探测只能证明"这个 IP:PORT 上有人接了 SYN"，
 * 不能证明设备本身健康——云侧 LB / 防火墙 / NAT 都会代答握手。
 * 因此 TCP 信号只允许**降级**（把健康打成不可达），绝不允许**升级**
 * （把未知抬成健康）。健康必须由应用层发现结果这类强证据支撑。
 */
function mergeNetworkHealthWithLiveness(
  healthStatus: ManagedDeviceHealth,
  livenessStatus: 'ONLINE' | 'OFFLINE' | 'UNKNOWN',
  hasLivenessSignal: boolean,
): ManagedDeviceHealth {
  if (livenessStatus === 'OFFLINE') return 'UNREACHABLE';
  if (livenessStatus === 'UNKNOWN' && hasLivenessSignal && healthStatus === 'HEALTHY') return 'UNKNOWN';
  return healthStatus;
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

/**
 * 中文说明：第一个参数必须传**派生后**的来源状态（DISCOVERED / ERROR / 原始
 * host 状态），不能传原始 pg_hosts.status。发现流程只更新
 * pg_device_assets.last_discovered_at，从不回写 pg_hosts.status，
 * 传原始值会让成功发现过的设备永远算不出 HEALTHY。
 */
export function mapNetworkDeviceHealth(
  sourceStatus: string,
  lastErrorCode?: string,
  supportTier?: string,
  lastDiscoveredAt?: string,
  now: Date = new Date(),
): ManagedDeviceHealth {
  return resolveManagedDeviceHealth({
    sourceStatus,
    lastContactAt: lastDiscoveredAt,
    lastErrorCode,
    degraded: supportTier?.trim().toUpperCase() === 'UNSUPPORTED',
    staleAfterSeconds: readDiscoveryStaleSeconds(),
    staleHealth: 'UNKNOWN',
    now,
  });
}

export function mapAgentHealth(status: string, lastHeartbeatAt?: string, now: Date = new Date()): ManagedDeviceHealth {
  return resolveManagedDeviceHealth({
    sourceStatus: status,
    lastContactAt: lastHeartbeatAt,
    staleAfterSeconds: readPositiveSeconds('AGENT_OFFLINE_TIMEOUT_SECONDS', 60),
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
  const descriptorVersion = stringValue(descriptor.osVersion);
  const rawVersion = descriptorVersion && !isWindowsVersionPlaceholder(osType, descriptorVersion)
    ? descriptorVersion
    : stringValue(source.osVersion);
  const osVersion = rawVersion && !isWindowsVersionPlaceholder(osType, rawVersion) ? rawVersion : undefined;
  const projector = agentSystemVersionProjectors[osType] ?? projectDefaultAgentSystemVersion;
  return projector(descriptor, source, osVersion);
}

type AgentSystemVersionProjector = (
  descriptor: Record<string, unknown>,
  source: ManagedDeviceProjectionSource,
  osVersion: string | undefined,
) => string | undefined;

const agentSystemVersionProjectors: Readonly<Record<string, AgentSystemVersionProjector>> = Object.freeze({
  WINDOWS: (_descriptor, source, osVersion) => osVersion ?? projectWindowsCapabilityVersion(source) ?? source.osName,
  LINUX: projectLinuxAgentSystemVersion,
});

function projectDefaultAgentSystemVersion(
  _descriptor: Record<string, unknown>,
  source: ManagedDeviceProjectionSource,
  osVersion: string | undefined,
): string | undefined {
  return osVersion ?? source.osName;
}

function projectLinuxAgentSystemVersion(
  descriptor: Record<string, unknown>,
  source: ManagedDeviceProjectionSource,
  osVersion: string | undefined,
): string | undefined {
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
  const version = firstString(detail, ['osVersion', 'Version', 'version']);
  return productName ?? (version && !isWindowsVersionPlaceholder('WINDOWS', version) ? version : undefined);
}

function isWindowsVersionPlaceholder(osType: string, value: string): boolean {
  if (osType.toUpperCase() !== 'WINDOWS') return false;
  const normalized = value.trim().toUpperCase();
  return normalized === 'WINDOWS' || normalized === 'WINDOWS_NT';
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
