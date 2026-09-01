-- 监控明细通过父级 service_asset 授权，不再在关系表中逐条投影。
-- 只清理已废弃的高基数明细关系，不触碰业务授权、角色绑定或监控业务表。
delete from public.pg_business_permission_relations
 where related_object_type in (
   'monitor_probe_result',
   'monitor_certificate_observation',
   'monitor_risk',
   'execution_run',
   'execution_step',
   'deployment_plan',
   'workflow'
 );

-- 正式运行时关系仓储使用 pg_documents 命名空间；兼容清理历史 JSON 文档。
delete from public.pg_documents
 where namespace = 'security.business_permission_relations'
   and payload->>'relatedObjectType' in (
     'monitor_probe_result',
     'monitor_certificate_observation',
     'monitor_risk',
     'execution_run',
     'execution_step',
     'deployment_plan',
     'workflow'
   );
