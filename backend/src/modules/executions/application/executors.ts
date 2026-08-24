import type { ExecutionStepEntity } from '../schema/executions.schema.js';

export interface StepExecutionInput {
  step: ExecutionStepEntity;
  runType: string;
  dryRun: boolean;
}

export interface StepExecutionResult {
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
  detail?: Record<string, unknown>;
}

export interface Executor {
  readonly type: string;
  executeStep(input: StepExecutionInput): Promise<StepExecutionResult>;
}

export class MockExecutor implements Executor {
  readonly type = 'MOCK';

  async executeStep(input: StepExecutionInput): Promise<StepExecutionResult> {
    if (input.step.inputSnapshot.mockResult === 'fail') {
      return { success: false, errorCode: 'MOCK_STEP_FAILED', errorMessage: '模拟执行失败' };
    }
    return {
      success: true,
      detail: {
        dryRun: input.dryRun,
        stepType: input.step.stepType,
      },
    };
  }
}

export class ExecutorRegistry {
  private readonly executors = new Map<string, Executor>();

  constructor(executors: Executor[] = [new MockExecutor()]) {
    for (const executor of executors) {
      this.register(executor);
    }
  }

  register(executor: Executor): void {
    this.executors.set(executor.type, executor);
  }

  get(type: string): Executor {
    return this.executors.get(type) ?? this.executors.get('MOCK') ?? new MockExecutor();
  }
}
