import { AppError } from '../../../common/errors/app-error.js';
import type {
  CredentialAcquireContract,
  UnifiedPluginCapabilityDescriptor,
  UnifiedPluginManifestV1,
  UnifiedPluginRuntime,
  UnifiedPluginScope,
  UnifiedPluginSource,
  UnifiedPluginSupport,
  UnifiedPluginTrust,
} from '../dto/unified-plugins.dto.js';

export const unifiedPluginSources = ['BUILTIN', 'USER'] as const satisfies readonly UnifiedPluginSource[];
export const unifiedPluginScopes = ['MANAGED', 'STANDALONE', 'BOTH'] as const satisfies readonly UnifiedPluginScope[];
export const unifiedPluginTrustLevels = ['OFFICIAL_SIGNED', 'USER_SIGNED', 'UNSIGNED'] as const satisfies readonly UnifiedPluginTrust[];
export const unifiedPluginSupportLevels = ['OFFICIAL', 'COMMUNITY', 'SELF_MANAGED'] as const satisfies readonly UnifiedPluginSupport[];

export const unifiedPluginRuntimes = ['AGENT_PLAN', 'WORKFLOW_DSL'] as const satisfies readonly UnifiedPluginRuntime[];
/** Manifest 版本必须是完整的 SemVer 2.0.0，不接受 v 前缀或隐式版本。 */
export const semanticVersionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const executableCodeExtensions = ['.js', '.mjs', '.cjs'];
const forbiddenExecutableExtensions = ['.ts', '.tsx', '.vue', '.ps1', '.sh', '.bat', '.cmd', '.exe', '.dll', '.so', '.dylib'];
const maximumResourceCount = 500;
const maximumResourceBytes = 20 * 1024 * 1024;
const manifestKeys = new Set([
  'apiVersion', 'kind', 'pluginId', 'version', 'displayNameKey', 'descriptionKey', 'logoUrl', 'defaultLocale', 'publisher', 'runtime',
  'source', 'scope', 'trust', 'support', 'minGcacVersion', 'capabilities',
  'credentialAcquire', 'permissions', 'compatibility', 'resources',
]);

export function validateUnifiedPluginManifest(input: unknown): UnifiedPluginManifestV1 {
  const manifest = requireRecord(input, 'manifest');
  assertKnownKeys(manifest, manifestKeys, 'manifest');
  if (manifest.apiVersion !== 'gcac.plugin-manifest/v1') fail('apiVersion', '仅支持 gcac.plugin-manifest/v1');
  if (manifest.kind !== 'GcacPlugin') fail('kind', '仅支持 GcacPlugin');
  const version = requireSemanticVersion(manifest.version, 'version');
  const runtime = requireEnum(manifest.runtime, unifiedPluginRuntimes, 'runtime');
  const source = requireEnum(manifest.source, unifiedPluginSources, 'source');
  const scope = requireEnum(manifest.scope, unifiedPluginScopes, 'scope');
  const trust = requireEnum(manifest.trust, unifiedPluginTrustLevels, 'trust');
  const support = requireEnum(manifest.support, unifiedPluginSupportLevels, 'support');
  const capabilities = requireArray(manifest.capabilities, 'capabilities').map(validateCapability);
  if (capabilities.length === 0) fail('capabilities', '至少声明一项能力');
  const resources = requireRecord(manifest.resources, 'resources');
  validateResourceMaps(resources);
  if (runtime === 'AGENT_PLAN' && Object.keys(readStringMap(resources.agentPlans)).length === 0) {
    fail('resources.agentPlans', 'AGENT_PLAN 插件必须声明 Agent Plan 模板');
  }
  if (runtime === 'WORKFLOW_DSL' && Object.keys(readStringMap(resources.workflows)).length === 0) {
    fail('resources.workflows', 'WORKFLOW_DSL 插件必须声明 Workflow DSL');
  }
  const permissions = requireStringArray(manifest.permissions ?? [], 'permissions');
  const credentialAcquire = validateCredentialAcquire(manifest.credentialAcquire, capabilities);
  return {
    apiVersion: 'gcac.plugin-manifest/v1',
    kind: 'GcacPlugin',
    pluginId: requireString(manifest.pluginId, 'pluginId'),
    version,
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
    ...(credentialAcquire ? { credentialAcquire } : {}),
    permissions,
    compatibility: readCompatibility(manifest.compatibility),
    resources: {
      ...(resources.runtimeEntrypoint === undefined
        ? {}
        : { runtimeEntrypoint: readResourcePath(resources.runtimeEntrypoint, 'resources.runtimeEntrypoint') }),
      agentPlans: readStringMap(resources.agentPlans),
      workflows: readStringMap(resources.workflows),
      forms: readStringMap(resources.forms),
      presentations: readStringMap(resources.presentations),
      locales: readStringMap(resources.locales),
      discoveryMappings: readStringMap(resources.discoveryMappings),
      agentDiscoveryMappings: readStringMap(resources.agentDiscoveryMappings),
      ...(resources.onboarding === undefined ? {} : { onboarding: validateOnboardingResources(resources.onboarding) }),
    },
  };
}

export function isSemanticVersion(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = semanticVersionPattern.exec(value);
  if (!match) return false;
  const prerelease = match[4]?.split('.') ?? [];
  return !prerelease.some((part) => /^0[0-9]+$/.test(part));
}

function validateCredentialAcquire(input: unknown, capabilities: UnifiedPluginCapabilityDescriptor[]): CredentialAcquireContract | undefined {
  const declared = capabilities.some((item) => item.key === 'credential.acquire');
  if (!declared && input !== undefined) fail('credentialAcquire', '未声明 credential.acquire 时不能提供获取合同');
  if (!declared) return undefined;
  const value = requireRecord(input, 'credentialAcquire');
  assertKnownKeys(value, new Set(['inputContractVersion', 'loginUrl', 'allowedOrigins', 'output']), 'credentialAcquire');
  const inputContractVersion = requireString(value.inputContractVersion, 'credentialAcquire.inputContractVersion');
  const loginUrl = requireString(value.loginUrl, 'credentialAcquire.loginUrl');
  if (!/^https?:\/\//i.test(loginUrl)) fail('credentialAcquire.loginUrl', '必须是 HTTP(S) URL');
  const allowedOrigins = requireStringArray(value.allowedOrigins, 'credentialAcquire.allowedOrigins');
  if (allowedOrigins.length === 0 || allowedOrigins.some((origin) => !/^https?:\/\//i.test(origin))) {
    fail('credentialAcquire.allowedOrigins', '必须是非空 HTTP(S) Origin 数组');
  }
  const output = requireRecord(value.output, 'credentialAcquire.output');
  assertKnownKeys(output, new Set(['version', 'parameters']), 'credentialAcquire.output');
  const outputVersion = requireString(output.version, 'credentialAcquire.output.version');
  const parameters = requireRecord(output.parameters, 'credentialAcquire.output.parameters');
  const normalizedParameters: CredentialAcquireContract['output']['parameters'] = {};
  for (const [name, raw] of Object.entries(parameters)) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(name)) fail(`credentialAcquire.output.parameters.${name}`, '参数名不合法');
    const parameter = requireRecord(raw, `credentialAcquire.output.parameters.${name}`);
    assertKnownKeys(parameter, new Set(['secretType', 'required', 'delivery']), `credentialAcquire.output.parameters.${name}`);
    const secretType = requireEnum(parameter.secretType, ['password', 'api_token', 'session_id', 'ssh_key', 'private_key', 'certificate_private_key'] as const, `${name}.secretType`);
    if (typeof parameter.required !== 'boolean') fail(`${name}.required`, '必须是布尔值');
    const delivery = requireRecord(parameter.delivery, `${name}.delivery`);
    assertKnownKeys(delivery, new Set(['location', 'name']), `${name}.delivery`);
    const location = requireEnum(delivery.location, ['header', 'query', 'cookie', 'local_storage', 'session_storage'] as const, `${name}.delivery.location`);
    normalizedParameters[name] = {
      secretType,
      required: parameter.required,
      delivery: { location, name: requireString(delivery.name, `${name}.delivery.name`) },
    };
  }
  if (Object.keys(normalizedParameters).length === 0) fail('credentialAcquire.output.parameters', '至少声明一个输出参数');
  return {
    inputContractVersion,
    loginUrl,
    allowedOrigins,
    output: { version: outputVersion, parameters: normalizedParameters },
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
  const declared = collectDeclaredResourcePaths(manifest);
  const runtimeEntrypoint = manifest.resources.runtimeEntrypoint;
  const missing = declared.filter((path) => !(path in resources));
  if (missing.length > 0) fail('resources', '插件资源缺失', { missing });
  for (const path of Object.keys(resources)) {
    const normalized = path.replaceAll('\\', '/');
    if (normalized.startsWith('/') || normalized.includes('../')) fail(`resources.${path}`, '资源路径不安全');
    assertResourceExtensionAllowed(manifest.runtime, normalized, path, runtimeEntrypoint);
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
  const resourceKeys = ['runtimeEntrypoint', 'agentPlans', 'workflows', 'forms', 'presentations', 'locales', 'discoveryMappings', 'agentDiscoveryMappings', 'onboarding'];
  assertKnownKeys(resources, new Set(resourceKeys), 'resources');
  if (resources.runtimeEntrypoint !== undefined) {
    const runtimeEntrypoint = readResourcePath(resources.runtimeEntrypoint, 'resources.runtimeEntrypoint');
    if (runtimeEntrypoint !== 'runtime/index.js') fail('resources.runtimeEntrypoint', 'Runner 入口必须固定为 runtime/index.js');
  }
  for (const key of resourceKeys) {
    if (key === 'runtimeEntrypoint' || key === 'onboarding') continue;
    readStringMap(resources[key], `resources.${key}`);
  }
  if (resources.onboarding !== undefined) {
    validateOnboardingResources(resources.onboarding);
  }
}

function validateOnboardingResources(input: unknown): NonNullable<UnifiedPluginManifestV1['resources']['onboarding']> {
  const onboarding = requireRecord(input, 'resources.onboarding');
  assertKnownKeys(onboarding, new Set(['applicationAsset', 'applicationAssets']), 'resources.onboarding');
  const result: NonNullable<UnifiedPluginManifestV1['resources']['onboarding']> = {};
  const paths = new Set<string>();
  if (onboarding.applicationAsset !== undefined) {
    result.applicationAsset = validateOnboardingResourcePath(onboarding.applicationAsset, 'resources.onboarding.applicationAsset');
    paths.add(result.applicationAsset);
  }
  if (onboarding.applicationAssets !== undefined) {
    const resources = readStringMap(onboarding.applicationAssets, 'resources.onboarding.applicationAssets');
    if (Object.keys(resources).length === 0) fail('resources.onboarding.applicationAssets', '至少声明一个接入配方资源');
    result.applicationAssets = Object.fromEntries(Object.entries(resources).map(([key, path]) => {
      const normalized = validateOnboardingResourcePath(path, `resources.onboarding.applicationAssets.${key}`);
      if (paths.has(normalized)) fail(`resources.onboarding.applicationAssets.${key}`, '接入配方资源路径不能重复');
      paths.add(normalized);
      return [key, normalized];
    }));
  }
  if (paths.size === 0) fail('resources.onboarding', '必须声明至少一个接入配方资源');
  return result;
}

function validateOnboardingResourcePath(input: unknown, path: string): string {
  const resourcePath = readResourcePath(input, path);
  if (resourcePath.includes('://')) fail(path, '接入配方资源不能使用 URL');
  if (!resourcePath.toLowerCase().endsWith('.json')) fail(path, '接入配方必须是 JSON 资源');
  return resourcePath;
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

function readResourcePath(input: unknown, path: string): string {
  const value = requireString(input, path).replaceAll('\\', '/');
  if (value.startsWith('/') || value.includes('../') || value.includes('\0')) fail(path, '资源路径不安全');
  return value;
}

function collectDeclaredResourcePaths(manifest: UnifiedPluginManifestV1): string[] {
  const paths: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === 'string') {
      paths.push(value);
      return;
    }
    if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  Object.values(manifest.resources).forEach(collect);
  return [...new Set(paths)];
}

function assertResourceExtensionAllowed(_runtime: UnifiedPluginRuntime, normalizedPath: string, originalPath: string, runtimeEntrypoint?: string): void {
  const lower = normalizedPath.toLowerCase();
  if (runtimeEntrypoint !== undefined && normalizedPath === runtimeEntrypoint && lower === 'runtime/index.js') return;
  if ([...executableCodeExtensions, ...forbiddenExecutableExtensions].some((extension) => lower.endsWith(extension))) {
    fail(`resources.${originalPath}`, '普通插件不得携带可执行代码');
  }
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

function requireSemanticVersion(input: unknown, path: string): string {
  if (!isSemanticVersion(input)) fail(path, '必须是合法 SemVer');
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
