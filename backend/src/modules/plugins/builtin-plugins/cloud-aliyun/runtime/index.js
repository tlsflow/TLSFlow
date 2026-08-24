import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const runtimeDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(runtimeDirectory, '..');
const packageManifest = JSON.parse(readPackageResource('manifest.json'));
const PLUGIN_ID = packageManifest.pluginId;
const PLUGIN_VERSION = packageManifest.version;
const PROVIDER = 'cloud.aliyun';
const SIGNATURE_ALGORITHM = 'ALIYUN-RPC-HMAC-SHA1';
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
    const credential = resolveCredential(input.credential);
    const service = await hostCloudServiceGet(hostApi, { cloudServiceRef: requiredIdentifier(input.cloudServiceRef, 'cloudServiceRef') }, grantRefs);
    const requestInput = record(input.request, 'input.request');
    const responses = [];
    for (const requestItem of normalizeRequestInputs(requestInput)) {
      const body = requestItem.body === undefined ? {} : requestItem.body;
      const request = await signRequest(hostApi, service, credential, requestItem, body, idempotencyKey, operation, grantId, grantRefs);
      responses.push(await hostHttpRequest(hostApi, request, grantRefs));
    }
    return operation === 'connection-test'
      ? readResult(operation, responses[0])
      : discoverResult(responses, descriptor);
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
  const body = responseBody(response);
  if (code < 200 || code >= 300 || typeof body.Code === 'string' || typeof body.code === 'string') {
    const vendorCode = typeof body.Code === 'string' ? body.Code : typeof body.code === 'string' ? body.code : '';
    const vendorMessage = typeof body.Message === 'string' ? body.Message : typeof body.message === 'string' ? body.message : '';
    const detail = vendorCode ? `：${vendorCode}${vendorMessage ? ` ${vendorMessage}` : ''}` : '';
    throw contractError('CLOUD_READ_FAILED', `云厂商只读请求失败${detail}`);
  }
  return successResult({ provider: PROVIDER, operation, signatureAlgorithm: SIGNATURE_ALGORITHM, signatureVerified: response.signatureVerified === true, status: 'SUCCEEDED' });
}

function discoverResult(responses, descriptor) {
  if (!Array.isArray(responses) || responses.length === 0 || responses.some((response) => statusCode(response) < 200 || statusCode(response) >= 300)) throw contractError('CLOUD_DISCOVERY_FAILED', '云厂商发现请求失败');
  const outputResources = normalizeDiscoveryResponse(responses.map(responseBody), descriptor);
  return successResult({ provider: PROVIDER, operation: 'discover', signatureAlgorithm: SIGNATURE_ALGORITHM, signatureVerified: responses.every((response) => response.signatureVerified === true), status: 'SUCCEEDED', resources: outputResources });
}

export function normalizeDiscoveryResponse(body, descriptor) {
  const bodies = Array.isArray(body) ? body : [body];
  const resources = bodies.flatMap((item) => Array.isArray(item?.resources)
    ? item.resources.map((resource) => ({ source: resource, shape: 'normalized' }))
    : aliyunDomainItems(item).map((resource) => ({ source: resource, shape: 'aliyun-cdn' })));
  return normalizeDiscoveryResources(resources, descriptor);
}

export function normalizeDiscoveryResources(resources, descriptor) {
  return resources.map(({ source, shape }, index) => {
    const resource = record(source, `resources.${index}`);
    const resourceId = shape === 'aliyun-cdn'
      ? requiredIdentifier(resource.DomainName, `Domains.Domain.${index}.DomainName`)
      : requiredIdentifier(resource.id, `resources.${index}.id`);
    const resourceType = shape === 'aliyun-cdn'
      ? 'cdn.domain'
      : requiredIdentifier(resource.type, `resources.${index}.type`);
    const cdnScope = resourceType === 'cdn.domain' ? normalizeCdnScope(resource, shape) : undefined;
    const region = cdnScope?.key ?? requiredIdentifier(resource.region, `resources.${index}.region`);
    const displayName = shape === 'aliyun-cdn' ? resource.DomainName : resource.displayName;
    const metadata = shape === 'aliyun-cdn'
      ? compactMetadata({
        domainName: resource.DomainName,
        status: resource.DomainStatus ?? resource.Status,
        cname: resource.Cname,
        gmtCreated: resource.GmtCreated,
        gmtModified: resource.GmtModified,
        cdnRegion: cdnScope?.key,
        cdnRegionName: cdnScope?.name,
        cdnRegionSource: cdnScope?.source,
      })
      : compactMetadata({
        ...(resource.metadata ?? {}),
        ...(cdnScope ? { cdnRegion: cdnScope.key, cdnRegionName: cdnScope.name, cdnRegionSource: cdnScope.source } : {}),
      });
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
      ...(typeof displayName === 'string' && displayName.trim() ? { displayName: displayName.trim() } : {}),
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    };
  });
}

function aliyunDomainItems(body) {
  const domains = body?.Domains;
  if (Array.isArray(domains?.PageData)) return domains.PageData;
  return Array.isArray(domains?.Domain) ? domains.Domain : [];
}

function normalizeCdnScope(resource, shape) {
  const metadata = shape === 'aliyun-cdn' ? resource : record(resource.metadata ?? {}, 'resources.metadata');
  const rawValue = firstString(
    shape === 'aliyun-cdn' ? resource.Scope : undefined,
    shape === 'aliyun-cdn' ? resource.DomainScope : undefined,
    shape === 'aliyun-cdn' ? resource.Coverage : undefined,
    metadata.cdnRegion,
    metadata.scope,
    metadata.Scope,
    shape === 'aliyun-cdn' ? resource.Region : resource.region,
  );
  const normalized = rawValue.toLocaleLowerCase().replaceAll('_', '-').replaceAll(' ', '');
  if (/(domestic|mainland|china|中国大陆|中国境内|^cn-)/i.test(normalized)) {
    return { key: 'mainland', name: '中国大陆', source: rawValue ? 'PROVIDER' : 'INFERRED' };
  }
  return { key: 'global', name: '全球', source: rawValue ? 'PROVIDER_OR_INFERRED' : 'DEFAULT' };
}

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() ?? '';
}

function compactMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
}

async function signRequest(hostApi, service, secretRefs, requestInput, body, idempotencyKey, operation, grantId, grantRefs) {
  const { endpoint: serviceEndpoint } = cloudServiceScope(service);
  const endpoint = requestInput.endpoint === undefined ? serviceEndpoint : requiredEndpoint(requestInput.endpoint);
  const url = new URL(requiredPath(requestInput.uri), endpoint);
  const method = requiredMethod(requestInput.method ?? 'POST');
  const action = requiredIdentifier(requestInput.action ?? operation, 'request.action');
  const timestamp = aliTimestamp(requestInput.timestamp ?? new Date().toISOString());
  const query = sanitizeQuery(requestInput.query);
  const bodyText = stableJson(body);
  const publicValuePlaceholder = '__GCAC_ALIYUN_ACCESS_KEY_ID__';
  const params = {
    Action: action,
    AccessKeyId: publicValuePlaceholder,
    Format: 'JSON',
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: idempotencyKey,
    SignatureVersion: '1.0',
    // 中文说明：阿里云 RPC 公共参数名称是 Timestamp，不能使用签名算法自定义字段。
    Timestamp: timestamp,
    Version: requiredIdentifier(requestInput.apiVersion ?? '2018-05-10', 'request.apiVersion'),
    ...query,
  };
  const unsigned = canonicalQuery(params);
  const stringToSign = `${method}&%2F&${rfc3986(unsigned)}`;
  const signature = await hostCryptoHmac(hostApi, {
    grantId,
    secretRef: requiredSecretRef(secretRefs.accessKeySecret),
    publicValueRef: requiredSecretRef(secretRefs.accessKeyId),
    publicValuePlaceholder,
    data: stringToSign,
    hashAlgorithm: 'SHA-1',
    keySuffix: '&',
  }, grantRefs);
  params.AccessKeyId = requiredCredential(signature.publicValue, 'publicValue');
  params.Signature = requiredCredential(signature.signatureBase64, 'signatureBase64');
  const signedQuery = canonicalQuery(params);
  return { provider: PLUGIN_ID, algorithm: SIGNATURE_ALGORITHM, method, url: `${endpoint.replace(/\/$/, '')}/?${signedQuery}`, path: '/', operationPath: url.pathname, query: params, headers: { host: url.host, 'content-type': 'application/json', 'x-gcac-request-nonce': idempotencyKey }, signedHeaders: ['content-type', 'host'], body: bodyText };
}

function normalizeRequestInputs(requestInput) {
  if (!Array.isArray(requestInput.requests) || requestInput.requests.length === 0) return [requestInput];
  return requestInput.requests.map((item, index) => record(item, `input.request.requests.${index}`));
}

async function hostData(hostApi, invoke) {
  if (!hostApi || typeof hostApi.call !== 'function') throw hostError('Host API 不可用');
  let result;
  try { result = await invoke(); } catch { throw hostError('Cloud Host API 调用失败'); }
  if (!result || result.ok !== true || !result.data || typeof result.data !== 'object' || Array.isArray(result.data)) throw hostError('Cloud Host API 返回无效结果');
  return result.data;
}

function hostCloudServiceGet(hostApi, input, grantRefs) { return hostData(hostApi, () => hostApi.call('cloudService.get', input, grantRefs)); }
function hostCryptoHmac(hostApi, input, grantRefs) { return hostData(hostApi, () => hostApi.call('crypto.hmac', input, grantRefs)); }
function hostHttpRequest(hostApi, input, grantRefs) {
  // 中文说明：签名阶段可以保留厂商诊断字段，但 Host API 只接收固定的 HTTP 合同字段。
  const request = {
    url: input.url,
    method: input.method,
    headers: input.headers,
    ...(input.body !== undefined ? { body: input.body } : {}),
  };
  return hostData(hostApi, () => hostApi.call('http.request', request, grantRefs));
}

function resolveCredential(value) {
  const credential = record(value, 'input.credential');
  if (credential.secretRefs !== undefined) {
    const refs = record(credential.secretRefs, 'input.credential.secretRefs');
    return {
      accessKeyId: requiredSecretRef(refs.accessKeyId),
      accessKeySecret: requiredSecretRef(refs.accessKeySecret),
    };
  }
  const legacyRef = requiredSecretRef(credential.secretRef);
  return { accessKeyId: legacyRef, accessKeySecret: legacyRef };
}

function successResult(output) { return { success: true, status: 'SUCCESS', output, warnings: [] }; }
function failureResult(error) { const item = error && typeof error === 'object' ? error : {}; const code = typeof item.code === 'string' ? item.code : 'CLOUD_PLUGIN_FAILED'; return { success: false, status: 'FAILED', output: {}, warnings: [], error: { code, message: typeof item.safeMessage === 'string' ? item.safeMessage : 'Cloud 插件执行失败', retryable: item.retryable === true, mayBeUnknown: false, secretRedacted: true } }; }
function responseBody(response) { if (!response || typeof response !== 'object') return {}; if (response.body && typeof response.body === 'object' && !Array.isArray(response.body)) return response.body; if (typeof response.body === 'string') { try { return JSON.parse(response.body); } catch { return {}; } } return {}; }
function statusCode(response) { return typeof response?.statusCode === 'number' && Number.isInteger(response.statusCode) ? response.statusCode : 0; }
function requiredDescriptorEnv(name) { const value = process.env[name]?.trim(); if (!value || !/^[A-Za-z0-9._:-]{1,256}$/.test(value)) throw contractError('CLOUD_DESCRIPTOR_MISSING', `${name} 缺失或格式无效`); return value; }
function requiredDigestEnv(name) { const value = process.env[name]?.trim(); if (!value || !HASH_PATTERN.test(value)) throw contractError('CLOUD_DESCRIPTOR_MISSING', `${name} 缺失或格式无效`); return value; }
function record(value, path) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw contractError('CLOUD_INPUT_INVALID', `${path} 必须是对象`); return value; }
function cloudServiceScope(service) { const serviceRecord = record(service, 'service'); const scope = record(serviceRecord.scope, 'service.scope'); return { endpoint: requiredEndpoint(scope.endpoint ?? 'https://cdn.aliyuncs.com') }; }
function requiredIdentifier(value, path) { if (typeof value !== 'string' || !/^[A-Za-z0-9._:/-]{1,512}$/.test(value)) throw contractError('CLOUD_INPUT_INVALID', `${path} 缺少固定标识`); return value; }
function requiredGrantRef(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(value)) throw contractError('CLOUD_CONTRACT_DENIED', 'Cloud Action Grant 格式无效'); return value; }
function requiredIdempotencyKey(value) { if (typeof value !== 'string' || value.trim().length === 0 || value.length > 512) throw contractError('CLOUD_CONTRACT_DENIED', 'Cloud Action 幂等键无效'); return value; }
function requiredSecretRef(value) { if (typeof value !== 'string' || !/^secret:\/\/[A-Za-z0-9._:/#-]{1,512}$/.test(value)) throw contractError('CLOUD_INPUT_INVALID', 'SecretRef 格式无效'); return value; }
function requiredCredential(value, path) { if (typeof value !== 'string' || value.length === 0 || value.length > 512) throw contractError('CLOUD_CREDENTIAL_INVALID', `${path} 缺失`); return value; }
function requiredEndpoint(value) { if (typeof value !== 'string' || !/^https:\/\/[^/\s]+$/i.test(value)) throw contractError('CLOUD_SERVICE_INVALID', 'Cloud Service Endpoint 无效'); return value; }
function requiredPath(value) { if (typeof value !== 'string' || !value.startsWith('/') || value.includes('..') || value.length > 2048) throw contractError('CLOUD_INPUT_INVALID', '请求路径无效'); return value; }
function requiredMethod(value) { if (typeof value !== 'string' || !['GET', 'POST'].includes(value.toUpperCase())) throw contractError('CLOUD_INPUT_INVALID', '请求方法不在固定集合'); return value.toUpperCase(); }
function sanitizeQuery(value) { if (value === undefined) return {}; const query = record(value, 'request.query'); const result = {}; for (const [key, item] of Object.entries(query)) { if (!/^[A-Za-z0-9_.-]{1,128}$/.test(key) || !['string', 'number', 'boolean'].includes(typeof item)) throw contractError('CLOUD_INPUT_INVALID', '请求查询参数无效'); result[key] = String(item); } return result; }
function aliTimestamp(value) { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw contractError('CLOUD_INPUT_INVALID', '请求时间戳无效'); return new Date(value).toISOString().replace(/\.000Z$/, 'Z'); }
function canonicalQuery(query) { return Object.entries(query).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${rfc3986(key)}=${rfc3986(String(value))}`).join('&'); }
function rfc3986(value) { return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`); }
function stableJson(value) { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`; return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`; }
function schemaHash(schema) { return `sha256:${createHash('sha256').update(stableJson(schema)).digest('hex')}`; }
function contractError(code, safeMessage) { const error = new Error(safeMessage); error.code = code; error.safeMessage = safeMessage; error.retryable = false; error.mayBeUnknown = false; return error; }
function hostError(safeMessage) { const error = contractError('CLOUD_HOST_CALL_FAILED', safeMessage); error.retryable = true; return error; }
