import type { StepExecutionResult } from './executors.js';
import type { ExecutionFailureCategory } from '../dto/executions.dto.js';
import type { ExecutionStepEntity } from '../schema/executions.schema.js';

export interface FailurePolicyDecision {
  category: ExecutionFailureCategory;
  shouldAutoRetry: boolean;
}

export class FailurePolicyEngine {
  classify(step: ExecutionStepEntity, result: StepExecutionResult): FailurePolicyDecision {
    const errorCode = String(result.errorCode ?? '');
    const errorMessage = String(result.errorMessage ?? '');
    const bucket = `${errorCode} ${errorMessage}`.toLowerCase();

    if (bucket.includes('cancel')) {
      return { category: 'cancelled', shouldAutoRetry: false };
    }
    if (bucket.includes('timeout')) {
      return { category: 'timeout', shouldAutoRetry: step.attemptCount < step.maxAttempts };
    }
    if (bucket.includes('unsafe') || bucket.includes('non_idempotent') || bucket.includes('destructive')) {
      return { category: 'unsafe', shouldAutoRetry: false };
    }
    return { category: 'transient', shouldAutoRetry: step.attemptCount < step.maxAttempts };
  }
}
