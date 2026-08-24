-- 云 Provider 从未具备已验收的证书部署能力。
-- 仅退役历史云端证书执行引用，保留 CloudAccountAsset、发现出的 Framework/Site 和普通 DSL WorkflowVersion。

create temporary table gcac_retired_cloud_certificate_workflow_bindings (
  plugin_version_id varchar(128) not null,
  capability_key varchar(192) not null,
  workflow_key varchar(192) not null,
  workflow_template_id varchar(128) not null,
  workflow_version_id varchar(128) not null,
  primary key (plugin_version_id, capability_key, workflow_key)
) on commit drop;

create temporary table gcac_retired_cloud_certificate_assignments (
  id varchar(128) primary key,
  tenant_id varchar(128) not null,
  owner_id varchar(128) not null,
  capability_key varchar(192) not null,
  plugin_version_id varchar(128) not null,
  plugin_binding_id varchar(128) not null
) on commit drop;

create temporary table gcac_retired_cloud_certificate_targets (
  id text primary key,
  tenant_id text not null,
  cloud_account_asset_id text not null,
  provider_key text not null
) on commit drop;

insert into gcac_retired_cloud_certificate_workflow_bindings (
  plugin_version_id, capability_key, workflow_key, workflow_template_id, workflow_version_id
)
select
  binding.plugin_version_id,
  binding.capability_key,
  binding.workflow_key,
  binding.workflow_template_id,
  binding.workflow_version_id
from unified_plugin_workflow_bindings binding
join unified_plugin_versions version
  on version.id = binding.plugin_version_id
where version.plugin_id like 'cloud.%'
  and binding.capability_key in ('certificate.deploy', 'certificate.verify', 'certificate.rollback');

insert into gcac_retired_cloud_certificate_assignments (
  id, tenant_id, owner_id, capability_key, plugin_version_id, plugin_binding_id
)
select
  assignment.id,
  assignment.tenant_id,
  assignment.owner_id,
  assignment.capability_key,
  assignment.plugin_version_id,
  assignment.plugin_binding_id
from plugin_capability_assignments assignment
where assignment.owner_type = 'CLOUD_ACCOUNT_ASSET'
  and assignment.status <> 'DISABLED'
  and assignment.capability_key in ('certificate.deploy', 'certificate.verify', 'certificate.rollback');

insert into gcac_retired_cloud_certificate_targets (
  id, tenant_id, cloud_account_asset_id, provider_key
)
select
  target.id,
  target.tenant_id,
  account.id,
  account.provider_key
from pg_managed_targets target
join pg_cloud_account_assets account
  on account.id = target.asset_id
 and account.tenant_id = target.tenant_id
 and account.deleted_at is null
where target.deleted_at is null
  and (
    target.status <> 'DISABLED'
    or coalesce(target.metadata->>'disabledReason', '') <> 'RETIRED_UNIMPLEMENTED_CLOUD_CERTIFICATE_EXECUTION'
  );

insert into database_forward_cleanup_audits (
  audit_id, migration_version, source_table, source_namespace, source_id,
  cleanup_action, reason, metadata
)
select
  'P2-F-DB-20260817-CCA-' || md5(assignment.id),
  '20260817001000',
  'plugin_capability_assignments',
  '',
  assignment.id,
  'UPDATE',
  'RETIRED_UNIMPLEMENTED_CLOUD_CERTIFICATE_EXECUTION',
  jsonb_build_object(
    'tenantId', assignment.tenant_id,
    'cloudAccountAssetId', assignment.owner_id,
    'capabilityKey', assignment.capability_key,
    'pluginVersionId', assignment.plugin_version_id,
    'pluginBindingId', assignment.plugin_binding_id
  )
from gcac_retired_cloud_certificate_assignments assignment
on conflict do nothing;

update plugin_capability_assignments assignment
set status = 'DISABLED',
    updated_at = now()
from gcac_retired_cloud_certificate_assignments retired
where retired.id = assignment.id;

insert into database_forward_cleanup_audits (
  audit_id, migration_version, source_table, source_namespace, source_id,
  cleanup_action, reason, metadata
)
select
  'P2-F-DB-20260817-CCT-' || md5(target.id),
  '20260817001000',
  'pg_managed_targets',
  '',
  target.id,
  'UPDATE',
  'RETIRED_UNIMPLEMENTED_CLOUD_CERTIFICATE_EXECUTION',
  jsonb_build_object(
    'tenantId', target.tenant_id,
    'cloudAccountAssetId', target.cloud_account_asset_id,
    'providerKey', target.provider_key,
    'deployable', false
  )
from gcac_retired_cloud_certificate_targets target
on conflict do nothing;

update pg_managed_targets target
set status = 'DISABLED',
    metadata = coalesce(target.metadata, '{}'::jsonb) || jsonb_build_object(
      'deployable', false,
      'disabledReason', 'RETIRED_UNIMPLEMENTED_CLOUD_CERTIFICATE_EXECUTION'
    ),
    updated_at = now(),
    version = target.version + 1
from gcac_retired_cloud_certificate_targets retired
where retired.id = target.id;

insert into database_forward_cleanup_audits (
  audit_id, migration_version, source_table, source_namespace, source_id,
  cleanup_action, reason, metadata
)
select
  'P2-F-DB-20260817-CWB-' || md5(binding.plugin_version_id || ':' || binding.capability_key || ':' || binding.workflow_key),
  '20260817001000',
  'unified_plugin_workflow_bindings',
  '',
  binding.plugin_version_id || ':' || binding.capability_key || ':' || binding.workflow_key,
  'DELETE',
  'RETIRED_UNIMPLEMENTED_CLOUD_CERTIFICATE_EXECUTION',
  jsonb_build_object(
    'pluginVersionId', binding.plugin_version_id,
    'capabilityKey', binding.capability_key,
    'workflowKey', binding.workflow_key,
    'workflowTemplateId', binding.workflow_template_id,
    'workflowVersionId', binding.workflow_version_id
  )
from gcac_retired_cloud_certificate_workflow_bindings binding
on conflict do nothing;

insert into database_forward_cleanup_audits (
  audit_id, migration_version, source_table, source_namespace, source_id,
  cleanup_action, reason, metadata
)
select
  'P2-F-DB-20260817-CWE-' || md5(execution.id),
  '20260817001000',
  'workflow_execution_bindings',
  '',
  execution.id,
  'DELETE',
  'RETIRED_UNIMPLEMENTED_CLOUD_CERTIFICATE_EXECUTION',
  jsonb_build_object(
    'pluginVersionId', execution.plugin_version_id,
    'capabilityKey', execution.capability_key,
    'workflowKey', execution.workflow_key,
    'workflowTemplateId', execution.workflow_template_id,
    'workflowVersionId', execution.workflow_version_id
  )
from workflow_execution_bindings execution
join gcac_retired_cloud_certificate_workflow_bindings binding
  on binding.plugin_version_id = execution.plugin_version_id
 and binding.capability_key = execution.capability_key
 and binding.workflow_key = execution.workflow_key
on conflict do nothing;

delete from workflow_execution_bindings execution
using gcac_retired_cloud_certificate_workflow_bindings binding
where binding.plugin_version_id = execution.plugin_version_id
  and binding.capability_key = execution.capability_key
  and binding.workflow_key = execution.workflow_key;

insert into database_forward_cleanup_audits (
  audit_id, migration_version, source_table, source_namespace, source_id,
  cleanup_action, reason, metadata
)
select
  'P2-F-DB-20260817-CBS-' || md5(session.id),
  '20260817001000',
  'browser_credential_sessions',
  '',
  session.id,
  'DELETE',
  'RETIRED_UNIMPLEMENTED_CLOUD_CERTIFICATE_EXECUTION',
  jsonb_build_object(
    'pluginVersionId', session.plugin_version_id,
    'capabilityKey', session.capability_key,
    'workflowTemplateId', session.workflow_template_id,
    'workflowVersionId', session.workflow_version_id
  )
from browser_credential_sessions session
join gcac_retired_cloud_certificate_workflow_bindings binding
  on binding.plugin_version_id = session.plugin_version_id
 and binding.capability_key = session.capability_key
 and binding.workflow_template_id = session.workflow_template_id
 and binding.workflow_version_id = session.workflow_version_id
on conflict do nothing;

delete from browser_credential_sessions session
using gcac_retired_cloud_certificate_workflow_bindings binding
where binding.plugin_version_id = session.plugin_version_id
  and binding.capability_key = session.capability_key
  and binding.workflow_template_id = session.workflow_template_id
  and binding.workflow_version_id = session.workflow_version_id;

insert into database_forward_cleanup_audits (
  audit_id, migration_version, source_table, source_namespace, source_id,
  cleanup_action, reason, metadata
)
select
  'P2-F-DB-20260817-CWL-' || md5(ledger.id),
  '20260817001000',
  'plugin_workflow_ledgers',
  '',
  ledger.id,
  'DELETE',
  'RETIRED_UNIMPLEMENTED_CLOUD_CERTIFICATE_EXECUTION',
  jsonb_build_object(
    'pluginVersionId', ledger.plugin_version_id,
    'capabilityKey', ledger.capability_key,
    'workflowVersionId', ledger.workflow_version_id
  )
from plugin_workflow_ledgers ledger
join gcac_retired_cloud_certificate_workflow_bindings binding
  on binding.plugin_version_id = ledger.plugin_version_id
 and binding.capability_key = ledger.capability_key
 and binding.workflow_version_id = ledger.workflow_version_id
on conflict do nothing;

delete from plugin_workflow_ledgers ledger
using gcac_retired_cloud_certificate_workflow_bindings binding
where binding.plugin_version_id = ledger.plugin_version_id
  and binding.capability_key = ledger.capability_key
  and binding.workflow_version_id = ledger.workflow_version_id;

delete from unified_plugin_workflow_bindings binding
using gcac_retired_cloud_certificate_workflow_bindings retired
where retired.plugin_version_id = binding.plugin_version_id
  and retired.capability_key = binding.capability_key
  and retired.workflow_key = binding.workflow_key;
