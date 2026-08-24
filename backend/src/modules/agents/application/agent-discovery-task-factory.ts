import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { UnifiedAgentPlanPolicyAuthorityPortV1 } from '../../plugins/application/unified-agent-plan-authorization.port.js';
import type { UnifiedPluginsApplicationService } from '../../plugins/application/unified-plugins.application-service.js';
import type { UnifiedPluginVersionRecord } from '../../plugins/dto/unified-plugins.dto.js';
import { canonicalPluginIds } from '../../plugins/canonical-plugin-id/canonical-plugin-id.registry.js';
import type { AgentRegistration } from '../schema/agents.schema.js';
import { selectWebDiscoveryPaths } from '../agent-discovery-paths.js';

const DISCOVERY_SPEC_VERSION = 'gcac.agent-web-discovery/v1';
const DEFAULT_CERTIFICATE_FILE_EXTENSIONS = ['.cer', '.crt', '.der', '.pem'];

interface AgentWebDiscoverySpecProfile {
  pluginId: string;
  frameworkType: string;
  processNames: string[];
  serviceNames: string[];
  commandLineContains: string[];
  configArgKeys: string[];
  rootArgKeys: string[];
  configPathHints: string[];
  targetPathHints: string[];
  defaultConfigRelativePaths: string[];
  configFileNames: string[];
  certificateFileExtensions: string[];
  listeningPorts: number[];
}

interface AgentWebDiscoverySpec {
  specVersion: typeof DISCOVERY_SPEC_VERSION;
  source: 'declarative-plugin-metadata';
  profiles: AgentWebDiscoverySpecProfile[];
}

export interface AgentDiscoveryRequestFactory {
  createForAgent(input: {
    tenantId: string;
    agent: AgentRegistration;
    requestedBy: string;
    requestId: string;
  }): Promise<AgentDirectDiscoveryRequest>;
}

export interface AgentDirectDiscoveryRequest {
  requestId: string;
  payload: Record<string, unknown>;
}

/**
 * 手动 Web 重新发现直接调用 Agent Core 的管理端点。
 *
 * 发现是只读且短时的操作，不应先写入 Agent 队列再等待反向轮询。授权载荷
 * 仍使用 Agent v2 合同，Agent 只接受签名有效且范围为 application.discover
 * 的 agent.fact.collect 请求。
 */
export function createAgentDiscoveryTaskFactory(dependencies: {
  plugins: UnifiedPluginsApplicationService;
  policyAuthority: UnifiedAgentPlanPolicyAuthorityPortV1;
}): AgentDiscoveryRequestFactory {
  return {
    createForAgent: (input) => createDiscoveryRequest(dependencies, input),
  };
}

async function createDiscoveryRequest(
  dependencies: Parameters<typeof createAgentDiscoveryTaskFactory>[0],
  input: Parameters<AgentDiscoveryRequestFactory['createForAgent']>[0],
): Promise<AgentDirectDiscoveryRequest> {
  const versions = await dependencies.plugins.listAccessibleVersions(input.tenantId);
  const anchor = selectAuthorizationAnchor(versions);
  if (!anchor) throw new AppError('CAPABILITY_MISSING', '没有启用且支持 Agent 发现授权的 Canonical 插件版本');

  const paths = discoveryPathsFor(input.agent);
  const discoverySpec = buildAgentWebDiscoverySpec(versions, input.agent.descriptor.osType);
  const planDigest = digest({
    actionType: 'agent.fact.collect',
    agentId: input.agent.id,
    tenantId: input.tenantId,
    pluginId: anchor.pluginId,
    pluginVersionId: anchor.id,
    capability: 'application.discover',
    paths,
    discoverySpec,
    refreshWebInventory: true,
  });
  dependencies.policyAuthority.assertReady();
  const authorization = await dependencies.policyAuthority.issueAuthorization({
    agentId: input.agent.id,
    tenantId: input.tenantId,
    pluginId: anchor.pluginId,
    pluginVersionId: anchor.id,
    capability: 'application.discover',
    actions: ['filesystem.read', 'process.list', 'service.list'],
    allowedPaths: paths,
    allowedServices: [],
    artifactDigests: [],
    policyRef: 'gcac.agent.discovery',
    policyVersion: '1',
    planDigest,
    lifetimeSeconds: 300,
  });
  if (!authorization.token || authorization.decision.allowed !== true) {
    throw new AppError('AGENT_AUTHORIZATION_UNAVAILABLE', 'Web 发现授权未签发', {
      reason: authorization.decision.reason ?? 'Policy Authority 未返回允许的发现决策',
    });
  }

  return {
    requestId: input.requestId,
    payload: {
      actionType: 'agent.fact.collect',
      actionSchemaVersion: '1.0',
      requestId: input.requestId,
      agentId: input.agent.id,
      tenantId: input.tenantId,
      pluginId: anchor.pluginId,
      // Agent v2 字段历史上命名为 pluginVersion，但其安全合同绑定的是版本 ID。
      pluginVersion: anchor.id,
      capability: 'application.discover',
      actions: authorization.token.actions,
      paths: authorization.token.allowedPaths,
      services: authorization.token.allowedServices,
      artifactDigests: authorization.token.artifactDigests,
      planDigest,
      token: authorization.token,
      policyDecision: authorization.decision,
      discoverySpec,
      refreshWebInventory: true,
      requestedBy: input.requestedBy,
    },
  };
}

function selectAuthorizationAnchor(versions: UnifiedPluginVersionRecord[]): UnifiedPluginVersionRecord | undefined {
  const candidates = versions
    .filter(isTrustedBuiltinDiscoveryPlugin)
    .filter((version) => version.manifest.capabilities.some((capability) => capability.key === 'application.discover' && capability.executionLocations.includes('AGENT')))
    .sort((left, right) => {
      return left.pluginId.localeCompare(right.pluginId) || right.version.localeCompare(left.version);
    });
  return candidates[0];
}

function discoveryPathsFor(agent: AgentRegistration): string[] {
  return [...selectWebDiscoveryPaths(agent.descriptor.osType)];
}

function buildAgentWebDiscoverySpec(versions: UnifiedPluginVersionRecord[], osType: string): AgentWebDiscoverySpec {
  const source = osType.toLowerCase().includes('windows') ? 'windows' : 'linux';
  const profiles = versions
    .filter(isTrustedBuiltinDiscoveryPlugin)
    .flatMap((version) => discoveryProfilesForVersion(version, source));
  return {
    specVersion: DISCOVERY_SPEC_VERSION,
    source: 'declarative-plugin-metadata',
    profiles: dedupeProfiles(profiles),
  };
}

/**
 * 发现 profile 是插件的静态声明，不应再由宿主维护产品 ID 白名单。
 * 安全边界由四件事共同构成：Canonical 注册表、内置来源、官方签名信任、Agent 发现能力。
 * 用户插件即使伪造同名 capability，也不能进入 Agent 单轮扫描。
 */
function isTrustedBuiltinDiscoveryPlugin(version: UnifiedPluginVersionRecord): boolean {
  return version.status === 'ENABLED'
    && version.source === 'BUILTIN'
    && version.trust === 'OFFICIAL_SIGNED'
    && canonicalPluginIds.includes(version.pluginId as (typeof canonicalPluginIds)[number])
    && version.manifest.pluginId === version.pluginId
    && version.manifest.source === 'BUILTIN'
    && version.manifest.trust === 'OFFICIAL_SIGNED'
    && version.manifest.capabilities.some((capability) => capability.key === 'application.discover' && capability.executionLocations.includes('AGENT'));
}

function discoveryProfilesForVersion(version: UnifiedPluginVersionRecord, source: 'windows' | 'linux'): AgentWebDiscoverySpecProfile[] {
  const resourcePath = version.manifest.resources?.discoveryMappings?.profiles;
  const raw = resourcePath ? version.resources?.[resourcePath] : undefined;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { profiles?: unknown[] };
    return Array.isArray(parsed.profiles)
      ? parsed.profiles.flatMap((profile) => normalizeDiscoveryProfile(version.pluginId, profile, source))
      : [];
  } catch {
    // 插件发现资源坏了不能扩大扫描范围。
  }
  return [];
}

function normalizeDiscoveryProfile(pluginId: string, raw: unknown, source: 'windows' | 'linux'): AgentWebDiscoverySpecProfile[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const profile = raw as Record<string, unknown>;
  const sources = stringArray(profile.sources);
  if (sources.length > 0 && !sources.includes(source)) return [];
  return [{
    pluginId,
    frameworkType: safeIdentifier(stringValue(profile.frameworkType) ?? pluginId) ?? pluginId,
    processNames: basenames(stringArray(profile.processExecutables)),
    serviceNames: safeStrings(stringArray(profile.serviceNames), 32),
    commandLineContains: safeStrings(stringArray(profile.commandLineContains), 16),
    configArgKeys: safeStrings(stringArray(profile.configArgKeys), 16),
    rootArgKeys: safeStrings(stringArray(profile.rootArgKeys), 16),
    configPathHints: safePaths(stringArray(profile.configPaths), source),
    targetPathHints: safePaths(stringArray(profile.targetPaths), source),
    defaultConfigRelativePaths: safeRelativePaths(stringArray(profile.defaultConfigRelativePaths)),
    configFileNames: safeStrings(stringArray(profile.configFileNames), 32),
    certificateFileExtensions: unique([
      ...DEFAULT_CERTIFICATE_FILE_EXTENSIONS,
      ...safeStrings(stringArray(profile.certificateFileExtensions), 16),
    ]),
    listeningPorts: ports(profile.listeningPorts),
  }];
}

function mergeDiscoveryProfile(
  fallback: AgentWebDiscoverySpecProfile | undefined,
  current: AgentWebDiscoverySpecProfile,
): AgentWebDiscoverySpecProfile {
  if (!fallback) return current;
  return {
    ...current,
    processNames: unique([...fallback.processNames, ...current.processNames]),
    serviceNames: unique([...fallback.serviceNames, ...current.serviceNames]),
    commandLineContains: unique([...fallback.commandLineContains, ...current.commandLineContains]),
    configArgKeys: unique([...fallback.configArgKeys, ...current.configArgKeys]),
    rootArgKeys: unique([...fallback.rootArgKeys, ...current.rootArgKeys]),
    configPathHints: unique([...fallback.configPathHints, ...current.configPathHints]),
    targetPathHints: unique([...fallback.targetPathHints, ...current.targetPathHints]),
    defaultConfigRelativePaths: unique([...fallback.defaultConfigRelativePaths, ...current.defaultConfigRelativePaths]),
    configFileNames: unique([...fallback.configFileNames, ...current.configFileNames]),
    certificateFileExtensions: unique([...fallback.certificateFileExtensions, ...current.certificateFileExtensions]),
    listeningPorts: [...new Set([...fallback.listeningPorts, ...current.listeningPorts])].sort((left, right) => left - right),
  };
}

function dedupeProfiles(profiles: AgentWebDiscoverySpecProfile[]): AgentWebDiscoverySpecProfile[] {
  const byPlugin = new Map<string, AgentWebDiscoverySpecProfile>();
  for (const item of profiles) {
    const current = byPlugin.get(item.pluginId);
    byPlugin.set(item.pluginId, current ? mergeDiscoveryProfile(current, item) : item);
  }
  return [...byPlugin.values()].sort((left, right) => left.pluginId.localeCompare(right.pluginId));
}

function basenames(paths: string[]): string[] {
  return unique(paths.map((item) => item.replaceAll('\\', '/').split('/').pop() ?? '').filter(Boolean));
}

function safePaths(paths: string[], source: 'windows' | 'linux'): string[] {
  return unique(paths.filter((item) => source === 'windows' ? /^[A-Za-z]:[\\/]/.test(item) : item.startsWith('/')).slice(0, 32));
}

function safeRelativePaths(paths: string[]): string[] {
  return unique(paths.filter((item) => item.length <= 260 && !/^[A-Za-z]:[\\/]/.test(item) && !item.startsWith('/') && !item.replaceAll('\\', '/').split('/').includes('..')).slice(0, 16));
}

function safeStrings(values: string[], limit: number): string[] {
  return unique(values.filter((item) => /^[A-Za-z0-9._*:-]{1,128}$/.test(item)).slice(0, limit));
}

function safeIdentifier(value: string | undefined): string | undefined {
  return value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim()) : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function ports(value: unknown): number[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is number => Number.isInteger(item) && item > 0 && item <= 65535))].slice(0, 32).sort((left, right) => left - right)
    : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))].slice(0, 64);
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}
