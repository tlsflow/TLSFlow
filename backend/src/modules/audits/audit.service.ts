import { PgliteDatabase } from '../../database/pglite-database.js';
import type { AsyncRepositoryPort } from '../../persistence/repositories/async-repository-port.js';
import { PgDocumentRepository } from '../../persistence/repositories/pg-document-repository.js';
import type { AuditLogEntity } from '../../persistence/entities/audit-log.entity.js';
import type { ActorType, AuditResult, RequestContext, ResourceDescriptor, SecuritySubject, RiskLevel } from '../../shared/security-types.js';
import { newId } from '../../shared/id.js';
import { securityErrors } from '../../shared/security-error.js';
import { RedactionService } from './redaction.service.js';

export interface WriteAuditInput {
  eventType: string;
  actorType: ActorType;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  result: AuditResult;
  riskLevel: RiskLevel;
  detail?: unknown;
  context?: RequestContext;
  failClosed?: boolean;
}

export interface AuditQuery {
  actorId?: string;
  eventType?: string;
  resourceType?: string;
  resourceId?: string;
  resourceScope?: Record<string, string | undefined>;
  riskLevel?: RiskLevel;
}

export interface AuthorizedAuditQueryInput {
  subject: SecuritySubject;
  query?: AuditQuery;
  context?: RequestContext;
  assertCan: (subject: SecuritySubject, action: string, resource: ResourceDescriptor, context?: RequestContext) => Promise<void>;
}

export class AuditService {
  private static readonly defaultDb = new PgliteDatabase();

  private static createDefaultRepository(): AsyncRepositoryPort<AuditLogEntity> {
    return new PgDocumentRepository<AuditLogEntity>(AuditService.defaultDb, 'security.audit_logs');
  }

  constructor(
    private readonly logs: AsyncRepositoryPort<AuditLogEntity> = AuditService.createDefaultRepository(),
    private readonly redaction = new RedactionService(),
  ) {}

  async write(input: WriteAuditInput): Promise<AuditLogEntity> {
    try {
      const redactedDetail = input.detail === undefined ? undefined : this.redaction.redact(input.detail).value;
      return this.logs.create({
        id: newId('aud'),
        eventType: input.eventType,
        actorType: input.actorType,
        actorId: input.actorId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        result: input.result,
        riskLevel: input.riskLevel,
        requestId: input.context?.requestId,
        sourceIp: input.context?.sourceIp,
        detail: redactedDetail,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      if (input.failClosed || input.riskLevel === 'high' || input.riskLevel === 'critical') {
        throw securityErrors.auditWriteFailed({ cause: error instanceof Error ? error.message : String(error) });
      }
      throw error;
    }
  }

  async query(query: AuditQuery = {}): Promise<AuditLogEntity[]> {
    return this.logs.list((log) => {
      return (!query.actorId || log.actorId === query.actorId)
        && (!query.eventType || log.eventType === query.eventType)
        && (!query.resourceType || log.resourceType === query.resourceType)
        && (!query.resourceId || log.resourceId === query.resourceId)
        && (!query.riskLevel || log.riskLevel === query.riskLevel);
    });
  }

  async deleteByResources(resources: Array<{ resourceType: string; resourceId?: string }>): Promise<number> {
    if (resources.length === 0) return 0;
    const keys = new Set(resources
      .filter((resource) => resource.resourceId)
      .map((resource) => `${resource.resourceType}:${resource.resourceId}`));
    if (keys.size === 0) return 0;

    const matched = await this.logs.list((log) => Boolean(log.resourceId) && keys.has(`${log.resourceType}:${log.resourceId}`));
    await Promise.all(matched.map((log) => this.logs.delete(log.id)));
    return matched.length;
  }

  async queryWithPermission(input: AuthorizedAuditQueryInput): Promise<AuditLogEntity[]> {
    const query = input.query ?? {};
    await input.assertCan(input.subject, 'audit.read', {
      type: query.resourceType ?? 'auditLog',
      id: query.resourceId,
      scope: query.resourceScope,
    }, input.context);
    return this.query(query);
  }
}
