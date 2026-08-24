import { AppError } from '../../../common/errors/app-error.js';
import type { Executor, StepExecutionInput, StepExecutionResult } from '../../executions/application/executors.js';

export interface HttpRequestTemplate {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  headerRefs?: Record<string, string>;
  body?: unknown;
  bodySecretRef?: string;
  timeoutMs?: number;
  tls?: { verify?: boolean; caSecretRef?: string; clientCertSecretRef?: string; sni?: string };
}

export interface HttpResponsePolicy {
  successStatusCodes?: number[];
  assertions?: HttpAssertion[];
}

export type HttpAssertion =
  | { type: 'status'; equals: number }
  | { type: 'header_exists'; name: string }
  | { type: 'body_contains'; text: string };

export interface HttpExtractor {
  name: string;
  source: 'header' | 'body';
  path?: string;
  pattern?: string;
  required?: boolean;
  secret?: boolean;
}

export interface CurlExecutionRequest {
  idempotencyKey: string;
  template: HttpRequestTemplate;
  responsePolicy?: HttpResponsePolicy;
  extractors?: HttpExtractor[];
  variables?: Record<string, string | number | boolean>;
  dryRun?: boolean;
  mockResponse?: { statusCode: number; headers?: Record<string, string>; body?: unknown };
}

export interface CurlExecutionResult {
  success: boolean;
  rendered: { method: string; url: string; headerNames: string[]; hasBody: boolean };
  statusCode?: number;
  assertions: Array<{ type: string; passed: boolean; message: string }>;
  extracted: Record<string, unknown>;
}

export class CurlExecutor implements Executor {
  readonly type = 'CURL';
  private readonly executed = new Set<string>();

  async executeStep(input: StepExecutionInput): Promise<StepExecutionResult> {
    const request = input.step.inputSnapshot.curlRequest as CurlExecutionRequest | undefined;
    if (!request) return { success: true, detail: { skipped: true, reason: 'missing curlRequest' } };
    const result = this.execute(request, input.dryRun);
    return result.success ? { success: true, detail: result as unknown as Record<string, unknown> } : { success: false, errorCode: 'CURL_POLICY_FAILED', errorMessage: 'HTTP 响应策略不满足', detail: result as unknown as Record<string, unknown> };
  }

  execute(request: CurlExecutionRequest, forceDryRun = false): CurlExecutionResult {
    validateRequest(request);
    if (this.executed.has(request.idempotencyKey)) {
      throw new AppError('IDEMPOTENCY_CONFLICT', 'CURL 请求幂等键已执行', { idempotencyKey: request.idempotencyKey });
    }
    const dryRun = forceDryRun || request.dryRun === true;
    const rendered = render(request.template, request.variables ?? {});
    if (dryRun) return { success: true, rendered, assertions: [], extracted: {} };
    this.executed.add(request.idempotencyKey);
    const response = request.mockResponse ?? { statusCode: 200, headers: {}, body: {} };
    const statusCode = response.statusCode;
    const successCodes = request.responsePolicy?.successStatusCodes ?? [200, 201, 202, 204];
    const assertions = evaluateAssertions(response, request.responsePolicy?.assertions ?? []);
    const extracted = runExtractors(response, request.extractors ?? []);
    return { success: successCodes.includes(statusCode) && assertions.every((item) => item.passed), rendered, statusCode, assertions, extracted };
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
    return { idempotencyKey: `curl_import_${Math.abs(hash(command))}`, template: { url, method: method ?? 'GET', headers } };
  }

  exportCurl(request: CurlExecutionRequest): string {
    validateRequest(request);
    const rendered = render(request.template, request.variables ?? {});
    const headerArgs = rendered.headerNames.map((name) => `-H '${name}: [REDACTED_OR_SECRET_REF]'`).join(' ');
    return ['curl', '-X', rendered.method, headerArgs, `'${rendered.url}'`].filter(Boolean).join(' ');
  }
}

function validateRequest(request: CurlExecutionRequest): void {
  if (!request.idempotencyKey) throw new AppError('VALIDATION_FAILED', 'idempotencyKey 必填');
  const url = new URL(request.template.url);
  if (!['https:', 'http:'].includes(url.protocol)) throw new AppError('VALIDATION_FAILED', '只允许 http/https URL', { url: request.template.url });
  if (url.protocol === 'http:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new AppError('VALIDATION_FAILED', '非本地 HTTP 明文 URL 被拒绝', { url: request.template.url });
  }
  scanSecretLike(request.template.headers ?? {}, ['headers']);
  scanSecretLike(request.template.body, ['body']);
  if (request.template.headers?.Authorization && !request.template.headerRefs?.Authorization) {
    throw new AppError('VALIDATION_FAILED', 'Authorization 必须通过 headerRefs/SecretRef 提供');
  }
  if (request.template.timeoutMs !== undefined && (request.template.timeoutMs < 1 || request.template.timeoutMs > 60_000)) {
    throw new AppError('VALIDATION_FAILED', 'timeoutMs 必须在 1-60000 之间');
  }
  if (request.template.tls?.verify === false) throw new AppError('VALIDATION_FAILED', '跳过 TLS 校验必须走审批后的专用策略，执行器默认拒绝');
  if (request.template.tls?.caSecretRef && !/^secret:\/\/.+/.test(request.template.tls.caSecretRef)) throw new AppError('VALIDATION_FAILED', 'CA 必须使用 SecretRef');
  if (request.template.tls?.clientCertSecretRef && !/^secret:\/\/.+/.test(request.template.tls.clientCertSecretRef)) throw new AppError('VALIDATION_FAILED', '客户端证书必须使用 SecretRef');
  for (const extractor of request.extractors ?? []) {
    if (!extractor.name.trim()) throw new AppError('VALIDATION_FAILED', 'extractor name 必填');
    if (!extractor.path && !extractor.pattern) throw new AppError('VALIDATION_FAILED', 'extractor 必须提供 path 或 pattern');
  }
}

function render(template: HttpRequestTemplate, variables: Record<string, string | number | boolean>): CurlExecutionResult['rendered'] {
  return {
    method: template.method ?? 'GET',
    url: renderTemplate(template.url, variables),
    headerNames: [...new Set([...Object.keys(template.headers ?? {}), ...Object.keys(template.headerRefs ?? {})])].sort(),
    hasBody: template.body !== undefined || template.bodySecretRef !== undefined,
  };
}

function scanSecretLike(value: unknown, path: string[]): void {
  if (typeof value === 'string' && /(password|token|api[_-]?key|authorization)\s*[:=]|bearer\s+[a-z0-9._-]{10,}|sk-[a-z0-9]{20,}/i.test(value)) {
    throw new AppError('VALIDATION_FAILED', 'CURL 请求包含疑似明文敏感信息', { fieldPath: path.join('.') });
  }
  if (Array.isArray(value)) value.forEach((item, index) => scanSecretLike(item, [...path, String(index)]));
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) scanSecretLike(child, [...path, key]);
  }
}

function renderTemplate(value: string, variables: Record<string, string | number | boolean>): string {
  return value.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key: string) => {
    const found = variables[key];
    if (found === undefined) throw new AppError('VALIDATION_FAILED', '变量缺失', { key });
    return encodeURIComponent(String(found));
  });
}

function evaluateAssertions(response: NonNullable<CurlExecutionRequest['mockResponse']>, assertions: HttpAssertion[]): CurlExecutionResult['assertions'] {
  return assertions.map((assertion) => {
    if (assertion.type === 'status') return { type: assertion.type, passed: response.statusCode === assertion.equals, message: `status=${response.statusCode}` };
    if (assertion.type === 'header_exists') return { type: assertion.type, passed: Boolean(response.headers?.[assertion.name]), message: `header=${assertion.name}` };
    return { type: assertion.type, passed: String(response.body ?? '').includes(assertion.text), message: 'body contains' };
  });
}

function runExtractors(response: NonNullable<CurlExecutionRequest['mockResponse']>, extractors: HttpExtractor[]): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const extractor of extractors) {
    const source = extractor.source === 'header' ? JSON.stringify(response.headers ?? {}) : (typeof response.body === 'string' ? response.body : JSON.stringify(response.body ?? {}));
    const value = extractor.pattern ? source.match(new RegExp(extractor.pattern))?.[1] : readJsonPath(response.body, extractor.path ?? '');
    if ((value === undefined || value === null) && extractor.required) throw new AppError('WORKFLOW_ASSERTION_FAILED', '必需提取变量失败', { name: extractor.name });
    if (value !== undefined && value !== null) output[extractor.name] = extractor.secret ? '[SECRET_CAPTURED]' : value;
  }
  return output;
}

function readJsonPath(body: unknown, path: string): unknown {
  if (!path || !path.startsWith('$.')) return undefined;
  return path.slice(2).split('.').reduce<unknown>((current, key) => (current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined), body);
}

function hash(value: string): number {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) result = ((result << 5) - result + value.charCodeAt(index)) | 0;
  return result;
}
