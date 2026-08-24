import { AppError } from '../../../common/errors/app-error.js';
import { MemoryRepository } from '../../../persistence/repositories/memory-repository.js';
import type { RepositoryPort } from '../../../persistence/repositories/repository-port.js';
import type { ExecutionRunEntity, ExecutionStepEntity } from '../schema/executions.schema.js';

function sameTenant(left?: string, right?: string): boolean {
  return (left ?? '') === (right ?? '');
}

export class ExecutionsRepository {
  readonly moduleName = 'executions' as const;

  constructor(
    private readonly runs: RepositoryPort<ExecutionRunEntity> = new MemoryRepository<ExecutionRunEntity>(),
    private readonly steps: RepositoryPort<ExecutionStepEntity> = new MemoryRepository<ExecutionStepEntity>(),
  ) {}

  createRun(run: ExecutionRunEntity): ExecutionRunEntity {
    const duplicated = this.runs.list((item) => sameTenant(item.tenantId, run.tenantId) && item.idempotencyKey === run.idempotencyKey)[0];
    if (duplicated) {
      throw new AppError('IDEMPOTENCY_CONFLICT', '执行运行幂等键已被使用', { idempotencyKey: run.idempotencyKey });
    }
    return this.runs.create(run);
  }

  updateRun(id: string, patch: Partial<ExecutionRunEntity>): ExecutionRunEntity {
    return this.runs.update(id, { ...patch, version: (this.runs.getOrThrow(id).version ?? 1) + 1 });
  }

  getRun(id: string, tenantId?: string): ExecutionRunEntity | undefined {
    const run = this.runs.get(id);
    return run && sameTenant(run.tenantId, tenantId) ? run : undefined;
  }

  getRunOrThrow(id: string, tenantId?: string): ExecutionRunEntity {
    const run = this.getRun(id, tenantId);
    if (!run) throw new AppError('RESOURCE_NOT_FOUND', '执行运行不存在', { id });
    return run;
  }

  listRuns(tenantId?: string, deploymentPlanId?: string): ExecutionRunEntity[] {
    return this.runs.list((run) => sameTenant(run.tenantId, tenantId) && (!deploymentPlanId || run.deploymentPlanId === deploymentPlanId));
  }

  findRunByIdempotencyKey(tenantId: string | undefined, idempotencyKey: string): ExecutionRunEntity | undefined {
    return this.runs.list((run) => sameTenant(run.tenantId, tenantId) && run.idempotencyKey === idempotencyKey)[0];
  }

  nextRunNo(tenantId: string | undefined, deploymentPlanId: string): number {
    const runs = this.listRuns(tenantId, deploymentPlanId);
    return runs.reduce((max, run) => Math.max(max, run.runNo), 0) + 1;
  }

  createStep(step: ExecutionStepEntity): ExecutionStepEntity {
    const duplicated = this.steps.list((item) => sameTenant(item.tenantId, step.tenantId)
      && item.executionRunId === step.executionRunId
      && item.stepNo === step.stepNo)[0];
    if (duplicated) {
      throw new AppError('RESOURCE_ALREADY_EXISTS', '执行步骤序号重复', { executionRunId: step.executionRunId, stepNo: step.stepNo });
    }
    return this.steps.create(step);
  }

  updateStep(id: string, patch: Partial<ExecutionStepEntity>): ExecutionStepEntity {
    return this.steps.update(id, { ...patch, version: (this.steps.getOrThrow(id).version ?? 1) + 1 });
  }

  getStep(id: string, tenantId?: string): ExecutionStepEntity | undefined {
    const step = this.steps.get(id);
    return step && sameTenant(step.tenantId, tenantId) ? step : undefined;
  }

  getStepOrThrow(id: string, tenantId?: string): ExecutionStepEntity {
    const step = this.getStep(id, tenantId);
    if (!step) throw new AppError('RESOURCE_NOT_FOUND', '执行步骤不存在', { id });
    return step;
  }

  listSteps(tenantId?: string, executionRunId?: string): ExecutionStepEntity[] {
    return this.steps.list((step) => sameTenant(step.tenantId, tenantId) && (!executionRunId || step.executionRunId === executionRunId));
  }

  clear(): void {
    this.runs.clear();
    this.steps.clear();
  }
}
