-- P2：清理指向已删除或不再可执行 WorkflowVersion 的插件绑定。
-- 这些历史引用不能在运行期兼容转换，必须先删除运行引用，再删除绑定并留下审计记录。

create temporary table gcac_invalid_plugin_workflow_bindings (
  plugin_version_id varchar(128) not null,
  capability_key varchar(192) not null,
  workflow_key varchar(192) not null,
  workflow_template_id varchar(128) not null,
  workflow_version_id varchar(128) not null,
  reason varchar(128) not null,
  primary key (plugin_version_id, capability_key, workflow_key)
) on commit drop;

insert into gcac_invalid_plugin_workflow_bindings (
  plugin_version_id, capability_key, workflow_key,
  workflow_template_id, workflow_version_id, reason
)
select
  binding.plugin_version_id,
  binding.capability_key,
  binding.workflow_key,
  binding.workflow_template_id,
  binding.workflow_version_id,
  case
    when template.document_id is null then 'MISSING_WORKFLOW_TEMPLATE'
    when version.document_id is null then 'MISSING_WORKFLOW_VERSION'
    when version.payload->>'templateId' <> binding.workflow_template_id then 'WORKFLOW_TEMPLATE_MISMATCH'
    when coalesce(template.payload->>'origin', '') <> 'plugin_internal' then 'INVALID_WORKFLOW_TEMPLATE_ORIGIN'
    when coalesce(version.payload->>'status', '') <> 'published' then 'WORKFLOW_VERSION_NOT_PUBLISHED'
    when coalesce(version.payload->>'contentHash', '') <> binding.workflow_content_sha256 then 'WORKFLOW_CONTENT_HASH_MISMATCH'
    when plugin.manifest->'resources'->>'runtimeEntrypoint' = 'runtime/index.js'
      and coalesce(version.payload->>'executionMode', '') <> 'PLUGIN_RUNNER' then 'LEGACY_PLUGIN_WORKFLOW_VERSION'
  end as reason
from unified_plugin_workflow_bindings binding
join unified_plugin_versions plugin
  on plugin.id = binding.plugin_version_id
left join pg_documents template
  on template.namespace = 'workflow.templates'
 and template.document_id = binding.workflow_template_id
left join pg_documents version
  on version.namespace = 'workflow.template_versions'
 and version.document_id = binding.workflow_version_id
where template.document_id is null
   or version.document_id is null
   or version.payload->>'templateId' <> binding.workflow_template_id
   or coalesce(template.payload->>'origin', '') <> 'plugin_internal'
   or coalesce(version.payload->>'status', '') <> 'published'
   or coalesce(version.payload->>'contentHash', '') <> binding.workflow_content_sha256
   or (
     plugin.manifest->'resources'->>'runtimeEntrypoint' = 'runtime/index.js'
     and coalesce(version.payload->>'executionMode', '') <> 'PLUGIN_RUNNER'
   );

insert into database_forward_cleanup_audits (
  audit_id, migration_version, source_table, source_namespace, source_id,
  cleanup_action, reason, metadata
)
select
  'P2-F-DB-20260814-PWB-' || md5(invalid.plugin_version_id || ':' || invalid.capability_key || ':' || invalid.workflow_key),
  '20260814000200',
  'unified_plugin_workflow_bindings',
  '',
  invalid.plugin_version_id || ':' || invalid.capability_key || ':' || invalid.workflow_key,
  'DELETE',
  invalid.reason,
  jsonb_build_object(
    'pluginVersionId', invalid.plugin_version_id,
    'capabilityKey', invalid.capability_key,
    'workflowKey', invalid.workflow_key,
    'workflowTemplateId', invalid.workflow_template_id,
    'workflowVersionId', invalid.workflow_version_id
  )
from gcac_invalid_plugin_workflow_bindings invalid
on conflict do nothing;

insert into database_forward_cleanup_audits (
  audit_id, migration_version, source_table, source_namespace, source_id,
  cleanup_action, reason, metadata
)
select
  'P2-F-DB-20260814-WEB-' || md5(execution.id),
  '20260814000200',
  'workflow_execution_bindings',
  '',
  execution.id,
  'DELETE',
  'REMOVED_DANGLING_PLUGIN_WORKFLOW_BINDING',
  jsonb_build_object(
    'pluginVersionId', execution.plugin_version_id,
    'capabilityKey', execution.capability_key,
    'workflowKey', execution.workflow_key,
    'workflowTemplateId', execution.workflow_template_id,
    'workflowVersionId', execution.workflow_version_id
  )
from workflow_execution_bindings execution
join gcac_invalid_plugin_workflow_bindings invalid
  on invalid.plugin_version_id = execution.plugin_version_id
 and invalid.capability_key = execution.capability_key
 and invalid.workflow_key = execution.workflow_key
on conflict do nothing;

delete from workflow_execution_bindings execution
using gcac_invalid_plugin_workflow_bindings invalid
where invalid.plugin_version_id = execution.plugin_version_id
  and invalid.capability_key = execution.capability_key
  and invalid.workflow_key = execution.workflow_key;

insert into database_forward_cleanup_audits (
  audit_id, migration_version, source_table, source_namespace, source_id,
  cleanup_action, reason, metadata
)
select
  'P2-F-DB-20260814-BRS-' || md5(session.id),
  '20260814000200',
  'browser_credential_sessions',
  '',
  session.id,
  'DELETE',
  'REMOVED_DANGLING_PLUGIN_WORKFLOW_BINDING',
  jsonb_build_object(
    'pluginVersionId', session.plugin_version_id,
    'capabilityKey', session.capability_key,
    'workflowTemplateId', session.workflow_template_id,
    'workflowVersionId', session.workflow_version_id
  )
from browser_credential_sessions session
join gcac_invalid_plugin_workflow_bindings invalid
  on invalid.plugin_version_id = session.plugin_version_id
 and invalid.capability_key = session.capability_key
 and invalid.workflow_template_id = session.workflow_template_id
 and invalid.workflow_version_id = session.workflow_version_id
on conflict do nothing;

delete from browser_credential_sessions session
using gcac_invalid_plugin_workflow_bindings invalid
where invalid.plugin_version_id = session.plugin_version_id
  and invalid.capability_key = session.capability_key
  and invalid.workflow_template_id = session.workflow_template_id
  and invalid.workflow_version_id = session.workflow_version_id;

insert into database_forward_cleanup_audits (
  audit_id, migration_version, source_table, source_namespace, source_id,
  cleanup_action, reason, metadata
)
select
  'P2-F-DB-20260814-PWL-' || md5(ledger.id),
  '20260814000200',
  'plugin_workflow_ledgers',
  '',
  ledger.id,
  'DELETE',
  'REMOVED_DANGLING_PLUGIN_WORKFLOW_BINDING',
  jsonb_build_object(
    'pluginVersionId', ledger.plugin_version_id,
    'capabilityKey', ledger.capability_key,
    'workflowVersionId', ledger.workflow_version_id
  )
from plugin_workflow_ledgers ledger
join gcac_invalid_plugin_workflow_bindings invalid
  on invalid.plugin_version_id = ledger.plugin_version_id
 and invalid.capability_key = ledger.capability_key
 and invalid.workflow_version_id = ledger.workflow_version_id
on conflict do nothing;

delete from plugin_workflow_ledgers ledger
using gcac_invalid_plugin_workflow_bindings invalid
where invalid.plugin_version_id = ledger.plugin_version_id
  and invalid.capability_key = ledger.capability_key
  and invalid.workflow_version_id = ledger.workflow_version_id;

delete from unified_plugin_workflow_bindings binding
using gcac_invalid_plugin_workflow_bindings invalid
where invalid.plugin_version_id = binding.plugin_version_id
  and invalid.capability_key = binding.capability_key
  and invalid.workflow_key = binding.workflow_key;
