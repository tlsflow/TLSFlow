import type { ExecutionsRepository } from '../repository/executions.repository.js';
import type { ExecutionRunEntity, ExecutionStepEntity } from '../schema/executions.schema.js';

export interface RecoveryCandidate {
  run: ExecutionRunEntity;
  stepsToResume: ExecutionStepEntity[];
  skippedStepIds: string[];
}

export class RunRecoveryWorker {
  constructor(private readonly repository: ExecutionsRepository) {}

  recoverableRuns(tenantId?: string): RecoveryCandidate[] {
    return this.repository.listRuns(tenantId)
      .filter((run) => ['PENDING', 'DISPATCHED', 'RUNNING'].includes(run.status))
      .map((run) => {
        const steps = this.repository.listSteps(tenantId, run.id).sort((left, right) => left.stepNo - right.stepNo);
        const stepsToResume = steps.filter((step) => this.canResume(step));
        const skippedStepIds = steps.filter((step) => step.status === 'RUNNING' && step.idempotent === false).map((step) => step.id);
        return { run, stepsToResume, skippedStepIds };
      });
  }

  private canResume(step: ExecutionStepEntity): boolean {
    if (step.status === 'PENDING') return true;
    if (step.status !== 'RUNNING') return false;
    return step.idempotent !== false;
  }
}
