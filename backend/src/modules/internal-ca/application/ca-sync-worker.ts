import type { CaOperationsRepository } from '../repository/ca-operations.repository.js';
import type { CaSyncRunEntity } from '../schema/internal-ca.schema.js';

export interface CaSyncBatchProcessor {
  processNextCaSyncBatch(
    tenantId: string,
    runId: string,
    workerId: string,
    now?: Date,
  ): Promise<CaSyncRunEntity>;
}

export interface CaSyncWorkerFailure {
  run: CaSyncRunEntity;
  error: unknown;
}

export class CaSyncWorker {
  constructor(
    private readonly repository: Pick<CaOperationsRepository, 'listRunnableSyncRuns'>
      & Partial<Pick<CaOperationsRepository, 'getSyncRun'>>,
    private readonly processor: CaSyncBatchProcessor,
    private readonly workerId: string,
    private readonly onFailure?: (failure: CaSyncWorkerFailure) => void,
  ) {}

  async runRun(tenantId: string, runId: string, now = new Date()): Promise<CaSyncRunEntity> {
    try {
      return await this.processor.processNextCaSyncBatch(tenantId, runId, this.workerId, now);
    } catch (error) {
      const run = await this.repository.getSyncRun?.(tenantId, runId);
      if (run) this.onFailure?.({ run, error });
      throw error;
    }
  }

  async runOnce(maxRuns = 4, now = new Date()): Promise<number> {
    const limit = Number.isFinite(maxRuns) && maxRuns > 0 ? Math.floor(maxRuns) : 1;
    const runs = await this.repository.listRunnableSyncRuns(now.toISOString(), limit);
    for (const run of runs) {
      try {
        await this.processor.processNextCaSyncBatch(run.tenantId, run.id, this.workerId, now);
      } catch (error) {
        this.onFailure?.({ run, error });
      }
    }
    return runs.length;
  }
}
