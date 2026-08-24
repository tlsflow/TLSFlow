create table if not exists plugin_promotion_records (
  id varchar(64) primary key,
  tenant_id varchar(64) not null,
  source_plugin_binding_id varchar(64) not null,
  target_plugin_binding_id varchar(64),
  device_asset_id varchar(64),
  application_asset_id varchar(64),
  status varchar(32) not null check (status in ('PREVIEWED','CONFLICT','RUNNING','COMPLETED','ERROR','REVOKED')),
  preview_snapshot jsonb not null,
  created_resources jsonb not null default '{}'::jsonb,
  error_code varchar(128),
  error_message text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  revoked_at timestamptz,
  version integer not null default 1
);

create index if not exists idx_plugin_promotion_records_tenant_status
  on plugin_promotion_records (tenant_id, status, updated_at desc);

create unique index if not exists uq_plugin_promotion_records_active_source
  on plugin_promotion_records (tenant_id, source_plugin_binding_id)
  where status in ('PREVIEWED','RUNNING','COMPLETED');
