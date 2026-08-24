-- 设备详情按单个 Agent/设备读取 JSONB 事实，不得因为历史日志增长退化为 namespace 全量扫描。
create index if not exists idx_pg_documents_agent_snapshots_detail
  on pg_documents (namespace, (payload->>'tenantId'), (payload->>'agentId'), (payload->>'reportedAt') desc)
  where namespace = 'agents:snapshots';

create index if not exists idx_pg_documents_agent_heartbeats_detail
  on pg_documents (namespace, (payload->>'tenantId'), (payload->>'agentId'), (payload->>'receivedAt') desc)
  where namespace = 'agents:heartbeats';

create index if not exists idx_pg_documents_agent_tasks_detail
  on pg_documents (namespace, (payload->>'tenantId'), (payload->>'agentId'), (payload->>'createdAt'))
  where namespace = 'agents:tasks';

create index if not exists idx_pg_documents_agent_task_logs_detail
  on pg_documents (namespace, (payload->>'tenantId'), (payload->>'agentId'), (payload->>'emittedAt') desc, (payload->>'sequence'))
  where namespace = 'agents:taskLogs';

create index if not exists idx_pg_documents_agent_runtime_logs_detail
  on pg_documents (namespace, (payload->>'tenantId'), (payload->>'agentId'), (payload->>'emittedAt') desc)
  where namespace = 'agents:runtimeLogs';

create index if not exists idx_pg_documents_device_detail_audits
  on pg_documents (namespace, (payload->>'tenantId'), (payload->>'resourceId'), (payload->>'createdAt') desc)
  where namespace = 'security.audit_logs';

-- 兼容 tenantId 缺失的历史审计记录；详情仍会按目标 Host/设备资产 resourceId 限定。
create index if not exists idx_pg_documents_device_detail_legacy_audits
  on pg_documents (namespace, (payload->>'resourceId'), (payload->>'createdAt') desc)
  where namespace = 'security.audit_logs' and payload->>'tenantId' is null;
