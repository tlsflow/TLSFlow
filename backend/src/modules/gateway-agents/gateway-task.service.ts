import type { RepositoryPort } from '../../persistence/repositories/repository-port.js';
import { newId } from '../../shared/id.js';
import type { GatewayDelegatedTaskInput, GatewayEvidence, GatewayTask, GatewayTaskResult } from './gateway-agent.types.js';
import type { GatewayTaskAuditWriter } from './gateway-target-history.service.js';

export interface GatewayTaskRepositories {
  tasks: RepositoryPort<GatewayTask>;
  evidence: RepositoryPort<GatewayEvidence>;
}

export interface GatewayTaskServiceOptions {
  repositories?: GatewayTaskRepositories;
  auditWriter?: GatewayTaskAuditWriter;
}

export class GatewayTaskService {
  private readonly tasks = new Map<string, GatewayTask>();
  private readonly idempotencyIndex = new Map<string, string>();
  private readonly evidence = new Map<string, GatewayEvidence>();
  private readonly evidenceSequenceIndex = new Map<string, string>();
  private readonly evidenceRefIndex = new Map<string, string>();

  private readonly repositories?: GatewayTaskRepositories;
  private readonly auditWriter?: GatewayTaskAuditWriter;

  constructor(options?: GatewayTaskRepositories | GatewayTaskServiceOptions) {
    this.repositories = isGatewayTaskRepositories(options) ? options : options?.repositories;
    this.auditWriter = isGatewayTaskRepositories(options) ? undefined : options?.auditWriter;
    // 默认路径仍是纯内存 Map。只有调用方显式传入 RepositoryPort 时，才从持久层重建状态。
    for (const task of this.repositories?.tasks.list() ?? []) {
      this.tasks.set(task.id, task);
      this.idempotencyIndex.set(task.idempotencyKey, task.id);
    }
    for (const item of this.repositories?.evidence.list() ?? []) {
      this.evidence.set(item.id, item);
      this.indexEvidence(item);
    }
  }

  dispatch(input: GatewayDelegatedTaskInput): GatewayTask {
    const existingId = this.idempotencyIndex.get(input.idempotencyKey);
    if (existingId) return this.tasks.get(existingId)!;

    const now = input.now ?? new Date();
    const task: GatewayTask = {
      id: input.id ?? newId('gateway_task'),
      idempotencyKey: input.idempotencyKey,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      operatorId: input.operatorId,
      planId: input.planId,
      executionRunId: input.executionRunId,
      stepId: input.stepId,
      gatewayId: input.gatewayId,
      delegatedTargetId: input.delegatedTargetId,
      target: input.target,
      adapter: input.adapter,
      action: input.action,
      payload: input.payload ?? {},
      forwardingGrant: input.forwardingGrant,
      status: 'queued',
      evidenceIds: [],
      evidenceAckCursor: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    return this.save(task);
  }

  ack(taskId: string, leaseId: string, now = new Date()): GatewayTask {
    const task = this.requireTask(taskId);
    if (task.leaseId === leaseId && (task.status === 'acknowledged' || task.status === 'running')) return task;
    if (task.leaseId && task.leaseId !== leaseId) throw new Error('GatewayTask lease 冲突');
    if (task.status !== 'queued') return task;
    return this.save({ ...task, leaseId, status: 'acknowledged', acknowledgedAt: now.toISOString(), updatedAt: now.toISOString() });
  }

  markRunning(taskId: string, leaseId: string, now = new Date()): GatewayTask {
    const task = this.requireLease(taskId, leaseId);
    if (task.status === 'running') return task;
    if (task.status !== 'acknowledged') throw new Error(`GatewayTask 状态不允许运行: ${task.status}`);
    return this.save({ ...task, status: 'running', updatedAt: now.toISOString() });
  }

  appendEvidence(input: Omit<GatewayEvidence, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): GatewayEvidence {
    const task = this.requireTask(input.taskId);
    const { executionRunId: _executionRunId, stepId: _stepId, action: _action, result: _result, evidenceRef: _evidenceRef, ...safeInput } = input;
    const evidenceRef = _evidenceRef ?? input.id ?? newId('evidence_ref');
    const sequence = input.sequence ?? this.nextEvidenceSequence(task);
    const existingId = this.evidenceSequenceIndex.get(this.evidenceSequenceKey(task.id, sequence)) ?? this.evidenceRefIndex.get(this.evidenceRefKey(task.id, evidenceRef));
    if (existingId) return this.evidence.get(existingId)!;
    const evidence: GatewayEvidence = {
      ...safeInput,
      operatorId: task.operatorId,
      planId: task.planId,
      executionRunId: task.executionRunId,
      stepId: task.stepId,
      action: task.action,
      result: task.result?.status ?? (task.status === 'failed' || task.status === 'cancelled' || task.status === 'timeout' ? task.status : 'success'),
      evidenceRef,
      sequence,
      id: input.id ?? newId('gw_evd'),
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    if (this.evidence.has(evidence.id)) return this.evidence.get(evidence.id)!;
    this.saveEvidence(evidence);
    this.save({ ...task, evidenceIds: [...new Set([...task.evidenceIds, evidence.id])], updatedAt: evidence.createdAt });
    this.auditWriter?.recordEvidence(this.requireTask(task.id), evidence);
    return evidence;
  }

  result(taskId: string, leaseId: string, result: Omit<GatewayTaskResult, 'evidenceIds' | 'finishedAt'> & Partial<Pick<GatewayTaskResult, 'evidenceIds' | 'finishedAt'>>): GatewayTask {
    const task = this.requireLease(taskId, leaseId);
    if (task.result) return task;
    const finishedAt = result.finishedAt ?? new Date().toISOString();
    const evidenceIds = result.evidenceIds ?? task.evidenceIds;
    const firstEvidenceRef = evidenceIds.map((id) => this.evidence.get(id)?.evidenceRef).find((ref): ref is string => Boolean(ref));
    const completed = this.save({
      ...task,
      status: result.status,
      result: {
        ...result,
        evidenceIds,
        evidenceRef: result.evidenceRef ?? firstEvidenceRef ?? evidenceIds[0],
        finishedAt,
      },
      updatedAt: finishedAt,
    });
    this.auditWriter?.recordResult(completed);
    return completed;
  }

  updateEvidenceAckCursor(taskId: string, ackCursor: number, now = new Date()): GatewayTask {
    const task = this.requireTask(taskId);
    const current = task.evidenceAckCursor ?? 0;
    if (ackCursor <= current) return task;
    return this.save({ ...task, evidenceAckCursor: ackCursor, updatedAt: now.toISOString() });
  }

  updateForwardingGrant(taskId: string, forwardingGrant: GatewayTask['forwardingGrant'], now = new Date()): GatewayTask {
    const task = this.requireTask(taskId);
    return this.save({ ...task, forwardingGrant, updatedAt: now.toISOString() });
  }

  get(taskId: string): GatewayTask | undefined {
    return this.tasks.get(taskId);
  }

  listRecoverable(): GatewayTask[] {
    return [...this.tasks.values()].filter((task) => ['queued', 'acknowledged', 'running'].includes(task.status));
  }

  listEvidence(taskId: string): GatewayEvidence[] {
    const task = this.requireTask(taskId);
    return task.evidenceIds.map((id) => this.evidence.get(id)).filter((item): item is GatewayEvidence => item !== undefined);
  }

  private requireTask(taskId: string): GatewayTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('GatewayTask 不存在');
    return task;
  }

  private requireLease(taskId: string, leaseId: string): GatewayTask {
    const task = this.requireTask(taskId);
    if (task.leaseId !== leaseId) throw new Error('GatewayTask lease 无效');
    return task;
  }

  private save(task: GatewayTask): GatewayTask {
    this.tasks.set(task.id, task);
    this.idempotencyIndex.set(task.idempotencyKey, task.id);
    this.repositories?.tasks.upsert(task);
    return task;
  }

  private saveEvidence(evidence: GatewayEvidence): GatewayEvidence {
    this.evidence.set(evidence.id, evidence);
    this.indexEvidence(evidence);
    this.repositories?.evidence.upsert(evidence);
    return evidence;
  }

  private indexEvidence(evidence: GatewayEvidence): void {
    if (evidence.sequence !== undefined) this.evidenceSequenceIndex.set(this.evidenceSequenceKey(evidence.taskId, evidence.sequence), evidence.id);
    this.evidenceRefIndex.set(this.evidenceRefKey(evidence.taskId, evidence.evidenceRef), evidence.id);
  }

  private nextEvidenceSequence(task: GatewayTask): number {
    const maxExisting = task.evidenceIds
      .map((id) => this.evidence.get(id)?.sequence)
      .filter((sequence): sequence is number => typeof sequence === 'number')
      .reduce((max, sequence) => Math.max(max, sequence), 0);
    return Math.max(task.evidenceAckCursor ?? 0, maxExisting) + 1;
  }

  private evidenceSequenceKey(taskId: string, sequence: number): string {
    return `${taskId}:${sequence}`;
  }

  private evidenceRefKey(taskId: string, evidenceRef: string): string {
    return `${taskId}:${evidenceRef}`;
  }
}

function isGatewayTaskRepositories(value: GatewayTaskRepositories | GatewayTaskServiceOptions | undefined): value is GatewayTaskRepositories {
  return Boolean(value) && 'tasks' in value! && 'evidence' in value!;
}
