import { AppError } from '../../../common/errors/app-error.js';
import type {
  UnifiedPluginCapabilityDescriptor,
  UnifiedPluginManifestV1,
  UnifiedPluginRuntime,
  UnifiedPluginScope,
  UnifiedPluginSource,
  UnifiedPluginSupport,
  UnifiedPluginTrust,
} from '../dto/unified-plugins.dto.js';

export const unifiedPluginRuntimes = ['AGENT_ATOMIC', 'WORKFLOW_DSL'] as const satisfies readonly UnifiedPluginRuntime[];
export const unifiedPluginSources = ['BUILTIN', 'USER'] as const satisfies readonly UnifiedPluginSource[];
export const unifiedPluginScopes = ['MANAGED', 'STANDALONE', 'BOTH'] as const satisfies readonly UnifiedPluginScope[];
export const unifiedPluginTrustLevels = ['OFFICIAL_SIGNED', 'USER_SIGNED', 'UNSIGNED'] as const satisfies readonly UnifiedPluginTrust[];
export const unifiedPluginSupportLevels = ['OFFICIAL', 'COMMUNITY', 'SELF_MANAGED'] as const satisfies readonly UnifiedPluginSupport[];

const forbiddenResourceExtensions = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.vue', '.ps1', '.sh', '.bat', '.cmd', '.exe'];
const maximumResourceCount = 500;
const maximumResourceBytes = 20 * 1024 * 1024;
const manifestKeys = new Set([
  'apiVersion', 'kind', 'pluginId', 'version', 'displayNameKey', 'descriptionKey', 'logoUrl', 'defaultLocale', 'publisher', 'runtime',
  'source', 'scope', 'trust', 'support', 'minGcacVersion', 'capabilities', 'permissions', 'compatibility', 'resources',
]);

export function validateUnifiedPluginManifest(input: unknown): UnifiedPluginManifestV1 {
  const manifest = requireRecord(input, 'manifest');
  assertKnownKeys(manifest, manifestKeys, 'manifest');
  if (manifest.apiVersion !== 'gcac.plugin-manifest/v1') fail('apiVersion', '仅支持 gcac.plugin-manifest/v1');
  if (manifest.kind !== 'GcacPlugin') fail('kind', '仅支持 GcacPlugin');
  const runtime = requireEnum(manifest.runtime, unifiedPluginRuntimes, 'runtime');
  const source = requireEnum(manifest.source, unifiedPluginSources, 'source');
  const scope = requireEnum(manifest.scope, unifiedPluginScopes, 'scope');
  const trust = requireEnum(manifest.trust, unifiedPluginTrustLevels, 'trust');
  const support = requireEnum(manifest.support, unifiedPluginSupportLevels, 'support');
  const capabilities = requireArray(manifest.capabilities, 'capabilities').map(validateCapability);
  if (capabilities.length === 0) fail('capabilities', '至少声明一项能力');
  const resources = requireRecord(manifest.resources, 'resources');
  validateResourceMaps(resources);
  if (runtime === 'AGENT_ATOMIC' && Object.keys(readStringMap(resources.agentRecipes)).length === 0) {
    fail('resources.agentRecipes', 'AGENT_ATOMIC 插件必须声明 Agent Recipe');
  }
  if (runtime === 'WORKFLOW_DSL' && Object.keys(readStringMap(resources.workflows)).length === 0) {
    fail('resources.workflows', 'WORKFLOW_DSL 插件必须声明 Workflow DSL');
  }
  return {
    apiVersion: 'gcac.plugin-manifest/v1',
    kind: 'GcacPlugin',
    pluginId: requireString(manifest.pluginId, 'pluginId'),
    version: requireString(manifest.version, 'version'),
    displayNameKey: requireString(manifest.displayNameKey, 'displayNameKey'),
    descriptionKey: optionalString(manifest.descriptionKey, 'descriptionKey'),
    logoUrl: optionalLogoUrl(manifest.logoUrl),
    defaultLocale: optionalString(manifest.defaultLocale, 'defaultLocale'),
    publisher: requireString(manifest.publisher, 'publisher'),
    runtime,
    source,
    scope,
    trust,
    support,
    minGcacVersion: optionalString(manifest.minGcacVersion, 'minGcacVersion'),
    capabilities,
    permissions: requireStringArray(manifest.permissions ?? [], 'permissions'),
    compatibility: readCompatibility(manifest.compatibility),
    resources: {
      workflows: readStringMap(resources.workflows),
      agentRecipes: readStringMap(resources.agentRecipes),
      forms: readStringMap(resources.forms),
      presentations: readStringMap(resources.presentations),
      locales: readStringMap(resources.locales),
      discoveryMappings: readStringMap(resources.discoveryMappings),
      agentDiscoveryMappings: readStringMap(resources.agentDiscoveryMappings),
      actionAliases: readStringMap(resources.actionAliases),
    },
  };
}

function optionalLogoUrl(input: unknown): string | undefined {
  const value = optionalString(input, 'logoUrl');
  if (value === undefined) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) fail('logoUrl', '只支持 HTTP(S) URL 或本地 Web 路径');
  const normalized = value.replace(/\\/g, '/');
  if (normalized.split('/').includes('..')) fail('logoUrl', '本地路径不能包含 ..');
  return value;
}

export function assertUnifiedPluginResources(manifest: UnifiedPluginManifestV1, resources: Record<string, string>): void {
  const entries = Object.entries(resources);
  if (entries.length > maximumResourceCount) fail('resources', '资源文件数量超限', { maximumResourceCount });
  const totalBytes = entries.reduce((total, [, content]) => total + Buffer.byteLength(content, 'utf8'), 0);
  if (totalBytes > maximumResourceBytes) fail('resources', '资源总大小超限', { maximumResourceBytes });
  const declared = Object.values(manifest.resources).flatMap((mapping) => Object.values(mapping ?? {}));
  const missing = declared.filter((path) => !(path in resources));
  if (missing.length > 0) fail('resources', '插件资源缺失', { missing });
  for (const path of Object.keys(resources)) {
    const normalized = path.replaceAll('\\', '/');
    if (normalized.startsWith('/') || normalized.includes('../')) fail(`resources.${path}`, '资源路径不安全');
    if (forbiddenResourceExtensions.some((extension) => normalized.toLowerCase().endsWith(extension))) {
      fail(`resources.${path}`, '插件不得携带可执行代码');
    }
  }
}

function assertKnownKeys(record: Record<string, unknown>, allowed: Set<string>, path: string): void {
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  if (unknown.length > 0) fail(path, '包含未知字段', { unknown });
}

function validateCapability(input: unknown, index: number): UnifiedPluginCapabilityDescriptor {
  const item = requireRecord(input, `capabilities.${index}`);
  const locations = requireStringArray(item.executionLocations, `capabilities.${index}.executionLocations`);
  const allowed = ['AGENT', 'CONTROL_PLANE', 'GATEWAY'] as const;
  if (locations.some((location) => !allowed.includes(location as typeof allowed[number]))) {
    fail(`capabilities.${index}.executionLocations`, '执行位置不支持');
  }
  const riskLevel = requireEnum(item.riskLevel, ['LOW', 'MEDIUM', 'HIGH'] as const, `capabilities.${index}.riskLevel`);
  return {
    key: requireString(item.key, `capabilities.${index}.key`),
    contractVersion: requireString(item.contractVersion, `capabilities.${index}.contractVersion`),
    actionContractId: requireString(item.actionContractId, `capabilities.${index}.actionContractId`),
    riskLevel,
    executionLocations: locations as UnifiedPluginCapabilityDescriptor['executionLocations'],
  };
}

function validateResourceMaps(resources: Record<string, unknown>): void {
  for (const key of ['workflows', 'agentRecipes', 'forms', 'presentations', 'locales', 'discoveryMappings', 'agentDiscoveryMappings', 'actionAliases']) {
    readStringMap(resources[key], `resources.${key}`);
  }
}

function readCompatibility(input: unknown): UnifiedPluginManifestV1['compatibility'] {
  if (input === undefined) return undefined;
  const record = requireRecord(input, 'compatibility');
  assertKnownKeys(record, new Set(['productFamilies', 'frameworkTypes', 'targetTypes', 'managementMethods', 'executionLocations', 'artifactContracts']), 'compatibility');
  return {
    productFamilies: record.productFamilies === undefined ? undefined : requireStringArray(record.productFamilies, 'compatibility.productFamilies'),
    frameworkTypes: record.frameworkTypes === undefined ? undefined : requireStringArray(record.frameworkTypes, 'compatibility.frameworkTypes'),
    targetTypes: record.targetTypes === undefined ? undefined : requireStringArray(record.targetTypes, 'compatibility.targetTypes'),
    managementMethods: record.managementMethods === undefined ? undefined : requireArray(record.managementMethods, 'compatibility.managementMethods').map((item, index) => requireEnum(item, ['AGENT', 'PLUGIN', 'MANUAL'] as const, `compatibility.managementMethods.${index}`)),
    executionLocations: record.executionLocations === undefined ? undefined : requireArray(record.executionLocations, 'compatibility.executionLocations').map((item, index) => requireEnum(item, ['AGENT', 'CONTROL_PLANE', 'GATEWAY'] as const, `compatibility.executionLocations.${index}`)),
    artifactContracts: record.artifactContracts === undefined ? undefined : requireStringArray(record.artifactContracts, 'compatibility.artifactContracts'),
  };
}

function readStringMap(input: unknown, path = 'resources'): Record<string, string> {
  if (input === undefined) return {};
  const record = requireRecord(input, path);
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) result[key] = requireString(value, `${path}.${key}`);
  return result;
}

function requireRecord(input: unknown, path: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(path, '必须是对象');
  return input as Record<string, unknown>;
}

function requireArray(input: unknown, path: string): unknown[] {
  if (!Array.isArray(input)) fail(path, '必须是数组');
  return input;
}

function requireString(input: unknown, path: string): string {
  if (typeof input !== 'string' || input.trim() === '') fail(path, '必须是非空字符串');
  return input;
}

function optionalString(input: unknown, path: string): string | undefined {
  return input === undefined ? undefined : requireString(input, path);
}

function requireStringArray(input: unknown, path: string): string[] {
  return requireArray(input, path).map((item, index) => requireString(item, `${path}.${index}`));
}

function requireEnum<T extends string>(input: unknown, allowed: readonly T[], path: string): T {
  if (typeof input !== 'string' || !allowed.includes(input as T)) fail(path, `必须是 ${allowed.join('、')} 之一`);
  return input as T;
}

function fail(path: string, message: string, details: Record<string, unknown> = {}): never {
  throw new AppError('VALIDATION_FAILED', `统一插件 Manifest 无效：${message}`, { path, ...details });
}
