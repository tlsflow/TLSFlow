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
    private readonly repository: Pick<CaOperationsRepository, 'listRunnableSyncRuns'>,
    private readonly processor: CaSyncBatchProcessor,
    private readonly workerId: string,
    private readonly onFailure?: (failure: CaSyncWorkerFailure) => void,
  ) {}

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
