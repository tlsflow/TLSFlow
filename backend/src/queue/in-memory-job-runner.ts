import { randomUUID } from 'node:crypto';
import { AppError } from '../common/errors/app-error.js';
import { getRequestContext } from '../common/tracing/request-context.js';
import type { JobPayload, JobResult } from './job.types.js';
import type { EnqueueJobInput, QueuePort } from './queue-port.js';

export type JobWorker = (job: JobPayload) => Promise<JobResult>;

// 内存队列只用于基础框架测试。生产实现替换为 Redis/BullMQ 或企业 MQ，但 QueuePort 不变。
export class InMemoryJobRunner implements QueuePort {
  private readonly jobs: JobPayload[] = [];
  private readonly idempotencyKeys = new Set<string>();

  constructor(private readonly worker: JobWorker = async (job) => ({ jobId: job.jobId, success: true })) {}

  async enqueue<TPayload extends Record<string, unknown>>(input: EnqueueJobInput<TPayload>): Promise<JobPayload<TPayload>> {
    if (input.idempotencyKey && this.idempotencyKeys.has(input.idempotencyKey)) {
      throw new AppError('IDEMPOTENCY_CONFLICT', '幂等键已被不同请求使用', { idempotencyKey: input.idempotencyKey });
    }
    const context = getRequestContext();
    const job: JobPayload<TPayload> = {
      jobId: randomUUID(),
      jobType: input.jobType,
      tenantId: context?.tenantId,
      actorId: context?.actorId,
      requestId: context?.requestId ?? `req_job_${randomUUID()}`,
      traceId: context?.traceId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
      retryPolicy: input.retryPolicy ?? { maxAttempts: 3, backoffSeconds: 30 },
      timeoutSeconds: input.timeoutSeconds ?? 1800,
    };
    if (job.idempotencyKey) this.idempotencyKeys.add(job.idempotencyKey);
    this.jobs.push(job);
    return job;
  }

  async runNext(): Promise<JobResult | null> {
    const job = this.jobs.shift();
    if (!job) return null;
    return this.worker(job);
  }

  size(): number {
    return this.jobs.length;
  }
}
