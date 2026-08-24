import { newId } from '../../shared/id.js';
import type { GatewayDelegatedTaskInput, GatewayEvidence, GatewayTask, GatewayTaskResult } from './gateway-agent.types.js';

export class GatewayTaskService {
  private readonly tasks = new Map<string, GatewayTask>();
  private readonly idempotencyIndex = new Map<string, string>();
  private readonly evidence = new Map<string, GatewayEvidence>();

  dispatch(input: GatewayDelegatedTaskInput): GatewayTask {
    const existingId = this.idempotencyIndex.get(input.idempotencyKey);
    if (existingId) return this.tasks.get(existingId)!;

    const now = input.now ?? new Date();
    const task: GatewayTask = {
      id: input.id ?? newId('gateway_task'),
      idempotencyKey: input.idempotencyKey,
      executionRunId: input.executionRunId,
      stepId: input.stepId,
      gatewayId: input.gatewayId,
      delegatedTargetId: input.delegatedTargetId,
      target: input.target,
      adapter: input.adapter,
      action: input.action,
      payload: input.payload ?? {},
      credentialSessionId: input.credentialSessionId,
      status: 'queued',
      evidenceIds: [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    this.tasks.set(task.id, task);
    this.idempotencyIndex.set(task.idempotencyKey, task.id);
    return task;
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
    const evidence: GatewayEvidence = {
      ...input,
      id: input.id ?? newId('gw_evd'),
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    if (this.evidence.has(evidence.id)) return this.evidence.get(evidence.id)!;
    this.evidence.set(evidence.id, evidence);
    this.save({ ...task, evidenceIds: [...new Set([...task.evidenceIds, evidence.id])], updatedAt: evidence.createdAt });
    return evidence;
  }

  result(taskId: string, leaseId: string, result: Omit<GatewayTaskResult, 'evidenceIds' | 'finishedAt'> & Partial<Pick<GatewayTaskResult, 'evidenceIds' | 'finishedAt'>>): GatewayTask {
    const task = this.requireLease(taskId, leaseId);
    if (task.result) return task;
    const finishedAt = result.finishedAt ?? new Date().toISOString();
    return this.save({
      ...task,
      status: result.status,
      result: {
        ...result,
        evidenceIds: result.evidenceIds ?? task.evidenceIds,
        finishedAt,
      },
      updatedAt: finishedAt,
    });
  }

  get(taskId: string): GatewayTask | undefined {
    return this.tasks.get(taskId);
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
    return task;
  }
}
