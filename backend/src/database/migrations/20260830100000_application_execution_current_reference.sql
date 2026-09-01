-- 应用资产执行配置使用稳定身份；版本号只属于已物化的计划和运行快照。

alter table unified_plugin_bindings
  add column if not exists plugin_id text;

alter table plugin_capability_assignments
  add column if not exists plugin_id text;

alter table workflow_execution_bindings
  add column if not exists plugin_id text;

update unified_plugin_bindings binding
   set plugin_id = plugin.plugin_id
  from unified_plugin_versions plugin
 where plugin.id = binding.plugin_version_id
   and binding.plugin_id is null;

update plugin_capability_assignments assignment
   set plugin_id = plugin.plugin_id
  from unified_plugin_versions plugin
 where plugin.id = assignment.plugin_version_id
   and assignment.plugin_id is null;

update workflow_execution_bindings binding
   set plugin_id = plugin.plugin_id
  from unified_plugin_versions plugin
 where plugin.id = binding.plugin_version_id
   and binding.plugin_id is null;

-- 旧工作流绑定没有独立的执行快照，不能继续锁定已退休的版本。
alter table workflow_execution_bindings
  alter column plugin_version_id drop not null,
  alter column workflow_version_id drop not null,
  alter column workflow_version_selection set default 'CURRENT';

alter table workflow_execution_bindings
  drop constraint if exists ck_workflow_execution_bindings_fixed_identity,
  drop constraint if exists ck_workflow_execution_bindings_version_selection_fixed;

-- 先清理历史固定版本引用，再添加 CURRENT 约束，避免旧数据在加约束时阻断迁移。
update workflow_execution_bindings
   set plugin_version_id = null,
       workflow_version_id = null,
       workflow_version_selection = 'CURRENT'
 where plugin_id is not null;

alter table workflow_execution_bindings
  add constraint ck_workflow_execution_bindings_current_identity
    check (length(trim(plugin_id)) > 0
      and length(trim(capability_key)) > 0
      and length(trim(workflow_key)) > 0
      and length(trim(workflow_template_id)) > 0),
  add constraint ck_workflow_execution_bindings_version_selection_current
    check (workflow_version_selection = 'CURRENT');

create index if not exists idx_unified_plugin_bindings_current_plugin
  on unified_plugin_bindings (tenant_id, plugin_id, status);

create index if not exists idx_plugin_capability_assignments_current_plugin
  on plugin_capability_assignments (tenant_id, plugin_id, capability_key, status);

create index if not exists idx_workflow_execution_bindings_current_plugin
  on workflow_execution_bindings (tenant_id, plugin_id, capability_key, workflow_key, status);

create table if not exists application_execution_compatibility (
  tenant_id text not null,
  application_asset_id text not null,
  source_type text not null,
  source_id text not null,
  status text not null,
  issues jsonb not null default '[]'::jsonb,
  checked_plugin_version_id text,
  checked_workflow_version_id text,
  checked_at timestamptz not null default now(),
  version integer not null default 1,
  primary key (tenant_id, application_asset_id, source_type, source_id),
  constraint ck_application_execution_compatibility_status
    check (status in ('READY', 'UPDATE_REQUIRED', 'UNSUPPORTED')),
  constraint ck_application_execution_compatibility_issues_array
    check (jsonb_typeof(issues) = 'array')
);

create index if not exists idx_application_execution_compatibility_status
  on application_execution_compatibility (tenant_id, status, checked_at desc);
