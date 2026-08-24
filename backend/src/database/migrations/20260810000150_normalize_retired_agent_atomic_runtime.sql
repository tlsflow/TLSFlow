-- 20260810000150：为 Agent Plan 运行时收口清理已退休的旧 Agent Atomic 记录。
-- 20260810000200 会移除 AGENT_ATOMIC；历史清退记录仍需保留，不能直接删除。
-- 只有已退休且没有任何运行期引用的记录允许做存储运行时归一化。

-- 当前数据库仍由历史迁移保留 AGENT_ATOMIC。先临时扩展允许集合，才能把旧行
-- 归一化为 AGENT_PLAN；下一条不可变迁移会在数据清理完成后移除 AGENT_ATOMIC。
alter table unified_plugin_versions
  drop constraint if exists unified_plugin_versions_runtime_check;

alter table unified_plugin_versions
  add constraint unified_plugin_versions_runtime_check
  check (runtime in ('AGENT_ATOMIC', 'AGENT_PLAN', 'WORKFLOW_DSL', 'TRUSTED_JS'));

do $$
begin
  if exists (
    select 1
    from unified_plugin_versions version
    where version.runtime = 'AGENT_ATOMIC'
      and (
        version.status not in ('RETIRED', 'QUARANTINED')
        or exists (
          select 1
          from unified_plugin_bindings binding
          where binding.plugin_version_id = version.id
            and binding.status <> 'DISABLED'
        )
        or exists (
          select 1
          from plugin_capability_assignments assignment
          where assignment.plugin_version_id = version.id
            and assignment.status <> 'DISABLED'
        )
        or exists (
          select 1
          from plugin_runner_version_bindings runner_binding
          where runner_binding.plugin_version_id = version.id
        )
        or exists (
          select 1
          from unified_plugin_workflow_bindings workflow_binding
          where workflow_binding.plugin_version_id = version.id
        )
        or exists (
          select 1
          from pg_device_assets asset
          where asset.plugin_version_id = version.id
        )
        or exists (
          select 1
          from pg_service_assets asset
          where asset.metadata->>'pluginVersionId' = version.id
        )
        or exists (
          select 1
          from pg_hosts host
          cross join lateral jsonb_array_elements(host.management_channels) channel
          where channel->'metadata'->>'pluginVersionId' = version.id
        )
      )
  ) then
    raise exception '存在仍被运行期引用的 AGENT_ATOMIC 插件版本，禁止自动归一化';
  end if;
end
$$;

with updated as (
  update unified_plugin_versions
  set runtime = 'AGENT_PLAN',
      updated_at = now()
  where runtime = 'AGENT_ATOMIC'
    and status in ('RETIRED', 'QUARANTINED')
  returning id
), summary as (
  select count(*)::integer as updated_row_count from updated
)
insert into database_forward_cleanup_audits (
  migration_version, source_table, source_namespace, source_id,
  cleanup_action, reason, metadata
)
select
  '20260810000150', 'unified_plugin_versions', '', 'retired-agent-atomic-runtime',
  'UPDATE', 'NORMALIZE_RETIRED_AGENT_RUNTIME',
  jsonb_build_object('updatedRowCount', summary.updated_row_count)
from summary
on conflict do nothing;
