-- 恢复执行历史的可验证部分。
-- 状态转移是执行状态的事实源；审计和任务文档只用于补齐能被明确证明的关联。
-- 原始任务载荷可能包含私钥、PFX、Token 和密码，本迁移只写入脱敏的恢复元数据。

create table if not exists pg_documents (
  namespace varchar(128) not null,
  document_id varchar(128) not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (namespace, document_id)
);

create index if not exists idx_pg_documents_namespace_updated
  on pg_documents (namespace, updated_at desc);

create temporary table if not exists gcac_restored_execution_runs (
  id text primary key,
  tenant_id text,
  deployment_plan_id text not null,
  execution_target_id text,
  run_no integer not null,
  type text not null,
  idempotency_key text not null,
  request_hash text not null,
  external_run_id text,
  status text not null,
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  error_message text,
  summary jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  created_by text not null,
  updated_by text,
  version integer not null
) on commit drop;

truncate gcac_restored_execution_runs;

with run_events as (
  select
    payload,
    payload->>'entityId' as run_id,
    nullif(payload->>'tenantId', '') as tenant_id,
    (payload->>'createdAt')::timestamptz as occurred_at
  from pg_documents
  where namespace = 'deployment-plans:transitions'
    and payload->>'entityType' = 'executionRun'
    and nullif(payload->>'entityId', '') is not null
), run_ids as (
  select distinct run_id from run_events
), latest as (
  select distinct on (run_id)
    run_id, tenant_id, payload->>'toStatus' as status, payload->>'actorId' as actor_id,
    occurred_at
  from run_events
  order by run_id, occurred_at desc
), firsts as (
  select
    run_id,
    max(tenant_id) as tenant_id,
    min(occurred_at) as created_at,
    min(occurred_at) filter (where payload->>'toStatus' = 'RUNNING') as started_at,
    max(occurred_at) filter (where payload->>'toStatus' in ('SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED', 'ROLLBACK_SUCCESS', 'ROLLBACK_FAILED')) as finished_at
  from run_events
  group by run_id
), audit as (
  select
    payload->>'resourceId' as run_id,
    max(payload->'detail'->>'deploymentPlanId') as deployment_plan_id,
    max(payload->'detail'->>'jobId') as external_run_id,
    max(payload->>'action') as action
  from pg_documents
  where namespace = 'security.audit_logs'
    and payload->>'resourceType' = 'executionRun'
    and payload->>'resourceId' in (select run_id from run_ids)
  group by payload->>'resourceId'
), task_links as (
  select
    payload->>'executionRunId' as run_id,
    max(document_id) as task_id,
    max(nullif(payload->>'tenantId', '')) as tenant_id
  from pg_documents
  where namespace = 'agents:tasks'
    and payload->>'executionRunId' in (select run_id from run_ids)
  group by payload->>'executionRunId'
), numbered as (
  select
    run_ids.run_id,
    coalesce(firsts.tenant_id, latest.tenant_id, task_links.tenant_id) as tenant_id,
    coalesce(audit.deployment_plan_id, 'restored:unresolved:plan:' || run_ids.run_id) as deployment_plan_id,
    row_number() over (
      partition by coalesce(firsts.tenant_id, latest.tenant_id, task_links.tenant_id, ''), coalesce(audit.deployment_plan_id, 'restored:unresolved:plan:' || run_ids.run_id)
      order by firsts.created_at, run_ids.run_id
    )::integer as run_no,
    case
      when coalesce(audit.action, '') like 'execution.dry_run.%' then 'dry_run'
      when coalesce(audit.action, '') like 'execution.rollback.%'
        or exists (
          select 1 from run_events rollback_event
          where rollback_event.run_id = run_ids.run_id
            and rollback_event.payload->>'event' = 'rollback.requested'
        ) then 'rollback'
      else 'apply'
    end as type,
    coalesce(audit.external_run_id, task_links.task_id) as external_run_id,
    latest.status,
    firsts.started_at,
    firsts.finished_at,
    case when latest.status in ('FAILED', 'TIMEOUT', 'ROLLBACK_FAILED') then 'RESTORED_HISTORY_FAILED' end as error_code,
    case when latest.status in ('FAILED', 'TIMEOUT', 'ROLLBACK_FAILED') then '执行历史已恢复；原始错误载荷未保留' end as error_message,
    firsts.created_at,
    latest.occurred_at as updated_at,
    coalesce(nullif(latest.actor_id, ''), 'restored:system') as actor_id,
    case when audit.deployment_plan_id is null then 'unresolved_plan' else 'plan_from_audit' end as plan_confidence
  from run_ids
  join firsts using (run_id)
  join latest using (run_id)
  left join audit using (run_id)
  left join task_links using (run_id)
)
insert into gcac_restored_execution_runs (
  id, tenant_id, deployment_plan_id, execution_target_id, run_no, type, idempotency_key, request_hash,
  external_run_id, status, started_at, finished_at, error_code, error_message, summary,
  created_at, updated_at, created_by, updated_by, version
)
select
  run_id,
  tenant_id,
  deployment_plan_id,
  null,
  run_no,
  type,
  'restored:run:' || run_id,
  'restored:request:' || md5(run_id || ':' || deployment_plan_id || ':' || type),
  external_run_id,
  case when status in ('PENDING', 'DISPATCHED', 'RUNNING', 'SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED', 'ROLLBACK_RUNNING', 'ROLLBACK_SUCCESS', 'ROLLBACK_FAILED') then status else 'FAILED' end,
  started_at,
  finished_at,
  error_code,
  error_message,
  jsonb_build_object(
    'restoredFromHistory', true,
    'restoredFrom', jsonb_build_array('deployment-plans:transitions', 'security.audit_logs', 'agents:tasks', 'security.execution_grants'),
    'recoveryConfidence', plan_confidence,
    'sourceRunId', run_id
  ),
  created_at,
  updated_at,
  actor_id,
  null,
  1
from numbered;

-- 无法确认父运行的步骤集中挂到一个明确标识的恢复运行，禁止伪造归属。
insert into gcac_restored_execution_runs (
  id, tenant_id, deployment_plan_id, execution_target_id, run_no, type, idempotency_key, request_hash,
  external_run_id, status, started_at, finished_at, error_code, error_message, summary,
  created_at, updated_at, created_by, updated_by, version
)
select
  'restored:unresolved:run',
  max(nullif(payload->>'tenantId', '')),
  'restored:unresolved:plan:execution-history',
  null, 1, 'apply', 'restored:run:unresolved', 'restored:request:unresolved', null,
  'FAILED', min((payload->>'createdAt')::timestamptz), max((payload->>'createdAt')::timestamptz),
  'RESTORED_HISTORY_UNRESOLVED', '无法从现有历史证据确认步骤所属运行',
  jsonb_build_object('restoredFromHistory', true, 'recoveryConfidence', 'unresolved_step_parent'),
  min((payload->>'createdAt')::timestamptz), max((payload->>'createdAt')::timestamptz), 'restored:system', null, 1
from pg_documents transition
where transition.namespace = 'deployment-plans:transitions'
  and transition.payload->>'entityType' = 'executionStep'
  and not exists (
    select 1
    from pg_documents task
    join pg_documents run_transition
      on run_transition.namespace = 'deployment-plans:transitions'
     and run_transition.payload->>'entityType' = 'executionRun'
     and run_transition.payload->>'entityId' = task.payload->>'executionRunId'
    where task.namespace = 'agents:tasks'
      and task.payload->>'executionStepId' = transition.payload->>'entityId'
  )
  and not exists (
    select 1
    from pg_documents grant_document
    join pg_documents run_transition
      on run_transition.namespace = 'deployment-plans:transitions'
     and run_transition.payload->>'entityType' = 'executionRun'
     and run_transition.payload->>'entityId' = grant_document.payload->>'runId'
    where grant_document.namespace = 'security.execution_grants'
      and split_part(grant_document.payload->>'stepId', ':', 1) = transition.payload->>'entityId'
  )
having count(*) > 0
on conflict (id) do nothing;

insert into pg_documents (namespace, document_id, payload, updated_at)
select
  'executions:runs', id,
  jsonb_strip_nulls(jsonb_build_object(
    'id', id, 'tenantId', tenant_id, 'deploymentPlanId', deployment_plan_id, 'executionTargetId', execution_target_id,
    'runNo', run_no, 'type', type, 'idempotencyKey', idempotency_key, 'requestHash', request_hash,
    'externalRunId', external_run_id, 'status', status, 'startedAt', started_at, 'finishedAt', finished_at,
    'errorCode', error_code, 'errorMessage', error_message, 'summary', summary, 'createdAt', created_at,
    'updatedAt', updated_at, 'createdBy', created_by, 'updatedBy', updated_by, 'version', version
  )), now()
from gcac_restored_execution_runs
on conflict (namespace, document_id) do update
set payload = excluded.payload, updated_at = excluded.updated_at;

create temporary table if not exists gcac_restored_execution_steps (
  id text primary key,
  tenant_id text,
  execution_run_id text not null,
  deployment_plan_target_id text,
  step_no integer not null,
  step_type text not null,
  name text not null,
  depends_on jsonb not null,
  idempotent boolean,
  attempt_count integer not null,
  max_attempts integer not null,
  last_failure_category text,
  last_error_code text,
  last_error_message text,
  last_error_details jsonb,
  input_snapshot jsonb not null,
  status text not null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  created_by text,
  updated_by text,
  version integer not null
) on commit drop;

truncate gcac_restored_execution_steps;

with step_events as (
  select payload, payload->>'entityId' as step_id, nullif(payload->>'tenantId', '') as tenant_id,
    (payload->>'createdAt')::timestamptz as occurred_at
  from pg_documents
  where namespace = 'deployment-plans:transitions'
    and payload->>'entityType' = 'executionStep'
    and nullif(payload->>'entityId', '') is not null
), latest as (
  select distinct on (step_id)
    step_id, tenant_id, payload->>'toStatus' as status, payload->>'actorId' as actor_id, occurred_at
  from step_events order by step_id, occurred_at desc
), firsts as (
  select
    step_id, max(tenant_id) as tenant_id, min(occurred_at) as created_at,
    min(occurred_at) filter (where payload->>'toStatus' = 'RUNNING') as started_at,
    max(occurred_at) filter (where payload->>'toStatus' in ('SUCCESS', 'FAILED', 'SKIPPED', 'TIMEOUT')) as finished_at,
    count(*) filter (where payload->>'toStatus' = 'RUNNING')::integer as running_count
  from step_events group by step_id
), task_links as (
  select distinct on (payload->>'executionStepId')
    payload->>'executionStepId' as step_id,
    payload->>'executionRunId' as execution_run_id,
    nullif(payload->>'tenantId', '') as tenant_id,
    document_id as task_id,
    coalesce(payload->>'deploymentPlanTargetId', payload->'payload'->>'deploymentPlanTargetId', payload->'payload'->'plan'->>'deploymentPlanTargetId') as deployment_plan_target_id,
    coalesce(payload->>'stepType', payload->'payload'->>'stepType') as step_type,
    coalesce(payload->'payload'->>'actionType', payload->'payload'->>'type', 'restored.history.step') as task_type,
    1 as source_priority,
    updated_at as source_updated_at
  from pg_documents
  where namespace = 'agents:tasks'
    and nullif(payload->>'executionStepId', '') is not null
  order by payload->>'executionStepId', updated_at desc, document_id desc
), grant_links as (
  select distinct on (split_part(payload->>'stepId', ':', 1))
    split_part(payload->>'stepId', ':', 1) as step_id,
    payload->>'runId' as execution_run_id,
    nullif(payload->>'tenantId', '') as tenant_id,
    document_id as task_id,
    null::text as deployment_plan_target_id,
    null::text as step_type,
    coalesce(payload->>'executorType', 'restored.history.step') as task_type,
    2 as source_priority,
    updated_at as source_updated_at
  from pg_documents
  where namespace = 'security.execution_grants'
    and exists (
      select 1
      from gcac_restored_execution_runs restored_run
      where restored_run.id = payload->>'runId'
    )
    and nullif(payload->>'stepId', '') is not null
    and split_part(payload->>'stepId', ':', 1) in (select step_id from step_events)
  order by split_part(payload->>'stepId', ':', 1), updated_at desc, document_id desc
), execution_links as (
  select * from task_links
  union all
  select * from grant_links
), linked as (
  select distinct on (step_id)
    step_id, execution_run_id, tenant_id, task_id, deployment_plan_target_id, step_type, task_type
  from execution_links
  order by step_id, source_priority, source_updated_at desc, task_id desc
), numbered as (
  select
    latest.step_id,
    coalesce(firsts.tenant_id, latest.tenant_id, linked.tenant_id) as tenant_id,
    case
      when exists (
        select 1 from gcac_restored_execution_runs restored_run
        where restored_run.id = linked.execution_run_id
      ) then linked.execution_run_id
      else 'restored:unresolved:run'
    end as execution_run_id,
    linked.deployment_plan_target_id,
    row_number() over (
      partition by case
        when exists (
          select 1 from gcac_restored_execution_runs restored_run
          where restored_run.id = linked.execution_run_id
        ) then linked.execution_run_id
        else 'restored:unresolved:run'
      end
      order by firsts.created_at, latest.step_id
    )::integer as step_no,
    case
      when upper(coalesce(linked.step_type, '')) in ('DISCOVER', 'BACKUP', 'INSTALL', 'RELOAD', 'VERIFY', 'ROLLBACK', 'CUSTOM') then upper(linked.step_type)
      when coalesce(linked.task_type, '') ilike '%rollback%' then 'ROLLBACK'
      else 'CUSTOM'
    end as step_type,
    coalesce(linked.task_type, 'restored.history.step') || ' ' || latest.step_id as name,
    (coalesce(firsts.running_count, 0) + 1)::integer as attempt_count,
    case when latest.status in ('FAILED', 'TIMEOUT') then 'unsafe' end as last_failure_category,
    case when latest.status in ('FAILED', 'TIMEOUT') then 'RESTORED_HISTORY_FAILED' end as last_error_code,
    case when latest.status in ('FAILED', 'TIMEOUT') then '执行步骤历史已恢复；原始错误载荷未保留' end as last_error_message,
    jsonb_build_object('restoredFromHistory', true, 'sourceStepId', latest.step_id, 'sourceTaskId', linked.task_id) as input_snapshot,
    latest.status, firsts.started_at, firsts.finished_at, firsts.created_at, latest.occurred_at as updated_at,
    coalesce(nullif(latest.actor_id, ''), 'restored:system') as actor_id
  from latest
  join firsts using (step_id)
  left join linked using (step_id)
)
insert into gcac_restored_execution_steps (
  id, tenant_id, execution_run_id, deployment_plan_target_id, step_no, step_type, name, depends_on, idempotent,
  attempt_count, max_attempts, last_failure_category, last_error_code, last_error_message, last_error_details,
  input_snapshot, status, started_at, finished_at, created_at, updated_at, created_by, updated_by, version
)
select
  step_id, tenant_id, execution_run_id, deployment_plan_target_id, step_no, step_type, name, '[]'::jsonb,
  step_type <> 'RELOAD', greatest(attempt_count, 1), greatest(attempt_count, 1), last_failure_category,
  last_error_code, last_error_message,
  case when last_error_code is null then null else jsonb_build_object('restoredFromHistory', true, 'sensitivePayloadRestored', false) end,
  input_snapshot,
  case when status in ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED', 'TIMEOUT') then status else 'FAILED' end,
  started_at, finished_at, created_at, updated_at, actor_id, null, 1
from numbered;

insert into pg_documents (namespace, document_id, payload, updated_at)
select
  'executions:steps', id,
  jsonb_strip_nulls(jsonb_build_object(
    'id', id, 'tenantId', tenant_id, 'executionRunId', execution_run_id, 'deploymentPlanTargetId', deployment_plan_target_id,
    'stepNo', step_no, 'stepType', step_type, 'name', name, 'dependsOn', depends_on, 'idempotent', idempotent,
    'attemptCount', attempt_count, 'maxAttempts', max_attempts, 'lastFailureCategory', last_failure_category,
    'lastErrorCode', last_error_code, 'lastErrorMessage', last_error_message, 'lastErrorDetails', last_error_details,
    'inputSnapshot', input_snapshot, 'status', status, 'startedAt', started_at, 'finishedAt', finished_at,
    'createdAt', created_at, 'updatedAt', updated_at, 'createdBy', created_by, 'updatedBy', updated_by, 'version', version
  )), now()
from gcac_restored_execution_steps
on conflict (namespace, document_id) do update
set payload = excluded.payload, updated_at = excluded.updated_at;
