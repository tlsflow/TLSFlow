-- 迁移目的：把内置插件及其 Workflow 资源从“默认租户”语义迁移为 SYSTEM 所有权。
-- 向后兼容：保留 tenant_id 作为历史兼容字段，不再用它做内置资源授权判断。

alter table unified_plugin_versions
  add column if not exists owner_type varchar(16) not null default 'TENANT',
  add column if not exists owner_id varchar(128);

update unified_plugin_versions
   set owner_type = case when source = 'BUILTIN' then 'SYSTEM' else 'TENANT' end,
       owner_id = case when source = 'BUILTIN' then null else tenant_id end
 where owner_type is null
    or (source = 'BUILTIN' and owner_type <> 'SYSTEM')
    or (source = 'USER' and owner_type <> 'TENANT');

alter table unified_plugin_versions
  add constraint ck_unified_plugin_versions_owner_type
  check (owner_type in ('SYSTEM', 'TENANT'));

create index if not exists idx_unified_plugin_versions_owner_catalog
  on unified_plugin_versions (owner_type, source, status, plugin_id);

alter table unified_plugin_workflow_bindings
  add column if not exists owner_type varchar(16) not null default 'SYSTEM',
  add column if not exists owner_id varchar(128);

update unified_plugin_workflow_bindings binding
   set owner_type = plugin.owner_type,
       owner_id = plugin.owner_id
  from unified_plugin_versions plugin
 where plugin.id = binding.plugin_version_id
   and (binding.owner_type <> plugin.owner_type or binding.owner_id is distinct from plugin.owner_id);

alter table unified_plugin_workflow_bindings
  add constraint ck_unified_plugin_workflow_bindings_owner_type
  check (owner_type in ('SYSTEM', 'TENANT'));

create index if not exists idx_unified_plugin_workflow_binding_owner
  on unified_plugin_workflow_bindings (owner_type, owner_id, workflow_version_id);
