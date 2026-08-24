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

  private readonly db: DatabasePort;
  private readonly runs: PgDocumentRepository<ExecutionRunEntity>;
  private readonly steps: PgDocumentRepository<ExecutionStepEntity>;
  private storageReady?: Promise<void>;

  constructor(db: DatabasePort = new PgliteDatabase()) {
    this.db = db;
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
    await this.ensureStorage();
    const { clauses, params } = executionDocumentConditions({ tenantId, deploymentPlanId });
    return listExecutionDocuments<ExecutionRunEntity>(this.db, 'executions:runs', clauses, params, `
      order by payload->>'createdAt' asc`);
  }

  async findRunByIdempotencyKey(tenantId: string | undefined, idempotencyKey: string): Promise<ExecutionRunEntity | undefined> {
    await this.ensureStorage();
    const { clauses, params } = executionDocumentConditions({ tenantId });
    params.push(idempotencyKey);
    clauses.push(`payload->>'idempotencyKey' = $${params.length + 1}`);
    return (await listExecutionDocuments<ExecutionRunEntity>(this.db, 'executions:runs', clauses, params, `
      order by payload->>'createdAt' asc
      limit 1`))[0];
  }

  async nextRunNo(tenantId: string | undefined, deploymentPlanId: string): Promise<number> {
    const runs = await this.listRuns(tenantId, deploymentPlanId);
    return runs.reduce((max, run) => Math.max(max, run.runNo), 0) + 1;
  }

  async createStep(step: ExecutionStepEntity): Promise<ExecutionStepEntity> {
    await this.ensureStorage();
    const duplicateRows = await this.db.query<DocumentRow<ExecutionStepEntity>>(
      `select document_id, payload
         from pg_documents
        where namespace = 'executions:steps'
          and payload->>'executionRunId' = $1
          and (payload->>'stepNo')::integer = $2
          and payload->>'tenantId' is not distinct from $3::text
        limit 1`,
      [step.executionRunId, step.stepNo, step.tenantId ?? null],
    );
    const duplicated = documentEntity(duplicateRows.rows[0]);
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
    await this.ensureStorage();
    const { clauses, params } = executionDocumentConditions({ tenantId, executionRunId });
    return listExecutionDocuments<ExecutionStepEntity>(this.db, 'executions:steps', clauses, params, `
      order by (payload->>'stepNo')::integer asc, payload->>'createdAt' asc`);
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

  private async ensureStorage(): Promise<void> {
    if (!this.storageReady) {
      this.storageReady = this.runs.initialize();
    }
    await this.storageReady;
  }
}

interface DocumentRow<T> extends Record<string, unknown> {
  document_id: string;
  payload: T;
}

function documentEntity<T>(row: DocumentRow<T> | undefined): (T & { id: string }) | undefined {
  return row ? structuredClone({ ...row.payload, id: row.document_id }) : undefined;
}

async function listExecutionDocuments<T>(
  db: DatabasePort,
  namespace: 'executions:runs' | 'executions:steps',
  clauses: readonly string[],
  params: readonly unknown[],
  suffix = '',
): Promise<Array<T & { id: string }>> {
  const result = await db.query<DocumentRow<T>>(
    `select document_id, payload
       from pg_documents
      where namespace = $1
      ${clauses.length > 0 ? `and ${clauses.join('\n and ')}` : ''}
      ${suffix}`,
    [namespace, ...params],
  );
  return result.rows.map(documentEntity).filter((item): item is T & { id: string } => item !== undefined);
}

function executionDocumentConditions(input: {
  tenantId?: string;
  deploymentPlanId?: string;
  executionRunId?: string;
}): { clauses: string[]; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (input.tenantId !== undefined) {
    params.push(input.tenantId);
    clauses.push(`coalesce(payload->>'tenantId', '') = $${params.length + 1}`);
  }
  if (input.deploymentPlanId) {
    params.push(input.deploymentPlanId);
    clauses.push(`payload->>'deploymentPlanId' = $${params.length + 1}`);
  }
  if (input.executionRunId) {
    params.push(input.executionRunId);
    clauses.push(`payload->>'executionRunId' = $${params.length + 1}`);
  }
  return { clauses, params };
}
