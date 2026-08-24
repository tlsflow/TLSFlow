import { randomUUID } from 'node:crypto';
import { AppError } from '../common/errors/app-error.js';
import { getRequestContext } from '../common/tracing/request-context.js';
import type { DatabasePort } from '../database/database-port.js';
import { PgliteDatabase } from '../database/pglite-database.js';
import type { JobPayload, JobResult, JobType } from './job.types.js';
import type { EnqueueJobInput, QueuePort } from './queue-port.js';

export type JobWorker = (job: JobPayload) => Promise<JobResult>;

interface JobQueueRow extends Record<string, unknown> {
  job_id: string;
  status: JobPayload['status'];
  payload: JobPayload;
  result: JobResult | null;
}

// 正式 PostgreSQL 队列实现。队列状态和结果都持久化到数据库，避免重启丢失待执行任务。
export class PgJobRunner implements QueuePort {
  private initialized?: Promise<void>;

  constructor(
    private readonly worker: JobWorker = async (job) => ({ jobId: job.jobId, success: true }),
    private readonly db: DatabasePort = new PgliteDatabase(),
    private readonly acceptedJobTypes?: readonly JobType[],
  ) {}

  async enqueue<TPayload extends Record<string, unknown>>(input: EnqueueJobInput<TPayload>): Promise<JobPayload<TPayload>> {
    await this.ensureTable();
    if (input.idempotencyKey) {
      const duplicated = await this.db.query<{ job_id: string }>(
        `select job_id
           from job_queue
          where idempotency_key = $1
          limit 1`,
        [input.idempotencyKey],
      );
      if (duplicated.rows.length > 0) {
        throw new AppError('IDEMPOTENCY_CONFLICT', '幂等键已被不同请求使用', { idempotencyKey: input.idempotencyKey });
      }
    }

    const context = getRequestContext();
    const job: JobPayload<TPayload> = {
      jobId: randomUUID(),
      jobType: input.jobType,
      attempt: 0,
      status: 'queued',
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

    await this.db.query(
      `insert into job_queue (job_id, status, payload, idempotency_key, created_at, updated_at)
       values ($1, $2, $3::jsonb, $4, now(), now())`,
      [job.jobId, job.status, JSON.stringify(job), job.idempotencyKey ?? null],
    );
    return structuredClone(job);
  }

  async runNext(): Promise<JobResult | null> {
    await this.ensureTable();
    const leased = await this.db.transaction(async (tx) => {
      const typeFilter = this.acceptedJobTypes?.length
        ? ` and payload->>'jobType' = any($1::text[])`
        : '';
      const selected = await tx.query<JobQueueRow>(
        `select job_id, status, payload, result
           from job_queue
          where status in ('queued', 'retrying')${typeFilter}
          order by created_at asc
          limit 1`,
        this.acceptedJobTypes?.length ? [[...this.acceptedJobTypes]] : undefined,
      );
      const row = selected.rows[0];
      if (!row) return null;

      const runningJob: JobPayload = {
        ...row.payload,
        attempt: row.payload.attempt + 1,
        status: 'running',
      };
      await tx.query(
        `update job_queue
            set status = 'running',
                payload = $2::jsonb,
                updated_at = now()
          where job_id = $1`,
        [row.job_id, JSON.stringify(runningJob)],
      );
      return runningJob;
    });
    if (!leased) return null;

    try {
      const result = await this.worker(leased);
      if (result.success) {
        const succeeded = { ...result, jobId: leased.jobId, attempt: leased.attempt, willRetry: false };
        await this.finishJob(leased, 'succeeded', succeeded);
        return succeeded;
      }
      return await this.handleFailure(leased, result);
    } catch (error) {
      return await this.handleFailure(leased, {
        jobId: leased.jobId,
        success: false,
        errorCode: 'JOB_WORKER_THROWN',
        details: { message: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  async size(): Promise<number> {
    await this.ensureTable();
    const result = await this.db.query<{ total: number }>(
      `select count(*)::int as total
         from job_queue
        where status in ('queued', 'retrying')`,
    );
    return result.rows[0]?.total ?? 0;
  }

  async getResult(jobId: string): Promise<JobResult | undefined> {
    await this.ensureTable();
    const result = await this.db.query<JobQueueRow>(
      `select job_id, status, payload, result
         from job_queue
        where job_id = $1`,
      [jobId],
    );
    const row = result.rows[0];
    return row?.result ? structuredClone(row.result) : undefined;
  }

  private async handleFailure(job: JobPayload, result: JobResult): Promise<JobResult> {
    const willRetry = job.attempt < job.retryPolicy.maxAttempts;
    const failedResult: JobResult = {
      ...result,
      jobId: job.jobId,
      success: false,
      attempt: job.attempt,
      willRetry,
    };
    const nextStatus: JobPayload['status'] = willRetry ? 'retrying' : 'failed';
    await this.finishJob(job, nextStatus, failedResult, willRetry ? { ...job, status: 'retrying' } : undefined);
    return failedResult;
  }

  private async finishJob(job: JobPayload, status: JobPayload['status'], result: JobResult, nextPayload: JobPayload = { ...job, status }): Promise<void> {
    await this.db.query(
      `update job_queue
          set status = $2,
              payload = $3::jsonb,
              result = $4::jsonb,
              updated_at = now()
        where job_id = $1`,
      [job.jobId, status, JSON.stringify(nextPayload), JSON.stringify(result)],
    );
  }

  private async ensureTable(): Promise<void> {
    if (!this.initialized) {
      this.initialized = this.db.exec(`
        create table if not exists job_queue (
          job_id varchar(128) primary key,
          status varchar(32) not null,
          payload jsonb not null,
          result jsonb null,
          idempotency_key varchar(255) null,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );
        create unique index if not exists idx_job_queue_idempotency_key
          on job_queue (idempotency_key)
          where idempotency_key is not null;
        create index if not exists idx_job_queue_status_created
          on job_queue (status, created_at asc);
      `);
    }
    await this.initialized;
  }
}
