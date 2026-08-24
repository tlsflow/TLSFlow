-- 006.3：记录 Provider 证书更新前的远端状态，供验证失败或人工确认后的恢复使用。

create table if not exists pg_provider_operation_ledger (
  id varchar(128) primary key,
  tenant_id varchar(128) not null,
  cloud_account_asset_id varchar(128) not null references pg_cloud_account_assets(id),
  provider_key varchar(128) not null,
  framework_type varchar(192) not null,
  operation_key varchar(128) not null,
  target_ref jsonb not null,
  checkpoint jsonb not null,
  status varchar(32) not null default 'AVAILABLE'
    check (status in ('AVAILABLE', 'USED', 'EXPIRED', 'FAILED')),
  created_at timestamptz not null default now(),
  used_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_provider_operation_ledger_target
  on pg_provider_operation_ledger (tenant_id, cloud_account_asset_id, provider_key, framework_type, operation_key, created_at desc);
