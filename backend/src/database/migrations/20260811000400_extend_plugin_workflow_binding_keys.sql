-- 004.5 P2：将具体 Workflow key 与暴露的 Capability key 分离。
-- 旧迁移不可修改；无法唯一恢复 Workflow 身份的执行绑定直接审计并删除。

alter table unified_plugin_workflow_bindings
  add column if not exists workflow_key varchar(192);

update unified_plugin_workflow_bindings
set workflow_key = capability_key
where workflow_key is null;

alter table unified_plugin_workflow_bindings
  drop constraint if exists unified_plugin_workflow_bindings_pkey,
  drop constraint if exists pk_unified_plugin_workflow_bindings_identity;

alter table unified_plugin_workflow_bindings
  alter column workflow_key set not null,
  add constraint pk_unified_plugin_workflow_bindings_identity
    primary key (plugin_version_id, capability_key, workflow_key),
  add constraint ck_unified_plugin_workflow_bindings_workflow_key
    check (length(trim(workflow_key)) > 0);

create index if not exists idx_unified_plugin_workflow_resource_key
  on unified_plugin_workflow_bindings (plugin_version_id, workflow_resource_path, workflow_key);

alter table workflow_execution_bindings
  add column if not exists workflow_key varchar(192);

create temporary table gcac_workflow_execution_binding_keys (
  id text primary key,
  workflow_key varchar(192) not null
) on commit drop;

insert into gcac_workflow_execution_binding_keys (id, workflow_key)
select execution.id,
       min(workflow_binding.workflow_key) as workflow_key
from workflow_execution_bindings execution
join unified_plugin_workflow_bindings workflow_binding
  on workflow_binding.plugin_version_id = execution.plugin_version_id
 and workflow_binding.capability_key = execution.capability_key
 and workflow_binding.workflow_template_id = execution.workflow_template_id
 and workflow_binding.workflow_version_id = execution.workflow_version_id
group by execution.id
having count(*) = 1;

create temporary table gcac_unresolved_workflow_execution_bindings (
  id text primary key,
  reason varchar(128) not null
) on commit drop;

insert into gcac_unresolved_workflow_execution_bindings (id, reason)
select execution.id,
       'REMOVED_UNRESOLVED_WORKFLOW_KEY'
from workflow_execution_bindings execution
left join gcac_workflow_execution_binding_keys resolved
  on resolved.id = execution.id
where resolved.id is null;

insert into database_forward_cleanup_audits (
  audit_id, migration_version, source_table, source_namespace, source_id,
  cleanup_action, reason, metadata
)
select
  'P2-F-DB-20260811-WFK-' || md5('workflow-execution-binding:' || execution.id),
  '20260811000400',
  'workflow_execution_bindings',
  '',
  execution.id,
  'DELETE',
  unresolved.reason,
  jsonb_build_object(
    'pluginVersionId', execution.plugin_version_id,
    'capabilityKey', execution.capability_key,
    'workflowTemplateId', execution.workflow_template_id,
    'workflowVersionId', execution.workflow_version_id,
    'workflowVersionSelection', execution.workflow_version_selection
  )
from gcac_unresolved_workflow_execution_bindings unresolved
join workflow_execution_bindings execution on execution.id = unresolved.id
on conflict do nothing;

delete from workflow_execution_bindings execution
using gcac_unresolved_workflow_execution_bindings unresolved
where unresolved.id = execution.id;

update workflow_execution_bindings execution
set workflow_key = resolved.workflow_key
from gcac_workflow_execution_binding_keys resolved
where resolved.id = execution.id;

alter table workflow_execution_bindings
  alter column workflow_key set not null,
  add constraint ck_workflow_execution_bindings_workflow_key
    check (length(trim(workflow_key)) > 0),
  add constraint fk_workflow_execution_bindings_plugin_workflow
    foreign key (plugin_version_id, capability_key, workflow_key)
    references unified_plugin_workflow_bindings (plugin_version_id, capability_key, workflow_key)
    on delete restrict;

create index if not exists idx_workflow_execution_bindings_plugin_capability_workflow
  on workflow_execution_bindings (tenant_id, plugin_version_id, capability_key, workflow_key);
