import type { DatabasePort } from '../../database/database-port.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { PgDocumentRepository } from '../../persistence/repositories/pg-document-repository.js';
import type { IdentifiedEntity } from '../../persistence/repositories/repository-port.js';
import type { GatewayEvidence, GatewayTask } from './gateway-agent.types.js';
import type { AuditService } from '../audits/audit.service.js';

export interface GatewayTargetHistoryRecord {
  id: string;
  tenantId?: string;
  taskId: string;
  operatorId?: string;
  planId?: string;
  executionRunId: string;
  stepId: string;
  gatewayId: string;
  delegatedTargetId: string;
  adapter: string;
  credentialLeaseId?: string;
  action: string;
  result: string;
  summary: string;
  evidenceId?: string;
  evidenceRef?: string;
  evidenceKind?: string;
  certificateFingerprint?: string;
  backupRef?: string;
  verifyResult?: unknown;
  responseSummary?: unknown;
  createdAt: string;
}

export interface GatewayTargetHistoryRepositoryPort {
  append(record: GatewayTargetHistoryRecord): Promise<GatewayTargetHistoryRecord>;
  listByTarget(delegatedTargetId: string, tenantId?: string): Promise<GatewayTargetHistoryRecord[]>;
  listByTask(taskId: string): Promise<GatewayTargetHistoryRecord[]>;
}

type GatewayTargetHistoryEntity = GatewayTargetHistoryRecord & IdentifiedEntity;

export class PgGatewayTargetHistoryRepository implements GatewayTargetHistoryRepositoryPort {
  private readonly repository: PgDocumentRepository<GatewayTargetHistoryEntity>;

  constructor(db: DatabasePort = new PgliteDatabase()) {
    this.repository = new PgDocumentRepository(db, 'gateway-target-history');
  }

  async append(record: GatewayTargetHistoryRecord): Promise<GatewayTargetHistoryRecord> {
    const existing = await this.repository.get(record.id);
    if (existing) return existing;
    return this.repository.upsert(record as GatewayTargetHistoryEntity);
  }

  async listByTarget(delegatedTargetId: string, tenantId?: string): Promise<GatewayTargetHistoryRecord[]> {
    return this.repository
      .list((record) => record.delegatedTargetId === delegatedTargetId && (!tenantId || record.tenantId === tenantId))
      .then((rows) => rows.sort(sortByCreatedAt));
  }

  async listByTask(taskId: string): Promise<GatewayTargetHistoryRecord[]> {
    return this.repository.list((record) => record.taskId === taskId).then((rows) => rows.sort(sortByCreatedAt));
  }
}

export class RepositoryGatewayTargetHistoryRepository implements GatewayTargetHistoryRepositoryPort {
  constructor(private readonly repository: PgDocumentRepository<GatewayTargetHistoryEntity>) {}

  async append(record: GatewayTargetHistoryRecord): Promise<GatewayTargetHistoryRecord> {
    const existing = await this.repository.get(record.id);
    if (existing) return existing;
    return this.repository.upsert(record as GatewayTargetHistoryEntity);
  }

  async listByTarget(delegatedTargetId: string, tenantId?: string): Promise<GatewayTargetHistoryRecord[]> {
    return this.repository.list((record) => record.delegatedTargetId === delegatedTargetId && (!tenantId || record.tenantId === tenantId)).then((rows) => rows.sort(sortByCreatedAt));
  }

  async listByTask(taskId: string): Promise<GatewayTargetHistoryRecord[]> {
    return this.repository.list((record) => record.taskId === taskId).then((rows) => rows.sort(sortByCreatedAt));
  }
}

export interface GatewayTaskAuditWriterOptions {
  audit?: AuditService;
  history?: GatewayTargetHistoryRepositoryPort;
}

export class GatewayTaskAuditWriter {
  constructor(private readonly options: GatewayTaskAuditWriterOptions = {}) {}

  recordEvidence(task: GatewayTask, evidence: GatewayEvidence): void {
    const detail = structuredDetail(task, evidence.summary, evidence, evidence.result);
    this.options.audit?.write({
      eventType: 'gateway.task.evidence.recorded',
      actorType: task.operatorId ? 'user' : 'system',
      actorId: task.operatorId ?? 'gateway-agent',
      action: task.action,
      resourceType: 'gatewayTarget',
      resourceId: task.delegatedTargetId,
      result: evidence.result === 'success' ? 'success' : 'failure',
      riskLevel: riskFor(task.action),
      detail,
    });
    void this.options.history?.append(toHistoryRecord(task, evidence.summary, evidence, evidence.result, evidence.createdAt));
  }

  recordResult(task: GatewayTask): void {
    if (!task.result) return;
    const detail = structuredDetail(task, task.result.summary, undefined, task.result.status);
    this.options.audit?.write({
      eventType: 'gateway.task.result.recorded',
      actorType: task.operatorId ? 'user' : 'system',
      actorId: task.operatorId ?? 'gateway-agent',
      action: task.action,
      resourceType: 'gatewayTarget',
      resourceId: task.delegatedTargetId,
      result: task.result.success ? 'success' : 'failure',
      riskLevel: riskFor(task.action),
      detail,
    });
    void this.options.history?.append(toHistoryRecord(task, task.result.summary, undefined, task.result.status, task.result.finishedAt));
  }

  async listTargetHistory(delegatedTargetId: string): Promise<GatewayTargetHistoryRecord[]> {
    return this.options.history?.listByTarget(delegatedTargetId) ?? [];
  }

  async listTenantTargetHistory(tenantId: string, delegatedTargetId: string): Promise<GatewayTargetHistoryRecord[]> {
    return this.options.history?.listByTarget(delegatedTargetId, tenantId) ?? [];
  }
}

function structuredDetail(task: GatewayTask, summary: string, evidence: GatewayEvidence | undefined, result: string): Record<string, unknown> {
  return {
    operatorId: task.operatorId,
    planId: task.planId,
    executionRunId: task.executionRunId,
    stepId: task.stepId,
    gatewayId: task.gatewayId,
    delegatedTargetId: task.delegatedTargetId,
    adapter: task.adapter,
    credentialLeaseId: task.credentialLeaseId,
    credentialSessionId: task.credentialSessionId,
    action: task.action,
    result,
    summary,
    evidenceId: evidence?.id,
    evidenceRef: evidence?.evidenceRef,
    evidenceKind: evidence?.kind,
    certificateFingerprint: readString(evidence?.metadata, 'certificateFingerprint') ?? readString(evidence?.metadata, 'fingerprint') ?? (evidence?.kind === 'certificate_fingerprint' ? evidence.summary : undefined),
    backupRef: readString(evidence?.metadata, 'backupRef') ?? (evidence?.kind === 'backup_ref' ? evidence.evidenceRef : undefined),
    verifyResult: evidence?.metadata.verifyResult,
    responseSummary: evidence?.metadata.responseSummary ?? (evidence?.kind === 'response_summary' ? evidence.summary : undefined),
  };
}

function toHistoryRecord(task: GatewayTask, summary: string, evidence: GatewayEvidence | undefined, result: string, createdAt: string): GatewayTargetHistoryRecord {
  const detail = structuredDetail(task, summary, evidence, result);
  return {
    id: evidence ? `gateway-history:evidence:${evidence.id}` : `gateway-history:result:${task.id}`,
    tenantId: task.tenantId,
    taskId: task.id,
    operatorId: task.operatorId,
    planId: task.planId,
    executionRunId: task.executionRunId,
    stepId: task.stepId,
    gatewayId: task.gatewayId,
    delegatedTargetId: task.delegatedTargetId,
    adapter: task.adapter,
    credentialLeaseId: task.credentialLeaseId,
    action: task.action,
    result,
    summary,
    evidenceId: evidence?.id,
    evidenceRef: evidence?.evidenceRef,
    evidenceKind: evidence?.kind,
    certificateFingerprint: detail.certificateFingerprint as string | undefined,
    backupRef: detail.backupRef as string | undefined,
    verifyResult: detail.verifyResult,
    responseSummary: detail.responseSummary,
    createdAt,
  };
}

function readString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function riskFor(action: string): 'low' | 'medium' | 'high' | 'critical' {
  if (['delete', 'remove', 'rollback'].includes(action)) return 'critical';
  if (['write', 'install', 'upgrade', 'exec', 'upload'].includes(action)) return 'high';
  return 'medium';
}

function sortByCreatedAt(left: GatewayTargetHistoryRecord, right: GatewayTargetHistoryRecord): number {
  return left.createdAt.localeCompare(right.createdAt);
}
