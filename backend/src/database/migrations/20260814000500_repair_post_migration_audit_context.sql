-- 002.3：清理 20260814000400 执行后由旧后台写入路径产生的缺失审计租户上下文。
-- 只有唯一活动业务租户时才允许自动归属；进入集团架构后必须由运行时请求提供明确上下文。
-- 迁移执行器已经为每个文件包裹事务，本文件不自行 BEGIN/COMMIT。

do $$
declare
  default_tenant_id text;
  active_tenant_count integer;
begin
  select count(*)::integer
    into active_tenant_count
    from tenants
   where status = 'ACTIVE'
     and deleted_at is null;

  if active_tenant_count <> 1 then
    raise exception '无法安全回填后台审计：当前活动租户数量不是 1';
  end if;

  select id::text
    into default_tenant_id
    from tenants
   where code = 'default'
     and status = 'ACTIVE'
     and deleted_at is null;

  if default_tenant_id is null then
    raise exception '活动 default 租户不存在，无法修复审计租户上下文';
  end if;

  insert into database_forward_cleanup_audits (
    audit_id, migration_version, source_table, source_namespace, source_id,
    cleanup_action, reason, metadata
  )
  select
    'TCAR-' || md5('20260814000500:pg_documents:' || document.namespace || ':' || document.document_id),
    '20260814000500', 'pg_documents', document.namespace, document.document_id,
    'UPDATE', 'POST_MIGRATION_MISSING_AUDIT_TENANT_CONTEXT',
    jsonb_build_object(
      'previousTenantId', nullif(document.payload->>'tenantId', ''),
      'targetTenantId', default_tenant_id,
      'payloadBodyPreserved', true
    )
  from pg_documents document
  where document.namespace = 'security.audit_logs'
    and coalesce(document.payload->>'tenantId', '') in ('', 'default')
  on conflict do nothing;

  update pg_documents document
     set payload = jsonb_set(
       document.payload,
       '{tenantId}',
       to_jsonb(default_tenant_id),
       true
     ),
     updated_at = now()
   where document.namespace = 'security.audit_logs'
     and coalesce(document.payload->>'tenantId', '') in ('', 'default');
end
$$;
