import type { ExecutionsRepository } from '../repository/executions.repository.js';
import type { ExecutionRunEntity, ExecutionStepEntity } from '../schema/executions.schema.js';

export interface RecoveryCandidate {
  run: ExecutionRunEntity;
  stepsToResume: ExecutionStepEntity[];
  skippedStepIds: string[];
}

export class RunRecoveryWorker {
  constructor(private readonly repository: ExecutionsRepository) {}

  async recoverableRuns(tenantId?: string): Promise<RecoveryCandidate[]> {
    const runs = await this.repository.listRuns(tenantId);
    const candidates: RecoveryCandidate[] = [];
    for (const run of runs.filter((item) => ['PENDING', 'DISPATCHED', 'RUNNING'].includes(item.status))) {
      const steps = (await this.repository.listSteps(tenantId, run.id)).sort((left, right) => left.stepNo - right.stepNo);
      const stepsToResume = steps.filter((step) => this.canResume(step));
      const skippedStepIds = steps.filter((step) => step.status === 'RUNNING' && step.idempotent === false).map((step) => step.id);
      candidates.push({ run, stepsToResume, skippedStepIds });
    }
    return candidates;
  }

  private canResume(step: ExecutionStepEntity): boolean {
    if (step.status === 'PENDING') return true;
    if (step.status !== 'RUNNING') return false;
    return step.idempotent !== false;
  }
}
