-- 004.5：固定旧 Recipe、Discovery Mapping 和裸 Workflow 的逐项清退审计。
-- 本迁移只追加到历史迁移之后；历史迁移文件保持不可变。

alter table database_forward_cleanup_audits
  add column if not exists audit_id varchar(128);

-- 历史审计行没有独立 ID 时，按原始主键生成稳定 ID，保证旧记录仍可追踪。
update database_forward_cleanup_audits audit
set audit_id = 'DBF-' || audit.migration_version || '-' || md5(
  audit.migration_version || ':' || audit.source_table || ':' || audit.source_namespace || ':' || audit.source_id || ':' || audit.cleanup_action
)
where audit.audit_id is null;

alter table database_forward_cleanup_audits
  alter column audit_id set not null;

create unique index if not exists uq_database_forward_cleanup_audits_audit_id
  on database_forward_cleanup_audits (audit_id);

create temporary table gcac_0045_retirement_inventory (
  audit_id varchar(128) not null primary key,
  kind varchar(32) not null,
  source_table varchar(128) not null,
  source_namespace varchar(128) not null default '',
  source_id varchar(512) not null,
  resource_path varchar(512),
  cleanup_action varchar(32) not null,
  reason varchar(128) not null,
  metadata jsonb not null default '{}'::jsonb
) on commit drop;

insert into gcac_0045_retirement_inventory (
  audit_id, kind, source_table, source_namespace, source_id, resource_path,
  cleanup_action, reason, metadata
)
values
  ('P1-F-DB-20260811-REC-001', 'RECIPE', 'unified_plugin_resources', '', 'builtin.linux.nginx.pem', 'agent-recipes/builtin.linux.nginx.pem.json', 'DELETE', 'REMOVED_LEGACY_RECIPE', jsonb_build_object('fileName', 'agent-recipes.ts')),
  ('P1-F-DB-20260811-REC-002', 'RECIPE', 'unified_plugin_resources', '', 'builtin.windows.iis.pfx', 'agent-recipes/builtin.windows.iis.pfx.json', 'DELETE', 'REMOVED_LEGACY_RECIPE', jsonb_build_object('fileName', 'agent-recipes.ts')),
  ('P1-F-DB-20260811-REC-003', 'RECIPE', 'unified_plugin_resources', '', 'builtin.windows.nginx.pem', 'agent-recipes/builtin.windows.nginx.pem.json', 'DELETE', 'REMOVED_LEGACY_RECIPE', jsonb_build_object('fileName', 'agent-recipes.ts')),
  ('P1-F-DB-20260811-REC-004', 'RECIPE', 'unified_plugin_resources', '', 'builtin.windows.apache.pem', 'agent-recipes/builtin.windows.apache.pem.json', 'DELETE', 'REMOVED_LEGACY_RECIPE', jsonb_build_object('fileName', 'agent-recipes.ts')),
  ('P1-F-DB-20260811-REC-005', 'RECIPE', 'unified_plugin_resources', '', 'builtin.windows.tomcat.pkcs12', 'agent-recipes/builtin.windows.tomcat.pkcs12.json', 'DELETE', 'REMOVED_LEGACY_RECIPE', jsonb_build_object('fileName', 'agent-recipes.ts')),
  ('P1-F-DB-20260811-REC-006', 'RECIPE', 'unified_plugin_resources', '', 'builtin.windows.custom.certificate', 'agent-recipes/builtin.windows.custom.certificate.json', 'DELETE', 'REMOVED_LEGACY_RECIPE', jsonb_build_object('fileName', 'agent-recipes.ts')),
  ('P1-F-DB-20260811-REC-007', 'RECIPE', 'unified_plugin_resources', '', 'builtin.rabbitmq.pem', 'agent-recipes/builtin.rabbitmq.pem.json', 'DELETE', 'REMOVED_LEGACY_RECIPE', jsonb_build_object('fileName', 'agent-recipes.ts')),
  ('P1-F-DB-20260811-REC-008', 'RECIPE', 'unified_plugin_resources', '', 'builtin.java.pkcs12', 'agent-recipes/builtin.java.pkcs12.json', 'DELETE', 'REMOVED_LEGACY_RECIPE', jsonb_build_object('fileName', 'agent-recipes.ts')),
  ('P1-F-DB-20260811-REC-009', 'RECIPE', 'unified_plugin_resources', '', 'builtin.windows-service.certificate-file', 'agent-recipes/builtin.windows-service.certificate-file.json', 'DELETE', 'REMOVED_LEGACY_RECIPE', jsonb_build_object('fileName', 'agent-recipes.ts')),
  ('P1-F-DB-20260811-MAP-001', 'DISCOVERY_MAPPING', 'unified_plugin_resources', '', 'iis.json', 'discovery-mappings/iis.json', 'DELETE', 'REMOVED_LEGACY_DISCOVERY_MAPPING', jsonb_build_object('fileName', 'iis.json')),
  ('P1-F-DB-20260811-MAP-002', 'DISCOVERY_MAPPING', 'unified_plugin_resources', '', 'nginx.json', 'discovery-mappings/nginx.json', 'DELETE', 'REMOVED_LEGACY_DISCOVERY_MAPPING', jsonb_build_object('fileName', 'nginx.json')),
  ('P1-F-DB-20260811-MAP-003', 'DISCOVERY_MAPPING', 'unified_plugin_resources', '', 'apache.json', 'discovery-mappings/apache.json', 'DELETE', 'REMOVED_LEGACY_DISCOVERY_MAPPING', jsonb_build_object('fileName', 'apache.json')),
  ('P1-F-DB-20260811-MAP-004', 'DISCOVERY_MAPPING', 'unified_plugin_resources', '', 'tomcat.json', 'discovery-mappings/tomcat.json', 'DELETE', 'REMOVED_LEGACY_DISCOVERY_MAPPING', jsonb_build_object('fileName', 'tomcat.json')),
  ('P1-F-DB-20260811-MAP-005', 'DISCOVERY_MAPPING', 'unified_plugin_resources', '', 'windows-nginx.json', 'discovery-mappings/windows-nginx.json', 'DELETE', 'REMOVED_LEGACY_DISCOVERY_MAPPING', jsonb_build_object('fileName', 'windows-nginx.json')),
  ('P1-F-DB-20260811-MAP-006', 'DISCOVERY_MAPPING', 'unified_plugin_resources', '', 'windows-apache.json', 'discovery-mappings/windows-apache.json', 'DELETE', 'REMOVED_LEGACY_DISCOVERY_MAPPING', jsonb_build_object('fileName', 'windows-apache.json')),
  ('P1-F-DB-20260811-MAP-007', 'DISCOVERY_MAPPING', 'unified_plugin_resources', '', 'windows-tomcat.json', 'discovery-mappings/windows-tomcat.json', 'DELETE', 'REMOVED_LEGACY_DISCOVERY_MAPPING', jsonb_build_object('fileName', 'windows-tomcat.json')),
  ('P1-F-DB-20260811-WFL-001', 'BARE_WORKFLOW', 'pg_documents', 'workflow.templates', 'apache-8444-cert-switch', 'workflows/apache-8444-cert-switch.json', 'DELETE', 'REMOVED_LEGACY_BARE_WORKFLOW', jsonb_build_object('fileName', 'apache-8444-cert-switch.json')),
  ('P1-F-DB-20260811-WFL-002', 'BARE_WORKFLOW', 'pg_documents', 'workflow.templates', 'synology-dsm-cert-import', 'workflows/synology-dsm-cert-import.json', 'DELETE', 'REMOVED_LEGACY_BARE_WORKFLOW', jsonb_build_object('fileName', 'synology-dsm-cert-import.json'));

create temporary table gcac_0045_retired_plugin_versions (
  plugin_version_id varchar(128) not null primary key
) on commit drop;

insert into gcac_0045_retired_plugin_versions (plugin_version_id)
select distinct plugin_version.id
from unified_plugin_versions plugin_version
where plugin_version.plugin_id in (
    select inventory.source_id
    from gcac_0045_retirement_inventory inventory
    where inventory.kind = 'RECIPE'
  )
  or exists (
    select 1
    from unified_plugin_resources resource
    join gcac_0045_retirement_inventory inventory
      on inventory.resource_path = resource.resource_path
     and inventory.kind in ('RECIPE', 'DISCOVERY_MAPPING')
    where resource.plugin_version_id = plugin_version.id
  );

-- 逐项写入清退清单。matched* 字段记录迁移开始时的实际匹配数量，0 也必须留痕。
insert into database_forward_cleanup_audits (
  audit_id, migration_version, source_table, source_namespace, source_id,
  cleanup_action, reason, metadata
)
select
  inventory.audit_id,
  '20260811000100',
  inventory.source_table,
  inventory.source_namespace,
  inventory.source_id,
  inventory.cleanup_action,
  inventory.reason,
  inventory.metadata || jsonb_build_object(
    'inventoryId', inventory.audit_id,
    'kind', inventory.kind,
    'migrationVersion', '20260811000100',
    'resourcePath', inventory.resource_path,
    'matchedResourceRows', case
      when inventory.resource_path is null then 0
      else (select count(*) from unified_plugin_resources resource where resource.resource_path = inventory.resource_path)
    end,
    'matchedPluginVersionRows', case
      when inventory.kind in ('RECIPE', 'DISCOVERY_MAPPING') then (
        select count(*)
        from gcac_0045_retired_plugin_versions retired
        where retired.plugin_version_id in (
          select resource.plugin_version_id
          from unified_plugin_resources resource
          where resource.resource_path = inventory.resource_path
        )
      )
      else 0
    end,
    'matchedWorkflowTemplateRows', case
      when inventory.kind = 'BARE_WORKFLOW' then (
        select count(*)
        from pg_documents template
        where template.namespace = inventory.source_namespace
          and (template.document_id = inventory.source_id or template.payload->>'name' = inventory.source_id)
      )
      else 0
    end
  )
from gcac_0045_retirement_inventory inventory
on conflict do nothing;

-- 统一保留 InputBindingsV1 的四个业务分区，清除历史平行字段可能残留的顶层数据。
with candidates as (
  select binding.id,
         jsonb_build_object(
           'apiVersion', 'gcac.input-bindings/v1',
           'variables', coalesce(case when jsonb_typeof(binding.input_bindings->'variables') = 'object' then binding.input_bindings->'variables' end, '{}'::jsonb),
           'connections', coalesce(case when jsonb_typeof(binding.input_bindings->'connections') = 'object' then binding.input_bindings->'connections' end, '{}'::jsonb),
           'credentials', coalesce(case when jsonb_typeof(binding.input_bindings->'credentials') = 'object' then binding.input_bindings->'credentials' end, '{}'::jsonb),
           'artifacts', coalesce(case when jsonb_typeof(binding.input_bindings->'artifacts') = 'object' then binding.input_bindings->'artifacts' end, '{}'::jsonb)
         ) normalized
  from unified_plugin_bindings binding
), repaired as (
  update unified_plugin_bindings binding
  set input_bindings = candidates.normalized,
      version = binding.version + 1,
      updated_at = now()
  from candidates
  where binding.id = candidates.id
    and binding.input_bindings is distinct from candidates.normalized
  returning binding.id
), summary as (
  select count(*)::integer updated_row_count from repaired
)
insert into database_forward_cleanup_audits (
  audit_id, migration_version, source_table, source_namespace, source_id,
  cleanup_action, reason, metadata
)
select
  'P1-F-DB-20260811-INP-001',
  '20260811000100',
  'unified_plugin_bindings',
  '',
  'input-bindings-v1-normalization',
  'UPDATE',
  'NORMALIZE_INPUT_BINDINGS_V1',
  jsonb_build_object(
    'schemaVersion', 'gcac.input-bindings/v1',
    'updatedRowCount', summary.updated_row_count,
    'preservedFields', jsonb_build_array('variables', 'connections', 'credentials', 'artifacts')
  )
from summary
on conflict do nothing;

with candidates as (
  select binding.id,
         jsonb_build_object(
           'apiVersion', 'gcac.input-bindings/v1',
           'variables', coalesce(case when jsonb_typeof(binding.input_bindings->'variables') = 'object' then binding.input_bindings->'variables' end, '{}'::jsonb),
           'connections', coalesce(case when jsonb_typeof(binding.input_bindings->'connections') = 'object' then binding.input_bindings->'connections' end, '{}'::jsonb),
           'credentials', coalesce(case when jsonb_typeof(binding.input_bindings->'credentials') = 'object' then binding.input_bindings->'credentials' end, '{}'::jsonb),
           'artifacts', coalesce(case when jsonb_typeof(binding.input_bindings->'artifacts') = 'object' then binding.input_bindings->'artifacts' end, '{}'::jsonb)
         ) normalized
  from workflow_execution_bindings binding
), repaired as (
  update workflow_execution_bindings binding
  set input_bindings = candidates.normalized,
      version = binding.version + 1,
      updated_at = now()
  from candidates
  where binding.id = candidates.id
    and binding.input_bindings is distinct from candidates.normalized
  returning binding.id
), summary as (
  select count(*)::integer updated_row_count from repaired
)
insert into database_forward_cleanup_audits (
  audit_id, migration_version, source_table, source_namespace, source_id,
  cleanup_action, reason, metadata
)
select
  'P1-F-DB-20260811-INP-002',
  '20260811000100',
  'workflow_execution_bindings',
  '',
  'input-bindings-v1-normalization',
  'UPDATE',
  'NORMALIZE_INPUT_BINDINGS_V1',
  jsonb_build_object(
    'schemaVersion', 'gcac.input-bindings/v1',
    'updatedRowCount', summary.updated_row_count,
    'preservedFields', jsonb_build_array('variables', 'connections', 'credentials', 'artifacts')
  )
from summary
on conflict do nothing;

-- 资源清退先处理精确路径，再关闭受影响的版本和绑定，避免旧资源继续成为运行时来源。
delete from unified_plugin_resources resource
using gcac_0045_retirement_inventory inventory
where inventory.resource_path is not null
  and resource.resource_path = inventory.resource_path;

delete from plugin_runner_version_bindings binding
using gcac_0045_retired_plugin_versions retired
where retired.plugin_version_id = binding.plugin_version_id;

delete from unified_plugin_workflow_bindings binding
using gcac_0045_retired_plugin_versions retired
where retired.plugin_version_id = binding.plugin_version_id;

update unified_plugin_bindings binding
set status = 'DISABLED',
    version = binding.version + 1,
    updated_at = now()
from gcac_0045_retired_plugin_versions retired
where retired.plugin_version_id = binding.plugin_version_id
  and binding.status <> 'DISABLED';

update plugin_capability_assignments assignment
set status = 'DISABLED',
    updated_at = now()
from gcac_0045_retired_plugin_versions retired
where retired.plugin_version_id = assignment.plugin_version_id
  and assignment.status <> 'DISABLED';

update unified_plugin_versions plugin_version
set status = 'RETIRED',
    validation_report = jsonb_set(
      case
        when jsonb_typeof(plugin_version.validation_report) = 'object' then plugin_version.validation_report
        else jsonb_build_object('originalValidationReport', plugin_version.validation_report)
      end,
      '{pluginRunnerCleanup}',
      jsonb_build_object(
        'status', 'RETIRED',
        'reason', 'REMOVED_EXPLICIT_LEGACY_RESOURCE',
        'migrationVersion', '20260811000100'
      ),
      true
    ),
    updated_at = now()
from gcac_0045_retired_plugin_versions retired
where retired.plugin_version_id = plugin_version.id
  and plugin_version.status <> 'RETIRED';

create temporary table gcac_0045_bare_workflow_template_ids (
  workflow_template_id varchar(512) not null primary key
) on commit drop;

insert into gcac_0045_bare_workflow_template_ids (workflow_template_id)
select template.document_id
from pg_documents template
where template.namespace = 'workflow.templates'
  and exists (
    select 1
    from gcac_0045_retirement_inventory inventory
    where inventory.kind = 'BARE_WORKFLOW'
      and (template.document_id = inventory.source_id or template.payload->>'name' = inventory.source_id)
  )
on conflict do nothing;

insert into gcac_0045_bare_workflow_template_ids (workflow_template_id)
select inventory.source_id
from gcac_0045_retirement_inventory inventory
where inventory.kind = 'BARE_WORKFLOW'
on conflict do nothing;

create temporary table gcac_0045_bare_workflow_version_ids (
  workflow_version_id varchar(512) not null primary key
) on commit drop;

insert into gcac_0045_bare_workflow_version_ids (workflow_version_id)
select version.document_id
from pg_documents version
where version.namespace = 'workflow.template_versions'
  and (
    version.payload->>'templateId' in (select workflow_template_id from gcac_0045_bare_workflow_template_ids)
    or exists (
      select 1
      from pg_documents template
      where template.namespace = 'workflow.templates'
        and template.document_id = version.payload->>'templateId'
        and template.document_id in (select workflow_template_id from gcac_0045_bare_workflow_template_ids)
    )
  )
on conflict do nothing;

delete from unified_plugin_workflow_bindings binding
where binding.workflow_template_id in (select workflow_template_id from gcac_0045_bare_workflow_template_ids)
   or binding.workflow_version_id in (select workflow_version_id from gcac_0045_bare_workflow_version_ids);

delete from workflow_execution_bindings binding
where binding.workflow_template_id in (select workflow_template_id from gcac_0045_bare_workflow_template_ids)
   or binding.workflow_version_id in (select workflow_version_id from gcac_0045_bare_workflow_version_ids);

delete from browser_credential_sessions session
where session.workflow_template_id in (select workflow_template_id from gcac_0045_bare_workflow_template_ids)
   or session.workflow_version_id in (select workflow_version_id from gcac_0045_bare_workflow_version_ids);

delete from plugin_workflow_ledgers ledger
where ledger.workflow_version_id in (select workflow_version_id from gcac_0045_bare_workflow_version_ids);

delete from pg_documents version
where version.namespace = 'workflow.template_versions'
  and version.document_id in (select workflow_version_id from gcac_0045_bare_workflow_version_ids);

delete from pg_documents template
where template.namespace = 'workflow.templates'
  and template.document_id in (select workflow_template_id from gcac_0045_bare_workflow_template_ids);
