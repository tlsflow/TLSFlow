import { AppError } from '../../../common/errors/app-error.js';

export const canonicalPluginRegistryApiVersion = 'gcac.canonical-plugin-registry/v1' as const;
export const canonicalPluginRegistryKind = 'CanonicalPluginIdRegistry' as const;

export type CanonicalPluginExecutionMode = 'isolated_process';

export const canonicalPluginIds = [
  'web.nginx',
  'web.apache',
  'web.iis',
  'app.tomcat',
  'app.java-keystore',
  'app.rabbitmq',
  'app.service-certificate-file',
  'device.citrix.netscaler-adc',
  'device.synology-dsm',
  'cloud.aliyun',
  'cloud.tencent',
  'cloud.huawei',
  'cloud.volcengine',
  'ca.openssl',
  'ca.acme',
  'ca.microsoft-adcs',
  'ca.acme-dns',
] as const;

export type CanonicalPluginId = typeof canonicalPluginIds[number];

export interface CanonicalPluginRegistryEntryV1 {
  canonicalId: CanonicalPluginId;
  displayKey: string;
  executionMode: CanonicalPluginExecutionMode;
  supportedPlatformProfiles: string[];
}

export interface CanonicalPluginIdRegistryV1 {
  apiVersion: typeof canonicalPluginRegistryApiVersion;
  kind: typeof canonicalPluginRegistryKind;
  registryVersion: string;
  entries: CanonicalPluginRegistryEntryV1[];
}

function entry(
  canonicalId: CanonicalPluginId,
  displayKey: string,
  profiles: string[],
): CanonicalPluginRegistryEntryV1 {
  return {
    canonicalId,
    displayKey,
    executionMode: 'isolated_process',
    supportedPlatformProfiles: profiles,
  };
}

/**
 * 该表只描述当前可用的 Canonical Plugin ID。旧插件 ID、Recipe、Mapping 和产品映射不属于运行时注册表。
 */
export const canonicalPluginIdRegistry: CanonicalPluginIdRegistryV1 = {
  apiVersion: canonicalPluginRegistryApiVersion,
  kind: canonicalPluginRegistryKind,
  registryVersion: '2026-08-09',
  entries: [
    entry('web.nginx', 'plugins.canonical.webNginx', ['linux.agent_plan.pem', 'windows.agent_plan.pem']),
    entry('web.apache', 'plugins.canonical.webApache', ['linux.agent_plan.pem', 'windows.agent_plan.pem']),
    entry('web.iis', 'plugins.canonical.webIis', ['windows.agent_plan.iis-pfx']),
    entry('app.tomcat', 'plugins.canonical.appTomcat', ['linux.agent_plan.pkcs12', 'windows.agent_plan.pkcs12']),
    entry('app.java-keystore', 'plugins.canonical.appJavaKeystore', ['cross-platform.agent_plan.pkcs12']),
    entry('app.rabbitmq', 'plugins.canonical.appRabbitmq', ['linux.agent_plan.pem']),
    entry('app.service-certificate-file', 'plugins.canonical.appServiceCertificateFile', ['windows.agent_plan.file']),
    entry('device.citrix.netscaler-adc', 'plugins.canonical.deviceCitrixNetscalerAdc', ['control-plane.gateway']),
    entry('device.synology-dsm', 'plugins.canonical.deviceSynologyDsm', ['control-plane.gateway']),
    entry('cloud.aliyun', 'plugins.canonical.cloudAliyun', ['control-plane.cloud']),
    entry('cloud.tencent', 'plugins.canonical.cloudTencent', ['control-plane.cloud']),
    entry('cloud.huawei', 'plugins.canonical.cloudHuawei', ['control-plane.cloud']),
    entry('cloud.volcengine', 'plugins.canonical.cloudVolcengine', ['control-plane.cloud']),
    entry('ca.openssl', 'plugins.canonical.caOpenssl', ['control-plane.ca']),
    entry('ca.acme', 'plugins.canonical.caAcme', ['control-plane.ca']),
    entry('ca.microsoft-adcs', 'plugins.canonical.caMicrosoftAdcs', ['control-plane.ca', 'windows.agent_plan.adcs']),
    entry('ca.acme-dns', 'plugins.canonical.caAcmeDns', ['control-plane.ca']),
  ],
};

export function validateCanonicalPluginIdRegistry(input: unknown): CanonicalPluginIdRegistryV1 {
  const registry = record(input, '$');
  knownKeys(registry, ['apiVersion', 'kind', 'registryVersion', 'entries'], '$');
  exact(registry.apiVersion, canonicalPluginRegistryApiVersion, '$.apiVersion');
  exact(registry.kind, canonicalPluginRegistryKind, '$.kind');
  if (typeof registry.registryVersion !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(registry.registryVersion)) {
    fail('$.registryVersion', '版本日期格式不合法');
  }
  const entries = array(registry.entries, '$.entries');
  if (entries.length !== canonicalPluginIds.length) fail('$.entries', '必须完整覆盖 17 个 Canonical Plugin ID');
  const actualIds = new Set<string>();
  const displayKeys = new Set<string>();
  for (const [index, rawEntry] of entries.entries()) {
    const item = record(rawEntry, `$.entries[${index}]`);
    knownKeys(item, ['canonicalId', 'displayKey', 'executionMode', 'supportedPlatformProfiles'], `$.entries[${index}]`);
    const canonicalId = identifier(rawEntryValue(item.canonicalId, `$.entries[${index}].canonicalId`), `$.entries[${index}].canonicalId`);
    if (!canonicalPluginIds.includes(canonicalId as CanonicalPluginId)) {
      fail(`$.entries[${index}].canonicalId`, '只能使用已登记的 Canonical Plugin ID');
    }
    if (actualIds.has(canonicalId)) fail(`$.entries[${index}].canonicalId`, 'Canonical Plugin ID 重复');
    actualIds.add(canonicalId);
    const displayKey = identifier(rawEntryValue(item.displayKey, `$.entries[${index}].displayKey`), `$.entries[${index}].displayKey`);
    if (displayKeys.has(displayKey)) fail(`$.entries[${index}].displayKey`, 'display key 重复');
    displayKeys.add(displayKey);
    exact(item.executionMode, 'isolated_process', `$.entries[${index}].executionMode`);
    const profiles = stringArray(item.supportedPlatformProfiles, `$.entries[${index}].supportedPlatformProfiles`);
    if (profiles.length === 0) fail(`$.entries[${index}].supportedPlatformProfiles`, '至少需要一个平台 Profile');
  }
  if (actualIds.size !== canonicalPluginIds.length || canonicalPluginIds.some((id) => !actualIds.has(id))) {
    fail('$.entries', 'Canonical Plugin ID 集合不完整');
  }
  return registry as unknown as CanonicalPluginIdRegistryV1;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, '必须是对象');
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, '必须是数组');
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  const values = array(value, path);
  if (values.some((item) => typeof item !== 'string' || item.trim() === '')) fail(path, '必须是非空字符串数组');
  return values as string[];
}

function identifier(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(value)) fail(path, '标识符格式不合法');
  return value;
}

function rawEntryValue(value: unknown, path: string): unknown {
  if (value === undefined) fail(path, '字段缺失');
  return value;
}

function knownKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const allowed = new Set(keys);
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) fail(`${path}.${unexpected}`, '不允许历史兼容字段或未知字段');
}

function exact(actual: unknown, expected: unknown, path: string): void {
  if (actual !== expected) fail(path, '固定值不匹配', { expected });
}

function fail(path: string, message: string, details: Record<string, unknown> = {}): never {
  throw new AppError('VALIDATION_FAILED', `Canonical Plugin ID Registry 无效：${message}`, { path, ...details });
}
