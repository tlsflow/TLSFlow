import { createHmac, createHash } from 'node:crypto';
import type { ProviderScope } from '../dto/providers.dto.js';
import { jsonBody, scopeEndpoint, sha256 } from './provider-runtime.js';

export interface SignedRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export function signAliyunRpc(input: {
  accessKeyId: string;
  accessKeySecret: string;
  action: string;
  version: string;
  params?: Record<string, unknown>;
  scope: ProviderScope;
  endpoint?: string;
  method?: 'GET' | 'POST';
}): SignedRequest {
  const method = input.method ?? 'GET';
  const aliyunParams = normalizeAliyunRpcParams(input.params);
  const params: Record<string, string> = {
    Format: 'JSON',
    Version: input.version,
    AccessKeyId: input.accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: randomNonce(),
    SignatureVersion: '1.0',
    Signature: '',
    Action: input.action,
    ...aliyunParams,
  };
  const canonicalized = Object.keys(params)
    .filter((key) => key !== 'Signature')
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key]!)}`)
    .join('&');
  const stringToSign = `${method}&%2F&${percentEncode(canonicalized)}`;
  params.Signature = createHmac('sha1', `${input.accessKeySecret}&`).update(stringToSign).digest('base64');
  const query = Object.keys(params).sort().map((key) => `${percentEncode(key)}=${percentEncode(params[key]!)}`).join('&');
  return {
    method,
    url: method === 'GET'
      ? `${scopeEndpoint(input.scope, input.endpoint ?? 'https://cdn.aliyuncs.com')}?${query}`
      : scopeEndpoint(input.scope, input.endpoint ?? 'https://cdn.aliyuncs.com'),
    headers: method === 'GET'
      ? { accept: 'application/json' }
      : {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
    ...(method === 'POST' ? { body: query } : {}),
  };
}

function normalizeAliyunRpcParams(input?: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (value === undefined || value === null) continue;
    result[key] = String(value);
  }
  return result;
}

export function signTencentTc3(input: {
  secretId: string;
  secretKey: string;
  service: string;
  action: string;
  version: string;
  region?: string;
  payload?: Record<string, unknown>;
  scope: ProviderScope;
  endpoint?: string;
  now?: Date;
}): SignedRequest {
  const body = jsonBody(input.payload ?? {});
  const timestamp = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const host = new URL(scopeEndpoint(input.scope, input.endpoint ?? `https://${input.service}.tencentcloudapi.com`)).host;
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`;
  const signedHeaders = 'content-type;host';
  const hashedPayload = sha256(body);
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`;
  const credentialScope = `${date}/${input.service}/tc3_request`;
  const hashedCanonicalRequest = sha256(canonicalRequest);
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${hashedCanonicalRequest}`;
  const secretDate = hmac(`TC3${input.secretKey}`, date);
  const secretService = hmac(secretDate, input.service);
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = hmac(secretSigning, stringToSign, 'hex');
  return {
    method: 'POST',
    url: scopeEndpoint(input.scope, input.endpoint ?? `https://${input.service}.tencentcloudapi.com`),
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

export function signHuaweiRequest(input: {
  accessKey: string;
  secretKey: string;
  method: SignedRequest['method'];
  path: string;
  query?: Record<string, string | undefined>;
  payload?: unknown;
  scope: ProviderScope;
  endpoint?: string;
  now?: Date;
}): SignedRequest {
  const body = jsonBody(input.payload ?? {});
  const host = new URL(scopeEndpoint(input.scope, input.endpoint ?? 'https://cdn.myhuaweicloud.com')).host;
  const sdkDate = formatBasicDate(input.now ?? new Date());
  const query = Object.keys(input.query ?? {})
    .filter((key) => input.query?.[key] !== undefined)
    .sort()
    .map((key) => `${key}=${encodeURIComponent(input.query![key]!)}`)
    .join('&');
  const canonicalHeaders = `content-type:application/json\nhost:${host}\n`;
  const signedHeaders = 'content-type;host';
  const canonicalRequest = `${input.method}\n${input.path}\n${query}\n${canonicalHeaders}\n${signedHeaders}\n${sha256(body)}`;
  const stringToSign = `SDK-HMAC-SHA256\n${sdkDate}\n${sha256(canonicalRequest)}`;
  const signature = createHmac('sha256', input.secretKey).update(stringToSign).digest('hex');
  return {
    method: input.method,
    url: `${scopeEndpoint(input.scope, input.endpoint ?? 'https://cdn.myhuaweicloud.com')}${input.path}${query ? `?${query}` : ''}`,
    headers: {
      'content-type': 'application/json',
      host,
      'x-sdk-date': sdkDate,
      authorization: `SDK-HMAC-SHA256 Access=${input.accessKey}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body,
  };
}

export function signVolcengineRequest(input: {
  accessKeyId: string;
  secretAccessKey: string;
  service: string;
  region?: string;
  action: string;
  payload?: Record<string, unknown>;
  scope: ProviderScope;
  endpoint?: string;
  now?: Date;
}): SignedRequest {
  const body = jsonBody(input.payload ?? {});
  const host = new URL(scopeEndpoint(input.scope, input.endpoint ?? `https://${input.service}.volcengineapi.com`)).host;
  const date = input.now ?? new Date();
  const xDate = formatVolcDate(date);
  const credentialScope = `${xDate.slice(0, 8)}/${input.region ?? input.scope.regions?.[0] ?? 'cn-north-1'}/${input.service}/request`;
  const canonicalRequest = `POST\n/\n\ncontent-type:application/json\nhost:${host}\n\ncontent-type;host\n${sha256(body)}`;
  const stringToSign = `HMAC-SHA256\n${xDate}\n${credentialScope}\n${sha256(canonicalRequest)}`;
  const dateKey = hmac(input.secretAccessKey, xDate.slice(0, 8));
  const regionKey = hmac(dateKey, input.region ?? input.scope.regions?.[0] ?? 'cn-north-1');
  const serviceKey = hmac(regionKey, input.service);
  const signature = hmac(hmac(serviceKey, 'request'), stringToSign, 'hex');
  return {
    method: 'POST',
    url: scopeEndpoint(input.scope, input.endpoint ?? `https://${input.service}.volcengineapi.com`),
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

function hmac(key: string | Buffer, value: string): Buffer;
function hmac(key: string | Buffer, value: string, encoding: 'hex'): string;
function hmac(key: string | Buffer, value: string, encoding?: 'hex'): string | Buffer {
  return encoding
    ? createHmac('sha256', key).update(value).digest(encoding)
    : createHmac('sha256', key).update(value).digest();
}

function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function randomNonce(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatBasicDate(value: Date): string {
  const iso = value.toISOString();
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function formatVolcDate(value: Date): string {
  return value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
