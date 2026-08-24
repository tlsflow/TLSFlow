-- 当前 Workflow 合同只允许 user 和 plugin_internal。
-- 迁移执行前已经产生的其他来源不再进入运行时，连同其运行引用一并清除。

create temporary table gcac_invalid_workflow_template_ids (
  workflow_template_id varchar(512) not null primary key
) on commit drop;

insert into gcac_invalid_workflow_template_ids (workflow_template_id)
select document.document_id
from pg_documents document
where document.namespace = 'workflow.templates'
  and coalesce(document.payload->>'origin', '') not in ('user', 'plugin_internal');

create temporary table gcac_invalid_workflow_version_ids (
  workflow_version_id varchar(512) not null primary key
) on commit drop;

insert into gcac_invalid_workflow_version_ids (workflow_version_id)
select version.document_id
from pg_documents version
where version.namespace = 'workflow.template_versions'
  and version.payload->>'templateId' in (
    select workflow_template_id from gcac_invalid_workflow_template_ids
  );

insert into database_forward_cleanup_audits (
  audit_id, migration_version, source_table, source_namespace, source_id,
  cleanup_action, reason, metadata
)
select
  'P1-F-DB-20260811-WFO-' || md5('plugin-binding:' || binding.plugin_version_id || ':' || binding.capability_key),
  '20260811000200', 'unified_plugin_workflow_bindings', '',
  binding.plugin_version_id || ':' || binding.capability_key,
  'DELETE', 'REMOVED_INVALID_WORKFLOW_ORIGIN',
  jsonb_build_object('workflowTemplateId', binding.workflow_template_id, 'workflowVersionId', binding.workflow_version_id)
from unified_plugin_workflow_bindings binding
where binding.workflow_template_id in (select workflow_template_id from gcac_invalid_workflow_template_ids)
   or binding.workflow_version_id in (select workflow_version_id from gcac_invalid_workflow_version_ids)
on conflict do nothing;

delete from unified_plugin_workflow_bindings binding
where binding.workflow_template_id in (select workflow_template_id from gcac_invalid_workflow_template_ids)
   or binding.workflow_version_id in (select workflow_version_id from gcac_invalid_workflow_version_ids);

insert into database_forward_cleanup_audits (
  audit_id, migration_version, source_table, source_namespace, source_id,
  cleanup_action, reason, metadata
)
select
  'P1-F-DB-20260811-WFO-' || md5('execution-binding:' || binding.id),
  '20260811000200', 'workflow_execution_bindings', '', binding.id,
  'DELETE', 'REMOVED_INVALID_WORKFLOW_ORIGIN',
  jsonb_build_object('workflowTemplateId', binding.workflow_template_id, 'workflowVersionId', binding.workflow_version_id)
from workflow_execution_bindings binding
where binding.workflow_template_id in (select workflow_template_id from gcac_invalid_workflow_template_ids)
   or binding.workflow_version_id in (select workflow_version_id from gcac_invalid_workflow_version_ids)
on conflict do nothing;

delete from workflow_execution_bindings binding
where binding.workflow_template_id in (select workflow_template_id from gcac_invalid_workflow_template_ids)
   or binding.workflow_version_id in (select workflow_version_id from gcac_invalid_workflow_version_ids);

insert into database_forward_cleanup_audits (
  audit_id, migration_version, source_table, source_namespace, source_id,
  cleanup_action, reason, metadata
)
select
  'P1-F-DB-20260811-WFO-' || md5('browser-session:' || session.id),
  '20260811000200', 'browser_credential_sessions', '', session.id,
  'DELETE', 'REMOVED_INVALID_WORKFLOW_ORIGIN',
  jsonb_build_object('workflowTemplateId', session.workflow_template_id, 'workflowVersionId', session.workflow_version_id)
from browser_credential_sessions session
where session.workflow_template_id in (select workflow_template_id from gcac_invalid_workflow_template_ids)
   or session.workflow_version_id in (select workflow_version_id from gcac_invalid_workflow_version_ids)
on conflict do nothing;

delete from browser_credential_sessions session
where session.workflow_template_id in (select workflow_template_id from gcac_invalid_workflow_template_ids)
   or session.workflow_version_id in (select workflow_version_id from gcac_invalid_workflow_version_ids);

insert into database_forward_cleanup_audits (
  audit_id, migration_version, source_table, source_namespace, source_id,
  cleanup_action, reason, metadata
)
select
  'P1-F-DB-20260811-WFO-' || md5('ledger:' || ledger.id),
  '20260811000200', 'plugin_workflow_ledgers', '', ledger.id,
  'DELETE', 'REMOVED_INVALID_WORKFLOW_ORIGIN',
  jsonb_build_object('workflowVersionId', ledger.workflow_version_id)
from plugin_workflow_ledgers ledger
where ledger.workflow_version_id in (select workflow_version_id from gcac_invalid_workflow_version_ids)
on conflict do nothing;

delete from plugin_workflow_ledgers ledger
where ledger.workflow_version_id in (select workflow_version_id from gcac_invalid_workflow_version_ids);

insert into database_forward_cleanup_audits (
  audit_id, migration_version, source_table, source_namespace, source_id,
  cleanup_action, reason, metadata
)
select
  'P1-F-DB-20260811-WFO-' || md5('version:' || version.document_id),
  '20260811000200', 'pg_documents', 'workflow.template_versions', version.document_id,
  'DELETE', 'REMOVED_INVALID_WORKFLOW_ORIGIN',
  jsonb_build_object('templateId', version.payload->>'templateId')
from pg_documents version
where version.namespace = 'workflow.template_versions'
  and version.document_id in (select workflow_version_id from gcac_invalid_workflow_version_ids)
on conflict do nothing;

delete from pg_documents version
where version.namespace = 'workflow.template_versions'
  and version.document_id in (select workflow_version_id from gcac_invalid_workflow_version_ids);

insert into database_forward_cleanup_audits (
  audit_id, migration_version, source_table, source_namespace, source_id,
  cleanup_action, reason, metadata
)
select
  'P1-F-DB-20260811-WFO-' || md5('template:' || template.document_id),
  '20260811000200', 'pg_documents', 'workflow.templates', template.document_id,
  'DELETE', 'REMOVED_INVALID_WORKFLOW_ORIGIN',
  jsonb_build_object('origin', template.payload->>'origin', 'name', template.payload->>'name')
from pg_documents template
where template.namespace = 'workflow.templates'
  and template.document_id in (select workflow_template_id from gcac_invalid_workflow_template_ids)
on conflict do nothing;

delete from pg_documents template
where template.namespace = 'workflow.templates'
  and template.document_id in (select workflow_template_id from gcac_invalid_workflow_template_ids);
