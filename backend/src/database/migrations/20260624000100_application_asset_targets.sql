create table if not exists pg_application_asset_targets (
  id text primary key,
  tenant_id text not null,
  application_asset_id text not null references pg_service_assets(id),
  agent_id text not null,
  site_asset_id text not null references pg_site_assets(id),
  managed_target_id text not null references pg_managed_targets(id),
  provider_type varchar(32) not null,
  framework_type varchar(32) not null,
  target_type varchar(32) not null,
  target_key varchar(255) not null,
  binding_key varchar(255),
  status varchar(32) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

create unique index if not exists uq_pg_application_asset_targets_active_application
  on pg_application_asset_targets (tenant_id, application_asset_id)
  where deleted_at is null;

create unique index if not exists uq_pg_application_asset_targets_target
  on pg_application_asset_targets (tenant_id, application_asset_id, managed_target_id, target_key)
  where deleted_at is null;

create index if not exists idx_pg_application_asset_targets_agent
  on pg_application_asset_targets (tenant_id, agent_id);

create index if not exists idx_pg_application_asset_targets_site_asset
  on pg_application_asset_targets (tenant_id, site_asset_id);

create index if not exists idx_pg_application_asset_targets_managed_target
  on pg_application_asset_targets (tenant_id, managed_target_id);

create index if not exists idx_pg_application_asset_targets_status
  on pg_application_asset_targets (tenant_id, status);
