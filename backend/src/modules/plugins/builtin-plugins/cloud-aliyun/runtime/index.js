import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const runtimeDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(runtimeDirectory, '..');
const packageManifest = JSON.parse(readPackageResource('manifest.json'));
const PLUGIN_ID = packageManifest.pluginId;
const PLUGIN_VERSION = packageManifest.version;
const PROVIDER = 'aliyun';
const SIGNATURE_ALGORITHM = 'ALIYUN-RPC-HMAC-SHA1';
const CAPABILITIES = Object.freeze(packageManifest.capabilities.map((item) => item.key));
const PERMISSIONS = Object.freeze([...packageManifest.permissions]);
const OPERATION_BY_CAPABILITY = Object.freeze({
  'cloud.service.connection-test': 'connection-test',
  'cloud.service.discover': 'discover',
  'certificate.deploy': 'deploy',
  'certificate.verify': 'verify',
  'certificate.rollback': 'rollback',
});
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

function readPackageResource(resourcePath) {
  const normalized = String(resourcePath).replaceAll('\\', '/');
  const absolute = resolve(packageDirectory, normalized);
  const relativePath = relative(packageDirectory, absolute).replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes(String.fromCharCode(0))
    || relativePath === '..' || relativePath.startsWith('../')) {
    throw new Error('插件包资源路径越界');
  }
  return readFileSync(join(packageDirectory, relativePath), 'utf8');
}

/**
 * Runner 只从环境接收适配器已经校验过的不可变身份和摘要。
 * 插件包不自行启动 IPC；标准 runner-server 负责加载本工厂并转发 Host API。
 */
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
    const grantRefs = [...context.grantRefs];
    const credential = record(input.credential, 'input.credential');
    const service = await hostCloudServiceGet(hostApi, {
      cloudServiceRef: requiredIdentifier(input.cloudServiceRef, 'cloudServiceRef'),
    }, grantRefs);
    const secret = await hostSecretResolve(hostApi, {
      grantId: requiredIdentifier(credential.grantId, 'credential.grantId'),
      secretRef: requiredSecretRef(credential.secretRef),
      purpose: `cloud.${operation}`,
    }, grantRefs);
    const requestInput = record(input.request, 'input.request');
    let body = requestInput.body === undefined ? {} : requestInput.body;
    if (operation === 'deploy' || operation === 'rollback') {
      const artifact = await hostArtifactRead(hostApi, {
        grantId: requiredIdentifier(credential.grantId, 'credential.grantId'),
        artifactRef: requiredArtifactRef(input.certificateArtifactRef),
      }, grantRefs);
      body = { ...record(body, 'input.request.body'), certificateChain: requiredPublicCertificate(artifact) };
    }
    const request = signRequest(service, secret, requestInput, body, security, operation);
    const response = await hostHttpRequest(hostApi, request, grantRefs);
    if (operation === 'connection-test' || operation === 'verify') return readResult(operation, response);
    if (operation === 'discover') return discoverResult(response, descriptor);
    return await writeResult(operation, service, secret, requestInput, security, response, grantRefs, hostApi, descriptor);
  } catch (error) {
    return failureResult(context, operation, error);
  }
}

function assertContext(context, descriptor, operation) {
  if (!context || typeof context !== 'object') throw contractError('CLOUD_CONTRACT_DENIED', '执行上下文缺失');
  if (context.pluginVersionId !== descriptor.pluginVersionId
    || context.pluginId !== descriptor.pluginId
    || context.pluginVersion !== descriptor.pluginVersion) {
    throw contractError('CLOUD_CONTRACT_DENIED', '执行上下文身份未绑定到固定 PluginVersion');
  }
  if (!operation) throw contractError('CLOUD_CONTRACT_DENIED', 'Capability 未绑定到 Cloud 插件');
  if (!Array.isArray(context.grantRefs) || context.grantRefs.length === 0) {
    throw contractError('CLOUD_CONTRACT_DENIED', 'Cloud 插件执行缺少 Grant');
  }
  const input = record(context.input, 'input');
  const security = record(input.security, 'input.security');
  for (const key of ['tokenRef', 'decisionRef', 'nonce', 'receiptRef', 'localPolicyRef', 'grantRef']) {
    if (!requiredIdentifier(security[key], `input.security.${key}`)) throw contractError('CLOUD_CONTRACT_DENIED', 'Cloud 执行授权材料缺失');
  }
  if (!context.grantRefs.includes(security.grantRef)) throw contractError('CLOUD_CONTRACT_DENIED', 'Cloud 执行 Grant 未绑定');
  for (const [key, envName] of [['packageHash', 'GCAC_PLUGIN_PACKAGE_HASH'], ['manifestHash', 'GCAC_PLUGIN_MANIFEST_HASH'], ['resourceHash', 'GCAC_PLUGIN_RESOURCE_HASH']]) {
    if (security[key] !== descriptor[key]) throw contractError('CLOUD_CONTRACT_DENIED', `${envName} 与执行绑定摘要不一致`);
  }
}

async function writeResult(operation, service, secret, requestInput, security, response, grantRefs, hostApi, descriptor) {
  let current = response;
  let attempts = 0;
  while (isPending(current)) {
    if (attempts++ >= 3) throw unknownError('CLOUD_OPERATION_UNKNOWN', '云厂商异步写操作超过轮询上限');
    const operationId = requiredIdentifier(current.operationId, 'operationId');
    const pollInput = { ...requestInput, method: 'GET', uri: `/operations/${operationId}`, action: 'GetOperation', body: {} };
    const pollRequest = signRequest(service, secret, pollInput, {}, security, operation);
    current = await hostHttpRequest(hostApi, pollRequest, grantRefs);
  }
  const status = statusCode(current);
  const state = responseState(current);
  if (state === 'FAILED' || status >= 400 && status < 500) {
    throw contractError('CLOUD_OPERATION_REJECTED', '云厂商拒绝了写操作');
  }
  if (status < 200 || status >= 300 || state === 'UNKNOWN') {
    throw unknownError('CLOUD_OPERATION_UNKNOWN', '云厂商写操作结果无法确认');
  }
  return successResult({
    provider: PROVIDER,
    operation,
    signatureAlgorithm: SIGNATURE_ALGORITHM,
    signatureVerified: current.signatureVerified === true,
    status: state === 'SUCCEEDED' ? 'SUCCEEDED' : 'ACCEPTED',
    descriptor: descriptor.pluginVersionId,
  });
}

function readResult(operation, response) {
  const status = statusCode(response);
  if (status < 200 || status >= 300) throw contractError('CLOUD_READ_FAILED', '云厂商只读请求失败');
  return successResult({
    provider: PROVIDER,
    operation,
    signatureAlgorithm: SIGNATURE_ALGORITHM,
    signatureVerified: response.signatureVerified === true,
    status: 'SUCCEEDED',
  });
}

function discoverResult(response, descriptor) {
  const status = statusCode(response);
  if (status < 200 || status >= 300) throw contractError('CLOUD_DISCOVERY_FAILED', '云厂商发现请求失败');
  const body = responseBody(response);
  const resources = Array.isArray(body.resources) ? body.resources : [];
  const normalizedObjects = resources.map((item, index) => {
    const resource = record(item, `resources.${index}`);
    const resourceId = requiredIdentifier(resource.id, `resources.${index}.id`);
    const resourceType = requiredIdentifier(resource.type, `resources.${index}.type`);
    const region = requiredIdentifier(resource.region, `resources.${index}.region`);
    return {
      apiVersion: 'gcac.cloud-service/v1',
      kind: 'CloudServiceResource',
      stableKey: `${descriptor.pluginId}:${resourceType}:${resourceId}`,
      pluginId: descriptor.pluginId,
      pluginVersionId: descriptor.pluginVersionId,
      provider: PROVIDER,
      resourceId,
      resourceType,
      region,
    };
  });
  return {
    ...successResult({ provider: PROVIDER, operation: 'discover', signatureAlgorithm: SIGNATURE_ALGORITHM, signatureVerified: response.signatureVerified === true, status: 'SUCCEEDED' }),
    normalizedObjects,
  };
}

function signRequest(service, secret, requestInput, body, security, operation) {
  const { endpoint } = cloudServiceScope(service);
  const url = new URL(requiredPath(requestInput.uri), endpoint);
  const method = requestInput.method === undefined ? (operation === 'discover' ? 'POST' : 'POST') : requiredMethod(requestInput.method);
  const action = requiredIdentifier(requestInput.action ?? operation, 'request.action');
  const timestamp = aliTimestamp(requestInput.timestamp);
  const query = sanitizeQuery(requestInput.query);
  const bodyText = stableJson(body);
  const params = {
    Action: action,
    AccessKeyId: requiredCredential(secret.accessKeyId, 'accessKeyId'),
    Format: 'JSON',
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: security.nonce,
    SignatureVersion: '1.0',
    SignatureTimestamp: timestamp,
    Version: requiredIdentifier(requestInput.apiVersion ?? '2018-05-10', 'request.apiVersion'),
    ...query,
  };
  const unsigned = canonicalQuery(params);
  const stringToSign = `${method}&%2F&${rfc3986(unsigned)}`;
  params.Signature = hmacBase64('sha1', `${requiredCredential(secret.accessKeySecret, 'accessKeySecret')}&`, stringToSign);
  const signedQuery = canonicalQuery(params);
  return {
    provider: PLUGIN_ID,
    algorithm: SIGNATURE_ALGORITHM,
    method,
    url: `${endpoint.replace(/\/$/, '')}/?${signedQuery}`,
    path: '/',
    operationPath: url.pathname,
    query: params,
    headers: { host: url.host, 'content-type': 'application/json', 'x-gcac-request-nonce': security.nonce },
    signedHeaders: ['content-type', 'host'],
    body: bodyText,
  };
}

async function hostData(hostApi, invoke) {
  if (!hostApi || typeof hostApi.call !== 'function') throw hostError('Host API 不可用');
  let result;
  try {
    result = await invoke();
  } catch {
    throw unknownError('CLOUD_HOST_CALL_FAILED', 'Cloud Host API 调用失败');
  }
  if (!result || result.ok !== true || !result.data || typeof result.data !== 'object' || Array.isArray(result.data)) {
    throw unknownError('CLOUD_HOST_CALL_FAILED', 'Cloud Host API 返回无效结果');
  }
  return result.data;
}

function hostCloudServiceGet(hostApi, input, grantRefs) {
  return hostData(hostApi, () => hostApi.call('cloudService.get', input, grantRefs));
}

function hostSecretResolve(hostApi, input, grantRefs) {
  return hostData(hostApi, () => hostApi.call('secret.grant.resolve', input, grantRefs));
}

function hostArtifactRead(hostApi, input, grantRefs) {
  return hostData(hostApi, () => hostApi.call('artifact.grant.read', input, grantRefs));
}

function hostHttpRequest(hostApi, input, grantRefs) {
  return hostData(hostApi, () => hostApi.call('http.request', input, grantRefs));
}

function successResult(summary) {
  return { success: true, status: 'SUCCESS', summary, normalizedObjects: [], warnings: [] };
}

function failureResult(context, operation, error) {
  const contract = error && typeof error === 'object' ? error : undefined;
  const code = typeof contract?.code === 'string' ? contract.code : 'CLOUD_PLUGIN_FAILED';
  const mayBeUnknown = contract?.mayBeUnknown === true || context?.writeEffect === true && code === 'CLOUD_HOST_CALL_FAILED';
  return {
    success: false,
    status: context?.writeEffect && mayBeUnknown ? 'UNKNOWN' : 'FAILED',
    summary: { provider: PROVIDER, operation: operation ?? 'unknown' },
    normalizedObjects: [],
    warnings: [],
    error: { code, message: typeof contract?.safeMessage === 'string' ? contract.safeMessage : 'Cloud 插件执行失败', retryable: contract?.retryable === true, mayBeUnknown, secretRedacted: true },
  };
}

function isPending(response) {
  return responseState(response) === 'PENDING' || statusCode(response) === 202;
}

function responseState(response) {
  const body = responseBody(response);
  if (typeof body.status === 'string') return body.status.toUpperCase();
  return statusCode(response) >= 200 && statusCode(response) < 300 ? 'SUCCEEDED' : 'UNKNOWN';
}

function responseBody(response) {
  if (!response || typeof response !== 'object') return {};
  if (response.body && typeof response.body === 'object' && !Array.isArray(response.body)) return response.body;
  if (typeof response.body === 'string') {
    try { return JSON.parse(response.body); } catch { return {}; }
  }
  return {};
}

function statusCode(response) {
  return typeof response?.statusCode === 'number' && Number.isInteger(response.statusCode) ? response.statusCode : 0;
}

function requiredDescriptorEnv(name) {
  const value = process.env[name]?.trim();
  if (!value || !/^[A-Za-z0-9._:-]{1,256}$/.test(value)) throw contractError('CLOUD_DESCRIPTOR_MISSING', `${name} 缺失或格式无效`);
  return value;
}

function requiredDigestEnv(name) {
  const value = process.env[name]?.trim();
  if (!value || !HASH_PATTERN.test(value)) throw contractError('CLOUD_DESCRIPTOR_MISSING', `${name} 缺失或格式无效`);
  return value;
}

function record(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw contractError('CLOUD_INPUT_INVALID', `${path} 必须是对象`);
  return value;
}

function cloudServiceScope(service) {
  const serviceRecord = record(service, 'service');
  const scope = record(serviceRecord.scope, 'service.scope');
  const metadata = record(scope.metadata, 'service.scope.metadata');
  return { endpoint: requiredEndpoint(scope.endpoint), metadata };
}

function requiredIdentifier(value, path) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:/-]{1,512}$/.test(value)) throw contractError('CLOUD_INPUT_INVALID', `${path} 缺少固定标识`);
  return value;
}

function requiredSecretRef(value) {
  if (typeof value !== 'string' || !/^secret:\/\/[A-Za-z0-9._:/#-]{1,512}$/.test(value)) throw contractError('CLOUD_INPUT_INVALID', 'SecretRef 格式无效');
  return value;
}

function requiredArtifactRef(value) {
  if (typeof value !== 'string' || !/^artifact:\/\/[A-Za-z0-9._:/#-]{1,512}$/.test(value)) throw contractError('CLOUD_INPUT_INVALID', 'ArtifactRef 格式无效');
  return value;
}

function requiredCredential(value, path) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) throw contractError('CLOUD_CREDENTIAL_INVALID', `${path} 缺失`);
  return value;
}

function requiredPublicCertificate(artifact) {
  if (typeof artifact.certificateChain !== 'string' || artifact.certificateChain.length === 0 || artifact.certificateChain.length > 1024 * 1024) throw contractError('CLOUD_ARTIFACT_INVALID', '证书 Artifact 缺少公钥证书链');
  return artifact.certificateChain;
}

function requiredEndpoint(value) {
  if (typeof value !== 'string' || !/^https:\/\/[^/\s]+$/i.test(value)) throw contractError('CLOUD_SERVICE_INVALID', 'Cloud Service Endpoint 无效');
  return value;
}

function requiredPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.includes('..') || value.length > 2048) throw contractError('CLOUD_INPUT_INVALID', '请求路径无效');
  return value;
}

function requiredMethod(value) {
  if (typeof value !== 'string' || !['GET', 'POST'].includes(value.toUpperCase())) throw contractError('CLOUD_INPUT_INVALID', '请求方法不在固定集合');
  return value.toUpperCase();
}

function sanitizeQuery(value) {
  if (value === undefined) return {};
  const query = record(value, 'request.query');
  const result = {};
  for (const [key, item] of Object.entries(query)) {
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(key) || ['string', 'number', 'boolean'].includes(typeof item) === false) throw contractError('CLOUD_INPUT_INVALID', '请求查询参数无效');
    result[key] = String(item);
  }
  return result;
}

function aliTimestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw contractError('CLOUD_INPUT_INVALID', '请求时间戳无效');
  return new Date(value).toISOString().replace(/\.000Z$/, 'Z');
}

function canonicalQuery(query) {
  return Object.entries(query).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${rfc3986(key)}=${rfc3986(String(value))}`).join('&');
}

function rfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function hmacBase64(algorithm, key, value) {
  return createHmac(algorithm, key).update(value).digest('base64');
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function contractError(code, safeMessage) {
  const error = new Error(safeMessage);
  error.code = code;
  error.safeMessage = safeMessage;
  error.retryable = false;
  error.mayBeUnknown = false;
  return error;
}

function hostError(safeMessage) {
  const error = contractError('CLOUD_HOST_CALL_FAILED', safeMessage);
  error.mayBeUnknown = true;
  error.retryable = true;
  return error;
}

function unknownError(code, safeMessage) {
  const error = contractError(code, safeMessage);
  error.mayBeUnknown = true;
  error.retryable = true;
  return error;
}
