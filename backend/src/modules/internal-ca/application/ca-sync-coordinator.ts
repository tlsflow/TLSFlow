import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { newId } from '../../../shared/id.js';
import type { RequestContext, SecuritySubject } from '../../../shared/security-types.js';
import { AUDIT_EVENT_TYPES } from '../../audits/audit-event-types.js';
import { writeCaOperationsAudit, type CaOperationsAuditPort } from '../ca-operations.security.js';
import {
  CaOperationsAdapterRegistry,
  assertCaOperationListInput,
  assertCaOperationRecordBatch,
} from '../providers/ca-operations.js';
import { CaOperationsRepository } from '../repository/ca-operations.repository.js';
import { InternalCaRepository } from '../repository/internal-ca.repository.js';
import type {
  CaOperationObjectType,
  CaSyncMode,
  CaSyncRunEntity,
  ExternalCaObservationEntity,
} from '../schema/internal-ca.schema.js';

const batchLimit = 500;
const leaseDurationMs = 60_000;
const maxAttempts = 5;

export interface CreateCaSyncRunsInput {
  tenantId: string;
  providerId: string;
  caId: string;
  objectTypes: CaOperationObjectType[];
  mode: CaSyncMode;
  actor: SecuritySubject;
  context?: RequestContext;
}

export class CaSyncCoordinator {
  private readonly operationsRepository: CaOperationsRepository;
  private readonly internalRepository: InternalCaRepository;

  constructor(
    db: DatabasePort,
    private readonly adapters: CaOperationsAdapterRegistry,
    private readonly audit?: CaOperationsAuditPort,
    operationsRepository?: CaOperationsRepository,
    internalRepository?: InternalCaRepository,
  ) {
    this.operationsRepository = operationsRepository ?? new CaOperationsRepository(db);
    this.internalRepository = internalRepository ?? new InternalCaRepository(db);
  }

  async createRuns(input: CreateCaSyncRunsInput): Promise<CaSyncRunEntity[]> {
    const provider = await this.internalRepository.getProvider(input.tenantId, input.providerId);
    const authority = await this.internalRepository.getAuthority(input.tenantId, input.caId);
    if (!provider || !authority || authority.providerId !== provider.id) {
      throw new AppError('RESOURCE_NOT_FOUND', 'CA 或 Provider 不存在或不匹配');
    }
    const adapter = this.adapters.get(provider.type);
    if (!adapter.getOperationsCapabilities().synchronizeHistory) {
      throw new AppError('CA_SYNC_CAPABILITY_UNSUPPORTED', '当前 Provider 不支持历史同步', { providerType: provider.type });
    }
    const objectTypes = [...new Set(input.objectTypes)];
    if (!objectTypes.length) throw new AppError('CA_OPERATIONS_QUERY_INVALID', '同步对象类型不能为空');
    for (const objectType of objectTypes) {
      const active = await this.operationsRepository.getActiveSyncRun(input.tenantId, provider.id, authority.id, objectType);
      if (active) throw new AppError('CA_SYNC_ALREADY_RUNNING', '相同范围的 CA 同步正在运行', { runId: active.id, objectType });
    }
    const previousRuns = await this.operationsRepository.listSyncRuns(input.tenantId, authority.id);
    const now = new Date().toISOString();
    const created: CaSyncRunEntity[] = [];
    for (const objectType of objectTypes) {
      const previousCursor = input.mode === 'incremental'
        ? previousRuns.find((run) => run.objectType === objectType && ['succeeded', 'partial'].includes(run.status))?.cursorAfter
        : undefined;
      const run: CaSyncRunEntity = {
        id: newId('casync'), tenantId: input.tenantId, providerId: provider.id, caId: authority.id,
        objectType, mode: input.mode, status: 'queued', cursorBefore: previousCursor, cursorAfter: previousCursor,
        readCount: 0, upsertedCount: 0, skippedCount: 0, failedCount: 0, attemptCount: 0,
        requestedBy: input.actor.id, createdAt: now, updatedAt: now,
      };
      try {
        created.push(await this.operationsRepository.createSyncRun(run));
      } catch (error) {
        const active = await this.operationsRepository.getActiveSyncRun(input.tenantId, provider.id, authority.id, objectType);
        if (active) throw new AppError('CA_SYNC_ALREADY_RUNNING', '相同范围的 CA 同步正在运行', { runId: active.id, objectType });
        throw error;
      }
      await this.writeAudit(input, run, AUDIT_EVENT_TYPES.CA_OPERATIONS_SYNC_STARTED, 'success');
    }
    return created;
  }

  listRuns(tenantId: string, caId?: string): Promise<CaSyncRunEntity[]> {
    return this.operationsRepository.listSyncRuns(tenantId, caId);
  }

  async processNextBatch(tenantId: string, runId: string, workerId: string, now = new Date()): Promise<CaSyncRunEntity> {
    const run = await this.operationsRepository.getSyncRun(tenantId, runId);
    if (!run) throw new AppError('RESOURCE_NOT_FOUND', 'CA 同步运行不存在', { runId });
    if (!['queued', 'running'].includes(run.status)) return run;
    const nowIso = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs).toISOString();
    if (!(await this.operationsRepository.acquireSyncLease(tenantId, runId, workerId, leaseExpiresAt, nowIso))) {
      throw new AppError('CA_SYNC_ALREADY_RUNNING', 'CA 同步运行已被其他 Worker 租赁', { runId });
    }
    const leased = { ...run, status: 'running' as const, leaseOwner: workerId, leaseExpiresAt, startedAt: run.startedAt ?? nowIso, updatedAt: nowIso };
    const provider = await this.internalRepository.getProvider(tenantId, run.providerId);
    const authority = await this.internalRepository.getAuthority(tenantId, run.caId);
    if (!provider || !authority || authority.providerId !== provider.id) {
      return this.failRun(leased, new AppError('CA_SYNC_SOURCE_UNAVAILABLE', 'CA 或 Provider 已不可用'), now);
    }
    try {
      const adapter = this.adapters.get(provider.type);
      const adapterInput = {
        provider, authority, objectType: run.objectType,
        cursor: run.cursorAfter ?? run.cursorBefore, limit: batchLimit,
      };
      assertCaOperationListInput(adapterInput);
      const batch = await adapter.listOperationRecords(adapterInput);
      assertCaOperationRecordBatch(batch, batchLimit);
      if (!batch.complete && !batch.nextCursor) throw new AppError('CA_SYNC_CURSOR_INVALID', '未完成批次必须返回下一游标');
      const observedAt = now.toISOString();
      const observations = batch.records.map<ExternalCaObservationEntity>((record) => ({
        id: newId('caobs'), tenantId, providerId: provider.id, caId: authority.id, objectType: run.objectType,
        ...record, observedAt, firstObservedAt: observedAt, createdAt: observedAt, updatedAt: observedAt,
      }));
      const completed = batch.complete;
      const updated: CaSyncRunEntity = {
        ...leased, status: completed ? 'succeeded' : 'queued', cursorAfter: batch.nextCursor ?? leased.cursorAfter,
        sourceWatermark: batch.sourceWatermark ?? leased.sourceWatermark,
        readCount: leased.readCount + batch.records.length, upsertedCount: leased.upsertedCount + batch.records.length,
        attemptCount: 0, nextAttemptAt: undefined, errorCode: undefined, errorMessage: undefined,
        leaseOwner: undefined, leaseExpiresAt: undefined, completedAt: completed ? observedAt : undefined, updatedAt: observedAt,
      };
      await this.operationsRepository.persistSyncBatch(updated, observations);
      if (completed) {
        await this.writeAudit({ tenantId, providerId: provider.id, caId: authority.id, objectTypes: [run.objectType], mode: run.mode, actor: syncActor(run), context: undefined }, updated, AUDIT_EVENT_TYPES.CA_OPERATIONS_SYNC_COMPLETED, 'success');
      }
      return updated;
    } catch (error) {
      return this.failRun(leased, error, now);
    }
  }

  private async failRun(run: CaSyncRunEntity, error: unknown, now: Date): Promise<CaSyncRunEntity> {
    const attemptCount = (run.attemptCount ?? 0) + 1;
    const terminal = attemptCount >= maxAttempts || isPermanentSyncError(error);
    const nowIso = now.toISOString();
    const updated: CaSyncRunEntity = {
      ...run,
      status: terminal ? (run.upsertedCount > 0 ? 'partial' : 'failed') : 'queued',
      attemptCount,
      nextAttemptAt: terminal ? undefined : new Date(now.getTime() + retryDelayMs(attemptCount)).toISOString(),
      errorCode: error instanceof AppError ? error.errorCode : 'CA_SYNC_SOURCE_UNAVAILABLE',
      errorMessage: String(error instanceof Error ? error.message : error).slice(0, 1024),
      failedCount: run.failedCount + 1,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      completedAt: terminal ? nowIso : undefined,
      updatedAt: nowIso,
    };
    await this.operationsRepository.updateSyncRun(updated);
    await this.writeAudit({ tenantId: run.tenantId, providerId: run.providerId, caId: run.caId, objectTypes: [run.objectType], mode: run.mode, actor: syncActor(run) }, updated, AUDIT_EVENT_TYPES.CA_OPERATIONS_SYNC_FAILED, 'failure');
    return updated;
  }

  private async writeAudit(
    input: CreateCaSyncRunsInput,
    run: CaSyncRunEntity,
    eventType: typeof AUDIT_EVENT_TYPES.CA_OPERATIONS_SYNC_STARTED | typeof AUDIT_EVENT_TYPES.CA_OPERATIONS_SYNC_COMPLETED | typeof AUDIT_EVENT_TYPES.CA_OPERATIONS_SYNC_FAILED,
    result: 'success' | 'failure',
  ): Promise<void> {
    if (!this.audit) return;
    await writeCaOperationsAudit(this.audit, {
      eventType, actor: input.actor, action: input.mode === 'full' ? 'ca.operations.sync.full' : 'ca.operations.sync',
      scope: { tenantId: input.tenantId, caId: input.caId, providerId: input.providerId, resourceType: 'caSyncRun', resourceId: run.id },
      result, riskLevel: input.mode === 'full' ? 'high' : 'medium',
      detail: { objectType: run.objectType, status: run.status, readCount: run.readCount, upsertedCount: run.upsertedCount, errorCode: run.errorCode },
      context: input.context,
    });
  }
}

function retryDelayMs(attemptCount: number): number {
  return Math.min(5 * 60_000, 5_000 * 2 ** Math.max(0, attemptCount - 1));
}

function isPermanentSyncError(error: unknown): boolean {
  return error instanceof AppError && ['CA_SYNC_CURSOR_INVALID', 'CA_SYNC_BATCH_TOO_LARGE', 'CA_OPERATIONS_QUERY_INVALID'].includes(error.errorCode);
}

function syncActor(run: CaSyncRunEntity): SecuritySubject {
  return { id: run.requestedBy, type: run.requestedBy === 'system' ? 'system' : 'user' };
}
