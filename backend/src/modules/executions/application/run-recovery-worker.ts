import type { ExecutionsRepository } from '../repository/executions.repository.js';
import type { ExecutionRunEntity, ExecutionStepEntity } from '../schema/executions.schema.js';

export interface RecoveryCandidate {
  run: ExecutionRunEntity;
  stepsToResume: ExecutionStepEntity[];
  skippedStepIds: string[];
  unknownStepIds: string[];
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
      const unknownStepIds = steps
        .filter((step) => step.status === 'RUNNING' && isPotentiallyUnknownWriteStep(step))
        .map((step) => step.id);
      candidates.push({ run, stepsToResume, skippedStepIds, unknownStepIds });
    }
    return candidates;
  }

  private canResume(step: ExecutionStepEntity): boolean {
    if (step.status === 'PENDING') return !hasUnknownResult(step);
    if (step.status !== 'RUNNING') return false;
    if (hasUnknownResult(step) || isPotentiallyUnknownWriteStep(step)) return false;
    return step.idempotent !== false;
  }
}

function hasUnknownResult(step: ExecutionStepEntity): boolean {
  const resultDetail = step.inputSnapshot.resultDetail;
  return Boolean(resultDetail && typeof resultDetail === 'object' && !Array.isArray(resultDetail)
    && String((resultDetail as Record<string, unknown>).executionStatus ?? '').toUpperCase() === 'UNKNOWN');
}

function isPotentiallyUnknownWriteStep(step: ExecutionStepEntity): boolean {
  const snapshot = step.inputSnapshot;
  const plan = snapshot.plan && typeof snapshot.plan === 'object' && !Array.isArray(snapshot.plan)
    ? snapshot.plan as Record<string, unknown>
    : undefined;
  const actionType = typeof snapshot.actionType === 'string' ? snapshot.actionType.trim().toLowerCase() : undefined;
  return snapshot.writeEffect === true
    || plan?.writeEffect === true
    || actionType === 'agent.plan.execute';
}
