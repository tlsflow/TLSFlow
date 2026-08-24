import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { PgDocumentRepository } from '../../../persistence/repositories/pg-document-repository.js';
import type { ExecutionRunEntity, ExecutionStepEntity } from '../schema/executions.schema.js';

function sameTenant(left?: string, right?: string): boolean {
  if (right === undefined) return true;
  return (left ?? '') === right;
}

function sameTenantStrict(left?: string, right?: string): boolean {
  return left === right;
}

export class ExecutionsRepository {
  readonly moduleName = 'executions' as const;

  private readonly runs: PgDocumentRepository<ExecutionRunEntity>;
  private readonly steps: PgDocumentRepository<ExecutionStepEntity>;

  constructor(db: DatabasePort = new PgliteDatabase()) {
    this.runs = new PgDocumentRepository(db, 'executions:runs');
    this.steps = new PgDocumentRepository(db, 'executions:steps');
  }

  async createRun(run: ExecutionRunEntity): Promise<ExecutionRunEntity> {
    const duplicated = await this.findRunByIdempotencyKey(run.tenantId, run.idempotencyKey);
    if (duplicated) {
      throw new AppError('IDEMPOTENCY_CONFLICT', '执行运行幂等键已被使用', { idempotencyKey: run.idempotencyKey });
    }
    return this.runs.create(run);
  }

  async updateRun(id: string, patch: Partial<ExecutionRunEntity>): Promise<ExecutionRunEntity> {
    const current = await this.getRunOrThrow(id);
    const updated = { ...current, ...structuredClone(patch), version: (current.version ?? 1) + 1 };
    return this.runs.upsert(updated);
  }

  async getRun(id: string, tenantId?: string): Promise<ExecutionRunEntity | undefined> {
    const run = await this.runs.get(id);
    if (!run) return undefined;
    return sameTenant(run.tenantId, tenantId) ? run : undefined;
  }

  async getRunOrThrow(id: string, tenantId?: string): Promise<ExecutionRunEntity> {
    const run = await this.getRun(id, tenantId);
    if (!run) throw new AppError('RESOURCE_NOT_FOUND', '执行运行不存在', { id });
    return run;
  }

  async listRuns(tenantId?: string, deploymentPlanId?: string): Promise<ExecutionRunEntity[]> {
    return this.runs.list((run) => sameTenant(run.tenantId, tenantId)
      && (!deploymentPlanId || run.deploymentPlanId === deploymentPlanId));
  }

  async findRunByIdempotencyKey(tenantId: string | undefined, idempotencyKey: string): Promise<ExecutionRunEntity | undefined> {
    return (await this.runs.list((run) => run.idempotencyKey === idempotencyKey
      && sameTenant(run.tenantId, tenantId)))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
  }

  async nextRunNo(tenantId: string | undefined, deploymentPlanId: string): Promise<number> {
    const runs = await this.listRuns(tenantId, deploymentPlanId);
    return runs.reduce((max, run) => Math.max(max, run.runNo), 0) + 1;
  }

  async createStep(step: ExecutionStepEntity): Promise<ExecutionStepEntity> {
    const duplicated = (await this.steps.list((item) => item.executionRunId === step.executionRunId
      && item.stepNo === step.stepNo
      && sameTenantStrict(item.tenantId, step.tenantId)))[0];
    if (duplicated) {
      throw new AppError('RESOURCE_ALREADY_EXISTS', '执行步骤序号重复', { executionRunId: step.executionRunId, stepNo: step.stepNo });
    }
    return this.steps.create(step);
  }

  async updateStep(id: string, patch: Partial<ExecutionStepEntity>): Promise<ExecutionStepEntity> {
    const current = await this.getStepOrThrow(id);
    const updated = { ...current, ...structuredClone(patch), version: (current.version ?? 1) + 1 };
    return this.steps.upsert(updated);
  }

  async getStep(id: string, tenantId?: string): Promise<ExecutionStepEntity | undefined> {
    const step = await this.steps.get(id);
    if (!step) return undefined;
    return sameTenant(step.tenantId, tenantId) ? step : undefined;
  }

  async getStepOrThrow(id: string, tenantId?: string): Promise<ExecutionStepEntity> {
    const step = await this.getStep(id, tenantId);
    if (!step) throw new AppError('RESOURCE_NOT_FOUND', '执行步骤不存在', { id });
    return step;
  }

  async listSteps(tenantId?: string, executionRunId?: string): Promise<ExecutionStepEntity[]> {
    return (await this.steps.list((step) => sameTenant(step.tenantId, tenantId)
      && (!executionRunId || step.executionRunId === executionRunId)))
      .sort((left, right) => left.stepNo - right.stepNo || left.createdAt.localeCompare(right.createdAt));
  }

  async deleteRunsByDeploymentPlan(tenantId: string | undefined, deploymentPlanId: string): Promise<{ runIds: string[]; stepIds: string[] }> {
    const runs = await this.listRuns(tenantId, deploymentPlanId);
    const runIds = runs.map((run) => run.id);
    if (runIds.length === 0) return { runIds: [], stepIds: [] };

    const steps = await this.listSteps(tenantId);
    const runIdSet = new Set(runIds);
    const stepIds = steps.filter((step) => runIdSet.has(step.executionRunId)).map((step) => step.id);
    await Promise.all(stepIds.map((id) => this.steps.delete(id)));
    await Promise.all(runIds.map((id) => this.runs.delete(id)));
    return { runIds, stepIds };
  }

  async clear(): Promise<void> {
    await this.steps.clear();
    await this.runs.clear();
  }
}
