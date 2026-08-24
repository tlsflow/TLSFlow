import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import type { ExecutionRunEntity, ExecutionStepEntity } from '../schema/executions.schema.js';

function sameTenant(left?: string, right?: string): boolean {
  if (right === undefined) return true;
  return (left ?? '') === right;
}

export class ExecutionsRepository {
  readonly moduleName = 'executions' as const;

  constructor(private readonly db: DatabasePort = new PgliteDatabase()) {}

  async createRun(run: ExecutionRunEntity): Promise<ExecutionRunEntity> {
    await this.ensureSchema();
    const duplicated = await this.findRunByIdempotencyKey(run.tenantId, run.idempotencyKey);
    if (duplicated) {
      throw new AppError('IDEMPOTENCY_CONFLICT', '执行运行幂等键已被使用', { idempotencyKey: run.idempotencyKey });
    }
    await this.db.query(
      `insert into pg_execution_runs (
         id, tenant_id, deployment_plan_id, execution_target_id, run_no, type, idempotency_key, request_hash,
         external_run_id, status, started_at, finished_at, error_code, error_message, concurrency_limit,
         recovery_attempt_count, last_recovery_at, summary, created_at, updated_at, created_by, updated_by, version
       ) values (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz,$12::timestamptz,$13,$14,$15,$16,$17::timestamptz,$18::jsonb,$19::timestamptz,$20::timestamptz,$21,$22,$23
       )`,
      [
        run.id, run.tenantId ?? null, run.deploymentPlanId, run.executionTargetId ?? null, run.runNo, run.type, run.idempotencyKey, run.requestHash,
        run.externalRunId ?? null, run.status, run.startedAt ?? null, run.finishedAt ?? null, run.errorCode ?? null, run.errorMessage ?? null, run.concurrencyLimit ?? null,
        run.recoveryAttemptCount ?? null, run.lastRecoveryAt ?? null, JSON.stringify(run.summary ?? {}), run.createdAt, run.updatedAt, run.createdBy, run.updatedBy ?? null, run.version,
      ],
    );
    return structuredClone(run);
  }

  async updateRun(id: string, patch: Partial<ExecutionRunEntity>): Promise<ExecutionRunEntity> {
    const current = await this.getRunOrThrow(id);
    const updated = { ...current, ...structuredClone(patch), version: (current.version ?? 1) + 1 };
    await this.db.query(
      `update pg_execution_runs
          set deployment_plan_id = $2,
              execution_target_id = $3,
              run_no = $4,
              type = $5,
              idempotency_key = $6,
              request_hash = $7,
              external_run_id = $8,
              status = $9,
              started_at = $10::timestamptz,
              finished_at = $11::timestamptz,
              error_code = $12,
              error_message = $13,
              concurrency_limit = $14,
              recovery_attempt_count = $15,
              last_recovery_at = $16::timestamptz,
              summary = $17::jsonb,
              updated_at = $18::timestamptz,
              created_by = $19,
              updated_by = $20,
              version = $21
        where id = $1`,
      [
        updated.id, updated.deploymentPlanId, updated.executionTargetId ?? null, updated.runNo, updated.type, updated.idempotencyKey, updated.requestHash,
        updated.externalRunId ?? null, updated.status, updated.startedAt ?? null, updated.finishedAt ?? null, updated.errorCode ?? null, updated.errorMessage ?? null, updated.concurrencyLimit ?? null,
        updated.recoveryAttemptCount ?? null, updated.lastRecoveryAt ?? null, JSON.stringify(updated.summary ?? {}), updated.updatedAt, updated.createdBy, updated.updatedBy ?? null, updated.version,
      ],
    );
    return updated;
  }

  async getRun(id: string, tenantId?: string): Promise<ExecutionRunEntity | undefined> {
    await this.ensureSchema();
    const result = await this.db.query<ExecutionRunRow>(`select * from pg_execution_runs where id = $1`, [id]);
    const row = result.rows[0];
    if (!row) return undefined;
    const run = toRun(row);
    return sameTenant(run.tenantId, tenantId) ? run : undefined;
  }

  async getRunOrThrow(id: string, tenantId?: string): Promise<ExecutionRunEntity> {
    const run = await this.getRun(id, tenantId);
    if (!run) throw new AppError('RESOURCE_NOT_FOUND', '执行运行不存在', { id });
    return run;
  }

  async listRuns(tenantId?: string, deploymentPlanId?: string): Promise<ExecutionRunEntity[]> {
    await this.ensureSchema();
    const result = await this.db.query<ExecutionRunRow>(`select * from pg_execution_runs order by created_at asc`);
    return result.rows
      .map(toRun)
      .filter((run) => sameTenant(run.tenantId, tenantId) && (!deploymentPlanId || run.deploymentPlanId === deploymentPlanId));
  }

  async findRunByIdempotencyKey(tenantId: string | undefined, idempotencyKey: string): Promise<ExecutionRunEntity | undefined> {
    await this.ensureSchema();
    const result = await this.db.query<ExecutionRunRow>(`select * from pg_execution_runs where idempotency_key = $1 order by created_at asc`, [idempotencyKey]);
    return result.rows.map(toRun).find((run) => sameTenant(run.tenantId, tenantId));
  }

  async nextRunNo(tenantId: string | undefined, deploymentPlanId: string): Promise<number> {
    const runs = await this.listRuns(tenantId, deploymentPlanId);
    return runs.reduce((max, run) => Math.max(max, run.runNo), 0) + 1;
  }

  async createStep(step: ExecutionStepEntity): Promise<ExecutionStepEntity> {
    await this.ensureSchema();
    const duplicated = await this.db.query<ExecutionStepRow>(
      `select * from pg_execution_steps where execution_run_id = $1 and step_no = $2 and coalesce(tenant_id, '') = coalesce($3, '') limit 1`,
      [step.executionRunId, step.stepNo, step.tenantId ?? null],
    );
    if (duplicated.rows.length > 0) {
      throw new AppError('RESOURCE_ALREADY_EXISTS', '执行步骤序号重复', { executionRunId: step.executionRunId, stepNo: step.stepNo });
    }
    await this.db.query(
      `insert into pg_execution_steps (
         id, tenant_id, execution_run_id, deployment_plan_target_id, step_no, step_type, name, depends_on, idempotent,
         attempt_count, max_attempts, last_failure_category, last_error_code, last_error_message, last_error_details, input_snapshot,
         status, started_at, finished_at, created_at, updated_at, created_by, updated_by, version
       ) values (
         $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17,$18::timestamptz,$19::timestamptz,$20::timestamptz,$21::timestamptz,$22,$23,$24
       )`,
      [
        step.id, step.tenantId ?? null, step.executionRunId, step.deploymentPlanTargetId ?? null, step.stepNo, step.stepType, step.name, JSON.stringify(step.dependsOn ?? []), step.idempotent ?? null,
        step.attemptCount, step.maxAttempts, step.lastFailureCategory ?? null, step.lastErrorCode ?? null, step.lastErrorMessage ?? null, step.lastErrorDetails ? JSON.stringify(step.lastErrorDetails) : null, JSON.stringify(step.inputSnapshot ?? {}),
        step.status, step.startedAt ?? null, step.finishedAt ?? null, step.createdAt, step.updatedAt, step.createdBy ?? null, step.updatedBy ?? null, step.version,
      ],
    );
    return structuredClone(step);
  }

  async updateStep(id: string, patch: Partial<ExecutionStepEntity>): Promise<ExecutionStepEntity> {
    const current = await this.getStepOrThrow(id);
    const updated = { ...current, ...structuredClone(patch), version: (current.version ?? 1) + 1 };
    await this.db.query(
      `update pg_execution_steps
          set execution_run_id = $2,
              deployment_plan_target_id = $3,
              step_no = $4,
              step_type = $5,
              name = $6,
              depends_on = $7::jsonb,
              idempotent = $8,
              attempt_count = $9,
              max_attempts = $10,
              last_failure_category = $11,
              last_error_code = $12,
              last_error_message = $13,
              last_error_details = $14::jsonb,
              input_snapshot = $15::jsonb,
              status = $16,
              started_at = $17::timestamptz,
              finished_at = $18::timestamptz,
              updated_at = $19::timestamptz,
              created_by = $20,
              updated_by = $21,
              version = $22
        where id = $1`,
      [
        updated.id, updated.executionRunId, updated.deploymentPlanTargetId ?? null, updated.stepNo, updated.stepType, updated.name, JSON.stringify(updated.dependsOn ?? []), updated.idempotent ?? null,
        updated.attemptCount, updated.maxAttempts, updated.lastFailureCategory ?? null, updated.lastErrorCode ?? null, updated.lastErrorMessage ?? null, updated.lastErrorDetails ? JSON.stringify(updated.lastErrorDetails) : null, JSON.stringify(updated.inputSnapshot ?? {}),
        updated.status, updated.startedAt ?? null, updated.finishedAt ?? null, updated.updatedAt, updated.createdBy ?? null, updated.updatedBy ?? null, updated.version,
      ],
    );
    return updated;
  }

  async getStep(id: string, tenantId?: string): Promise<ExecutionStepEntity | undefined> {
    await this.ensureSchema();
    const result = await this.db.query<ExecutionStepRow>(`select * from pg_execution_steps where id = $1`, [id]);
    const row = result.rows[0];
    if (!row) return undefined;
    const step = toStep(row);
    return sameTenant(step.tenantId, tenantId) ? step : undefined;
  }

  async getStepOrThrow(id: string, tenantId?: string): Promise<ExecutionStepEntity> {
    const step = await this.getStep(id, tenantId);
    if (!step) throw new AppError('RESOURCE_NOT_FOUND', '执行步骤不存在', { id });
    return step;
  }

  async listSteps(tenantId?: string, executionRunId?: string): Promise<ExecutionStepEntity[]> {
    await this.ensureSchema();
    const result = await this.db.query<ExecutionStepRow>(`select * from pg_execution_steps order by step_no asc`);
    return result.rows
      .map(toStep)
      .filter((step) => sameTenant(step.tenantId, tenantId) && (!executionRunId || step.executionRunId === executionRunId));
  }

  async deleteRunsByDeploymentPlan(tenantId: string | undefined, deploymentPlanId: string): Promise<{ runIds: string[]; stepIds: string[] }> {
    await this.ensureSchema();
    const runs = await this.listRuns(tenantId, deploymentPlanId);
    const runIds = runs.map((run) => run.id);
    if (runIds.length === 0) return { runIds: [], stepIds: [] };

    const steps = await this.listSteps(tenantId);
    const runIdSet = new Set(runIds);
    const stepIds = steps.filter((step) => runIdSet.has(step.executionRunId)).map((step) => step.id);
    await this.db.query(
      `delete from pg_execution_steps
        where execution_run_id = any($1::varchar[])
          and coalesce(tenant_id, '') = coalesce($2, '')`,
      [runIds, tenantId ?? null],
    );
    await this.db.query(
      `delete from pg_execution_runs
        where deployment_plan_id = $1
          and coalesce(tenant_id, '') = coalesce($2, '')`,
      [deploymentPlanId, tenantId ?? null],
    );
    return { runIds, stepIds };
  }

  async clear(): Promise<void> {
    await this.ensureSchema();
    await this.db.query('delete from pg_execution_steps');
    await this.db.query('delete from pg_execution_runs');
  }

  private async ensureSchema(): Promise<void> {
    await this.db.exec(`
      create table if not exists pg_execution_runs (
        id varchar(128) primary key,
        tenant_id varchar(128),
        deployment_plan_id varchar(128) not null,
        execution_target_id varchar(128),
        run_no integer not null,
        type varchar(32) not null,
        idempotency_key varchar(128) not null,
        request_hash varchar(128) not null,
        external_run_id varchar(128),
        status varchar(32) not null,
        started_at timestamptz,
        finished_at timestamptz,
        error_code varchar(128),
        error_message text,
        concurrency_limit integer,
        recovery_attempt_count integer,
        last_recovery_at timestamptz,
        summary jsonb not null default '{}'::jsonb,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        created_by varchar(128) not null,
        updated_by varchar(128),
        version integer not null default 1
      );
      create unique index if not exists idx_pg_execution_runs_idempotency
        on pg_execution_runs (coalesce(tenant_id, ''), idempotency_key);
      create index if not exists idx_pg_execution_runs_plan
        on pg_execution_runs (coalesce(tenant_id, ''), deployment_plan_id, created_at);
      create table if not exists pg_execution_steps (
        id varchar(128) primary key,
        tenant_id varchar(128),
        execution_run_id varchar(128) not null,
        deployment_plan_target_id varchar(128),
        step_no integer not null,
        step_type varchar(64) not null,
        name text not null,
        depends_on jsonb not null default '[]'::jsonb,
        idempotent boolean,
        attempt_count integer not null,
        max_attempts integer not null,
        last_failure_category varchar(64),
        last_error_code varchar(128),
        last_error_message text,
        last_error_details jsonb check (last_error_details is null or jsonb_typeof(last_error_details) = 'object'),
        input_snapshot jsonb not null default '{}'::jsonb,
        status varchar(32) not null,
        started_at timestamptz,
        finished_at timestamptz,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        created_by varchar(128),
        updated_by varchar(128),
        version integer not null default 1
      );
      create unique index if not exists idx_pg_execution_steps_run_stepno
        on pg_execution_steps (coalesce(tenant_id, ''), execution_run_id, step_no);
      create index if not exists idx_pg_execution_steps_run
        on pg_execution_steps (coalesce(tenant_id, ''), execution_run_id, step_no);
    `);
  }
}

type ExecutionRunRow = {
  id: string;
  tenant_id?: string | null;
  deployment_plan_id: string;
  execution_target_id?: string | null;
  run_no: number;
  type: ExecutionRunEntity['type'];
  idempotency_key: string;
  request_hash: string;
  external_run_id?: string | null;
  status: ExecutionRunEntity['status'];
  started_at?: string | null;
  finished_at?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  concurrency_limit?: number | null;
  recovery_attempt_count?: number | null;
  last_recovery_at?: string | null;
  summary: unknown;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by?: string | null;
  version: number;
};

type ExecutionStepRow = {
  id: string;
  tenant_id?: string | null;
  execution_run_id: string;
  deployment_plan_target_id?: string | null;
  step_no: number;
  step_type: ExecutionStepEntity['stepType'];
  name: string;
  depends_on: unknown;
  idempotent?: boolean | null;
  attempt_count: number;
  max_attempts: number;
  last_failure_category?: string | null;
  last_error_code?: string | null;
  last_error_message?: string | null;
  last_error_details?: unknown;
  input_snapshot: unknown;
  status: ExecutionStepEntity['status'];
  started_at?: string | null;
  finished_at?: string | null;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
  updated_by?: string | null;
  version: number;
};

function toRun(row: ExecutionRunRow): ExecutionRunEntity {
  return {
    id: row.id,
    tenantId: row.tenant_id ?? undefined,
    deploymentPlanId: row.deployment_plan_id,
    executionTargetId: row.execution_target_id ?? undefined,
    runNo: row.run_no,
    type: row.type,
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    externalRunId: row.external_run_id ?? undefined,
    status: row.status,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    errorCode: row.error_code ?? undefined,
    errorMessage: row.error_message ?? undefined,
    concurrencyLimit: row.concurrency_limit ?? undefined,
    recoveryAttemptCount: row.recovery_attempt_count ?? undefined,
    lastRecoveryAt: row.last_recovery_at ?? undefined,
    summary: asObject(row.summary),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by ?? undefined,
    version: row.version,
  };
}

function toStep(row: ExecutionStepRow): ExecutionStepEntity {
  return {
    id: row.id,
    tenantId: row.tenant_id ?? undefined,
    executionRunId: row.execution_run_id,
    deploymentPlanTargetId: row.deployment_plan_target_id ?? undefined,
    stepNo: row.step_no,
    stepType: row.step_type,
    name: row.name,
    dependsOn: asNumberArray(row.depends_on),
    idempotent: row.idempotent ?? undefined,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    lastFailureCategory: row.last_failure_category as ExecutionStepEntity['lastFailureCategory'] | undefined,
    lastErrorCode: row.last_error_code ?? undefined,
    lastErrorMessage: row.last_error_message ?? undefined,
    lastErrorDetails: row.last_error_details === null || row.last_error_details === undefined ? undefined : asObject(row.last_error_details),
    inputSnapshot: asObject(row.input_snapshot),
    status: row.status,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by ?? undefined,
    updatedBy: row.updated_by ?? undefined,
    version: row.version,
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asNumberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.map((item) => Number(item)).filter((item) => Number.isFinite(item)) : [];
}
