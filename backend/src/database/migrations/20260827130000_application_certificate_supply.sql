-- 003.6：应用级证书供应策略。历史迁移不可变，本文件只追加策略聚合和专属证书归属。
create table if not exists pg_application_certificate_policies (
  id text primary key,
  tenant_id text not null,
  application_asset_id text not null,
  current_version_id text,
  current_dedicated_certificate_asset_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_application_certificate_policy_tenant_asset unique (tenant_id, application_asset_id)
);

create table if not exists pg_application_certificate_policy_versions (
  id text primary key,
  policy_id text not null references pg_application_certificate_policies(id),
  tenant_id text not null,
  application_asset_id text not null,
  version_no integer not null,
  is_active boolean not null default false,
  primary_domain text not null,
  supply_mode text not null,
  certificate_asset_id text,
  certificate_version_id text,
  provider_type text,
  provider_id text,
  certificate_authority_id text,
  acme_provider_profile_id text,
  dns_provider_id text,
  credential_ref text,
  certificate_profile_version_id text,
  custody_mode text,
  deployment_artifact_mode text,
  auto_renew boolean not null default false,
  renewal_window_days integer,
  rotate_key_on_renewal boolean not null default false,
  status text not null,
  policy_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_application_certificate_policy_version unique (policy_id, version_no),
  constraint ck_application_certificate_policy_supply_mode check (supply_mode in ('manual', 'dedicated')),
  constraint ck_application_certificate_policy_provider_type check (provider_type is null or provider_type in ('internal_ca', 'acme')),
  constraint ck_application_certificate_policy_custody_mode check (custody_mode is null or custody_mode in ('agent_local', 'device_local', 'managed_secret')),
  constraint ck_application_certificate_policy_artifact_mode check (deployment_artifact_mode is null or deployment_artifact_mode in ('certificate_only', 'certificate_with_private_key')),
  constraint ck_application_certificate_policy_status check (status in ('draft', 'provisioning', 'issued', 'ready_to_deploy', 'deployed', 'tls_verified', 'trust_pending', 'renewing', 'needs_attention', 'disabled')),
  constraint ck_application_certificate_policy_version_positive check (version_no > 0),
  constraint ck_application_certificate_policy_tenant_match check (tenant_id <> '' and application_asset_id <> '')
);

create unique index if not exists uq_application_certificate_policy_active_version
  on pg_application_certificate_policy_versions (policy_id)
  where is_active;
create unique index if not exists uq_application_certificate_policy_active_dedicated_asset
  on pg_application_certificate_policy_versions (tenant_id, certificate_asset_id)
  where is_active and supply_mode = 'dedicated' and certificate_asset_id is not null;
create index if not exists idx_application_certificate_policy_versions_asset
  on pg_application_certificate_policy_versions (tenant_id, application_asset_id, version_no desc);

-- 专属证书需要独立归属关系；保留历史“租户+域名”唯一语义，仅将专属资产从该条件中隔离。
alter table pg_certificate_assets add column if not exists application_asset_id text;
create index if not exists idx_pg_certificate_assets_application_asset
  on pg_certificate_assets (tenant_id, application_asset_id)
  where application_asset_id is not null;
drop index if exists uq_pg_certificate_assets_tenant_domain;
create unique index if not exists uq_pg_certificate_assets_tenant_domain
  on pg_certificate_assets (tenant_id, lower(primary_domain))
  where status <> 'deleted' and application_asset_id is null;
create unique index if not exists uq_pg_certificate_assets_tenant_application
  on pg_certificate_assets (tenant_id, application_asset_id)
  where status <> 'deleted' and application_asset_id is not null;
create index if not exists idx_pg_certificate_assets_dedicated_domain
  on pg_certificate_assets (tenant_id, lower(primary_domain), application_asset_id)
  where status <> 'deleted' and application_asset_id is not null;

-- 兼容既有应用：存在证书绑定时沿用绑定版本；没有绑定的应用进入 manual/draft。
insert into pg_application_certificate_policies (
  id, tenant_id, application_asset_id, current_version_id,
  current_dedicated_certificate_asset_id, created_at, updated_at
)
select
  'acp_' || asset.id,
  asset.tenant_id,
  asset.id,
  'acpv_' || asset.id,
  null,
  asset.created_at,
  now()
from pg_service_assets asset
where asset.asset_kind = 'APPLICATION'
  and asset.deleted_at is null
on conflict (tenant_id, application_asset_id) do nothing;

insert into pg_application_certificate_policy_versions (
  id, policy_id, tenant_id, application_asset_id, version_no, is_active,
  primary_domain, supply_mode, certificate_asset_id, certificate_version_id,
  status, policy_snapshot, created_at, updated_at
)
select
  'acpv_' || asset.id,
  'acp_' || asset.id,
  asset.tenant_id,
  asset.id,
  1,
  true,
  lower(asset.address),
  'manual',
  version.certificate_asset_id,
  version.id,
  case when version.id is null then 'draft' else 'deployed' end,
  jsonb_build_object('migration', '20260827130000', 'legacyBinding', version.id is not null),
  asset.created_at,
  now()
from pg_service_assets asset
left join lateral (
  select v.id, v.certificate_asset_id
  from pg_certificate_bindings binding
  join pg_certificate_versions v on v.id = binding.certificate_version_id
  where binding.tenant_id = asset.tenant_id
    and binding.service_asset_id = asset.id
    and binding.deleted_at is null
    and binding.certificate_version_id is not null
  order by coalesce(binding.updated_at, binding.created_at) desc, binding.id desc
  limit 1
) version on true
where asset.asset_kind = 'APPLICATION'
  and asset.deleted_at is null
on conflict (policy_id, version_no) do nothing;

update pg_application_certificate_policies policy
set current_version_id = version.id,
    updated_at = now()
from pg_application_certificate_policy_versions version
where version.policy_id = policy.id
  and version.is_active;
