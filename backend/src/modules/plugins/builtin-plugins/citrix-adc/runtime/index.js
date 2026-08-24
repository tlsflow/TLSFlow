import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const packageManifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const PLUGIN_ID = packageManifest.pluginId;
const PLUGIN_VERSION = packageManifest.version;
const PROTOCOL = 'NITRO';
const CAPABILITIES = Object.freeze(packageManifest.capabilities.map((item) => item.key));
const PERMISSIONS = Object.freeze([...packageManifest.permissions]);
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/;
const SECRET_REF_PATTERN = /^secret:\/\/[A-Za-z0-9._:/#-]{1,512}$/;
const ARTIFACT_REF_PATTERN = /^artifact:\/\/[A-Za-z0-9._:/#-]{1,512}$/;

/** 标准 Runner 只加载这个工厂；本文件不实现 IPC 入口，也不监听 stdin/stdout。 */
export function createPluginRunnerExecutor() {
  return {
    descriptor: {
      pluginVersionId: injected('GCAC_PLUGIN_VERSION_ID', IDENTIFIER_PATTERN),
      pluginId: PLUGIN_ID,
      pluginVersion: PLUGIN_VERSION,
      capabilities: [...CAPABILITIES],
      permissions: [...PERMISSIONS],
      packageHash: injected('GCAC_PLUGIN_PACKAGE_HASH', HASH_PATTERN),
      resourceHash: injected('GCAC_PLUGIN_RESOURCE_HASH', HASH_PATTERN),
      manifestHash: injected('GCAC_PLUGIN_MANIFEST_HASH', HASH_PATTERN),
    },
    execute: (context, hostApi) => execute(context, hostApi),
  };
}

async function execute(context, hostApi) {
  assertContext(context);
  if (!CAPABILITIES.includes(context.capability)) fail('Capability 未绑定到 Citrix Manifest PluginVersion');
  const input = record(context.input, 'input');
  const state = { writeStarted: false };
  const fixture = requireFixture(input.protocolFixture, PROTOCOL);
  await resolveCredential(input, context, hostApi);
  try {
    switch (context.capability) {
      case 'device.connection.test':
      case 'device.identity.detect':
        return await testConnection(input, fixture, state, context.signal);
      case 'device.discover':
        return await discover(input, fixture, state, context.signal);
      case 'certificate.deploy':
        requireWriteRequest(context);
        return await deploy(input, fixture, state, context, hostApi);
      case 'certificate.rollback':
        requireWriteRequest(context);
        return await rollback(input, fixture, state, context.signal);
      default:
        fail('未实现的 Citrix Capability');
    }
  } catch (error) {
    if (context.writeEffect && (state.writeStarted || error?.writeStarted === true)) return unknownResult();
    throw error;
  }
}

async function testConnection(input, fixture, state, signal) {
  const response = await requestFixture(fixture, state, signal, 'GET', '/nitro/v1/config/nsversion');
  assertNitroSuccess(response, state);
  const version = stringValue(response.body.nsversion?.version, 'NITRO version');
  return successResult({
    protocol: PROTOCOL,
    managementAddress: optionalAddress(input.deviceAddress),
    productVersion: version,
    requestCount: 1,
  });
}

async function discover(input, fixture, state, signal) {
  const responses = {};
  for (const [name, path] of Object.entries({
    version: '/nitro/v1/config/nsversion',
    lb: '/nitro/v1/config/lbvserver',
    vpn: '/nitro/v1/config/vpnvserver',
    cs: '/nitro/v1/config/csvserver',
    gslb: '/nitro/v1/config/gslbvserver',
    bindings: '/nitro/v1/config/sslvserver_sslcertkey_binding',
    certificates: '/nitro/v1/config/sslcertkey',
  })) {
    responses[name] = await requestFixture(fixture, state, signal, 'GET', path);
    assertNitroSuccess(responses[name], state);
  }
  const discovery = toDiscovery(input, fixture, responses);
  return successResult({ protocol: PROTOCOL, discovery, requestCount: Object.keys(responses).length }, [discovery]);
}

async function deploy(input, fixture, state, context, hostApi) {
  const target = requiredTarget(input.target);
  const artifact = await resolveArtifact(input, context, hostApi);
  const current = await requestFixture(
    fixture,
    state,
    context.signal,
    'GET',
    `/nitro/v1/config/sslvserver_sslcertkey_binding?args=vservername:${encodeURIComponent(target)}`,
  );
  assertNitroSuccess(current, state);
  const previous = firstArrayItem(current.body.sslvserver_sslcertkey_binding);
  const certificateKey = requiredIdentifier(input.certificateKeyName ?? `gcac-${sha256Hex(artifact.fingerprint ?? artifact.artifactRef).slice(0, 16)}`, 'certificateKeyName');
  try {
    await writeNitro(fixture, state, context.signal, 'POST', '/nitro/v1/config/systemfile', {
      operation: 'upload-certificate-material',
      target,
      certificateKey,
      artifactRef: artifact.artifactRef,
      artifactSha256: artifact.sha256,
    });
    await writeNitro(fixture, state, context.signal, 'POST', '/nitro/v1/config/sslcertkey', {
      certkey: certificateKey,
      cert: `/nsconfig/ssl/${certificateKey}.pem`,
      key: `/nsconfig/ssl/${certificateKey}.key`,
    });
    await writeNitro(fixture, state, context.signal, 'POST', '/nitro/v1/config/sslvserver_sslcertkey_binding', {
      vservername: target,
      certkeyname: certificateKey,
    });
    const verified = await requestFixture(
      fixture,
      state,
      context.signal,
      'GET',
      `/nitro/v1/config/sslvserver_sslcertkey_binding?args=vservername:${encodeURIComponent(target)}&args=certkeyname:${encodeURIComponent(certificateKey)}`,
    );
    assertNitroSuccess(verified, state);
    if (!hasBinding(verified.body, target, certificateKey)) fail('NITRO 写入后绑定校验未命中', 'PLUGIN_PROTOCOL_CONTRACT_INVALID', true);
    return successResult({
      protocol: PROTOCOL,
      operation: 'certificate.deploy',
      target,
      certificateKey,
      previousBinding: redactBinding(previous),
      verified: true,
      requestCount: state.requestCount,
    });
  } catch (error) {
    if (state.writeStarted) {
      await attemptRollback(fixture, state, context.signal, target, previous, certificateKey);
      error.writeStarted = true;
    }
    throw error;
  }
}

async function rollback(input, fixture, state, signal) {
  const target = requiredTarget(input.target);
  const previous = record(input.previousBinding, 'previousBinding');
  const previousCert = requiredIdentifier(previous.certkeyname, 'previousBinding.certkeyname');
  await writeNitro(fixture, state, signal, 'POST', '/nitro/v1/config/sslvserver_sslcertkey_binding/rollback', {
    vservername: target,
    certkeyname: previousCert,
    priority: optionalInteger(previous.priority),
  });
  const verified = await requestFixture(
    fixture,
    state,
    signal,
    'GET',
    `/nitro/v1/config/sslvserver_sslcertkey_binding?args=vservername:${encodeURIComponent(target)}&args=certkeyname:${encodeURIComponent(previousCert)}`,
  );
  assertNitroSuccess(verified, state);
  if (!hasBinding(verified.body, target, previousCert)) fail('NITRO 回滚校验未命中', 'PLUGIN_PROTOCOL_CONTRACT_INVALID', true);
  return successResult({ protocol: PROTOCOL, operation: 'certificate.rollback', target, restoredCertificateKey: previousCert, verified: true, requestCount: state.requestCount });
}

async function attemptRollback(fixture, state, signal, target, previous, certificateKey) {
  if (!previous || typeof previous.certkeyname !== 'string') return;
  try {
    await writeNitro(fixture, state, signal, 'POST', '/nitro/v1/config/sslvserver_sslcertkey_binding/rollback', {
      vservername: target,
      certkeyname: previous.certkeyname,
      priority: optionalInteger(previous.priority),
      failedCertificateKey: certificateKey,
    });
  } catch (rollbackError) {
    rollbackError.writeStarted = true;
    throw rollbackError;
  }
}

async function resolveCredential(input, context, hostApi) {
  const credential = record(input.credential ?? input.credentials?.credential, 'credential');
  const username = stringValue(credential.username, 'credential.username');
  const secretRef = credential.secretRef ?? credential.secretRefs?.password;
  if (typeof secretRef !== 'string' || !SECRET_REF_PATTERN.test(secretRef)) fail('credential SecretRef 缺失或格式无效');
  const grantId = requiredIdentifier(credential.grantId ?? context.grantRefs[0], 'credential.grantId');
  if (!context.grantRefs.includes(grantId)) fail('credential Grant 未绑定到当前执行', 'PLUGIN_HOST_CALL_DENIED');
  const result = await hostApi.call('secret.grant.resolve', { grantId, secretRef, purpose: `${PLUGIN_ID}:nitro` }, [grantId]);
  if (!result || result.ok !== true || !result.data || result.data.value !== '[REDACTED]') fail('Secret Host API 未返回脱敏句柄', 'PLUGIN_HOST_CALL_DENIED');
  return { username };
}

async function resolveArtifact(input, context, hostApi) {
  const artifact = record(input.artifact ?? input.artifacts?.certificate, 'certificate artifact');
  const artifactRef = artifact.artifactRef ?? artifact.ref;
  if (typeof artifactRef !== 'string' || !ARTIFACT_REF_PATTERN.test(artifactRef)) fail('证书 ArtifactRef 缺失或格式无效');
  const grantId = requiredIdentifier(artifact.grantId ?? context.grantRefs[0], 'artifact.grantId');
  if (!context.grantRefs.includes(grantId)) fail('Artifact Grant 未绑定到当前执行', 'PLUGIN_HOST_CALL_DENIED');
  const result = await hostApi.call('artifact.grant.read', { grantId, artifactRef }, [grantId]);
  if (!result || result.ok !== true || !result.data || typeof result.data.sha256 !== 'string' || !HASH_PATTERN.test(result.data.sha256)) fail('Artifact Host API 未返回固定摘要', 'PLUGIN_HOST_CALL_DENIED');
  return { artifactRef, sha256: result.data.sha256, fingerprint: artifact.fingerprint };
}

async function requestFixture(fixture, state, signal, method, path, body) {
  if (method !== 'GET' && method !== 'HEAD') state.writeStarted = true;
  state.requestCount = (state.requestCount ?? 0) + 1;
  const response = fixture.responses[`${method} ${path}`];
  if (!response) fail(`NITRO Fixture 缺少固定响应：${method} ${path}`, 'PLUGIN_PROTOCOL_CONTRACT_INVALID', state.writeStarted);
  const request = { method, path, ...(body ? { body: redactRequestBody(body) } : {}) };
  if (response.expectedRequest) assertExpectedRequest(response.expectedRequest, request);
  await waitForFixture(response.delayMs, signal);
  if (response.transportError) fail('NITRO Fixture 传输失败', 'PLUGIN_RUNNER_TIMEOUT', state.writeStarted);
  if (!Number.isInteger(response.statusCode) || response.statusCode < 100 || response.statusCode > 599) fail('NITRO Fixture statusCode 无效', 'PLUGIN_PROTOCOL_CONTRACT_INVALID', state.writeStarted);
  if (!response.body || typeof response.body !== 'object' || Array.isArray(response.body)) fail('NITRO Fixture body 必须是对象', 'PLUGIN_PROTOCOL_CONTRACT_INVALID', state.writeStarted);
  return { statusCode: response.statusCode, body: response.body };
}

async function writeNitro(fixture, state, signal, method, path, body) {
  const response = await requestFixture(fixture, state, signal, method, path, body);
  assertNitroSuccess(response, state);
  return response;
}

function assertNitroSuccess(response, state) {
  if (response.statusCode < 200 || response.statusCode >= 300 || response.body.errorcode !== 0) {
    fail('NITRO 返回业务错误', 'PLUGIN_PROTOCOL_CONTRACT_INVALID', state.writeStarted);
  }
}

function toDiscovery(input, fixture, responses) {
  const version = stringValue(responses.version.body.nsversion?.version, 'NITRO version');
  const deviceAddress = optionalAddress(input.deviceAddress ?? fixture.device?.managementAddress);
  const sources = [
    ['LB', 'citrix.lb-server', 'lbvserver', responses.lb.body.lbvserver],
    ['VPN', 'citrix.vpn-server', 'vpnvserver', responses.vpn.body.vpnvserver],
    ['CS', 'citrix.cs-server', 'csvserver', responses.cs.body.csvserver],
    ['GSLB', 'citrix.gslb-server', 'gslbvserver', responses.gslb.body.gslbvserver],
  ];
  const frameworks = [];
  const sites = [];
  for (const [prefix, frameworkType, _resource, values] of sources) {
    const entries = array(values, `${prefix} virtual servers`);
    if (entries.length === 0) continue;
    const frameworkStableKey = `framework:${frameworkType.split('.')[1]}`;
    frameworks.push({ stableKey: frameworkStableKey, frameworkType, displayName: prefix });
    for (const value of entries) {
      const name = requiredIdentifier(String(value.name ?? ''), `${prefix} name`);
      const stableKey = `${prefix}:${safeKey(name)}`;
      sites.push({ stableKey, frameworkStableKey, siteType: 'network.virtual-server', displayName: name, addresses: [String(value.ipv46 ?? '')].filter(Boolean), port: optionalInteger(value.port), protocol: 'HTTPS', metadata: { virtualServerType: prefix } });
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
    stableKey: `CERT:${safeKey(requiredIdentifier(String(value.certkey ?? ''), 'certkey'))}`,
    sha256Fingerprint: typeof value.sha256Fingerprint === 'string' ? value.sha256Fingerprint : sha256Hex(String(value.certkey ?? '')),
    subject: optionalText(value.subject),
    issuer: optionalText(value.issuer),
    notBefore: optionalText(value.clientcertnotbefore),
    notAfter: optionalText(value.clientcertnotafter),
    metadata: { certkey: requiredIdentifier(String(value.certkey ?? ''), 'certkey'), certificatePath: optionalPath(value.cert) },
  }));
  const certificateByKey = new Map(certificates.map((item) => [String(item.metadata.certkey), item]));
  const certificateBindings = array(responses.bindings.body.sslvserver_sslcertkey_binding, 'NITRO bindings').map((value) => {
    const target = sites.find((site) => site.displayName === value.vservername);
    const certificate = certificateByKey.get(String(value.certkeyname));
    if (!target || !certificate) return undefined;
    return { stableKey: `BINDING:${safeKey(`${value.vservername}:${value.certkeyname}`)}`, managedTargetStableKey: `TARGET:${target.stableKey}`, certificateStableKey: certificate.stableKey, bindingName: String(value.vservername), metadata: { sniCertificate: Boolean(value.snicert), priority: optionalInteger(value.priority) } };
  }).filter(Boolean);
  return {
    apiVersion: 'gcac.device-discovery/v2',
    device: { stableKey: `citrix-adc:${safeKey(deviceAddress)}`, displayName: optionalText(input.displayName) ?? deviceAddress, productFamily: PLUGIN_ID, softwareVersion: version, managementAddress: deviceAddress, metadata: { managementProtocol: 'NITRO API' } },
    capabilities: CAPABILITIES.map((key) => ({ key, available: true })),
    frameworks,
    sites,
    managedTargets,
    certificates,
    certificateBindings,
    warnings: [],
  };
}

function requireFixture(value, protocol) {
  const fixture = record(value, 'protocolFixture');
  if (fixture.apiVersion !== 'gcac.device-fixture/v1' || fixture.protocol !== protocol) fail('协议 Fixture 合同不匹配');
  if (!fixture.responses || typeof fixture.responses !== 'object' || Array.isArray(fixture.responses)) fail('协议 Fixture 缺少 responses');
  return fixture;
}

function assertContext(context) {
  if (!context || typeof context !== 'object') fail('Runner 执行上下文缺失');
  for (const [key, pattern] of [['pluginVersionId', IDENTIFIER_PATTERN], ['pluginId', IDENTIFIER_PATTERN], ['pluginVersion', IDENTIFIER_PATTERN]]) {
    if (typeof context[key] !== 'string' || !pattern.test(context[key])) fail(`Runner 上下文 ${key} 无效`);
  }
  if (context.pluginId !== PLUGIN_ID || context.pluginVersion !== PLUGIN_VERSION) fail('Runner 执行上下文 PluginVersion 不匹配');
  if (!Array.isArray(context.grantRefs) || context.grantRefs.length === 0) fail('Runner 执行缺少 Grant');
  if (!(context.signal instanceof AbortSignal)) fail('Runner 执行缺少取消信号');
  if (!context.deadlineAt || Date.parse(context.deadlineAt) <= Date.now()) fail('Runner 执行超时');
}

function requireWriteRequest(context) {
  if (context.writeEffect !== true) fail('写入 Capability 必须声明 writeEffect=true');
}

function injected(name, pattern) {
  const value = process.env[name]?.trim();
  if (!value || !pattern.test(value)) throw new Error(`缺少或无效的 ${name}，Runner 必须失败关闭`);
  return value;
}

function successResult(summary, normalizedObjects = []) {
  return { success: true, status: 'SUCCESS', summary: redact(summary), normalizedObjects, warnings: [] };
}

function unknownResult() {
  return { success: false, status: 'UNKNOWN', summary: {}, normalizedObjects: [], warnings: [], error: { code: 'PLUGIN_OPERATION_UNKNOWN_STATE', message: 'Citrix 写操作结果无法确认，必须进入恢复流程', retryable: false, mayBeUnknown: true, secretRedacted: true } };
}

function fail(message, code = 'PLUGIN_CONTRACT_INVALID', writeStarted = false) {
  const error = new Error(message);
  error.code = code;
  error.writeStarted = writeStarted;
  throw error;
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
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) fail(`${name} 不是固定标识符`);
  return value;
}

function requiredTarget(value) {
  return requiredIdentifier(value, 'target');
}

function optionalAddress(value) {
  return stringValue(value, 'deviceAddress');
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function optionalPath(value) {
  return typeof value === 'string' && !/[\r\n]/.test(value) ? value : undefined;
}

function optionalInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

function array(value, name) {
  if (!Array.isArray(value)) fail(`${name} 必须是数组`);
  return value;
}

function firstArrayItem(value) {
  return Array.isArray(value) && value.length > 0 && value[0] && typeof value[0] === 'object' ? value[0] : undefined;
}

function hasBinding(body, target, certificateKey) {
  return array(body.sslvserver_sslcertkey_binding, 'NITRO binding response').some((item) => item?.vservername === target && item?.certkeyname === certificateKey);
}

function redactBinding(value) {
  if (!value || typeof value !== 'object') return undefined;
  return { vservername: optionalText(value.vservername), certkeyname: optionalText(value.certkeyname), priority: optionalInteger(value.priority), snicert: Boolean(value.snicert) };
}

function redactRequestBody(value) {
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (/password|secret|token|private|authorization|cookie/i.test(key)) result[key] = '[REDACTED]';
    else if (key === 'artifactRef') result[key] = child;
    else result[key] = child;
  }
  return result;
}

function assertExpectedRequest(expected, actual) {
  if (canonical(expected) !== canonical(actual)) fail('NITRO Fixture 请求合同不匹配');
}

async function waitForFixture(delayMs, signal) {
  if (delayMs === undefined) return;
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 120_000) fail('协议 Fixture delayMs 无效');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    const abort = () => { clearTimeout(timer); reject(Object.assign(new Error('Fixture 执行被取消'), { code: 'PLUGIN_OPERATION_CANCELLED' })); };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function safeKey(value) {
  if (IDENTIFIER_PATTERN.test(value)) return value;
  return `encoded-${Buffer.from(value, 'utf8').toString('base64url').slice(0, 220)}`;
}

function sha256Hex(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = /password|secret|token|private|authorization|cookie/i.test(key) ? '[REDACTED]' : redact(child);
  }
  return result;
}
