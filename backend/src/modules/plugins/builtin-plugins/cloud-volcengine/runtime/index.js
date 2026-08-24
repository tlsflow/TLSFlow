import { createHash, createHmac } from 'node:crypto';

const PLUGIN_ID = 'cloud.volcengine';
const PLUGIN_VERSION = '2.0.0';
const PROVIDER = 'volcengine';
const SIGNATURE_ALGORITHM = 'VOLCENGINE-V4-HMAC-SHA256';
const CAPABILITIES = Object.freeze(['cloud.service.connection-test', 'cloud.service.discover', 'certificate.deploy', 'certificate.rollback']);
const PERMISSIONS = Object.freeze(['artifact.read', 'audit.append', 'cloud.service.get', 'execution.cancel', 'execution.checkpoint', 'execution.progress', 'network.http', 'resource.lock', 'secret.resolve']);
const OPERATION_BY_CAPABILITY = Object.freeze({ 'cloud.service.connection-test': 'connection-test', 'cloud.service.discover': 'discover', 'certificate.deploy': 'deploy', 'certificate.rollback': 'rollback' });
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

// 厂商代码只有工厂导出；消息边界、握手和 Host API 代理均由标准 runner-server 负责。
export function createPluginRunnerExecutor() {
  const descriptor = Object.freeze({
    pluginVersionId: requiredDescriptorEnv('GCAC_PLUGIN_VERSION_ID'),
    pluginId: PLUGIN_ID,
    pluginVersion: PLUGIN_VERSION,
    capabilities: CAPABILITIES,
    permissions: PERMISSIONS,
    packageHash: requiredDigestEnv('GCAC_PLUGIN_PACKAGE_HASH'),
    resourceHash: requiredDigestEnv('GCAC_PLUGIN_RESOURCE_HASH'),
    manifestHash: requiredDigestEnv('GCAC_PLUGIN_MANIFEST_HASH'),
  });
  return Object.freeze({ descriptor, execute: (context, hostApi) => execute(context, hostApi, descriptor) });
}

async function execute(context, hostApi, descriptor) {
  const operation = OPERATION_BY_CAPABILITY[context?.capability];
  try {
    assertContext(context, descriptor, operation);
    const input = record(context.input, 'input');
    const security = record(input.security, 'input.security');
    const refs = [...context.grantRefs];
    const credential = record(input.credential, 'input.credential');
    const service = await hostData(hostApi, 'cloudService.get', { cloudServiceRef: requiredIdentifier(input.cloudServiceRef, 'cloudServiceRef') }, refs);
    const secret = await hostData(hostApi, 'secret.grant.resolve', { grantId: requiredIdentifier(credential.grantId, 'credential.grantId'), secretRef: requiredSecretRef(credential.secretRef), purpose: `cloud.${operation}` }, refs);
    const requestInput = record(input.request, 'input.request');
    let body = requestInput.body === undefined ? {} : requestInput.body;
    if (operation === 'deploy' || operation === 'rollback') {
      const artifact = await hostData(hostApi, 'artifact.grant.read', { grantId: requiredIdentifier(credential.grantId, 'credential.grantId'), artifactRef: requiredArtifactRef(input.certificateArtifactRef) }, refs);
      body = { ...record(body, 'input.request.body'), certificateChain: requiredPublicCertificate(artifact) };
    }
    const request = signRequest(service, secret, requestInput, body, security, operation);
    const response = await hostData(hostApi, 'http.request', request, refs);
    if (operation === 'connection-test') return readResult('connection-test', response);
    if (operation === 'discover') return discoverResult(response, descriptor);
    return await writeResult(operation, service, secret, requestInput, security, response, refs, hostApi, descriptor);
  } catch (error) {
    return failureResult(context, operation, error);
  }
}

function assertContext(context, descriptor, operation) {
  if (!context || typeof context !== 'object') throw contractError('CLOUD_CONTRACT_DENIED', '执行上下文缺失');
  if (context.pluginVersionId !== descriptor.pluginVersionId || context.pluginId !== descriptor.pluginId || context.pluginVersion !== descriptor.pluginVersion) throw contractError('CLOUD_CONTRACT_DENIED', '执行上下文身份未绑定到固定 PluginVersion');
  if (!operation) throw contractError('CLOUD_CONTRACT_DENIED', 'Capability 未绑定到 Cloud 插件');
  if (!Array.isArray(context.grantRefs) || context.grantRefs.length === 0) throw contractError('CLOUD_CONTRACT_DENIED', 'Cloud 插件执行缺少 Grant');
  const input = record(context.input, 'input');
  const security = record(input.security, 'input.security');
  for (const key of ['tokenRef', 'decisionRef', 'nonce', 'receiptRef', 'localPolicyRef', 'grantRef']) if (!requiredIdentifier(security[key], `input.security.${key}`)) throw contractError('CLOUD_CONTRACT_DENIED', 'Cloud 执行授权材料缺失');
  if (!context.grantRefs.includes(security.grantRef)) throw contractError('CLOUD_CONTRACT_DENIED', 'Cloud 执行 Grant 未绑定');
  for (const key of ['packageHash', 'manifestHash', 'resourceHash']) if (security[key] !== descriptor[key]) throw contractError('CLOUD_CONTRACT_DENIED', '执行绑定摘要与固定 PluginVersion 不一致');
}

async function writeResult(operation, service, secret, requestInput, security, response, refs, hostApi, descriptor) {
  let current = response;
  for (let attempt = 0; isPending(current); attempt += 1) {
    if (attempt >= 3) throw unknownError('CLOUD_OPERATION_UNKNOWN', '云厂商异步写操作超过轮询上限');
    const operationId = requiredIdentifier(current.operationId, 'operationId');
    current = await hostData(hostApi, 'http.request', signRequest(service, secret, { ...requestInput, method: 'GET', uri: `/operations/${operationId}`, action: 'GetOperation', body: {}, query: { operationId } }, {}, security, operation), refs);
  }
  const code = statusCode(current);
  const state = responseState(current);
  if (state === 'FAILED' || code >= 400 && code < 500) throw contractError('CLOUD_OPERATION_REJECTED', '云厂商拒绝了写操作');
  if (code < 200 || code >= 300 || state === 'UNKNOWN') throw unknownError('CLOUD_OPERATION_UNKNOWN', '云厂商写操作结果无法确认');
  return successResult({ provider: PROVIDER, operation, signatureAlgorithm: SIGNATURE_ALGORITHM, signatureVerified: current.signatureVerified === true, status: state === 'SUCCEEDED' ? 'SUCCEEDED' : 'ACCEPTED', descriptor: descriptor.pluginVersionId });
}

function readResult(operation, response) {
  const code = statusCode(response);
  if (code < 200 || code >= 300) throw contractError('CLOUD_READ_FAILED', '云厂商只读请求失败');
  return successResult({ provider: PROVIDER, operation, signatureAlgorithm: SIGNATURE_ALGORITHM, signatureVerified: response.signatureVerified === true, status: 'SUCCEEDED' });
}

function discoverResult(response, descriptor) {
  const code = statusCode(response);
  if (code < 200 || code >= 300) throw contractError('CLOUD_DISCOVERY_FAILED', '云厂商发现请求失败');
  const body = responseBody(response);
  const resources = Array.isArray(body.resources) ? body.resources : [];
  const normalizedObjects = resources.map((item, index) => {
    const resource = record(item, `resources.${index}`);
    const resourceId = requiredIdentifier(resource.id, `resources.${index}.id`);
    const resourceType = requiredIdentifier(resource.type, `resources.${index}.type`);
    const region = requiredIdentifier(resource.region, `resources.${index}.region`);
    return { apiVersion: 'gcac.cloud-service/v1', kind: 'CloudServiceResource', stableKey: `${descriptor.pluginId}:${resourceType}:${resourceId}`, pluginId: descriptor.pluginId, pluginVersionId: descriptor.pluginVersionId, provider: PROVIDER, resourceId, resourceType, region };
  });
  return { ...successResult({ provider: PROVIDER, operation: 'discover', signatureAlgorithm: SIGNATURE_ALGORITHM, signatureVerified: response.signatureVerified === true, status: 'SUCCEEDED' }), normalizedObjects };
}

function signRequest(service, secret, requestInput, body, security, operation) {
  const endpoint = requiredEndpoint(service.endpoint);
  const url = new URL(requiredPath(requestInput.uri), endpoint);
  const method = requiredMethod(requestInput.method ?? 'POST');
  const serviceName = requiredIdentifier(service.serviceName ?? requestInput.service ?? 'vod', 'service.serviceName');
  const region = requiredIdentifier(service.region ?? requestInput.region, 'service.region');
  const time = volcTimestamp(requestInput.timestamp);
  const queryObject = sanitizeQuery(requestInput.query);
  const query = canonicalQuery(queryObject);
  const bodyText = stableJson(body);
  const canonicalHeaders = `content-type:application/json\nhost:${url.host}\nx-date:${time.compact}\n`;
  const signedHeaders = 'content-type;host;x-date';
  const canonicalRequest = `${method}\n${url.pathname}\n${query}\n${canonicalHeaders}\n${signedHeaders}\n${sha256Hex(bodyText)}`;
  const scope = `${time.date}/${region}/${serviceName}/request`;
  const stringToSign = `HMAC-SHA256\n${time.compact}\n${scope}\n${sha256Hex(canonicalRequest)}`;
  const dateKey = hmac('sha256', `VOLC${requiredCredential(secret.secretKey, 'secretKey')}`, time.date);
  const regionKey = hmac('sha256', dateKey, region);
  const serviceKey = hmac('sha256', regionKey, serviceName);
  const signingKey = hmac('sha256', serviceKey, 'request');
  const signature = hmacHex('sha256', signingKey, stringToSign);
  const authorization = `HMAC-SHA256 Credential=${requiredCredential(secret.accessKey, 'accessKey')}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return {
    provider: PLUGIN_ID,
    algorithm: SIGNATURE_ALGORITHM,
    method,
    url: `${endpoint.replace(/\/$/, '')}${url.pathname}${query ? `?${query}` : ''}`,
    path: url.pathname,
    query: queryObject,
    headers: { authorization, host: url.host, 'content-type': 'application/json', 'x-date': time.compact, 'x-gcac-request-nonce': security.nonce },
    signedHeaders: signedHeaders.split(';'),
    body: bodyText,
  };
}

async function hostData(hostApi, method, input, grantRefs) {
  if (!hostApi || typeof hostApi.call !== 'function') throw unknownError('CLOUD_HOST_CALL_FAILED', 'Host API 不可用');
  let result;
  try { result = await hostApi.call(method, input, grantRefs); } catch { throw unknownError('CLOUD_HOST_CALL_FAILED', 'Cloud Host API 调用失败'); }
  if (!result || result.ok !== true || !result.data || typeof result.data !== 'object' || Array.isArray(result.data)) throw unknownError('CLOUD_HOST_CALL_FAILED', 'Cloud Host API 返回无效结果');
  return result.data;
}

function successResult(summary) { return { success: true, status: 'SUCCESS', summary, normalizedObjects: [], warnings: [] }; }
function failureResult(context, operation, error) { const item = error && typeof error === 'object' ? error : {}; const code = typeof item.code === 'string' ? item.code : 'CLOUD_PLUGIN_FAILED'; const mayBeUnknown = item.mayBeUnknown === true || context?.writeEffect === true && code === 'CLOUD_HOST_CALL_FAILED'; return { success: false, status: context?.writeEffect && mayBeUnknown ? 'UNKNOWN' : 'FAILED', summary: { provider: PROVIDER, operation: operation ?? 'unknown' }, normalizedObjects: [], warnings: [], error: { code, message: typeof item.safeMessage === 'string' ? item.safeMessage : 'Cloud 插件执行失败', retryable: item.retryable === true, mayBeUnknown, secretRedacted: true } }; }
function isPending(response) { return responseState(response) === 'PENDING' || statusCode(response) === 202; }
function responseState(response) { const body = responseBody(response); return typeof body.status === 'string' ? body.status.toUpperCase() : statusCode(response) >= 200 && statusCode(response) < 300 ? 'SUCCEEDED' : 'UNKNOWN'; }
function responseBody(response) { if (!response || typeof response !== 'object') return {}; if (response.body && typeof response.body === 'object' && !Array.isArray(response.body)) return response.body; if (typeof response.body === 'string') { try { return JSON.parse(response.body); } catch { return {}; } } return {}; }
function statusCode(response) { return typeof response?.statusCode === 'number' && Number.isInteger(response.statusCode) ? response.statusCode : 0; }
function requiredDescriptorEnv(name) { const value = process.env[name]?.trim(); if (!value || !/^[A-Za-z0-9._:-]{1,256}$/.test(value)) throw contractError('CLOUD_DESCRIPTOR_MISSING', `${name} 缺失或格式无效`); return value; }
function requiredDigestEnv(name) { const value = process.env[name]?.trim(); if (!value || !HASH_PATTERN.test(value)) throw contractError('CLOUD_DESCRIPTOR_MISSING', `${name} 缺失或格式无效`); return value; }
function record(value, path) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw contractError('CLOUD_INPUT_INVALID', `${path} 必须是对象`); return value; }
function requiredIdentifier(value, path) { if (typeof value !== 'string' || !/^[A-Za-z0-9._:/-]{1,512}$/.test(value)) throw contractError('CLOUD_INPUT_INVALID', `${path} 缺少固定标识`); return value; }
function requiredSecretRef(value) { if (typeof value !== 'string' || !/^secret:\/\/[A-Za-z0-9._:/#-]{1,512}$/.test(value)) throw contractError('CLOUD_INPUT_INVALID', 'SecretRef 格式无效'); return value; }
function requiredArtifactRef(value) { if (typeof value !== 'string' || !/^artifact:\/\/[A-Za-z0-9._:/#-]{1,512}$/.test(value)) throw contractError('CLOUD_INPUT_INVALID', 'ArtifactRef 格式无效'); return value; }
function requiredCredential(value, path) { if (typeof value !== 'string' || value.length === 0 || value.length > 512) throw contractError('CLOUD_CREDENTIAL_INVALID', `${path} 缺失`); return value; }
function requiredPublicCertificate(value) { if (typeof value.certificateChain !== 'string' || value.certificateChain.length === 0 || value.certificateChain.length > 1024 * 1024) throw contractError('CLOUD_ARTIFACT_INVALID', '证书 Artifact 缺少公钥证书链'); return value.certificateChain; }
function requiredEndpoint(value) { if (typeof value !== 'string' || !/^https:\/\/[^/\s]+$/i.test(value)) throw contractError('CLOUD_SERVICE_INVALID', 'Cloud Service Endpoint 无效'); return value; }
function requiredPath(value) { if (typeof value !== 'string' || !value.startsWith('/') || value.includes('..') || value.length > 2048) throw contractError('CLOUD_INPUT_INVALID', '请求路径无效'); return value; }
function requiredMethod(value) { if (typeof value !== 'string' || !['GET', 'POST'].includes(value.toUpperCase())) throw contractError('CLOUD_INPUT_INVALID', '请求方法不在固定集合'); return value.toUpperCase(); }
function sanitizeQuery(value) { if (value === undefined) return {}; const query = record(value, 'request.query'); const result = {}; for (const [key, item] of Object.entries(query)) { if (!/^[A-Za-z0-9_.-]{1,128}$/.test(key) || !['string', 'number', 'boolean'].includes(typeof item)) throw contractError('CLOUD_INPUT_INVALID', '请求查询参数无效'); result[key] = String(item); } return result; }
function volcTimestamp(value) { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw contractError('CLOUD_INPUT_INVALID', '请求时间戳无效'); const date = new Date(value); const compact = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); return { compact, date: compact.slice(0, 8) }; }
function canonicalQuery(query) { return Object.entries(query).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${rfc3986(key)}=${rfc3986(String(value))}`).join('&'); }
function rfc3986(value) { return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`); }
function hmac(algorithm, key, value) { return createHmac(algorithm, key).update(value).digest(); }
function hmacHex(algorithm, key, value) { return createHmac(algorithm, key).update(value).digest('hex'); }
function sha256Hex(value) { return createHash('sha256').update(value).digest('hex'); }
function stableJson(value) { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`; return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`; }
function contractError(code, safeMessage) { const error = new Error(safeMessage); error.code = code; error.safeMessage = safeMessage; error.retryable = false; error.mayBeUnknown = false; return error; }
function unknownError(code, safeMessage) { const error = contractError(code, safeMessage); error.mayBeUnknown = true; error.retryable = true; return error; }
