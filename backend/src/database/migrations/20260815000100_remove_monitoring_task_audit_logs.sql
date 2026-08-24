-- 清理历史证书监控任务审计，监控探测事实继续保留在监控专用表中。
-- 任务控制面仍保留 task_runs/task_events，只有高频任务审计从长期审计列表移除。
delete from pg_documents audit
 where audit.namespace = 'security.audit_logs'
   and audit.payload ->> 'resourceType' = 'task'
   and (
     audit.payload #>> '{detail,category}' = 'MONITORING'
     or audit.payload #>> '{detail,taskType}' in ('MONITORING_BATCH', 'MONITORING_PROBE')
     or exists (
       select 1
         from task_runs task
        where task.id = audit.payload ->> 'resourceId'
          and task.category = 'MONITORING'
     )
   );
