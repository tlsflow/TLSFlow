import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const runtimeDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(runtimeDirectory, '..');
const packageManifest = JSON.parse(readPackageResource('manifest.json'));
const PLUGIN_ID = packageManifest.pluginId;
const PLUGIN_VERSION = packageManifest.version;
const PROVIDER = 'volcengine';
const SIGNATURE_ALGORITHM = 'VOLCENGINE-V4-HMAC-SHA256';
const CAPABILITIES = Object.freeze(packageManifest.capabilities.map((item) => item.key));
const PERMISSIONS = Object.freeze([...packageManifest.permissions]);
const OPERATION_BY_CAPABILITY = Object.freeze({ 'cloud.service.connection-test': 'connection-test', 'cloud.service.discover': 'discover' });
const IDENTIFICATION_CAPABILITIES = new Set(['cloud.service.connection-test', 'cloud.service.discover']);
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

function readPackageResource(resourcePath) {
  const normalized = String(resourcePath).replaceAll('\\', '/');
  const absolute = resolve(packageDirectory, normalized);
  const relativePath = relative(packageDirectory, absolute).replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes(String.fromCharCode(0)) || relativePath === '..' || relativePath.startsWith('../')) throw new Error('插件包资源路径越界');
  return readFileSync(join(packageDirectory, relativePath), 'utf8');
}

function actionDescriptors(resourceHash) {
  const contracts = packageManifest.resources?.actionContracts;
  if (!contracts || typeof contracts !== 'object' || Array.isArray(contracts)) throw contractError('CLOUD_DESCRIPTOR_MISSING', 'Cloud 插件缺少 Action Contract 资源声明');
  const actions = Object.entries(contracts).flatMap(([actionId, resourcePath]) => {
    let contract;
    try { contract = JSON.parse(readPackageResource(String(resourcePath))); } catch { throw contractError('CLOUD_DESCRIPTOR_MISSING', `Action Contract 资源无效：${actionId}`); }
    if (!contract || typeof contract !== 'object' || Array.isArray(contract) || contract.apiVersion !== 'gcac.plugin-action-contract/v1' || contract.actionId !== actionId || !CAPABILITIES.includes(contract.capability) || contract.actionContractVersion !== 'v1' || !contract.inputSchema || !contract.outputSchema) throw contractError('CLOUD_DESCRIPTOR_MISSING', `Action Contract 内容无效：${actionId}`);
    if (!IDENTIFICATION_CAPABILITIES.has(contract.capability)) return [];
    return [Object.freeze({ actionId, capability: contract.capability, actionContractVersion: contract.actionContractVersion, inputSchemaSha256: schemaHash(contract.inputSchema), outputSchemaSha256: schemaHash(contract.outputSchema), resourceHash })];
  });
  if (actions.length === 0) throw contractError('CLOUD_DESCRIPTOR_MISSING', 'Cloud 插件没有可执行 Action Contract');
  return Object.freeze(actions);
}

export function createPluginRunnerExecutor() {
  const resourceHash = requiredDigestEnv('GCAC_PLUGIN_RESOURCE_HASH');
  const descriptor = Object.freeze({
    pluginVersionId: requiredDescriptorEnv('GCAC_PLUGIN_VERSION_ID'),
    pluginId: PLUGIN_ID,
    pluginVersion: PLUGIN_VERSION,
    capabilities: CAPABILITIES,
    actions: actionDescriptors(resourceHash),
    permissions: PERMISSIONS,
    packageHash: requiredDigestEnv('GCAC_PLUGIN_PACKAGE_HASH'),
    resourceHash,
    manifestHash: requiredDigestEnv('GCAC_PLUGIN_MANIFEST_HASH'),
  });
  return Object.freeze({ descriptor, execute: (context, hostApi) => execute(context, hostApi, descriptor) });
}

async function execute(context, hostApi, descriptor) {
  const operation = OPERATION_BY_CAPABILITY[context?.capability];
  try {
    if (!IDENTIFICATION_CAPABILITIES.has(context?.capability)) throw contractError('PLUGIN_RUNNER_SCOPE_FORBIDDEN', '证书生命周期必须由普通 DSL 执行，Cloud Runner 只负责服务识别');
    assertContext(context, descriptor, operation);
    const input = record(context.input, 'input');
    const grantRefs = [...context.grantRefs];
    const grantId = requiredGrantRef(grantRefs[0]);
    const idempotencyKey = requiredIdempotencyKey(context.idempotencyKey);
    const credential = record(input.credential, 'input.credential');
    const service = await hostCloudServiceGet(hostApi, { cloudServiceRef: requiredIdentifier(input.cloudServiceRef, 'cloudServiceRef') }, grantRefs);
    const secret = await hostSecretResolve(hostApi, { grantId, secretRef: requiredSecretRef(credential.secretRef), purpose: `cloud.${operation}` }, grantRefs);
    const requestInput = record(input.request, 'input.request');
    const body = requestInput.body === undefined ? {} : requestInput.body;
    const request = signRequest(service, secret, requestInput, body, idempotencyKey);
    const response = await hostHttpRequest(hostApi, request, grantRefs);
    return operation === 'connection-test'
      ? readResult(operation, response)
      : discoverResult(response, descriptor);
  } catch (error) {
    return failureResult(error);
  }
}

function assertContext(context, descriptor, operation) {
  if (!context || typeof context !== 'object') throw contractError('CLOUD_CONTRACT_DENIED', '执行上下文缺失');
  if (context.pluginVersionId !== descriptor.pluginVersionId || context.pluginId !== descriptor.pluginId || context.pluginVersion !== descriptor.pluginVersion) throw contractError('CLOUD_CONTRACT_DENIED', '执行上下文身份未绑定到固定 PluginVersion');
  if (!IDENTIFICATION_CAPABILITIES.has(context.capability)) throw contractError('PLUGIN_RUNNER_SCOPE_FORBIDDEN', '证书生命周期必须由普通 DSL 执行，Cloud Runner 只负责服务识别');
  if (!operation) throw contractError('CLOUD_CONTRACT_DENIED', 'Capability 未绑定到 Cloud 插件');
  if (!Array.isArray(context.grantRefs) || context.grantRefs.length === 0) throw contractError('CLOUD_CONTRACT_DENIED', 'Cloud 插件执行缺少 Grant');
  if (context.actionId !== `${context.capability}.v1` || context.actionContractVersion !== 'v1') throw contractError('CLOUD_CONTRACT_DENIED', 'Cloud Action 身份未绑定到固定合同');
  if (context.writeEffect !== false) throw contractError('CLOUD_CONTRACT_DENIED', 'Cloud 识别 Action 必须为只读');
  for (const key of ['packageHash', 'manifestHash', 'resourceHash']) if (context[key] !== descriptor[key]) throw contractError('CLOUD_CONTRACT_DENIED', '执行绑定摘要与固定 PluginVersion 不一致');
}

function readResult(operation, response) {
  const code = statusCode(response);
  if (code < 200 || code >= 300) throw contractError('CLOUD_READ_FAILED', '云厂商只读请求失败');
  return successResult({ provider: PROVIDER, operation, signatureAlgorithm: SIGNATURE_ALGORITHM, signatureVerified: response.signatureVerified === true, status: 'SUCCEEDED' });
}

function discoverResult(response, descriptor) {
  const code = statusCode(response);
  if (code < 200 || code >= 300) throw contractError('CLOUD_DISCOVERY_FAILED', '云厂商发现请求失败');
  const resources = Array.isArray(responseBody(response).resources) ? responseBody(response).resources : [];
  const outputResources = resources.map((item, index) => {
    const resource = record(item, `resources.${index}`);
    const resourceId = requiredIdentifier(resource.id, `resources.${index}.id`);
    const resourceType = requiredIdentifier(resource.type, `resources.${index}.type`);
    const region = requiredIdentifier(resource.region, `resources.${index}.region`);
    return { apiVersion: 'gcac.cloud-service/v1', kind: 'CloudServiceResource', stableKey: `${descriptor.pluginId}:${resourceType}:${resourceId}`, pluginId: descriptor.pluginId, pluginVersionId: descriptor.pluginVersionId, provider: PROVIDER, resourceId, resourceType, region };
  });
  return successResult({ provider: PROVIDER, operation: 'discover', signatureAlgorithm: SIGNATURE_ALGORITHM, signatureVerified: response.signatureVerified === true, status: 'SUCCEEDED', resources: outputResources });
}

function signRequest(service, secret, requestInput, body, idempotencyKey) {
  const { endpoint, metadata } = cloudServiceScope(service);
  const url = new URL(requiredPath(requestInput.uri), endpoint);
  const method = requiredMethod(requestInput.method ?? 'POST');
  const serviceName = requiredIdentifier(metadata.serviceName, 'service.scope.metadata.serviceName');
  const region = requiredIdentifier(metadata.region, 'service.scope.metadata.region');
  const time = volcTimestamp(requestInput.timestamp ?? new Date().toISOString());
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
  return { provider: PLUGIN_ID, algorithm: SIGNATURE_ALGORITHM, method, url: `${endpoint.replace(/\/$/, '')}${url.pathname}${query ? `?${query}` : ''}`, path: url.pathname, query: queryObject, headers: { authorization, host: url.host, 'content-type': 'application/json', 'x-date': time.compact, 'x-gcac-request-nonce': idempotencyKey }, signedHeaders: signedHeaders.split(';'), body: bodyText };
}

async function hostData(hostApi, invoke) {
  if (!hostApi || typeof hostApi.call !== 'function') throw hostError('Host API 不可用');
  let result;
  try { result = await invoke(); } catch { throw hostError('Cloud Host API 调用失败'); }
  if (!result || result.ok !== true || !result.data || typeof result.data !== 'object' || Array.isArray(result.data)) throw hostError('Cloud Host API 返回无效结果');
  return result.data;
}

function hostCloudServiceGet(hostApi, input, grantRefs) { return hostData(hostApi, () => hostApi.call('cloudService.get', input, grantRefs)); }
function hostSecretResolve(hostApi, input, grantRefs) { return hostData(hostApi, () => hostApi.call('secret.grant.resolve', input, grantRefs)); }
function hostHttpRequest(hostApi, input, grantRefs) { return hostData(hostApi, () => hostApi.call('http.request', input, grantRefs)); }

function successResult(output) { return { success: true, status: 'SUCCESS', output, warnings: [] }; }
function failureResult(error) { const item = error && typeof error === 'object' ? error : {}; const code = typeof item.code === 'string' ? item.code : 'CLOUD_PLUGIN_FAILED'; return { success: false, status: 'FAILED', output: {}, warnings: [], error: { code, message: typeof item.safeMessage === 'string' ? item.safeMessage : 'Cloud 插件执行失败', retryable: item.retryable === true, mayBeUnknown: false, secretRedacted: true } }; }
function responseBody(response) { if (!response || typeof response !== 'object') return {}; if (response.body && typeof response.body === 'object' && !Array.isArray(response.body)) return response.body; if (typeof response.body === 'string') { try { return JSON.parse(response.body); } catch { return {}; } } return {}; }
function statusCode(response) { return typeof response?.statusCode === 'number' && Number.isInteger(response.statusCode) ? response.statusCode : 0; }
function requiredDescriptorEnv(name) { const value = process.env[name]?.trim(); if (!value || !/^[A-Za-z0-9._:-]{1,256}$/.test(value)) throw contractError('CLOUD_DESCRIPTOR_MISSING', `${name} 缺失或格式无效`); return value; }
function requiredDigestEnv(name) { const value = process.env[name]?.trim(); if (!value || !HASH_PATTERN.test(value)) throw contractError('CLOUD_DESCRIPTOR_MISSING', `${name} 缺失或格式无效`); return value; }
function record(value, path) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw contractError('CLOUD_INPUT_INVALID', `${path} 必须是对象`); return value; }
function cloudServiceScope(service) { const serviceRecord = record(service, 'service'); const scope = record(serviceRecord.scope, 'service.scope'); const metadata = record(scope.metadata, 'service.scope.metadata'); return { endpoint: requiredEndpoint(scope.endpoint), metadata }; }
function requiredIdentifier(value, path) { if (typeof value !== 'string' || !/^[A-Za-z0-9._:/-]{1,512}$/.test(value)) throw contractError('CLOUD_INPUT_INVALID', `${path} 缺少固定标识`); return value; }
function requiredGrantRef(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(value)) throw contractError('CLOUD_CONTRACT_DENIED', 'Cloud Action Grant 格式无效'); return value; }
function requiredIdempotencyKey(value) { if (typeof value !== 'string' || value.trim().length === 0 || value.length > 512) throw contractError('CLOUD_CONTRACT_DENIED', 'Cloud Action 幂等键无效'); return value; }
function requiredSecretRef(value) { if (typeof value !== 'string' || !/^secret:\/\/[A-Za-z0-9._:/#-]{1,512}$/.test(value)) throw contractError('CLOUD_INPUT_INVALID', 'SecretRef 格式无效'); return value; }
function requiredCredential(value, path) { if (typeof value !== 'string' || value.length === 0 || value.length > 512) throw contractError('CLOUD_CREDENTIAL_INVALID', `${path} 缺失`); return value; }
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
function schemaHash(schema) { return `sha256:${createHash('sha256').update(stableJson(schema)).digest('hex')}`; }
function contractError(code, safeMessage) { const error = new Error(safeMessage); error.code = code; error.safeMessage = safeMessage; error.retryable = false; error.mayBeUnknown = false; return error; }
function hostError(safeMessage) { const error = contractError('CLOUD_HOST_CALL_FAILED', safeMessage); error.retryable = true; return error; }
