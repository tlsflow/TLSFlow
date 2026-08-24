import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import { canonicalize } from '../../../shared/canonical-json.js';
import type { ExecutionRunStatus, ExecutionStepStatus } from '../../../shared/enums/core.enums.js';
import { assertTransition, InvalidStateTransitionError } from '../../../shared/state-machine/core-state-machine.js';
import type { ExecutionRunEntity } from '../schema/executions.schema.js';

export class ExecutionsDomainService {
  buildRunRequestHash(input: { deploymentPlanId: string; type: string; sourceRunId?: string }): string {
    return createHash('sha256').update(canonicalize(input)).digest('hex');
  }

  transitionRun(current: ExecutionRunStatus, next: ExecutionRunStatus): void {
    try {
      assertTransition('executionRun', current, next);
    } catch (error) {
      if (error instanceof InvalidStateTransitionError) {
        throw new AppError('DEPLOYMENT_INVALID_STATE', error.message, { from: current, to: next });
      }
      throw error;
    }
  }

  transitionStep(current: ExecutionStepStatus, next: ExecutionStepStatus): void {
    try {
      assertTransition('executionStep', current, next);
    } catch (error) {
      if (error instanceof InvalidStateTransitionError) {
        throw new AppError('DEPLOYMENT_INVALID_STATE', error.message, { from: current, to: next });
      }
      throw error;
    }
  }

  assertRollbackAllowed(run: ExecutionRunEntity): void {
    if (!['SUCCESS', 'FAILED', 'TIMEOUT'].includes(run.status)) {
      throw new AppError('DEPLOYMENT_INVALID_STATE', '只有成功、失败或超时的执行运行允许进入回滚', { runId: run.id, status: run.status });
    }
  }
}
