-- 迁移目的：将历史业务对象使用的逻辑租户编码 default 归一化为 tenants.id UUID。
-- 背景：服务端租户上下文已经使用默认租户 UUID，历史业务表仍保存 default 时，
--      记录会在仓储 tenant_id 过滤阶段被排除，尚未进入 RBAC/ObjectSet 判断。
-- 边界：
--   1. 只迁移明确属于默认租户的 default，不处理 SYSTEM、*、UUID 零值或其他租户值。
--   2. 不修改备份表和迁移结果表，保留原始迁移证据。
--   3. 不启用 hierarchical 模式，不创建新租户，不改变对象授权语义。

do $$
declare
  default_tenant_id text;
  tenant_table record;
begin
  select id::text
    into default_tenant_id
    from tenants
   where code = 'default'
     and deleted_at is null;

  if default_tenant_id is null then
    raise exception '默认租户不存在，无法归一化历史业务对象归属';
  end if;

  -- 历史 default 和新 UUID 数据合并后，一个租户可能暂时出现多个活动默认信任域。
  -- 保留最早建立的默认信任域，其余信任域仍保留，但不再标记为默认。
  if to_regclass('public.pg_ca_trust_domains') is not null then
    with ranked_defaults as (
      select id,
             row_number() over (
               partition by case
                 when tenant_id = 'default' then default_tenant_id
                 else tenant_id
               end
               order by created_at asc, id asc
             ) as position
        from pg_ca_trust_domains
       where tenant_id in ('default', default_tenant_id)
         and is_default = true
         and status not in ('retired', 'compromised')
    )
    update pg_ca_trust_domains trust_domain
       set is_default = false,
           updated_at = now()
      from ranked_defaults ranked
     where trust_domain.id = ranked.id
       and ranked.position > 1;
  end if;

  -- 部署输入快照是不可变审计记录，不能走普通 UPDATE 路径。
  -- 只在当前事务内临时移除保护触发器，修正租户归属后立即恢复；
  -- snapshot 和 sealed_runtime_payload 等审计正文保持原样。
  if to_regclass('public.deployment_input_snapshots') is not null then
    execute 'drop trigger if exists trg_deployment_input_snapshots_immutable on deployment_input_snapshots';
    execute
      'update deployment_input_snapshots
          set tenant_id = $1
        where tenant_id::text = ''default'''
      using default_tenant_id;
    execute
      'create trigger trg_deployment_input_snapshots_immutable
       before update or delete on deployment_input_snapshots
       for each row execute function gcac_reject_deployment_input_snapshot_mutation()';
  end if;

  -- 业务表历史上同时使用 text/varchar 保存租户逻辑编码。
  -- 动态枚举现有活动表可以覆盖各业务模块，但显式排除备份和迁移证据。
  for tenant_table in
    select table_name
      from information_schema.columns
     where table_schema = 'public'
       and column_name = 'tenant_id'
       and data_type in ('text', 'character varying', 'character')
       and table_name !~ '(^|_)(backup|backups)(_|$)'
       and table_name <> 'legacy_plugin_migration_results'
       and table_name <> 'deployment_input_snapshots'
     order by table_name
  loop
    execute format(
      'update %I set tenant_id = $1 where tenant_id::text = ''default''',
      tenant_table.table_name
    ) using default_tenant_id;
  end loop;

  -- JSON 文档仓储使用 camelCase 顶层字段保存租户归属。
  -- 只改写已经明确写入 tenantId=default 的文档，不猜测缺失租户字段的归属。
  if to_regclass('public.pg_documents') is not null then
    update pg_documents
       set payload = jsonb_set(payload, '{tenantId}', to_jsonb(default_tenant_id), false),
           updated_at = now()
     where payload ->> 'tenantId' = 'default';
  end if;
end
$$;
