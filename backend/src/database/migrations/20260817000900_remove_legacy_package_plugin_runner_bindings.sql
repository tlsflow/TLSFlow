-- 004.5 P2：包级 Plugin Runner 已废弃。仅删除仍指向旧版本的绑定及其运行引用，保留普通 DSL WorkflowVersion。

create temporary table gcac_legacy_package_plugin_workflow_bindings (
  plugin_version_id varchar(128) not null,
  capability_key varchar(192) not null,
  workflow_key varchar(192) not null,
  workflow_template_id varchar(128) not null,
  workflow_version_id varchar(128) not null,
  reason varchar(128) not null,
  primary key (plugin_version_id, capability_key, workflow_key)
) on commit drop;

insert into gcac_legacy_package_plugin_workflow_bindings (
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
    when coalesce(version.payload->>'executionMode', '') = 'PLUGIN_RUNNER'
      then 'REMOVED_LEGACY_PACKAGE_PLUGIN_RUNNER_BINDING'
    else 'REMOVED_LEGACY_PLUGIN_WORKFLOW_BINDING'
  end
from unified_plugin_workflow_bindings binding
join pg_documents version
  on version.namespace = 'workflow.template_versions'
 and version.document_id = binding.workflow_version_id
where coalesce(version.payload->>'executionMode', '') = 'PLUGIN_RUNNER'
   or coalesce(version.payload->'content'->>'kind', '') = 'PluginWorkflow';

insert into database_forward_cleanup_audits (
  audit_id, migration_version, source_table, source_namespace, source_id,
  cleanup_action, reason, metadata
)
select
  'P2-F-DB-20260817-PWB-' || md5(legacy.plugin_version_id || ':' || legacy.capability_key || ':' || legacy.workflow_key),
  '20260817000900',
  'unified_plugin_workflow_bindings',
  '',
  legacy.plugin_version_id || ':' || legacy.capability_key || ':' || legacy.workflow_key,
  'DELETE',
  legacy.reason,
  jsonb_build_object(
    'pluginVersionId', legacy.plugin_version_id,
    'capabilityKey', legacy.capability_key,
    'workflowKey', legacy.workflow_key,
    'workflowTemplateId', legacy.workflow_template_id,
    'workflowVersionId', legacy.workflow_version_id
  )
from gcac_legacy_package_plugin_workflow_bindings legacy
on conflict do nothing;

insert into database_forward_cleanup_audits (
  audit_id, migration_version, source_table, source_namespace, source_id,
  cleanup_action, reason, metadata
)
select
  'P2-F-DB-20260817-WEB-' || md5(execution.id),
  '20260817000900',
  'workflow_execution_bindings',
  '',
  execution.id,
  'DELETE',
  'REMOVED_LEGACY_PACKAGE_PLUGIN_RUNNER_BINDING',
  jsonb_build_object(
    'pluginVersionId', execution.plugin_version_id,
    'capabilityKey', execution.capability_key,
    'workflowKey', execution.workflow_key,
    'workflowTemplateId', execution.workflow_template_id,
    'workflowVersionId', execution.workflow_version_id
  )
from workflow_execution_bindings execution
join gcac_legacy_package_plugin_workflow_bindings legacy
  on legacy.plugin_version_id = execution.plugin_version_id
 and legacy.capability_key = execution.capability_key
 and legacy.workflow_key = execution.workflow_key
on conflict do nothing;

delete from workflow_execution_bindings execution
using gcac_legacy_package_plugin_workflow_bindings legacy
where legacy.plugin_version_id = execution.plugin_version_id
  and legacy.capability_key = execution.capability_key
  and legacy.workflow_key = execution.workflow_key;

insert into database_forward_cleanup_audits (
  audit_id, migration_version, source_table, source_namespace, source_id,
  cleanup_action, reason, metadata
)
select
  'P2-F-DB-20260817-BRS-' || md5(session.id),
  '20260817000900',
  'browser_credential_sessions',
  '',
  session.id,
  'DELETE',
  'REMOVED_LEGACY_PACKAGE_PLUGIN_RUNNER_BINDING',
  jsonb_build_object(
    'pluginVersionId', session.plugin_version_id,
    'capabilityKey', session.capability_key,
    'workflowTemplateId', session.workflow_template_id,
    'workflowVersionId', session.workflow_version_id
  )
from browser_credential_sessions session
join gcac_legacy_package_plugin_workflow_bindings legacy
  on legacy.plugin_version_id = session.plugin_version_id
 and legacy.capability_key = session.capability_key
 and legacy.workflow_template_id = session.workflow_template_id
 and legacy.workflow_version_id = session.workflow_version_id
on conflict do nothing;

delete from browser_credential_sessions session
using gcac_legacy_package_plugin_workflow_bindings legacy
where legacy.plugin_version_id = session.plugin_version_id
  and legacy.capability_key = session.capability_key
  and legacy.workflow_template_id = session.workflow_template_id
  and legacy.workflow_version_id = session.workflow_version_id;

insert into database_forward_cleanup_audits (
  audit_id, migration_version, source_table, source_namespace, source_id,
  cleanup_action, reason, metadata
)
select
  'P2-F-DB-20260817-PWL-' || md5(ledger.id),
  '20260817000900',
  'plugin_workflow_ledgers',
  '',
  ledger.id,
  'DELETE',
  'REMOVED_LEGACY_PACKAGE_PLUGIN_RUNNER_BINDING',
  jsonb_build_object(
    'pluginVersionId', ledger.plugin_version_id,
    'capabilityKey', ledger.capability_key,
    'workflowVersionId', ledger.workflow_version_id
  )
from plugin_workflow_ledgers ledger
join gcac_legacy_package_plugin_workflow_bindings legacy
  on legacy.plugin_version_id = ledger.plugin_version_id
 and legacy.capability_key = ledger.capability_key
 and legacy.workflow_version_id = ledger.workflow_version_id
on conflict do nothing;

delete from plugin_workflow_ledgers ledger
using gcac_legacy_package_plugin_workflow_bindings legacy
where legacy.plugin_version_id = ledger.plugin_version_id
  and legacy.capability_key = ledger.capability_key
  and legacy.workflow_version_id = ledger.workflow_version_id;

delete from unified_plugin_workflow_bindings binding
using gcac_legacy_package_plugin_workflow_bindings legacy
where legacy.plugin_version_id = binding.plugin_version_id
  and legacy.capability_key = binding.capability_key
  and legacy.workflow_key = binding.workflow_key;
