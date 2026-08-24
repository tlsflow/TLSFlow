import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import type {
  AutomationEntity,
  AutomationRunActionResultEntity,
  AutomationRunEntity,
  AutomationRunTargetEntity,
  AutomationVersionEntity,
} from '../schema/automations.schema.js';

type AutomationRow = Record<string, unknown>;

function iso(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return value instanceof Date ? value.toISOString() : String(value);
}

function json<T>(value: unknown): T {
  if (typeof value === 'string') return JSON.parse(value) as T;
  return structuredClone(value) as T;
}

function mapAutomation(row: AutomationRow): AutomationEntity {
  return {
    id: String(row.id), tenantId: String(row.tenant_id), name: String(row.name),
    description: row.description ? String(row.description) : undefined,
    status: row.status as AutomationEntity['status'], currentVersion: Number(row.current_version),
    nextRunAt: iso(row.next_run_at), lastRunAt: iso(row.last_run_at), createdBy: String(row.created_by),
    createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)!, deletedAt: iso(row.deleted_at), version: Number(row.version),
  };
}

function mapVersion(row: AutomationRow): AutomationVersionEntity {
  return {
    id: String(row.id), tenantId: String(row.tenant_id), automationId: String(row.automation_id), version: Number(row.version),
    trigger: json(row.trigger_config), targetSelector: json(row.target_selector), actions: json(row.actions),
    guardrails: json(row.guardrails), checksum: String(row.checksum), createdBy: String(row.created_by), createdAt: iso(row.created_at)!,
  };
}

function mapRun(row: AutomationRow): AutomationRunEntity {
  return {
    id: String(row.id), tenantId: String(row.tenant_id), automationId: String(row.automation_id), automationVersion: Number(row.automation_version),
    automationNameSnapshot: String(row.automation_name_snapshot), triggerType: row.trigger_type as AutomationRunEntity['triggerType'],
    scheduledAt: iso(row.scheduled_at), idempotencyKey: String(row.idempotency_key), parentRunId: row.parent_run_id ? String(row.parent_run_id) : undefined,
    status: row.status as AutomationRunEntity['status'], targetSummary: json(row.target_summary), actionTypes: json(row.action_types),
    environmentSnapshots: json(row.environment_snapshots), failureStage: row.failure_stage as AutomationRunEntity['failureStage'],
    failureCode: row.failure_code ? String(row.failure_code) : undefined, failureMessage: row.failure_message ? String(row.failure_message) : undefined,
    startedAt: iso(row.started_at), finishedAt: iso(row.finished_at), createdBy: String(row.created_by), createdAt: iso(row.created_at)!,
  };
}

function mapTarget(row: AutomationRow): AutomationRunTargetEntity {
  return {
    id: String(row.id), tenantId: String(row.tenant_id), runId: String(row.run_id), sequenceNo: Number(row.sequence_no),
    targetSnapshot: json(row.target_snapshot), environmentSnapshot: row.environment_snapshot ? String(row.environment_snapshot) : undefined,
    actionTypes: json(row.action_types), status: row.status as AutomationRunTargetEntity['status'],
    currentAction: row.current_action as AutomationRunTargetEntity['currentAction'], failureStage: row.failure_stage as AutomationRunTargetEntity['failureStage'],
    deploymentPlanId: row.deployment_plan_id ? String(row.deployment_plan_id) : undefined,
    executionRunId: row.execution_run_id ? String(row.execution_run_id) : undefined,
    notificationRequestIds: json(row.notification_request_ids), errorCode: row.error_code ? String(row.error_code) : undefined,
    errorMessage: row.error_message ? String(row.error_message) : undefined, startedAt: iso(row.started_at), finishedAt: iso(row.finished_at),
    createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)!,
  };
}

function mapActionResult(row: AutomationRow): AutomationRunActionResultEntity {
  return {
    id: String(row.id), tenantId: String(row.tenant_id), runId: String(row.run_id), runTargetId: row.run_target_id ? String(row.run_target_id) : undefined,
    actionType: row.action_type as AutomationRunActionResultEntity['actionType'], actionPosition: Number(row.action_position),
    status: row.status as AutomationRunActionResultEntity['status'],
    externalReferenceType: row.external_reference_type as AutomationRunActionResultEntity['externalReferenceType'],
    externalReferenceId: row.external_reference_id ? String(row.external_reference_id) : undefined,
    failureStage: row.failure_stage as AutomationRunActionResultEntity['failureStage'], errorCode: row.error_code ? String(row.error_code) : undefined,
    errorMessage: row.error_message ? String(row.error_message) : undefined, startedAt: iso(row.started_at), finishedAt: iso(row.finished_at),
    createdAt: iso(row.created_at)!,
  };
}

export class AutomationsRepository {
  constructor(private readonly db: DatabasePort = new PgliteDatabase()) {}

  async acquireSchedulerLease(leaseKey: string, ownerId: string, leasedUntil: Date): Promise<boolean> {
    const result = await this.db.query<{ lease_key: string }>(`insert into automation_scheduler_leases (lease_key, owner_id, leased_until, updated_at)
      values ($1, $2, $3, now()) on conflict (lease_key) do update set owner_id = excluded.owner_id, leased_until = excluded.leased_until, updated_at = now()
      where automation_scheduler_leases.leased_until < now() returning lease_key`, [leaseKey, ownerId, leasedUntil.toISOString()]);
    return result.rows.length > 0;
  }

  transaction<T>(work: (repository: AutomationsRepository) => Promise<T>): Promise<T> {
    return this.db.transaction((transaction) => work(new AutomationsRepository(transaction)));
  }

  async createAutomation(entity: AutomationEntity): Promise<AutomationEntity> {
    await this.db.query(`insert into automation_definitions
      (id, tenant_id, name, description, status, current_version, next_run_at, last_run_at, created_by, created_at, updated_at, deleted_at, version)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [entity.id, entity.tenantId, entity.name, entity.description ?? null, entity.status, entity.currentVersion, entity.nextRunAt ?? null,
      entity.lastRunAt ?? null, entity.createdBy, entity.createdAt, entity.updatedAt, entity.deletedAt ?? null, entity.version]);
    return structuredClone(entity);
  }

  async getAutomation(id: string, tenantId: string, includeDeleted = false): Promise<AutomationEntity | undefined> {
    const result = await this.db.query<AutomationRow>(`select * from automation_definitions
      where id = $1 and tenant_id = $2 ${includeDeleted ? '' : "and status <> 'deleted'"}`, [id, tenantId]);
    return result.rows[0] ? mapAutomation(result.rows[0]) : undefined;
  }

  async getAutomationOrThrow(id: string, tenantId: string, includeDeleted = false): Promise<AutomationEntity> {
    const entity = await this.getAutomation(id, tenantId, includeDeleted);
    if (!entity) throw new AppError('RESOURCE_NOT_FOUND', '自动化不存在', { id });
    return entity;
  }

  async listAutomations(tenantId: string, includeDeleted = false): Promise<AutomationEntity[]> {
    const result = await this.db.query<AutomationRow>(`select * from automation_definitions
      where tenant_id = $1 ${includeDeleted ? '' : "and status <> 'deleted'"} order by updated_at desc`, [tenantId]);
    return result.rows.map(mapAutomation);
  }

  async updateAutomation(id: string, tenantId: string, patch: Partial<AutomationEntity>): Promise<AutomationEntity> {
    const current = await this.getAutomationOrThrow(id, tenantId, true);
    const next = { ...current, ...structuredClone(patch), id, tenantId, version: current.version + 1 };
    await this.db.query(`update automation_definitions set name=$1, description=$2, status=$3, current_version=$4,
      next_run_at=$5, last_run_at=$6, updated_at=$7, deleted_at=$8, version=$9 where id=$10 and tenant_id=$11`,
    [next.name, next.description ?? null, next.status, next.currentVersion, next.nextRunAt ?? null, next.lastRunAt ?? null,
      next.updatedAt, next.deletedAt ?? null, next.version, id, tenantId]);
    return next;
  }

  async createVersion(entity: AutomationVersionEntity): Promise<AutomationVersionEntity> {
    await this.db.query(`insert into automation_versions
      (id, tenant_id, automation_id, version, trigger_config, target_selector, actions, guardrails, checksum, created_by, created_at)
      values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11)`,
    [entity.id, entity.tenantId, entity.automationId, entity.version, JSON.stringify(entity.trigger), JSON.stringify(entity.targetSelector),
      JSON.stringify(entity.actions), JSON.stringify(entity.guardrails), entity.checksum, entity.createdBy, entity.createdAt]);
    return structuredClone(entity);
  }

  async getVersion(automationId: string, version: number, tenantId: string): Promise<AutomationVersionEntity | undefined> {
    const result = await this.db.query<AutomationRow>('select * from automation_versions where tenant_id=$1 and automation_id=$2 and version=$3', [tenantId, automationId, version]);
    return result.rows[0] ? mapVersion(result.rows[0]) : undefined;
  }

  async listVersions(automationId: string, tenantId: string): Promise<AutomationVersionEntity[]> {
    const result = await this.db.query<AutomationRow>('select * from automation_versions where tenant_id=$1 and automation_id=$2 order by version desc', [tenantId, automationId]);
    return result.rows.map(mapVersion);
  }

  async createRun(entity: AutomationRunEntity): Promise<AutomationRunEntity> {
    await this.db.query(`insert into automation_runs
      (id, tenant_id, automation_id, automation_version, automation_name_snapshot, trigger_type, scheduled_at, idempotency_key,
       parent_run_id, status, target_summary, action_types, environment_snapshots, failure_stage, failure_code, failure_message,
       started_at, finished_at, created_by, created_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15,$16,$17,$18,$19,$20)`,
    [entity.id, entity.tenantId, entity.automationId, entity.automationVersion, entity.automationNameSnapshot, entity.triggerType,
      entity.scheduledAt ?? null, entity.idempotencyKey, entity.parentRunId ?? null, entity.status, JSON.stringify(entity.targetSummary),
      JSON.stringify(entity.actionTypes), JSON.stringify(entity.environmentSnapshots), entity.failureStage ?? null, entity.failureCode ?? null,
      entity.failureMessage ?? null, entity.startedAt ?? null, entity.finishedAt ?? null, entity.createdBy, entity.createdAt]);
    return structuredClone(entity);
  }

  async findRunByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<AutomationRunEntity | undefined> {
    const result = await this.db.query<AutomationRow>('select * from automation_runs where tenant_id=$1 and idempotency_key=$2', [tenantId, idempotencyKey]);
    return result.rows[0] ? mapRun(result.rows[0]) : undefined;
  }

  async getRun(id: string, tenantId: string): Promise<AutomationRunEntity | undefined> {
    const result = await this.db.query<AutomationRow>('select * from automation_runs where id=$1 and tenant_id=$2', [id, tenantId]);
    return result.rows[0] ? mapRun(result.rows[0]) : undefined;
  }

  async updateRun(id: string, tenantId: string, patch: Partial<AutomationRunEntity>): Promise<AutomationRunEntity> {
    const current = await this.getRun(id, tenantId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', '自动化运行不存在', { id });
    const next = { ...current, ...structuredClone(patch), id, tenantId };
    await this.db.query(`update automation_runs set status=$1, target_summary=$2::jsonb, failure_stage=$3, failure_code=$4,
      failure_message=$5, started_at=$6, finished_at=$7 where id=$8 and tenant_id=$9`,
    [next.status, JSON.stringify(next.targetSummary), next.failureStage ?? null, next.failureCode ?? null, next.failureMessage ?? null,
      next.startedAt ?? null, next.finishedAt ?? null, id, tenantId]);
    return next;
  }

  async listRuns(tenantId: string, automationId?: string): Promise<AutomationRunEntity[]> {
    const result = await this.db.query<AutomationRow>(`select * from automation_runs where tenant_id=$1
      ${automationId ? 'and automation_id=$2' : ''} order by created_at desc`, automationId ? [tenantId, automationId] : [tenantId]);
    return result.rows.map(mapRun);
  }

  async createRunTarget(entity: AutomationRunTargetEntity): Promise<AutomationRunTargetEntity> {
    await this.db.query(`insert into automation_run_targets
      (id, tenant_id, run_id, sequence_no, target_snapshot, environment_snapshot, action_types, status, current_action, failure_stage,
       deployment_plan_id, execution_run_id, notification_request_ids, error_code, error_message, started_at, finished_at, created_at, updated_at)
      values ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18,$19)`,
    [entity.id, entity.tenantId, entity.runId, entity.sequenceNo, JSON.stringify(entity.targetSnapshot), entity.environmentSnapshot ?? null,
      JSON.stringify(entity.actionTypes), entity.status, entity.currentAction ?? null, entity.failureStage ?? null, entity.deploymentPlanId ?? null,
      entity.executionRunId ?? null, JSON.stringify(entity.notificationRequestIds), entity.errorCode ?? null, entity.errorMessage ?? null,
      entity.startedAt ?? null, entity.finishedAt ?? null, entity.createdAt, entity.updatedAt]);
    return structuredClone(entity);
  }

  async listRunTargets(runId: string, tenantId: string): Promise<AutomationRunTargetEntity[]> {
    const result = await this.db.query<AutomationRow>('select * from automation_run_targets where tenant_id=$1 and run_id=$2 order by sequence_no', [tenantId, runId]);
    return result.rows.map(mapTarget);
  }

  async updateRunTarget(id: string, tenantId: string, patch: Partial<AutomationRunTargetEntity>): Promise<AutomationRunTargetEntity> {
    const result = await this.db.query<AutomationRow>('select * from automation_run_targets where id=$1 and tenant_id=$2', [id, tenantId]);
    if (!result.rows[0]) throw new AppError('RESOURCE_NOT_FOUND', '自动化运行目标不存在', { id });
    const next = { ...mapTarget(result.rows[0]), ...structuredClone(patch), id, tenantId };
    await this.db.query(`update automation_run_targets set status=$1, current_action=$2, failure_stage=$3, deployment_plan_id=$4,
      execution_run_id=$5, notification_request_ids=$6::jsonb, error_code=$7, error_message=$8, started_at=$9, finished_at=$10,
      updated_at=$11 where id=$12 and tenant_id=$13`,
    [next.status, next.currentAction ?? null, next.failureStage ?? null, next.deploymentPlanId ?? null, next.executionRunId ?? null,
      JSON.stringify(next.notificationRequestIds), next.errorCode ?? null, next.errorMessage ?? null, next.startedAt ?? null,
      next.finishedAt ?? null, next.updatedAt, id, tenantId]);
    return next;
  }

  async createActionResult(entity: AutomationRunActionResultEntity): Promise<AutomationRunActionResultEntity> {
    await this.db.query(`insert into automation_run_action_results
      (id, tenant_id, run_id, run_target_id, action_type, action_position, status, external_reference_type, external_reference_id,
       failure_stage, error_code, error_message, started_at, finished_at, created_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [entity.id, entity.tenantId, entity.runId, entity.runTargetId ?? null, entity.actionType, entity.actionPosition, entity.status,
      entity.externalReferenceType ?? null, entity.externalReferenceId ?? null, entity.failureStage ?? null, entity.errorCode ?? null,
      entity.errorMessage ?? null, entity.startedAt ?? null, entity.finishedAt ?? null, entity.createdAt]);
    return structuredClone(entity);
  }

  async listActionResults(runId: string, tenantId: string): Promise<AutomationRunActionResultEntity[]> {
    const result = await this.db.query<AutomationRow>('select * from automation_run_action_results where tenant_id=$1 and run_id=$2 order by action_position', [tenantId, runId]);
    return result.rows.map(mapActionResult);
  }
}
