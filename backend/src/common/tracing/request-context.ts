import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { TenantScope } from '../../shared/security-types.js';

export interface RequestContext {
  requestId: string;
  traceId: string;
  tenantId?: string;
  tenantScope?: TenantScope;
  tenantContextVersion?: string;
  actorId?: string;
  actorType?: 'USER' | 'AGENT' | 'SYSTEM';
  ip?: string;
  userAgent?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function generateRequestId(now: Date = new Date()): string {
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `req_${date}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function generateTraceId(): string {
  return `trace_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

export function runWithRequestContext<T>(context: RequestContext, callback: () => T): T {
  return storage.run(context, callback);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
