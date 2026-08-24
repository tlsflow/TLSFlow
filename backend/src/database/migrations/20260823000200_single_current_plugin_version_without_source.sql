-- 将按来源分别生效的历史数据收敛为每个租户和插件只有一个当前版本。
with ranked as (
  select id,
         row_number() over (
           partition by tenant_id, plugin_id
           order by updated_at desc, created_at desc, id desc
         ) as rank
    from unified_plugin_versions
   where status = 'ENABLED'
)
update unified_plugin_versions version
   set status = 'RETIRED',
       updated_at = now()
  from ranked
 where version.id = ranked.id
   and ranked.rank > 1;

drop index if exists uq_unified_plugin_versions_current;

create unique index if not exists uq_unified_plugin_versions_current
  on unified_plugin_versions (tenant_id, plugin_id)
 where status = 'ENABLED';
