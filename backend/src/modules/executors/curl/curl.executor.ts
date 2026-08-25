import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { AppError } from '../../../common/errors/app-error.js';
import type { Executor, StepExecutionInput, StepExecutionResult } from '../../executions/application/executors.js';
import { NodeCurlHttpClient, type CurlHttpClient } from './curl.http-client.js';
import type { CurlSecretResolver, CurlSecretResolverContext } from './curl.secret-resolver.js';
import { CookieSessionStore, type CookieJar } from './cookie-session.js';
import type { CertificateArtifactStore } from '../../certificates/artifacts/certificate-artifact-store.js';

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
  /** 由 Workflow Adapter 从 ResolvedConnectionV1 注入，DSL 本身不能伪造该连接事实。 */
  connection?: {
    host: string;
    port: number;
    tlsEnabled: boolean;
    allowedProtocols: Array<'http' | 'https'>;
  };
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, Primitive>;
  headers?: Record<string, string>;
  headerRefs?: Record<string, string>;
  bodyType?: 'json' | 'form' | 'multipart' | 'raw' | 'none';
  body?: unknown;
  form?: Record<string, Primitive>;
  formSecretRefs?: Record<string, string>;
  multipart?: Record<string, MultipartValue>;
  bodySecretRef?: string;
  /** 同一工作流运行内共享的逻辑 Cookie 会话名称。 */
  cookieSessionRef?: string;
  auth?: HttpAuthConfig;
  timeoutMs?: number;
  maxResponseBytes?: number;
  tls?: { verify?: boolean; caSecretRef?: string; clientCertSecretRef?: string; clientKeySecretRef?: string; sni?: string; allowInsecure?: boolean };
}

export type HttpAuthConfig =
  | { type: 'none' }
  | { type: 'basic'; username: string; secretRef: string }
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
  /** 只能是 artifact:// 引用或渲染后的受控 PEM 内容，禁止本地路径。 */
  artifactRef?: string;
  artifactSha256?: string;
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
  setCookie?: string[];
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

export interface CurlWorkflowExecutionResult {
  result: CurlExecutionResult;
  runtimeResponse?: HttpResponse;
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
  artifactLogLines: string[];
  cookieJar?: CookieJar;
  cookieSessionRef?: string;
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
  executionGrantService?: CurlSecretResolverContext['executionGrantService'];
  cookieSessionStore?: CookieSessionStore;
  artifactStore?: Pick<CertificateArtifactStore, 'get'>;
}

export class CurlExecutor implements Executor {
  readonly type = 'CURL';
  private readonly executed = new Set<string>();
  private readonly httpClient: CurlHttpClient;
  private readonly cookieSessionStore: CookieSessionStore;

  constructor(private readonly options: CurlExecutorOptions = {}) {
    this.httpClient = options.httpClient ?? new NodeCurlHttpClient();
    this.cookieSessionStore = options.cookieSessionStore ?? new CookieSessionStore();
  }

  async executeStep(input: StepExecutionInput): Promise<StepExecutionResult> {
    const request = input.step.inputSnapshot.curlRequest as CurlExecutionRequest | undefined;
    if (!request) return { success: false, errorCode: 'CURL_REQUEST_REQUIRED', errorMessage: 'CURL 执行器缺少 curlRequest，拒绝伪成功' };
    const result = await this.execute(request, input.dryRun, {
      runId: input.step.executionRunId,
      stepId: input.step.id,
      tenantId: input.step.tenantId,
      actorId: 'curl-executor',
      planId: typeof input.step.inputSnapshot.deploymentPlanId === 'string' ? input.step.inputSnapshot.deploymentPlanId : undefined,
      targetId: typeof input.step.inputSnapshot.deploymentPlanTargetId === 'string' ? input.step.inputSnapshot.deploymentPlanTargetId : undefined,
      workflowVersionId: typeof input.step.inputSnapshot.workflowVersionId === 'string' ? input.step.inputSnapshot.workflowVersionId : undefined,
      executionGrantId: typeof input.step.inputSnapshot.executionGrantId === 'string' ? input.step.inputSnapshot.executionGrantId : undefined,
      allowInsecureTls: typeof input.step.inputSnapshot.resolvedDeploymentInput === 'object'
        && input.step.inputSnapshot.resolvedDeploymentInput !== null
        && !Array.isArray(input.step.inputSnapshot.resolvedDeploymentInput)
        && typeof (input.step.inputSnapshot.resolvedDeploymentInput as Record<string, unknown>).variables === 'object'
        && (input.step.inputSnapshot.resolvedDeploymentInput as Record<string, unknown>).variables !== null
        && !Array.isArray((input.step.inputSnapshot.resolvedDeploymentInput as Record<string, unknown>).variables)
        && (input.step.inputSnapshot.resolvedDeploymentInput as Record<string, unknown>).variables !== undefined
        && ((input.step.inputSnapshot.resolvedDeploymentInput as Record<string, unknown>).variables as Record<string, unknown>).allowInsecureTls === true,
      executionGrantService: this.options.executionGrantService,
      cookieSessionStore: this.cookieSessionStore,
      cookieSessionRef: request.template.cookieSessionRef,
    });
    return result.success
      ? { success: true, detail: result as unknown as Record<string, unknown> }
      : { success: false, errorCode: result.errorCode ?? 'CURL_POLICY_FAILED', errorMessage: result.errorMessage ?? 'HTTP 响应策略不满足', detail: result as unknown as Record<string, unknown> };
  }

  async execute(request: CurlExecutionRequest, forceDryRun = false, context: CurlSecretResolverContext = {}): Promise<CurlExecutionResult> {
    return (await this.executeWithRuntimeResponse(request, forceDryRun, context)).result;
  }

  async executeForWorkflow(request: CurlExecutionRequest, forceDryRun = false, context: CurlSecretResolverContext = {}): Promise<CurlWorkflowExecutionResult> {
    return this.executeWithRuntimeResponse(request, forceDryRun, context);
  }

  async validateForWorkflow(request: CurlExecutionRequest, context: CurlSecretResolverContext = {}): Promise<void> {
    validateRequest(request, true);
    await validateTlsBypassAuthorization(request, context);
    await validateCookieSessionAuthorization(request, context);
  }

  private async executeWithRuntimeResponse(request: CurlExecutionRequest, forceDryRun: boolean, context: CurlSecretResolverContext): Promise<CurlWorkflowExecutionResult> {
    validateRequest(request);
    await validateTlsBypassAuthorization(request, context);
    await validateCookieSessionAuthorization(request, context);
    if (this.executed.has(request.idempotencyKey)) {
      throw new AppError('IDEMPOTENCY_CONFLICT', 'CURL 请求幂等键已执行', { idempotencyKey: request.idempotencyKey });
    }

    const dryRun = forceDryRun || request.dryRun === true;
    const prepared = await prepareRequest(request, this.options.secretResolver, {
      ...context,
      cookieSessionStore: context.cookieSessionStore ?? this.cookieSessionStore,
    }, this.options.artifactStore);
    if (dryRun) return { result: baseResult(prepared.rendered, ['request:dry_run'], 0) };

    this.executed.add(request.idempotencyKey);
    const retryPolicy = normalizeRetryPolicy(request.retryPolicy, prepared.method);
    let last: CurlExecutionResult | undefined;

    for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt += 1) {
      const started = Date.now();
      refreshCookieHeader(prepared);
      const outcome = request.mockResponse
        ? { response: normalizeResponse(request.mockResponse), retryable: shouldRetryStatus(request.mockResponse.statusCode, retryPolicy) }
        : await sendHttpRequest(prepared, this.httpClient);
      const elapsedMs = Date.now() - started;
      const logs = [
        ...prepared.artifactLogLines,
        `request:${prepared.method}:${maskText(prepared.url, prepared.redactionValues)}:attempt:${attempt}:elapsedMs:${elapsedMs}`,
      ];

      if (outcome.response) {
        const runtimeResponse = normalizeResponse(outcome.response);
        updateCookieJar(prepared, runtimeResponse);
        refreshCookieHeader(prepared);
        last = buildResponseResult(request, prepared, runtimeResponse, attempt, logs);
        if (last.success || attempt === retryPolicy.maxAttempts || !shouldRetryResult(last, retryPolicy)) {
          return { result: last, runtimeResponse: sanitizeRuntimeResponse(runtimeResponse, prepared.redactionValues) };
        }
      } else {
        last = {
          ...baseResult(prepared.rendered, logs, attempt),
          success: false,
          retryable: outcome.retryable,
          errorCode: outcome.errorCode,
          errorMessage: outcome.errorMessage,
        };
        if (attempt === retryPolicy.maxAttempts || !outcome.retryable || !retryPolicy.retryOnNetworkError) return { result: last };
      }

      await waitBeforeRetry(attempt, retryPolicy);
    }

    return { result: last ?? baseResult(prepared.rendered, ['request:not_started'], 0) };
  }

  getRequiredCapabilities(): string[] {
    return ['curl.request', 'http.tls.verify', 'http.header.secret_ref', 'http.form.secret_ref', 'http.extractor', 'http.assertion', 'http.cookie.session'];
  }

  clearCookieSessions(scope: { tenantId: string; runId: string; workflowVersionId: string }): void {
    this.cookieSessionStore.clear(scope);
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

function validateRequest(request: CurlExecutionRequest, allowUnresolvedVariables = false): void {
  if (!request.idempotencyKey) throw new AppError('VALIDATION_FAILED', 'idempotencyKey 必填');
  const url = resolveRequestUrl(request.template, request.variables ?? {}, allowUnresolvedVariables);
  if (!['https:', 'http:'].includes(url.protocol)) throw new AppError('VALIDATION_FAILED', '只允许 http/https URL', { url: request.template.url });
  const allowedProtocols = request.template.connection?.allowedProtocols ?? ['https'];
  if (allowedProtocols.length === 0 || allowedProtocols.some((protocol) => protocol !== 'http' && protocol !== 'https')) {
    throw new AppError('VALIDATION_FAILED', 'allowedProtocols 必须是非空的 http/https 协议白名单', { allowedProtocols });
  }
  if (!allowedProtocols.includes(url.protocol.slice(0, -1) as 'http' | 'https')) {
    throw new AppError('VALIDATION_FAILED', 'HTTP URL 协议不在连接契约白名单中', {
      url: request.template.url,
      protocol: url.protocol.slice(0, -1),
      allowedProtocols,
    });
  }
  if (url.protocol === 'http:' && request.template.tls !== undefined) {
    throw new AppError('VALIDATION_FAILED', 'HTTP 明文请求不得携带 TLS 配置', { url: request.template.url });
  }
  scanSecretLike(request.template.headers ?? {}, ['headers']);
  scanSecretLike(request.template.body, ['body']);
  scanSecretLike(request.template.form, ['form']);
  scanSecretLike(request.template.query, ['query']);
  for (const [key, ref] of Object.entries(request.template.formSecretRefs ?? {})) {
    if (!isSecretRef(ref)) throw new AppError('SECRET_REF_INVALID', '表单密文字段必须使用 SecretRef', { key, ref });
  }
  if (request.template.headers?.Authorization && !request.template.headerRefs?.Authorization) {
    throw new AppError('VALIDATION_FAILED', 'Authorization 必须通过 headerRefs/SecretRef 提供');
  }
  if (request.template.cookieSessionRef !== undefined) {
    if (!/^[A-Za-z][A-Za-z0-9._:-]{0,63}$/.test(request.template.cookieSessionRef)) {
      throw new AppError('VALIDATION_FAILED', 'cookieSessionRef 格式无效');
    }
    const hasExplicitCookie = Object.keys(request.template.headers ?? {}).some((key) => key.toLowerCase() === 'cookie')
      || Object.keys(request.template.headerRefs ?? {}).some((key) => key.toLowerCase() === 'cookie')
      || request.template.auth?.type === 'cookie';
    if (hasExplicitCookie) throw new AppError('VALIDATION_FAILED', 'CookieSession 不得与显式 Cookie Header 或 Cookie 认证同时使用');
  }
  if (request.template.timeoutMs !== undefined && (request.template.timeoutMs < 1 || request.template.timeoutMs > 60_000)) {
    throw new AppError('VALIDATION_FAILED', 'timeoutMs 必须在 1-60000 之间');
  }
  if (request.template.maxResponseBytes !== undefined && (request.template.maxResponseBytes < 1 || request.template.maxResponseBytes > 10 * 1024 * 1024)) {
    throw new AppError('VALIDATION_FAILED', 'maxResponseBytes 必须在 1-10485760 之间');
  }
  if (request.template.tls?.caSecretRef && !isSecretRef(request.template.tls.caSecretRef)) throw new AppError('VALIDATION_FAILED', 'CA 必须使用 SecretRef');
  if (request.template.tls?.clientCertSecretRef && !isSecretRef(request.template.tls.clientCertSecretRef)) throw new AppError('VALIDATION_FAILED', '客户端证书必须使用 SecretRef');
  if (request.template.tls?.clientKeySecretRef && !isSecretRef(request.template.tls.clientKeySecretRef)) throw new AppError('VALIDATION_FAILED', '客户端私钥必须使用 SecretRef');
  validateAuth(request.template.auth);
  for (const extractor of request.extractors ?? []) {
    if (!extractor.name.trim()) throw new AppError('VALIDATION_FAILED', 'extractor name 必填');
    if (!extractor.path && !extractor.pattern && !extractor.header && extractor.source !== 'status') throw new AppError('VALIDATION_FAILED', 'extractor 必须提供 path、pattern 或 header');
    if (extractor.source === 'header' && /^(?:set-cookie|cookie)$/i.test(extractor.header ?? extractor.path ?? '')) {
      throw new AppError('VALIDATION_FAILED', 'Cookie 和 Set-Cookie 不允许作为工作流输出提取');
    }
  }
}

async function validateTlsBypassAuthorization(request: CurlExecutionRequest, context: CurlSecretResolverContext): Promise<void> {
  if (request.template.tls?.verify !== false) return;
  if (context.allowInsecureTls !== true) {
    throw new AppError('VALIDATION_FAILED', 'TLS 跳过校验请求缺少已绑定的 allowInsecureTls=true', {
      policy: 'workflow.tls.insecure',
      reason: 'binding_required',
    });
  }
  if (!context.executionGrantId || !context.executionGrantService) {
    throw new AppError('AUTH_FORBIDDEN', 'TLS 跳过校验必须携带当前工作流的 ExecutionGrant', {
      policy: 'workflow.tls.insecure',
      reason: 'execution_grant_required',
    });
  }
  try {
    await context.executionGrantService.validate({
      grantId: context.executionGrantId,
      tenantId: context.tenantId,
      planId: context.planId,
      runId: context.runId ?? '',
      stepId: context.stepId ?? '',
      targetId: context.targetId,
      workflowVersionId: context.workflowVersionId,
      executorType: '017.CURL_HTTP',
      action: 'workflow.tls.insecure',
    });
  } catch (error) {
    throw new AppError('AUTH_FORBIDDEN', 'TLS 跳过校验的宿主 ExecutionGrant 无效', {
      policy: 'workflow.tls.insecure',
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

async function validateCookieSessionAuthorization(request: CurlExecutionRequest, context: CurlSecretResolverContext): Promise<void> {
  if (!request.template.cookieSessionRef) return;
  if (!context.executionGrantId || !context.executionGrantService || !context.tenantId || !context.runId || !context.stepId || !context.workflowVersionId) {
    throw new AppError('AUTH_FORBIDDEN', 'CookieSession 必须绑定当前工作流步骤的 ExecutionGrant', { action: 'http.cookie.session' });
  }
  try {
    await context.executionGrantService.validate({
      grantId: context.executionGrantId,
      tenantId: context.tenantId,
      runId: context.runId,
      stepId: context.stepId,
      workflowVersionId: context.workflowVersionId,
      executorType: '017.CURL_HTTP',
      action: 'http.cookie.session',
    });
  } catch (error) {
    throw new AppError('AUTH_FORBIDDEN', 'CookieSession ExecutionGrant 无效', { action: 'http.cookie.session', reason: error instanceof Error ? error.message : String(error) });
  }
}

function validateAuth(auth: HttpAuthConfig | undefined): void {
  if (!auth || auth.type === 'none') return;
  if (auth.type === 'basic') {
    if (!auth.username || !isSecretRef(auth.secretRef)) throw new AppError('SECRET_REF_INVALID', 'Basic 认证必须提供用户名和 SecretRef');
  }
  if (auth.type === 'bearer' || auth.type === 'cookie') {
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
  const url = resolveRequestUrl(request.template, variables);
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
  if (request.template.cookieSessionRef) headerNames.add('Cookie');
  return {
    method: request.template.method ?? 'GET',
    url: url.toString(),
    headerNames: [...headerNames].sort(),
    hasBody: bodyType !== 'none',
    bodyType,
    timeoutMs: request.template.timeoutMs ?? defaultTimeoutMs,
    tlsVerify: url.protocol === 'https:' && request.template.tls?.verify !== false,
  };
}

async function prepareRequest(
  request: CurlExecutionRequest,
  resolver?: CurlSecretResolver,
  context: CurlSecretResolverContext = {},
  artifactStore?: Pick<CertificateArtifactStore, 'get'>,
): Promise<PreparedRequest> {
  const variables = request.variables ?? {};
  const secrets = request.secrets ?? {};
  const redactionValues: string[] = [];
  const url = resolveRequestUrl(request.template, variables);
  for (const [key, value] of Object.entries(request.template.query ?? {})) url.searchParams.set(key, renderTemplate(String(value), variables));
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.template.headers ?? {})) headers[key] = renderTemplate(value, variables);
  for (const [key, ref] of Object.entries(request.template.headerRefs ?? {})) {
    const secret = await getSecret(ref, secrets, resolver, context, 'http.header');
    headers[key] = secretString(secret, ['value', 'token', 'apiKey']);
    redactionValues.push(headers[key]!);
  }
  await applyAuth(request.template.auth, url, headers, secrets, redactionValues, variables, resolver, context);

  const cookieSessionRef = request.template.cookieSessionRef;
  const cookieJar = cookieSessionRef
    ? context.cookieSessionStore?.getOrCreate({
        tenantId: context.tenantId ?? '',
        runId: context.runId ?? '',
        workflowVersionId: context.workflowVersionId ?? '',
        cookieSessionRef,
      })
    : undefined;
  if (cookieSessionRef && !cookieJar) throw new AppError('AUTH_FORBIDDEN', 'CookieSession 缺少当前租户、运行和工作流版本授权上下文');

  const bodyType: 'json' | 'form' | 'multipart' | 'raw' | 'none' = request.template.bodyType ?? inferBodyType(request.template);
  const artifactLogLines: string[] = [];
  const body = await buildBody(request.template, bodyType, variables, secrets, headers, redactionValues, resolver, context, artifactStore, artifactLogLines);
  const timeoutMs = request.template.timeoutMs ?? defaultTimeoutMs;
  const usesTls = url.protocol === 'https:';
  const tlsVerify = usesTls && request.template.tls?.verify !== false;
  const tls = usesTls ? await resolveTlsOptions(request.template, secrets, resolver, context, redactionValues) : undefined;
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
    artifactLogLines,
    cookieJar,
    cookieSessionRef,
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

function resolveRequestUrl(
  template: HttpRequestTemplate,
  variables: Record<string, Primitive>,
  allowUnresolvedVariables = false,
): URL {
  const rendered = renderTemplate(template.url, variables, false, allowUnresolvedVariables);
  const connection = template.connection;
  // 连接快照是地址的唯一权威来源，绝对 URL 会绕过主机、端口和协议事实，必须拒绝。
  if (connection && isAbsoluteUrl(rendered)) {
    throw new AppError('VALIDATION_FAILED', '带连接上下文的 HTTP 请求 URL 必须是相对路径', { url: template.url });
  }
  try {
    const absolute = new URL(rendered);
    if (connection && absolute.hostname === connection.host && normalizePort(absolute) === connection.port) {
      absolute.protocol = connection.tlsEnabled ? 'https:' : 'http:';
    }
    return absolute;
  } catch {
    if (!connection) throw new AppError('VALIDATION_FAILED', 'HTTP 请求 URL 必须是完整 URL，或由连接快照提供路径和主机', { url: template.url });
    const path = rendered.startsWith('/') ? rendered : `/${rendered}`;
    const protocol = connection.tlsEnabled ? 'https' : 'http';
    return new URL(`${protocol}://${connection.host}:${connection.port}${path}`);
  }
}

function isAbsoluteUrl(value: string): boolean {
  const trimmed = value.trim();
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(trimmed) || trimmed.startsWith('//');
}

function normalizePort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === 'https:' ? 443 : 80;
}

async function applyAuth(
  auth: HttpAuthConfig | undefined,
  url: URL,
  headers: Record<string, string>,
  secrets: CurlExecutionRequest['secrets'],
  redactionValues: string[],
  variables: Record<string, Primitive>,
  resolver?: CurlSecretResolver,
  context: CurlSecretResolverContext = {},
): Promise<void> {
  if (!auth || auth.type === 'none') return;
  if (auth.type === 'basic') {
    const secret = await getSecret(auth.secretRef, secrets, resolver, context, 'http.auth.basic');
    const username = renderTemplate(auth.username, variables, false);
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
  artifactStore?: Pick<CertificateArtifactStore, 'get'>,
  artifactLogLines: string[] = [],
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
    for (const [key, ref] of Object.entries(template.formSecretRefs ?? {})) {
      const value = secretString(await getSecret(ref, secrets, resolver, context, `http.form.${key}`), ['password', 'value', 'token', 'apiKey']);
      params.set(key, value);
      redactionValues.push(value);
    }
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
      } else if (part.artifactRef !== undefined) {
        const renderedArtifactRef = renderTemplate(part.artifactRef, variables);
        if (renderedArtifactRef.startsWith('artifact://')) {
          if (!artifactStore || !context.tenantId) throw new AppError('AUTH_FORBIDDEN', 'multipart Artifact 读取需要宿主 ArtifactStore 和租户上下文');
          await validateArtifactAccess(renderedArtifactRef, context);
          const artifact = await artifactStore.get(renderedArtifactRef, context.tenantId);
          if (!artifact) throw new AppError('RESOURCE_NOT_FOUND', 'multipart Artifact 不存在或不属于当前租户');
          value = artifact.content.toString('utf8');
          verifyArtifactContent(value, artifact.content, part.artifactSha256, key);
          artifactLogLines.push(buildArtifactLogLine(part.filename ?? key, artifact.content));
        } else {
          const content = Buffer.from(renderedArtifactRef, 'utf8');
          if (!isPemContent(renderedArtifactRef)) throw new AppError('VALIDATION_FAILED', 'multipart artifactRef 只能引用 artifact:// 或 PEM 内容，禁止本地路径');
          verifyArtifactContent(renderedArtifactRef, content, part.artifactSha256, key);
          value = renderedArtifactRef;
          artifactLogLines.push(buildArtifactLogLine(part.filename ?? key, content));
        }
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

const maxMultipartArtifactBytes = 5 * 1024 * 1024;

function verifyArtifactContent(text: string, content: Buffer, expectedSha256: string | undefined, field: string): void {
  if (content.byteLength > maxMultipartArtifactBytes) throw new AppError('VALIDATION_FAILED', 'multipart Artifact 超过 5 MiB 大小限制', { field });
  if (!isPemContent(text)) throw new AppError('VALIDATION_FAILED', 'multipart Artifact 不是受控 PEM 内容', { field });
  if (expectedSha256) {
    const actual = createSha256(content);
    const expected = expectedSha256.replace(/^sha256:/i, '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expected) || actual !== expected) throw new AppError('VALIDATION_FAILED', 'multipart Artifact SHA-256 校验失败', { field });
  }
}

function isPemContent(value: string): boolean {
  return /^\s*-----BEGIN [A-Z0-9 ]+-----/.test(value);
}

function createSha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

async function validateArtifactAccess(artifactRef: string, context: CurlSecretResolverContext): Promise<void> {
  if (!context.executionGrantService) return;
  if (!context.executionGrantId || !context.tenantId || !context.runId || !context.stepId || !context.workflowVersionId) {
    throw new AppError('AUTH_FORBIDDEN', 'multipart Artifact 必须绑定当前工作流步骤的 ExecutionGrant');
  }
  try {
    await context.executionGrantService.validate({
      grantId: context.executionGrantId,
      tenantId: context.tenantId,
      runId: context.runId,
      stepId: context.stepId,
      workflowVersionId: context.workflowVersionId,
      executorType: '017.CURL_HTTP',
      artifactRef,
      action: 'workflow.step.execute',
    });
  } catch (error) {
    throw new AppError('AUTH_FORBIDDEN', 'multipart Artifact ExecutionGrant 无效', { reason: error instanceof Error ? error.message : String(error) });
  }
}

function buildArtifactLogLine(filename: string, content: Buffer): string {
  const safeFilename = filename.replace(/[\r\n]/g, ' ').slice(0, 256);
  return `multipart:artifact:filename:${safeFilename}:bytes:${content.byteLength}:sha256:${createSha256(content)}`;
}

async function sendHttpRequest(prepared: PreparedRequest, httpClient: CurlHttpClient): Promise<AttemptOutcome> {
  try {
    const response = await httpClient.send({
      url: prepared.url,
      method: prepared.method,
      headers: prepared.headers,
      body: prepared.body,
      timeoutMs: prepared.timeoutMs,
      ...(prepared.tls ? {
        tls: {
          verify: prepared.tlsVerify,
          ca: prepared.tls.ca,
          cert: prepared.tls.cert,
          key: prepared.tls.key,
          servername: prepared.tls.servername,
        },
      } : {}),
    });
    const normalized = normalizeResponse(response);
    return { response: normalized, retryable: shouldRetryStatus(normalized.statusCode, normalizeRetryPolicy(undefined, prepared.method)) };
  } catch (error) {
    return classifyFetchError(error);
  }
}

function refreshCookieHeader(prepared: PreparedRequest): void {
  if (!prepared.cookieJar) return;
  const value = prepared.cookieJar.getCookieHeader(prepared.url);
  if (value) prepared.headers.Cookie = value;
  else deleteHeader(prepared.headers, 'cookie');
  for (const redactionValue of prepared.cookieJar.getRedactionValues(prepared.url)) {
    if (redactionValue && !prepared.redactionValues.includes(redactionValue)) prepared.redactionValues.push(redactionValue);
  }
}

function updateCookieJar(prepared: PreparedRequest, response: HttpResponse): void {
  if (!prepared.cookieJar || !response.setCookie || response.setCookie.length === 0) return;
  for (const header of response.setCookie) {
    const pair = header.split(';', 1)[0]?.trim() ?? '';
    const separator = pair.indexOf('=');
    if (separator > 0) {
      for (const value of [pair, pair.slice(separator + 1)]) {
        if (value && !prepared.redactionValues.includes(value)) prepared.redactionValues.push(value);
      }
    }
  }
  prepared.cookieJar.setCookies(response.setCookie, prepared.url);
}

function sanitizeRuntimeResponse(response: HttpResponse, redactionValues: string[]): HttpResponse {
  const headers = Object.fromEntries(Object.entries(response.headers ?? {}).filter(([key]) => key.toLowerCase() !== 'set-cookie' && key.toLowerCase() !== 'cookie'));
  const bodyText = response.bodyText === undefined ? undefined : maskText(response.bodyText, redactionValues);
  const bodyJson = response.bodyJson === undefined ? undefined : maskCookieUnknown(response.bodyJson, redactionValues);
  const body = typeof response.body === 'string'
    ? maskText(response.body, redactionValues)
    : response.body === undefined
      ? undefined
      : maskCookieUnknown(response.body, redactionValues);
  return {
    ...response,
    headers,
    setCookie: undefined,
    ...(bodyText !== undefined ? { bodyText } : {}),
    ...(bodyJson !== undefined ? { bodyJson } : {}),
    ...(body !== undefined ? { body } : {}),
  };
}

function maskCookieUnknown(value: unknown, redactionValues: string[]): unknown {
  if (typeof value === 'string') return maskText(value, redactionValues);
  if (Array.isArray(value)) return value.map((item) => maskCookieUnknown(item, redactionValues));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      /^(?:set-)?cookie$/i.test(key) ? '[REDACTED]' : maskCookieUnknown(child, redactionValues),
    ]));
  }
  return value;
}

function buildResponseResult(request: CurlExecutionRequest, prepared: PreparedRequest, response: HttpResponse, attempts: number, logs: string[]): CurlExecutionResult {
  const normalized = normalizeResponse(response);
  const responseBytes = Buffer.byteLength(normalized.bodyText ?? JSON.stringify(normalized.body ?? ''), 'utf8');
  if (responseBytes > prepared.maxResponseBytes) {
    return { ...baseResult(prepared.rendered, logs, attempts), success: false, statusCode: normalized.statusCode, responseBytes, errorCode: 'HTTP_RESPONSE_TOO_LARGE', errorMessage: 'HTTP 响应超过大小限制' };
  }
  const successCodes = request.responsePolicy?.successStatusCodes ?? (request.responsePolicy?.failOnNon2xx === false ? [normalized.statusCode] : defaultSuccessCodes);
  const assertions = evaluateAssertions(normalized, request.responsePolicy?.assertions ?? []);
  const success = successCodes.includes(normalized.statusCode) && assertions.every((item) => item.passed);
  const extracted = runExtractors(normalized, request.extractors ?? [], success);
  const responseRedactionValues = collectSensitiveExtractorValues(normalized, request.extractors ?? []);
  const redactionValues = [...prepared.redactionValues, ...responseRedactionValues];
  const responseLogs = [
    ...logs,
    `response:status:${normalized.statusCode}`,
    ...vendorResponseLogLines(normalized.bodyJson ?? normalized.body, redactionValues),
  ];
  return {
    success,
    rendered: prepared.rendered,
    statusCode: normalized.statusCode,
    headers: maskHeaders(normalized.headers ?? {}, redactionValues),
    bodyText: maskText(normalized.bodyText ?? '', redactionValues),
    bodyJson: maskUnknown(normalized.bodyJson, redactionValues),
    responseBytes,
    attempts,
    retryable: shouldRetryStatus(normalized.statusCode, normalizeRetryPolicy(request.retryPolicy, prepared.method)),
    errorCode: success ? undefined : 'HTTP_NON_SUCCESS_STATUS',
    errorMessage: success
      ? undefined
      : `HTTP 响应未满足成功策略：status=${normalized.statusCode}, expected=${successCodes.join(',')}，response=${summarizeHttpResponse(normalized, redactionValues)}`,
    assertions,
    extracted,
    logs: responseLogs,
  };
}

/**
 * 失败消息只保留可定位的响应形状和厂商错误摘要，不复制完整响应体。
 * 响应体可能包含 Cookie、令牌或目标系统返回的敏感字段，必须先按字段名和
 * Secret 值脱敏，再限制摘要长度。
 */
function summarizeHttpResponse(response: HttpResponse, redactionValues: string[]): string {
  const body = response.bodyJson ?? response.body;
  const bodyText = response.bodyText ?? '';
  const bodyType = response.bodyJson !== undefined ? 'json' : bodyText.trim() ? 'text' : 'empty';
  const shape = JSON.stringify(sanitizeSummaryShape(summarizeValueShape(body)));
  const parts = [`type=${bodyType}`, `bytes=${Buffer.byteLength(bodyText, 'utf8')}`, `shape=${shape}`];
  const error = isRecord(body) && isRecord(body.error) ? body.error : isRecord(body) ? body : undefined;
  const code = error && ['code', 'errorcode', 'status'].map((key) => error[key]).find((value) => typeof value === 'number' || typeof value === 'string');
  if (code !== undefined) parts.push(`errorCode=${String(code).slice(0, 32)}`);
  const message = error && ['message', 'error_description', 'detail'].map((key) => error[key]).find((value) => typeof value === 'string');
  if (typeof message === 'string' && message.trim()) {
    parts.push(`message=${sanitizeDiagnosticText(message, redactionValues)}`);
  }
  return parts.join(';');
}

function sanitizeSummaryShape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeSummaryShape(item));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    if (key === 'keys' && Array.isArray(child)) {
      return [key, child.map((item) => typeof item === 'string' && isSensitiveKey(item) ? '[REDACTED_FIELD]' : item)];
    }
    if (key === 'children' && isRecord(child)) {
      return [key, Object.fromEntries(Object.entries(child).map(([childKey, childValue]) => [
        isSensitiveKey(childKey) ? '[REDACTED_FIELD]' : childKey,
        sanitizeSummaryShape(childValue),
      ]))];
    }
    return [key, sanitizeSummaryShape(child)];
  }));
}

function sanitizeDiagnosticText(value: string, redactionValues: string[]): string {
  return maskText(value, redactionValues)
    .replace(/\b(authorization|cookie|password|secret|token|api[_-]?key)\b/gi, '[REDACTED_FIELD]')
    .replace(/\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9._-]{8,}\b/g, '[REDACTED_JWT]')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 160);
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
  const setCookie = response.setCookie
    ?? (response.headers ? Object.entries(response.headers).find(([key]) => key.toLowerCase() === 'set-cookie')?.[1].split(/\r?\n(?=[^\s])/g) : undefined);
  return { ...response, headers: response.headers ?? {}, ...(setCookie && setCookie.length > 0 ? { setCookie } : {}), bodyText, bodyJson, body: response.body ?? bodyJson ?? bodyText };
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
    const actual = String(response.bodyText ?? response.body ?? '');
    return { type: assertion.type, passed: actual.includes(assertion.text) || actual.toLowerCase().includes(assertion.text.toLowerCase()), message: 'body contains' };
  });
}

function vendorResponseLogLines(body: unknown, redactionValues: string[]): string[] {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return [];
  const record = body as Record<string, unknown>;
  const lines: string[] = [];
  if (typeof record.errorcode === 'number') lines.push(`response:nitroErrorCode:${record.errorcode}`);
  if (typeof record.message === 'string' && record.message.length > 0) {
    lines.push(`response:nitroMessage:${maskText(record.message, redactionValues)}`);
  }
  return lines;
}

function runExtractors(response: HttpResponse, extractors: HttpExtractor[], enforceRequired = true): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const extractor of extractors) {
    const value = readExtractorValue(response, extractor);
    if ((value === undefined || value === null) && extractor.required && enforceRequired) throw buildRequiredExtractorError(extractor, response);
    if (value !== undefined && value !== null) output[extractor.name] = extractor.secret ? '[SECRET_CAPTURED]' : value;
  }
  return output;
}

function collectSensitiveExtractorValues(response: HttpResponse, extractors: HttpExtractor[]): string[] {
  return extractors
    .filter((extractor) => extractor.secret)
    .map((extractor) => readExtractorValue(response, extractor))
    .filter((value): value is string | number | boolean => ['string', 'number', 'boolean'].includes(typeof value))
    .map(String)
    .filter(Boolean);
}

function readExtractorValue(response: HttpResponse, extractor: HttpExtractor): unknown {
  if (extractor.source === 'status') return response.statusCode;
  if (extractor.source === 'header') return getHeader(response.headers, extractor.header ?? extractor.path ?? '');
  if (extractor.source === 'json' || (extractor.source === 'body' && extractor.path)) {
    return readJsonPath(response.bodyJson ?? response.body, extractor.path ?? '');
  }
  if (extractor.pattern) return String(response.bodyText ?? response.body ?? '').match(new RegExp(extractor.pattern))?.[1];
  return undefined;
}

function buildRequiredExtractorError(extractor: HttpExtractor, response: HttpResponse): AppError {
  const detail = {
    extractor: extractor.name,
    source: extractor.source,
    ...(extractor.path ? { path: extractor.path } : {}),
    ...(extractor.header ? { header: extractor.header } : {}),
    ...(extractor.pattern ? { pattern: extractor.pattern } : {}),
    responseStatusCode: response.statusCode,
    responseHeaderNames: Object.keys(response.headers ?? {}),
    responseBodyShape: summarizeValueShape(response.bodyJson ?? response.body),
    responseTextLength: String(response.bodyText ?? response.body ?? '').length,
  };
  return new AppError(
    'WORKFLOW_ASSERTION_FAILED',
    `必需提取变量失败：extractor=${extractor.name}，source=${extractor.source}${describeHttpExtractorRule(extractor)}`,
    detail,
  );
}

function describeHttpExtractorRule(extractor: HttpExtractor): string {
  if (extractor.path) return `，path=${extractor.path}`;
  if (extractor.header) return `，header=${extractor.header}`;
  if (extractor.pattern) return `，pattern=${extractor.pattern}`;
  return '';
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

function renderTemplate(value: string, variables: Record<string, Primitive>, encode = false, allowUnresolvedVariables = false): string {
  return value.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key: string) => {
    const found = variables[key];
    if (found === undefined) {
      if (allowUnresolvedVariables) return `{{${key}}}`;
      throw new AppError('VALIDATION_FAILED', `变量缺失：${key}`, { key });
    }
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

function deleteHeader(headers: Record<string, string>, name: string): void {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) if (key.toLowerCase() === lower) delete headers[key];
}

function maskHeaders(headers: Record<string, string>, redactionValues: string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, isSensitiveKey(key) ? '[REDACTED]' : maskText(value, redactionValues)]));
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
  if (template.form || template.formSecretRefs) return 'form';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function summarizeValueShape(value: unknown, depth = 0): unknown {
  if (value === null) return { type: 'null' };
  if (value === undefined) return { type: 'undefined' };
  if (typeof value === 'string') return { type: 'string', length: value.length };
  if (typeof value === 'number' || typeof value === 'boolean') return { type: typeof value };
  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      ...(depth >= 1 || value.length === 0 ? {} : { firstItem: summarizeValueShape(value[0], depth + 1) }),
    };
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    return {
      type: 'object',
      keys: keys.slice(0, 12),
      ...(depth >= 1 ? {} : {
        children: Object.fromEntries(keys.slice(0, 6).map((key) => [key, summarizeValueShape(value[key], depth + 1)])),
      }),
    };
  }
  return { type: typeof value };
}

function hash(value: string): number {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) result = ((result << 5) - result + value.charCodeAt(index)) | 0;
  return result;
}
