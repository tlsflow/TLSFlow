import { AppError } from '../../../common/errors/app-error.js';
import type { JobPayload, JobResult } from '../../../queue/job.types.js';
import type { ExecutionsApplicationService } from './executions.application-service.js';
import { ExecutorRegistry } from './executors.js';

export class StepRunner {
  constructor(
    private readonly executions: ExecutionsApplicationService,
    private readonly registry: ExecutorRegistry = new ExecutorRegistry(),
  ) {}

  async run(job: JobPayload): Promise<JobResult> {
    if (job.jobType !== 'DEPLOYMENT_EXECUTE') {
      return { jobId: job.jobId, success: true };
    }
    const payload = job.payload as { runId?: string; tenantId?: string; actorId?: string };
    if (!payload.runId) {
      return { jobId: job.jobId, success: false, errorCode: 'RUN_ID_REQUIRED' };
    }

    try {
      const result = await this.executions.runDispatchedExecution(payload.runId, payload.actorId ?? job.actorId ?? 'system', payload.tenantId ?? job.tenantId, this.registry);
      return {
        jobId: job.jobId,
        success: result.success,
        errorCode: result.errorCode,
        details: result,
      };
    } catch (error) {
      if (error instanceof AppError) {
        return { jobId: job.jobId, success: false, errorCode: error.errorCode, details: error.details };
      }
      return {
        jobId: job.jobId,
        success: false,
        errorCode: 'STEP_RUNNER_FAILED',
        details: { message: error instanceof Error ? error.message : String(error) },
      };
    }
  }
}
