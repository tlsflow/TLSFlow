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

export const trustedJsUnknownCodePermission = 'runtime.execute_unknown_code';

export const unifiedPluginRuntimes = ['AGENT_ATOMIC', 'WORKFLOW_DSL', 'TRUSTED_JS'] as const satisfies readonly UnifiedPluginRuntime[];
const executableCodeExtensions = ['.js', '.mjs', '.cjs'];
const forbiddenExecutableExtensions = ['.ts', '.tsx', '.vue', '.ps1', '.sh', '.bat', '.cmd', '.exe', '.dll', '.so', '.dylib'];
const maximumResourceCount = 500;
const maximumResourceBytes = 20 * 1024 * 1024;
const manifestKeys = new Set([
  'apiVersion', 'kind', 'pluginId', 'version', 'displayNameKey', 'descriptionKey', 'logoUrl', 'defaultLocale', 'publisher', 'runtime',
  'source', 'scope', 'trust', 'support', 'minGcacVersion', 'capabilities', 'providerKey', 'supportedProducts', 'supportedOperations',
  'credentialAcquire', 'permissions', 'compatibility', 'resources',
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
  const runtimeEntrypoint = readRuntimeEntrypoint(resources.runtimeEntrypoint);
  const permissions = requireStringArray(manifest.permissions ?? [], 'permissions');
  const providerMetadata = validateProviderPluginMetadata(manifest, runtime, capabilities);
  if (runtime === 'TRUSTED_JS') {
    if (!runtimeEntrypoint) fail('resources.runtimeEntrypoint', 'TRUSTED_JS 插件必须声明 runtimeEntrypoint');
    if (trust !== 'OFFICIAL_SIGNED') fail('trust', 'TRUSTED_JS 插件当前只允许 OFFICIAL_SIGNED 信任级别');
    if (!permissions.includes(trustedJsUnknownCodePermission)) {
      fail('permissions', `TRUSTED_JS 插件必须声明 ${trustedJsUnknownCodePermission} 权限`);
    }
  } else if (runtimeEntrypoint) {
    fail('resources.runtimeEntrypoint', '只有 TRUSTED_JS 插件可以声明 runtimeEntrypoint');
  }
  const credentialAcquire = validateCredentialAcquire(manifest.credentialAcquire, capabilities);
  return {
    apiVersion: 'gcac.plugin-manifest/v1',
    kind: 'GcacPlugin',
    pluginId: requireString(manifest.pluginId, 'pluginId'),
    version: requireString(manifest.version, 'version'),
    ...(providerMetadata?.providerKey ? { providerKey: providerMetadata.providerKey } : {}),
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
    ...(providerMetadata ? {
      supportedProducts: providerMetadata.supportedProducts,
      supportedOperations: providerMetadata.supportedOperations,
    } : {}),
    ...(credentialAcquire ? { credentialAcquire } : {}),
    permissions,
    compatibility: readCompatibility(manifest.compatibility),
    resources: {
      workflows: readStringMap(resources.workflows),
      agentRecipes: readStringMap(resources.agentRecipes),
      ...(runtimeEntrypoint ? { runtimeEntrypoint } : {}),
      forms: readStringMap(resources.forms),
      presentations: readStringMap(resources.presentations),
      locales: readStringMap(resources.locales),
      discoveryMappings: readStringMap(resources.discoveryMappings),
      agentDiscoveryMappings: readStringMap(resources.agentDiscoveryMappings),
      actionAliases: readStringMap(resources.actionAliases),
    },
  };
}

function validateProviderPluginMetadata(
  manifest: Record<string, unknown>,
  runtime: UnifiedPluginRuntime,
  capabilities: UnifiedPluginCapabilityDescriptor[],
): Pick<UnifiedPluginManifestV1, 'providerKey' | 'supportedProducts' | 'supportedOperations'> | undefined {
  const hasProviderMetadata = manifest.providerKey !== undefined
    || manifest.supportedProducts !== undefined
    || manifest.supportedOperations !== undefined;
  if (!hasProviderMetadata) return undefined;
  if (runtime !== 'TRUSTED_JS') {
    fail('providerKey', '只有 TRUSTED_JS 插件可以声明 Provider 元数据');
  }
  const providerKey = requireString(manifest.providerKey, 'providerKey').trim();
  if (!/^[a-z][a-z0-9]*(\.[a-z0-9]+)+$/.test(providerKey)) {
    fail('providerKey', 'Provider Key 必须是类似 cloud.aliyun 的稳定命名空间');
  }
  const supportedProducts = uniqueNonEmptyStrings(requireStringArray(manifest.supportedProducts, 'supportedProducts'), 'supportedProducts');
  const supportedOperations = uniqueNonEmptyStrings(requireStringArray(manifest.supportedOperations, 'supportedOperations'), 'supportedOperations');
  if (supportedProducts.length === 0) fail('supportedProducts', 'Provider 插件至少声明一个产品');
  if (supportedOperations.length === 0) fail('supportedOperations', 'Provider 插件至少声明一个操作');
  const missingCapabilityOperations = capabilities
    .map((item) => item.key)
    .filter((key) => !supportedOperations.includes(key));
  if (missingCapabilityOperations.length > 0) {
    fail('supportedOperations', 'Provider 插件必须覆盖已声明能力对应的操作键', { missingCapabilityOperations });
  }
  const invalidProducts = supportedProducts.filter((item) => !item.startsWith(`${providerKey}.`));
  if (invalidProducts.length > 0) {
    fail('supportedProducts', 'Provider 插件产品键必须落在 providerKey 命名空间下', { invalidProducts, providerKey });
  }
  return { providerKey, supportedProducts, supportedOperations };
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
  const missing = declared.filter((path) => !(path in resources));
  if (missing.length > 0) fail('resources', '插件资源缺失', { missing });
  for (const path of Object.keys(resources)) {
    const normalized = path.replaceAll('\\', '/');
    if (normalized.startsWith('/') || normalized.includes('../')) fail(`resources.${path}`, '资源路径不安全');
    assertResourceExtensionAllowed(manifest.runtime, normalized, path);
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
  readRuntimeEntrypoint(resources.runtimeEntrypoint);
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

function readRuntimeEntrypoint(input: unknown): string | undefined {
  if (input === undefined) return undefined;
  const value = requireString(input, 'resources.runtimeEntrypoint');
  const normalized = value.replaceAll('\\', '/');
  if (normalized.startsWith('/') || normalized.includes('../')) fail('resources.runtimeEntrypoint', '资源路径不安全');
  return value;
}

function collectDeclaredResourcePaths(manifest: UnifiedPluginManifestV1): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(manifest.resources)) {
    if (!value) continue;
    if (key === 'runtimeEntrypoint' && typeof value === 'string') {
      paths.push(value);
      continue;
    }
    if (typeof value === 'object') paths.push(...Object.values(value));
  }
  return [...new Set(paths)];
}

function assertResourceExtensionAllowed(runtime: UnifiedPluginRuntime, normalizedPath: string, originalPath: string): void {
  const lower = normalizedPath.toLowerCase();
  if (runtime === 'TRUSTED_JS') {
    if (forbiddenExecutableExtensions.some((extension) => lower.endsWith(extension))) {
      fail(`resources.${originalPath}`, 'TRUSTED_JS 插件不得携带宿主不可执行的脚本或二进制资源');
    }
    return;
  }
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

function optionalString(input: unknown, path: string): string | undefined {
  return input === undefined ? undefined : requireString(input, path);
}

function requireStringArray(input: unknown, path: string): string[] {
  return requireArray(input, path).map((item, index) => requireString(item, `${path}.${index}`));
}

function uniqueNonEmptyStrings(items: string[], path: string): string[] {
  const normalized = items.map((item) => item.trim());
  const duplicated = normalized.filter((item, index) => normalized.indexOf(item) !== index);
  if (duplicated.length > 0) fail(path, '不能包含重复项', { duplicated: [...new Set(duplicated)] });
  return normalized;
}

function requireEnum<T extends string>(input: unknown, allowed: readonly T[], path: string): T {
  if (typeof input !== 'string' || !allowed.includes(input as T)) fail(path, `必须是 ${allowed.join('、')} 之一`);
  return input as T;
}

function fail(path: string, message: string, details: Record<string, unknown> = {}): never {
  throw new AppError('VALIDATION_FAILED', `统一插件 Manifest 无效：${message}`, { path, ...details });
}
