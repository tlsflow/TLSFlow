import { AppError } from '../../../common/errors/app-error.js';
import type { CaOperationsRepository, CaAutomaticSyncTarget } from '../repository/ca-operations.repository.js';
import type { CaSyncRunEntity } from '../schema/internal-ca.schema.js';
import type { CreateCaSyncRunsInput } from './ca-sync-coordinator.js';
import { enqueueTaskBestEffort, type TaskEnqueuer } from '../../tasks/task-enqueue.js';

const overlapMs = 5 * 60_000;

export interface CaAutomaticSyncCreator {
  createCaSyncRuns(input: CreateCaSyncRunsInput): Promise<CaSyncRunEntity[]>;
}

export interface CaAutoSyncFailure {
  target: CaAutomaticSyncTarget;
  error: unknown;
}

export class CaAutoSyncScheduler {
  constructor(
    private readonly repository: Pick<CaOperationsRepository, 'listDueAutomaticSyncTargets'>,
    private readonly creator: CaAutomaticSyncCreator,
    private readonly onFailure?: (failure: CaAutoSyncFailure) => void,
    private readonly tasks?: TaskEnqueuer,
  ) {}

  async runOnce(maxTargets = 8, now = new Date()): Promise<number> {
    const limit = Number.isFinite(maxTargets) && maxTargets > 0 ? Math.floor(maxTargets) : 1;
    const targets = await this.repository.listDueAutomaticSyncTargets(now.toISOString(), limit);
    for (const target of targets) {
      try {
        const runs = await this.creator.createCaSyncRuns({
          tenantId: target.tenantId,
          providerId: target.providerId,
          caId: target.caId,
          objectTypes: [target.objectType],
          mode: 'incremental',
          changedAfter: resolveChangedAfter(target),
          actor: { id: 'system_ca_auto_sync', type: 'system' },
        });
        for (const run of runs) {
          enqueueTaskBestEffort(this.tasks, {
            tenantId: run.tenantId,
            taskType: 'CA_RECORD_SYNC',
            requestedBy: run.requestedBy,
            triggerSource: 'ca.sync.scheduler',
            idempotencyKey: `ca-record-sync:${run.id}`,
            payload: { syncRunId: run.id },
            resourceRefs: [
              { resourceType: 'caSyncRun', resourceId: run.id },
              { resourceType: 'certificateAuthority', resourceId: run.caId },
            ],
          });
        }
      } catch (error) {
        if (!(error instanceof AppError && error.errorCode === 'CA_SYNC_ALREADY_RUNNING')) {
          this.onFailure?.({ target, error });
        }
      }
    }
    return targets.length;
  }
}

function resolveChangedAfter(target: CaAutomaticSyncTarget): string | undefined {
  const watermark = target.sourceWatermark ?? target.completedAt;
  if (!watermark) return undefined;
  return new Date(new Date(watermark).getTime() - overlapMs).toISOString();
}
