import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const runtimeDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(runtimeDirectory, '..');
const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const PLUGIN_ID = manifest.pluginId;
const PLUGIN_VERSION = manifest.version;
const PROTOCOL = 'F5_ICONTROL_REST';
const IDENTIFIER = /^[A-Za-z0-9._:-]{1,256}$/;
const HASH = /^sha256:[a-f0-9]{64}$/;
const SECRET_REF = /^secret:\/\/[A-Za-z0-9._:/#-]{1,512}$/;
const IDENTIFICATION_CAPABILITIES = Object.freeze([
  'device.connection.test',
  'device.identity.detect',
  'device.discover',
]);

/**
 * Runner 只处理脱敏协议 Fixture，真实设备 HTTP 由普通 Workflow DSL 执行。
 * 这样可以在隔离进程中验证发现投影，又不会让 Runner 自行建立第二条网络链路。
 */
export function createPluginRunnerExecutor() {
  const resourceHash = requiredDescriptorEnv('GCAC_PLUGIN_RESOURCE_HASH', HASH);
  const descriptor = Object.freeze({
    pluginVersionId: requiredDescriptorEnv('GCAC_PLUGIN_VERSION_ID', IDENTIFIER),
    pluginId: PLUGIN_ID,
    pluginVersion: PLUGIN_VERSION,
    capabilities: Object.freeze([...(manifest.capabilities ?? []).map((item) => item.key)]),
    actions: actionDescriptors(resourceHash),
    permissions: Object.freeze([...(manifest.permissions ?? [])]),
    packageHash: requiredDescriptorEnv('GCAC_PLUGIN_PACKAGE_HASH', HASH),
    resourceHash,
    manifestHash: requiredDescriptorEnv('GCAC_PLUGIN_MANIFEST_HASH', HASH),
  });
  return {
    descriptor,
    execute: (context, hostApi) => execute(context, hostApi, descriptor),
  };
}

async function execute(context, hostApi, descriptor) {
  if (!IDENTIFICATION_CAPABILITIES.includes(context?.capability)) {
    fail('证书部署和回滚必须由普通 Workflow DSL 执行', 'PLUGIN_RUNNER_SCOPE_FORBIDDEN');
  }
  assertContext(context, descriptor);
  const input = record(context.input, 'input');
  const fixture = requireFixture(input.protocolFixture);
  await resolveCredential(input, context, hostApi);
  if (context.capability === 'device.discover') {
    return successResult({ protocol: PROTOCOL, operation: 'device.discover', requestCount: 5 }, [discover(input, fixture)]);
  }
  if (context.capability === 'device.identity.detect') {
    requestResponse(fixture, 'GET', '/mgmt/tm/sys/version');
    requestResponse(fixture, 'GET', '/mgmt/tm/sys/management-ip');
    requestResponse(fixture, 'GET', '/mgmt/tm/sys/failover');
    return successResult({
      protocol: PROTOCOL,
      operation: 'device.identity.detect',
      requestCount: 3,
      productVersion: readVersion(fixture),
      managementAddress: readManagementAddress(fixture),
      haState: readFailoverState(fixture),
    });
  }
  requestResponse(fixture, 'GET', '/mgmt/tm/sys/version');
  return successResult({ protocol: PROTOCOL, operation: 'device.connection.test', requestCount: 1, productVersion: readVersion(fixture) });
}

function actionDescriptors(resourceHash) {
  const contracts = manifest.resources?.actionContracts;
  if (!contracts || typeof contracts !== 'object' || Array.isArray(contracts)) fail('F5 插件缺少 Action Contract 资源声明', 'PLUGIN_RUNNER_START_FAILED');
  const actions = Object.entries(contracts).map(([actionId, resourcePath]) => {
    let contract;
    try {
      contract = JSON.parse(readPackageResource(String(resourcePath)));
    } catch {
      fail(`F5 Action Contract 资源无效：${actionId}`, 'PLUGIN_RUNNER_START_FAILED');
    }
    if (!contract || typeof contract !== 'object' || Array.isArray(contract)
      || contract.apiVersion !== 'gcac.plugin-action-contract/v1'
      || contract.actionId !== actionId
      || !IDENTIFICATION_CAPABILITIES.includes(contract.capability)
      || contract.actionContractVersion !== 'v1'
      || !contract.inputSchema || !contract.outputSchema || contract.writeEffect !== false) {
      fail(`F5 Action Contract 内容无效：${actionId}`, 'PLUGIN_RUNNER_START_FAILED');
    }
    return {
      actionId,
      capability: contract.capability,
      actionContractVersion: contract.actionContractVersion,
      inputSchemaSha256: schemaHash(contract.inputSchema),
      outputSchemaSha256: schemaHash(contract.outputSchema),
      resourceHash,
    };
  });
  if (actions.length !== IDENTIFICATION_CAPABILITIES.length) fail('F5 插件设备识别 Action Contract 不完整', 'PLUGIN_RUNNER_START_FAILED');
  return Object.freeze(actions.map((item) => Object.freeze(item)));
}

function readPackageResource(resourcePath) {
  const normalized = String(resourcePath).replaceAll('\\', '/');
  const absolute = resolve(packageDirectory, normalized);
  const relativePath = relative(packageDirectory, absolute).replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0') || relativePath === '..' || relativePath.startsWith('../')) throw new Error('插件包资源路径越界');
  return readFileSync(join(packageDirectory, relativePath), 'utf8');
}

function discover(input, fixture) {
  requestResponse(fixture, 'GET', '/mgmt/tm/sys/version');
  requestResponse(fixture, 'GET', '/mgmt/tm/sys/failover');
  const virtuals = items(requestResponse(fixture, 'GET', '/mgmt/tm/ltm/virtual').body, 'Virtual Servers');
  const profiles = items(requestResponse(fixture, 'GET', '/mgmt/tm/ltm/profile/client-ssl').body, 'Client SSL Profiles');
  const certificates = items(requestResponse(fixture, 'GET', '/mgmt/tm/sys/file/ssl-cert').body, 'SSL certificates');
  const profileReferences = new Map();
  for (const virtual of virtuals) {
    for (const reference of items(virtual.profilesReference, 'Profile references', true)) {
      if (String(reference.context ?? '').toLowerCase() !== 'clientside') continue;
      const key = profileKey(reference);
      const list = profileReferences.get(key) ?? [];
      list.push(virtual);
      profileReferences.set(key, list);
    }
  }

  const frameworkStableKey = 'framework:f5.ltm';
  const sites = [];
  const targets = [];
  const bindings = [];
  const certificateObjects = [];
  const certificateByPath = new Map();
  for (const certificate of certificates) {
    const path = String(certificate.fullPath ?? certificate.name ?? '');
    const stableKey = `CERT:${safeKey(path)}`;
    const normalized = { stableKey, ...(typeof certificate.sha256Fingerprint === 'string' ? { sha256Fingerprint: certificate.sha256Fingerprint } : {}), ...(typeof certificate.subject === 'string' ? { subject: certificate.subject } : {}), ...(typeof certificate.issuer === 'string' ? { issuer: certificate.issuer } : {}), ...(typeof certificate.notBefore === 'string' ? { notBefore: certificate.notBefore } : {}), ...(typeof certificate.notAfter === 'string' ? { notAfter: certificate.notAfter } : {}), metadata: { certificatePath: path } };
    certificateObjects.push(normalized);
    certificateByPath.set(path, normalized);
  }

  for (const virtual of virtuals) {
    const refs = items(virtual.profilesReference, 'Profile references', true).filter((item) => String(item.context ?? '').toLowerCase() === 'clientside');
    const clientProfiles = refs.map((reference) => profiles.find((profile) => profileKey(profile) === profileKey(reference))).filter(Boolean);
    if (clientProfiles.length === 0) continue;
    const siteKey = `VS:${safeKey(String(virtual.fullPath ?? `/${virtual.partition ?? 'Common'}/${virtual.name}`))}`;
    const endpoint = parseDestination(virtual.destination);
    sites.push({ stableKey: siteKey, frameworkStableKey, siteType: 'network.virtual-server', displayName: String(virtual.fullPath ?? virtual.name), addresses: endpoint.address ? [endpoint.address] : [], ...(endpoint.port ? { port: endpoint.port } : {}), protocol: 'HTTPS', metadata: { virtualServerPath: String(virtual.fullPath ?? virtual.name) } });
    for (const profile of clientProfiles) {
      const profilePath = String(profile.fullPath ?? `/${profile.partition ?? 'Common'}/${profile.name}`);
      const profileUri = f5ProfileUri(profilePath);
      const entries = Array.isArray(profile.certKeyChain) ? profile.certKeyChain : [];
      const references = profileReferences.get(profileKey(profile)) ?? [virtual];
      for (const entry of entries) {
        if (String(entry.usage ?? 'SERVER').toUpperCase() === 'CA') continue;
        const entryName = String(entry.name ?? 'default');
        const targetKey = `TARGET:${safeKey(`${siteKey}#${profilePath}#${entryName}`)}`;
        const certPath = String(entry.cert ?? '');
        const certificate = certificateByPath.get(certPath);
        targets.push({ stableKey: targetKey, frameworkStableKey, siteStableKey: siteKey, targetType: 'tls.binding', targetKey: `F5:${safeKey(`${profilePath}:${entryName}`)}`, supportedCapabilities: ['certificate.deploy', 'certificate.rollback'], executionLocations: ['CONTROL_PLANE', 'GATEWAY'], metadata: { profilePath, profileUri, keyChainEntryName: entryName, profileReferenceCount: references.length, referencingVirtualServers: references.map((item) => String(item.fullPath ?? item.name)), serverName: profile.serverName, sniDefault: Boolean(profile.sniDefault), sniRequire: Boolean(profile.sniRequire), usage: entry.usage ?? 'SERVER', generation: profile.generation } });
        if (certificate) bindings.push({ stableKey: `BINDING:${safeKey(`${targetKey}:${certPath}`)}`, managedTargetStableKey: targetKey, certificateStableKey: certificate.stableKey, bindingName: `${profilePath}#${entryName}`, metadata: { profilePath, keyChainEntryName: entryName, sharedProfile: references.length > 1 } });
      }
    }
  }
  return { apiVersion: 'gcac.device-discovery/v2', device: { stableKey: `f5-bigip:${safeKey(String(input.deviceAddress))}`, displayName: input.displayName ?? input.deviceAddress, productFamily: PLUGIN_ID, softwareVersion: readVersion(fixture), managementAddress: input.deviceAddress, metadata: { managementProtocol: 'iControl REST', haState: readFailoverState(fixture) } }, capabilities: IDENTIFICATION_CAPABILITIES.map((key) => ({ key, available: true })), frameworks: [{ stableKey: frameworkStableKey, frameworkType: 'f5.ltm', displayName: 'LTM' }], sites, managedTargets: targets, certificates: certificateObjects, certificateBindings: bindings, warnings: [] };
}

function profileKey(value) {
  return String(value.fullPath ?? `/${value.partition ?? 'Common'}/${value.name}`);
}

function f5ProfileUri(profilePath) {
  return `/mgmt/tm/ltm/profile/client-ssl/~${profilePath.replace(/^\//, '').replaceAll('/', '~')}`;
}

function parseDestination(value) {
  const text = String(value ?? '').replace(/^\//, '');
  const match = text.match(/(?:^|\/)([^/:]+)(?::(\d+))?$/);
  return { address: match?.[1], port: match?.[2] ? Number(match[2]) : undefined };
}

function readVersion(fixture) {
  const body = fixture.responses['GET /mgmt/tm/sys/version']?.body ?? {};
  const nested = Object.values(body.entries ?? {}).flatMap((entry) => Object.values(entry?.nestedStats?.entries ?? {}));
  const version = nested.find((entry) => entry?.description && /\d+\.\d+/.test(String(entry.description)))?.description;
  return String(version ?? body.version ?? 'unknown');
}

function readManagementAddress(fixture) {
  const body = fixture.responses['GET /mgmt/tm/sys/management-ip']?.body ?? {};
  const nested = Object.values(body.entries ?? {}).flatMap((entry) => Object.values(entry?.nestedStats?.entries ?? {}));
  return String(nested.find((entry) => entry?.description)?.description ?? body.managementAddress ?? 'unknown');
}

function readFailoverState(fixture) {
  const body = fixture.responses['GET /mgmt/tm/sys/failover']?.body ?? {};
  const nested = Object.values(body.entries ?? {}).flatMap((entry) => Object.values(entry?.nestedStats?.entries ?? {}));
  return String(nested.find((entry) => entry?.description)?.description ?? body.status ?? 'UNKNOWN').toUpperCase();
}

function items(body, name, optional = false) {
  const values = body?.items ?? (optional ? [] : undefined);
  if (!Array.isArray(values)) fail(`${name} 必须是 items 数组`, 'PLUGIN_PROTOCOL_CONTRACT_INVALID');
  return values;
}

function assertContext(context, descriptor) {
  if (!context || typeof context !== 'object') fail('Runner 执行上下文缺失');
  for (const key of ['pluginVersionId', 'pluginId', 'pluginVersion']) if (typeof context[key] !== 'string' || !IDENTIFIER.test(context[key])) fail(`Runner 上下文 ${key} 无效`);
  if (context.pluginVersionId !== descriptor.pluginVersionId || context.pluginId !== PLUGIN_ID || context.pluginVersion !== PLUGIN_VERSION) fail('Runner 执行上下文 PluginVersion 不匹配');
  const action = descriptor.actions.find((item) => item.actionId === context.actionId);
  if (!action || action.capability !== context.capability || action.actionContractVersion !== context.actionContractVersion || action.inputSchemaSha256 !== context.inputSchemaSha256 || action.outputSchemaSha256 !== context.outputSchemaSha256 || action.resourceHash !== context.resourceHash) fail('Runner Action Contract 未绑定到固定 PluginVersion', 'PLUGIN_RUNNER_VERSION_MISMATCH');
  if (context.packageHash !== descriptor.packageHash || context.manifestHash !== descriptor.manifestHash) fail('Runner 执行上下文 PluginVersion 摘要不匹配', 'PLUGIN_RUNNER_VERSION_MISMATCH');
  if (context.writeEffect !== false) fail('设备识别 Action 必须声明 writeEffect=false');
  if (!Array.isArray(context.grantRefs) || context.grantRefs.length === 0) fail('Runner 执行缺少 Grant');
  if (!(context.signal instanceof AbortSignal)) fail('Runner 执行缺少取消信号');
  if (!context.deadlineAt || Date.parse(context.deadlineAt) <= Date.now()) fail('Runner 执行超时');
}

async function resolveCredential(input, context, hostApi) {
  const credential = record(input.credential, 'credential');
  const secretRef = credential.secretRef ?? credential.secretRefs?.password;
  const grantId = credential.grantId ?? context.grantRefs[0];
  if (typeof credential.username !== 'string' || credential.username.trim() === '') fail('credential.username 缺失');
  if (typeof secretRef !== 'string' || !SECRET_REF.test(secretRef)) fail('credential SecretRef 缺失或格式无效');
  if (typeof grantId !== 'string' || !context.grantRefs.includes(grantId)) fail('credential Grant 未绑定到当前执行', 'PLUGIN_HOST_CALL_DENIED');
  if (!hostApi || typeof hostApi.call !== 'function') fail('Secret Host API 不可用', 'PLUGIN_HOST_CALL_DENIED');
  const result = await hostApi.call('secret.grant.resolve', { grantId, secretRef, purpose: `${PLUGIN_ID}:identification` }, [grantId]);
  if (!result || result.ok !== true || result.data?.value !== '[REDACTED]') fail('Secret Host API 未返回脱敏句柄', 'PLUGIN_HOST_CALL_DENIED');
}

function requireFixture(value) {
  const fixture = record(value, 'protocolFixture');
  if (fixture.apiVersion !== 'gcac.device-fixture/v1' || fixture.protocol !== PROTOCOL) fail('协议 Fixture 合同不匹配');
  if (!fixture.responses || typeof fixture.responses !== 'object' || Array.isArray(fixture.responses)) fail('协议 Fixture 缺少 responses');
  return fixture;
}

function successResult(summary, normalizedObjects) {
  return { success: true, status: 'SUCCESS', output: { summary, normalizedObjects: normalizedObjects ?? [] }, warnings: [] };
}

function requestResponse(fixture, method, path) {
  const response = fixture.responses[`${method} ${path}`];
  if (!response) fail(`F5 Fixture 缺少固定响应：${method} ${path}`, 'PLUGIN_PROTOCOL_CONTRACT_INVALID');
  if (!Number.isInteger(response.statusCode) || response.statusCode < 100 || response.statusCode > 599) fail('F5 Fixture statusCode 无效', 'PLUGIN_PROTOCOL_CONTRACT_INVALID');
  if (!response.body || typeof response.body !== 'object' || Array.isArray(response.body)) fail('F5 Fixture body 必须是对象', 'PLUGIN_PROTOCOL_CONTRACT_INVALID');
  if (response.statusCode < 200 || response.statusCode >= 300) fail('F5 返回 HTTP 错误', 'PLUGIN_PROTOCOL_CONTRACT_INVALID');
  return response;
}

function safeKey(value) {
  return String(value).replace(/[^A-Za-z0-9._:/-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 256) || 'unknown';
}

function record(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} 必须是对象`);
  return value;
}

function requiredDescriptorEnv(name, pattern) {
  const value = process.env[name]?.trim();
  if (!value || !pattern.test(value)) throw new Error(`缺少或无效的 ${name}，Runner 必须失败关闭`);
  return value;
}

function schemaHash(schema) {
  return `sha256:${createHash('sha256').update(stableJson(schema), 'utf8').digest('hex')}`;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

function fail(message, code = 'PLUGIN_CONTRACT_INVALID') {
  const error = new Error(message);
  error.code = code;
  throw error;
}
