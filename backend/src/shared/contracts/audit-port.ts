import type { RequestContext } from '../../common/tracing/request-context.js';

export interface AuditResourceRef {
  resourceType: string;
  resourceId: string;
}

export interface AuditPort {
  recordAuditEvent(context: RequestContext, action: string, resource: AuditResourceRef, before: unknown, after: unknown): Promise<void>;
}
