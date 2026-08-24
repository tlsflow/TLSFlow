-- 004.5：发布前数据库前向清退。
-- 迁移执行器已经为每个文件包裹事务，本文件不自行 BEGIN/COMMIT。
-- 项目尚未发布，不保留旧逻辑的运行期数据；本迁移直接清除当前数据库中的旧记录。

create table if not exists database_forward_cleanup_audits (
  migration_version varchar(32) not null,
  source_table varchar(128) not null,
  source_namespace varchar(128) not null default '',
  source_id varchar(512) not null,
  cleanup_action varchar(32) not null,
  reason varchar(128) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (migration_version, source_table, source_namespace, source_id, cleanup_action)
);

-- 旧 Compatibility Catalog、Provider baseline/recipe、Discovery Mapping 和 Action Alias
-- 都是已删除的根合同。按根 apiVersion 匹配，不按 namespace 猜测，避免误删当前能力评估记录。
-- 宿主不再通过 PowerShell 读取 Windows Root Store；旧观测记录必须一并清除。
insert into database_forward_cleanup_audits (
  migration_version, source_table, source_namespace, source_id, cleanup_action, reason, metadata
)
select
  '20260809000500', 'pg_root_certificate_source_observations', '', observation.id,
  'DELETE', 'REMOVED_HOST_POWERSHELL_ROOT_SOURCE',
  jsonb_build_object('sourceType', observation.source_type, 'rootCertificateId', observation.root_certificate_id)
from pg_root_certificate_source_observations observation
where observation.source_type = 'windows'
on conflict do nothing;

delete from pg_root_certificate_source_observations observation
where observation.source_type = 'windows';

insert into database_forward_cleanup_audits (
  migration_version, source_table, source_namespace, source_id, cleanup_action, reason, metadata
)
select
  '20260809000500', 'app_documents', coalesce(document.namespace, ''), document.document_id,
  'DELETE', 'REMOVED_COMPATIBILITY_CONTRACT',
  jsonb_build_object('apiVersion', document.payload->>'apiVersion', 'schemaVersion', document.payload->>'schemaVersion')
from app_documents document
where document.payload->>'apiVersion' in (
    'gcac.compatibility/v1',
    'gcac.compatibility/v2',
    'gcac.runtime-baseline/v1',
    'gcac.execution-recipe/v1',
    'gcac.certification-record/v1',
    'gcac.adapter/v1',
    'gcac.plugin-action-aliases/v1',
    'gcac.agent-discovery-mapping/v1'
  )
  or document.payload->>'schemaVersion' = 'gcac.compatibility-catalog/v1'
on conflict do nothing;

insert into database_forward_cleanup_audits (
  migration_version, source_table, source_namespace, source_id, cleanup_action, reason, metadata
)
select
  '20260809000500', 'pg_documents', coalesce(document.namespace, ''), document.document_id,
  'DELETE', 'REMOVED_COMPATIBILITY_CONTRACT',
  jsonb_build_object('apiVersion', document.payload->>'apiVersion', 'schemaVersion', document.payload->>'schemaVersion')
from pg_documents document
where document.payload->>'apiVersion' in (
    'gcac.compatibility/v1',
    'gcac.compatibility/v2',
    'gcac.runtime-baseline/v1',
    'gcac.execution-recipe/v1',
    'gcac.certification-record/v1',
    'gcac.adapter/v1',
    'gcac.plugin-action-aliases/v1',
    'gcac.agent-discovery-mapping/v1'
  )
  or document.payload->>'schemaVersion' = 'gcac.compatibility-catalog/v1'
on conflict do nothing;

delete from app_documents document
where document.payload->>'apiVersion' in (
    'gcac.compatibility/v1',
    'gcac.compatibility/v2',
    'gcac.runtime-baseline/v1',
    'gcac.execution-recipe/v1',
    'gcac.certification-record/v1',
    'gcac.adapter/v1',
    'gcac.plugin-action-aliases/v1',
    'gcac.agent-discovery-mapping/v1'
  )
  or document.payload->>'schemaVersion' = 'gcac.compatibility-catalog/v1';

delete from pg_documents document
where document.payload->>'apiVersion' in (
    'gcac.compatibility/v1',
    'gcac.compatibility/v2',
    'gcac.runtime-baseline/v1',
    'gcac.execution-recipe/v1',
    'gcac.certification-record/v1',
    'gcac.adapter/v1',
    'gcac.plugin-action-aliases/v1',
    'gcac.agent-discovery-mapping/v1'
  )
  or document.payload->>'schemaVersion' = 'gcac.compatibility-catalog/v1';

-- 旧插件 Package、Catalog Activation 和旧执行记录已经不再是 Runner 数据源，直接删除。
insert into database_forward_cleanup_audits (
  migration_version, source_table, source_namespace, source_id, cleanup_action, reason, metadata
)
select
  '20260809000500', 'pg_documents', document.namespace, document.document_id,
  'DELETE', 'REMOVED_LEGACY_PLUGIN_DOCUMENT',
  jsonb_build_object('status', document.payload->>'status', 'installStatus', document.payload->>'installStatus')
from pg_documents document
where document.namespace in ('plugins:packages', 'plugins:catalog-activations', 'plugins:executions')
on conflict do nothing;

delete from pg_documents document
where document.namespace in ('plugins:packages', 'plugins:catalog-activations', 'plugins:executions');

-- 旧 Agent 合同只能从任务队列及其游标/日志中清除；四个 v2 合同动作不在删除集合内。
insert into database_forward_cleanup_audits (
  migration_version, source_table, source_namespace, source_id, cleanup_action, reason, metadata
)
select
  '20260809000500', 'pg_documents', 'agents:tasks', task.document_id,
  'DELETE', 'REMOVED_AGENT_LEGACY_ACTION',
  jsonb_build_object('actionType', coalesce(task.payload->>'actionType', task.payload->>'type'))
from pg_documents task
where task.namespace = 'agents:tasks'
  and coalesce(task.payload->>'actionType', task.payload->>'type') in (
    'agent.atomic_plan.execute',
    'agent.execute',
    'command.execute',
    'process.execute',
    'filesystem.write',
    'linux.nginx.deploy_certificate',
    'windows.iis.deploy_certificate'
  )
on conflict do nothing;

insert into database_forward_cleanup_audits (
  migration_version, source_table, source_namespace, source_id, cleanup_action, reason, metadata
)
select
  '20260809000500', 'pg_documents', 'agents:taskLogs', log.document_id,
  'DELETE', 'ORPHANED_AGENT_LEGACY_TASK_LOG',
  jsonb_build_object('taskId', log.payload->>'taskId')
from pg_documents log
where log.namespace = 'agents:taskLogs'
  and exists (
    select 1
    from pg_documents task
    where task.namespace = 'agents:tasks'
      and task.document_id = log.payload->>'taskId'
      and coalesce(task.payload->>'actionType', task.payload->>'type') in (
        'agent.atomic_plan.execute',
        'agent.execute',
        'command.execute',
        'process.execute',
        'filesystem.write',
        'linux.nginx.deploy_certificate',
        'windows.iis.deploy_certificate'
      )
  )
on conflict do nothing;

insert into database_forward_cleanup_audits (
  migration_version, source_table, source_namespace, source_id, cleanup_action, reason, metadata
)
select
  '20260809000500', 'pg_documents', 'agents:taskLogCursors', cursor.document_id,
  'DELETE', 'ORPHANED_AGENT_LEGACY_TASK_CURSOR',
  jsonb_build_object('taskId', cursor.payload->>'taskId')
from pg_documents cursor
where cursor.namespace = 'agents:taskLogCursors'
  and exists (
    select 1
    from pg_documents task
    where task.namespace = 'agents:tasks'
      and task.document_id = cursor.payload->>'taskId'
      and coalesce(task.payload->>'actionType', task.payload->>'type') in (
        'agent.atomic_plan.execute',
        'agent.execute',
        'command.execute',
        'process.execute',
        'filesystem.write',
        'linux.nginx.deploy_certificate',
        'windows.iis.deploy_certificate'
      )
  )
on conflict do nothing;

delete from pg_documents log
where log.namespace = 'agents:taskLogs'
  and exists (
    select 1
    from pg_documents task
    where task.namespace = 'agents:tasks'
      and task.document_id = log.payload->>'taskId'
      and coalesce(task.payload->>'actionType', task.payload->>'type') in (
        'agent.atomic_plan.execute',
        'agent.execute',
        'command.execute',
        'process.execute',
        'filesystem.write',
        'linux.nginx.deploy_certificate',
        'windows.iis.deploy_certificate'
      )
  );

delete from pg_documents cursor
where cursor.namespace = 'agents:taskLogCursors'
  and exists (
    select 1
    from pg_documents task
    where task.namespace = 'agents:tasks'
      and task.document_id = cursor.payload->>'taskId'
      and coalesce(task.payload->>'actionType', task.payload->>'type') in (
        'agent.atomic_plan.execute',
        'agent.execute',
        'command.execute',
        'process.execute',
        'filesystem.write',
        'linux.nginx.deploy_certificate',
        'windows.iis.deploy_certificate'
      )
  );

delete from pg_documents task
where task.namespace = 'agents:tasks'
  and coalesce(task.payload->>'actionType', task.payload->>'type') in (
    'agent.atomic_plan.execute',
    'agent.execute',
    'command.execute',
    'process.execute',
    'filesystem.write',
    'linux.nginx.deploy_certificate',
    'windows.iis.deploy_certificate'
  );

-- 旧 Recipe、Baseline、Discovery Mapping 和 Action Alias 资源不再属于当前合同。
-- 即使记录仍有旧绑定，也必须一次性撤销旧执行引用并清退记录，禁止靠保留绑定形成兼容路径。
create temporary table if not exists gcac_legacy_plugin_versions (
  plugin_version_id varchar(128) primary key
) on commit drop;

truncate gcac_legacy_plugin_versions;

insert into gcac_legacy_plugin_versions (plugin_version_id)
select distinct resource.plugin_version_id
from unified_plugin_resources resource
where resource.resource_path like 'runtime-baselines/%'
   or resource.resource_path like 'execution-recipes/%'
   or resource.resource_path like 'agent-recipes/%'
   or resource.resource_path like 'agent-discovery-mappings/%'
   or resource.resource_path like 'discovery-mappings/%'
   or resource.resource_path like 'action-aliases/%';

insert into database_forward_cleanup_audits (
  migration_version, source_table, source_namespace, source_id, cleanup_action, reason, metadata
)
select
  '20260809000500', 'plugin_runner_version_bindings', '', binding.plugin_version_id,
  'DELETE', 'REMOVED_LEGACY_PLUGIN_RUNNER_BINDING',
  jsonb_build_object('canonicalPluginId', binding.canonical_plugin_id, 'pluginVersion', binding.plugin_version)
from plugin_runner_version_bindings binding
join gcac_legacy_plugin_versions legacy on legacy.plugin_version_id = binding.plugin_version_id
on conflict do nothing;

delete from plugin_runner_version_bindings binding
using gcac_legacy_plugin_versions legacy
where legacy.plugin_version_id = binding.plugin_version_id;

insert into database_forward_cleanup_audits (
  migration_version, source_table, source_namespace, source_id, cleanup_action, reason, metadata
)
select
  '20260809000500', 'unified_plugin_workflow_bindings', '', binding.plugin_version_id || ':' || binding.capability_key,
  'DELETE', 'REMOVED_LEGACY_PLUGIN_WORKFLOW_BINDING',
  jsonb_build_object('workflowTemplateId', binding.workflow_template_id, 'workflowVersionId', binding.workflow_version_id)
from unified_plugin_workflow_bindings binding
join gcac_legacy_plugin_versions legacy on legacy.plugin_version_id = binding.plugin_version_id
on conflict do nothing;

delete from unified_plugin_workflow_bindings binding
using gcac_legacy_plugin_versions legacy
where legacy.plugin_version_id = binding.plugin_version_id;

insert into database_forward_cleanup_audits (
  migration_version, source_table, source_namespace, source_id, cleanup_action, reason, metadata
)
select
  '20260809000500', 'unified_plugin_bindings', '', binding.id,
  'UPDATE', 'DISABLED_LEGACY_PLUGIN_BINDING',
  jsonb_build_object('pluginVersionId', binding.plugin_version_id, 'previousStatus', binding.status)
from unified_plugin_bindings binding
join gcac_legacy_plugin_versions legacy on legacy.plugin_version_id = binding.plugin_version_id
where binding.status <> 'DISABLED'
on conflict do nothing;

update unified_plugin_bindings binding
set status = 'DISABLED', updated_at = now(), version = version + 1
from gcac_legacy_plugin_versions legacy
where legacy.plugin_version_id = binding.plugin_version_id
  and binding.status <> 'DISABLED';

insert into database_forward_cleanup_audits (
  migration_version, source_table, source_namespace, source_id, cleanup_action, reason, metadata
)
select
  '20260809000500', 'plugin_capability_assignments', '', assignment.id,
  'UPDATE', 'DISABLED_LEGACY_PLUGIN_ASSIGNMENT',
  jsonb_build_object('pluginVersionId', assignment.plugin_version_id, 'previousStatus', assignment.status)
from plugin_capability_assignments assignment
join gcac_legacy_plugin_versions legacy on legacy.plugin_version_id = assignment.plugin_version_id
where assignment.status <> 'DISABLED'
on conflict do nothing;

update plugin_capability_assignments assignment
set status = 'DISABLED', updated_at = now()
from gcac_legacy_plugin_versions legacy
where legacy.plugin_version_id = assignment.plugin_version_id
  and assignment.status <> 'DISABLED';

insert into database_forward_cleanup_audits (
  migration_version, source_table, source_namespace, source_id, cleanup_action, reason, metadata
)
select
  '20260809000500', 'unified_plugin_versions', '', version.id,
  'UPDATE', 'RETIRED_LEGACY_PLUGIN_VERSION',
  jsonb_build_object('pluginId', version.plugin_id, 'pluginVersion', version.plugin_version, 'previousStatus', version.status)
from unified_plugin_versions version
join gcac_legacy_plugin_versions legacy on legacy.plugin_version_id = version.id
where version.status <> 'RETIRED'
on conflict do nothing;

update unified_plugin_versions version
set status = 'RETIRED',
    validation_report = jsonb_set(
      case when jsonb_typeof(version.validation_report) = 'object'
        then version.validation_report
        else jsonb_build_object('originalValidationReport', version.validation_report)
      end,
      '{pluginRunnerCleanup}',
      jsonb_build_object('status', 'RETIRED', 'reason', 'REMOVED_LEGACY_PLUGIN_RESOURCE'),
      true
    ),
    updated_at = now()
from gcac_legacy_plugin_versions legacy
where legacy.plugin_version_id = version.id
  and version.status <> 'RETIRED';

insert into database_forward_cleanup_audits (
  migration_version, source_table, source_namespace, source_id, cleanup_action, reason, metadata
)
select
  '20260809000500', 'unified_plugin_resources', '', resource.plugin_version_id || ':' || resource.resource_path,
  'DELETE', 'REMOVED_LEGACY_PLUGIN_RESOURCE',
  jsonb_build_object('pluginVersionId', resource.plugin_version_id, 'resourcePath', resource.resource_path)
from unified_plugin_resources resource
where resource.resource_path like 'runtime-baselines/%'
   or resource.resource_path like 'execution-recipes/%'
   or resource.resource_path like 'agent-recipes/%'
   or resource.resource_path like 'agent-discovery-mappings/%'
   or resource.resource_path like 'discovery-mappings/%'
   or resource.resource_path like 'action-aliases/%'
on conflict do nothing;

delete from unified_plugin_resources resource
where resource.resource_path like 'runtime-baselines/%'
   or resource.resource_path like 'execution-recipes/%'
   or resource.resource_path like 'agent-recipes/%'
   or resource.resource_path like 'agent-discovery-mappings/%'
   or resource.resource_path like 'discovery-mappings/%'
   or resource.resource_path like 'action-aliases/%';

-- 两个旧产品 Workflow 已经从宿主删除。无论是否存在旧绑定，都直接清除其关联记录。
insert into database_forward_cleanup_audits (
  migration_version, source_table, source_namespace, source_id, cleanup_action, reason, metadata
)
select
  '20260809000500', 'unified_plugin_workflow_bindings', '', binding.plugin_version_id || ':' || binding.capability_key,
  'DELETE', 'REMOVED_LEGACY_HOST_PLUGIN_WORKFLOW_BINDING',
  jsonb_build_object('workflowTemplateId', binding.workflow_template_id, 'workflowVersionId', binding.workflow_version_id)
from unified_plugin_workflow_bindings binding
where binding.workflow_template_id in (
  select template.document_id
  from pg_documents template
  where template.namespace = 'workflow.templates'
    and (template.document_id in ('apache-8444-cert-switch', 'synology-dsm-cert-import')
      or template.payload->>'name' in ('apache-8444-cert-switch', 'synology-dsm-cert-import'))
)
on conflict do nothing;

delete from unified_plugin_workflow_bindings binding
where binding.workflow_template_id in (
  select template.document_id
  from pg_documents template
  where template.namespace = 'workflow.templates'
    and (template.document_id in ('apache-8444-cert-switch', 'synology-dsm-cert-import')
      or template.payload->>'name' in ('apache-8444-cert-switch', 'synology-dsm-cert-import'))
);

insert into database_forward_cleanup_audits (
  migration_version, source_table, source_namespace, source_id, cleanup_action, reason, metadata
)
select
  '20260809000500', 'workflow_execution_bindings', '', execution.id,
  'DELETE', 'REMOVED_LEGACY_HOST_WORKFLOW_BINDING',
  jsonb_build_object('workflowTemplateId', execution.workflow_template_id, 'workflowVersionId', execution.workflow_version_id)
from workflow_execution_bindings execution
where execution.workflow_template_id in (
    select template.document_id
    from pg_documents template
    where template.namespace = 'workflow.templates'
      and (template.document_id in ('apache-8444-cert-switch', 'synology-dsm-cert-import')
        or template.payload->>'name' in ('apache-8444-cert-switch', 'synology-dsm-cert-import'))
  );

delete from workflow_execution_bindings execution
where execution.workflow_template_id in (
    select template.document_id
    from pg_documents template
    where template.namespace = 'workflow.templates'
      and (template.document_id in ('apache-8444-cert-switch', 'synology-dsm-cert-import')
        or template.payload->>'name' in ('apache-8444-cert-switch', 'synology-dsm-cert-import'))
  );

insert into database_forward_cleanup_audits (
  migration_version, source_table, source_namespace, source_id, cleanup_action, reason, metadata
)
select
  '20260809000500', 'browser_credential_sessions', '', session.id,
  'DELETE', 'REMOVED_LEGACY_HOST_WORKFLOW_SESSION',
  jsonb_build_object('workflowTemplateId', session.workflow_template_id, 'workflowVersionId', session.workflow_version_id)
from browser_credential_sessions session
where session.workflow_template_id in (
    select template.document_id
    from pg_documents template
    where template.namespace = 'workflow.templates'
      and (template.document_id in ('apache-8444-cert-switch', 'synology-dsm-cert-import')
        or template.payload->>'name' in ('apache-8444-cert-switch', 'synology-dsm-cert-import'))
  );

delete from browser_credential_sessions session
where session.workflow_template_id in (
    select template.document_id
    from pg_documents template
    where template.namespace = 'workflow.templates'
      and (template.document_id in ('apache-8444-cert-switch', 'synology-dsm-cert-import')
        or template.payload->>'name' in ('apache-8444-cert-switch', 'synology-dsm-cert-import'))
  );

insert into database_forward_cleanup_audits (
  migration_version, source_table, source_namespace, source_id, cleanup_action, reason, metadata
)
select
  '20260809000500', 'plugin_workflow_ledgers', '', ledger.id,
  'DELETE', 'REMOVED_LEGACY_HOST_WORKFLOW_LEDGER',
  jsonb_build_object('workflowVersionId', ledger.workflow_version_id, 'pluginVersionId', ledger.plugin_version_id)
from plugin_workflow_ledgers ledger
where ledger.workflow_version_id in (
    select version.document_id
    from pg_documents version
    join pg_documents template
      on template.namespace = 'workflow.templates'
     and template.document_id = version.payload->>'templateId'
    where version.namespace = 'workflow.template_versions'
      and (template.document_id in ('apache-8444-cert-switch', 'synology-dsm-cert-import')
        or template.payload->>'name' in ('apache-8444-cert-switch', 'synology-dsm-cert-import'))
  );

delete from plugin_workflow_ledgers ledger
where ledger.workflow_version_id in (
    select version.document_id
    from pg_documents version
    join pg_documents template
      on template.namespace = 'workflow.templates'
     and template.document_id = version.payload->>'templateId'
    where version.namespace = 'workflow.template_versions'
      and (template.document_id in ('apache-8444-cert-switch', 'synology-dsm-cert-import')
        or template.payload->>'name' in ('apache-8444-cert-switch', 'synology-dsm-cert-import'))
  );

insert into database_forward_cleanup_audits (
  migration_version, source_table, source_namespace, source_id, cleanup_action, reason, metadata
)
select
  '20260809000500', 'pg_documents', 'workflow.template_versions', version.document_id,
  'DELETE', 'REMOVED_LEGACY_HOST_WORKFLOW_VERSION',
  jsonb_build_object('templateId', version.payload->>'templateId', 'name', template.payload->>'name')
from pg_documents version
join pg_documents template
  on template.namespace = 'workflow.templates'
 and template.document_id = version.payload->>'templateId'
where version.namespace = 'workflow.template_versions'
  and (template.document_id in ('apache-8444-cert-switch', 'synology-dsm-cert-import')
    or template.payload->>'name' in ('apache-8444-cert-switch', 'synology-dsm-cert-import'))
;

delete from pg_documents version
where version.namespace = 'workflow.template_versions'
  and version.payload->>'templateId' in (
    select template.document_id
    from pg_documents template
    where template.namespace = 'workflow.templates'
      and (template.document_id in ('apache-8444-cert-switch', 'synology-dsm-cert-import')
        or template.payload->>'name' in ('apache-8444-cert-switch', 'synology-dsm-cert-import'))
  );

insert into database_forward_cleanup_audits (
  migration_version, source_table, source_namespace, source_id, cleanup_action, reason, metadata
)
select
  '20260809000500', 'pg_documents', 'workflow.templates', template.document_id,
  'DELETE', 'REMOVED_LEGACY_HOST_WORKFLOW',
  jsonb_build_object('name', template.payload->>'name')
from pg_documents template
where template.namespace = 'workflow.templates'
  and (template.document_id in ('apache-8444-cert-switch', 'synology-dsm-cert-import')
    or template.payload->>'name' in ('apache-8444-cert-switch', 'synology-dsm-cert-import'))
on conflict do nothing;

delete from pg_documents template
where template.namespace = 'workflow.templates'
  and (template.document_id in ('apache-8444-cert-switch', 'synology-dsm-cert-import')
    or template.payload->>'name' in ('apache-8444-cert-switch', 'synology-dsm-cert-import'));
