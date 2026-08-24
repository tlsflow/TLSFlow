import type { JobPayload, JobResult, JobType } from './job.types.js';

export interface EnqueueJobInput<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  jobType: JobType;
  resourceType?: string;
  resourceId?: string;
  idempotencyKey?: string;
  payload: TPayload;
  retryPolicy?: { maxAttempts: number; backoffSeconds: number };
  timeoutSeconds?: number;
}

export interface QueuePort {
  enqueue<TPayload extends Record<string, unknown>>(input: EnqueueJobInput<TPayload>): Promise<JobPayload<TPayload>>;
  runNext(): Promise<JobResult | null>;
}
