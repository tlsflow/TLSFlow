import { AppError } from '../../../common/errors/app-error.js';
import type { ExecutionStepEntity } from '../schema/executions.schema.js';

export interface StepGraphState {
  runnable: ExecutionStepEntity[];
  blocked: ExecutionStepEntity[];
  running: ExecutionStepEntity[];
  terminal: ExecutionStepEntity[];
}

function isTerminal(status: ExecutionStepEntity['status']): boolean {
  return ['SUCCESS', 'FAILED', 'TIMEOUT', 'SKIPPED'].includes(status);
}

function terminalSatisfied(status: ExecutionStepEntity['status']): boolean {
  return ['SUCCESS', 'SKIPPED'].includes(status);
}

export class StepGraphBuilder {
  build(steps: ExecutionStepEntity[]): StepGraphState {
    const sorted = [...steps].sort((left, right) => left.stepNo - right.stepNo);
    const stepByNo = new Map(sorted.map((step) => [step.stepNo, step] as const));
    this.assertNoCycles(sorted, stepByNo);

    const runnable: ExecutionStepEntity[] = [];
    const blocked: ExecutionStepEntity[] = [];
    const running: ExecutionStepEntity[] = [];
    const terminal: ExecutionStepEntity[] = [];

    for (const step of sorted) {
      if (step.status === 'RUNNING') {
        running.push(step);
        continue;
      }
      if (isTerminal(step.status)) {
        terminal.push(step);
        continue;
      }
      if (step.status !== 'PENDING') {
        blocked.push(step);
        continue;
      }
      const dependencies = this.getDependencies(step, sorted);
      if (dependencies.every((dependencyNo) => terminalSatisfied(stepByNo.get(dependencyNo)?.status ?? 'FAILED'))) {
        runnable.push(step);
      } else {
        blocked.push(step);
      }
    }

    return { runnable, blocked, running, terminal };
  }

  getDependencies(step: ExecutionStepEntity, orderedSteps: ExecutionStepEntity[]): number[] {
    if (Array.isArray(step.dependsOn) && step.dependsOn.length > 0) {
      return [...new Set(step.dependsOn)].sort((left, right) => left - right);
    }
    const previous = orderedSteps
      .filter((candidate) => candidate.stepNo < step.stepNo && candidate.deploymentPlanTargetId === step.deploymentPlanTargetId)
      .sort((left, right) => right.stepNo - left.stepNo)[0];
    return previous ? [previous.stepNo] : [];
  }

  private assertNoCycles(orderedSteps: ExecutionStepEntity[], stepByNo: Map<number, ExecutionStepEntity>): void {
    const visiting = new Set<number>();
    const visited = new Set<number>();

    const visit = (stepNo: number) => {
      if (visited.has(stepNo)) return;
      if (visiting.has(stepNo)) {
        throw new AppError('VALIDATION_FAILED', '执行步骤依赖存在循环', { stepNo });
      }
      visiting.add(stepNo);
      const step = stepByNo.get(stepNo);
      if (!step) {
        throw new AppError('VALIDATION_FAILED', '执行步骤依赖引用了不存在的步骤', { stepNo });
      }
      for (const dependencyNo of this.getDependencies(step, orderedSteps)) {
        if (!stepByNo.has(dependencyNo)) {
          throw new AppError('VALIDATION_FAILED', '执行步骤依赖引用了不存在的步骤', { stepNo, dependencyNo });
        }
        visit(dependencyNo);
      }
      visiting.delete(stepNo);
      visited.add(stepNo);
    };

    for (const step of orderedSteps) {
      visit(step.stepNo);
    }
  }
}
