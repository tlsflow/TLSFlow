import { PgliteDatabase } from '../../database/pglite-database.js';
import type { DatabasePort } from '../../database/database-port.js';
import type { AsyncRepositoryPort } from '../../persistence/repositories/async-repository-port.js';
import { PgDocumentRepository } from '../../persistence/repositories/pg-document-repository.js';
import type { AuditLogEntity } from '../../persistence/entities/audit-log.entity.js';
import type { ActorType, AuditResult, RequestContext, ResourceDescriptor, SecuritySubject, RiskLevel } from '../../shared/security-types.js';
import { newId } from '../../shared/id.js';
import { securityErrors } from '../../shared/security-error.js';
import { RedactionService } from './redaction.service.js';
import { isSuppressedAudit } from './audit-event-types.js';

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
  tenantId?: string;
  keyword?: string;
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

export type AuditTenantResolver = () => Promise<string>;

export class AuditService {
  private static readonly defaultDb = new PgliteDatabase();

  private readonly logs: AsyncRepositoryPort<AuditLogEntity>;
  private readonly redaction: RedactionService;
  private readonly defaultTenantResolver?: AuditTenantResolver;
  private readonly queryDb?: DatabasePort;

  private static createDefaultRepository(): AsyncRepositoryPort<AuditLogEntity> {
    return new PgDocumentRepository<AuditLogEntity>(AuditService.defaultDb, 'security.audit_logs');
  }

  constructor(
    logs?: AsyncRepositoryPort<AuditLogEntity>,
    redaction = new RedactionService(),
    defaultTenantResolver?: AuditTenantResolver,
    queryDb?: DatabasePort,
  ) {
    this.logs = logs ?? AuditService.createDefaultRepository();
    this.redaction = redaction;
    this.defaultTenantResolver = defaultTenantResolver;
    this.queryDb = queryDb ?? (logs === undefined ? AuditService.defaultDb : undefined);
  }

  /**
   * 为事务复用相同的租户解析规则，只替换审计仓储的数据连接。
   * 这样事务内写入不会退化成一个没有默认租户解析器的新实例。
   */
  forDatabase(db: DatabasePort): AuditService {
    return new AuditService(
      new PgDocumentRepository<AuditLogEntity>(db, 'security.audit_logs'),
      this.redaction,
      this.defaultTenantResolver,
      db,
    );
  }

  async write(input: WriteAuditInput): Promise<AuditLogEntity> {
    try {
      const redactedDetail = input.detail === undefined ? undefined : this.redaction.redact(input.detail).value;
      const tenantId = await this.resolveTenantId(input.context);
      if (!tenantId && this.defaultTenantResolver) {
        throw new Error('审计写入缺少租户上下文');
      }
      const entity: AuditLogEntity = {
        id: newId('aud'),
        tenantId,
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
      };
      if (isSuppressedAudit(entity)) return structuredClone(entity);
      return this.logs.create(entity);
    } catch (error) {
      if (input.failClosed || input.riskLevel === 'high' || input.riskLevel === 'critical') {
        throw securityErrors.auditWriteFailed({ cause: error instanceof Error ? error.message : String(error) });
      }
      throw error;
    }
  }

  private async resolveTenantId(context: RequestContext | undefined): Promise<string | undefined> {
    return resolveContextTenantId(context) ?? this.defaultTenantResolver?.();
  }

  async query(query: AuditQuery = {}): Promise<AuditLogEntity[]> {
    if (this.queryDb) return this.queryPersistedLogs(query);
    return this.logs.list((log) => {
      return !isSuppressedAudit(log)
        && (!query.tenantId || log.tenantId === query.tenantId)
        && matchesAuditKeyword(log, query.keyword)
        && (!query.actorId || log.actorId === query.actorId)
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

    if (this.queryDb) {
      await this.ensurePersistedLogsReady();
      const result = await this.queryDb.query<{ document_id: string }>(
        `delete from pg_documents
          where namespace = 'security.audit_logs'
            and payload->>'resourceId' is not null
            and ((payload->>'resourceType') || ':' || (payload->>'resourceId')) = any($1::text[])
          returning document_id`,
        [[...keys]],
      );
      return result.rows.length;
    }

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
    return this.query({ tenantId: query.tenantId ?? input.subject.scope?.tenantId ?? resolveContextTenantId(input.context), ...query });
  }

  private async queryPersistedLogs(query: AuditQuery): Promise<AuditLogEntity[]> {
    await this.ensurePersistedLogsReady();
    const params: unknown[] = [];
    const conditions: string[] = [];
    appendAuditCondition(conditions, params, "payload->>'tenantId'", query.tenantId);
    appendAuditKeywordCondition(conditions, params, query.keyword);
    appendAuditCondition(conditions, params, "payload->>'actorId'", query.actorId);
    appendAuditCondition(conditions, params, "payload->>'eventType'", query.eventType);
    appendAuditCondition(conditions, params, "payload->>'resourceType'", query.resourceType);
    appendAuditCondition(conditions, params, "payload->>'resourceId'", query.resourceId);
    appendAuditCondition(conditions, params, "payload->>'riskLevel'", query.riskLevel);
    appendSuppressedAuditCondition(conditions);
    const result = await this.queryDb!.query<AuditDocumentRow>(
      `select document_id, payload
         from pg_documents
        where namespace = 'security.audit_logs'
        ${conditions.length > 0 ? `and ${conditions.join('\n and ')}` : ''}
        order by updated_at asc`,
      params,
    );
    return result.rows.map((row) => structuredClone({ ...row.payload, id: row.document_id }));
  }

  private async ensurePersistedLogsReady(): Promise<void> {
    if (this.logs instanceof PgDocumentRepository) await this.logs.initialize();
  }
}

interface AuditDocumentRow extends Record<string, unknown> {
  document_id: string;
  payload: AuditLogEntity;
}

function appendAuditCondition(conditions: string[], params: unknown[], expression: string, value: string | undefined): void {
  if (!value) return;
  params.push(value);
  conditions.push(`${expression} = $${params.length}`);
}

function appendAuditKeywordCondition(conditions: string[], params: unknown[], keyword: string | undefined): void {
  const normalized = keyword?.trim();
  if (!normalized) return;
  params.push(`%${normalized}%`);
  conditions.push('payload::text ilike $' + params.length);
}

function matchesAuditKeyword(log: AuditLogEntity, keyword: string | undefined): boolean {
  const normalized = keyword?.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return JSON.stringify(log).toLocaleLowerCase().includes(normalized);
}

function appendSuppressedAuditCondition(conditions: string[]): void {
  conditions.push(`not (
    payload->>'eventType' = 'secret.used'
    or (
      payload->>'eventType' = 'permission.denied'
      and payload->'detail'->>'reason' in ('no allow policy', 'no object grant')
    )
  )`);
}

function resolveContextTenantId(context: RequestContext | undefined): string | undefined {
  return context?.tenantId ?? context?.actor?.scope?.tenantId;
}
