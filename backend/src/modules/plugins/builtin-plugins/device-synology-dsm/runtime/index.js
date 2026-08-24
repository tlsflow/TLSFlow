import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const packageManifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const PLUGIN_ID = packageManifest.pluginId;
const PLUGIN_VERSION = packageManifest.version;
const PROTOCOL = 'DSM';
const CAPABILITIES = Object.freeze(packageManifest.capabilities.map((item) => item.key));
const PERMISSIONS = Object.freeze([...packageManifest.permissions]);
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/;
const SECRET_REF_PATTERN = /^secret:\/\/[A-Za-z0-9._:/#-]{1,512}$/;
const ARTIFACT_REF_PATTERN = /^artifact:\/\/[A-Za-z0-9._:/#-]{1,512}$/;
const AUTH_PATH = '/webapi/auth.cgi?api=SYNO.API.Auth&version=7&method=login&session=GCAC&format=sid';
const INFO_PATH = '/webapi/entry.cgi?api=SYNO.DSM.Info&version=2&method=get';
const SERVICE_PATH = '/webapi/entry.cgi?api=SYNO.Core.Network.Interface&version=1&method=list';
const CERTIFICATE_PATH = '/webapi/entry.cgi?api=SYNO.Core.Certificate&version=1&method=list';
const IMPORT_PATH = '/webapi/entry.cgi?api=SYNO.Core.Certificate&version=1&method=import';
const ROLLBACK_PATH = '/webapi/entry.cgi?api=SYNO.Core.Certificate&version=1&method=rollback';

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
  if (!CAPABILITIES.includes(context.capability)) fail('Capability 未绑定到 Synology DSM PluginVersion');
  const input = record(context.input, 'input');
  const state = { requestCount: 0, writeStarted: false, responseIndexes: {} };
  const fixture = requireFixture(input.protocolFixture);
  const credential = await resolveCredential(input, context, hostApi);
  try {
    switch (context.capability) {
      case 'device.connection.test':
        return await connectionTest(input, fixture, credential, state, context.signal);
      case 'device.discover':
        return await discover(input, fixture, credential, state, context.signal);
      case 'certificate.deploy':
        requireWriteRequest(context);
        return await deploy(input, fixture, credential, state, context, hostApi);
      case 'certificate.rollback':
        requireWriteRequest(context);
        return await rollback(input, fixture, credential, state, context.signal);
      default:
        fail('未实现的 Synology DSM Capability');
    }
  } catch (error) {
    if (context.writeEffect && (state.writeStarted || error?.writeStarted === true)) return unknownResult();
    throw error;
  }
}

async function connectionTest(input, fixture, credential, state, signal) {
  const response = await requestFixture(fixture, state, signal, 'POST', AUTH_PATH, {
    account: credential.username,
    password: '[REDACTED]',
    secretGrantId: credential.grantId,
  });
  assertDsmSuccess(response, state);
  const sid = stringValue(response.body.data?.sid, 'DSM 会话 SID');
  const info = await requestFixture(fixture, state, signal, 'GET', INFO_PATH, { sid });
  assertDsmSuccess(info, state);
  return successResult({
    protocol: PROTOCOL,
    managementAddress: requiredAddress(input.deviceAddress),
    productVersion: dsmVersion(info.body),
    sessionEstablished: Boolean(sid),
    requestCount: state.requestCount,
  });
}

async function discover(input, fixture, credential, state, signal) {
  const session = await login(fixture, credential, state, signal);
  const [info, services, certificates] = await Promise.all([
    requestFixture(fixture, state, signal, 'GET', INFO_PATH, { sid: session.sid }),
    requestFixture(fixture, state, signal, 'GET', SERVICE_PATH, { sid: session.sid }),
    requestFixture(fixture, state, signal, 'GET', CERTIFICATE_PATH, { sid: session.sid }),
  ]);
  assertDsmSuccess(info, state);
  assertDsmSuccess(services, state);
  assertDsmSuccess(certificates, state);
  const discovery = toDiscovery(input, fixture, info.body, services.body, certificates.body);
  return successResult({ protocol: PROTOCOL, requestCount: state.requestCount, sessionEstablished: true }, [discovery]);
}

async function deploy(input, fixture, credential, state, context, hostApi) {
  const target = requiredTarget(input.target);
  const artifact = await resolveArtifact(input, context, hostApi);
  const session = await login(fixture, credential, state, context.signal);
  const current = await requestFixture(fixture, state, context.signal, 'GET', CERTIFICATE_PATH, { sid: session.sid });
  assertDsmSuccess(current, state);
  const previous = findTargetCertificate(current.body, target);
  const certificateId = requiredIdentifier(
    input.certificateId ?? `gcac-${sha256Hex(artifact.artifactRef).slice(0, 16)}`,
    'certificateId',
  );
  try {
    await writeDsm(fixture, state, context.signal, IMPORT_PATH, {
      sid: session.sid,
      target,
      certificateId,
      artifactRef: artifact.artifactRef,
      artifactSha256: artifact.sha256,
      intermediateCount: optionalNonNegativeInteger(input.intermediateCount) ?? 0,
    });
    const verified = await requestFixture(fixture, state, context.signal, 'GET', CERTIFICATE_PATH, { sid: session.sid });
    assertDsmSuccess(verified, state);
    if (!hasTargetCertificate(verified.body, target, certificateId)) {
      fail('DSM 写入后证书绑定校验未命中', 'PLUGIN_PROTOCOL_CONTRACT_INVALID', true);
    }
    return successResult({
      protocol: PROTOCOL,
      operation: 'certificate.deploy',
      target,
      certificateId,
      previousCertificate: redactCertificate(previous),
      verified: true,
      requestCount: state.requestCount,
    });
  } catch (error) {
    if (state.writeStarted) {
      await attemptRollback(fixture, state, context.signal, session.sid, target, previous, certificateId);
      error.writeStarted = true;
    }
    throw error;
  }
}

async function rollback(input, fixture, credential, state, signal) {
  const target = requiredTarget(input.target);
  const previous = record(input.previousCertificate, 'previousCertificate');
  const certificateId = requiredIdentifier(previous.id ?? previous.certificateId, 'previousCertificate.id');
  const session = await login(fixture, credential, state, signal);
  await writeDsm(fixture, state, signal, ROLLBACK_PATH, {
    sid: session.sid,
    target,
    certificateId,
  });
  const verified = await requestFixture(fixture, state, signal, 'GET', CERTIFICATE_PATH, { sid: session.sid });
  assertDsmSuccess(verified, state);
  if (!hasTargetCertificate(verified.body, target, certificateId)) {
    fail('DSM 回滚后证书绑定校验未命中', 'PLUGIN_PROTOCOL_CONTRACT_INVALID', true);
  }
  return successResult({
    protocol: PROTOCOL,
    operation: 'certificate.rollback',
    target,
    restoredCertificateId: certificateId,
    verified: true,
    requestCount: state.requestCount,
  });
}

async function attemptRollback(fixture, state, signal, sid, target, previous, failedCertificateId) {
  if (!previous) return;
  const certificateId = previous.id ?? previous.certificateId;
  if (typeof certificateId !== 'string') return;
  try {
    await writeDsm(fixture, state, signal, ROLLBACK_PATH, {
      sid,
      target,
      certificateId,
      failedCertificateId,
    });
  } catch (error) {
    error.writeStarted = true;
    throw error;
  }
}

async function login(fixture, credential, state, signal) {
  const response = await requestFixture(fixture, state, signal, 'POST', AUTH_PATH, {
    account: credential.username,
    password: '[REDACTED]',
    secretGrantId: credential.grantId,
  });
  assertDsmSuccess(response, state);
  return { sid: stringValue(response.body.data?.sid, 'DSM 会话 SID') };
}

async function resolveCredential(input, context, hostApi) {
  const credential = record(input.credential ?? input.credentials?.credential, 'credential');
  const username = stringValue(credential.username, 'credential.username');
  const secretRef = credential.secretRef ?? credential.secretRefs?.password;
  if (typeof secretRef !== 'string' || !SECRET_REF_PATTERN.test(secretRef)) fail('credential SecretRef 缺失或格式无效');
  const grantId = requiredIdentifier(credential.grantId ?? context.grantRefs[0], 'credential.grantId');
  if (!context.grantRefs.includes(grantId)) fail('credential Grant 未绑定到当前执行', 'PLUGIN_HOST_CALL_DENIED');
  const result = await hostApi.call('secret.grant.resolve', { grantId, secretRef, purpose: `${PLUGIN_ID}:dsm` }, [grantId]);
  if (!result || result.ok !== true || !result.data || result.data.value !== '[REDACTED]') {
    fail('Secret Host API 未返回脱敏句柄', 'PLUGIN_HOST_CALL_DENIED');
  }
  return { username, grantId };
}

async function resolveArtifact(input, context, hostApi) {
  const artifact = record(input.artifact ?? input.artifacts?.certificate, 'certificate artifact');
  const artifactRef = artifact.artifactRef ?? artifact.ref;
  if (typeof artifactRef !== 'string' || !ARTIFACT_REF_PATTERN.test(artifactRef)) fail('证书 ArtifactRef 缺失或格式无效');
  const grantId = requiredIdentifier(artifact.grantId ?? context.grantRefs[0], 'artifact.grantId');
  if (!context.grantRefs.includes(grantId)) fail('Artifact Grant 未绑定到当前执行', 'PLUGIN_HOST_CALL_DENIED');
  const result = await hostApi.call('artifact.grant.read', { grantId, artifactRef }, [grantId]);
  if (!result || result.ok !== true || !result.data || !HASH_PATTERN.test(result.data.sha256)) {
    fail('Artifact Host API 未返回固定摘要', 'PLUGIN_HOST_CALL_DENIED');
  }
  return { artifactRef, sha256: result.data.sha256 };
}

async function requestFixture(fixture, state, signal, method, path, body) {
  state.requestCount += 1;
  if (method !== 'GET' && method !== 'HEAD') state.writeStarted = path === IMPORT_PATH || path === ROLLBACK_PATH;
  const responseKey = `${method} ${path}`;
  const definedResponse = fixture.responses[responseKey];
  const response = Array.isArray(definedResponse)
    ? definedResponse[state.responseIndexes[responseKey] ?? 0]
    : definedResponse;
  if (Array.isArray(definedResponse)) state.responseIndexes[responseKey] = (state.responseIndexes[responseKey] ?? 0) + 1;
  if (!response) fail(`DSM Fixture 缺少固定响应：${method} ${path}`, 'PLUGIN_PROTOCOL_CONTRACT_INVALID', state.writeStarted);
  const request = { method, path, ...(body ? { body: redactRequestBody(body) } : {}) };
  if (response.expectedRequest) assertExpectedRequest(response.expectedRequest, request);
  await waitForFixture(response.delayMs, signal);
  if (response.transportError) fail('DSM Fixture 传输失败', 'PLUGIN_RUNNER_TIMEOUT', state.writeStarted);
  if (!Number.isInteger(response.statusCode) || response.statusCode < 100 || response.statusCode > 599) {
    fail('DSM Fixture statusCode 无效', 'PLUGIN_PROTOCOL_CONTRACT_INVALID', state.writeStarted);
  }
  if (!response.body || typeof response.body !== 'object' || Array.isArray(response.body)) {
    fail('DSM Fixture body 必须是对象', 'PLUGIN_PROTOCOL_CONTRACT_INVALID', state.writeStarted);
  }
  return { statusCode: response.statusCode, body: response.body };
}

async function writeDsm(fixture, state, signal, path, body) {
  const response = await requestFixture(fixture, state, signal, 'POST', path, body);
  assertDsmSuccess(response, state);
  return response;
}

function assertDsmSuccess(response, state) {
  if (response.statusCode < 200 || response.statusCode >= 300 || response.body.success !== true) {
    fail('DSM 返回业务错误', 'PLUGIN_PROTOCOL_CONTRACT_INVALID', state.writeStarted);
  }
}

function toDiscovery(input, fixture, infoBody, servicesBody, certificatesBody) {
  const version = dsmVersion(infoBody);
  const address = requiredAddress(input.deviceAddress ?? fixture.device?.managementAddress);
  const services = array(servicesBody.data?.services ?? [], 'DSM services');
  const certificates = array(certificatesBody.data?.certificates ?? [], 'DSM certificates');
  const frameworkStableKey = 'framework:synology-dsm';
  const frameworks = [{ stableKey: frameworkStableKey, frameworkType: 'synology.dsm-web', displayName: 'DSM Web' }];
  const sites = services.map((service) => {
    const name = requiredName(String(service.name ?? service.id ?? ''), 'DSM service name');
    return {
      stableKey: `DSM:${safeKey(name)}`,
      frameworkStableKey,
      siteType: 'device.service',
      displayName: name,
      addresses: [address],
      port: optionalNonNegativeInteger(service.port),
      protocol: String(service.protocol ?? 'HTTPS'),
      metadata: { serviceId: optionalText(service.id), certificateId: optionalText(service.certificateId) },
    };
  });
  const managedTargets = sites.map((site) => ({
    stableKey: `TARGET:${site.stableKey}`,
    frameworkStableKey,
    siteStableKey: site.stableKey,
    targetType: 'tls.binding',
    targetKey: site.stableKey,
    supportedCapabilities: ['certificate.deploy', 'certificate.verify', 'certificate.rollback'],
    executionLocations: ['CONTROL_PLANE', 'GATEWAY'],
  }));
  const normalizedCertificates = certificates.map((certificate) => ({
    stableKey: `CERT:${safeKey(requiredIdentifier(String(certificate.id ?? certificate.certificateId ?? ''), 'DSM certificate id'))}`,
    sha256Fingerprint: requiredFingerprint(certificate.sha256Fingerprint ?? certificate.fingerprint),
    subject: optionalText(certificate.subject),
    issuer: optionalText(certificate.issuer),
    notBefore: optionalText(certificate.notBefore),
    notAfter: optionalText(certificate.notAfter),
    metadata: { certificateId: requiredIdentifier(String(certificate.id ?? certificate.certificateId), 'DSM certificate id') },
  }));
  const certificateById = new Map(normalizedCertificates.map((item) => [String(item.metadata.certificateId), item]));
  const certificateBindings = services.map((service) => {
    const serviceName = String(service.name ?? service.id ?? '');
    const certificateId = String(service.certificateId ?? '');
    const certificate = certificateById.get(certificateId);
    const site = sites.find((item) => item.displayName === serviceName);
    if (!certificate || !site) return undefined;
    return {
      stableKey: `BINDING:${safeKey(`${serviceName}:${certificateId}`)}`,
      managedTargetStableKey: `TARGET:${site.stableKey}`,
      certificateStableKey: certificate.stableKey,
      bindingName: serviceName,
      metadata: { certificateId },
    };
  }).filter(Boolean);
  return {
    apiVersion: 'gcac.device-discovery/v2',
    device: {
      stableKey: `synology-dsm:${safeKey(address)}`,
      displayName: optionalText(input.displayName) ?? address,
      productFamily: PLUGIN_ID,
      softwareVersion: version,
      managementAddress: address,
      metadata: { managementProtocol: 'DSM Web API' },
    },
    capabilities: CAPABILITIES.map((key) => ({ key, available: true })),
    frameworks,
    sites,
    managedTargets,
    certificates: normalizedCertificates,
    certificateBindings,
    warnings: [],
  };
}

function findTargetCertificate(body, target) {
  const certificates = array(body.data?.certificates ?? [], 'DSM certificates');
  return certificates.find((certificate) => {
    const targets = Array.isArray(certificate.serviceNames) ? certificate.serviceNames : [certificate.serviceName];
    return targets.includes(target);
  });
}

function hasTargetCertificate(body, target, certificateId) {
  return Boolean(findTargetCertificate(body, target)?.id === certificateId
    || findTargetCertificate(body, target)?.certificateId === certificateId);
}

function requireFixture(value) {
  const fixture = record(value, 'protocolFixture');
  if (fixture.apiVersion !== 'gcac.device-fixture/v1' || fixture.protocol !== PROTOCOL) fail('DSM Fixture 合同不匹配');
  if (!fixture.responses || typeof fixture.responses !== 'object' || Array.isArray(fixture.responses)) fail('DSM Fixture 缺少 responses');
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
  return {
    success: false,
    status: 'UNKNOWN',
    summary: {},
    normalizedObjects: [],
    warnings: [],
    error: { code: 'PLUGIN_OPERATION_UNKNOWN_STATE', message: 'DSM 写操作结果无法确认，必须进入恢复流程', retryable: false, mayBeUnknown: true, secretRedacted: true },
  };
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
  if (typeof value !== 'string' || value.trim() === '' || value.length > 256 || /[\r\n]/.test(value)) fail('target 不是固定目标标识');
  return value;
}

function requiredAddress(value) {
  return stringValue(value, 'deviceAddress');
}

function requiredName(value, name) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 256 || /[\r\n]/.test(value)) fail(`${name} 不是固定名称`);
  return value;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function optionalNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

function requiredFingerprint(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) fail('DSM certificate fingerprint 缺失或格式无效');
  return value.toLowerCase();
}

function array(value, name) {
  if (!Array.isArray(value)) fail(`${name} 必须是数组`);
  return value;
}

function dsmVersion(body) {
  return stringValue(body.data?.version ?? body.data?.systemVersion ?? body.data?.['SYNO.DSM.Info']?.version, 'DSM version');
}

function redactCertificate(value) {
  if (!value || typeof value !== 'object') return undefined;
  return {
    id: optionalText(value.id ?? value.certificateId),
    serviceName: optionalText(value.serviceName),
    serviceNames: Array.isArray(value.serviceNames) ? value.serviceNames.map((item) => optionalText(item)).filter(Boolean) : undefined,
    sha256Fingerprint: optionalText(value.sha256Fingerprint ?? value.fingerprint),
  };
}

function redactRequestBody(value) {
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = /password|secret|token|private|authorization|cookie/i.test(key) ? '[REDACTED]' : child;
  }
  return result;
}

function assertExpectedRequest(expected, actual) {
  if (canonical(expected) !== canonical(actual)) fail('DSM Fixture 请求合同不匹配');
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
  for (const [key, child] of Object.entries(value)) result[key] = /password|secret|token|private|authorization|cookie/i.test(key) ? '[REDACTED]' : redact(child);
  return result;
}
