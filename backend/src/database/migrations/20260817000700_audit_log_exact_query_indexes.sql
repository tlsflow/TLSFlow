-- 审计日志按租户、操作者和事件类型精确过滤，禁止先拉取完整历史后在 Node.js 过滤。
create index if not exists idx_pg_documents_audit_logs_tenant_actor_event
  on pg_documents (namespace, (payload->>'tenantId'), (payload->>'actorId'), (payload->>'eventType'), updated_at)
  where namespace = 'security.audit_logs';

create index if not exists idx_pg_documents_audit_logs_resource_type
  on pg_documents (namespace, (payload->>'resourceType'), (payload->>'resourceId'))
  where namespace = 'security.audit_logs';
