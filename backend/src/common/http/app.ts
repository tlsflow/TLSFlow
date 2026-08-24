import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import type { AppConfig } from '../../config/app-config.js';
import { loadAppConfig } from '../../config/app-config.js';
import { AppError } from '../errors/app-error.js';
import { toErrorResponse } from '../errors/error-handler.js';
import { generateRequestId, generateTraceId, runWithRequestContext, type RequestContext } from '../tracing/request-context.js';
import { Router } from './router.js';
import type { HttpRequest } from './http-types.js';

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
}

export type AuthTokenResolver = (authorization: string | undefined) => { actorId: string; tenantId?: string } | undefined;
export type PersistenceFlusher = { flush: () => Promise<void> };

export class App {
  readonly router = new Router();
  readonly config: AppConfig;
  private authTokenResolver?: AuthTokenResolver;
  private readonly persistenceFlushers: PersistenceFlusher[] = [];

  constructor(config: AppConfig = loadAppConfig()) {
    this.config = config;
  }

  setAuthTokenResolver(resolver: AuthTokenResolver): void {
    this.authTokenResolver = resolver;
  }

  registerPersistenceFlusher(flusher: PersistenceFlusher): void {
    this.persistenceFlushers.push(flusher);
  }

  async handle(request: HttpRequest): Promise<InjectResponse> {
    return runWithRequestContext(request.context, async () => {
      const route = this.router.match(request.method, request.path);
      if (!route) {
        const handled = toErrorResponse(new AppError('RESOURCE_NOT_FOUND', '接口不存在', { path: request.path }), request.context.requestId);
        return this.json(handled.statusCode, handled.body, request.context);
      }
      try {
        const result = await route.handler(request);
        await this.flushPersistence();
        if (isResponseBody(result)) return this.json(result.statusCode ?? 200, result.body, request.context, result.headers);
        return this.json(200, result, request.context);
      } catch (error) {
        const handled = toErrorResponse(error, request.context.requestId);
        return this.json(handled.statusCode, handled.body, request.context);
      }
    });
  }

  async inject(input: InjectRequest): Promise<InjectResponse> {
    const url = new URL(input.path, 'http://localhost');
    const context = this.createContext(input.headers ?? {}, '127.0.0.1');
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
      const body = await readJsonBody(req);
      const host = req.headers.host ?? 'localhost';
      const url = new URL(req.url ?? '/', `http://${host}`);
      const context = this.createContext(req.headers, req.socket.remoteAddress);
      const response = await this.handle({
        method: req.method ?? 'GET',
        path: url.pathname,
        query: parseQuery(url.searchParams),
        headers: req.headers,
        body,
        context,
      });
      writeNodeResponse(res, response);
    });
  }

  private createContext(headers: Record<string, string | string[] | undefined>, ip?: string): RequestContext {
    const requestId = readHeader(headers, 'x-request-id') ?? generateRequestId();
    const traceId = readHeader(headers, 'x-trace-id') ?? generateTraceId();
    const tokenIdentity = this.authTokenResolver?.(readHeader(headers, 'authorization'));
    return {
      requestId,
      traceId,
      tenantId: tokenIdentity?.tenantId ?? readHeader(headers, 'x-tenant-id'),
      actorId: tokenIdentity?.actorId ?? readHeader(headers, 'x-actor-id'),
      actorType: readHeader(headers, 'x-actor-type') as RequestContext['actorType'] | undefined,
      ip,
      userAgent: readHeader(headers, 'user-agent'),
    };
  }

  private json(statusCode: number, body: unknown, context: RequestContext, headers: Record<string, string> = {}): InjectResponse {
    return {
      statusCode,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-request-id': context.requestId,
        'x-trace-id': context.traceId,
        ...headers,
      },
      body,
    };
  }

  private async flushPersistence(): Promise<void> {
    for (const flusher of this.persistenceFlushers) {
      await flusher.flush();
    }
  }
}

function isResponseBody(value: unknown): value is { statusCode?: number; headers?: Record<string, string>; body?: unknown } {
  return Boolean(value && typeof value === 'object' && ('statusCode' in value || 'body' in value || 'headers' in value));
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
  if (!['POST', 'PUT', 'PATCH'].includes(req.method ?? '')) return undefined;
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
  res.end(JSON.stringify(response.body ?? null));
}
