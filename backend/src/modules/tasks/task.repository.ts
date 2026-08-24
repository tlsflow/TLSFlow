import type { DatabasePort } from '../../database/database-port.js';
import { newId } from '../../shared/id.js';
import type {
  MonitoringProbe,
  MonitoringProbePage,
  MonitoringProbeQuery,
  TaskAttempt,
  TaskDefinition,
  TaskDetail,
  TaskEnqueueInput,
  TaskEvent,
  TaskPage,
  TaskQuery,
  TaskResourceRef,
  TaskRun,
  TaskStatus,
} from './task.types.js';

interface TaskRunRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  task_type: string;
  definition_version: number;
  category: TaskRun['category'];
  status: TaskStatus;
  requested_by: string | null;
  trigger_source: string;
  resource_summary: Record<string, unknown> | null;
  idempotency_key: string | null;
  parent_task_id: string | null;
  payload: Record<string, unknown>;
  progress: Record<string, unknown> | null;
  available_at: string;
  next_attempt_at: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
}

export class TaskRepository {
  constructor(private readonly db: DatabasePort) {}

  async ensureDefinitions(definitions: readonly TaskDefinition[]): Promise<void> {
    for (const definition of definitions) {
      await this.db.query(
        `insert into task_definitions
          (id, task_type, version, category, display_key, executor_key, timeout_seconds, retry_policy, permission_key, sensitive_paths, enabled)
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb, $11)
         on conflict (task_type, version) do update set
           display_key = excluded.display_key,
           executor_key = excluded.executor_key,
           timeout_seconds = excluded.timeout_seconds,
           retry_policy = excluded.retry_policy,
           permission_key = excluded.permission_key,
           sensitive_paths = excluded.sensitive_paths,
           enabled = excluded.enabled,
           updated_at = now()`,
        [
          definition.id,
          definition.taskType,
          definition.version,
          definition.category,
          definition.displayKey,
          definition.executorKey,
          definition.timeoutSeconds,
          JSON.stringify(definition.retryPolicy),
          definition.permissionKey,
          JSON.stringify(definition.sensitivePaths),
          definition.enabled,
        ],
      );
    }
  }

  async findActiveByIdempotency(tenantId: string, taskType: string, idempotencyKey: string): Promise<TaskRun | undefined> {
    const result = await this.db.query<TaskRunRow>(
      `select * from task_runs
        where tenant_id = $1 and task_type = $2 and idempotency_key = $3
          and status not in ('SUCCEEDED', 'FAILED', 'CANCELLED')
        order by created_at desc limit 1`,
      [tenantId, taskType, idempotencyKey],
    );
    return result.rows[0] ? mapTaskRun(result.rows[0]) : undefined;
  }

  async create(input: TaskEnqueueInput, definition: TaskDefinition): Promise<TaskRun> {
    const id = newId('task');
    const task = await this.db.transaction(async (tx) => {
      await tx.query(
        `insert into task_runs
          (id, tenant_id, task_type, definition_version, category, status, requested_by, trigger_source,
           resource_summary, idempotency_key, parent_task_id, payload, available_at)
         values ($1, $2, $3, $4, $5, 'QUEUED', $6, $7, $8::jsonb, $9, $10, $11::jsonb, coalesce($12::timestamptz, now()))`,
        [
          id,
          input.tenantId,
          input.taskType,
          definition.version,
          definition.category,
          input.requestedBy ?? null,
          input.triggerSource,
          JSON.stringify(input.resourceSummary ?? {}),
          input.idempotencyKey ?? null,
          input.parentTaskId ?? null,
          JSON.stringify(input.payload ?? {}),
          input.availableAt ?? null,
        ],
      );
      for (const ref of uniqueRefs(input.resourceRefs ?? [])) {
        await tx.query(
          `insert into task_resource_refs (task_run_id, resource_type, resource_id, display_key)
           values ($1, $2, $3, $4)
           on conflict do nothing`,
          [id, ref.resourceType, ref.resourceId, ref.displayKey ?? null],
        );
      }
      await appendEvent(tx, id, 'CREATED', {
        taskType: input.taskType,
        category: definition.category,
        triggerSource: input.triggerSource,
      }, input.requestedBy);
      return this.getByIdWithDb(tx, input.tenantId, id);
    });
    if (!task) throw new Error('任务创建后无法读取');
    return task;
  }

  async getById(tenantId: string, id: string): Promise<TaskRun | undefined> {
    return this.getByIdWithDb(this.db, tenantId, id);
  }

  async list(query: TaskQuery): Promise<TaskPage> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = ['tenant_id = $1'];
    const params: unknown[] = [query.tenantId];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (query.category) add('category = ?', query.category);
    if (query.taskType) add('task_type = ?', query.taskType);
    if (query.status) add('status = ?', query.status);
    if (query.requestedBy) {
      params.push(query.requestedBy);
      const requestedByPlaceholder = `$${params.length}`;
      const requestedBySql = `requested_by = ${requestedByPlaceholder}`;
      if (query.includePendingApprovals) {
        where.push(`(${requestedBySql} or (
          status in ('QUEUED', 'RUNNING', 'RETRY_WAITING', 'CANCELLING')
          and nullif(coalesce(progress->>'approvalId', resource_summary->>'approvalId'), '') is not null
          and (
            progress->>'status' = 'waiting_approval'
            or resource_summary->>'status' = 'waiting_approval'
            or progress->>'approvalStatus' = 'pending'
            or resource_summary->>'approvalStatus' = 'pending'
            or progress->>'approvalPending' = 'true'
            or resource_summary->>'approvalPending' = 'true'
          )
        ))`);
      } else {
        where.push(requestedBySql);
      }
    }
    if (query.taskId) add('id = ?', query.taskId);
    if (query.createdFrom) add('created_at >= ?', query.createdFrom);
    if (query.createdTo) add('created_at <= ?', query.createdTo);
    if (query.keyword) {
      params.push(`%${query.keyword}%`);
      const placeholder = `$${params.length}`;
      where.push(`(id ilike ${placeholder} or task_type ilike ${placeholder} or coalesce(last_error_message, '') ilike ${placeholder})`);
    }
    if (query.resourceType || query.resourceId) {
      const resourceWhere: string[] = [];
      if (query.resourceType) {
        params.push(query.resourceType);
        resourceWhere.push(`resource_type = $${params.length}`);
      }
      if (query.resourceId) {
        params.push(query.resourceId);
        resourceWhere.push(`resource_id = $${params.length}`);
      }
      where.push(`exists (select 1 from task_resource_refs refs where refs.task_run_id = task_runs.id and ${resourceWhere.join(' and ')})`);
    }
    const whereSql = where.join(' and ');
    const count = await this.db.query<{ total: number }>(`select count(*)::int as total from task_runs where ${whereSql}`, params);
    const offset = (page - 1) * pageSize;
    const rows = await this.db.query<TaskRunRow>(
      `select * from task_runs where ${whereSql} order by created_at desc limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, pageSize, offset],
    );
    return { items: rows.rows.map(mapTaskRun), page, pageSize, total: count.rows[0]?.total ?? 0 };
  }

  async listActiveExecutionTasks(tenantId: string, requestedBy?: string, includePendingApprovals = false): Promise<TaskRun[]> {
    const params: unknown[] = [tenantId];
    const where = [
      'tenant_id = $1',
      `status in ('QUEUED', 'RUNNING', 'RETRY_WAITING', 'CANCELLING')`,
    ];
    if (requestedBy && includePendingApprovals) {
      params.push(requestedBy);
      where.push(`(requested_by = $${params.length} or (
        status in ('QUEUED', 'RUNNING', 'RETRY_WAITING', 'CANCELLING')
        and nullif(coalesce(progress->>'approvalId', resource_summary->>'approvalId'), '') is not null
        and (
          progress->>'status' = 'waiting_approval'
          or resource_summary->>'status' = 'waiting_approval'
          or progress->>'approvalStatus' = 'pending'
          or resource_summary->>'approvalStatus' = 'pending'
          or progress->>'approvalPending' = 'true'
          or resource_summary->>'approvalPending' = 'true'
        )
      ))`);
    } else if (requestedBy) {
      params.push(requestedBy);
      where.push(`requested_by = $${params.length}`);
    }
    const rows = await this.db.query<TaskRunRow>(
      `select * from task_runs where ${where.join(' and ')} order by created_at desc limit 200`,
      params,
    );
    return rows.rows.map(mapTaskRun);
  }

  async claimNext(tenantId: string | undefined, workerId: string, leaseSeconds: number): Promise<{ task: TaskRun; attempt: TaskAttempt } | undefined> {
    return this.db.transaction(async (tx) => {
      await recoverExpiredLeases(tx);
      const params: unknown[] = [];
      const tenantSql = tenantId ? `and tenant_id = $${params.push(tenantId)}` : '';
      const selected = await tx.query<TaskRunRow>(
        `select * from task_runs
          where status in ('QUEUED', 'RETRY_WAITING')
            and available_at <= now()
            and (next_attempt_at is null or next_attempt_at <= now())
            and (lease_expires_at is null or lease_expires_at <= now())
            ${tenantSql}
          order by available_at asc, created_at asc
          for update skip locked limit 1`,
        params,
      );
      const row = selected.rows[0];
      if (!row) return undefined;
      const attemptNoResult = await tx.query<{ attempt_no: number }>(
        'select coalesce(max(attempt_no), 0)::int + 1 as attempt_no from task_attempts where task_run_id = $1',
        [row.id],
      );
      const attemptNo = attemptNoResult.rows[0]?.attempt_no ?? 1;
      const attemptId = newId('attempt');
      const expiresAt = new Date(Date.now() + leaseSeconds * 1000).toISOString();
      await tx.query(
        `insert into task_attempts (id, task_run_id, attempt_no, worker_id, lease_expires_at, status)
         values ($1, $2, $3, $4, $5, 'RUNNING')`,
        [attemptId, row.id, attemptNo, workerId, expiresAt],
      );
      await tx.query(
        `update task_runs set status = 'RUNNING', lease_owner = $2, lease_expires_at = $3,
            started_at = coalesce(started_at, now()), next_attempt_at = null
          where id = $1`,
        [row.id, workerId, expiresAt],
      );
      await appendEvent(tx, row.id, 'CLAIMED', { workerId, attemptNo }, undefined, attemptId);
      const task = await this.getByIdWithDb(tx, row.tenant_id, row.id);
      if (!task) throw new Error('Claim 后任务不存在');
      return {
        task,
        attempt: {
          id: attemptId,
          taskRunId: row.id,
          attemptNo,
          workerId,
          leaseExpiresAt: expiresAt,
          status: 'RUNNING',
          startedAt: new Date().toISOString(),
        },
      };
    });
  }

  async heartbeat(task: TaskRun, attempt: TaskAttempt, workerId: string, leaseSeconds: number, progress?: Record<string, unknown>): Promise<void> {
    const expiresAt = new Date(Date.now() + leaseSeconds * 1000).toISOString();
    const result = await this.db.query(
      `update task_runs set lease_expires_at = $4, progress = coalesce($5::jsonb, progress)
        where id = $1 and tenant_id = $2 and lease_owner = $3 and status = 'RUNNING'
        returning id`,
      [task.id, task.tenantId, workerId, expiresAt, progress ? JSON.stringify(progress) : null],
    );
    if (result.rows.length === 0) throw new Error('TASK_LEASE_LOST');
    await this.db.query(
      `update task_attempts set lease_expires_at = $2 where id = $1 and status = 'RUNNING'`,
      [attempt.id, expiresAt],
    );
    await appendEvent(this.db, task.id, progress ? 'PROGRESS' : 'HEARTBEAT', progress ?? { workerId }, undefined, attempt.id);
  }

  async finish(
    task: TaskRun,
    attempt: TaskAttempt,
    workerId: string,
    status: Extract<TaskStatus, 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'RETRY_WAITING'>,
    result: { errorCode?: string; errorMessage?: string; detail?: Record<string, unknown> },
    nextAttemptAt?: string,
    retryAfterSeconds?: number,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const nextStatus = status === 'RETRY_WAITING' ? 'RETRY_WAITING' : status;
      const updated = await tx.query(
        `update task_runs set status = $4, lease_owner = null, lease_expires_at = null,
            next_attempt_at = case
              when $6::double precision is not null then now() + ($6::double precision * interval '1 second')
              else $5::timestamptz
            end,
            finished_at = case when $4 in ('SUCCEEDED', 'FAILED', 'CANCELLED') then now() else finished_at end,
            last_error_code = $7, last_error_message = $8, progress = coalesce($9::jsonb, progress)
          where id = $1 and tenant_id = $2 and lease_owner = $3 and status = 'RUNNING'
          returning id`,
        [
          task.id,
          task.tenantId,
          workerId,
          nextStatus,
          nextAttemptAt ?? null,
          retryAfterSeconds ?? null,
          result.errorCode ?? null,
          result.errorMessage ?? null,
          result.detail ? JSON.stringify(result.detail) : null,
        ],
      );
      if (updated.rows.length === 0) throw new Error('TASK_LEASE_LOST');
      await tx.query(
        `update task_attempts set status = $2, finished_at = now(), error_code = $3, error_summary = $4
          where id = $1 and status = 'RUNNING'`,
        [attempt.id, status === 'SUCCEEDED' ? 'SUCCEEDED' : status === 'CANCELLED' ? 'CANCELLED' : status === 'RETRY_WAITING' ? 'FAILED' : 'FAILED', result.errorCode ?? null, result.errorMessage ?? null],
      );
      await appendEvent(tx, task.id, eventForStatus(nextStatus), result.detail ?? { errorCode: result.errorCode, errorMessage: result.errorMessage }, undefined, attempt.id);
    });
  }

  async requestCancel(tenantId: string, id: string, actorId?: string, reason?: string): Promise<TaskRun> {
    const result = await this.db.transaction(async (tx) => {
      const task = await this.getByIdWithDb(tx, tenantId, id);
      if (!task) throw new Error('NOT_FOUND');
      if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(task.status)) return task;
      const status = task.status === 'RUNNING' ? 'CANCELLING' : 'CANCELLED';
      await tx.query(`update task_runs set status = $3, finished_at = case when $3 = 'CANCELLED' then now() else finished_at end where id = $1 and tenant_id = $2`, [id, tenantId, status]);
      await appendEvent(tx, id, 'CANCEL_REQUESTED', { status, ...(reason ? { reason } : {}) }, actorId);
      return this.getByIdWithDb(tx, tenantId, id);
    });
    if (!result) throw new Error('任务取消后无法读取');
    return result;
  }

  async retry(tenantId: string, id: string, actorId?: string): Promise<TaskRun> {
    const result = await this.db.transaction(async (tx) => {
      const task = await this.getByIdWithDb(tx, tenantId, id);
      if (!task) throw new Error('NOT_FOUND');
      if (!['FAILED', 'CANCELLED'].includes(task.status)) throw new Error('NOT_RETRYABLE');
      await tx.query(
        `update task_runs set status = 'QUEUED', available_at = now(), next_attempt_at = null,
            finished_at = null, last_error_code = null, last_error_message = null
          where id = $1 and tenant_id = $2`,
        [id, tenantId],
      );
      await appendEvent(tx, id, 'RETRY_SCHEDULED', { actorId }, actorId);
      return this.getByIdWithDb(tx, tenantId, id);
    });
    if (!result) throw new Error('任务重试后无法读取');
    return result;
  }

  async detail(tenantId: string, id: string): Promise<TaskDetail | undefined> {
    const task = await this.getById(tenantId, id);
    if (!task) return undefined;
    // 监控任务会持续产生大量探测日志，详情只返回状态事件和探测记录，避免通用任务详情接口携带无用日志。
    const eventsQuery = task.category === 'MONITORING'
      ? 'select * from task_events where task_run_id = $1 and event_type <> \'LOG\' order by created_at asc'
      : 'select * from task_events where task_run_id = $1 order by created_at asc';
    const [attempts, events, childTasks, resourceRefs, auditEvents] = await Promise.all([
      this.db.query<Record<string, unknown>>('select * from task_attempts where task_run_id = $1 order by attempt_no asc', [id]),
      this.db.query<Record<string, unknown>>(eventsQuery, [id]),
      this.db.query<TaskRunRow>('select * from task_runs where tenant_id = $1 and parent_task_id = $2 order by created_at asc', [tenantId, id]),
      this.db.query<Record<string, unknown>>('select resource_type, resource_id, display_key from task_resource_refs where task_run_id = $1', [id]),
      this.db.query<{ payload: Record<string, unknown> }>(
        `select payload
           from pg_documents
          where namespace = 'security.audit_logs'
            and payload->>'resourceType' = 'task'
            and payload->>'resourceId' = $1
          order by updated_at asc`,
        [id],
      ),
    ]);
    return {
      task,
      attempts: attempts.rows.map(mapAttempt),
      events: events.rows.map(mapEvent),
      childTasks: childTasks.rows.map(mapTaskRun),
      resourceRefs: resourceRefs.rows.map((row) => ({ resourceType: String(row.resource_type), resourceId: String(row.resource_id), displayKey: row.display_key ? String(row.display_key) : undefined })),
      auditEvents: auditEvents.rows.map((row) => redactRecord(row.payload)),
    };
  }

  async listMonitoringProbes(query: MonitoringProbeQuery): Promise<MonitoringProbePage> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = ['tenant_id = $1'];
    const params: unknown[] = [query.tenantId];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (query.taskRunId) add('task_run_id = ?', query.taskRunId);
    if (query.monitorTargetId) add('monitor_target_id = ?', query.monitorTargetId);
    if (query.serviceAssetId) add('service_asset_id = ?', query.serviceAssetId);
    if (query.status) add('status = ?', query.status);
    if (query.checkedFrom) add('checked_at >= ?', query.checkedFrom);
    if (query.checkedTo) add('checked_at <= ?', query.checkedTo);
    const whereSql = where.join(' and ');
    const count = await this.db.query<{ total: number }>(`select count(*)::int as total from task_monitor_probes where ${whereSql}`, params);
    const rows = await this.db.query<Record<string, unknown>>(
      `select * from task_monitor_probes where ${whereSql} order by checked_at desc limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize],
    );
    return { items: rows.rows.map(mapProbe), page, pageSize, total: count.rows[0]?.total ?? 0 };
  }

  private async getByIdWithDb(db: DatabasePort, tenantId: string, id: string): Promise<TaskRun | undefined> {
    const result = await db.query<TaskRunRow>('select * from task_runs where tenant_id = $1 and id = $2', [tenantId, id]);
    return result.rows[0] ? mapTaskRun(result.rows[0]) : undefined;
  }
}

async function recoverExpiredLeases(db: DatabasePort): Promise<void> {
  const expired = await db.query<{ id: string; tenant_id: string; attempt_id: string }>(
    `select task_runs.id, task_runs.tenant_id, task_attempts.id as attempt_id
       from task_runs
       join task_attempts on task_attempts.task_run_id = task_runs.id
         and task_attempts.status = 'RUNNING'
      where task_runs.status in ('RUNNING', 'CANCELLING')
        and task_runs.lease_expires_at is not null
        and task_runs.lease_expires_at <= now()
      for update of task_runs, task_attempts skip locked`,
  );
  for (const row of expired.rows) {
    const nextStatus = row.id && (await db.query<{ status: TaskStatus }>(
      'select status from task_runs where id = $1',
      [row.id],
    )).rows[0]?.status === 'CANCELLING' ? 'CANCELLED' : 'RETRY_WAITING';
    await db.query(
      `update task_attempts set status = $2, finished_at = now(), error_code = $3, error_summary = $4
       where id = $1 and status = 'RUNNING'`,
      [row.attempt_id, nextStatus === 'CANCELLED' ? 'CANCELLED' : 'EXPIRED', 'TASK_LEASE_EXPIRED', 'Worker 租约已过期'],
    );
    await db.query(
      `update task_runs
          set status = $2,
              lease_owner = null,
              lease_expires_at = null,
              next_attempt_at = case when $2 = 'RETRY_WAITING' then now() else null end,
              finished_at = case when $2 = 'CANCELLED' then now() else finished_at end,
              last_error_code = case when $2 = 'RETRY_WAITING' then $3 else last_error_code end,
              last_error_message = case when $2 = 'RETRY_WAITING' then $4 else last_error_message end
        where id = $1`,
      [row.id, nextStatus, 'TASK_LEASE_EXPIRED', 'Worker 租约已过期，任务已回收'],
    );
    await appendEvent(db, row.id, nextStatus === 'CANCELLED' ? 'CANCELLED' : 'EXPIRED', {
      errorCode: 'TASK_LEASE_EXPIRED',
      reason: '租约过期自动回收',
    });
  }
}

export async function appendEvent(
  db: DatabasePort,
  taskRunId: string,
  eventType: string,
  eventData: Record<string, unknown>,
  actorId?: string,
  attemptId?: string,
): Promise<void> {
  await db.query(
    `insert into task_events (id, task_run_id, attempt_id, event_type, event_data, actor_type, actor_id, request_id)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
    [newId('event'), taskRunId, attemptId ?? null, eventType, JSON.stringify(redactRecord(eventData)), actorId ? 'USER' : 'SYSTEM', actorId ?? null, undefined],
  );
}

function eventForStatus(status: TaskStatus): string {
  if (status === 'SUCCEEDED') return 'SUCCEEDED';
  if (status === 'FAILED') return 'FAILED';
  if (status === 'CANCELLED') return 'CANCELLED';
  return 'RETRY_SCHEDULED';
}

function mapTaskRun(row: TaskRunRow): TaskRun {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    taskType: row.task_type,
    definitionVersion: Number(row.definition_version),
    category: row.category,
    status: row.status,
    requestedBy: row.requested_by ?? undefined,
    triggerSource: row.trigger_source,
    resourceSummary: row.resource_summary ?? undefined,
    idempotencyKey: row.idempotency_key ?? undefined,
    parentTaskId: row.parent_task_id ?? undefined,
    payload: row.payload ?? {},
    progress: row.progress ?? undefined,
    availableAt: String(row.available_at),
    nextAttemptAt: row.next_attempt_at ? String(row.next_attempt_at) : undefined,
    leaseOwner: row.lease_owner ?? undefined,
    leaseExpiresAt: row.lease_expires_at ? String(row.lease_expires_at) : undefined,
    createdAt: String(row.created_at),
    startedAt: row.started_at ? String(row.started_at) : undefined,
    finishedAt: row.finished_at ? String(row.finished_at) : undefined,
    lastErrorCode: row.last_error_code ?? undefined,
    lastErrorMessage: row.last_error_message ?? undefined,
  };
}

function mapAttempt(row: Record<string, unknown>): TaskAttempt {
  return {
    id: String(row.id),
    taskRunId: String(row.task_run_id),
    attemptNo: Number(row.attempt_no),
    workerId: String(row.worker_id),
    leaseExpiresAt: String(row.lease_expires_at),
    status: row.status as TaskAttempt['status'],
    startedAt: String(row.started_at),
    finishedAt: row.finished_at ? String(row.finished_at) : undefined,
    errorCode: row.error_code ? String(row.error_code) : undefined,
    errorSummary: row.error_summary ? String(row.error_summary) : undefined,
  };
}

function mapEvent(row: Record<string, unknown>): TaskEvent {
  return {
    id: String(row.id),
    taskRunId: String(row.task_run_id),
    attemptId: row.attempt_id ? String(row.attempt_id) : undefined,
    eventType: row.event_type as TaskEvent['eventType'],
    eventData: redactRecord((row.event_data ?? {}) as Record<string, unknown>),
    actorType: String(row.actor_type),
    actorId: row.actor_id ? String(row.actor_id) : undefined,
    requestId: row.request_id ? String(row.request_id) : undefined,
    createdAt: String(row.created_at),
  };
}

function mapProbe(row: Record<string, unknown>): MonitoringProbe {
  return {
    id: String(row.id),
    taskRunId: String(row.task_run_id),
    tenantId: String(row.tenant_id),
    monitorTargetId: row.monitor_target_id ? String(row.monitor_target_id) : undefined,
    serviceAssetId: String(row.service_asset_id),
    status: String(row.status),
    checkedAt: String(row.checked_at),
    latencyMs: row.latency_ms === null || row.latency_ms === undefined ? undefined : Number(row.latency_ms),
    summary: row.summary ? String(row.summary) : undefined,
    detail: redactRecord((row.detail ?? {}) as Record<string, unknown>),
  };
}

function uniqueRefs(refs: readonly TaskResourceRef[]): TaskResourceRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.resourceType}:${ref.resourceId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function redactRecord(value: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/password|secret|token|private.?key|authorization/i.test(key)) {
      output[key] = '[REDACTED]';
    } else if (item && typeof item === 'object' && !Array.isArray(item)) {
      output[key] = redactRecord(item as Record<string, unknown>);
    } else {
      output[key] = item;
    }
  }
  return output;
}
