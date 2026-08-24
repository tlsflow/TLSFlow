import { Buffer } from 'node:buffer';
import { setTimeout as delay } from 'node:timers/promises';
import { AppError } from '../../../common/errors/app-error.js';
import type { Executor, StepExecutionInput, StepExecutionResult } from '../../executions/application/executors.js';
import { NodeCurlHttpClient, type CurlHttpClient } from './curl.http-client.js';
import type { CurlSecretResolver, CurlSecretResolverContext } from './curl.secret-resolver.js';

export interface HttpSecretValue {
  value?: string;
  username?: string;
  password?: string;
  token?: string;
  apiKey?: string;
  cookie?: string;
  cert?: string;
  key?: string;
}

export interface HttpRequestTemplate {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, Primitive>;
  headers?: Record<string, string>;
  headerRefs?: Record<string, string>;
  bodyType?: 'json' | 'form' | 'multipart' | 'raw' | 'none';
  body?: unknown;
  form?: Record<string, Primitive>;
  multipart?: Record<string, MultipartValue>;
  bodySecretRef?: string;
  auth?: HttpAuthConfig;
  timeoutMs?: number;
  maxResponseBytes?: number;
  tls?: { verify?: boolean; caSecretRef?: string; clientCertSecretRef?: string; clientKeySecretRef?: string; sni?: string; allowInsecure?: boolean };
}

export type HttpAuthConfig =
  | { type: 'none' }
  | { type: 'basic'; secretRef: string }
  | { type: 'bearer'; secretRef: string }
  | { type: 'api_key'; secretRef: string; in?: 'header' | 'query'; name: string }
  | { type: 'cookie'; secretRef: string; name?: string }
  | { type: 'custom_header'; secretRef: string; headerName: string }
  | { type: 'mtls'; certSecretRef: string; keySecretRef: string };

export interface MultipartValue {
  value?: Primitive;
  contentType?: string;
  filename?: string;
  secretRef?: string;
}

export interface HttpRetryPolicy {
  maxAttempts?: number;
  backoff?: 'fixed' | 'exponential';
  intervalMs?: number;
  retryOnStatus?: number[];
  retryOnNetworkError?: boolean;
}

export interface HttpResponsePolicy {
  successStatusCodes?: number[];
  assertions?: HttpAssertion[];
  failOnNon2xx?: boolean;
}

export type HttpAssertion =
  | { type: 'status'; equals: number }
  | { type: 'header_exists'; name: string }
  | { type: 'body_contains'; text: string };

export interface HttpExtractor {
  name: string;
  source: 'header' | 'body' | 'json' | 'status';
  path?: string;
  pattern?: string;
  header?: string;
  required?: boolean;
  secret?: boolean;
}

export interface CurlExecutionRequest {
  idempotencyKey: string;
  template: HttpRequestTemplate;
  responsePolicy?: HttpResponsePolicy;
  extractors?: HttpExtractor[];
  variables?: Record<string, string | number | boolean>;
  secrets?: Record<string, string | HttpSecretValue>;
  retryPolicy?: HttpRetryPolicy;
  dryRun?: boolean;
  mockResponse?: HttpResponse;
}

export interface HttpResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body?: unknown;
  bodyText?: string;
  bodyJson?: unknown;
}

export interface CurlExecutionResult {
  success: boolean;
  rendered: { method: string; url: string; headerNames: string[]; hasBody: boolean; bodyType: string; timeoutMs: number; tlsVerify: boolean };
  statusCode?: number;
  headers?: Record<string, string>;
  bodyText?: string;
  bodyJson?: unknown;
  responseBytes?: number;
  attempts: number;
  retryable?: boolean;
  errorCode?: string;
  errorMessage?: string;
  assertions: Array<{ type: string; passed: boolean; message: string }>;
  extracted: Record<string, unknown>;
  logs: string[];
}

type Primitive = string | number | boolean;

interface PreparedRequest {
  rendered: CurlExecutionResult['rendered'];
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Buffer;
  timeoutMs: number;
  maxResponseBytes: number;
  tlsVerify: boolean;
  tls?: {
    ca?: string;
    cert?: string;
    key?: string;
    servername?: string;
  };
  redactionValues: string[];
}

interface AttemptOutcome {
  response?: HttpResponse;
  errorCode?: string;
  errorMessage?: string;
  retryable: boolean;
}

const defaultSuccessCodes = [200, 201, 202, 203, 204, 205, 206];
const defaultRetryStatus = [408, 429, 500, 502, 503, 504];
const defaultTimeoutMs = 30_000;
const defaultMaxResponseBytes = 1024 * 1024;

export interface CurlExecutorOptions {
  secretResolver?: CurlSecretResolver;
  httpClient?: CurlHttpClient;
}

export class CurlExecutor implements Executor {
  readonly type = 'CURL';
  private readonly executed = new Set<string>();
  private readonly httpClient: CurlHttpClient;

  constructor(private readonly options: CurlExecutorOptions = {}) {
    this.httpClient = options.httpClient ?? new NodeCurlHttpClient();
  }

  async executeStep(input: StepExecutionInput): Promise<StepExecutionResult> {
    const request = input.step.inputSnapshot.curlRequest as CurlExecutionRequest | undefined;
    if (!request) return { success: false, errorCode: 'CURL_REQUEST_REQUIRED', errorMessage: 'CURL 执行器缺少 curlRequest，拒绝伪成功' };
    const result = await this.execute(request, input.dryRun, {
      runId: input.step.executionRunId,
      stepId: input.step.id,
      tenantId: input.step.tenantId,
      actorId: 'curl-executor',
    });
    return result.success
      ? { success: true, detail: result as unknown as Record<string, unknown> }
      : { success: false, errorCode: result.errorCode ?? 'CURL_POLICY_FAILED', errorMessage: result.errorMessage ?? 'HTTP 响应策略不满足', detail: result as unknown as Record<string, unknown> };
  }

  async execute(request: CurlExecutionRequest, forceDryRun = false, context: CurlSecretResolverContext = {}): Promise<CurlExecutionResult> {
    validateRequest(request);
    if (this.executed.has(request.idempotencyKey)) {
      throw new AppError('IDEMPOTENCY_CONFLICT', 'CURL 请求幂等键已执行', { idempotencyKey: request.idempotencyKey });
    }

    const dryRun = forceDryRun || request.dryRun === true;
    const prepared = await prepareRequest(request, this.options.secretResolver, context);
    if (dryRun) return baseResult(prepared.rendered, ['request:dry_run'], 0);

    this.executed.add(request.idempotencyKey);
    const retryPolicy = normalizeRetryPolicy(request.retryPolicy, prepared.method);
    let last: CurlExecutionResult | undefined;

    for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt += 1) {
      const started = Date.now();
      const outcome = request.mockResponse
        ? { response: normalizeResponse(request.mockResponse), retryable: shouldRetryStatus(request.mockResponse.statusCode, retryPolicy) }
        : await sendHttpRequest(prepared, this.httpClient);
      const elapsedMs = Date.now() - started;
      const logs = [`request:${prepared.method}:${maskText(prepared.url, prepared.redactionValues)}:attempt:${attempt}:elapsedMs:${elapsedMs}`];

      if (outcome.response) {
        last = buildResponseResult(request, prepared, outcome.response, attempt, logs);
        if (last.success || attempt === retryPolicy.maxAttempts || !shouldRetryResult(last, retryPolicy)) return last;
      } else {
        last = {
          ...baseResult(prepared.rendered, logs, attempt),
          success: false,
          retryable: outcome.retryable,
          errorCode: outcome.errorCode,
          errorMessage: outcome.errorMessage,
        };
        if (attempt === retryPolicy.maxAttempts || !outcome.retryable || !retryPolicy.retryOnNetworkError) return last;
      }

      await waitBeforeRetry(attempt, retryPolicy);
    }

    return last ?? baseResult(prepared.rendered, ['request:not_started'], 0);
  }

  getRequiredCapabilities(): string[] {
    return ['curl.request', 'http.tls.verify', 'http.header.secret_ref', 'http.extractor', 'http.assertion', 'http.cookie.session'];
  }

  importCurl(command: string): CurlExecutionRequest {
    scanSecretLike(command, ['curl']);
    const url = command.match(/https?:\/\/[^\s'"]+/)?.[0];
    if (!url) throw new AppError('VALIDATION_FAILED', 'curl 命令缺少 URL');
    const method = command.match(/(?:-X|--request)\s+([A-Z]+)/)?.[1] as HttpRequestTemplate['method'] | undefined;
    const headers: Record<string, string> = {};
    for (const match of command.matchAll(/(?:-H|--header)\s+['"]([^:'"]+):\s*([^'"]+)['"]/g)) headers[match[1]!] = match[2]!;
    const data = command.match(/(?:--data|-d)\s+['"]([^'"]+)['"]/)?.[1];
    return {
      idempotencyKey: `curl_import_${Math.abs(hash(command))}`,
      template: {
        url,
        method: method ?? (data ? 'POST' : 'GET'),
        headers,
        bodyType: data ? 'raw' : undefined,
        body: data,
      },
    };
  }

  exportCurl(request: CurlExecutionRequest): string {
    validateRequest(request);
    const rendered = renderRequestPreview(request);
    const headerArgs = rendered.headerNames.map((name) => `-H '${name}: [REDACTED_OR_SECRET_REF]'`).join(' ');
    const bodyArg = rendered.hasBody ? "--data '[REDACTED_OR_SECRET_REF]'" : '';
    return ['curl', '-X', rendered.method, headerArgs, bodyArg, `'${rendered.url}'`].filter(Boolean).join(' ');
  }
}

function validateRequest(request: CurlExecutionRequest): void {
  if (!request.idempotencyKey) throw new AppError('VALIDATION_FAILED', 'idempotencyKey 必填');
  const url = new URL(renderTemplate(request.template.url, request.variables ?? {}, false));
  if (!['https:', 'http:'].includes(url.protocol)) throw new AppError('VALIDATION_FAILED', '只允许 http/https URL', { url: request.template.url });
  if (url.protocol === 'http:' && !isLocalhost(url.hostname)) {
    throw new AppError('VALIDATION_FAILED', '非本地 HTTP 明文 URL 被拒绝', { url: request.template.url });
  }
  scanSecretLike(request.template.headers ?? {}, ['headers']);
  scanSecretLike(request.template.body, ['body']);
  scanSecretLike(request.template.form, ['form']);
  scanSecretLike(request.template.query, ['query']);
  if (request.template.headers?.Authorization && !request.template.headerRefs?.Authorization) {
    throw new AppError('VALIDATION_FAILED', 'Authorization 必须通过 headerRefs/SecretRef 提供');
  }
  if (request.template.timeoutMs !== undefined && (request.template.timeoutMs < 1 || request.template.timeoutMs > 60_000)) {
    throw new AppError('VALIDATION_FAILED', 'timeoutMs 必须在 1-60000 之间');
  }
  if (request.template.maxResponseBytes !== undefined && (request.template.maxResponseBytes < 1 || request.template.maxResponseBytes > 10 * 1024 * 1024)) {
    throw new AppError('VALIDATION_FAILED', 'maxResponseBytes 必须在 1-10485760 之间');
  }
  if (request.template.tls?.verify === false && request.template.tls.allowInsecure !== true) throw new AppError('VALIDATION_FAILED', '跳过 TLS 校验必须走审批后的专用策略，执行器默认拒绝');
  if (request.template.tls?.caSecretRef && !isSecretRef(request.template.tls.caSecretRef)) throw new AppError('VALIDATION_FAILED', 'CA 必须使用 SecretRef');
  if (request.template.tls?.clientCertSecretRef && !isSecretRef(request.template.tls.clientCertSecretRef)) throw new AppError('VALIDATION_FAILED', '客户端证书必须使用 SecretRef');
  if (request.template.tls?.clientKeySecretRef && !isSecretRef(request.template.tls.clientKeySecretRef)) throw new AppError('VALIDATION_FAILED', '客户端私钥必须使用 SecretRef');
  validateAuth(request.template.auth);
  for (const extractor of request.extractors ?? []) {
    if (!extractor.name.trim()) throw new AppError('VALIDATION_FAILED', 'extractor name 必填');
    if (!extractor.path && !extractor.pattern && !extractor.header && extractor.source !== 'status') throw new AppError('VALIDATION_FAILED', 'extractor 必须提供 path、pattern 或 header');
  }
}

function validateAuth(auth: HttpAuthConfig | undefined): void {
  if (!auth || auth.type === 'none') return;
  if (auth.type === 'basic' || auth.type === 'bearer' || auth.type === 'cookie') {
    if (!isSecretRef(auth.secretRef)) throw new AppError('SECRET_REF_INVALID', '认证必须使用 SecretRef');
  }
  if (auth.type === 'api_key') {
    if (!isSecretRef(auth.secretRef) || !auth.name) throw new AppError('SECRET_REF_INVALID', 'API Key 认证必须提供 SecretRef 和名称');
  }
  if (auth.type === 'custom_header') {
    if (!isSecretRef(auth.secretRef) || !auth.headerName) throw new AppError('SECRET_REF_INVALID', '自定义 Header 认证必须提供 SecretRef 和 Header 名称');
  }
  if (auth.type === 'mtls' && (!isSecretRef(auth.certSecretRef) || !isSecretRef(auth.keySecretRef))) throw new AppError('SECRET_REF_INVALID', 'mTLS 必须提供证书和私钥 SecretRef');
}

function renderRequestPreview(request: CurlExecutionRequest): CurlExecutionResult['rendered'] {
  const variables = request.variables ?? {};
  const url = new URL(renderTemplate(request.template.url, variables));
  for (const [key, value] of Object.entries(request.template.query ?? {})) url.searchParams.set(key, renderTemplate(String(value), variables));
  const bodyType: 'json' | 'form' | 'multipart' | 'raw' | 'none' = request.template.bodyType ?? inferBodyType(request.template);
  const headerNames = new Set<string>([
    ...Object.keys(request.template.headers ?? {}),
    ...Object.keys(request.template.headerRefs ?? {}),
  ]);
  if (request.template.auth?.type === 'basic' || request.template.auth?.type === 'bearer') headerNames.add('Authorization');
  if (request.template.auth?.type === 'custom_header') headerNames.add(request.template.auth.headerName);
  if (request.template.auth?.type === 'api_key' && request.template.auth.in !== 'query') headerNames.add(request.template.auth.name);
  if (request.template.auth?.type === 'cookie') headerNames.add('Cookie');
  return {
    method: request.template.method ?? 'GET',
    url: url.toString(),
    headerNames: [...headerNames].sort(),
    hasBody: bodyType !== 'none',
    bodyType,
    timeoutMs: request.template.timeoutMs ?? defaultTimeoutMs,
    tlsVerify: request.template.tls?.verify !== false,
  };
}

async function prepareRequest(
  request: CurlExecutionRequest,
  resolver?: CurlSecretResolver,
  context: CurlSecretResolverContext = {},
): Promise<PreparedRequest> {
  const variables = request.variables ?? {};
  const secrets = request.secrets ?? {};
  const redactionValues: string[] = [];
  const url = new URL(renderTemplate(request.template.url, variables));
  for (const [key, value] of Object.entries(request.template.query ?? {})) url.searchParams.set(key, renderTemplate(String(value), variables));
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.template.headers ?? {})) headers[key] = renderTemplate(value, variables);
  for (const [key, ref] of Object.entries(request.template.headerRefs ?? {})) {
    const secret = await getSecret(ref, secrets, resolver, context, 'http.header');
    headers[key] = secretString(secret, ['value', 'token', 'apiKey']);
    redactionValues.push(headers[key]!);
  }
  await applyAuth(request.template.auth, url, headers, secrets, redactionValues, resolver, context);

  const bodyType: 'json' | 'form' | 'multipart' | 'raw' | 'none' = request.template.bodyType ?? inferBodyType(request.template);
  const body = await buildBody(request.template, bodyType, variables, secrets, headers, redactionValues, resolver, context);
  const timeoutMs = request.template.timeoutMs ?? defaultTimeoutMs;
  const tlsVerify = request.template.tls?.verify !== false;
  const tls = await resolveTlsOptions(request.template, secrets, resolver, context, redactionValues);
  if (body && headers['Content-Length'] === undefined) headers['Content-Length'] = String(body.byteLength);
  const rendered = {
    method: request.template.method ?? 'GET',
    url: url.toString(),
    headerNames: Object.keys(headers).sort(),
    hasBody: body !== undefined,
    bodyType,
    timeoutMs,
    tlsVerify,
  };
  return {
    rendered,
    url: url.toString(),
    method: rendered.method,
    headers,
    body,
    timeoutMs,
    maxResponseBytes: request.template.maxResponseBytes ?? defaultMaxResponseBytes,
    tlsVerify,
    tls,
    redactionValues,
  };
}

async function resolveTlsOptions(
  template: HttpRequestTemplate,
  secrets: CurlExecutionRequest['secrets'],
  resolver: CurlSecretResolver | undefined,
  context: CurlSecretResolverContext,
  redactionValues: string[],
): Promise<PreparedRequest['tls']> {
  const certSecretRef = template.tls?.clientCertSecretRef ?? (template.auth?.type === 'mtls' ? template.auth.certSecretRef : undefined);
  const keySecretRef = template.tls?.clientKeySecretRef ?? (template.auth?.type === 'mtls' ? template.auth.keySecretRef : undefined);
  const ca = template.tls?.caSecretRef
    ? secretString(await getSecret(template.tls.caSecretRef, secrets, resolver, context, 'http.tls.ca'), ['value', 'cert'])
    : undefined;
  const cert = certSecretRef
    ? secretString(await getSecret(certSecretRef, secrets, resolver, context, 'http.tls.client_cert'), ['cert', 'value'])
    : undefined;
  const key = keySecretRef
    ? secretString(await getSecret(keySecretRef, secrets, resolver, context, 'http.tls.client_key'), ['key', 'value'])
    : undefined;
  if (ca) redactionValues.push(ca);
  if (cert) redactionValues.push(cert);
  if (key) redactionValues.push(key);
  return { ca, cert, key, servername: template.tls?.sni };
}

async function applyAuth(
  auth: HttpAuthConfig | undefined,
  url: URL,
  headers: Record<string, string>,
  secrets: CurlExecutionRequest['secrets'],
  redactionValues: string[],
  resolver?: CurlSecretResolver,
  context: CurlSecretResolverContext = {},
): Promise<void> {
  if (!auth || auth.type === 'none') return;
  if (auth.type === 'basic') {
    const secret = await getSecret(auth.secretRef, secrets, resolver, context, 'http.auth.basic');
    const username = secretString(secret, ['username']);
    const password = secretString(secret, ['password', 'value']);
    const value = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    headers.Authorization = value;
    redactionValues.push(username, password, value);
    return;
  }
  if (auth.type === 'bearer') {
    const token = secretString(await getSecret(auth.secretRef, secrets, resolver, context, 'http.auth.bearer'), ['token', 'value']);
    headers.Authorization = `Bearer ${token}`;
    redactionValues.push(token, headers.Authorization);
    return;
  }
  if (auth.type === 'api_key') {
    const apiKey = secretString(await getSecret(auth.secretRef, secrets, resolver, context, 'http.auth.api_key'), ['apiKey', 'value', 'token']);
    if (auth.in === 'query') url.searchParams.set(auth.name, apiKey);
    else headers[auth.name] = apiKey;
    redactionValues.push(apiKey);
    return;
  }
  if (auth.type === 'cookie') {
    const cookie = secretString(await getSecret(auth.secretRef, secrets, resolver, context, 'http.auth.cookie'), ['cookie', 'value', 'token']);
    headers.Cookie = auth.name ? `${auth.name}=${cookie}` : cookie;
    redactionValues.push(cookie, headers.Cookie);
    return;
  }
  if (auth.type === 'custom_header') {
    const value = secretString(await getSecret(auth.secretRef, secrets, resolver, context, 'http.auth.custom_header'), ['value', 'token', 'apiKey']);
    headers[auth.headerName] = value;
    redactionValues.push(value);
    return;
  }
  const cert = secretString(await getSecret(auth.certSecretRef, secrets, resolver, context, 'http.tls.client_cert'), ['cert', 'value']);
  const key = secretString(await getSecret(auth.keySecretRef, secrets, resolver, context, 'http.tls.client_key'), ['key', 'value']);
  redactionValues.push(cert, key);
}

async function buildBody(
  template: HttpRequestTemplate,
  bodyType: string,
  variables: Record<string, Primitive>,
  secrets: CurlExecutionRequest['secrets'],
  headers: Record<string, string>,
  redactionValues: string[],
  resolver?: CurlSecretResolver,
  context: CurlSecretResolverContext = {},
): Promise<Buffer | undefined> {
  if (bodyType === 'none') return undefined;
  if (template.bodySecretRef) {
    const value = secretString(await getSecret(template.bodySecretRef, secrets, resolver, context, 'http.body'), ['value', 'token', 'apiKey']);
    redactionValues.push(value);
    return Buffer.from(value, 'utf8');
  }
  if (bodyType === 'json') {
    if (template.body === undefined) return undefined;
    headers['Content-Type'] ??= 'application/json';
    return Buffer.from(JSON.stringify(renderUnknown(template.body, variables)), 'utf8');
  }
  if (bodyType === 'form') {
    headers['Content-Type'] ??= 'application/x-www-form-urlencoded';
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(template.form ?? asPrimitiveRecord(template.body))) params.set(key, renderTemplate(String(value), variables));
    return Buffer.from(params.toString(), 'utf8');
  }
  if (bodyType === 'multipart') {
    const boundary = `gcac-${Math.random().toString(16).slice(2)}`;
    const chunks: Buffer[] = [];
    for (const [key, part] of Object.entries(template.multipart ?? {})) {
      let value: string;
      if (part.secretRef) {
        value = secretString(await getSecret(part.secretRef, secrets, resolver, context, `http.multipart.${key}`), ['value', 'token', 'apiKey']);
        redactionValues.push(value);
      } else if (part.filename) {
        value = String(part.value ?? '');
      } else {
        value = String(part.value ?? '');
      }
      chunks.push(Buffer.from(`--${boundary}\r\n`, 'utf8'));
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${escapeMultipartValue(key)}"${part.filename ? `; filename="${escapeMultipartValue(part.filename)}"` : ''}\r\n`, 'utf8'));
      if (part.contentType) chunks.push(Buffer.from(`Content-Type: ${part.contentType}\r\n`, 'utf8'));
      chunks.push(Buffer.from('\r\n', 'utf8'));
      chunks.push(Buffer.from(value, 'utf8'));
      chunks.push(Buffer.from('\r\n', 'utf8'));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
    headers['Content-Type'] ??= `multipart/form-data; boundary=${boundary}`;
    return Buffer.concat(chunks);
  }
  if (bodyType === 'raw') {
    const raw = typeof template.body === 'string' ? renderTemplate(template.body, variables) : JSON.stringify(renderUnknown(template.body, variables));
    return Buffer.from(raw, 'utf8');
  }
  return undefined;
}

async function sendHttpRequest(prepared: PreparedRequest, httpClient: CurlHttpClient): Promise<AttemptOutcome> {
  try {
    const response = await httpClient.send({
      url: prepared.url,
      method: prepared.method,
      headers: prepared.headers,
      body: prepared.body,
      timeoutMs: prepared.timeoutMs,
      tls: {
        verify: prepared.tlsVerify,
        ca: prepared.tls?.ca,
        cert: prepared.tls?.cert,
        key: prepared.tls?.key,
        servername: prepared.tls?.servername,
      },
    });
    const normalized = normalizeResponse(response);
    return { response: normalized, retryable: shouldRetryStatus(normalized.statusCode, normalizeRetryPolicy(undefined, prepared.method)) };
  } catch (error) {
    return classifyFetchError(error);
  }
}

function buildResponseResult(request: CurlExecutionRequest, prepared: PreparedRequest, response: HttpResponse, attempts: number, logs: string[]): CurlExecutionResult {
  const normalized = normalizeResponse(response);
  const responseBytes = Buffer.byteLength(normalized.bodyText ?? JSON.stringify(normalized.body ?? ''), 'utf8');
  if (responseBytes > prepared.maxResponseBytes) {
    return { ...baseResult(prepared.rendered, logs, attempts), success: false, statusCode: normalized.statusCode, responseBytes, errorCode: 'HTTP_RESPONSE_TOO_LARGE', errorMessage: 'HTTP 响应超过大小限制' };
  }
  const successCodes = request.responsePolicy?.successStatusCodes ?? (request.responsePolicy?.failOnNon2xx === false ? [normalized.statusCode] : defaultSuccessCodes);
  const assertions = evaluateAssertions(normalized, request.responsePolicy?.assertions ?? []);
  const extracted = runExtractors(normalized, request.extractors ?? []);
  const success = successCodes.includes(normalized.statusCode) && assertions.every((item) => item.passed);
  return {
    success,
    rendered: prepared.rendered,
    statusCode: normalized.statusCode,
    headers: maskHeaders(normalized.headers ?? {}),
    bodyText: maskText(normalized.bodyText ?? '', prepared.redactionValues),
    bodyJson: maskUnknown(normalized.bodyJson, prepared.redactionValues),
    responseBytes,
    attempts,
    retryable: shouldRetryStatus(normalized.statusCode, normalizeRetryPolicy(request.retryPolicy, prepared.method)),
    errorCode: success ? undefined : 'HTTP_NON_SUCCESS_STATUS',
    errorMessage: success ? undefined : 'HTTP 响应未满足成功策略',
    assertions,
    extracted,
    logs,
  };
}

function baseResult(rendered: CurlExecutionResult['rendered'], logs: string[], attempts: number): CurlExecutionResult {
  return { success: true, rendered, attempts, assertions: [], extracted: {}, logs };
}

function classifyFetchError(error: unknown): AttemptOutcome {
  if (error instanceof Error && error.name === 'AbortError') {
    return { errorCode: 'HTTP_REQUEST_TIMEOUT', errorMessage: 'HTTP 请求超时', retryable: true };
  }
  const message = error instanceof Error ? error.message : String(error);
  const code = /certificate|TLS|SSL|self signed|CERT_/i.test(message) ? 'TLS_CERT_UNTRUSTED' : 'HTTP_NETWORK_ERROR';
  return { errorCode: code, errorMessage: message, retryable: code !== 'TLS_CERT_UNTRUSTED' };
}

function normalizeResponse(response: HttpResponse): HttpResponse {
  const bodyText = response.bodyText ?? (typeof response.body === 'string' ? response.body : response.body === undefined ? '' : JSON.stringify(response.body));
  const bodyJson = response.bodyJson ?? (typeof response.body === 'object' ? response.body : tryParseJson(bodyText));
  return { ...response, headers: response.headers ?? {}, bodyText, bodyJson, body: response.body ?? bodyJson ?? bodyText };
}

function normalizeRetryPolicy(policy: HttpRetryPolicy | undefined, method: string): Required<HttpRetryPolicy> {
  const safeMethod = ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'].includes(method);
  return {
    maxAttempts: Math.max(1, Math.min(policy?.maxAttempts ?? (safeMethod ? 1 : 1), 5)),
    backoff: policy?.backoff ?? 'fixed',
    intervalMs: policy?.intervalMs ?? 10,
    retryOnStatus: policy?.retryOnStatus ?? defaultRetryStatus,
    retryOnNetworkError: policy?.retryOnNetworkError ?? true,
  };
}

function shouldRetryStatus(statusCode: number, policy: Required<HttpRetryPolicy>): boolean {
  return policy.retryOnStatus.includes(statusCode);
}

function shouldRetryResult(result: CurlExecutionResult, policy: Required<HttpRetryPolicy>): boolean {
  return result.statusCode !== undefined && shouldRetryStatus(result.statusCode, policy);
}

async function waitBeforeRetry(attempt: number, policy: Required<HttpRetryPolicy>): Promise<void> {
  const interval = policy.backoff === 'exponential' ? policy.intervalMs * (2 ** (attempt - 1)) : policy.intervalMs;
  if (interval > 0) await delay(interval);
}

function evaluateAssertions(response: HttpResponse, assertions: HttpAssertion[]): CurlExecutionResult['assertions'] {
  return assertions.map((assertion) => {
    if (assertion.type === 'status') return { type: assertion.type, passed: response.statusCode === assertion.equals, message: `status=${response.statusCode}` };
    if (assertion.type === 'header_exists') return { type: assertion.type, passed: getHeader(response.headers, assertion.name) !== undefined, message: `header=${assertion.name}` };
    return { type: assertion.type, passed: String(response.bodyText ?? response.body ?? '').includes(assertion.text), message: 'body contains' };
  });
}

function runExtractors(response: HttpResponse, extractors: HttpExtractor[]): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const extractor of extractors) {
    let value: unknown;
    if (extractor.source === 'status') value = response.statusCode;
    if (extractor.source === 'header') value = getHeader(response.headers, extractor.header ?? extractor.path ?? '');
    if (extractor.source === 'json' || (extractor.source === 'body' && extractor.path)) value = readJsonPath(response.bodyJson ?? response.body, extractor.path ?? '');
    if (extractor.pattern) value = String(response.bodyText ?? response.body ?? '').match(new RegExp(extractor.pattern))?.[1];
    if ((value === undefined || value === null) && extractor.required) throw new AppError('WORKFLOW_ASSERTION_FAILED', '必需提取变量失败', { name: extractor.name });
    if (value !== undefined && value !== null) output[extractor.name] = extractor.secret ? '[SECRET_CAPTURED]' : value;
  }
  return output;
}

async function getSecret(
  ref: string,
  secrets: CurlExecutionRequest['secrets'],
  resolver: CurlSecretResolver | undefined,
  context: CurlSecretResolverContext,
  purpose: string,
): Promise<string | HttpSecretValue> {
  if (!isSecretRef(ref)) throw new AppError('SECRET_REF_INVALID', 'SecretRef 格式无效', { ref });
  const secret = secrets?.[ref];
  if (secret !== undefined) return secret;
  if (!resolver) throw new AppError('AUTH_FORBIDDEN', 'Secret 缺失或无权访问', { ref });
  return parseResolvedSecret(await resolver.resolveSecret(ref, purpose, context));
}

function parseResolvedSecret(secret: string): string | HttpSecretValue {
  const trimmed = secret.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (isRecord(parsed)) return parsed as HttpSecretValue;
    } catch {
      // ignore and fall back to raw string
    }
  }
  return secret;
}

function secretString(secret: string | HttpSecretValue, keys: string[]): string {
  if (typeof secret === 'string') return secret;
  for (const key of keys) {
    const value = secret[key as keyof HttpSecretValue];
    if (typeof value === 'string' && value) return value;
  }
  throw new AppError('SECRET_REF_INVALID', 'Secret 内容缺少所需字段', { keys });
}

function renderUnknown(value: unknown, variables: Record<string, Primitive>): unknown {
  if (typeof value === 'string') return renderTemplate(value, variables);
  if (Array.isArray(value)) return value.map((item) => renderUnknown(item, variables));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, renderUnknown(child, variables)]));
  return value;
}

function renderTemplate(value: string, variables: Record<string, Primitive>, encode = false): string {
  return value.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key: string) => {
    const found = variables[key];
    if (found === undefined) throw new AppError('VALIDATION_FAILED', '变量缺失', { key });
    return encode ? encodeURIComponent(String(found)) : String(found);
  });
}

function escapeMultipartValue(value: string): string {
  return value.replace(/\"/g, '%22').replace(/\r|\n/g, ' ');
}

function scanSecretLike(value: unknown, path: string[]): void {
  if (typeof value === 'string' && /(password|token|api[_-]?key|authorization)\s*[:=]|bearer\s+[a-z0-9._-]{10,}|sk-[a-z0-9]{20,}/i.test(value)) {
    throw new AppError('VALIDATION_FAILED', 'CURL 请求包含疑似明文敏感信息', { fieldPath: path.join('.') });
  }
  if (Array.isArray(value)) value.forEach((item, index) => scanSecretLike(item, [...path, String(index)]));
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) scanSecretLike(child, [...path, key]);
  }
}

function readJsonPath(body: unknown, path: string): unknown {
  if (!path || !path.startsWith('$.')) return undefined;
  return readPath(body, path.slice(2));
}

function readPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), source);
}

function tryParseJson(text: string): unknown {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function headersToRecord(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {};
  headers.forEach((value, key) => {
    output[key] = value;
  });
  return output;
}

function getHeader(headers: Record<string, string> | undefined, name: string): string | undefined {
  const lower = name.toLowerCase();
  return Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === lower)?.[1];
}

function maskHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, isSensitiveKey(key) ? '[REDACTED]' : value]));
}

function maskUnknown(value: unknown, redactionValues: string[]): unknown {
  if (typeof value === 'string') return maskText(value, redactionValues);
  if (Array.isArray(value)) return value.map((item) => maskUnknown(item, redactionValues));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, isSensitiveKey(key) ? '[REDACTED]' : maskUnknown(child, redactionValues)]));
  return value;
}

function maskText(text: string, redactionValues: string[]): string {
  let result = text;
  for (const value of redactionValues) {
    if (value) result = result.split(value).join('[REDACTED]');
  }
  return result
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]')
    .replace(/bearer\s+[a-z0-9._-]{10,}/gi, 'Bearer [REDACTED]')
    .replace(/(authorization|cookie|api[_-]?key|token|password)=([^&\s]+)/gi, '$1=[REDACTED]');
}

function isSensitiveKey(key: string): boolean {
  return /(password|token|privateKey|authorization|credential|secret|cookie|apiKey|pfx|jks)/i.test(key);
}

function inferBodyType(template: HttpRequestTemplate): 'json' | 'form' | 'multipart' | 'raw' | 'none' {
  if (template.multipart) return 'multipart';
  if (template.form) return 'form';
  if (template.body === undefined && !template.bodySecretRef) return 'none';
  return typeof template.body === 'string' ? 'raw' : 'json';
}

function asPrimitiveRecord(value: unknown): Record<string, Primitive> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, Primitive] => ['string', 'number', 'boolean'].includes(typeof entry[1])));
}

function isSecretRef(value: string): boolean {
  return /^secret:\/\/[a-zA-Z0-9/_#.-]+$/.test(value);
}

function isLocalhost(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1'].includes(hostname);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hash(value: string): number {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) result = ((result << 5) - result + value.charCodeAt(index)) | 0;
  return result;
}
