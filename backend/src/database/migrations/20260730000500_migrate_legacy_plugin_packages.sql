-- 旧插件协议与 Unified Plugin 协议的 Runtime/能力模型并不等价。
-- 本迁移只建立可证明的一对一关系；无法精确匹配的对象保持禁用并进入人工重导清单。
create table if not exists legacy_plugin_migration_results (
  source_kind varchar(32) not null check (source_kind in ('DOCUMENT_PACKAGE', 'RELATIONAL_PACKAGE', 'CATALOG_ACTIVATION', 'EXECUTION_AUDIT')),
  source_id varchar(192) not null,
  tenant_id varchar(128) not null,
  legacy_plugin_id varchar(192) not null,
  legacy_version varchar(64),
  unified_plugin_version_id varchar(128) references unified_plugin_versions(id) on delete restrict,
  result varchar(32) not null check (result in ('MAPPED', 'MANUAL_REIMPORT_REQUIRED')),
  reason varchar(128) not null,
  source_status varchar(64),
  created_at timestamptz not null default now(),
  primary key (source_kind, source_id)
);

create index if not exists idx_legacy_plugin_migration_results_tenant
  on legacy_plugin_migration_results (tenant_id, result, legacy_plugin_id);

with document_packages as (
  select
    document_id as source_id,
    coalesce(nullif(payload->>'tenantId', ''), 'default') as tenant_id,
    coalesce(nullif(payload#>>'{manifest,pluginId}', ''), nullif(payload#>>'{manifest,name}', ''), document_id) as legacy_plugin_id,
    nullif(payload#>>'{manifest,version}', '') as legacy_version,
    nullif(payload->>'installStatus', '') as source_status
  from pg_documents
  where namespace = 'plugins:packages'
), matched as (
  select source.*, version.id as unified_plugin_version_id
  from document_packages source
  left join unified_plugin_versions version
    on version.tenant_id = source.tenant_id
   and version.plugin_id = source.legacy_plugin_id
   and version.plugin_version = source.legacy_version
)
insert into legacy_plugin_migration_results (
  source_kind, source_id, tenant_id, legacy_plugin_id, legacy_version,
  unified_plugin_version_id, result, reason, source_status
)
select
  'DOCUMENT_PACKAGE', source_id, tenant_id, legacy_plugin_id, legacy_version,
  unified_plugin_version_id,
  case when unified_plugin_version_id is null then 'MANUAL_REIMPORT_REQUIRED' else 'MAPPED' end,
  case when legacy_version is null then 'LEGACY_VERSION_MISSING'
       when unified_plugin_version_id is null then 'UNIFIED_VERSION_NOT_FOUND'
       else 'EXACT_IDENTITY_MATCH' end,
  source_status
from matched
on conflict (source_kind, source_id) do nothing;

with execution_audits as (
  select
    execution.document_id as source_id,
    coalesce(nullif(package.payload->>'tenantId', ''), 'default') as tenant_id,
    coalesce(
      nullif(package.payload#>>'{manifest,pluginId}', ''),
      nullif(package.payload#>>'{manifest,name}', ''),
      nullif(execution.payload->>'pluginPackageId', ''),
      execution.document_id
    ) as legacy_plugin_id,
    nullif(package.payload#>>'{manifest,version}', '') as legacy_version,
    nullif(execution.payload->>'status', '') as source_status,
    package.document_id as package_source_id
  from pg_documents execution
  left join pg_documents package
    on package.namespace = 'plugins:packages'
   and package.document_id = execution.payload->>'pluginPackageId'
  where execution.namespace = 'plugins:executions'
), matched as (
  select source.*, package_result.unified_plugin_version_id
  from execution_audits source
  left join legacy_plugin_migration_results package_result
    on package_result.source_kind = 'DOCUMENT_PACKAGE'
   and package_result.source_id = source.package_source_id
)
insert into legacy_plugin_migration_results (
  source_kind, source_id, tenant_id, legacy_plugin_id, legacy_version,
  unified_plugin_version_id, result, reason, source_status
)
select
  'EXECUTION_AUDIT', source_id, tenant_id, legacy_plugin_id, legacy_version,
  unified_plugin_version_id,
  case when unified_plugin_version_id is null then 'MANUAL_REIMPORT_REQUIRED' else 'MAPPED' end,
  case when package_source_id is null then 'LEGACY_PACKAGE_NOT_FOUND'
       when unified_plugin_version_id is null then 'UNIFIED_VERSION_NOT_FOUND'
       else 'PACKAGE_IDENTITY_MATCH' end,
  source_status
from matched
on conflict (source_kind, source_id) do nothing;

with relational_packages as (
  select
    package.id::text as source_id,
    coalesce(package.tenant_id::text, 'default') as tenant_id,
    package.name as legacy_plugin_id,
    package.plugin_version as legacy_version,
    package.status as source_status
  from plugin_packages package
  where package.deleted_at is null
), matched as (
  select source.*, version.id as unified_plugin_version_id
  from relational_packages source
  left join unified_plugin_versions version
    on version.tenant_id = source.tenant_id
   and version.plugin_id = source.legacy_plugin_id
   and version.plugin_version = source.legacy_version
)
insert into legacy_plugin_migration_results (
  source_kind, source_id, tenant_id, legacy_plugin_id, legacy_version,
  unified_plugin_version_id, result, reason, source_status
)
select
  'RELATIONAL_PACKAGE', source_id, tenant_id, legacy_plugin_id, legacy_version,
  unified_plugin_version_id,
  case when unified_plugin_version_id is null then 'MANUAL_REIMPORT_REQUIRED' else 'MAPPED' end,
  case when unified_plugin_version_id is null then 'UNIFIED_VERSION_NOT_FOUND' else 'EXACT_IDENTITY_MATCH' end,
  source_status
from matched
on conflict (source_kind, source_id) do nothing;

with activations as (
  select
    document_id as source_id,
    coalesce(nullif(payload->>'tenantId', ''), 'default') as tenant_id,
    coalesce(nullif(payload->>'pluginId', ''), document_id) as legacy_plugin_id,
    nullif(payload->>'status', '') as source_status
  from pg_documents
  where namespace = 'plugins:catalog-activations'
), matched as (
  select source.*, candidate.id as unified_plugin_version_id, candidate.plugin_version as legacy_version
  from activations source
  left join lateral (
    select version.id, version.plugin_version
    from unified_plugin_versions version
    where version.tenant_id = source.tenant_id
      and version.plugin_id = source.legacy_plugin_id
    order by version.created_at desc, version.id desc
    limit 1
  ) candidate on true
)
insert into legacy_plugin_migration_results (
  source_kind, source_id, tenant_id, legacy_plugin_id, legacy_version,
  unified_plugin_version_id, result, reason, source_status
)
select
  'CATALOG_ACTIVATION', source_id, tenant_id, legacy_plugin_id, legacy_version,
  unified_plugin_version_id,
  case when unified_plugin_version_id is null then 'MANUAL_REIMPORT_REQUIRED' else 'MAPPED' end,
  case when unified_plugin_version_id is null then 'UNIFIED_VERSION_NOT_FOUND' else 'LATEST_UNIFIED_VERSION_MATCH' end,
  source_status
from matched
on conflict (source_kind, source_id) do nothing;

-- 旧启用状态只能降级，不能绕过 Unified Plugin 的权限审批自动升级。
update unified_plugin_versions version
set status = 'DISABLED', updated_at = now()
from legacy_plugin_migration_results migration
where migration.unified_plugin_version_id = version.id
  and migration.source_status in ('disabled', 'DISABLED', 'installed_disabled')
  and version.status not in ('RETIRED', 'QUARANTINED');
