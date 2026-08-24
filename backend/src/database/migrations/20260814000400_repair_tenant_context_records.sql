-- 002.3：修复当前数据库中的租户归属和安全文档上下文。
-- 迁移执行器已经为每个文件包裹事务，本文件不自行 BEGIN/COMMIT。
-- 只在当前仍只有一个活动业务租户时，把无法产生歧义的历史记录归一化到 default UUID。
-- 原始安全文档正文不重写，只补充顶层 tenantId，并为每条变更保留脱敏审计。

do $$
declare
  default_tenant_id text;
  active_business_tenant_count integer;
begin
  select id::text
    into default_tenant_id
    from tenants
   where code = 'default'
     and status = 'ACTIVE'
     and deleted_at is null;

  if default_tenant_id is null then
    raise exception '活动 default 租户不存在，无法修复租户上下文';
  end if;

  select count(*)::integer
    into active_business_tenant_count
    from tenants
   where status = 'ACTIVE'
     and deleted_at is null
     and code <> 'default';

  if active_business_tenant_count <> 0 then
    raise exception '存在其他活动业务租户，不能无歧义地回填历史租户上下文';
  end if;

  insert into database_forward_cleanup_audits (
    audit_id, migration_version, source_table, source_namespace, source_id,
    cleanup_action, reason, metadata
  )
  select
    'TCAR-' || md5('20260814000400:credential_profiles:' || profile.id),
    '20260814000400', 'credential_profiles', '', profile.id,
    'UPDATE', 'ZERO_UUID_TENANT_TO_DEFAULT',
    jsonb_build_object(
      'previousTenantId', profile.tenant_id,
      'targetTenantId', default_tenant_id,
      'secretPayloadPreserved', true
    )
  from credential_profiles profile
  where profile.tenant_id::text = '00000000-0000-0000-0000-000000000000'
  on conflict do nothing;

  update credential_profiles
     set tenant_id = default_tenant_id,
         updated_at = now()
   where tenant_id::text = '00000000-0000-0000-0000-000000000000';

  insert into database_forward_cleanup_audits (
    audit_id, migration_version, source_table, source_namespace, source_id,
    cleanup_action, reason, metadata
  )
  select
    'TCAR-' || md5('20260814000400:pg_documents:' || document.namespace || ':' || document.document_id),
    '20260814000400', 'pg_documents', document.namespace, document.document_id,
    'UPDATE', 'MISSING_SECURITY_TENANT_CONTEXT',
    jsonb_build_object(
      'previousTenantId', nullif(document.payload->>'tenantId', ''),
      'targetTenantId', default_tenant_id,
      'payloadBodyPreserved', true
    )
  from pg_documents document
  where document.namespace in (
    'security.audit_logs',
    'security.approval_requests',
    'security.execution_grants',
    'security.secrets'
  )
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
   where document.namespace in (
     'security.audit_logs',
     'security.approval_requests',
     'security.execution_grants',
     'security.secrets'
   )
     and coalesce(document.payload->>'tenantId', '') in ('', 'default');
end
$$;
