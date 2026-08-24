-- 仪表盘专用读模型只读取计数、状态窗口和最近审计候选；这些索引避免每次首屏扫描全租户历史数据。
create index if not exists idx_pg_service_assets_dashboard_status
  on pg_service_assets (tenant_id, status, updated_at desc)
  where deleted_at is null and asset_kind <> 'DEVICE';

create index if not exists idx_pg_certificate_versions_dashboard_active_expiry
  on pg_certificate_versions (tenant_id, not_after, certificate_asset_id)
  where status = 'active';

create index if not exists idx_pg_certificate_bindings_dashboard_managed
  on pg_certificate_bindings (tenant_id, status, updated_at desc)
  where deleted_at is null;

create index if not exists idx_pg_documents_dashboard_agents
  on pg_documents (namespace, (payload->>'tenantId'), (payload->>'status'), updated_at desc)
  where namespace = 'agents:registrations';

create index if not exists idx_pg_documents_dashboard_audits
  on pg_documents (namespace, (payload->>'tenantId'), updated_at desc)
  where namespace = 'security.audit_logs';
