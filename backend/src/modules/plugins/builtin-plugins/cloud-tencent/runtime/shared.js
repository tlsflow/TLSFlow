import { createHmac, createHash } from 'node:crypto';

export function providerRuntimeError(message, details = {}) {
  const error = new Error(message);
  error.code = 'PROVIDER_PLUGIN_RUNTIME_ERROR';
  error.details = details;
  return error;
}

export async function resolveRuntimeContext(hostApi, context, providerName) {
  const assetId = readString(context?.assetId);
  if (!assetId) throw providerRuntimeError(`${providerName} 插件缺少云账号资产 ID`);
  const asset = await hostApi.cloudAccount.get(assetId);
  const credential = await hostApi.credential.resolveCloudCredential(assetId);
  return { assetId, asset, credential };
}

export function buildDiscoveryPayload(plugin, asset, providerName, frameworkTypes = []) {
  const supportedProducts = Array.isArray(plugin.supportedProducts) ? plugin.supportedProducts : [];
  const requested = frameworkTypes.length > 0
    ? frameworkTypes.filter((item) => supportedProducts.includes(item))
    : supportedProducts;
  return {
    apiVersion: 'gcac.device-discovery/v2',
    device: {
      stableKey: asset.id,
      displayName: asset.displayName || providerName,
      productFamily: plugin.providerKey,
      managementAddress: asset.scope?.endpoint,
      metadata: {
        providerKey: plugin.providerKey,
        accountId: asset.accountId,
        scope: asset.scope,
      },
    },
    capabilities: (Array.isArray(plugin.supportedOperations) ? plugin.supportedOperations : [])
      .map((key) => ({ key, available: true })),
    frameworks: requested.map((frameworkType) => ({
      stableKey: frameworkType,
      frameworkType,
      displayName: frameworkDisplayName(frameworkType),
      metadata: { providerKey: plugin.providerKey },
    })),
    sites: [],
    managedTargets: [],
    certificates: [],
    certificateBindings: [],
    warnings: [],
  };
}

export async function resolveCertificateInput(hostApi, input) {
  const certificateId = readString(input?.certificateId);
  const certificatePem = readString(input?.certificatePem);
  const privateKeyPem = readString(input?.privateKeyPem);
  const chainPem = readString(input?.chainPem) || readString(input?.certificateChainPem);
  const certificateRef = readString(input?.certificateRef);
  if (certificateId || certificatePem) {
    return { certificateId, certificatePem, privateKeyPem, chainPem };
  }
  if (certificateRef) {
    const material = await hostApi.artifact.readCertificateMaterial(certificateRef);
    return {
      certificateId: undefined,
      certificatePem: material.certificatePem,
      privateKeyPem: material.privateKeyPem,
      chainPem: material.certificateChainPem,
    };
  }
  throw providerRuntimeError('证书部署缺少 certificateId、certificatePem 或 certificateRef');
}

export function ensureTarget(input) {
  const target = readRecord(input?.target) || readRecord(input);
  if (!target) throw providerRuntimeError('插件执行输入缺少 target');
  const frameworkType = readString(target.frameworkType);
  const resourceId = readString(target.resourceId);
  if (!frameworkType || !resourceId) throw providerRuntimeError('target 缺少 frameworkType 或 resourceId');
  return {
    frameworkType,
    resourceId,
    domain: readString(target.domain),
    listenerId: readString(target.listenerId),
    certificateId: readString(target.certificateId),
    metadata: readRecord(target.metadata) || {},
  };
}

export async function saveCheckpoint(hostApi, providerKey, target, previous) {
  const checkpoint = {
    providerKey,
    target,
    previous,
  };
  const saved = await hostApi.checkpoint.save({
    checkpointName: `${providerKey}:${target.frameworkType}:${target.resourceId}`,
    payload: checkpoint,
  });
  return { ...checkpoint, ref: saved.ref };
}

export async function loadCheckpoint(hostApi, input) {
  const direct = readRecord(input?.checkpoint);
  if (direct?.ref) {
    const payload = await hostApi.checkpoint.load(direct.ref);
    return { ...payload, ref: direct.ref };
  }
  if (direct) return direct;
  const rollbackContext = readRecord(input?.rollbackContext);
  const nested = readRecord(rollbackContext?.checkpoint);
  if (nested?.ref) {
    const payload = await hostApi.checkpoint.load(nested.ref);
    return { ...payload, ref: nested.ref };
  }
  if (nested) return nested;
  throw providerRuntimeError('证书回滚缺少 checkpoint');
}

export function buildOperationResult(providerKey, operationKey, status, resultSummary = {}, extras = {}) {
  return {
    operationId: `provider_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    providerKey,
    operationKey,
    status,
    resultSummary,
    ...extras,
  };
}

export async function requestJson(hostApi, request) {
  const response = await hostApi.http.request(request);
  const bodyText = typeof response.body === 'string' ? response.body : '';
  let json;
  try {
    json = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    json = {};
  }
  return { status: response.status, headers: response.headers || {}, bodyText, json: readRecord(json) || {} };
}

export function assertResponse(response, providerKey) {
  if (response.status < 200 || response.status >= 300) {
    throw providerRuntimeError(`${providerKey} API 返回失败`, {
      status: response.status,
      body: response.bodyText,
    });
  }
  return response.json || {};
}

export function scopeEndpoint(scope, fallback) {
  return (readString(scope?.endpoint) || fallback).replace(/\/+$/, '');
}

export function jsonBody(value) {
  return JSON.stringify(value ?? {});
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function signAliyunRpc(input) {
  const method = input.method || 'GET';
  const params = {
    Format: 'JSON',
    Version: input.version,
    AccessKeyId: input.accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    SignatureVersion: '1.0',
    Signature: '',
    Action: input.action,
    ...normalizeAliyunRpcParams(input.params),
  };
  const canonicalized = Object.keys(params)
    .filter((key) => key !== 'Signature')
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join('&');
  const stringToSign = `${method}&%2F&${percentEncode(canonicalized)}`;
  params.Signature = createHmac('sha1', `${input.accessKeySecret}&`).update(stringToSign).digest('base64');
  const query = Object.keys(params).sort().map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`).join('&');
  return {
    method,
    url: method === 'GET' ? `${scopeEndpoint(input.scope, input.endpoint)}?${query}` : scopeEndpoint(input.scope, input.endpoint),
    headers: method === 'GET'
      ? { accept: 'application/json' }
      : { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    ...(method === 'POST' ? { body: query } : {}),
  };
}

export function signTencentTc3(input) {
  const body = jsonBody(input.payload || {});
  const timestamp = Math.floor((input.now || new Date()).getTime() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const host = new URL(scopeEndpoint(input.scope, input.endpoint)).host;
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`;
  const signedHeaders = 'content-type;host';
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256(body)}`;
  const credentialScope = `${date}/${input.service}/tc3_request`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${sha256(canonicalRequest)}`;
  const secretDate = hmac(`TC3${input.secretKey}`, date);
  const secretService = hmac(secretDate, input.service);
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = hmac(secretSigning, stringToSign, 'hex');
  return {
    method: 'POST',
    url: scopeEndpoint(input.scope, input.endpoint),
    headers: {
      'content-type': 'application/json; charset=utf-8',
      host,
      'x-tc-action': input.action,
      'x-tc-version': input.version,
      ...(input.region ? { 'x-tc-region': input.region } : {}),
      'x-tc-timestamp': String(timestamp),
      authorization: `TC3-HMAC-SHA256 Credential=${input.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body,
  };
}

export function signHuaweiRequest(input) {
  const body = jsonBody(input.payload || {});
  const host = new URL(scopeEndpoint(input.scope, input.endpoint)).host;
  const sdkDate = (input.now || new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const query = Object.keys(input.query || {})
    .filter((key) => input.query[key] !== undefined)
    .sort()
    .map((key) => `${key}=${encodeURIComponent(input.query[key])}`)
    .join('&');
  const canonicalHeaders = `content-type:application/json\nhost:${host}\n`;
  const signedHeaders = 'content-type;host';
  const canonicalRequest = `${input.method}\n${input.path}\n${query}\n${canonicalHeaders}\n${signedHeaders}\n${sha256(body)}`;
  const stringToSign = `SDK-HMAC-SHA256\n${sdkDate}\n${sha256(canonicalRequest)}`;
  const signature = createHmac('sha256', input.secretKey).update(stringToSign).digest('hex');
  return {
    method: input.method,
    url: `${scopeEndpoint(input.scope, input.endpoint)}${input.path}${query ? `?${query}` : ''}`,
    headers: {
      'content-type': 'application/json',
      host,
      'x-sdk-date': sdkDate,
      authorization: `SDK-HMAC-SHA256 Access=${input.accessKey}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body,
  };
}

export function signVolcengineRequest(input) {
  const body = jsonBody(input.payload || {});
  const host = new URL(scopeEndpoint(input.scope, input.endpoint)).host;
  const xDate = (input.now || new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const region = input.region || input.scope?.regions?.[0] || 'cn-north-1';
  const credentialScope = `${xDate.slice(0, 8)}/${region}/${input.service}/request`;
  const canonicalRequest = `POST\n/\n\ncontent-type:application/json\nhost:${host}\n\ncontent-type;host\n${sha256(body)}`;
  const stringToSign = `HMAC-SHA256\n${xDate}\n${credentialScope}\n${sha256(canonicalRequest)}`;
  const dateKey = hmac(input.secretAccessKey, xDate.slice(0, 8));
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, input.service);
  const signature = hmac(hmac(serviceKey, 'request'), stringToSign, 'hex');
  return {
    method: 'POST',
    url: scopeEndpoint(input.scope, input.endpoint),
    headers: {
      'content-type': 'application/json',
      host,
      'x-date': xDate,
      'x-action': input.action,
      authorization: `HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}, SignedHeaders=content-type;host, Signature=${signature}`,
    },
    body,
  };
}

export function frameworkDisplayName(frameworkType) {
  const token = frameworkType.split('.').at(-1) || frameworkType;
  return {
    cdn: 'CDN',
    alb: 'ALB',
    clb: 'CLB',
    oss: 'OSS',
    live: 'Live',
    vod: 'VOD',
    elb: 'ELB',
    'waf-cname': 'WAF CNAME',
    'waf-cloud': 'WAF Cloud',
  }[token] || token.toUpperCase();
}

export function readRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

export function readString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function firstString(value, keys) {
  const record = readRecord(value) || {};
  for (const key of keys) {
    const candidate = readString(record[key]);
    if (candidate) return candidate;
  }
  return undefined;
}

export function toRecordArray(value) {
  return Array.isArray(value) ? value.filter((item) => Boolean(readRecord(item))) : [];
}

function normalizeAliyunRpcParams(input = {}) {
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    result[key] = String(value);
  }
  return result;
}

function percentEncode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function hmac(key, value, encoding) {
  return encoding
    ? createHmac('sha256', key).update(value).digest(encoding)
    : createHmac('sha256', key).update(value).digest();
}
