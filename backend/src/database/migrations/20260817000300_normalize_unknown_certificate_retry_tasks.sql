-- 将仍处于 RETRY_WAITING、但实际步骤已返回未知写入结果的证书部署任务
-- 收敛到等待结果或人工确认，避免统一任务层再次重放原写操作。
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
         and step.payload->'inputSnapshot'->'certificateVerification'->>'capabilityKey' = 'certificate.verify'
         and step.payload->'inputSnapshot'->'certificateVerification'->>'schemaVersion' = '1.0'
         -- 历史快照可能仅在部署产物中保存目标指纹；与运行时恢复逻辑保持一致，
         -- 只要能取得固定 SHA-256 指纹，就允许进入只读 TLS 主动核验队列。
         and nullif(trim(coalesce(
           step.payload->'inputSnapshot'->'certificateVerification'->>'expectedFingerprintSha256',
           step.payload->'inputSnapshot'->'deploymentArtifact'->>'expectedFingerprintSha256',
           step.payload->'inputSnapshot'->'artifact'->>'expectedFingerprintSha256',
           step.payload->'inputSnapshot'->'executionRuntimeSnapshot'->'deploymentArtifact'->>'expectedFingerprintSha256'
         )), '') is not null
    ) as automatic_recovery
    from task_runs task
   where task.status = 'RETRY_WAITING'
     and task.task_type = 'CERTIFICATE_DEPLOY'
     and task.lease_owner is null
     and exists (
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
     )
)
update task_runs task
   set status = case when classified.automatic_recovery then 'WAITING_RESULT' else 'AWAITING_CONFIRMATION' end,
       next_attempt_at = case when classified.automatic_recovery then now() else null end,
       lease_owner = null,
       lease_expires_at = null,
       last_error_code = 'EXECUTION_RESULT_UNCONFIRMED',
       last_error_message = case
         when classified.automatic_recovery then '写入结果待确认，控制面将主动核验目标证书状态'
         else '写入结果无法确认，系统已停止自动重放；请在执行详情中核验目标证书状态'
       end,
       progress = coalesce(task.progress, '{}'::jsonb) || jsonb_build_object(
         'pending', true,
         'waitingStatus', case when classified.automatic_recovery then 'WAITING_RESULT' else 'AWAITING_CONFIRMATION' end,
         'automaticRecovery', classified.automatic_recovery
       )
  from classified
 where task.id = classified.id;

update task_attempts attempt
   set status = 'WAITING'
  from task_runs task
 where attempt.task_run_id = task.id
   and task.task_type = 'CERTIFICATE_DEPLOY'
   and attempt.status = 'FAILED'
   and task.status in ('WAITING_RESULT', 'AWAITING_CONFIRMATION')
   and attempt.error_code in ('EXECUTION_PENDING', 'PLUGIN_OPERATION_UNKNOWN_STATE', 'TASK_LEASE_EXPIRED');

update task_events event
   set event_type = task.status,
       event_data = event.event_data || jsonb_build_object('waitingStatus', task.status)
  from task_runs task
 where event.task_run_id = task.id
   and task.task_type = 'CERTIFICATE_DEPLOY'
   and event.event_type = 'RETRY_SCHEDULED'
   and task.status in ('WAITING_RESULT', 'AWAITING_CONFIRMATION')
   and exists (
     select 1
      from task_attempts attempt
      where attempt.id = event.attempt_id
        and attempt.status = 'WAITING'
        and attempt.error_code in ('EXECUTION_PENDING', 'PLUGIN_OPERATION_UNKNOWN_STATE', 'TASK_LEASE_EXPIRED')
   );
