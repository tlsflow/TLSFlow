import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const runtimeDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(runtimeDirectory, '..');
const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const PLUGIN_ID = manifest.pluginId;
const PLUGIN_VERSION = manifest.version;
const PROTOCOL = 'NITRO';
const IDENTIFIER = /^[A-Za-z0-9._:-]{1,256}$/;
const HASH = /^sha256:[a-f0-9]{64}$/;
const SECRET_REF = /^secret:\/\/[A-Za-z0-9._:/#-]{1,512}$/;
const DEVICE_IDENTIFICATION_CAPABILITIES = Object.freeze([
  'device.connection.test',
  'device.identity.detect',
  'device.discover',
]);
const READONLY_CAPABILITIES = Object.freeze([...DEVICE_IDENTIFICATION_CAPABILITIES, 'credential.health-check']);

/**
 * Citrix 插件只负责设备连接/凭据健康/身份/资源识别。
 * 证书部署、终验和回滚全部保留在 certificate-deploy.json 的普通 DSL 中。
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
  if (!READONLY_CAPABILITIES.includes(context?.capability)) {
    fail('证书部署、验证和回滚必须由普通 DSL 执行', 'PLUGIN_RUNNER_SCOPE_FORBIDDEN');
  }
  assertContext(context, descriptor);
  const input = record(context.input, 'input');
  const fixture = requireFixture(input.protocolFixture);
  await resolveCredential(input, context, hostApi);
  if (context.capability === 'device.discover') {
    return discover(input, fixture, context.signal);
  }
  if (context.capability === 'credential.health-check') {
    return credentialHealthCheck(input, fixture, context.signal);
  }
  return connectionTest(input, fixture, context.signal);
}

function actionDescriptors(resourceHash) {
  const contracts = manifest.resources?.actionContracts;
  if (!contracts || typeof contracts !== 'object' || Array.isArray(contracts)) {
    fail('Citrix 插件缺少 Action Contract 资源声明', 'PLUGIN_RUNNER_START_FAILED');
  }
  const actions = Object.entries(contracts).flatMap(([actionId, resourcePath]) => {
    let contract;
    try {
      contract = JSON.parse(readPackageResource(String(resourcePath)));
    } catch {
      fail(`Citrix Action Contract 资源无效：${actionId}`, 'PLUGIN_RUNNER_START_FAILED');
    }
    if (!contract
      || typeof contract !== 'object'
      || Array.isArray(contract)
      || contract.apiVersion !== 'gcac.plugin-action-contract/v1'
      || contract.actionId !== actionId
      || !READONLY_CAPABILITIES.includes(contract.capability)
      || contract.actionContractVersion !== 'v1'
      || !contract.inputSchema
      || !contract.outputSchema
      || contract.writeEffect !== false) {
      fail(`Citrix Action Contract 内容无效：${actionId}`, 'PLUGIN_RUNNER_START_FAILED');
    }
    return [{
      actionId,
      capability: contract.capability,
      actionContractVersion: contract.actionContractVersion,
      inputSchemaSha256: schemaHash(contract.inputSchema),
      outputSchemaSha256: schemaHash(contract.outputSchema),
      resourceHash,
    }];
  });
  if (actions.length === 0) fail('Citrix 插件没有可执行的只读 Action Contract', 'PLUGIN_RUNNER_START_FAILED');
  return Object.freeze(actions.map((action) => Object.freeze(action)));
}

function readPackageResource(resourcePath) {
  const normalized = String(resourcePath).replaceAll('\\', '/');
  const absolute = resolve(packageDirectory, normalized);
  const relativePath = relative(packageDirectory, absolute).replaceAll('\\', '/');
  if (!normalized
    || normalized.startsWith('/')
    || normalized.includes(String.fromCharCode(0))
    || relativePath === '..'
    || relativePath.startsWith('../')) {
    throw new Error('插件包资源路径越界');
  }
  return readFileSync(join(packageDirectory, relativePath), 'utf8');
}

async function connectionTest(input, fixture, signal) {
  const response = await requestFixture(fixture, signal, 'GET', '/nitro/v1/config/nsversion');
  assertNitroSuccess(response);
  return successResult({
    protocol: PROTOCOL,
    managementAddress: stringValue(input.deviceAddress, 'deviceAddress'),
    productVersion: stringValue(response.body.nsversion?.version, 'NITRO version'),
    requestCount: 1,
  });
}

async function credentialHealthCheck(input, fixture, signal) {
  const response = await requestFixture(fixture, signal, 'GET', '/nitro/v1/config/nsversion');
  const statusCode = response.statusCode;
  const nitroErrorCode = response.body.errorcode;
  if (statusCode === 200 && nitroErrorCode === 0) {
    return { success: true, status: 'SUCCESS', output: { apiVersion: 'gcac.credential-health-result/v1', status: 'VALID', summary: '设备认证成功', evidence: { protocol: PROTOCOL, httpStatus: statusCode } }, warnings: [] };
  }
  if (statusCode === 401 || statusCode === 403 || (statusCode === 200 && nitroErrorCode !== 0)) {
    return { success: true, status: 'SUCCESS', output: { apiVersion: 'gcac.credential-health-result/v1', status: 'ERROR', reasonCode: 'PASSWORD_INVALID', summary: '设备拒绝凭据认证', evidence: { protocol: PROTOCOL, httpStatus: statusCode, nitroErrorCode } }, warnings: [] };
  }
  if (statusCode >= 500) {
    return { success: true, status: 'SUCCESS', output: { apiVersion: 'gcac.credential-health-result/v1', status: 'UNREACHABLE', reasonCode: 'REMOTE_SERVICE_ERROR', summary: '设备远端服务暂时不可用', evidence: { protocol: PROTOCOL, httpStatus: statusCode } }, warnings: [] };
  }
  return { success: true, status: 'SUCCESS', output: { apiVersion: 'gcac.credential-health-result/v1', status: 'UNREACHABLE', reasonCode: 'NETWORK_UNREACHABLE', summary: '设备网络暂时不可达', evidence: { protocol: PROTOCOL, httpStatus: statusCode } }, warnings: [] };
}

async function discover(input, fixture, signal) {
  const responses = {};
  const paths = {
    version: '/nitro/v1/config/nsversion',
    lb: '/nitro/v1/config/lbvserver',
    vpn: '/nitro/v1/config/vpnvserver',
    cs: '/nitro/v1/config/csvserver',
    gslb: '/nitro/v1/config/gslbvserver',
    bindings: '/nitro/v1/config/sslvserver_sslcertkey_binding',
    certificates: '/nitro/v1/config/sslcertkey',
  };
  for (const [name, path] of Object.entries(paths)) {
    responses[name] = await requestFixture(fixture, signal, 'GET', path);
    assertNitroSuccess(responses[name]);
  }
  const normalized = toDiscovery(input, fixture, responses);
  return successResult({ protocol: PROTOCOL, operation: 'device.discover', requestCount: Object.keys(paths).length }, [normalized]);
}

async function resolveCredential(input, context, hostApi) {
  const credential = record(input.credential ?? input.credentials?.credential, 'credential');
  const secretRef = credential.secretRef ?? credential.secretRefs?.password;
  const grantId = credential.grantId ?? context.grantRefs[0];
  if (typeof credential.username !== 'string' || credential.username.trim() === '') fail('credential.username 缺失');
  if (typeof secretRef !== 'string' || !SECRET_REF.test(secretRef)) fail('credential SecretRef 缺失或格式无效');
  if (typeof grantId !== 'string' || !context.grantRefs.includes(grantId)) fail('credential Grant 未绑定到当前执行', 'PLUGIN_HOST_CALL_DENIED');
  if (!hostApi || typeof hostApi.call !== 'function') fail('Secret Host API 不可用', 'PLUGIN_HOST_CALL_DENIED');
  const result = await hostApi.call('secret.grant.resolve', { grantId, secretRef, purpose: `${PLUGIN_ID}:nitro-identification` }, [grantId]);
  if (!result || result.ok !== true || result.data?.value !== '[REDACTED]') fail('Secret Host API 未返回脱敏句柄', 'PLUGIN_HOST_CALL_DENIED');
}

async function requestFixture(fixture, signal, method, path) {
  const response = fixture.responses[`${method} ${path}`];
  if (!response) fail(`NITRO Fixture 缺少固定响应：${method} ${path}`, 'PLUGIN_PROTOCOL_CONTRACT_INVALID');
  await waitForFixture(response.delayMs, signal);
  if (response.transportError) fail('NITRO Fixture 传输失败', 'PLUGIN_RUNNER_TIMEOUT');
  if (!Number.isInteger(response.statusCode) || response.statusCode < 100 || response.statusCode > 599) fail('NITRO Fixture statusCode 无效', 'PLUGIN_PROTOCOL_CONTRACT_INVALID');
  if (!response.body || typeof response.body !== 'object' || Array.isArray(response.body)) fail('NITRO Fixture body 必须是对象', 'PLUGIN_PROTOCOL_CONTRACT_INVALID');
  return response;
}

function toDiscovery(input, fixture, responses) {
  const version = stringValue(responses.version.body.nsversion?.version, 'NITRO version');
  const deviceAddress = stringValue(input.deviceAddress ?? fixture.device?.managementAddress, 'deviceAddress');
  const sources = [
    ['LB', 'citrix.lb-server', responses.lb.body.lbvserver],
    ['VPN', 'citrix.vpn-server', responses.vpn.body.vpnvserver],
    ['CS', 'citrix.cs-server', responses.cs.body.csvserver],
    ['GSLB', 'citrix.gslb-server', responses.gslb.body.gslbvserver],
  ];
  const frameworks = [];
  const sites = [];
  for (const [prefix, frameworkType, values] of sources) {
    const entries = array(values, `${prefix} virtual servers`);
    if (entries.length === 0) continue;
    const frameworkStableKey = `framework:${frameworkType.split('.')[1]}`;
    frameworks.push({ stableKey: frameworkStableKey, frameworkType, displayName: prefix });
    for (const value of entries) {
      const name = requiredIdentifier(value.name, `${prefix} name`);
      sites.push({
        stableKey: `${prefix}:${safeKey(name)}`,
        frameworkStableKey,
        siteType: 'network.virtual-server',
        displayName: name,
        addresses: [String(value.ipv46 ?? '')].filter(Boolean),
        ...(Number.isInteger(value.port) ? { port: value.port } : {}),
        protocol: 'HTTPS',
        metadata: { virtualServerType: prefix },
      });
    }
  }
  const managedTargets = sites.map((site) => ({
    stableKey: `TARGET:${site.stableKey}`,
    frameworkStableKey: site.frameworkStableKey,
    siteStableKey: site.stableKey,
    targetType: 'tls.binding',
    targetKey: site.stableKey,
    supportedCapabilities: ['certificate.deploy', 'certificate.verify', 'certificate.rollback'],
    executionLocations: ['CONTROL_PLANE', 'GATEWAY'],
  }));
  const certificates = array(responses.certificates.body.sslcertkey, 'NITRO certificates').map((value) => ({
    stableKey: `CERT:${safeKey(requiredIdentifier(value.certkey, 'certkey'))}`,
    sha256Fingerprint: typeof value.sha256Fingerprint === 'string' ? value.sha256Fingerprint : sha256Hex(String(value.certkey)),
    ...(typeof value.subject === 'string' ? { subject: value.subject } : {}),
    ...(typeof value.issuer === 'string' ? { issuer: value.issuer } : {}),
    metadata: { certkey: requiredIdentifier(value.certkey, 'certkey'), ...(typeof value.cert === 'string' ? { certificatePath: value.cert } : {}) },
  }));
  const certificateByKey = new Map(certificates.map((item) => [item.metadata.certkey, item]));
  const certificateBindings = array(responses.bindings.body.sslvserver_sslcertkey_binding, 'NITRO bindings').flatMap((value) => {
    const target = sites.find((site) => site.displayName === value.vservername);
    const certificate = certificateByKey.get(String(value.certkeyname));
    return target && certificate
      ? [{ stableKey: `BINDING:${safeKey(`${value.vservername}:${value.certkeyname}`)}`, managedTargetStableKey: `TARGET:${target.stableKey}`, certificateStableKey: certificate.stableKey, bindingName: String(value.vservername), metadata: { sniCertificate: Boolean(value.snicert), ...(Number.isInteger(value.priority) ? { priority: value.priority } : {}) } }]
      : [];
  });
  return {
    apiVersion: 'gcac.device-discovery/v2',
    device: { stableKey: `citrix-adc:${safeKey(deviceAddress)}`, displayName: input.displayName ?? deviceAddress, productFamily: PLUGIN_ID, softwareVersion: version, managementAddress: deviceAddress, metadata: { managementProtocol: 'NITRO API' } },
    capabilities: DEVICE_IDENTIFICATION_CAPABILITIES.map((key) => ({ key, available: true })),
    frameworks,
    sites,
    managedTargets,
    certificates,
    certificateBindings,
    warnings: [],
  };
}

function assertContext(context, descriptor) {
  if (!context || typeof context !== 'object') fail('Runner 执行上下文缺失');
  for (const key of ['pluginVersionId', 'pluginId', 'pluginVersion']) {
    if (typeof context[key] !== 'string' || !IDENTIFIER.test(context[key])) fail(`Runner 上下文 ${key} 无效`);
  }
  if (context.pluginVersionId !== descriptor.pluginVersionId
    || context.pluginId !== PLUGIN_ID
    || context.pluginVersion !== PLUGIN_VERSION) {
    fail('Runner 执行上下文 PluginVersion 不匹配');
  }
  const action = descriptor.actions.find((item) => item.actionId === context.actionId);
  if (!action
    || action.capability !== context.capability
    || action.actionContractVersion !== context.actionContractVersion
    || action.inputSchemaSha256 !== context.inputSchemaSha256
    || action.outputSchemaSha256 !== context.outputSchemaSha256
    || action.resourceHash !== context.resourceHash) {
    fail('Runner Action Contract 未绑定到固定 PluginVersion', 'PLUGIN_RUNNER_VERSION_MISMATCH');
  }
  if (context.packageHash !== descriptor.packageHash || context.manifestHash !== descriptor.manifestHash) {
    fail('Runner 执行上下文 PluginVersion 摘要不匹配', 'PLUGIN_RUNNER_VERSION_MISMATCH');
  }
  if (context.writeEffect !== false) fail('设备识别 Action 必须声明 writeEffect=false');
  if (!Array.isArray(context.grantRefs) || context.grantRefs.length === 0) fail('Runner 执行缺少 Grant');
  if (!(context.signal instanceof AbortSignal)) fail('Runner 执行缺少取消信号');
  if (!context.deadlineAt || Date.parse(context.deadlineAt) <= Date.now()) fail('Runner 执行超时');
}

function requireFixture(value) {
  const fixture = record(value, 'protocolFixture');
  if (fixture.apiVersion !== 'gcac.device-fixture/v1' || fixture.protocol !== PROTOCOL) fail('协议 Fixture 合同不匹配');
  if (!fixture.responses || typeof fixture.responses !== 'object' || Array.isArray(fixture.responses)) fail('协议 Fixture 缺少 responses');
  return fixture;
}

function successResult(summary, normalizedObjects = []) {
  return { success: true, status: 'SUCCESS', output: { summary, normalizedObjects }, warnings: [] };
}

function fail(message, code = 'PLUGIN_CONTRACT_INVALID') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function requiredDescriptorEnv(name, pattern) {
  const value = process.env[name]?.trim();
  if (!value || !pattern.test(value)) throw new Error(`缺少或无效的 ${name}，Runner 必须失败关闭`);
  return value;
}

function record(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} 必须是对象`);
  return value;
}

function stringValue(value, name) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${name} 缺失`);
  return value;
}

function requiredIdentifier(value, name) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) fail(`${name} 不是固定标识符`);
  return value;
}

function array(value, name) {
  if (!Array.isArray(value)) fail(`${name} 必须是数组`);
  return value;
}

function safeKey(value) {
  return String(value).replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 256) || 'unknown';
}

function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(
      ([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`,
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

function schemaHash(schema) {
  return `sha256:${createHash('sha256').update(stableJson(schema), 'utf8').digest('hex')}`;
}

async function waitForFixture(delayMs, signal) {
  if (delayMs === undefined) return;
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 120_000) fail('协议 Fixture delayMs 无效');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    const abort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('Fixture 执行被取消'), { code: 'PLUGIN_OPERATION_CANCELLED' }));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function assertNitroSuccess(response) {
  if (response.statusCode < 200 || response.statusCode >= 300 || response.body.errorcode !== 0) {
    fail('NITRO 返回业务错误', 'PLUGIN_PROTOCOL_CONTRACT_INVALID');
  }
}
