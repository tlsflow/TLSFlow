import { createHash } from 'node:crypto';
import { AppError } from '../../common/errors/app-error.js';
import type { AgentTaskEnvelope } from '../agents/schema/agents.schema.js';
import type { LocalTask, LocalTaskLedgerSnapshot, StepExecutionResultLike } from './full-agent.types.js';

const terminalStatuses = new Set<LocalTask['status']>(['succeeded', 'failed', 'timeout', 'rejected']);

function stableStringify(input: unknown): string {
  if (input === null || typeof input !== 'object') return JSON.stringify(input);
  if (Array.isArray(input)) return `[${input.map((item) => stableStringify(item)).join(',')}]`;
  return `{${Object.keys(input as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((input as Record<string, unknown>)[key])}`).join(',')}}`;
}

export function fingerprintTaskInput(task: AgentTaskEnvelope): string {
  return createHash('sha256').update(stableStringify({
    agentId: task.agentId,
    executionRunId: task.executionRunId,
    executionStepId: task.executionStepId,
    idempotencyKey: task.idempotencyKey,
    payload: task.payload,
  })).digest('hex');
}

export class LocalTaskLedger {
  private readonly tasks = new Map<string, LocalTask>();
  private readonly idempotencyIndex = new Map<string, string>();

  constructor(snapshot?: LocalTaskLedgerSnapshot) {
    for (const task of snapshot?.tasks ?? []) {
      const restored = terminalStatuses.has(task.status) ? task : { ...task, status: 'recovering' as const };
      this.tasks.set(restored.taskId, restored);
      this.idempotencyIndex.set(restored.idempotencyKey, restored.taskId);
    }
  }

  accept(task: AgentTaskEnvelope): LocalTask {
    const fingerprint = fingerprintTaskInput(task);
    const existingByTaskId = this.tasks.get(task.id);
    if (existingByTaskId) return existingByTaskId;

    const existingTaskId = this.idempotencyIndex.get(task.idempotencyKey);
    if (existingTaskId) {
      const existing = this.tasks.get(existingTaskId);
      if (existing?.payloadFingerprint !== fingerprint) {
        throw new AppError('IDEMPOTENCY_CONFLICT', '本地任务幂等键冲突', {
          taskId: task.id,
          existingTaskId,
          idempotencyKey: task.idempotencyKey,
        });
      }
      return existing;
    }

    const now = new Date().toISOString();
    const localTask: LocalTask = {
      taskId: task.id,
      idempotencyKey: task.idempotencyKey,
      executionRunId: task.executionRunId,
      executionStepId: task.executionStepId,
      payloadFingerprint: fingerprint,
      status: 'received',
      receivedAt: now,
      updatedAt: now,
    };
    this.tasks.set(localTask.taskId, localTask);
    this.idempotencyIndex.set(localTask.idempotencyKey, localTask.taskId);
    return localTask;
  }

  markRunning(taskId: string, leaseId: string): LocalTask {
    return this.patch(taskId, { status: 'running', leaseId });
  }

  complete(taskId: string, result: StepExecutionResultLike): LocalTask {
    const status = result.status === 'dry_run' || result.success ? 'succeeded' : result.status;
    return this.patch(taskId, { status, result });
  }

  get(taskId: string): LocalTask | undefined {
    return this.tasks.get(taskId);
  }

  recoverable(): LocalTask[] {
    return [...this.tasks.values()].filter((task) => !terminalStatuses.has(task.status));
  }

  snapshot(): LocalTaskLedgerSnapshot {
    return { tasks: [...this.tasks.values()].map((task) => ({ ...task })) };
  }

  private patch(taskId: string, patch: Partial<LocalTask>): LocalTask {
    const current = this.tasks.get(taskId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', '本地任务不存在', { taskId });
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.tasks.set(taskId, next);
    return next;
  }
}
