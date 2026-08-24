import type { IncomingHttpHeaders } from 'node:http';
import type { RequestContext } from '../tracing/request-context.js';

export interface HttpRequest {
  method: string;
  path: string;
  query: Record<string, string | string[] | undefined>;
  headers: IncomingHttpHeaders;
  body?: unknown;
  context: RequestContext;
}

export interface HttpResponseBody {
  statusCode?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export type HttpHandler = (request: HttpRequest) => Promise<HttpResponseBody | unknown> | HttpResponseBody | unknown;

export interface RouteDefinition {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  handler: HttpHandler;
  summary: string;
  tags: string[];
  responses?: Record<string, unknown>;
}
