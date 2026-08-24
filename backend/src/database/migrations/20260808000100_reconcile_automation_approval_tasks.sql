-- 将已经创建但未登记统一任务的自动化审批运行补齐到任务控制面。
-- 该迁移只处理仍处于 waiting_approval 且审批记录仍为 pending 的运行，重复执行不会产生重复任务。
with pending_runs as (
  select
    ar.id,
    ar.tenant_id,
    ar.created_by,
    ar.created_at,
    ar.approval_id,
    ar.automation_id,
    ar.automation_name_snapshot,
    ar.target_summary,
    ar.trigger_type,
    ar.execution_options
  from automation_runs ar
  join pg_documents approval
    on approval.namespace = 'security.approval_requests'
   and approval.document_id = ar.approval_id
   and approval.payload->>'status' = 'pending'
  where ar.status = 'waiting_approval'
    and ar.approval_id is not null
    and not exists (
      select 1
      from task_resource_refs refs
      where refs.resource_type = 'automationRun'
        and refs.resource_id = ar.id
    )
), inserted_tasks as (
  insert into task_runs (
    id, tenant_id, task_type, definition_version, category, status, requested_by,
    trigger_source, resource_summary, idempotency_key, payload, available_at, created_at
  )
  select
    'task_' || md5('automation-run:' || id),
    tenant_id,
    'AUTOMATION_RUN',
    1,
    'EXECUTION',
    'QUEUED',
    created_by,
    'automation.reconcile',
    jsonb_build_object(
      'displayName', automation_name_snapshot,
      'automationId', automation_id,
      'automationRunId', id,
      'approvalId', approval_id,
      'summary', '等待审批',
      'percent', 15,
      'totalTargets', coalesce((target_summary->>'total')::int, 0),
      'status', 'waiting_approval',
      'approvalPending', true,
      'approvalStatus', 'pending'
    ),
    'automation-run:' || id,
    jsonb_build_object(
      'runId', id,
      'automationId', automation_id,
      'automationName', automation_name_snapshot,
      'triggerType', trigger_type,
      'executionOptions', execution_options
    ),
    coalesce(created_at, now()),
    coalesce(created_at, now())
  from pending_runs
  on conflict do nothing
  returning id
)
insert into task_resource_refs (task_run_id, resource_type, resource_id, display_key)
select 'task_' || md5('automation-run:' || id), 'automationRun', id, automation_name_snapshot
from pending_runs
where 'task_' || md5('automation-run:' || id) in (select id from inserted_tasks)
on conflict do nothing;

insert into task_events (id, task_run_id, event_type, event_data, actor_type, actor_id, created_at)
select
  'tevent_' || md5('automation-run-created:' || ar.id),
  'task_' || md5('automation-run:' || ar.id),
  'CREATED',
  jsonb_build_object('taskType', 'AUTOMATION_RUN', 'category', 'EXECUTION', 'triggerSource', 'automation.reconcile'),
  case when ar.created_by is null then 'system' else 'user' end,
  ar.created_by,
  coalesce(ar.created_at, now())
from automation_runs ar
where ar.status = 'waiting_approval'
  and ar.approval_id is not null
  and exists (
    select 1 from task_resource_refs refs
    where refs.task_run_id = 'task_' || md5('automation-run:' || ar.id)
      and refs.resource_type = 'automationRun'
      and refs.resource_id = ar.id
  )
  and not exists (
    select 1 from task_events events
    where events.task_run_id = 'task_' || md5('automation-run:' || ar.id)
      and events.event_type = 'CREATED'
  )
on conflict do nothing;
