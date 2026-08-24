-- 发布前彻底清理旧 Provider 运行时数据。
-- 20260809000700 已经把旧 CA Provider 的执行身份清空，但仍保留了退休行；
-- 本迁移继续删除这些旧记录，并删除最后遗留的旧 Provider 账本和 ACME 字段。
-- 迁移执行器已经为每个文件包裹事务，本文件不自行 BEGIN/COMMIT。

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

create temporary table if not exists gcac_legacy_provider_ids (
  provider_id text primary key
) on commit drop;

create temporary table if not exists gcac_legacy_ca_ids (
  ca_id text primary key
) on commit drop;

create temporary table if not exists gcac_legacy_ca_node_ids (
  node_id text primary key
) on commit drop;

create temporary table if not exists gcac_legacy_ca_request_ids (
  request_id text primary key
) on commit drop;

truncate gcac_legacy_provider_ids;
truncate gcac_legacy_ca_ids;
truncate gcac_legacy_ca_node_ids;
truncate gcac_legacy_ca_request_ids;

-- 007 迁移已经记录了被识别的旧 Provider。读取审计记录可以覆盖“旧字符串只存在
-- 于 endpoint/credential”这一类已经被 007 脱敏、当前行中不再可搜索的情况。
insert into gcac_legacy_provider_ids (provider_id)
select audit.source_id
from database_forward_cleanup_audits audit
where audit.migration_version = '20260809000700'
  and audit.source_table = 'pg_ca_providers'
  and audit.cleanup_action = 'UPDATE'
  and audit.reason = 'RETIRED_LEGACY_CA_PROVIDER'
on conflict do nothing;

do $$
begin
  if to_regclass('public.pg_ca_providers') is not null then
    execute $sql$
      insert into gcac_legacy_provider_ids (provider_id)
      select provider.id
      from pg_ca_providers provider
      where lower(concat_ws('|', provider.id, provider.name, provider.type,
          provider.deployment_mode, provider.runtime_platform, provider.availability_mode,
          provider.endpoint, provider.credential_secret_ref, provider.capabilities::text,
          provider.payload::text)) like any (array[
        '%acme%', '%adcs%', '%microsoft-adcs%', '%microsoft_adcs%', '%openssl%'
      ])
      on conflict do nothing
    $sql$;
  end if;
end
$$;

-- 收集可能在 007 之前没有正确关联 Provider 的 CA 父子记录，避免删除 Provider 时
-- 被残留外键阻断，也避免把孤立的厂商记录留在通用 CA 表中。
do $$
begin
  if to_regclass('public.pg_certificate_authorities') is not null then
    execute $sql$
      insert into gcac_legacy_ca_ids (ca_id)
      select authority.id
      from pg_certificate_authorities authority
      where authority.provider_id in (select provider_id from gcac_legacy_provider_ids)
         or lower(concat_ws('|', authority.id, authority.name, authority.role,
             authority.topology_mode, authority.security_domain, authority.payload::text)) like any (array[
           '%acme%', '%adcs%', '%microsoft-adcs%', '%microsoft_adcs%', '%openssl%'
         ])
      on conflict do nothing
    $sql$;
  end if;

  if to_regclass('public.pg_ca_nodes') is not null then
    execute $sql$
      insert into gcac_legacy_ca_node_ids (node_id)
      select node.id
      from pg_ca_nodes node
      where node.provider_id in (select provider_id from gcac_legacy_provider_ids)
         or lower(concat_ws('|', node.id, node.name, node.platform, node.role,
             node.identity_fingerprint, node.key_backend, node.capabilities::text,
             node.payload::text)) like any (array[
           '%acme%', '%adcs%', '%microsoft-adcs%', '%microsoft_adcs%', '%openssl%'
         ])
      on conflict do nothing
    $sql$;
  end if;

  if to_regclass('public.pg_certificate_requests') is not null then
    execute $sql$
      insert into gcac_legacy_ca_request_ids (request_id)
      select request.id
      from pg_certificate_requests request
      where request.ca_id in (select ca_id from gcac_legacy_ca_ids)
         or lower(concat_ws('|', request.id, request.provider_request_id,
             request.failure_code, request.failure_message, request.payload::text)) like any (array[
           '%acme%', '%adcs%', '%microsoft-adcs%', '%microsoft_adcs%', '%openssl%'
         ])
      on conflict do nothing
    $sql$;
  end if;
end
$$;

-- 旧 Provider 操作账本属于宿主厂商 Workflow 的状态，不是通用 Cloud Account
-- 数据。先留下可追溯审计，再删除整张历史表；Cloud Account 表本身保留。
do $$
begin
  if to_regclass('public.pg_provider_operation_ledger') is not null then
    execute $sql$
      insert into database_forward_cleanup_audits (
        migration_version, source_table, source_id, cleanup_action, reason, metadata
      )
      select
        '20260809000800', 'pg_provider_operation_ledger', ledger.id, 'DELETE',
        'REMOVED_LEGACY_PROVIDER_OPERATION_LEDGER',
        jsonb_build_object(
          'providerKey', ledger.provider_key,
          'frameworkType', ledger.framework_type,
          'operationKey', ledger.operation_key,
          'cloudAccountAssetId', ledger.cloud_account_asset_id
        )
      from pg_provider_operation_ledger ledger
      on conflict do nothing
    $sql$;
  end if;
end
$$;

drop table if exists pg_provider_operation_ledger;

-- 先清理所有已收集的子记录，再删除旧 CA 和 Provider 记录。每个表都做存在性判断，
-- 这样数据库如果在历史版本中没有创建某个可选运行表，迁移仍然可以安全完成。
do $$
begin
  if to_regclass('public.pg_ca_node_request_nonces') is not null then
    execute 'delete from pg_ca_node_request_nonces where node_id in (select node_id from gcac_legacy_ca_node_ids)';
  end if;
  if to_regclass('public.pg_ca_capability_records') is not null then
    execute $sql$
      delete from pg_ca_capability_records
      where (owner_type = 'provider' and owner_id in (select provider_id from gcac_legacy_provider_ids))
         or (owner_type = 'node' and owner_id in (select node_id from gcac_legacy_ca_node_ids))
    $sql$;
  end if;
  if to_regclass('public.pg_ca_node_tasks') is not null then
    execute $sql$
      delete from pg_ca_node_tasks
      where provider_id in (select provider_id from gcac_legacy_provider_ids)
         or node_id in (select node_id from gcac_legacy_ca_node_ids)
    $sql$;
  end if;
  if to_regclass('public.pg_ca_node_enrollment_tokens') is not null then
    execute 'delete from pg_ca_node_enrollment_tokens where provider_id in (select provider_id from gcac_legacy_provider_ids)';
  end if;
  if to_regclass('public.pg_ca_external_observations') is not null then
    execute $sql$
      delete from pg_ca_external_observations
      where provider_id in (select provider_id from gcac_legacy_provider_ids)
         or ca_id in (select ca_id from gcac_legacy_ca_ids)
    $sql$;
  end if;
  if to_regclass('public.pg_ca_sync_runs') is not null then
    execute $sql$
      delete from pg_ca_sync_runs
      where provider_id in (select provider_id from gcac_legacy_provider_ids)
         or ca_id in (select ca_id from gcac_legacy_ca_ids)
    $sql$;
  end if;
  if to_regclass('public.pg_ca_template_mappings') is not null then
    execute $sql$
      delete from pg_ca_template_mappings
      where provider_id in (select provider_id from gcac_legacy_provider_ids)
         or ca_id in (select ca_id from gcac_legacy_ca_ids)
    $sql$;
  end if;
  if to_regclass('public.pg_ca_issuance_records') is not null then
    execute 'delete from pg_ca_issuance_records where ca_id in (select ca_id from gcac_legacy_ca_ids)';
  end if;
  if to_regclass('public.pg_ca_serial_states') is not null then
    execute 'delete from pg_ca_serial_states where ca_id in (select ca_id from gcac_legacy_ca_ids)';
  end if;
  if to_regclass('public.pg_certificate_issuances') is not null then
    execute $sql$
      delete from pg_certificate_issuances
      where provider_id in (select provider_id from gcac_legacy_provider_ids)
         or certificate_request_id in (select request_id from gcac_legacy_ca_request_ids)
    $sql$;
  end if;
  if to_regclass('public.pg_certificate_revocations') is not null then
    execute 'delete from pg_certificate_revocations where ca_id in (select ca_id from gcac_legacy_ca_ids)';
  end if;
  if to_regclass('public.pg_trust_distributions') is not null then
    execute 'delete from pg_trust_distributions where ca_id in (select ca_id from gcac_legacy_ca_ids)';
  end if;
  if to_regclass('public.pg_certificate_versions') is not null then
    execute $sql$
      update pg_certificate_versions
      set issuing_ca_id = null
      where issuing_ca_id in (select ca_id from gcac_legacy_ca_ids)
    $sql$;
    execute $sql$
      update pg_certificate_versions
      set certificate_request_id = null
      where certificate_request_id in (select request_id from gcac_legacy_ca_request_ids)
    $sql$;
  end if;
  if to_regclass('public.pg_certificate_requests') is not null then
    execute 'delete from pg_certificate_requests where id in (select request_id from gcac_legacy_ca_request_ids)';
  end if;
  if to_regclass('public.pg_certificate_authorities') is not null then
    execute 'update pg_certificate_authorities set parent_ca_id = null where parent_ca_id in (select ca_id from gcac_legacy_ca_ids)';
    execute 'delete from pg_certificate_authorities where id in (select ca_id from gcac_legacy_ca_ids)';
  end if;
  if to_regclass('public.pg_ca_nodes') is not null then
    execute 'delete from pg_ca_nodes where id in (select node_id from gcac_legacy_ca_node_ids)';
  end if;
  if to_regclass('public.pg_ca_providers') is not null then
    execute $sql$
      insert into database_forward_cleanup_audits (
        migration_version, source_table, source_id, cleanup_action, reason, metadata
      )
      select
        '20260809000800', 'pg_ca_providers', provider.id, 'DELETE',
        'REMOVED_LEGACY_CA_PROVIDER_RECORD',
        jsonb_build_object('name', provider.name, 'type', provider.type, 'status', provider.status)
      from pg_ca_providers provider
      where provider.id in (select provider_id from gcac_legacy_provider_ids)
      on conflict do nothing
    $sql$;
    execute 'delete from pg_ca_providers where id in (select provider_id from gcac_legacy_provider_ids)';
  end if;
end
$$;

-- ACME 为首次申请临时放宽了 RenewalJob 的约束；旧流程已经删除，空版本任务
-- 也是旧数据，删除后恢复通用 RenewalJob 的原始非空合同。
do $$
begin
  if to_regclass('public.pg_certificate_renewal_jobs') is not null then
    execute $sql$
      insert into database_forward_cleanup_audits (
        migration_version, source_table, source_id, cleanup_action, reason, metadata
      )
      select
        '20260809000800', 'pg_certificate_renewal_jobs', job.id, 'DELETE',
        'REMOVED_LEGACY_ACME_RENEWAL_JOB',
        jsonb_build_object('renewalWindowKey', job.renewal_window_key, 'status', job.status)
      from pg_certificate_renewal_jobs job
      where job.certificate_version_id is null
      on conflict do nothing
    $sql$;
    execute 'delete from pg_certificate_renewal_jobs where certificate_version_id is null';
  end if;
end
$$;

alter table if exists pg_certificate_renewal_jobs
  alter column certificate_version_id set not null;

-- 删除 ACME 专用列及其索引。DROP COLUMN 会处理列依赖，但显式删除索引让历史
-- 数据库中名称尚存的旧索引也不会留下错误的结构信号。
drop index if exists idx_pg_certificate_renewal_jobs_lease;
drop index if exists uq_pg_certificate_renewal_jobs_acme_active;
drop index if exists uq_pg_certificate_renewal_jobs_acme_initial;
drop index if exists idx_pg_certificate_versions_activation;

alter table if exists pg_certificate_versions
  drop column if exists activation_state;
