-- 恢复宿主内置 ACME 生命周期。
-- 历史插件化账本保留仅用于审计，所有未终态插件申请统一转为 UNKNOWN，禁止再由 Runner 继续执行。

-- 这些表只保留插件化期间的审计事实，不再被宿主 API、任务控制面或 Plugin Runner 消费。
-- 使用独立审计结构，避免恢复原生 ACME 时重新引入 Facade 生命周期或外键耦合。
create table if not exists pg_acme_plugin_requests (
  id text primary key,
  tenant_id text not null,
  status text not null,
  unknown_reason text,
  next_action text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create index if not exists idx_pg_acme_plugin_requests_audit
  on pg_acme_plugin_requests (tenant_id, status, updated_at desc);

create table if not exists pg_acme_plugin_operations (
  id text primary key,
  tenant_id text not null,
  request_id text,
  status text not null,
  may_be_unknown boolean not null default false,
  last_error_code text,
  last_error_message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create index if not exists idx_pg_acme_plugin_operations_audit
  on pg_acme_plugin_operations (tenant_id, request_id, status, updated_at desc);

alter table if exists pg_acme_plugin_requests
  add column if not exists unknown_reason text,
  add column if not exists next_action text;
alter table if exists pg_acme_plugin_operations
  add column if not exists may_be_unknown boolean not null default false,
  add column if not exists last_error_code text,
  add column if not exists last_error_message text;

create table if not exists pg_acme_accounts (
  id text primary key,
  tenant_id text not null,
  provider_id text not null references pg_ca_providers(id),
  directory_url_hash char(64) not null,
  account_url text,
  account_key_secret_ref text not null,
  contact jsonb not null default '[]'::jsonb,
  eab_key_id_secret_ref text,
  eab_hmac_secret_ref text,
  status text not null,
  last_error_code text,
  last_error_message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create unique index if not exists uq_pg_acme_accounts_directory_key on pg_acme_accounts (tenant_id, provider_id, directory_url_hash, account_key_secret_ref);
create index if not exists idx_pg_acme_accounts_status on pg_acme_accounts (tenant_id, provider_id, status, updated_at desc);

create table if not exists pg_acme_orders (
  id text primary key,
  tenant_id text not null,
  provider_id text not null references pg_ca_providers(id),
  account_id text not null references pg_acme_accounts(id),
  certificate_request_id text not null references pg_certificate_requests(id),
  external_order_url text not null,
  status text not null,
  identifiers jsonb not null default '[]'::jsonb,
  authorization_urls jsonb not null default '[]'::jsonb,
  finalize_url text,
  certificate_url text,
  csr_sha256 char(64),
  retry_after_at timestamptz,
  attempt_count integer not null default 0,
  failure_code text,
  failure_summary text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create unique index if not exists uq_pg_acme_orders_external_url on pg_acme_orders (tenant_id, external_order_url);
create unique index if not exists uq_pg_acme_orders_active_request on pg_acme_orders (tenant_id, certificate_request_id) where status in ('pending', 'ready', 'processing');
create index if not exists idx_pg_acme_orders_status on pg_acme_orders (tenant_id, status, retry_after_at, updated_at);

create table if not exists pg_acme_authorizations (
  id text primary key,
  tenant_id text not null,
  order_id text not null references pg_acme_orders(id),
  external_authorization_url text not null,
  identifier jsonb not null,
  status text not null,
  expires_at timestamptz,
  wildcard boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create unique index if not exists uq_pg_acme_authorizations_url on pg_acme_authorizations (tenant_id, external_authorization_url);
create index if not exists idx_pg_acme_authorizations_order_status on pg_acme_authorizations (tenant_id, order_id, status);

create table if not exists pg_acme_challenges (
  id text primary key,
  tenant_id text not null,
  order_id text not null references pg_acme_orders(id),
  authorization_id text not null references pg_acme_authorizations(id),
  external_challenge_url text not null,
  type text not null,
  identifier text not null,
  token_sha256 char(64) not null,
  key_authorization_sha256 char(64) not null,
  presentation_id text,
  status text not null,
  lease_owner text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  retry_after_at timestamptz,
  failure_code text,
  failure_summary text,
  cleanup_error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create unique index if not exists uq_pg_acme_challenges_url on pg_acme_challenges (tenant_id, external_challenge_url);
create index if not exists idx_pg_acme_challenges_lease on pg_acme_challenges (tenant_id, status, lease_expires_at, updated_at);

create table if not exists pg_acme_http01_presentations (
  token_sha256 char(64) primary key,
  tenant_id text not null,
  identifier text not null,
  key_authorization text not null,
  presentation_id text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create unique index if not exists uq_pg_acme_http01_presentation_id on pg_acme_http01_presentations (tenant_id, presentation_id);
create index if not exists idx_pg_acme_http01_presentations_expiry on pg_acme_http01_presentations (expires_at);

create table if not exists pg_acme_renewal_policies (
  id text primary key,
  tenant_id text not null,
  certificate_asset_id text references pg_certificate_assets(id),
  binding_id text,
  provider_id text not null references pg_ca_providers(id),
  account_id text not null references pg_acme_accounts(id),
  enabled boolean not null default true,
  renewal_window_days integer not null,
  challenge_type text not null,
  rotate_key_on_renewal boolean not null default true,
  deployment_mode text not null,
  max_attempts integer not null default 5,
  backoff_seconds integer not null default 300,
  maintenance_window jsonb,
  status text not null,
  version integer not null default 1,
  created_by text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create unique index if not exists uq_pg_acme_renewal_policies_asset on pg_acme_renewal_policies (tenant_id, certificate_asset_id) where certificate_asset_id is not null and status <> 'disabled';
create unique index if not exists uq_pg_acme_renewal_policies_binding on pg_acme_renewal_policies (tenant_id, binding_id) where binding_id is not null and status <> 'disabled';
create index if not exists idx_pg_acme_renewal_policies_due on pg_acme_renewal_policies (tenant_id, enabled, status, updated_at);

alter table if exists pg_certificate_renewal_jobs
  add column if not exists policy_id text references pg_acme_renewal_policies(id),
  add column if not exists source_certificate_version_id text references pg_certificate_versions(id),
  add column if not exists acme_order_id text references pg_acme_orders(id),
  add column if not exists deployment_plan_id text,
  add column if not exists execution_run_id text,
  add column if not exists promotion_status text not null default 'pending',
  add column if not exists attempt_count integer not null default 0,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists failure_code text,
  add column if not exists failure_message text,
  add column if not exists policy_snapshot jsonb;
create index if not exists idx_pg_certificate_renewal_jobs_lease on pg_certificate_renewal_jobs (tenant_id, status, next_attempt_at, lease_expires_at, scheduled_at);
create unique index if not exists uq_pg_certificate_renewal_jobs_acme_active on pg_certificate_renewal_jobs (tenant_id, source_certificate_version_id, renewal_window_key)
  where source_certificate_version_id is not null and status not in ('completed', 'failed', 'rollback_required', 'cancelled');

alter table if exists pg_certificate_versions add column if not exists activation_state text not null default 'promoted';
alter table if exists pg_certificate_versions drop constraint if exists ck_pg_certificate_versions_activation_state;
alter table if exists pg_certificate_versions add constraint ck_pg_certificate_versions_activation_state check (activation_state in ('staged', 'promoted'));
create index if not exists idx_pg_certificate_versions_activation on pg_certificate_versions (tenant_id, certificate_asset_id, activation_state, not_after desc);

do $$
begin
  if to_regclass('public.pg_acme_plugin_requests') is not null then
    execute $sql$
      update pg_acme_plugin_requests
      set status = 'UNKNOWN',
          unknown_reason = coalesce(unknown_reason, 'NATIVE_ACME_RUNTIME_RESTORED'),
          next_action = 'manual_recovery_required',
          updated_at = now()
      where status not in ('SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN')
    $sql$;
  end if;
  if to_regclass('public.pg_acme_plugin_operations') is not null then
    execute $sql$
      update pg_acme_plugin_operations
      set status = 'UNKNOWN',
          may_be_unknown = true,
          last_error_code = coalesce(last_error_code, 'NATIVE_ACME_RUNTIME_RESTORED'),
          last_error_message = coalesce(last_error_message, 'ACME 插件运行时已退役，禁止继续触发 Plugin Runner'),
          updated_at = now()
      where status not in ('SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN')
    $sql$;
  end if;
end
$$;
