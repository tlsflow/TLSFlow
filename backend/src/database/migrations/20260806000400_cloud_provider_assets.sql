-- 006.3：云 Provider 扩展和云账号资产基础表。
-- 只新增表和索引，不修改既有 Device/Host 历史表及迁移。

create table if not exists pg_cloud_account_assets (
  id varchar(128) primary key,
  tenant_id varchar(128) not null,
  asset_kind varchar(32) not null default 'cloud.account',
  provider_key varchar(128) not null,
  display_name varchar(255) not null,
  account_id varchar(255),
  credential_ref varchar(512) not null,
  scope jsonb not null default '{}'::jsonb,
  identity_key varchar(512) not null,
  status varchar(32) not null default 'ACTIVE'
    check (status in ('ACTIVE', 'DISABLED', 'ERROR', 'DELETED')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  constraint ck_cloud_account_assets_kind check (asset_kind = 'cloud.account'),
  constraint ck_cloud_account_assets_credential_ref check (
    credential_ref like 'secret://%' or credential_ref like 'credential://%'
  )
);

create unique index if not exists uq_cloud_account_assets_identity
  on pg_cloud_account_assets (tenant_id, identity_key)
  where deleted_at is null;

create index if not exists idx_cloud_account_assets_provider_status
  on pg_cloud_account_assets (tenant_id, provider_key, status, updated_at desc);
