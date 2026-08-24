-- 历史表单曾把序号“1”持久化为 management.host。该值既不是可路由的 IP，
-- 也不是有效 DNS 名称；对已绑定 Host 的受管插件，唯一可靠的修复来源是
-- Host.primary_ip。只修复存在明确 Host 主地址的纯数字连接，不猜测其它记录。
with invalid_management_hosts as (
  select binding.id, host.primary_ip
    from unified_plugin_bindings binding
    join pg_hosts host
      on host.tenant_id = binding.tenant_id
     and host.id = binding.managed_context->>'hostId'
     and host.deleted_at is null
   where binding.mode = 'MANAGED'
     and binding.status = 'ACTIVE'
     and nullif(trim(host.primary_ip), '') is not null
     and host.primary_ip !~ '^[0-9]+$'
     and coalesce(binding.input_bindings #>> '{connections,management,host}', '') ~ '^[0-9]+$'
)
update unified_plugin_bindings binding
   set input_bindings = jsonb_set(
         binding.input_bindings,
         '{connections,management,host}',
         to_jsonb(invalid_management_hosts.primary_ip),
         false
       ),
       version = binding.version + 1,
       updated_at = now()
  from invalid_management_hosts
 where binding.id = invalid_management_hosts.id;
