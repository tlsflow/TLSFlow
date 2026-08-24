import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, normalize, resolve } from 'node:path';
import { URL } from 'node:url';
import type { AppConfig } from '../../config/app-config.js';
import { loadAppConfig } from '../../config/app-config.js';
import { AppError } from '../errors/app-error.js';
import { toErrorResponse } from '../errors/error-handler.js';
import { generateRequestId, generateTraceId, runWithRequestContext, type RequestContext } from '../tracing/request-context.js';
import { Router } from './router.js';
import type { HttpRequest } from './http-types.js';
import type { TenantScope } from '../../shared/security-types.js';

export interface InjectRequest {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface InjectResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  stream?: (response: ServerResponse) => Promise<void> | void;
}

export type AuthTokenResolver = (
  authorization: string | undefined,
  cookie: string | undefined,
) => Promise<{ actorId: string; tenantId?: string; tenantScope?: TenantScope; contextVersion?: string } | undefined>
  | { actorId: string; tenantId?: string; tenantScope?: TenantScope; contextVersion?: string }
  | undefined;
export type AgentTokenResolver = (
  token: string,
  request: { method: string; path: string },
) => Promise<{ actorId: string; tenantId: string } | undefined>
  | { actorId: string; tenantId: string }
  | undefined;
export type PersistenceFlusher = { flush: () => Promise<void> };

export interface AppOptions {
  config?: AppConfig;
  /**
   * 仅供旧测试入口显式开启，真实 HTTP Server 永远不会使用请求头装配身份。
   */
  allowLegacyHeaderContext?: boolean;
}

export class App {
  readonly router = new Router();
  readonly config: AppConfig;
  private readonly allowLegacyHeaderContext: boolean;
  private authTokenResolver?: AuthTokenResolver;
  private agentTokenResolver?: AgentTokenResolver;
  private readonly persistenceFlushers: PersistenceFlusher[] = [];
  private readonly resources = new Map<string, unknown>();

  constructor(options: AppOptions = {}) {
    this.config = options.config ?? loadAppConfig();
    this.allowLegacyHeaderContext = options.allowLegacyHeaderContext === true;
  }

  setAuthTokenResolver(resolver: AuthTokenResolver): void {
    this.authTokenResolver = resolver;
  }

  setAgentTokenResolver(resolver: AgentTokenResolver): void {
    this.agentTokenResolver = resolver;
  }

  registerPersistenceFlusher(flusher: PersistenceFlusher): void {
    this.persistenceFlushers.push(flusher);
  }

  setResource<T>(key: string, value: T): void {
    this.resources.set(key, value);
  }

  getResource<T>(key: string): T | undefined {
    return this.resources.get(key) as T | undefined;
  }

  async handle(request: HttpRequest): Promise<InjectResponse> {
    return runWithRequestContext(request.context, async () => {
      const route = this.router.match(request.method, request.path);
      if (!route) {
        const handled = toErrorResponse(new AppError('RESOURCE_NOT_FOUND', '接口不存在', { path: request.path }), request.context.requestId);
        return this.respond(handled.statusCode, handled.body, request.context);
      }
      try {
        const result = await route.handler(request);
        await this.flushPersistence();
        if (isResponseBody(result)) return this.respond(result.statusCode ?? 200, await resolveBody(result.body), request.context, result.headers, result.stream);
        return this.respond(200, await resolveBody(result), request.context);
      } catch (error) {
        const handled = toErrorResponse(error, request.context.requestId);
        return this.respond(handled.statusCode, handled.body, request.context);
      }
    });
  }

  async inject(input: InjectRequest): Promise<InjectResponse> {
    const url = new URL(input.path, 'http://localhost');
    const requestId = input.headers ? readHeader(input.headers, 'x-request-id') ?? generateRequestId() : generateRequestId();
    let context: RequestContext;
    try {
      context = await this.createContext(
        input.headers ?? {},
        input.method.toUpperCase(),
        url.pathname,
        '127.0.0.1',
        this.allowLegacyHeaderContext,
      );
    } catch (error) {
      const handled = toErrorResponse(error, requestId);
      return this.respond(handled.statusCode, handled.body, {
        requestId,
        traceId: input.headers ? readHeader(input.headers, 'x-trace-id') ?? generateTraceId() : generateTraceId(),
      });
    }
    return this.handle({
      method: input.method.toUpperCase(),
      path: url.pathname,
      query: parseQuery(url.searchParams),
      headers: input.headers ?? {},
      body: input.body,
      context,
    });
  }

  createNodeServer() {
    return createServer(async (req, res) => {
      const host = req.headers.host ?? 'localhost';
      const url = new URL(req.url ?? '/', `http://${host}`);
      const method = (req.method ?? 'GET').toUpperCase();
      const route = this.router.match(method, url.pathname);
      const isApiPath = url.pathname === '/api' || url.pathname.startsWith('/api/');
      const staticResponse = !route && ['GET', 'HEAD'].includes(method) && !isApiPath
        ? await this.tryServeStatic(url.pathname, method === 'HEAD', req.headers)
        : undefined;
      if (staticResponse) {
        writeNodeResponse(res, staticResponse);
        return;
      }
      const body = await readJsonBody(req);
      let context: RequestContext;
      try {
        context = await this.createContext(
          req.headers,
          method,
          url.pathname,
          req.socket.remoteAddress,
          false,
        );
      } catch (error) {
        const requestId = readHeader(req.headers, 'x-request-id') ?? generateRequestId();
        const traceId = readHeader(req.headers, 'x-trace-id') ?? generateTraceId();
        const handled = toErrorResponse(error, requestId);
        writeNodeResponse(res, this.respond(handled.statusCode, handled.body, { requestId, traceId }));
        return;
      }
      const response = await this.handle({
        method: req.method ?? 'GET',
        path: url.pathname,
        query: parseQuery(url.searchParams),
        headers: req.headers,
        body,
        context,
      });
      if (response.stream) {
        res.statusCode = response.statusCode;
        for (const [key, value] of Object.entries(response.headers)) res.setHeader(key, value);
        await response.stream(res);
        return;
      }
      writeNodeResponse(res, response);
    });
  }

  private async tryServeStatic(
    requestPath: string,
    headOnly: boolean,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<InjectResponse | undefined> {
    const webRoot = this.config.webRoot;
    if (!webRoot) return undefined;
    const context = {
      requestId: readHeader(headers, 'x-request-id') ?? generateRequestId(),
      traceId: readHeader(headers, 'x-trace-id') ?? generateTraceId(),
    };
    const normalizedRoot = resolve(webRoot);
    let relativePath: string;
    try {
      relativePath = decodeURIComponent(requestPath).replace(/^\/+/u, '');
    } catch {
      return this.respond(400, 'Bad Request', context, { 'content-type': 'text/plain; charset=utf-8' });
    }
    const candidate = resolve(normalizedRoot, normalize(relativePath));
    if (!isWithinRoot(normalizedRoot, candidate)) {
      return this.respond(404, 'Not Found', context, { 'content-type': 'text/plain; charset=utf-8' });
    }
    const file = await readStaticFile(candidate);
    const fallback = !file && extname(requestPath) === ''
      ? await readStaticFile(resolve(normalizedRoot, 'index.html'))
      : undefined;
    const selected = file ?? fallback;
    if (!selected) return undefined;
    return this.respond(200, headOnly ? '' : selected.content, context, {
      'content-type': selected.contentType,
      'content-length': String(selected.content.length),
      'cache-control': file ? staticCacheControl(requestPath) : 'no-cache',
    });
  }

  private async createContext(
    headers: Record<string, string | string[] | undefined>,
    method: string,
    path: string,
    ip?: string,
    allowLegacyHeaderContext = false,
  ): Promise<RequestContext> {
    const requestId = readHeader(headers, 'x-request-id') ?? generateRequestId();
    const traceId = readHeader(headers, 'x-trace-id') ?? generateTraceId();
    const authorization = readHeader(headers, 'authorization');
    const cookie = readHeader(headers, 'cookie');
    const tokenIdentity = await this.authTokenResolver?.(authorization, cookie);
    const agentToken = readHeader(headers, 'x-agent-token')?.trim();
    const agentIdentity = !tokenIdentity && agentToken
      ? await this.agentTokenResolver?.(agentToken, { method, path })
      : undefined;
    const hasAuthenticationMaterial = Boolean(authorization?.trim() || cookie?.trim() || agentToken);
    const legacyContext = allowLegacyHeaderContext && !hasAuthenticationMaterial
      ? {
        tenantId: readHeader(headers, 'x-tenant-id'),
        actorId: readHeader(headers, 'x-actor-id'),
      }
      : {};
    return {
      requestId,
      traceId,
      tenantId: tokenIdentity?.tenantId ?? agentIdentity?.tenantId ?? legacyContext.tenantId,
      tenantScope: tokenIdentity?.tenantScope,
      tenantContextVersion: tokenIdentity?.contextVersion,
      actorId: tokenIdentity?.actorId ?? agentIdentity?.actorId ?? legacyContext.actorId,
      actorType: tokenIdentity
        ? 'USER'
        : agentIdentity
          ? 'AGENT'
        : readHeader(headers, 'x-actor-type') as RequestContext['actorType'] | undefined,
      ip,
      userAgent: readHeader(headers, 'user-agent'),
    };
  }

  private respond(
    statusCode: number,
    body: unknown,
    context: RequestContext,
    headers: Record<string, string> = {},
    stream?: (response: ServerResponse) => Promise<void> | void,
  ): InjectResponse {
    const contentType = headers['content-type'] ?? headers['Content-Type'] ?? 'application/json; charset=utf-8';
    return {
      statusCode,
      headers: {
        'content-type': contentType,
        'x-request-id': context.requestId,
        'x-trace-id': context.traceId,
        ...headers,
      },
      body,
      stream,
    };
  }

  private async flushPersistence(): Promise<void> {
    for (const flusher of this.persistenceFlushers) {
      await flusher.flush();
    }
  }
}

function isResponseBody(
  value: unknown,
): value is { statusCode?: number; headers?: Record<string, string>; body?: unknown; stream?: (response: ServerResponse) => Promise<void> | void } {
  return Boolean(
    value
      && typeof value === 'object'
      && ('statusCode' in value || 'body' in value || 'headers' in value || 'stream' in value),
  );
}

async function resolveBody<T>(value: T | Promise<T>): Promise<T> {
  return await value;
}

function parseQuery(searchParams: URLSearchParams): Record<string, string | string[] | undefined> {
  const output: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of searchParams.entries()) {
    const current = output[key];
    if (current === undefined) output[key] = value;
    else output[key] = Array.isArray(current) ? [...current, value] : [current, value];
  }
  return output;
}

function readHeader(headers: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const value = headers[key] ?? headers[key.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method ?? '')) return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError('VALIDATION_FAILED', '请求体必须是合法 JSON');
  }
}

function writeNodeResponse(res: ServerResponse, response: InjectResponse): void {
  res.statusCode = response.statusCode;
  for (const [key, value] of Object.entries(response.headers)) res.setHeader(key, value);
  const contentType = String(response.headers['content-type'] ?? 'application/json; charset=utf-8').toLowerCase();
  if (contentType.startsWith('application/json')) {
    res.end(JSON.stringify(response.body ?? null));
    return;
  }
  if (typeof response.body === 'string' || Buffer.isBuffer(response.body)) {
    res.end(response.body);
    return;
  }
  res.end(String(response.body ?? ''));
}

async function readStaticFile(filePath: string): Promise<{ content: Buffer; contentType: string } | undefined> {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return undefined;
    const content = await readFile(filePath);
    return { content, contentType: mimeType(extname(filePath)) };
  } catch {
    return undefined;
  }
}

function isWithinRoot(root: string, candidate: string): boolean {
  const prefix = root.endsWith('\\') || root.endsWith('/') ? root : `${root}${process.platform === 'win32' ? '\\' : '/'}`;
  return candidate === root || candidate.startsWith(prefix);
}

function mimeType(extension: string): string {
  const types: Record<string, string> = {
    '.css': 'text/css; charset=utf-8',
    '.gif': 'image/gif',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  };
  return types[extension.toLowerCase()] ?? 'application/octet-stream';
}

function staticCacheControl(requestPath: string): string {
  return /\.[a-f0-9]{8,}\.(?:css|js)$/iu.test(requestPath)
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=3600';
}
