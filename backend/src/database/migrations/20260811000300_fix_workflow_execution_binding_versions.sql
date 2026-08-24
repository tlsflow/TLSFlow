-- 004.5 P2：Execution Binding 只保留固定的 Manifest -> PluginVersion -> Capability -> WorkflowVersion 链。
-- 旧迁移不可修改；无法证明固定发布链的开发记录直接审计并删除，不进入运行期兼容路径。

alter table workflow_execution_bindings
  add column if not exists plugin_version_id varchar(128),
  add column if not exists capability_key varchar(192);

create temporary table gcac_invalid_workflow_execution_bindings (
  id text primary key,
  reason varchar(128) not null
) on commit drop;

insert into gcac_invalid_workflow_execution_bindings (id, reason)
select binding.id,
       case
         when binding.workflow_version_selection <> 'FIXED' then 'REMOVED_NON_FIXED_VERSION_SELECTION'
         when binding.plugin_version_id is null or binding.capability_key is null then 'REMOVED_MISSING_PLUGIN_IDENTITY'
         else 'REMOVED_INVALID_PLUGIN_WORKFLOW_CHAIN'
       end
from workflow_execution_bindings binding
where binding.workflow_version_selection <> 'FIXED'
   or binding.plugin_version_id is null
   or binding.capability_key is null
   or not exists (
      select 1
        from unified_plugin_workflow_bindings workflow_binding
        join unified_plugin_versions plugin
          on plugin.id = workflow_binding.plugin_version_id
        join pg_documents template
          on template.namespace = 'workflow.templates'
         and template.document_id = workflow_binding.workflow_template_id
        join pg_documents version
          on version.namespace = 'workflow.template_versions'
         and version.document_id = workflow_binding.workflow_version_id
       where workflow_binding.plugin_version_id = binding.plugin_version_id
         and workflow_binding.capability_key = binding.capability_key
         and workflow_binding.workflow_template_id = binding.workflow_template_id
         and workflow_binding.workflow_version_id = binding.workflow_version_id
         and (plugin.tenant_id = binding.tenant_id or plugin.source = 'BUILTIN')
         and plugin.status = 'ENABLED'
         and plugin.runtime = 'WORKFLOW_DSL'
         and exists (
           select 1
             from jsonb_array_elements(coalesce(plugin.manifest->'capabilities', '[]'::jsonb)) declared
            where declared->>'key' = binding.capability_key
         )
         and template.payload->>'origin' = 'plugin_internal'
         and version.payload->>'templateId' = workflow_binding.workflow_template_id
         and version.payload->>'status' = 'published'
         and version.payload->>'contentHash' = workflow_binding.workflow_content_sha256
   );

insert into database_forward_cleanup_audits (
  audit_id, migration_version, source_table, source_namespace, source_id,
  cleanup_action, reason, metadata
)
select
  'P2-F-DB-20260811-WEB-' || md5('workflow-execution-binding:' || binding.id),
  '20260811000300',
  'workflow_execution_bindings',
  '',
  binding.id,
  'DELETE',
  invalid.reason,
  jsonb_build_object(
    'workflowVersionSelection', binding.workflow_version_selection,
    'pluginVersionId', binding.plugin_version_id,
    'capabilityKey', binding.capability_key,
    'workflowTemplateId', binding.workflow_template_id,
    'workflowVersionId', binding.workflow_version_id
  )
from gcac_invalid_workflow_execution_bindings invalid
join workflow_execution_bindings binding on binding.id = invalid.id
on conflict do nothing;

delete from workflow_execution_bindings binding
using gcac_invalid_workflow_execution_bindings invalid
where invalid.id = binding.id;

alter table workflow_execution_bindings
  drop constraint if exists ck_workflow_execution_bindings_version_selection,
  drop constraint if exists ck_workflow_execution_bindings_version;

alter table workflow_execution_bindings
  alter column plugin_version_id set not null,
  alter column capability_key set not null,
  alter column workflow_version_id set not null,
  add constraint fk_workflow_execution_bindings_plugin_version
    foreign key (plugin_version_id) references unified_plugin_versions(id) on delete restrict,
  add constraint ck_workflow_execution_bindings_version_selection_fixed
    check (workflow_version_selection = 'FIXED'),
  add constraint ck_workflow_execution_bindings_fixed_identity
    check (length(trim(plugin_version_id)) > 0 and length(trim(capability_key)) > 0 and length(trim(workflow_template_id)) > 0 and length(trim(workflow_version_id)) > 0);

create index if not exists idx_workflow_execution_bindings_plugin_capability
  on workflow_execution_bindings (tenant_id, plugin_version_id, capability_key);

create index if not exists idx_workflow_execution_bindings_fixed_workflow_version
  on workflow_execution_bindings (tenant_id, workflow_template_id, workflow_version_id);
