-- 发布前一次性清退 ACME、ADCS、OpenSSL 旧 CA 运行数据。
-- 迁移执行器已经为每个文件包裹事务，本文件不自行 BEGIN/COMMIT。
-- 只保留通用 CA Provider 基础行并清空旧执行身份；Cloud Account/Service 基础对象不在本迁移范围内。

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

create temporary table if not exists gcac_legacy_ca_provider_ids (
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

create temporary table if not exists gcac_legacy_task_ids (
  task_id text primary key
) on commit drop;

create temporary table if not exists gcac_legacy_document_ids (
  document_id text primary key
) on commit drop;

truncate gcac_legacy_ca_provider_ids;
truncate gcac_legacy_ca_ids;
truncate gcac_legacy_ca_node_ids;
truncate gcac_legacy_ca_request_ids;
truncate gcac_legacy_task_ids;
truncate gcac_legacy_document_ids;

-- Provider 表是通用 CA 基础表，不能删除。只按明确的旧厂商标识收集记录，避免影响其他 CA Provider。
do $$
begin
  if to_regclass('public.pg_ca_providers') is not null then
    execute $sql$
      insert into gcac_legacy_ca_provider_ids (provider_id)
      select provider.id
      from pg_ca_providers provider
      where lower(concat_ws('|', provider.id, provider.name, provider.type,
          provider.deployment_mode, provider.runtime_platform, provider.endpoint,
          provider.credential_secret_ref, provider.capabilities::text, provider.payload::text)) like any (array[
        '%acme%', '%adcs%', '%microsoft-adcs%', '%microsoft_adcs%', '%openssl%'
      ])
      on conflict do nothing
    $sql$;
  end if;
end
$$;

do $$
begin
  if to_regclass('public.pg_certificate_authorities') is not null then
    execute $sql$
      insert into gcac_legacy_ca_ids (ca_id)
      select authority.id
      from pg_certificate_authorities authority
      where authority.provider_id in (select provider_id from gcac_legacy_ca_provider_ids)
      on conflict do nothing
    $sql$;
  end if;

  if to_regclass('public.pg_ca_nodes') is not null then
    execute $sql$
      insert into gcac_legacy_ca_node_ids (node_id)
      select node.id
      from pg_ca_nodes node
      where node.provider_id in (select provider_id from gcac_legacy_ca_provider_ids)
      on conflict do nothing
    $sql$;
  end if;

  if to_regclass('public.pg_certificate_requests') is not null then
    execute $sql$
      insert into gcac_legacy_ca_request_ids (request_id)
      select request.id
      from pg_certificate_requests request
      where request.ca_id in (select ca_id from gcac_legacy_ca_ids)
      on conflict do nothing
    $sql$;
  end if;
end
$$;

do $$
begin
  if to_regclass('public.pg_ca_providers') is not null then
    execute $sql$
      insert into database_forward_cleanup_audits (
        migration_version, source_table, source_id, cleanup_action, reason, metadata
      )
      select
        '20260809000700', 'pg_ca_providers', provider.id, 'UPDATE',
        'RETIRED_LEGACY_CA_PROVIDER',
        jsonb_build_object('name', provider.name, 'type', provider.type, 'previousStatus', provider.status)
      from pg_ca_providers provider
      where provider.id in (select provider_id from gcac_legacy_ca_provider_ids)
        and (provider.status is distinct from 'retired'
          or provider.endpoint is not null
          or provider.credential_secret_ref is not null
          or provider.capabilities <> '{}'::jsonb)
      on conflict do nothing;

      update pg_ca_providers provider
      set status = 'retired',
          endpoint = null,
          credential_secret_ref = null,
          capabilities = '{}'::jsonb,
          payload = provider.payload || jsonb_build_object(
            'gcacCleanup', jsonb_build_object(
              'status', 'RETIRED',
              'reason', 'REMOVED_LEGACY_CA_PROVIDER_EXECUTION_IDENTITY'
            )
          ),
          updated_at = now()
      where provider.id in (select provider_id from gcac_legacy_ca_provider_ids);
    $sql$;
  end if;
end
$$;

-- 先删除依赖 ACME 专用表的 RenewalJob，之后才能安全删除旧字段和专用表。
do $$
begin
  if to_regclass('public.pg_certificate_renewal_jobs') is not null then
    if to_regclass('public.pg_acme_renewal_policies') is not null
       and to_regclass('public.pg_acme_orders') is not null then
      execute $sql$
        delete from pg_certificate_renewal_jobs job
        where job.policy_id in (
            select policy.id
            from pg_acme_renewal_policies policy
            where policy.provider_id in (select provider_id from gcac_legacy_ca_provider_ids)
          )
           or job.acme_order_id in (
            select acme_order.id
            from pg_acme_orders acme_order
            where acme_order.provider_id in (select provider_id from gcac_legacy_ca_provider_ids)
          )
           or job.certificate_request_id in (select request_id from gcac_legacy_ca_request_ids)
      $sql$;
    elsif to_regclass('public.pg_acme_renewal_policies') is not null then
      execute $sql$
        delete from pg_certificate_renewal_jobs job
        where job.policy_id in (
          select policy.id
          from pg_acme_renewal_policies policy
          where policy.provider_id in (select provider_id from gcac_legacy_ca_provider_ids)
        )
           or job.certificate_request_id in (select request_id from gcac_legacy_ca_request_ids)
      $sql$;
    else
      execute $sql$
        delete from pg_certificate_renewal_jobs job
        where job.certificate_request_id in (select request_id from gcac_legacy_ca_request_ids)
      $sql$;
    end if;
  end if;
end
$$;

-- 旧 ACME 专用字段先移除外键，再按子表到父表删除专用表。
alter table if exists pg_certificate_renewal_jobs
  drop column if exists policy_id,
  drop column if exists source_certificate_version_id,
  drop column if exists acme_order_id,
  drop column if exists deployment_plan_id,
  drop column if exists execution_run_id,
  drop column if exists promotion_status,
  drop column if exists attempt_count,
  drop column if exists next_attempt_at,
  drop column if exists lease_owner,
  drop column if exists lease_expires_at,
  drop column if exists failure_code,
  drop column if exists failure_message,
  drop column if exists policy_snapshot;

drop table if exists pg_acme_http01_presentations;
drop table if exists pg_acme_challenges;
drop table if exists pg_acme_authorizations;
drop table if exists pg_acme_orders;
drop table if exists pg_acme_renewal_policies;
drop table if exists pg_acme_accounts;

-- CA 节点和 CA 运营记录按外键依赖从子到父清理。
do $$
begin
  if to_regclass('public.pg_ca_node_request_nonces') is not null then
    execute 'delete from pg_ca_node_request_nonces where node_id in (select node_id from gcac_legacy_ca_node_ids)';
  end if;
  if to_regclass('public.pg_ca_capability_records') is not null then
    execute $sql$
      delete from pg_ca_capability_records
      where (owner_type = 'provider' and owner_id in (select provider_id from gcac_legacy_ca_provider_ids))
         or (owner_type = 'node' and owner_id in (select node_id from gcac_legacy_ca_node_ids))
    $sql$;
  end if;
  if to_regclass('public.pg_ca_node_tasks') is not null then
    execute 'delete from pg_ca_node_tasks where provider_id in (select provider_id from gcac_legacy_ca_provider_ids)';
  end if;
  if to_regclass('public.pg_ca_node_enrollment_tokens') is not null then
    execute 'delete from pg_ca_node_enrollment_tokens where provider_id in (select provider_id from gcac_legacy_ca_provider_ids)';
  end if;
  if to_regclass('public.pg_ca_external_observations') is not null then
    execute 'delete from pg_ca_external_observations where provider_id in (select provider_id from gcac_legacy_ca_provider_ids)';
  end if;
  if to_regclass('public.pg_ca_sync_runs') is not null then
    execute 'delete from pg_ca_sync_runs where provider_id in (select provider_id from gcac_legacy_ca_provider_ids)';
  end if;
  if to_regclass('public.pg_ca_template_mappings') is not null then
    execute 'delete from pg_ca_template_mappings where provider_id in (select provider_id from gcac_legacy_ca_provider_ids)';
  end if;
  if to_regclass('public.pg_ca_issuance_records') is not null then
    execute 'delete from pg_ca_issuance_records where ca_id in (select ca_id from gcac_legacy_ca_ids)';
  end if;
  if to_regclass('public.pg_ca_serial_states') is not null then
    execute 'delete from pg_ca_serial_states where ca_id in (select ca_id from gcac_legacy_ca_ids)';
  end if;
  if to_regclass('public.pg_certificate_issuances') is not null then
    execute 'delete from pg_certificate_issuances where provider_id in (select provider_id from gcac_legacy_ca_provider_ids)';
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
  end if;
  if to_regclass('public.pg_certificate_requests') is not null then
    if to_regclass('public.pg_certificate_versions') is not null then
      execute $sql$
        update pg_certificate_versions
        set certificate_request_id = null
        where certificate_request_id in (select request_id from gcac_legacy_ca_request_ids)
      $sql$;
    end if;
    execute 'delete from pg_certificate_requests where id in (select request_id from gcac_legacy_ca_request_ids)';
  end if;
  if to_regclass('public.pg_ca_nodes') is not null then
    execute 'delete from pg_ca_nodes where id in (select node_id from gcac_legacy_ca_node_ids)';
  end if;
  if to_regclass('public.pg_certificate_authorities') is not null then
    execute 'update pg_certificate_authorities set parent_ca_id = null where id in (select ca_id from gcac_legacy_ca_ids)';
    execute 'delete from pg_certificate_authorities where id in (select ca_id from gcac_legacy_ca_ids)';
  end if;
end
$$;

-- 清理统一任务控制面中显式绑定旧 Provider 的任务，保留 Cloud Provider/Account 任务和资产。
do $$
begin
  if to_regclass('public.task_runs') is not null then
    execute $sql$
      insert into gcac_legacy_task_ids (task_id)
      select task.id
      from task_runs task
      where task.payload->>'providerId' in (select provider_id from gcac_legacy_ca_provider_ids)
         or task.resource_summary->>'providerId' in (select provider_id from gcac_legacy_ca_provider_ids)
         or lower(concat_ws('|', task.task_type, task.trigger_source, task.payload::text, task.resource_summary::text)) like any (array[
           '%acme%', '%adcs%', '%microsoft-adcs%', '%openssl%'
         ])
      on conflict do nothing
    $sql$;

    execute $sql$
      update task_runs child
      set parent_task_id = null
      where child.parent_task_id in (select task_id from gcac_legacy_task_ids)
        and child.id not in (select task_id from gcac_legacy_task_ids)
    $sql$;
    execute 'delete from task_runs where id in (select task_id from gcac_legacy_task_ids)';
  end if;
end
$$;

-- 旧 Agent/Provider 文档任务没有稳定外键，先收集并清理日志游标，再清理任务本身。
do $$
begin
  if to_regclass('public.pg_documents') is not null then
    execute $sql$
      insert into gcac_legacy_document_ids (document_id)
      select document.document_id
      from pg_documents document
      where document.payload->>'providerId' in (select provider_id from gcac_legacy_ca_provider_ids)
         or document.payload->>'providerKey' in (select provider_id from gcac_legacy_ca_provider_ids)
         or lower(coalesce(document.namespace, '')) like any (array['%acme%', '%adcs%', '%openssl%'])
         or lower(coalesce(document.payload->>'providerType', '')) like any (array['%acme%', '%adcs%', '%openssl%'])
      on conflict do nothing
    $sql$;

    execute $sql$
      delete from pg_documents log
      where log.namespace in ('agents:taskLogs', 'agents:taskLogCursors')
        and log.payload->>'taskId' in (select document_id from gcac_legacy_document_ids)
    $sql$;
    execute $sql$
      delete from pg_documents document
      where document.document_id in (select document_id from gcac_legacy_document_ids)
         or lower(coalesce(document.namespace, '')) like any (array['%acme%', '%adcs%', '%openssl%'])
    $sql$;
  end if;

  if to_regclass('public.app_documents') is not null then
    execute $sql$
      delete from app_documents document
      where lower(coalesce(document.namespace, '')) like any (array['%acme%', '%adcs%', '%openssl%'])
         or document.payload->>'providerId' in (select provider_id from gcac_legacy_ca_provider_ids)
         or document.payload->>'providerKey' in (select provider_id from gcac_legacy_ca_provider_ids)
    $sql$;
  end if;
end
$$;

-- 旧插件 Provider Registry 已不再是当前 Provider 数据源；表不存在时保持幂等。
drop table if exists provider_registry;

-- 旧执行 Repository 自建表没有当前统一执行模型的外键，先删步骤再删运行。
drop table if exists pg_execution_steps;
drop table if exists pg_execution_runs;
