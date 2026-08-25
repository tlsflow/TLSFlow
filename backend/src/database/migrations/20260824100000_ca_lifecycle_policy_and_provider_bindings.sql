-- 003.6：Provider 动作绑定与证书策略。历史 baseline 不可修改，所有新增字段通过本迁移追加。
create table if not exists pg_ca_provider_action_bindings (
  id text primary key,
  tenant_id text not null,
  provider_id text not null references pg_ca_providers(id) on delete cascade,
  plugin_version_id text not null,
  execution_location text not null,
  approval_mode text not null default 'none',
  capability_evidence jsonb not null default '{}'::jsonb,
  status text not null,
  payload jsonb not null default '{}'::jsonb,
  created_by text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint pg_ca_provider_action_bindings_location_check check (execution_location in ('control_plane', 'agent')),
  constraint pg_ca_provider_action_bindings_approval_check check (approval_mode in ('none', 'gcac_before_submit', 'external_ca_after_submit')),
  constraint pg_ca_provider_action_bindings_status_check check (status in ('draft', 'active', 'revalidation_required', 'disabled'))
);
create index if not exists idx_ca_provider_action_bindings_provider on pg_ca_provider_action_bindings (tenant_id, provider_id, updated_at desc);

create table if not exists pg_certificate_policies (
  id text primary key,
  tenant_id text not null,
  status text not null,
  current_version integer not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint pg_certificate_policies_status_check check (status in ('active', 'disabled')),
  constraint pg_certificate_policies_version_check check (current_version > 0)
);
create unique index if not exists uq_certificate_policies_active_tenant on pg_certificate_policies (tenant_id) where status = 'active';

create table if not exists pg_certificate_policy_versions (
  id text primary key,
  policy_id text not null references pg_certificate_policies(id) on delete cascade,
  version_no integer not null,
  rules jsonb not null,
  created_by text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (policy_id, version_no)
);

alter table pg_certificate_requests add column if not exists certificate_policy_version_id text references pg_certificate_policy_versions(id);
alter table pg_certificate_requests add column if not exists provider_action_binding_id text references pg_ca_provider_action_bindings(id);
create index if not exists idx_certificate_requests_policy_binding on pg_certificate_requests (tenant_id, certificate_policy_version_id, provider_action_binding_id);
