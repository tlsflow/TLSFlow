-- 外部结果等待不是失败重试；写操作结果不明也不能继续被 Worker 自动重放。
alter table if exists task_runs
  drop constraint if exists task_run_status_check;

alter table if exists task_runs
  add constraint task_run_status_check
  check (status in (
    'QUEUED',
    'RUNNING',
    'RETRY_WAITING',
    'WAITING_RESULT',
    'AWAITING_CONFIRMATION',
    'CANCELLING',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED'
  ));

alter table if exists task_attempts
  drop constraint if exists task_attempt_status_check;

alter table if exists task_attempts
  add constraint task_attempt_status_check
  check (status in ('RUNNING', 'WAITING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED'));

-- 兼容已经被错误写为 RETRY_WAITING 的执行任务。未知写入结果停止调度，
-- 其余异步任务继续按下一次时间读取控制面已落账的状态。
with classified as (
  select task.id,
    exists (
      select 1
        from pg_documents step
       where step.namespace = 'executions:steps'
         and step.payload->>'executionRunId' = coalesce(
           task.payload->>'runId',
           task.resource_summary->>'runId',
           task.progress->>'runId'
         )
         and step.payload->>'status' = 'RUNNING'
         and (
           step.payload->'inputSnapshot'->'resultDetail'->>'executionStatus' = 'UNKNOWN'
           or step.payload->'inputSnapshot'->'resultDetail'->>'mayBeUnknown' = 'true'
           or step.payload->>'lastErrorCode' = 'PLUGIN_OPERATION_UNKNOWN_STATE'
         )
    ) as result_unconfirmed
  from task_runs task
 where task.status = 'RETRY_WAITING'
   and task.last_error_code = 'EXECUTION_PENDING'
)
update task_runs task
   set status = case when classified.result_unconfirmed then 'AWAITING_CONFIRMATION' else 'WAITING_RESULT' end,
       next_attempt_at = case when classified.result_unconfirmed then null else coalesce(task.next_attempt_at, now()) end,
       lease_owner = null,
       lease_expires_at = null,
       last_error_code = case when classified.result_unconfirmed then 'EXECUTION_RESULT_UNCONFIRMED' else 'EXECUTION_PENDING' end,
       last_error_message = case
         when classified.result_unconfirmed then case
           when task.last_error_message is null or task.last_error_message = '执行运行仍在等待 Agent 或异步步骤完成'
             then '写入结果无法确认，系统已停止自动重放；请在执行详情中核验目标证书状态'
           else task.last_error_message
         end
         else case
           when task.last_error_message is null or task.last_error_message = '执行运行仍在等待 Agent 或异步步骤完成'
             then '执行运行仍在等待外部执行结果，控制面将继续查询运行状态'
           else task.last_error_message
         end
       end,
       progress = coalesce(task.progress, '{}'::jsonb) || jsonb_build_object(
         'pending', true,
         'waitingStatus', case when classified.result_unconfirmed then 'AWAITING_CONFIRMATION' else 'WAITING_RESULT' end
       )
  from classified
 where task.id = classified.id;

update task_attempts attempt
   set status = 'WAITING'
  from task_runs task
 where attempt.task_run_id = task.id
   and attempt.status = 'FAILED'
   and attempt.error_code = 'EXECUTION_PENDING'
   and task.status in ('WAITING_RESULT', 'AWAITING_CONFIRMATION');

update task_events event
   set event_type = case when task.status = 'AWAITING_CONFIRMATION' then 'AWAITING_CONFIRMATION' else 'WAITING_RESULT' end,
       event_data = event.event_data || jsonb_build_object('waitingStatus', task.status)
  from task_runs task
 where event.task_run_id = task.id
   and event.event_type = 'RETRY_SCHEDULED'
   and task.status in ('WAITING_RESULT', 'AWAITING_CONFIRMATION')
   and exists (
     select 1
       from task_attempts attempt
      where attempt.id = event.attempt_id
        and attempt.error_code = 'EXECUTION_PENDING'
   );
