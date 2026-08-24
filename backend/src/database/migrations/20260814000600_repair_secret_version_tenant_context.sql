-- 002.3：修复历史 Secret 与 SecretVersion 的半迁移租户上下文。
-- 20260814000400 已将 security.secrets 回填为真实租户 UUID，但历史版本文档未同步。
-- 本迁移只从同一 Secret 的已验证父租户回填缺失或历史逻辑租户，不放宽运行时租户一致性校验。
-- 迁移执行器已经为每个文件包裹事务，本文件不自行 BEGIN/COMMIT。

do $$
declare
  unresolved_count integer;
  mismatched_count integer;
begin
  select count(*)::integer
    into unresolved_count
    from pg_documents version
    left join pg_documents secret
      on secret.namespace = 'security.secrets'
     and secret.document_id = version.payload->>'secretId'
   where version.namespace = 'security.secret_versions'
     and coalesce(version.payload->>'tenantId', '') in (
       '', 'default', 'tenant_default', '00000000-0000-0000-0000-000000000000'
     )
     and (
       secret.document_id is null
       or coalesce(secret.payload->>'tenantId', '') = ''
       or not exists (
         select 1
           from tenants tenant
          where tenant.id::text = secret.payload->>'tenantId'
            and tenant.deleted_at is null
       )
     );

  if unresolved_count <> 0 then
    raise exception '存在无法从父 Secret 证明归属的 SecretVersion，拒绝自动回填：%', unresolved_count;
  end if;

  select count(*)::integer
    into mismatched_count
    from pg_documents version
    join pg_documents secret
      on secret.namespace = 'security.secrets'
     and secret.document_id = version.payload->>'secretId'
   where version.namespace = 'security.secret_versions'
     and coalesce(version.payload->>'tenantId', '') not in (
       '', 'default', 'tenant_default', '00000000-0000-0000-0000-000000000000'
     )
     and version.payload->>'tenantId' <> secret.payload->>'tenantId';

  if mismatched_count <> 0 then
    raise exception '存在非空但与父 Secret 不一致的 SecretVersion 租户，拒绝自动覆盖：%', mismatched_count;
  end if;

  insert into database_forward_cleanup_audits (
    audit_id, migration_version, source_table, source_namespace, source_id,
    cleanup_action, reason, metadata
  )
  select
    'SVTR-' || md5('20260814000600:pg_documents:' || version.namespace || ':' || version.document_id),
    '20260814000600', 'pg_documents', version.namespace, version.document_id,
    'UPDATE', 'SECRET_VERSION_TENANT_FROM_PARENT_SECRET',
    jsonb_build_object(
      'secretId', secret.document_id,
      'previousTenantId', nullif(version.payload->>'tenantId', ''),
      'targetTenantId', secret.payload->>'tenantId',
      'payloadBodyPreserved', true
    )
  from pg_documents version
  join pg_documents secret
    on secret.namespace = 'security.secrets'
   and secret.document_id = version.payload->>'secretId'
  join tenants tenant
    on tenant.id::text = secret.payload->>'tenantId'
   and tenant.deleted_at is null
  where version.namespace = 'security.secret_versions'
    and coalesce(version.payload->>'tenantId', '') in (
      '', 'default', 'tenant_default', '00000000-0000-0000-0000-000000000000'
    )
  on conflict do nothing;

  update pg_documents version
     set payload = jsonb_set(
       version.payload,
       '{tenantId}',
       to_jsonb(secret.payload->>'tenantId'),
       true
     ),
         updated_at = now()
    from pg_documents secret
    join tenants tenant
      on tenant.id::text = secret.payload->>'tenantId'
     and tenant.deleted_at is null
   where version.namespace = 'security.secret_versions'
     and secret.namespace = 'security.secrets'
     and secret.document_id = version.payload->>'secretId'
     and coalesce(version.payload->>'tenantId', '') in (
       '', 'default', 'tenant_default', '00000000-0000-0000-0000-000000000000'
     );
end
$$;
