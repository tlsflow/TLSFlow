import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import type {
  AutomationEntity,
  AutomationRunActionResultEntity,
  AutomationRunEntity,
  AutomationRunTargetEntity,
  AutomationTriggerDeliveryEntity,
  AutomationVersionEntity,
} from '../schema/automations.schema.js';

type AutomationRow = Record<string, unknown>;

function iso(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return value instanceof Date ? value.toISOString() : String(value);
}

function json<T>(value: unknown, fallback?: T): T {
  if (value === undefined || value === null) return structuredClone(fallback) as T;
  if (typeof value === 'string') return JSON.parse(value) as T;
  return structuredClone(value) as T;
}

function mapAutomation(row: AutomationRow): AutomationEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    description: row.description ? String(row.description) : undefined,
    status: row.status as AutomationEntity['status'],
    currentVersion: Number(row.current_version),
    nextRunAt: iso(row.next_run_at),
    lastRunAt: iso(row.last_run_at),
    createdBy: String(row.created_by),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
    deletedAt: iso(row.deleted_at),
    version: Number(row.version),
  };
}

function mapVersion(row: AutomationRow): AutomationVersionEntity {
  const legacySelector = json(row.target_selector, {}) as AutomationVersionEntity['targetSelector'];
  const targetResolver = json(row.target_resolver, undefined) as AutomationVersionEntity['targetResolver'];
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    automationId: String(row.automation_id),
    version: Number(row.version),
    trigger: json(row.trigger_config),
    filters: json(row.filters, []),
    targetResolver: targetResolver ?? { type: 'legacy_target_selector', selector: legacySelector },
    targetSelector: legacySelector,
    approvalStage: json(row.approval_stage, undefined),
    actions: json(row.actions),
    guardrails: json(row.guardrails),
    checksum: String(row.checksum),
    createdBy: String(row.created_by),
    createdAt: iso(row.created_at)!,
  };
}

function mapRun(row: AutomationRow): AutomationRunEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    automationId: String(row.automation_id),
    automationVersion: Number(row.automation_version),
    automationNameSnapshot: String(row.automation_name_snapshot),
    triggerType: row.trigger_type as AutomationRunEntity['triggerType'],
    scheduledAt: iso(row.scheduled_at),
    idempotencyKey: String(row.idempotency_key),
    parentRunId: row.parent_run_id ? String(row.parent_run_id) : undefined,
    triggerContext: json(row.trigger_context, undefined),
    executionOptions: json(row.execution_options, undefined),
    approvalId: row.approval_id ? String(row.approval_id) : undefined,
    deliveryId: row.delivery_id ? String(row.delivery_id) : undefined,
    status: row.status as AutomationRunEntity['status'],
    targetSummary: json(row.target_summary),
    actionTypes: json(row.action_types),
    environmentSnapshots: json(row.environment_snapshots, []),
    failureStage: row.failure_stage as AutomationRunEntity['failureStage'],
    failureCode: row.failure_code ? String(row.failure_code) : undefined,
    failureMessage: row.failure_message ? String(row.failure_message) : undefined,
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
    createdBy: String(row.created_by),
    createdAt: iso(row.created_at)!,
  };
}

function mapDelivery(row: AutomationRow): AutomationTriggerDeliveryEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    automationId: String(row.automation_id),
    automationVersion: Number(row.automation_version),
    deliveryKey: String(row.delivery_key),
    triggerType: row.trigger_type as AutomationTriggerDeliveryEntity['triggerType'],
    eventType: row.event_type ? String(row.event_type) : undefined,
    payload: json(row.payload, {}),
    status: row.status as AutomationTriggerDeliveryEntity['status'],
    runId: row.run_id ? String(row.run_id) : undefined,
    approvalId: row.approval_id ? String(row.approval_id) : undefined,
    errorCode: row.error_code ? String(row.error_code) : undefined,
    errorMessage: row.error_message ? String(row.error_message) : undefined,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

function mapTarget(row: AutomationRow): AutomationRunTargetEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    runId: String(row.run_id),
    sequenceNo: Number(row.sequence_no),
    targetSnapshot: json(row.target_snapshot),
    environmentSnapshot: row.environment_snapshot ? String(row.environment_snapshot) : undefined,
    actionTypes: json(row.action_types),
    status: row.status as AutomationRunTargetEntity['status'],
    currentAction: row.current_action as AutomationRunTargetEntity['currentAction'],
    failureStage: row.failure_stage as AutomationRunTargetEntity['failureStage'],
    deploymentPlanId: row.deployment_plan_id ? String(row.deployment_plan_id) : undefined,
    executionRunId: row.execution_run_id ? String(row.execution_run_id) : undefined,
    notificationRequestIds: json(row.notification_request_ids, []),
    errorCode: row.error_code ? String(row.error_code) : undefined,
    errorMessage: row.error_message ? String(row.error_message) : undefined,
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

function mapActionResult(row: AutomationRow): AutomationRunActionResultEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    runId: String(row.run_id),
    runTargetId: row.run_target_id ? String(row.run_target_id) : undefined,
    actionType: row.action_type as AutomationRunActionResultEntity['actionType'],
    actionPosition: Number(row.action_position),
    status: row.status as AutomationRunActionResultEntity['status'],
    externalReferenceType: row.external_reference_type as AutomationRunActionResultEntity['externalReferenceType'],
    externalReferenceId: row.external_reference_id ? String(row.external_reference_id) : undefined,
    failureStage: row.failure_stage as AutomationRunActionResultEntity['failureStage'],
    errorCode: row.error_code ? String(row.error_code) : undefined,
    errorMessage: row.error_message ? String(row.error_message) : undefined,
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
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

  async releaseSchedulerLease(leaseKey: string, ownerId: string): Promise<void> {
    await this.db.query(
      `delete from automation_scheduler_leases
        where lease_key = $1 and owner_id = $2`,
      [leaseKey, ownerId],
    );
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

  async listAutomationTenantIds(): Promise<string[]> {
    const result = await this.db.query<{ tenant_id: string }>(`select distinct tenant_id from automation_definitions where status <> 'deleted'
      union select distinct tenant_id from automation_runs where status in ('queued', 'running', 'waiting_approval') order by tenant_id`);
    return result.rows.map((row) => String(row.tenant_id));
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
      (id, tenant_id, automation_id, version, trigger_config, filters, target_resolver, target_selector, approval_stage, actions, guardrails, checksum, created_by, created_at)
      values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14)`,
    [entity.id, entity.tenantId, entity.automationId, entity.version, JSON.stringify(entity.trigger), JSON.stringify(entity.filters ?? []),
      JSON.stringify(entity.targetResolver ?? { type: 'legacy_target_selector', selector: entity.targetSelector ?? {} }),
      JSON.stringify(entity.targetSelector ?? {}), JSON.stringify(entity.approvalStage ?? null),
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
       parent_run_id, trigger_context, execution_options, approval_id, delivery_id, status, target_summary, action_types, environment_snapshots,
       failure_stage, failure_code, failure_message, started_at, finished_at, created_by, created_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb,$18,$19,$20,$21,$22,$23,$24)`,
    [entity.id, entity.tenantId, entity.automationId, entity.automationVersion, entity.automationNameSnapshot, entity.triggerType,
      entity.scheduledAt ?? null, entity.idempotencyKey, entity.parentRunId ?? null, JSON.stringify(entity.triggerContext ?? null),
      JSON.stringify(entity.executionOptions ?? null), entity.approvalId ?? null, entity.deliveryId ?? null, entity.status, JSON.stringify(entity.targetSummary),
      JSON.stringify(entity.actionTypes), JSON.stringify(entity.environmentSnapshots), entity.failureStage ?? null,
      entity.failureCode ?? null, entity.failureMessage ?? null, entity.startedAt ?? null, entity.finishedAt ?? null,
      entity.createdBy, entity.createdAt]);
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
    await this.db.query(`update automation_runs set status=$1, trigger_context=$2::jsonb, execution_options=$3::jsonb, approval_id=$4, delivery_id=$5,
      target_summary=$6::jsonb, failure_stage=$7, failure_code=$8, failure_message=$9, started_at=$10, finished_at=$11
      where id=$12 and tenant_id=$13`,
    [next.status, JSON.stringify(next.triggerContext ?? null), JSON.stringify(next.executionOptions ?? null), next.approvalId ?? null, next.deliveryId ?? null,
      JSON.stringify(next.targetSummary), next.failureStage ?? null, next.failureCode ?? null, next.failureMessage ?? null,
      next.startedAt ?? null, next.finishedAt ?? null, id, tenantId]);
    return next;
  }

  async listRuns(tenantId: string, automationId?: string): Promise<AutomationRunEntity[]> {
    const result = await this.db.query<AutomationRow>(`select * from automation_runs where tenant_id=$1
      ${automationId ? 'and automation_id=$2' : ''} order by created_at desc`, automationId ? [tenantId, automationId] : [tenantId]);
    return result.rows.map(mapRun);
  }

  async listRunnableRuns(limit: number): Promise<AutomationRunEntity[]> {
    const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 1;
    const result = await this.db.query<AutomationRow>(`select * from automation_runs
      where status in ('queued', 'running', 'waiting_approval') order by created_at asc limit $1`, [normalizedLimit]);
    return result.rows.map(mapRun);
  }

  async createDelivery(entity: AutomationTriggerDeliveryEntity): Promise<AutomationTriggerDeliveryEntity> {
    await this.db.query(`insert into automation_trigger_deliveries
      (id, tenant_id, automation_id, automation_version, delivery_key, trigger_type, event_type, payload, status, run_id, approval_id, error_code, error_message, created_at, updated_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15)`,
    [entity.id, entity.tenantId, entity.automationId, entity.automationVersion, entity.deliveryKey, entity.triggerType, entity.eventType ?? null,
      JSON.stringify(entity.payload), entity.status, entity.runId ?? null, entity.approvalId ?? null, entity.errorCode ?? null,
      entity.errorMessage ?? null, entity.createdAt, entity.updatedAt]);
    return structuredClone(entity);
  }

  async getDelivery(id: string, tenantId: string): Promise<AutomationTriggerDeliveryEntity | undefined> {
    const result = await this.db.query<AutomationRow>('select * from automation_trigger_deliveries where id=$1 and tenant_id=$2', [id, tenantId]);
    return result.rows[0] ? mapDelivery(result.rows[0]) : undefined;
  }

  async findDelivery(tenantId: string, automationId: string, automationVersion: number, deliveryKey: string): Promise<AutomationTriggerDeliveryEntity | undefined> {
    const result = await this.db.query<AutomationRow>(`select * from automation_trigger_deliveries
      where tenant_id=$1 and automation_id=$2 and automation_version=$3 and delivery_key=$4`,
    [tenantId, automationId, automationVersion, deliveryKey]);
    return result.rows[0] ? mapDelivery(result.rows[0]) : undefined;
  }

  async updateDelivery(id: string, tenantId: string, patch: Partial<AutomationTriggerDeliveryEntity>): Promise<AutomationTriggerDeliveryEntity> {
    const current = await this.getDelivery(id, tenantId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', '自动化触发投递不存在', { id });
    const next = { ...current, ...structuredClone(patch), id, tenantId };
    await this.db.query(`update automation_trigger_deliveries set payload=$1::jsonb, status=$2, run_id=$3, approval_id=$4,
      error_code=$5, error_message=$6, updated_at=$7 where id=$8 and tenant_id=$9`,
    [JSON.stringify(next.payload), next.status, next.runId ?? null, next.approvalId ?? null, next.errorCode ?? null,
      next.errorMessage ?? null, next.updatedAt, id, tenantId]);
    return next;
  }

  async listDeliveries(tenantId: string, automationId?: string): Promise<AutomationTriggerDeliveryEntity[]> {
    const result = await this.db.query<AutomationRow>(`select * from automation_trigger_deliveries where tenant_id=$1
      ${automationId ? 'and automation_id=$2' : ''} order by created_at desc`, automationId ? [tenantId, automationId] : [tenantId]);
    return result.rows.map(mapDelivery);
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

  async getRunTarget(id: string, tenantId: string): Promise<AutomationRunTargetEntity | undefined> {
    const result = await this.db.query<AutomationRow>('select * from automation_run_targets where id=$1 and tenant_id=$2', [id, tenantId]);
    return result.rows[0] ? mapTarget(result.rows[0]) : undefined;
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

  async updateActionResult(id: string, tenantId: string, patch: Partial<AutomationRunActionResultEntity>): Promise<AutomationRunActionResultEntity> {
    const result = await this.db.query<AutomationRow>('select * from automation_run_action_results where id=$1 and tenant_id=$2', [id, tenantId]);
    if (!result.rows[0]) throw new AppError('RESOURCE_NOT_FOUND', '自动化动作结果不存在', { id });
    const next = { ...mapActionResult(result.rows[0]), ...structuredClone(patch), id, tenantId };
    await this.db.query(`update automation_run_action_results set status=$1, external_reference_type=$2, external_reference_id=$3,
      failure_stage=$4, error_code=$5, error_message=$6, started_at=$7, finished_at=$8 where id=$9 and tenant_id=$10`,
    [next.status, next.externalReferenceType ?? null, next.externalReferenceId ?? null, next.failureStage ?? null,
      next.errorCode ?? null, next.errorMessage ?? null, next.startedAt ?? null, next.finishedAt ?? null, id, tenantId]);
    return next;
  }

  async listActionResults(runId: string, tenantId: string): Promise<AutomationRunActionResultEntity[]> {
    const result = await this.db.query<AutomationRow>('select * from automation_run_action_results where tenant_id=$1 and run_id=$2 order by action_position', [tenantId, runId]);
    return result.rows.map(mapActionResult);
  }
}
