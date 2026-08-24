-- 旧 Worker 在未知结果恢复已将 ExecutionRun 收敛为终态后仍会重复调度，
-- 继而把统一任务真实的 TLS 核验错误覆盖为 TASK_EXECUTOR_THROWN。
-- 仅回填能从关联终态 ExecutionRun 可靠取得的错误，不修改其他历史失败任务。
with candidates as (
  select task.id,
         nullif(run.payload->>'errorCode', '') as error_code,
         coalesce(nullif(run.payload->>'errorMessage', ''), '执行运行已失败') as error_message
    from task_runs task
    join pg_documents run
      on run.namespace = 'executions:runs'
     and run.document_id = coalesce(
       task.payload->>'runId',
       task.resource_summary->>'runId',
       task.progress->>'runId'
     )
   where task.task_type = 'CERTIFICATE_DEPLOY'
     and task.status = 'FAILED'
     and task.last_error_code = 'TASK_EXECUTOR_THROWN'
     and run.payload->>'status' in ('FAILED', 'TIMEOUT', 'ROLLBACK_FAILED')
     and nullif(run.payload->>'errorCode', '') is not null
), repaired_tasks as (
  update task_runs task
     set last_error_code = candidates.error_code,
         last_error_message = candidates.error_message,
         progress = coalesce(task.progress, '{}'::jsonb) || jsonb_build_object(
           'terminalErrorSource', 'execution_run'
         )
    from candidates
   where task.id = candidates.id
  returning task.id, candidates.error_code, candidates.error_message
), latest_failed_attempts as (
  select distinct on (attempt.task_run_id)
         attempt.id,
         attempt.task_run_id,
         repaired.error_code,
         repaired.error_message
    from task_attempts attempt
    join repaired_tasks repaired on repaired.id = attempt.task_run_id
   where attempt.status = 'FAILED'
     and attempt.error_code = 'TASK_EXECUTOR_THROWN'
   order by attempt.task_run_id, attempt.attempt_no desc
)
update task_attempts attempt
   set error_code = latest_failed_attempts.error_code,
       error_summary = latest_failed_attempts.error_message
  from latest_failed_attempts
 where attempt.id = latest_failed_attempts.id;

-- task_events 是面向任务详情的状态记录，不是审计账本；同步最终失败事件的错误码，
-- 让用户看到核验失败的真实原因而不是控制面竞态的实现细节。
with candidates as (
  select task.id,
         nullif(run.payload->>'errorCode', '') as error_code,
         coalesce(nullif(run.payload->>'errorMessage', ''), '执行运行已失败') as error_message
    from task_runs task
    join pg_documents run
      on run.namespace = 'executions:runs'
     and run.document_id = coalesce(
       task.payload->>'runId',
       task.resource_summary->>'runId',
       task.progress->>'runId'
     )
   where task.task_type = 'CERTIFICATE_DEPLOY'
     and task.status = 'FAILED'
     and task.progress->>'terminalErrorSource' = 'execution_run'
     and nullif(run.payload->>'errorCode', '') is not null
), latest_failed_events as (
  select distinct on (event.task_run_id)
         event.id,
         candidates.error_code,
         candidates.error_message
    from task_events event
    join candidates on candidates.id = event.task_run_id
   where event.event_type = 'FAILED'
     and event.event_data->>'errorCode' = 'TASK_EXECUTOR_THROWN'
   order by event.task_run_id, event.created_at desc, event.id desc
)
update task_events event
   set event_data = coalesce(event.event_data, '{}'::jsonb) || jsonb_build_object(
     'errorCode', latest_failed_events.error_code,
     'errorMessage', latest_failed_events.error_message,
     'source', 'execution_run.terminal_error_repair'
   )
  from latest_failed_events
 where event.id = latest_failed_events.id;
